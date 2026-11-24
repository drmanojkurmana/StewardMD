// Real-browser headless test: ResearchMD Phase 2 screens end to end.
// The research API is mocked in-process from the frozen contract shapes
// (docs/research/contracts/phase-2/schemas + blinding.md + prisma2020.md).
// Covers: protocol lock flow, search run + import + dedup, blinded screening,
// conflict resolution, PRISMA numbers equal to stored decisions, responsive
// layouts at 375 / 768 / 1024 px, no horizontal overflow, no em-dash, Escape.
//   node test/run-research-phase2-ui.mjs   (CHROME=/path/to/chrome to override)
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

const PORT = 9094, CDP = 9494, OUT = '/tmp/stewardmd-research-phase2';
const TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};

/* ---------------- Contract mock: in-memory research API ---------------- */
const PID = 'prj_bcg_1994';
const GLOBAL_REASONS = [
  ['WRONG_POPULATION', 'Wrong population'],
  ['WRONG_INTERVENTION', 'Wrong intervention or exposure'],
  ['WRONG_COMPARATOR', 'Wrong comparator'],
  ['WRONG_OUTCOME', 'Wrong outcome'],
  ['WRONG_DESIGN', 'Wrong study design'],
  ['DUPLICATE_REPORT', 'Duplicate report of an included study'],
  ['FULL_TEXT_UNAVAILABLE', 'Full text unavailable'],
  ['LANGUAGE', 'Language exclusion'],
  ['ABSTRACT_ONLY', 'Conference abstract only, no full data'],
  ['ONGOING_STUDY', 'Ongoing study, no results yet']
].map(([code, label]) => ({ code, label, scope: 'global' }));

const T0 = 1763000000000;
const db = {
  protocols: [],
  searches: [],
  records: [
    { id: 'rec_1', projectId: PID, source: 'pubmed', externalId: '1001', title: 'BCG vaccination and tuberculosis prevention in infants', authors: ['Colditz GA', 'Brewer TF'], year: 1994, doi: '10.1001/jama.1994.1001', abstract: 'Objective: To estimate the efficacy of BCG vaccination against tuberculosis. Data sources: Published trials. Results: BCG reduced tuberculosis incidence.', metadata: {}, createdTs: T0 },
    { id: 'rec_2', projectId: PID, source: 'pubmed', externalId: '1002', title: 'BCG revaccination in adolescents: a controlled trial', authors: ['Rosenthal SR'], year: 1998, doi: '', abstract: 'Revaccination was assessed in adolescents with prior BCG.', metadata: {}, createdTs: T0 + 1 },
    { id: 'rec_3', projectId: PID, source: 'pubmed', externalId: '1003', title: 'Tuberculosis outcomes after BCG: a cohort analysis', authors: ['Comstock GW'], year: 2001, doi: '', abstract: 'Cohort follow-up of vaccinated and unvaccinated groups.', metadata: {}, createdTs: T0 + 2 },
    { id: 'rec_4', projectId: PID, source: 'pubmed', externalId: '1004', title: 'Neonatal BCG and all-cause mortality', authors: ['Aaby P'], year: 2005, doi: '', abstract: 'Non-specific effects of neonatal BCG on mortality.', metadata: {}, createdTs: T0 + 3 },
    { id: 'rec_5', projectId: PID, source: 'import:ris', externalId: 'RIS1', title: 'BCG vaccination and tuberculosis prevention in infants', authors: ['Colditz GA'], year: 1994, doi: '10.1001/jama.1994.1001', abstract: '', metadata: {}, createdTs: T0 + 4 },
    { id: 'rec_6', projectId: PID, source: 'import:csv', externalId: 'CSV1', title: 'BCG scar formation and protection', authors: ['Fine PEM'], year: 2010, doi: '', abstract: 'Scar status and protection against tuberculosis.', metadata: {}, createdTs: T0 + 5 },
    { id: 'rec_7', projectId: PID, source: 'pubmed', externalId: '1007', title: 'BCG timing at birth versus school age', authors: ['Vandiviere HM'], year: 2015, doi: '', abstract: 'Comparison of vaccination schedules.', metadata: {}, createdTs: T0 + 6 }
  ],
  reports: [
    { id: 'rep_1', projectId: PID, recordId: 'rec_1', status: 'retrieved', retrievalSource: 'publisher', r2Key: 'research/pdfs/rep_1.pdf', studyId: null, createdTs: T0, updatedTs: T0 },
    { id: 'rep_2', projectId: PID, recordId: 'rec_3', status: 'retrieved', retrievalSource: 'library', r2Key: 'research/pdfs/rep_2.pdf', studyId: null, createdTs: T0, updatedTs: T0 },
    { id: 'rep_3', projectId: PID, recordId: 'rec_6', status: 'not_retrieved', retrievalSource: '', r2Key: '', studyId: null, createdTs: T0, updatedTs: T0 }
  ],
  dedupGroups: [
    { id: 'dg_1', projectId: PID, canonicalRecordId: 'rec_1', memberIds: ['rec_1', 'rec_5'], algorithm: 'deterministic-v1', createdTs: T0 }
  ],
  votes: [],
  conflicts: []
};
let idSeq = 0;
const nid = (p) => `${p}_${++idSeq}`;

