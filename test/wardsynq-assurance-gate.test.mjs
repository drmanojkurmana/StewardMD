/* Codex F8: the assurance run fails when the test process failed, and under --release when hazards are not verified. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, HAZARDS, assess } from "../wardsynq/wardsynq-safety-case.js";

const clean = { exitCode: 0, signal: null, error: null, fileFailures: [], failedTests: [], testsSeen: 100 };
const hz = (status) => [{ id: "HAZ-X", status }];

test("a clean run with only verified hazards passes in both modes", () => {
  assert.equal(gate(hz("verified"), clean).ok, true);
  assert.equal(gate(hz("verified"), clean, { release: true }).ok, true);
});

test("a failed or crashed test process fails the run even when every mapped hazard is verified", () => {
  for (const bad of [{ exitCode: 1 }, { exitCode: null, signal: "SIGKILL" }, { error: "spawn ENOENT", exitCode: null }, { fileFailures: ["test/wardsynq-x.test.mjs"] }, { failedTests: ["a test outside any hazard"] }, { testsSeen: 0 }]) {
    const v = gate(hz("verified"), { ...clean, ...bad });
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.reasons.length >= 1);
  }
});

test("development report: partial, no-evidence and uncontrolled do not fail; failing does", () => {
  for (const s of ["partial", "no-evidence", "uncontrolled"]) assert.equal(gate(hz(s), clean).ok, true, s);
  assert.equal(gate(hz("failing"), clean).ok, false);
});

test("--release: partial, no-evidence and uncontrolled also fail, and the reason names the hazard", () => {
  for (const s of ["partial", "no-evidence", "uncontrolled", "failing"]) {
    const v = gate(hz(s), clean, { release: true });
    assert.equal(v.ok, false, s);
    assert.match(v.reasons.join(" "), /HAZ-X/);
  }
});

test("HAZ-DOWN-01 evidence names are all real test names", async () => {
  const { readFileSync } = await import("node:fs");
  const files = ["wardsynq-store", "wardsynq-offline-journal"].map((f) => readFileSync(new URL(`./${f}.test.mjs`, import.meta.url), "utf8").toLowerCase()).join("\n");
  const down = HAZARDS.find((h) => h.id === "HAZ-DOWN-01");
  const missing = down.verification.tests.filter((t) => !files.includes(t.toLowerCase()));
  assert.deepEqual(missing, [], "every cited fragment exists in a test file");
  assert.ok(assess([], HAZARDS).length > 0);
});
