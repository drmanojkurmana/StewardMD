// connect-agent/phone/verify.mjs - CHECK THE ADAPTER AGAINST REAL PATIENTS BEFORE ASKING FOR APPROVAL.
//
// Discovery records where each clinical view lives and which calls it makes. That is a map, not
// proof. Before the draft goes to the owner, the agent runs the map: it reads the ward list through
// the adapter, picks real patients from it, replays every view's discovered call for them inside the
// doctor's own session, and asks the brain whether what came back is what the view claims to be (a
// patient list and not a doctor list; a full lab panel and not a menu). Views that fail are handed
// back to the doctor as guided asks ("show me the reports"), and the outcome travels with the draft
// so the approver sees "worklist: 3 rows through the endpoint" rather than a promise.
//
// PHI never leaves the phone: the brain sees column names, row counts and the response kind only.

import { readWorklist, readView, fillPath } from './runtime.mjs';
import { executeView, usableRows } from './adapter-runtime.mjs';
import { scrubForBrain, redactEndpoints, mergeEndpointDetails } from './deep-crawl.mjs';

const TAP_LIST_TAB = "(function(){try{var els=document.querySelectorAll('a,button,li,[role=tab],label,span');for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').replace(/\\s+/g,' ').trim();if(t.length<=24&&/^(in ?patients?|inpatients?|ip( patients?)?|ward( list)?|admitted( patients?)?)$/i.test(t)&&els[i].getClientRects().length){els[i].click();return 'tapped'}}return 'none'}catch(e){return 'e'}})()";

export const VERIFY_RESOURCES = Object.freeze(['worklist', 'patient', 'notes', 'labs', 'radiology', 'medications', 'discharge', 'history']);

/** Column names of a row set, PHI-free (meta keys dropped, digit runs scrubbed). */
export function columnsOf(rows) {
  const keys = [];
  for (const r of Array.isArray(rows) ? rows.slice(0, 5) : []) for (const k of Object.keys(r || {})) if (k !== '_href' && k !== '_args' && !keys.includes(k)) keys.push(k);
  return scrubForBrain(keys).slice(0, 24);
}

/** Deterministic judgment when there is no brain: rows with a recognisable column count as verified. */
export function localVerdict(resource, rows, kind) {
  const n = Array.isArray(rows) ? rows.length : 0;
  if (!n) return { ok: false, resource: 'none', confidence: 0.9, reason: 'no rows came back', suggestion: 'ask-doctor' };
  return { ok: true, resource, confidence: 0.5, reason: n + ' rows through the ' + (kind || 'page'), suggestion: 'ok' };
}

/**
 * verifyViews({ plugin, origin, views, brain, notify, stopped }) -> { patients, checks, failed }
 * checks: [{ resource, ok, via, rows, kind, reason, url }] one per verifiable view; `failed` lists the
 * resources the doctor should be asked for. Each verified view gets `view.verified` (PHI-free).
 */
