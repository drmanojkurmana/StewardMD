/* test/wardsynq-abdm-hospital-routes.test.mjs - owner S6 phase A1: the ABDM profile through the router.
 *
 * Routes: GET /api/queue/ward/abdm-profile, POST /api/queue/ward/connector-save (kind "abdm"),
 * POST /api/queue/member (a doctor's HPR ID), and the Admin > Integrations > ABDM card (pages/abdm.js).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-abdm-hospital-routes.test.mjs
 */
import { as, seed, docs, H, ENV, T, ORG_ID, OTHER, ADMIN, NURSE, HR, DOCTOR, OTHER_ADMIN, writesNow } from "./wardsynq-connectors-harness.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { CONNECTOR_TYPE, openConnectorSecrets } = await import("../functions/_wardsynq/connectors.js");
const { sealSecret } = await import("../functions/_wardsynq/webhooks.js");

const HFR = "IN2810006668";
const SECRET = "abdm-bridge-secret-do-not-leak-0001";
const PROFILE = (settings) => ({ orgId: ORG_ID, kind: "abdm", provider: "shared-bridge", settings: { hfrFacilityId: HFR, status: "draft", ...(settings || {}) } });
const save = (who, settings) => as(who, "/ward/connector-save", "POST", PROFILE(settings));
const view = (who, orgId) => as(who, `/ward/abdm-profile?orgId=${orgId || ORG_ID}`);

function seedIndia() {
  seed();
  docs.get(`q_orgs/${ORG_ID}`).fields.regionProfile = { hfrId: HFR };
}
const record = () => H.RECORD.latest(T, CONNECTOR_TYPE, "abdm");

/* ---- who may see and change it ---------------------------------------------------------------------- */

test("negative authorization: no session 401; nurse and hr 403 with nothing written; another hospital's admin 403", async () => {
  seedIndia();
  const before = writesNow();
  assert.equal((await view(null)).__status, 401);
  assert.equal((await save(null)).__status, 401);
  for (const who of [NURSE, HR]) {
    const v = await view(who);
    assert.equal(v.__status, 403, `${who}: ${v.__text}`);
    const s = await save(who);
    assert.equal(s.__status, 403, `${who}: ${s.__text}`);
  }
  const otherView = await view(OTHER_ADMIN);
  assert.equal(otherView.__status, 403, otherView.__text);
  const otherSave = await save(OTHER_ADMIN);
  assert.equal(otherSave.__status, 403, otherSave.__text);
  assert.equal(writesNow(), before, "no refused call wrote anything");
  assert.equal(await record(), null);
});

test("another hospital's admin sees only their own (empty) profile, never this one", async () => {
  seedIndia();
  assert.equal((await save(ADMIN)).__status, 200);
  const theirs = await view(OTHER_ADMIN, OTHER);
  assert.equal(theirs.__status, 200, theirs.__text);
  assert.equal(theirs.profile, null);
  assert.ok(!theirs.__text.includes(HFR));
});

/* ---- the admin walks the profile ----------------------------------------------------------------------- */

test("positive: the admin sets up, submits, links in sandbox and suspends; each step versioned and audited", async () => {
  seedIndia();
  const fresh = await view(ADMIN);
  assert.equal(fresh.__status, 200, fresh.__text);
  assert.equal(fresh.profile, null);
  assert.equal(fresh.hfrOnOrg, HFR);
  assert.deepEqual(fresh.statusOptions.map((o) => o.status), ["draft", "submitted"]);
  assert.equal(fresh.bridge, "shared");
  assert.ok(!/verified/i.test(fresh.checklist.map((i) => i.status + i.detail).join(" ")), "nothing claims verification");

  const draft = await save(ADMIN);
  assert.equal(draft.__status, 200, draft.__text);
  assert.equal(draft.connector.id, "abdm");
  const sub = await save(ADMIN, { status: "submitted" });
  assert.equal(sub.__status, 200, sub.__text);
  const noHip = await save(ADMIN, { status: "sandbox-linked" });
  assert.equal(noHip.__status, 422);
  assert.match(noHip.message, /Enter the HIP ID/);
  const linked = await save(ADMIN, { status: "sandbox-linked", hipId: HFR, hiuId: HFR });
  assert.equal(linked.__status, 200, linked.__text);
  const rec = await record();
  assert.equal(rec.version, 3);
  assert.equal(rec.settings.status, "sandbox-linked");
  assert.deepEqual(H.RECORD.audit.filter((a) => a.scope && a.scope.kind === "abdm").map((a) => a.action), ["connector.create", "connector.update", "connector.update"]);

  const after = await view(ADMIN);
  assert.equal(after.profile.settings.hipId, HFR);
  assert.equal(after.checklist.find((i) => i.key === "linkage").status, "entered");
  assert.equal(after.checklist.find((i) => i.key === "production").status, "blocked");
  assert.equal(after.statusOptions.find((o) => o.status === "production-linked").allowed, false);

  const n = writesNow();
  const prod = await save(ADMIN, { status: "production-linked", hipId: HFR, hiuId: HFR });
  assert.equal(prod.__status, 422);
  assert.match(prod.message, /Production linking is blocked.*India-region hosting/);
  const moved = await save(ADMIN, { status: "sandbox-linked", hipId: "SOME-OTHER-HIP", hiuId: HFR });
  assert.equal(moved.__status, 422);
  assert.match(moved.message, /fixed once ABDM has linked them/);
  const skip = await save(ADMIN, { status: "draft", hipId: HFR, hiuId: HFR });
  assert.equal(skip.__status, 422, "sandbox-linked cannot jump to draft");
  assert.equal(writesNow(), n, "refused saves wrote nothing");

  assert.equal((await save(ADMIN, { status: "suspended", hipId: HFR, hiuId: HFR })).__status, 200);
  assert.equal((await save(ADMIN, { status: "draft", hipId: "NEW-HIP-01", hiuId: "" })).__status, 200, "from suspended, back to draft with new ids");
  assert.equal((await record()).version, 5);
});

