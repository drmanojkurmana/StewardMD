/* test/kardia-sync-relay.test.mjs
 * Unit tests for Kardia SyncProbe Relay core, Worker logic, and client adapter.
 *
 * Requirements covered:
 * - Token expiry (5 min validity, timeout triggers)
 * - Role binding (display bound to uid, probe, single use per role, no swap)
 * - Third socket rejected (max 1 display + 1 probe, second probe rejected)
 * - Rate and size limits (max 128 bytes, max 60 fps per socket, excess dropped)
 * - Cross-room isolation (tokens, frames, closure isolated)
 * - Invalidation on close (either side closing, BYE frame, idle 60 s timeout)
 * - Protocol parsing and generator helpers
 * - Client adapter (kardia-sync-relay.js) transport interface
 *
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/kardia-sync-relay.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as Core from "../kardia-sync-worker/src/core.js";
import relayTransport from "../kardia-sync-relay.js";

// Helper to create a standard test room
function createTestRoom(opts = {}) {
  const now = opts.now || Date.now();
  const roomId = opts.roomId || "0123456789abcdef0123456789abcdef";
  const roomToken = opts.roomToken || "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ab";
  const displayUid = opts.displayUid || "uid-display-1";
  return new Core.SyncRoomCore({
    roomId,
    roomToken,
    displayUid,
    now,
    ...opts,
  });
}

// Helper to construct a mock binary frame [version, type, ...data]
function makeFrame(type, length = 30) {
  const u8 = new Uint8Array(length);
  u8[0] = 1; // version 1
  u8[1] = type;
  for (let i = 2; i < length; i++) u8[i] = (i * 7) & 0xff;
  return u8;
}

/* ==================== 1. Token Expiry ==================== */
test("token expiry: 5 minute session validity, expiresAt enforcement", () => {
  const t0 = 100000;
  const room = createTestRoom({ now: t0 });

  assert.equal(room.expiresAt, t0 + Core.SESSION_TTL_MS);
  assert.equal(Core.SESSION_TTL_MS, 300000, "5 minutes in ms");

  // Connecting at 4m 59s succeeds
  const okCheck = room.canConnect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: room.roomToken,
    now: t0 + 299999,
  });
  assert.equal(okCheck.ok, true);

  // Connecting at 5m 00s fails due to expiry
  const expiredCheck = room.canConnect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: room.roomToken,
    now: t0 + 300000,
  });
  assert.equal(expiredCheck.ok, false);
  assert.equal(expiredCheck.reason, "expired");

  // checkTimeouts triggers session_expired and invalidates room
  const room2 = createTestRoom({ now: t0 });
  room2.connect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: room2.roomToken,
    now: t0,
  });
  assert.equal(room2.checkTimeouts(t0 + 10000), null, "not expired yet");
  const timeout = room2.checkTimeouts(t0 + 300001);
  assert.ok(timeout);
  assert.equal(timeout.expired, true);
  assert.equal(timeout.reason, "session_expired");
  assert.equal(room2.closed, true);
  assert.equal(room2.roomToken, null, "token invalidated");
});

/* ==================== 2. Role Binding ==================== */
test("role binding: display bound to creator uid, probe unconstrained, roles cannot swap", () => {
  const room = createTestRoom();

  // Display must match creator's uid
  const wrongUid = room.connect({
    role: "display",
    tokenUid: "uid-stranger",
    roomToken: room.roomToken,
  });
  assert.equal(wrongUid.ok, false);
  assert.equal(wrongUid.reason, "uid_mismatch");

  // Display matches creator's uid -> binds display
  const dispOk = room.connect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: room.roomToken,
  });
  assert.equal(dispOk.ok, true);
  assert.equal(room.connected.display, true);
  assert.equal(room.rolesUsed.display, true);

  // Probe can be any learner uid
  const probeOk = room.connect({
    role: "probe",
    tokenUid: "uid-learner-2",
    roomToken: room.roomToken,
  });
  assert.equal(probeOk.ok, true);
  assert.equal(room.connected.probe, true);
  assert.equal(room.rolesUsed.probe, true);

  // Roles cannot swap: sending socket claiming a role it's not bound to
  const badRoleMsg = room.onMessage({
    role: "invalid-role",
    data: makeFrame(Core.TYPE_POSE),
  });
  assert.equal(badRoleMsg.forwarded, false);
  assert.equal(badRoleMsg.reason, "invalid_role");

  // Simultaneous socket for connected role rejected
  const secondDisplay = room.connect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: room.roomToken,
  });
  assert.equal(secondDisplay.ok, false);
  assert.equal(secondDisplay.reason, "display_already_connected");

  // Different uid rejected after probe was bound
  const secondProbe = room.connect({
    role: "probe",
    tokenUid: "uid-learner-3",
    roomToken: room.roomToken,
  });
  assert.equal(secondProbe.ok, false);
  assert.equal(secondProbe.reason, "uid_mismatch");

  // Second simultaneous socket for already connected probe is rejected
  const secondProbeSame = room.connect({
    role: "probe",
    tokenUid: "uid-learner-2",
    roomToken: room.roomToken,
  });
  assert.equal(secondProbeSame.ok, false);
  assert.equal(secondProbeSame.reason, "probe_already_connected");
});

