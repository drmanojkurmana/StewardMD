// Promote fully-grounded (zero-VERIFY) v2 Standard Protocols -> runtime templates (kb/protocols/).
// Reversible + fail-closed: lifecycleState:"draft" + experimental:true (NEVER "active"), so the base
// apply flow ignores them; only the smd_onco_protolib test flag surfaces them. Regenerates index.json.
const fs = require('fs');
const ROOT = require('path').join(__dirname, '..', '..');
const SRC = ROOT + '/docs/superpowers/onco-protocols-v2';
const OUT = ROOT + '/kb/protocols';

// Intra-day frequency: an EXPLICIT, source-verified allow-list keyed by "<protocolId>::<drugId>".
// Free-text scanning over-matches (a drug's note quotes combination-arm / escalation / alternative-drug
// frequencies), so every entry here was hand-checked against its sourced note that dosePerUnit is the
// PER-ADMINISTRATION dose (not a "/day divided" daily dose). Anything absent = once daily (engine
// default 1). A missed BID just shows the correct per-dose; it can never over-compute a daily dose.
const FREQ_MAP = {
  'breast-capecitabine::capecitabine': 2, 'gi-gastric-capox::capecitabine': 2,
  'gi-gastric-pembro::capecitabine': 2, 'gi-net-captem::capecitabine': 2,
  'gi-hcc-sorafenib::sorafenib': 2, 'gu-prostate-abiraterone::prednisone': 2,
  'gu-prostate-adt-arpi::darolutamide': 2, 'gu-prostate-adt-arpi::prednisone-with-abiraterone': 2,
  'gu-prostate-docetaxel-mcrpc::prednisone': 2, 'gu-prostate-olaparib::olaparib': 2,
  'gyn-olaparib-maint::olaparib': 2, 'lung-alectinib::alectinib': 2, 'lung-alk-tki-other::crizotinib': 2,
  'rare-histiocytic-braf-mek::dabrafenib': 2, 'rare-mastocytosis-midostaurin::midostaurin': 2,
  'skin-melanoma-braf-mek-dab-tram::dabrafenib': 2, 'thyroid-anaplastic-dab-tram::dabrafenib': 2,
  'thyroid-medullary-selpercatinib::selpercatinib': 2
};
const FREQ_LABEL = { 2: 'BID', 3: 'TID', 4: 'QID' };
function detectFreq(protocolId, drug) {
  const n = FREQ_MAP[protocolId + '::' + drug.id];
  return n ? { dosesPerDay: n, frequency: FREQ_LABEL[n] } : null;
}

function coerceCycles(c) {
  if (typeof c === 'number' && isFinite(c)) return { cycles: c, note: null };
  const m = /(\d+)/.exec(String(c || ''));           // leading count if the prose starts with one
  return { cycles: m ? parseInt(m[1], 10) : 1, note: (typeof c === 'string' && c.trim()) ? c.trim() : null };
}

function pickSource(ev) {
  ev = ev || {};
  const all = [].concat(ev.core || [], ev.guideline || [], ev.institutional || []);
  const names = all.map(function (e) { return e && e.source; }).filter(Boolean);
  const nccn = names.find(function (n) { return /nccn|standard guidelines/i.test(n); }) || names[0] || null;
  const textbook = names.find(function (n) { return /devita|harrison/i.test(n); }) || null;
  return { nccn: nccn, textbook: textbook };
}

// Drop keys that are null/undefined/"" (runtime protocol.schema.json types caps/roundingRule as object,
// source fields/diseaseId as string, etc. - absent is valid, null is not). Matches rchop.json's shape.
function stripNull(o) {
  const out = {};
  for (const k in o) if (o[k] != null && o[k] !== '') out[k] = o[k];
  return out;
}
const RUNTIME_BASIS = { bsa: 1, auc: 1, mgkg: 1, flat: 1 };

const files = fs.readdirSync(SRC).filter(function (f) { return f.endsWith('.json'); });
const index = [{ id: 'rchop', name: 'R-CHOP', diseaseId: 'dlbcl', version: '0.1-skeleton', lifecycleState: 'draft' }];
const freqLog = [], problems = [], defaults = [];
let promoted = 0, skipped = 0;

