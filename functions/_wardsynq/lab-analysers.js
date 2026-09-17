/* functions/_wardsynq/lab-analysers.js - laboratory analysers: the register, the on-premises connector's
 * door, and the bench's inbox of analyser results waiting for a technologist.
 *
 * THE CONNECTOR IS ON THE HOSPITAL'S NETWORK. This server runs on Pages Functions and cannot open a TCP
 * socket, so an analyser speaking HL7 v2 over MLLP or ASTM E1381/E1394 talks to connect-agent/analyser/
 * on a machine in the laboratory, which frames and acknowledges per the specification, keeps a durable
 * queue, and calls three routes here over HTTPS. Which protocol each analyser speaks (astm or hl7) is
 * the per-analyser adapter choice, set on Admin > Integrations > Laboratory analysers with the mapping of
 * the instrument's own test codes to the hospital's test names; the connector fetches it.
 *
 * THE CREDENTIAL. One connector key per hospital, issued on the same Admin card, shown once, stored
 * AES-GCM sealed under the document key exactly as webhook secrets are (webhooks.js sealSecret), never
 * returned again and never an environment variable. It names the hospital (so the door can find the
 * record) and carries a random secret compared in constant time. Rotating replaces it; revoking ends it.
 * No key issued means the Admin card says plainly that no analyser can send anything.
 *
 * WHAT THE CONNECTOR MAY DO is narrow and written by nobody's clinical authority: file a result as
 * RECEIVED in this inbox, file a QC run for a control lot, and ask which tests were ordered on a
 * specimen. It never writes an Observation or a DiagnosticReport. A result reaches the chart only when a
 * technologist on the Laboratory board releases it, through lab-result.js releaseResult, as themselves,
 * so the hospital's autoverification, second-person verification and critical-value rules apply exactly
 * as they do to a typed result, and a rejected QC run on that analyser and test blocks it (lab-qc.js).
 * Nothing is released automatically.
 *
 * THE INBOX HOLDS PATIENT VALUES, so every read and write of it is behind lab.result at the route and a
 * resolved clinical actor here, and every write is audited with ids and counts, never a value.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { VersionConflictError } from "./repository.js";
import { docKey } from "./documents.js";
import { sealSecret, openSecret } from "./webhooks.js";
import { releaseResult } from "./lab-result.js";
import { ANALYSER_TYPE, MATERIAL_TYPE, RUN_TYPE, entriesFor, appendRuns, currentBlocks, qcBlockedTests, recordQcOverride } from "./lab-qc.js";

const KEY_TYPE = "_wardsynq_lab_connector";
const KEY_ID = "lab-connector";
const INBOX_TYPE = "_wardsynq_analyser_result";
const PROTOCOLS = Object.freeze(["astm", "hl7"]);
const TRANSPORTS = Object.freeze(["tcp-server", "tcp-client"]);
const STATUSES = Object.freeze(["final", "preliminary", "corrected"]);
const MAX_ANALYSERS = 50;
const MAX_MAP = 500;
const KEY_PREFIX = "wsqlab";
const POLL_SECONDS = 300;

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, " ");
const upper = (v) => str(v).toUpperCase();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const BY = "wardsynq-lab";
const CONNECTOR_ACTOR = "device:lab-connector";
const auditEvent = (action, actor, scope, outcome) => ({ ts: new Date().toISOString(), actor, connectorId: BY, action, outcome: outcome || "ok", scope });

const refuse = (error, message) => ({ ok: false, status: 422, error, message });
const readFailed = { ok: false, status: 502, error: "record_read_failed", message: "The laboratory record could not be read, so nothing was changed." };
const writeFailed = (e) => e instanceof VersionConflictError
  ? { ok: false, status: 409, error: "version_conflict", message: "This changed at the same moment. Reload and try again; nothing was saved." }
  : { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made." };

async function open(request, env, ctx, need) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { ok: false, status: 404, error: "not_a_wardsynq_hospital" } };
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, need, ctx.actorDeps);
    return { actorId: r.actor.id, repo: ctx.recordDeps.repository, tenantId: mig.tenantId };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", message: str(e && e.message) } };
  }
}

/* ---- the register (Admin) ------------------------------------------------------------------------- */

