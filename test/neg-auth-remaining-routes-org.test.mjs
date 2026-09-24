/* test/neg-auth-remaining-routes-org.test.mjs — negative-authorization coverage for the remaining
 * routes that scripts/wardsynq-reachability.mjs listed as untested and that sit OUTSIDE the WardSynQ
 * clinical record store: GET+POST /bill/tariff, POST /bill/invoice, POST /bill/dispense, GET /bill/shift,
 * POST /room/update, POST /session/status, POST /org/from-connect, GET /mfa/status.
 *
 * For each route: (1) no session -> 401, (2) a signed-in member without the capability -> 403 (and
 * nothing written, for writes), (3) a member of a DIFFERENT hospital -> refused, (4) the correct role
 * succeeds and a meaningful property of the response is asserted, not just the 200 - except where the
 * route's own documented behaviour is narrower or wider than that shape, which is called out and
 * tested as written (mfa/status is a staff-only, self-scoped route with no orgId/identity to misuse;
 * org/from-connect requires a StewardMD account and is not org-scoped at all, since it MINTS a new org).
 *
 * Same harness as test/queue-orgs-onboard.test.mjs: `_fbfirestore.js` faked in-memory, a small
 * in-memory CONNECT_DB double, `mintStaffSession` for PIN-bound staff sessions, the router run for
 * real via `onRequest`. No `_wardsynq/deps.js` mock: none of these routes touch the RecordService.
 *
 * node --test --experimental-test-module-mocks test/neg-auth-remaining-routes-org.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) continue;
        const cur = docs.get(w.update.name), cd = w.currentDocument;
        if (cd && cd.exists === false && cur) throw Object.assign(new Error("exists"), { code: "precondition" });
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

/* CONNECT_DB double: only exercised here by nothing (no onboarding in this file) - present only
 * because the router imports selfCreateTenant at module scope; the reachability suite's own
 * queue-orgs-onboard.test.mjs shows an empty double is enough for the module to load. */
const connectDb = () => ({ prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }), batch: async () => [] });

const { mintStaffSession, totpAt } = await import("../functions/_opd_auth.js");
const A = await import("../functions/_opd_auth.js");
const ORG = await import("../functions/_opd_org_store.js");
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const uidFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);

const OWNER_A_EMAIL = "owner-orgb-a@example.test", OWNER_A = uidFor(OWNER_A_EMAIL);
const OWNER_B_EMAIL = "owner-orgb-b@example.test", OWNER_B = uidFor(OWNER_B_EMAIL);
const DOCTOR_A_EMAIL = "doctor-orgb-a@example.test";      // role "doctor": ORDER_CREATE, in ORG_A
const CASHIER_A_EMAIL = "cashier-orgb-a@example.test";    // role "cashier": BILLING_CHARGE/BILLING_VIEW, in ORG_A
const PHARMACY_A_EMAIL = "pharmacy-orgb-a@example.test";  // role "pharmacy": ORDER_DISPENSE, in ORG_A
const ADMIN_A_EMAIL = "admin-orgb-a@example.test";        // role "admin": STAFF_ADMIN, in ORG_A
const ADMIN_B_EMAIL = "admin-orgb-b@example.test";        // role "admin": STAFF_ADMIN, in ORG_B only
const CASHIER_B_EMAIL = "cashier-orgb-b@example.test";    // role "cashier", in ORG_B only

let ENV;
function reset() {
  docs.clear(); clock = 1;
  ENV = { QUEUE_ENABLED: "1", QUEUE_STAFF_ENABLED: "1", CLINIC_BILLING_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: connectDb() };
}

