#!/usr/bin/env node
// build-all.mjs — single orchestrator for the KB build pipeline.
//
// Chains the hand-run `node kb/tools/*.mjs` sequence into one command so a
// large rebuild (hundreds/thousands of diseases) is reproducible and
// CI-runnable. Steps that need inputs unavailable in a given environment
// degrade gracefully:
//   - core / clinical need a live-engine dump (engine-dump.json,
//     engine-assoc.json, engine-tx.json). Skipped with a notice if absent.
//   - embeddings need Cloudflare creds (CLOUDFLARE_ACCOUNT_ID + _API_TOKEN).
//     Skipped unless --embed is passed and creds are present.
//
// Usage:
//   node kb/tools/build-all.mjs [--version <v>] [--dump-dir <dir>]
//                               [--embed] [--skip-core] [--skip-coverage]
//
// Order: validate -> [core, clinical] -> enrichment -> expanded -> rag ->
//        index -> [embed] -> coverage-matrix. Fails fast on any hard error.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS = __dirname;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const VERSION = opt('--version', '1');
const DUMP_DIR = opt('--dump-dir', process.env.CLAUDE_JOB_DIR || '/tmp');
const DO_EMBED = flag('--embed');
const SKIP_CORE = flag('--skip-core');
const SKIP_COVERAGE = flag('--skip-coverage');

const results = [];
function step(label, tool, args = [], { optional = false, reason = '' } = {}) {
  if (reason) {
    console.log(`\n⏭  SKIP  ${label} — ${reason}`);
    results.push({ label, status: 'skipped', reason });
    return;
  }
  console.log(`\n▶  ${label}  (node ${tool} ${args.join(' ')})`);
  const r = spawnSync('node', [join(TOOLS, tool), ...args], { stdio: 'inherit' });
  if (r.status === 0) {
    results.push({ label, status: 'ok' });
  } else {
    results.push({ label, status: 'fail', code: r.status });
    if (!optional) {
      summary();
      console.error(`\n✗ ${label} failed (exit ${r.status}) — aborting.`);
      process.exit(r.status || 1);
    }
  }
}

function summary() {
  console.log('\n─── build-all summary ───');
  for (const r of results) {
    const mark = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '⏭' : '✗';
    console.log(`  ${mark} ${r.label}${r.reason ? '  (' + r.reason + ')' : ''}${r.code ? '  exit ' + r.code : ''}`);
  }
}

console.log(`KB build-all — version=${VERSION} dumpDir=${DUMP_DIR}`);

// 1. Validate authored content first — fail fast before building anything.
step('validate content', 'validate-content.mjs', ['--quiet']);

// 2. Engine-dump-dependent scoring/display artifacts (core, clinical).
const dump = join(DUMP_DIR, 'engine-dump.json');
const assoc = join(DUMP_DIR, 'engine-assoc.json');
const tx = join(DUMP_DIR, 'engine-tx.json');
const haveDump = existsSync(dump) && existsSync(assoc);
const haveTx = existsSync(tx) && existsSync(dump);

step('build kb.core', 'build-kb-core.mjs', [dump, assoc, VERSION], {
  reason: SKIP_CORE ? '--skip-core' : !haveDump ? `no engine dump in ${DUMP_DIR}` : '',
});
step('build kb.clinical', 'build-kb-clinical.mjs', [tx, dump, VERSION], {
  reason: SKIP_CORE ? '--skip-core' : !haveTx ? `no engine tx/dump in ${DUMP_DIR}` : '',
});

// 3. Source-JSON-derived artifacts (always runnable).
step('build kb.enrichment', 'build-kb-enrichment.mjs', [VERSION]);
step('build kb.expanded', 'build-kb-expanded.mjs', [VERSION]);
step('build kb.rag', 'build-kb-rag-bundle.mjs', [VERSION]);
step('build kb.index', 'build-kb-index.mjs');

// 4. Embeddings (Cloudflare Workers AI) — opt-in + creds required.
const haveCreds = !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);
step('embed + upsert vectors', 'embed-upsert.mjs', [], {
  optional: true,
  reason: !DO_EMBED ? 'pass --embed to enable' : !haveCreds ? 'CLOUDFLARE_ACCOUNT_ID/_API_TOKEN not set' : '',
});

// 5. Coverage matrix (reads the shipped dist globals produced above).
step('build coverage matrix', 'build-coverage-matrix.mjs', [], {
  optional: true,
  reason: SKIP_COVERAGE ? '--skip-coverage' : '',
});

summary();
const failed = results.some((r) => r.status === 'fail');
console.log(`\n${failed ? 'COMPLETED WITH FAILURES' : 'OK'}`);
process.exit(failed ? 1 : 0);
