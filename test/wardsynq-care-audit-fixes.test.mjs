/* CLIN-22, CLIN-23, CLIN-24 (audit B:C4, B:C5, B:C6).
 * - A vital charted on a tablet a few seconds fast still reaches the flowsheet.
 * - A risk tool with an unusable item is refused, not scored without it.
 * - A fluid period with no output charted is not "complete".
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-care-audit-fixes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
const { vitalsToObservations } = await import("../functions/_wardsynq/migrate-vitals.js");
const { entryFrom } = await import("../functions/_wardsynq/flowsheet-view.js");
const { recordAssessment } = await import("../functions/_wardsynq/risk-assessment.js");
const { fluidToObservations, summariseBalance } = await import("../functions/_wardsynq/fluid-balance.js");
const { Observation } = await import("../wardsynq/wardsynq-model.js");

test("a tablet 3 seconds fast: the observation is stored at the server's receipt time and placed on the flowsheet", () => {
  const tabletAhead = new Date(Date.now() + 3000).toISOString();
  const obs = vitalsToObservations({ vitals: { pulse: 112, rr: 24 }, patientId: "p1", ticketId: "enc1", encounterId: "enc1", recordedAt: tabletAhead, idPrefix: "wsq-ward-vitals", defaultTempUnit: "C" });
  assert.equal(obs.length, 2);
  for (const o of obs) {
    assert.ok(Date.parse(o.meta.effectiveAt) <= Date.parse(o.meta.recordedAt), "never observed after it was received");
    assert.equal(o.meta.effectiveAtAsSent, tabletAhead, "what the device said is kept");
    assert.ok(entryFrom(o), `${o.code} is placed`);
  }
});

test("an observation already stored a few minutes ahead of its receipt is placed; hours ahead is still refused", () => {
  const recordedAt = "2026-09-26T10:00:00.000Z";
  const stored = (effectiveAt) => ({ patientId: "p1", code: "8867-4", display: "Pulse", value: 90, unit: "/min", meta: { recordedAt, effectiveAt } });
  assert.ok(entryFrom(stored("2026-09-26T10:02:00.000Z")), "two minutes of clock skew is the same moment");
  assert.equal(entryFrom(stored("2026-09-26T13:00:00.000Z")), null, "three hours ahead is not skew");
  // A past observation time is untouched.
  const past = Observation({ patientId: "p1", code: "8867-4", value: 90, effectiveAt: "2026-09-26T09:00:00.000Z" });
  assert.equal(past.meta.effectiveAt, "2026-09-26T09:00:00.000Z");
  assert.equal("effectiveAtAsSent" in past.meta, false);
});

test("a risk tool with one unusable item is refused, not scored lower without it", async () => {
  const morse = { id: "morse", name: "Morse Fall Scale", items: [
    { key: "history", options: [{ value: "no", score: 0 }, { value: "yes", scroe: 25 }] },
    { key: "iv", options: [{ value: "no", score: 0 }, { value: "yes", score: 20 }] },
    { key: "gait", options: [{ value: "normal", score: 0 }, { value: "weak", score: 10 }] },
  ], bands: [{ band: "low", min: 0, max: 24, actions: ["standard"] }, { band: "moderate", min: 25, max: 44, actions: ["x"] }, { band: "high", min: 45, max: 125, actions: ["high-risk bundle"] }] };
  const r = await recordAssessment(null, {}, { migration: { mode: "authoritative", tenantId: "t" }, tools: [morse], toolId: "morse", encounterId: "e1",
    answers: { history: "yes", iv: "yes", gait: "weak" } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.error, "tool_has_unusable_items");
  assert.deepEqual(r.problems.map((p) => p.key), ["history"]);
});

test("twelve hours of intake with no output charted is not complete, and the output hours are named", () => {
  const from = "2026-09-26T00:00:00.000Z", to = "2026-09-26T12:00:00.000Z";
  const entries = [];
  for (let h = 0; h < 12; h++) entries.push({ direction: "intake", kind: "iv", value: 100, unit: "mL", at: new Date(Date.parse(from) + h * 3600000 + 600000).toISOString() });
  const { observations } = fluidToObservations({ entries, patientId: "p1", encounterId: "e1" });
  const b = summariseBalance(observations, { from, to });
  assert.equal(b.gaps.length, 0, "every hour has an entry");
  assert.equal(b.outputGaps.length, 12, "and not one of them has output");
  assert.equal(b.intakeGaps.length, 0);
  assert.equal(b.complete, false);
  // With output in every hour too, it is complete.
  const both = entries.concat(entries.map((e) => ({ ...e, direction: "output", kind: "urine", value: 50 })));
  const b2 = summariseBalance(fluidToObservations({ entries: both, patientId: "p1", encounterId: "e1" }).observations, { from, to });
  assert.equal(b2.complete, true);
});