/* ==================== 3. Third Socket Rejected ==================== */
test("third socket rejected: max 1 display and 1 probe; second probe rejected even early", () => {
  // Test early second probe rejection before display connects
  const room1 = createTestRoom();
  const probe1 = room1.connect({
    role: "probe",
    tokenUid: "learner-1",
    roomToken: room1.roomToken,
  });
  assert.equal(probe1.ok, true);

  const probe2 = room1.connect({
    role: "probe",
    tokenUid: "learner-2",
    roomToken: room1.roomToken,
  });
  assert.equal(probe2.ok, false, "second probe rejected before display connects");
  assert.equal(probe2.reason, "uid_mismatch");

  // Test third socket when both display and probe are connected
  const room2 = createTestRoom();
  room2.connect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: room2.roomToken,
  });
  room2.connect({
    role: "probe",
    tokenUid: "learner-1",
    roomToken: room2.roomToken,
  });

  const third = room2.canConnect({
    role: "probe",
    tokenUid: "learner-2",
    roomToken: room2.roomToken,
  });
  assert.equal(third.ok, false, "third socket rejected");

  const thirdOther = room2.canConnect({
    role: "other",
    tokenUid: "other",
    roomToken: room2.roomToken,
  });
  assert.equal(thirdOther.ok, false);
});

/* ==================== 4. Rate and Size Limits ==================== */
test("size limit: max 128 bytes, excess frames dropped", () => {
  const room = createTestRoom();
  room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken });
  room.connect({ role: "probe", tokenUid: "learner-1", roomToken: room.roomToken });

  // 128 bytes -> allowed
  const frame128 = makeFrame(Core.TYPE_POSE, 128);
  const res128 = room.onMessage({ role: "probe", data: frame128 });
  assert.equal(res128.forwarded, true);
  assert.equal(res128.toRole, "display");

  // 129 bytes -> dropped
  const frame129 = makeFrame(Core.TYPE_POSE, 129);
  const res129 = room.onMessage({ role: "probe", data: frame129 });
  assert.equal(res129.forwarded, false);
  assert.equal(res129.dropped, true);
  assert.equal(res129.reason, "size_limit");

  // 256 bytes -> dropped
  const frame256 = makeFrame(Core.TYPE_POSE, 256);
  const res256 = room.onMessage({ role: "probe", data: frame256 });
  assert.equal(res256.forwarded, false);
  assert.equal(res256.dropped, true);
  assert.equal(res256.reason, "size_limit");

  // Non-binary frame -> dropped
  const textMsg = room.onMessage({ role: "probe", data: "text not binary" });
  assert.equal(textMsg.forwarded, false);
  assert.equal(textMsg.dropped, true);
  assert.equal(textMsg.reason, "non_binary");
});

