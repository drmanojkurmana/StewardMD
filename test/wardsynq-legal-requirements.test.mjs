/* test/wardsynq-legal-requirements.test.mjs - the legal requirement registry and the State/UT configuration layered on it
 * (functions/_wardsynq/legal-requirements.js, owner's legal guidance of 2026-09-17), the hospital's State/UT on its region
 * profile, item 52 of the donor criteria, and the /org/legal-requirements route. Real router, in-memory store.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-legal-requirements.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { REQUIREMENTS, STATES_UTS, SOURCE_TYPES, STATUSES, requirement, citeOf, enforcement, enforced, stateConfigFor, validateStateConfig, formFSubmission, formFPortalClock,
  medleaprRequired, legalView } from "../functions/_wardsynq/legal-requirements.js";
import { orgProfile, validateOrgProfile } from "../functions/_region_in.js";
import { donorCriteriaFor } from "../functions/_wardsynq/donor-criteria.js";
import { loadSite, leftovers } from "./wsq-site-i18n-harness.mjs";

const ON = "2026-09-17";

/* ------------------------------------------------------------------------------------------ PURE */

test("every requirement follows the owner's model: source type, status, jurisdiction India or a State/UT, dates, evidence, a citation", () => {
  const codes = new Set(STATES_UTS.map((s) => s.code));
  assert.equal(STATES_UTS.length, 36);
  assert.equal(STATES_UTS.filter((s) => s.kind === "UT").length, 8);
  assert.equal(new Set(REQUIREMENTS.map((r) => r.id)).size, REQUIREMENTS.length, "ids are unique");
  for (const r of REQUIREMENTS) {
    assert.ok(SOURCE_TYPES.includes(r.sourceType), r.id);
    assert.ok(STATUSES.includes(r.status), r.id);
    assert.ok(r.jurisdiction === "IN" || codes.has(r.jurisdiction), r.id);
    for (const d of [r.effectiveFrom, r.expiresOn]) assert.ok(d === null || /^\d{4}-\d{2}-\d{2}$/.test(d), r.id);
    assert.ok(r.title && r.instrument && r.cite, r.id);
    for (const e of r.evidence) assert.ok(/^https:\/\//.test(e.url) && typeof e.verified === "boolean", r.id);
    assert.ok(!/—/.test(JSON.stringify(r)), "no em dash: " + r.id);
  }
  assert.throws(() => requirement("NO-SUCH"), /no requirement/);
});

test("enforcement: UNDER_CHALLENGE enforced; STAYED, STRUCK_DOWN, not yet effective and expired are not; a State entry applies only in its State/UT; case type and region narrow it", () => {
  const base = requirement("IN-PCPNDT-R9-8-MONTHLY");
  assert.deepEqual(enforcement(base, { on: ON }), { applies: true, reason: "in-force" });
  assert.deepEqual(enforcement({ ...base, status: "UNDER_CHALLENGE" }, { on: ON }), { applies: true, reason: "under-challenge-not-stayed" });
  assert.deepEqual(enforcement({ ...base, status: "STAYED" }, { on: ON }), { applies: false, reason: "stayed" });
  assert.deepEqual(enforcement({ ...base, status: "STRUCK_DOWN" }, { on: ON }), { applies: false, reason: "struck-down" });
  assert.equal(enforcement({ ...base, status: "AMENDED" }, { on: ON }).applies, true);
  assert.equal(enforcement({ ...base, effectiveFrom: "2026-09-18" }, { on: ON }).reason, "not-yet-effective");
  assert.equal(enforcement({ ...base, expiresOn: "2026-09-16" }, { on: ON }).reason, "expired");
  assert.equal(enforcement({ ...base, expiresOn: ON }, { on: ON }).applies, true, "in force on its expiry day");
  assert.equal(enforcement(base, { on: ON, region: "US" }).reason, "other-country");
  assert.equal(enforcement(base, {}).reason, "no-date");
  const rj = requirement("RJ-MEDLEAPR-HC-2025");
  assert.equal(enforcement(rj, { on: ON }).reason, "state-not-set");
  assert.equal(enforcement(rj, { on: ON, stateUt: "MH" }).reason, "other-state");
  assert.equal(enforcement(rj, { on: ON, stateUt: "rj" }).applies, true);
  assert.equal(enforcement(rj, { on: "2026-01-31", stateUt: "RJ" }).reason, "not-yet-effective");
  assert.equal(enforcement(rj, { on: ON, stateUt: "RJ", caseType: "MLR", facilityType: "private" }).applies, true);
  assert.equal(enforcement(rj, { on: ON, stateUt: "RJ", caseType: "SOMETHING" }).reason, "case-type");
  assert.equal(enforcement(rj, { on: ON, stateUt: "RJ", facilityType: "military" }).reason, "facility-type");
  assert.equal(enforced("IN-SPDI-2011", { on: "2027-05-13" }), false, "SPDI gives way when the DPDP duties commence");
  assert.equal(enforced("IN-DPDP-ACT-S3-17", { on: ON }), false);
});

test("item 52 is UNDER_CHALLENGE with Thangjam Santa Singh v Union of India and its evidence, and stays enforced as the Rule states", () => {
  const r = requirement("IN-DCR-XIIB-H-52");
  assert.equal(r.status, "UNDER_CHALLENGE");
  assert.equal(r.challenge.case, "Thangjam Santa Singh v Union of India");
  assert.equal(r.challenge.stayed, false);
  assert.ok(r.evidence.some((e) => /livelaw/.test(e.url)));
  assert.equal(enforced("IN-DCR-XIIB-H-52", { on: ON }), true);
  const d = donorCriteriaFor({}, "IN").deferrals["high-risk-behaviour"];
  assert.equal(d.days, "permanent");
  assert.equal(d.law.item, "52");
  assert.equal(d.law.status, "UNDER_CHALLENGE");
  assert.equal(d.law.challenge.case, "Thangjam Santa Singh v Union of India");
});

test("Form F submission per State/UT: Maharashtra online in 5 days, Delhi online, Rajasthan portal and record, Bihar and every other not configured; the portal clock reads it", () => {
  const mh = formFSubmission("MH", null, ON);
  assert.equal(mh.mode, "ONLINE");
  assert.equal(mh.deadlineDays, 5);
  assert.equal(mh.portalUrl, "https://pcpndt.maharashtra.gov.in/");
  assert.equal(mh.requiresPortal && mh.requiresReference, true, "acknowledgement not configured: the safest, required");
  assert.equal(mh.requirementId, "MH-PCPNDT-FORMF-ONLINE");
  assert.deepEqual(mh.editable, ["acknowledgementRequired"], "only the value the shipped entry leaves unset");
  assert.equal(formFSubmission("DL", null, ON).mode, "ONLINE");
  assert.equal(formFSubmission("DL", null, ON).deadlineDays, null);
  const rj = formFSubmission("RJ", null, ON);
  assert.equal(rj.mode, "PORTAL_AND_RECORD");
  assert.equal(rj.requiresPortal, true);
  for (const st of ["BR", "KA", "OD"]) {
    const x = formFSubmission(st, null, ON);
    assert.equal(x.configured, false, st);
    assert.equal(x.requiresPortal, false, st);
    assert.deepEqual(x.editable, ["mode", "deadlineDays", "portalUrl", "acknowledgementRequired"], st);
  }
  const none = formFSubmission(null, null, ON);
  assert.equal(none.stateUt, null);
  assert.deepEqual(none.editable, []);
  assert.equal(citeOf("IN-PCPNDT-R9-4-FORMF").includes("r.9(4)"), true, "Form F itself is central");

  assert.deepEqual(formFPortalClock({ procedureDate: "2026-09-10" }, mh, ON), { dueBy: "2026-09-15", state: "overdue" });
  assert.deepEqual(formFPortalClock({ procedureDate: "2026-09-15" }, mh, ON), { dueBy: "2026-09-20", state: "due" });
  assert.equal(formFPortalClock({ procedureDate: "2026-09-10", portalSubmittedOn: "2026-09-16" }, mh, ON).state, "submitted-late");
  assert.equal(formFPortalClock({ procedureDate: "2026-09-10" }, formFSubmission("DL", null, ON), ON), null, "no deadline, no clock");
});

test("State/UT configuration: the hospital sets only what the registry leaves unset, with valid values; a shipped value cannot be overridden", () => {
  const cfg = { stateConfig: { BR: { formF: { mode: "OFFLINE", deadlineDays: 99 } }, MH: { formF: { mode: "OFFLINE", acknowledgementRequired: false } } } };
  const br = stateConfigFor("formF", "BR", cfg, ON);
  assert.equal(br.values.mode, "OFFLINE");
  assert.equal(br.sources.mode, "hospital");
  assert.equal(br.values.deadlineDays, null, "an invalid stored value is not used");
  const mh = stateConfigFor("formF", "MH", cfg, ON);
  assert.equal(mh.values.mode, "ONLINE", "the registry's value wins over a stored one");
  assert.equal(mh.values.acknowledgementRequired, false);
  assert.equal(formFSubmission("MH", cfg, ON).requiresReference, false);

  assert.match(validateStateConfig("formF", "MH", { mode: "OFFLINE" }, null, ON).problems[0], /set by MH-PCPNDT-FORMF-ONLINE/);
  assert.deepEqual(validateStateConfig("formF", "MH", { acknowledgementRequired: true }, null, ON), { value: { acknowledgementRequired: true }, problems: [] });
  assert.match(validateStateConfig("formF", "BR", { mode: "FAX" }, null, ON).problems[0], /mode: not a valid value/);
  assert.match(validateStateConfig("formF", "BR", { portalUrl: "http://x.test" }, null, ON).problems[0], /portalUrl/);
  assert.match(validateStateConfig("formF", "BR", { colour: "red" }, null, ON).problems[0], /not a formF value/);
  assert.match(validateStateConfig("formF", null, { mode: "ONLINE" }, null, ON).problems[0], /State\/UT/);
  assert.match(validateStateConfig("nope", "BR", {}, null, ON).problems[0], /kind/);
  assert.deepEqual(validateStateConfig("formF", "BR", { deadlineDays: null }, cfg, ON).value, { mode: "OFFLINE" }, "null clears a key");
  assert.ok(validateStateConfig("medleapr", "KA", { required: true }, null, ON).problems.some((p) => /effectiveFrom/.test(p)));
  assert.match(validateStateConfig("medleapr", "RJ", { required: false }, null, ON).problems[0], /set by RJ-MEDLEAPR-HC-2025/);
});

test("MedLEaPR by State/UT, case type and date: Rajasthan from 1 February 2026 for MLR and PMR; not configured elsewhere unless the hospital sets it", () => {
  assert.equal(medleaprRequired("RJ", null, "MLR", ON).required, true);
  assert.equal(medleaprRequired("RJ", null, "PMR", "2026-02-01").required, true);
  assert.equal(medleaprRequired("RJ", null, "MLR", "2026-01-31").required, false);
  assert.equal(medleaprRequired("RJ", null, "TRIAGE", ON).required, false);
  assert.deepEqual(medleaprRequired("KA", null, "MLR", ON), { required: false, configured: false, requirementId: null, stateUt: "KA" });
  assert.equal(medleaprRequired(null, null, "MLR", ON).required, false);
  const ka = { stateConfig: { KA: { medleapr: { required: true, effectiveFrom: "2026-07-05", caseTypes: ["MLR"] } } } };
  assert.equal(medleaprRequired("KA", ka, "MLR", ON).required, true);
  assert.equal(medleaprRequired("KA", ka, "PMR", ON).required, false);
  assert.equal(medleaprRequired("KA", ka, "MLR", "2026-07-04").required, false);
  assert.equal(requirement("RJ-MEDLEAPR-HC-2025").sourceType, "COURT_ORDER");
  assert.match(requirement("RJ-MEDLEAPR-HC-2025").instrument, /Bail Application No\. 173\/2025/);
});

test("legalView lists India's and the hospital's State/UT requirements and names what is not configured", () => {
  const v = legalView("BR", null, ON, "IN");
  assert.ok(v.requirements.every((r) => r.jurisdiction === "IN" || r.jurisdiction === "BR"));
  assert.ok(!v.requirements.some((r) => r.id === "RJ-MEDLEAPR-HC-2025"));
  assert.deepEqual(v.notConfigured, ["formF", "medleapr"]);
  const rj = legalView("RJ", null, ON, "IN");
  assert.deepEqual(rj.notConfigured, []);
  assert.equal(rj.requirements.find((r) => r.id === "IN-DCR-XIIB-H-52").enforcement.reason, "under-challenge-not-stayed");
  assert.equal(legalView("ZZ", null, ON, "IN").stateUt, null);
});

test("the region profile keeps a State/UT only from the list, and only for a hospital in India", () => {
  assert.deepEqual(orgProfile({ stateUt: "mh", hfrId: "IN1234567890" }, "IN"), { hfrId: "IN1234567890", stateUt: "MH" });
  assert.deepEqual(orgProfile({ stateUt: "XX" }, "IN"), {});
  assert.deepEqual(orgProfile({ stateUt: "MH" }, "US"), {});
  assert.deepEqual(validateOrgProfile({ stateUt: "RJ" }, "IN"), {});
  assert.match(validateOrgProfile({ stateUt: "Rajasthan" }, "IN").stateUt, /from the list/);
  assert.match(validateOrgProfile({ stateUt: "RJ" }, "US").region, /only to a hospital in India/);
});

/* ------------------------------------------------------------------------------------------ the screen */

function page(lang) {
  const e = loadSite({ lang, pages: ["registers.js", "bloodbank.js"] });
  const c = { esc: e.win.WSQ.esc, t: e.win.WSQ.t, tSafe: e.win.WSQ.tSafe, en: e.win.WSQ.en, can: () => true, state: { orgId: "org-1" } };
  return { ...e, c, L: e.win.WSQ._legal, B: e.win.WSQ._bloodbank };
}

test("the Legal requirements screen translates around the registry's English, says what is not configured, never draws a failed load as none, and edits only on Admin", () => {
  const { c, L, doc } = page("xx");
  const view = { ok: true, canEdit: true, ...legalView("BR", null, ON, "IN") };
  const reader = L.html(c, view, false);
  assert.match(reader, /⟦Not configured for your State\/UT\.⟧/);
  assert.match(reader, /⟦under challenge in the Supreme Court; not stayed; enforced⟧/);
  assert.ok(!reader.includes('data-lg="save"') && !reader.includes("lgState"), "the Registers tab is read-only");
  const english = [...view.requirements.flatMap((r) => [r.title, r.sourceType + ": " + r.instrument + (r.provision ? ", " + r.provision : ""), r.notes, r.challenge ? r.challenge.case + ", " + r.challenge.court : "", r.effectiveFrom || "", r.expiresOn || "", r.jurisdiction, ...r.evidence.map((e) => e.kind)]),
    ...STATES_UTS.map((s) => s.name), "Bihar", "BR", "ONLINE", "OFFLINE", "PORTAL_AND_RECORD", "MLR", "PMR", "AGE_DETERMINATION", "OTHER_MEDICO_LEGAL"].filter(Boolean);
  assert.deepEqual(leftovers(reader, english), []);
  const admin = L.html(c, view, true);
  assert.ok(admin.includes('data-lg="save" data-kind="formF"') && admin.includes('data-lg="save" data-kind="medleapr"') && admin.includes('id="lgState"'));
  assert.deepEqual(leftovers(admin, english), []);
  doc.getElementById("lg_formF_mode").value = "OFFLINE";
  doc.getElementById("lg_formF_deadlineDays").value = "";
  doc.getElementById("lg_formF_acknowledgementRequired").value = "no";
  assert.deepEqual(L.read("formF", view.config.formF.editable), { mode: "OFFLINE", deadlineDays: null, portalUrl: null, acknowledgementRequired: false });
  const rj = L.html(c, { ok: true, canEdit: true, ...legalView("RJ", null, ON, "IN") }, true);
  assert.ok(!rj.includes('data-kind="medleapr"'), "Rajasthan's shipped MedLEaPR values are not editable");
  assert.match(L.html(c, false, true), /Do not read this as none applying/);
  assert.match(L.html(c, { ok: true, canEdit: false, ...legalView(null, null, ON, "IN") }, false), /⟦This hospital&#39;s State\/UT is not recorded/);
  assert.match(L.submissionText(c, formFSubmission("BR", null, ON)), /⟦Form F submission is not configured for Bihar/);
});

test("the donor criteria table says item 52 is under challenge in the Supreme Court, not stayed, enforced", () => {
  const { c, B } = page("en");
  const html = B.criteriaTableHtml(c, donorCriteriaFor({}, "IN"), false, {});
  assert.match(html, /Item 52: under challenge in the Supreme Court; not stayed; enforced \(Thangjam Santa Singh v Union of India\)/);
});

/* ------------------------------------------------------------------------------------------ ROUTES */

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
      }
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "test", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});
const tenantDb = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }), batch: async () => [] };
const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "org-a", ORG_B = "org-b";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
const P = (r) => `${r}@example.test`;
const ADMIN = P("admin"), HIM = P("him"), RAD = P("radiologist"), CASHIER = P("cashier"), NURSE = P("nurse"), ROGUE = P("rogue");
const ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "test-secret-that-is-long-enough-for-hmac", WSQ_TICK_OFF: "1", FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb };

function seed() {
  docs.clear(); clock = 1;
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "HOSP-A", name: "Hospital A", kind: "clinic", mode: "wardsynq", region: "IN", ownerUid: "cfa:nobody", createdAt: 1, regionProfile: { stateUt: "BR" }, wardsynq: { controlledDrugs: ["Morphine"] } }, updateTime: "t1" });
  docs.set(`q_orgs/${ORG_B}`, { fields: { id: ORG_B, code: "HOSP-B", name: "Hospital B", kind: "clinic", mode: "wardsynq", region: "IN", ownerUid: "cfa:nobody", createdAt: 1, wardsynq: {} }, updateTime: "t1" });
  for (const [email, role] of [[ADMIN, "admin"], [HIM, "him"], [RAD, "radiologist"], [CASHIER, "cashier"], [NURSE, "nurse"]]) {
    docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(email))}`, { fields: { orgId: ORG, identity: idFor(email), role, active: true }, updateTime: "t1" });
  }
  docs.set(`q_members/${sanitize(ORG_B)}__${sanitize(idFor(ROGUE))}`, { fields: { orgId: ORG_B, identity: idFor(ROGUE), role: "admin", active: true }, updateTime: "t1" });
}
async function as(email, path, method, body) {
  const headers = { "Content-Type": "application/json" };
  if (email) headers["Cf-Access-Authenticated-User-Email"] = email;
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: method || "GET", headers, body: body ? JSON.stringify(body) : undefined }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}
const orgFields = () => JSON.stringify(docs.get(`q_orgs/${ORG}`).fields);
const auditRows = () => [...docs.values()].filter((d) => d.fields && d.fields.action === "org:legal_state_config");

test("GET /org/legal-requirements: 401 without a session, 403 for a role that keeps no register and for another hospital; the admin and a register keeper read it", async () => {
  seed();
  assert.equal((await as(null, "/org/legal-requirements?orgId=" + ORG)).__status, 401);
  for (const who of [CASHIER, NURSE]) assert.equal((await as(who, "/org/legal-requirements?orgId=" + ORG)).__status, 403, who);
  assert.equal((await as(ROGUE, "/org/legal-requirements?orgId=" + ORG)).__status, 403, "another hospital's admin");
  const admin = await as(ADMIN, "/org/legal-requirements?orgId=" + ORG);
  assert.equal(admin.__status, 200, JSON.stringify(admin));
  assert.equal(admin.stateUt, "BR");
  assert.equal(admin.canEdit, true);
  assert.deepEqual(admin.notConfigured, ["formF", "medleapr"]);
  for (const who of [HIM, RAD]) {
    const r = await as(who, "/org/legal-requirements?orgId=" + ORG);
    assert.equal(r.__status, 200, who);
    assert.equal(r.canEdit, false, who);
  }
});

test("POST /org/legal-requirements: staff.admin only, a reason, only the values the registry leaves to the hospital; nothing written on a refusal; the saved value reads back and is audited without the values", async () => {
  seed();
  const body = { orgId: ORG, kind: "formF", values: { mode: "OFFLINE" }, reason: "District AA letter 12" };
  const before = orgFields();
  assert.equal((await as(null, "/org/legal-requirements", "POST", body)).__status, 401);
  for (const who of [HIM, RAD, CASHIER]) assert.equal((await as(who, "/org/legal-requirements", "POST", body)).__status, 403, who);
  assert.equal((await as(ROGUE, "/org/legal-requirements", "POST", body)).__status, 403, "another hospital's admin");
  assert.equal((await as(ADMIN, "/org/legal-requirements", "POST", { ...body, reason: "" })).error, "reason_required");
  assert.equal((await as(ADMIN, "/org/legal-requirements", "POST", { ...body, values: { mode: "FAX" } })).__status, 422);
  assert.equal(orgFields(), before, "no refusal wrote anything");
  assert.equal(auditRows().length, 0);

  const saved = await as(ADMIN, "/org/legal-requirements", "POST", body);
  assert.equal(saved.__status, 200, JSON.stringify(saved));
  assert.equal(saved.config.formF.values.mode, "OFFLINE");
  assert.equal(saved.config.formF.sources.mode, "hospital");
  assert.deepEqual(docs.get(`q_orgs/${ORG}`).fields.wardsynq.legal, { stateConfig: { BR: { formF: { mode: "OFFLINE" } } } });
  assert.deepEqual(docs.get(`q_orgs/${ORG}`).fields.wardsynq.controlledDrugs, ["Morphine"], "the other settings are kept");
  const rows = auditRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0].fields.meta), { kind: "formF", stateUt: "BR", changed: ["mode"], reason: "District AA letter 12" });

  docs.get(`q_orgs/${ORG}`).fields.regionProfile = { stateUt: "RJ" };
  const shipped = await as(ADMIN, "/org/legal-requirements", "POST", { orgId: ORG, kind: "medleapr", values: { required: false }, reason: "We think not" });
  assert.equal(shipped.__status, 422);
  assert.match(shipped.message, /RJ-MEDLEAPR-HC-2025/);

  delete docs.get(`q_orgs/${ORG}`).fields.regionProfile;
  assert.match((await as(ADMIN, "/org/legal-requirements", "POST", body)).message, /State\/UT/, "no State/UT recorded: nothing to configure");
});

test("POST /org/update records the State/UT only from the list", async () => {
  seed();
  const bad = await as(ADMIN, "/org/update", "POST", { orgId: ORG, regionProfile: { stateUt: "Maharashtra" } });
  assert.equal(bad.__status, 422);
  assert.match(bad.errors.stateUt, /from the list/);
  const ok = await as(ADMIN, "/org/update", "POST", { orgId: ORG, regionProfile: { stateUt: "MH" } });
  assert.equal(ok.__status, 200, JSON.stringify(ok));
  assert.equal(ok.org.regionProfile.stateUt, "MH");
  assert.equal((await as(ADMIN, "/org/legal-requirements?orgId=" + ORG)).config.formF.values.mode, "ONLINE");
});

test("the Registers page and Admin reach the legal requirements route", async () => {
  const { readFileSync } = await import("node:fs");
  const reg = readFileSync(new URL("../wardsynq/site/pages/registers.js", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../wardsynq/site/pages/admin.js", import.meta.url), "utf8");
  assert.ok(reg.includes('"/org/legal-requirements"') && reg.includes('"/org/legal-requirements" + q'));
  assert.ok(admin.includes("WSQ._legal.render"));
});
