/* test/wardsynq-portal-ui.test.mjs - P2.9 screens: the patient portal and the staff "Patient portal" page.
 *
 * node --test test/wardsynq-portal-ui.test.mjs
 *
 * Loading, failed and empty must be three different screens: "we could not load your bills" read as
 * "you have no bills" tells a patient something false. And the staff page must actually call the
 * enrol / grants / revoke / messages / reply routes, so they are not finished-but-unreachable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const I18N = read("wardsynq/site/i18n.js");
const PORTAL = read("wardsynq/site/portal.js");
const STAFF = read("wardsynq/site/pages/portal-access.js");
const ROUTER = read("functions/api/queue/[[path]].js");

function loadPortal() {
  const window = {};
  vm.runInNewContext(I18N, { window });
  vm.runInNewContext(PORTAL, { window });
  return window.WSQPortal;
}
function loadStaff() {
  const pages = {};
  const window = { WSQ: { page: (n, d) => { pages[n] = d; } } };
  vm.runInNewContext(STAFF, { window });
  return { pages, api: window.WSQ._portalAccess };
}
const c = { esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x])) };

test("portal: loading, failed, session ended and signed-in are distinct screens", () => {
  const P = loadPortal();
  const phases = ["signin", "loading", "failed", "ended"].map((phase) => P.renderPhase({ phase }));
  assert.match(phases[0], /data-phase="signin"/);
  assert.match(phases[1], /data-phase="loading"/);
  assert.match(phases[2], /data-phase="failed"/);
  assert.match(phases[2], /not an empty record/);
  assert.match(phases[3], /data-phase="ended"/);
  assert.equal(new Set(phases).size, 4);
});

test("portal: a failed section is never drawn as an empty one", () => {
  const P = loadPortal();
  const base = { access: { kind: "patient", sections: ["bills", "consents", "discharge"] }, document: {}, bills: [], consents: [{ consentId: "c1", scopeLabel: "Research", status: "granted", canWithdraw: true }], failedSections: ["discharge"] };
  const html = P.renderRecord(base);
  assert.match(html, /data-empty="bills"/, "no bills is an empty state");
  assert.match(html, /data-section="discharge"[\s\S]*could not load this part/, "a failed read says so");
  assert.doesNotMatch(html, /data-empty="discharge"/);
  assert.match(html, /data-act="withdraw" data-id="c1"/);
});

test("portal: a proxy's page draws only the granted sections, and never a withdraw button", () => {
  const P = loadPortal();
  const html = P.renderRecord({ access: { kind: "proxy", relationship: "spouse", sections: ["appointments", "bills"] }, document: { appointments: [] }, bills: [], failedSections: [] });
  assert.match(html, /viewing as spouse/);
  assert.match(html, /data-section="appointments"/);
  assert.match(html, /data-section="bills"/);
  for (const s of ["results", "medicines", "messages", "consents", "discharge"]) assert.doesNotMatch(html, new RegExp('data-section="' + s + '"'), s);
  assert.doesNotMatch(html, /data-act="withdraw"/);
});

test("portal: messages show the not-an-emergency warning above the box, and escape what patients typed", () => {
  const P = loadPortal();
  const html = P.renderRecord({ access: { kind: "patient", sections: ["messages"] }, document: {}, notEmergency: "This is not a way to get urgent help.", messages: [{ sentAt: "2026-09-01T00:00:00Z", body: "<img src=x onerror=alert(1)>", reply: null }] });
  assert.ok(html.indexOf("not a way to get urgent help") < html.indexOf('id="pMsgBody"'));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Not answered yet/);
});

test("portal: no staff session, no PHI in the address, POST only", () => {
  assert.doesNotMatch(PORTAL, /firebase|api\/queue|Authorization/);
  assert.match(PORTAL, /sessionStorage/);
  // localStorage (D6) holds only the chosen language code, never the session: PHI still lives only
  // in sessionStorage, and only under the session key.
  assert.match(PORTAL, /localStorage/, "language preference");
  const localStorageCalls = PORTAL.match(/localStorage\.\w+\(([^)]*)\)/g) || [];
  assert.ok(localStorageCalls.length > 0);
  for (const call of localStorageCalls) assert.doesNotMatch(call, /\bKEY\b/, "the session key never reaches localStorage: " + call);
  assert.doesNotMatch(PORTAL, /fetch\([^)]*\?/, "no query strings on portal calls");
  assert.match(PORTAL, /method: "POST"/);
  const html = read("wardsynq/site/portal.html");
  assert.doesNotMatch(html, /firebase|shell\.js/);
  assert.doesNotMatch(PORTAL + html, /—/, "no em dash");
  assert.match(read("scripts/build-wardsynq-site.sh"), /portal\.html/, "the site build ships the page");
});

test("staff page: worklist and grants have distinct loading, failed and empty states", () => {
  const { pages, api } = loadStaff();
  assert.ok(pages["portal-access"], "registered as a page");
  assert.match(api.worklistHtml(c, null), /spin/);
  assert.match(api.worklistHtml(c, { ok: false, error: "permission" }), /Do not read this as no messages/);
  assert.match(api.worklistHtml(c, { ok: true, messages: [] }), /data-empty="messages"/);
  assert.match(api.worklistHtml(c, { ok: true, messages: [{ messageId: "m1", patientId: "p", waitingHours: 50 }], warning: "old" }), /data-pa="reply" data-id="m1"/);
  assert.match(api.grantsHtml(c, { ok: false }), /Do not read this as nobody having access/);
  assert.match(api.grantsHtml(c, { ok: true, grants: [] }), /data-empty="grants"/);
  const g = api.grantsHtml(c, { ok: true, grants: [{ grantId: "g1", state: "in-use", proxy: { name: "Ravi", relationship: "spouse", sections: ["bills"], consentFrom: "patient", consentMethod: "in-person-verbal" } }] });
  assert.match(g, /data-pa="revoke" data-id="g1"/);
  assert.equal(api.patientIdForMrn("GH-000123"), "opd-pat-gh-000123", "the same id opd-identity.js files the record under");
});

test("education leaflets: the library keeps loading, failed and empty apart; a draft's writer is not offered Approve; the portal shows given copies", () => {
  const { api } = loadStaff();
  assert.match(api.libraryHtml(c, null, true), /spin/);
  assert.match(api.libraryHtml(c, { ok: false }, true), /Do not read this as no leaflets/);
  assert.match(api.libraryHtml(c, { ok: true, leaflets: [] }, true), /data-empty="leaflets"/);
  const draft = { leafletId: "l1", version: 1, title: "Wound care", language: "hi", body: "text", state: "draft", draftedBy: ["cfa:a"] };
  assert.ok(!/data-pa="eduapprove"/.test(api.libraryHtml(c, { ok: true, me: "cfa:a", leaflets: [draft] }, true)), "not offered to the person who wrote it");
  assert.match(api.libraryHtml(c, { ok: true, me: "cfa:b", leaflets: [draft] }, true), /data-pa="eduapprove" data-id="l1" data-v="1"/);
  assert.ok(!/data-pa="edu/.test(api.libraryHtml(c, { ok: true, me: "cfa:b", leaflets: [draft] }, false)), "a reader gets no author controls");
  assert.ok(!/data-pa="edu/.test(api.libraryHtml(c, { ok: true, me: "cfa:b", leaflets: [{ ...draft, state: "retired", retired: { reason: "old" } }] }, true)), "a retired leaflet is only read");
  for (const route of ["/ward/education-leaflets", "/ward/education-leaflet-save", "/ward/education-leaflet-approve", "/ward/education-leaflet-retire"]) assert.ok(STAFF.includes(route), route);

  const P = loadPortal();
  const given = P.renderRecord({ access: { kind: "patient", sections: ["education"] }, document: {}, education: [{ title: "Wound care", language: "hi", body: "line <b>", attachedAt: "2026-09-17T01:00:00Z" }], failedSections: [] });
  assert.match(given, /data-section="education"/);
  assert.match(given, /line &lt;b&gt;/);
  assert.match(P.renderRecord({ access: { kind: "patient", sections: ["education"] }, document: {}, education: [], failedSections: [] }), /data-empty="education"/);
  const bad = P.renderRecord({ access: { kind: "patient", sections: ["education"] }, document: {}, failedSections: ["education"] });
  assert.ok(!/data-empty="education"/.test(bad), "a failed read is never drawn as none given");
  assert.ok(!/data-section="education"/.test(P.renderRecord({ access: { kind: "proxy", sections: ["bills"] }, document: {}, bills: [], failedSections: [] })), "a proxy not granted it sees no such section");
});

test("staff page calls every staff portal route, and the router guards each with a capability", () => {
  for (const route of ["/ward/patient-messages", "/ward/patient-reply", "/ward/patient-enrol", "/ward/patient-revoke", "/ward/patient-grants"]) {
    assert.ok(STAFF.includes(route), route);
  }
  assert.match(ROUTER, /"patient-enrol": CAPS\.EMR_TREAT, "patient-revoke": CAPS\.EMR_TREAT, "patient-grants": CAPS\.EMR_TREAT/);
  assert.match(ROUTER, /"patient-messages": CAPS\.EMR_VIEW, "patient-reply": CAPS\.EMR_TREAT/);
  assert.match(read("wardsynq/site/index.html"), /pages\/portal-access\.js/);
});

test("listGrants refuses when the feature is off and without a patient, and never returns digests", async () => {
  const { listGrants } = await import("../functions/_wardsynq/patient-access.js");
  const mig = { mode: "authoritative", tenantId: "t" };
  assert.equal((await listGrants(null, {}, { migration: mig, patientId: "p", config: { enabled: false } })).status, 404);
  assert.equal((await listGrants(null, {}, { migration: mig, patientId: "", config: { enabled: true } })).status, 422);
  const src = read("functions/_wardsynq/patient-access.js");
  const start = src.indexOf("async function listGrants");
  const body = src.slice(start, src.indexOf("\nexport {", start));
  assert.ok(body.length > 500 && body.includes("grantSections"), "the slice is the function, not an empty string");
  assert.doesNotMatch(body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|^\s*\*.*$/gm, ""), /codeHash|tokenHash/, "a grant readable by staff must not be a way to become the patient");
});
