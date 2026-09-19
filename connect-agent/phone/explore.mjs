// connect-agent/phone/explore.mjs — bounded read-only exploration loop for the phone runner, plus the
// live-probe executor and the deterministic fallback planner. See connect-agent/phone/CONTRACT.md.
import { LIMITS } from '../discovery.mjs';

// discovery.mjs's SKIP_LABEL/CANDIDATE_REF/CLICKABLE are module-local (not exported), so they are
// copied here rather than imported. Keep in sync with connect-agent/discovery.mjs if it changes.
const CANDIDATE_REF = /\[ref=([A-Za-z0-9_-]{1,32})\]/;
const CLICKABLE = /\b(link|button|menuitem|tab|option|row)\b/i;
const SKIP_LABEL = /sign\s?out|log\s?out|logout|delete|remove|discharge|export|download|order|prescribe|submit|save|new\b|create/i;

const TIER1 = /doctor|physician|clinical|ward|inpatient|\bipd\b|\bopd\b|patient|worklist|census|dashboard/i;
const TIER2 = /lab|result|investigation|radiolog|report|medic|drug|medicine|allerg|encounter|visit|note|summary|history|vital|diagnos/i;

const CAPS_DEFAULT = { maxSteps: 60, maxMs: 240000, maxDepth: 20, waitMs: 1200 };

function parseCandidates(lines) {
  const out = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const refMatch = CANDIDATE_REF.exec(line);
    if (!refMatch || !CLICKABLE.test(line) || SKIP_LABEL.test(line)) continue;
    const nameMatch = /"([^"]*)"/.exec(line);
    out.push({ ref: refMatch[1], label: nameMatch ? nameMatch[1] : '', line });
  }
  return out;
}

/** True when the most recent observed event's response shape is (or directly contains) an array —
 *  the signal that the page just rendered a list (e.g. a patient worklist). */
function lastEventWasArrayShaped(events) {
  if (!Array.isArray(events) || !events.length) return false;
  const shape = events[events.length - 1]?.responseShape;
  if (!shape || typeof shape !== 'object') return false;
  if (shape.type === 'array') return true;
  if (shape.type === 'object' && shape.keys) return Object.values(shape.keys).some((v) => v && v.type === 'array');
  return false;
}

/**
 * Local deterministic planner. Used by tests and as a fallback when the server planner (`api.plan`,
 * `POST /sessions/:id/plan`) is unreachable. NEVER widens beyond refs already present in `lines`: it
 * only picks among refs `explorePhone`'s caller already snapshotted, exactly like discovery.mjs's
 * `candidateRefs()`.
 */
export async function defaultPlanner({ lines = [], depth = 0, events = [], visited = [] } = {}) {
  // Dedup by label: refs are regenerated each snapshot (position-based), so a ref is not stable across
  // snapshots, but a redacted label is. This keeps the walk from re-clicking the same tab or row.
  const seenLabels = new Set((visited || []).filter((v) => typeof v === 'string' && v.indexOf('label:') === 0).map((v) => v.slice(6)));
  const candidates = parseCandidates(lines).filter((c) => !seenLabels.has(c.label));
  if (!candidates.length) return depth > 0 ? { action: 'back', reason: 'no-candidate' } : { action: 'stop', reason: 'no-candidate' };

  // Prefer opening a record whose label carries a redacted id "#", to go one level deeper. Fires when
  // the list arrived as a JSON array (SPA) OR when the candidate is a table row (server-rendered HTML,
  // e.g. GHIS, where no array event is ever observed). Either signal alone is enough.
  const arrayShaped = lastEventWasArrayShaped(events);
  const patientRow = candidates.find((c) => c.label.includes('#') && (arrayShaped || /\brow\b/i.test(c.line)));
  if (patientRow) return { action: 'click', ref: patientRow.ref, label: patientRow.label, reason: 'patient-row' };

  const tier1 = candidates.find((c) => TIER1.test(c.label));
  if (tier1) return { action: 'click', ref: tier1.ref, label: tier1.label, reason: 'tier1-keyword' };

  const tier2 = candidates.find((c) => TIER2.test(c.label));
  if (tier2) return { action: 'click', ref: tier2.ref, label: tier2.label, reason: 'tier2-keyword' };

  // Shallow dead-end: click the first unseen candidate to keep exploring rather than stopping cold.
  if (depth < 2 && candidates[0]) return { action: 'click', ref: candidates[0].ref, label: candidates[0].label, reason: 'explore-first' };
  return depth > 0 ? { action: 'back', reason: 'no-candidate' } : { action: 'stop', reason: 'no-candidate' };
}

