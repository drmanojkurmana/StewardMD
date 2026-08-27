/* StewardMD — tenant (medical college) provisioning. PLATFORM-OWNER ONLY.
 * ---------------------------------------------------------------------------
 *   GET  /api/tenants                       -> every institution + its admins
 *   POST /api/tenants        { name, adminEmail, withPassword? }
 *                                           -> create the college and provision its admin
 *   POST /api/tenants/password { orgId, identity }
 *                                           -> issue a fresh generated password
 *
 * WHY THIS EXISTS. Every piece was already here — createOrg, setMembership, setMemberPassword, and
 * an email+password login that mints a staff session — but nothing joined them up, so a college
 * could only be created by the customer themselves, from inside the app, with no way to hand over
 * credentials. This is the one owner-gated seam that makes StewardMD sellable to an institution.
 *
 * OWNERSHIP: the college admin becomes the org's OWNER, not merely a member. They asked for "full
 * controls", and ownership is what survives them later removing their own membership by accident.
 * The consequence is real and deliberate: `authorizeOrgAccess` knows only org-owner and membership,
 * so StewardMD staff canNOT read a tenant's clinical data through the org routes. Support means
 * re-provisioning through this route, not reading their records.
 *
 * TWO LOGINS, DIFFERENT REACH — the thing to not get wrong:
 *   Google (Firebase) reaches EVERYTHING, including the eLOGBook console, because
 *     functions/api/pglog/[[path]].js authenticates with verifyFirebaseToken() only.
 *   The generated password mints a STAFF SESSION (POST /api/queue/auth/email), which reaches the
 *     OPD/queue surfaces and NOT the logbook.
 *   So the password is a convenience for clinic staff, and the admin still signs in with Google for
 *   the logbook. Anything else would mean widening the auth surface of the module that carries the
 *   PGMER-2023 9.2(c) signing guarantees. Owner decision, 2026-08-27.
 */
import { ownerOK } from "../../_adminauth.js";
import * as ORG from "../../_opd_org_store.js";
import { lookupUidByEmail } from "../../_fbadmin.js";

const json = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

/* No O/0 and no I/1/l: this password is read off one screen and typed on a phone, and an ambiguous
 * glyph turns into a support ticket. 3 groups of 4 from a 56-char alphabet is ~69 bits. */
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function genPassword(groups, len) {
  groups = groups || 3; len = len || 4;
  const b = new Uint32Array(groups * len);
  crypto.getRandomValues(b);
  const out = [];
  for (let g = 0; g < groups; g++) {
    let s = "";
    for (let i = 0; i < len; i++) s += ALPHABET.charAt(b[g * len + i] % ALPHABET.length);
    out.push(s);
  }
  return out.join("-");
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const method = request.method;

  if (!(await ownerOK(request, env))) return json({ error: "unauthorised" }, 401);

  let body = {};
  if (method === "POST") { try { body = (await request.json()) || {}; } catch (e) { body = {}; } }

  // ── list every institution, with whoever administers it ──
  if (method === "GET" && !seg) {
    let orgs = [];
    try { orgs = await ORG.listAllOrgs(env, 300); }
    catch (e) { return json({ error: "list_failed", detail: String((e && e.message) || e) }, 500); }
    const out = [];
    for (const o of orgs) {
      let admins = [];
      try {
        admins = (await ORG.listMembers(env, o.id))
          .filter((m) => m.role === "admin" || m.role === "academic_cell")
          .map((m) => ({ identity: m.identity, role: m.role, email: m.email, active: m.active, hasPin: m.hasPin }));
      } catch (e) { admins = []; }
      out.push({ id: o.id, code: o.code, name: o.name, mode: o.mode, ownerUid: o.ownerUid, createdAt: o.createdAt, admins });
    }
    return json({ ok: true, tenants: out });
  }

  // ── create a college and provision its admin ──
  if (method === "POST" && !seg) {
    const name = String(body.name || "").trim();
    const email = String(body.adminEmail || "").trim().toLowerCase();
    if (!name) return json({ error: "name_required" }, 400);
    if (!email) return json({ error: "admin_email_required" }, 400);

    // The admin must already have a StewardMD account, because ownership is keyed on the Firebase
    // uid. Naming the email is the difference between a fixable message and a mystery.
    let uid = null;
    try { uid = await lookupUidByEmail(env, email); } catch (e) { uid = null; }
    if (!uid) return json({ error: "no_such_account", email }, 404);
    const identity = "fb:" + uid;

    const org = await ORG.createOrg(env, { name, mode: "native" }, identity);
    await ORG.setMembership(env, org.id, identity, { role: "admin" }, identity);

    // Optional, and returned exactly once — it is only ever stored salted+hashed.
    let password = null;
    if (body.withPassword) {
      password = genPassword();
      await ORG.setMemberPassword(env, org.id, identity, email, password, identity);
    }
    return json({
      ok: true,
      tenant: { id: org.id, code: org.code, name: org.name },
      admin: { identity, email },
      password,
      note: "Share the institution code with the college. The admin signs in with Google for the eLOGBook console; the password reaches the OPD/queue surfaces only.",
    });
  }

  // ── re-issue a password (lost credentials) ──
  if (method === "POST" && seg === "password") {
    const orgId = String(body.orgId || "");
    const identity = String(body.identity || "");
    if (!orgId || !identity) return json({ error: "bad_args" }, 400);
    const org = await ORG.getOrg(env, orgId);
    if (!org) return json({ error: "org_not_found" }, 404);
    const member = await ORG.getMembership(env, orgId, identity);
    if (!member) return json({ error: "not_a_member" }, 404);
    const email = String(body.email || member.email || "").trim().toLowerCase();
    if (!email) return json({ error: "email_required" }, 400);
    const password = genPassword();
    await ORG.setMemberPassword(env, orgId, identity, email, password, identity);
    return json({ ok: true, identity, email, password });
  }

  return json({ error: "not-found", seg }, 404);
}
