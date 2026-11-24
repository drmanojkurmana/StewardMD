// Real-browser headless test: ResearchMD Phase 3 screens end to end.
// The research API is mocked in-process from the frozen Phase 3 contracts
// (docs/research/contracts/phase-3/extraction.md, rob.md, data-import.md) and a
// fixture worker result.json (extract.py shape). Covers: offline PDF page
// render + page jump + locator highlight + select-to-quote, extraction verify /
// correct with audit, suggestion never auto-applied or auto-verified, promote
// gate (no unverified value reaches analysis), RoB blinding + consensus +
// traffic-light, CSV import errors, responsive 375 / 768 / 1024, no horizontal
// overflow, no em-dash, no page errors, Escape.
//   node test/run-research-phase3-ui.mjs   (CHROME=/path/to/chrome to override)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFile } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => existsSync(p));

const PORT = 9096, CDP = 9496, OUT = '/tmp/stewardmd-research-phase3';
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};
const PID = 'prj_bcg_1994';
const T0 = 1763000000000;

/* ---------------- fixture worker result.json (extract.py shape) ---------------- */
function makeWords(text, x, y) {
  const out = [];
  let cx = x;
  for (const t of text.split(' ')) {
    const w = t.length * 6.2;
    out.push({ t, x0: +cx.toFixed(2), y0: y, x1: +(cx + w).toFixed(2), y1: y + 11 });
    cx += w + 4;
  }
  return out;
}
const RESULT = {
  jobId: 'job_1', idempotencyKey: 'k1', status: 'done', usage: { pages: 2, seconds: 1.5 },
  ocr: true, sha256: 'a'.repeat(64),
  pages: [
    { n: 1, width: 612, height: 792, ocr: false, text: 'TB cases in vaccinated 4 of 123 control 11 of 139',
      words: makeWords('TB cases in vaccinated 4 of 123 control 11 of 139', 72, 100),
      tables: [{ bbox: [72, 140, 540, 220], rows: [['Group', 'Cases', 'N'], ['Vaccine', '4', '123'], ['Control', '11', '139']] }] },
    { n: 2, width: 612, height: 792, ocr: true, text: 'Revaccination assessed in adolescents',
      words: makeWords('Revaccination assessed in adolescents', 72, 100), tables: [] }
  ]
};

/* ---------------- contract mock: in-memory research API ---------------- */
const TEMPLATES = [
  { id: 'rct_binary', label: 'RCT binary outcome', measures: ['RR', 'OR', 'RD'], fields: [
    { key: 'events1', label: 'Events (intervention)', type: 'integer', required: true },
    { key: 'n1', label: 'N (intervention)', type: 'integer', required: true },
    { key: 'events2', label: 'Events (control)', type: 'integer', required: true },
    { key: 'n2', label: 'N (control)', type: 'integer', required: true } ] },
  { id: 'rct_continuous', label: 'RCT continuous outcome', measures: ['MD', 'SMD'], fields: [
    { key: 'mean1', label: 'Mean (intervention)', type: 'number', required: true },
    { key: 'sd1', label: 'SD (intervention)', type: 'number', required: true },
    { key: 'n1', label: 'N (intervention)', type: 'integer', required: true },
    { key: 'mean2', label: 'Mean (control)', type: 'number', required: true },
    { key: 'sd2', label: 'SD (control)', type: 'number', required: true },
    { key: 'n2', label: 'N (control)', type: 'integer', required: true } ] },
  { id: 'generic_effect', label: 'Generic effect', measures: ['RR', 'OR', 'HR', 'MD', 'SMD'], fields: [
    { key: 'yi', label: 'log effect (yi)', type: 'number', required: false },
    { key: 'se', label: 'Standard error', type: 'number', required: false },
    { key: 'effect', label: 'Reported effect', type: 'number', required: false },
    { key: 'ciLower', label: 'CI lower', type: 'number', required: false },
    { key: 'ciUpper', label: 'CI upper', type: 'number', required: false },
    { key: 'ciLevel', label: 'CI level', type: 'number', required: false } ] }
];
const pdfLoc = (page, box, quote) => ({ kind: 'pdf', citation: 'Aronson 1948', page, quote, pdf: { artifactId: 'art_1', page, box } });
const verifiedField = (value, page, quote) => ({ value, locator: pdfLoc(page, { x: 0.1, y: 0.12, w: 0.4, h: 0.02 }, quote), quote, status: 'verified', source: 'human', verifier: 'u_self', verifiedAt: T0 });