function addVote(key, stage, reviewer, decision, reasonCode) {
  db.votes.push({ id: nid('dec'), key, stage, reviewer, decision, reasonCode: reasonCode || undefined, createdTs: T0 + db.votes.length });
}
// Preset decisions: rec_1 include/include, rec_2 exclude/exclude, rec_3 split,
// rec_4 peer-only (blinding case), rec_6 uncertain/include, rep_1 include/include,
// rep_2 exclude/exclude (FULL_TEXT_UNAVAILABLE).
addVote('rec_1', 'title_abstract', 'self', 'include');
addVote('rec_1', 'title_abstract', 'peer', 'include');
addVote('rec_2', 'title_abstract', 'self', 'exclude', 'WRONG_POPULATION');
addVote('rec_2', 'title_abstract', 'peer', 'exclude', 'WRONG_POPULATION');
addVote('rec_3', 'title_abstract', 'self', 'include');
addVote('rec_3', 'title_abstract', 'peer', 'exclude', 'WRONG_DESIGN');
addVote('rec_4', 'title_abstract', 'peer', 'include');
addVote('rec_6', 'title_abstract', 'self', 'uncertain');
addVote('rec_6', 'title_abstract', 'peer', 'include');
addVote('rep_1', 'full_text', 'self', 'include');
addVote('rep_1', 'full_text', 'peer', 'include');
addVote('rep_2', 'full_text', 'self', 'exclude', 'FULL_TEXT_UNAVAILABLE');
addVote('rep_2', 'full_text', 'peer', 'exclude', 'FULL_TEXT_UNAVAILABLE');

function latestVotes(key) {
  const map = {};
  for (const v of db.votes) if (v.key === key) map[v.reviewer] = v;
  return map;
}
function conflictFor(key) {
  return db.conflicts.find((c) => (c.recordId || c.reportId) === key) || null;
}
function outcomeFor(key) {
  const conf = conflictFor(key);
  if (conf) return conf.status === 'open' ? 'conflict' : conf.resolution;
  const vals = Object.values(latestVotes(key));
  if (!vals.length) return 'pending';
  if (vals.length === 2 && vals.every((v) => v.decision === 'include')) return 'include';
  if (vals.length === 2 && vals.every((v) => v.decision === 'exclude')) return 'exclude';
  return 'pending';
}
function maybeOpenConflict(key, stage) {
  const lv = latestVotes(key);
  if (!lv.self || !lv.peer) return null;
  const disagree = lv.self.decision !== lv.peer.decision;
  const uncertain = lv.self.decision === 'uncertain' || lv.peer.decision === 'uncertain';
  if (!disagree && !uncertain) return null;
  let conf = conflictFor(key);
  if (!conf) {
    const isRecord = key.startsWith('rec_');
    conf = {
      id: nid('c'), projectId: PID,
      recordId: isRecord ? key : undefined,
      reportId: isRecord ? undefined : key,
      stage, status: 'open', createdTs: Date.now()
    };
    db.conflicts.push(conf);
  }
  return conf;
}
maybeOpenConflict('rec_3', 'title_abstract');
maybeOpenConflict('rec_6', 'title_abstract');
// Stable ids for the two seeded conflicts (test clicks them by id).
db.conflicts[0].id = 'c_1';
db.conflicts[1].id = 'c_2';

