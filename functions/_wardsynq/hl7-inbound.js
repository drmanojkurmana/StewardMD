/* functions/_wardsynq/hl7-inbound.js - the HL7 v2 gateway: another hospital's ADT and results, into
 * THIS record, through exactly the doors a FHIR bundle goes through.
 *
 * NOT A BLIND LISTENER. An HL7 message is parsed (Connect's hardened parser: encoding discovered
 * from MSH, budgets, warn-never-throw), checked against the hospital's own INTEGRATION PROFILE
 * (which message types and events, which required segments, which sending applications, which
 * processing id), normalised to SCCM 1.1 (hl7-normalize.js), and then LANDED by the same function
 * that lands a FHIR transaction (fhir-inbound.js landBundle): the same adapter, the same terminology
 * marking, the same identity reconciliation, the same ownership partition, the same all-or-nothing
 * write, the same exception queue, the same provenance and idempotency. A message is a transaction:
 * one refusal refuses the whole message and nothing is written.
 *
 * ACK/NACK IS THE CONTRACT. Every message that could be parsed far enough to answer gets an ACK
 * whose MSA-1 says what happened: AA when it landed (or had already landed - a replay is a no-op and
 * says so), AE when it was held for a person or refused for its content (an ERR segment names the
 * exception), AR when it was rejected before content was considered (a type the profile does not
 * accept, a missing required segment, a processing id for the wrong environment, an unnamed sender).
 * The HTTP status is 200 whenever an ACK could be built, because an MLLP bridge treats anything
 * else as a transport failure and retries; a 4xx here means "no ACK could be made".
 *
 * Z-SEGMENTS ARE PRESERVED, NEVER INTERPRETED. They ride verbatim in the held message's payload
 * (the raw message IS the exception's payload) and, when the hospital asks for it, in an
 * ExchangeMessage receipt. Nothing reads them.
 *
 * THE LISTENER IS HTTPS. This runs on Cloudflare Pages Functions, which has no TCP: MLLP does not
 * exist here and is not pretended to. A hospital's interface engine posts ER7 over HTTPS to this door
 * (Content-Type x-application/hl7-v2+er7), or an MLLP-to-HTTPS bridge on their side does. OFF
 * unless wardsynq.hl7.inbound.enabled is true.
 */

import { parseHl7, seg, segs, field, comp } from "../_connect/connectors/hl7v2/parser.js";
import { hl7ToSccm } from "./hl7-normalize.js";
import { landBundle, openIngest, registerRedrive, REASON, authorizedSourceSystem } from "./fhir-inbound.js";
import { resolveId, operationOutcome } from "./fhir.js";
import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { esc, ts } from "./hl7v2.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const MESSAGE_TYPE = "ExchangeMessage";

/** The messages this gateway understands at all. A hospital's profile may narrow this, never widen it. */
const SUPPORTED = Object.freeze([
  "ADT^A01", "ADT^A02", "ADT^A03", "ADT^A04", "ADT^A08",
  /* TASK 7.6. The cancellations. A ward that can be told a patient was admitted, moved and
   * discharged but never that any of it was taken back accumulates ghosts: a bed that stays
   * occupied, a discharge summary owed for a visit that did not happen. A11 cancel-admit,
   * A12 cancel-transfer, A13 cancel-discharge. None of them may CREATE an encounter - see
   * fhir-inbound.js's cancellationsWithoutTarget: a cancellation of a visit this hospital never
   * had is held for a person, never turned into a new visit that is instantly cancelled. */
  "ADT^A11", "ADT^A12", "ADT^A13",
  "ORU^R01",
  /* An order placed in another system, arriving here. ORM^O01 is the classic order message and
   * OML^O21 its laboratory successor; both are filed as ServiceRequests, the same type the ORU
   * path already creates for the order behind a result. */
  "ORM^O01", "OML^O21",
]);

/** The hospital's integration profile, with the defaults any hospital gets. */
const DEFAULT_PROFILE = Object.freeze({
  messages: SUPPORTED,
  /* An order message must carry an ORC: the ORC is what says what is HAPPENING to the order (new,
   * cancelled, held). An OBR alone describes a service with no instruction attached to it. */
  requiredSegments: { ADT: ["MSH", "EVN", "PID", "PV1"], ORU: ["MSH", "PID", "OBR", "OBX"], ORM: ["MSH", "PID", "ORC"], OML: ["MSH", "PID", "ORC"] },
  sendingApplications: [],      // MSH-3 values allowed; empty = any named sender
  processingIds: ["P"],         // MSH-11; a T (training) message does not enter a production record
  keepRaw: false,               // store every message verbatim as an ExchangeMessage receipt
});