test("the facility ID must be the hospital record's; with none on the record, nothing is saved", async () => {
  seedIndia();
  const before = writesNow();
  const wrong = await save(ADMIN, { hfrFacilityId: "IN1111111111" });
  assert.equal(wrong.__status, 422);
  assert.match(wrong.message, /must match the one on the hospital record/);
  delete docs.get(`q_orgs/${ORG_ID}`).fields.regionProfile;
  const none = await save(ADMIN);
  assert.equal(none.__status, 422);
  assert.match(none.message, /Hospital tab first/);
  const badStatus = await save(ADMIN, { status: "live" });
  assert.equal(badStatus.__status, 422);
  assert.equal(writesNow(), before);
});

test("doctors: registration readiness is listed, and an HPR ID set through /member shows on the card", async () => {
  seedIndia();
  const v = await view(ADMIN);
  const doc = v.doctors.find((d) => d.role === "doctor");
  assert.ok(doc, JSON.stringify(v.doctors));
  assert.equal(doc.regNoSet, false);
  assert.equal(v.checklist.find((i) => i.key === "doctors").status, "missing");
  const bad = await as(ADMIN, "/member", "POST", { orgId: ORG_ID, identity: doc.identity, regionProfile: { hprId: "123" } });
  assert.equal(bad.__status, 422, bad.__text);
  const ok = await as(ADMIN, "/member", "POST", { orgId: ORG_ID, identity: doc.identity, regionProfile: { hprId: "12345678901234" } });
  assert.equal(ok.__status, 200, ok.__text);
  const again = await view(ADMIN);
  const d2 = again.doctors.find((d) => d.identity === doc.identity);
  assert.equal(d2.hprId, "12345678901234");
  assert.equal(d2.hprValid, true);
  assert.equal(d2.role, "doctor", "setting the HPR ID kept the role");
  const byNurse = await as(NURSE, "/member", "POST", { orgId: ORG_ID, identity: doc.identity, regionProfile: { hprId: "99999999999999" } });
  assert.equal(byNurse.__status, 403);
  assert.equal((await view(ADMIN)).doctors.find((d) => d.identity === doc.identity).hprId, "12345678901234");
});

/* ---- sealing ------------------------------------------------------------------------------------------ */

test("owner A1: a credential sent with a profile save is dropped, never sealed, stored, echoed or audited; no other provider exists", async () => {
  seedIndia();
  const r = await as(ADMIN, "/ward/connector-save", "POST", { ...PROFILE(), secrets: { clientSecret: SECRET } });
  assert.equal(r.__status, 200, r.__text);
  assert.ok(!r.__text.includes(SECRET));
  assert.deepEqual(r.connector.secretsSet, []);
  assert.deepEqual((await record()).secretsEnc, {});
  assert.ok(!JSON.stringify(H.RECORD.audit).includes(SECRET));
  const before = writesNow();
  const own = await as(ADMIN, "/ward/connector-save", "POST", { orgId: ORG_ID, kind: "abdm", provider: "own-bridge", settings: { clientId: "SBXID_000001" }, secrets: { clientSecret: SECRET } });
  assert.equal(own.__status, 422, own.__text);
  assert.equal(own.error, "unknown_provider");
  assert.ok(!own.__text.includes(SECRET));
  assert.equal(writesNow(), before);
});

