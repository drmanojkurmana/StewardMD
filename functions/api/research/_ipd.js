/* ResearchMD Phase 5C.2 + 5C.3 IPD compliance (ES module, server side).
 * Contract: docs/research/contracts/phase-6/ipd.md; spec source
 * docs/research/compliance/5C1-applicability.md section 6. Migration 0005.
 *
 * Hard boundary (plan rules 10/12): patient-level rows never reach an LLM.
 * The study-level import path (_data.js) keeps its 422 ipd_gate refusal;
 * IPD uploads go through THIS module: evidence gate (403 before any R2
 * write) -> deterministic identifier scanner (422) -> envelope encryption
 * (AES-256-GCM data key wrapped by an HKDF-derived KEK from
 * env.RESEARCH_IPD_KEK) -> private R2 ciphertext. Every read writes an
 * append-only access-log row. stats_model jobs carry {ipdApproved:true,
 * evidenceId} ONLY when the gate re-passes at creation (job.py contract).
 *
 * OPEN SEAM (documented in ipd.md): the Python worker reads plaintext and
 * holds no KEK, so worker-side decryption of envelope snapshots is Phase 5D
 * wiring; the API gate and message contract here are complete.
 */
import { adminAuth, adminErr } from "./_institutions.js";
import { readRawBody, verifySignedHeaders } from "./_callback.js";
import { parseCsv } from "./_data.js";
import { verhoeffValid } from "./_phi.js";

const WRITE_ROLES = ["owner", "editor", "analyst"];
const ALL_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];
const REGIONS = ["IN", "EU", "US", "GLOBAL_DEID"];
const JURISDICTIONS = ["IN", "EU", "US"];
const TIERS = ["anonymised_deid", "hipaa_lds", "coded_pseudonymised"];
const EVIDENCE_KINDS = ["irb_approval", "exemption_waiver", "consent_basis", "dua", "baa",
  "dpa", "safe_harbor", "expert_determination", "authorization", "other"];
const EVIDENCE_EXTENSIONS = { pdf: 1, png: 1, jpg: 1, jpeg: 1 };
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_IPD_CSV_BYTES = 5 * 1024 * 1024;
const SCAN_SAMPLE_ROWS = 200;
const FAMILIES = ["linear", "logistic", "km", "logrank", "cox", "diagnostic"];
const STATS_MAX_SECONDS = 240;
const STATS_MAX_ROWS = 100000;
const SETTLED = ["succeeded", "failed", "cancelled"];
const STATS_R2_KEY_RE = /^projects\/[A-Za-z0-9_-]+\/data\/(snapshots\/)?[A-Za-z0-9_.-]+\.(csv|json)$/;

function isInt(n) { return typeof n === "number" && Number.isInteger(n); }
async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---- shapes ---------------------------------------------------------------- */
function evidenceOf(row) {
  return {
    id: row.id, projectId: row.project_id, kind: row.kind, jurisdiction: row.jurisdiction || "",
    title: row.title || "", r2Key: row.r2_key, sha256: row.sha256, bytes: row.bytes,
    contentType: row.content_type, status: row.status,
    metadata: JSON.parse(row.metadata_json || "{}"),
    uploadedBy: row.uploaded_by, approvedBy: row.approved_by || "",
    approvedTs: row.approved_ts == null ? null : row.approved_ts,
    expiresTs: row.expires_ts == null ? null : row.expires_ts, createdTs: row.created_ts,
  };
}
function configOf(row) {
  return {
    projectId: row.project_id, dataRegion: row.data_region,
    jurisdictions: JSON.parse(row.jurisdictions_json || "[]"),
    identifiabilityTier: row.identifiability_tier,
    legalBasis: JSON.parse(row.legal_basis_json || "{}"),
    attestation: JSON.parse(row.attestation_json || "{}"),
    agreements: JSON.parse(row.agreements_json || "{}"),
    lockedTs: row.locked_ts, updatedBy: row.updated_by, updatedTs: row.updated_ts,
  };
}
function datasetOf(row) {
  return {
    id: row.id, projectId: row.project_id, version: row.version,
    storageKey: row.storage_key, sha256: row.sha256, bytes: row.bytes, rowCount: row.row_count,
    identifiabilityTier: row.identifiability_tier,
    jurisdictions: JSON.parse(row.jurisdictions_json || "[]"),
    dataRegion: row.data_region, evidenceId: row.evidence_id,
    containsIpd: row.contains_ipd === 1, encryption: "AES-256-GCM",
    createdBy: row.created_by, createdTs: row.created_ts,
  };
}
export function statsJobOf(row) {
  return {
    id: row.id, projectId: row.project_id, kind: row.kind, status: row.status,
    idempotencyKey: row.idempotency_key, datasetId: row.dataset_id,
    inputR2Key: row.input_r2_key, resultR2Key: row.result_r2_key || "",
    model: JSON.parse(row.model_json || "{}"),
    compliance: JSON.parse(row.compliance_json || "{}"),
    containsIpd: row.contains_ipd === 1, evidenceId: row.evidence_id,
    ceilings: JSON.parse(row.ceilings_json || "{}"),
    usage: JSON.parse(row.usage_json || "{}"), errorCode: row.error_code || "",
    createdBy: row.created_by, createdTs: row.created_ts,
    startedTs: row.started_ts == null ? null : row.started_ts,
    completedTs: row.completed_ts == null ? null : row.completed_ts,
    cancelRequestedTs: row.cancel_requested_ts == null ? null : row.cancel_requested_ts,
  };
}
function incidentOf(row) {
  return {
    id: row.id, description: row.description,
    jurisdictions: JSON.parse(row.jurisdictions_json || "[]"),
    affectedProjects: JSON.parse(row.affected_projects_json || "[]"),
    encrypted: row.encrypted_flag === 1, discoveredTs: row.discovered_ts,
    sla: JSON.parse(row.sla_json || "{}"), status: row.status, statusNote: row.status_note || "",
    createdBy: row.created_by, createdTs: row.created_ts, updatedTs: row.updated_ts,
  };
}

/* ---- access log (append-only; the API only ever INSERTs) -------------------- */
async function ipdLog(ctx, projectId, datasetId, action, result) {
  const { request, db, uid, api } = ctx;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const ipHash = ip ? (await api.sha256Hex(ip)).slice(0, 16) : "";
  await db.prepare("INSERT INTO research_ipd_access_log (id,project_id,dataset_id,user_id,action,result,ip_hash,ts) VALUES (?,?,?,?,?,?,?,?)")
    .bind(api.uuid("ipdl_"), projectId, datasetId || "", uid || "worker", action, result, ipHash, Date.now()).run();
}