function computePrisma() {
  const dbSources = ['pubmed', 'europe_pmc', 'crossref', 'semantic_scholar'];
  const fromDb = db.records.filter((r) => dbSources.includes(r.source)).length;
  const fromOther = db.records.filter((r) => !dbSources.includes(r.source)).length;
  let dupRemoved = 0;
  for (const g of db.dedupGroups) dupRemoved += g.memberIds.filter((m) => m !== g.canonicalRecordId).length;
  const taOutcome = (recId) => outcomeFor(recId);
  const ftOutcome = (repId) => outcomeFor(repId);
  const screened = db.records.filter((r) => Object.keys(latestVotes(r.id)).length > 0).length;
  const excluded = db.records.filter((r) => taOutcome(r.id) === 'exclude').length;
  const assessed = db.reports.filter((rep) => Object.keys(latestVotes(rep.id)).length > 0).length;
  const reportsExcluded = db.reports.filter((rep) => ftOutcome(rep.id) === 'exclude').length;
  const included = db.reports.filter((rep) => ftOutcome(rep.id) === 'include').length;
  const byReason = {};
  for (const rep of db.reports) {
    for (const v of Object.values(latestVotes(rep.id))) {
      if (v.decision === 'exclude' && v.reasonCode) byReason[v.reasonCode] = (byReason[v.reasonCode] || 0) + 1;
    }
  }
  return {
    projectId: PID,
    recordsIdentified: db.records.length,
    recordsFromDatabases: fromDb,
    recordsFromOtherSources: fromOther,
    recordsDuplicatesRemoved: dupRemoved,
    recordsScreened: screened,
    recordsExcluded: excluded,
    reportsSought: db.reports.length,
    reportsNotRetrieved: db.reports.filter((r) => r.status === 'not_retrieved').length,
    reportsAssessed: assessed,
    reportsExcluded,
    studiesIncluded: included,
    conflictsOpen: db.conflicts.filter((c) => c.status === 'open').length,
    excludedByReason: Object.entries(byReason).map(([reasonCode, count]) => ({ reasonCode, count }))
  };
}

function envelope(code, message, status) {
  return { status, body: { error: { code, message, requestId: 'req_mock' } } };
}