/** PURE. A register entry from what the Admin screen sent, or { error }. */
function analyserFrom(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const name = str(a.name).slice(0, 120), ref = slug(a.ref || a.name);
  if (!name || !ref) return { error: refuse("name_required", "Give the analyser a name.") };
  const protocol = str(a.protocol), transport = str(a.transport);
  if (!PROTOCOLS.includes(protocol)) return { error: refuse("bad_protocol", "Choose how the analyser talks: ASTM or HL7 v2.") };
  if (!TRANSPORTS.includes(transport)) return { error: refuse("bad_transport", "Choose whether the connector listens or connects.") };
  const port = Number(a.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: refuse("bad_port", "The port is a whole number from 1 to 65535.") };
  const host = str(a.host).slice(0, 253);
  if (host && !/^[A-Za-z0-9.:-]+$/.test(host)) return { error: refuse("bad_host", "The host is a network address or name, with no scheme or path.") };
  if (transport === "tcp-client" && !host) return { error: refuse("host_required", "The connector connects to the analyser, so give the analyser's address.") };
  const rows = Array.isArray(a.testMap) ? a.testMap : [];
  if (rows.length > MAX_MAP) return { error: refuse("too_many_codes", `An analyser may map ${MAX_MAP} test codes.`) };
  const testMap = [], seen = new Set();
  for (const r of rows) {
    const instrumentCode = str(r && r.instrumentCode).slice(0, 40), testName = str(r && r.testName).slice(0, 120);
    if (!instrumentCode && !testName) continue;
    if (!instrumentCode || !testName) return { error: refuse("bad_mapping", "Each mapping line needs the instrument code and the hospital test name.") };
    // The ASTM and HL7 delimiters cannot be part of a code, or the code could never be matched.
    if (/[|^\\&~\r\n]/.test(instrumentCode)) return { error: refuse("bad_mapping", `The instrument code ${instrumentCode} contains a delimiter character.`) };
    if (seen.has(upper(instrumentCode))) return { error: refuse("duplicate_code", `The instrument code ${instrumentCode} is mapped twice.`) };
    seen.add(upper(instrumentCode));
    testMap.push({ instrumentCode, testName, unit: str(r.unit).slice(0, 30) || null, orderedAs: str(r.orderedAs).slice(0, 120) || null });
  }
  return { analyser: { id: `an-${ref}`, ref, name, protocol, transport, host: host || null, port, hostQuery: a.hostQuery === true, active: a.active !== false, testMap } };
}

const connectorSummary = (rec) => ({ issued: !!(rec && rec.keyEnc), keySetAt: (rec && rec.keySetAt) || null, revokedAt: (rec && rec.revokedAt) || null });

/** The register, and whether a connector key is issued. staff.admin at the route. */
async function listAnalysers(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return who.error;
  let rows, key;
  try { [rows, key] = await Promise.all([who.repo.latestByType(who.tenantId, ANALYSER_TYPE, MAX_ANALYSERS * 2), who.repo.latest(who.tenantId, KEY_TYPE, KEY_ID)]); }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The analysers could not be read." }; }
  return {
    ok: true, keyConfigured: !!(await docKey(env)), connector: connectorSummary(key),
    analysers: (rows || []).filter(Boolean).sort((a, b) => str(a.name).localeCompare(str(b.name))),
    protocols: PROTOCOLS, transports: TRANSPORTS,
  };
}

