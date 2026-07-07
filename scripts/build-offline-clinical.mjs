#!/usr/bin/env node
/* Build the bundled OFFLINE CLINICAL dataset (structured "gold" records + openFDA
 * monographs) that offline-clinical.js serves when the drug API is unreachable.
 *
 * Source of truth = the same import SQL that seeds D1:
 *   worker/data/import/structured_gold.sql   → drug_structured(composition, gold, …)
 *   worker/data/import/monographs.sql         → monographs(composition, indication, …)
 *
 * We load them through sqlite3 (robust SQL-string parsing), keep only the fields the
 * UI actually renders (drop the verification-only bulk), and emit a gzipped JSON keyed
 * by composition:  { v, generated, struct:{comp:{gold}}, mono:{comp:{…}} }
 *
 * Output: data/offline-clinical.json.gz  (bundled into www/ by scripts/build-www.sh)
 * Run:    node scripts/build-offline-clinical.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMP = join(ROOT, 'worker/data/import');
const TMP = join(ROOT, 'data', '.clinical-build.db');
const OUT_JSON = join(ROOT, 'data', 'offline-clinical.json');
const OUT_GZ = join(ROOT, 'data', 'offline-clinical.json.gz');
const SCHEMA_SQL = join(ROOT, 'worker/structured_schema.sql');
// monographs.sql (openFDA) first; monographs_india_poc.sql (India-authored, INSERT OR
// REPLACE) last so its curated rows win — same apply order as prod. It is the SOLE source
// of the Nimesulide/Etoricoxib/Aceclofenac (and future POC-only) monographs.
const MONO_FILES = ['monographs.sql', 'monographs_india_poc.sql'];
// Load order that reproduces prod's drug_structured. The field-model files (OR REPLACE, no
// gold) MUST load first; the gold files last, so `gold` wins and is never wiped by an
// OR REPLACE. gold_pantoprazole.sql is an UPDATE, so its row must already exist (created by
// structured.sql / pantoprazole_polished.sql above it).
const STRUCT_FILES = ['structured.sql', 'pantoprazole_polished.sql', 'polished_batch.sql', 'structured_gold.sql', 'gold_pantoprazole.sql'];
// Fields renderStructured() actually shows (qfGrid + ST_SECS). raw_label & the rest are dropped.
const ST_FIELDS = ['summary', 'adult_dose', 'ped_dose', 'geriatric', 'moa', 'administration', 'renal_adjust',
  'hepatic_adjust', 'pregnancy', 'lactation', 'contraindications', 'boxed_warning', 'precautions', 'common_se',
  'serious_se', 'interactions', 'monitoring', 'overdose', 'counseling', 'food_timing', 'half_life', 'alcohol'];

mkdirSync(join(ROOT, 'data'), { recursive: true });
try { rmSync(TMP); } catch {}

function sql(statements) { execFileSync('sqlite3', [TMP], { input: statements, maxBuffer: 512 * 1024 * 1024 }); }
function queryJSON(select) {
  const out = execFileSync('sqlite3', [TMP, '-json', select], { maxBuffer: 512 * 1024 * 1024 }).toString().trim();
  return out ? JSON.parse(out) : [];
}

console.log('• building temp SQLite from import SQL…');
// Full drug_structured schema (composition PK) + the newer `gold` JSON column.
sql(readFileSync(SCHEMA_SQL, 'utf8'));
sql('ALTER TABLE drug_structured ADD COLUMN gold TEXT;');
for (const f of STRUCT_FILES) {
  try { sql(readFileSync(join(IMP, f), 'utf8')); console.log('   loaded', f); }
  catch (e) { console.log('   ⚠ skipped', f, '-', String(e.message || e).split('\n')[0]); }
}
for (const f of MONO_FILES) {   // monographs.sql carries its own CREATE TABLE IF NOT EXISTS; POC reuses it
  try { sql(readFileSync(join(IMP, f), 'utf8')); console.log('   loaded', f); }
  catch (e) { console.log('   ⚠ skipped', f, '-', String(e.message || e).split('\n')[0]); }
}

console.log('• exporting displayed columns…');
const structRows = queryJSON(
  `SELECT composition, gold, ${ST_FIELDS.join(', ')} FROM drug_structured
   WHERE gold IS NOT NULL OR ${ST_FIELDS.map((f) => f + ' IS NOT NULL').join(' OR ')};`
);
const monoRows = queryJSON(
  "SELECT composition, indication, dosage, pregnancy, specific_pop, adverse, interactions, warnings, forms, source FROM monographs;"
);

// Assemble maps keyed by EXACT composition (mirrors the worker's exact match).
const struct = {}, mono = {};
let sDup = 0, mDup = 0, goldCount = 0;
for (const r of structRows) {
  if (!r.composition) continue;
  if (struct[r.composition]) sDup++;
  const o = {};
  const hasGold = r.gold != null && String(r.gold).trim() !== '';
  if (hasGold) {
    o.gold = r.gold; goldCount++;                                          // renderStructured prefers data.gold → parseGold(); fields are redundant
  } else {
    for (const k of ST_FIELDS) if (r[k] != null && String(r[k]).trim() !== '') o[k] = r[k];  // fallback fields (qfGrid/stSections) only when no gold
  }
  struct[r.composition] = o;
}
for (const r of monoRows) {
  if (!r.composition) continue;
  if (mono[r.composition]) mDup++;
  const o = {};
  for (const k of ['indication', 'dosage', 'pregnancy', 'specific_pop', 'adverse', 'interactions', 'warnings', 'forms', 'source']) {
    if (r[k] != null && String(r[k]).trim() !== '') o[k] = r[k];
  }
  mono[r.composition] = o;
}

const payload = { v: 1, generated: new Date().toISOString(), struct, mono };
const json = JSON.stringify(payload);
writeFileSync(OUT_JSON, json);
const gz = gzipSync(Buffer.from(json), { level: 9 });
writeFileSync(OUT_GZ, gz);
try { rmSync(TMP); } catch {}

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
console.log(`\n✓ structured molecules: ${Object.keys(struct).length}  (with gold: ${goldCount}, dups collapsed: ${sDup})`);
console.log(`✓ monographs:           ${Object.keys(mono).length}  (dups collapsed: ${mDup})`);
console.log(`✓ ${OUT_JSON}  ${mb(statSync(OUT_JSON).size)}`);
console.log(`✓ ${OUT_GZ}  ${mb(statSync(OUT_GZ).size)}  (gzip -9)`);
// sanity: a known molecule must be present with real gold JSON
const probe = struct['Pantoprazole'] || struct['pantoprazole'];
console.log(`\nsanity — Pantoprazole gold present: ${!!(probe && probe.gold && probe.gold.length > 100)}`);
if (probe && probe.gold) { try { const g = JSON.parse(probe.gold); console.log(`  gold keys: ${Object.keys(g).join(', ')}`); } catch { console.log('  ⚠ gold not valid JSON'); } }
// sanity: India-authored POC monograph must be present (proves monographs_india_poc.sql loaded)
const mProbe = mono['Nimesulide'] || mono['nimesulide'];
console.log(`sanity — Nimesulide POC monograph present: ${!!(mProbe && mProbe.dosage)}`);