function hl7Enabled(config) {
  return !!(config && config.inbound && config.inbound.enabled === true);
}

/** PURE. The hospital's profile over the defaults. Only narrows. */
function profileFor(config) {
  const p = (config && config.profile && typeof config.profile === "object") ? config.profile : {};
  const messages = Array.isArray(p.messages) ? p.messages.map(str).filter((m) => SUPPORTED.includes(m)) : DEFAULT_PROFILE.messages;
  return {
    messages: messages.length ? messages : DEFAULT_PROFILE.messages,
    requiredSegments: { ...DEFAULT_PROFILE.requiredSegments, ...(p.requiredSegments && typeof p.requiredSegments === "object" ? p.requiredSegments : {}) },
    sendingApplications: Array.isArray(p.sendingApplications) ? p.sendingApplications.map(str).filter(Boolean) : [],
    processingIds: Array.isArray(p.processingIds) && p.processingIds.length ? p.processingIds.map(str) : DEFAULT_PROFILE.processingIds,
    keepRaw: p.keepRaw === true,
  };
}

/**
 * PURE. Everything the profile refuses BEFORE content is considered. Each problem is an ERR-shaped
 * fact: { code (HL7 table 0357), detail, segment?, fatal }. Any problem here is an AR.
 */
function validateMessage(msg, kind, profile) {
  const problems = [];
  const msh = seg(msg, "MSH");
  if (!msh) return [{ code: "100", detail: "no MSH segment", segment: "MSH", fatal: true }];
  if (!kind.controlId) problems.push({ code: "101", detail: "MSH-10 message control id is required", segment: "MSH", fatal: true });
  if (!kind.type) problems.push({ code: "101", detail: "MSH-9 message type is required", segment: "MSH", fatal: true });
  const key = `${kind.type}^${kind.event}`;
  if (kind.type && !profile.messages.includes(key)) problems.push({ code: "200", detail: `${key} is not a message this hospital accepts (${profile.messages.join(", ")})`, segment: "MSH", fatal: true });
  if (kind.processingId && !profile.processingIds.includes(kind.processingId)) problems.push({ code: "202", detail: `MSH-11 processing id ${kind.processingId} is not accepted here (${profile.processingIds.join(", ")})`, segment: "MSH", fatal: true });
  if (profile.sendingApplications.length && !profile.sendingApplications.includes(kind.sendingApp)) problems.push({ code: "207", detail: `MSH-3 sending application "${kind.sendingApp}" is not registered with this hospital`, segment: "MSH", fatal: true });
  for (const s of profile.requiredSegments[kind.type] || []) {
    if (!seg(msg, s)) problems.push({ code: "100", detail: `required segment ${s} is missing for ${key}`, segment: s, fatal: true });
  }
  const pid = seg(msg, "PID");
  if (pid && !str(comp(pid, 3, 0, msg.encoding))) problems.push({ code: "101", detail: "PID-3 patient identifier is required", segment: "PID", fatal: true });
  return problems;
}

/**
 * PURE. An ACK^event^ACK in ER7. MSA-1 is the answer; MSA-2 echoes the control id; ERR segments name
 * what went wrong (HL7 table 0357 code, severity, and a human sentence). Every value is escaped.
 */
function buildAck(kind, ack, opts) {
  const o = opts || {};
  const now = ts(o.now || new Date().toISOString());
  const control = esc(o.controlId || `ACK-${kind.controlId || "0"}-${Date.now().toString(36)}`);
  const lines = [
    ["MSH", "^~\\&", esc(o.app || "WardSynQ"), esc(o.facility || ""), esc(kind.sendingApp || ""), esc(kind.sendingFacility || ""), now, "", `ACK^${esc(kind.event || "")}^ACK`, control, esc(kind.processingId || "P"), "2.5.1"].join("|"),
    ["MSA", esc(ack.code), esc(kind.controlId || ""), esc(ack.text || "")].join("|"),
  ];
  for (const e of ack.errors || []) {
    lines.push(["ERR", "", e.segment ? `${esc(e.segment)}^1` : "", `${esc(e.code || "207")}^${esc(e.name || "")}^HL70357`, esc(e.severity || "E"), "", "", "", esc(e.detail || "")].join("|"));
  }
  return lines.join("\r") + "\r";
}

