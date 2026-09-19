/* functions/_wardsynq/advisory-authoring.js - checking a hospital's rules before its ward runs them.
 *
 * advisories.js let a hospital write its own advice and made it structurally unable to block. What
 * it did not give anyone was a way to find out what a rule DOES before a ward is running it, and
 * domain 6 has carried "no rule-pack authoring UI" ever since. The missing half was never a form -
 * a hospital can already put rules in its config - it was the check.
 *
 * TWO THINGS RUIN A RULE PACK, AND A FORM PREVENTS NEITHER:
 *
 *   A RULE THAT NEVER FIRES. A typo in a drug name or a threshold produces a rule that is simply
 *   silent. Nobody notices, because nothing happens, and the hospital believes it has a safety net
 *   it does not have. This is the failure mode a validator alone misses: the rule is well-formed.
 *
 *   A RULE THAT FIRES ON EVERYTHING. Alert fatigue is the characteristic failure of CDSS
 *   (override-analytics.js exists because of it), and a hospital that can author advisories WILL
 *   author too many. A rule that would have fired on most of last month's orders is not a safety
 *   improvement; it is one more box a prescriber learns to click through, and it makes the rules
 *   either side of it less effective too.
 *
 * SO THE CHECK IS A DRY RUN AGAINST THE HOSPITAL'S OWN RECENT ORDERS. Not a synthetic example: a
 * rule's behaviour depends entirely on what this hospital actually prescribes, and a sample built
 * from invented data would tell an author what their rule does in a hospital that does not exist.
 *
 * IT CHANGES NOTHING. This writes no configuration and activates nothing. The rules come in on the
 * request, are compiled, are run against a read-only sample, and the answer goes back. Making the
 * check the same act as the deployment would mean the only way to find out what a rule does is to
 * ship it, which is exactly the situation this closes.
 *
 * IT REPORTS. IT DOES NOT REFUSE. A rule that fires on everything might be right - "every
 * intravenous antibiotic needs a review date" is meant to fire constantly. So the numbers are
 * reported and named, and a human decides. A validator that rejected a rule on its firing rate
 * would be a software engineer overruling a clinical decision it cannot see the reason for.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { compileAdvisories, evaluateAdvisories } from "./advisories.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** How many recent orders a dry run is measured against. */
const SAMPLE = 200;

/** Above this share of the sample, a rule is reported as firing on nearly everything. */
const NOISY_AT = 0.5;

/** Below this many firings, a rule is reported as having fired on nothing in the sample. */
const SILENT_AT = 1;

/**
 * PURE. What a dry run means, per rule.
 *
 * `counts` is ruleId -> firings; `sampleSize` is how many orders were tried. Every rule in the pack
 * appears, including the ones that fired nothing - a rule missing from the report is exactly the
 * rule an author most needs to see.
 */
function readDryRun(rules, counts, sampleSize) {
  const n = Number(sampleSize) || 0;
  return (rules || []).map((r) => {
    const fired = Number((counts || {})[r.id]) || 0;
    /* Null, never zero, when there was nothing to try. "It fired on none of 200 orders" and "there
     * were no orders" are different facts and only one of them is about the rule. */
    const share = n > 0 ? Math.round((fired / n) * 100) / 100 : null;
    const row = { id: r.id, message: r.message, level: r.level, fired, sampleSize: n, share };

    if (n === 0) {
      row.reading = "There were no recent orders to try this against, so nothing is known about what it would do.";
      return row;
    }
    if (fired < SILENT_AT) {
      /* The failure a validator misses: the rule is well-formed and simply silent, and nobody
       * notices because nothing happens. */
      row.silent = true;
      row.reading = `This rule fired on NONE of the last ${n} orders. It may be correct and rare, or its drug name or threshold may not match anything this hospital actually prescribes. A rule that never fires is a safety net that is not there.`;
      return row;
    }
    if (share >= NOISY_AT) {
      row.noisy = true;
      row.reading = `This rule fired on ${fired} of the last ${n} orders (${Math.round(share * 100)}%). That may be intended, and it may also be one more box a prescriber learns to click through - which makes the rules either side of it less effective too.`;
      return row;
    }
    row.reading = `Fired on ${fired} of the last ${n} orders.`;
    return row;
  });
}

async function open_(request, env, ctx, need) {
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

/**
 * Compiles a draft advisory set and reports what it would have done.
 * ctx: { migration, advisories, now? }
 */
async function checkAdvisories(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", rules: [] };

  const draft = Array.isArray(ctx.advisories) ? ctx.advisories : null;
  if (!draft) return { ...base, ok: false, status: 422, error: "advisories_required", detail: "send the advisory list to check", rules: [] };

  /* The SAME compiler the live path uses. A separate validator would be a second opinion about what
   * a valid rule is, and the two would disagree the first time either changed - so an author would
   * be told a rule is fine by the checker and have it silently dropped by the engine. */
  const compiled = compileAdvisories(draft);

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, rules: [] };

  let orders = [], patients = new Map();
  try {
    orders = (await svc.list("MedicationOrder", SAMPLE).catch(() => []) || []).filter(Boolean);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), rules: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), rules: [] };
  }

  /* The problem list per patient, read once. An advisory can condition on a diagnosis, and running
   * the sample without one would make every such rule look silent for a reason that is about this
   * check rather than about the rule. */
  const ids = [...new Set(orders.map((o) => str(o.patientId)).filter(Boolean))];
  await Promise.all(ids.map(async (pid) => {
    const rows = await svc.byPatient("Condition", pid).catch(() => []);
    patients.set(pid, (rows || []).filter(Boolean));
  }));

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const counts = {};
  for (const o of orders) {
    let fired;
    try {
      fired = evaluateAdvisories({
        compiled, drug: o.drug || o.drugCode,
        problems: patients.get(str(o.patientId)) || [],
        observations: [], nowMs,
      });
    } catch (_) { continue; }
    // evaluateAdvisories returns a plain array of the advisories that fired.
    for (const f of Array.isArray(fired) ? fired : []) {
      const id = str(f && f.id);
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
  }

  const rows = readDryRun(compiled.rules, counts, orders.length);
  const silent = rows.filter((r) => r.silent).length;
  const noisy = rows.filter((r) => r.noisy).length;

  return {
    ...base, ok: true,
    accepted: compiled.rules.length,
    /* The compiler's own problems, unchanged. A rule dropped by the engine and not reported here
     * would be a rule an author believes they have. */
    rejected: compiled.problems || [],
    rules: rows,
    sampleSize: orders.length,
    ...(orders.length === 0 ? {
      sampleWarning: "There are no recent orders to try these rules against, so this report says nothing about what they would do. It has checked only that they are well-formed.",
    } : {}),
    ...(silent ? { silentCount: silent } : {}),
    ...(noisy ? { noisyCount: noisy } : {}),
    /* Reported, never refused. "Every intravenous antibiotic needs a review date" is MEANT to fire
     * constantly, and a checker that rejected it would be overruling a clinical decision it cannot
     * see the reason for. */
    note: "Nothing has been saved and nothing is active: this compiles the rules and reports what they would have done against recent orders. A rule that fires on everything may still be right, and a rule that fires on nothing may still be correct and rare - both are reported so a person can decide.",
    activation: "To use these rules, set them as wardsynq.advisories. An advisory can never block an order, whatever it says.",
  };
}

export { SAMPLE, NOISY_AT, SILENT_AT, readDryRun, checkAdvisories };
