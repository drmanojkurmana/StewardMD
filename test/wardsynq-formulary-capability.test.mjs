/* test/wardsynq-formulary-capability.test.mjs - O19: keeping the formulary is its own capability (formulary.manage), held by
 * the pharmacy role and by admin, so a pharmacist no longer has to be made a hospital admin to maintain it. Through the real
 * router (wardsynq-ops-harness): the pharmacist creates, edits and retires entries and loads a CSV; a nurse and hr cannot;
 * admin still can; granting and revoking the role grants and revokes the capability; and the pharmacist still reaches none of
 * the other admin routes (staff, hospital settings, billing settings, integrations).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-formulary-capability.test.mjs
 */
import { as, seedHospital, docsWhere, idFor, U, ORG } from "./wardsynq-ops-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPS, ROLE_CAPS, can } from "../functions/_queue_roles.js";

const formulary = () => docsWhere((f, p) => p === `q_orgs/${ORG}`)[0].fields.wardsynq.formulary;
const audits = () => docsWhere((f) => f.action === "org:formulary");

/** Dry run then commit the whole list, as the screen does. Returns the commit's answer. */
async function save(who, entries, reason) {
  const dry = await as(who, "/org/formulary", "POST", { orgId: ORG, entries });
  if (dry.__status !== 200) return dry;
  return as(who, "/org/formulary", "POST", { orgId: ORG, entries, commit: true, confirmCount: dry.changeCount, planId: dry.planId, reason });
}

test("PURE: formulary.manage is held by the pharmacy and admin roles only", () => {
  assert.equal(CAPS.FORMULARY_MANAGE, "formulary.manage");
  const holders = Object.keys(ROLE_CAPS).filter((r) => can(r, CAPS.FORMULARY_MANAGE)).sort();
  assert.deepEqual(holders, ["admin", "pharmacy"]);
  // The pharmacy gains nothing else administrative with it.
  for (const cap of [CAPS.STAFF_ADMIN, CAPS.BILLING_CHARGE, CAPS.BILLING_VIEW, CAPS.EMR_VIEW, CAPS.EMR_TREAT, CAPS.ANALYTICS_VIEW, CAPS.SESSION_MANAGE])
    assert.equal(can("pharmacy", cap), false, cap);
});

test("pharmacist creates, edits and retires formulary entries and loads a CSV; each commit is audited under the pharmacist", async () => {
  seedHospital();
  const got = await as(U.PHARMACY, `/org/formulary?orgId=${ORG}`);
  assert.equal(got.__status, 200, JSON.stringify(got));
  assert.deepEqual(got.entries, []);

  const created = await save(U.PHARMACY, [{ drug: "Meropenem", restricted: true, requiresApproval: true, approvedBy: "Microbiology" }], "P and T committee");
  assert.equal(created.__status, 200, JSON.stringify(created));
  assert.equal(created.written, 1);
  assert.equal(formulary()[0].drug, "Meropenem");

  const edited = await save(U.PHARMACY, [{ drug: "Meropenem", restricted: true, requiresApproval: true, approvedBy: "Microbiology", note: "Stewardship round" }], "note added");
  assert.equal(edited.written, 1, JSON.stringify(edited));
  assert.equal(formulary()[0].note, "Stewardship round");

  const retired = await save(U.PHARMACY, [{ ...formulary()[0], retired: true }], "withdrawn");
  assert.equal(retired.written, 1, JSON.stringify(retired));
  assert.equal(formulary()[0].retired, true);

  const map = await as(U.PHARMACY, "/org/formulary-import", "POST", { orgId: ORG, csv: "Name,Code\nParacetamol 500mg,PCM-500\n" });
  assert.equal(map.__status, 200, JSON.stringify(map));
  const csvBody = { orgId: ORG, csv: "Name,Code\nParacetamol 500mg,PCM-500\n", mapping: { drug: 0, code: 1 }, mode: "merge" };
  const dry = await as(U.PHARMACY, "/org/formulary-import", "POST", csvBody);
  assert.equal(dry.__status, 200, JSON.stringify(dry));
  const done = await as(U.PHARMACY, "/org/formulary-import", "POST", { ...csvBody, commit: true, confirmCount: dry.changeCount, planId: dry.planId, reason: "stock list" });
  assert.equal(done.written, 1, JSON.stringify(done));
  assert.equal(formulary().length, 2);

  const rows = audits();
  assert.equal(rows.length, 4);
  for (const r of rows) assert.ok(JSON.stringify(r.fields).includes(idFor(U.PHARMACY)), "the audit row names the pharmacist: " + JSON.stringify(r.fields));
});