test("sealing: a sealed value on the ABDM record is never in any response or audit, opens only with the right key, and the next save drops it", async () => {
  seedIndia();
  /* Defence in depth: the ABDM kind declares no secret (owner A1), so a sealed value could only arrive on the
   * record by some other path. It still never leaves the server, and the framework's seal is what protects it. */
  const sealed = await sealSecret(ENV, SECRET);
  assert.ok(sealed && !sealed.includes(SECRET), "the envelope is not the secret");
  const at = new Date().toISOString();
  await H.RECORD.append(T, [{ resourceType: CONNECTOR_TYPE, id: "abdm", version: 1, kind: "abdm", provider: "shared-bridge", name: null, settings: { hfrFacilityId: HFR, status: "draft" },
    secretsEnc: { stray: sealed }, secretsSetAt: at, active: true, createdAt: at, createdBy: "t", writtenBy: { id: "t", kind: "human", at } }],
    { audit: { ts: at, actor: "t", connectorId: "wardsynq-connectors", action: "connector.create", outcome: "ok", scope: { connectorId: "abdm", kind: "abdm", secretsReplaced: ["stray"] } } });

  for (const path of [`/ward/abdm-profile?orgId=${ORG_ID}`, `/ward/connectors?orgId=${ORG_ID}`, `/ward/connectors?orgId=${ORG_ID}&kind=abdm`]) {
    const res = await as(ADMIN, path);
    assert.equal(res.__status, 200, `${path}: ${res.__text}`);
    assert.ok(!res.__text.includes(SECRET) && !res.__text.includes(sealed), `${path} carries neither the secret nor its seal`);
  }
  const rec = await record();
  assert.deepEqual(await openConnectorSecrets(ENV, rec), { stray: SECRET }, "opens with the document key");
  const wrongKey = { ...ENV, DOC_ENC_KEY: Buffer.alloc(32, 9).toString("base64url") };
  assert.deepEqual(await openConnectorSecrets(wrongKey, rec), {}, "a wrong key opens nothing, and nothing is guessed");

  const next = await save(ADMIN, { status: "submitted" });
  assert.equal(next.__status, 200, next.__text);
  assert.ok(!next.__text.includes(SECRET) && !next.__text.includes(sealed));
  assert.deepEqual((await record()).secretsEnc, {}, "a credential the kind does not declare is not carried forward");
  assert.ok(!JSON.stringify(H.RECORD.audit).includes(SECRET) && !JSON.stringify(H.RECORD.audit).includes(sealed), "no secret or seal in the audit trail");
});

/* ---- the screen --------------------------------------------------------------------------------------- */

test("Admin > Integrations > ABDM card: loading, failed and not set up are distinct; shared bridge, no credential field; honest statuses", async () => {
  const { readFileSync } = await import("node:fs");
  const { abdmView } = await import("../functions/_wardsynq/abdm-hospital.js");
  const win = { addEventListener() {} };
  const doc = { readyState: "complete", getElementById: () => ({ innerHTML: "", querySelectorAll: () => [] }), createElement: () => ({ innerHTML: "" }), body: { appendChild() {} }, addEventListener() {} };
  const run = (src) => new Function("window", "document", "location", "localStorage", src)(win, doc, { hash: "", search: "", origin: "https://wardsynq.example" }, { getItem: () => null, setItem() {}, removeItem() {} });
  run(readFileSync(new URL("../wardsynq/site/shell.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8"));
  run(readFileSync(new URL("../wardsynq/site/pages/abdm.js", import.meta.url), "utf8"));
  const c = { esc: win.WSQ.esc, state: { orgId: ORG_ID } };
  const html = win.WSQ._abdmHtml;
  assert.equal(typeof win.WSQ._abdmLoad, "function");
  assert.match(html(c, null), /Loading the ABDM profile/);
  assert.match(html(c, { failed: true, message: "forbidden" }), /could not be loaded: forbidden. This is not the same as it not being set up/);
  const org = { region: "IN", regionProfile: { hfrId: HFR } };
  const fresh = html(c, { ok: true, ...abdmView(null, org, [{ identity: "d1", email: "doc@h", role: "doctor", regNo: "", active: true }]) });
  assert.match(fresh, /Not set up for this hospital/);
  assert.match(fresh, /Bridge: shared StewardMD bridge/);
  assert.ok(!/type="password"|client secret|client ID/i.test(fresh), "no bridge credential field at all (owner A1)");
  assert.match(fresh, /stay in the chart, marked as received under that consent/, "owner A4");
  assert.match(fresh, /Entered, not verified/);
  assert.match(fresh, /Not built yet/);
  assert.match(fresh, /Blocked<\/span><\/td><td>Awaiting India hosting\./, "owner A2");
  assert.ok(!/>Verified</.test(fresh));
  assert.match(fresh, /data-abdm-hpr="d1"/);
  const linked = html(c, { ok: true, ...abdmView({ id: "abdm", version: 3, settings: { hfrFacilityId: HFR, hipId: HFR, status: "sandbox-linked" }, secretsSet: [] }, org, []) });
  assert.match(linked, /<option value="production-linked" disabled>Linked in production \(not available\)/);
  assert.match(linked, /No active prescriber/);
  // The generic connector card leaves ABDM to its own card.
  const { catalogue } = await import("../functions/_wardsynq/connectors.js");
  const generic = win.WSQ._connectorsHtml(c, { ok: true, keyConfigured: true, catalogue: catalogue(), connectors: [] });
  assert.ok(!generic.includes('data-cn-save="abdm"'));
  const index = readFileSync(new URL("../wardsynq/site/index.html", import.meta.url), "utf8");
  assert.match(index, /pages\/abdm\.js\?v=\d+/);
});
