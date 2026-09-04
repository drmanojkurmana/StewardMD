/* test/wardsynq-shadow.test.mjs — the Ward Sync shadow observer.
 *
 * This wraps a function that a live mobile app depends on, so the tests are almost entirely about
 * what it must NOT do: change the result, change the arguments, throw, or run at all when the flag
 * is off. The observation itself is the least important thing here.
 *
 * node --test test/wardsynq-shadow.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { installShadow } from "../wardsynq/wardsynq-shadow.js";

const flagsOn = { get: (n) => n === "smd_wardsynq_shadow" };
const flagsOff = { get: () => false };

const bundle = (over) => ({
  patientId: "12345", episodeId: "EP1",
  patient: { name: "RAMU DEVI", sex: "F", bed: "12A", mrn: "12345", age: "45" },
  labs: [
    { test: "Sodium", result: "138", units: "mEq/L", date: "03-JUL-2026 08:30" },
    { test: "Potassium", result: "6.4", units: "mEq/L", date: "03-JUL-2026 08:30" },
  ],
  ...over,
});

/** A stand-in for the live ICU module. */
function hostWith(impl) {
  return { ingestFromWard: impl || ((b) => ({ applied: true, rows: ((b && b.labs) || []).length })) };
}

/* ------------------------------------------------------------------ it must not run uninvited */

test("flag off: nothing is installed and the function is untouched", () => {
  const host = hostWith();
  const before = host.ingestFromWard;
  const s = installShadow({ host, flags: flagsOff });
  assert.equal(s.installed, false);
  assert.equal(host.ingestFromWard, before, "with the flag off there is not even a wrapper");
});

test("no host: it declines rather than throwing at load", () => {
  assert.equal(installShadow({ host: null, flags: flagsOn }).installed, false);
  assert.equal(installShadow({ host: {}, flags: flagsOn }).installed, false, "a host with no ingestFromWard is not an error");
});

/* ------------------------------------------------------------------ it must not change behaviour */

test("the legacy result is returned unchanged", () => {
  const sentinel = { applied: true, marker: Symbol("legacy") };
  const host = hostWith(() => sentinel);
  installShadow({ host, flags: flagsOn });
  assert.equal(host.ingestFromWard(bundle()), sentinel, "the caller gets exactly what the legacy path returned");
});

test("the legacy path receives its arguments unmodified, and runs FIRST", () => {
  const seen = [];
  const order = [];
  const b = bundle();
  const host = hostWith(function (...args) { seen.push(args); order.push("legacy"); return "ok"; });
  installShadow({ host, flags: flagsOn, onObservation: () => order.push("shadow") });

  host.ingestFromWard(b, "second-arg", 3);
  assert.equal(seen[0][0], b, "the same bundle object, not a copy");
  assert.deepEqual(seen[0].slice(1), ["second-arg", 3], "every argument is passed through");
  assert.deepEqual(order, ["legacy", "shadow"], "the chart is updated before anything is observed");
});

test("`this` is preserved, because the live function is a method on ICU", () => {
  const host = {
    marker: "icu",
    ingestFromWard() { return this.marker; },
  };
  installShadow({ host, flags: flagsOn });
  assert.equal(host.ingestFromWard(bundle()), "icu");
});

test("a legacy throw still propagates, because swallowing it would hide a real failure", () => {
  const host = hostWith(() => { throw new Error("legacy exploded"); });
  installShadow({ host, flags: flagsOn });
  assert.throws(() => host.ingestFromWard(bundle()), /legacy exploded/,
    "the shadow must not turn a real ingest failure into a silent success");
});

/* ------------------------------------------------------------------ the shadow must never bite */

test("ADVERSARIAL: a shadow failure cannot reach the caller", () => {
  const host = hostWith(() => "legacy-ok");
  const s = installShadow({
    host, flags: flagsOn,
    onObservation: () => { throw new Error("shadow exploded"); },
  });
  assert.equal(host.ingestFromWard(bundle()), "legacy-ok", "a defect in the adapter must not break a ward round");
  assert.equal(s.report().shadowErrors, 1, "it shows up as a number instead");
  assert.match(s.report().lastError, /shadow exploded/);
});

test("ADVERSARIAL: junk bundles are observed without disturbing anything", () => {
  const host = hostWith(() => "ok");
  const s = installShadow({ host, flags: flagsOn });
  for (const junk of [null, undefined, {}, { labs: null }, { patientId: "1", labs: "not-an-array" }]) {
    assert.equal(host.ingestFromWard(junk), "ok");
  }
  assert.equal(s.report().shadowErrors, 0, "the adapter tolerates junk, so the shadow does too");
});

test("ADVERSARIAL: the shadow does not mutate the bundle the legacy path was given", () => {
  const b = bundle();
  const snapshot = JSON.stringify(b);
  const host = hostWith(() => "ok");
  installShadow({ host, flags: flagsOn });
  host.ingestFromWard(b);
  assert.equal(JSON.stringify(b), snapshot, "observation is read-only");
});

/* ------------------------------------------------------------------ what it is actually for */

test("observation: it counts what the adapter produced against what the bundle held", () => {
  const host = hostWith(() => "ok");
  const s = installShadow({ host, flags: flagsOn });
  host.ingestFromWard(bundle());
  const r = s.report();
  assert.equal(r.bundlesSeen, 1);
  assert.equal(r.mapped, 1);
  assert.equal(r.legacyLabRows, 2);
  assert.equal(r.observationsMapped, 2);
  assert.equal(r.clean, true, "no errors and no disagreements is what readiness looks like");
});

test("observation: a shortfall against the bundle's own lab rows is recorded as a disagreement", () => {
  const host = hostWith(() => "ok");
  const s = installShadow({ host, flags: flagsOn });
  // One row has no test name, so the adapter drops it and reports an issue.
  host.ingestFromWard(bundle({ labs: [{ test: "Sodium", result: "138" }, { test: "", result: "9" }] }));
  const r = s.report();
  assert.equal(r.disagreements.length, 1, "a shortfall is exactly what this observer exists to surface");
  assert.equal(r.disagreements[0].legacyLabRows, 2);
  assert.equal(r.disagreements[0].wardsynqObservations, 1);
  assert.equal(r.clean, false);
  assert.ok(r.issues.some((i) => i.code === "GHIS_LAB_NO_NAME"), "and the adapter's own reason is carried through");
});

test("observation: mapping issues from real vocabulary gaps are surfaced", () => {
  const host = hostWith(() => "ok");
  const s = installShadow({ host, flags: flagsOn });
  host.ingestFromWard(bundle({ labs: [{ test: "Serum Xyzase", result: "3", units: "U/L" }] }));
  assert.ok(s.report().issues.some((i) => i.code === "GHIS_LAB_UNMAPPED"),
    "an unmapped analyte is the kind of thing that must be found in shadow rather than in production");
});

test("uninstall: the original function is restored exactly", () => {
  const host = hostWith();
  const original = host.ingestFromWard;
  const s = installShadow({ host, flags: flagsOn });
  assert.notEqual(host.ingestFromWard, original);
  s.uninstall();
  assert.equal(host.ingestFromWard, original, "the change is fully reversible at runtime as well as by not loading the file");
});
