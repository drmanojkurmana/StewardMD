/* test/maik-local-scribe-safety.test.mjs — Item 13d: on-device Scribe safety-rule parity with the
 * server copy (functions/api/ai/_opd-scribe.js, 2026-09-19 negation/time/sources rules).
 *
 * PORTED into maik-local.js's SCRIBE_SYS: the negation rule (a denied symptom is never asserted
 * present) and the time-preservation rule (durations/onset are never dropped, a stopped medicine is
 * not a current one).
 *
 * NOT PORTED: the server's per-field "sources" (verbatim quote) + verifySources/flagContradictions.
 * That is genuinely large for this file's rolling-window architecture — scribeMerge accumulates
 * emrFields/suggestions across many refines but has no equivalent merge for a sources map, and
 * doubling the JSON shape a small on-device model must hold together across every window risks the
 * exact "answered in prose instead of JSON" failure scribeFill already has to recover from. Reported
 * plainly here rather than half-porting it.
 *
 * node --test test/maik-local-scribe-safety.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

function load() {
  const gen = [];
  let reply = () => JSON.stringify({ en: "ok", emrFields: {}, suggestions: {} });
  const Llama = {
    available: async () => ({ available: true, loaded: true, debugBuild: true, availableMemory: 0 }),
    load: async () => ({}),
    generate: async (p) => { gen.push(p); return { text: reply(p) }; },
    release: async () => ({})
  };
  const PACKS = { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true, files: [{ bytes: 1107408704 }] } };
  const models = {
    PACKS, activePack: () => "maik-lite", installedCached: () => true, pathFor: async () => "/m.gguf",
    totalBytes: (id) => PACKS[id].files[0].bytes
  };
  const win = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_MODELS: models, setTimeout, clearTimeout
  };
  win.window = win;
  new Function("window", "document", "setTimeout", "clearTimeout", SRC)(win, { addEventListener() {} }, setTimeout, clearTimeout);
  return { L: win.SMD_MAIK_LOCAL, gen, setReply: (f) => { reply = f; } };
}

test("SCRIBE_SYS: the negation rule — a denied symptom is never written as present", () => {
  const { L } = load();
  assert.match(L.SCRIBE_SYS, /NEGATION AND TIME/i);
  assert.match(L.SCRIBE_SYS, /explicitly DENIED/);
  assert.match(L.SCRIBE_SYS, /NEVER be written as present/);
});

test("SCRIBE_SYS: the time rule — every stated duration/onset must be preserved", () => {
  const { L } = load();
  assert.match(L.SCRIBE_SYS, /Preserve every stated duration and onset/);
});

test("SCRIBE_SYS: a stopped medicine is recorded as discontinued, never as a current home medication", () => {
  const { L } = load();
  assert.match(L.SCRIBE_SYS, /STOPPED is NOT a current medicine/);
  assert.match(L.SCRIBE_SYS, /never as an ongoing home medication/);
});

test("SCRIBE_SYS: sources (verbatim quote per field) deliberately NOT ported — out of scope, reported", () => {
  const { L } = load();
  const schemaLine = L.SCRIBE_SYS.slice(0, L.SCRIBE_SYS.indexOf("\n"));
  assert.equal(/sources/i.test(schemaLine), false, "the on-device JSON schema does not ask for a sources map");
});

test("scribeFill() actually sends SCRIBE_SYS (carrying the ported rules) as the system prompt", async () => {
  const { L, gen } = load();
  await L.scribeFill("Patient denies fever, stopped metformin last month, cough for 3 days.");
  assert.ok(gen.length >= 1, "the fake plugin was called");
  assert.equal(gen[0].system, L.SCRIBE_SYS);
});