test("rate limit: max 60 fps per socket, excess dropped, independent socket buckets", () => {
  const t0 = Date.now();
  const room = createTestRoom({ now: t0 });
  room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken, now: t0 });
  room.connect({ role: "probe", tokenUid: "learner-1", roomToken: room.roomToken, now: t0 });

  const frame = makeFrame(Core.TYPE_POSE, 30);
  const now = t0 + 1000;

  // Send 60 frames from probe in the same 1000ms window -> all accepted
  for (let i = 0; i < 60; i++) {
    const res = room.onMessage({ role: "probe", data: frame, now: now + i * 10 });
    assert.equal(res.forwarded, true, "frame " + i + " should forward");
  }

  // 61st frame in the same window from probe -> dropped
  const res61 = room.onMessage({ role: "probe", data: frame, now: now + 700 });
  assert.equal(res61.forwarded, false);
  assert.equal(res61.dropped, true);
  assert.equal(res61.reason, "rate_limit");

  // Display socket has its own independent bucket: display can still send 60 frames
  for (let i = 0; i < 60; i++) {
    const resDisp = room.onMessage({ role: "display", data: frame, now: now + i * 10 });
    assert.equal(resDisp.forwarded, true, "display frame " + i + " should forward");
  }

  // 61st frame from display -> dropped
  const resDisp61 = room.onMessage({ role: "display", data: frame, now: now + 700 });
  assert.equal(resDisp61.forwarded, false);
  assert.equal(resDisp61.dropped, true);
  assert.equal(resDisp61.reason, "rate_limit");

  // After 1000ms window passes, probe can send again
  const nextSecond = now + 1650;
  const resNewSec = room.onMessage({ role: "probe", data: frame, now: nextSecond });
  assert.equal(resNewSec.forwarded, true, "new 1s window allows frames");
});

/* ==================== 5. Cross-room Isolation ==================== */
test("cross-room isolation: separate tokens, independent relay, no frame leakage", () => {
  const roomA = createTestRoom({
    roomId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    roomToken: "TokenForRoomA_0123456789-_abcdefghijk",
    displayUid: "doc-A",
  });
  const roomB = createTestRoom({
    roomId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    roomToken: "TokenForRoomB_0123456789-_abcdefghijk",
    displayUid: "doc-B",
  });

  // Token for Room A rejected in Room B
  const badToken = roomB.connect({
    role: "display",
    tokenUid: "doc-B",
    roomToken: roomA.roomToken,
  });
  assert.equal(badToken.ok, false);
  assert.equal(badToken.reason, "invalid_room_token");

  // Connect both rooms legitimately
  roomA.connect({ role: "display", tokenUid: "doc-A", roomToken: roomA.roomToken });
  roomA.connect({ role: "probe", tokenUid: "learner-A", roomToken: roomA.roomToken });

  roomB.connect({ role: "display", tokenUid: "doc-B", roomToken: roomB.roomToken });
  roomB.connect({ role: "probe", tokenUid: "learner-B", roomToken: roomB.roomToken });

  // Probe in Room A sends a frame
  const frameA = makeFrame(Core.TYPE_POSE, 40);
  const outA = roomA.onMessage({ role: "probe", data: frameA });
  assert.equal(outA.forwarded, true);
  assert.equal(outA.toRole, "display");

  // Invalidate Room A: Room B is completely unaffected
  roomA.invalidate("closed");
  assert.equal(roomA.closed, true);
  assert.equal(roomB.closed, false, "Room B stays open and operational");

  const frameB = makeFrame(Core.TYPE_POSE, 40);
  const outB = roomB.onMessage({ role: "probe", data: frameB });
  assert.equal(outB.forwarded, true);
  assert.equal(outB.toRole, "display");
});

/* ==================== 6. Socket Drops and Invalidation ==================== */
test("socket drops: display disconnect does not close peer or invalidate room", () => {
  const room = createTestRoom();
  room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken });
  room.connect({ role: "probe", tokenUid: "learner-1", roomToken: room.roomToken });

  const closeRes = room.onClose({ role: "display", reason: "display left" });
  assert.equal(closeRes.closePeer, false, "peer remains connected");
  assert.equal(closeRes.peerRole, "probe");
  assert.equal(room.closed, false, "room remains open");
  assert.notEqual(room.roomToken, null, "token preserved");
  assert.equal(room.connected.display, false);
  assert.equal(room.connected.probe, true);

  // Subsequent connection attempt with same uid succeeds
  const reconnect = room.canConnect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: room.roomToken,
  });
  assert.equal(reconnect.ok, true);
});

test("socket drops: probe disconnect does not close peer or invalidate room", () => {
  const room = createTestRoom();
  room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken });
  room.connect({ role: "probe", tokenUid: "learner-1", roomToken: room.roomToken });

  const closeRes = room.onClose({ role: "probe", reason: "probe disconnected" });
  assert.equal(closeRes.closePeer, false, "peer remains connected");
  assert.equal(closeRes.peerRole, "display");
  assert.equal(room.closed, false, "room remains open");
  assert.notEqual(room.roomToken, null, "token preserved");
  assert.equal(room.connected.probe, false);
  assert.equal(room.connected.display, true);

  // Subsequent connection attempt with same uid succeeds
  const reconnect = room.canConnect({
    role: "probe",
    tokenUid: "learner-1",
    roomToken: room.roomToken,
  });
  assert.equal(reconnect.ok, true);
});

