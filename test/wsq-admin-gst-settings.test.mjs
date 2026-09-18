/* test/wsq-admin-gst-settings.test.mjs - Admin Center > Price list > GST settings (wardsynq/site/pages/admin.js).
 *
 * gst-packages: the settings the GST treatment review leaves to the hospital's chartered accountant. Could not be read is
 * never shown as the defaults; each setting says "Confirm with your chartered accountant." and the review's reason in
 * one line; a valuation other than the published tariff shows the review's warning; Save sends
 * POST /api/queue/org/gst-settings with every setting and the reason (the server validates, needs the CA's opinion for a
 * non-default and audits: test/wardsynq-gst-packages.test.mjs); the card is read with GET /api/queue/org/gst-settings.
 * gst-parties (2026-09-17): the GST recipient is no longer a setting here; the card says it is determined on each payer
 * contract, and a saved old hospital-wide "payer" is said to apply only to contracts with no determination.
 * Every word is translated. The Price list form carries the intensive care class, the hours a bed price covers and the
 * not-health-care marker; the package form the payer's room rate and whether its rate includes GST.
 *
 * node --test test/wsq-admin-gst-settings.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const SETTINGS = { pkgRoomValuation: "published_tariff", recipientOfCashlessClaims: null, placeOfSupply: "where_performed", intensiveCareUnits: "named_and_specialty",
  roomChargeBasis: "bed_tariff", dischargeMedsAsComposite: "taxed", gstTdsDeductorSchemes: ["cghs"], aggregateTurnoverRs: 62000000, caOpinionRef: null, caOpinionDate: null };
const flush = () => new Promise((r) => setTimeout(r, 0));
function ctx(win, api) { return { esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en, ms: win.WSQ.ms, toast() {}, api, state: { orgId: "org-1" } }; }
const host = () => ({ innerHTML: "", querySelectorAll: () => [] });

test("the Price list tab draws the GST settings card from GET /org/gst-settings and saves through POST /org/gst-settings; tariff and package forms carry the new GST fields", () => {
  const src = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  assert.match(src, /renderGstSettings\(c, document\.getElementById\("admGstHost"\)\)/);
  assert.match(src, /c\.api\("\/org\/gst-settings\?orgId="/);
  assert.match(src, /c\.api\("\/org\/gst-settings", \{ orgId: c\.state\.orgId, settings: settings, reason:/);
  for (const id of ["admTrfIcu", "admTrfHours", "admTrfNonHealth", "admPkgRoomRate", "admPkgRoomSrc", "admPkgInclGst"]) assert.ok(src.includes(`id="${id}"`), id);
  assert.match(src, /intensiveCareClass: kind === "bed" \? document\.getElementById\("admTrfIcu"\)\.value/);
  assert.match(src, /priceIncludesGst: document\.getElementById\("admPkgInclGst"\)\.checked/);
});

test("could not be read is not the defaults; each setting says the chartered accountant decides and why", async () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const failed = host();
  await win.WSQ._renderGstSettings(ctx(win, () => Promise.resolve({ ok: false })), failed); await flush();
  assert.match(failed.innerHTML, /The GST settings could not be loaded\. Do not read this as the defaults\./);
  assert.doesNotMatch(failed.innerHTML, /published per-day room tariff/);
  const h = host();
  await win.WSQ._renderGstSettings(ctx(win, () => Promise.resolve({ ok: true, settings: SETTINGS })), h); await flush();
  assert.equal(h.innerHTML.split("Confirm with your chartered accountant.").length - 1, 6, "five choices and the TDS schemes");
  assert.doesNotMatch(h.innerHTML, /admGst_recipientOfCashlessClaims/, "no hospital-wide GST recipient");
  assert.match(h.innerHTML, /The GST recipient \(Section 2\(93\) CGST Act\) is determined on each payer contract under Integrations, Payers/);
  assert.doesNotMatch(h.innerHTML, /Your earlier hospital-wide setting/);
  const legacy = host();
  await win.WSQ._renderGstSettings(ctx(win, () => Promise.resolve({ ok: true, settings: { ...SETTINGS, recipientOfCashlessClaims: "payer" } })), legacy); await flush();
  assert.match(legacy.innerHTML, /Your earlier hospital-wide setting made the insurer, TPA or scheme the GST recipient\. It is used only for payer contracts with no determination of their own/);
  assert.match(h.innerHTML, /<option value="published_tariff" selected>The hospital&#39;s published per-day room tariff, capped at the package price \(default\)<\/option>|<option value="published_tariff" selected>The hospital's published per-day room tariff, capped at the package price \(default\)<\/option>/);
  assert.match(h.innerHTML, /A health service is supplied where it is performed \(IGST Act Section 12\(4\), a probable reading\)/);
  assert.match(h.innerHTML, /HDU, step-down, isolation and labour rooms are not named/);
  assert.match(h.innerHTML, /id="admGstTds_cghs" checked/);
  assert.match(h.innerHTML, /value="62000000"/);
});

test("Save sends every setting and the reason; a valuation other than the published tariff shows the review's warning", async () => {
  const { win, doc } = loadSite({ pages: ["admin.js"] });
  const el = new Proxy({}, { get: (_t, id) => doc.getElementById(id) });
  const sent = [];
  const api = (path, body) => { if (body) { sent.push([path, body]); return Promise.resolve({ ok: true, changed: ["pkgRoomValuation"], settings: SETTINGS }); } return Promise.resolve({ ok: true, settings: { ...SETTINGS, pkgRoomValuation: "scheme_rate" } }); };
  const h = host();
  await win.WSQ._renderGstSettings(ctx(win, api), h); await flush();
  assert.match(el.admGstValNote.innerHTML, /Room charges inside packages will be valued using the payer&#39;s own per-day room rate instead of your published room tariff\. There is no official rule on this\. Record your chartered accountant&#39;s approval\./);
  for (const [k, v] of Object.entries({ pkgRoomValuation: "scheme_rate", placeOfSupply: "where_performed", intensiveCareUnits: "include_hdu", roomChargeBasis: "bed_tariff", dischargeMedsAsComposite: "taxed" })) el["admGst_" + k].value = v;
  el.admGstTds_pmjay.checked = true; el.admGstTurnover.value = "62000000"; el.admGstCaRef.value = "CA letter 9"; el.admGstCaDate.value = "2026-09-10"; el.admGstReason.value = "CA opinion received";
  el.admGstSave.onclick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "/org/gst-settings");
  assert.deepEqual(sent[0][1], { orgId: "org-1", reason: "CA opinion received", settings: { pkgRoomValuation: "scheme_rate", placeOfSupply: "where_performed", intensiveCareUnits: "include_hdu",
    roomChargeBasis: "bed_tariff", dischargeMedsAsComposite: "taxed", gstTdsDeductorSchemes: ["pmjay"], aggregateTurnoverRs: "62000000", caOpinionRef: "CA letter 9", caOpinionDate: "2026-09-10" } });
  el.admGstTurnover.value = "6.2 crore";
  el.admGstSave.onclick();
  assert.equal(sent.length, 1, "a turnover that is not a whole number of rupees sends nothing");
  assert.match(el.admGstMsg.innerHTML, /Aggregate turnover is a whole number of rupees/);
});

test("in a staff language every word of the GST settings card is translated", async () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const h = host();
  await win.WSQ._renderGstSettings(ctx(win, () => Promise.resolve({ ok: true, settings: { ...SETTINGS, recipientOfCashlessClaims: "payer", caOpinionRef: "CA letter 9" } })), h); await flush();
  assert.deepEqual(leftovers(h.innerHTML, ["62000000", "CA letter 9"]), []);
});
