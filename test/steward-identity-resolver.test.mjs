/* test/steward-identity-resolver.test.mjs — Wave 2: Universal Patient Identity.
 *
 * Covers steward-identity-resolver.js (mint, normalisation, carrier equivalence,
 * revocation, audit events, active context, offline cache), the smd-nfc.js read-back
 * verification + revokeTag integration, the smd-identity-scanner.js headless contract,
 * and the wardsynq "barcode" -> "wristband" alias.
 *
 * node --test test/steward-identity-resolver.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import R from "../steward-identity-resolver.js";
import SMD_NFC from "../smd-nfc.js";
import PatientIdentityScanner from "../smd-identity-scanner.js";
import { TAG_TYPES, assignTag } from "../wardsynq/wardsynq-identity-tag.js";

const GATE = readFileSync(new URL("../functions/_middleware.js", import.meta.url), "utf8");

/* ── mintStewardId ─────────────────────────────────────────────────────────── */
test("mintStewardId generates canonical SMD- + 6 Crockford chars", () => {
  for (let i = 0; i < 50; i++) {
    const id = R.mintStewardId();
    assert.match(id, /^SMD-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/, id);
    assert.ok(!/[ILOU]/.test(id.slice(4)), `no ambiguous chars in ${id}`);
  }
});

test("mintStewardId produces unique identifiers", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(R.mintStewardId());
  assert.equal(seen.size, 500);
});

/* ── normalisation ─────────────────────────────────────────────────────────── */
test("normalizeCarrierValue trims, upper-cases and strips redundant prefixes", () => {
  assert.equal(R.normalizeCarrierValue("  smd-ab12cd  "), "SMD-AB12CD");
  assert.equal(R.normalizeCarrierValue("mrn-12345"), "MRN-12345");
  assert.equal(R.normalizeCarrierValue("SMD:SMD-AB12CD"), "SMD-AB12CD");
  assert.equal(R.normalizeCarrierValue("UHID:MRN-9988"), "MRN-9988");
  assert.equal(R.normalizeCarrierValue("PATIENT:smd-zz11aa"), "SMD-ZZ11AA");
  assert.equal(R.normalizeCarrierValue(""), "");
  assert.equal(R.normalizeCarrierValue(null), "");
  assert.equal(R.normalizeCarrierValue({}), "");
});

test("normalizeCarrierValue extracts the id from deep links", () => {
  assert.equal(R.normalizeCarrierValue("https://stewardmd.in/opd?uid=SMD-AB12CD"), "SMD-AB12CD");
  assert.equal(R.normalizeCarrierValue("https://stewardmd.in/opd?patientId=SMD-AB12CD"), "SMD-AB12CD");
  assert.equal(R.normalizeCarrierValue("https://stewardmd.in/opd?scan=SMD-AB12CD"), "SMD-AB12CD");
  assert.equal(R.normalizeCarrierValue("https://stewardmd.in/opd?mrn=MRN-9988"), "MRN-9988");
  assert.equal(R.normalizeCarrierValue("https://stewardmd.in/opd?stewardId=SMD-XY88ZZ"), "SMD-XY88ZZ");
  assert.equal(R.normalizeCarrierValue("https://stewardmd.in/opd?uid=smd-lower1"), "SMD-LOWER1");
});

test("normalizeCarrierValue reads tag/scan objects ({ text, url, uid, value, code })", () => {
  assert.equal(R.normalizeCarrierValue({ text: "  smd-t1 " }), "SMD-T1");
  assert.equal(R.normalizeCarrierValue({ url: "https://stewardmd.in/opd?uid=SMD-U1" }), "SMD-U1");
  assert.equal(R.normalizeCarrierValue({ text: "", url: "https://stewardmd.in/opd?scan=SMD-S1", uid: "04A1" }), "SMD-S1");
  assert.equal(R.normalizeCarrierValue({ uid: "smd-raw9" }), "SMD-RAW9");
  assert.equal(R.normalizeCarrierValue({ value: "mrn-77" }), "MRN-77");
  assert.equal(R.normalizeCarrierValue({ code: "SMD:SMD-C1" }), "SMD-C1");
  assert.equal(R.normalizeCarrierValue({ text: "", url: "https://example.com/x" }), "", "a URL with no patient param is not an id");
});