test("probe drops and the same uid rejoins", () => {
  const t0 = 100000;
  const room = createTestRoom({ now: t0 });

  // 1. Initial connect
  const dConn = room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken, now: t0 });
  assert.equal(dConn.ok, true);
  const pConn = room.connect({ role: "probe", tokenUid: "uid-probe-1", roomToken: room.roomToken, now: t0 + 100 });
  assert.equal(pConn.ok, true);
  assert.equal(room.connected.probe, true);
  assert.equal(room.probeUid, "uid-probe-1");

  // Frames flow
  const frame1 = makeFrame(Core.TYPE_POSE, 32);
  const m1 = room.onMessage({ role: "probe", data: frame1, now: t0 + 200 });
  assert.equal(m1.forwarded, true);

  // 2. Probe drops (e.g. mobile network drop or screen lock)
  const dropRes = room.onClose({ role: "probe", now: t0 + 500, reason: "network_drop" });
  assert.equal(dropRes.closePeer, false, "peer is not closed on drop");
  assert.equal(room.connected.probe, false, "probe marked disconnected");
  assert.equal(room.connected.display, true, "display remains connected waiting for reconnect");
  assert.equal(room.closed, false, "room is not closed on drop");
  assert.notEqual(room.roomToken, null, "room token is preserved for reconnect");

  // While disconnected, probe frame cannot be sent
  const dropMsg = room.onMessage({ role: "probe", data: frame1, now: t0 + 600 });
  assert.equal(dropMsg.forwarded, false);
  assert.equal(dropMsg.reason, "role_not_connected");

  // 3. Same uid rejoins within session expiry and idle timeout
  const rejoinCheck = room.canConnect({
    role: "probe",
    tokenUid: "uid-probe-1",
    roomToken: room.roomToken,
    now: t0 + 1000,
  });
  assert.equal(rejoinCheck.ok, true, "same probe uid can reconnect");

  const rejoinConn = room.connect({
    role: "probe",
    tokenUid: "uid-probe-1",
    roomToken: room.roomToken,
    now: t0 + 1000,
  });
  assert.equal(rejoinConn.ok, true);
  assert.equal(room.connected.probe, true);
  assert.equal(room.probeUid, "uid-probe-1");

  // Frames flow again after rejoin
  const frame2 = makeFrame(Core.TYPE_POSE, 32);
  const m2 = room.onMessage({ role: "probe", data: frame2, now: t0 + 1100 });
  assert.equal(m2.forwarded, true);
  assert.equal(m2.toRole, "display");
});

test("a different uid with the right token is rejected after the probe was bound", () => {
  const room = createTestRoom();
  room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken });

  // First probe connects -> binds probeUid
  const p1 = room.connect({ role: "probe", tokenUid: "uid-legit-probe", roomToken: room.roomToken });
  assert.equal(p1.ok, true);
  assert.equal(room.probeUid, "uid-legit-probe");

  // Probe drops
  room.onClose({ role: "probe" });
  assert.equal(room.connected.probe, false);

  // Another client with correct roomToken but DIFFERENT uid tries to connect as probe
  const impostorCheck = room.canConnect({
    role: "probe",
    tokenUid: "uid-intruder",
    roomToken: room.roomToken,
  });
  assert.equal(impostorCheck.ok, false);
  assert.equal(impostorCheck.status, 403);
  assert.equal(impostorCheck.reason, "uid_mismatch");

  const impostorConn = room.connect({
    role: "probe",
    tokenUid: "uid-intruder",
    roomToken: room.roomToken,
  });
  assert.equal(impostorConn.ok, false);
  assert.equal(impostorConn.reason, "uid_mismatch");
  assert.equal(room.connected.probe, false);
  assert.equal(room.probeUid, "uid-legit-probe", "bound probeUid remains unchanged");
});

