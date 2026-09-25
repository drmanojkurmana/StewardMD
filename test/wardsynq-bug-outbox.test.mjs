import "./helpers/trust-cf-access-header.mjs"; // test identity = the Cf-Access email header (production verifies the Access JWT)
/* test/wardsynq-bug-outbox.test.mjs - the Report Bug widget's device outbox against the real server route.
 *
 * The real wardsynq/site/bug-reporter.js runs in a small DOM double; its fetch is bridged to the real router
 * (POST /api/queue/ward/bug-report) on the shared in-memory hospital, or made to fail to play "server down".
 * Server down -> the report stays on the device marked unsent and the toast says so; server up -> it is sent
 * once, never twice; reports saved before this change are uploaded the same way; unsent reports are not capped.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-bug-outbox.test.mjs
 */
import { seed, H, ENV, ORG_ID, NURSE, onRequest } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { BUG_REPORT_TYPE } = await import("../functions/_wardsynq/bug-reports.js");
const SRC = readFileSync(new URL("../wardsynq/site/bug-reporter.js", import.meta.url), "utf8");

function el() {
  return { style: {}, innerHTML: "", textContent: "", appendChild() {}, removeChild() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
}

/** A page with the widget loaded. net.up decides whether the server answers; net.posts counts bug-report POSTs. */
function page(initialLog) {
  const store = new Map([["smd_opd_hospital", ORG_ID], ["smd_opd_staff_tok", "staff-token"]]);
  if (initialLog) store.set("wardsynq_bug_log", JSON.stringify(initialLog));
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const net = { up: false, posts: 0 };
  const fetch = async (url, opts) => {
    const u = String(url);
    if (!u.startsWith("/api/queue/")) throw new TypeError("collector not running");
    if (u.endsWith("/bug-report")) net.posts++;
    if (!net.up) throw new TypeError("Failed to fetch");
    // The staff token proves nothing in the harness; the request is made as the signed-in nurse.
    const headers = { ...(opts && opts.headers), "Cf-Access-Authenticated-User-Email": NURSE };
    return onRequest({ request: new Request("https://wardsynq.test" + u, { method: (opts && opts.method) || "GET", headers, body: opts && opts.body }), env: ENV, waitUntil: () => {} });
  };
  const win = { addEventListener() {}, location: { href: "https://wardsynq.test/#/ward", pathname: "/", hash: "#/ward" }, innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1 };
  const document = { readyState: "complete", body: el(), createElement: el, getElementById: () => null, querySelector: () => null, addEventListener() {} };
  const quiet = { error() {} };
  new Function("window", "document", "localStorage", "navigator", "fetch", "setTimeout", "setInterval", "clearTimeout", "console", "confirm", "alert", SRC)(
    win, document, localStorage, { userAgent: "test-agent" }, fetch, () => 0, () => 0, () => {}, quiet, () => true, () => {});
  return { api: win.WSQ_BUG_REPORTER, net, log: () => JSON.parse(store.get("wardsynq_bug_log") || "[]"), store };
}
const serverRows = () => H.RECORD._rows.filter((r) => r.resourceType === BUG_REPORT_TYPE);
const ctx = { page: "ward", wardView: "beds", orgId: ORG_ID, url: "https://wardsynq.test/#/ward", patient: { id: "pat-1", bed: "07" } };

test("server down: the report stays on the device unsent and the message says it was not sent", async () => {
  seed();
  const p = page();
  const r = await p.api._record("Transfer button did nothing.", "major", ctx, null);
  assert.equal(r.sent, false);
  assert.equal(r.saved, true);
  assert.match(r.message, /saved on this device and NOT sent yet/);
  assert.doesNotMatch(r.message, /sent to the hospital's server/);
  const log = p.log();
  assert.equal(log.length, 1);
  assert.equal(log[0].sent, false);
  assert.equal(log[0].lastError, "no connection to the server");
  assert.equal(serverRows().length, 0);
});

test("server up: the waiting report is sent once, and a second flush sends nothing", async () => {
  seed();
  const p = page();
  await p.api._record("Transfer button did nothing.", "major", ctx, null);
  p.net.up = true;
  const f = await p.api.flush();
  assert.deepEqual(f, { sent: 1, waiting: 0 });
  assert.equal(serverRows().length, 1);
  const log = p.log();
  assert.equal(log[0].sent, true);
  assert.equal(log[0].serverId, serverRows()[0].id);
  const posts = p.net.posts;
  assert.deepEqual(await p.api.flush(), { sent: 0, waiting: 0 });
  assert.equal(p.net.posts, posts, "nothing is posted again");
  assert.equal(serverRows().length, 1, "no duplicate");
});

test("a send whose answer was lost is resent without a duplicate on the server", async () => {
  seed();
  const p = page();
  p.net.up = true;
  const r = await p.api._record("Chart tab froze.", "blocker", ctx, null);
  assert.equal(r.sent, true);
  assert.match(r.message, /sent to the hospital's server/);
  // The device never heard back: mark it unsent again and let the retry run.
  const log = p.log(); log[0].sent = false; p.store.set("wardsynq_bug_log", JSON.stringify(log));
  assert.deepEqual(await p.api.flush(), { sent: 1, waiting: 0 });
  assert.equal(serverRows().length, 1);
});

test("not signed in: kept unsent with that reason, and nothing is posted", async () => {
  seed();
  const p = page();
  p.store.delete("smd_opd_staff_tok");
  p.net.up = true;
  const r = await p.api._record("Login page button misaligned.", "minor", ctx, null);
  assert.equal(r.sent, false);
  assert.match(r.message, /not signed in/);
  assert.equal(p.net.posts, 0);
  assert.equal(p.log()[0].sent, false);
});

test("reports saved before this change are uploaded once, with no patient name reaching the server", async () => {
  seed();
  const legacy = [{ id: "BUG-OLD-1", timestamp: "2026-09-10T08:00:00.000Z", description: "Old report", severity: "major", location: "ward",
    context: { url: "https://wardsynq.test/#/ward", page: "ward", patient: { id: "pat-9", name: "Legacy Name", bed: "3" } }, targetElement: null, errors: [], userAgent: "ua", screen: {} }];
  const p = page(legacy);
  p.net.up = true;
  assert.deepEqual(await p.api.flush(), { sent: 1, waiting: 0 });
  assert.equal(serverRows().length, 1);
  assert.equal(serverRows()[0].body.clientReportId, "BUG-OLD-1");
  assert.ok(!JSON.stringify(serverRows()[0].body).includes("Legacy Name"));
  assert.deepEqual(await p.api.flush(), { sent: 0, waiting: 0 });
  assert.equal(serverRows().length, 1);
});

test("unsent reports are never capped; sent copies are trimmed to 50", async () => {
  seed();
  const many = [];
  for (let i = 0; i < 70; i++) many.push({ id: "BUG-W-" + i, timestamp: "2026-09-16T00:00:00.000Z", description: "d" + i, severity: "minor", location: "x", context: {}, sent: false });
  for (let i = 0; i < 60; i++) many.push({ id: "BUG-S-" + i, timestamp: "2026-09-16T00:00:00.000Z", description: "s" + i, severity: "minor", location: "x", context: {}, sent: true, serverId: "bug-" + i });
  const p = page(many);
  await p.api._record("One more while offline.", "major", ctx, null);
  const log = p.log();
  assert.equal(log.filter((b) => !b.sent).length, 71, "every unsent report kept");
  assert.equal(log.filter((b) => b.sent).length, 50);
});

test("View Past Bugs: loading, failed and loaded are three different screens; waiting reports are marked", () => {
  seed();
  const p = page();
  const waiting = [{ id: "BUG-W", timestamp: "2026-09-16T01:00:00.000Z", description: "Waiting one", location: "ward", sent: false, lastError: "not signed in" }];
  const loading = p.api._logsHtml(waiting, null);
  assert.match(loading, /Waiting to send/);
  assert.match(loading, /Last try: not signed in/);
  assert.match(loading, /Loading reports from the server/);
  const failed = p.api._logsHtml(waiting, false, "no connection to the server");
  assert.match(failed, /could not be loaded: no connection to the server/);
  assert.doesNotMatch(failed, /No bug reports yet/);
  const loaded = p.api._logsHtml([], { ok: true, manager: false, reports: [
    { id: "bug-1", clientReportId: "BUG-1", status: "in_progress", description: "A", location: "ward", reportedAt: "2026-09-16T02:00:00.000Z" },
    { id: "bug-2", clientReportId: "BUG-2", status: "solved", description: "B", location: "ward", reportedAt: "2026-09-16T01:00:00.000Z", solution: { note: "Fixed the refresh." } }] });
  assert.match(loaded, /In progress/);
  assert.match(loaded, /Solved/);
  assert.match(loaded, /How it was solved: Fixed the refresh\./);
  assert.match(p.api._logsHtml([], { ok: true, reports: [] }), /No bug reports yet/);
});
