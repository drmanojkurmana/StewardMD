/* scripts/wardsynq-assurance.mjs — run the WardSynQ tests and print the assurance table.
 *
 * The safety case is only worth anything if its evidence is executed rather than asserted, so this
 * runs the real suites, parses what actually passed, and cross-references the hazard table against
 * that. A hazard whose named test has been renamed or deleted shows as MISSING TEST rather than
 * quietly continuing to look verified, which is the failure mode this whole file exists to prevent.
 *
 *   node scripts/wardsynq-assurance.mjs
 *   node scripts/wardsynq-assurance.mjs --json
 *
 * Exit code is 1 when any hazard is FAILING, so this can gate a pipeline. It is deliberately 0 for
 * UNCONTROLLED and NO_EVIDENCE: those are known, declared gaps in an early build, and a gate that
 * fails on them from day one is a gate somebody switches off.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assess, report, summarise } from "../wardsynq/wardsynq-safety-case.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const SUITES = [
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
  "test/wardsynq-interop.test.mjs",
  "test/wardsynq-paediatrics.test.mjs",
  "test/wardsynq-safety-case.test.mjs",
];

/** Runs node --test with the TAP reporter and returns a flat list of {name, passed}. */
function runTests() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", ...SUITES], { cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", () => {
      const results = [];
      // TAP lines look like "ok 3 - name" / "not ok 3 - name", indented for subtests.
      for (const line of out.split("\n")) {
        const m = line.match(/^\s*(not ok|ok)\s+\d+\s+-\s+(.*?)\s*$/);
        if (!m) continue;
        const name = m[2].replace(/\s+#.*$/, "");
        if (/^test\//.test(name)) continue; // the file-level roll-up, not a test
        results.push({ name, passed: m[1] === "ok" });
      }
      resolve(results);
    });
  });
}

const testResults = await runTests();
const assessment = assess(testResults);
const summary = summarise(assessment);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, assessment, testsSeen: testResults.length }, null, 2));
} else {
  console.log(report(assessment));
  console.log(`Evidence drawn from ${testResults.length} executed tests across ${SUITES.length} suites.`);
}

process.exit(assessment.some((a) => a.status === "failing") ? 1 : 0);
