/* Renders the contacts-and-status screen for real. */
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

const SEL = { patientId: "p1", encounterId: "e1", name: "Ramesh Kumar", mrn: "MRN-77", admittedAt: "2026-09-10T08:00:00.000Z" };
const view = (W, people) => W._render({ ...W._st, view: "people", sel: SEL, people });

test("a patient with nobody recorded is told about loudly, not left as an empty list", () => {
  const W = loadWard();
  const html = view(W, { ok: true, people: [], hasEmergencyContact: false, warning: "Nobody is recorded as a contact for this patient." });
  assert.match(html, /Nobody is recorded as a contact/);
  assert.match(html, /Nobody can be telephoned/);
});

test("a contact shows who they are, what they are, and a number that can be dialled", () => {
  const W = loadWard();
  const html = view(W, { ok: true, hasEmergencyContact: true, people: [{
    relatedPersonId: "r1", name: "Sita Kumar", relationship: "spouse", phone: "9876543210",
    nextOfKin: true, guardian: false, emergencyContact: true, active: true,
    recordedBy: "reception.01", recordedAt: "2026-09-12T10:00:00.000Z",
  }] });
  assert.ok(html.includes("Sita Kumar"));
  assert.ok(html.includes("spouse"));
  assert.ok(html.includes('href="tel:9876543210"'), "the number should be dialled, not just read");
  assert.match(html, /next of kin, emergency contact/);
  assert.ok(html.includes('data-w-act="personremove:r1"'));
});

test("a removed contact stays on the screen, marked, with who removed it and why", () => {
  const W = loadWard();
  const html = view(W, { ok: true, people: [{
    relatedPersonId: "r2", name: "Old Contact", relationship: "friend", phone: "1", active: false,
    emergencyContact: true, recordedBy: "reception.01", recordedAt: "2026-09-01T10:00:00.000Z",
    removedBy: "reception.02", removedAt: "2026-09-11T10:00:00.000Z", removedReason: "moved away",
  }] });
  assert.ok(html.includes("Old Contact"), "a removed contact must not vanish");
  assert.ok(html.includes("w-gone"));
  assert.ok(html.includes("removed by reception.02"));
  assert.ok(html.includes("moved away"));
  // Nothing to remove twice.
  assert.ok(!html.includes('data-w-act="personremove:r2"'));
});

test("a deceased patient says so at the top, and the chart is not presented as closed", () => {
  const W = loadWard();
  const html = view(W, { ok: true, people: [], deceased: {
    at: "2026-09-12T10:00:00.000Z", cause: "Septic shock", certifiedBy: "Dr Rao",
    recordedBy: "dr.a", recordedAt: "2026-09-12T12:00:00.000Z",
  } });
  assert.match(html, /recorded as deceased/);
  assert.ok(html.includes("Septic shock"));
  assert.ok(html.includes("certified by Dr Rao"));
  assert.match(html, /chart stays open and readable/);
  // Recording a death is not offered twice; withdrawing it is.
  assert.ok(!html.includes('data-w-act="deathrecord"'));
  assert.ok(html.includes('data-w-act="deathwithdraw"'));
});

test("a withdrawn death is shown as withdrawn, not as if it never happened", () => {
  const W = loadWard();
  const html = view(W, { ok: true, people: [], deceasedCorrected: {
    reason: "wrong patient selected", by: "dr.a", at: "2026-09-12T13:00:00.000Z",
  } });
  assert.match(html, /was withdrawn/);
  assert.ok(html.includes("wrong patient selected"));
  // And recording one is available again.
  assert.ok(html.includes('data-w-act="deathrecord"'));
});

test("recording a death warns before it is offered", () => {
  const W = loadWard();
  const html = view(W, { ok: true, people: [] });
  assert.match(html, /recorded permanently against this patient/);
  assert.match(html, /Check you have the right person/);
});

test("the screen asks for a patient rather than rendering an empty form", () => {
  const W = loadWard();
  const html = W._render({ ...W._st, view: "people", sel: null });
  assert.match(html, /Open a patient first/);
});