test("display rejoin by its uid", () => {
  const room = createTestRoom({ displayUid: "uid-host-doc" });
  room.connect({ role: "display", tokenUid: "uid-host-doc", roomToken: room.roomToken });
  room.connect({ role: "probe", tokenUid: "uid-learner-1", roomToken: room.roomToken });

  // Display drops (e.g. mobile app backgrounded / screen lock)
  const dropRes = room.onClose({ role: "display", reason: "backgrounded" });
  assert.equal(dropRes.closePeer, false);
  assert.equal(room.connected.display, false);
  assert.equal(room.connected.probe, true, "probe stays connected");
  assert.equal(room.closed, false);

  // Different uid trying to claim display role is rejected
  const fakeDisp = room.canConnect({
    role: "display",
    tokenUid: "uid-someone-else",
    roomToken: room.roomToken,
  });
  assert.equal(fakeDisp.ok, false);
  assert.equal(fakeDisp.reason, "uid_mismatch");

  // Legitimate display rejoins by its uid
  const legitRejoin = room.connect({
    role: "display",
    tokenUid: "uid-host-doc",
    roomToken: room.roomToken,
  });
  assert.equal(legitRejoin.ok, true);
  assert.equal(room.connected.display, true);

  // Second simultaneous socket for display is rejected
  const dupDisp = room.canConnect({
    role: "display",
    tokenUid: "uid-host-doc",
    roomToken: room.roomToken,
  });
  assert.equal(dupDisp.ok, false);
  assert.equal(dupDisp.reason, "display_already_connected");
});

test("no rejoin after BYE", () => {
  const room = createTestRoom({ displayUid: "uid-doc" });
  const validToken = room.roomToken;
  room.connect({ role: "display", tokenUid: "uid-doc", roomToken: validToken });
  room.connect({ role: "probe", tokenUid: "uid-probe", roomToken: validToken });

  // Probe sends BYE frame (explicit end)
  const bye = makeFrame(Core.TYPE_BYE, 8);
  const msgRes = room.onMessage({ role: "probe", data: bye });
  assert.equal(msgRes.forwarded, true);
  assert.equal(msgRes.closeBoth, true);
  assert.equal(msgRes.reason, "bye");

  // Room is now closed and token wiped
  assert.equal(room.closed, true);
  assert.equal(room.roomToken, null);
  assert.equal(room.connected.display, false);
  assert.equal(room.connected.probe, false);

  // Neither probe nor display can rejoin even with original token
  const probeRejoin = room.canConnect({
    role: "probe",
    tokenUid: "uid-probe",
    roomToken: validToken,
  });
  assert.equal(probeRejoin.ok, false);
  assert.equal(probeRejoin.reason, "room_closed");

  const dispRejoin = room.canConnect({
    role: "display",
    tokenUid: "uid-doc",
    roomToken: validToken,
  });
  assert.equal(dispRejoin.ok, false);
  assert.equal(dispRejoin.reason, "room_closed");
});

test("token compare rejects a one-character change", () => {
  const tok = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ab";
  // Direct constant-time compare
  assert.equal(Core.timingSafeEqualTokens(tok, tok), true, "identical tokens match");

  // Reject 1-char change at the end
  const tokEnd = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ac";
  assert.equal(Core.timingSafeEqualTokens(tok, tokEnd), false, "1-char change at end rejected");

  // Reject 1-char change at the start
  const tokStart = "BbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ab";
  assert.equal(Core.timingSafeEqualTokens(tok, tokStart), false, "1-char change at start rejected");

  // Reject 1-char change in the middle
  const tokMid = "AbCdEfGhIjKlMnOpQrStUvXxYz0123456789-_ab";
  assert.equal(Core.timingSafeEqualTokens(tok, tokMid), false, "1-char change in middle rejected");

  // Reject truncated / different length / null
  assert.equal(Core.timingSafeEqualTokens(tok, tok.slice(0, 32)), false, "different length rejected");
  assert.equal(Core.timingSafeEqualTokens(tok, tok + "x"), false, "longer token rejected");
  assert.equal(Core.timingSafeEqualTokens(tok, null), false, "null rejected");
  assert.equal(Core.timingSafeEqualTokens(tok, ""), false, "empty string rejected");

  // Through room.canConnect
  const room = createTestRoom({ roomToken: tok });
  const checkEnd = room.canConnect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: tokEnd,
  });
  assert.equal(checkEnd.ok, false);
  assert.equal(checkEnd.reason, "invalid_room_token");

  const checkMid = room.canConnect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: tokMid,
  });
  assert.equal(checkMid.ok, false);
  assert.equal(checkMid.reason, "invalid_room_token");

  const checkStart = room.canConnect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: tokStart,
  });
  assert.equal(checkStart.ok, false);
  assert.equal(checkStart.reason, "invalid_room_token");

  // Exact token succeeds
  const checkOk = room.canConnect({
    role: "display",
    tokenUid: "uid-display-1",
    roomToken: tok,
  });
  assert.equal(checkOk.ok, true);
});

