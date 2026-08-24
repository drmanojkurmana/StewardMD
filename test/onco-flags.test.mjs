/* Oncology flag posture + the safety properties that make it defensible.
 *
 * WHY THIS FILE EXISTS (2026-08-24). smd_onco_protolib was re-opened by owner decision, so the
 * experimental draft protocol library is now offered to every user. That is a deliberate call with
 * a concrete justification: kb/protocols holds 124 protocols of which ZERO are lifecycleState:active
 * and 123 are experimental drafts, and opd-emr.js oncoUsable() accepts only active-or-experimental -
 * so with the flag OFF the onco workbench had NO usable protocols at all. The trade was never
 * "verified regimens vs draft ones", it was "draft ones vs an empty library".
 *
 * The properties BELOW are what make that defensible, and they are the ones that must never quietly
 * change. If any of them breaks, the flag should be re-closed - and this file is how you find out.
 *
 * Mirrors the waiver-register approach in test/sknx-flags.test.mjs: record the deliberate posture,
 * then fail when something moves that nobody declared.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = readFileSync(join(ROOT, "queue-flags.js"), "utf8");
const INDEX = JSON.parse(readFileSync(join(ROOT, "kb/protocols/index.json"), "utf8"));
const ITEMS = INDEX.protocols || INDEX.items || [];

/* Flags deliberately defaulted ON, with the reason. Dev/testing posture, owner-approved. */
const DECLARED_ON = {
  smd_onco_home: "read-only reference workbench",
  smd_onco_navigator: "ONCOTREE pathway navigator, R1 GO on all verticals",
  smd_onco_protocols: "treatment-plan engine; writes stay server-gated by QUEUE_ONCO_WRITE",
  smd_onco_staging: "AJCC/TNM staging, read-only",
  smd_onco_tallman: "tall-man lettering, display-only",
  smd_onco_drugview: "oncology drug + interaction view, read-only",
  smd_onco_protoref: "read-only protocol browse",
  smd_onco_ctcae: "CTCAE grading, read-only",
  smd_onco_iotox: "irAE principles, no doses (fail-closed on numerals)",
  smd_onco_recist: "RECIST 1.1 calculator, read-only",
  smd_onco_favorites: "UX only, no clinical content",
  smd_onco_recommend: "protocol recommendation, never auto-selects",
  smd_onco_evidence_overlay: "evidence overlay, records the physician's choice only",
  smd_onco_kb_admin: "admin ingestion, additionally gated server-side",
  smd_onco_protolib: "RE-OPENED 2026-08-24: without it the workbench had zero usable protocols",
};

function defsFrom(src) {
  // Parse the declared defaults straight out of the source, so the test reads what ships rather
  // than whatever a module-load side effect produced.
  const out = {};
  const re = /(smd_onco_[a-z_]+):\s*\{\s*type:\s*"bool",\s*def:\s*(true|false)/g;
  let m;
  while ((m = re.exec(src)) !== null) out[m[1]] = m[2] === "true";
  return out;
}
const DEFS = defsFrom(SRC);

/* ── posture ───────────────────────────────────────────────────────────────── */

test("the flag file parses and declares the oncology flags", () => {
  assert.ok(Object.keys(DEFS).length >= 14, "expected the oncology flag set; got " + Object.keys(DEFS).length);
});

test("every oncology flag defaulted ON is a declared decision, not an accident", () => {
  const on = Object.keys(DEFS).filter(k => DEFS[k]);
  const undeclared = on.filter(k => !DECLARED_ON[k]);
  assert.deepEqual(undeclared, [],
    "defaulted ON but not declared here: " + undeclared.join(", "));
});

test("the register does not rot: nothing is declared ON that now defaults OFF", () => {
  const stale = Object.keys(DECLARED_ON).filter(k => k in DEFS && !DEFS[k]);
  assert.deepEqual(stale, [],
    "declared ON but now defaults OFF - trim the register: " + stale.join(", "));
});

test("smd_onco_protolib is ON, and its definition still states the risk it carries", () => {
  assert.equal(DEFS.smd_onco_protolib, true, "owner decision 2026-08-24");
  const line = SRC.split("\n").find(l => l.indexOf("smd_onco_protolib:") >= 0) || "";
  assert.ok(/PUBLIC-RELEASE-GATE/.test(line), "must keep its release-gate marker");
  assert.ok(/UNVERIFIED/.test(line), "must still say it surfaces UNVERIFIED regimens");
  assert.ok(/EXPERIMENTAL DRAFT/.test(line), "must state that each one is badged");
});

/* ── the properties that make the decision defensible ──────────────────────── */

test("THE JUSTIFICATION HOLDS: the library is still overwhelmingly experimental drafts", () => {
  // If this ever flips - real active protocols appear - the reasoning for opening the flag changes,
  // and someone should revisit it rather than let the flag ride on a stale premise.
  const active = ITEMS.filter(p => p.lifecycleState === "active");
  const experimental = ITEMS.filter(p => p.experimental);
  assert.ok(ITEMS.length >= 100, "expected a populated protocol index");
  assert.equal(active.length, 0,
    "protocols are now lifecycleState:active (" + active.length + ") - revisit whether protolib still needs to be ON");
  assert.ok(experimental.length >= ITEMS.length - 2, "expected nearly all protocols to be experimental drafts");
});

test("SAFETY: promotion never activates - no protocol is both experimental and active", () => {
  const both = ITEMS.filter(p => p.experimental && p.lifecycleState === "active");
  assert.deepEqual(both.map(p => p.id), [],
    "an experimental protocol must never be lifecycleState:active - that would bypass human activation");
});

test("SAFETY: every experimental protocol is lifecycleState:draft, so it renders as a draft", () => {
  const bad = ITEMS.filter(p => p.experimental && p.lifecycleState !== "draft");
  assert.deepEqual(bad.map(p => p.id + ":" + p.lifecycleState), [],
    "an experimental protocol with a non-draft lifecycle would not render the EXPERIMENTAL DRAFT badge");
});

test("SAFETY: the usable-protocol gate still requires active OR experimental, nothing looser", () => {
  // opd-emr.js oncoUsable() is what the flag actually opens. If that predicate ever widens, the
  // flag stops meaning what this file says it means.
  const emr = readFileSync(join(ROOT, "opd-emr.js"), "utf8");
  const line = emr.split("\n").find(l => l.indexOf("function oncoUsable") >= 0) || "";
  assert.ok(line, "oncoUsable() not found in opd-emr.js");
  assert.ok(/lifecycleState === "active"/.test(line), "must still require active...");
  assert.ok(/oncoProtoLibOn\(\) && p\.experimental/.test(line), "...or experimental behind the flag");
});

test("SAFETY: writes stay doubly gated regardless of any client flag", () => {
  // The client default alone must never be able to write a plan.
  assert.ok(/QUEUE_ONCO_WRITE/.test(SRC), "the server write gate must still be documented here");
  assert.ok(/doubly gated|DOUBLY gated/.test(SRC), "the double-gating note must survive");
});
