/* test/abdm-merge-invariants.test.mjs — what the feat/abdm-v3-reconcile merge into wardsynq-product must keep true.
 *
 * Owner decision A3 (2026-09-14) merged two ABDM implementations. Each invariant below is one collision the
 * merge resolved (docs/emr-gap-analysis/S6_ABDM_INTEGRATION_DESIGN.md section 1.3), pinned so a later edit
 * cannot quietly reopen it:
 *   one SCCM version, one gateway env scheme, a consent request that names the doctor, Immunization and
 *   Invoice landable (and landed as the chart's own types), no ABDM vars in the deploy config, production
 *   ABDM traffic refused (A2), the branch's Fidelius derivation, and the A5 desk role rule.
 *
 * node --test test/abdm-merge-invariants.test.mjs
 */
import { registerHooks } from "node:module";
// The queue router reaches data/interaction-rules.json; Node wants the attribute the Worker bundler adds.
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { SCCM_VERSION, RESOURCE_KEYS, bundle } from "../functions/_connect/canonical/model.js";
import { abdmConfig } from "../functions/_connect/abdm/config.js";
import { makeGateway, ENDPOINTS, AbdmError } from "../functions/_connect/abdm/gateway.js";
import { LANDABLE, landNdhmDocuments } from "../functions/_wardsynq/abdm-land.js";
import { mapSccmBundle } from "../wardsynq/adapters/wardsynq-sccm-adapter.js";
import { serializeNdhm } from "../functions/_connect/connectors/abdm/serialize.js";
import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { immunizationRecord, invoiceRecord } from "./connect/abdm/fixtures/sccm-records.mjs";
import { abhaDeskCan, ABHA_DESK_ROLES } from "../functions/_queue_roles.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...jsFiles(rel));
    else if (/\.js$/.test(name)) out.push(rel);
  }
  return out;
}
const FUNCTIONS = jsFiles("functions");

test("one SCCM version: 1.1, declared once, carrying all five optional collections", () => {
  assert.equal(SCCM_VERSION, "1.1");
  const declared = FUNCTIONS.filter((f) => /export const SCCM_VERSION\s*=/.test(read(f)));
  assert.deepEqual(declared, ["functions/_connect/canonical/model.js"], "exactly one declaration");
  const b = bundle({});
  for (const k of ["administrations", "serviceRequests", "consents", "immunizations", "invoices"]) {
    assert.ok(RESOURCE_KEYS.includes(k), k + " is a resource key");
    assert.deepEqual(b[k], [], k + " is on the bundle");
  }
});