async function api(path, method, body, headers) {
  const res = await onRequest({
    request: new Request("https://x/api/queue" + path, {
      method: method || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    }),
    env: ENV,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const asFirebase = (email) => ({ "Cf-Access-Authenticated-User-Email": email });

function seedOrg(id, ownerUid, name) {
  docs.set(`q_orgs/${id}`, { fields: { id, code: "SMD-" + id.toUpperCase().slice(0, 6), name, kind: "clinic", mode: "native", ownerUid, createdAt: 1 }, updateTime: "t1" });
}
function seedMember(orgId, identity, role) {
  docs.set(`q_members/${sanitize(orgId)}__${sanitize(identity)}`, { fields: { orgId, identity, role, active: true, createdAt: 1 }, updateTime: "t1" });
}
function seedTwoHospitals() {
  reset();
  seedOrg("org-b-a", OWNER_A, "Bill Hospital A");
  seedOrg("org-b-b", OWNER_B, "Bill Hospital B");
  seedMember("org-b-a", DOCTOR_A_EMAIL, "doctor");
  seedMember("org-b-a", CASHIER_A_EMAIL, "cashier");
  seedMember("org-b-a", PHARMACY_A_EMAIL, "pharmacy");
  seedMember("org-b-a", ADMIN_A_EMAIL, "admin");
  seedMember("org-b-b", ADMIN_B_EMAIL, "admin");
  seedMember("org-b-b", CASHIER_B_EMAIL, "cashier");
}

/* ==================================================================================================
 * GET/POST /bill/tariff - billing.view (GET) / staff.admin (POST)
 * ================================================================================================== */

test("POST /bill/tariff: no session refused, wrong-role refused (nothing written), cross-hospital refused, admin creates the price, and cashier can read it back", async () => {
  seedTwoHospitals();
  const item = { orgId: "org-b-a", name: "OPD Consultation", code: "CONS", kind: "service", price: 50000 };

  const r401 = await api("/bill/tariff", "POST", item, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/bill/tariff", "POST", item, asFirebase(DOCTOR_A_EMAIL));
  assert.equal(r403.__status, 403, JSON.stringify(r403));
  const readAfter403 = await api("/bill/tariff?orgId=org-b-a", "GET", null, asFirebase(CASHIER_A_EMAIL));
  assert.equal(readAfter403.items.length, 0, "the wrong-role attempt wrote nothing");

  const rCross = await api("/bill/tariff", "POST", item, asFirebase(ADMIN_B_EMAIL));
  assert.ok(rCross.__status === 403 || rCross.__status === 404, JSON.stringify(rCross));

  const rOk = await api("/bill/tariff", "POST", item, asFirebase(ADMIN_A_EMAIL));
  assert.equal(rOk.__status, 200, JSON.stringify(rOk));

  const r401get = await api("/bill/tariff?orgId=org-b-a", "GET", null, {});
  assert.equal(r401get.__status, 401, JSON.stringify(r401get));
  const r403get = await api("/bill/tariff?orgId=org-b-a", "GET", null, asFirebase(DOCTOR_A_EMAIL));
  assert.equal(r403get.__status, 403, JSON.stringify(r403get));
  const rCrossGet = await api("/bill/tariff?orgId=org-b-a", "GET", null, asFirebase(CASHIER_B_EMAIL));
  assert.ok(rCrossGet.__status === 403 || rCrossGet.__status === 404, JSON.stringify(rCrossGet));
  const rOkGet = await api("/bill/tariff?orgId=org-b-a", "GET", null, asFirebase(CASHIER_A_EMAIL));
  assert.equal(rOkGet.__status, 200, JSON.stringify(rOkGet));
  assert.equal(rOkGet.items.length, 1);
  assert.equal(rOkGet.items[0].price, 50000);
});

/* ==================================================================================================
 * POST /bill/invoice - billing.charge (also exercises /bill/order = order.create and
 * /bill/pay = billing.charge, so the invoice raised here is a real, priced one, not a stub)
 * ================================================================================================== */

async function realBillableOrder(kind) {
  const tariff = await api("/bill/tariff", "POST", { orgId: "org-b-a", name: kind === "medication" ? "Paracetamol 500mg" : "OPD Consultation", code: kind === "medication" ? "PARA500" : "CONS", kind, price: 10000 }, asFirebase(ADMIN_A_EMAIL));
  assert.equal(tariff.__status, 200, JSON.stringify(tariff));
  const patient = await api("/bill/patient", "POST", { orgId: "org-b-a", name: "Bill Testcase", mobile: "9876500100", sex: "male", ageYears: 35 }, asFirebase(DOCTOR_A_EMAIL));
  assert.equal(patient.__status, 200, JSON.stringify(patient));
  const order = await api("/bill/order", "POST", { orgId: "org-b-a", patientId: patient.id, tariffId: tariff.id, qty: 1 }, asFirebase(DOCTOR_A_EMAIL));
  assert.equal(order.__status, 200, JSON.stringify(order));
  return { patientId: patient.id, orderId: order.id };
}

test("POST /bill/invoice: no session refused, wrong-role refused (nothing written), cross-hospital refused, cashier raises a real, priced invoice", async () => {
  seedTwoHospitals();
  const { patientId } = await realBillableOrder("service");

  const r401 = await api("/bill/invoice", "POST", { orgId: "org-b-a", patientId }, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/bill/invoice", "POST", { orgId: "org-b-a", patientId }, asFirebase(DOCTOR_A_EMAIL));
  assert.equal(r403.__status, 403, JSON.stringify(r403));

  const rCross = await api("/bill/invoice", "POST", { orgId: "org-b-a", patientId }, asFirebase(ADMIN_B_EMAIL));
  assert.ok(rCross.__status === 403 || rCross.__status === 404, JSON.stringify(rCross));

  const rOk = await api("/bill/invoice", "POST", { orgId: "org-b-a", patientId }, asFirebase(CASHIER_A_EMAIL));
  assert.equal(rOk.__status, 200, JSON.stringify(rOk));
  assert.equal(rOk.invoice.total, 10000);
  assert.equal(rOk.invoice.status, "open");

  // The wrong-role attempt really did write nothing: a second, correct-role invoice for the SAME
  // patient still finds one billable order, not two invoices' worth.
  const orderReadBack = await api(`/bill/orders?orgId=org-b-a&patientId=${patientId}&status=billed`, "GET", null, asFirebase(CASHIER_A_EMAIL));
  assert.equal(orderReadBack.orders.length, 1);
});

/* ==================================================================================================
 * POST /bill/dispense - order.dispense (a distinct authority from billing.charge - the person
 * handing over medicines is never the person who took the money, per billing.charge's own comment)
 * ================================================================================================== */

test("POST /bill/dispense: no session refused, wrong-role refused (nothing written), cross-hospital refused, pharmacy hands the medicine over only after payment", async () => {
  seedTwoHospitals();
  const { patientId, orderId } = await realBillableOrder("medication");
  const invoice = await api("/bill/invoice", "POST", { orgId: "org-b-a", patientId }, asFirebase(CASHIER_A_EMAIL));
  assert.equal(invoice.__status, 200, JSON.stringify(invoice));

  // Not yet paid: even the correct role is refused by the state machine, not by capability.
  const tooEarly = await api("/bill/dispense", "POST", { orgId: "org-b-a", orderId }, asFirebase(PHARMACY_A_EMAIL));
  assert.equal(tooEarly.error, "not_dispensable", JSON.stringify(tooEarly));

  const paid = await api("/bill/pay", "POST", { orgId: "org-b-a", invoiceId: invoice.invoice.id, method: "cash" }, asFirebase(CASHIER_A_EMAIL));
  assert.equal(paid.__status, 200, JSON.stringify(paid));

  const r401 = await api("/bill/dispense", "POST", { orgId: "org-b-a", orderId }, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/bill/dispense", "POST", { orgId: "org-b-a", orderId }, asFirebase(CASHIER_A_EMAIL));
  assert.equal(r403.__status, 403, JSON.stringify(r403));
  const stillPaid = await api(`/bill/orders?orgId=org-b-a&patientId=${patientId}&status=paid`, "GET", null, asFirebase(CASHIER_A_EMAIL));
  assert.equal(stillPaid.orders.length, 1, "the wrong-role attempt did not dispense it");

  const rCross = await api("/bill/dispense", "POST", { orgId: "org-b-a", orderId }, asFirebase(ADMIN_B_EMAIL));
  assert.ok(rCross.__status === 403 || rCross.__status === 404, JSON.stringify(rCross));

  const rOk = await api("/bill/dispense", "POST", { orgId: "org-b-a", orderId }, asFirebase(PHARMACY_A_EMAIL));
  assert.equal(rOk.__status, 200, JSON.stringify(rOk));
  assert.equal(rOk.ok, true);
  const dispensed = await api(`/bill/orders?orgId=org-b-a&patientId=${patientId}&status=dispensed`, "GET", null, asFirebase(CASHIER_A_EMAIL));
  assert.equal(dispensed.orders.length, 1);
});

/* ==================================================================================================
 * GET /bill/shift - billing.view (the day-end drawer report: today's paid invoices by tender). Read-only,
 * but it is money: the pharmacy role that hands medicines over must not see the takings.
 * ================================================================================================== */

test("GET /bill/shift: no session refused, pharmacy refused, cross-hospital refused, cashier reads today's takings by tender", async () => {
  seedTwoHospitals();
  const { patientId } = await realBillableOrder("medication");
  const invoice = await api("/bill/invoice", "POST", { orgId: "org-b-a", patientId }, asFirebase(CASHIER_A_EMAIL));
  assert.equal(invoice.__status, 200, JSON.stringify(invoice));
  const paid = await api("/bill/pay", "POST", { orgId: "org-b-a", invoiceId: invoice.invoice.id, method: "cash" }, asFirebase(CASHIER_A_EMAIL));
  assert.equal(paid.__status, 200, JSON.stringify(paid));

  const r401 = await api("/bill/shift?orgId=org-b-a", "GET", null, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/bill/shift?orgId=org-b-a", "GET", null, asFirebase(PHARMACY_A_EMAIL));
  assert.equal(r403.__status, 403, JSON.stringify(r403));

  const rCross = await api("/bill/shift?orgId=org-b-a", "GET", null, asFirebase(ADMIN_B_EMAIL));
  assert.ok(rCross.__status === 403 || rCross.__status === 404, JSON.stringify(rCross));

  const rOk = await api("/bill/shift?orgId=org-b-a", "GET", null, asFirebase(CASHIER_A_EMAIL));
  assert.equal(rOk.__status, 200, JSON.stringify(rOk));
  assert.equal(rOk.ok, true, JSON.stringify(rOk));
  assert.equal(rOk.count, 1, "the one paid invoice is counted");
  assert.ok(rOk.total > 0, "a paid invoice has a non-zero total");
  assert.equal(rOk.byMethod.cash, rOk.total, "and it is all cash");
  assert.equal(rOk.invoices.length, 1);
  assert.equal(rOk.invoices[0].paidMethod, "cash");
  assert.ok(!("patientId" in rOk.invoices[0]), "invoice rows carry no patient identity");
});

/* ==================================================================================================
 * POST /room/update - staff.admin
 * ================================================================================================== */

test("POST /room/update: no session refused, wrong-role refused (nothing written), admin renames their own room", async () => {
  seedTwoHospitals();
  const created = await api("/room", "POST", { orgId: "org-b-a", name: "Room 1", number: "1" }, asFirebase(ADMIN_A_EMAIL));
  assert.equal(created.__status, 200, JSON.stringify(created));

  const r401 = await api("/room/update", "POST", { orgId: "org-b-a", roomId: created.room.id, name: "Renamed" }, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/room/update", "POST", { orgId: "org-b-a", roomId: created.room.id, name: "Renamed" }, asFirebase(DOCTOR_A_EMAIL));
  assert.equal(r403.__status, 403, JSON.stringify(r403));
  const stillOriginal = await ORG.getRoom(ENV, created.room.id);
  assert.equal(stillOriginal.name, "Room 1");

  const rOk = await api("/room/update", "POST", { orgId: "org-b-a", roomId: created.room.id, name: "Renamed" }, asFirebase(ADMIN_A_EMAIL));
  assert.equal(rOk.__status, 200, JSON.stringify(rOk));
  assert.equal(rOk.room.name, "Renamed");
});

/* BUG (not fixed here, per instruction): unlike its two siblings on the very same routing block
 * (seg==="ward"&&sub==="update" and seg==="bed"&&sub==="update", both of which read the target row
 * first and refuse with 404 when `row.orgId !== body.orgId`), POST /room/update
 * (functions/api/queue/[[path]].js:3869) never checks that `roomId` actually belongs to `body.orgId`
 * before calling ORG.updateRoom(). azOrg(CAPS.STAFF_ADMIN, { roomId: body.roomId }) only checks that
 * the CALLER holds staff.admin in body.orgId (a pure scope check against the actor's OWN membership
 * scope) - it has no way to verify the room's true owner, and nothing else in the handler does
 * either. An admin of hospital B can rename, or deactivate, hospital A's room by id - just by
 * passing their OWN orgId (which they legitimately administer) alongside hospital A's roomId. */
test("POST /room/update should refuse to let an admin of a DIFFERENT hospital rename this room by naming it", async () => {
  seedTwoHospitals();
  const created = await api("/room", "POST", { orgId: "org-b-a", name: "Room 1", number: "1" }, asFirebase(ADMIN_A_EMAIL));
  assert.equal(created.__status, 200, JSON.stringify(created));

  const rCross = await api("/room/update", "POST", { orgId: "org-b-b", roomId: created.room.id, name: "Taken Over" }, asFirebase(ADMIN_B_EMAIL));
  assert.ok(rCross.__status === 403 || rCross.__status === 404, JSON.stringify(rCross));
  assert.equal((await ORG.getRoom(ENV, created.room.id)).name, "Room 1", "an admin of a different hospital must not be able to rename this room by naming it");
});

/* ==================================================================================================
 * POST /session/status - session.manage. Uses STAFF (PIN) sessions throughout, not Firebase: a
 * Firebase actor always resolves to the global role "doctor" or "admin" (functions/api/queue/
 * [[path]].js's resolveActor), which already holds session.manage, so Firebase cannot exercise the
 * "signed-in member without the capability" case for this specific route.
 * ================================================================================================== */

test("POST /session/status: no session refused, wrong-role refused, the session's own doctor pauses it", async () => {
  seedTwoHospitals();
  await ORG.setMembership(ENV, "org-b-a", "doc-sess", { role: "doctor" }, "owner");
  await ORG.setMembership(ENV, "org-b-a", "nurse-sess", { role: "nurse" }, "owner");
  const docToken = await mintStaffSession(ENV, "org-b-a", "doc-sess", Date.now());
  const nurseToken = await mintStaffSession(ENV, "org-b-a", "nurse-sess", Date.now());

  const created = await api("/session?hospitalId=org-b-a", "GET", null, { "X-Staff-Token": docToken });
  assert.equal(created.__status, 200, JSON.stringify(created));
  const sessionId = created.session.id;
  assert.equal(created.session.status, "active");

  const r401 = await api("/session/status", "POST", { sessionId, status: "paused" }, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/session/status", "POST", { sessionId, status: "paused" }, { "X-Staff-Token": nurseToken });
  assert.equal(r403.__status, 403, JSON.stringify(r403));

  const rOk = await api("/session/status", "POST", { sessionId, status: "paused" }, { "X-Staff-Token": docToken });
  assert.equal(rOk.__status, 200, JSON.stringify(rOk));
  assert.equal(rOk.session.status, "paused");
});

/* BUG (found while writing the cross-hospital case above, not fixed here): loadSessionFor
 * (functions/api/queue/[[path]].js:442-453) calls `json({...}, 404)` / `json({...}, 403)` in all
 * three of its refusal branches (lines 444, 447, 451) with NO THIRD ARGUMENT - json()'s own
 * corsHeaders(request) (line 314-317) then dereferences `request.headers` on an undefined `request`
 * and throws, which onRequest's outer handler turns into an unstructured 500 with the raw exception
 * message ("Cannot read properties of undefined (reading 'headers')") as the body's `error` field -
 * an internal detail a caller should never see. This is NOT "allows what it should refuse" - the
 * request is still refused, nothing is read or written - but it is every refusal path
 * loadSessionFor has (a missing sessionId, a Firebase doctor touching someone else's session, and a
 * staff session from another hospital), and loadSessionFor is shared by every session-scoped route
 * in this file: /ticket, /import, /import-from-source, /advance, /status, /priority, /move, /assign,
 * /revoke, /session/status and /timeline/extend - eleven routes, not just this one. */
test("POST /session/status: a staff session from a DIFFERENT hospital is cleanly refused, not crashed", async () => {
  seedTwoHospitals();
  await ORG.setMembership(ENV, "org-b-a", "doc-sess2", { role: "doctor" }, "owner");
  await ORG.setMembership(ENV, "org-b-b", "doc-sess2-b", { role: "doctor" }, "owner");
  const docToken = await mintStaffSession(ENV, "org-b-a", "doc-sess2", Date.now());
  const docBToken = await mintStaffSession(ENV, "org-b-b", "doc-sess2-b", Date.now());
  const created = await api("/session?hospitalId=org-b-a", "GET", null, { "X-Staff-Token": docToken });
  assert.equal(created.__status, 200, JSON.stringify(created));

  const rCross = await api("/session/status", "POST", { sessionId: created.session.id, status: "paused" }, { "X-Staff-Token": docBToken });
  assert.ok(rCross.__status === 403 || rCross.__status === 404, JSON.stringify(rCross));
});

/* ==================================================================================================
 * POST /org/from-connect - account_required (needs a StewardMD/Firebase account; mints a BRAND NEW
 * org linked to a Connect tenant, so it is not org-scoped like the routes above - there is no
 * existing org for a "wrong role" or "cross-hospital" attempt to misuse. A staff PIN session is
 * refused for the same reason onboard/wardsynq refuses one (test/queue-orgs-onboard.test.mjs).
 * ================================================================================================== */

test("POST /org/from-connect: no session refused, a staff PIN session cannot self-onboard a connected hospital, a StewardMD account can", async () => {
  seedTwoHospitals();
  await ORG.setMembership(ENV, "org-b-a", "reception-fc", { role: "reception" }, "owner");
  const staffToken = await mintStaffSession(ENV, "org-b-a", "reception-fc", Date.now());
  const body = { name: "Connected Hospital", connectTenantId: "tenant-fc-1", connectConnectionId: "conn-fc-1" };

  const r401 = await api("/org/from-connect", "POST", body, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/org/from-connect", "POST", body, { "X-Staff-Token": staffToken });
  assert.equal(r403.__status, 403, JSON.stringify(r403));
  assert.equal(r403.error, "account_required");

  const rOk = await api("/org/from-connect", "POST", body, asFirebase("new-fc-owner@example.test"));
  assert.equal(rOk.__status, 200, JSON.stringify(rOk));
  assert.equal(rOk.org.mode, "connect");
  assert.equal(rOk.org.connectTenantId, "tenant-fc-1");
  assert.equal(rOk.org.connectConnectionId, "conn-fc-1");
});

/* ==================================================================================================
 * GET /mfa/status - staff accounts only, self-scoped: no orgId/identity parameter exists to name
 * someone else's status, so there is no "wrong role" or "cross-hospital" misuse surface (the same
 * reasoning as test/neg-auth-org-members.test.mjs's /mfa/disable tests) - each staff session simply
 * sees its OWN hospital's OWN member, whichever hospital that is.
 * ================================================================================================== */

test("GET /mfa/status: no session refused, a Firebase account is refused (staff accounts only), each staff session sees only its own status", async () => {
  seedTwoHospitals();
  await ORG.setMembership(ENV, "org-b-a", "nurse-mfa", { role: "nurse" }, "owner");
  await ORG.setMemberPin(ENV, "org-b-a", "nurse-mfa", "4826", "owner");
  await ORG.setMembership(ENV, "org-b-b", "nurse-mfa-b", { role: "nurse" }, "owner");
  await ORG.setMemberPin(ENV, "org-b-b", "nurse-mfa-b", "7391", "owner");

  const r401 = await api("/mfa/status", "GET", null, {});
  assert.equal(r401.__status, 401, JSON.stringify(r401));

  const r403 = await api("/mfa/status", "GET", null, asFirebase(DOCTOR_A_EMAIL));
  assert.equal(r403.__status, 403, JSON.stringify(r403));
  assert.equal(r403.error, "staff_accounts_only");

  const tokenA = (await api("/auth/pin", "POST", { orgId: "org-b-a", identity: "nurse-mfa", pin: "4826" }, {})).token;
  const tokenB = (await api("/auth/pin", "POST", { orgId: "org-b-b", identity: "nurse-mfa-b", pin: "7391" }, {})).token;

  const statusA = await api("/mfa/status", "GET", null, { "X-Staff-Token": tokenA });
  assert.equal(statusA.__status, 200, JSON.stringify(statusA));
  assert.equal(statusA.enabled, false);

  const statusB = await api("/mfa/status", "GET", null, { "X-Staff-Token": tokenB });
  assert.equal(statusB.__status, 200, JSON.stringify(statusB));
  assert.equal(statusB.enabled, false);

  // Enrolling on hospital A's session must never flip hospital B's own status.
  const enrol = await api("/mfa/enrol", "POST", {}, { "X-Staff-Token": tokenA });
  assert.equal(enrol.__status, 200, JSON.stringify(enrol));
  const STEP = () => Math.floor(Date.now() / A.TOTP_STEP_MS);
  const confirm = await api("/mfa/confirm", "POST", { code: await totpAt(enrol.secret, STEP()) }, { "X-Staff-Token": tokenA });
  assert.equal(confirm.__status, 200, JSON.stringify(confirm));

  // Confirming enrolment revokes every session minted before it (same as setMemberPin/setMemberActive) -
  // a fresh sign-in has to clear the now-required second step, same as a real sign-in would.
  const challengeA = await api("/auth/pin", "POST", { orgId: "org-b-a", identity: "nurse-mfa", pin: "4826" }, {});
  assert.equal(challengeA.error, "mfa_required", JSON.stringify(challengeA));
  const signedInA = await api("/auth/mfa", "POST", { challenge: challengeA.challenge, code: confirm.recoveryCodes[0] }, {});
  assert.equal(signedInA.__status, 200, JSON.stringify(signedInA));

  const statusAAfter = await api("/mfa/status", "GET", null, { "X-Staff-Token": signedInA.token });
  assert.equal(statusAAfter.enabled, true);
  const statusBAfter = await api("/mfa/status", "GET", null, { "X-Staff-Token": tokenB });
  assert.equal(statusBAfter.enabled, false, "hospital B's own member is untouched by hospital A's enrolment");
});
