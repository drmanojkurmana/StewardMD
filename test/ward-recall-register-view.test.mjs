/* R7-1 screen: the Recall register view (functions/_wardsynq/registry.js, /ward/registries).
 *
 * The one screen that NAMES PATIENTS, so the two things it must never do are: show an empty cohort when the
 * read failed or was refused (that reads as "nobody overdue"), and lose the "never reviewed" patient among
 * the merely due. Both are checked here, plus that it is reachable from Boards and tools at all - the gap
 * this screen closed was a finished route no screen called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sb = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: { getElementById: () => null, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }), addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }), setTimeout, clearTimeout, console, Promise, Date,
  };
  sb.window = sb; sb.self = sb; vm.createContext(sb); vm.runInContext(src, sb);
  return sb.window.WARD;
}
const view = (W, extra) => W._render({ ...W._st, view: "recall", ...extra });
const REPORT = {
  ok: true,
  registries: [{
    id: "dm", name: "Diabetes", total: 3, neverReviewed: 1, overdue: 1, reviewEveryMonths: 12,
    members: [
      { patientId: "pat-1", mrn: "MRN-1", because: "Type 2 diabetes mellitus", review: { state: "never", overdue: true, lastReview: null } },
      { patientId: "pat-2", mrn: "MRN-2", because: "Type 2 diabetes mellitus", review: { state: "overdue", overdue: true, lastReview: "2024-01-05T00:00:00Z", dueAt: "2025-01-04T00:00:00Z", overdueDays: 600 } },
      { patientId: "pat-3", mrn: "MRN-3", because: "Type 2 diabetes mellitus", review: { state: "current", overdue: false, lastReview: "2026-06-01T00:00:00Z", dueAt: "2027-05-27T00:00:00Z" } },
    ],
  }],
};

test("recall register: reachable from Boards and tools; loading, failed and forbidden are distinct and never an empty cohort", () => {
  const W = loadWard();
  assert.ok(W._render({ ...W._st, view: "list", list: [] }).includes('data-w-act="recallview"'));
  assert.match(view(W, { recall: { busy: true } }), /Loading the recall register/);
  const failed = view(W, { recall: { ok: false } });
  assert.match(failed, /could not be loaded. Do not read this as nobody overdue/);
  assert.match(view(W, { recall: { ok: false, status: 403 } }), /authority to read a chart is needed/);
  // Neither state may render the words a reader would take as "this cohort is empty".
  for (const html of [view(W, { recall: { busy: true } }), failed]) {
    assert.ok(!/Nobody is in this cohort/.test(html));
    assert.ok(!/\d+ in the cohort/.test(html), "no cohort count is drawn from a read that did not happen");
  }
});

test("members carry why they are in the cohort and how overdue; never reviewed is its own state, listed first", () => {
  const W = loadWard();
  const html = view(W, { recall: REPORT });
  assert.match(html, /3 in the cohort/);
  assert.match(html, /1 never reviewed/);
  assert.match(html, /reviewed every 12 months/);
  assert.match(html, /Never reviewed/);
  assert.match(html, /Overdue by 600 days/);
  assert.match(html, /Up to date/);
  assert.match(html, /Type 2 diabetes mellitus/);
  assert.match(html, /last review 2024-01-05/);
  // The server sorts; the screen must not reorder it - never reviewed stays above merely overdue.
  assert.ok(html.indexOf("MRN-1") < html.indexOf("MRN-2"), "never reviewed is listed first");
  assert.ok(html.includes('data-w-act="recallfilter:1"') && html.includes('data-w-act="recallfilter:0"'));
});

test("a short list says why: an unreadable type, a truncated read and an unusable definition each warn", () => {
  const W = loadWard();
  assert.match(view(W, { recall: { ...REPORT, unreadable: ["Observation"] } }), /may be short. Do not read it as nobody overdue/);
  assert.match(view(W, { recall: { ...REPORT, truncated: true } }), /oldest records were not read/);
  assert.match(view(W, { recall: { ...REPORT, problems: [{ index: 0, reason: "no_problem_codes" }] } }), /1 registry definitions could not be used/);
});

test("no registries, a registry with no review interval, and an empty filter each read as themselves", () => {
  const W = loadWard();
  assert.match(view(W, { recall: { ok: true, registries: [] } }), /No registries are configured/);
  assert.match(view(W, { recall: { ok: true, skipped: "off", registries: [] } }), /not switched on for this hospital/);
  const noRecall = view(W, { recall: { ok: true, registries: [{ id: "x", name: "Asthma", total: 2, neverReviewed: 0, overdue: 0, recall: null, members: [] }] } });
  assert.match(noRecall, /No review interval is configured for this registry/);
  const filtered = view(W, { recallOverdue: true, recall: { ok: true, registries: [{ id: "x", name: "Asthma", total: 2, neverReviewed: 0, overdue: 0, reviewEveryMonths: 6, members: [] }] } });
  assert.match(filtered, /Nobody in this cohort is overdue/);
});