/* ---- envelope encryption (5C.2) --------------------------------------------- */
function bytesToB64(bytes) {
  let bin = "";
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
}
function b64ToBytes(s) {
  const bin = atob(String(s));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
/* KEK: HKDF-SHA256 over env.RESEARCH_IPD_KEK -> AES-KW-256 wrapping key.
 * The KEK material never enters D1 or R2; only the wrapped data key does. */
export async function deriveKek(env) {
  const secret = env && env.RESEARCH_IPD_KEK;
  if (!secret || String(secret).length < 16) {
    const e = new Error("ipd_kek_unconfigured"); e.code = "ipd_kek_unconfigured"; throw e;
  }
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)),
    "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256",
      salt: new TextEncoder().encode("research-ipd-kek-v1"),
      info: new TextEncoder().encode("ipd-snapshot-wrap") },
    base, { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}
export async function encryptSnapshot(env, plaintext) {
  const kek = await deriveKek(env);
  const dataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dataKey, plaintext);
  const wrapped = await crypto.subtle.wrapKey("raw", dataKey, kek, "AES-KW");
  return {
    ciphertext: new Uint8Array(ct),
    envelope: { alg: "AES-256-GCM", wrap: "AES-KW", iv: bytesToB64(iv), wrappedKey: bytesToB64(wrapped) },
  };
}
export async function decryptSnapshot(env, envelope, ciphertext) {
  const kek = await deriveKek(env);
  const dataKey = await crypto.subtle.unwrapKey("raw", b64ToBytes(envelope.wrappedKey), kek,
    "AES-KW", { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(envelope.iv) }, dataKey, ciphertext);
  return new Uint8Array(pt);
}

/* ---- compliance gate (5C.3) -------------------------------------------------- */
async function getConfig(db, projectId) {
  return db.prepare("SELECT * FROM research_ipd_config WHERE project_id=?").bind(projectId).first();
}
/* Evidence groups: any approved, owner-approved, non-expired row whose kind is
 * in the group satisfies it. Returns [{name, kinds}]. */
function requiredGroups(config) {
  const jurisdictions = JSON.parse(config.jurisdictions_json || "[]");
  const tier = config.identifiability_tier;
  const basis = JSON.parse(config.legal_basis_json || "{}");
  const groups = [{ name: "ethics_approval", kinds: ["irb_approval", "exemption_waiver"] }];
  if (jurisdictions.indexOf("IN") >= 0 && basis.IN === "consent")
    groups.push({ name: "consent_basis", kinds: ["consent_basis"] });
  if (jurisdictions.indexOf("EU") >= 0) {
    groups.push({ name: "dpa", kinds: ["dpa"] });
    if (basis.EU === "9_2_a_explicit_consent") groups.push({ name: "consent_basis", kinds: ["consent_basis"] });
  }
  if (jurisdictions.indexOf("US") >= 0) {
    if (tier === "anonymised_deid") groups.push({ name: "deidentification", kinds: ["safe_harbor", "expert_determination"] });
    else {
      groups.push({ name: "baa", kinds: ["baa"] });
      if (tier === "hipaa_lds") groups.push({ name: "dua", kinds: ["dua"] });
      else groups.push({ name: "us_use_basis", kinds: ["dua", "exemption_waiver", "authorization"] });
    }
  }
  if (!jurisdictions.length)
    groups.push({ name: "deidentification", kinds: ["safe_harbor", "expert_determination"] });
  return groups;
}
/* Returns {missing:[names], ethicsEvidenceId}. Attestation failures are named
 * groups too, so one 403 lists everything the owner must fix. */
async function gateCheck(db, project, config, now) {
  const missing = [];
  let ethicsEvidenceId = "";
  for (const g of requiredGroups(config)) {
    const placeholders = g.kinds.map(() => "?").join(",");
    const row = await db.prepare(
      "SELECT id,kind FROM research_ipd_evidence WHERE project_id=? AND kind IN (" + placeholders + ") AND status='approved' AND approved_by=? AND (expires_ts IS NULL OR expires_ts>?) ORDER BY created_ts ASC LIMIT 1")
      .bind(project.id, ...g.kinds, project.owner_uid, now).first();
    if (!row) missing.push(g.name);
    else if (g.name === "ethics_approval") ethicsEvidenceId = row.id;
  }
  const att = JSON.parse(config.attestation_json || "{}");
  const agreements = JSON.parse(config.agreements_json || "{}");
  const basis = JSON.parse(config.legal_basis_json || "{}");
  const jurisdictions = JSON.parse(config.jurisdictions_json || "[]");
  if (att.responsibility !== true) missing.push("responsibility_attestation");
  if (jurisdictions.indexOf("IN") >= 0) {
    if (basis.IN === "dpdp_s17_2_b_research" && att.noIndividualDecisions !== true)
      missing.push("no_individual_decisions_attestation");
    if (att.pediatric === true && att.guardianConsent !== true)
      missing.push("guardian_consent_attestation");
  }
  if (jurisdictions.indexOf("EU") >= 0) {
    if (agreements.dpa !== true) missing.push("dpa_agreement");
    if (att.dpia !== true) missing.push("dpia_attestation");
    if (basis.EU === "9_2_j_scientific_research" &&
        !(typeof att.memberStateLaw === "string" && att.memberStateLaw.trim()))
      missing.push("member_state_law_reference");
  }
  if (jurisdictions.indexOf("US") >= 0 && config.identifiability_tier !== "anonymised_deid" && agreements.baa !== true)
    missing.push("baa_agreement");
  if ((jurisdictions.indexOf("US") >= 0 && config.identifiability_tier === "anonymised_deid") || !jurisdictions.length) {
    if (att.noActualKnowledge !== true) missing.push("no_actual_knowledge_attestation");
  }
  return { missing, ethicsEvidenceId };
}

/* ---- deterministic identifier scanner (T0, no LLM) --------------------------- */
const DIRECT_ID_HEADER = /^(patient[_-]?name|name|full[_-]?name|first[_-]?name|last[_-]?name|surname|forename|mrn|medical[_-]?record([_-]?number)?|ssn|social[_-]?security([_-]?number)?|aadhaar|phone|mobile|telephone|fax|email|e[_-]?mail|address|street|street[_-]?address|postal[_-]?address|url|website|ip[_-]?address|device[_-]?(id|serial)|serial[_-]?number|license|licence|vehicle|vin|biometric|photo|image|account[_-]?(number|id)|health[_-]?plan|beneficiary[_-]?(number|id)|certificate[_-]?(number|id))$/i;
/* Safe Harbor extras: full dates, ZIP, ages > 89 and unique identifying codes.
 * LDS and coded tiers permit dates, city/state, ZIP and coded ids. */