for (const f of files) {
  const p = JSON.parse(fs.readFileSync(SRC + '/' + f, 'utf8'));
  if ((p.verifyFields || []).length) { skipped++; continue; }   // only zero-VERIFY
  const reg = p.regimen || {};

  // Guard: every drug must satisfy the runtime schema (basis enum, numeric dose). A zero-VERIFY
  // protocol should always pass, but fail-closed - skip (don't ship) any that doesn't, and log it.
  const bad = (reg.drugs || []).filter(function (d) { return !RUNTIME_BASIS[d.basis] || typeof d.dosePerUnit !== 'number'; });
  if (bad.length) { problems.push(p.id + ': ' + bad.length + ' drug(s) with non-runtime basis/dose - NOT promoted'); skipped++; continue; }

  const cyc = coerceCycles(reg.cycles);
  const clen = (Number.isInteger(reg.cycleLengthDays) && reg.cycleLengthDays >= 1) ? reg.cycleLengthDays : 28;
  if (clen === 28 && reg.cycleLengthDays == null) defaults.push(p.id + ': cycleLengthDays defaulted to 28 (continuous/absent in source)');
  const src = pickSource(p.evidence);

  const drugs = (reg.drugs || []).map(function (d) {
    const out = stripNull({
      id: d.id, name: d.name, basis: d.basis, dosePerUnit: d.dosePerUnit, unit: d.unit,
      route: d.route, notes: d.notes || '', provenance: d.provenance,
      caps: (d.caps && typeof d.caps === 'object') ? d.caps : null,
      roundingRule: (d.roundingRule && typeof d.roundingRule === 'object') ? d.roundingRule : null
    });
    out.days = d.days || [];
    out.modificationRules = d.modificationRules || [];
    const fq = detectFreq(p.id, d);
    if (fq) { out.dosesPerDay = fq.dosesPerDay; out.frequency = fq.frequency; freqLog.push(p.id + ' :: ' + d.name + ' -> ' + fq.frequency); }
    return out;
  });

  const tmpl = stripNull({
    id: p.id, diseaseId: p.diseaseId, name: p.name,
    version: p.protocolVersion || '1.0',
    lifecycleState: 'draft', experimental: true,
    intentOptions: p.treatmentIntent || ['palliative'],
    cycleLengthDays: clen,
    cycles: cyc.cycles,
    cyclesNote: cyc.note,
    caps: 'protocol',
    source: { nccn: String(src.nccn || 'Standard Guidelines (NCCN)'), textbook: String(src.textbook || '') },
    institution: { provenance: 'ONCQIS grounded Standard Protocol (experimental, owner/device test only; not clinically activated)', approval: null },
    biomarkers: p.biomarkers, stage: p.stage,
    treatmentSetting: p.treatmentSetting, histology: p.histology,
    premedications: reg.premedications || [],
    supportiveCare: reg.supportiveCare || [],
    monitoring: p.monitoring || [],
    clearanceChecks: p.clearanceChecks || [],
    doseModificationRules: p.doseModificationRules || [],
    drugs: drugs
  });
  fs.writeFileSync(OUT + '/' + p.id + '.json', JSON.stringify(tmpl, null, 2) + '\n');
  index.push(stripNull({ id: p.id, name: p.name, diseaseId: p.diseaseId, version: tmpl.version, lifecycleState: 'draft', experimental: true }));
  promoted++;
}

fs.writeFileSync(OUT + '/index.json', JSON.stringify({
  _note: 'rchop is the hand-listed Phase-4 skeleton (draft). experimental:true entries are grounded v2 protocols promoted for OWNER/DEVICE TEST behind smd_onco_protolib; none are lifecycleState:active. Regenerated by tmp/promote.js.',
  protocols: index
}, null, 2) + '\n');

console.log('promoted ' + promoted + ' (skipped ' + skipped + '); index has ' + index.length + ' entries');
if (problems.length) { console.log('\nPROBLEMS (not promoted):'); problems.forEach(function (l) { console.log('  ' + l); }); }
if (defaults.length) { console.log('\ndefaulted cycleLengthDays (' + defaults.length + '):'); defaults.forEach(function (l) { console.log('  ' + l); }); }
console.log('\nBID/TID/QID drugs tagged (' + freqLog.length + '):');
freqLog.sort().forEach(function (l) { console.log('  ' + l); });