/** ctx.analyser: { name, ref?, protocol, transport, host?, port, hostQuery?, active?, testMap: [{instrumentCode, testName, unit?, orderedAs?}] }, ctx.expectedVersion? */
async function saveAnalyser(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return who.error;
  const parsed = analyserFrom(ctx.analyser);
  if (parsed.error) return parsed.error;
  const a = parsed.analyser;
  let cur, all;
  try { [cur, all] = await Promise.all([who.repo.latest(who.tenantId, ANALYSER_TYPE, a.id), who.repo.latestByType(who.tenantId, ANALYSER_TYPE, MAX_ANALYSERS * 2)]); }
  catch { return readFailed; }
  if (ctx.expectedVersion != null && (!cur || Number(ctx.expectedVersion) !== cur.version)) return writeFailed(new VersionConflictError("stale"));
  if (!cur && (all || []).length >= MAX_ANALYSERS) return { ok: false, status: 409, error: "too_many_analysers", message: `A hospital may register ${MAX_ANALYSERS} analysers.` };
  if ((all || []).some((x) => x && x.id !== a.id && x.active !== false && a.active && x.transport === "tcp-server" && a.transport === "tcp-server" && x.port === a.port && (x.host || "") === (a.host || ""))) {
    return refuse("port_in_use", "Another active analyser already listens on that port.");
  }
  const at = new Date().toISOString();
  const next = { resourceType: ANALYSER_TYPE, ...a, version: cur ? cur.version + 1 : 1, createdAt: (cur && cur.createdAt) || at, createdBy: (cur && cur.createdBy) || who.actorId, writtenBy: { id: who.actorId, kind: "human", at } };
  try {
    await who.repo.append(who.tenantId, [next], { audit: auditEvent(cur ? "lab.analyser.update" : "lab.analyser.create", who.actorId, { analyserId: a.id, protocol: a.protocol, transport: a.transport, port: a.port, codes: a.testMap.length, active: a.active }) });
  } catch (e) { return writeFailed(e); }
  return { ok: true, written: 1, analyser: next };
}

/* ---- the connector key ---------------------------------------------------------------------------------- */

