/* functions/_wardsynq/twin-simulate.js — TASK 10.19: what-if, and structurally incapable of writing.
 *
 * SIMULATION MUST NEVER MUTATE PRODUCTION CLINICAL RECORDS (plan section 18). This file does not
 * import RecordService, does not import any repository, does not import `svc` or `.put`/`.append`
 * from anywhere - so a scenario cannot reach the record store even by accident, not merely by
 * convention. test/wardsynq-twin-simulate.test.mjs proves this by passing a repository spy that
 * throws on ANY write method and running every scenario through it.
 *
 * A SIMULATION READS A REAL SNAPSHOT AND ADJUSTS IT ARITHMETICALLY. It takes the twin snapshot
 * digital-twin.js already built from real data, and a hypothetical delta, and returns a PROJECTED
 * version of the same numbers - never a second, independent forecast. Every scenario the plan names
 * is a plain arithmetic adjustment to a count the twin already carries; none of them invent a new
 * clinical judgement.
 *
 * EVERY OUTPUT CARRIES THE LABEL, ON THE OBJECT ITSELF, NOT JUST IN A HEADER COMMENT - because a
 * simulation result can be copied into a chat message, a screenshot, an export, anywhere the label
 * in this file is not visible.
 */

const LABEL = "SIMULATION - NOT LIVE STATE";

/** PURE. Occupied beds after `extra` more admissions with `dischargesExpected` fewer through natural
 *  flow, bounded to the real bed count the twin already reported - never negative, never over 100%. */
function simulateExtraAdmissions(twin, params) {
  const beds = twin && twin.sections && twin.sections.flow && twin.sections.flow.data && twin.sections.flow.data.flow && twin.sections.flow.data.flow.beds;
  if (!beds) return { ok: false, error: "no_baseline", detail: "the twin snapshot has no bed section to simulate from" };
  const extra = Math.max(0, Number(params && params.extraAdmissions) || 0);
  const dischargesExpected = Math.max(0, Number(params && params.dischargesExpected) || 0);
  const total = beds.states ? Object.values(beds.states).reduce((a, b) => a + b, 0) : null;
  const projectedOccupied = Math.max(0, beds.occupied + extra - dischargesExpected);
  return {
    ok: true, scenario: "extra-admissions", params: { extraAdmissions: extra, dischargesExpected },
    baseline: { occupied: beds.occupied, totalBeds: total },
    projected: {
      occupied: total != null ? Math.min(total, projectedOccupied) : projectedOccupied,
      wouldExceedCapacity: total != null && projectedOccupied > total,
      deficit: total != null ? Math.max(0, projectedOccupied - total) : null,
    },
  };
}

/** PURE. ICU capacity reduced by `removedBeds` - occupancy pressure, not an admission decision. */
function simulateIcuCapacityReduction(twin, params) {
  const beds = twin && twin.sections && twin.sections.flow && twin.sections.flow.data && twin.sections.flow.data.flow && twin.sections.flow.data.flow.beds;
  if (!beds) return { ok: false, error: "no_baseline", detail: "the twin snapshot has no bed section to simulate from" };
  const removed = Math.max(0, Number(params && params.removedBeds) || 0);
  const total = beds.states ? Object.values(beds.states).reduce((a, b) => a + b, 0) : 0;
  const remaining = Math.max(0, total - removed);
  return {
    ok: true, scenario: "icu-capacity-reduction", params: { removedBeds: removed },
    baseline: { occupied: beds.occupied, totalBeds: total },
    projected: {
      remainingBeds: remaining,
      wouldExceedCapacity: beds.occupied > remaining,
      overflow: Math.max(0, beds.occupied - remaining),
    },
  };
}

/** PURE. A diagnostic modality going down - the twin's outstanding-specimen count as the backlog
 *  proxy, growing by `hoursOut` worth of the current daily rate rather than a fabricated curve. */
function simulateDiagnosticOutage(twin, params) {
  const lis = twin && twin.sections && twin.sections.lis && twin.sections.lis.data;
  if (!lis) return { ok: false, error: "no_baseline", detail: "the twin snapshot has no LIS section to simulate from" };
  const hoursOut = Math.max(0, Number(params && params.hoursOut) || 0);
  const modality = String((params && params.modality) || "CT");
  /* A dumb, explicit rate: the current outstanding count divided by 24, times the hours out - not a
   * queueing-theory model this codebase has no data to fit. */
  const hourlyRate = lis.outstanding > 0 ? lis.outstanding / 24 : 0;
  const additionalBacklog = Math.round(hourlyRate * hoursOut);
  return {
    ok: true, scenario: "diagnostic-outage", params: { modality, hoursOut },
    baseline: { outstanding: lis.outstanding },
    projected: { outstanding: lis.outstanding + additionalBacklog, additionalBacklog,
      note: "a flat-rate projection from the current backlog, not a queueing model - there is no data in this codebase to fit one." },
  };
}

/** PURE. A blood-product shortage - since digital-twin.js is honest that blood inventory is NOT
 *  BUILT, this scenario is honest too: it cannot project a number that does not exist to shrink. */
function simulateBloodShortage() {
  return { ok: false, error: "no_data_source", detail: "no blood-product inventory module exists in this codebase (see digital-twin.js NOT_BUILT.bloodBank) - there is nothing here to simulate a shortage of." };
}

/** PURE. A temporary ward closure - beds in that ward's state histogram move to `blocked` for the
 *  simulation's purposes only, and any currently-occupied beds in it become the displacement count. */
function simulateWardClosure(twin, params) {
  const beds = twin && twin.sections && twin.sections.flow && twin.sections.flow.data && twin.sections.flow.data.flow && twin.sections.flow.data.flow.beds;
  if (!beds) return { ok: false, error: "no_baseline", detail: "the twin snapshot has no bed section to simulate from" };
  const ward = String((params && params.ward) || "");
  if (!ward) return { ok: false, error: "ward_required", detail: "a ward closure needs a named ward" };
  /* This codebase's twin does not carry per-ward bed counts today (patient-flow.js's beds section is
   * hospital-wide) - said honestly rather than guessed at per-ward from a hospital total. */
  return {
    ok: true, scenario: "ward-closure", params: { ward },
    baseline: { hospitalWideOccupied: beds.occupied },
    projected: null,
    note: "the twin's bed section is hospital-wide, not per-ward, so this scenario cannot project a per-ward displacement count without inventing one. Building per-ward bed aggregation belongs in patient-flow.js, not here.",
  };
}

const SCENARIOS = Object.freeze({
  "extra-admissions": simulateExtraAdmissions,
  "icu-capacity-reduction": simulateIcuCapacityReduction,
  "diagnostic-outage": simulateDiagnosticOutage,
  "blood-shortage": simulateBloodShortage,
  "ward-closure": simulateWardClosure,
});

/**
 * PURE. Runs one named scenario against a twin snapshot. Never touches storage - the whole function
 * signature is (twin object, scenario name, params object) -> result object.
 */
function simulateScenario(twin, scenarioName, params) {
  const fn = SCENARIOS[String(scenarioName || "")];
  if (!fn) return { ok: false, label: LABEL, error: "unknown_scenario", detail: `"${scenarioName}" is not a simulation this file runs. Known: ${Object.keys(SCENARIOS).join(", ")}` };
  if (!twin) return { ok: false, label: LABEL, error: "no_twin", detail: "a simulation needs a real twin snapshot to project from" };
  const result = fn(twin, params || {});
  return { ...result, label: LABEL, simulatedAt: new Date().toISOString() };
}

export { LABEL, SCENARIOS, simulateScenario };
