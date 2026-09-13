/* P1.10 / P1.5 screens: an image link only when one is real, templates render their pick lists, and the
 * TPA screen keeps loading, failed and empty apart and never shows a channel stronger than it was.
 *
 * node --test test/ward-rad-tpa-view.test.mjs
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

const order = { serviceRequestId: "sr-1", category: "imaging", display: "Mammogram" };
const rad = (W, radiology) => W._render({ ...W._st, view: "radiology", sel: { patientId: "p1" }, investigations: { requests: [order] }, radiology: { pickedRequestId: "sr-1", ...radiology } });
const TEMPLATES = [{ id: "mammo", version: "2", name: "Mammogram", sections: [{ key: "birads", label: "BI-RADS category", options: ["1", "2"], required: true }] }];

test("radiology: loading, failed, missing identifier and a real link are four different screens", () => {
  const W = loadWard();
  assert.match(rad(W, {}), /Checking for images/);
  assert.match(rad(W, { studies: null, studiesFailed: true }), /Could not check for images. That is not the same as there being none/);
  const missing = rad(W, { studies: [{ serviceRequestId: "sr-1", study: null, viewer: { available: false, detail: "The viewer needs studyInstanceUid, which is not known for this study." } }], templates: [] });
  assert.match(missing, /No image link. The viewer needs studyInstanceUid/);
  assert.ok(!/Open images/.test(missing));
  const ok = rad(W, { studies: [{ serviceRequestId: "sr-1", study: { modality: "MG", accessionNumber: "sr-1", instanceCount: 4 }, viewer: { available: true, url: "https://pacs.example.test/v?acc=sr-1" } }], templates: [] });
  assert.match(ok, /href="https:\/\/pacs.example.test\/v\?acc=sr-1" target="_blank" rel="noopener noreferrer"/);
  assert.match(ok, /accession sr-1/);
  assert.match(ok, /free text only/);
});

test("radiology: a chosen template renders its hospital pick list, free text stays available", () => {
  const W = loadWard();
  const html = rad(W, { studies: [], templates: TEMPLATES, templateId: "mammo" });
  assert.match(html, /<option value="">Free text<\/option>/);
  assert.match(html, /BI-RADS category \*/);
  assert.match(html, /<select id="wRadSec_birads"><option value="">-<\/option><option value="1">1<\/option><option value="2">2<\/option>/);
  assert.match(html, /id="wRadFindings"/);
  assert.match(html, /data-w-act="radtemplate:wRad"/);
});

test("radiology board: the picked study shows its image state and template picker", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "radboard", radBoard: { requested: [{ orderId: "sr-1", name: "A B", mrn: "M1" }], reported: [], criticals: [], errors: [], picked: "sr-1",
    studies: [{ serviceRequestId: "sr-1", study: null, viewer: { available: false, detail: "No image viewer is configured for this hospital (wardsynq.imagingViewer.urlTemplate)." } }], templates: TEMPLATES } });
  assert.match(html, /No image viewer is configured/);
  assert.match(html, /id="wRadBTpl"/);
});

const tpa = (W, t) => W._render({ ...W._st, view: "tpa", sel: { patientId: "p1", encounterId: "e1" }, tpa: t });

test("tpa: loading and failed are not empty", () => {
  const W = loadWard();
  assert.match(tpa(W, null), /Loading claims/);
  const failed = tpa(W, { failed: true });
  assert.match(failed, /Claims could not be read. This is not the same as this patient having none/);
  assert.ok(!/No claim has been coded/.test(failed));
  assert.match(tpa(W, { claims: [], preAuthorisations: [], estimates: [], payers: [] }), /No claim has been coded for this patient/);
});

test("tpa: channel, warnings, settlement, resubmissions, estimates and the explicit balance action", () => {
  const W = loadWard();
  const html = tpa(W, {
    payers: [{ id: "nhcx", name: "NHCX Test", adapter: "fhir-claim", endpointConfigured: true }],
    claims: [
      { id: "c1", state: "submitted", payerId: "nokey", codes: [{ code: "E11.9" }], adapter: { state: "not_configured", note: "not_configured: credentials missing." }, submissions: [{}, { resubmission: true, reason: "missing discharge summary" }] },
      { id: "c2", state: "paid", payerId: "nhcx", payerReference: "CR-1", codes: [{ code: "I10" }], settlement: { paidAmount: 11000, approvedAmount: 12000, shortPaidAmount: 1000, shortPaymentReason: "co-pay", disallowances: [{ reason: "consumables", amount: 3000 }], outstandingAmount: 4000, balanceWith: "unassigned" } },
    ],
    preAuthorisations: [{ state: "requested", treatment: "PTCA", payerId: "nhcx", adapter: { state: "acknowledged" } }],
    estimates: [{ estimatedAmount: 6000, currency: "INR", payerId: "nhcx", at: "2026-09-13T10:00:00Z", lines: [{ code: "BED", quantity: 3, amount: 6000 }], unpriced: [{ code: "XRAY" }], note: "An ESTIMATE from the hospital tariff" }],
    payerWarnings: { c1: ["Payer \"nokey\" is not configured; its rules cannot be checked."] },
  });
  assert.match(html, /not configured, nothing sent - not_configured: credentials missing/);
  assert.match(html, /nokey \(not configured\)/);
  assert.match(html, /resubmitted 1 time: missing discharge summary/);
  assert.match(html, /Payer &quot;nokey&quot; is not configured/);
  assert.match(html, /paid 11000 of 12000 approved &middot; short 1000: co-pay &middot; disallowed: consumables \(3000\) &middot; outstanding 4000 &middot; balance with unassigned/);
  assert.match(html, /data-w-act="claimbalance:c2"/);
  assert.match(html, /data-w-act="claimsettle:c1"/);
  assert.match(html, /data-w-act="claimack:c1"/);
  assert.match(html, /acknowledged by the payer/);
  assert.match(html, /Not priced, not in the total: XRAY/);
  assert.match(html, /data-w-act="estimate"/);
  assert.ok(!/claimbalance:c1/.test(html), "no balance action before settlement");
});
