/* test/wsq-admin-bug-reports.test.mjs - Admin Center > Bug reports (wardsynq/site/pages/admin.js).
 *
 * The screen a hospital admin works bug reports from: loading, failed and empty are three different screens; a
 * report opens to its full details; Set in progress / Mark solved (with a note) / Reopen are offered by status;
 * Remove is offered ONLY on a solved report, and only to a manager. Each button sends exactly one request:
 * POST /api/queue/ward/bug-report-status or POST /api/queue/ward/bug-report-remove (the server enforces both;
 * test/wardsynq-bug-reports.test.mjs). The list is GET /api/queue/ward/bug-reports.
 *
 * node --test test/wsq-admin-bug-reports.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const ctxOf = (win, api) => ({ esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en, ms: win.WSQ.ms, api, state: { orgId: "org-1" } });
const rep = (status, over) => ({ id: "bug-" + status, version: 3, status, severity: "major", description: "Transfer did nothing.", location: "ward / beds", reportedAt: "2026-09-16T10:00:00.000Z",
  context: { url: "https://wardsynq.com/#/ward", patient: { id: "pat-1", bed: "07" } }, target: { selector: "button.w-btn", snippet: "Transfer" },
  errors: [{ time: "2026-09-16T09:59:00.000Z", text: "TypeError: x" }], reporter: { id: "cfa:n", name: "nurse@example.test", role: "nurse" },
  events: [{ status: "open", by: "cfa:n", at: "2026-09-16T10:00:00.000Z" }], ...(over || {}) });

test("the Bug reports tab is in the Admin Center for a WardSynQ hospital and reads GET /ward/bug-reports", () => {
  const src = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  assert.match(src, /\["bugs", "nav\.admin\.bugs"\]/);
  assert.match(src, /bugs: renderBugs/);
  assert.match(src, /c\.api\("\/ward\/bug-reports\?orgId="/);
});

test("loading, failed and empty are three different screens", () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const c = ctxOf(win);
  const html = win.WSQ._bugsHtml;
  const loading = html(c, { filter: "active", list: null });
  assert.match(loading, /Loading bug reports/);
  assert.doesNotMatch(loading, /No bug reports/);
  const failed = html(c, { filter: "active", list: false, failMsg: "network" });
  assert.match(failed, /Bug reports could not be loaded: network/);
  assert.doesNotMatch(failed, /No bug reports/);
  assert.match(html(c, { filter: "active", list: [] }), /No bug reports match this filter/);
});

test("a manager opens a report and sees its details; the actions follow its status and Remove only when solved", () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const c = ctxOf(win);
  const html = win.WSQ._bugsHtml;
  for (const [status, has, hasNot] of [
    ["open", ['data-bug-act="in_progress"', 'data-bug-act="solved"', 'id="bugNote"'], ['data-bug-act="remove"', 'data-bug-act="open"']],
    ["in_progress", ['data-bug-act="solved"', 'id="bugNote"'], ['data-bug-act="remove"', 'data-bug-act="in_progress"']],
    ["solved", ['data-bug-act="remove"', 'data-bug-act="open"'], ['data-bug-act="solved"']],
    ["removed", [], ['data-bug-act="remove"', 'data-bug-act="open"', 'data-bug-act="solved"']],
  ]) {
    const r = rep(status, status === "solved" ? { solution: { note: "Fixed the refresh.", at: "2026-09-16T11:00:00.000Z" } } : null);
    const out = html(c, { filter: "all", list: [r], openId: r.id, manager: true });
    assert.match(out, /data-bug-open="bug-/);
    assert.match(out, /Transfer did nothing\./);
    assert.match(out, /pat-1 \/ 07/);
    assert.match(out, /button\.w-btn/);
    assert.match(out, /TypeError: x/);
    for (const h of has) assert.ok(out.includes(h), `${status}: offers ${h}`);
    for (const h of hasNot) assert.ok(!out.includes(h), `${status}: does not offer ${h}`);
    if (status === "solved") assert.match(out, /How it was solved:<\/b> Fixed the refresh\./);
  }
});

test("someone who is not a manager sees their own reports and no action at all", () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const c = ctxOf(win);
  const out = win.WSQ._bugsHtml(c, { filter: "active", list: [rep("solved")], openId: "bug-solved", manager: false });
  assert.match(out, /Only the hospital admin sees every report/);
  assert.doesNotMatch(out, /data-bug-act=/);
});

test("each button sends one request to the server route", async () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const calls = [];
  const c = ctxOf(win, (path, body) => { calls.push([path, body]); return Promise.resolve({ ok: true }); });
  const r = rep("solved");
  await win.WSQ._bugAction(c, "in_progress", r, "");
  await win.WSQ._bugAction(c, "solved", r, "Fixed.");
  await win.WSQ._bugAction(c, "remove", r);
  assert.deepEqual(calls, [
    ["/ward/bug-report-status", { orgId: "org-1", id: "bug-solved", status: "in_progress", note: "", expectedVersion: 3 }],
    ["/ward/bug-report-status", { orgId: "org-1", id: "bug-solved", status: "solved", note: "Fixed.", expectedVersion: 3 }],
    ["/ward/bug-report-remove", { orgId: "org-1", id: "bug-solved", expectedVersion: 3 }],
  ]);
});

test("every word on the screen goes through the staff language; report content does not", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win);
  const r = rep("open");
  const out = win.WSQ._bugsHtml(c, { filter: "active", list: [r], openId: r.id, manager: true });
  const DATA = ["Transfer did nothing.", "ward / beds", "major", "2026-09-16 10:00", "https://wardsynq.com/#/ward", "pat-1 / 07", 'button.w-btn "Transfer"', "nurse@example.test (nurse)",
    "nurse@example.test", "2026-09-16T09:59:00.000Z TypeError: x", "cfa:n", "bug_report"];
  assert.deepEqual(leftovers(out, DATA), []);
});