test("one gateway env scheme: ABDM_ENV host-only bases, nothing reads ABDM_GATEWAY_URL, no doubled path", async () => {
  for (const f of FUNCTIONS) assert.ok(!/env\s*(&&\s*env)?\.ABDM_GATEWAY_URL/.test(read(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")), f + " reads the retired ABDM_GATEWAY_URL");
  const cfg = abdmConfig({});
  assert.equal(cfg.envName, "sandbox");
  assert.equal(new URL(cfg.gatewayBase).pathname, "/", "the base is a host, never a path");
  for (const [k, p] of Object.entries(ENDPOINTS)) assert.ok(p.startsWith("/api/"), k + " is absolute from the host root");
  const urls = [];
  const gw = makeGateway({ baseUrl: cfg.gatewayBase, cmId: cfg.cmId, hiuId: cfg.hiuId, clientId: cfg.clientId,
    kv: { get: async () => null, put: async () => {} }, secrets: { get: async (n) => (n === "ABDM_CLIENT_SECRET" ? "s" : null) },
    fetch: async (u, init) => { urls.push({ u: String(u), body: init && init.body }); return { ok: true, status: 202, json: async () => ({ accessToken: "t", expiresIn: 600 }) }; } });
  await gw.post("consentInit", {});
  assert.equal(urls[0].u, "https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions");
  assert.equal(urls[1].u, "https://dev.abdm.gov.in/api/hiecm/consent/v3/request/init");
  assert.equal(JSON.parse(urls[0].body).clientId, "SBXID_062379", "the sandbox bridge id comes from code, not a deploy var");
});

test("the consent route sends the doctor's registration number as requester (behaviour: wardsynq-abdm-hiu-routes test 12)", () => {
  const src = read("functions/api/connect/[[path]].js");
  const at = src.indexOf('path === "/abdm/hiu/consent-request"');
  const block = src.slice(at, src.indexOf('path === "/abdm/hiu/data-request"'));
  assert.ok(block.includes("resolveClinicalActor("), "the requester is the signed-in doctor, resolved server-side");
  assert.ok(/identifier: \{ type: "REGNO", value: regNo/.test(block));
  assert.ok(block.indexOf('"requester_registration_required"') < block.indexOf("requestConsent("), "refused before any gateway call");
  assert.ok(/requestConsent\([\s\S]*requester \}\)/.test(block), "and passed to requestConsent");
});

test("LANDABLE includes Immunization and Invoice, and they land as the chart's own types", async () => {
  assert.ok(LANDABLE.includes("Immunization"));
  assert.ok(LANDABLE.includes("Invoice"));

  const m = mapSccmBundle(immunizationRecord);
  const imm = m.entities.filter((e) => e.resourceType === "Immunization");
  assert.equal(imm.length, 1, "one Immunization record, the type immunization.js writes");
  assert.equal(imm[0].vaccine, "Rotavirus vaccine");
  assert.equal(imm[0].vaccineCodeSystem, "http://snomed.info/sct");
  assert.equal(imm[0].status, "completed");
  assert.equal(imm[0].primarySource, false, "another facility's account, not this hospital's evidence");
  assert.equal(imm[0].meta.source.system, "stewardmd");

  const inv = mapSccmBundle(invoiceRecord).entities;
  assert.equal(inv.filter((e) => e.resourceType === "Invoice").length, 0, "never filed as this hospital's bill");
  const note = inv.find((e) => e.resourceType === "ClinicalNote" && e.noteType === "external-invoice");
  assert.ok(note, "filed as an external note");
  assert.equal(note.sections.invoice.identifierValue, "GIMSR/2026/000123", "kept verbatim");

  // End to end through the real landing: NDHM document -> consume tail -> adapter -> governed store.
  const ctx = { now: () => new Date("2026-08-19T00:00:00.000Z"), tenant: { id: "t1" }, hipId: "IN2810006668", envName: "sandbox" };
  const repository = new MemoryRepository();
  const out = await landNdhmDocuments({}, { repository, pseudonym: async () => null }, {
    tenantId: "t1", transactionId: "txn-merge-1", consent: { purpose: { code: "CAREMGT" }, actor: "fb:doctor" },
    documents: [serializeNdhm(ctx, { ...immunizationRecord, profile: "ImmunizationRecord" }), serializeNdhm(ctx, { ...invoiceRecord, profile: "InvoiceRecord" })],
  });
  assert.equal(out.refused, 0, JSON.stringify(out.results));
  assert.equal(((await repository.latestByType("t1", "Immunization", 10)) || []).length, 1, "the vaccination is on the chart");
  assert.equal(((await repository.latestByType("t1", "Invoice", 10)) || []).length, 0, "no external bill in this hospital's billing");
  const notes = (await repository.latestByType("t1", "ClinicalNote", 20)) || [];
  assert.equal(notes.filter((n) => n.noteType === "external-invoice").length, 1, "the bill is on the chart, marked as another facility's");
});

test("the deploy config carries no ABDM vars (bindings at limit; sandbox identity lives in code)", () => {
  const toml = read("wrangler.toml");
  assert.ok(!/^\s*ABDM_[A-Z_]+\s*=/m.test(toml), "an ABDM_* var is set in wrangler.toml");
});

test("production ABDM traffic is refused (owner A2) and never inherits the sandbox identity", async () => {
  const prod = abdmConfig({ ABDM_ENV: "production" });
  assert.ok(prod.trafficHeld);
  assert.equal(prod.clientId, "");
  assert.equal(prod.hipId, "");
  assert.equal(prod.hiuId, "");
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ accessToken: "t", expiresIn: 600 }) }; };
  const kv = { get: async () => null, put: async () => {} }, secrets = { get: async () => "x" };
  await assert.rejects(() => makeGateway({ baseUrl: prod.gatewayBase, trafficHeld: prod.trafficHeld, fetch, kv, secrets }).post("consentInit", {}), AbdmError);
  // A gateway built by hand at the production host, with no config flag, is refused too.
  await assert.rejects(() => makeGateway({ baseUrl: "https://apis.abdm.gov.in", fetch, kv, secrets }).session(), /India-region hosting/);
  assert.equal(calls, 0, "not one request left for production");
});

test("the Fidelius key derivation is the branch's proven one (HKDF over the Weierstrass x)", () => {
  const src = read("functions/_connect/abdm/fidelius.js");
  assert.ok(src.includes("montgomeryUToWeierstrassX("), "sharedSecret converts X25519's Montgomery u to the Weierstrass x");
});

test("GET /api/queue/vaccines serves the immunisation picker without a session (it sat unreachable inside the POST block)", async () => {
  const { onRequest } = await import("../functions/api/queue/[[path]].js");
  const res = await onRequest({ request: new Request("https://stewardmd.in/api/queue/vaccines"), env: { QUEUE_ENABLED: "1" }, waitUntil: () => {} });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.catalogue) ? j.catalogue.length : Object.keys(j.catalogue).length, "the IG value set is returned");
  // The write stays behind a session: an immunization timeline entry with no sign-in is refused.
  const post = await onRequest({ request: new Request("https://stewardmd.in/api/queue/timeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "immunization", ticketId: "t1" }) }), env: { QUEUE_ENABLED: "1" }, waitUntil: () => {} });
  assert.equal(post.status, 401);
});

test("A5: billing and front desk may create an ABHA as well as verify; roles that register nobody may do neither", () => {
  for (const role of ["reception", "cashier", "billing"]) {
    assert.equal(abhaDeskCan(role, "create"), true, role + " create");
    assert.equal(abhaDeskCan(role, "verify"), true, role + " verify");
  }
  for (const role of ["pharmacy", "lab", "radiographer", "hr", "him", "viewer", "", null]) {
    assert.equal(abhaDeskCan(role, "create"), false, String(role));
    assert.equal(abhaDeskCan(role, "verify"), false, String(role));
  }
  assert.equal(abhaDeskCan("reception", "delete"), false, "an unknown action is refused");
  assert.ok(Object.isFrozen(ABHA_DESK_ROLES.create));
});
