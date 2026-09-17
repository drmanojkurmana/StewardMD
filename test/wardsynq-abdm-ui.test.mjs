/* test/wardsynq-abdm-ui.test.mjs - the screens that reach the ABDM routes (owner S6, phases A3 to A5).
 *
 *   check-in sheet (patient-register.js)  GET "/ward/abdm-desk", POST "/ward/abha"       ABHA verify / create panel
 *   Patients page (pages/patients.js)     GET "/ward/abdm-share", POST "/ward/abdm-share-register"   Scan and Share
 *   ward chart (ward.js, ABDM tab)        GET "/ward/abdm-records", POST "/ward/abdm-link-stay", "/ward/abdm-consent-request", "/ward/abdm-fetch"
 *   Admin > Integrations > ABDM (pages/abdm.js)  POST "/ward/abdm-registry-check"
 *
 * Loading, failed and not connected are three different screens: an unloaded state never looks like an empty or a
 * refused one. Markup builders are exercised directly; the ward chart is checked by source, as its view needs the whole app.
 *
 * node --test test/wardsynq-abdm-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enrolmentConsent } from "../functions/_connect/abdm/consent-text.js";
import { REASONS } from "../functions/_wardsynq/abdm-connect.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const HFR = "IN2810006668";

/* ---- the check-in sheet's ABHA panel ------------------------------------------------------------------------- */

function loadRegister() {
  const win = { document: { getElementById: () => null, createElement: () => ({ id: "", className: "" }), body: { appendChild() {} } } };
  win.window = win;
  new Function("window", "module", read("patient-register.js"))(win, { exports: {} });
  return win.SMD_PATIENTREG;
}

