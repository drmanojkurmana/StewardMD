/* functions/_wardsynq/fhir-group.js - FHIR Group, defined narrowly: the patients on one ward NOW.
 *
 * WardSynQ has no patient-group resource. A bulk client asking for Group/{id}/$export wants a cohort,
 * and the one cohort this record genuinely holds is the ward census: every patient with an open
 * (in-progress) Encounter whose location is that ward. So a Group here is exactly that and nothing
 * else - not a registry, not a research cohort, not a list anybody maintains.
 *
 * DERIVED, NEVER STORED. A Group is computed from the Encounters the reader may see, through the same
 * governed roster read a search uses. Membership is the census at the moment of reading (actual: true),
 * and a bulk export freezes the member list at kick-off, so the export is the ward as it stood when it
 * was asked for.
 *
 * THE ID IS A HASH OF THE WARD NAME (ward-<16 hex>), because a ward name is free text and a FHIR id is
 * [A-Za-z0-9.-]{1,64}. The name travels as Group.name.
 *
 * NOTHING IS PRETENDED COMPLETE. The census is every open encounter (service.listByStatus, R4-2; it used to be the
 * OLDEST SEARCH_POOL encounters of every status, so a new admission was in no Group). More open encounters than the
 * open-census ceiling refuses the census (422 too-costly) rather than state part of a ward as the ward.
 */

import { open, operationOutcome } from "./fhir.js";
import { ListCeilingError } from "./service.js";
import { fhirId, sha256Hex } from "./fhir-id.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** PURE. The Group id for a ward name. */
const groupIdFor = (ward) => `ward-${sha256Hex(str(ward).toLowerCase()).slice(0, 16)}`;

/** PURE. The census from encounter rows: Map groupId -> { ward, patientIds:Set }. */
function censusOf(encounters) {
  const groups = new Map();
  for (const e of encounters || []) {
    if (!e || str(e.status) !== "in-progress" || !str(e.patientId)) continue;
    const ward = str(e.location && e.location.ward);
    if (!ward) continue;
    const id = groupIdFor(ward);
    if (!groups.has(id)) groups.set(id, { id, ward, patientIds: new Set() });
    groups.get(id).patientIds.add(str(e.patientId));
  }
  return groups;
}

/** PURE. One census group as an R4 Group. */
function fhirGroup(g) {
  const members = [...g.patientIds].sort();
  return {
    resourceType: "Group", id: g.id, type: "person", actual: true,
    name: g.ward,
    code: { text: "Patients with an open encounter on this ward" },
    quantity: members.length,
    ...(members.length ? { member: members.map((p) => ({ entity: { reference: `Patient/${fhirId(p)}` } })) } : {}),
  };
}

/**
 * The census, read as the requester. Returns { groups } or { error: { status, outcome } }.
 * ctx: { migration, actorDeps, recordDeps, actorOverride? }
 */
async function readCensus(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { error: { status: 404, outcome: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") } };
  const { svc, error } = await open(request, env, ctx);
  if (error) return { error: { status: error.status, outcome: operationOutcome("error", error.status === 401 ? "login" : "forbidden", error.detail || error.error) } };
  let rows;
  try { rows = await svc.listByStatus("Encounter", ["in-progress"]); }
  catch (e) {
    if (e instanceof ListCeilingError) return { error: { status: 422, outcome: operationOutcome("error", "too-costly", `more than ${e.max} encounters are open, so no ward membership can be stated as complete; use Patient/$export with _type and _since`) } };
    return { error: { status: 403, outcome: operationOutcome("error", "forbidden", `a Group is the ward census, which needs Encounter read: ${str(e && e.message)}`) } };
  }
  return { groups: censusOf(rows) };
}

/** GET Group and Group/{id}. Returns { obj, status } like dispatchRead. */
async function groups(request, env, ctx, url) {
  const c = await readCensus(request, env, ctx);
  if (c.error) return { obj: c.error.outcome, status: c.error.status };
  const id = str(ctx.id);
  if (id) {
    const g = c.groups.get(id);
    if (!g) return { obj: operationOutcome("error", "not-found", "no such Group: a Group here is a ward with at least one open encounter"), status: 404 };
    return { obj: fhirGroup(g), status: 200 };
  }
  for (const k of url.searchParams.keys()) {
    if (!["orgId", "_format", "name"].includes(k)) return { obj: operationOutcome("error", "not-supported", `${k} is not a Group search parameter this server supports (name only)`), status: 400 };
  }
  const name = str(url.searchParams.get("name")).toLowerCase();
  const list = [...c.groups.values()].filter((g) => !name || g.ward.toLowerCase().includes(name)).sort((a, b) => a.ward.localeCompare(b.ward)).map(fhirGroup);
  const entry = list.map((r) => ({ fullUrl: `${str(ctx.base)}/Group/${r.id}`, resource: r, search: { mode: "match" } }));
  return { obj: { resourceType: "Bundle", type: "searchset", total: list.length, entry }, status: 200 };
}

/**
 * The member patient ids of one Group, for a bulk kick-off. Refuses a capped census: exporting part of
 * a ward while calling it the ward is the silent omission the export promises never to make.
 * Returns { ward, patientIds } or { error: { status, outcome } }.
 */
async function groupMembers(request, env, ctx, groupId) {
  const c = await readCensus(request, env, ctx);
  if (c.error) return c;
  const g = c.groups.get(str(groupId));
  if (!g) return { error: { status: 404, outcome: operationOutcome("error", "not-found", "no such Group: a Group here is a ward with at least one open encounter") } };
  return { ward: g.ward, patientIds: [...g.patientIds].sort() };
}

export { groupIdFor, censusOf, fhirGroup, groups, groupMembers };
