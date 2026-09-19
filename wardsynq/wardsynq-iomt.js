/* wardsynq/wardsynq-iomt.js — medical device telemetry gateway. HAZ-DEV-01.
 *
 * Until this file existed, `Observation` carried `signalQualityIndex` and `artifact` and NOTHING
 * EVER SET THEM. The fields were a description of a control rather than the control. This is the
 * thing that sets them, and it is also the thing that decides whose chart a reading belongs to.
 *
 * The hazard has two halves and the second is the dangerous one:
 *   1. a bad reading treated as real, so an automated score is computed from noise;
 *   2. a good reading attributed to the WRONG PATIENT, because a monitor was moved between beds and
 *      nobody re-associated it. That is silent, plausible, and it poisons the chart.
 *
 * So a reading with no positive patient-device association is REFUSED, not queued, not guessed from
 * the bed. Association requires scanning both the patient's wristband and the device's own asset
 * tag, because a device that merely says which bed it is in is telling you where furniture is.
 *
 * ARTEFACT IS DERIVED, NEVER ACCEPTED. `artifact` is computed here from signal quality and from
 * physiological plausibility, and a payload claiming `artifact: false` cannot override it. A device
 * asserting its own data is clean is exactly the claim that must not be load-bearing.
 *
 * CLOCK. A reading whose timestamp is further from ours than the tolerance is accepted but marked,
 * because event ordering across devices is what makes a trend readable, and a monitor with a wrong
 * clock silently reorders a resuscitation.
 *
 * NOT MODELLED: PTP or NTP synchronisation itself (this detects skew, it does not correct it),
 * waveform-level analysis, device firmware and calibration registries, and alarm forwarding from the
 * device's own alarm system.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-iomt.test.mjs
 */

import { Observation } from "./wardsynq-model.js";

/** Below this, a reading is not trustworthy enough to drive an automated score. */
const SQI_FLOOR = 80;

/** How far a device clock may drift before its readings are marked as unorderable. */
const CLOCK_TOLERANCE_MS = 10_000;

/** No heartbeat for this long during active monitoring is a disconnection. */
const DISCONNECT_AFTER_MS = 30_000;

/**
 * Plausibility bounds. NOT clinical limits and deliberately far wider than any critical threshold:
 * these catch a lead falling off or an arterial line flushing, not illness. A genuinely extreme but
 * real value must reach the chart, so these bounds only mark artefact, they never discard.
 */
const PLAUSIBLE = Object.freeze({
  "8867-4": { name: "Heart rate", min: 20, max: 250, unit: "/min" },
  "8480-6": { name: "Systolic BP", min: 30, max: 260, unit: "mm[Hg]" },
  "8462-4": { name: "Diastolic BP", min: 10, max: 180, unit: "mm[Hg]" },
  "59408-5": { name: "SpO2", min: 40, max: 100, unit: "%" },
  "9279-1": { name: "Respiratory rate", min: 4, max: 60, unit: "/min" },
  "8310-5": { name: "Temperature", min: 28, max: 43, unit: "Cel" },
});

class DeviceGatewayError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DeviceGatewayError";
    this.code = code || "DEVICE_VIOLATION";
  }
}

const up = (v) => (typeof v === "string" ? v.trim().toUpperCase() : "");

class DeviceGateway {
  /** @param {{now?: () => string, bus?: object, sqiFloor?: number, clockToleranceMs?: number, disconnectAfterMs?: number}} deps */
  constructor(deps) {
    deps = deps || {};
    this.now = deps.now || (() => new Date().toISOString());
    this.bus = deps.bus || null;
    this.sqiFloor = deps.sqiFloor ?? SQI_FLOOR;
    this.clockToleranceMs = deps.clockToleranceMs ?? CLOCK_TOLERANCE_MS;
    this.disconnectAfterMs = deps.disconnectAfterMs ?? DISCONNECT_AFTER_MS;
    /** deviceId -> association */
    this.associations = new Map();
  }

  async _emit(t, p) { if (this.bus) await this.bus.emit(t, p); }

  /**
   * Binds a device to a patient. Both barcodes must be physically scanned: the patient's wristband
   * and the device's own asset tag. Anything less is an assumption about where furniture is.
   */
  async associate(input) {
    const { device, patient, scannedWristband, scannedAssetTag, actorId } = input || {};
    if (!actorId) throw new DeviceGatewayError("an association must name who performed it", "NO_ACTOR");
    if (!device || !device.deviceId) throw new DeviceGatewayError("an association needs an identified device", "NO_DEVICE");
    if (!patient || !patient.id) throw new DeviceGatewayError("an association needs an identified patient", "NO_PATIENT");

    if (!scannedWristband || up(scannedWristband) !== up(patient.wristbandBarcode || patient.mrn)) {
      throw new DeviceGatewayError("the patient's wristband was not scanned, or does not match", "WRISTBAND_MISMATCH");
    }
    if (!scannedAssetTag || up(scannedAssetTag) !== up(device.assetTag)) {
      throw new DeviceGatewayError("the device's asset tag was not scanned, or does not match", "ASSET_TAG_MISMATCH");
    }

    // Moving a device to a new patient ends the previous association explicitly, so a chart never
    // has two live claims on one monitor.
    const previous = this.associations.get(device.deviceId);
    if (previous && previous.patientId !== patient.id) {
      previous.endedAt = this.now();
      previous.endedBecause = "device re-associated to another patient";
      await this._emit("device.dissociated", { association: { ...previous } });
    }

    const association = {
      deviceId: device.deviceId, assetTag: device.assetTag, kind: device.kind || null,
      patientId: patient.id, patientMrn: patient.mrn,
      encounterId: input.encounterId || null,
      by: actorId, at: this.now(),
      lastHeartbeatAt: this.now(),
      endedAt: null, endedBecause: null,
    };
    this.associations.set(device.deviceId, association);
    await this._emit("device.associated", { association: { ...association } });
    return association;
  }