const db = {
  studies: [
    { id: 'st_1', projectId: PID, label: 'Aronson 1948', measure: 'RR', inputs: {}, locator: { kind: 'manual', citation: 'Aronson 1948' }, verified: false, version: 1, artifactId: 'art_1', createdAt: T0, updatedAt: T0 },
    { id: 'st_2', projectId: PID, label: 'Ferguson 1949', measure: 'RR', inputs: {}, locator: { kind: 'manual', citation: 'Ferguson 1949' }, verified: false, version: 1, artifactId: 'art_1', createdAt: T0, updatedAt: T0 }
  ],
  artifacts: [ { id: 'art_1', projectId: PID, filename: 'aronson1948.pdf', sha256: 'a'.repeat(64), bytes: 100000, pages: 2, status: 'succeeded', jobId: 'job_1', createdTs: T0 } ],
  extractions: {
    st_1: { id: 'ext_1', projectId: PID, studyId: 'st_1', artifactId: 'art_1', template: 'rct_binary', status: 'draft', version: 1,
      fields: {}, suggestions: [ { id: 'sug_1', fieldKey: 'events1', value: 4, locator: pdfLoc(1, { x: 0.11, y: 0.12, w: 0.05, h: 0.02 }, 'vaccinated 4 of 123'), quote: 'vaccinated 4 of 123', model: 't1-mock', status: 'unverified', createdTs: T0 } ],
      createdBy: 'u_self', createdTs: T0, updatedTs: T0 },
    st_2: { id: 'ext_2', projectId: PID, studyId: 'st_2', artifactId: 'art_1', template: 'rct_binary', status: 'verified', version: 1,
      fields: { events1: verifiedField(6, 1, '6 cases in 306'), n1: verifiedField(306, 1, '306 infants'), events2: verifiedField(29, 1, '29 cases in 303'), n2: verifiedField(303, 1, '303 infants') },
      suggestions: [], createdBy: 'u_self', createdTs: T0, updatedTs: T0 }
  },
  audit: { ext_1: [], ext_2: [] },
  rob: { 'st_1:rob2': { self: null, peer: { submitted: true, overall: 'high', domains: [
    { key: 'd1', judgment: 'high', quote: 'allocation not concealed', locator: { kind: 'manual', citation: 'Aronson 1948', page: '3', quote: 'allocation not concealed' } },
    { key: 'd2', judgment: 'low', quote: 'blinded', locator: { kind: 'manual', citation: 'Aronson 1948', page: '3', quote: 'blinded' } },
    { key: 'd3', judgment: 'low', quote: 'complete follow-up', locator: { kind: 'manual', citation: 'Aronson 1948', page: '4', quote: 'complete follow-up' } },
    { key: 'd4', judgment: 'low', quote: 'objective outcome', locator: { kind: 'manual', citation: 'Aronson 1948', page: '4', quote: 'objective outcome' } },
    { key: 'd5', judgment: 'low', quote: 'pre-specified', locator: { kind: 'manual', citation: 'Aronson 1948', page: '5', quote: 'pre-specified' } } ] } } },
  robConflicts: [],
  dictionary: { version: 1, columns: [
    { column: 'study_id', label: 'Study ID', type: 'string', required: true },
    { column: 'events1', label: 'Events intervention', type: 'integer', required: true, range: { min: 0, max: 1000000 } },
    { column: 'n1', label: 'N intervention', type: 'integer', required: true, range: { min: 1, max: 10000000 } },
    { column: 'events2', label: 'Events control', type: 'integer', required: true, range: { min: 0, max: 1000000 } },
    { column: 'n2', label: 'N control', type: 'integer', required: true, range: { min: 1, max: 10000000 } } ] },
  imports: [],
  uploads: {}
};
let idSeq = 0;
const nid = (p) => `${p}_${++idSeq}`;

const ROB_TOOLS = [
  { id: 'rob2', name: 'RoB 2', source: 'Sterne et al BMJ 2019;366:l4898', overallRule: 'worst_domain_rob2', domains: [
    { key: 'd1', label: 'Randomization process', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [{ key: '1.1', text: 'Was the allocation sequence random?' }, { key: '1.2', text: 'Was the allocation sequence concealed?' }] },
    { key: 'd2', label: 'Deviations from intended interventions', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [{ key: '2.1', text: 'Were participants aware of their assigned intervention?' }] },
    { key: 'd3', label: 'Missing outcome data', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [{ key: '3.1', text: 'Were data for nearly all participants available?' }] },
    { key: 'd4', label: 'Measurement of the outcome', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [{ key: '4.1', text: 'Was the method of measuring the outcome inappropriate?' }] },
    { key: 'd5', label: 'Selection of the reported result', judgments: ['low', 'some_concerns', 'high'], signallingQuestions: [{ key: '5.1', text: 'Were data analysed per a pre-specified plan?' }] } ] },
  { id: 'robins_i', name: 'ROBINS-I', source: 'Sterne et al BMJ 2016;355:i4919', overallRule: 'worst_domain', domains: [
    { key: 'd1', label: 'Confounding', judgments: ['low', 'moderate', 'serious', 'critical', 'no_information'], signallingQuestions: [{ key: '1.1', text: 'Is there potential for confounding?' }] },
    { key: 'd2', label: 'Selection of participants', judgments: ['low', 'moderate', 'serious', 'critical', 'no_information'], signallingQuestions: [] },
    { key: 'd3', label: 'Classification of interventions', judgments: ['low', 'moderate', 'serious', 'critical', 'no_information'], signallingQuestions: [] },
    { key: 'd4', label: 'Deviations from intended interventions', judgments: ['low', 'moderate', 'serious', 'critical', 'no_information'], signallingQuestions: [] },
    { key: 'd5', label: 'Missing data', judgments: ['low', 'moderate', 'serious', 'critical', 'no_information'], signallingQuestions: [] },
    { key: 'd6', label: 'Measurement of outcomes', judgments: ['low', 'moderate', 'serious', 'critical', 'no_information'], signallingQuestions: [] },
    { key: 'd7', label: 'Selection of the reported result', judgments: ['low', 'moderate', 'serious', 'critical', 'no_information'], signallingQuestions: [] } ] },
  { id: 'quadas2', name: 'QUADAS-2', source: 'Whiting et al Ann Intern Med 2011;155:529-536', overallRule: 'domain_level', domains: [
    { key: 'patient_selection', label: 'Patient selection', judgments: ['low', 'high', 'unclear'], applicability: true, signallingQuestions: [{ key: 'ps1', text: 'Was a consecutive or random sample enrolled?' }] },
    { key: 'index_test', label: 'Index test', judgments: ['low', 'high', 'unclear'], applicability: true, signallingQuestions: [] },
    { key: 'reference_standard', label: 'Reference standard', judgments: ['low', 'high', 'unclear'], applicability: true, signallingQuestions: [] },
    { key: 'flow_timing', label: 'Flow and timing', judgments: ['low', 'high', 'unclear'], applicability: false, signallingQuestions: [] } ] },
  { id: 'nos', name: 'Newcastle-Ottawa', source: 'Wells et al, Ottawa Hospital Research Institute', overallRule: 'stars_threshold', domains: [
    { key: 'sel1', label: 'Representativeness of the exposed cohort', maxStars: 1 },
    { key: 'sel2', label: 'Selection of the non-exposed cohort', maxStars: 1 },
    { key: 'sel3', label: 'Ascertainment of exposure', maxStars: 1 },
    { key: 'sel4', label: 'Outcome not present at start', maxStars: 1 },
    { key: 'comp1', label: 'Comparability of cohorts', maxStars: 2 },
    { key: 'out1', label: 'Assessment of outcome', maxStars: 1 },
    { key: 'out2', label: 'Follow-up long enough', maxStars: 1 },
    { key: 'out3', label: 'Adequacy of follow-up', maxStars: 1 } ] }
];