/**
 * explorePhone({ client, collector, planner, startUrl, caps, stopSignal }) -> { steps, visitedUrls, stopReason, depth }
 *
 * Loop: snapshot -> planner({url, lines, visited, depth, events}) -> click/back/stop -> collector.observe().
 * click = depth+1, back = depth-1. Stops on any cap, a planner error, a `blocked` event observed by the
 * collector, or `stopSignal()` returning true (wired by index.mjs to the plugin's native "stopped" event
 * — the doctor tapping Stop).
 */
export async function explorePhone({ client, collector, planner, startUrl, caps = {}, stopSignal } = {}) {
  if (!client) throw new Error('explorePhone requires a client');
  if (!collector) throw new Error('explorePhone requires a collector');
  if (typeof planner !== 'function') throw new Error('explorePhone requires a planner function');

  const maxSteps = Math.min(Math.max(caps.maxSteps ?? CAPS_DEFAULT.maxSteps, 1), CAPS_DEFAULT.maxSteps);
  const maxMs = Math.min(Math.max(caps.maxMs ?? CAPS_DEFAULT.maxMs, 0), CAPS_DEFAULT.maxMs);
  const maxDepth = Math.min(Math.max(caps.maxDepth ?? CAPS_DEFAULT.maxDepth, 0), CAPS_DEFAULT.maxDepth);
  const waitMs = caps.waitMs ?? CAPS_DEFAULT.waitMs;

  const steps = [];
  const visitedUrls = [];
  const clickedLabels = [];
  let depth = 0;
  let stopReason = 'step-cap';
  const deadline = Date.now() + maxMs;

  const noteUrl = async () => {
    const cur = await client.currentUrl().catch(() => null);
    const url = cur?.url || null;
    if (url && !visitedUrls.includes(url)) visitedUrls.push(url);
    return url;
  };

  if (startUrl) {
    await client.navigate({ url: startUrl });
    await collector.observe({ ms: waitMs });
  }

  while (steps.length < maxSteps) {
    if (Date.now() >= deadline) { stopReason = 'time-cap'; break; }
    if (depth > maxDepth) { stopReason = 'depth-cap'; break; }
    if (typeof stopSignal === 'function' && stopSignal()) { stopReason = 'stop-signal'; break; }

    const url = await noteUrl();
    const snap = await client.snapshot();
    const lines = String(snap?.snapshot ?? '').split('\n').filter(Boolean);
    const events = typeof collector.raw === 'function' ? collector.raw() : [];

    let decision;
    try {
      decision = await planner({ url, lines, visited: [...visitedUrls, ...clickedLabels], depth, events });
    } catch {
      stopReason = 'planner-error';
      break;
    }

    if (!decision || decision.action === 'stop') { stopReason = decision?.reason || 'planner-stop'; break; }

    if (decision.action === 'back') {
      await client.evaluate({ expression: 'history.back()' }).catch(() => {});
      depth = Math.max(0, depth - 1);
      await collector.observe({ ms: waitMs });
      steps.push({ ref: null, action: 'back', fromUrl: url, reason: decision.reason || 'back' });
      if (events.some((e) => e && e.blocked) || (collector.raw?.() || []).some((e) => e && e.blocked)) { stopReason = 'blocked'; break; }
      continue;
    }

    if (decision.action === 'click') {
      const ref = decision.ref;
      if (!ref || !lines.some((l) => l.includes(`[ref=${ref}]`))) { stopReason = 'invalid-ref'; break; }
      await client.click({ ref });
      if (decision.label) clickedLabels.push('label:' + decision.label);
      depth += 1;
      await collector.observe({ ms: waitMs });
      const toUrl = await noteUrl();
      steps.push({ ref, label: decision.label || null, fromUrl: url, toUrl, reason: decision.reason || 'click' });
      if ((collector.raw?.() || []).some((e) => e && e.blocked)) { stopReason = 'blocked'; break; }
      continue;
    }

    stopReason = 'unknown-action';
    break;
  }

  return Object.freeze({ steps, visitedUrls, stopReason, depth });
}

