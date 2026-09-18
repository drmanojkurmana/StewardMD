/* test/wsq-site-formulary-page.test.mjs - Admin Center > Hospital > Formulary (pages/admin.js WSQ._formularyHtml), the
 * screen for GET/POST /api/queue/org/formulary and POST /api/queue/org/formulary-import. Every state translates; drug
 * names, codes and server messages stay as they came; a failed load never reads as no formulary; Save carries exactly the
 * dry run's count and plan, and a refused dry run offers no Save.
 *
 * node --test test/wsq-site-formulary-page.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const ctxOf = (win, caps) => ({ esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en, can: (k) => (caps || ["staff.admin", "order.verify"]).includes(k) });
const ENTRIES = [{ drug: "Meropenem", code: "MER-1", restricted: true, requiresApproval: true, aliases: ["Meronem"] }, { drug: "Morphine", controlled: true, retired: true }];
const state = (over) => ({ r: { ok: true, entries: ENTRIES, requireReasonOffFormulary: false, problems: [] }, draft: { entries: ENTRIES, requireReasonOffFormulary: false }, edit: null, q: "", pv: null, map: null, mapping: null, mode: "", csvPv: null, ...over });
const PREVIEW = { ok: true, step: "preview", planId: "abcd1234abcd1234", changeCount: 2, counts: { add: 1, change: 1, remove: 0, invalid: 0, setting: 0 },
  rows: [{ index: 0, label: "Meropenem", status: "change" }, { index: 2, label: "Colistin", status: "add" }], removed: [] };
const REFUSED = { ok: false, error: "invalid_formulary", message: "Nothing was saved.", step: "preview", planId: "x", changeCount: 1, counts: { add: 1, change: 0, remove: 0, invalid: 1, setting: 0 },
  rows: [{ row: 3, label: "Colistin", status: "invalid", problems: [{ reason: "restriction_has_no_route", message: "A restricted drug needs a route." }] }], removed: [] };

test("formulary card: loading, failed, list, editor, dry run and refusal translate; drug values and server messages are kept verbatim", () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const c = ctxOf(win), html = win.WSQ._formularyHtml;
  const DATA = ["Meropenem", "MER-1", "Meronem", "Morphine", "Colistin", "Nothing was saved.", "1", "2", "3", "0"];
  for (const s of [state({ r: undefined }), state({ r: null }), state(), state({ edit: 0 }), state({ pv: PREVIEW }), state({ csvPv: REFUSED, map: { fields: ["drug", "code"], headers: ["Name", "Code"], rowCount: 3 } }), state({ pv: false })]) {
    const h = html(c, s);
    const left = leftovers(h, [...DATA, "Name", "Code"]);
    assert.equal(left.length, 0, JSON.stringify(left));
  }
  assert.match(html(c, state({ r: null })), /msg err/, "a failed load is said, never drawn as an empty list");
  assert.doesNotMatch(html(c, state({ r: null })), /data-fml="dry"/);
  assert.match(html(c, state({ pv: PREVIEW })), /data-fml="ed-commit" data-count="2" data-plan="abcd1234abcd1234"/);
  const refused = html(c, state({ pv: REFUSED }));
  assert.match(refused, /msg err/); assert.doesNotMatch(refused, /data-fml="ed-commit"/, "a refused dry run offers no save");
  assert.match(html(c, state({ pv: false })), /msg err/);
});

test("formulary card in English: no markers or dashes; hr without order.verify is told, not shown a list; empty is said plainly", () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const html = win.WSQ._formularyHtml;
  const hr = html(ctxOf(win, ["staff.admin"]), state());
  assert.match(hr, /needs both staff administration and pharmacy verification/);
  assert.doesNotMatch(hr, /Meropenem/);
  const empty = html(ctxOf(win), state({ r: { ok: true, entries: [], problems: [] }, draft: { entries: [], requireReasonOffFormulary: false } }));
  assert.match(empty, /No formulary is configured\./);
  const full = html(ctxOf(win), state({ pv: REFUSED, edit: -1 }));
  assert.ok(!full.includes("⟦")); assert.doesNotMatch(full, /[–—]/);
  assert.match(full, /Retired/);
  assert.match(full, /nobody could ever order it/, "a known refusal reason is shown in the screen's own words");
});
