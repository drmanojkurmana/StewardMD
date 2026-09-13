/* functions/_connect/agent/brain.js - the model that helps the Connect Agent read a hospital's SCREENS.
 *
 * Three questions, all about STRUCTURE and never about a patient:
 *   classify     "which resource is this screen" (labels, headers, path, redacted snapshot)
 *   map-columns  "which canonical role does each column header play"
 *   next         "which of these controls leads to the resource still missing"
 *
 * THE PHI GATE IS THE CONTRACT. Nothing reaches the model unless every string in the request passes
 * phiGate(): only whitelisted keys, capped lengths, no run of 3+ digits (an MRN, a phone, a date), no
 * '@' (an email), no control characters. The phone redacts before sending; this refuses regardless.
 *
 * Every answer is advisory. The deterministic validator (connect-agent/manifest) still decides what
 * enters an adapter. Answers are cached per hospital origin and structure hash (KV, 30 days), so one
 * EMR costs one model call per screen shape, not one per doctor.
 *
 * The model is reached through the MaiK gateway's Google adapter (functions/_wardsynq/maik-gateway.js)
 * so its key handling, timeouts and error scrubbing apply. The model id comes from CONNECT_AGENT_MODEL
 * (default: the registry's newest Gemini Pro), the surface from CONNECT_AGENT_MODEL_PROVIDER
 * ("vertex" default, "gemini" for AI Studio). A dated id is never hard-coded here.
 */
import { PROVIDERS, MODELS } from "../../_wardsynq/maik-gateway.js";
import { sha256hex } from "./hmac.js";

export const RESOURCES = Object.freeze(["worklist", "patient", "notes", "labs", "radiology", "medications", "discharge", "history"]);
/* The column roles connect-agent/manifest/infer-html.mjs knows (its HEADER_RULES vocabulary). A role
 * the deterministic side cannot consume is useless as a hint, so the answer is clamped to this list. */
export const ROLES = Object.freeze([
  "doctor", "prodCode", "drugName", "route", "dosage", "frequency", "duration", "testName", "method",
  "result", "unit", "reference", "patientId", "visitId", "name", "department", "age", "sex", "bed",
  "visitType", "date", "title", "report",
]);
export const OPS = Object.freeze(["classify", "map-columns", "next", "verify"]);
export const SUGGESTIONS = Object.freeze(["ok", "other-endpoint", "ask-doctor"]);

const LIMITS = Object.freeze({ str: 120, list: 60, snapshot: 8000, path: 300 });
const DIGITS = /\d{3,}/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/; // newlines and tabs are fine: the snapshot is line-based
const ALLOWED_KEYS = Object.freeze({
  "classify": ["op", "origin", "path", "headers", "labels", "snapshot", "ask"],
  "map-columns": ["op", "origin", "resource", "headers"],
  "next": ["op", "origin", "controls", "looking", "path"],
  "verify": ["op", "origin", "resource", "headers", "rowCount", "kind", "path"],
});

function str(v) { return typeof v === "string" ? v : ""; }

function badString(s, max) {
  if (typeof s !== "string") return "not a string";
  if (s.length > max) return "longer than " + max;
  if (DIGITS.test(s)) return "carries a run of 3+ digits";
  if (s.indexOf("@") >= 0) return "carries an @";
  if (CONTROL.test(s)) return "carries control characters";
  return null;
}