async function handleApi(req, res, path, query) {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  let body = null;
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  }
  const m = (re) => path.match(re);
  let mm;

  // Protocols
  if (path === `/v1/projects/${PID}/protocols` && req.method === 'GET') {
    return send(200, { protocols: db.protocols.slice().sort((a, b) => b.version - a.version) });
  }
  if (path === `/v1/projects/${PID}/protocols` && req.method === 'POST') {
    const c = body && body.content;
    if (!c || !c.pico || !c.eligibility || !c.outcomes) return send(400, envelope('invalid_protocol', 'Protocol content fails validation', 400).body);
    const p = { id: nid('proto'), projectId: PID, version: 1, status: 'draft', content: c, createdBy: 'u_self', createdTs: Date.now() };
    db.protocols.push(p);
    return send(200, { protocol: p });
  }
  if ((mm = m(/^\/v1\/protocols\/([^/]+)$/)) && req.method === 'GET') {
    const vers = db.protocols.filter((p) => p.id === mm[1]);
    if (!vers.length) return send(404, envelope('protocol_not_found', 'No such protocol', 404).body);
    const want = query.get('version');
    const p = want ? vers.find((v) => v.version === Number(want)) : vers[vers.length - 1];
    if (!p) return send(404, envelope('protocol_not_found', 'No such version', 404).body);
    return send(200, { protocol: p });
  }
  if ((mm = m(/^\/v1\/protocols\/([^/]+)\/versions$/)) && req.method === 'POST') {
    const vers = db.protocols.filter((p) => p.id === mm[1]);
    const latest = vers[vers.length - 1];
    if (!latest) return send(404, envelope('protocol_not_found', 'No such protocol', 404).body);
    if (latest.status === 'locked') return send(409, envelope('protocol_locked', 'Protocol is locked; create a new protocol', 409).body);
    if (!body || body.baseVersion !== latest.version) {
      return send(409, { error: { code: 'stale_version', message: 'Protocol changed on the server', requestId: 'req_mock' }, current: { protocol: latest } });
    }
    const p = { id: latest.id, projectId: PID, version: latest.version + 1, status: 'draft', content: body.content, createdBy: 'u_self', createdTs: Date.now() };
    db.protocols.push(p);
    return send(200, { protocol: p });
  }
  if ((mm = m(/^\/v1\/protocols\/([^/]+)\/lock$/)) && req.method === 'POST') {
    const vers = db.protocols.filter((p) => p.id === mm[1]);
    const latest = vers[vers.length - 1];
    if (!latest) return send(404, envelope('protocol_not_found', 'No such protocol', 404).body);
    if (latest.status === 'locked') return send(409, envelope('protocol_locked', 'Already locked', 409).body);
    const json = JSON.stringify(latest.content);
    let hash = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) { hash ^= json.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
    latest.status = 'locked';
    latest.lockHash = 'sha256:' + hash.toString(16).padStart(8, '0') + 'mock';
    latest.lockedAt = Date.now();
    return send(200, { protocol: latest });
  }

  // Searches, imports, dedup
  if (path === `/v1/projects/${PID}/searches` && req.method === 'GET') {
    return send(200, { searchRuns: db.searches.slice().sort((a, b) => b.createdTs - a.createdTs) });
  }
  if (path === `/v1/projects/${PID}/searches` && req.method === 'POST') {
    if (!body || !body.database || !body.query) return send(400, envelope('invalid_search', 'database and query are required', 400).body);
    const run = {
      id: nid('srch'), projectId: PID, database: body.database, query: body.query,
      filters: body.filters || {}, dateTo: body.dateTo || null, apiVersion: 'mock-2026-11',
      resultCount: body.database === 'pubmed' ? 4 : 2,
      r2Key: `research/ids/${nid('key')}.json`, createdBy: 'u_self', createdTs: Date.now()
    };
    db.searches.push(run);
    return send(200, { searchRun: run });
  }
  if (path === `/v1/projects/${PID}/import-uploads` && req.method === 'POST') {
    return send(200, { storageKey: 'research/imports/upload_mock.ris' });
  }
  if (path === `/v1/projects/${PID}/imports` && req.method === 'POST') {
    if (!body || !body.format || !body.storageKey) return send(400, envelope('invalid_body', 'format and storageKey required', 400).body);
    const run = {
      id: nid('srch'), projectId: PID, database: 'import', query: `import:${body.format}`,
      filters: {}, dateTo: null, apiVersion: 'mock-2026-11', resultCount: 3,
      r2Key: 'research/ids/import_mock.json', createdBy: 'u_self', createdTs: Date.now()
    };
    db.searches.push(run);
    return send(200, { import: { searchRunId: run.id, recordsAdded: 2, duplicatesFlagged: 1, groupIds: ['dg_1'] } });
  }
  if (path === `/v1/projects/${PID}/dedup:run` && req.method === 'POST') {
    return send(200, { dedupRun: { groupsCreated: 1, duplicatesRemoved: 1, groupIds: ['dg_1'] } });
  }
  if (path === `/v1/projects/${PID}/dedup-groups` && req.method === 'GET') {
    return send(200, { groups: db.dedupGroups });
  }

  // Records, reports, reasons
  if (path === `/v1/projects/${PID}/records` && req.method === 'GET') return send(200, { records: db.records });
  if (path === `/v1/projects/${PID}/reports` && req.method === 'GET') return send(200, { reports: db.reports });
  if (path === `/v1/projects/${PID}/exclusion-reasons` && req.method === 'GET') return send(200, { reasons: GLOBAL_REASONS });

  // Decisions (blinded list + vote), records and reports
  if ((mm = m(/^\/v1\/(records|reports)\/([^/]+)\/decisions$/))) {
    const key = mm[2];
    const stage = mm[1] === 'records' ? 'title_abstract' : 'full_text';
    const known = mm[1] === 'records' ? db.records.some((r) => r.id === key) : db.reports.some((r) => r.id === key);
    if (!known) return send(404, envelope(mm[1] === 'records' ? 'record_not_found' : 'report_not_found', 'No such item', 404).body);
    if (req.method === 'GET') {
      const lv = latestVotes(key);
      const both = !!(lv.self && lv.peer);
      const votes = [];
      if (lv.self) votes.push({ reviewer: 'self', decision: lv.self.decision, reasonCode: lv.self.reasonCode, createdTs: lv.self.createdTs, visible: true });
      if (lv.peer) {
        votes.push(both
          ? { reviewer: 'peer', decision: lv.peer.decision, reasonCode: lv.peer.reasonCode, createdTs: lv.peer.createdTs, visible: true }
          : { reviewer: 'peer', decision: 'hidden', visible: false });
      }
      return send(200, { votes, outcome: outcomeFor(key) });
    }
    if (req.method === 'POST') {
      const conf = conflictFor(key);
      if (conf && conf.status === 'open') return send(409, envelope('conflict_open', 'Resolve the open conflict first', 409).body);
      const d = body && body.decision;
      if (!['include', 'exclude', 'uncertain'].includes(d)) return send(400, envelope('invalid_decision', 'Bad vote value', 400).body);
      if (d === 'exclude') {
        const code = body.reasonCode;
        if (!code) return send(400, envelope('invalid_decision', 'reasonCode required with exclude', 400).body);
        if (!GLOBAL_REASONS.some((r) => r.code === code)) return send(422, envelope('exclusion_reason_unknown', 'Unknown reason code', 422).body);
      }
      if (d === 'include' && body.reasonCode) return send(400, envelope('invalid_decision', 'reasonCode forbidden with include', 400).body);
      addVote(key, stage, 'self', d, body.reasonCode);
      const newConf = maybeOpenConflict(key, stage);
      const out = outcomeFor(key);
      const resp = {
        decision: { id: nid('dec'), stage, decision: d, reasonCode: body.reasonCode, createdTs: Date.now() },
        outcome: out
      };
      if (newConf && out === 'conflict') resp.conflictId = newConf.id;
      return send(200, resp);
    }
  }

  // Conflicts
  if (path === `/v1/projects/${PID}/conflicts` && req.method === 'GET') {
    const sorted = db.conflicts.slice().sort((a, b) => (a.status === b.status ? b.createdTs - a.createdTs : a.status === 'open' ? -1 : 1));
    return send(200, { conflicts: sorted });
  }
  if ((mm = m(/^\/v1\/conflicts\/([^/]+)\/resolve$/)) && req.method === 'POST') {
    const conf = db.conflicts.find((c) => c.id === mm[1]);
    if (!conf) return send(404, envelope('conflict_not_found', 'No such conflict', 404).body);
    if (conf.status === 'resolved') return send(409, envelope('already_decided', 'Conflict already resolved', 409).body);
    const r = body && body.resolution;
    if (!['include', 'exclude'].includes(r)) return send(400, envelope('invalid_decision', 'resolution must be include or exclude', 400).body);
    if (r === 'exclude' && !GLOBAL_REASONS.some((x) => x.code === body.reasonCode)) {
      return send(422, envelope('exclusion_reason_unknown', 'reasonCode required with exclude', 422).body);
    }
    conf.status = 'resolved';
    conf.resolution = r;
    conf.resolutionReason = r === 'exclude' ? body.reasonCode : undefined;
    conf.resolvedBy = 'u_self';
    conf.resolvedTs = Date.now();
    return send(200, { conflict: conf });
  }

  // PRISMA
  if (path === `/v1/projects/${PID}/prisma` && req.method === 'GET') {
    return send(200, { prisma: computePrisma(), generatedTs: Date.now() });
  }

  return send(404, envelope('not_found', 'Unknown Research API endpoint', 404).body);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = decodeURIComponent(u.pathname);
  if (p.startsWith('/api/research/')) {
    try {
      await handleApi(req, res, p.slice('/api/research'.length), u.searchParams);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'mock_error', message: String(e && e.message || e) } }));
    }
    return;
  }
  const fp = join(repo, normalize(p === '/' ? '/index.html' : p).replace(/^(\.\.[/\\])+/, ''));
  readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream', 'cache-control': 'no-store, no-cache, must-revalidate' });
    res.end(data);
  });
}).listen(PORT);

