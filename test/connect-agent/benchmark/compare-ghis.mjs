// test/connect-agent/benchmark/compare-ghis.mjs — GHIS zero-knowledge benchmark comparator.
//
// NEVER imported by connect-agent/** or functions/**. The discovery agent under test must never see
// ghis-expected.json or this file — it is graded against them from the outside, after the fact, by
// this benchmark harness only. Importing either from the agent's own code would leak the answer key
// into the thing being scored (defeats "zero-knowledge").
//
// compareAgainstExpected() accepts EITHER of the agent's two output shapes:
//   - a discovery spec:      { events: [{ method, path, origin, queryKeys, status, contentType, responseShape }] }
//   - a compiled manifest:   { origins: [{id, origin}], operations: [{ method, originId, pathTemplate, ... }] }
// and grades it against ghis-expected.json's `entries` list.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Copied from connect-agent/discovery.mjs (ID_SEGMENT / redactPath) — NOT imported, because this file
// must never depend on connect-agent/** (this harness is the outside grader, not a consumer). Kept
// behaviorally identical; if discovery.mjs's rule changes, update this copy too.
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24}|[A-Za-z0-9_-]{16,}|.*\d{4,}.*)$/i;

function normalizeIdSegment(seg) {
  if (/^\{[^}]*\}$/.test(seg)) return '{id}';           // manifest pathTemplate placeholder, e.g. {patientId}
  return ID_SEGMENT.test(seg) ? '{id}' : seg;
}

/** Normalise a path for comparison: id-like segments -> {id}, no trailing slash, and a trailing
 *  {id} segment is collapsed away so a base path declared with a trailing slash (an id passed as a
 *  query key, e.g. GetMedicines/?id=) still matches an id captured as a path segment. */
export function normalizePath(pathname) {
  let p = String(pathname || '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p === '') p = '/';
  const segs = p.split('/').map(normalizeIdSegment);
  if (segs.length > 1 && segs[segs.length - 1] === '{id}') segs.pop();
  const out = segs.join('/');
  return out === '' ? '/' : out;
}

function loadEntries(expected) {
  return Array.isArray(expected) ? expected : (expected && expected.entries) || [];
}

function originsMapFromManifest(manifest) {
  const m = {};
  for (const o of manifest.origins || []) m[o.id] = o.origin;
  return m;
}

/** Extract a flat { method, origin, path } list from either input shape. */
function extractObserved(manifestOrSpec) {
  if (!manifestOrSpec || typeof manifestOrSpec !== 'object') {
    throw new Error('compareAgainstExpected: manifestOrSpec must be an object');
  }
  if (Array.isArray(manifestOrSpec.events)) {
    return manifestOrSpec.events.map((e) => ({
      method: String(e.method || 'GET').toUpperCase(),
      origin: e.origin,
      path: normalizePath(e.path),
    }));
  }
  if (Array.isArray(manifestOrSpec.operations)) {
    const originsMap = originsMapFromManifest(manifestOrSpec);
    return manifestOrSpec.operations.map((op) => ({
      method: String(op.method || 'GET').toUpperCase(),
      origin: originsMap[op.originId],
      path: normalizePath(op.pathTemplate),
    }));
  }
  throw new Error('compareAgainstExpected: input must be a discovery spec ({events:[...]}) or a compiled manifest ({operations:[...]})');
}

function matchKey(e) { return `${e.method} ${e.origin} ${e.path}`; }

/**
 * compareAgainstExpected(manifestOrSpec, expected) -> {
 *   discovered, missed, extra, writesProposed, coverageByKind, score
 * }
 * A path matches when method + origin are equal and normalizePath(observed) === normalizePath(expected).
 * score = found read (non-write) entries / expected read entries.
 */
export function compareAgainstExpected(manifestOrSpec, expected) {
  const entries = loadEntries(expected);
  const observed = extractObserved(manifestOrSpec);
  const observedKeys = new Set(observed.map(matchKey));

  const discovered = [];
  const missed = [];
  const writesProposed = [];
  const coverageByKind = {};

  for (const entry of entries) {
    const key = matchKey({ method: entry.method, origin: entry.origin, path: normalizePath(entry.path) });
    const found = observedKeys.has(key);
    const kind = entry.kind || 'other';
    coverageByKind[kind] = coverageByKind[kind] || { expected: 0, found: 0 };
    coverageByKind[kind].expected += 1;
    if (found) {
      coverageByKind[kind].found += 1;
      discovered.push(entry);
      if (entry.write) writesProposed.push(entry);
    } else {
      missed.push(entry);
    }
  }

  const expectedKeys = new Set(entries.map((e) => matchKey({ method: e.method, origin: e.origin, path: normalizePath(e.path) })));
  const extra = observed.filter((o) => !expectedKeys.has(matchKey(o)));

  const readEntries = entries.filter((e) => !e.write);
  const readFound = discovered.filter((e) => !e.write).length;
  const score = readEntries.length ? readFound / readEntries.length : 0;

  return { discovered, missed, extra, writesProposed, coverageByKind, score };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: node compare-ghis.mjs <spec-or-manifest.json>');
    process.exit(1);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const expected = JSON.parse(readFileSync(path.join(here, 'ghis-expected.json'), 'utf8'));
  const input = JSON.parse(readFileSync(path.resolve(inputPath), 'utf8'));

  const result = compareAgainstExpected(input, expected);

  const foundKeys = new Set(result.discovered.map((e) => matchKey({ method: e.method, origin: e.origin, path: normalizePath(e.path) })));
  console.log('op                       method  kind              status  path');
  for (const entry of loadEntries(expected)) {
    const key = matchKey({ method: entry.method, origin: entry.origin, path: normalizePath(entry.path) });
    const pass = foundKeys.has(key);
    const tag = pass ? 'PASS' : 'FAIL';
    console.log(`${entry.op.padEnd(24)} ${entry.method.padEnd(6)}  ${(entry.kind || '').padEnd(16)}  ${tag}    ${entry.path}${entry.write ? '  [write]' : ''}`);
  }
  console.log('');
  console.log(`score: ${result.score.toFixed(3)}  (${result.discovered.filter((e) => !e.write).length}/${loadEntries(expected).filter((e) => !e.write).length} read endpoints found)`);
  if (result.writesProposed.length) {
    console.log(`WRITE ENDPOINTS PROPOSED (should never happen): ${result.writesProposed.map((e) => e.op).join(', ')}`);
  }
  if (result.extra.length) {
    console.log(`extra (observed, not in expected): ${result.extra.length}`);
  }

  const fail = result.writesProposed.length > 0 || result.score < 0.5;
  process.exit(fail ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
}