test("nurse and hr cannot read or change the formulary through either door; nothing is written", async () => {
  seedHospital();
  const body = { orgId: ORG, entries: [{ drug: "Meropenem" }], commit: true, confirmCount: 1, planId: "x", reason: "x" };
  for (const who of [U.NURSE, U.HR, U.DOCTOR, U.CASHIER]) {
    for (const [path, method, b] of [[`/org/formulary?orgId=${ORG}`, "GET"], ["/org/formulary", "POST", body], ["/org/formulary-import", "POST", { orgId: ORG, csv: "Name\nX\n" }]]) {
      const r = await as(who, path, method, b);
      assert.equal(r.__status, 403, who + " " + path + " " + JSON.stringify(r));
    }
  }
  const refused = await as(U.NURSE, "/org/formulary", "POST", body);
  assert.match(refused.message, /cannot change the formulary/);
  assert.equal(formulary(), undefined);
  assert.equal(audits().length, 0);
});

test("admin keeps every formulary power it had", async () => {
  seedHospital();
  const done = await save(U.ADMIN, [{ drug: "Vancomycin", restricted: true, restrictedTo: ["ICU"] }], "committee");
  assert.equal(done.__status, 200, JSON.stringify(done));
  assert.equal(formulary()[0].drug, "Vancomycin");
  const retired = await save(U.ADMIN, [{ ...formulary()[0], retired: true }], "withdrawn");
  assert.equal(retired.written, 1);
});

test("granting the pharmacy role grants the capability; changing the role revokes it", async () => {
  seedHospital();
  const NEW = "newpharm@example.test", id = idFor(NEW);
  assert.equal((await as(NEW, `/org/formulary?orgId=${ORG}`)).__status, 403, "not yet a member");
  const add = await as(U.ADMIN, "/member", "POST", { orgId: ORG, identity: id, role: "pharmacy" });
  assert.equal(add.__status, 200, JSON.stringify(add));
  assert.equal((await as(NEW, `/org/formulary?orgId=${ORG}`)).__status, 200, "granted with the pharmacy role");
  const me = await as(NEW, `/whoami?orgId=${ORG}`);
  assert.equal(me.__status, 200, JSON.stringify(me));
  assert.ok((me.caps || []).includes("formulary.manage"), "the screen is told the capability: " + JSON.stringify(me));
  const demote = await as(U.ADMIN, "/member", "POST", { orgId: ORG, identity: id, role: "nurse" });
  assert.equal(demote.__status, 200, JSON.stringify(demote));
  assert.equal((await as(NEW, `/org/formulary?orgId=${ORG}`)).__status, 403, "revoked with the role");
});

test("NEGATIVE: the pharmacist reaches no other admin route (staff, hospital settings, billing settings, integrations)", async () => {
  seedHospital();
  const routes = [
    [`/members?orgId=${ORG}`, "GET"],
    ["/member", "POST", { orgId: ORG, identity: idFor(U.NURSE), role: "admin" }],
    ["/member", "POST", { orgId: ORG, identity: idFor(U.PHARMACY), role: "admin" }],
    ["/member/disable", "POST", { orgId: ORG, identity: idFor(U.NURSE) }],
    ["/org/update", "POST", { orgId: ORG, name: "Renamed" }],
    [`/org/rcm-settings?orgId=${ORG}`, "GET"],
    ["/org/rcm-settings", "POST", { orgId: ORG, settings: {}, reason: "x" }],
    [`/org/reorder-policy?orgId=${ORG}`, "GET"],
    ["/bill/tariff", "POST", { orgId: ORG, code: "X", name: "X", price: 1 }],
    [`/ward/connectors?orgId=${ORG}`, "GET"],
    ["/ward/connector-save", "POST", { orgId: ORG }],
    [`/ward/webhooks?orgId=${ORG}`, "GET"],
    [`/ward/smart-clients?orgId=${ORG}`, "GET"],
    ["/ward/smart-client-save", "POST", { orgId: ORG }],
  ];
  for (const [path, method, b] of routes) {
    const r = await as(U.PHARMACY, path, method, b);
    assert.equal(r.__status, 403, path + " " + JSON.stringify(r));
  }
  // Control: the same reads open for admin, so the refusals above are the capability and not a broken request.
  for (const path of [`/members?orgId=${ORG}`, `/org/rcm-settings?orgId=${ORG}`, `/org/reorder-policy?orgId=${ORG}`, `/ward/connectors?orgId=${ORG}`, `/ward/webhooks?orgId=${ORG}`, `/ward/smart-clients?orgId=${ORG}`]) {
    const r = await as(U.ADMIN, path);
    assert.notEqual(r.__status, 403, "admin " + path + " " + JSON.stringify(r));
  }
  const org = docsWhere((f, p) => p === `q_orgs/${ORG}`)[0].fields;
  assert.equal(org.name, "WSQ Ward Hospital", "nothing was renamed");
  const pharm = docsWhere((f) => f.identity === idFor(U.PHARMACY))[0].fields;
  assert.equal(pharm.role, "pharmacy", "the pharmacist did not promote themselves");
});
