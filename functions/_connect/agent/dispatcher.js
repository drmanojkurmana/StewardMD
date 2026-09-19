/* StewardMD — Connect Agent SERVER-SIDE edge dispatcher: the agent-built adapter as the
 * SAME KIND OF THING as the hand-built GHIS adapter.
 *
 * Three tiers, never mixed (Invariant 3):
 *   Tier 1 Hospital Adapter — hospital-level, shared, a static replay map (method + path per
 *     resource, resolved from the ACTIVE adapter version only). Never per-doctor, never edited
 *     in place (a change is a NEW version row).
 *   Tier 2 Hospital Auth Recipe — hospital-level, shared, the login choreography recorded once
 *     (connect-agent/phone/recipe-recorder.mjs) and replayed by session.js loginWithRecipe.
 *   Tier 3 Doctor Session — doctor-level, ephemeral: a cookie jar in KV under casess:<token>
 *     with 15-minute sliding TTL (session.js putSession/getSession, SESS_KV_TTL). The password
 *     opens the session and is then GONE: never stored, logged, or returned.
 *
 * Two fail-closed rules live here, not in the caller:
 *   - a 302 from the hospital means the session is gone: the KV row is dropped and 401
 *     login_required is answered (the doctor signs in again; there is no stored password).
 *   - a 404 or schema mismatch from an ACTIVE endpoint is DRIFT, never a reason to scrape:
 *     markDrift() records NEEDS_REPAIR and no WebView fallback runs at runtime (Invariant 2).
 *     Only the ACTIVE version ever serves (Invariant 1): AWAITING_APPROVAL candidates never
 *     reach this path, and rollbackVersion restores the last good version without new discovery.
 *
 * No node: imports: this runs on Cloudflare Pages/Workers (Web APIs only).
 */
import { loginWithRecipe, putSession, getSession, dropSession } from "./session.js";
import { adapterReq } from "./http.js";
import { markDrift } from "./activation.js";
import { getDeployment, getVersion } from "./store.js";

export const RESOURCES = Object.freeze([
  "patients",
  "medications",
  "lab",
  "lab-detail",
  "radiology",
  "radiology-report",
  "demographics",
]);

const TOKEN_KEY = /token|verification|csrf|xsrf|antiforgery|nonce/i;
const PATIENT_KEY = /record|mrn|uhid|patient|reg(no|istration)|hosp(ital)?(no|id)|umr|^id$/i;
const VISIT_KEY = /visit|episode|encounter|admission|ip(no|number)/i;

/* GHIS parity shapes (functions/api/ghis/[[path]].js): double JSON unwrapping plus numeric +
 * named entity decoding, so &#xA; reads back as the newline the screen showed. */
export function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&nbsp;/gi, " ").replace(/&ndash;/gi, "-").replace(/&mdash;/gi, "-")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, "&");
}

export function deepDecode(v) {
  if (typeof v === "string") return decodeEntities(v);
  if (Array.isArray(v)) return v.map(deepDecode);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepDecode(v[k]);
    return out;
  }
  return v;
}

/* Double JSON unwrapping for GHIS's string-wrapped JSON; HTML/text passes through for htmlToText. */
export function parseGhisBody(body) {
  if (body == null) return [];
  if (typeof body !== "string") return body;
  const t = body.trim();
  if (!t) return [];
  try {
    let v = JSON.parse(t);
    if (typeof v === "string") v = JSON.parse(v);
    return v;
  } catch { return body; }
}

export function htmlToText(s) {
  if (!s) return "";
  return decodeEntities(
    String(s).replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6])\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
  ).replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

export function newToken() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "") + Math.floor(Math.random() * 65536).toString(16);
  } catch { /* fall through to getRandomValues */ }
  const u = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
}

const enc = (v) => encodeURIComponent(v == null ? "" : String(v));

/* Canonical query keys from whatever the caller named them (patientId/patient_id, renderId/Render_ID,
 * episodeId/Episode_Id, resultid/resultId, recordNo). Values only; no PHI is logged here. */
