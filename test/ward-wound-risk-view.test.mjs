/* Wound care and risk assessment, rendered for real.
 *
 * The assertions that matter: a wound's WORST stage must stay visible even when today's reading is
 * better, and where it came from must be presented as fixed. Both are guarantees the module makes
 * and a screen could quietly undo. */
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

const SEL = { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar" };
const wound = (W, d) => W._render({ ...W._st, view: "wounds", sel: SEL, wounds: d });
const risk = (W, d, tools, extra) => W._render({ ...W._st, view: "risks", sel: SEL, risks: d, riskTools: tools, ...extra });

test("A WOUND'S WORST STAGE STAYS VISIBLE even when today's reading is better", () => {
  const W = loadWard();
  const html = wound(W, { ok: true, acquiredHere: 0, wounds: [{
    woundId: "w1", site: "Sacrum", kind: "pressure", stage: "2", worstStage: "4",
    origin: "present-on-admission", assessments: 3,
    firstAssessedAt: "2026-09-01T10:00:00.000Z", lastAssessedAt: "2026-09-13T10:00:00.000Z",
  }] });
  assert.ok(html.includes("stage 2"), "today's reading should show");
  assert.match(html, /worst it has been: stage 4/, "a wound that reached stage 4 must not read as stage 2");
});

test("a wound that developed here is flagged, and counted at the top", () => {
  const W = loadWard();
  const html = wound(W, { ok: true, acquiredHere: 1, wounds: [{
    woundId: "w1", site: "Heel", kind: "pressure", stage: "3", worstStage: "3",
    origin: "acquired-here", assessments: 1,
    firstAssessedAt: "2026-09-12T10:00:00.000Z", lastAssessedAt: "2026-09-12T10:00:00.000Z",
  }] });
  assert.match(html, /developed here/);
  assert.match(html, /1 wound developed here/);
});

test("the form says where-it-came-from is fixed and a worse stage is never lowered", () => {
  const W = loadWard();
  const html = wound(W, { ok: true, acquiredHere: 0, wounds: [] });
  assert.match(html, /set the first time it is charted and cannot be changed/);
  assert.match(html, /never lowered by a later reading/);
  assert.ok(html.includes('id="wWdSite"'));
});

test("a wound list that has not loaded says loading, not 'none charted'", () => {
  const W = loadWard();
  const html = wound(W, null);
  assert.match(html, /Loading/);
  assert.ok(!html.includes("No wounds charted"));
});

test("A HOSPITAL WITH NO RISK TOOLS IS TOLD IT IS A SETTING, not an all-clear", () => {
  const W = loadWard();
  const html = risk(W, { ok: true, assessments: [] }, { tools: [] });
  assert.match(html, /configured no risk tools/);
  assert.match(html, /not an assessment that everything is fine/);
});

test("a high-risk assessment with an overdue reassessment says both", () => {
  const W = loadWard();
  const html = risk(W, { ok: true, assessments: [{
    assessmentId: "a1", toolId: "falls", toolName: "Falls risk", score: 9, band: "high",
    assessedAt: "2026-09-10T10:00:00.000Z", assessedBy: "nurse.a",
    reassessment: { due: true }, actions: [{ action: "Bed rails up" }],
  }] }, { tools: [{ id: "falls", name: "Falls risk" }] });
  assert.ok(html.includes("Falls risk"));
  assert.ok(html.includes("score 9"));
  assert.match(html, /high/);
  assert.match(html, /reassessment overdue/);
  assert.ok(html.includes('data-w-act="riskdone:a1~Bed rails up"'), "an outstanding action needs a way to complete it");
});

test("an action already completed offers nothing to do", () => {
  const W = loadWard();
  const html = risk(W, { ok: true, assessments: [{
    assessmentId: "a1", toolId: "falls", toolName: "Falls risk", band: "low",
    assessedAt: "2026-09-10T10:00:00.000Z",
    actions: [{ action: "Bed rails up", completedAt: "2026-09-10T11:00:00.000Z" }],
  }] }, { tools: [] });
  assert.ok(!html.includes('data-w-act="riskdone:'), "a completed action needs no button");
});

test("the tool's own questions are rendered, and the screen scores nothing itself", () => {
  const W = loadWard();
  const html = risk(W, { ok: true, assessments: [] }, { tools: [{ id: "falls", name: "Falls risk" }] },
    { riskForm: { id: "falls", name: "Falls risk", questions: [
      { key: "history", text: "Has fallen before?", options: [{ key: "yes", label: "Yes", value: 1 }, { key: "no", label: "No", value: 0 }] },
      { key: "meds", text: "Number of sedating medicines" },
    ] } });
  assert.ok(html.includes("Has fallen before?"));
  assert.ok(html.includes('id="wRq_history"'));
  assert.ok(html.includes('id="wRq_meds"'));
  assert.match(html, /Nothing here scores anything itself/);
  assert.match(html, /recorded as unanswered/);
});

test("both screens ask for a patient rather than rendering a dead form", () => {
  const W = loadWard();
  assert.match(W._render({ ...W._st, view: "wounds", sel: null }), /Open a patient first/);
  assert.match(W._render({ ...W._st, view: "risks", sel: null }), /Open a patient first/);
});
