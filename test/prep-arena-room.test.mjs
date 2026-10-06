/* PrepNucleus Arena friend challenges: the `room` in matchmaking (prep-arena-worker/src/core.js). Two invited players
 * with the same room meet each other at once whatever their ratings; never a stranger, never another room; a room-less
 * player never pairs into a room; a room waits ROOM_WAIT_MS (not 30 s) for the friend.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-arena-room.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../prep-arena-worker/src/core.js";

const ids = (r) => r.pairs.map((p) => p.map((x) => x.uidh).sort().join("+"));

test("same room pairs at once, at any rating; strangers and other rooms are skipped", () => {
  const w = [
    { uidh: "s1", rating: 1200, at: 0 },
    { uidh: "r1", rating: 1200, at: 0, room: "AAAAAAAAAAAAAAAA" },
    { uidh: "x1", rating: 1200, at: 0, room: "BBBBBBBBBBBBBBBB" },
    { uidh: "s2", rating: 1210, at: 0 },
    { uidh: "r2", rating: 2000, at: 100, room: "AAAAAAAAAAAAAAAA" },
  ];
  const r = C.matchQueue(w, 200);
  assert.deepEqual(ids(r).sort(), ["r1+r2", "s1+s2"]);
  assert.deepEqual(w.map((x) => x.uidh), ["x1"], "the lone room waits for its friend");
});

test("a room-less player never pairs into a room, even after widening", () => {
  const w = [{ uidh: "r1", rating: 1200, at: 0, room: "AAAAAAAAAAAAAAAA" }, { uidh: "s1", rating: 1200, at: 0 }];
  assert.deepEqual(C.matchQueue(w, 20e3).pairs, []);
  const r = C.matchQueue(w, C.NOBODY_MS);
  assert.deepEqual(r.nobody, ["s1"], "the stranger times out at 30 s");
  assert.deepEqual(w.map((x) => x.uidh), ["r1"], "the room keeps waiting");
});

test("a room waits ROOM_WAIT_MS, and the queue wakes for it", () => {
  const w = [{ uidh: "r1", rating: 1200, at: 0, room: "AAAAAAAAAAAAAAAA" }];
  assert.equal(C.queueWakeAt(w, 0), C.ROOM_WAIT_MS, "no widen step for a room");
  assert.deepEqual(C.matchQueue(w, C.ROOM_WAIT_MS - 1).nobody, []);
  assert.deepEqual(C.matchQueue(w, C.ROOM_WAIT_MS).nobody, ["r1"]);
  // the friend arriving late still meets them
  const w2 = [{ uidh: "r1", rating: 1200, at: 0, room: "CCCCCCCCCCCCCCCC" }, { uidh: "r2", rating: 900, at: 170e3, room: "CCCCCCCCCCCCCCCC" }];
  assert.deepEqual(ids(C.matchQueue(w2, 170e3)), ["r1+r2"]);
});

test("room codes: the social route's 16-character alphabet only", () => {
  assert.ok(C.ROOM_RE.test("ABCDEFGHJKMNPQRS"));
  for (const bad of ["", "abcdefghjkmnpqrs", "ABCDEFGHJKMNPQR", "ABCDEFGHJKMNPQRO", "ABCDEFGHJKMNPQR1", "ABCDEFGHJKMNPQRS&exam=x"]) assert.equal(C.ROOM_RE.test(bad), false, bad);
});
