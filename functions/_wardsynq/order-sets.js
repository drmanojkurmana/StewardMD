/* functions/_wardsynq/order-sets.js — a named group of orders, applied one at a time.
 *
 * An order set is how a hospital turns "admit a community-acquired pneumonia" into the bloods, the
 * chest film, the antibiotic and the fluids, without the admitting doctor writing eight orders at
 * three in the morning and forgetting the second blood culture. It is also one of the easiest ways
 * to hurt somebody, and the two facts are the same fact: a set applies a lot of clinical decisions
 * very fast.
 *
 * THE ONE RULE EVERYTHING ELSE FOLLOWS FROM: APPLYING A SET IS APPLYING EACH ORDER INDIVIDUALLY,
 * THROUGH THE ORDINARY ORDERING PATH, WITH THE ORDINARY SAFETY CHECKS. This file writes NO orders
 * itself. It resolves a set into a list of order requests and hands them back, and the caller puts
 * each one through the same door a hand-written order goes through - the same CDSS, the same
 * allergy check, the same dose ceiling, the same override record. A set that wrote orders directly
 * would be a hole straight through every control this system has, and it would be invisible: the
 * orders would look exactly like ordinary ones.
 *
 * NOTHING IS APPLIED THAT THE CLINICIAN DID NOT SEE. A set resolves to a list with each item's
 * default selection stated, and the caller sends back what was actually chosen. An item the
 * clinician deselected is not ordered, and an item they never saw - because the set changed between
 * being read and being applied - is refused rather than quietly added. A set that silently orders
 * twelve things is how a patient ends up on two anticoagulants.
 *
 * PARTIAL APPLICATION IS NORMAL AND MUST BE LOUD. If the antibiotic is refused for an allergy while
 * the bloods go through, that is the system working - but the clinician has to be told exactly which
 * items landed and which did not. Silently applying seven of eight is the failure mode that makes
 * order sets dangerous, because the missing one is invisible in a chart full of new orders.
 *
 * A SET IS CONTENT, NOT CODE. Sets live as org configuration with a version, and every application
 * records which set and which version it came from - so when a set turns out to be wrong, the
 * patients it was applied to can be found.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "OrderSetApplication";

/** What an item asks for. Each maps to an existing ordering path; this file invents no third kind. */
const KINDS = Object.freeze(["medication", "investigation"]);

/**
 * PURE. Validates a set definition into something applyable, or says why it cannot be.
 *
 * A malformed item is REPORTED and dropped rather than silently skipped: a set that quietly loses
 * its antibiotic still looks like it applied cleanly, which is the worst outcome available.
 */
function resolveSet(def) {
  const d = def || {};
  const id = str(d.id), name = str(d.name);
  if (!id || !name) return { ok: false, error: "set_incomplete", detail: "a set needs an id and a name", items: [], problems: [] };

  const items = [], problems = [];
  const seen = new Set();
  for (let i = 0; i < (Array.isArray(d.items) ? d.items : []).length; i++) {
    const it = d.items[i] || {};
    const kind = str(it.kind).toLowerCase();
    if (!KINDS.includes(kind)) { problems.push({ index: i, reason: "unknown_kind", kind: it.kind || null }); continue; }

    const key = str(it.key) || str(it.drug) || str(it.code);
    if (!key) { problems.push({ index: i, reason: "no_key" }); continue; }
    const k = key.toLowerCase();
    if (seen.has(k)) { problems.push({ index: i, reason: "duplicate", key }); continue; }
    seen.add(k);

    if (kind === "medication") {
      const drug = str(it.drug);
      const value = it.dose && Number(it.dose.value);
      const unit = str(it.dose && it.dose.unit);
      /* A medication item with no dose cannot be ordered - the bedside five-rights check compares
       * the prepared dose against the ordered one, so a doseless order can never be given. A set
       * carrying one would put an unadministrable order on every patient it touched. */
      if (!drug) { problems.push({ index: i, reason: "no_drug", key }); continue; }
      if (!Number.isFinite(value) || value <= 0 || !unit) { problems.push({ index: i, reason: "no_dose", key, drug }); continue; }
      items.push({
        key, kind, drug, dose: { value, unit },
        route: str(it.route) || null, frequency: str(it.frequency) || null, stopAt: str(it.stopAt) || null,
        // Stated, not assumed. An item a set does not pre-select is one the clinician has to choose.
        defaultSelected: it.defaultSelected !== false,
        note: str(it.note) || null,
      });
    } else {
      const code = str(it.code) || str(it.display);
      if (!code) { problems.push({ index: i, reason: "no_code", key }); continue; }
      items.push({
        key, kind, code, display: str(it.display) || code,
        defaultSelected: it.defaultSelected !== false, note: str(it.note) || null,
      });
    }
  }
  if (!items.length) return { ok: false, error: "set_empty", detail: "no usable items", items: [], problems };
  return {
    ok: true, id, name, version: str(d.version) || "0",
    description: str(d.description) || null,
    items, problems,
  };
}

