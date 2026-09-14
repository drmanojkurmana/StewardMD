/* functions/_wardsynq/hospital-group.js — P2.14: one member hospital's operational counts, for its group.
 *
 * ONLY NUMBERS LEAVE THIS FILE. The return value is built field by field from a fixed list of counts;
 * nothing read here (a patient id, a name, an MRN, a record id, a ward or bed label) is ever copied
 * into it, and the test pins that by seeding identifiable data and searching the response for it.
 * vault/decisions/Decisions.md records why a group sees counts and nothing else.
 *
 * EACH COUNT IS THE HOSPITAL'S OWN COMPUTATION, READ IN ITS OWN TENANT. The counting is not redone
 * here: census and open critical results are summariseWard() (ward-metrics.js), free beds are
 * bedStateCounts() (patient-flow.js) over the hospital's own bed master, ED waiting is listEd()'s own
 * filter (migrate-ed.js: an ED encounter still in progress), and staff short is rosterStaffing()
 * (digital-twin.js). The repository is the member hospital's, resolved from ITS org document, never a
 * tenant id a caller supplied. The authority to read it is the hospital owner's acceptance of the
 * group, re-checked by the router on every call, the same no-user service read ops-tick.js makes for
 * escalation. It never goes through a clinical actor, so the group admin gains no chart access.
 *
 * NOT READ IS NOT ZERO. A count that could not be read is null with the reason "could_not_be_read"; a
 * count the hospital has not set up (no bed list, no roster) is null with "not_set_up". A hospital with
 * no count readable at all is status "unreadable", and the screen says so in words.
 */

import { summariseWard } from "./ward-metrics.js";
import { bedStateCounts } from "./patient-flow.js";

const SCAN = 1000;
export const COUNT_KEYS = Object.freeze(["census", "bedsFree", "edWaiting", "criticalOpen", "staffShort"]);

/** PURE. The projection: a fixed set of numbers and reason codes. Exported for the test. */
export function projectCounts(parts) {
  const p = parts || {};
  const counts = {}, reasons = {};
  const put = (k, v, reason) => { counts[k] = Number.isFinite(v) ? v : null; if (!Number.isFinite(v)) reasons[k] = reason || "could_not_be_read"; };
  if (p.encounters) {
    const m = summariseWard({ encounters: p.encounters, criticalLoops: p.criticalLoops || [] });
    put("census", m.patients);
    put("edWaiting", p.encounters.filter((e) => e && e.class === "ED" && e.status === "in-progress").length);
    put("criticalOpen", p.criticalLoops ? m.open.criticalResults : null);
  } else {
    put("census", null); put("edWaiting", null);
    put("criticalOpen", p.criticalLoops ? summariseWard({ criticalLoops: p.criticalLoops }).open.criticalResults : null);
  }
  const activeBeds = p.beds ? p.beds.filter((b) => b && b.active !== false) : null;
  if (!activeBeds) put("bedsFree", null);
  else if (!activeBeds.length) put("bedsFree", null, "not_set_up");
  else put("bedsFree", bedStateCounts(activeBeds).available);
  const s = p.staffing;
  if (!s || s.ok !== true) put("staffShort", null);
  else if (!s.rosterConfigured) put("staffShort", null, "not_set_up");
  else put("staffShort", (s.gaps || []).reduce((n, g) => n + (Number(g && g.short) || 0), 0));
  const read = COUNT_KEYS.filter((k) => counts[k] !== null || reasons[k] === "not_set_up").length;
  return {
    status: read === COUNT_KEYS.length ? "ok" : read === 0 ? "unreadable" : "partial",
    counts, reasons, capped: !!p.capped,
  };
}

/**
 * deps: { repository, tenantId, listBeds(), staffing() } - every one of them the member hospital's own.
 * No tenant means this hospital keeps no WardSynQ record; that is "unreadable", never a row of zeros.
 */
export async function hospitalCounts(deps) {
  const d = deps || {};
  if (!d.repository || !d.tenantId) return { ...projectCounts({}), status: "unreadable", why: "no_wardsynq_record" };
  const safe = (fn) => Promise.resolve().then(fn).catch(() => null);
  const [encounters, criticalLoops, beds, staffing] = await Promise.all([
    safe(() => d.repository.latestByType(d.tenantId, "Encounter", SCAN)),
    safe(() => d.repository.latestByType(d.tenantId, "CriticalResultLoop", SCAN)),
    safe(() => d.listBeds()),
    safe(() => d.staffing()),
  ]);
  const capped = (encounters && encounters.length >= SCAN) || (criticalLoops && criticalLoops.length >= SCAN);
  return projectCounts({ encounters, criticalLoops, beds, staffing, capped });
}