/* ---------------- CDP harness (same pattern as run-research-ui.mjs) ---------------- */
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd2-chrome-${process.pid}`, '--no-first-run', '--disable-gpu'
], { stdio: 'ignore' });

let ws, sid, id = 0, failures = 0;
const pending = new Map();
const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
const ok = (pass, label) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  if (!pass) failures++;
};
const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    try { if (await ev(expr)) return true; } catch { /* page busy */ }
    await sleep(100);
  }
  return false;
};
const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);
const setVal = (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const nav = (screen) => ev(`SMD_RESEARCH.navigate(${JSON.stringify(screen)});1`);
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
  for (let i = 0; i < 60; i++) {
    try { version = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const created = await call('Target.createTarget', { url: 'about:blank' });
  sid = (await call('Target.attachToTarget', { targetId: created.result.targetId, flatten: true })).result.sessionId;

  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await call('Page.navigate', { url: `http://localhost:${PORT}/?research=1` });
  ok(await until('!!window.SMD_RESEARCH && !!SMD_RESEARCH.screens && !!SMD_RESEARCH.screens.protocol && !!SMD_RESEARCH.screens.search && !!SMD_RESEARCH.screens.screening && !!SMD_RESEARCH.screens.conflicts && !!SMD_RESEARCH.screens.prisma', 30000), 'app loaded with all five Phase 2 screens');
  ok(await ev(`!!document.querySelector('script[src*="research-screen-protocol.js?v=rmd4"]') && !!document.querySelector('script[src*="research-screen-prisma.js?v=rmd"]')`), 'index.html carries the new script tags');

  // Mark the seed project as server-backed so server screens mount (practice gate skips it).
  await ev(`(function(){var s=JSON.parse(localStorage.getItem('smd_research_state_v1'));s.projects[0].serverId=s.projects[0].id;s.projects[0].practice=false;localStorage.setItem('smd_research_state_v1',JSON.stringify(s));return 1})()`);
  await ev(`SMD_RESEARCH.open({screen:'protocol'});1`);
  ok(await until(`!!document.querySelector('#researchMD:not([hidden]) .rmd-p2-screen')`, 5000), 'protocol screen opens');
  ok(await until(`/No protocol yet/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'protocol empty state names the next action');

  /* 1. Protocol: PICO builder, versions, lock, PROSPERO export */
  await click('[data-rmd="proto-create"]');
  ok(await until(`!!document.querySelector('#rmdProtoForm')`, 3000), 'protocol form opens');
  await setVal('#rmd_proto_title', 'BCG for tuberculosis prevention');
  await setVal('#rmd_proto_pop', 'Infants and children under 5 years');
  await setVal('#rmd_proto_int', 'BCG vaccination at birth');
  await setVal('#rmd_proto_cmp', 'No vaccination');
  await setVal('#rmd_proto_out', 'Incidence of active tuberculosis');
  await setVal('[data-rmd-list="eligibility"][data-rmd-idx="0"]', 'Randomized or quasi-randomized trials');
  await setVal('#rmd_proto_primary', 'Confirmed tuberculosis at any follow-up');
  await click('[data-rmd-add="secondary"]');
  await setVal('[data-rmd-list="secondary"][data-rmd-idx="0"]', 'All-cause mortality');
  await click('[data-rmd-add="timePoints"]');
  await setVal('[data-rmd-list="timePoints"][data-rmd-idx="0"]', '12 months');
  await click('[data-rmd-add="subgroups"]');
  await setVal('[data-rmd-list="subgroups"][data-rmd-idx="0"]', 'Age under 1 year');
  await click('[data-rmd-framework="PECO"]');
  ok(await until(`/Exposure/.test(document.querySelector('#rmdProtoForm').innerText)`, 3000), 'PECO toggle relabels intervention as exposure');
  await click('[data-rmd-framework="PICO"]');
  await click('[data-rmd="proto-save"]');
  ok(await until(`/Draft/.test(document.querySelector('#rmdScreenBody').innerText) && !!document.querySelector('[data-rmd-version="1"]')`, 5000), 'draft protocol v1 saved and listed');

  await click('[data-rmd="proto-edit"]');
  await setVal('#rmd_proto_pop', 'Infants and children under 10 years');
  await click('[data-rmd="proto-save"]');
  ok(await until(`!!document.querySelector('[data-rmd-version="2"]')`, 5000), 'editing saves version 2');
  await click('[data-rmd-version="1"]');
  ok(await until(`/Viewing version 1/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'version history opens older version read-only');
  await click('[data-rmd="proto-back-latest"]');

  await click('[data-rmd="proto-lock"]');
  ok(await until(`!!document.querySelector('#rmdLockModal')`, 3000), 'lock confirm dialog opens');
  ok(/cannot be edited after locking/i.test(await text('#rmdLockModal')), 'lock confirm states the protocol cannot be edited after locking');
  await shot('phone-375-protocol-lock-confirm');
  await click('[data-rmd="proto-lock-confirm"]');
  ok(await until(`/Locked/.test(document.querySelector('#rmdScreenBody').innerText) && /Hash: sha256:/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'lock stores and shows hash plus timestamp');
  ok(await ev(`!document.querySelector('[data-rmd="proto-edit"]') && !document.querySelector('[data-rmd="proto-lock"]')`), 'locked protocol offers no edit or re-lock');
  ok(await until(`/cannot be edited/.test(document.querySelector('#rmdScreenBody').innerText)`, 3000), 'locked view explains the one-way lock');

  await ev(`window.__blobs=[];const orig=URL.createObjectURL;URL.createObjectURL=(b)=>{window.__blobs.push(b);return orig(b)};1`);
  await click('[data-rmd="proto-prospero"]');
  await sleep(200);
  const prosperoText = await ev(`window.__blobs.length?window.__blobs[window.__blobs.length-1].text():''`);
  ok(/PROSPERO registration fields/.test(prosperoText) && /Infants and children under 10 years/.test(prosperoText) && /12 months/.test(prosperoText), 'PROSPERO export contains the locked protocol fields');

  await click('[data-rmd="proto-create"]');
  ok(await until(`/New Protocol/.test(document.querySelector('.rmd-form-card').innerText)`, 3000), 'locked protocol offers Start New Protocol as a fresh draft');
  await setVal('#rmd_proto_pop', 'Adults with latent tuberculosis');
  await setVal('#rmd_proto_int', 'Preventive therapy');
  await setVal('#rmd_proto_out', 'Active tuberculosis incidence');
  await setVal('#rmd_proto_primary', 'Confirmed tuberculosis');
  await setVal('[data-rmd-list="eligibility"][data-rmd-idx="0"]', 'Randomized trials in adults');
  await click('[data-rmd="proto-save"]');
  ok(await until(`/Draft/.test(document.querySelector('#rmdScreenBody').innerText) && !/Hash: sha256:/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'new protocol saves as its own draft v1, not a version of the locked one');

  /* 2. Search: run, history counts, import, dedup */
  await nav('search');
  ok(await until(`/Run a Search/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'search screen opens');
  await setVal('#rmd_search_query', '(BCG[MeSH] OR vaccine[tiab]) AND tuberculosis[tiab]');
  await setVal('#rmd_search_dateto', '2026-11-01');
  await click('[data-rmd="search-run"]');
  ok(await until(`/4 records/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'PubMed run completes and history shows the mocked count (4)');
  ok(await until(`/Up to 2026-11-01/.test(document.querySelector('#rmdScreenBody').innerText)`, 3000), 'run history shows the date upper bound');
  await click('[data-rmd-db="europe_pmc"]');
  ok(await ev(`document.querySelector('#rmd_search_query').value===''`), 'per-database query fields are independent');
  await click('[data-rmd-db="pubmed"]');
  ok(await ev(`document.querySelector('#rmd_search_query').value.includes('BCG[MeSH]')`), 'switching back keeps the PubMed query');

  await ev(`(()=>{const f=new File(['TY  - JOUR\\nTI  - Imported trial\\nER  - \\n'],'refs.ris',{type:'text/plain'});const input=document.getElementById('rmd_import_file');Object.defineProperty(input,'files',{value:[f],configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  ok(await until(`/1 entries detected/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'RIS file preview counts entries deterministically');
  await click('[data-rmd="import-run"]');
  ok(await until(`/Import complete: 2 added, 1 duplicates flagged/.test(document.querySelector('#rmdScreenBody').innerText)`, 8000), 'import reports added records and flagged duplicates');
  await click('[data-rmd="dedup-run"]');
  ok(await until(`/1 duplicates removed across 1 groups/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'dedup run reports groups and duplicates removed');
  await shot('phone-375-search');

  /* 3. Screening: blinding, reasons, conflict announcement, full-text queue */
  await nav('screening');
  ok(await until(`!!document.querySelector('[data-rmd-item="rec_4"]')`, 8000), 'screening queue lists records');
  ok(await ev(`!document.querySelector('[data-rmd-item="rec_5"]')`), 'non-canonical duplicate is excluded from the screening queue');
  await click('[data-rmd-item="rec_4"]');
  ok(await until(`!!document.querySelector('.rmd-votes-box') && /Neonatal BCG/.test(document.querySelector('.rmd-pane-right').textContent)`, 5000), 'vote panel loads for the selected record');
  const peerBefore = await ev(`(()=>{const lines=[...document.querySelectorAll('.rmd-vote-line')];const p=lines.find(l=>l.textContent.includes('Reviewer 2'));return p?p.textContent:''})()`);
  ok(/Hidden until both reviewers decide/.test(peerBefore) && !/include/.test(peerBefore), 'blinded: peer vote hidden before both decide (no decision, reason or timestamp leaked)');
  await shot('phone-375-screening-blinded');
  await click('[data-rmd-vote="exclude"]');
  ok(await until(`!!document.querySelector('[data-rmd-reason="WRONG_POPULATION"]')`, 3000), 'exclude requires a coded reason');
  await click('[data-rmd-reason="WRONG_POPULATION"]');
  ok(await until(`/Conflict opened/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'disagreeing second vote opens a conflict and announces unblinding');
  const peerAfter = await ev(`(()=>{const lines=[...document.querySelectorAll('.rmd-vote-line')];const p=lines.find(l=>l.textContent.includes('Reviewer 2'));return p?p.textContent:''})()`);
  ok(/include/.test(peerAfter), 'after both decided the peer vote becomes visible');

  await click('[data-rmd-item="rec_7"]');
  await until(`!!document.querySelector('[data-rmd-vote="include"]')`, 5000);
  await click('[data-rmd-vote="include"]');
  ok(await until(`/Vote saved|End of the queue/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'include vote saves and the one-hand flow advances');

  await click('[data-rmd-stage="full_text"]');
  ok(await until(`!!document.querySelector('[data-rmd-item="rep_3"]')`, 5000), 'full-text queue lists reports');
  await click('[data-rmd-item="rep_3"]');
  ok(await until(`/not retrieved/i.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'not-retrieved report is flagged');
  ok(await ev(`!document.querySelector('[data-rmd-vote]')`), 'not-retrieved report cannot be voted');

  /* 4. Conflicts: both votes visible, resolution with reason */
  await nav('conflicts');
  ok(await until(`!!document.querySelector('[data-rmd-conf="c_1"]')`, 8000), 'conflict list loads');
  ok(await until(`/3 open/.test(document.querySelector('#rmdScreenBody').innerText)`, 3000), 'open conflict count matches stored conflicts (3)');
  await click('[data-rmd-conf="c_1"]');
  ok(await until(`/exclude/.test(document.querySelector('.rmd-pane-right').innerText) && /include/.test(document.querySelector('.rmd-pane-right').innerText)`, 5000), 'resolver sees both unblinded votes');
  ok(await until(`/You voted on this item/.test(document.querySelector('#rmdScreenBody').innerText)`, 3000), 'voter-resolver warning shown (blinding B4)');
  await setVal('#rmd_resolve_note', 'No non-voter owner or editor is available; resolving as the only editor.');
  await click('[data-rmd-resolve="exclude"]');
  ok(await until(`!!document.querySelector('[data-rmd-resolve-reason="WRONG_DESIGN"]')`, 3000), 'exclude resolution requires a reason');
  await click('[data-rmd-resolve-reason="WRONG_DESIGN"]');
  ok(await until(`/Resolved: exclude/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'conflict resolved with reason');
  ok(await until(`/2 open/.test(document.querySelector('#rmdScreenBody').innerText)`, 3000), 'open count drops after resolution');
  await shot('phone-375-conflict-resolved');

  await ev(`SMD_RESEARCH.store.getActiveProject().role='reviewer';SMD_RESEARCH.navigate('conflicts');1`);
  await until(`!!document.querySelector('[data-rmd-conf="c_2"]')`, 5000);
  await click('[data-rmd-conf="c_2"]');
  ok(await until(`/Only an owner or editor can resolve/.test(document.querySelector('#rmdScreenBody').innerText)`, 5000), 'reviewer role sees votes but no resolve controls');
  ok(await ev(`!document.querySelector('[data-rmd-resolve]')`), 'resolve buttons hidden for reviewer');
  await ev(`SMD_RESEARCH.store.getActiveProject().role='owner';SMD_RESEARCH.navigate('conflicts');1`);

  /* 5. PRISMA: numbers equal the stored decisions */
  await nav('prisma');
  ok(await until(`!!document.querySelector('svg.rmd-prisma-svg')`, 8000), 'PRISMA 2020 diagram renders as inline SVG');
  const expected = {
    recordsIdentified: 7, recordsFromDatabases: 5, recordsFromOtherSources: 2,
    recordsDuplicatesRemoved: 1, recordsScreened: 6, recordsExcluded: 2,
    reportsSought: 3, reportsNotRetrieved: 1, reportsAssessed: 2,
    reportsExcluded: 1, studiesIncluded: 1, conflictsOpen: 2
  };
  const counts = await ev(`(()=>{const o={};document.querySelectorAll('.rmd-count-table [data-count-for]').forEach(td=>{o[td.getAttribute('data-count-for')]=Number(td.textContent.trim())});return o})()`);
  let countsMatch = true;
  for (const k of Object.keys(expected)) if (counts[k] !== expected[k]) countsMatch = false;
  ok(countsMatch, `PRISMA table equals stored decisions (${JSON.stringify(counts)})`);
  const mockPrisma = computePrisma();
  let apiMatch = true;
  for (const k of Object.keys(expected)) if (mockPrisma[k] !== expected[k]) apiMatch = false;
  ok(apiMatch, 'mock API PRISMA view agrees with the independent expectation');
  const svgCounts = await ev(`(()=>{const o={};document.querySelectorAll('svg.rmd-prisma-svg [data-count-for]').forEach(t=>{o[t.getAttribute('data-count-for')]=Number(t.textContent.trim())});return o})()`);
  let svgMatch = true;
  for (const k of Object.keys(svgCounts)) if (counts[k] !== svgCounts[k]) svgMatch = false;
  ok(svgMatch && Object.keys(svgCounts).length >= 10, 'SVG diagram numbers equal the counts table');
  ok(await until(`/Full text unavailable: 2/.test(document.querySelector('#rmdScreenBody').textContent)`, 3000), 'exclusion reasons shown with labels and counts');
  await shot('phone-375-prisma');

  /* 6. Responsive: 375 / 768 / 1024, overflow, em-dash, two-pane */
  const screens = [
    ['protocol', `/Protocol/.test(document.querySelector('#rmdScreenBody').innerText)`],
    ['search', `/Run a Search/.test(document.querySelector('#rmdScreenBody').innerText)`],
    ['screening', `!!document.querySelector('.rmd-split-layout')`],
    ['conflicts', `!!document.querySelector('.rmd-split-layout')`],
    ['prisma', `!!document.querySelector('svg.rmd-prisma-svg')`]
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
      await nav('screening');
      await until(`!!document.querySelector('.rmd-pane-left')`, 5000);
      ok(await ev(`(()=>{const l=document.querySelector('.rmd-pane-left');const r=document.querySelector('.rmd-pane-right');return l&&r&&getComputedStyle(l).display!=='none'&&getComputedStyle(r).display!=='none'})()`), `screening two-pane visible at ${width}px`);
      await nav('conflicts');
      await until(`!!document.querySelector('.rmd-pane-left')`, 5000);
      ok(await ev(`(()=>{const l=document.querySelector('.rmd-pane-left');const r=document.querySelector('.rmd-pane-right');return l&&r&&getComputedStyle(l).display!=='none'&&getComputedStyle(r).display!=='none'})()`), `conflicts two-pane visible at ${width}px`);
      await shot(`tablet-${width}-conflicts`);
    }
  }
  await shot('tablet-1024-prisma');

  /* 7. Escape closes the overlay */
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