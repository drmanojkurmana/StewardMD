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
