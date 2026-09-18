/* gap-claims-gst-2 screens: package billing on TPA / Claims (loading, failed and none kept apart; flags; the manual
 * portal said plainly; nothing called submitted) and package lines on the cashier's bill.
 *
 * node --test test/ward-package-view.test.mjs
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
const T = { claims: [], preAuthorisations: [{ id: "pa-1", state: "approved", treatment: "ORIF" }], estimates: [], eligibilityChecks: [], payers: [] };
const tpa = (W, tpaPkg) => W._render({ ...W._st, view: "tpa", sel: { patientId: "p1", encounterId: "e1" }, tpa: T, tpaPkg });
const PKG = { id: "pkg-pmjay-su007a", version: 1, scheme: "pmjay", code: "SU007A", name: "ORIF", rate: 45000, expectedLosDays: 2, preAuthRequired: true, active: true };

test("package section: loading, could not be read and none are three different screens", () => {
  const W = loadWard();
  assert.match(tpa(W, null), /Loading packages/);
  const failed = tpa(W, false);
  assert.match(failed, /Packages could not be read. This is not the same as this stay having none/);
  assert.ok(!/data-w-act="pkgset"/.test(failed), "nothing offered when the packages are unknown");
  const none = tpa(W, { assignments: [], stays: [{ id: "e1", status: "in-progress", periodStart: "2026-09-10T08:00:00Z" }], packages: [PKG] });
  assert.match(none, /No stay of this patient is on a package/);
  assert.match(none, /data-w-act="pkgset"/);
  const noPkgs = tpa(W, { assignments: [], stays: [{ id: "e1" }], packages: [] });
  assert.match(noPkgs, /A package needs an inpatient stay and a package set up by an administrator/);
});

test("package on a stay: rate, length of stay exceeded, pre-authorisation problem, the split, and the manual pack", () => {
  const W = loadWard();
  const html = tpa(W, {
    stays: [{ id: "e1" }], packages: [PKG],
    assignments: [{ id: "a1", version: 1, encounterId: "e1", beneficiaryId: "PMJAY-1", package: PKG,
      flags: { stayDays: 4, expectedLosDays: 2, losExceeded: true, preAuthRequired: true, preAuthState: "missing", preAuthProblem: true, manualPortal: true },
      split: { counts: { included: 5, excluded: 1, outside: 2 }, excluded: [{ display: "Locking plate", line: 20000 }], outside: [{ display: "Doctor visit", line: 500 }], unpriced: [] } }],
  });
  assert.match(html, /Rate 45000 &middot; version 1 &middot; stay e1 &middot; beneficiary ID PMJAY-1/);
  assert.match(html, /Length of stay exceeded: day 4, the package expects 2\./);
  assert.match(html, /This package needs an approved pre-authorisation: none linked/);
  assert.match(html, /Excluded, billed on top: Locking plate 20000/);
  assert.match(html, /Not listed by the package, billed; check against the scheme: Doctor visit 500/);
  assert.match(html, /Not connected to the scheme's portal. Nothing is sent from here/);
  assert.match(html, /data-w-act="pkgpack:e1"/);
  assert.match(html, /data-w-act="pkgremove:e1"/);
  assert.ok(!/submitted to|has been submitted/i.test(html));
  const unread = tpa(W, { stays: [{ id: "e1" }], packages: [PKG], assignments: [{ id: "a1", encounterId: "e1", package: PKG, flags: { stayDays: 1, expectedLosDays: 2, preAuthState: "approved" }, split: false }] });
  assert.match(unread, /The stay's charges could not be read, so what is billed on top is not known/);
});

test("cashier bill: the package rate, covered lines at zero, excluded and unlisted lines said, flags on the bill", () => {
  const W = loadWard();
  const inv = { invoiceId: "inv-1", status: "open", charged: 65000, paidIn: 0, balance: 65000, events: [], receipts: [],
    package: { code: "SU007A", name: "ORIF", rate: 45000, losExceeded: true, stayDays: 3, expectedLosDays: 2, preAuthProblem: false, preAuthState: "approved" },
    lines: [
      { code: "SU007A", display: "Package: ORIF", line: 45000, packageCode: "SU007A", packageLine: true },
      { code: "BED-GEN", display: "General bed", line: 0, packageCode: "SU007A", packageIncluded: true },
      { code: "IMPLANT", display: "Locking plate", line: 20000, packageCode: "SU007A", packageExcluded: true },
      { code: "DR-VISIT", display: "Doctor visit", line: 500, packageCode: "SU007A", packageOutside: true },
    ] };
  const html = W._render({ ...W._st, view: "cashier", sel: { patientId: "p1" }, cashier: { patientId: "p1", invoices: [inv], einvoice: undefined } });
  assert.match(html, /Package SU007A: ORIF, rate 45000/);
  assert.match(html, /Package: ORIF &middot; <b>package rate<\/b>/);
  assert.match(html, /General bed &middot; <b>included in the package<\/b>/);
  assert.match(html, /Locking plate &middot; <b>excluded from the package, billed<\/b>/);
  assert.match(html, /Doctor visit &middot; <b>not listed by the package, billed; check<\/b>/);
  assert.match(html, /Length of stay exceeded/);
});
