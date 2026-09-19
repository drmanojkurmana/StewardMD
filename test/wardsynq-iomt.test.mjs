/* test/wardsynq-iomt.test.mjs — HAZ-DEV-01, device telemetry.
 *
 * Two hazards, and the tests weight them accordingly. A noisy reading driving a score is bad; a good
 * reading landing on the wrong patient's chart is worse, because it is silent and plausible. Most of
 * what follows tries to get an unattributed or misattributed reading into a chart.
 *
 * node --test test/wardsynq-iomt.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DeviceGateway, DeviceGatewayError, scoreable, SQI_FLOOR } from "../wardsynq/wardsynq-iomt.js";
import { ClinicalEventBus } from "../wardsynq/wardsynq-events.js";
import { Patient } from "../wardsynq/wardsynq-model.js";

function clock(startIso) {
  let t = Date.parse(startIso);
  return { now: () => new Date(t).toISOString(), advance: (s) => { t += s * 1000; } };
}

const patientOf = (over) => Patient({ mrn: "GH-5", name: "Test Patient", dob: "1965-03-03", wristbandBarcode: "GH-5", ...over });
const deviceOf = (over) => ({ deviceId: "MON-04", assetTag: "AT-9911", kind: "bedside-monitor", ...over });

function gw(over) {
  const c = (over && over.clock) || clock("2026-09-04T10:00:00.000Z");
  return { g: new DeviceGateway({ now: c.now, ...(over || {}) }), clock: c };
}

async function bound(g, p = patientOf(), d = deviceOf()) {
  await g.associate({ device: d, patient: p, scannedWristband: "GH-5", scannedAssetTag: "AT-9911", actorId: "nurse-1" });
  return { p, d };
}

const hr = (over) => ({ deviceId: "MON-04", code: "8867-4", value: 82, unit: "/min", signalQualityIndex: 97, ...over });

/* ------------------------------------------------------------------ ADVERSARIAL: attribution */

test("ADVERSARIAL: a reading from an unassociated device is REFUSED, not queued or guessed", async () => {
  const { g } = gw();
  await assert.rejects(() => g.ingest(hr()), (e) => {
    assert.equal(e.code, "NOT_ASSOCIATED");
    return true;
  }, "an unattributed reading is not a reading with a missing field, it is a number belonging to somebody unknown");
});

test("ADVERSARIAL: association requires BOTH scans, not a bed number", async () => {
  const { g } = gw();
  const p = patientOf(), d = deviceOf();
  await assert.rejects(() => g.associate({ device: d, patient: p, scannedAssetTag: "AT-9911", actorId: "nurse-1" }),
    (e) => { assert.equal(e.code, "WRISTBAND_MISMATCH"); return true; });
  await assert.rejects(() => g.associate({ device: d, patient: p, scannedWristband: "GH-5", actorId: "nurse-1" }),
    (e) => { assert.equal(e.code, "ASSET_TAG_MISMATCH"); return true; });
  await assert.rejects(() => g.associate({ device: d, patient: p, scannedWristband: "GH-9", scannedAssetTag: "AT-9911", actorId: "nurse-1" }),
    (e) => { assert.equal(e.code, "WRISTBAND_MISMATCH"); return true; });
  await assert.rejects(() => g.associate({ device: d, patient: p, scannedWristband: "GH-5", scannedAssetTag: "AT-0000", actorId: "nurse-1" }),
    (e) => { assert.equal(e.code, "ASSET_TAG_MISMATCH"); return true; });
});

test("ADVERSARIAL: moving a monitor to another bed does not keep charting to the old patient", async () => {
  const bus = new ClinicalEventBus();
  const dissociated = [];
  bus.on("device.dissociated", (e) => dissociated.push(e.payload.association));
  const { g } = gw({ bus });

  const first = patientOf({ mrn: "GH-5", wristbandBarcode: "GH-5" });
  await bound(g, first);
  const a = await g.ingest(hr());
  assert.equal(a.patientId, first.id);

  // The monitor is wheeled to the next bed and re-associated.
  const second = patientOf({ mrn: "GH-6", wristbandBarcode: "GH-6" });
  await g.associate({ device: deviceOf(), patient: second, scannedWristband: "GH-6", scannedAssetTag: "AT-9911", actorId: "nurse-2" });
  const b = await g.ingest(hr());

  assert.equal(b.patientId, second.id, "readings follow the new association");
  assert.notEqual(b.patientId, first.id);
  assert.equal(dissociated.length, 1, "and the previous claim is explicitly ended, so no chart has two live claims");
  assert.equal(dissociated[0].endedBecause, "device re-associated to another patient");
});