/** PURE. "wsqlab.<base64url org id>.<secret>" to its parts, or null. */
function parseConnectorKey(token) {
  const m = /^wsqlab\.([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{32,100})$/.exec(str(token));
  if (!m) return null;
  let orgId;
  try { orgId = atob(m[1].replace(/-/g, "+").replace(/_/g, "/")); } catch { return null; }
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(orgId) ? { orgId, secret: m[2] } : null;
}

/** ctx: { revoke? }. Issues (or rotates) the hospital's connector key and returns it ONCE, or revokes it. */
async function connectorKey(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return who.error;
  let cur;
  try { cur = await who.repo.latest(who.tenantId, KEY_TYPE, KEY_ID); } catch { return readFailed; }
  const at = new Date().toISOString();
  if (ctx.revoke === true) {
    if (!cur || !cur.keyEnc) return { ok: true, unchanged: true, connector: connectorSummary(cur) };
    const next = { ...cur, version: cur.version + 1, keyEnc: null, revokedAt: at, writtenBy: { id: who.actorId, kind: "human", at } };
    try { await who.repo.append(who.tenantId, [next], { audit: auditEvent("lab.connector.key.revoke", who.actorId, { connector: KEY_ID }) }); }
    catch (e) { return writeFailed(e); }
    return { ok: true, written: 1, connector: connectorSummary(next) };
  }
  const orgId = str(ctx.orgId);
  if (!orgId) return refuse("org_required", "The hospital is required.");
  if (!(await docKey(env))) return { ok: false, status: 503, error: "connector_key_not_configured", message: "Keys cannot be stored encrypted on this server, so no key was issued." };
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const keyEnc = await sealSecret(env, secret);
  if (!keyEnc) return { ok: false, status: 503, error: "connector_key_not_configured", message: "Keys cannot be stored encrypted on this server, so no key was issued." };
  const next = { resourceType: KEY_TYPE, id: KEY_ID, version: cur ? cur.version + 1 : 1, keyEnc, keySetAt: at, revokedAt: null, writtenBy: { id: who.actorId, kind: "human", at } };
  try { await who.repo.append(who.tenantId, [next], { audit: auditEvent(cur && cur.keyEnc ? "lab.connector.key.rotate" : "lab.connector.key.issue", who.actorId, { connector: KEY_ID }) }); }
  catch (e) { return writeFailed(e); }
  return {
    ok: true, written: 1, connector: connectorSummary(next),
    key: `${KEY_PREFIX}.${b64url(new TextEncoder().encode(orgId))}.${secret}`,
    note: "Copy this key into the connector's key file now. It is not shown again; issue a new one to replace it.",
  };
}

/** The door's check. { ok } or { status, error }. Never says which part was wrong. */
async function authenticateConnector(env, repo, tenantId, presented) {
  let rec;
  try { rec = await repo.latest(tenantId, KEY_TYPE, KEY_ID); } catch { return { status: 503, error: "unavailable" }; }
  const want = rec && rec.keyEnc ? await openSecret(env, rec.keyEnc) : null;
  const got = str(presented && presented.secret);
  if (!want || want.length !== got.length) return { status: 401, error: "auth" };
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 ? { ok: true } : { status: 401, error: "auth" };
}

/* ---- the connector's three calls (ctx: { repo, tenantId }) ----------------------------------------------- */

/** GET analyser-config: the active analysers, with no mapping (the server maps). */
async function connectorConfig(ctx) {
  let rows;
  try { rows = await ctx.repo.latestByType(ctx.tenantId, ANALYSER_TYPE, MAX_ANALYSERS * 2); } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
  return { status: 200, body: { ok: true, pollSeconds: POLL_SECONDS,
    analysers: (rows || []).filter(Boolean).map((a) => ({ id: a.id, name: a.name, protocol: a.protocol, transport: a.transport, host: a.host, port: a.port, hostQuery: a.hostQuery === true, active: a.active !== false })) } };
}

/** PURE. The body the connector sends, validated, or { error }. */
function resultBodyFrom(b) {
  const body = b && typeof b === "object" ? b : {};
  const analyserId = str(body.analyserId), messageId = str(body.messageId), specimenId = str(body.specimenId);
  if (!analyserId || !/^[A-Za-z0-9._:-]{8,128}$/.test(messageId) || !specimenId || specimenId.length > 64) return { error: "bad_message" };
  const rows = Array.isArray(body.results) ? body.results : [];
  if (!rows.length || rows.length > 200) return { error: "bad_results" };
  const results = [];
  for (const r of rows) {
    const instrumentCode = str(r && r.instrumentCode), value = r && (typeof r.value === "number" ? String(r.value) : str(r.value));
    const status = str(r && r.status);
    if (!instrumentCode || instrumentCode.length > 40 || !value || value.length > 200 || !STATUSES.includes(status)) return { error: "bad_results" };
    results.push({ instrumentCode, value, unit: str(r.unit).slice(0, 40) || null, referenceRange: str(r.referenceRange).slice(0, 60) || null, flags: str(r.flags).slice(0, 20) || null, status });
  }
  const observedAt = str(body.observedAt) && Number.isFinite(Date.parse(body.observedAt)) ? new Date(Date.parse(body.observedAt)).toISOString() : null;
  return { analyserId, messageId, specimenId, results, observedAt, protocol: PROTOCOLS.includes(str(body.protocol)) ? str(body.protocol) : null };
}

/** PURE. The specimen a tube's barcode names: its accession number, its label or its id. */
function specimenFor(specimens, specimenId) {
  const want = upper(specimenId);
  return (specimens || []).find((s) => s && (upper(s.accessionNumber) === want || upper(s.label) === want || upper(s.id) === want)) || null;
}

/** POST analyser-results. body per resultBodyFrom. */
async function connectorResults(ctx, rawBody) {
  const m = resultBodyFrom(rawBody);
  if (m.error) return { status: 422, body: { ok: false, error: m.error } };
  const { repo, tenantId } = ctx;
  const inboxId = `anr-${slug(m.messageId)}`;
  let analyser, existing, existingQc, materials;
  try {
    [analyser, existing, existingQc, materials] = await Promise.all([
      repo.latest(tenantId, ANALYSER_TYPE, m.analyserId), repo.latest(tenantId, INBOX_TYPE, inboxId),
      repo.latest(tenantId, RUN_TYPE, `qcr-${slug(m.messageId)}-0`), repo.latestByType(tenantId, MATERIAL_TYPE, 500),
    ]);
  } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
  if (!analyser || analyser.active === false) return { status: 409, body: { ok: false, error: "unknown_analyser" } };
  if (existing || existingQc) return { status: 200, body: { ok: true, outcome: "duplicate" } };

  const byCode = new Map((analyser.testMap || []).map((t) => [upper(t.instrumentCode), t]));
  const mapped = m.results.map((r) => { const t = byCode.get(upper(r.instrumentCode)); return { ...r, testName: t ? t.testName : null, unit: r.unit || (t && t.unit) || null }; });

  /* A CONTROL, NOT A PATIENT. The sample id an active control lot is registered under makes this a QC run. */
  const material = (materials || []).find((x) => x && x.active !== false && x.sampleId && upper(x.sampleId) === upper(m.specimenId) && (!x.analyserId || x.analyserId === analyser.id));
  if (material) {
    const { entries, problems } = entriesFor(material, mapped.filter((r) => r.testName).map((r) => ({ test: r.testName, value: r.value })));
    if (!entries.length) {
      try { await repo.auditOnly(tenantId, auditEvent("lab.qc.connector.unusable", CONNECTOR_ACTOR, { analyserId: analyser.id, materialId: material.id, problems: problems.length, unmapped: mapped.filter((r) => !r.testName).length }, "refused")); } catch { /* the refusal stands */ }
      return { status: 422, body: { ok: false, error: "qc_unusable" } };
    }
    try { await appendRuns(repo, tenantId, { material, analyserId: analyser.id, entries, source: "connector", at: m.observedAt, actorId: CONNECTOR_ACTOR, messageId: m.messageId }); }
    catch (e) { return e instanceof VersionConflictError ? { status: 200, body: { ok: true, outcome: "duplicate" } } : { status: 503, body: { ok: false, error: "unavailable" } }; }
    return { status: 200, body: { ok: true, outcome: "qc", runs: entries.length } };
  }

  let specimens;
  // ponytail: the newest 1000 specimens scanned for the barcode; an accession index when a laboratory outgrows that window.
  try { specimens = await repo.latestByType(tenantId, "SpecimenCollection", 1000, { newest: true }); } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
  const sp = specimenFor(specimens, m.specimenId);
  const matched = !!(sp && sp.state !== "failed");
  const at = new Date().toISOString();
  const row = {
    resourceType: INBOX_TYPE, id: inboxId, version: 1, state: matched ? "pending" : "unmatched",
    analyserId: analyser.id, analyserName: analyser.name, protocol: m.protocol || analyser.protocol, messageId: m.messageId, specimenId: m.specimenId,
    specimenRecordId: matched ? sp.id : null, serviceRequestId: matched ? sp.serviceRequestId : null, patientId: matched ? sp.patientId : null,
    results: mapped, observedAt: m.observedAt, receivedAt: at, writtenBy: { id: CONNECTOR_ACTOR, kind: "device", at },
  };
  try {
    await repo.append(tenantId, [row], { audit: auditEvent("lab.analyser.result.receive", CONNECTOR_ACTOR, { analyserId: analyser.id, inboxId, matched, results: mapped.length, unmapped: mapped.filter((r) => !r.testName).length }) });
  } catch (e) { return e instanceof VersionConflictError ? { status: 200, body: { ok: true, outcome: "duplicate" } } : { status: 503, body: { ok: false, error: "unavailable" } }; }
  return { status: 200, body: { ok: true, outcome: matched ? "queued" : "unmatched" } };
}

/** POST analyser-orders: the host query. What was ordered on each specimen, as this analyser's own codes. */
async function connectorOrders(ctx, rawBody) {
  const b = rawBody && typeof rawBody === "object" ? rawBody : {};
  const ids = Array.isArray(b.specimenIds) ? b.specimenIds.map(str).filter(Boolean) : [];
  if (!str(b.analyserId) || !ids.length || ids.length > 50 || ids.some((x) => x.length > 64)) return { status: 422, body: { ok: false, error: "bad_query" } };
  const { repo, tenantId } = ctx;
  let analyser, specimens;
  try { [analyser, specimens] = await Promise.all([repo.latest(tenantId, ANALYSER_TYPE, str(b.analyserId)), repo.latestByType(tenantId, "SpecimenCollection", 1000, { newest: true })]); }
  catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
  if (!analyser || analyser.active === false) return { status: 409, body: { ok: false, error: "unknown_analyser" } };
  if (analyser.hostQuery !== true) return { status: 409, body: { ok: false, error: "host_query_off" } };
  const orders = [];
  for (const id of ids) {
    const sp = specimenFor(specimens, id);
    if (!sp || (sp.state !== "collected" && sp.state !== "received")) continue;
    let sr;
    try { sr = await repo.latest(tenantId, "ServiceRequest", sp.serviceRequestId); } catch { return { status: 503, body: { ok: false, error: "unavailable" } }; }
    if (!sr || ["completed", "revoked", "cancelled", "entered-in-error"].includes(sr.status)) continue;
    const names = new Set([norm(sr.display), norm(sr.code)].filter(Boolean));
    const tests = (analyser.testMap || []).filter((t) => names.has(norm(t.orderedAs)) || names.has(norm(t.testName))).map((t) => ({ instrumentCode: t.instrumentCode }));
    if (tests.length) orders.push({ specimenId: id, priority: ["stat", "urgent"].includes(sr.priority) ? sr.priority : "routine", tests });
  }
  return { status: 200, body: { ok: true, orders } };
}

/* ---- the bench (lab.result) -------------------------------------------------------------------------------- */

/** The analyser results waiting for a technologist, and the ones no specimen matched. */
async function analyserInbox(request, env, ctx) {
  const who = await open(request, env, ctx, "record:read");
  if (who.error) return { ...who.error, rows: [] };
  let rows;
  try { rows = await who.repo.latestByType(who.tenantId, INBOX_TYPE, 1000, { newest: true }); }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "Analyser results could not be read.", rows: [] }; }
  let blocks = null;
  try { blocks = await currentBlocks(who.repo, who.tenantId); } catch { blocks = null; }
  const open_ = (rows || []).filter((r) => r && (r.state === "pending" || r.state === "unmatched"));
  return {
    ok: true,
    rows: open_.map((r) => ({
      ...r,
      qcBlocked: blocks === null ? null : blocks.filter((b) => b.analyserId === r.analyserId && r.results.some((x) => x.testName && norm(x.testName) === norm(b.test))).map((b) => ({ test: b.test, rules: b.rules })),
    })),
    ...(blocks === null ? { qcUnreadable: true } : {}),
    ...((rows || []).length >= 1000 ? { partial: true, partialWarning: "Only the latest 1000 analyser results were read; older ones waiting may be missing." } : {}),
  };
}