/** HL7 table 0357 names for the codes this gateway emits. */
const ERR_NAME = Object.freeze({ 100: "Segment sequence error", 101: "Required field missing", 200: "Unsupported message type", 202: "Unsupported processing id", 207: "Application internal error" });

/** The receipt record, when the hospital keeps raw messages. Non-clinical; append-only like everything else. */
function ExchangeMessage(input) {
  const i = input || {};
  return { resourceType: MESSAGE_TYPE, id: i.id, source: i.source, protocol: "hl7v2", controlId: i.controlId, type: i.type, event: i.event, receivedAt: i.receivedAt, digest: i.digest, raw: i.raw, outcome: i.outcome || null, exceptionId: i.exceptionId || null, zSegments: i.zSegments || [] };
}

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The gateway. ctx: { migration, config (wardsynq.hl7), body (ER7 text), sourceSystem? (header), base, actorDeps, recordDeps, terminology?, profiles?, override?, replayKeySuffix?, facility? }
 * Returns { ok, status, ack (ER7 text) | outcome (JSON when no ACK can be built), result }
 */
async function ingestHl7(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  if (!hl7Enabled(ctx.config)) return { ok: false, status: 404, outcome: operationOutcome("error", "not-supported", "Inbound HL7 v2 is not enabled for this hospital. It is off unless wardsynq.hl7.inbound.enabled is true.") };
  const profile = profileFor(ctx.config);
  const raw = typeof ctx.body === "string" ? ctx.body : "";
  if (!raw.trim()) return { ok: false, status: 400, outcome: operationOutcome("error", "required", "an HL7 v2 message (ER7) is required as the body") };

  const msg = parseHl7(raw, {});
  const msh = seg(msg, "MSH");
  if (!msh) return { ok: false, status: 400, outcome: operationOutcome("error", "invalid", `not an HL7 v2 message: ${(msg.warnings || []).join("; ") || "no MSH"}`) };
  const { sccm, kind, zSegments, warnings } = hl7ToSccm(msg, { tenantId: mig.tenantId, now: new Date().toISOString() });
  const ackWith = (code, text, errors, status) => ({ ok: code === "AA", status: status || 200, ack: buildAck(kind, { code, text, errors }, { facility: ctx.facility, now: new Date().toISOString() }), kind });

  const problems = validateMessage(msg, kind, profile);
  if (problems.length) return { ...ackWith("AR", "rejected by the integration profile: " + problems.map((p) => p.detail).join("; "), problems.map((p) => ({ code: p.code, name: ERR_NAME[p.code], segment: p.segment, detail: p.detail })), 200), rejected: problems };

  // AUTHENTICATE, THEN AUTHORIZE THE CLAIMED SOURCE - the same order and the same
  // SourceSystemGrant check fhir-inbound.js's ingestFhir() uses, so a doctor's clinical session
  // cannot declare itself to be a registered HL7 sending facility via MSH-3/MSH-4 any more than it
  // could via a FHIR header - see fhir-inbound.js's own header for the vulnerability this closes.
  const { svc, resolved, error } = await openIngest(request, env, ctx);
  if (error) return { ok: false, status: error.status, outcome: error.outcome, ack: buildAck(kind, { code: "AR", text: "not authorised at this door", errors: [{ code: "207", name: ERR_NAME[207], detail: error.outcome && error.outcome.issue && error.outcome.issue[0].diagnostics }] }, { facility: ctx.facility }) };

  const bodyClaim = [kind.sendingApp, kind.sendingFacility].filter(Boolean).join("-");
  const src = await authorizedSourceSystem(svc, resolved, ctx.sourceSystem, bodyClaim);
  if (src.error) {
    const code = src.error.code === "source_required" ? "101" : "207";
    return ackWith("AR", src.error.detail, [{ code, name: ERR_NAME[code], segment: "MSH", detail: src.error.detail }]);
  }
  const system = src.system;
  const adapterSystem = `hl7v2-${system}`;
  sccm.meta.sourceConnector = adapterSystem;

  const unsupported = (msg.segments || []).filter((s) => !/^Z/i.test(s.id) && !["MSH", "EVN", "PID", "PD1", "NK1", "PV1", "PV2", "DG1", "AL1", "OBR", "OBX", "NTE", "ORC", "TQ1", "ROL", "IN1", "GT1", "ZZZ"].includes(s.id)).map((s) => s.id);
  const landingProblems = [...new Set(unsupported)].map((id) => ({ reason: REASON.UNSUPPORTED, detail: `segment ${id} is not one this gateway files; carried in the raw message only` }));
  // landBundle reads the record (identity candidates, ownership) before it writes anything, and a
  // repository failure on one of those reads is not caught inside it - it throws. EVERY message that
  // parsed this far still gets an ACK: an MLLP bridge treats an uncaught 500 as a transport failure
  // and retries the same message forever rather than seeing the AE it should hold and act on.
  let landed;
  try {
    landed = await landBundle(request, env, {
      ...ctx, svc, resolved, sccm, system, adapterSystem, patient: sccm.patient, problems: landingProblems, requests: new Map(), bundleType: "transaction", atomic: true,
      protocol: "hl7v2", mode: "bundle", body: raw, messageControlId: kind.controlId, trigger: kind.event, grantId: src.grantId || null, targetType: undefined, targetId: undefined, patientRef: undefined, ifMatch: undefined,
    });
  } catch (e) {
    return { ...ackWith("AE", "the record could not be read to file this message: " + str(e && e.message), [{ code: "207", name: ERR_NAME[207], detail: str(e && e.message) }]) };
  }

  /* The receipt, when kept: the message verbatim (Z-segments and all), what became of it, and the
   * exception it raised if any. A separate append under the adapter's own name. */
  if (profile.keepRaw) {
    try {
      const adapterActor = makeActor({ id: `adapter:${adapterSystem}`, kind: KIND.ADAPTER, tier: TIER.DRAFT, display: `HL7 v2 from ${system}`, onBehalfOf: resolved.actor.id });
      const digest = await sha256(raw);
      const receipt = ExchangeMessage({ id: `hl7-msg-${adapterSystem}-${digest.slice(0, 40)}`, source: adapterSystem, controlId: kind.controlId, type: kind.type, event: kind.event, receivedAt: new Date().toISOString(), digest, raw, zSegments,
        outcome: landed.duplicate ? "replayed" : landed.held ? "held" : landed.ok && landed.status < 300 ? "filed" : "refused", exceptionId: landed.exceptionId || null });
      await svc.governedForIngest({}).put(adapterActor, receipt);
    } catch { /* a receipt that cannot be written does not change the answer to the sender */ }
  }

  const held = landed.held ? landed.exceptionId : null;
  if (landed.duplicate) return { ...ackWith("AA", `already processed (control id ${kind.controlId}); nothing filed twice`), result: landed, warnings };
  if (held) return { ...ackWith("AE", `held for a person to decide: see ExchangeException/${held}`, [{ code: "207", name: ERR_NAME[207], detail: `held: ${held}` }]), result: landed, exceptionId: held, warnings };
  if (!landed.ok) {
    const issues = (landed.outcome && landed.outcome.issue) || [];
    return { ...ackWith(landed.status === 401 || landed.status === 403 ? "AR" : "AE", issues.map((i) => i.diagnostics).join("; ") || "refused", issues.map((i) => ({ code: "207", name: ERR_NAME[207], detail: i.diagnostics }))), result: landed, warnings };
  }
  const written = (landed.written || []).length;
  return { ...ackWith("AA", `${written} record${written === 1 ? "" : "s"} filed${warnings.length ? "; " + warnings.length + " warning(s)" : ""}`), result: landed, warnings };
}

/* A held HL7 message is re-driven through THIS door when a person decides. */
registerRedrive("hl7v2", (request, env, ctx) => ingestHl7(request, env, { ...ctx, config: ctx.hl7Config || ctx.config }));

export { MESSAGE_TYPE, SUPPORTED, DEFAULT_PROFILE, ERR_NAME, hl7Enabled, profileFor, validateMessage, buildAck, ExchangeMessage, ingestHl7 };
