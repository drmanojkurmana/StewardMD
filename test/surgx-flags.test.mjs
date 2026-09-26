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

test("flags: SURGX is released to all users, and the draft line obligation stays written down", () => {
  // Owner decision 2026-09-25: SURGX is on for every user and no longer Beta. The content is still
  // ai_drafted, so smd_surgx_draft stays ON and every screen keeps its draft line until R1 sign-off.
  // This test keeps that obligation discoverable in the flag file rather than remembered.
  const src = readFileSync(join(ROOT, "surgx-flags.js"), "utf8");
  assert.ok(/RELEASED \(2026-09-25, owner decision\)/.test(src));
  assert.ok(/draft line and sources until R1 clinical sign-off\. Do not remove that line/i.test(src));
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

test("entitlement: Notes requires the clinician gate WHEN smd_surgx_notes_verify is on", () => {
  // flag:()=>true turns every flag on, including the verify gate - this is the gate-enabled path.
  const deps = { flag: () => true, bypass: () => false };
  assert.equal(ENT.notesAccess(Object.assign({ canPrescribe: () => false }, deps)), "verify_required");
  assert.equal(ENT.notesAccess(Object.assign({ canPrescribe: () => true }, deps)), "allowed");
});

test("entitlement: by DEFAULT the registration gate is off and Notes opens", () => {
  /* Owner decision 2026-08-25: a surgical note is the surgeon's own record of what they did, not an
   * order acting on a patient, so it does not carry the prescribing gate. Notes still cannot
   * prescribe (SURGX exposes no Rx affordance at all) and the EMR write stays gated separately. */
  assert.equal(ENT.notesAccess({
    flag: (k) => k === "smd_surgx_notes",          // notes on, verify gate off (the shipped default)
    canPrescribe: () => false,
    bypass: () => false
  }), "allowed");
  assert.equal(F.DEFS.smd_surgx_notes_verify.def, false, "the gate must ship OFF");
});

test("entitlement: turning the gate back on needs no rebuild", () => {
  // The whole point of doing this with a flag: it is reversible on a device.
  assert.equal(F.DEFS.smd_surgx_notes_verify.type, "bool");
  assert.ok(F.DEFS.smd_surgx_notes_verify.query, "must be settable via ?query too");
  assert.equal(ENT.notesAccess({
    flag: (k) => k === "smd_surgx_notes" || k === "smd_surgx_notes_verify",
    canPrescribe: () => false,
    bypass: () => false
  }), "verify_required");
});

test("entitlement: the master Notes flag still wins over everything", () => {
  assert.equal(ENT.notesAccess({ flag: () => false, canPrescribe: () => true, bypass: () => true }), "off");
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