test("invalidation on close: BYE frame forwarded then closes both sockets and invalidates", () => {
  const room = createTestRoom();
  room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken });
  room.connect({ role: "probe", tokenUid: "learner-1", roomToken: room.roomToken });

  const byeFrame = makeFrame(Core.TYPE_BYE, 10);
  assert.equal(Core.isByeFrame(byeFrame), true);

  const res = room.onMessage({ role: "probe", data: byeFrame });
  assert.equal(res.forwarded, true, "BYE frame is forwarded to peer");
  assert.equal(res.toRole, "display");
  assert.equal(res.closeBoth, true);
  assert.equal(res.reason, "bye");
  assert.equal(room.closed, true);
  assert.equal(room.roomToken, null, "token invalidated");

  // Subsequent message after BYE dropped
  const postBye = room.onMessage({ role: "display", data: makeFrame(Core.TYPE_POSE) });
  assert.equal(postBye.forwarded, false);
  assert.equal(postBye.reason, "room_closed");
});

test("idle timeout: 60 seconds with no frames closes both and invalidates room", () => {
  const t0 = 100000;
  const room = createTestRoom({ now: t0 });
  room.connect({ role: "display", tokenUid: "uid-display-1", roomToken: room.roomToken, now: t0 });
  room.connect({ role: "probe", tokenUid: "learner-1", roomToken: room.roomToken, now: t0 + 1000 });

  // After 59s: still not idle
  assert.equal(room.checkTimeouts(t0 + 59000), null);

  // After 60s from last active (t0 + 1000 + 60000 = t0 + 61000)
  const timeout = room.checkTimeouts(t0 + 61001);
  assert.ok(timeout);
  assert.equal(timeout.expired, true);
  assert.equal(timeout.closeBoth, true);
  assert.equal(timeout.reason, "idle_timeout");
  assert.equal(room.closed, true);
  assert.equal(room.roomToken, null);
});

/* ==================== 7. Protocol Helpers ==================== */
test("protocol parser: extracts token and roomToken; rejects malformed headers", () => {
  const validHeader = "kardia-sync, eyJhbGciOiJSUzI1NiJ9.payload.sig, Token32BytesBase64Url-_1234567890";
  const parsed = Core.parseProtocol(validHeader);
  assert.ok(parsed);
  assert.equal(parsed.protocol, "kardia-sync");
  assert.equal(parsed.token, "eyJhbGciOiJSUzI1NiJ9.payload.sig");
  assert.equal(parsed.roomToken, "Token32BytesBase64Url-_1234567890");

  for (const bad of [
    null,
    "",
    "other-proto, tok, roomtok",
    "kardia-sync, tok",
    "kardia-sync, not-a-jwt, roomtok",
    "kardia-sync, a.b.c, short",
    "kardia-sync, a.b.c, bad$char!token",
    "kardia-sync, a.b.c, token, extra",
  ]) {
    assert.equal(Core.parseProtocol(bad), null, "should reject: " + bad);
  }
});

test("id and token generators: 128 bit hex roomId, 32 bytes base64url roomToken", () => {
  const id = Core.generateRoomId();
  assert.equal(typeof id, "string");
  assert.equal(id.length, 32, "128 bit = 16 bytes = 32 hex chars");
  assert.ok(/^[0-9a-f]{32}$/.test(id));

  const tok = Core.generateRoomToken();
  assert.equal(typeof tok, "string");
  assert.equal(tok.length, 43, "32 bytes base64url unpadded is 43 chars");
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(tok));
});