/* ── carrier equivalence ───────────────────────────────────────────────────── */
test("areCarriersEquivalent: NFC, QR, barcode and manual naming one StewardID are equivalent", () => {
  R.reset();
  const sid = "SMD-EQTEST";
  for (const type of ["nfc", "qr", "barcode", "manual"]) {
    R.registerCarrier({ patientId: sid, stewardId: sid, type, value: sid, issuedBy: "test" });
  }
  const nfc = { type: "nfc", value: sid };
  const qr = { type: "qr", value: sid };
  const barcode = { type: "barcode", value: sid };
  assert.equal(R.areCarriersEquivalent(nfc, qr), true);
  assert.equal(R.areCarriersEquivalent(nfc, barcode), true);
  assert.equal(R.areCarriersEquivalent(qr, barcode), true);
  assert.equal(R.areCarriersEquivalent(nfc, sid), true, "bare manual value matches too");
  assert.equal(R.areCarriersEquivalent(`  ${sid.toLowerCase()} `, nfc), true, "case/whitespace insensitive");
});

test("areCarriersEquivalent: distinct values on one registry link via the same patient", () => {
  R.reset();
  R.registerCarrier({ patientId: "P1", stewardId: "SMD-P1AAAA", type: "nfc", value: "04A1B2", issuedBy: "test" });
  R.registerCarrier({ patientId: "P1", stewardId: "SMD-P1AAAA", type: "manual", value: "SMD-P1AAAA", issuedBy: "test" });
  assert.equal(R.areCarriersEquivalent({ type: "nfc", value: "04A1B2" }, { type: "manual", value: "SMD-P1AAAA" }), true);
});

test("areCarriersEquivalent returns false for distinct patients", () => {
  R.reset();
  R.registerCarrier({ patientId: "PA", stewardId: "SMD-AAAAAA", type: "nfc", value: "SMD-AAAAAA", issuedBy: "test" });
  R.registerCarrier({ patientId: "PB", stewardId: "SMD-BBBBBB", type: "qr", value: "SMD-BBBBBB", issuedBy: "test" });
  assert.equal(R.areCarriersEquivalent({ type: "nfc", value: "SMD-AAAAAA" }, { type: "qr", value: "SMD-BBBBBB" }), false);
  assert.equal(R.areCarriersEquivalent("SMD-AAAAAA", "SMD-BBBBBB"), false);
  assert.equal(R.areCarriersEquivalent("", "SMD-BBBBBB"), false);
});

/* ── revocation ────────────────────────────────────────────────────────────── */
test("an active carrier resolves successfully with the full result shape", () => {
  R.reset();
  const sid = "SMD-ACTIVE1";
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: sid, issuedBy: "frontdesk" });
  const res = R.resolvePatientIdentity(
    { type: "nfc", value: sid },
    { patientStore: { [sid]: { name: "Asha", stewardId: sid } } }
  );
  assert.equal(res.ok, true);
  assert.equal(res.stewardId, sid);
  assert.equal(res.patientId, sid);
  assert.equal(res.patient.name, "Asha");
  assert.equal(res.carrier.type, "nfc");
  assert.equal(res.carrier.normalized, sid);
  assert.equal(res.identityStatus, "verified");
  assert.equal(res.activeEncounter, null);
  assert.equal(res.activeAdmission, null);
  assert.equal(res.currentQueueTicket, null);
  assert.ok(res.context && typeof res.context === "object");
});

test("a revoked carrier resolves to CARRIER_REVOKED without touching the patient record", () => {
  R.reset();
  const sid = "SMD-REVOKED-1";
  const store = { [sid]: { name: "Ravi", stewardId: sid, mrn: "MRN-1" } };
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: sid, issuedBy: "frontdesk" });
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "qr", value: sid, issuedBy: "frontdesk" });
  const before = R.resolvePatientIdentity({ type: "nfc", value: sid }, { patientStore: store });
  assert.equal(before.ok, true);

  const revoked = R.revokeCarrier({ type: "nfc", value: sid, reason: "Lost card", revokedBy: "nurse-1" });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedReason, "Lost card");
  assert.equal(R.isCarrierRevoked({ type: "nfc", value: sid }), true);
  assert.equal(R.isCarrierRevoked({ type: "qr", value: sid }), false, "the QR carrier is untouched");

  const res = R.resolvePatientIdentity({ type: "nfc", value: sid }, { patientStore: store });
  assert.equal(res.ok, false);
  assert.equal(res.error, "CARRIER_REVOKED");
  assert.equal(res.reason, "Lost card");
  assert.ok(res.carrier);

  const bare = R.resolvePatientIdentity(sid, { patientStore: store });
  assert.equal(bare.ok, false, "a bare value fails closed against the revoked carrier");
  assert.equal(bare.error, "CARRIER_REVOKED");

  assert.deepEqual(store[sid], { name: "Ravi", stewardId: sid, mrn: "MRN-1" }, "patient record intact");
  const qr = R.resolvePatientIdentity({ type: "qr", value: sid }, { patientStore: store });
  assert.equal(qr.ok, true, "the surviving carrier still resolves the same patient");
  assert.equal(qr.patient.name, "Ravi");
  assert.deepEqual(R.getActiveCarriersForPatient(sid).map((c) => c.type), ["qr"]);
});