function cleanList(list, name, max) {
  if (!Array.isArray(list)) return { error: name + " must be an array" };
  if (list.length > LIMITS.list) return { error: name + " has more than " + LIMITS.list + " entries" };
  const out = [];
  for (const s of list) {
    const why = badString(s, max);
    if (why) return { error: name + " entry " + why };
    const t = s.replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return { list: out };
}

/**
 * phiGate(payload) -> { ok: true, clean } | { ok: false, reason }
 * Pure. `clean` carries only the whitelisted keys for the op, each checked.
 */
export function phiGate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "payload must be an object" };
  const op = str(payload.op);
  if (OPS.indexOf(op) < 0) return { ok: false, reason: "op must be one of " + OPS.join(", ") };
  const allowed = ALLOWED_KEYS[op];
  for (const k of Object.keys(payload)) {
    if (allowed.indexOf(k) < 0) return { ok: false, reason: "key \"" + k + "\" is not accepted for " + op };
  }
  let origin = "";
  try {
    const u = new URL(str(payload.origin));
    if (u.protocol !== "https:") return { ok: false, reason: "origin must be https" };
    origin = u.origin;
  } catch { return { ok: false, reason: "origin must be an absolute https origin" }; }

  const clean = { op, origin };
  if (payload.path !== undefined) {
    const why = badString(payload.path, LIMITS.path);
    if (why) return { ok: false, reason: "path " + why };
    let p = payload.path;
    try { p = /^https?:/i.test(p) ? new URL(p).pathname : p; } catch { /* keep as given */ }
    clean.path = p.split("?")[0].slice(0, LIMITS.path);
  }
  for (const k of ["headers", "labels", "controls"]) {
    if (payload[k] === undefined) continue;
    const r = cleanList(payload[k], k, LIMITS.str);
    if (r.error) return { ok: false, reason: r.error };
    clean[k] = r.list;
  }
  if (payload.looking !== undefined) {
    const r = cleanList(payload.looking, "looking", 32);
    if (r.error) return { ok: false, reason: r.error };
    if (r.list.some((x) => RESOURCES.indexOf(x) < 0)) return { ok: false, reason: "looking names an unknown resource" };
    clean.looking = r.list;
  }
  for (const k of ["resource", "ask"]) {
    if (payload[k] === undefined) continue;
    if (RESOURCES.indexOf(payload[k]) < 0) return { ok: false, reason: k + " names an unknown resource" };
    clean[k] = payload[k];
  }
  if (payload.rowCount !== undefined) {
    const n = Number(payload.rowCount);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { ok: false, reason: "rowCount must be a whole number" };
    clean.rowCount = n;
  }
  if (payload.kind !== undefined) {
    if (["json", "html", "page", "endpoint", "empty", "none"].indexOf(payload.kind) < 0) return { ok: false, reason: "kind must name a response kind" };
    clean.kind = payload.kind;
  }
  if (payload.snapshot !== undefined) {
    const why = badString(payload.snapshot, LIMITS.snapshot);
    if (why) return { ok: false, reason: "snapshot " + why };
    clean.snapshot = payload.snapshot;
  }
  if (op === "classify" && !(clean.headers || []).length && !(clean.labels || []).length && !clean.snapshot) return { ok: false, reason: "classify needs headers, labels or a snapshot" };
  if (op === "map-columns" && (!clean.resource || !(clean.headers || []).length)) return { ok: false, reason: "map-columns needs resource and headers" };
  if (op === "next" && (!(clean.controls || []).length || !(clean.looking || []).length)) return { ok: false, reason: "next needs controls and looking" };
  if (op === "verify" && (!clean.resource || clean.rowCount === undefined)) return { ok: false, reason: "verify needs resource and rowCount" };
  return { ok: true, clean };
}

function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

/** The structure hash the cache is keyed by: everything the model sees except the origin. */
export async function structureHash(clean) {
  const { origin, ...rest } = clean;
  return sha256hex(canonical(rest));
}

/* ---- prompts ------------------------------------------------------------------------------------- */

const SYSTEM = "You help a read-only integration agent understand the SCREENS of a hospital EMR. "
  + "You are given screen structure only: element labels, table column headers, a URL path and an accessibility-style outline. "
  + "There is never any patient data. Answer with a single JSON object and nothing else.";

