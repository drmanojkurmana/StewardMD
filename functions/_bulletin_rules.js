/* StewardMD - Clinical Bulletins: pure rules (validation, canonical hash, public projection).
 *
 * No I/O here, so every clinical-safety rule is unit-testable on its own. Plan and the safety rules S1-S12
 * these functions enforce: docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md.
 */
import { KB_DISEASE_IDS } from "./_kb_disease_ids.js";

export const KINDS = ["safety", "approval", "guideline", "trial"];
export const EVIDENCE_TYPES = ["regulatory_approval", "regulatory_safety", "guideline", "rct", "meta_analysis"];
export const REGULATORS = ["", "FDA", "EMA", "MHRA", "CDSCO", "WHO", "ICMR", "SOCIETY"];
export const INDIA_STATUSES = ["cdsco_approved", "not_approved_india", "not_applicable", "unknown"];
export const REVIEW_MONTHS = [6, 12, 24];
export const MONTH_MS = 2629800000;                 // 30.4375 days
export const MAX_DISEASES = 5;
export const CANDIDATE_TYPES = ["safety_alert", "drug_approval", "guideline", "trial"];

// field -> [min, max]; min 0 = optional
export const LIMITS = {
  headline: [10, 120], what_changed: [20, 400], applies_to: [0, 200], evidence_note: [0, 120],
  source_label: [3, 160], source_url: [12, 500], doi: [0, 100], pmid: [0, 10],
};

let _idSet = null;
export function knownDiseaseIds() { return _idSet || (_idSet = new Set(KB_DISEASE_IDS)); }

// One line of text: control characters out, whitespace collapsed, trimmed.
export function cleanText(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// Review Desk formatting markers ([b], [i], [u] and their closers); rendered by bulletins.js after escaping.
export function stripFormat(s) { return String(s || "").replace(/\[\/?[biu]\]/g, ""); }

export function isHttpsUrl(v) {
  try { const u = new URL(String(v || "")); return u.protocol === "https:" && !!u.hostname; } catch (e) { return false; }
}

function realDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s + "T00:00:00Z");
  if (!isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === s ? t : null;   // rejects 2026-02-30
}

/* Validate a draft from the Review Desk. Returns { ok, value, errors:[{field, code}] }.
 * `value` holds only whitelisted, cleaned fields plus sorted unique disease_ids. */
export function validateDraft(input, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const ids = opts.diseaseIds || knownDiseaseIds();
  const b = input && typeof input === "object" ? input : {};
  const errors = [];
  const err = (field, code) => errors.push({ field, code });
  const v = {};

  for (const f of Object.keys(LIMITS)) {
    const s = cleanText(b[f]);
    const [min, max] = LIMITS[f];
    const n = stripFormat(s).length;                                  // [b]/[i]/[u] markers do not count
    if (min && !n) err(f, "required");
    else if (n && n < min) err(f, "too-short");
    else if (n > max) err(f, "too-long");
    if (s.indexOf("\u2014") >= 0) err(f, "em-dash");                // house rule for app-facing text
    v[f] = s;
  }
  v.update_id = cleanText(b.update_id).slice(0, 80);
  if (!v.update_id) err("update_id", "required");

  v.kind = cleanText(b.kind);
  if (KINDS.indexOf(v.kind) < 0) err("kind", "invalid");
  v.evidence_type = cleanText(b.evidence_type);
  if (EVIDENCE_TYPES.indexOf(v.evidence_type) < 0) err("evidence_type", "invalid");
  v.regulator = cleanText(b.regulator).toUpperCase();
  if (REGULATORS.indexOf(v.regulator) < 0) err("regulator", "invalid");
  v.india_status = cleanText(b.india_status);
  if (INDIA_STATUSES.indexOf(v.india_status) < 0) err("india_status", "invalid");
  v.review_months = parseInt(b.review_months, 10);
  if (REVIEW_MONTHS.indexOf(v.review_months) < 0) err("review_months", "invalid");

  if (v.source_url && !isHttpsUrl(v.source_url)) err("source_url", "not-https");
  v.source_date = cleanText(b.source_date);
  const sd = realDate(v.source_date);
  if (sd == null) err("source_date", "invalid");
  else if (sd > now + 86400000) err("source_date", "future");
  if (v.doi && !/^10\.\d{4,9}\/\S+$/.test(v.doi)) err("doi", "invalid");
  if (v.pmid && !/^\d{1,10}$/.test(v.pmid)) err("pmid", "invalid");

  const raw = Array.isArray(b.disease_ids) ? b.disease_ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const dz = Array.from(new Set(raw)).sort();
  if (!dz.length) err("disease_ids", "required");
  else if (dz.length > MAX_DISEASES) err("disease_ids", "too-many");
  else if (dz.some((d) => !ids.has(d))) err("disease_ids", "unknown");
  v.disease_ids = dz;

  return { ok: errors.length === 0, value: v, errors };
}

/* The signed content, in a fixed order. Changing anything here changes every hash, which un-signs
 * every live bulletin: only ever append, and only with a migration plan. */
export function canonicalFields(v) {
  return [v.kind, v.headline, v.what_changed, v.applies_to || "", v.evidence_type, v.evidence_note || "",
    v.regulator || "", v.india_status, v.source_label, v.source_url, v.source_date, v.doi || "", v.pmid || "",
    Number(v.review_months), (v.disease_ids || []).slice().sort()];
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function bodyHash(v) { return sha256Hex(JSON.stringify(canonicalFields(v))); }

/* What the public list may carry. No uids, no hashes, no audit detail. */
export function publicProjection(row, diseaseIds) {
  return {
    id: row.id, kind: row.kind, headline: row.headline, what_changed: row.what_changed,
    applies_to: row.applies_to || "", evidence_type: row.evidence_type, evidence_note: row.evidence_note || "",
    regulator: row.regulator || "", india_status: row.india_status, source_label: row.source_label,
    source_url: isHttpsUrl(row.source_url) ? row.source_url : "", source_date: row.source_date,
    doi: row.doi || "", pmid: row.pmid || "",
    signed_name: row.signed_name, signed_reg: row.signed_reg, signed_council: row.signed_council || "",
    signed_ts: row.signed_ts, review_due_ts: row.review_due_ts, updated_ts: row.updated_ts,
    disease_ids: (diseaseIds || []).slice().sort(),
  };
}