export async function verifyViews({ plugin, origin, views, brain = null, book = null, notify = null, stopped = () => false, maxPatients = 2, waitMs = 6000, parseHtml = null }) {
  const proven = (v) => !!(v && v.proof && v.proof.status === 'proven');
  const say = (extra) => { try { if (notify) notify('VERIFYING', extra); } catch { /* UI must never break the check */ } };
  const checks = [];
  const failed = [];
  const list = Array.isArray(views) ? views : [];
  const worklistView = list.find((v) => v && v.resourceHint === 'worklist');

  // 1. The ward list through the adapter (endpoint replay first, page second).
  let patients = [];
  let wlVia = 'none';
  if (worklistView) {
    say({ checking: 'worklist' });
    if (!book || !proven(worklistView)) await learnPageLoadCalls({ plugin, origin, view: worklistView, waitMs: Math.max(waitMs, 20000), tapList: true, book });
    try {
      patients = await readWorklist({ plugin, origin, replay: list, settleMs: Math.min(1200, waitMs), maxWaitMs: waitMs, onRead: (r) => { wlVia = r.via; } });
    } catch (e) {
      const c = { resource: 'worklist', ok: false, via: wlVia, rows: 0, kind: 'error', reason: String((e && e.message) || e).slice(0, 160) };
      checks.push(c); worklistView.verified = c; failed.push('worklist');
      if (e && e.name === 'NotSignedIn') throw e;
    }
    if (patients.length) {
      const verdict = await judge({ brain, resource: 'worklist', rows: patients.map((p) => ({ 'Patient ID': p.patientId, 'Patient name': p.patientFirstName, Bed: p.bedName })), kind: wlVia === 'endpoint' ? 'endpoint' : 'page', path: worklistView.pathTemplate });
      const c = { resource: 'worklist', ok: verdict.ok, via: wlVia, rows: patients.length, kind: wlVia, reason: verdict.reason, resourceSeen: verdict.resource };
      checks.push(c); worklistView.verified = c;
      if (!verdict.ok) failed.push('worklist');
    }
  }

  // 2. Every other view with a discovered call, for up to two real patients.
  const sample = patients.slice(0, maxPatients);
  const listRows = {};
  for (const view of list) {
    if (stopped()) break;
    if (!view || view === worklistView || !VERIFY_RESOURCES.includes(view.resourceHint)) continue;
    if (!sample.length) { view.verified = { resource: view.resourceHint, ok: false, via: 'none', rows: 0, kind: 'none', reason: 'no patient to check with' }; failed.push(view.resourceHint); continue; }
    /* NOT PROVEN DURING THE CRAWL: open the view's own page for a real patient and run the proof there
     * (the page's own load calls against the rows it shows). Still nothing: no endpoint is kept. */
    if (book && !proven(view) && !view.detailOf) {
      say({ checking: view.resourceHint, learning: true });
      await learnPageLoadCalls({ plugin, origin, view, patient: sample[0], waitMs: Math.min(Math.max(waitMs, 6000), 12000), book });
    }
    if (book && !proven(view)) {
      const status = (view.proof && view.proof.status) || 'none';
      view.verified = { resource: view.resourceHint, ok: false, via: 'none', rows: 0, kind: 'none', reason: 'no endpoint was proven for this view (' + status + '); it will be read from its page' };
      checks.push(Object.assign({ resource: view.resourceHint }, view.verified)); failed.push(view.resourceHint); continue;
    }
    if (!Array.isArray(view.endpoints) || !view.endpoints.length) { view.verified = { resource: view.resourceHint, ok: false, via: 'none', rows: 0, kind: 'none', reason: 'no data call was discovered for this view; it will be read from its page' }; continue; }
    say({ checking: view.resourceHint });
    let best = null;
    let lastError = '';
    for (const patient of sample) {
      let out = null;
      try { out = await executeView({ plugin, origin, view, patient, parseHtml }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; out = null; lastError = String((e && e.message) || e).replace(/\d{3,}/g, '#').slice(0, 120); }
      if (out && out.rows.length) { best = out; listRows[view.resourceHint] = { rows: out.rows, patient }; break; }
      if (out && !best) best = out;
    }
    /* Nothing usable (no rows, or one column per row): open the view's own page for this patient, keep
     * the calls it makes on load (a lab page's search post), and replay once more. */
    if (!book && (!best || !usableRows(best.rows))) {
      say({ checking: view.resourceHint, learning: true });
      await learnPageLoadCalls({ plugin, origin, view, patient: sample[0], waitMs: Math.min(Math.max(waitMs, 6000), 12000) });
      let again = null;
      try { again = await executeView({ plugin, origin, view, patient: sample[0], parseHtml }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; again = null; }
      if (again && usableRows(again.rows)) best = again;
    }
    const rows = best ? best.rows : [];
    const verdict = await judge({ brain, resource: view.resourceHint, rows, kind: best ? best.kind : 'none', path: best ? best.url : null });
    const c = { resource: view.resourceHint, ok: verdict.ok, via: best ? 'endpoint' : 'none', rows: rows.length, kind: best ? best.kind : 'none', reason: (!best && lastError) ? 'replay failed: ' + lastError : verdict.reason, resourceSeen: verdict.resource, url: best ? best.url : null };
    checks.push(c); view.verified = c;
    if (!verdict.ok) failed.push(view.resourceHint);
  }

  // 3. The chains: a proven detail view (one lab result, one report) for a row of its proven list.
  for (const view of list) {
    if (stopped()) break;
    if (!view || !view.detailOf || !proven(view)) continue;
    const parent = listRows[view.detailOf];
    if (!parent || !parent.rows.length) { view.verified = { resource: view.resourceHint, ok: false, via: 'none', rows: 0, kind: 'none', reason: 'the ' + view.detailOf + ' list returned no row to open' }; checks.push(Object.assign({ resource: view.resourceHint }, view.verified)); continue; }
    say({ checking: view.resourceHint });
    let out = null;
    let err = '';
    try { out = await executeView({ plugin, origin, view, patient: parent.patient, parentRow: parent.rows[0], parseHtml }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; err = String((e && e.message) || e).replace(/\d{3,}/g, '#').slice(0, 120); }
    const rows = out ? out.rows : [];
    const c = { resource: view.resourceHint, ok: rows.length > 0, via: out ? 'endpoint' : 'none', rows: rows.length, kind: out ? out.kind : 'none', reason: rows.length ? rows.length + ' rows for one ' + view.detailOf + ' row through the chained call' : (err ? 'replay failed: ' + err : 'the chained call answered no rows'), url: out ? out.url : null };
    checks.push(c); view.verified = c;
  }
  return { patients, checks, failed: [...new Set(failed)] };
}

/* THE CALL A LIST MAKES ON ITS OWN. A ward list fills itself by AJAX as the page loads (GHIS: GetIPWL),
 * before the crawl ever clicks, so it is easy to miss. Load the list page once, wait for its rows,
 * and keep every same-origin data call it made (field names and mode constants only) on the view. */
export async function learnPageLoadCalls({ plugin, origin, view, waitMs = 20000, patient = null, tapList = false, book = null }) {
  if (!view || !view.pathTemplate) return;
  try {
    if (typeof plugin.drainRequests === 'function') await plugin.drainRequests().catch(() => null);
    if (typeof plugin.drainObserverEvents === 'function') await plugin.drainObserverEvents().catch(() => null);
    const page = patient ? fillPath(view.pathTemplate, patient) : view.pathTemplate;
    await plugin.navigate({ url: page.indexOf('http') === 0 ? page : String(origin).replace(/\/$/, '') + page });
    try { await readView({ plugin, origin, view, settleMs: 1500, toggleAll: true, maxWaitMs: waitMs, navigate: false }); } catch { /* the rows are a bonus; the calls are the point */ }
    /* A ward list that loads only when its tab is tapped (In patients, IP, Ward) never calls on load:
     * tap such a tab once, read-only by label, and let the call happen. */
    if (tapList) {
      try { await plugin.evaluate({ expression: TAP_LIST_TAB }); await new Promise((r) => setTimeout(r, Math.min(4000, waitMs))); } catch { /* no tab */ }
    }
    // With proof, the page's calls are candidates only: one is kept when its answer matches the rows shown.
    if (book) { await book.prove({ client: plugin, view, label: 'open the ' + view.resourceHint + ' page', since: 0 }); return; }
    const pageUrl = ((await plugin.currentUrl().catch(() => ({}))) || {}).url || view.pathTemplate;
    const drained = typeof plugin.drainRequests === 'function' ? await plugin.drainRequests().catch(() => null) : null;
    let eps = redactEndpoints(drained && drained.requests, pageUrl);
    if (typeof plugin.drainObserverEvents === 'function') {
      const obs = await plugin.drainObserverEvents().catch(() => null);
      if (obs && Array.isArray(obs.events) && obs.events.length) eps = eps.length ? mergeEndpointDetails(eps, obs.events) : redactEndpoints(obs.events, pageUrl);
    }
    const have = new Set((view.endpoints || []).map((e) => e.method + ' ' + e.path));
    const learned = eps.filter((e) => !have.has(e.method + ' ' + e.path));
    if (learned.length) view.endpoints = learned.concat(view.endpoints || []).slice(0, 8);
  } catch { /* learning never breaks verification */ }
}

/** The brain's verdict on a replayed view, or the local one when the brain is absent or silent. */
export async function judge({ brain, resource, rows, kind, path }) {
  const local = localVerdict(resource, rows, kind);
  if (!brain || typeof brain.verify !== 'function' || !rows.length) return local;
  let a = null;
  try { a = await brain.verify(scrubForBrain({ resource, headers: columnsOf(rows), rowCount: rows.length, kind: kind || 'page', path: path ? String(path).split('?')[0] : '' })); } catch { a = null; }
  if (!a || typeof a.ok !== 'boolean') return local;
  return { ok: a.ok, resource: a.resource || 'none', confidence: Number(a.confidence) || 0, reason: String(a.reason || local.reason).slice(0, 200), suggestion: a.suggestion || (a.ok ? 'ok' : 'ask-doctor') };
}