function promptFor(clean) {
  if (clean.op === "classify") {
    return "Screen structure:\n" + JSON.stringify({ path: clean.path || null, headers: clean.headers || [], labels: clean.labels || [], outline: clean.snapshot || null })
      + "\n\nResources: " + RESOURCES.join(", ") + ".\n"
      + "worklist = a list of many patients (ward list, OPD/IPD list, my patients). patient = one patient's demographics. "
      + "notes = clinical/assessment notes. labs = laboratory results. radiology = imaging reports. medications = drug chart, prescription, treatment sheet, MAR. "
      + "discharge = discharge summary. history = visit or encounter history.\n"
      + (clean.ask ? "The doctor was asked to show: " + clean.ask + ". Say whether this screen is that.\n" : "")
      + "Answer: {\"resource\": <one of the resources or \"none\">, \"confidence\": <0 to 1>, \"reason\": <short>}";
  }
  if (clean.op === "map-columns") {
    return "A " + clean.resource + " table has these column headers, in order:\n" + JSON.stringify(clean.headers)
      + "\n\nRoles: " + ROLES.join(", ") + ".\n"
      + "Map each header to the ONE role it plays, or leave it out if none fits. patientId = MRN/UHID/hospital number, visitId = visit/episode/admission number, name = the patient's name (never the doctor's), sex = gender, age = age or DOB, bed = bed/room, department = ward/dept/unit, drugName = medicine, prodCode = drug code, testName = investigation name, result = the result value, reference = normal range, date = any date column, title = report/study title, report = report body or summary.\n"
      + "Answer: {\"fields\": {<header>: <role>, ...}}";
  }
  if (clean.op === "verify") {
    return "A read-only agent replayed the call it discovered for the resource \"" + clean.resource + "\"" + (clean.path ? " (" + clean.path + ")" : "") + " for one real patient and got "
      + clean.rowCount + " rows of kind " + (clean.kind || "unknown") + " with these columns:\n" + JSON.stringify(clean.headers || [])
      + "\n\nJudge the STRUCTURE only. Is this really the patient's " + clean.resource + " (worklist = many patients of a ward, not a list of doctors, departments or menu items; labs = investigations with results, not just an order list; medications = drugs with dose or frequency; radiology = studies with reports; notes/history/discharge = clinical text or visit rows)? "
      + "Answer: {\"ok\": <true|false>, \"resource\": <what these columns most likely are, one of " + RESOURCES.join(", ") + " or \"none\">, \"confidence\": <0 to 1>, \"reason\": <short>, \"suggestion\": <\"ok\" if it is right, \"other-endpoint\" if another call is likely to hold the real data, \"ask-doctor\" if only the doctor can show where it lives>}";
  }
  return "A read-only agent is on an EMR screen" + (clean.path ? " at path " + clean.path : "") + " and can tap ONE of these controls (labels, in order, zero-based):\n"
    + JSON.stringify(clean.controls) + "\n\nIt is still looking for: " + clean.looking.join(", ") + ".\n"
    + "Which control most likely opens one of those resources? Never choose anything that could write, order, print, send, sign out, delete or change data.\n"
    + "Answer: {\"index\": <zero-based index or -1 if none>, \"resource\": <which resource it opens or \"none\">, \"reason\": <short>}";
}

function parseJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("the model did not answer with JSON");
  return JSON.parse(t.slice(start, end + 1));
}