/**
 * PURE. What the clinician chose, checked against what the set actually contains.
 *
 * An item the caller asks for that is NOT in the set is refused. That is the case where the set
 * changed between being read and being applied, and quietly ordering something the clinician never
 * saw on their screen is exactly what this must not do.
 */
function selectionFrom(resolved, chosenKeys) {
  const byKey = new Map(resolved.items.map((i) => [i.key.toLowerCase(), i]));
  const asked = Array.isArray(chosenKeys) ? chosenKeys : null;
  // With no explicit selection, the set's own defaults apply - and only those.
  const keys = asked || resolved.items.filter((i) => i.defaultSelected).map((i) => i.key);
  const selected = [], unknown = [];
  const done = new Set();
  for (const k of keys) {
    const key = str(k).toLowerCase();
    if (!key || done.has(key)) continue;
    done.add(key);
    const item = byKey.get(key);
    if (!item) { unknown.push(str(k)); continue; }
    selected.push(item);
  }
  return { selected, unknown, deselected: resolved.items.filter((i) => !done.has(i.key.toLowerCase())).map((i) => i.key) };
}

/**
 * PURE. The order requests a selection becomes. These go through the ORDINARY ordering routes -
 * this function hands them back, it does not write them.
 */
function requestsFor(selection, ctx) {
  const c = ctx || {};
  return selection.map((i) => (i.kind === "medication"
    ? {
        kind: "medication", key: i.key,
        order: {
          patientId: c.patientId, encounterId: c.encounterId,
          drug: i.drug, dose: i.dose, route: i.route, frequency: i.frequency,
          ...(i.stopAt ? { stopAt: i.stopAt } : {}),
        },
      }
    : {
        kind: "investigation", key: i.key,
        order: { patientId: c.patientId, encounterId: c.encounterId, code: i.code, display: i.display },
      }));
}

function OrderSetApplication(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    /* WHICH set and WHICH version. When a set turns out to be wrong, this is how the patients it was
     * applied to are found. */
    setId: i.setId,
    setName: i.setName || null,
    setVersion: i.setVersion || null,
    applied: Array.isArray(i.applied) ? i.applied : [],
    failed: Array.isArray(i.failed) ? i.failed : [],
    deselected: Array.isArray(i.deselected) ? i.deselected : [],
    appliedBy: i.appliedBy || null,
    appliedAt: i.appliedAt || null,
    source: { system: "wardsynq-native", sourceId: `order-set:${i.id}` },
  };
}

function applicationIdFor(encounterId, setId, at) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const e = slug(encounterId), s = slug(setId), t = slug(at);
  return e && s && t ? `wsq-oset-${e}-${s}-${t}` : null;
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

/** The sets this hospital has, resolved so a caller sees exactly what each would order. */
async function listOrderSets(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", sets: [] };

  const defs = Array.isArray(ctx.sets) ? ctx.sets : [];
  const sets = defs.map((d) => resolveSet(d));
  return {
    ...base, ok: true,
    sets: sets.filter((s) => s.ok).map((s) => ({ id: s.id, name: s.name, version: s.version, description: s.description, items: s.items, ...(s.problems.length ? { problems: s.problems } : {}) })),
    // A set the hospital configured badly is REPORTED, not silently absent from the list: a missing
    // set looks like a set nobody wrote, and somebody will write a second one.
    ...(sets.some((s) => !s.ok) ? { unusable: sets.filter((s) => !s.ok).map((s, i) => ({ index: i, error: s.error, detail: s.detail, problems: s.problems })) } : {}),
  };
}