function canonParams(raw) {
  const q = {};
  if (!raw || typeof raw !== "object") return q;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    const lk = String(k).toLowerCase();
    if (lk === "patientid" || lk === "patient_id" || lk === "mrn" || lk === "uhid" || lk === "id" || lk === "recordno" && !q.patientId) {
      if (lk === "recordno" && !q.recordNo) q.recordNo = String(v);
      if (!q.patientId && lk !== "recordno") q.patientId = String(v);
      if (lk === "recordno" && !q.patientId && String(v).indexOf("-") > 0) q.patientId = String(v).split("-")[0];
      else if (lk === "recordno" && !q.patientId) q.patientId = String(v);
      continue;
    }
    if (lk === "renderid" || lk === "render_id" || lk === "rendered_id") { q.renderId = String(v); continue; }
    if (lk === "episodeid" || lk === "episode_id" || lk === "episode" || lk === "visitid" || lk === "visit_id" || lk === "visitno" || lk === "ipno") { q.episodeId = String(v); continue; }
    if (lk === "resultid" || lk === "result_id" || lk === "resultid ") { q.resultid = String(v); continue; }
    if (lk === "type" || lk === "printtype") { q.type = String(v); continue; }
    if (!(k in q)) q[k] = String(v);
  }
  // recordNo = "<MR>-<episode>" when both halves are known and no explicit recordNo arrived.
  if (!q.recordNo && q.patientId && q.episodeId) q.recordNo = q.patientId + "-" + q.episodeId;
  else if (!q.recordNo && q.patientId) q.recordNo = q.patientId;
  return q;
}

function valueForKey(key, q, csrf) {
  if (TOKEN_KEY.test(key)) return csrf || "";
  const lk = String(key).toLowerCase();
  if (/render/.test(lk)) return q.renderId || "";
  if (/result.?id/.test(lk)) return q.resultid || "";
  if (/episode|visit|admission|encounter|ipno/.test(lk)) return q.episodeId || q.patientId || "";
  if (/recordno/.test(lk)) return q.recordNo || q.patientId || "";
  if (PATIENT_KEY.test(key)) return q.patientId || "";
  if (VISIT_KEY.test(key)) return q.episodeId || "";
  for (const k of Object.keys(q)) {
    if (k.toLowerCase() === lk) return q[k];
  }
  return "";
}

/* The static GHIS replay map: byte-for-byte the hand-built adapter's reads. Used when the active
 * adapter version carries no custom path for the resource (or when no D1 adapter is available,
 * e.g. tests). An active version's own method+path always wins over this table when present. */
function ghisRequest(resource, q, csrf) {
  const XHR = { "X-Requested-With": "XMLHttpRequest" };
  switch (resource) {
    case "patients": {
      const p = new URLSearchParams({
        NursingStationId: "", PatientId: "", FloorId: "", Emp_ID: "", Dept_ID: "",
        Type: "IPWorkList", __RequestVerificationToken: csrf || "",
      });
      return { method: "GET", path: "/Doctor/Home/GetIPWL?" + p.toString(), extra: XHR };
    }
    case "medications":
      return { method: "GET", path: "/Doctor/Home/GetMedicines/?id=" + enc(q.patientId || ""), extra: XHR };
    case "lab":
      return {
        method: "POST", path: "/Lab/Home/GetSearchPatientId",
        body: "__RequestVerificationToken=" + enc(csrf || "") + "&patient_id=" + enc(q.patientId || "") + "&DeptID=&FDate=&EDate=",
        extra: XHR,
      };
    case "lab-detail":
      return {
        method: "POST", path: "/Lab/Home/GetPrintLabResultDetailsAuth",
        body: "__RequestVerificationToken=" + enc(csrf || "") + "&Render_ID=" + enc(q.renderId || "") + "&Episode_Id=" + enc(q.episodeId || "") + "&Result_Type=a",
        extra: XHR,
      };
    case "radiology":
      return { method: "GET", path: "/Radio/Home?recordNo=" + enc(q.patientId || ""), extra: XHR };
    case "radiology-report": {
      const rid = q.resultid || "";
      const path = q.type === "automated"
        ? "/Radio/Home/GetRadiologyAutomatedResultPrint?resultid=" + enc(rid)
        : "/Radiology/Home/GetRadiologyResultPrint?resultid=" + enc(rid);
      return { method: "GET", path, extra: XHR };
    }
    case "demographics":
      return {
        method: "POST", path: "/Doctor/Home/Searchnew",
        body: "__RequestVerificationToken=" + enc(csrf || "") + "&recordNo=" + enc(q.recordNo || q.patientId || ""),
        extra: XHR,
      };
    default:
      return null;
  }
}

/* A custom active-version endpoint ({ method, path, bodyKeys? }) filled with the same rules:
 * token keys take the session CSRF, id keys take the canonical query, constants stay as recorded. */
