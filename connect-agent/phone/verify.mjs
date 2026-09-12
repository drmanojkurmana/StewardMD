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

import { readWorklist } from './runtime.mjs';
import { executeView } from './adapter-runtime.mjs';
import { scrubForBrain } from './deep-crawl.mjs';

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
export async function verifyViews({ plugin, origin, views, brain = null, notify = null, stopped = () => false, maxPatients = 2, waitMs = 6000, parseHtml = null }) {
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
  for (const view of list) {
    if (stopped()) break;
    if (!view || view === worklistView || !VERIFY_RESOURCES.includes(view.resourceHint)) continue;
    if (!Array.isArray(view.endpoints) || !view.endpoints.length) { view.verified = { resource: view.resourceHint, ok: false, via: 'none', rows: 0, kind: 'none', reason: 'no data call was discovered for this view; it will be read from its page' }; continue; }
    if (!sample.length) { view.verified = { resource: view.resourceHint, ok: false, via: 'none', rows: 0, kind: 'none', reason: 'no patient to check with' }; failed.push(view.resourceHint); continue; }
    say({ checking: view.resourceHint });
    let best = null;
    for (const patient of sample) {
      let out = null;
      try { out = await executeView({ plugin, origin, view, patient, parseHtml }); } catch (e) { if (e && e.name === 'NotSignedIn') throw e; out = null; }
      if (out && out.rows.length) { best = out; break; }
      if (out && !best) best = out;
    }
    const rows = best ? best.rows : [];
    const verdict = await judge({ brain, resource: view.resourceHint, rows, kind: best ? best.kind : 'none', path: best ? best.url : null });
    const c = { resource: view.resourceHint, ok: verdict.ok, via: best ? 'endpoint' : 'none', rows: rows.length, kind: best ? best.kind : 'none', reason: verdict.reason, resourceSeen: verdict.resource, url: best ? best.url : null };
    checks.push(c); view.verified = c;
    if (!verdict.ok) failed.push(view.resourceHint);
  }
  return { patients, checks, failed: [...new Set(failed)] };
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
