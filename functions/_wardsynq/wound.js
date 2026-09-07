/* functions/_wardsynq/wound.js — the wound, over time, and the two things nobody may quietly change.
 *
 * Nursing documentation could chart vitals, fluid, handovers, care plans and risk scores, and could
 * not chart a wound. A pressure ulcer is the commonest serious harm a hospital does to a patient who
 * came in for something else, and it is the one every regulator counts.
 *
 * A PRESSURE ULCER IS NEVER REVERSE-STAGED. This is the rule this file exists to enforce and it is
 * not a preference. A category 4 ulcer that improves does not become a category 2: the lost tissue
 * does not come back, granulation is not muscle, and a chart that let the stage fall would report
 * less harm than the hospital caused - the exact direction a harm record must never drift. A healing
 * category 4 is documented as "category 4, healing". The staging vocabulary is the recognised one
 * and `worstStage` is carried forward from the wound's own history, not from what the nurse typed
 * today.
 *
 * WHERE IT CAME FROM IS SET ONCE. "Present on admission" or "acquired here" is the single datum the
 * whole harm figure rests on, and a system that let it be edited later is a system where a hospital
 * can stop having pressure ulcers. It is recorded on the FIRST assessment of a wound and every later
 * assessment inherits it; changing it needs a new wound, deliberately.
 *
 * AREA IS COMPUTED, NEVER STORED, AND NEVER CALLED HEALING. length x width is arithmetic and it is
 * offered. "This wound is improving" is a clinical judgement about a patient, and a number that got
 * smaller is not it - a cavity can shrink at the surface while it undermines. The change is reported
 * as a change, with both measurements, and a human reads it.
 *
 * NO PHOTOGRAPHS. A wound image is identifiable PHI with its own storage, consent and retention
 * problems, and the clinical record here holds none. Nothing in this file accepts one, and a
 * hospital that needs them needs a decision about where they live first.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "WoundAssessment";
const num = (v) => {
  if (v === null || v === undefined || (typeof v !== "number" && str(v) === "")) return null;
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The recognised categories. `unstageable` and `deep-tissue` are real answers, not missing data. */
const STAGES = Object.freeze(["1", "2", "3", "4", "unstageable", "deep-tissue"]);
/** Where it came from. The datum the whole harm figure rests on. */
const ORIGINS = Object.freeze(["present-on-admission", "acquired-here", "unknown"]);
const KINDS = Object.freeze(["pressure", "surgical", "traumatic", "diabetic-foot", "venous", "other"]);

/** PURE. Higher is worse. `unstageable` and `deep-tissue` outrank 4: both may conceal full-thickness
 *  loss, and treating them as lesser is how a serious ulcer is recorded as a minor one. */
function stageRank(stage) {
  const s = str(stage);
  if (s === "unstageable" || s === "deep-tissue") return 5;
  const n = Number(s);
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : 0;
}

/** PURE. The worse of two stages, by rank. Used to carry `worstStage` forward, never to lower it. */
function worseStage(a, b) {
  if (!STAGES.includes(str(a))) return STAGES.includes(str(b)) ? str(b) : null;
  if (!STAGES.includes(str(b))) return str(a);
  return stageRank(a) >= stageRank(b) ? str(a) : str(b);
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** PURE. The WOUND's identity: this patient, this site. Every assessment of it shares this. */
function woundIdFor(patientId, site) {
  const p = slug(patientId), s = slug(site);
  return p && s ? `wsq-wnd-${p}-${s}` : null;
}
/** PURE. One assessment of that wound, at a time. A re-chart at the same instant is the same one. */
function assessmentIdFor(woundId, at) {
  const w = slug(woundId), t = slug(at);
  return w && t ? `${w}-${t}` : null;
}

function WoundAssessment(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    woundId: i.woundId,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    site: i.site || null,
    kind: KINDS.includes(i.kind) ? i.kind : "other",
    /* What the nurse staged it as TODAY. Never the wound's worst - that is its own field. */
    stage: STAGES.includes(i.stage) ? i.stage : null,
    /* The worst it has EVER been, carried forward. A category 4 that improves stays a 4 here. */
    worstStage: STAGES.includes(i.worstStage) ? i.worstStage : null,
    origin: ORIGINS.includes(i.origin) ? i.origin : "unknown",
    lengthCm: num(i.lengthCm), widthCm: num(i.widthCm), depthCm: num(i.depthCm),
    tissue: i.tissue || null,             // the nurse's words: granulating, sloughy, necrotic
    exudate: i.exudate || null,
    infectionSigns: i.infectionSigns === true,
    dressing: i.dressing || null,
    note: i.note || null,
    assessedBy: i.assessedBy || null, assessedAt: i.assessedAt || null,
    source: { system: "wardsynq-native", sourceId: `wound:${i.id}` },
  };
}