// Same shape() rules as SMD_CONNECT_OBSERVER (discovery.mjs), stripped to what a live GET-only probe
// needs. Written as a real function so it is syntax-checked, serialized with String() and evaluated in
// the page realm. Must not close over anything from this module: every input arrives in `config`.
function SMD_CONNECT_PROBE(url, config) {
  var L = config.limits;
  var SENSITIVE_RE = new RegExp(config.sensitive, 'i');
  var HOSTILE_RE = /^(?:__proto__|constructor|prototype)$/;

  var shape = function (value, depth, budget) {
    if (budget.n++ > L.maxNodes) return 'truncated';
    if (value === null) return 'null';
    var t = typeof value;
    if (t !== 'object') return t;
    if (depth >= L.maxDepth) return 'object';
    if (Array.isArray(value)) return { type: 'array', sample: value.length ? shape(value[0], depth + 1, budget) : null };
    var out = {};
    var keys = Object.keys(value).slice(0, L.maxKeys);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (HOSTILE_RE.test(k)) continue;
      if (SENSITIVE_RE.test(k)) continue;
      if (k.length > L.maxStringLen) continue;
      out[k] = shape(value[k], depth + 1, budget);
    }
    return { type: 'object', keys: out };
  };

  return fetch(url, { credentials: 'include', method: 'GET' }).then(function (response) {
    var ct = '';
    try { ct = response.headers.get('content-type') || ''; } catch (e) { ct = ''; }
    if (!/json/i.test(ct)) {
      return JSON.stringify({ status: response.status, contentType: ct, responseShape: null, itemCount: null });
    }
    return response.json().then(function (body) {
      var s = null;
      try { s = shape(body, 0, { n: 0 }); } catch (e) { s = null; }
      var itemCount = Array.isArray(body) ? body.length : null;
      return JSON.stringify({ status: response.status, contentType: ct, responseShape: s, itemCount: itemCount });
    }, function () {
      return JSON.stringify({ status: response.status, contentType: ct, responseShape: null, itemCount: null });
    });
  }, function (err) {
    return JSON.stringify({ status: 0, contentType: '', responseShape: null, itemCount: null, error: String(err && err.message || err) });
  });
}

const PROBE_SOURCE = String(SMD_CONNECT_PROBE);
const PROBE_SENSITIVE = 'password|passwd|token|secret|cookie|authorization|session|csrf|jwt|mrn|patient.?name|phone|email|dob|address|ssn|national.?id';

/**
 * probePhone({ client, probes }) -> { probes: [{opId, status, contentType, responseShape, itemCount}] }
 *
 * Runs the CONTRACT live-probe policy in the page realm for each server-issued probe: a plain GET with
 * credentials, key-only response shape, never a raw value. Only probes the caller passed are executed —
 * this never widens beyond what the server asked for.
 */
export async function probePhone({ client, probes } = {}) {
  if (!client) throw new Error('probePhone requires a client');
  const list = Array.isArray(probes) ? probes : [];
  const config = { sensitive: PROBE_SENSITIVE, limits: LIMITS };
  const out = [];
  for (const probe of list) {
    if (!probe || !probe.opId || !probe.url) continue;
    const expression = `(${PROBE_SOURCE})(${JSON.stringify(String(probe.url))}, ${JSON.stringify(config)})`;
    const res = await client.evaluate({ expression });
    let parsed = null;
    try { parsed = JSON.parse(res?.result ?? 'null'); } catch { parsed = null; }
    out.push({
      opId: probe.opId,
      status: Number(parsed?.status ?? 0),
      contentType: String(parsed?.contentType ?? ''),
      responseShape: parsed?.responseShape ?? null,
      itemCount: parsed && typeof parsed.itemCount === 'number' ? parsed.itemCount : null,
    });
  }
  return { probes: out };
}

export { SKIP_LABEL };
