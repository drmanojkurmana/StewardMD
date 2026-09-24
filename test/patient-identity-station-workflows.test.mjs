/* test/patient-identity-station-workflows.test.mjs — Wave 3: Universal Patient Identity
 * across stations (StewardID 2.0 / Ni-Key).
 *
 *   1. Front desk: registration mints a canonical StewardID; the done card shows it next to
 *      the MRN and issues the full identity package (Ni-Key write with read-back
 *      verification + file label); duplicates warn with StewardID/MRN/phone.
 *   2. Doctor desk: a scan offers View Profile / Start Consultation / Follow-up Consult, and
 *      a follow-up links parentEncounterId instead of overwriting history.
 *   3. Nurse triage: a scan routes to vitals pre-linked to patient + encounter, with no
 *      doctor actions on the nurse sheet.
 *   4. Billing/pharmacy: review resolves the canonical identity (no duplicate accounts);
 *      dispense records dispensedBy/dispensedAt, distinct from bedside administeredBy.
 *   5. Bedside (IPD): a revoked carrier is refused before any server call; OPD+IPD
 *      ambiguity asks which episode the act belongs to.
 *
 * Where a surface needs a real DOM it is covered by source assertions here plus the
 * headless-browser harness (test/run-nfc-ui.mjs proves patient-register + opd.html load and
 * behave; ward/EMR sheets are exercised headlessly before merge). What CAN run in Node
 * runs here behaviorally: the real resolver, scanner, NFC bridge, EMR openProfile/_render,
 * ward _bedside helpers, and the register done card.
 *
 * node --test test/patient-identity-station-workflows.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import R from "../steward-identity-resolver.js";
import PatientIdentityScanner from "../smd-identity-scanner.js";
import SMD_NFC from "../smd-nfc.js";

const REG_SRC = readFileSync(new URL("../patient-register.js", import.meta.url), "utf8");
const OPD = readFileSync(new URL("../opd.html", import.meta.url), "utf8");
const BILL = readFileSync(new URL("../clinic-billing.html", import.meta.url), "utf8");
const WARD_SRC = readFileSync(new URL("../ward.js", import.meta.url), "utf8");
const EMR_SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
const STORE_SRC = readFileSync(new URL("../functions/_clinic_billing_store.js", import.meta.url), "utf8");

/* ── loaders ─────────────────────────────────────────────────────────────── */

/* patient-register.js is a window IIFE: it needs a window with a document at load. The pure
 * card builders (_doneHtml/_sheetHtml) then run with no further DOM. */
const regWindow = { document: {} };
globalThis.window = regWindow;
const REG = (await import("../patient-register.js")).default;
delete globalThis.window;

function loadEmr() {
  const mkEl = () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    _h: "", set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; },
  });
  const rootEl = mkEl();
  const win = { SMD_QUEUE_FLAGS: { bool: (k) => k === "smd_opd_emr" } };
  const doc = {
    getElementById: (id) => (id === "smdOpdEmr" ? rootEl : null),
    createElement: () => mkEl(), body: { appendChild() {} },
    addEventListener() {}, querySelectorAll: () => [],
  };
  new Function("window", "document", "location", "localStorage", EMR_SRC)(
    win, doc, { search: "", hostname: "" }, { getItem: () => null, setItem() {} }
  );
  return win.OPDEMR;
}

function loadWardBedside(doc) {
  const win = { StewardIdentityResolver: R };
  doc = doc || {
    getElementById: () => null,
    createElement: () => ({ classList: { add() {}, remove() {} } }),
    body: { appendChild() {} },
  };
  new Function("window", "document", "location", "localStorage", WARD_SRC)(
    win, doc, { search: "" }, { getItem: () => null, setItem() {} }
  );
  return win.WARD._bedside;
}

/* ── 1. front desk: mint, done card, duplicate warning ────────────────────── */

test("registration never mints a StewardID on the device: the server mints and reserves it", () => {
  // 2026-09-24: a device-minted ID was unique only within its tab and the server dropped it.
  assert.doesNotMatch(REG_SRC, /mintStewardId\(\)/);
  assert.doesNotMatch(REG_SRC, /stewardId: state\.stewardId \|\| ""/, "the payload no longer carries a device-made ID");
});

