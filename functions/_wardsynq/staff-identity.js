/* functions/_wardsynq/staff-identity.js - who did something on a chart, as the ward reads it.
 *
 * Owner 2026-09-16: "so everyone knows who gave the drugs who asked to give". Every record keeps the id its writer
 * signed in with ("cfa:<hash>", "fb:<uid>", a staff sign-in ID, an email); that id stays the audit key and is never
 * rewritten. This turns an id into the staff member of THIS hospital it belongs to, and then into the only three
 * things a clinical reader is shown: the name the hospital recorded, its employee id, and the role.
 *
 * One lookup for two readers: GET /ward/actor-names (the audit screen, staff.admin) and GET /ward/staff-identities
 * (every chart screen). An id that is nobody at this hospital resolves to nothing; it is never looked up elsewhere.
 * A mobile number, an email or an account id is never returned as a name or an employee id.
 */
import { notAName } from "../_opd_org.js";

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * ids -> Map(id -> member | null), against this hospital's members only.
 * members: ORG.listMembers(orgId) (disabled members included: a nurse who left still gave last month's doses).
 * dir: { accountEmail(id) -> email|null, accessIdOf(email) -> "cfa:<hash>", getMember(identity) -> member|null }.
 * getMember is the direct read for an id the listing did not include (the listing is capped). Never throws for one
 * id: a lookup that fails leaves that id unresolved.
 */
async function membersForIds(members, ids, dir) {
  const byKey = new Map();
  for (const m of members || []) for (const k of [m.identity, m.email]) if (k) byKey.set(String(k).toLowerCase(), m);
  const out = new Map();
  let accessIds = null;
  for (const id of ids) {
    let m = byKey.get(id.toLowerCase()) || null;
    if (!m && id.indexOf("fb:") === 0 && dir.accountEmail) {
      const email = await dir.accountEmail(id).catch(() => null);
      if (email) m = byKey.get(email) || (dir.getMember ? await dir.getMember(email).catch(() => null) : null);
    }
    if (!m && id.indexOf("cfa:") === 0 && dir.accessIdOf) {
      if (!accessIds) {
        accessIds = new Map();
        for (const x of members || []) {
          const e = [x.email, x.identity].find((v) => /@/.test(String(v || "")));
          if (e) accessIds.set(await dir.accessIdOf(e), x);
        }
      }
      m = accessIds.get(id) || null;
    }
    if (!m && dir.getMember) m = await dir.getMember(id).catch(() => null);
    out.set(id, m || null);
  }
  return out;
}

/** PURE. The fields a chart reader may see for a member, or null for nobody here. An employee id falls back to the
 * staff sign-in ID the hospital chose ("nurse1"), never to an email, a mobile number or an account id. */
function staffIdentity(m) {
  if (!m) return null;
  const name = str(m.displayName) && !notAName(m.displayName) ? str(m.displayName) : null;
  const ident = str(m.identity);
  const employeeId = str(m.employeeId) || (ident && !notAName(ident) ? ident : "") || null;
  return { name, employeeId, role: str(m.role) || null };
}

/** PURE. "?ids=a,b,c" -> distinct ids, at most `max`. */
function idsParam(raw, max) {
  return [...new Set(String(raw || "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, max);
}

export { membersForIds, staffIdentity, idsParam };
