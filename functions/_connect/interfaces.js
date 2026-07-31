// functions/_connect/interfaces.js — connector contract guards + injected ctx + conformance harness (spec §5)
import { validateBundle } from "./canonical/validate.js";
import { ALLOW as AUDIT_ALLOW_LIST } from "./audit.js";

const PULL_METHODS = ["capabilities", "authenticate", "validate", "fetchPatient", "normalize"];
const EVENT_METHODS = ["authenticate", "validate", "initiate", "ingest", "normalize"];

export function assertConnector(c) {
  if (!c || !c.meta || !c.meta.profile) throw new Error("connector.meta.profile required");
  const need = c.meta.profile === "event" ? EVENT_METHODS : PULL_METHODS;
  const missing = need.filter((m) => typeof c[m] !== "function");
  if (missing.length) throw new Error("connector missing method(s): " + missing.join(", "));
  if (c.meta.sccmVersion !== "1.0") throw new Error("connector must declare sccmVersion 1.0");
}

const AUDIT_ALLOW = new Set(AUDIT_ALLOW_LIST);

// A valid injected ctx with a spying audit sink that RECORDS raw payloads so the harness can detect leaks.
export function makeCtx(over = {}) {
  const recorded = [];
  const ctx = {
    tenant: over.tenant || { id: "t-mock", mode: "sandbox", settings: {} },
    config: over.config || {},
    secrets: over.secrets || (async () => "x"),
    scope: over.scope || ["Patient", "Condition", "Observation"],
    now: over.now || (() => new Date(0)),
    fetch: over.fetch || (async () => new Response("{}")),
    audit: (e) => { recorded.push(e); },
    logger: over.logger || { warn() {}, error() {} },
    budget: over.budget || { maxSubrequests: 20, deadlineMs: 5000, maxPagesPerResource: 5 },
  };
  ctx._recorded = recorded;
  return ctx;
}

export async function runConformance(connector, opts = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail: detail || "" });
  try { assertConnector(connector); add("contract", true); } catch (e) { add("contract", false, e.message); }

  const ctx = makeCtx({ fetch: opts.fetch });
  try { await connector.authenticate(ctx); add("authenticate", true); } catch (e) { add("authenticate", false, e.message); }
  try { const c = await connector.capabilities(ctx); add("capabilities", !!c); } catch (e) { add("capabilities", false, e.message); }

  let bundle;
  try {
    const raw = await connector.fetchPatient(ctx, (opts.fixtures || {}).patientRef);
    bundle = await connector.normalize(ctx, raw);
    add("fetch+normalize", true);
  } catch (e) { add("fetch+normalize", false, e.message); }

  if (bundle) { const v = validateBundle(bundle); add("valid-sccm", v.ok, v.errors.join("; ")); }

  // No PHI in audit: every recorded event must contain only allow-listed keys.
  const leak = ctx._recorded.find((e) => Object.keys(e).some((k) => !AUDIT_ALLOW.has(k)));
  add("no-phi-in-audit", !leak, leak ? "disallowed key(s): " + Object.keys(leak).join(",") : "");

  return { passed: checks.every((c) => c.ok), checks };
}
