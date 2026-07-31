// functions/_connect/sdk/conformance.js — Track C: profile-aware connector conformance kit (spec §5).
// A superset of interfaces.runConformance that dispatches on descriptor.profile. Checks 6 (normalize ->
// valid SCCM) and 7 (deterministic, source-derived ids) run ONLY when descriptor.capabilities.emitsBundle.
// Reuses assertConnector/makeCtx, validateBundle, the audit ALLOW-list, and the typed errors. Synthetic only.
import { assertConnector, makeCtx } from "../interfaces.js";
import { validateBundle } from "../canonical/validate.js";
import { ALLOW } from "../audit.js";
import { UpstreamError, AuthError } from "../permission.js";
import { describe, assertDescriptor } from "./descriptor.js";

const ALLOW_SET = new Set(ALLOW);
export class ConformanceError extends Error { constructor(msg, failed) { super(msg); this.name = "ConformanceError"; this.failed = failed || []; } }

const rejectingFetch = async () => { throw new Error("upstream down"); };
const BUNDLE_KEYS = ["encounters", "conditions", "medications", "allergies", "observations", "diagnosticReports", "documents"];

function isTyped(e) {
  if (e instanceof UpstreamError || e instanceof AuthError) return true;   // the connector's own typed errors
  const n = e && (e.name || (e.constructor && e.constructor.name));
  return !!n && /Error$/.test(n) && !["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(n);
}
function idSet(b) {
  const out = [];
  if (b) { if (b.patient && b.patient.id) out.push("Patient:" + b.patient.id); for (const k of BUNDLE_KEYS) (b[k] || []).forEach((r) => r && r.id && out.push(k + ":" + r.id)); }
  return out.sort();
}
async function produce(connector, descriptor, opts, ctx) {
  if (descriptor.profile === "pull") { const raw = await connector.fetchPatient(ctx, (opts.fixtures || {}).patientRef); return connector.normalize(ctx, raw); }
  const r = await connector.ingest(ctx, (opts.fixtures || {}).rawEvent); return r ? r.bundle : null;
}
const ctxOf = (opts, over = {}) => makeCtx(Object.assign({ fetch: opts.fetch }, (opts.fixtures || {}).scope ? { scope: opts.fixtures.scope } : {}, over));

export async function runConformance(connector, opts = {}) {
  const checks = [];
  const add = (name, ok, detail, skipped) => checks.push({ name, ok: skipped ? true : !!ok, skipped: !!skipped, detail: detail || "" });
  let descriptor = null;
  try { assertConnector(connector); descriptor = describe(connector); assertDescriptor(descriptor); add("1-contract", true); }
  catch (e) { add("1-contract", false, e.message); return { passed: false, checks, descriptor }; }
  const profile = descriptor.profile, emits = descriptor.capabilities.emitsBundle;

  // 2 authenticate does not throw uncontrolled on a healthy ctx
  try { await connector.authenticate(ctxOf(opts)); add("2-authenticate", true); } catch (e) { add("2-authenticate", false, e.message); }

  // 3 authenticate is retryable: a rejecting fetch -> resolves OR a typed error, never an uncontrolled throw
  try { await connector.authenticate(ctxOf(opts, { fetch: rejectingFetch })); add("3-authenticate-retryable", true); }
  catch (e) { add("3-authenticate-retryable", isTyped(e), isTyped(e) ? "" : "uncontrolled throw: " + (e.name || "Error")); }

  // 4 capabilities degrades gracefully (pull only)
  if (profile === "pull") { try { add("4-capabilities", !!(await connector.capabilities(ctxOf(opts)))); } catch (e) { add("4-capabilities", false, e.message); } }
  else add("4-capabilities", true, "n/a (event profile)", true);

  // 5 validate returns a report object without throwing
  try { const v = await connector.validate(ctxOf(opts)); add("5-validate", v && typeof v === "object"); } catch (e) { add("5-validate", false, e.message); }

  // 6 normalize -> valid SCCM (emits only)
  if (emits) { try { const b = await produce(connector, descriptor, opts, ctxOf(opts)); const v = b ? validateBundle(b) : { ok: false, errors: ["no bundle"] }; add("6-valid-sccm", v.ok, (v.errors || []).join("; ")); } catch (e) { add("6-valid-sccm", false, e.message); } }
  else add("6-valid-sccm", true, "skipped (emitsBundle=false)", true);

  // 7 deterministic + source-derived (not tenant-salted) ids (emits only)
  if (emits) {
    try {
      const A1 = idSet(await produce(connector, descriptor, opts, ctxOf(opts, { tenant: { id: "t-A", mode: "sandbox", settings: {} } })));
      const A2 = idSet(await produce(connector, descriptor, opts, ctxOf(opts, { tenant: { id: "t-A", mode: "sandbox", settings: {} } })));
      const B1 = idSet(await produce(connector, descriptor, opts, ctxOf(opts, { tenant: { id: "t-B", mode: "sandbox", settings: {} } })));
      const deterministic = JSON.stringify(A1) === JSON.stringify(A2);
      const notSalted = JSON.stringify(A1) === JSON.stringify(B1);
      add("7-deterministic-ids", deterministic && notSalted && A1.length > 0, !deterministic ? "ids not stable across runs" : (!notSalted ? "ids differ by tenant (salted) — must be source-derived (C5)" : (A1.length ? "" : "no ids to check")));
    } catch (e) { add("7-deterministic-ids", false, e.message); }
  } else add("7-deterministic-ids", true, "skipped (emitsBundle=false)", true);

  // 8 no PHI in audit: every recorded ctx.audit event has only ALLOW keys
  try {
    const spy = ctxOf(opts);
    await produce(connector, descriptor, opts, spy).catch(() => {});
    const leak = (spy._recorded || []).find((e) => e && typeof e === "object" && Object.keys(e).some((k) => !ALLOW_SET.has(k)));
    add("8-no-phi-in-audit", !leak, leak ? "disallowed audit key(s): " + Object.keys(leak).join(",") : "");
  } catch (e) { add("8-no-phi-in-audit", false, e.message); }

  // 9 no secret in logs/errors: a sentinel secret must not surface in a logger arg or a thrown message/stack
  try {
    const SENT = "SENTINEL-" + Math.random().toString(36).slice(2);
    const seen = [];
    const over = { logger: { warn: (...a) => seen.push(...a), error: (...a) => seen.push(...a) }, secrets: async () => SENT };
    for (const run of [() => produce(connector, descriptor, opts, ctxOf(opts, over)), () => connector.authenticate(ctxOf(opts, over)), () => connector.validate(ctxOf(opts, over))]) {
      try { await run(); } catch (e) { seen.push(e && e.message, e && e.stack); }
    }
    const leaked = seen.some((x) => String(x == null ? "" : x).includes(SENT));
    add("9-no-secret-leak", !leaked, leaked ? "the injected secret sentinel leaked into a log or error" : "");
  } catch (e) { add("9-no-secret-leak", false, e.message); }

  // 10 fail-closed on upstream error: a rejecting fetch -> a typed throw OR a degraded (warned) / null bundle,
  // never a complete-looking bundle with no warnings, never an uncontrolled error.
  try {
    let ok, detail = "";
    try {
      const b = await produce(connector, descriptor, opts, ctxOf(opts, { fetch: rejectingFetch }));
      ok = b === null || !!(b && b.meta && Array.isArray(b.meta.warnings) && b.meta.warnings.length);
      if (!ok) detail = "returned a complete bundle with no warnings on upstream failure (fail-open)";
    } catch (e) { ok = isTyped(e); if (!ok) detail = "threw an uncontrolled error: " + (e.name || "Error"); }
    add("10-fail-closed", ok, detail);
  } catch (e) { add("10-fail-closed", false, e.message); }

  return { passed: checks.every((c) => c.ok), checks, descriptor };
}

export async function assertConforms(connector, opts = {}) {
  const { passed, checks } = await runConformance(connector, opts);
  if (!passed) { const failed = checks.filter((c) => !c.ok).map((c) => c.name); throw new ConformanceError("connector '" + ((connector.meta || {}).id) + "' failed conformance: " + failed.join(", "), failed); }
}
