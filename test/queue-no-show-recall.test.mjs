/* test/queue-no-show-recall.test.mjs - OPD-04 (D13): a no-show recalled back to the queue keeps its token
 * and its patient link, through the real router.
 *
 * Routes: GET /api/queue/no-show/list (by sessionId and by orgId), POST /api/queue/no-show/recall, and the
 * existing POST /api/queue/status that marks a no-show and must not be a back door out of one.
 * Negative authorization: no session 401; a member without queue.reorder (reception, which may mark a
 * no-show) 403 with nothing written; another hospital refused; the recall window and a missing reason
 * refused; the right role succeeds and the audit row says who, when and why.
 *
 * node --test --experimental-test-module-mocks test/queue-no-show-recall.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as H from "./helpers/opd-router-harness.mjs";
const { api, docs, DAY } = H;
const { recallRefusal, NO_SHOW_RECALL_MS } = await import("../functions/_queue_eta.js");

const ticket = (id) => docs.get("q_tickets/" + id).fields;
const events = (action) => [...docs.values()].map((d) => d.fields).filter((f) => f.action === action);
let NURSE, RECEPTION, VIEWER, OTHER;

/* Hospital A numbers per department; desk staff (PIN sessions, as at a real desk) register three patients
 * into Cardiology's pool, call the second, and reception marks them no-show. */
async function calledThenNoShow() {
  H.seed({ scope: "department", prefixes: { dcard: "C" } });
  NURSE = await H.staffToken("org-a", "nurse1", "nurse");
  RECEPTION = await H.staffToken("org-a", "desk1", "reception");
  VIEWER = await H.staffToken("org-a", "view1", "viewer");
  OTHER = await H.staffToken("org-b", "nurse9", "admin");
  const add = async (name) => (await api("/pool", "POST", { orgId: "org-a", name, mobile: "98765000" + (10 + name.length), departmentId: "dcard", date: DAY }, NURSE)).ticket;
  const a = await add("Anu"), b = await add("Balaji"), c = await add("Chitra");
  const pool = b.sessionId;
  assert.equal((await api("/status", "POST", { sessionId: pool, ticketId: b.id, status: "called" }, NURSE)).__status, 200);
  const ns = await api("/status", "POST", { sessionId: pool, ticketId: b.id, status: "no_show" }, RECEPTION);
  assert.equal(ns.__status, 200, "reception, which runs the desk, may mark a no-show: " + JSON.stringify(ns));
  return { a, b, c, pool };
}

test("OPD-04 marking a no-show keeps the token and the patient link (tokenVer), starts the window, and the status route cannot bring it back", async () => {
  const { b, pool } = await calledThenNoShow();
  const t = ticket(b.id);
  assert.equal(t.status, "no_show");
  assert.equal(t.token, "C-002");
  assert.equal(t.tokenVer, 1, "the patient link is not killed: the patient may still come");
  assert.ok(t.noShowAt > 0);
  const back = await api("/status", "POST", { sessionId: pool, ticketId: b.id, status: "waiting" }, NURSE);
  assert.equal(back.__status, 400); assert.equal(back.error, "use_recall");
  assert.equal(ticket(b.id).status, "no_show");
});

test("OPD-04 GET /api/queue/no-show/list: 401 without a session, another hospital refused, a viewer may read; by session and by hospital", async () => {
  const { b, pool } = await calledThenNoShow();
  assert.equal((await api("/no-show/list?sessionId=" + pool)).__status, 401);
  assert.equal((await api("/no-show/list?orgId=org-a&date=" + DAY)).__status, 401);
  const other = await api("/no-show/list?orgId=org-a&date=" + DAY, "GET", null, OTHER);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const otherSess = await api("/no-show/list?sessionId=" + pool, "GET", null, OTHER);
  assert.ok(otherSess.__status === 403 || otherSess.__status === 404, JSON.stringify(otherSess));
  const byOrg = await api("/no-show/list?orgId=org-a&date=" + DAY, "GET", null, VIEWER);
  assert.equal(byOrg.__status, 200, JSON.stringify(byOrg));
  assert.deepEqual(byOrg.noShows.map((x) => [x.id, x.token, x.name]), [[b.id, "C-002", "Balaji"]]);
  assert.ok(byOrg.noShows[0].recallableUntil > Date.now());
  const bySess = await api("/no-show/list?sessionId=" + pool, "GET", null, NURSE);
  assert.deepEqual(bySess.noShows.map((x) => x.id), [b.id]);
});

test("OPD-04 POST /api/queue/no-show/recall: 401, reception (no queue.reorder) 403, another hospital refused, a missing reason refused, all with nothing written", async () => {
  const { b, pool } = await calledThenNoShow();
  const body = { sessionId: pool, ticketId: b.id, reason: "Arrived from the lab", to: "waiting" };
  const before = JSON.stringify(ticket(b.id));
  assert.equal((await api("/no-show/recall", "POST", body)).__status, 401);
  const rec = await api("/no-show/recall", "POST", body, RECEPTION);
  assert.equal(rec.__status, 403, JSON.stringify(rec));
  const other = await api("/no-show/recall", "POST", body, OTHER);
  assert.ok(other.__status === 403 || other.__status === 404, JSON.stringify(other));
  const noWhy = await api("/no-show/recall", "POST", { ...body, reason: " " }, NURSE);
  assert.equal(noWhy.__status, 400); assert.equal(noWhy.error, "reason_required"); assert.ok(noWhy.message);
  assert.equal(JSON.stringify(ticket(b.id)), before, "no refusal changed the ticket");
  assert.equal(events("recall_no_show").length, 0, "and wrote no recall audit row");
});

