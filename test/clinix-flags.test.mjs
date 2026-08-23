import { test } from "node:test";
import assert from "node:assert";

// Stub localStorage before requiring, matching test/thorex-flags.test.js. `location` is undefined
// in node, so the flags file's search() hits its catch and the query-param path is inert here.
const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const { default: F } = await import("../clinix-flags.js");

test("the master flag is ON by default (owner decision 2026-08-23: testers-only app)", () => {
  assert.equal(F.bool("smd_clinix"), true);
});

test("draft mode is ON by default, because ALL content is ai_drafted", () => {
  // With this off every pathway reads "Awaiting clinical review" and the module is unusable for
  // testers. The per-lesson "Draft, pending clinician review" line and the source citations are
  // what keep it honest, not this flag. Flip to false before any non-tester release.
  assert.equal(F.bool("smd_clinix_draft"), true);
});

test("uncleared media stays OFF - that one is a licence question, not a review question", () => {
  // Unlike the review gate, this cannot be waived by an owner decision: rendering media whose
  // licence is unverified is a rights problem regardless of who the audience is.
  assert.equal(F.bool("smd_clinix_uncleared_media"), false);
});

test("the tutor is OFF by default, so a lesson is deterministic content only", () => {
  assert.equal(F.bool("smd_clinix_tutor"), false);
});

test("viva tier defaults to mbbs, and only accepts the two real values", () => {
  assert.equal(F.get("smd_clinix_viva_tier"), "mbbs");
  assert.equal(F.set("smd_clinix_viva_tier", "pg"), true);
  assert.equal(F.get("smd_clinix_viva_tier"), "pg");
  F.set("smd_clinix_viva_tier", "made-up-tier");   // enum: an out-of-range value is written...
  assert.equal(F.get("smd_clinix_viva_tier"), "mbbs", "...but read back as the default, never as garbage");
});

test("viva voice mode is OFF by default (a per-device student opt-in, never forced on)", () => {
  assert.equal(F.bool("smd_clinix_viva_voice"), false);
});

test("haptics default ON, matching the other modules", () => {
  assert.equal(F.bool("smd_clinix_haptics"), true);
});

test("set flips a flag and it persists", () => {
  F.set("smd_clinix", true);
  assert.equal(F.bool("smd_clinix"), true);
  F.set("smd_clinix", false);
  assert.equal(F.bool("smd_clinix"), false);
});

test("every flag declares a description and a query alias, so it is discoverable", () => {
  for (const k of Object.keys(F.DEFS)) {
    const d = F.DEFS[k];
    assert.ok(d.desc && d.desc.length > 10, `${k} has no usable description`);
    assert.ok(d.query, `${k} has no ?query alias, so it cannot be toggled on a device`);
    assert.ok(k.indexOf("smd_clinix") === 0, `${k} is not namespaced to the module`);
  }
});

test("all() reports every flag", () => {
  const a = F.all();
  assert.deepEqual(Object.keys(a).sort(), Object.keys(F.DEFS).sort());
});

test("an unknown flag reads null rather than throwing", () => {
  assert.equal(F.get("smd_clinix_not_a_flag"), null);
  assert.equal(F.set("smd_clinix_not_a_flag", true), false);
});
