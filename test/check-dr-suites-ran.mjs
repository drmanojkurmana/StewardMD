/* test/check-dr-suites-ran.mjs — TASK 9.19/9.12: did the disaster-recovery evidence actually RUN?
 *
 * THE FAILURE THIS EXISTS FOR IS INVISIBLE BY CONSTRUCTION. `wardsynq-restore`, `wardsynq-onprem` and
 * `wardsynq-d1-sql` all need `node:sqlite`, and all three deliberately SKIP rather than fail when it
 * is unavailable - which is the right call, because an engine gap is not a broken product and a red
 * build for one teaches people to ignore red builds.
 *
 * The cost of that design is that the suites cannot tell you they stopped running. CI pins Node 22,
 * where node:sqlite needs `--experimental-sqlite`, and .github/workflows/ci.yml did not pass it. So
 * the restore rehearsal - the single best piece of recovery evidence in this repository - skipped on
 * every CI run and reported green. Nobody was lying; the report was just about nothing.
 *
 * A SKIP IS NOT A PASS, AND THIS IS THE ONE PLACE THAT SAYS SO OUT LOUD. It runs the three suites and
 * fails if any of them executed zero tests, so the evidence pipeline has to be genuinely armed rather
 * than merely green. It deliberately does NOT re-assert what those suites assert - they own that.
 *
 *   node --experimental-test-module-mocks --experimental-sqlite test/check-dr-suites-ran.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* The suites whose evidence is worthless if they silently skip. Each is here because it proves
 * something about RECOVERY or ISOLATION that no other suite proves. */
const REQUIRED = [
  { file: "wardsynq-restore.test.mjs", proves: "the restore rehearsal: a destroyed database rebuilt from an export, read back through the real repository" },
  { file: "wardsynq-onprem.test.mjs", proves: "the on-premise boot: the same repository on a hospital's own SQLite, schema applied at start" },
  { file: "wardsynq-d1-sql.test.mjs", proves: "tenant isolation enforced in SQL, and batch rollback on a real constraint violation" },
];

/* A suite that runs zero tests has told you nothing. This is the whole check. */
const MIN_TESTS = 1;

let bad = 0;
for (const suite of REQUIRED) {
  const res = spawnSync(process.execPath,
    ["--test", "--experimental-test-module-mocks", "--experimental-sqlite", "--test-reporter=tap", join(HERE, suite.file)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout || ""}\n${res.stderr || ""}`;

  /* TAP's own counters, not a guess: `# pass N`, `# fail N`, `# skipped N`. */
  const num = (label) => { const m = out.match(new RegExp(`^# ${label} (\\d+)$`, "m")); return m ? Number(m[1]) : null; };
  const pass = num("pass"), fail = num("fail"), skipped = num("skipped");

  if (fail === null && pass === null) {
    console.log(`❌ ${suite.file}: produced no TAP summary at all (exit ${res.status})`);
    bad++; continue;
  }
  if (fail > 0) {
    console.log(`❌ ${suite.file}: ${fail} test(s) FAILED`);
    bad++; continue;
  }
  if (pass < MIN_TESTS) {
    console.log(`❌ ${suite.file}: ran ${pass} test(s) and skipped ${skipped}. A SKIPPED SUITE IS NOT A PASSING ONE.`);
    console.log(`   this suite is required because it proves ${suite.proves}`);
    console.log(`   almost always: node:sqlite is unavailable - pass --experimental-sqlite (needed on Node 22, unflagged from 23.4)`);
    bad++; continue;
  }
  console.log(`✅ ${suite.file}: ${pass} test(s) executed${skipped ? `, ${skipped} skipped` : ""}`);
}

console.log(bad
  ? `\n${bad} disaster-recovery suite(s) did not actually run. The evidence they represent is NOT in this build.`
  : "\nAll disaster-recovery suites executed. Their evidence is real for this build.");
process.exit(bad ? 1 : 0);
