/* scripts/wardsynq-assurance.mjs — run the WardSynQ tests and print the assurance table.
 *
 * The safety case is only worth anything if its evidence is executed rather than asserted, so this
 * runs the real suites, parses what actually passed, and cross-references the hazard table against
 * that. A hazard whose named test has been renamed or deleted shows as MISSING TEST rather than
 * quietly continuing to look verified, which is the failure mode this whole file exists to prevent.
 *
 *   node scripts/wardsynq-assurance.mjs
 *   node scripts/wardsynq-assurance.mjs --json
 *   node scripts/wardsynq-assurance.mjs --release
 *
 * Exit code is 1 when the test process failed or crashed (non-zero exit, a failed or crashed test file,
 * any failed test, no results parsed) or when any hazard is FAILING. The default is the development
 * report: it stays 0 for UNCONTROLLED, NO_EVIDENCE and PARTIAL, which are known, declared gaps in an
 * early build, and a gate that fails on them from day one is a gate somebody switches off.
 * --release is the deployment gate: those three also exit 1. Software verification is all this
 * checks; clinical approval is a separate required sign-off the hazard caveats carry.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assess, gate, report, summarise } from "../wardsynq/wardsynq-safety-case.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const SUITES = [
  /* TASK 9.12/9.20. The recovery suites were absent from this list, so the assurance table was
   * assembled without ever running the restore rehearsal - the evidence HAZ-DR-01 now cites. */
  "test/wardsynq-restore.test.mjs",
  "test/wardsynq-backup-run.test.mjs",
  "test/wardsynq-p0-core.test.mjs",
  "test/wardsynq-store.test.mjs",
  "test/wardsynq-mpi.test.mjs",
  "test/wardsynq-safety.test.mjs",
  "test/wardsynq-ghis-adapter.test.mjs",
  "test/wardsynq-temporal.test.mjs",
  "test/wardsynq-critical.test.mjs",
  "test/wardsynq-transfusion.test.mjs",
  "test/wardsynq-surgical.test.mjs",
  "test/wardsynq-actors.test.mjs",
  "test/wardsynq-iomt.test.mjs",
  "test/wardsynq-offline.test.mjs",
  "test/wardsynq-offline-journal.test.mjs",   // HAZ-DOWN-01: three-way reconciliation and the durable journal
  "test/wardsynq-interop.test.mjs",
  "test/wardsynq-paediatrics.test.mjs",
  "test/wardsynq-deterioration.test.mjs",
  "test/wardsynq-notify.test.mjs",
  "test/wardsynq-emergency.test.mjs",
  "test/wardsynq-recognition.test.mjs",
  "test/wardsynq-obstetrics.test.mjs",
  "test/wardsynq-bundle-binding.test.mjs",
  "test/wardsynq-quality.test.mjs",
  "test/wardsynq-incidents.test.mjs",
  "test/wardsynq-consent.test.mjs",
  "test/wardsynq-research.test.mjs",
  "test/wardsynq-lineage.test.mjs",
  "test/wardsynq-api-gov.test.mjs",
  "test/wardsynq-billing.test.mjs",
  "test/wardsynq-population.test.mjs",
  "test/wardsynq-secops.test.mjs",
  "test/wardsynq-mlops.test.mjs",
  "test/wardsynq-simulation.test.mjs",
  "test/wardsynq-scenarios.test.mjs",
  "test/wardsynq-opd.test.mjs",
  "test/wardsynq-flowsheet.test.mjs",
  "test/wardsynq-brand.test.mjs",
  "test/wardsynq-transport.test.mjs",
  "test/wardsynq-pews.test.mjs",
  "test/wardsynq-readlog.test.mjs",
  "test/wardsynq-opd-render.test.mjs",
  "test/wardsynq-ghis-live.test.mjs",
  "test/wardsynq-flowsheet-render.test.mjs",
  "test/wardsynq-pipeline.test.mjs",
  // The Task 2.6/2.7 bridge suites - the first hazards this file argues (HAZ-ONCO-01, HAZ-CARDIO-01)
  // whose evidence lives in a mock.module()-based test file, hence the added flag below.
  "test/wardsynq-oncology.test.mjs",
  "test/wardsynq-cardiology.test.mjs",
  "test/wardsynq-safety-case.test.mjs",
  // Medical Core (HAZ-ML-01..04). Not wardsynq-* files, so they are named explicitly: the hazards
  // are argued in the same safety case rather than in a parallel one, which is the whole point.
  "test/medcore-units.test.mjs",
  "test/medcore-age.test.mjs",
  "test/medcore-shortcut.test.mjs",
  "test/medcore-labels.test.mjs",
  "test/medcore-pipeline.test.mjs",
  "test/medcore-models.test.mjs",
  "test/medcore-gbm.test.mjs",
  "test/medcore-decide.test.mjs",
  "test/medcore-shadow.test.mjs",
];

/** Runs node --test with the TAP reporter. Returns the flat {name, passed} list plus how the process ended. */
function runTests() {
  return new Promise((resolve) => {
    const run = { exitCode: null, signal: null, error: null, stderr: "", fileFailures: [], failedTests: [] };
    const child = spawn(process.execPath, ["--test", "--experimental-test-module-mocks", "--experimental-sqlite", "--test-reporter=tap", ...SUITES], { cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { run.stderr += d; });
    child.on("error", (e) => { run.error = String((e && e.message) || e); resolve({ results: [], run }); });
    child.on("close", (code, signal) => {
      run.exitCode = code; run.signal = signal;
      const results = [];
      // TAP lines look like "ok 3 - name" / "not ok 3 - name", indented for subtests.
      for (const line of out.split("\n")) {
        const m = line.match(/^\s*(not ok|ok)\s+\d+\s+-\s+(.*?)\s*$/);
        if (!m) continue;
        const name = m[2].replace(/\s+#.*$/, "");
        // The file-level roll-up is not a test, but a failed or crashed FILE is a failed run.
        if (/^test\//.test(name)) { if (m[1] === "not ok") run.fileFailures.push(name); continue; }
        results.push({ name, passed: m[1] === "ok" });
      }
      run.failedTests = results.filter((r) => !r.passed).map((r) => r.name);
      resolve({ results, run });
    });
  });
}

const release = process.argv.includes("--release");
const { results: testResults, run } = await runTests();
run.testsSeen = testResults.length;
const assessment = assess(testResults);
const summary = summarise(assessment);
const verdict = gate(assessment, run, { release });
// Node prints loader warnings on stderr even on a green run, so it is reported, not failed on.
const stderrTail = run.stderr.trim().split("\n").slice(-40).join("\n");

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, assessment, testsSeen: testResults.length, mode: release ? "release" : "development",
    testRun: { exitCode: run.exitCode, signal: run.signal, error: run.error, fileFailures: run.fileFailures, failedTests: run.failedTests, stderr: stderrTail },
    ok: verdict.ok, reasons: verdict.reasons }, null, 2));
} else {
  console.log(report(assessment));
  console.log(`Evidence drawn from ${testResults.length} executed tests across ${SUITES.length} suites.`);
  if (stderrTail) console.log(`\nTest process stderr (last lines):\n${stderrTail}`);
  console.log(`\n${verdict.ok ? "PASS" : "FAIL"} (${release ? "release" : "development"} gate)${verdict.reasons.map((r) => `\n  - ${r}`).join("")}`);
}

process.exit(verdict.ok ? 0 : 1);