test("ADVERSARIAL: after dissociation, readings are refused again rather than continuing quietly", async () => {
  const { g } = gw();
  await bound(g);
  await g.ingest(hr());
  await g.dissociate("MON-04", "nurse-1", "patient discharged");
  await assert.rejects(() => g.ingest(hr()), (e) => { assert.equal(e.code, "NOT_ASSOCIATED"); return true; });
});

test("ADVERSARIAL: a reading cannot name its own patient", async () => {
  const { g } = gw();
  const { p } = await bound(g);
  const obs = await g.ingest(hr({ patientId: "someone-else", patientMrn: "GH-999" }));
  assert.equal(obs.patientId, p.id, "attribution comes from the association, never from the payload");
});

/* ------------------------------------------------------------------ ADVERSARIAL: quality */

test("ADVERSARIAL: a device cannot assert that its own data is clean", async () => {
  const { g } = gw();
  await bound(g);
  const obs = await g.ingest(hr({ signalQualityIndex: 30, artifact: false, scoreEligible: true }));
  assert.equal(obs.artifact, true, "artifact is derived here, and a payload claiming otherwise is overwritten");
  assert.equal(obs.scoreEligible, false);
  assert.equal(obs.qualityFlags[0].code, "LOW_SQI");
});

test("quality: a low signal quality index marks the reading and excludes it from scores", async () => {
  const { g } = gw();
  await bound(g);
  const bad = await g.ingest(hr({ signalQualityIndex: SQI_FLOOR - 1 }));
  const good = await g.ingest(hr({ signalQualityIndex: SQI_FLOOR }));
  assert.equal(bad.artifact, true);
  assert.equal(good.artifact, false, "the floor is inclusive");
  assert.deepEqual(scoreable([bad, good]).map((o) => o.signalQualityIndex), [SQI_FLOOR]);
});

test("quality: a missing signal quality is treated as unverified, not as good", async () => {
  const { g } = gw();
  await bound(g);
  const obs = await g.ingest(hr({ signalQualityIndex: undefined }));
  assert.equal(obs.artifact, true, "silence about quality is not a claim of quality");
  assert.equal(obs.qualityFlags[0].code, "NO_SQI");
});

test("quality: a physiologically implausible value is marked but NEVER discarded", async () => {
  const { g } = gw();
  await bound(g);
  const obs = await g.ingest(hr({ value: 300, signalQualityIndex: 99 }));
  assert.equal(obs.artifact, true);
  assert.equal(obs.value, 300, "an extreme but real value must still reach the chart; only its score eligibility changes");
  assert.equal(obs.qualityFlags.some((f) => f.code === "IMPLAUSIBLE"), true);
});

test("quality: an extreme but plausible value is fully eligible", async () => {
  const { g } = gw();
  await bound(g);
  const obs = await g.ingest(hr({ code: "59408-5", value: 71, unit: "%", signalQualityIndex: 96 }));
  assert.equal(obs.artifact, false, "an SpO2 of 71 is a sick patient, not a broken sensor");
  assert.equal(obs.scoreEligible, true);
});

test("scores: the filter is the supported entry point and excludes every flagged reading", async () => {
  const { g } = gw();
  await bound(g);
  const readings = [
    await g.ingest(hr({ signalQualityIndex: 98 })),
    await g.ingest(hr({ signalQualityIndex: 40 })),
    await g.ingest(hr({ value: 500, signalQualityIndex: 99 })),
    await g.ingest(hr({ signalQualityIndex: undefined })),
  ];
  assert.equal(readings.filter((o) => o.artifact).length, 3);
  assert.equal(scoreable(readings).length, 1, "a score computed over the unfiltered list is the hazard");
});