const DEID_EXTRA_HEADER = /^(zip|zip[_-]?code|postal[_-]?code|postcode|dob|date[_-]?of[_-]?birth|birth[_-]?date|admission[_-]?date|discharge[_-]?date|death[_-]?date|date[_-]?of[_-]?death|patient[_-]?id|patientid|subject[_-]?id|participant[_-]?id|person[_-]?id)$/i;
const CELL_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CELL_SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const CELL_URL = /\bhttps?:\/\/\S+/i;
const CELL_IP = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const CELL_PHONE = /(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const CELL_FULLDATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/;
const PHONE_COLUMN = /^(phone|mobile|telephone|fax)/i;
const AGE_COLUMN = /^age/i;

export function scanIpdIdentifiers(header, rows, tier) {
  const hits = [];
  const seen = {};
  const add = (column, rule) => {
    const key = column + "::" + rule;
    if (!seen[key]) { seen[key] = true; hits.push({ column, rule }); }
  };
  const deid = tier === "anonymised_deid";
  header.forEach((h) => {
    const name = String(h).trim();
    if (DIRECT_ID_HEADER.test(name)) add(name, "direct_identifier_column");
    if (deid && DEID_EXTRA_HEADER.test(name)) add(name, "safe_harbor_column");
  });
  const sample = rows.slice(0, SCAN_SAMPLE_ROWS);
  header.forEach((h, ci) => {
    const name = String(h).trim();
    const phoneCol = PHONE_COLUMN.test(name);
    const ageCol = AGE_COLUMN.test(name);
    for (const row of sample) {
      const v = String(row[ci] == null ? "" : row[ci]).trim();
      if (!v) continue;
      if (CELL_EMAIL.test(v)) add(name, "email");
      if (CELL_SSN.test(v)) add(name, "ssn");
      if (CELL_URL.test(v)) add(name, "url");
      if (CELL_IP.test(v)) add(name, "ip_address");
      if (phoneCol && CELL_PHONE.test(v)) add(name, "phone");
      if (/\b\d{4}\s\d{4}\s\d{4}\b/.test(v) && verhoeffValid(v.replace(/\s/g, ""))) add(name, "aadhaar");
      if (deid && CELL_FULLDATE.test(v)) add(name, "full_date");
      if (deid && ageCol && Number(v) > 89) add(name, "age_over_89");
    }
  });
  return hits;
}

/* ---- evidence routes ---------------------------------------------------------- */
export async function uploadEvidence(ctx) {
  const { request, env, db, uid, projectId, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Evidence uploads need an owner, editor or analyst role", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart evidence upload", requestId); }
  const file = form.get("file");
  if (!file || typeof file === "string") return err(400, "missing_file", "Upload one evidence file in the file field", requestId);
  if (file.size < 1 || file.size > MAX_EVIDENCE_BYTES)
    return err(413, "file_size", "Evidence file must be 1 byte to 10 MiB", requestId);
  const name = typeof file.name === "string" ? file.name : "";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!EVIDENCE_EXTENSIONS[ext]) return err(415, "file_type", "Evidence must be .pdf, .png, .jpg or .jpeg", requestId);
  const kind = String(form.get("kind") || "");
  if (EVIDENCE_KINDS.indexOf(kind) < 0)
    return err(400, "invalid_body", "kind must be one of " + EVIDENCE_KINDS.join(", "), requestId);
  const jurisdiction = String(form.get("jurisdiction") || "");
  if (jurisdiction && JURISDICTIONS.indexOf(jurisdiction) < 0)
    return err(400, "invalid_body", "jurisdiction must be IN, EU or US", requestId);
  const title = String(form.get("title") || "").slice(0, 200);
  let metadata = {};
  const rawMeta = form.get("metadataJson");
  if (rawMeta && typeof rawMeta === "string" && rawMeta.trim()) {
    if (rawMeta.length > 4000) return err(400, "invalid_body", "metadataJson must be at most 4000 characters", requestId);
    try { metadata = JSON.parse(rawMeta); } catch { return err(400, "invalid_body", "metadataJson must be valid JSON", requestId); }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      return err(400, "invalid_body", "metadataJson must be a JSON object", requestId);
  }
  let expiresTs = null;
  const rawExp = form.get("expiresTs");
  if (rawExp && typeof rawExp === "string" && rawExp.trim()) {
    expiresTs = Number(rawExp);
    if (!isInt(expiresTs) || expiresTs <= Date.now())
      return err(400, "invalid_body", "expiresTs must be a future epoch-ms integer", requestId);
  }
  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Bytes(bytes);
  const id = uuid("ev_"), now = Date.now();
  const r2Key = "projects/" + projectId + "/ipd/evidence/" + id;
  const contentType = ext === "pdf" ? "application/pdf" : "image/" + (ext === "jpg" ? "jpeg" : ext);
  await env.RESEARCH_R2.put(r2Key, bytes, { httpMetadata: { contentType },
    customMetadata: { projectId, evidenceId: id, uploadedBy: uid, sha256 } });
  await db.prepare("INSERT INTO research_ipd_evidence (id,project_id,kind,jurisdiction,title,r2_key,sha256,bytes,content_type,status,metadata_json,uploaded_by,expires_ts,created_ts) VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)")
    .bind(id, projectId, kind, jurisdiction, title, r2Key, sha256, file.size, contentType,
      JSON.stringify(metadata), uid, expiresTs, now).run();
  await audit(db, projectId, uid, "ipd_evidence_uploaded", id, { kind, jurisdiction, bytes: file.size });
  const row = await db.prepare("SELECT * FROM research_ipd_evidence WHERE id=?").bind(id).first();
  return json({ evidence: evidenceOf(row) }, 201, { "x-request-id": requestId });
}
async function resolveEvidence(db, uid, evidenceId, roles) {
  const row = await db.prepare("SELECT * FROM research_ipd_evidence WHERE id=?").bind(evidenceId).first();
  if (!row) return { status: 404, code: "evidence_not_found" };
  const me = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(row.project_id, uid).first();
  if (!me || roles.indexOf(me.role) < 0) {
    const any = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
      .bind(row.project_id, uid).first();
    return any ? { status: 403, code: "not_member" } : { status: 404, code: "evidence_not_found" };
  }
  return { row, projectId: row.project_id, role: me.role };
}
export async function listEvidence(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const gate = await api.projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return api.gateErr(gate, "Project access denied", requestId);
  const rows = (await db.prepare("SELECT * FROM research_ipd_evidence WHERE project_id=? ORDER BY created_ts DESC LIMIT 100")
    .bind(projectId).all()).results || [];
  return api.json({ evidence: rows.map(evidenceOf) }, 200, { "x-request-id": requestId });
}
export async function getEvidence(ctx, evidenceId) {
  const { db, uid, requestId, api } = ctx;
  const resolved = await resolveEvidence(db, uid, evidenceId, ALL_ROLES);
  if (resolved.status) return api.err(resolved.status, resolved.code, "Evidence not found", requestId);
  return api.json({ evidence: evidenceOf(resolved.row) }, 200, { "x-request-id": requestId });
}
export async function evidenceFile(ctx, evidenceId) {
  const { env, db, uid, requestId, api } = ctx;
  const resolved = await resolveEvidence(db, uid, evidenceId, WRITE_ROLES);
  if (resolved.status) return api.err(resolved.status, resolved.code, "Evidence not found", requestId);
  if (!env.RESEARCH_R2) return api.err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  const obj = await env.RESEARCH_R2.get(resolved.row.r2_key);
  if (!obj) return api.err(404, "evidence_not_found", "Evidence file not found", requestId);
  const bytes = await obj.arrayBuffer();
  return new Response(bytes, { status: 200, headers: {
    "content-type": resolved.row.content_type || "application/octet-stream",
    "cache-control": "no-store", "x-content-type-options": "nosniff", "x-request-id": requestId } });
}
export async function decideEvidence(ctx, evidenceId, approve) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit } = api;
  const resolved = await resolveEvidence(db, uid, evidenceId, ["owner"]);
  if (resolved.status)
    return err(resolved.status, resolved.code,
      resolved.code === "not_member" ? "Approving evidence needs the project owner" : "Evidence not found", requestId);
  if (resolved.row.status !== "pending")
    return err(409, "already_decided", "Evidence already " + resolved.row.status, requestId);
  const now = Date.now();
  await db.prepare("UPDATE research_ipd_evidence SET status=?,approved_by=?,approved_ts=? WHERE id=? AND status='pending'")
    .bind(approve ? "approved" : "rejected", uid, now, evidenceId).run();
  await audit(db, resolved.projectId, uid, approve ? "ipd_evidence_approved" : "ipd_evidence_rejected", evidenceId,
    { kind: resolved.row.kind });
  const row = await db.prepare("SELECT * FROM research_ipd_evidence WHERE id=?").bind(evidenceId).first();
  return json({ evidence: evidenceOf(row) }, 200, { "x-request-id": requestId });
}