test("revocation can throw CarrierRevokedError when configured", () => {
  R.reset();
  R.registerCarrier({ patientId: "PX", stewardId: "SMD-THROW1", type: "nfc", value: "SMD-THROW1", issuedBy: "t" });
  R.revokeCarrier({ type: "nfc", value: "SMD-THROW1", reason: "stolen" });
  assert.throws(
    () => R.resolvePatientIdentity({ type: "nfc", value: "SMD-THROW1" }, { throwOnRevoked: true }),
    (e) => e.name === "CarrierRevokedError" && e.code === "CARRIER_REVOKED" && e.reason === "stolen"
  );
});

test("registerCarrier validates type and value", () => {
  R.reset();
  assert.throws(() => R.registerCarrier({ patientId: "P", type: "pigeon", value: "X" }), /carrier type/);
  assert.throws(() => R.registerCarrier({ patientId: "P", type: "nfc", value: "   " }), /value/);
  assert.throws(() => R.registerCarrier({ type: "nfc", value: "X" }), /patient/);
});

/* ── audit events ──────────────────────────────────────────────────────────── */
test("patient.identity.resolved is emitted with all audit fields", () => {
  R.reset();
  const events = [];
  const onEvt = (e) => events.push(e);
  R.on("patient.identity.resolved", onEvt);
  try {
    const sid = "SMD-EVENT01";
    R.registerCarrier({ patientId: sid, stewardId: sid, type: "qr", value: sid, issuedBy: "t" });
    R.resolvePatientIdentity(
      { type: "qr", value: sid },
      { patientStore: { [sid]: { name: "Meera" } }, actorId: "doc-7", context: { station: "doctor" } }
    );
    assert.equal(events.length, 1);
    const e = events[0];
    assert.equal(e.event, "patient.identity.resolved");
    assert.equal(e.stewardId, sid);
    assert.equal(e.patientId, sid);
    assert.equal(e.carrierType, "qr");
    assert.equal(e.carrierValue, sid);
    assert.equal(e.actorId, "doc-7");
    assert.ok(e.timestamp);
    assert.deepEqual(e.context, { station: "doctor" });
  } finally {
    R.off("patient.identity.resolved", onEvt);
  }
});

test("off() removes listeners; emit() to no listeners is safe", () => {
  let n = 0;
  const fn = () => { n++; };
  R.on("patient.identity.resolved", fn);
  R.off("patient.identity.resolved", fn);
  R.emit("patient.identity.resolved", {});
  assert.equal(n, 0);
});

/* ── active context ────────────────────────────────────────────────────────── */
test("resolution includes active encounter, admission and queue ticket", () => {
  R.reset();
  const sid = "SMD-CTX001";
  const enc = { id: "enc-1", type: "opd", status: "active" };
  const adm = { id: "adm-1", ward: "Ward A", bed: "B-12" };
  const tkt = { token: "T-014", status: "waiting" };
  const res = R.resolvePatientIdentity(
    { type: "manual", value: sid },
    { patientStore: { [sid]: { name: "Kiran", stewardId: sid, activeEncounter: enc, activeAdmission: adm, currentQueueTicket: tkt } } }
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.activeEncounter, enc);
  assert.deepEqual(res.activeAdmission, adm);
  assert.deepEqual(res.currentQueueTicket, tkt);
});

test("an unknown id resolves provisional with no patient, never throws", () => {
  R.reset();
  const res = R.resolvePatientIdentity("SMD-NOSUCH1", { patientStore: {} });
  assert.equal(res.ok, true);
  assert.equal(res.patient, null);
  assert.equal(res.identityStatus, "provisional");
  assert.equal(res.stewardId, "SMD-NOSUCH1");
});

test("patientStore accepts a Map, a lookup function, and async lookups", async () => {
  R.reset();
  const m = new Map([["SMD-MAP001", { name: "Map Patient" }]]);
  const r1 = R.resolvePatientIdentity("SMD-MAP001", { patientStore: m });
  assert.equal(r1.patient.name, "Map Patient");

  const r2 = R.resolvePatientIdentity("SMD-FN0001", {
    patientStore: (id) => (id === "SMD-FN0001" ? { name: "Fn Patient" } : null),
  });
  assert.equal(r2.patient.name, "Fn Patient");

  const r3 = await R.resolvePatientIdentity("SMD-ASYNC01", {
    patientStore: async (id) => ({ name: "Async " + id }),
  });
  assert.equal(r3.ok, true);
  assert.equal(r3.patient.name, "Async SMD-ASYNC01");
});

