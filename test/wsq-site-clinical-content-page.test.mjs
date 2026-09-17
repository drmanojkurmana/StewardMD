/* test/wsq-site-clinical-content-page.test.mjs - Admin Center > Hospital: the critical limits, delta limits, autoverification,
 * MAR times and note template cards (pages/admin.js WSQ._ccs), the screen for GET/POST /api/queue/org/clinical-settings/<setting>.
 * Every state translates; codes, times and server messages stay as they came; a failed load never reads as not configured; the
 * draft starts from what is saved, never from a default; Save carries the dry run's count and plan, and a refused dry run offers none.
 *
 * node --test test/wsq-site-clinical-content-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";
import { checkContent, referenceFor } from "../functions/_wardsynq/clinical-content-settings.js";

const ALL = ["staff.admin", "lab.result", "order.verify", "emr.treat"];
const ctxOf = (win, caps) => ({ esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en, can: (k) => (caps || ALL).includes(k) });
const SAVED = {
  criticalLimits: { "2823-3": { display: "Potassium", unit: "mmol/L", low: 2.5, high: 6.5 } },
  deltaLimits: { "2823-3": { maxAbsolute: 1.5, withinHours: 48 } },
  autoVerify: { enabled: true, codes: ["2823-3"] },
  marTimes: { TDS: ["07:00", "13:00", "21:00"] },
  noteTemplates: [{ id: "ward-round", name: "Ward round", sections: [{ key: "plan", title: "Plan", prompt: "What next?", required: true }] }],
};
const read = (key, over) => ({ ok: true, key, configured: true, saved: SAVED[key], problems: [], signOff: { signedOffBy: "Dr Rao", reason: "Approved", at: "2026-09-17T10:00:00Z" }, reference: referenceFor(key), ...over });
const PREVIEW = { ok: true, step: "preview", planId: "abcd1234abcd1234", changeCount: 1, counts: { add: 1, change: 0, remove: 0, invalid: 0 }, rows: [{ item: "2823-3", status: "add" }] };
const REFUSED = { ok: false, error: "invalid_clinical_content", message: "Nothing was saved.", step: "preview", planId: "x", changeCount: 0, counts: { add: 0, change: 0, remove: 0, invalid: 1 },
  rows: [{ item: "BD", status: "invalid", problems: [{ reason: "bad_time", message: "A time must be written as HH:MM." }] }] };

test("every card and state translates; saved values, codes and server messages are kept verbatim", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win), ccs = win.WSQ._ccs;
  for (const key of ccs.keys) {
    const rows = ccs.rows(key, SAVED[key]);
    const DATA = [...Object.keys(referenceFor(key).knownCodes || {}).map((k) => k + " " + referenceFor(key).knownCodes[k]), "OD", "BD", "TDS", "QID", "OM", "HS", "Dr Rao", "Approved", "2823-3", "BD",
      "Nothing was saved.", "0", "1", "progress, nursing, assessment"];
    for (const s of [{ r: undefined }, { r: null }, { r: read(key), rows }, { r: read(key, { configured: false, saved: {}, signOff: null }), rows: [] }, { r: read(key), rows, pv: PREVIEW }, { r: read(key), rows, pv: REFUSED }, { r: read(key), rows, pv: false }]) {
      const h = ccs.html(c, key, { rows: [], enabled: false, pv: null, ...s });
      const left = leftovers(h, DATA).filter((x) => !/\d{2}:\d{2}|mmol|mg\/dL|\/uL|Potassium|<=|>=|Ward round|ward-round|plan \| Plan/.test(x));
      assert.equal(left.length, 0, key + " " + JSON.stringify(left));
    }
  }
});

test("a failed load is said, not drawn as not configured; no access is told; a refused dry run offers no save; the saved plan is what Save sends", () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const c = ctxOf(win), ccs = win.WSQ._ccs;
  const failed = ccs.html(c, "criticalLimits", { r: null, rows: [], pv: null });
  assert.match(failed, /msg err/); assert.match(failed, /Do not read this as not configured/); assert.doesNotMatch(failed, /data-ccs="dry"/);
  const lab = ccs.html(ctxOf(win, ["staff.admin"]), "deltaLimits", { r: read("deltaLimits"), rows: [], pv: null });
  assert.match(lab, /needs staff administration and the clinical capability/); assert.doesNotMatch(lab, /48/);
  const empty = ccs.html(c, "criticalLimits", { r: read("criticalLimits", { configured: false, saved: {}, signOff: null }), rows: ccs.rows("criticalLimits", {}), pv: null });
  assert.match(empty, /No critical limits are saved/);
  assert.doesNotMatch(empty, /value="2823-3"[^>]* selected/, "the draft is not prefilled from the built-in defaults");
  assert.match(ccs.html(c, "marTimes", { r: read("marTimes"), rows: [], pv: PREVIEW }), /data-ccs="commit" data-count="1" data-plan="abcd1234abcd1234"/);
  const refused = ccs.html(c, "marTimes", { r: read("marTimes"), rows: [], pv: REFUSED });
  assert.match(refused, /msg err/); assert.doesNotMatch(refused, /data-ccs="commit"/);
  assert.match(refused, /24 hour clock/, "a known refusal reason is in the screen's own words");
  const signed = ccs.html(c, "autoVerify", { r: read("autoVerify"), rows: ccs.rows("autoVerify", SAVED.autoVerify), enabled: true, pv: null });
  assert.match(signed, /Signed off by: Dr Rao/); assert.match(signed, /data-ccs-on checked/);
  for (const key of ccs.keys) assert.ok(!ccs.html(c, key, { r: read(key), rows: ccs.rows(key, SAVED[key]), enabled: true, pv: REFUSED }).match(/[–—⟦]/), key);
});

test("the rows the screen edits round-trip to exactly the saved value the server accepts", () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const ccs = win.WSQ._ccs;
  for (const key of ccs.keys) {
    const back = JSON.parse(JSON.stringify(ccs.value(key, ccs.rows(key, SAVED[key]), SAVED.autoVerify.enabled)));
    const chk = checkContent(key, back);
    assert.deepEqual(chk.problems, [], key);
    assert.deepEqual(chk.value, checkContent(key, SAVED[key]).value, key);
  }
});
