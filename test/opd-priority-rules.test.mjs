/* Plan item 12: priority follows a stated reason, and every change of it is audited.
 *
 * What these defend: a bare "make this patient first" is the queue-jumping a hospital is accused of, so
 *   - the REASON sets the level (two desks give the same patient the same place),
 *   - no reason, no change (and "other" needs words),
 *   - the change and its audit row (from, to, why, who) land together,
 *   - registering ahead of the queue is the priority right, not the desk's,
 *   - both consoles ask for the reason instead of flipping a number.
 *
 * node --test --experimental-test-module-mocks test/opd-priority-rules.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createRequire } from "node:module";
import { docs, api, seed, member, OWNER_A, DAY } from "./helpers/opd-router-harness.mjs";
const { priorityRule, PRIORITY_LEVEL } = await import("../functions/_queue_eta.js");

test("the reason sets the level; no reason, an unknown one, or a wordless 'other' is refused", () => {
  assert.equal(priorityRule("emergency").priority, 2);
  for (const r of ["senior", "pregnant", "disability", "child", "results"]) assert.equal(priorityRule(r).priority, 1, r);
  assert.equal(priorityRule("clear").priority, 0, "taking priority away is a reason too");
  assert.equal(priorityRule(""), null);
  assert.equal(priorityRule("vip"), null, "not on the list is not a reason");
  assert.equal(priorityRule("other"), null);
  assert.equal(priorityRule("other", "ok"), null, "two letters is not a reason");
  assert.deepEqual(priorityRule(" Other ", "came back with a fracture"), { priority: 1, reason: "other", note: "came back with a fracture" });
});

const tickets = () => [...docs.entries()].filter(([k]) => k.startsWith("q_tickets/")).map(([k, d]) => ({ id: k.slice(10), ...d.fields }));
const events = () => [...docs.entries()].filter(([k]) => k.startsWith("q_events/")).map(([, d]) => d.fields);

async function oneTicket() {
  seed();
  const sess = await api(`/session?hospitalId=org-a&date=${DAY}`, "GET", null, OWNER_A);
  assert.equal(sess.__status, 200, JSON.stringify(sess));
  const t = await api("/ticket", "POST", { sessionId: sess.session.id, name: "Ravi", mobile: "9876543211" }, OWNER_A);
  assert.equal(t.__status, 200, JSON.stringify(t));
  return { sid: sess.session.id, tid: t.ticket.id };
}

test("POST /priority: a bare number is refused; a reason sets the level and writes from/to/why on the audit row", async () => {
  const { sid, tid } = await oneTicket();
  const bare = await api("/priority", "POST", { sessionId: sid, ticketId: tid, priority: 2 }, OWNER_A);
  assert.equal(bare.__status, 400, JSON.stringify(bare));
  assert.equal(tickets()[0].priority, 0, "nothing changed");

  const ok = await api("/priority", "POST", { sessionId: sid, ticketId: tid, reason: "senior", priority: 2 }, OWNER_A);
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(tickets()[0].priority, 1, "the reason decides, not the number sent with it");
  assert.equal(tickets()[0].priorityReason, "senior");
  const row = events().filter((e) => e.action === "priority").pop();
  assert.ok(row, "audited");
  assert.deepEqual(JSON.parse(row.meta), { from: 0, to: 1, reason: "senior", note: "" });
  assert.ok(row.actor, "and who did it");

  await api("/priority", "POST", { sessionId: sid, ticketId: tid, reason: "clear" }, OWNER_A);
  assert.equal(tickets()[0].priority, 0);
  assert.equal(tickets()[0].priorityReason, "");
  assert.deepEqual(JSON.parse(events().filter((e) => e.action === "priority").pop().meta).to, 0);
});

test("registration ahead of the queue: needs a reason, and is the priority right (the desk's registration still goes through, in arrival order)", async () => {
  const { sid } = await oneTicket();
  const noWhy = await api("/ticket", "POST", { sessionId: sid, name: "Asha", mobile: "9876543212", priority: 2 }, OWNER_A);
  assert.equal(noWhy.__status, 400, JSON.stringify(noWhy));
  const why = await api("/ticket", "POST", { sessionId: sid, name: "Asha", mobile: "9876543212", priorityReason: "pregnant" }, OWNER_A);
  assert.equal(why.__status, 200, JSON.stringify(why));
  assert.equal(why.ticket.priority, 1);
  assert.match(events().filter((e) => e.action === "register").pop().meta, /priority:pregnant/);

  member("org-a", "desk-a@example.test", "reception");
  const desk = await api("/pool", "POST", { orgId: "org-a", name: "Mohan", mobile: "9876543213", priorityReason: "emergency", date: DAY }, "desk-a@example.test");
  assert.equal(desk.__status, 200, JSON.stringify(desk));
  assert.equal(desk.ticket.priority, 0, "reception may register, not jump the queue");
});

const PRIO_KEYS = (src) => [...src.matchAll(/\["([a-z]+)", ?"[^"]+"\]/g)].map((m) => m[1]);
const read = (f) => readFileSync(fileURLToPath(new URL("../" + f, import.meta.url)), "utf8");

test("both consoles offer only reasons the server accepts, and neither sends a bare priority number", () => {
  for (const f of ["queue.js", "opd.html"]) {
    const src = read(f);
    const keys = PRIO_KEYS(src.slice(src.indexOf("var PRIO")));
    assert.ok(keys.length >= 7, f + ": the reason list is there");
    for (const k of keys.slice(0, 7)) assert.ok(k in PRIORITY_LEVEL, f + " offers " + k);
    assert.ok(!/priority",\s*\{[^}]*priority:\s*[\d+(]/.test(src) && !/"priority",\{[^}]*priority:/.test(src), f + " never posts {priority: n}");
  }
});

test("the app console opens a reason sheet, chips are 44px buttons that say which is picked", () => {
  const src = read("queue.js");
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null });
  const sb = { navigator: { userAgent: "node" }, location: { hash: "", href: "", search: "" },
    document: { getElementById: () => null, createElement: el, addEventListener() {}, body: el(), documentElement: el(), querySelector: () => null, querySelectorAll: () => [], activeElement: null },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval, console, Promise, Date, JSON, Math };
  sb.SMD_OPD_PULSE = createRequire(import.meta.url)("../opd-pulse-model.js");
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  const Q = sb.window.QUEUE;
  const tk = { id: "t1", name: "Ravi", status: "waiting", priority: 1, priorityReason: "senior", registeredAt: Date.now() };
  const html = Q._render({ ...Q._st, view: "queue", session: { id: "s1" }, tickets: [tk], prioSheet: { ticketId: "t1", cur: 1, reason: "senior", note: "" } });
  assert.match(html, /role="dialog" aria-label="Set priority"/);
  assert.match(html, /aria-pressed="true" data-q-act="prio-pick:senior"/);
  assert.match(html, /prio-pick:clear/, "a patient with priority can have it cleared, with that as the reason");
  assert.match(html, /Senior citizen/, "the row says why, not just 'Priority'");
  assert.match(read("queue.css"), /\.q-prio-chip \{ min-height: 44px/);
});