/** Clamp the model's answer to the shape the phone may act on. Anything outside the vocabulary is dropped. */
export function shapeAnswer(clean, raw) {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const reason = str(a.reason).slice(0, 200);
  if (clean.op === "classify") {
    const resource = RESOURCES.indexOf(a.resource) >= 0 ? a.resource : "none";
    const c = Number(a.confidence);
    return { resource, confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0, reason };
  }
  if (clean.op === "map-columns") {
    const fields = {};
    const src = a.fields && typeof a.fields === "object" && !Array.isArray(a.fields) ? a.fields : {};
    for (const h of clean.headers) {
      const role = src[h];
      if (ROLES.indexOf(role) >= 0 && !Object.values(fields).includes(role)) fields[h] = role;
    }
    return { fields };
  }
  if (clean.op === "verify") {
    const c = Number(a.confidence);
    return { ok: a.ok === true, resource: RESOURCES.indexOf(a.resource) >= 0 ? a.resource : "none", confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0, reason, suggestion: SUGGESTIONS.indexOf(a.suggestion) >= 0 ? a.suggestion : (a.ok === true ? "ok" : "ask-doctor") };
  }
  const idx = Number.isInteger(a.index) && a.index >= 0 && a.index < clean.controls.length ? a.index : -1;
  const resource = RESOURCES.indexOf(a.resource) >= 0 ? a.resource : "none";
  return { index: idx, control: idx >= 0 ? clean.controls[idx] : null, resource, reason };
}

/* ---- the call ------------------------------------------------------------------------------------ */

const CACHE_TTL_S = 30 * 24 * 3600;
const CACHE_PREFIX = "connect-agent:brain:";

/* THE MODEL IS CONFIGURED, NEVER DEFAULTED. The owner provisioned a specific Gemini for the Connect
 * Agent; running on whatever the registry happens to list was a silent substitution (every brain call
 * until 2026-09-13 went to the registry default because CONNECT_AGENT_MODEL was unset). No model id,
 * no brain: the call fails with that reason and the phone falls back to its deterministic rules. */
export function brainModel(env) {
  const provider = str(env && env.CONNECT_AGENT_MODEL_PROVIDER) || "vertex";
  const model = str(env && env.CONNECT_AGENT_MODEL);
  if (!model) throw new Error("CONNECT_AGENT_MODEL is not set: the Connect Agent brain has no configured model");
  if (!PROVIDERS[provider] || provider === "wardsynq" || provider === "local-openai") throw new Error("CONNECT_AGENT_MODEL_PROVIDER must be vertex or gemini");
  return { provider, model };
}

async function generate({ env, fetchImpl, generateImpl, system, prompt }) {
  const { provider, model } = brainModel(env);
  const req = { env, config: { timeoutMs: 45000 }, model: { model }, system, prompt, fetchImpl };
  if (typeof generateImpl === "function") return generateImpl(req, provider);
  try {
    return await PROVIDERS[provider].generate(req);
  } catch (e) {
    /* The same key serves both Google surfaces; when nobody pinned one, a Vertex refusal (project
     * not enabled, region) still gets an answer from AI Studio. Pinned providers fail as pinned. */
    throw e;
  }
}

/**
 * askBrain({ env, kv, fetchImpl, generateImpl, payload }) ->
 *   { ok: true, cached, answer, model } | { ok: false, refused: reason } | throws on a model failure.
 * `refused` is the PHI gate; nothing was sent. A throw means the model could not be reached or did
 * not answer usably; the caller falls back to its deterministic rules.
 */
export async function askBrain({ env, kv, fetchImpl, generateImpl, payload }) {
  const gate = phiGate(payload);
  if (!gate.ok) return { ok: false, refused: gate.reason };
  const clean = gate.clean;
  const hash = await structureHash(clean);
  const key = CACHE_PREFIX + clean.origin + ":" + clean.op + ":" + hash;
  if (kv) {
    try {
      const hit = await kv.get(key);
      if (hit) { const c = JSON.parse(hit); return { ok: true, cached: true, answer: c.answer, model: c.model }; }
    } catch { /* a cache miss is a cache miss */ }
  }
  const out = await generate({ env, fetchImpl, generateImpl, system: SYSTEM, prompt: promptFor(clean) });
  const answer = shapeAnswer(clean, parseJson(out && out.text));
  const model = out && out.model ? out.model : null;
  if (kv) { try { await kv.put(key, JSON.stringify({ answer, model }), { expirationTtl: CACHE_TTL_S }); } catch { /* best effort */ } }
  return { ok: true, cached: false, answer, model };
}