/* ── offline cache ─────────────────────────────────────────────────────────── */
test("resolution falls back to the offline cache when the provider throws", () => {
  R.reset();
  const sid = "SMD-OFFLINE";
  const first = R.resolvePatientIdentity(sid, {
    patientStore: { [sid]: { name: "Cached Patient", stewardId: sid } },
  });
  assert.equal(first.patient.name, "Cached Patient");

  const throwing = () => { throw new Error("network down"); };
  const res = R.resolvePatientIdentity(sid, { patientStore: throwing });
  assert.equal(res.ok, true);
  assert.equal(res.patient.name, "Cached Patient", "served from offline cache");
});

test("options.offline resolves purely from cache", () => {
  R.reset();
  const sid = "SMD-OFFL2NE";
  R.resolvePatientIdentity(sid, { patientStore: { [sid]: { name: "Offline Two" } } });
  const res = R.resolvePatientIdentity(sid, { patientStore: () => { throw new Error("down"); }, offline: true });
  assert.equal(res.ok, true);
  assert.equal(res.patient.name, "Offline Two");
});

/* ── smd-nfc.js read-back verification ─────────────────────────────────────── */
test("NFC write verifies read-back: match succeeds, mismatch fails, opt-out skips", async () => {
  class MockNDEFReader {
    async scan() { return Promise.resolve(); }
    async write() { return Promise.resolve(); }
  }
  globalThis.window = { NDEFReader: MockNDEFReader };
  try {
    const ok = await SMD_NFC.writeTag("SMD-RB-001", { simulatedReadBack: "SMD-RB-001" });
    assert.equal(ok.success, true);

    const plain = await SMD_NFC.writeTag("SMD-RB-002");
    assert.equal(plain.success, true, "no read-back channel passes (write success is the signal)");

    await assert.rejects(
      SMD_NFC.writeTag("SMD-RB-003", { simulatedReadBack: "SMD-DIFFERENT" }),
      /Read-back verification failed/
    );
    try {
      await SMD_NFC.writeTag("SMD-RB-003", { simulatedReadBack: "SMD-DIFFERENT" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "WRITE_VERIFICATION_FAILED");
    }
    const skipped = await SMD_NFC.writeTag("SMD-RB-004", { simulatedReadBack: "NOPE", verifyReadBack: false });
    assert.equal(skipped.success, true, "verifyReadBack:false skips the check");
  } finally {
    delete globalThis.window;
  }
});

test("NFC native write honours plugin verification echoes", async () => {
  let mode = "ok";
  globalThis.window = {
    Capacitor: {
      Plugins: {
        NfcPlugin: {
          writeTag: async (opts) => {
            if (mode === "verified-false") return { success: true, verified: false, ...opts };
            if (mode === "echo-mismatch") return { success: true, readBackText: "SOMETHING-ELSE", ...opts };
            return { success: true, ...opts };
          },
        },
      },
    },
  };
  try {
    const ok = await SMD_NFC.writeTag("SMD-NAT-1");
    assert.equal(ok.success, true);
    mode = "verified-false";
    await assert.rejects(SMD_NFC.writeTag("SMD-NAT-1"), (e) => e.code === "WRITE_VERIFICATION_FAILED");
    mode = "echo-mismatch";
    await assert.rejects(SMD_NFC.writeTag("SMD-NAT-1"), (e) => e.code === "WRITE_VERIFICATION_FAILED");
    mode = "ok";
  } finally {
    delete globalThis.window;
  }
});

test("SMD_NFC.revokeTag revokes the NFC carrier through the resolver", () => {
  R.reset();
  assert.equal(typeof SMD_NFC.revokeTag, "function");
  R.registerCarrier({ patientId: "P9", stewardId: "SMD-TAG9X1", type: "nfc", value: "SMD-TAG9X1", issuedBy: "t" });
  const c = SMD_NFC.revokeTag("SMD-TAG9X1", { reason: "Lost card", revokedBy: "nurse-2" });
  assert.equal(c.status, "revoked");
  assert.equal(R.isCarrierRevoked({ type: "nfc", value: "SMD-TAG9X1" }), true);
  const res = R.resolvePatientIdentity({ type: "nfc", value: "SMD-TAG9X1" });
  assert.equal(res.error, "CARRIER_REVOKED");
});

test("initAppListener passes taps through the resolver when loaded", async () => {
  R.reset();
  const sid = "SMD-APP-L1";
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "nfc", value: sid, issuedBy: "t" });
  let listenerCb = null;
  globalThis.window = {
    Capacitor: {
      Plugins: {
        NfcPlugin: {
          startScan: async () => ({ status: "listening" }),
          stopScan: async () => ({ status: "stopped" }),
          addListener: async (evt, cb) => {
            if (evt === "tagDiscovered") listenerCb = cb;
            return { remove: () => { listenerCb = null; } };
          },
        },
      },
    },
  };
  try {
    const seen = [];
    await SMD_NFC.initAppListener({
      onUhid: (u, tag, identity) => { seen.push([u, identity]); },
      onEmpty: () => {},
      identityOptions: { patientStore: { [sid]: { name: "App Tap" } } },
    });
    assert.ok(listenerCb);
    listenerCb({ uid: "04A1", text: sid, url: "" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], sid);
    assert.equal(seen[0][1].ok, true, "third arg carries the resolved identity");
    assert.equal(seen[0][1].patient.name, "App Tap");
  } finally {
    await SMD_NFC.stopScan();
    delete globalThis.window;
  }
});