test("OPD-04 a nurse recalls: same token, same patient link, head of its priority band, and the audit row carries who, when and why", async () => {
  const { a, b, c, pool } = await calledThenNoShow();
  const r = await api("/no-show/recall", "POST", { sessionId: pool, ticketId: b.id, reason: "Arrived from the lab", to: "waiting" }, NURSE);
  assert.equal(r.__status, 200, JSON.stringify(r));
  const t = ticket(b.id);
  assert.equal(t.status, "waiting");
  assert.equal(t.token, "C-002", "the same token");
  assert.equal(t.tokenVer, 1, "the same patient link");
  assert.equal(t.priority, 0, "priority unchanged");
  const order = r.tickets.filter((x) => ["registered", "waiting", "called"].includes(x.status)).sort((x, y) => x.position - y.position).map((x) => x.id);
  assert.deepEqual(order, [b.id, a.id, c.id], "at the head of the waiting list");
  const ev = events("recall_no_show");
  assert.equal(ev.length, 1);
  assert.equal(ev[0].actor, "nurse1", "who");
  assert.ok(ev[0].ts > 0, "when");
  const meta = JSON.parse(ev[0].meta);
  assert.equal(meta.reason, "Arrived from the lab", "why");
  assert.equal(meta.to, "waiting");
  assert.doesNotMatch(ev[0].meta, /Balaji|98765/, "no name or phone in the audit row");
  const again = await api("/no-show/recall", "POST", { sessionId: pool, ticketId: b.id, reason: "again", to: "called" }, NURSE);
  assert.equal(again.__status, 409); assert.equal(again.error, "not_no_show");
  assert.deepEqual((await api("/no-show/list?sessionId=" + pool, "GET", null, NURSE)).noShows, []);
});

test("OPD-04 the window: 4 hours after being marked, or once the session has ended, a recall is refused with a sentence", async () => {
  const { b, pool } = await calledThenNoShow();
  const f = docs.get("q_tickets/" + b.id);
  f.fields.noShowAt = Date.now() - NO_SHOW_RECALL_MS - 1000;
  const late = await api("/no-show/recall", "POST", { sessionId: pool, ticketId: b.id, reason: "Came back", to: "called" }, NURSE);
  assert.equal(late.__status, 409); assert.equal(late.error, "recall_window_passed"); assert.match(late.message, /Register the patient again/);
  assert.deepEqual((await api("/no-show/list?sessionId=" + pool, "GET", null, NURSE)).noShows, [], "not listed once the window has passed");
  assert.equal(ticket(b.id).status, "no_show");
  const now = Date.now();
  assert.equal(recallRefusal({ status: "no_show", noShowAt: now }, { status: "finished" }, now), "session_ended");
  assert.equal(recallRefusal({ status: "no_show", noShowAt: now - 10 }, { status: "active", expiresAt: now - 1 }, now), "session_ended");
  assert.equal(recallRefusal({ status: "no_show" }, { status: "active" }, now), "recall_window_passed", "a no-show from before D13 has no window");
  assert.equal(recallRefusal({ status: "no_show", noShowAt: now - 60000 }, { status: "active", expiresAt: now + 60000 }, now), null);
});

test("screens: the console and the app mark a no-show on a called patient and recall from a list that never looks empty when it failed", () => {
  const opd = readFileSync(new URL("../opd.html", import.meta.url), "utf8"), q = readFileSync(new URL("../queue.js", import.meta.url), "utf8");
  assert.match(opd, /data-a="noshow"/);
  assert.match(opd, /api\("no-show\/list\?orgId=/);
  assert.match(opd, /api\("no-show\/recall"/);
  assert.match(opd, /could not be loaded[^<]*\. Do not read this as none/);
  assert.match(q, /data-q-act="noshow:/);
  assert.match(q, /apiGet\("\/no-show\/list\?sessionId=/);
  assert.match(q, /"\/no-show\/recall"/);
  assert.match(q, /The no-shows could not be loaded\. Do not read this as none/);
  // The patient's own link stays alive after a no-show, so it must say what happened rather than show a position.
  assert.match(readFileSync(new URL("../queue.html", import.meta.url), "utf8"), /d\.status==="no_show"\) return msgView\("campaign","Your token was called"/);
  const block = opd.slice(opd.indexOf("function openNoShows"), opd.indexOf("function openNoShows") + 4000) + q.slice(q.indexOf("function noShowPanel"), q.indexOf("function noShowPanel") + 3000);
  assert.doesNotMatch(block, /[—–]/, "no em or en dash");
});
