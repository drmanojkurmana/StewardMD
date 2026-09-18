/* test/wsq-admin-packages.test.mjs - Admin Center > Price list > Packages (wardsynq/site/pages/admin.js).
 *
 * The package master screen: failed is never shown as none; a package lists its scheme, code, rate, expected days
 * and pre-authorisation; Add sends POST /api/queue/ward/package-save with the typed fields (the server validates and
 * audits, test/wardsynq-packages.test.mjs); a change needs a reason and sends the version it read; the list is
 * GET /api/queue/ward/packages and Versions reads GET /api/queue/ward/package-versions. Every word is translated.
 *
 * node --test test/wsq-admin-packages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const PKG = { id: "pkg-pmjay-su007a", version: 2, scheme: "pmjay", schemeName: null, code: "SU007A", name: "ORIF", rate: 45000, expectedLosDays: 2, preAuthRequired: true, active: true,
  inclusions: { kinds: ["bed"], items: [] }, exclusions: { kinds: [], items: ["IMPLANT"] }, preAuthDocuments: ["X-ray"], claimDocuments: ["Discharge summary"] };
const flush = () => new Promise((r) => setTimeout(r, 0));
function ctx(win, api) { return { esc: win.WSQ.esc, t: win.WSQ.t, tSafe: win.WSQ.tSafe, en: win.WSQ.en, ms: win.WSQ.ms, toast() {}, api, state: { orgId: "org-1" } }; }
const host = () => ({ innerHTML: "", querySelectorAll: () => [] });

test("the Price list tab draws the Packages card from GET /ward/packages and saves through POST /ward/package-save", () => {
  const src = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  assert.match(src, /renderPackages\(c, document\.getElementById\("admPkgHost"\)\)/);
  assert.match(src, /c\.api\("\/ward\/packages\?orgId="/);
  assert.match(src, /c\.api\("\/ward\/package-save"/);
  assert.match(src, /c\.api\("\/ward\/package-versions\?orgId="/);
});

test("could not be read is not none; a package row shows what billing needs", async () => {
  const { win } = loadSite({ pages: ["admin.js"] });
  const failed = host();
  await win.WSQ._renderPackages(ctx(win, () => Promise.resolve({ ok: false })), failed); await flush();
  assert.match(failed.innerHTML, /The packages could not be loaded. Do not read this as no packages/);
  assert.doesNotMatch(failed.innerHTML, /No packages set up yet/);
  const none = host();
  await win.WSQ._renderPackages(ctx(win, () => Promise.resolve({ ok: true, packages: [] })), none); await flush();
  assert.match(none.innerHTML, /No packages set up yet/);
  const one = host();
  await win.WSQ._renderPackages(ctx(win, () => Promise.resolve({ ok: true, packages: [PKG, { ...PKG, id: "p2", code: "OLD", active: false }] })), one); await flush();
  assert.match(one.innerHTML, /PM-JAY \(Ayushman Bharat\)<\/td><td>SU007A<\/td><td>ORIF<br><small>version 2<\/small><\/td><td>45000.00<\/td><td>2<\/td><td>required/);
  assert.match(one.innerHTML, /version 2 &middot; withdrawn/);
  assert.match(one.innerHTML, /data-pkg-hist="pkg-pmjay-su007a"/);
});

test("Add sends the typed package; a rate that is not a plain amount sends nothing", async () => {
  const { win, doc } = loadSite({ pages: ["admin.js"] });
  const elements = new Proxy({}, { get: (_t, id) => doc.getElementById(id) });
  const sent = [];
  const api = (path, body) => { if (body) { sent.push([path, body]); return Promise.resolve({ ok: true }); } return Promise.resolve({ ok: true, packages: [PKG] }); };
  const h = host();
  await win.WSQ._renderPackages(ctx(win, api), h); await flush();
  Object.assign(elements.admPkgScheme, { value: "cghs" });
  elements.admPkgCode.value = "CGHS-12"; elements.admPkgName.value = "Cataract"; elements.admPkgRate.value = "12000.50"; elements.admPkgLos.value = "1";
  elements.admPkgSchemeName.value = ""; elements.admPkgPreauth.checked = false;
  elements.admPkgIncItems.value = ""; elements.admPkgExcItems.value = "Lens\nIMPLANT"; elements.admPkgPreDocs.value = "Eye exam"; elements.admPkgClaimDocs.value = "";
  elements.admPkgSave.onclick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "/ward/package-save");
  assert.deepEqual([sent[0][1].scheme, sent[0][1].code, sent[0][1].rate, sent[0][1].expectedLosDays, sent[0][1].exclusions.items, sent[0][1].preAuthDocuments],
    ["cghs", "CGHS-12", "12000.50", "1", ["Lens", "IMPLANT"], ["Eye exam"]]);
  elements.admPkgRate.value = "12,000";
  elements.admPkgSave.onclick();
  assert.equal(sent.length, 1, "a rate that is not a plain amount is refused on screen");
  assert.match(elements.admPkgMsg.innerHTML, /The rate has to be a plain amount in rupees/);
});

test("in a staff language every word of the Packages card is translated", async () => {
  const { win } = loadSite({ lang: "xx", pages: ["admin.js"] });
  const h = host();
  await win.WSQ._renderPackages(ctx(win, () => Promise.resolve({ ok: true, packages: [PKG] })), h); await flush();
  assert.deepEqual(leftovers(h.innerHTML, ["SU007A", "ORIF", "45000.00", "X-ray", "Discharge summary", "IMPLANT"]), []);
});
