/* test/wardsynq-offline-shared-device.test.mjs - the offline outbox findings of the 2026-09-26 audit (lane C).
 *
 * DATA-01: a second nurse signing in on a shared tablet deleted the first nurse's unsent dose and vitals. Now
 * another user's unsent writes are kept, hidden from the new user and never sent as them, sent when their
 * owner signs in again, and the new user is told how many are waiting.
 * DATA-04: a vitals answer that saved nothing (ok:true, written:0, every reading failed) was dropped as "sent".
 * DATA-12: a rate-limit answer (429) during a backlog replay was a refusal that could only be discarded.
 *
 * node --test test/wardsynq-offline-shared-device.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import vm from "node:vm";

const SRC = readFileSync(new URL("../ward-offline.js", import.meta.url), "utf8");
const load = () => { const sb = { crypto: webcrypto }; sb.window = sb; sb.globalThis = sb; vm.runInNewContext(SRC, sb); return sb.WARD_OFFLINE; };
const WO = load();
const durable = () => Object.assign(WO.memoryStore(), { durable: true });
const A = "staff:org~nurse-a", B = "staff:org~nurse-b";

/** One tablet: a store shared by every page load, a signed-in user, and a server that records what it got. */
function tablet() {
  const store = durable(), sent = [];
  let who = A, online = false;
  const page = () => WO.create({ store, actor: () => who, online: () => online, headers: () => ({ "X-User": who }),
    fetch: async (u, o) => { sent.push({ u, as: o.headers["X-User"], body: JSON.parse(o.body) }); return { status: 200, json: async () => ({ ok: true, written: 1 }) }; } });
  return { store, sent, page, signIn: (x) => { who = x; }, setOnline: (v) => { online = v; } };
}

test("DATA-01: nurse B signing in keeps nurse A's unsent dose and vitals, never shows or sends them as B, and says they are waiting", async () => {
  const t = tablet();
  const a = t.page();
  await a.enqueue("mar", { orderId: "rx-1", dueAt: "2026-09-26T08:00:00.000Z", action: "administer" }, { label: "Dose", patientId: "p1" });
  await a.enqueue("vitals", { encounterId: "e1", patientId: "p1", vitals: { sbp: "82" } }, { label: "Vitals", patientId: "p1" });
  await t.store.put("cache", A + "|p1", { actor: A, patientId: "p1", savedAt: Date.now(), data: { chart: "A's cached chart" } });

  // Shift change: A's session ended, B signs in and the ward page loads.
  t.signIn(B); t.setOnline(true);
  const b = t.page();
  await b.load();
  assert.equal((await t.store.all("outbox")).length, 2, "A's entries are still on the device");
  assert.equal((await t.store.all("cache")).length, 0, "A's read cache is not left for B");
  const s = b.state();
  assert.equal(s.waiting, 0, "none of A's entries is B's");
  assert.equal(s.queued.length, 0);
  assert.equal(s.items.length, 0);
  assert.equal(s.others, 2, "B is told two entries from another user are waiting");

  await b.enqueue("note", { patientId: "p2", sections: { s: "B's own" } }, { label: "Note", patientId: "p2" });
  const out = await b.sync();
  assert.equal(out.sent, 1);
  assert.deepEqual(t.sent.map((x) => [x.u, x.as]), [["/api/queue/ward/note", B]], "only B's own entry went, as B");
  await assert.rejects(b.discard((await t.store.all("outbox"))[0].id), /not your write/);

  // B signs out: B's own go, A's stay.
  await b.clearAll();
  assert.equal((await t.store.all("outbox")).length, 2);

  // A signs in again on the tablet: A's entries send, as A, in the order charted.
  t.signIn(A);
  const a2 = t.page();
  await a2.load();
  assert.equal(a2.state().waiting, 2);
  assert.equal(a2.state().others, 0);
  const out2 = await a2.sync();
  assert.equal(out2.sent, 2);
  assert.deepEqual(t.sent.slice(1).map((x) => [x.u, x.as]), [["/api/queue/ward/mar", A], ["/api/queue/ward/vitals", A]]);
  assert.equal((await t.store.all("outbox")).length, 0);
});

test("DATA-01: signing out with nobody identified deletes no unsent write", async () => {
  const t = tablet();
  await t.page().enqueue("vitals", { encounterId: "e1", patientId: "p1", vitals: { pulse: "130" } }, { label: "Vitals", patientId: "p1" });
  t.signIn(null);
  await t.page().clearAll();
  assert.equal((await t.store.all("outbox")).length, 1);
});