/**
 * Resolves a set and a selection into the order requests the caller must then APPLY, one at a time,
 * through the ordinary ordering routes. Writes no order.
 *
 * ctx: { migration, sets, setId, patientId, encounterId, select?, actorDeps, recordDeps }
 */
async function prepareOrderSet(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", requests: [] };

  const setId = str(ctx.setId);
  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  if (!setId) return { ...base, ok: false, status: 422, error: "set_required", requests: [] };
  if (!patientId || !encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", requests: [] };

  const def = (Array.isArray(ctx.sets) ? ctx.sets : []).find((d) => d && str(d.id) === setId);
  if (!def) return { ...base, ok: false, status: 404, error: "set_not_found", setId, requests: [] };
  const resolved = resolveSet(def);
  if (!resolved.ok) return { ...base, ok: false, status: 422, error: resolved.error, detail: resolved.detail, problems: resolved.problems, requests: [] };

  const { selected, unknown, deselected } = selectionFrom(resolved, ctx.select);
  /* An item asked for that the set does not contain is REFUSED, and the whole preparation with it.
   * This is the case where the set changed between being read and being applied, and ordering
   * something the clinician never saw on their screen is exactly what must not happen. */
  if (unknown.length) {
    return { ...base, ok: false, status: 409, error: "not_in_set", detail: "these were not in the set as it stands now; re-read it", unknown, setVersion: resolved.version, requests: [] };
  }
  if (!selected.length) return { ...base, ok: false, status: 422, error: "nothing_selected", requests: [] };

  return {
    ...base, ok: true,
    setId: resolved.id, setName: resolved.name, setVersion: resolved.version,
    requests: requestsFor(selected, { patientId, encounterId }),
    deselected,
    /* Said on every response, because the whole safety argument depends on the caller doing it: the
     * requests below are NOT orders. Each one still goes through the ordinary ordering route and
     * gets the ordinary checks. */
    note: "These are order REQUESTS, not orders. Apply each through the ordinary ordering route so it "
      + "gets the same safety checks as a hand-written order. Nothing here has been ordered.",
  };
}

/**
 * Records that a set was applied, and exactly what landed and what did not.
 * ctx: { migration, setId, setName, setVersion, patientId, encounterId, applied, failed,
 *        deselected, actorDeps, recordDeps }
 */
async function recordApplication(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId), setId = str(ctx.setId);
  if (!patientId || !encounterId || !setId) return { ...base, ok: false, status: 422, error: "set_and_encounter_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const appliedAt = new Date().toISOString();
  const id = applicationIdFor(encounterId, setId, appliedAt);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const rec = OrderSetApplication({
    id, patientId, encounterId, setId,
    setName: str(ctx.setName) || null, setVersion: str(ctx.setVersion) || null,
    applied: Array.isArray(ctx.applied) ? ctx.applied : [],
    failed: Array.isArray(ctx.failed) ? ctx.failed : [],
    deselected: Array.isArray(ctx.deselected) ? ctx.deselected : [],
    appliedBy: resolved.actor.id, appliedAt,
  });
  try {
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, applicationId: id,
      setId, setVersion: rec.setVersion, appliedCount: rec.applied.length, failedCount: rec.failed.length,
      /* PARTIAL APPLICATION IS LOUD. Silently applying seven of eight is the failure mode that makes
       * order sets dangerous, because the missing one is invisible in a chart full of new orders. */
      ...(rec.failed.length ? { partial: true, failed: rec.failed } : {}),
      version: out.record.version, actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

export {
  TYPE, KINDS, OrderSetApplication, applicationIdFor,
  resolveSet, selectionFrom, requestsFor,
  listOrderSets, prepareOrderSet, recordApplication,
};
