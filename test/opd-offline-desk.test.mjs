/* Plan item 13: degraded desk mode. The desk keeps checking patients in when the server cannot be reached.
 *
 * What these defend:
 *   - two desks can never print the same offline number (a series letter per desk, reserved create-only),
 *   - a slip is honoured exactly once, however many times a flaky sync retries it,
 *   - the patient keeps the number on the slip AND their place (the time the slip was printed),
 *   - a check-in is never dropped: a sync that cannot finish keeps it, one the server questions goes to review,
 *   - a register that landed is not sent twice when only the queue step failed,
 *   - the day's numbered sequence is untouched by offline slips.
 *
 * node --test --experimental-test-module-mocks test/opd-offline-desk.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { docs, api, seed, OWNER_A, NURSE_A, VIEWER_A, HR_B, DAY } from "./helpers/opd-router-harness.mjs";

const OFF = createRequire(import.meta.url)("../opd-offline-desk.js");
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

function mem() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
/* A fake server: `answers[path]` is a function (body) -> json, or throws "down" to act unreachable. */
function server(answers) {
  const calls = [];
  return { calls, call: (path, body) => { calls.push({ path, body }); const a = answers[path]; if (!a) return Promise.reject(new Error("down")); try { return Promise.resolve(a(body)); } catch (e) { return Promise.reject(e); } } };
}
const DOWN = () => { throw new Error("down"); };

test("the series is reserved online once; offline numbers come from it in order, and none without it", async () => {
  const st = mem(), sv = server({ "offline-series": () => ({ ok: true, series: "OB" }) });
  const d = OFF.desk({ storage: st, call: sv.call, orgId: "org-a", date: DAY });
  assert.equal(d.issue({ name: "Asha" }), null, "no series in hand: nothing to promise");
  assert.equal(await d.prepare(), true);
  assert.equal(await d.prepare(), true);
  assert.equal(sv.calls.length, 1, "reserved once, not on every refresh");
  assert.equal(d.issue({ name: "Asha" }).token, "OB-1");
  assert.equal(d.issue({ name: "Ravi" }).token, "OB-2");
  assert.equal(d.pending(), 2);
  // A reload of the desk tab keeps the series and the outbox.
  assert.equal(OFF.desk({ storage: st, call: sv.call, orgId: "org-a", date: DAY }).issue({ name: "Mohan" }).token, "OB-3");
  assert.equal(OFF.desk({ storage: st, call: sv.call, orgId: "org-a", date: "2099-01-01" }).issue({}), null, "yesterday's series is not today's");
});

test("sync sends each check-in the online way, with its slip number and the time it was taken; unreachable stops and keeps the rest", async () => {
  const st = mem();
  let up = false;
  const sv = server({ "offline-series": () => ({ ok: true, series: "OA" }),
    "patient/register": (b) => { if (!up) throw new Error("down"); return { ok: true, mrn: "MR-" + b.name }; },
    "pool": (b) => ({ ok: true, ticket: { token: b.offlineToken } }) });
  const d = OFF.desk({ storage: st, call: sv.call, orgId: "org-a", date: DAY, now: () => 1000 });
  await d.prepare();
  d.issue({ name: "Asha", mobile: "9876543210", visitType: "followup", departmentId: "dcard" }); d.issue({ name: "Ravi" });
  let r = await d.sync();
  assert.deepEqual([r.synced, r.left], [0, 2], "still down: nothing lost");
  up = true;
  r = await d.sync();
  assert.deepEqual([r.synced, r.left, r.review], [2, 0, 0]);
  const pools = sv.calls.filter((c) => c.path === "pool").map((c) => c.body);
  assert.deepEqual(pools[0], { orgId: "org-a", date: DAY, name: "Asha", mobile: "9876543210", mrn: "MR-Asha", visitType: "followup", departmentId: "dcard", offlineToken: "OA-1", offlineAt: 1000 });
  assert.equal(pools[1].offlineToken, "OA-2");
});

