// connect-agent/manifest/validate.mjs — candidate-specific validation on synthetic fixtures.
//
// This is the "does this manifest actually work" gate, distinct from schema validation ("is this manifest
// well formed") and from the legacy discovery-artifact gate (controller.mjs#validateAdapterSpec, re-exported
// below unchanged so old approvals keep their exact meaning).
//
// It produces a deterministic evidence hash bound to the exact manifest contentHash. Change one byte of the
// manifest and the evidence no longer matches, so an activation bound to that evidence cannot be replayed
// against a different manifest.
import { validateManifest, manifestContentHash, canonicalJson, sha256, templatePlaceholders } from './schema.mjs';
import { executeOperation, SessionExpiredError } from './interpret.mjs';
import { buildBundle, evaluate } from './normalize.mjs';

export { validateAdapterSpec } from '../controller.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MED_STATUS = new Set(['active', 'inactive', 'completed', 'stopped', 'on-hold', 'not-taken', 'entered-in-error', 'unknown']);
const DATE_FIELDS = ['effectiveDateTime', 'date'];

/**
 * A fixture-backed transport. `routes` maps "<METHOD> <pathname><search>" to { status, headers?, body }.
 * Anything not in the map is a 404: a fixture cannot accidentally satisfy a request the manifest was not
 * supposed to make, which is what makes the "invented endpoint" and "undeclared URL" tests meaningful.
 */
export function createFixtureExec(fixture) {
  const routes = fixture.routes || {};
  const calls = [];
  return {
    calls,
    async request({ method, url }) {
      const u = new URL(url);
      const key = `${method} ${u.pathname}${u.search}`;
      calls.push(key);
      const route = Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : null;
      if (!route) return { status: 404, body: { error: 'no fixture route' } };
      if (route.throws) throw new Error(String(route.throws));
      return { status: route.status ?? 200, headers: route.headers || {}, body: route.body ?? null };
    },
  };
}

async function runAll({ manifest, fixture, limits }) {
  const exec = createFixtureExec(fixture);
  const results = [];
  let expired = false;
  for (const op of manifest.operations) {
    // Only the placeholders this template actually declares: the interpreter refuses an extra parameter
    // on purpose, so the fixture's shared param bag is narrowed per operation rather than passed whole.
    const needed = templatePlaceholders(op.pathTemplate);
    const params = {};
    for (const k of needed) if ((fixture.params || {})[k] !== undefined) params[k] = fixture.params[k];
    try {
      results.push(await executeOperation({ manifest, operationType: op.type, exec, params, limits, validate: false }));
    } catch (err) {
      if (err instanceof SessionExpiredError) { expired = true; continue; }
      results.push({ operationType: op.type, url: null, pages: [], itemCount: 0, partial: true, bytes: 0, calls: 0, warnings: [String(err.message).slice(0, 160)] });
    }
  }
  return { results, exec, expired };
}

/**
 * validateCandidate({ manifest, fixture, limits })
 *   -> { ok, activatable, manifestContentHash, checks, warnings, evidenceHash }
 *
 * `checks` is an ordered list of { name, ok, detail }. `warnings` carries every omitted-uncertain-field
 * note: this layer never fills a gap in, it reports it.
 */
