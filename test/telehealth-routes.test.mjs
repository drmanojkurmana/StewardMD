/* Video visits through the real /api/queue router (functions/_telehealth.js rules).
 *
 * What these defend:
 *   - video is off unless the hospital saved a server, and every video route says so (409),
 *   - the consent (who agreed, who recorded it) lands with its audit row, and without it nothing changes,
 *   - the staff ticket view never carries the room name; only /tele/start (audited) and the patient's room call do,
 *   - the patient's page gets the room only while the visit is in consultation, and the link dies with the visit,
 *   - the settings route is staff.admin, needs a reason, is audited, flags a public server; /org/update refuses it.
 *
 * node --test --experimental-test-module-mocks test/telehealth-routes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docs, api, seed, org, OWNER_A, HR_A, NURSE_A, DAY } from "./helpers/opd-router-harness.mjs";

const SERVER = "https://video.example.org";
const events = () => [...docs.entries()].filter(([k]) => k.startsWith("q_events/")).map(([, d]) => d.fields);
const rawTicket = (id) => docs.get("q_tickets/" + id).fields;
function withVideo(baseUrl, mode) {
  const d = docs.get("q_orgs/org-a");
  d.fields = { ...d.fields, mode: mode || d.fields.mode, wardsynq: { ...(d.fields.wardsynq || {}), telehealth: { baseUrl } } };
}
async function oneTicket() {
  const sess = await api(`/session?hospitalId=org-a&date=${DAY}`, "GET", null, OWNER_A);
  assert.equal(sess.__status, 200, JSON.stringify(sess));
  const t = await api("/ticket", "POST", { sessionId: sess.session.id, name: "Ravi", mobile: "9876543211" }, OWNER_A);
  assert.equal(t.__status, 200, JSON.stringify(t));
  return { sid: sess.session.id, tid: t.ticket.id };
}
const CONSENT = { givenBy: "patient", agreed: true };

test("video off: every video route refuses with 409 and nothing is written", async () => {
  seed();
  const { sid, tid } = await oneTicket();
  for (const sub of ["enable", "start", "send-link"]) {
    const r = await api("/tele/" + sub, "POST", { sessionId: sid, ticketId: tid, teleConsent: CONSENT }, OWNER_A);
    assert.equal(r.__status, 409, sub + " " + JSON.stringify(r));
    assert.equal(r.error, "video_off");
  }
  assert.ok(!rawTicket(tid).teleconsult);
  const board = await api(`/opd-board?orgId=org-a&date=${DAY}`, "GET", null, OWNER_A);
  assert.equal(board.__status, 200, JSON.stringify(board));
  assert.equal(board.telehealth, false, "the desk offers no video visit");
  withVideo(SERVER);
  assert.equal((await api(`/opd-board?orgId=org-a&date=${DAY}`, "GET", null, OWNER_A)).telehealth, true);
});

test("enable: consent required; with it the ticket gets a room, the consent and one tele_consent row; the view hides the room", async () => {
  seed(); withVideo(SERVER);
  const { sid, tid } = await oneTicket();
  const none = await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid }, OWNER_A);
  assert.equal(none.__status, 422, JSON.stringify(none));
  const noWho = await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid, teleConsent: { agreed: true } }, OWNER_A);
  assert.equal(noWho.__status, 422, JSON.stringify(noWho));
  assert.ok(!rawTicket(tid).teleconsult, "refused consent changed nothing");

  const ok = await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid, teleConsent: { givenBy: "parent", agreed: true } }, OWNER_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.ticket.teleconsult, true);
  assert.equal(ok.ticket.teleRoom, undefined, "the staff view never carries the room name");
  const raw = rawTicket(tid);
  assert.match(raw.teleRoom, /^wsq-[0-9a-f]{32}$/);
  assert.equal(raw.teleConsentBy, "parent");
  assert.ok(raw.teleConsentAt > 0);
  assert.ok(raw.teleConsentRecordedBy);
  assert.equal(events().filter((e) => e.action === "tele_consent").length, 1);

  const again = await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid, teleConsent: CONSENT }, OWNER_A);
  assert.equal(again.__status, 200);
  assert.equal(rawTicket(tid).teleRoom, raw.teleRoom, "a double tap mints no second room");
  assert.equal(events().filter((e) => e.action === "tele_consent").length, 1);

  const list = await api(`/list?sessionId=${sid}`, "GET", null, OWNER_A);
  assert.ok(!JSON.stringify(list).includes(raw.teleRoom), "the room name is not in the ticket list");
});

test("patient side: wait page before start, room only in consultation, link dead after the visit", async () => {
  seed(); withVideo(SERVER);
  const { sid, tid } = await oneTicket();
  const link = await api(`/link?sessionId=${sid}&ticketId=${tid}`, "GET", null, OWNER_A);
  const tk = link.token;

  const notTele = await api("/tele/wait?t=" + encodeURIComponent(tk), "GET");
  assert.equal(notTele.error, "invalid_link", "an ordinary visit has no video page");

  await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid, teleConsent: CONSENT }, OWNER_A);
  const room = rawTicket(tid).teleRoom;
  const wait = await api("/tele/wait?t=" + encodeURIComponent(tk), "GET");
  assert.equal(wait.ok, true, JSON.stringify(wait));
  assert.equal(wait.ready, false);
  assert.ok(!JSON.stringify(wait).includes(room), "the waiting page never sees the room before start");
  assert.ok(!/Ravi|9876543211/.test(JSON.stringify(wait)), "no PHI on the patient page");
  const early = await api("/tele/room?t=" + encodeURIComponent(tk), "POST", {});
  assert.equal(early.__status, 409);
  assert.equal(early.error, "not_started");

  const start = await api("/tele/start", "POST", { sessionId: sid, ticketId: tid }, OWNER_A);
  assert.equal(start.__status, 200, JSON.stringify(start));
  assert.equal(start.roomUrl, SERVER + "/" + room);
  assert.equal(rawTicket(tid).status, "in_consultation");
  assert.ok(events().some((e) => e.action === "tele_start"));

  const ready = await api("/tele/wait?t=" + encodeURIComponent(tk), "GET");
  assert.equal(ready.ready, true);
  const join = await api("/tele/room?t=" + encodeURIComponent(tk), "POST", {});
  assert.equal(join.__status, 200, JSON.stringify(join));
  assert.equal(join.roomUrl, SERVER + "/" + room);
  assert.ok(events().some((e) => e.action === "tele_join"));

  const done = await api("/status", "POST", { sessionId: sid, ticketId: tid, status: "completed" }, OWNER_A);
  assert.equal(done.__status, 200, JSON.stringify(done));
  const dead = await api("/tele/room?t=" + encodeURIComponent(tk), "POST", {});
  assert.equal(dead.ok, false);
  assert.ok(!dead.roomUrl, "a finished visit's link opens nothing");
  const deadWait = await api("/tele/wait?t=" + encodeURIComponent(tk), "GET");
  assert.equal(deadWait.ok, false);

  const late = await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid, teleConsent: CONSENT }, OWNER_A);
  assert.equal(late.__status, 200, "already a video visit: returned unchanged");
});

test("video switched off after booking: the patient gets no room", async () => {
  seed(); withVideo(SERVER);
  const { sid, tid } = await oneTicket();
  const tk = (await api(`/link?sessionId=${sid}&ticketId=${tid}`, "GET", null, OWNER_A)).token;
  await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid, teleConsent: CONSENT }, OWNER_A);
  await api("/tele/start", "POST", { sessionId: sid, ticketId: tid }, OWNER_A);
  withVideo("");
  const r = await api("/tele/room?t=" + encodeURIComponent(tk), "POST", {});
  assert.equal(r.error, "video_off");
});

test("send-link: not a video visit is refused; the message carries the waiting page link, no name", async () => {
  seed(); withVideo(SERVER);
  const { sid, tid } = await oneTicket();
  const refused = await api("/tele/send-link", "POST", { sessionId: sid, ticketId: tid }, OWNER_A);
  assert.equal(refused.__status, 409);
  assert.equal(refused.error, "not_teleconsult");
  await api("/tele/enable", "POST", { sessionId: sid, ticketId: tid, teleConsent: CONSENT }, OWNER_A);
  const r = await api("/tele/send-link", "POST", { sessionId: sid, ticketId: tid }, OWNER_A);
  assert.equal(r.__status, 200, JSON.stringify(r));
  assert.match(r.url, /^https:\/\/stewardmd\.in\/tele\?t=/);
  assert.ok(!r.url.includes(rawTicket(tid).teleRoom));
});

test("settings: staff.admin only, WardSynQ hospitals, https, a reason, audited, read back; public server flagged; /org/update refuses it", async () => {
  seed();
  const native = await api("/org/telehealth-settings?orgId=org-a", "GET", null, OWNER_A);
  assert.equal(native.__status, 409);
  assert.equal(native.error, "not_a_wardsynq_hospital");
  docs.get("q_orgs/org-a").fields.mode = "wardsynq";

  const get = await api("/org/telehealth-settings?orgId=org-a", "GET", null, OWNER_A);
  assert.equal(get.__status, 200, JSON.stringify(get));
  assert.deepEqual(get.settings, { on: false, baseUrl: "", publicServer: false }, "off by default");

  const nurse = await api("/org/telehealth-settings", "POST", { orgId: "org-a", settings: { baseUrl: SERVER }, reason: "x" }, NURSE_A);
  assert.equal(nurse.__status, 403);
  const http = await api("/org/telehealth-settings", "POST", { orgId: "org-a", settings: { baseUrl: "http://v.example.org" }, reason: "x" }, HR_A);
  assert.equal(http.__status, 422);
  assert.equal(http.error, "https_required");
  const noWhy = await api("/org/telehealth-settings", "POST", { orgId: "org-a", settings: { baseUrl: SERVER } }, HR_A);
  assert.equal(noWhy.__status, 422);
  assert.equal(noWhy.error, "reason_required");

  const pub = await api("/org/telehealth-settings", "POST", { orgId: "org-a", settings: { baseUrl: "https://meet.jit.si" }, reason: "pilot" }, HR_A);
  assert.equal(pub.__status, 200, JSON.stringify(pub));
  assert.deepEqual(pub.settings, { on: true, baseUrl: "https://meet.jit.si", publicServer: true });
  const row = events().filter((e) => e.action === "org:telehealth_settings").pop();
  assert.ok(row, "audited");
  assert.equal(JSON.parse(row.meta).reason, "pilot");

  const who = await api("/whoami?orgId=org-a", "GET", null, OWNER_A);
  assert.equal(who.telehealth, true);

  const off = await api("/org/telehealth-settings", "POST", { orgId: "org-a", settings: { baseUrl: "" }, reason: "pilot over" }, HR_A);
  assert.equal(off.__status, 200);
  assert.equal(off.settings.on, false);

  const sneak = await api("/org/update", "POST", { orgId: "org-a", wardsynq: { telehealth: { baseUrl: SERVER } } }, OWNER_A);
  assert.equal(sneak.__status, 422);
  assert.equal(sneak.error, "use_telehealth_settings_route");
});