/** PURE. "3.5-5.1", "3.5 to 5.1" -> { low, high }; anything else carries only its text. */
function rangeOf(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:-|to)\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(str(text));
  return m ? { low: Number(m[1]), high: Number(m[2]) } : { low: null, high: null };
}

/**
 * Releases one analyser result as the technologist who presses the button.
 * ctx: { inboxId, expectedVersion, qcOverrideReason?, deltaLimits, autoVerify, labVerification, ...deps }
 */
async function releaseAnalyserResult(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return { ...who.error, written: 0 };
  let row;
  try { row = await who.repo.latest(who.tenantId, INBOX_TYPE, str(ctx.inboxId)); } catch { return { ...readFailed, written: 0 }; }
  if (!row) return { ok: false, status: 404, error: "not_found", message: "No such analyser result.", written: 0 };
  if (row.state !== "pending") return { ok: false, status: 409, error: "not_pending", message: row.state === "unmatched" ? "This result matched no specimen, so it cannot be released." : "This result has already been dealt with.", written: 0 };
  if (ctx.expectedVersion != null && Number(ctx.expectedVersion) !== row.version) return { ...writeFailed(new VersionConflictError("stale")), written: 0 };
  const mapped = (row.results || []).filter((r) => r.testName);
  if (!mapped.length) return refuse("nothing_mapped", "None of these instrument codes is mapped to a hospital test. Map them on Admin > Integrations > Laboratory analysers.");

  let blocked;
  try { blocked = await qcBlockedTests(who.repo, who.tenantId, row.analyserId, mapped.map((r) => r.testName)); }
  catch { return { ok: false, status: 502, error: "qc_unreadable", message: "The QC state of this analyser could not be read, so nothing was released.", written: 0 }; }
  let override = null;
  if (blocked.length) {
    const reason = str(ctx.qcOverrideReason).slice(0, 1000);
    if (reason.length < 10) {
      return { ok: false, status: 409, error: "qc_blocked", blocked: blocked.map((b) => ({ test: b.test, rules: b.rules })), written: 0,
        message: "A rejected QC run blocks release for this analyser and test. Record the corrective action on the Quality control screen, or override with a reason." };
    }
    try { override = await recordQcOverride(who.repo, who.tenantId, who.actorId, { analyserId: row.analyserId, blocked, reason, subject: { kind: "analyser-result", id: row.id } }); }
    catch (e) { return { ...writeFailed(e), written: 0 }; }
  }

  const status = mapped.some((r) => r.status === "corrected") ? "corrected" : mapped.every((r) => r.status === "final") ? "final" : "preliminary";
  const released = await releaseResult(request, env, {
    ...ctx, serviceRequestId: row.serviceRequestId, patientId: row.patientId, status,
    reportedAt: row.observedAt || row.receivedAt,
    tests: mapped.map((r) => ({ test: r.testName, value: r.value, unit: r.unit, range: r.referenceRange, ...rangeOf(r.referenceRange), critical: /(^|[^A-Z])(LL|HH)([^A-Z]|$)/.test(upper(r.flags)) })),
    analyser: { id: row.analyserId, name: row.analyserName, tests: mapped.map((r) => r.testName) },
    idempotencyKey: `analyser-release:${row.id}`,
  });
  if (!released.ok) return { ...released, inboxId: row.id, ...(override ? { overrideId: override.id } : {}) };

  const at = new Date().toISOString();
  const next = { ...row, version: row.version + 1, state: "released", reportId: released.reportId, releasedBy: who.actorId, releasedAt: at, overrideId: override ? override.id : null, writtenBy: { id: who.actorId, kind: "human", at } };
  try {
    await who.repo.append(who.tenantId, [next], { audit: auditEvent("lab.analyser.result.release", who.actorId, { inboxId: row.id, reportId: released.reportId, analyserId: row.analyserId, overrideId: next.overrideId }) });
  } catch {
    return { ...released, ok: false, status: 502, error: "inbox_update_failed", released: true, inboxId: row.id,
      message: "The result was released to the chart, but this analyser row could not be marked as done and may still be listed. Do not release it again." };
  }
  return { ...released, inboxId: row.id, released: true, ...(override ? { overrideId: override.id } : {}) };
}