test("scores: non-device observations are not filtered out by the device rule", async () => {
  const manual = { category: "vital-signs", value: 88 };
  assert.deepEqual(scoreable([manual]), [manual], "a nurse's manual observation has no SQI and must not be dropped");
});

/* ------------------------------------------------------------------ clock and connectivity */

test("clock: skew beyond tolerance is marked, and the device's own time is not rewritten", async () => {
  const c = clock("2026-09-04T10:00:00.000Z");
  const { g } = gw({ clock: c });
  await bound(g);
  const measuredAt = "2026-09-04T09:59:00.000Z"; // one minute behind
  const obs = await g.ingest(hr({ measuredAt }));
  assert.equal(obs.qualityFlags.some((f) => f.code === "CLOCK_SKEW"), true);
  assert.equal(obs.meta.effectiveAt, measuredAt, "silently correcting a timestamp would make a resuscitation look tidier than it was");
  assert.equal(Math.round(obs.clockSkewMs / 1000), 60);
});

test("clock: skew inside tolerance passes unflagged", async () => {
  const c = clock("2026-09-04T10:00:00.000Z");
  const { g } = gw({ clock: c });
  await bound(g);
  const obs = await g.ingest(hr({ measuredAt: "2026-09-04T09:59:56.000Z" }));
  assert.equal(obs.artifact, false);
});

test("connectivity: a silent device is reported as disconnected", async () => {
  const c = clock("2026-09-04T10:00:00.000Z");
  const bus = new ClinicalEventBus();
  const lost = [];
  bus.on("device.disconnected", (e) => lost.push(...e.payload.devices));
  const { g } = gw({ clock: c, bus });
  const { p } = await bound(g);
  await g.ingest(hr());

  c.advance(20);
  assert.deepEqual(await g.checkConnectivity(), [], "twenty seconds of quiet is not a disconnection");
  c.advance(20);
  const out = await g.checkConnectivity();
  assert.equal(out.length, 1);
  assert.equal(out[0].patientId, p.id, "the alert names the patient, not just the device");
  assert.equal(lost.length, 1);
});

test("connectivity: a heartbeat keeps a quiet device alive, and a reading counts as one", async () => {
  const c = clock("2026-09-04T10:00:00.000Z");
  const { g } = gw({ clock: c });
  await bound(g);
  c.advance(25);
  g.heartbeat("MON-04");
  c.advance(25);
  assert.deepEqual(await g.checkConnectivity(), [], "a heartbeat resets the silence");
  c.advance(25);
  await g.ingest(hr());
  c.advance(25);
  assert.deepEqual(await g.checkConnectivity(), [], "and so does an actual reading");
});

test("connectivity: a dissociated device is not reported as lost", async () => {
  const c = clock("2026-09-04T10:00:00.000Z");
  const { g } = gw({ clock: c });
  await bound(g);
  await g.dissociate("MON-04", "nurse-1", "patient discharged");
  c.advance(600);
  assert.deepEqual(await g.checkConnectivity(), [], "a monitor nobody is attached to is not a clinical alarm");
});

/* ------------------------------------------------------------------ provenance */

test("provenance: an observation records the device, its asset tag and when it was bound", async () => {
  const { g } = gw();
  await bound(g);
  const obs = await g.ingest(hr());
  assert.equal(obs.deviceId, "MON-04");
  assert.equal(obs.deviceAssetTag, "AT-9911");
  assert.equal(obs.meta.source.system, "iomt");
  assert.ok(obs.associationAt, "so a later reader can check the reading fell inside a valid association");
  assert.equal(obs.category, "device");
});

test("provenance: association names who performed it", async () => {
  const { g } = gw();
  const a = await g.associate({ device: deviceOf(), patient: patientOf(), scannedWristband: "GH-5", scannedAssetTag: "AT-9911", actorId: "nurse-7" });
  assert.equal(a.by, "nurse-7");
  await assert.rejects(() => g.associate({ device: deviceOf(), patient: patientOf(), scannedWristband: "GH-5", scannedAssetTag: "AT-9911" }),
    (e) => { assert.equal(e.code, "NO_ACTOR"); return true; });
});