test("a register that landed is not sent again when only the queue step failed; a slip the server already has counts as sent", async () => {
  const st = mem();
  let poolUp = false;
  const sv = server({ "offline-series": () => ({ ok: true, series: "OA" }), "patient/register": () => ({ ok: true, mrn: "MR9" }),
    "pool": () => { if (!poolUp) throw new Error("down"); return { ok: false, error: "offline_token_used" }; } });
  const d = OFF.desk({ storage: st, call: sv.call, orgId: "org-a", date: DAY });
  await d.prepare(); d.issue({ name: "Asha" });
  await d.sync();
  poolUp = true;
  const r = await d.sync();
  assert.equal(sv.calls.filter((c) => c.path === "patient/register").length, 1, "registered once");
  assert.equal(sv.calls.filter((c) => c.path === "pool").pop().body.mrn, "MR9", "and queued under that record");
  assert.deepEqual([r.synced, r.left, r.review], [1, 0, 0], "already in the queue is done, not an error");
});

test("the same card is the same patient; a shared phone number goes to review, queued by name, never dropped", async () => {
  const st = mem();
  const sv = server({ "offline-series": () => ({ ok: true, series: "OA" }),
    "patient/register": (b) => ({ ok: false, error: "duplicate", duplicateOf: b.stewardId ? { stewardId: b.stewardId, mrn: "MR1" } : { mrn: "MR2", mobile: b.mobile } }),
    "pool": () => ({ ok: true }) });
  const d = OFF.desk({ storage: st, call: sv.call, orgId: "org-a", date: DAY });
  await d.prepare();
  d.issue({ name: "Asha", stewardId: "SMP-AAAA-BBBBC" }); d.issue({ name: "Ravi", mobile: "9876543210" });
  const r = await d.sync();
  const pools = sv.calls.filter((c) => c.path === "pool").map((c) => c.body.mrn);
  assert.deepEqual(pools, ["MR1", ""], "the card's record is used; a phone match is not trusted");
  assert.equal(r.review, 1);
  const rv = d.review()[0];
  assert.equal(rv.token, "OA-2"); assert.match(rv.why, /Possible duplicate of MR2/);
  d.dismiss("OA-2");
  assert.equal(d.review().length, 0);
});

test("a check-in taken while a sync is in flight is not overwritten; another hospital's items are never sent under this sign-in", async () => {
  const st = mem();
  let release;
  const gate = new Promise((r) => { release = r; });
  const sv = server({ "offline-series": () => ({ ok: true, series: "OA" }), "patient/register": () => gate.then(() => ({ ok: true, mrn: "M" })), "pool": () => ({ ok: true }) });
  const d = OFF.desk({ storage: st, call: sv.call, orgId: "org-a", date: DAY });
  await d.prepare(); d.issue({ name: "First" });
  const p = d.sync();
  d.issue({ name: "Second" });
  release(); await p;
  assert.deepEqual(sv.calls.filter((c) => c.path === "pool").map((c) => c.body.name), ["First", "Second"], "the second check-in was not overwritten: the same sync sent it too");
  assert.equal(d.pending(), 0);
  assert.equal(OFF.desk({ storage: st, call: sv.call, orgId: "org-b", date: DAY }).pending(), 0, "org-a's check-in is not org-b's to send");
});

/* ---- the server: POST /offline-series and POST /pool with an offline token ---------------------------- */

const tickets = () => [...docs.entries()].filter(([k]) => k.startsWith("q_tickets/")).map(([, d]) => d.fields);

test("POST /offline-series: 401, 403 without queue.add, another hospital refused; each desk gets its own letter", async () => {
  seed();
  const body = { orgId: "org-a", date: DAY };
  assert.equal((await api("/offline-series", "POST", body)).__status, 401);
  assert.equal((await api("/offline-series", "POST", body, VIEWER_A)).__status, 403);
  const other = await api("/offline-series", "POST", body, HR_B);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const a = await api("/offline-series", "POST", body, NURSE_A), b = await api("/offline-series", "POST", body, OWNER_A);
  assert.equal(a.__status, 200, JSON.stringify(a));
  assert.deepEqual([a.series, b.series], ["OA", "OB"], "two desks, two series");
});