/* ==================== 8. Client Transport Adapter ==================== */
test("client adapter: implements contract transport interface (id, kind, capabilities)", async () => {
  assert.equal(relayTransport.id, "relay");
  assert.equal(relayTransport.kind, "relay");

  const origNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  // capabilities() when offline
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: false },
    configurable: true,
    writable: true,
  });
  const capOffline = await relayTransport.capabilities();
  assert.equal(capOffline.available, false);
  assert.equal(capOffline.needsInternet, true);
  assert.ok(!capOffline.reason.toLowerCase().includes("offline"), "never describe relay as offline");
  assert.ok(capOffline.reason.toLowerCase().includes("internet"));

  // capabilities() when online but no user
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true,
    writable: true,
  });
  globalThis.SMD_AUTH = null;
  globalThis.firebase = null;
  const capNoUser = await relayTransport.capabilities();
  assert.equal(capNoUser.available, false);
  assert.equal(capNoUser.reason, "Sign-in required");

  // capabilities() when online and signed in
  globalThis.SMD_AUTH = {
    currentUser: {
      uid: "dr-test",
      getIdToken: () => Promise.resolve("fake-jwt-token"),
    },
  };
  const capOk = await relayTransport.capabilities();
  assert.equal(capOk.available, true);
  assert.equal(capOk.needsInternet, true);
  assert.equal(capOk.maxPayload, 128);

  // Restore navigator
  if (origNav) {
    Object.defineProperty(globalThis, "navigator", origNav);
  } else {
    delete globalThis.navigator;
  }
});

test("client adapter: host and join methods communicate using pairing payload", async () => {
  let createdWsUrl = null;
  let createdWsProtocols = null;

  class MockWebSocket {
    constructor(url, protocols) {
      createdWsUrl = url;
      createdWsProtocols = protocols;
      this.readyState = 0;
      this.bufferedAmount = 0;
      this.sent = [];
      setTimeout(() => {
        this.readyState = 1;
        if (this.onopen) this.onopen();
      }, 5);
    }
    send(bytes) {
      this.sent.push(bytes);
    }
    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({ reason: "closed" });
    }
  }

  const prevWs = globalThis.WebSocket;
  const prevFetch = globalThis.fetch;
  globalThis.WebSocket = MockWebSocket;

  // Mock POST /sync/session
  globalThis.fetch = async (url, opts) => {
    if (url.includes("/sync/session")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          roomId: "room123456789abcdef0123456789abcdef",
          roomToken: "roomTokBase64Url32BytesExample-_1234567890",
          expiresAt: Date.now() + 300000,
        }),
      };
    }
    throw new Error("unexpected fetch: " + url);
  };

  globalThis.SMD_AUTH = {
    currentUser: {
      uid: "doc-host",
      getIdToken: () => Promise.resolve("jwt-doc-host"),
    },
  };

  const pairing = {
    sessionId: "sess16byteshex00",
    shortCode: "KRD2X9",
    displayPub: "base64rawP256Key",
    expiresAt: Date.now() + 300000,
  };

  let connectedRole = null;
  const handlers = {
    onPeerConnected: (info) => { connectedRole = info.role; },
    onBytes: () => {},
    onPeerLost: () => {},
    onError: () => {},
  };

  // 1. Host
  await relayTransport.host(pairing, handlers);
  assert.ok(pairing.relay);
  assert.equal(pairing.relay.roomId, "room123456789abcdef0123456789abcdef");
  assert.equal(pairing.relay.roomToken, "roomTokBase64Url32BytesExample-_1234567890");
  assert.equal(connectedRole, "display");
  assert.ok(createdWsUrl.includes("/sync/room?id=room123456789abcdef0123456789abcdef&role=display"));
  assert.deepEqual(createdWsProtocols, ["kardia-sync", "jwt-doc-host", "roomTokBase64Url32BytesExample-_1234567890"]);

  // Test sending frames
  const sent = relayTransport.send(new Uint8Array([1, 3, 10, 20]));
  assert.equal(sent, true);

  // Test stats
  const st = relayTransport.stats();
  assert.equal(typeof st.sentPerSec, "number");
  assert.equal(typeof st.recvPerSec, "number");

  await relayTransport.close();

  // 2. Join
  globalThis.SMD_AUTH.currentUser = {
    uid: "probe-learner",
    getIdToken: () => Promise.resolve("jwt-probe-learner"),
  };

  await relayTransport.join(pairing, handlers);
  assert.equal(connectedRole, "probe");
  assert.ok(createdWsUrl.includes("/sync/room?id=room123456789abcdef0123456789abcdef&role=probe"));
  assert.deepEqual(createdWsProtocols, ["kardia-sync", "jwt-probe-learner", "roomTokBase64Url32BytesExample-_1234567890"]);

  await relayTransport.close();

  // Cleanup
  globalThis.WebSocket = prevWs;
  globalThis.fetch = prevFetch;
  globalThis.SMD_AUTH = null;
});