function extById(id) { for (const k in db.extractions) if (db.extractions[k].id === id) return db.extractions[k]; return null; }
function studyById(id) { return db.studies.find((s) => s.id === id) || null; }

function robOverall(tool, domains) {
  const j = domains.map((d) => d.judgment);
  if (tool === 'rob2') {
    if (j.includes('high')) return 'high';
    const sc = j.filter((x) => x === 'some_concerns').length;
    if (sc >= 2) return 'high';
    if (sc === 1) return 'some_concerns';
    return 'low';
  }
  if (tool === 'robins_i') {
    for (const w of ['critical', 'serious', 'moderate', 'low']) if (j.includes(w)) return w;
    return 'no_information';
  }
  if (tool === 'quadas2') { if (j.includes('high')) return 'high'; if (j.includes('unclear')) return 'unclear'; return 'low'; }
  const stars = domains.reduce((a, d) => a + (d.stars || 0), 0);
  return stars >= 7 ? 'low' : stars >= 5 ? 'some_concerns' : 'high';
}
function robAssessment(studyId, tool) {
  const rec = db.rob[`${studyId}:${tool}`] || { self: null, peer: null };
  const both = !!(rec.self && rec.self.submitted && rec.peer && rec.peer.submitted);
  const conf = db.robConflicts.find((c) => c.studyId === studyId && c.tool === tool) || null;
  let outcome = 'pending';
  if (both) outcome = conf ? (conf.status === 'open' ? 'conflict' : 'agreed') : 'agreed';
  const a = { studyId, tool, outcome, conflictId: conf ? conf.id : null,
    self: rec.self ? { submitted: true, domains: rec.self.domains, overall: robOverall(tool, rec.self.domains) } : { submitted: false, domains: [] },
    peer: both ? { submitted: true, domains: rec.peer.domains, overall: robOverall(tool, rec.peer.domains) } : { hidden: true } };
  if (conf && conf.status === 'resolved') a.consensus = { submitted: true, domains: conf.domains, overall: robOverall(tool, conf.domains) };
  return a;
}

function validateCsv(text, dict) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  const header = lines[0].split(',').map((s) => s.trim());
  const checks = [];
  const seen = {};
  let imported = 0;
  const colBy = {}; for (const c of dict.columns) colBy[c.column] = c;
  for (const h of header) if (!colBy[h]) checks.push({ code: 'unknown_column', severity: 'warning', row: null, column: h, message: `Column "${h}" has no dictionary entry` });
  for (const c of dict.columns) if (!header.includes(c.column)) checks.push({ code: 'missing_column', severity: 'warning', row: null, column: c.column, message: `Dictionary column "${c.column}" is absent from the CSV` });
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(',');
    const row = {}; header.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
    let rowOk = true;
    for (const c of dict.columns) {
      const v = row[c.column];
      if (v === undefined || v === '') {
        if (c.required) { checks.push({ code: 'missing_required', severity: 'error', row: r, column: c.column, message: `Required value missing in row ${r}` }); rowOk = false; }
        else checks.push({ code: 'missing_optional', severity: 'warning', row: r, column: c.column, message: `Optional value empty in row ${r}` });
        continue;
      }
      if (c.type === 'integer' || c.type === 'number') {
        const num = Number(v);
        if (!isFinite(num) || (c.type === 'integer' && !Number.isInteger(num))) { checks.push({ code: 'type_mismatch', severity: 'error', row: r, column: c.column, message: `"${v}" is not a valid ${c.type}` }); rowOk = false; continue; }
        if (c.range && (num < c.range.min || num > c.range.max)) { checks.push({ code: 'out_of_range', severity: 'error', row: r, column: c.column, message: `${v} is outside the allowed range ${c.range.min} to ${c.range.max}` }); rowOk = false; }
      }
      if (c.type === 'category' && c.allowed && !c.allowed.includes(v)) { checks.push({ code: 'not_allowed', severity: 'error', row: r, column: c.column, message: `"${v}" is not an allowed value` }); rowOk = false; }
    }
    const sid = row.study_id;
    if (sid) { if (seen[sid]) { checks.push({ code: 'duplicate_study_id', severity: 'error', row: r, column: 'study_id', message: `Duplicate study_id "${sid}"` }); rowOk = false; } seen[sid] = true; }
    if (rowOk) imported++;
  }
  const errs = checks.filter((c) => c.severity === 'error').length;
  const warns = checks.filter((c) => c.severity === 'warning').length;
  return { rowCount: lines.length - 1, rowsImported: imported, checks, status: errs ? 'errors' : warns ? 'warnings' : 'ok' };
}