test("POST /pool with an offline token: keeps the slip's number and time, honoured once, unreserved refused, the day's sequence untouched", async () => {
  seed();
  const s = await api("/offline-series", "POST", { orgId: "org-a", date: DAY }, NURSE_A);
  const at = Date.now() - 10 * 60000;
  const body = { orgId: "org-a", date: DAY, name: "Asha", mobile: "9876543210", offlineToken: s.series + "-1", offlineAt: at };
  const ok = await api("/pool", "POST", body, NURSE_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.ticket.token, "OA-1");
  assert.equal(tickets()[0].registeredAt, at, "their place is when the slip was printed");
  const again = await api("/pool", "POST", body, NURSE_A);
  assert.equal(again.__status, 409); assert.equal(again.error, "offline_token_used");
  assert.equal(tickets().length, 1, "a retried sync never queues the slip twice");
  const forged = await api("/pool", "POST", { ...body, offlineToken: "OZ-1" }, NURSE_A);
  assert.equal(forged.__status, 422); assert.equal(forged.error, "bad_offline_token");
  const future = await api("/pool", "POST", { ...body, offlineToken: "OA-2", offlineAt: Date.now() + 3600e3 }, NURSE_A);
  assert.ok(Math.abs(tickets().find((t) => t.token === "OA-2").registeredAt - Date.now()) < 5000, "a clock ahead of the server is not a place ahead of the queue");
  assert.equal(future.__status, 200);
  const online = await api("/pool", "POST", { orgId: "org-a", date: DAY, name: "Ravi", mobile: "9876543211" }, NURSE_A);
  assert.equal(online.ticket.token, "1", "the numbered sequence starts where it was: offline slips burn no number");
});

/* ---- the screens ------------------------------------------------------------------------------------ */

test("the check-in sheet keeps an unreachable check-in offline with its number and a print button; the console wires it", () => {
  const pr = read("patient-register.js");
  assert.match(pr, /opts\.offline \? opts\.offline\(sent\)/, "unreachable asks the host to keep it offline");
  assert.match(pr, /data-a="print-token"/);
  const opd = read("opd.html");
  assert.match(opd, /<script src="\/opd-offline-desk\.js\?v=/);
  assert.match(opd, /<script src="\/ward-labels\.js\?v=/);
  assert.match(opd, /offline: function\(sent\)\{ var d=offDesk\(\)/);
  assert.match(opd, /printToken: function\(o\)\{ printTokenSlip\(o\); \}/);
  assert.match(opd, /addEventListener\("online"/, "coming back online sends what is waiting");
  assert.match(read("scripts/build-wardsynq-site.sh"), /opd-offline-desk\.js/, "and wardsynq.com serves the module");
  // The app's front desk uses the same sheet and the same desk: offline hook, print, a sync on every poll, a warned sign-out.
  const q = read("queue.js"), idx = read("index.html");
  assert.match(q, /offline: function \(sent\) \{ var d = offDesk\(\); return d \? d\.issue\(sent\) : null; \}/);
  assert.match(q, /printToken: printTokenSlip/);
  assert.match(q, /loadPulse\(\);\n\s+offTick\(\);/, "each front-desk poll sends what is waiting");
  assert.match(q, /cmd === "staffout"\) \{ if \(!signOutDesk\(\)\) return;/, "signing out with unsent check-ins asks first");
  assert.match(q, /function signOutDesk\(\) \{ if \(!offSignOut\(\)\) return false;/);
  assert.match(q, /function offSignOut\(\) \{[\s\S]{0,120}if \(d\.pending\(\)\)[\s\S]{0,80}window\.confirm/);
  assert.match(idx, /<script src="\/opd-offline-desk\.js\?v=/);
});

test("the slip prints the offline number largest, with the hospital and the time", () => {
  const sb = {}; sb.window = sb; vm.createContext(sb); vm.runInContext(read("ward-labels.js"), sb);
  const doc = sb.WARD_LABELS.labelDocument("token", { hospital: "City Hospital", token: "OA-3", name: "Asha", issuedAt: "10:42" });
  assert.match(doc, /<div class="tok">OA-3<\/div>/);
  assert.match(doc, /City Hospital/);
  assert.match(doc, /Keep this slip/);
  assert.match(doc, /\.tok\{font-weight:800/);
});