  /** Ends an association deliberately, for example when a patient is discharged. */
  async dissociate(deviceId, actorId, reason) {
    const a = this.associations.get(deviceId);
    if (!a || a.endedAt) return null;
    a.endedAt = this.now();
    a.endedBecause = reason || "ended";
    a.endedBy = actorId || null;
    await this._emit("device.dissociated", { association: { ...a } });
    return a;
  }

  activeAssociation(deviceId) {
    const a = this.associations.get(deviceId);
    return a && !a.endedAt ? a : null;
  }

  /**
   * Turns one device reading into a canonical Observation.
   *
   * Refuses outright if the device is not currently associated with a patient. This is the whole
   * point: an unattributed reading is not a reading with a missing field, it is a number that
   * belongs to somebody and we do not know who.
   */
  async ingest(reading) {
    if (!reading || !reading.deviceId) throw new DeviceGatewayError("a reading must say which device produced it", "NO_DEVICE");
    const a = this.activeAssociation(reading.deviceId);
    if (!a) {
      await this._emit("device.reading.orphaned", { deviceId: reading.deviceId, code: reading.code });
      throw new DeviceGatewayError(
        `device ${reading.deviceId} is not associated with any patient; a reading nobody owns must not reach a chart`,
        "NOT_ASSOCIATED",
      );
    }

    a.lastHeartbeatAt = this.now();

    const flags = [];
    const sqi = typeof reading.signalQualityIndex === "number" ? reading.signalQualityIndex : null;
    if (sqi === null) flags.push({ code: "NO_SQI", message: "the device reported no signal quality" });
    else if (sqi < this.sqiFloor) flags.push({ code: "LOW_SQI", message: `signal quality ${sqi} is below the floor of ${this.sqiFloor}` });

    const bounds = PLAUSIBLE[String(reading.code)];
    if (bounds && typeof reading.value === "number") {
      if (reading.value < bounds.min || reading.value > bounds.max) {
        flags.push({ code: "IMPLAUSIBLE", message: `${bounds.name} ${reading.value} is outside the plausible range ${bounds.min} to ${bounds.max}` });
      }
    }

    // Clock skew. Marked, never corrected: silently rewriting a device's timestamp would make a
    // resuscitation look tidier than it was.
    let skewMs = null;
    if (reading.measuredAt) {
      skewMs = Date.parse(this.now()) - Date.parse(reading.measuredAt);
      if (Number.isFinite(skewMs) && Math.abs(skewMs) > this.clockToleranceMs) {
        flags.push({ code: "CLOCK_SKEW", message: `device clock differs by ${Math.round(skewMs / 1000)} s, beyond the ${this.clockToleranceMs / 1000} s tolerance` });
      }
    }

    const obs = Observation({
      patientId: a.patientId,
      encounterId: a.encounterId,
      category: "device",
      code: String(reading.code),
      codeSystem: reading.codeSystem || "LOINC",
      value: reading.value,
      unit: reading.unit || (bounds && bounds.unit) || null,
      signalQualityIndex: sqi,
      // DERIVED here. A payload cannot assert that its own data is clean.
      artifact: flags.length > 0,
      effectiveAt: reading.measuredAt || undefined,
      source: { system: "iomt", sourceId: reading.deviceId },
    });
    obs.deviceId = a.deviceId;
    obs.deviceAssetTag = a.assetTag;
    obs.associationAt = a.at;
    obs.qualityFlags = flags;
    obs.clockSkewMs = skewMs;
    // Explicit, so a consumer never has to infer eligibility from the artifact flag alone.
    obs.scoreEligible = flags.length === 0;

    await this._emit("device.observation", { observation: obs, flags });
    return obs;
  }

  /** Devices that have gone quiet during active monitoring. */
  async checkConnectivity() {
    const nowMs = Date.parse(this.now());
    const lost = [];
    for (const a of this.associations.values()) {
      if (a.endedAt) continue;
      const silentMs = nowMs - Date.parse(a.lastHeartbeatAt);
      if (silentMs > this.disconnectAfterMs) {
        lost.push({ deviceId: a.deviceId, patientId: a.patientId, silentMs });
      }
    }
    if (lost.length) await this._emit("device.disconnected", { devices: lost });
    return lost;
  }

  /** Records a heartbeat without a reading, so a quiet but living device is not called lost. */
  heartbeat(deviceId) {
    const a = this.activeAssociation(deviceId);
    if (a) a.lastHeartbeatAt = this.now();
    return a;
  }
}

/**
 * The consumer-side guarantee: everything an automated score is allowed to see.
 * A score computed over the unfiltered list is the hazard, so this is the only supported entry.
 */
function scoreable(observations) {
  return (observations || []).filter((o) => o && o.category === "device" ? o.scoreEligible === true : true);
}

export {
  SQI_FLOOR, CLOCK_TOLERANCE_MS, DISCONNECT_AFTER_MS, PLAUSIBLE,
  DeviceGatewayError, DeviceGateway, scoreable,
};