function envelope(code, message, status) { return { status, body: { error: { code, message, requestId: 'req_mock' } } }; }
function multipartFile(raw, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = '--' + (m[1] || m[2]);
  const parts = raw.split(boundary);
  for (const part of parts) {
    const idx = part.indexOf('\r\n\r\n');
    if (idx < 0) continue;
    const head = part.slice(0, idx);
    if (/name="file"/.test(head)) {
      let body = part.slice(idx + 4);
      if (body.endsWith('\r\n')) body = body.slice(0, -2);
      return body;
    }
  }
  return null;
}

async function handleApi(req, res, path, query) {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const chunks = []; for await (const c of req) chunks.push(c);
  const rawBuf = Buffer.concat(chunks); const raw = rawBuf.toString('utf8');
  let body = null;
  if (req.method === 'POST' || req.method === 'PUT') { try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; } }
  const m = (re) => path.match(re); let mm;

  /* studies + templates + artifacts */
  if (path === `/v1/projects/${PID}/studies` && req.method === 'GET') return send(200, { studies: db.studies });
  if (path === '/v1/extraction-templates' && req.method === 'GET') return send(200, { templates: TEMPLATES });
  if (path === `/v1/projects/${PID}/artifacts` && req.method === 'GET') return send(200, { artifacts: db.artifacts });
  if ((mm = m(/^\/v1\/artifacts\/([^/]+)\/result$/)) && req.method === 'GET') {
    const art = db.artifacts.find((a) => a.id === mm[1]);
    if (!art) return send(404, envelope('artifact_not_found', 'No such artifact', 404).body);
    if (art.status !== 'succeeded') return send(409, envelope('job_not_done', 'Job not finished', 409).body);
    return send(200, RESULT);
  }
  if ((mm = m(/^\/v1\/jobs\/([^/]+)$/)) && req.method === 'GET') return send(200, { job: { id: mm[1], projectId: PID, kind: 'pdf_extract', status: 'succeeded', usage: { pages: 2, seconds: 1.5 }, createdTs: T0, completedTs: T0 } });

  /* extraction per study */
  if ((mm = m(/^\/v1\/projects\/[^/]+\/studies\/([^/]+)\/extraction$/))) {
    const sid = mm[1];
    if (req.method === 'GET') {
      let ex = db.extractions[sid];
      if (!ex) { ex = { id: nid('ext'), projectId: PID, studyId: sid, artifactId: null, template: query.get('template') || 'rct_binary', status: 'draft', version: 0, fields: {}, suggestions: [], createdTs: T0, updatedTs: T0 }; db.extractions[sid] = ex; db.audit[ex.id] = []; }
      return send(200, { extraction: ex });
    }
    if (req.method === 'PUT') {
      const ex = db.extractions[sid];
      if (!ex) return send(404, envelope('extraction_not_found', 'No such extraction', 404).body);
      if (body.version !== ex.version) return send(409, { error: { code: 'stale_version', message: 'Extraction changed on the server', requestId: 'req_mock' }, current: { extraction: ex } });
      ex.template = body.template || ex.template;
      if (body.artifactId !== undefined) ex.artifactId = body.artifactId;
      for (const k in (body.fields || {})) {
        const f = body.fields[k];
        ex.fields[k] = { value: f.value, locator: f.locator || null, quote: f.quote || '', status: 'unverified', source: 'human', verifier: null, verifiedAt: null };
        db.audit[ex.id].push({ kind: 'field_saved', fieldKey: k, by: 'u_self', ts: Date.now() });
      }
      ex.version++; ex.updatedTs = Date.now();
      return send(200, { extraction: ex });
    }
  }
  if ((mm = m(/^\/v1\/extractions\/([^/]+)\/verify$/)) && req.method === 'POST') {
    const ex = extById(mm[1]); if (!ex) return send(404, envelope('extraction_not_found', 'No such extraction', 404).body);
    const keys = body.fieldKey ? [body.fieldKey] : Object.keys(ex.fields);
    for (const k of keys) {
      const f = ex.fields[k]; if (!f) continue;
      if (f.value == null || f.value === '' || !f.locator || !f.quote) return send(422, envelope('locator_required', 'A value needs a locator and a quote before verification', 422).body);
      f.status = 'verified'; f.verifier = 'u_self'; f.verifiedAt = Date.now();
      db.audit[ex.id].push({ kind: 'verified', fieldKey: k, by: 'u_self', ts: Date.now() });
    }
    ex.version++; ex.status = 'verified';
    return send(200, { extraction: ex });
  }
  if ((mm = m(/^\/v1\/extractions\/([^/]+)\/correct$/)) && req.method === 'POST') {
    const ex = extById(mm[1]); if (!ex) return send(404, envelope('extraction_not_found', 'No such extraction', 404).body);
    if (!body.fieldKey || body.value === undefined || !body.reason) return send(400, envelope('invalid_correction', 'fieldKey, value and reason required', 400).body);
    const f = ex.fields[body.fieldKey] || {};
    const old = f.value;
    ex.fields[body.fieldKey] = { value: body.value, locator: body.locator || f.locator || null, quote: body.quote || f.quote || '', status: 'corrected', source: 'human', verifier: 'u_self', verifiedAt: Date.now() };
    db.audit[ex.id].push({ kind: 'corrected', fieldKey: body.fieldKey, old, new: body.value, reason: body.reason, by: 'u_self', ts: Date.now() });
    ex.version++;
    return send(200, { extraction: ex });
  }
  if ((mm = m(/^\/v1\/extractions\/([^/]+)\/audit$/)) && req.method === 'GET') {
    const ex = extById(mm[1]); if (!ex) return send(404, envelope('extraction_not_found', 'No such extraction', 404).body);
    return send(200, { events: (db.audit[ex.id] || []).slice().sort((a, b) => b.ts - a.ts) });
  }
  if ((mm = m(/^\/v1\/extractions\/([^/]+)\/suggestions\/([^/]+)\/accept$/)) && req.method === 'POST') {
    const ex = extById(mm[1]); if (!ex) return send(404, envelope('extraction_not_found', 'No such extraction', 404).body);
    const i = ex.suggestions.findIndex((s) => s.id === mm[2]);
    if (i < 0) return send(404, envelope('extraction_not_found', 'No such suggestion', 404).body);
    const s = ex.suggestions[i];
    ex.fields[s.fieldKey] = { value: s.value, locator: s.locator || null, quote: s.quote || '', status: 'unverified', source: 'suggestion', verifier: null, verifiedAt: null };
    ex.suggestions.splice(i, 1);
    db.audit[ex.id].push({ kind: 'suggestion_accepted', fieldKey: s.fieldKey, by: 'u_self', ts: Date.now() });
    ex.version++;
    return send(200, { extraction: ex });
  }
  if ((mm = m(/^\/v1\/extractions\/([^/]+)\/promote$/)) && req.method === 'POST') {
    const ex = extById(mm[1]); if (!ex) return send(404, envelope('extraction_not_found', 'No such extraction', 404).body);
    const tpl = TEMPLATES.find((t) => t.id === ex.template);
    const required = tpl.fields.filter((f) => f.required).map((f) => f.key);
    for (const k of required) {
      const f = ex.fields[k];
      if (!f || (f.status !== 'verified' && f.status !== 'corrected')) return send(422, envelope('extraction_unverified', 'A required field is unverified; no AI value reaches analysis unverified', 422).body);
    }
    const num = (k) => Number(ex.fields[k].value);
    const inputs = ex.template === 'rct_binary' ? { events1: num('events1'), n1: num('n1'), events2: num('events2'), n2: num('n2') } : { yi: num('yi'), se: num('se') };
    const locKey = body.locatorFieldKey || required[0];
    const study = studyById(ex.studyId);
    study.measure = body.measure; study.inputs = inputs; study.locator = ex.fields[locKey].locator; study.quote = ex.fields[locKey].quote;
    study.verified = true; study.verifiedBy = 'u_self'; study.verifiedAt = Date.now(); study.version++; study.updatedAt = Date.now();
    db.audit[ex.id].push({ kind: 'promoted', by: 'u_self', ts: Date.now() });
    return send(200, { study, requestId: 'req_mock' });
  }

  /* risk of bias */
  if (path === '/v1/rob-tools' && req.method === 'GET') return send(200, { tools: ROB_TOOLS });
  if ((mm = m(/^\/v1\/projects\/[^/]+\/studies\/([^/]+)\/rob$/))) {
    const sid = mm[1]; const tool = query.get('tool') || (body && body.tool) || 'rob2';
    if (req.method === 'GET') return send(200, { assessment: robAssessment(sid, tool) });
    if (req.method === 'POST') {
      for (const d of (body.domains || [])) if (!d.quote || !d.locator) return send(422, envelope('locator_required', 'Each domain needs a quote and locator', 422).body);
      const key = `${sid}:${tool}`;
      if (!db.rob[key]) db.rob[key] = { self: null, peer: null };
      const conf = db.robConflicts.find((c) => c.studyId === sid && c.tool === tool && c.status === 'open');
      if (conf) return send(409, envelope('conflict_open', 'Resolve the open conflict first', 409).body);
      db.rob[key].self = { submitted: true, domains: body.domains };
      const rec = db.rob[key];
      let outcome = 'pending';
      if (rec.peer && rec.peer.submitted) {
        const peerBy = {}; for (const d of rec.peer.domains) peerBy[d.key] = d.judgment;
        const disagree = body.domains.some((d) => peerBy[d.key] !== d.judgment);
        if (disagree) {
          const c = { id: nid('rc'), projectId: PID, studyId: sid, tool, status: 'open', createdTs: Date.now() };
          db.robConflicts.push(c); outcome = 'conflict';
          return send(200, { assessment: robAssessment(sid, tool), outcome, conflictId: c.id });
        }
        outcome = 'agreed';
      }
      return send(200, { assessment: robAssessment(sid, tool), outcome });
    }
  }
  if (path === `/v1/projects/${PID}/rob-conflicts` && req.method === 'GET') return send(200, { conflicts: db.robConflicts });
  if ((mm = m(/^\/v1\/rob-conflicts\/([^/]+)\/resolve$/)) && req.method === 'POST') {
    const c = db.robConflicts.find((x) => x.id === mm[1]);
    if (!c) return send(404, envelope('rob_conflict_not_found', 'No such conflict', 404).body);
    if (c.status === 'resolved') return send(409, envelope('already_decided', 'Already resolved', 409).body);
    if (!body.note) return send(400, envelope('invalid_correction', 'note required', 400).body);
    c.status = 'resolved'; c.domains = body.domains; c.note = body.note; c.resolvedBy = 'u_self'; c.resolvedTs = Date.now();
    return send(200, { conflict: c, assessment: robAssessment(c.studyId, c.tool) });
  }

  /* study-level data import */
  if (path === `/v1/projects/${PID}/data-dictionary` && req.method === 'GET') return send(200, { dictionary: db.dictionary });
  if (path === `/v1/projects/${PID}/data-dictionary` && req.method === 'PUT') {
    if (!body.columns || !body.columns.some((c) => c.column === 'study_id')) return send(422, envelope('invalid_dictionary', 'study_id column required', 422).body);
    db.dictionary = { version: db.dictionary.version + 1, columns: body.columns };
    return send(200, { dictionary: db.dictionary });
  }
  if (path === `/v1/projects/${PID}/data-uploads` && req.method === 'POST') {
    const text = multipartFile(raw, req.headers['content-type']);
    if (text == null) return send(400, envelope('missing_file', 'file field required', 400).body);
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
    const columns = lines.length ? lines[0].split(',').map((s) => s.trim()) : [];
    const storageKey = `projects/${PID}/data/${nid('sha')}.csv`;
    db.uploads[storageKey] = text;
    return send(201, { storageKey, sha256: 'b'.repeat(64), bytes: text.length, rowCount: Math.max(0, lines.length - 1), columns });
  }
  if (path === `/v1/projects/${PID}/data-imports` && req.method === 'POST') {
    const text = db.uploads[body.storageKey];
    if (text == null) return send(404, envelope('import_not_found', 'Upload not found', 404).body);
    const v = validateCsv(text, db.dictionary);
    const imp = { id: nid('imp'), projectId: PID, version: db.imports.length + 1, storageKey: body.storageKey,
      snapshotKey: `projects/${PID}/data/snapshots/imp_${idSeq}.csv`, rowCount: v.rowCount, rowsImported: v.rowsImported,
      status: v.status, checks: v.checks, dictionaryVersion: db.dictionary.version, frozen: false, frozenTs: null, createdBy: 'u_self', createdTs: Date.now() };
    db.imports.unshift(imp);
    return send(201, { import: imp });
  }
  if (path === `/v1/projects/${PID}/data-imports` && req.method === 'GET') return send(200, { imports: db.imports });
  if ((mm = m(/^\/v1\/data-imports\/([^/]+)\/freeze$/)) && req.method === 'POST') {
    const imp = db.imports.find((i) => i.id === mm[1]);
    if (!imp) return send(404, envelope('import_not_found', 'No such import', 404).body);
    if (imp.frozen) return send(409, envelope('already_frozen', 'Already frozen', 409).body);
    imp.frozen = true; imp.frozenTs = Date.now();
    return send(200, { import: imp });
  }
  if ((mm = m(/^\/v1\/data-imports\/([^/]+)$/)) && req.method === 'GET') {
    const imp = db.imports.find((i) => i.id === mm[1]);
    if (!imp) return send(404, envelope('import_not_found', 'No such import', 404).body);
    return send(200, { import: imp });
  }

  return send(404, envelope('not_found', 'Unknown Research API endpoint', 404).body);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/research/')) {
    try { await handleApi(req, res, p.slice('/api/research'.length), u.searchParams); }
    catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'mock_error', message: String(e && e.message || e) } })); }
    return;
  }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store, no-cache, must-revalidate' });
    res.end(data);
  });
}).listen(PORT);