/** ctx: { inboxId, reason, expectedVersion? }. Takes a result off the bench without releasing it. */
async function dismissAnalyserResult(request, env, ctx) {
  const who = await open(request, env, ctx, "record:write");
  if (who.error) return { ...who.error, written: 0 };
  const reason = str(ctx.reason).slice(0, 1000);
  if (reason.length < 5) return refuse("reason_required", "Say why this result is not being released (for example: rerun, sample rejected, not our specimen).");
  let row;
  try { row = await who.repo.latest(who.tenantId, INBOX_TYPE, str(ctx.inboxId)); } catch { return { ...readFailed, written: 0 }; }
  if (!row) return { ok: false, status: 404, error: "not_found", message: "No such analyser result.", written: 0 };
  if (row.state !== "pending" && row.state !== "unmatched") return { ok: false, status: 409, error: "not_pending", message: "This result has already been dealt with.", written: 0 };
  if (ctx.expectedVersion != null && Number(ctx.expectedVersion) !== row.version) return { ...writeFailed(new VersionConflictError("stale")), written: 0 };
  const at = new Date().toISOString();
  const next = { ...row, version: row.version + 1, state: "dismissed", dismissedBy: who.actorId, dismissedAt: at, dismissReason: reason, writtenBy: { id: who.actorId, kind: "human", at } };
  try { await who.repo.append(who.tenantId, [next], { audit: auditEvent("lab.analyser.result.dismiss", who.actorId, { inboxId: row.id, analyserId: row.analyserId }) }); }
  catch (e) { return { ...writeFailed(e), written: 0 }; }
  return { ok: true, written: 1, inboxId: row.id, state: "dismissed" };
}

export {
  ANALYSER_TYPE, KEY_TYPE, INBOX_TYPE, PROTOCOLS, TRANSPORTS, analyserFrom, parseConnectorKey, resultBodyFrom, specimenFor, rangeOf,
  listAnalysers, saveAnalyser, connectorKey, authenticateConnector, connectorConfig, connectorResults, connectorOrders,
  analyserInbox, releaseAnalyserResult, dismissAnalyserResult,
};
