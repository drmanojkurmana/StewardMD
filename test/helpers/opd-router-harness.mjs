/* test/helpers/opd-router-harness.mjs - the real /api/queue router over an in-memory Firestore, for the OPD
 * route tests (opd-dept-token-routes, queue-no-show-recall, org-clinical-settings, seed-signoff, group
 * snapshots). Same commit semantics as test/neg-auth-org-members.test.mjs: a failed precondition fails the
 * whole commit and applies nothing. Import this BEFORE anything that imports the router.
 *
 * Callers: api(path, method, body, who) where who is an email (a StewardMD account, identified by the
 * Cloudflare Access header), { staff: token } (a PIN staff session, see staffToken), or nothing (no session).
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { mock } from "node:test";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

export const docs = new Map();
let clock = 1;
export const fail = { commits: false };
mock.module("../../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/") || path.indexOf("/", coll.length + 1) >= 0) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      if (fail.commits) throw Object.assign(new Error("fs_commit_failed"), { status: 503 });
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
        if (cd && cd.exists === true && !cur) throw Object.assign(new Error("missing"), { code: "precondition" });
        if (cd && cd.updateTime && (!cur || cur.updateTime !== cd.updateTime)) throw Object.assign(new Error("stale"), { code: "precondition" });
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields, opts) => {
      const w = { update: { name: path, fields } };
      if (opts && opts.updateTime) w.currentDocument = { updateTime: opts.updateTime };
      else if (opts && opts.exists === true) w.currentDocument = { exists: true };
      return w;
    },
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

export const ORG = await import("../../functions/_opd_org_store.js");
const { onRequest } = await import("../../functions/api/queue/[[path]].js");

const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
export const uidFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
export const OWNER_A = "owner-a@example.test", OWNER_B = "owner-b@example.test", PLATFORM = "platform-owner@example.test";
export const HR_A = "hr-a@example.test", HR_B = "hr-b@example.test", NURSE_A = "nurse-a@example.test", VIEWER_A = "viewer-a@example.test", CASHIER_A = "cashier-a@example.test";
// Today (UTC), not a fixed date: a queue session expires at the end of its day, and the no-show recall window is refused after it.
export const DAY = new Date().toISOString().slice(0, 10);

export let ENV;
export function reset() {
  docs.clear(); clock = 1; fail.commits = false;
  ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), OWNER_EMAILS: PLATFORM };
}
export async function api(path, method, body, who) {
  const headers = { "Content-Type": "application/json" };
  if (typeof who === "string") headers["Cf-Access-Authenticated-User-Email"] = who;
  else if (who && who.staff) headers["X-Staff-Token"] = who.staff;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
export const org = (id, owner, extra) => docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id.toUpperCase().replace(/[^A-Z]/g, "").padEnd(6, "X").slice(0, 6), name: id, kind: "clinic", mode: "native", ownerUid: uidFor(owner), createdAt: 1, ...(extra || {}) }, updateTime: "t1" });
export const member = (orgId, email, role) => docs.set(`q_members/${sanitize(orgId)}__${sanitize(email)}`, { fields: { orgId, identity: email, role, active: true, createdAt: 1 }, updateTime: "t1" });
export const dept = (id, orgId, name, code) => docs.set(`q_departments/${id}`, { fields: { id, orgId, name, code: code || "", type: "general", active: true }, updateTime: "t1" });
/* Two hospitals. A: owner, hr (staff.admin), nurse, viewer, cashier, two departments. B: its own admin. */
export function seed(tokens) {
  reset();
  org("org-a", OWNER_A, tokens ? { tokens } : {});
  org("org-b", OWNER_B);
  member("org-a", HR_A, "hr"); member("org-a", NURSE_A, "nurse"); member("org-a", VIEWER_A, "viewer"); member("org-a", CASHIER_A, "cashier");
  member("org-b", HR_B, "admin");
  dept("dcard", "org-a", "Cardiology", "CAR"); dept("dmed", "org-a", "General Medicine", "GM");
  dept("dtheirs", "org-b", "Their Cardiology", "TC");
}
/* A PIN staff session for `identity` with `role` in `orgId`: the way desk and ward staff sign in, and the
 * only kind of session that can act on a queue session other than a doctor's own. */
const PINS = ["4826", "7391", "5937", "6148", "2759", "8364"];
let pinN = 0;
export async function staffToken(orgId, identity, role) {
  const pin = PINS[pinN++ % PINS.length];
  await ORG.setMembership(ENV, orgId, identity, { role }, "seed");
  const set = await ORG.setMemberPin(ENV, orgId, identity, pin, "seed");
  if (!set.ok) throw new Error("pin not set: " + JSON.stringify(set));
  const r = await api("/auth/pin", "POST", { orgId, identity, pin });
  if (!r.token) throw new Error("no staff token: " + JSON.stringify(r));
  return { staff: r.token };
}
