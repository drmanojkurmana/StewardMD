/* The doctor workspace, rendered for real.
 *
 * The assertion that matters most here is the one about NOT loaded versus empty: an empty allergy
 * box reads as "no known allergies" to every clinician alive, and a screen that renders a failed
 * load as blank calm is the most dangerous thing in this file. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sandbox = {
    navigator: { userAgent: "node" }, location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} }, querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise, Date,
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

const SEL = { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar", mrn: "MRN-77", ward: "Ward A", bed: "3", admittedAt: "2026-09-10T08:00:00.000Z" };

const TIMELINE = [
  { at: "2026-09-12T09:00:00.000Z", resourceType: "AllergyIntolerance", id: "al1", category: "allergy",
    label: "nurse.b recorded an allergy: Penicillin (severe)" },
  { at: "2026-09-12T11:00:00.000Z", resourceType: "DiagnosticReport", id: "dr1", category: "result",
    label: "Result: Potassium — final", critical: true },
  { at: "2026-09-12T09:11:00.000Z", resourceType: "ServiceRequest", id: "sr2", category: "investigation",
    label: "dr.mehta ordered Chest X-ray — active", reportReady: false },
  { at: "2026-09-12T10:00:00.000Z", resourceType: "ClinicalNote", id: "n1", category: "note",
    label: "dr.mehta wrote a progress note, signed",
    body: [{ heading: "assessment", text: "Community acquired pneumonia, right base." }] },
];

const LOADED = {
  view: "workspace", sel: SEL,
  timeline: TIMELINE,
  problems: [{ display: "Community acquired pneumonia", clinicalStatus: "active", verificationStatus: "confirmed" },
             { display: "Old fracture", clinicalStatus: "resolved" }],
  criticals: [{ code: "K", display: "Potassium", value: 6.9, unit: "mmol/L", state: "open" },
              { code: "Na", display: "Sodium", value: 120, state: "acknowledged" }],
  activeMeds: [{ drug: "Co-amoxiclav", dose: { value: 1.2, unit: "g" }, route: "iv", frequency: "TDS" }],
  news2: { total: 8, incomplete: false },
  people: { ok: true, people: [{ active: true, emergencyContact: true }], hasEmergencyContact: true },
};

const view = (W, extra) => W._render({ ...W._st, ...LOADED, ...extra });

test("the workspace shows the things that change what a prescriber may safely do", () => {
  const W = loadWard();
  const html = view(W);
  assert.ok(html.includes("Penicillin"), "allergies are missing");
  assert.ok(html.includes("Potassium"), "the critical result is missing");
  assert.ok(html.includes("Co-amoxiclav"), "current medicines are missing");
  assert.ok(html.includes("Community acquired pneumonia"), "active problems are missing");
});

test("only OUTSTANDING criticals and UNRESOLVED problems are shown as live", () => {
  const W = loadWard();
  const html = view(W);
  assert.ok(html.includes("Potassium"), "an open critical belongs here");
  assert.ok(!html.includes("Sodium"), "an acknowledged critical is not outstanding");
  assert.ok(!html.includes("Old fracture"), "a resolved problem is not an active problem");
});

test("A BLOCK THAT DID NOT LOAD SAYS SO, and never renders as blank calm", () => {
  const W = loadWard();
  // The chart read failed: timeline, problems, criticals and meds are all unloaded.
  const html = W._render({ ...W._st, view: "workspace", sel: SEL, timeline: null, problems: null, criticals: null, activeMeds: null, people: null });
  const warnings = html.split("Do not read this as empty").length - 1;
  assert.ok(warnings >= 5, "expected every unloaded block to warn, got " + warnings);
  // And it must NOT say the reassuring thing.
  assert.ok(!html.includes("None recorded."), "an unloaded allergy block must never read as 'none recorded'");
});

test("an empty-but-loaded block reads as empty, because that is the truth", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "workspace", sel: SEL, timeline: [], problems: [], criticals: [], activeMeds: [], news2: null, people: { ok: true, people: [], hasEmergencyContact: false } });
  assert.ok(html.includes("None recorded."), "a genuinely empty list should say so");
  assert.ok(!html.includes("Do not read this as empty"), "a loaded block must not warn");
});

test("a patient with nobody to telephone is flagged on the workspace, not just on the contacts screen", () => {
  const W = loadWard();
  const html = view(W, { people: { ok: true, people: [], hasEmergencyContact: false } });
  assert.match(html, /Nobody can be telephoned/);
});

test("a deceased patient is stated before anything else on the screen", () => {
  const W = loadWard();
  const html = view(W, { people: { ok: true, people: [], hasEmergencyContact: false, deceased: { at: "2026-09-12T10:00:00.000Z" } } });
  assert.match(html, /recorded as deceased/);
  // Before the blocks, so it cannot be missed.
  assert.ok(html.indexOf("recorded as deceased") < html.indexOf("Allergies"));
});

test("an incomplete early warning score says it is incomplete rather than reading as reassuring", () => {
  const W = loadWard();
  const html = view(W, { news2: { total: 2, incomplete: true } });
  assert.match(html, /incomplete - some observations were never recorded/);
});

test("a test still waiting for its result is listed as waiting", () => {
  const W = loadWard();
  const html = view(W);
  assert.ok(html.includes("Chest X-ray"));
  assert.ok(html.includes("waiting"));
});

test("the workspace leads straight into doing something, without another menu", () => {
  const W = loadWard();
  const html = view(W);
  assert.ok(html.includes('data-w-act="consultation"'), "no way to start a consultation");
  assert.ok(html.includes('data-w-act="timeline"'), "no way into the full history");
  assert.ok(html.includes('data-w-act="people"'), "no way into contacts");
});

test("the screen asks for a patient rather than rendering an empty shell", () => {
  const W = loadWard();
  assert.match(W._render({ ...W._st, view: "workspace", sel: null }), /Open a patient first/);
});