test("done card shows single canonical StewardID with Ni-Key write + file label", () => {
  regWindow.openFileLabel = () => {};
  const html = REG._doneHtml({ mrn: "MRN-42", stewardId: "SMD-ABC123", name: "Asha" });
  assert.match(html, /<p class="pr-mrlabel">StewardID<\/p>/);
  assert.match(html, /<p class="pr-mr">SMD-ABC123<\/p>/);
  assert.match(html, /id="prWriteNfc" data-a="write-nfc"/);
  assert.match(html, /data-sid="SMD-ABC123"/);
  assert.match(html, /Write Ni-Key NFC Tag/);
  assert.match(html, /data-a="print-label"/);
  delete regWindow.openFileLabel;
});

test("done card without a StewardID renders exactly as before", () => {
  const html = REG._doneHtml({ mrn: "MRN-42", name: "Asha" });
  assert.match(html, /MR number/);
  assert.ok(!html.includes("StewardID"), "no StewardID line for pre-identity records");
  assert.match(html, /<p class="pr-mr">MRN-42<\/p>/);
  assert.match(html, /id="prWriteNfc" data-a="write-nfc"/, "the NFC write still offered (MRN fallback)");
  assert.ok(!html.includes("data-sid="), "no empty steward id stamped on the button");
});

test("done card passes (mrn, stewardId) to the file label", () => {
  assert.match(REG_SRC, /root\.openFileLabel\(state\.doneMrn, state\.doneStewardId\)/);
});

test("Ni-Key write carries stewardId-or-mrn with read-back verification", async () => {
  assert.match(REG_SRC, /text: sid \|\| mrn, url: "https:\/\/stewardmd\.in\/opd\?uid=" \+ encodeURIComponent\(sid \|\| mrn\) \}, \{ verifyReadBack: true \}/);
  // The exact call the done card makes, against the real bridge.
  class MockNDEFReader {
    async write() { return Promise.resolve(); }
  }
  globalThis.window = { NDEFReader: MockNDEFReader };
  try {
    const sid = R.mintStewardId();
    const ok = await SMD_NFC.writeTag(
      { text: sid, url: "https://stewardmd.in/opd?uid=" + sid },
      { verifyReadBack: true, simulatedReadBack: sid }
    );
    assert.equal(ok.success, true);
    await assert.rejects(
      SMD_NFC.writeTag({ text: sid, url: "" }, { verifyReadBack: true, simulatedReadBack: "WRONG" }),
      (e) => e.code === "WRITE_VERIFICATION_FAILED"
    );
  } finally {
    delete globalThis.window;
  }
});

test("duplicate banner names StewardID, MRN and phone", () => {
  assert.match(REG_SRC, /dup\.stewardId \? "StewardID " \+ dup\.stewardId/);
  assert.match(REG_SRC, /pr-dupids/);
  assert.match(REG_SRC, /var who = dup\.mrn \|\| dup\.stewardId \|\| dup\.mobile/);
});

test("Ni-Key read resolves through the resolver, prefills, and is a follow-up", () => {
  assert.match(REG_SRC, /StewardIdentityResolver\.resolvePatientIdentity\(\{ type: "nfc", value: uhid \}\)/);
  assert.match(REG_SRC, /state\.stewardId = hit\.stewardId \|\| uhid/);
  assert.match(REG_SRC, /CARRIER REVOKED: This tag was marked lost or deactivated\. Please issue a replacement card\./);
});

/* ── 2. doctor desk: context-aware scan sheet + follow-up linkage ─────────── */

test("opd.html loads the Wave 2 identity scripts", () => {
  assert.match(OPD, /<script src="\/steward-identity-resolver\.js\?v=[^"]+"><\/script>/);
  assert.match(OPD, /<script src="\/smd-identity-scanner\.js\?v=[^"]+"><\/script>/);
});