/* ---------------- CDP harness (same pattern as run-research-phase2-ui.mjs) ---------------- */
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd3-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
], { stdio: 'ignore' });

let ws, sid, id = 0, failures = 0;
const pending = new Map();
const pageErrors = [];
const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id; pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
const ok = (pass, label) => { console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failures++; };
const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) { try { if (await ev(expr)) return true; } catch { /* page busy */ } await sleep(100); }
  return false;
};
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const setVal = (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const nav = (screen) => ev(`SMD_RESEARCH.navigate(${JSON.stringify(screen)});1`);
const selectWords = (a, b) => ev(`(()=>{const w=document.querySelector('#rmdPdfScroll');if(!w)return false;const ws=w.querySelectorAll('.rmd-pdf-word');if(ws.length<${b + 1})return false;const r=document.createRange();r.setStartBefore(ws[${a}]);r.setEndAfter(ws[${b}]);const s=getSelection();s.removeAllRanges();s.addRange(r);return true})()`);
const fieldStatus = (key) => ev(`(()=>{const r=document.querySelector('[data-rmd-fieldrow="${key}"]');const p=r&&r.querySelector('.rmd-status-pill');return p?p.textContent:''})()`);
async function shot(name) {
  await sleep(150);
  await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`);
  await mkdir(OUT, { recursive: true });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}
const noOverflow = () => ev(`(()=>{const b=document.getElementById('researchMD');return b.scrollWidth<=b.clientWidth+2})()`);
const noEmDash = async () => !/—/.test(await text('#researchMD'));

try {
  let version;
  for (let i = 0; i < 60; i++) { try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    // Real JS crashes always count. Network resource logs (app-boot endpoints
    // outside the research mock, and expected 4xx API gate responses) are not
    // page errors; the Phase 2 harness ignores the same boot 404s.
    if (msg.method === 'Runtime.exceptionThrown') pageErrors.push('JS: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && msg.params.entry.source !== 'network') pageErrors.push((msg.params.entry.url || '') + ' :: ' + msg.params.entry.text.slice(0, 160));
  };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;
  await call('Runtime.enable'); await call('Log.enable'); await call('Page.enable');

  await call('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 2, mobile: false });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.pdf && !!SMD_RESEARCH.screens.extract && !!SMD_RESEARCH.screens.rob && !!SMD_RESEARCH.screens.data', 30000), 'app loaded with all four Phase 3 screens');
  ok(await ev(`!!document.querySelector('script[src*="research-screen-pdf.js?v=rmd3"]') && !!document.querySelector('script[src*="research-screen-extract.js?v=rmd3"]') && !!document.querySelector('script[src*="research-screen-rob.js?v=rmd3"]') && !!document.querySelector('script[src*="research-screen-data.js?v=rmd3"]')`), 'index.html carries the four new script tags with ?v=rmd3');
  await ev(`SMD_RESEARCH.open({screen:'pdf'});1`);

  /* 1. PDF viewer: offline render, page jump, highlight, select-to-quote */
  ok(await until(`!!document.querySelector('#rmdPdfScroll .rmd-pdf-page')`, 8000), 'PDF page renders offline from result.json word boxes');
  ok(await ev(`document.querySelectorAll('#rmdPdfScroll .rmd-pdf-word').length >= 8`), 'page text laid out as positioned words');
  ok(await until(`/vaccinated/.test(document.querySelector('#rmdPdfScroll').textContent) && /123/.test(document.querySelector('#rmdPdfScroll').textContent)`, 3000), 'page 1 text present');
  await setVal('#rmdPdfPage', '2');
  ok(await until(`/Revaccination/.test(document.querySelector('#rmdPdfScroll').textContent)`, 5000), 'page jump renders page 2');
  ok(await until(`!!document.querySelector('.rmd-pdf-ocr')`, 3000), 'OCR page flagged');
  await setVal('#rmdPdfPage', '1');
  await until(`/vaccinated/.test(document.querySelector('#rmdPdfScroll').textContent)`, 5000);
  ok(await selectWords(0, 3), 'select words on the page');
  await click('[data-rmd="pdf-highlight-sel"]');
  ok(await until(`!!document.querySelector('#rmdPdfScroll .rmd-pdf-highlight')`, 3000), 'locator highlight overlay drawn from the selection box');
  ok(await until(`/Captured quote/.test(document.querySelector('.rmd-pdf-side').textContent)`, 3000), 'select-to-quote captures a verbatim quote');
  await shot('tablet-1024-pdf');

  /* 2. Extraction: suggestion gate, capture, verify, correct + audit, promote */
  await nav('extract');
  ok(await until(`!!document.querySelector('[data-rmd-fieldrow="events1"]') && !!document.querySelector('#rmdPdfScroll .rmd-pdf-page')`, 8000), 'extraction form renders beside the page view');
  ok(await until(`!!document.querySelector('.rmd-suggestion') && /Suggestion/.test(document.querySelector('.rmd-suggestion').textContent)`, 3000), 'AI suggestion labelled "Suggestion"');
  ok(await ev(`document.querySelector('[data-rmd-field="events1"]').value === ''`) && /Unverified/.test(await fieldStatus('events1')), 'suggestion is NOT auto-applied: field empty and unverified');
  await click('[data-rmd-accept="sug_1"]');
  ok(await until(`document.querySelector('[data-rmd-field="events1"]').value === '4'`, 5000), 'accept moves the suggestion value into the field');
  ok(/Unverified/.test(await fieldStatus('events1')), 'accepted suggestion stays unverified (never auto-verified)');
  await selectWords(0, 3);
  await click('[data-rmd-capture="events1"]');
  ok(await until(`!!document.querySelector('[data-rmd-fieldrow="events1"] .rmd-quote-block')`, 3000), 'capture quote pins a locator + verbatim quote on the field');
  await click('[data-rmd-verify="events1"]');
  ok(await until(`/Verified/.test((()=>{const r=document.querySelector('[data-rmd-fieldrow="events1"] .rmd-status-pill');return r?r.textContent:''})())`, 5000), 'verify marks the field verified');
  await click('[data-rmd="extract-promote"]');
  ok(await until(`/unverified/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'promote blocked while required fields are unverified (no AI value reaches analysis)');
  await click('[data-rmd-correct="events1"]');
  ok(await until(`!!document.querySelector('#rmdCorrectReason_events1')`, 3000), 'correct opens a reason field');
  await setVal('#rmdCorrectValue_events1', '5');
  await setVal('#rmdCorrectReason_events1', 'Re-read Table 2: 5 cases, not 4');
  await click('[data-rmd-correct-confirm="events1"]');
  ok(await until(`/Corrected/.test((()=>{const r=document.querySelector('[data-rmd-fieldrow="events1"] .rmd-status-pill');return r?r.textContent:''})())`, 5000), 'correction saved with status corrected');
  await click('[data-rmd="extract-audit"]');
  ok(await until(`!!document.querySelector('.rmd-audit-row') && /Re-read Table 2/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'audit shows the correction reason');
  ok(await ev(`(()=>{const rows=[...document.querySelectorAll('.rmd-audit-row')];return rows.some(r=>/4/.test(r.textContent)&&/5/.test(r.textContent))})()`), 'audit records old and new values');
  ok(await ev(`!(/Standard textbooks/.test(document.getElementById('researchMD').textContent))`), 'verbatim quotes and locators are not rewritten by the app-wide book scrubber (smd-books-keep)');
  await shot('tablet-1024-extract');
  // happy path: a fully verified extraction promotes to a study row
  await setVal('#rmdExtractStudy', 'st_2');
  ok(await until(`!!document.querySelector('[data-rmd-fieldrow="events1"]')`, 5000), 'second study loads');
  await click('[data-rmd="extract-promote"]');
  ok(await until(`/promoted to a study row/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'verified extraction promotes to an engine-ready study row');

  /* 3. Risk of bias: blinding, conflict, consensus, traffic-light, tools */
  await nav('rob');
  ok(await until(`!!document.querySelector('[data-rmd-domain="d1"]')`, 8000), 'RoB 2 domain forms render');
  ok(await ev(`document.querySelectorAll('[data-rmd-tool]').length === 4`), 'four tools offered (RoB 2, ROBINS-I, QUADAS-2, NOS)');
  ok(await until(`/Hidden until both assessors submit/.test(document.querySelector('.rmd-rob-summary-pane').textContent)`, 3000), 'blinded: peer assessment hidden before both submit');
  await shot('tablet-1024-rob-blinded');
  for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    await setVal(`[data-rmd-judgment="${d}"]`, 'low');
    await setVal(`[data-rmd-quote="${d}"]`, 'supporting text for ' + d);
    await setVal(`[data-rmd-page="${d}"]`, '3');
  }
  await click('[data-rmd="rob-submit"]');
  ok(await until(`/conflict/.test(document.querySelector('#rmdScreenBody').textContent)`, 6000), 'disagreeing second assessment opens a conflict');
  ok(await until(`!(/Hidden until both assessors submit/.test(document.querySelector('.rmd-rob-summary-pane').textContent))`, 3000), 'after both submit the peer assessment becomes visible');
  ok(await until(`!!document.querySelector('.rmd-light')`, 3000), 'traffic-light summary renders');
  ok(await until(`!!document.querySelector('.rmd-rob-consensus')`, 3000), 'consensus form offered for the open conflict');
  for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    await setVal(`[data-rmd-consensus="${d}"]`, 'low');
    await setVal(`[data-rmd-consensus-quote="${d}"]`, 'consensus text ' + d);
  }
  await setVal('#rmdRobNote', 'Agreed after re-reading the methods; allocation was concealed.');
  await click('[data-rmd="rob-resolve"]');
  ok(await until(`/Consensus recorded/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'consensus recorded and overall recomputed');
  ok(await until(`/Showing consensus judgments/.test(document.querySelector('#rmdScreenBody').textContent)`, 3000), 'summary shows consensus judgments');
  await click('[data-rmd-tool="nos"]');
  ok(await until(`!!document.querySelector('[data-rmd-star="sel1:1"]')`, 5000), 'Newcastle-Ottawa renders star items');
  await click('[data-rmd-tool="quadas2"]');
  ok(await until(`!!document.querySelector('[data-rmd-app="patient_selection"]')`, 5000), 'QUADAS-2 renders applicability concerns');
  await click('[data-rmd-tool="rob2"]');
  await until(`!!document.querySelector('[data-rmd-domain="d1"]')`, 5000);
  await shot('tablet-1024-rob-consensus');

  /* 4. Data import: dictionary, CSV checks, errors shown, versions, freeze */
  await nav('data');
  ok(await until(`!!document.querySelector('[data-rmd-coltype="study_id"]')`, 8000), 'data dictionary renders');
  await ev(`(()=>{const csv='study_id,events1,n1,events2,n2\\ns1,4,123,11,139\\ns2,6,0,29,303\\ns3,3,231,,220\\n';const f=new File([csv],'studies.csv',{type:'text/csv'});const input=document.getElementById('rmdDataFile');Object.defineProperty(input,'files',{value:[f],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  ok(await until(`/3 rows detected/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'CSV preview counts rows deterministically');
  await click('[data-rmd="data-import"]');
  ok(await until(`!!document.querySelector('.rmd-data-check-error')`, 8000), 'import validation errors are shown');
  ok(await until(`/out_of_range/.test(document.querySelector('#rmdScreenBody').textContent)`, 3000), 'out-of-range check reported');
  ok(await until(`/missing_required/.test(document.querySelector('#rmdScreenBody').textContent)`, 3000), 'missing-required check reported');
  ok(await until(`/blocking error/.test(document.querySelector('#rmdScreenBody').textContent)`, 3000), 'error banner names the blocking errors');
  ok(await until(`!!document.querySelector('[data-rmd-version]')`, 3000), 'import version listed');
  await shot('tablet-1024-data-errors');
  await click('[data-rmd="data-freeze"]');
  ok(await until(`/frozen as the analysis dataset/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'import freezes a snapshot');
  await click('[data-rmd="dict-save"]');
  ok(await until(`/Dictionary saved as version 2/.test(document.querySelector('#rmdScreenBody').textContent)`, 5000), 'dictionary saves a new version');

  /* 5. Responsive: 375 / 768 / 1024, overflow, em-dash, two-pane */
  const screens = [
    ['pdf', `!!document.querySelector('#rmdPdfScroll .rmd-pdf-page') || /No PDFs yet/.test(document.querySelector('#rmdScreenBody').textContent)`],
    ['extract', `!!document.querySelector('[data-rmd-fieldrow="events1"]') || /No studies/.test(document.querySelector('#rmdScreenBody').textContent)`],
    ['rob', `!!document.querySelector('[data-rmd-tool]')`],
    ['data', `!!document.querySelector('[data-rmd-coltype="study_id"]')`]
  ];
  for (const [width, height, mobile] of [[375, 812, true], [768, 1024, true], [1024, 768, false]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
    for (const [name, marker] of screens) {
      await nav(name);
      ok(await until(marker, 8000), `${name} renders at ${width}px`);
      ok(await noOverflow(), `no horizontal overflow on ${name} at ${width}px`);
      ok(await noEmDash(), `no em-dash in UI text on ${name} at ${width}px`);
    }
    if (width >= 768) {
      for (const name of ['extract', 'rob', 'data']) {
        await nav(name);
        await until(`!!document.querySelector('.rmd-pane-left')`, 5000);
        ok(await ev(`(()=>{const l=document.querySelector('.rmd-pane-left');const r=document.querySelector('.rmd-pane-right');return l&&r&&getComputedStyle(l).display!=='none'&&getComputedStyle(r).display!=='none'})()`), `${name} two-pane visible at ${width}px`);
      }
    }
    if (width === 375) await shot('phone-375-extract');
  }

  /* 6. No page errors, Escape closes */
  if (pageErrors.length) console.log('PAGE ERRORS:\n' + pageErrors.join('\n'));
  ok(pageErrors.length === 0, `no page errors (${pageErrors.length})`);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27}));1`);
  ok(await ev(`getComputedStyle(document.getElementById('researchMD')).display==='none'`), 'Escape closes the ResearchMD overlay');

} catch (e) {
  console.log('FAIL exception:', e.message);
  failures++;
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
  server.close();
}

console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