/* ── scanner headless contract ─────────────────────────────────────────────── */
test("PatientIdentityScanner.create works headless with station-specific actions", () => {
  const s = PatientIdentityScanner.create({ station: "nurse" });
  assert.equal(s.station, "nurse");
  assert.equal(s.showActionSheet, true);
  assert.equal(s.isMounted(), false);
  assert.equal(s.mount("#nope"), null, "no DOM: mount degrades to null");
  assert.equal(s.renderActionSheet({ ok: true }), null, "no DOM: sheet degrades to null");
  assert.deepEqual(
    PatientIdentityScanner.STATION_ACTIONS.doctor.map((a) => a.label),
    ["View Profile", "Start Consultation", "Start Follow-up"]
  );
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.nurse.map((a) => a.label), ["Record Vitals", "Triage"]);
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.billing.map((a) => a.label), ["Review & Bill"]);
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.pharmacy.map((a) => a.label), ["Dispense Order"]);
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.ward.map((a) => a.label), ["Bedside 5-Rights Verify"]);
  assert.deepEqual(PatientIdentityScanner.STATION_ACTIONS.frontdesk.map((a) => a.label), ["Add to Queue", "Check-in"]);
  s.destroy();
});

test("scanner resolves manual input through the resolver and fires callbacks", () => {
  R.reset();
  const sid = R.mintStewardId();
  R.registerCarrier({ patientId: sid, stewardId: sid, type: "manual", value: sid, issuedBy: "t" });
  const got = [];
  const errs = [];
  const s = new PatientIdentityScanner({
    station: "doctor",
    showActionSheet: false,
    resolverOptions: { patientStore: { [sid]: { name: "Scan Me", stewardId: sid } } },
    onResolved: (r) => got.push(r),
    onError: (e) => errs.push(e),
    onCancel: () => got.push("cancelled"),
  });
  const res = s.resolveManual(`  ${sid.toLowerCase()} `);
  assert.equal(res.ok, true);
  assert.equal(got.length, 1);
  assert.equal(got[0].patient.name, "Scan Me");
  assert.equal(s.lastResolved().stewardId, sid);
  s.cancel();
  assert.equal(got[1], "cancelled");

  const bad = s.resolveManual("   ");
  assert.equal(bad.ok, false);
  assert.equal(errs.length, 1, "empty input fires onError");
  s.destroy();
});

test("scanner startTapScan degrades gracefully without NFC", () => {
  delete globalThis.window;
  const s = PatientIdentityScanner.create({ station: "ward" });
  assert.equal(s.startTapScan(), null);
  assert.equal(s.isListening(), false);
  s.destroy();
});

/* ── wardsynq barcode alias + middleware gate ──────────────────────────────── */
test("TAG_TYPES stays frozen while assignTag aliases barcode to wristband", () => {
  assert.deepEqual(TAG_TYPES, ["wristband", "qr", "nfc"]);
  const t = assignTag({ patientId: "p1", tagType: "barcode", code: "B-100", assignedBy: "n1" });
  assert.equal(t.tagType, "wristband");
  assert.equal(t.status, "active");
});

test("the middleware pass-through covers the Wave 2 client scripts", () => {
  assert.match(GATE, /url\.pathname === "\/steward-identity-resolver\.js"/);
  assert.match(GATE, /url\.pathname === "\/smd-identity-scanner\.js"/);
});