/** PURE. length x width, when both are there. Null otherwise - never a partial figure. */
function areaCm2(a) {
  const l = num(a && a.lengthCm), w = num(a && a.widthCm);
  return l === null || w === null ? null : Math.round(l * w * 100) / 100;
}

/**
 * PURE. How this assessment compares with the one before it.
 *
 * It reports a CHANGE and never a judgement. "Smaller" is not "healing": a cavity can shrink at the
 * surface while it undermines, and a nurse reading "improving" stops looking.
 */
function compare(current, previous) {
  if (!previous) return { state: "first", detail: "This is the first assessment of this wound." };
  const now = areaCm2(current), was = areaCm2(previous);
  if (now === null || was === null) {
    return { state: "not-comparable", detail: "One of the two assessments has no length and width recorded." };
  }
  const change = Math.round((now - was) * 100) / 100;
  return {
    state: change < 0 ? "smaller" : change > 0 ? "larger" : "unchanged",
    areaCm2: now, previousAreaCm2: was, changeCm2: change,
    since: previous.assessedAt || null,
    /* Said in the response, because the word people reach for is the dangerous one. */
    note: "A change in surface area only. It is not a judgement that the wound is healing or not.",
  };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

function summary(a) {
  return {
    assessmentId: a.id, woundId: a.woundId, patientId: a.patientId, site: a.site, kind: a.kind,
    stage: a.stage, worstStage: a.worstStage, origin: a.origin,
    lengthCm: a.lengthCm, widthCm: a.widthCm, depthCm: a.depthCm, areaCm2: areaCm2(a),
    tissue: a.tissue || null, exudate: a.exudate || null, infectionSigns: !!a.infectionSigns,
    dressing: a.dressing || null, note: a.note || null,
    assessedBy: a.assessedBy, assessedAt: a.assessedAt, version: a.version,
  };
}

/** Charts a wound. ctx: { migration, patientId, encounterId?, site, kind?, stage?, origin?, ... } */
async function chartWound(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), site = str(ctx.site);
  if (!patientId || !site) return { ...base, ok: false, status: 422, error: "patient_and_site_required", detail: "a wound is identified by its site", written: 0 };
  const stage = str(ctx.stage);
  if (stage && !STAGES.includes(stage)) return { ...base, ok: false, status: 400, error: "unknown_stage", detail: `stage must be one of ${STAGES.join(", ")}`, written: 0 };
  // A photograph is not accepted, and saying so beats ignoring a field somebody sent.
  if (ctx.photo || ctx.image) return { ...base, ok: false, status: 400, error: "no_images", detail: "this record holds no wound images; they need their own storage, consent and retention decision", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const woundId = woundIdFor(patientId, site);
  const at = str(ctx.assessedAt) || new Date().toISOString();
  const id = assessmentIdFor(woundId, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let history;
  try { history = (await svc.byPatient(TYPE, patientId)) || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  const series = history.filter((a) => a && a.woundId === woundId)
    .sort((a, b) => String(a.assessedAt || "").localeCompare(String(b.assessedAt || "")));
  const first = series[0] || null;
  const previous = series.filter((a) => a.id !== id).slice(-1)[0] || null;

  if (series.some((a) => a.id === id)) {
    return { ...base, ok: true, written: 0, skipped: "already_charted", ...summary(series.find((a) => a.id === id)) };
  }

  /* WHERE IT CAME FROM IS SET ONCE. A system that let this be edited later is one where a hospital
   * can stop having pressure ulcers. Every later assessment inherits the first's answer. */
  const askedOrigin = str(ctx.origin);
  const origin = first ? first.origin : (ORIGINS.includes(askedOrigin) ? askedOrigin : "unknown");
  const originLocked = !!first && ORIGINS.includes(askedOrigin) && askedOrigin !== first.origin;

  /* NEVER REVERSE-STAGED. `worstStage` only ever rises. A category 4 that improves is documented as
   * a healing category 4, and the harm figure keeps counting it as a 4. */
  const worstSoFar = series.reduce((w, a) => worseStage(w, a.worstStage || a.stage), null);
  const worstStage = worseStage(worstSoFar, stage || null);

  const record = WoundAssessment({
    id, woundId, patientId, encounterId: str(ctx.encounterId) || null,
    site, kind: str(ctx.kind), stage: stage || null, worstStage, origin,
    lengthCm: ctx.lengthCm, widthCm: ctx.widthCm, depthCm: ctx.depthCm,
    tissue: str(ctx.tissue) || null, exudate: str(ctx.exudate) || null,
    infectionSigns: ctx.infectionSigns === true, dressing: str(ctx.dressing) || null,
    note: str(ctx.note) || null,
    assessedBy: resolved.actor.id, assessedAt: at,
  });

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    const cmp = compare(record, previous);
    return {
      ...base, ok: true, written: 1, ...summary({ ...record, version: out.record.version }),
      comparison: cmp,
      ...(originLocked ? {
        originNotChanged: first.origin,
        warning: `This wound was first recorded as "${first.origin}" and that is not editable. If this is a different wound, chart it at its own site.`,
      } : {}),
      ...(stage && worstStage !== stage ? {
        note: `Charted as category ${stage}. This wound reached category ${worstStage} and is recorded at its worst - a pressure ulcer is never reverse-staged.`,
      } : {}),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { assessmentId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** The patient's wounds, each with its series. ctx: { migration, patientId } */
async function listWounds(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", wounds: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", wounds: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, wounds: [] };

  let rows;
  try { rows = await svc.byPatient(TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), wounds: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), wounds: [] };
  }

  const byWound = new Map();
  for (const a of (rows || []).filter(Boolean)) byWound.set(a.woundId, [...(byWound.get(a.woundId) || []), a]);

  const wounds = [...byWound.entries()].map(([woundId, series]) => {
    series.sort((a, b) => String(a.assessedAt || "").localeCompare(String(b.assessedAt || "")));
    const latest = series[series.length - 1];
    return {
      woundId, site: latest.site, kind: latest.kind,
      origin: series[0].origin,
      stage: latest.stage,
      // Carried across the whole series, so no single reading can lower it.
      worstStage: series.reduce((w, a) => worseStage(w, a.worstStage || a.stage), null),
      assessments: series.length,
      firstAssessedAt: series[0].assessedAt, lastAssessedAt: latest.assessedAt,
      latest: summary(latest),
      comparison: compare(latest, series[series.length - 2] || null),
    };
  }).sort((a, b) => String(b.lastAssessedAt || "").localeCompare(String(a.lastAssessedAt || "")));

  return {
    ...base, ok: true, patientId, wounds,
    /* The number a hospital is actually accountable for. Counted from `origin`, which cannot be
     * edited after the first assessment. */
    acquiredHere: wounds.filter((w) => w.origin === "acquired-here").length,
    note: "A wound's worst stage is carried forward and never lowered, and where it came from is set at its first assessment.",
  };
}

export { TYPE, STAGES, ORIGINS, KINDS, stageRank, worseStage, woundIdFor, assessmentIdFor, WoundAssessment, areaCm2, compare, chartWound, listWounds };