/* ---- IPD config (owner; locks the residency pin) ------------------------------ */
const LEGAL_BASES = {
  IN: ["consent", "dpdp_s17_2_b_research"],
  EU: ["9_2_a_explicit_consent", "9_2_j_scientific_research"],
  US: ["authorization", "waiver", "dua", "deidentified"],
};
export async function putIpdConfig(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit } = api;
  const gate = await api.projectGate(db, projectId, uid, ["owner"]);
  if (gate.status) return api.gateErr(gate, "IPD configuration needs the project owner", requestId);
  const dataRegion = body.dataRegion;
  if (REGIONS.indexOf(dataRegion) < 0)
    return err(400, "invalid_body", "dataRegion must be IN, EU, US or GLOBAL_DEID", requestId);
  const tier = body.identifiabilityTier;
  if (TIERS.indexOf(tier) < 0)
    return err(400, "invalid_body", "identifiabilityTier must be anonymised_deid, hipaa_lds or coded_pseudonymised", requestId);
  const jurisdictions = body.jurisdictions === undefined ? [] : body.jurisdictions;
  if (!Array.isArray(jurisdictions) || jurisdictions.length > 3 ||
      jurisdictions.some((j) => JURISDICTIONS.indexOf(j) < 0) ||
      new Set(jurisdictions).size !== jurisdictions.length)
    return err(400, "invalid_body", "jurisdictions must be a unique subset of IN, EU, US", requestId);
  if (!jurisdictions.length && !(dataRegion === "GLOBAL_DEID" && tier === "anonymised_deid"))
    return err(400, "invalid_body", "Empty jurisdictions need GLOBAL_DEID and anonymised_deid", requestId);
  const legalBasis = body.legalBasis === undefined ? {} : body.legalBasis;
  if (!legalBasis || typeof legalBasis !== "object" || Array.isArray(legalBasis))
    return err(400, "invalid_body", "legalBasis must be an object", requestId);
  for (const j of jurisdictions) {
    const b = legalBasis[j];
    if (LEGAL_BASES[j].indexOf(b) < 0)
      return err(400, "invalid_body", "legalBasis." + j + " must be one of " + LEGAL_BASES[j].join(", "), requestId);
  }
  if (legalBasis.US === "preparatory_to_research")
    return err(400, "invalid_body", "preparatory_to_research cannot move PHI out of the covered entity (45 CFR 164.512(i)(1)(ii))", requestId);
  const attestation = body.attestation;
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation))
    return err(400, "invalid_body", "attestation must be an object", requestId);
  if (attestation.responsibility !== true)
    return err(400, "invalid_body", "attestation.responsibility must be true (signed researcher responsibility)", requestId);
  for (const k of ["noIndividualDecisions", "pediatric", "guardianConsent", "dpia", "noActualKnowledge"])
    if (attestation[k] !== undefined && typeof attestation[k] !== "boolean")
      return err(400, "invalid_body", "attestation." + k + " must be a boolean", requestId);
  if (attestation.memberStateLaw !== undefined &&
      (typeof attestation.memberStateLaw !== "string" || attestation.memberStateLaw.length > 300))
    return err(400, "invalid_body", "attestation.memberStateLaw must be at most 300 characters", requestId);
  const agreements = body.agreements === undefined ? {} : body.agreements;
  if (!agreements || typeof agreements !== "object" || Array.isArray(agreements))
    return err(400, "invalid_body", "agreements must be an object", requestId);
  for (const k of ["dpa", "baa"])
    if (agreements[k] !== undefined && typeof agreements[k] !== "boolean")
      return err(400, "invalid_body", "agreements." + k + " must be a boolean", requestId);
  const existing = await getConfig(db, projectId);
  if (existing && existing.data_region !== dataRegion)
    return err(409, "region_locked", "Data residency is locked once IPD is enabled", requestId);
  const now = Date.now();
  const values = [dataRegion, JSON.stringify(jurisdictions), tier, JSON.stringify(legalBasis),
    JSON.stringify(attestation), JSON.stringify(agreements), uid, now];
  if (existing) {
    await db.prepare("UPDATE research_ipd_config SET data_region=?,jurisdictions_json=?,identifiability_tier=?,legal_basis_json=?,attestation_json=?,agreements_json=?,updated_by=?,updated_ts=? WHERE project_id=?")
      .bind(...values, projectId).run();
  } else {
    await db.prepare("INSERT INTO research_ipd_config (project_id,data_region,jurisdictions_json,identifiability_tier,legal_basis_json,attestation_json,agreements_json,updated_by,updated_ts,locked_ts) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(projectId, ...values.slice(0, 7), now, values[7]).run();
    await db.prepare("UPDATE research_projects SET data_region=? WHERE id=?").bind(dataRegion, projectId).run();
  }
  await audit(db, projectId, uid, "ipd_config_saved", projectId, { dataRegion, tier, jurisdictions });
  const row = await getConfig(db, projectId);
  return json({ config: configOf(row) }, 200, { "x-request-id": requestId });
}
export async function getIpdConfig(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const gate = await api.projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return api.gateErr(gate, "Project access denied", requestId);
  const row = await getConfig(db, projectId);
  return api.json({ config: row ? configOf(row) : null }, 200, { "x-request-id": requestId });
}

