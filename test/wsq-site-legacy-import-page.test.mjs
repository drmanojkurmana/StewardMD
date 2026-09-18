/* test/wsq-site-legacy-import-page.test.mjs - Admin Center > Import from old system (pages/admin.js WSQ._importHtml),
 * the screen for POST /api/queue/ward/legacy-import. Every state translates; server row reasons and file values stay as
 * they came; a failed dry run never reads as an empty one; the import button carries exactly the dry run's count and plan.
 *
 * node --test test/wsq-site-legacy-import-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const ctxOf = (win) => ({ esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en });
const MAP = { ok: true, step: "map", kind: "patients", fields: { required: ["legacyMrn", "name", "mobile", "gender"], optional: ["birthDate"] }, headers: ["HIS No", "Patient Name"], rowCount: 2, rowCap: 100 };
const PREVIEW = { ok: true, step: "preview", kind: "patients", planId: "abcd1234abcd1234", partial: false, counts: { create: 1, matched: 0, duplicate: 1, invalid: 0 },
  rows: [{ row: 2, status: "create", label: "L-100" }, { row: 3, status: "duplicate", label: "L-101", reason: "A patient with this mobile number is already registered.", existing: { mrn: "SMD-1" } }] };

test("import screen: file, mapping, dry run and failure states translate; file values and server reasons are kept verbatim", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win), html = win.WSQ._importHtml;
  const first = html(c, { kind: "patients", map: null, preview: null });
  assert.equal(leftovers(first, []).length, 0, JSON.stringify(leftovers(first, [])));
  assert.match(first, /data-imp="read"/);
  const mapped = html(c, { kind: "patients", map: MAP, mapping: { legacyMrn: 0 }, preview: null });
  assert.equal(leftovers(mapped, ["HIS No", "Patient Name"]).length, 0, JSON.stringify(leftovers(mapped, ["HIS No", "Patient Name"])));
  assert.match(mapped, /data-imp-field="legacyMrn"[^>]*><option value="">[^<]*<\/option><option value="0" selected>/);
  const DATA = ["HIS No", "Patient Name", "L-100", "L-101", "A patient with this mobile number is already registered.", "SMD-1", "1", "0", "2", "3"];
  const pv = html(c, { kind: "patients", map: MAP, mapping: {}, preview: PREVIEW });
  assert.equal(leftovers(pv, DATA).length, 0, JSON.stringify(leftovers(pv, DATA)));
  assert.match(pv, /data-imp="commit" data-count="1" data-plan="abcd1234abcd1234"/);
  const failed = html(c, { kind: "patients", map: MAP, mapping: {}, preview: false });
  assert.match(failed, /msg err/); assert.doesNotMatch(failed, /data-imp="commit"/);
  const refused = html(c, { kind: "patients", map: MAP, mapping: {}, preview: { ok: false, error: "preview_changed", message: "What would be imported changed since the dry run.", ...PREVIEW, ok: false, step: undefined } });
  assert.match(refused, /msg err/); assert.doesNotMatch(refused, /data-imp="commit"/, "a refused commit offers no import until a new dry run");
});

test("import screen in English: no markers, no dashes, and nothing added is said plainly", () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const c = ctxOf(win);
  const none = win.WSQ._importHtml(c, { kind: "vendors", map: { ...MAP, kind: "vendors" }, mapping: {}, preview: { ...PREVIEW, counts: { create: 0, matched: 2, duplicate: 0, invalid: 0 }, rows: [] } });
  assert.ok(!none.includes("⟦"));
  assert.match(none, /Nothing in this file would be added\./);
  assert.doesNotMatch(none, /[–—]/);
});

test("R3-1 import screen: a 250-row file runs in three parts, the parts' reports read as one, and a stopped import says how to resume", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win), W = win.WSQ;
  assert.deepEqual(JSON.parse(JSON.stringify(W._importRuns(250, 100))), [{ from: 0, to: 100 }, { from: 100, to: 200 }, { from: 200, to: 250 }]);
  assert.equal(W._importRuns(0, 100).length, 0);
  const part = (from, create, dup) => ({ ok: true, step: "preview", kind: "patients", rowCount: 250, rowCap: 100, run: { from, to: from + 1 }, planId: "p" + from, counts: { create, matched: 0, duplicate: dup, invalid: 0 }, rows: [{ row: from + 2, status: create ? "create" : "duplicate", label: "L-" + from }] });
  const merged = W._importMerge([part(0, 1, 0), part(100, 0, 1), part(200, 1, 0)]);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.counts)), { create: 2, matched: 0, duplicate: 1, invalid: 0 });
  assert.deepEqual(merged.rows.map((r) => r.row), [2, 102, 202]);
  assert.deepEqual(merged.runs.map((r) => [r.planId, r.create]), [["p0", 1], ["p100", 0], ["p200", 1]]);
  const mapped = W._importHtml(c, { kind: "patients", map: { ...MAP, rowCount: 250 }, mapping: {}, preview: null });
  assert.equal(leftovers(mapped, ["HIS No", "Patient Name"]).length, 0, JSON.stringify(leftovers(mapped, ["HIS No", "Patient Name"])));
  const pv = W._importHtml(c, { kind: "patients", map: MAP, mapping: {}, preview: merged });
  assert.match(pv, /data-imp="commit" data-count="2"/);
  const stopped = W._importHtml(c, { kind: "patients", map: MAP, mapping: {}, preview: { ok: false, message: "The import stopped at row 133 after 31 of 100.", counts: merged.counts, rows: merged.rows, stopped: { n: 131, part: 2, parts: 3 } } });
  const DATA = ["HIS No", "Patient Name", "L-0", "L-100", "L-200", "The import stopped at row 133 after 31 of 100.", "0", "1", "2", "102", "202"];
  assert.equal(leftovers(stopped, DATA).length, 0, JSON.stringify(leftovers(stopped, DATA)));
  assert.match(stopped, /msg err/); assert.doesNotMatch(stopped, /data-imp="commit"/, "a stopped import offers no import until a new dry run");
});