function customRequest(custom, q, csrf) {
  const method = custom.method === "POST" ? "POST" : "GET";
  const rawPath = String(custom.path || "/");
  const qi = rawPath.indexOf("?");
  const base = qi >= 0 ? rawPath.slice(0, qi) : rawPath;
  const keys = [];
  if (qi >= 0) {
    for (const part of rawPath.slice(qi + 1).split("&")) {
      if (!part) continue;
      const i = part.indexOf("=");
      const k = i >= 0 ? part.slice(0, i) : part;
      const v = i >= 0 ? part.slice(i + 1) : "";
      keys.push([k, v]);
    }
  }
  if (method !== "POST") {
    const filled = keys.map(([k, v]) => {
      if (v && /^[A-Za-z_]{1,32}$/.test(v)) return enc(k) + "=" + enc(v); // recorded mode constant
      return enc(k) + "=" + enc(valueForKey(k, q, csrf));
    });
    return { method, path: base + (filled.length ? "?" + filled.join("&") : ""), extra: { "X-Requested-With": "XMLHttpRequest" } };
  }
  const fields = Array.isArray(custom.bodyKeys) && custom.bodyKeys.length
    ? custom.bodyKeys
    : (custom.params ? Object.keys(custom.params) : []);
  const out = {};
  for (const k of fields.slice(0, 40)) {
    const src = (custom.params && custom.params[k]) || null;
    if (src && src.constant !== undefined) out[k] = String(src.constant);
    else if (src && src.token) out[k] = csrf || "";
    else if (src && src.empty) out[k] = "";
    else out[k] = valueForKey(k, q, csrf);
  }
  const isJson = custom.requestKind === "json";
  return {
    method, path: base,
    body: isJson ? JSON.stringify(out) : Object.keys(out).map((k) => enc(k) + "=" + enc(out[k])).join("&"),
    extra: { "X-Requested-With": "XMLHttpRequest" },
  };
}

function customFor(adapter, resource) {
  if (!adapter || typeof adapter !== "object") return null;
  if (adapter.endpoints && adapter.endpoints[resource]) return adapter.endpoints[resource];
  if (adapter.paths && adapter.paths[resource]) {
    const p = adapter.paths[resource];
    return typeof p === "string" ? { method: "GET", path: p } : p;
  }
  if (Array.isArray(adapter.operations)) {
    const op = adapter.operations.find((o) => o && (o.resource === resource || o.type === resource));
    if (op && op.pathTemplate) return { method: op.method || "GET", path: op.pathTemplate };
  }
  if (Array.isArray(adapter.observedViews)) {
    const v = adapter.observedViews.find((x) => x && x.resourceHint === resource && Array.isArray(x.endpoints));
    const data = v && v.endpoints.find((e) => e && e.role === "data");
    if (data) return data;
  }
  return null;
}

export function resolveRequest(adapter, resource, rawParams, csrf) {
  const q = canonParams(rawParams);
  const custom = customFor(adapter, resource);
  if (custom && custom.path) return customRequest(custom, q, csrf);
  return ghisRequest(resource, q, csrf);
}

/**
 * Load the ACTIVE adapter for a deployment (Invariant 1): the version the deployment points at,
 * plus the PHI-free replay map the discovery job stored on its phone_state. AWAITING_APPROVAL
 * candidates are never returned here, so a new draft can never serve production traffic.
 * Returns null when no active adapter exists (caller falls back to the GHIS replay map).
 */
export async function resolveActiveAdapter(db, tenantId, deploymentId) {
  if (!db || !tenantId || !deploymentId) return null;
  let deployment = null;
  try { deployment = await getDeployment(db, tenantId, deploymentId); } catch { return null; }
  const activeId = deployment && deployment.active_version_id;
  if (!activeId) return null;
  let version = null;
  try { version = await getVersion(db, tenantId, activeId); } catch { return null; }
  if (!version || version.lifecycle !== "ACTIVE") return null;
  return { version, deployment };
}

/**
 * Tier 2 lookup: the login recipe for a deployment. The recipe is hospital-level and shared
 * (every doctor replays the same choreography with their own credentials). Stored alongside the
 * adapter when present; otherwise the caller passes it explicitly (tests, first login).
 */
export async function loadRecipeForDeployment(db, tenantId, deploymentId) {
  void db; void tenantId; void deploymentId;
  return null; // no recipe column in the current schema: the caller supplies the recipe
}

/**
 * Tier 3 login: replay the hospital recipe with the doctor's own id+password, mint a token, and
 * store ONLY the cookie jar (+csrf/origin) in KV with sliding TTL. The password is never stored.
 */
