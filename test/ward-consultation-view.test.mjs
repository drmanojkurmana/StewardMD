/* Renders the consultation screen for real, in a stub DOM, and checks the things that only break
 * in a browser: that a half-filled form survives a repaint, and that the dropdowns come back with
 * what was chosen rather than snapping to their first option. node --check cannot see any of this. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadWard() {
  const src = readFileSync(fileURLToPath(new URL("../ward.js", import.meta.url)), "utf8");
  const sandbox = {
    navigator: { userAgent: "node" },
    location: { hash: "", href: "" },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
      addEventListener() {}, body: { appendChild() {} },
      querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => "", setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, console, Promise,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.WARD;
}

const SEL = { patientId: "p1", encounterId: "e1", name: "Test Patient", ward: "A", admittedAt: "2026-09-12T09:00:00Z" };

test("the consultation screen renders every section", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "consultation", sel: SEL, templates: [] });
  for (const heading of ["Observations", "Diagnosis", "Prescription", "Test to order", "Note"]) {
    assert.ok(html.includes(heading), "missing section: " + heading);
  }
  assert.ok(html.includes('data-w-act="consultationsave"'), "no save button");
});

test("a half-filled consultation survives a repaint", () => {
  const W = loadWard();
  const st = {
    ...W._st, view: "consultation", sel: SEL, templates: [],
    cDraft: { wc_pulse: "104", wcProbText: "Community acquired pneumonia", wcMoDrug: "Amoxicillin", wcNoteText: "Chest clear on the left." },
  };
  const html = W._render(st);
  assert.ok(html.includes('value="104"'), "the pulse was lost");
  assert.ok(html.includes("Community acquired pneumonia"), "the diagnosis was lost");
  assert.ok(html.includes('value="Amoxicillin"'), "the drug was lost");
  assert.ok(html.includes("Chest clear on the left."), "the note was lost");
});

test("a dropdown comes back with what was chosen, not its first option", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "consultation", sel: SEL, templates: [], cDraft: { wc_o2: "1", wcProbVs: "confirmed" } });
  // "On oxygen" must be the selected one - a select rebuilt without this silently reads back as
  // "not recorded", which turns a patient on oxygen into one who is not.
  assert.match(html, /<option value="1" selected>On oxygen<\/option>/);
  assert.match(html, /<option value="confirmed" selected>Confirmed<\/option>/);
});

test("the screen asks for a patient rather than rendering an empty form", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "consultation", sel: null });
  assert.match(html, /Open a patient first/);
});

test("a refused consultation names every piece that was refused, and says nothing was written", () => {
  const W = loadWard();
  const html = W._render({
    ...W._st, view: "consultation", sel: SEL, templates: [],
    consultationResult: { ok: false, status: 403, written: 0, allowed: ["vitals"],
      refused: [{ piece: "medications", resourceType: "MedicationOrder", detail: "This role may not write the prescription." }] },
  });
  assert.match(html, /nothing was written/i);
  assert.ok(html.includes("This role may not write the prescription."));
});

test("a consultation that failed says nothing is on the chart, names the part, and keeps what was typed", () => {
  const W = loadWard();
  const html = W._render({
    ...W._st, view: "consultation", sel: SEL, templates: [],
    consultationResult: { ok: false, status: 422, error: "consultation_not_saved", written: 0,
      detail: "Nothing from this consultation was saved, because the problem list could not be. Fix that part and save again.",
      failedAt: "problems", notAttempted: ["medications", "note"],
      results: [{ piece: "vitals", ok: true }, { piece: "problems", ok: false, error: "version_conflict" }] },
  });
  assert.match(html, /Not saved - nothing from this consultation is on the chart/);
  assert.match(html, /because the problem list could not be/);
  assert.match(html, /The part that failed:<\/b> problems/);
  assert.match(html, /problems: version_conflict/);
  assert.ok(!/On the chart now/.test(html), "there is no partial state to describe any more");
});

test("a failure with no per-piece detail (a conflict at commit) is still shown, never a blank", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "consultation", sel: SEL, templates: [],
    consultationResult: { ok: false, status: 409, error: "consultation_conflict", written: 0, detail: "Someone else changed this chart while you were writing. Nothing from this consultation was saved; reload and save again." } });
  assert.match(html, /Not saved/);
  assert.match(html, /Someone else changed this chart/);
});

test("the approvals screen renders a chain, including one that was taken back", () => {
  const W = loadWard();
  const html = W._render({
    ...W._st, view: "approvals",
    approvals: [{
      verificationId: "v1", subjectType: "RestrictedMedication", subjectId: "Meropenem",
      state: "pending", approvals: 0, required: 1, withdrawn: true, reason: "resistant organism",
      history: [
        { id: "v1", kind: "request", by: "dr.a", at: "2026-09-12T10:00:00Z", reason: "resistant organism" },
        { id: "v2", kind: "decision", decision: "approved", by: "micro.b", at: "2026-09-12T10:05:00Z" },
        { id: "v3", kind: "decision", decision: "withdrawn", by: "micro.b", at: "2026-09-12T11:00:00Z" },
      ],
    }],
  });
  assert.ok(html.includes("Meropenem"));
  assert.match(html, /waiting/);
  assert.match(html, /something was taken back/);
  // The approval that happened is still shown, because it happened.
  assert.match(html, /approved by micro\.b/);
});

test("purchasing shows a part-delivered order and names an over-delivery", () => {
  const W = loadWard();
  const html = W._render({
    ...W._st, view: "purchasing",
    purchaseOrders: [{
      purchaseOrderId: "po-1", vendor: "Acme", raisedBy: "store.a", raisedAt: "2026-09-12T09:00:00Z",
      state: "part-received", approval: { state: "approved", approvals: 1, required: 1 },
      lines: [
        { item: "Paracetamol", ordered: 100, received: 130, unit: "box", over: 30 },
        { item: "Amoxicillin", ordered: 50, received: 0, unit: "box" },
      ],
    }],
  });
  assert.match(html, /part delivered/);
  assert.match(html, /30 more than ordered/);
  assert.ok(html.includes("130 of 100 box"));
});
