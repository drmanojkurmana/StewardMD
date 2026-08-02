// functions/_connect/onboard/ai-map.js — AI-assisted field mapping suggestion ("Suggest mapping" in the
// onboarding wizard). A hospital admin's CSV headers or REST/JSON keys are schema METADATA, not a data row —
// but this module is still built to the same PHI-safety bar as the rest of onboarding: the injected
// deps.aiSuggest seam is called with ONLY the header strings + the fixed SCCM target-field allow-list
// (derived from csv-upload.js's own mapper, never a second hardcoded list), and NOTHING else — no tenant id,
// no row/cell/patient value, no free text. Its response is then VALIDATED: any mapped field that is not one of
// the known SCCM fields is dropped (never trust a hallucinated field name), and any header the model didn't
// echo back verbatim from the input is dropped too (it cannot smuggle in a header we never asked about).
// deps.aiSuggest is absent by default (see the router's // VERIFY note) — flag off, no aiSuggest, or ANY
// aiSuggest error all fall back to the SAME deterministic inferColumnMap the CSV upload path already uses, so
// a suggestion is always available whether or not an LLM is wired up.
import { requireCan } from "../enterprise/guard.js";
import { makeAuditSink } from "../audit.js";
import { inferColumnMap, SCCM_TARGET_FIELDS } from "./csv-upload.js";
import { OnboardError } from "./errors.js";

const FIELD_SET = new Set(SCCM_TARGET_FIELDS);

// Drop anything the model invented: a mapped value must be a known SCCM field, and a mapped header must be
// one of the INPUT headers verbatim (structural allow-list on both sides of the pair, not just the value).
function validateAiMap(raw, headers) {
  const map = {};
  if (!raw || typeof raw !== "object") return map;
  const headerSet = new Set(headers);
  for (const key of Object.keys(raw)) {
    if (!headerSet.has(key)) continue;                              // not one of the headers we asked about
    const field = raw[key];
    if (typeof field !== "string" || !FIELD_SET.has(field)) continue; // not a real SCCM field — drop it
    map[key] = field;
  }
  return map;
}

// Pure/injectable. headers: array of column-name STRINGS only (schema metadata — never a data row/cell/
// patient value). Returns { map, source: "ai" | "heuristic" }.
export async function suggestFieldMap(deps, headers, opts = {}) {
  const hdrs = Array.isArray(headers) ? headers.filter((h) => typeof h === "string") : [];
  if (deps && typeof deps.aiSuggest === "function") {
    try {
      // The ENTIRE payload ever handed to the suggester: header strings + the fixed target-field list. Never
      // add another key here (no tenantId, no sample row, no free text) — this is the PHI-safety invariant.
      const payload = { headers: hdrs.slice(), fields: SCCM_TARGET_FIELDS.slice() };
      const raw = await deps.aiSuggest(payload);
      return { map: validateAiMap(raw, hdrs), source: "ai" };
    } catch {
      return { map: inferColumnMap(hdrs), source: "heuristic" };     // aiSuggest threw -> deterministic fallback
    }
  }
  return { map: inferColumnMap(hdrs), source: "heuristic" };         // no aiSuggest wired -> deterministic fallback
}

// The endpoint fn: RBAC-gated (connector:write, same action as saveConnection — this shapes a connection's
// config, it does not view PHI), rejects a headers array that isn't plain strings (so a caller can't smuggle
// row/cell data in through this seam), and audits a PHI-free outcome (counts + source only — never a header
// name or a mapped value, exactly like csv-upload's counts-only audit).
export async function suggestMapping(deps, request, env, tenantId, body = {}) {
  const { actor, tenant } = await requireCan(deps, request, env, tenantId, "connector:write");

  const headers = body.headers;
  if (!Array.isArray(headers) || headers.length === 0 || headers.some((h) => typeof h !== "string"))
    throw new OnboardError("invalid", "headers must be a non-empty array of strings");

  const t0 = Date.now();
  const { map, source } = await suggestFieldMap(deps, headers, {});

  // PHI-free audit: outcome + source + header/mapped COUNTS only — the audit ALLOW filter keeps these inside
  // resourceCounts/scope and structurally drops anything else, so no header name / mapped value can leak.
  await makeAuditSink(env, deps.db)({
    tenantId: tenant.id, actor: actor.id, action: "connect.onboard.map_suggested",
    resourceCounts: { headerCount: headers.length, mappedCount: Object.keys(map).length },
    scope: { source },
    latencyMs: Date.now() - t0, outcome: "ok", ts: new Date().toISOString(),
  });

  return { ok: true, map, source };
}