test("handleScannedUid resolves the carrier and refuses revoked tags first", () => {
  assert.match(OPD, /StewardIdentityResolver\.resolvePatientIdentity\(uid,\{role:role,hospital:st\.hospital,orgId:org,patientStore:boardPatientStore\}\)/);
  assert.match(OPD, /CARRIER REVOKED: This tag was marked lost or deactivated\. Please issue a replacement card\./);
  assert.match(OPD, /function boardPatientStore\(id\)/);
  assert.match(OPD, /activeEncounter:\{ type:"opd"/);
});

test("doctor scan sheet: summary + Start Consultation / View Profile / Follow-up Consult", () => {
  assert.match(OPD, /if\(role==="doctor"\|\|isRoomDoctor\(hit\)\)\{ openDoctorScanSheet\(hit,nm,stewardId,identity\); return; \}/);
  assert.match(OPD, /function openDoctorScanSheet\(hit,nm,stewardId,identity\)/);
  assert.match(OPD, /Status: <b>'\+esc\(status\)/);
  assert.match(OPD, /id="dsStart"[^>]*>Start Consultation</);
  assert.match(OPD, /id="dsProfile"[^>]*>View Profile</);
  assert.match(OPD, /id="dsFollow"[^>]*>Follow-up Consult</);
  assert.match(OPD, /OPDEMR\.openProfile\(\{patientId:pid,stewardId:sid\|\|pid,mrn:pid,name:nm\}\)/);
  assert.match(OPD, /OPDEMR\.openProfile\(\{patientId:pid,stewardId:sid\|\|pid,mrn:pid,name:nm,isFollowUp:true,parentEncounterId:t\.encounterId\|\|t\.episodeId\|\|hit\.tid\}\)/);
});

test("an in-consultation ticket still opens the chart, not the sheet", () => {
  const consultIdx = OPD.indexOf('openNotes(hit.sid,hit.tid,nm)');
  const sheetIdx = OPD.indexOf('openDoctorScanSheet(hit,nm,stewardId,identity)');
  assert.ok(consultIdx > -1 && sheetIdx > -1 && consultIdx < sheetIdx,
    "the active-consultation branch precedes the doctor sheet");
});

test("openProfile stores stewardId + follow-up linkage (behavioral)", () => {
  const E = loadEmr();
  E.openProfile({ patientId: "MR100", stewardId: "SMD-FU0001", name: "Asha", isFollowUp: true, parentEncounterId: "enc-9", noStore: true, tab: "assess" });
  const st = E._state();
  assert.equal(st.patient.mrn, "MR100");
  assert.equal(st.patient.stewardId, "SMD-FU0001");
  assert.equal(st.isFollowUp, true);
  assert.equal(st.parentEncounterId, "enc-9");
  assert.equal(E._followUpLink(), "enc-9");
  const html = E._render(st);
  assert.match(html, /SMD-FU0001/);
  assert.match(html, /Follow-up/);
});

test("openProfile without identity fields renders exactly as before", () => {
  const E = loadEmr();
  E.openProfile({ patientId: "MR101", name: "Ravi", noStore: true });
  const st = E._state();
  assert.equal(st.patient.stewardId, "MR101", "stewardId falls back to the patient id");
  assert.equal(st.isFollowUp, false);
  assert.equal(st.parentEncounterId, null);
  assert.equal(E._followUpLink(), "");
  assert.ok(!E._render(st).includes("StewardID"), "no StewardID span when it is the MRN itself");
});

test("the consultation note payload carries parentEncounterId on follow-ups", () => {
  assert.match(EMR_SRC, /function followUpLink\(\) \{ return \(st\.isFollowUp && st\.parentEncounterId\) \? st\.parentEncounterId : "";/);
  assert.match(EMR_SRC, /if \(followUpLink\(\)\) _body\.parentEncounterId = followUpLink\(\);/);
  assert.match(EMR_SRC, /if \(followUpLink\(\)\) _meta\.parentEncounterId = followUpLink\(\);/);
  assert.match(EMR_SRC, /if \(followUpLink\(\)\) extra\.parentEncounterId = followUpLink\(\);/);
});

/* ── 3. nurse triage: vitals, pre-linked, nothing else ────────────────────── */

test("nurse-role scans open vitals with the ticket link", () => {
  assert.match(OPD, /if\(role==="nurse"\|\|role==="intern"\|\|role==="resident"\|\|role==="reception"\)\{ openVitals\(hit\.sid,hit\.tid,nm\); return; \}/);
  assert.match(OPD, /function openVitals\(sid,tid,name\)/);
  assert.match(OPD, /post\("timeline",\{sessionId:sid,ticketId:tid,kind:"vitals"/);
});

test("the nurse scanner sheet offers vitals actions only (behavioral)", () => {
  R.reset();
  const sid = R.mintStewardId();
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "qr", value: sid, issuedBy: "t" });
  const enc = { id: "enc-3", type: "opd", department: "General Medicine" };
  const seen = [];
  const s = PatientIdentityScanner.create({
    station: "nurse",
    showActionSheet: false,
    resolverOptions: { patientStore: { [sid]: { name: "Triage Me", stewardId: sid, activeEncounter: enc } } },
    onResolved: (r) => seen.push(r),
  });
  const res = s.resolveManual(sid);
  assert.equal(res.ok, true);
  assert.equal(res.patientId, sid);
  assert.deepEqual(res.activeEncounter, enc, "the vitals entry is pre-linked to the encounter");
  assert.equal(seen.length, 1);
  const nurseIds = PatientIdentityScanner.STATION_ACTIONS.nurse.map((a) => a.id);
  assert.deepEqual(nurseIds, ["record-vitals", "triage"]);
  assert.ok(!nurseIds.includes("view-profile") && !nurseIds.includes("start-consultation") &&
    !nurseIds.includes("start-followup"), "no doctor actions leak onto the nurse sheet");
  s.destroy();
});

/* ── 4. billing + pharmacy ────────────────────────────────────────────────── */

test("clinic-billing.html loads the Wave 2 identity scripts", () => {
  assert.match(BILL, /<script src="\/steward-identity-resolver\.js\?v=[^"]+"><\/script>/);
  assert.match(BILL, /<script src="\/smd-identity-scanner\.js\?v=[^"]+"><\/script>/);
});

test("reviewPatient resolves the canonical identity and refuses revoked tags", () => {
  assert.match(BILL, /StewardIdentityResolver\.resolvePatientIdentity\(uid, \{ station: STATION, orgId: orgId \}\)/);
  assert.match(BILL, /This tag was marked lost or deactivated\. Please issue a replacement card\./);
  assert.match(BILL, /uid = res\.patientId \|\| uid;/);
  assert.match(BILL, /lookupView\(uid\);\s*\n?\s*loadPatient\(uid\);/, "the review still funnels through one lookup");
});

test("the dispense call is tagged with patientId + encounterId", () => {
  assert.match(BILL, /data-pat="'\+esc\(o\.patientId/);
  assert.match(BILL, /data-enc="'\+esc\(o\.encounterId\|\|o\.ticketId/);
  assert.match(BILL, /body:\{ orgId:orgId, orderId:b\.getAttribute\("data-disp"\), patientId:b\.getAttribute\("data-pat"\)\|\|"", encounterId:b\.getAttribute\("data-enc"\)\|\|"" \}/);
  assert.match(BILL, /That order belongs to a different patient\. Nothing was dispensed\./);
});

test("the server records dispensedBy/dispensedAt and refuses wrong-patient rows", () => {
  assert.match(STORE_SRC, /status: "dispensed", dispensedAt: Date\.now\(\), dispensedBy: actor \|\| ""/);
  assert.match(STORE_SRC, /claimedPatient !== String\(o\.patientId\)/);
  assert.match(STORE_SRC, /error: "patient_mismatch"/);
  assert.ok(!/administeredBy\s*:/.test(STORE_SRC),
    "clinic billing never writes administeredBy: dispense (pharmacy handover) stays distinct from bedside administration");
});

/* ── 5. bedside (IPD): revoked refusal + episode disambiguation ───────────── */

test("bedside normalisation reduces any carrier payload to its canonical id", () => {
  const B = loadWardBedside();
  assert.equal(B.normalize("https://stewardmd.in/opd?uid=smd-ab12cd"), "SMD-AB12CD");
  assert.equal(B.normalize("  band-7 "), "BAND-7");
});

test("a revoked carrier is refused with the spoken reason (behavioral)", () => {
  R.reset();
  const B = loadWardBedside();
  R.registerCarrier({ patientId: "P1", stewardId: "SMD-BED001", type: "wristband", value: "BAND-1", issuedBy: "t" });
  assert.equal(B.revoked("wristband", "BAND-1"), false);
  R.revokeCarrier({ type: "wristband", value: "BAND-1", reason: "reported lost" });
  assert.equal(B.revoked("wristband", "band-1"), true, "normalised before the check");
  assert.equal(B.revoked("", "BAND-1"), true, "a typeless check fails closed too");
  assert.equal(B.revokedError(), "Scanned tag has been deactivated or reported lost");
  const res = R.resolvePatientIdentity({ type: "wristband", value: "BAND-1" });
  assert.equal(res.ok, false);
  assert.equal(res.error, "CARRIER_REVOKED");
});

test("all three bedside dialogs refuse a revoked carrier before any server call", () => {
  const tagVerify = /var code = val\("wTgScan"\);[\s\S]{0,400}?if \(carrierRevoked\("wristband", normCarrierValue\(code\)\)\) \{ st\.err = revokedErr\(\); paint\(\); return; \}/;
  assert.match(WARD_SRC, tagVerify);
  assert.match(WARD_SRC, /if \(carrierRevoked\("wristband", normCarrierValue\(wristband\)\)\) \{ st\.err = revokedErr\(\); paint\(\); return; \}/);
  assert.match(WARD_SRC, /if \(_scanCode && carrierRevoked\("", normCarrierValue\(_scanCode\)\)\) \{ st\.err = revokedErr\(\); paint\(\); return; \}/);
  assert.match(WARD_SRC, /body\.scan = \{ patient: val\("wScanP"\), drug: val\("wScanD"\) \};/,
    "the scans themselves still travel to the server verbatim");
});

test("single-context bedside acts proceed with nothing attached (behavioral)", async () => {
  R.reset();
  const B = loadWardBedside();
  R.registerCarrier({ patientId: "P1", stewardId: "SMD-CTX001", type: "wristband", value: "BAND-9", issuedBy: "t" });
  const got = await new Promise((resolve) => B.maybeAsk("BAND-9", { ward: "Ward 3", bed: "Bed 24" }, (c, w) => resolve([c, w])));
  assert.deepEqual(got, [null, ""], "IPD-only: no question, nothing attached");
});

test("OPD + IPD ambiguity asks which episode the act belongs to (behavioral)", async () => {
  R.reset();
  const sid = "SMD-BOTH001";
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "wristband", value: "BAND-2", issuedBy: "t" });
  // The sheet needs a DOM: load ward with a minimal fake and click IPD.
  const fakeDoc = {
    _ov: null,
    getElementById(id) { return id === "wBedsideCtx" ? this._ov : null; },
    createElement() {
      return {
        style: {}, kids: [], _t: "",
        setAttribute() {}, appendChild(c) { this.kids.push(c); },
        set textContent(v) { this._t = v; }, get textContent() { return this._t; },
        set id(v) { this._id = v; }, get id() { return this._id; },
      };
    },
    body: { appendChild(n) { fakeDoc._ov = n; } },
  };
  const B = loadWardBedside(fakeDoc);
  assert.equal(B.episodeWords("opd", { department: "General Medicine" }, null), "OPD - General Medicine");
  assert.equal(B.episodeWords("ipd", null, { ward: "Ward 3", bed: "Bed 24" }), "IPD - Ward 3 / Bed 24");
  let picked = "unresolved";
  B.askContext({ department: "General Medicine" }, { ward: "Ward 3", bed: "Bed 24" }, (c) => { picked = c; });
  const ov = fakeDoc._ov;
  assert.ok(ov, "the sheet mounted");
  const buttons = [];
  const walk = (n) => { (n.kids || []).forEach((k) => { buttons.push(k); walk(k); }); };
  walk(ov);
  const texts = buttons.map((b) => b._t).filter(Boolean);
  assert.ok(texts.includes("Where do you want to work?"), `prompt shown (saw ${JSON.stringify(texts)})`);
  assert.ok(texts.includes("OPD - General Medicine"), `OPD choice shown (saw ${JSON.stringify(texts)})`);
  assert.ok(texts.includes("IPD - Ward 3 / Bed 24"), `IPD choice shown (saw ${JSON.stringify(texts)})`);
  const ipdBtn = buttons.find((b) => b._t === "IPD - Ward 3 / Bed 24");
  ipdBtn.onclick();
  assert.equal(picked, "ipd");
});

test("the ward tag verdict can carry the chosen episode", () => {
  assert.match(WARD_SRC, /st\.tagVerify\.episode = choice; st\.tagVerify\.episodeWords = words/);
  assert.match(WARD_SRC, /v\.episode && v\.episodeWords \? "<p>" \+ esc\(v\.episodeWords\)/);
});

test("opd toolbar carries a Scan button wired to openOpdScanner", () => {
  assert.match(OPD, /id="opdScanBtn"/);
  assert.match(OPD, /openOpdScanner/);
  assert.match(OPD, /window\.openOpdScanner=openOpdScanner/);
});

test("patient registration sheet carries both Ni-Key NFC and Scan QR buttons", () => {
  assert.match(REG_SRC, /data-a="read-nfc"/);
  assert.match(REG_SRC, /data-a="scan-qr"/);
  assert.match(REG_SRC, /applyResolvedIdentity/);
});

test("index.html routes incoming deep links on boot and appUrlOpen to the patient", () => {
  const INDEX = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(INDEX, /checkUrlScanOnBoot/);
  assert.match(INDEX, /window\.SMD_handleScanUid = onNfcUhid/);
});
