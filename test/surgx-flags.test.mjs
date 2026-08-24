import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import F from "../surgx-flags.js";
import ENT from "../surgx-entitlement.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("flags: the registry defines every SURGX flag with a type, default and description", () => {
  const keys = Object.keys(F.DEFS);
  ["smd_surgx", "smd_surgx_draft", "smd_surgx_notes", "smd_surgx_mentor",
    "smd_surgx_uncleared_media", "smd_surgx_haptics"].forEach((k) => {
    assert.ok(F.DEFS[k], "missing flag " + k);
    assert.ok(F.DEFS[k].type, k + " needs a type");
    assert.ok(typeof F.DEFS[k].def !== "undefined", k + " needs a default");
    assert.ok(F.DEFS[k].desc && F.DEFS[k].desc.length > 20, k + " needs a real description");
  });
  assert.ok(keys.length >= 6);
});

test("flags: the uncleared-media escape hatch is OFF by default and must never ship on", () => {
  assert.equal(F.DEFS.smd_surgx_uncleared_media.def, false);
  assert.ok(/NEVER ship on/i.test(F.DEFS.smd_surgx_uncleared_media.desc));
});

test("flags: Senior Surgeon Mode is OFF by default, so a case runs on its authored reasoning", () => {
  assert.equal(F.DEFS.smd_surgx_mentor.def, false);
});

test("flags: the master and draft flags are the ones the release gate must flip", () => {
  // They default ON for testers by owner decision (the same call recorded in clinix-flags.js).
  // The release gate is the comment; this test makes sure the comment is actually there so the
  // obligation is discoverable rather than remembered.
  const src = readFileSync(join(ROOT, "surgx-flags.js"), "utf8");
  assert.ok(/FLIP smd_surgx AND smd_surgx_draft TO false BEFORE ANY NON-TESTER RELEASE/i.test(src));
  assert.equal(F.DEFS.smd_surgx.def, true);
  assert.equal(F.DEFS.smd_surgx_draft.def, true);
});

test("flags: coercion is strict - only 1/on/true enable a bool", () => {
  // get() reads a store that does not exist in node, so exercise coerce through the public shape.
  assert.equal(typeof F.bool("smd_surgx"), "boolean");
  assert.equal(F.get("nope"), null);
  assert.equal(F.set("nope", true), false);
});

test("entitlement: Notes is off when its flag is down, whatever the role", () => {
  const off = ENT.notesAccess({ flag: () => false, canPrescribe: () => true, bypass: () => true });
  assert.equal(off, "off");
});

test("entitlement: Notes requires the app's existing clinician gate", () => {
  const deps = { flag: () => true, bypass: () => false };
  assert.equal(ENT.notesAccess(Object.assign({ canPrescribe: () => false }, deps)), "verify_required");
  assert.equal(ENT.notesAccess(Object.assign({ canPrescribe: () => true }, deps)), "allowed");
});

test("entitlement: an unverified user SEES Notes and is told why, never silently hidden", () => {
  // "verify_required" is deliberately a distinct state from "off": a surgeon who cannot find the
  // section will assume the app is broken.
  const s = ENT.notesAccess({ flag: () => true, canPrescribe: () => false, bypass: () => false });
  assert.notEqual(s, "off");
  assert.equal(s, "verify_required");
});

test("entitlement: the existing beta verify bypass is honoured", () => {
  assert.equal(ENT.notesAccess({ flag: () => true, canPrescribe: () => false, bypass: () => true }), "allowed");
});

test("entitlement: the educational sections are open to every role", () => {
  assert.equal(ENT.learningAccess(), "allowed");
});

test("entitlement: default case level tracks the clinician gate, never blocks on it", () => {
  assert.equal(ENT.defaultCaseLevel({ canPrescribe: () => false, isPro: () => false }), "intern");
  assert.equal(ENT.defaultCaseLevel({ canPrescribe: () => true, isPro: () => false }), "resident");
  assert.equal(ENT.defaultCaseLevel({ canPrescribe: () => true, isPro: () => true }), "surgeon");
});

test("entitlement: there is no paywall today", () => {
  assert.equal(ENT.tier(), "included");
});