test("check-in ABHA panel: checking, failed and not connected are distinct; not connected says why and that a typed ABHA is not verified", () => {
  const panel = loadRegister()._abdmPanelHtml;
  assert.equal(panel(null), "", "no ABDM panel where the sheet was not opened for ABDM");
  const loading = panel({ st: null });
  assert.match(loading, /Checking whether this hospital is connected to ABDM/);
  const failed = panel({ st: false });
  assert.match(failed, /could not be checked\. An ABHA typed below is recorded as typed, not verified/);
  assert.notEqual(loading, failed);
  for (const code of ["not_set_up", "inactive", "not_linked", "suspended", "production_held", "bridge_not_configured"]) {
    const h = panel({ st: { connection: { connected: false, code }, canVerify: true, canCreate: true } });
    assert.match(h, /Not connected to ABDM\./);
    assert.ok(h.includes(REASONS[code].replace(/'/g, "&#39;")) || h.includes(REASONS[code]), `${code}: the server's reason, word for word`);
    assert.match(h, /recorded as typed, not verified/);
    assert.ok(!/data-a="abdm-(verify|create)"/.test(h), `${code}: no verify or create button when not connected`);
  }
});

test("check-in ABHA panel: connected offers Verify and Create per the role table; linkedTo warns; done shows the ABDM ABHA locked", () => {
  const panel = loadRegister()._abdmPanelHtml;
  const conn = { connected: true, code: "connected", env: "sandbox", hipId: HFR, hiuId: HFR };
  const both = panel({ st: { connection: conn, canVerify: true, canCreate: true } });
  assert.match(both, /Connected to ABDM/);
  assert.ok(both.includes(HFR));
  assert.match(both, /data-a="abdm-verify"/);
  assert.match(both, /data-a="abdm-create"/);
  const verifyOnly = panel({ st: { connection: conn, canVerify: true, canCreate: false } });
  assert.match(verifyOnly, /data-a="abdm-verify"/);
  assert.ok(!/data-a="abdm-create"/.test(verifyOnly));
  const createOnly = panel({ st: { connection: conn, canVerify: false, canCreate: true } });
  assert.ok(!/data-a="abdm-verify"/.test(createOnly));
  assert.match(createOnly, /data-a="abdm-create"/);
  const neither = panel({ st: { connection: conn, canVerify: false, canCreate: false } });
  assert.match(neither, /Your role cannot verify or create an ABHA here/);
  assert.ok(!/data-a="abdm-(verify|create)"/.test(neither));

  const linked = panel({ st: { connection: conn, canVerify: true, canCreate: true }, linkedTo: "MRN-00042" });
  assert.match(linked, /already belongs to patient <b lang="en">MRN-00042<\/b>/);
  assert.match(linked, /data-a="abdm-reset"/);
  assert.ok(!/abdm-verify|abdm-create/.test(linked), "no way forward but starting again");

  const done = panel({ st: { connection: conn, canVerify: true, canCreate: true }, done: "verified", profile: { abhaNumber: "91234567890123", abhaAddress: "ramesh@sbx" } });
  assert.match(done, /ABHA verified with ABDM/);
  assert.ok(done.includes("91-2345-6789-0123") && done.includes("ramesh@sbx"));
  assert.match(done, /cannot be edited here/);
  assert.match(panel({ st: { connection: conn }, done: "created", profile: { abhaNumber: "91234567890123" } }), /ABHA created with ABDM/);
  assert.match(panel({ st: { connection: conn }, done: "shared", profile: { abhaNumber: "91234567890123" } }), /shared by the patient through ABDM/);
  // A refusal from ABDM is shown, escaped.
  assert.match(panel({ st: { connection: conn, canVerify: true }, mode: "verify-id", err: "<b>Invalid LoginId</b>" }), /&lt;b&gt;Invalid LoginId&lt;\/b&gt;/);
});

test("check-in ABHA panel: ABDM's consent is shown as ABDM wrote it, with the non-Aadhaar clause and both attestations unticked", () => {
  const panel = loadRegister()._abdmPanelHtml;
  const conn = { connected: true, env: "sandbox", hipId: HFR };
  assert.match(panel({ st: { connection: conn, canCreate: true }, mode: "create-consent" }), /Loading ABDM's consent text/);
  const consent = enrolmentConsent({ flow: "aadhaar", workerName: "Nurse Asha", patientName: "Ramesh Kumar" });
  const h = panel({ st: { connection: conn, canCreate: true }, mode: "create-consent", consent });
  const box = (id) => (h.match(new RegExp(`<input type="checkbox" class="pr-abdmc" data-id="${id}"[^>]*>`)) || [""])[0];
  assert.match(box("aadhaar-auth"), /checked/);
  assert.ok(box("non-aadhaar-route") && !/checked/.test(box("non-aadhaar-route")), "published note 2: unchecked in the Aadhaar flow");
  for (const id of ["worker-explained", "beneficiary-agrees"]) assert.ok(box(id) && !/checked/.test(box(id)), `${id} is the act of agreeing, never pre-ticked`);
  assert.match(h, /lang="en"/, "the published text is not machine translated");
  assert.match(h, /I, Ramesh Kumar, have been explained/);
  assert.match(h, /data-a="abdm-consent"/);
});

/* ---- Patients page: Scan and Share ----------------------------------------------------------------------------- */

function loadSite(withQr) {
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "", origin: "https://wardsynq.example" }, { getItem: () => null, setItem() {}, removeItem() {} });
  if (withQr) win.qrcode = new Function(read("vendor/qrcode-generator.js") + "\nreturn qrcode;")();
  run(read("wardsynq/site/shell.js"));
  run(read("wardsynq/site/pages/patients.js"));
  return win.WSQ;
}

test("Scan and Share: loading, failed and not connected are distinct; not connected shows no QR and says why", () => {
  const WSQ = loadSite(true);
  const c = { esc: WSQ.esc };
  const html = WSQ._abdmShareHtml;
  assert.match(html(c, null), /Loading the counter QR codes/);
  const failed = html(c, { failed: true, message: "forbidden" });
  assert.match(failed, /could not be loaded: forbidden\. This is not the same as there being no shared profiles/);
  const off = html(c, { ok: true, connection: { connected: false, code: "suspended" }, counters: [], shares: [] });
  assert.match(off, /No QR code is shown: this hospital is not connected to ABDM/);
  assert.ok(off.includes(REASONS.suspended.replace(/'/g, "&#39;")));
  assert.ok(!/<svg/.test(off) && !/data-share-print/.test(off));
});

test("Scan and Share: connected draws one printable QR per counter, and lists today's shares with register or registered", () => {
  const WSQ = loadSite(true);
  const c = { esc: WSQ.esc };
  const url = (code) => `https://phrsbx.abdm.gov.in/share-profile?hip-id=${HFR}&counter-id=${code}`;
  const r = { ok: true, connection: { connected: true, code: "connected", hipId: HFR },
    counters: [{ counterId: "desk", departmentId: null, name: null, url: url("desk") }, { counterId: "dcard", departmentId: "dcard", name: "Cardiology", url: url("dcard") }],
    shares: [
      { ticketId: "t1", token: "C-001", department: "Cardiology", registered: false, name: "Ramesh Kumar", profile: { gender: "M", yearOfBirth: "1985" }, abhaProof: "p.s" },
      { ticketId: "t2", token: "D-002", department: null, registered: true, mrn: "MRN-7" },
      { ticketId: "t3", token: "D-003", registered: false, name: "", profile: null, profileUnreadable: true },
    ] };
  const h = html(c, r);
  function html(cc, rr) { return WSQ._abdmShareHtml(cc, rr); }
  assert.equal((h.match(/<svg/g) || []).length, 2, "one QR per counter");
  assert.equal((h.match(/data-share-print="/g) || []).length, 2);
  assert.match(h, /Registration desk/);
  assert.match(h, /Cardiology/);
  assert.match(h, /Counter code dcard/);
  assert.match(h, /data-share-register="t1"/);
  assert.match(h, /Registered as MRN-7/);
  assert.match(h, /The shared profile could not be read\. Register the patient by hand/);
  assert.ok(!/data-share-register="t3"/.test(h), "an unreadable profile is not offered as pre-filled");
  // Per-department numbering with no active department: said, not left blank.
  assert.match(html(c, { ok: true, connection: { connected: true }, counters: [], shares: [] }), /No counter can take a token/);
  assert.match(html(c, { ok: true, connection: { connected: true }, counters: [], shares: [] }), /No patient has shared a profile today/);
  // Without the QR encoder loaded the counter is still listed, never a broken image.
  const bare = loadSite(false);
  assert.ok(!/<svg/.test(bare._abdmShareHtml({ esc: bare.esc }, r)));
});

test("the site loads the QR encoder before the Patients page, and the build copies it", () => {
  const index = read("wardsynq/site/index.html");
  const qr = index.indexOf('src="/vendor/qrcode-generator.js');
  const patients = index.indexOf('src="/wardsynq/site/pages/patients.js');
  assert.ok(qr > 0 && patients > 0 && qr < patients, "vendor/qrcode-generator.js is loaded before pages/patients.js");
  assert.match(index, /pages\/patients\.js\?v=[^"]+/);
  const build = read("scripts/build-wardsynq-site.sh");
  assert.match(build, /cp "\$ROOT\/vendor\/qrcode-generator\.js" "\$OUT\/vendor\/qrcode-generator\.js"/);
  assert.match(read("wardsynq/site/pages/patients.js"), /"\/ward\/abdm-share-register"/);
});

/* ---- the ward chart and the admin card ------------------------------------------------------------------------ */

test("ward chart: the ABDM tab is in CHART_CATS, opens the abdmrecords view, and that view calls the four chart routes", () => {
  const src = read("ward.js");
  const cats = src.slice(src.indexOf("var CHART_CATS = ["), src.indexOf("var CHART_CATS = [") + 6000);
  assert.match(cats, /act: "abdmrecords"/, "reachable from the chart's tab list");
  assert.match(src, /cmd === "abdmrecords"\) \{ abdmRecordsOpen\(\); return; \}/);
  assert.match(src, /state\.view === "abdmrecords" \? abdmRecordsView\(state\)/);
  assert.match(src, /apiGet\("\/ward\/abdm-records\?orgId="/);
  for (const route of ["/ward/abdm-link-stay", "/ward/abdm-consent-request", "/ward/abdm-fetch"]) assert.ok(src.includes(`"${route}"`), route);
  // Loading, failed and the no-ABHA case are three different sentences in the view.
  const view = src.slice(src.indexOf("function abdmRecordsView(state)"), src.indexOf("function abdmRecordsOpen()"));
  assert.match(view, /d == null\) return h \+ .*ward\.abdm-loading/);
  assert.match(view, /d === false\) return h \+ .*ward\.abdm-load-failed/);
  assert.match(view, /This is not the same as there being nothing/);
  assert.match(view, /ward\.abdm-no-abha/);
  // The check-in sheet on the ward asks the desk routes.
  assert.ok(src.includes('"/ward/abdm-desk') && src.includes('"/ward/abha'));
});

test("Admin ABDM card: the registry buttons post to the registry check for the facility and for a doctor", () => {
  const src = read("wardsynq/site/pages/abdm.js");
  assert.match(src, /c\.api\("\/ward\/abdm-registry-check"/);
  assert.match(src, /registryCheck\(b, \{ target: "facility" \}\)/);
  assert.match(src, /registryCheck\(b, \{ target: "professional", identity: b\.getAttribute\("data-abdm-check-hpr"\) \}\)/);
  assert.match(src, /data-abdm-check="facility"/);
});