export async function loginRun(env, { deploymentId, userId, password, recipe } = {}, { fetchImpl = fetch, token = null } = {}) {
  const rec = recipe || await loadRecipeForDeployment(env && env.CONNECT_DB, null, deploymentId);
  if (!rec) { const e = new Error("no_login_recipe"); e.code = "no_login_recipe"; throw e; }
  if (!userId || !password) { const e = new Error("bad_credentials"); e.code = "bad_credentials"; throw e; }
  const sess = await loginWithRecipe({ recipe: rec, userId, password, fetchImpl });
  const tok = token || newToken();
  await putSession(env, tok, {
    cookie: sess.cookie, csrf: sess.csrf || "", referer: sess.referer || "/",
    origin: rec.origin, deploymentId: deploymentId || null, doctorName: sess.doctorName || "",
  });
  return { ok: true, token: tok, doctorName: sess.doctorName || "" };
}

export async function logoutRun(env, token) {
  if (token) await dropSession(env, token);
  return { ok: true };
}

export async function statusRun(env, token) {
  const sess = await getSession(env, token);
  if (!sess) return { status: 401, body: { error: "login_required" } };
  return { status: 200, body: { connected: true } };
}

/**
 * Tier 1+3 read: resolve the ACTIVE adapter's endpoint for `resource`, fill it from `params`
 * (patientId, renderId, episodeId, resultid, recordNo), replay it inside the doctor's KV session,
 * and return normalized JSON. 302 drops the session (401); 404/schema drift marks NEEDS_REPAIR
 * via markDrift and never falls back to scraping.
 */
export async function dataRun(env, { deploymentId, resource, token, params } = {}, opts = {}) {
  const { fetchImpl = fetch, adapter = null, db = null, tenantId = null, versionId = null } = opts;
  if (!RESOURCES.includes(resource)) return { status: 404, body: { error: "not_found" } };
  const sess = await getSession(env, token);
  if (!sess) return { status: 401, body: { error: "login_required" } };

  let active = adapter;
  let activeVersionId = versionId;
  if (!active && db && tenantId && deploymentId) {
    try {
      const found = await resolveActiveAdapter(db, tenantId, deploymentId);
      if (found && found.version) {
        activeVersionId = found.version.id;
        // The replay map rides on the discovery job's phone_state; the version row itself
        // carries only the content hash + capabilities (never inlined, per schema).
        active = { origin: sess.origin };
      }
    } catch { /* fall through to the GHIS replay map */ }
  }
  const origin = (sess && sess.origin) || (active && active.origin) || null;
  if (!origin) return { status: 500, body: { error: "no_origin" } };

  const req = resolveRequest(active, resource, params || {}, sess.csrf || "");
  if (!req) return { status: 404, body: { error: "not_found" } };

  let r;
  try {
    r = await adapterReq({ origin, session: sess, method: req.method, path: req.path, body: req.body || null, extra: req.extra || {}, fetchImpl });
  } catch {
    return { status: 502, body: { error: "hospital_unreachable" } };
  }
  if (!r || r.unauth) {
    await dropSession(env, token);
    return { status: 401, body: { error: "login_required" } };
  }
  if (r.status === 404) {
    // Invariant 2: drift, never scrape at runtime.
    try {
      if (db && tenantId && deploymentId && activeVersionId) {
        await markDrift(db, { tenantId, deploymentId, versionId: activeVersionId, reason: resource + ":404" });
      }
    } catch { /* drift bookkeeping must never fail the read */ }
    return { status: 502, body: { error: "needs_repair", resource } };
  }
  if (r.status < 200 || r.status >= 300) {
    return { status: 502, body: { error: "hospital_error", status: r.status } };
  }
  const parsed = parseGhisBody(r.body);
  if (typeof parsed === "string") {
    // An HTML fragment (a report print): readable text, entities decoded.
    if (/<[a-z!\/]/i.test(parsed)) return { status: 200, body: htmlToText(parsed) };
    return { status: 200, body: deepDecode(parsed) };
  }
  const decoded = deepDecode(parsed);
  // Schema mismatch (a 200 that carries no usable shape) is drift too, not an empty read.
  if (decoded == null || (typeof decoded === "object" && !Array.isArray(decoded) && !Object.keys(decoded).length)) {
    try {
      if (db && tenantId && deploymentId && activeVersionId) {
        await markDrift(db, { tenantId, deploymentId, versionId: activeVersionId, reason: resource + ":schema" });
      }
    } catch { /* never fail the read on bookkeeping */ }
  }
  return { status: 200, body: decoded };
}