/** ward.js in a VM with just enough of a browser to render (the pattern of wardsynq-offline-conflicts.test.mjs). */
function loadWard() {
  const el = () => ({ value: "", innerHTML: "", outerHTML: "", classList: { add() {}, remove() {}, contains: () => true }, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [] });
  const sb = {
    navigator: { userAgent: "node", onLine: true }, location: { hash: "", href: "" },
    document: { getElementById: () => el(), createElement: () => el(), addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, atob: (x) => Buffer.from(x, "base64").toString("binary"),
    crypto: webcrypto, confirm: () => true, addEventListener() {}, fetch: async () => ({ status: 200, json: async () => ({}) }),
    setTimeout: (f) => setTimeout(f, 0), clearTimeout, console, Promise, Date, JSON, Uint8Array,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb);
  vm.runInContext(SRC, sb);
  vm.runInContext(readFileSync(new URL("../ward.js", import.meta.url), "utf8"), sb);
  return sb.WARD;
}

test("DATA-01: the ward bar tells the signed-in user about another user's waiting entries, and stays hidden with none", () => {
  const W = loadWard();
  W._st.view = "list";
  W._st.offline = { online: true, syncing: false, waiting: 0, conflicts: 0, refused: 0, others: 2, authNeeded: false, durable: true, readFailed: false, items: [], queued: [] };
  assert.match(W._render(W._st), /id="wOffBar"[^>]*>.*2 unsent from another user on this device; they send when that person signs in here/);
  W._st.offline = { ...W._st.offline, others: 0 };
  assert.match(W._render(W._st), /<div id="wOffBar"><\/div>/);
});

test("DATA-04: a vitals answer that saved no reading stays in the queue; one that saved them all is sent", () => {
  const failed = { ok: true, written: 0, observations: [{ id: "o1", error: "record_write_failed" }, { id: "o2", error: "record_write_failed" }] };
  assert.equal(WO.classify(200, failed), "retry");
  assert.equal(WO.classify(200, { ok: true, written: 1, observations: [{ id: "o1", written: 1 }, { id: "o2", error: "record_write_failed" }] }), "retry", "a reading that failed is resent; the saved one answers already_recorded");
  assert.equal(WO.classify(502, { ok: false, error: "record_write_failed", written: 0 }), "retry", "the server's own answer for nothing saved");
  assert.equal(WO.classify(200, { ok: true, written: 2, observations: [{ id: "o1", written: 1 }, { id: "o2", skipped: "already_recorded" }] }), "sent");
});

test("DATA-04: a queued vitals entry the server could not save is still on the device after sync", async () => {
  const store = durable();
  let answer = { ok: true, written: 0, observations: [{ id: "o1", error: "record_write_failed" }] };
  const box = WO.create({ store, actor: () => A, online: () => true, fetch: async () => ({ status: 200, json: async () => answer }) });
  await box.enqueue("vitals", { encounterId: "e1", patientId: "p1", vitals: { sbp: "82" } }, { label: "Vitals" });
  const out = await box.sync();
  assert.equal(out.sent, 0);
  assert.equal(out.stopped, "server");
  assert.equal(box.state().waiting, 1);
  answer = { ok: true, written: 1, observations: [{ id: "o1", written: 1 }] };
  assert.equal((await box.sync()).sent, 1);
  assert.equal(box.state().waiting, 0);
});

test("DATA-12: a rate limit during a backlog replay waits and retries; it is never a refusal to discard", async () => {
  assert.equal(WO.classify(429, { ok: false, error: "rate_limited" }), "retry");
  const store = durable();
  let limited = true;
  const box = WO.create({ store, actor: () => A, online: () => true, fetch: async () => (limited ? { status: 429, json: async () => ({ ok: false, error: "rate_limited" }) } : { status: 200, json: async () => ({ ok: true, written: 1 }) }) });
  await box.enqueue("fluid", { patientId: "p1", entries: [{ direction: "in", kind: "oral", value: "100" }] }, { label: "Fluid" });
  const out = await box.sync();
  assert.equal(out.refused, 0);
  assert.equal(box.state().waiting, 1, "still waiting to send, not refused");
  limited = false;
  assert.equal((await box.sync()).sent, 1);
});
