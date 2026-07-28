// FollowCare AI — doctor module (followcare.js) view-model + API-client unit tests (Phase 1).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = r => vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r });

// Minimal browser-ish globals so the IIFE loads headless. No DOM is exercised by these tests
// (they cover the pure view-model layer + the API client, which only needs fetch + firebase stubs).
globalThis.window = globalThis;
globalThis.document = { head: { appendChild() {} }, body: { appendChild() {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, style: {}, }) };
load("followcare-pathways.js");
load("followcare.js");
const FC = globalThis.FollowCare;

test("validateEnroll: rejects missing pathway + bad phone; accepts + normalises a good form", () => {
  const bad = FC.validateEnroll({ phone: "123" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.pathwayId && bad.errors.phone);
  const good = FC.validateEnroll({ pathwayId: "pneumonia", phone: "+91 98765 43210", name: "  Ramesh  " });
  assert.equal(good.ok, true);
  assert.equal(good.value.phone, "919876543210");   // digits only
  assert.equal(good.value.name, "Ramesh");           // trimmed
  assert.equal(good.value.pathwayId, "pneumonia");
});

test("validateEnroll: invalid discharge date is rejected", () => {
  const r = FC.validateEnroll({ pathwayId: "pneumonia", phone: "9876543210", dischargeMs: "not-a-date" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.dischargeMs);
});

test("escalationMeta: ranks red>orange>yellow>green>pending", () => {
  assert.ok(FC.escalationMeta("red").rank > FC.escalationMeta("orange").rank);
  assert.ok(FC.escalationMeta("orange").rank > FC.escalationMeta("yellow").rank);
  assert.ok(FC.escalationMeta("yellow").rank > FC.escalationMeta("green").rank);
  assert.equal(FC.escalationMeta("nonsense").label, "Pending");
});

test("sortEpisodes: worst escalation first, then soonest due", () => {
  const list = [
    { episodeId: "a", escalation: "green", nextDueMs: 100 },
    { episodeId: "b", escalation: "red", nextDueMs: 500 },
    { episodeId: "c", escalation: "orange", nextDueMs: 50 },
    { episodeId: "d", escalation: "green", nextDueMs: 40 },
  ];
  const ids = FC.sortEpisodes(list).map(e => e.episodeId);
  assert.deepEqual(ids, ["b", "c", "d", "a"]);
});

test("counts: tallies by escalation", () => {
  const c = FC.counts([{ escalation: "red" }, { escalation: "red" }, { escalation: "green" }, { escalation: "" }]);
  assert.equal(c.red, 2); assert.equal(c.green, 1); assert.equal(c.total, 4);
});

test("fmtWhen: relative time both directions", () => {
  const now = 1_000_000_000_000;
  assert.equal(FC.fmtWhen(0, now), "—");
  assert.equal(FC.fmtWhen(now + 2 * 86400000, now), "in 2d");
  assert.equal(FC.fmtWhen(now - 3 * 86400000, now), "3d ago");
  assert.equal(FC.fmtWhen(now + 1800000, now), "now");
});

test("enrollError: maps server codes to safe clinician copy", () => {
  assert.match(FC.enrollError("bad_phone"), /mobile number/i);
  assert.match(FC.enrollError("signin_required"), /sign in/i);
  assert.match(FC.enrollError("weird"), /link/i);
});

test("API client: attaches Bearer token + hits the right path", async () => {
  const calls = [];
  globalThis.firebase = { auth: () => ({ currentUser: { getIdToken: () => Promise.resolve("TOK123") } }) };
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ json: () => Promise.resolve({ ok: true, episodes: [] }) }); };
  const res = await FC._api.episodes();
  assert.equal(res.body.ok, true);
  assert.equal(calls[0].url, "/api/followcare/episodes");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer TOK123");

  await FC._api.enroll({ pathwayId: "pneumonia", phone: "919876543210" });
  const enroll = calls[1];
  assert.equal(enroll.url, "/api/followcare/enroll");
  assert.equal(enroll.opts.method, "POST");
  assert.equal(JSON.parse(enroll.opts.body).pathwayId, "pneumonia");
});