/* ---- IPD upload: gate -> scanner -> encrypt -> R2 ------------------------------ */
export async function uploadIpd(ctx) {
  const { request, env, db, uid, projectId, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "IPD uploads need an owner, editor or analyst role", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let kekOk = true;
  try { await deriveKek(env); } catch (e) { kekOk = false; }
  if (!kekOk) return err(503, "ipd_kek_unconfigured", "IPD encryption is not configured", requestId);
  const project = gate.project;
  const config = await getConfig(db, projectId);
  /* 5C.3 hard gate: 403 BEFORE any R2 write. */
  if (!config)
    return err(403, "ipd_gate", "IPD compliance configuration is required before uploading patient-level data", requestId);
  const checked = await gateCheck(db, project, config, Date.now());
  if (checked.missing.length)
    return json({ error: { code: "ipd_gate", message: "IPD compliance evidence is missing or not owner-approved", requestId },
      missing: checked.missing }, 403, { "x-request-id": requestId });
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart CSV upload", requestId); }
  const file = form.get("file");
  if (!file || typeof file === "string") return err(400, "missing_file", "Upload one CSV in the file field", requestId);
  if (file.size < 1 || file.size > MAX_IPD_CSV_BYTES)
    return err(413, "file_size", "IPD CSV must be 1 byte to 5 MiB", requestId);
  const name = typeof file.name === "string" ? file.name : "";
  const dot = name.lastIndexOf(".");
  if ((dot >= 0 ? name.slice(dot + 1).toLowerCase() : "") !== "csv")
    return err(415, "file_type", "IPD file must be .csv", requestId);
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  const { header, rows } = parseCsv(text);
  if (!header.length || !rows.length)
    return err(422, "invalid_dataset", "The CSV needs a header and at least one data row", requestId);
  const hits = scanIpdIdentifiers(header, rows, config.identifiability_tier);
  if (hits.length)
    return json({ error: { code: "ipd_identifiers", message: "Direct identifiers detected for the declared identifiability tier; the upload was blocked.", requestId },
      hits }, 422, { "x-request-id": requestId });
  const sha256 = await sha256Bytes(bytes);
  const { ciphertext, envelope } = await encryptSnapshot(env, bytes);
  const id = uuid("ipd_"), now = Date.now();
  /* Key shape follows job.py R2_KEY_RE; the BYTES are ciphertext. */
  const storageKey = "projects/" + projectId + "/data/snapshots/" + id + ".csv";
  await env.RESEARCH_R2.put(storageKey, ciphertext, { httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { projectId, datasetId: id, containsIpd: "true", uploadedBy: uid } });
  const last = await db.prepare("SELECT MAX(version) AS v FROM research_ipd_datasets WHERE project_id=?")
    .bind(projectId).first();
  const version = ((last && last.v) || 0) + 1;
  await db.prepare("INSERT INTO research_ipd_datasets (id,project_id,version,storage_key,sha256,bytes,row_count,identifiability_tier,jurisdictions_json,data_region,evidence_id,envelope_json,contains_ipd,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)")
    .bind(id, projectId, version, storageKey, sha256, file.size, rows.length, config.identifiability_tier,
      config.jurisdictions_json, config.data_region, checked.ethicsEvidenceId, JSON.stringify(envelope), uid, now).run();
  await ipdLog(ctx, projectId, id, "upload", "ok");
  await audit(db, projectId, uid, "ipd_uploaded", id, { version, rowCount: rows.length, bytes: file.size,
    tier: config.identifiability_tier, dataRegion: config.data_region });
  const row = await db.prepare("SELECT * FROM research_ipd_datasets WHERE id=?").bind(id).first();
  return json({ dataset: datasetOf(row) }, 201, { "x-request-id": requestId });
}
async function resolveDataset(db, uid, datasetId, roles) {
  const row = await db.prepare("SELECT * FROM research_ipd_datasets WHERE id=?").bind(datasetId).first();
  if (!row) return { status: 404, code: "dataset_not_found" };
  const me = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(row.project_id, uid).first();
  if (!me || roles.indexOf(me.role) < 0) {
    const any = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
      .bind(row.project_id, uid).first();
    return any ? { status: 403, code: "not_member" } : { status: 404, code: "dataset_not_found" };
  }
  return { row, projectId: row.project_id, role: me.role };
}
export async function listIpdDatasets(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const gate = await api.projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return api.gateErr(gate, "Project access denied", requestId);
  const rows = (await db.prepare("SELECT * FROM research_ipd_datasets WHERE project_id=? ORDER BY version DESC LIMIT 100")
    .bind(projectId).all()).results || [];
  return api.json({ datasets: rows.map(datasetOf) }, 200, { "x-request-id": requestId });
}
export async function getIpdDataset(ctx, datasetId) {
  const { db, uid, requestId, api } = ctx;
  const resolved = await resolveDataset(db, uid, datasetId, ALL_ROLES);
  if (resolved.status) return api.err(resolved.status, resolved.code, "Dataset not found", requestId);
  return api.json({ dataset: datasetOf(resolved.row) }, 200, { "x-request-id": requestId });
}
/* Every read writes an access-log row (5C.2). Decryption failure is logged
 * with result 'error' and answered with a stable 500 (no detail). */
export async function ipdSnapshot(ctx, datasetId) {
  const { env, db, uid, requestId, api } = ctx;
  const resolved = await resolveDataset(db, uid, datasetId, WRITE_ROLES);
  if (resolved.status)
    return api.err(resolved.status, resolved.code,
      resolved.code === "not_member" ? "Reading IPD needs an owner, editor or analyst role" : "Dataset not found", requestId);
  if (!env.RESEARCH_R2) return api.err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let kek;
  try { kek = await deriveKek(env); }
  catch (e) { return api.err(503, "ipd_kek_unconfigured", "IPD encryption is not configured", requestId); }
  const obj = await env.RESEARCH_R2.get(resolved.row.storage_key);
  if (!obj) {
    await ipdLog(ctx, resolved.projectId, datasetId, "read", "error");
    return api.err(404, "dataset_not_found", "Snapshot not found", requestId);
  }
  const ciphertext = await obj.arrayBuffer();
  let plaintext;
  try {
    plaintext = await decryptSnapshot(env, JSON.parse(resolved.row.envelope_json || "{}"), ciphertext);
  } catch (e) {
    await ipdLog(ctx, resolved.projectId, datasetId, "read", "error");
    return api.err(500, "ipd_decrypt_failed", "The IPD snapshot could not be decrypted", requestId);
  }
  await ipdLog(ctx, resolved.projectId, datasetId, "read", "ok");
  return new Response(plaintext, { status: 200, headers: {
    "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "x-request-id": requestId } });
}
export async function ipdAccessLog(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const gate = await api.projectGate(db, projectId, uid, ["owner"]);
  if (gate.status) return api.gateErr(gate, "The IPD access log needs the project owner", requestId);
  const rows = (await db.prepare("SELECT * FROM research_ipd_access_log WHERE project_id=? ORDER BY ts DESC, id DESC LIMIT 100")
    .bind(projectId).all()).results || [];
  return api.json({ accessLog: rows.map((r) => ({ id: r.id, projectId: r.project_id, datasetId: r.dataset_id,
    userId: r.user_id, action: r.action, result: r.result, ipHash: r.ip_hash, ts: r.ts })) },
    200, { "x-request-id": requestId });
}

/* ---- stats_model jobs (job.py flag contract) ---------------------------------- */
function validateModelSpec(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) return "model must be an object";
  if (FAMILIES.indexOf(model.family) < 0) return "model.family must be one of " + FAMILIES.join(", ");
  const str = (v) => typeof v === "string" && v.trim() && v.length <= 200;
  if (model.family === "linear" || model.family === "logistic") {
    if (!str(model.formula)) return "model.formula is required";
  } else if (model.family === "km") {
    if (!str(model.time) || !str(model.event)) return "model.time and model.event are required";
  } else if (model.family === "logrank") {
    if (!str(model.time) || !str(model.event) || !str(model.group)) return "model.time, model.event and model.group are required";
  } else if (model.family === "cox") {
    if (!str(model.time) || !str(model.event)) return "model.time and model.event are required";
    if (!Array.isArray(model.covariates) || !model.covariates.length || model.covariates.length > 50 ||
        model.covariates.some((c) => !str(c))) return "model.covariates must be 1-50 column names";
  } else if (model.family === "diagnostic") {
    const c = model.columns;
    if (!c || typeof c !== "object" || ["TP", "FN", "FP", "TN"].some((k) => !str(c[k])))
      return "model.columns needs TP, FN, FP and TN column names";
  }
  return null;
}
/* Producer-side mirror of backend/research/stats/job.py validate_message. */
export function validateStatsMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false;
  if (msg.v !== 1 || msg.kind !== "stats_model") return false;
  for (const f of ["jobId", "projectId", "idempotencyKey"]) {
    const v = msg[f];
    if (typeof v !== "string" || !v || v.length > (f === "idempotencyKey" ? 120 : 80)) return false;
  }
  if (!Number.isInteger(msg.createdAt) || msg.createdAt < 0) return false;
  const c = msg.ceilings;
  if (!c || typeof c !== "object") return false;
  if (!Number.isInteger(c.maxSeconds) || c.maxSeconds < 1 || c.maxSeconds > STATS_MAX_SECONDS) return false;
  if (!Number.isInteger(c.maxRows) || c.maxRows < 1 || c.maxRows > STATS_MAX_ROWS) return false;
  const inp = msg.input;
  if (!inp || typeof inp !== "object") return false;
  if (typeof inp.r2Key !== "string" || !STATS_R2_KEY_RE.test(inp.r2Key)) return false;
  if (inp.r2Key.indexOf("projects/" + msg.projectId + "/") !== 0) return false;
  if (!inp.model || typeof inp.model !== "object" || FAMILIES.indexOf(inp.model.family) < 0) return false;
  const comp = inp.compliance;
  if (!comp || typeof comp !== "object" || comp.ipdApproved !== true) return false;
  if (typeof comp.evidenceId !== "string" || !comp.evidenceId.trim() || comp.evidenceId.length > 200) return false;
  return true;
}
export async function createStatsJob(ctx, projectId, body) {
  const { env, db, uid, projectId: _p, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Stats jobs need an owner, editor or analyst role", requestId);
  const datasetId = typeof body.datasetId === "string" ? body.datasetId : "";
  const dataset = await db.prepare("SELECT * FROM research_ipd_datasets WHERE id=? AND project_id=?")
    .bind(datasetId, projectId).first();
  if (!dataset) return err(404, "dataset_not_found", "Dataset not found", requestId);
  const badModel = validateModelSpec(body.model);
  if (badModel) return err(400, "invalid_body", badModel, requestId);
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 120)
    return err(400, "invalid_body", "idempotencyKey must be 1-120 characters", requestId);
  const maxRows = body.maxRows === undefined ? STATS_MAX_ROWS : body.maxRows;
  const maxSeconds = body.maxSeconds === undefined ? STATS_MAX_SECONDS : body.maxSeconds;
  if (!isInt(maxRows) || maxRows < 1 || maxRows > STATS_MAX_ROWS)
    return err(400, "invalid_body", "maxRows must be 1-" + STATS_MAX_ROWS, requestId);
  if (!isInt(maxSeconds) || maxSeconds < 1 || maxSeconds > STATS_MAX_SECONDS)
    return err(400, "invalid_body", "maxSeconds must be 1-" + STATS_MAX_SECONDS, requestId);
  /* The compliance flag is attached ONLY when the gate re-passes NOW. */
  const config = await getConfig(db, projectId);
  if (!config) return err(403, "ipd_gate", "IPD compliance configuration is required", requestId);
  const checked = await gateCheck(db, gate.project, config, Date.now());
  if (checked.missing.length)
    return json({ error: { code: "ipd_gate", message: "IPD compliance evidence is missing or not owner-approved", requestId },
      missing: checked.missing }, 403, { "x-request-id": requestId });
  const existing = await db.prepare("SELECT * FROM research_stats_jobs WHERE project_id=? AND idempotency_key=?")
    .bind(projectId, idempotencyKey).first();
  if (existing) {
    if (existing.input_r2_key !== dataset.storage_key || existing.model_json !== JSON.stringify(body.model))
      return err(409, "idempotency_conflict", "This idempotencyKey was already used with a different input", requestId);
    return json({ job: statsJobOf(existing), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  }
  if (!env.RESEARCH_QUEUE) return err(503, "queue_unavailable", "Research job queue is not provisioned", requestId);
  const jobId = uuid("job_"), now = Date.now();
  const compliance = { ipdApproved: true, evidenceId: checked.ethicsEvidenceId };
  const ceilings = { maxSeconds, maxRows };
  await db.prepare("INSERT INTO research_stats_jobs (id,project_id,kind,status,idempotency_key,dataset_id,input_r2_key,model_json,compliance_json,contains_ipd,evidence_id,ceilings_json,created_by,created_ts) VALUES (?,?, 'stats_model','queued',?,?,?,?,?,1,?,?,?,?)")
    .bind(jobId, projectId, idempotencyKey, datasetId, dataset.storage_key, JSON.stringify(body.model),
      JSON.stringify(compliance), checked.ethicsEvidenceId, JSON.stringify(ceilings), uid, now).run();
  const message = {
    v: 1, kind: "stats_model", jobId, projectId, idempotencyKey,
    input: { r2Key: dataset.storage_key, model: body.model, compliance, envelope: JSON.parse(dataset.envelope_json) },
    ceilings, createdAt: Math.floor(now / 1000),
  };
  if (!validateStatsMessage(message)) {
    await db.prepare("UPDATE research_stats_jobs SET status='failed',error_code='invalid_message',completed_ts=? WHERE id=?")
      .bind(Date.now(), jobId).run();
    return err(500, "invalid_message", "Job message failed the contract schema", requestId);
  }
  try {
    await env.RESEARCH_QUEUE.send(message);
  } catch (e) {
    await db.prepare("UPDATE research_stats_jobs SET status='failed',error_code='queue_unavailable',completed_ts=? WHERE id=?")
      .bind(Date.now(), jobId).run();
    return err(503, "queue_unavailable", "Could not queue the job; retry with the same idempotency key", requestId);
  }
  await ipdLog(ctx, projectId, datasetId, "analysis", "ok");
  await audit(db, projectId, uid, "stats_job_created", jobId, { family: body.model.family, datasetId, evidenceId: checked.ethicsEvidenceId });
  const row = await db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").bind(jobId).first();
  return json({ job: statsJobOf(row), requestId }, 202, { "x-request-id": requestId });
}
export async function getStatsJob(ctx, jobId) {
  const { db, uid, requestId, api } = ctx;
  const row = await db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").bind(jobId).first();
  if (!row || !(await api.member(db, row.project_id, uid)))
    return api.err(404, "job_not_found", "Job not found", requestId);
  return api.json({ job: statsJobOf(row), requestId }, 200, { "x-request-id": requestId });
}
export async function cancelStatsJob(ctx, jobId) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const row = await db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").bind(jobId).first();
  if (!row) return err(404, "job_not_found", "Job not found", requestId);
  const gate = await projectGate(db, row.project_id, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Cancelling a job needs an owner, editor or analyst role", requestId);
  if (SETTLED.indexOf(row.status) >= 0)
    return json({ job: statsJobOf(row), alreadySettled: true, requestId }, 200, { "x-request-id": requestId });
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  await env.RESEARCH_R2.put("projects/" + row.project_id + "/jobs/" + jobId + "/cancel", "",
    { httpMetadata: { contentType: "text/plain" } });
  await db.prepare("UPDATE research_stats_jobs SET cancel_requested_ts=? WHERE id=? AND status IN ('queued','running')")
    .bind(Date.now(), jobId).run();
  await audit(db, row.project_id, uid, "stats_job_cancel_requested", jobId, {});
  const fresh = await db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").bind(jobId).first();
  return json({ job: statsJobOf(fresh), requestId }, 200, { "x-request-id": requestId });
}
/* Stats callback: callback.md verification order exactly (secret -> skew ->
 * constant-time signature over the RAW body -> validation -> job -> key match
 * -> replay -> guarded transition). No credit movement: stats jobs are T0. */
export async function statsJobCallback(ctx, pathJobId) {
  const { request, env, db, requestId, api } = ctx;
  const { json, err, audit } = api;
  let rawText;
  try { rawText = await readRawBody(request, 65536); }
  catch { return err(400, "invalid_body", "Invalid callback payload", requestId); }
  const badSig = await verifySignedHeaders(env, request, rawText, api, Math.floor(Date.now() / 1000));
  if (badSig) return err(badSig.status, badSig.code, badSig.message, requestId);
  let body;
  try { body = JSON.parse(rawText); } catch { return err(400, "invalid_body", "Invalid callback payload", requestId); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return err(400, "invalid_body", "body must be an object", requestId);
  const allowed = ["jobId", "idempotencyKey", "status", "resultKey", "error", "usage"];
  for (const k of Object.keys(body)) if (allowed.indexOf(k) < 0) return err(400, "invalid_body", "unexpected field " + k, requestId);
  if (body.jobId !== pathJobId) return err(400, "invalid_body", "jobId must equal the path job id", requestId);
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey)
    return err(400, "invalid_body", "idempotencyKey is required", requestId);
  if (["done", "failed", "cancelled"].indexOf(body.status) < 0)
    return err(400, "invalid_body", "status must be done, failed or cancelled", requestId);
  if (body.status === "done") {
    if (typeof body.resultKey !== "string" || !/^projects\/[A-Za-z0-9_-]+\/jobs\/[^/]+\/result\.json$/.test(body.resultKey))
      return err(400, "invalid_body", "resultKey is required and must be the result.json R2 key", requestId);
    if ("error" in body) return err(400, "invalid_body", "error is absent unless failed", requestId);
  } else if (body.status === "failed") {
    if (typeof body.error !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(body.error))
      return err(400, "invalid_body", "error is required and must be a stable code", requestId);
    if ("resultKey" in body) return err(400, "invalid_body", "resultKey is absent unless done", requestId);
  } else if ("resultKey" in body || "error" in body) {
    return err(400, "invalid_body", "resultKey and error are absent unless done/failed", requestId);
  }
  const u = body.usage;
  if (!u || typeof u !== "object" || Array.isArray(u) ||
      Object.keys(u).some((k) => k !== "pages" && k !== "seconds") ||
      !Number.isInteger(u.pages) || u.pages < 0 ||
      typeof u.seconds !== "number" || !Number.isFinite(u.seconds) || u.seconds < 0)
    return err(400, "invalid_body", "usage carries non-negative pages and seconds only", requestId);
  const job = await db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").bind(pathJobId).first();
  if (!job) return err(404, "job_not_found", "Job not found", requestId);
  if (body.idempotencyKey !== job.idempotency_key)
    return err(409, "callback_mismatch", "Callback does not match the stored job", requestId);
  if (body.status === "done" && body.resultKey.indexOf("projects/" + job.project_id + "/jobs/" + job.id + "/") !== 0)
    return err(409, "callback_mismatch", "resultKey is outside the job's project", requestId);
  if (SETTLED.indexOf(job.status) >= 0)
    return json({ job: statsJobOf(job), replay: true, requestId }, 200, { "x-request-id": requestId });
  const now = Date.now();
  const terminal = body.status === "done" ? "succeeded" : body.status;
  const upd = await db.prepare(
    "UPDATE research_stats_jobs SET status=?,result_r2_key=?,usage_json=?,error_code=?,completed_ts=? WHERE id=? AND status IN ('queued','running')")
    .bind(terminal, body.status === "done" ? body.resultKey : "", JSON.stringify(body.usage),
      body.status === "failed" ? body.error : "", now, job.id).run();
  if (!upd.meta || !upd.meta.changes) {
    const raced = await db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").bind(job.id).first();
    return json({ job: statsJobOf(raced), replay: true, requestId }, 200, { "x-request-id": requestId });
  }
  if (env.RESEARCH_R2)
    await env.RESEARCH_R2.delete("projects/" + job.project_id + "/jobs/" + job.id + "/cancel").catch(() => {});
  await audit(db, job.project_id, "worker", "stats_job_settled", job.id, { status: terminal, usage: body.usage });
  const fresh = await db.prepare("SELECT * FROM research_stats_jobs WHERE id=?").bind(job.id).first();
  return json({ job: statsJobOf(fresh), requestId }, 200, { "x-request-id": requestId });
}

/* ---- breach incident log (adminAuth) ------------------------------------------ */
function slaFor(jurisdictions, discoveredTs) {
  const H = 3600000, D = 86400000;
  const sla = {};
  if (jurisdictions.indexOf("IN") >= 0) {
    sla.dpbiIntimation = "without delay";
    sla.dpbiReportDueTs = discoveredTs + 72 * H;
    sla.certInDueTs = discoveredTs + 6 * H;
  }
  if (jurisdictions.indexOf("EU") >= 0) {
    sla.controllerAlert = "without undue delay";
    sla.authorityDueTs = discoveredTs + 72 * H;
  }
  if (jurisdictions.indexOf("US") >= 0) {
    sla.ceDueTs = discoveredTs + 60 * D;
    sla.individualsDueTs = discoveredTs + 60 * D;
    sla.ocrDueTs = discoveredTs + 60 * D;
    sla.ocrAnnualLogUnder500 = true;
  }
  return sla;
}
export async function createIncident(ctx, body) {
  const { db, requestId, api } = ctx;
  const { json, err, uuid } = api;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description || description.length > 4000)
    return err(400, "invalid_body", "description must be 1-4000 characters", requestId);
  const jurisdictions = body.jurisdictions;
  if (!Array.isArray(jurisdictions) || !jurisdictions.length || jurisdictions.length > 3 ||
      jurisdictions.some((j) => JURISDICTIONS.indexOf(j) < 0) || new Set(jurisdictions).size !== jurisdictions.length)
    return err(400, "invalid_body", "jurisdictions must be a unique non-empty subset of IN, EU, US", requestId);
  const affectedProjects = body.affectedProjects === undefined ? [] : body.affectedProjects;
  if (!Array.isArray(affectedProjects) || affectedProjects.length > 50 ||
      affectedProjects.some((p) => typeof p !== "string" || !p || p.length > 80))
    return err(400, "invalid_body", "affectedProjects must be at most 50 project ids", requestId);
  if (body.encrypted !== undefined && typeof body.encrypted !== "boolean")
    return err(400, "invalid_body", "encrypted must be a boolean", requestId);
  const discoveredTs = body.discoveredTs === undefined ? Date.now() : body.discoveredTs;
  if (!isInt(discoveredTs) || discoveredTs <= 0 || discoveredTs > Date.now() + 60000)
    return err(400, "invalid_body", "discoveredTs must be a past epoch-ms integer", requestId);
  const id = uuid("inc_"), now = Date.now();
  await db.prepare("INSERT INTO research_security_incidents (id,description,jurisdictions_json,affected_projects_json,encrypted_flag,discovered_ts,sla_json,status,created_by,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, description, JSON.stringify(jurisdictions), JSON.stringify(affectedProjects),
      body.encrypted === true ? 1 : 0, discoveredTs, JSON.stringify(slaFor(jurisdictions, discoveredTs)),
      "open", auth.uid, now, now).run();
  const row = await db.prepare("SELECT * FROM research_security_incidents WHERE id=?").bind(id).first();
  return json({ incident: incidentOf(row) }, 201, { "x-request-id": requestId });
}
export async function listIncidents(ctx) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const rows = (await db.prepare("SELECT * FROM research_security_incidents ORDER BY created_ts DESC LIMIT 100").all()).results || [];
  return api.json({ incidents: rows.map(incidentOf) }, 200, { "x-request-id": requestId });
}
export async function getIncident(ctx, id) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const row = await db.prepare("SELECT * FROM research_security_incidents WHERE id=?").bind(id).first();
  if (!row) return api.err(404, "incident_not_found", "Incident not found", requestId);
  return api.json({ incident: incidentOf(row) }, 200, { "x-request-id": requestId });
}
export async function updateIncidentStatus(ctx, id, body) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const row = await db.prepare("SELECT * FROM research_security_incidents WHERE id=?").bind(id).first();
  if (!row) return api.err(404, "incident_not_found", "Incident not found", requestId);
  if (["open", "contained", "closed"].indexOf(body.status) < 0)
    return api.err(400, "invalid_body", "status must be open, contained or closed", requestId);
  const note = body.note === undefined ? row.status_note : String(body.note);
  if (note.length > 2000) return api.err(400, "invalid_body", "note must be at most 2000 characters", requestId);
  const now = Date.now();
  await db.prepare("UPDATE research_security_incidents SET status=?,status_note=?,updated_ts=? WHERE id=?")
    .bind(body.status, note, now, id).run();
  const fresh = await db.prepare("SELECT * FROM research_security_incidents WHERE id=?").bind(id).first();
  return api.json({ incident: incidentOf(fresh) }, 200, { "x-request-id": requestId });
}