export async function validateCandidate({ manifest, fixture, limits = {} }) {
  const checks = [];
  const warnings = [];
  const add = (name, ok, detail = '') => { checks.push({ name, ok, detail: String(detail).slice(0, 240) }); return ok; };

  const schemaErrors = validateManifest(manifest);
  add('schema', schemaErrors.length === 0, schemaErrors.join('; '));
  if (schemaErrors.length) {
    return finish({ manifest, checks, warnings, activatable: false });
  }
  add('content-hash', manifest.contentHash === manifestContentHash(manifest), 'contentHash must cover the manifest body');

  const first = await runAll({ manifest, fixture, limits });
  const second = await runAll({ manifest, fixture, limits });

  // Identity consistency: every item has a usable id, no id repeats across pages, and two identical runs
  // produce the same id sequence (a source that reshuffles pages would fail here). The id comes from the
  // OPERATION'S OWN DECLARED id MAPPING (mapping.fields.id), not an assumed raw `.id`/`.identifier` key -
  // a real EMR item has no reason to carry either literally (this is exactly why the manifest declares
  // how to derive one). Checking the raw key instead of the mapping made this fail on every source that
  // genuinely has no such key, which is the common case, not the exception.
  const idExprOf = (opType) => manifest.operations.find((op) => op.type === opType)?.mapping?.fields?.id || null;
  const idsOf = (run) => run.results.map((r) => {
    const idExpr = idExprOf(r.operationType);
    return {
      type: r.operationType,
      ids: r.pages.flatMap((p) => p.items.map((i) => {
        if (!idExpr || !i || typeof i !== 'object') return null;
        const v = evaluate(idExpr, i);
        return v.present && v.value !== null && v.value !== '' ? v.value : null;
      })),
    };
  });
  const idsA = idsOf(first);
  const idsB = idsOf(second);
  const missingIds = idsA.filter((e) => e.ids.some((id) => id === null || id === undefined || id === ''));
  add('identity-present', missingIds.length === 0, missingIds.map((e) => e.type).join(', '));
  const dupes = idsA.filter((e) => new Set(e.ids).size !== e.ids.length);
  add('identity-unique-across-pages', dupes.length === 0, dupes.map((e) => e.type).join(', '));
  add('identity-stable', canonicalJson(idsA) === canonicalJson(idsB), 'two identical runs must yield the same ids');

  const built = buildBundle({ manifest, results: first.results, tenantId: fixture.tenantId || null, generatedAt: null });
  warnings.push(...built.warnings);

  // Dates and time zones: every timestamp that survived normalization is an explicit UTC instant derived
  // from a declared zone. A timestamp we could not interpret was dropped with a warning, never guessed.
  const badDates = [];
  for (const list of [built.bundle.observations, built.bundle.documents]) {
    for (const r of list) for (const f of DATE_FIELDS) if (r[f] != null && !ISO.test(String(r[f]))) badDates.push(`${r.id}.${f}`);
  }
  for (const e of built.bundle.encounters) {
    for (const k of ['start', 'end']) if (e.period && e.period[k] != null && !ISO.test(String(e.period[k]))) badDates.push(`${e.id}.period.${k}`);
  }
  add('dates-normalized-to-declared-zone', badDates.length === 0, badDates.join(', '));

  // Units and reference ranges.
  const unitProblems = [];
  const rangeProblems = [];
  for (const o of built.bundle.observations) {
    if (o.value && typeof o.value === 'object' && 'value' in o.value) {
      if (o.value.value != null && (!o.value.unit || String(o.value.unit) === '1')) unitProblems.push(`${o.id}: numeric value with no source unit`);
    }
    const rr = o.referenceRange;
    if (rr && rr.low != null && rr.high != null && Number(rr.low) > Number(rr.high)) rangeProblems.push(`${o.id}: low > high`);
  }
  add('units-declared', unitProblems.length === 0, unitProblems.join('; '));
  add('reference-ranges-ordered', rangeProblems.length === 0, rangeProblems.join('; '));

  // Medication status and dose.
  const medProblems = [];
  for (const m of built.bundle.medications) {
    if (!MED_STATUS.has(String(m.status))) medProblems.push(`${m.id}: unknown status '${m.status}'`);
    if (m.dosage == null) warnings.push(`medication ${m.id}: no dose in source; omitted rather than assumed`);
  }
  add('medication-status', medProblems.length === 0, medProblems.join('; '));

  // Absent vs negative must be visibly distinguishable in the warnings the bundle carries.
  const hasAbsent = built.warnings.some((w) => w.startsWith('absent:'));
  const hasNegative = built.warnings.some((w) => w.startsWith('negative:'));
  add('absent-vs-negative-distinguished', hasAbsent || hasNegative || built.bundle.observations.length > 0,
    'a bundle must say whether a missing collection is unknown or genuinely empty');

  // Partial responses are reported as partial, and a partial read never counts as complete evidence.
  const partial = first.results.filter((r) => r.partial);
  add('partial-reads-reported', partial.every((r) => r.warnings.length > 0), partial.map((r) => r.operationType).join(', '));

  // Existing canonical validation, unchanged.
  add('sccm-bundle', built.validation.ok, built.validation.errors.join('; '));

  // Capability probes.
  const probeFailures = [];
  for (const probe of manifest.capabilityProbes) {
    const result = first.results.find((r) => r.operationType === probe.operationType);
    const count = result ? result.itemCount : 0;
    if (count < (probe.expect.minItems ?? 0)) probeFailures.push(`${probe.operationType}: ${count} item(s), expected at least ${probe.expect.minItems}`);
  }
  add('capability-probes', probeFailures.length === 0, probeFailures.join('; '));

  const ok = checks.every((c) => c.ok);
  // Activation floor. A candidate whose observation read produced nothing has not demonstrated the read
  // it claims, so it cannot be activated no matter how clean the rest of the evidence looks.
  const declaresResults = manifest.operations.some((o) => o.type === 'list_results');
  const emptyObservations = built.bundle.observations.length === 0;
  const activatable = ok && !partial.length && !first.expired && declaresResults && !emptyObservations;
  if (!declaresResults) warnings.push('not activatable: no list_results operation was compiled for this deployment');
  if (declaresResults && emptyObservations) warnings.push('not activatable: the observation read produced no rows on the validation fixture');

  return finish({ manifest, checks, warnings, activatable });
}

function finish({ manifest, checks, warnings, activatable }) {
  const contentHash = typeof manifest?.contentHash === 'string' ? manifest.contentHash : null;
  const ok = checks.every((c) => c.ok);
  const uniqueWarnings = [...new Set(warnings)].sort();
  // Bound to the manifest contentHash: evidence for one manifest can never be presented for another.
  const evidenceHash = sha256(canonicalJson({ manifestContentHash: contentHash, checks, warnings: uniqueWarnings, activatable }));
  return { ok, activatable, manifestContentHash: contentHash, checks, warnings: uniqueWarnings, evidenceHash };
}
