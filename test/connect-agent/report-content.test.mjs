// test/connect-agent/report-content.test.mjs -- THE REPORT-CONTENT CHECK.
//   node --test test/connect-agent/report-content.test.mjs
//
// The owner authorized the brain to read a report's WORDS (2026-09-15) for one question only: is a
// proven "radiology" call returning a radiology report, a lab sheet, or just the patient's name and
// address? These tests hold the two halves of that contract:
//   the phone   (scrubExcerpt)  -- a person cannot survive the scrub, but the prose must
//   the server  (phiGate)       -- whatever the phone sends, a patient in it is refused, not forwarded
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubExcerpt } from "../../connect-agent/phone/deep-crawl.mjs";
import { narrativeExcerpt, identityValues } from "../../connect-agent/phone/prove.mjs";
import { phiGate, askBrain } from "../../functions/_connect/agent/brain.js";

const ORIGIN = "https://ghis.gitam.edu";
const gate = (excerpt) => phiGate({ op: "verify", origin: ORIGIN, resource: "radiology", headers: ["Report"], rowCount: 1, excerpt });

// A radiology report as a hospital actually prints it: an identity block, then the study.
const RAW_REPORT = [
  "GITAM Institute of Medical Sciences",
  "Patient Name : RAMESH KUMAR REDDY",
  "UHID No : 502862        IP No : 2024117788",
  "Age / Sex : 54 Y / M",
  "Address : 12-3-45, Beach Road, Visakhapatnam - 530045",
  "Mobile : 9876543210    Email : ramesh.k@example.com",
  "Referred by : Dr. S. Prasad",
  "",
  "CT SCAN OF THE BRAIN - PLAIN",
  "TECHNIQUE: Axial sections of 5 mm thickness were obtained from the skull base to the vertex.",
  "FINDINGS: No evidence of acute infarct, haemorrhage or space occupying lesion.",
  "The ventricular system is normal in size. Midline structures are central.",
  "IMPRESSION: Normal study of the brain.",
].join("\n");

test("the study survives the scrub and the patient does not", () => {
  const out = scrubExcerpt(RAW_REPORT, ["RAMESH KUMAR REDDY", "54 Y / M"]);
  // The clinical words are what the model needs, so they must still be there.
  assert.match(out, /CT SCAN OF THE BRAIN/);
  assert.match(out, /No evidence of acute infarct/);
  assert.match(out, /IMPRESSION: Normal study of the brain/);
  // The person must not be.
  assert.doesNotMatch(out, /RAMESH/i);
  assert.doesNotMatch(out, /Beach Road/i);
  assert.doesNotMatch(out, /example\.com/i);
  assert.doesNotMatch(out, /502862|9876543210|530045/);
  assert.doesNotMatch(out, /\d{3,}/);
  assert.doesNotMatch(out, /@/);
  // The identity block is MARKED, not deleted: a page of only markers must still read as one.
  assert.match(out, /\[identifier\]/);
  // And what the phone produces is what the server accepts.
  assert.equal(gate(out).ok, true);
});

test("a demographics block with no report reads as nothing but identifiers", () => {
  const demographicsOnly = RAW_REPORT.split("\n").slice(0, 7).join("\n");
  const out = scrubExcerpt(demographicsOnly, ["RAMESH KUMAR REDDY"]);
  // What is left is the hospital's own letterhead and one marker: no study, no findings, no patient.
  assert.equal(out, "GITAM Institute of Medical Sciences\n[identifier]");
  assert.doesNotMatch(out, /RAMESH|Beach Road|54 Y/i);
  assert.equal(gate(out).ok, true);
});

test("consecutive identity lines collapse to one marker, so a header block cannot flood the excerpt", () => {
  const out = scrubExcerpt("Patient Name : A B\nAddress : somewhere\nMobile : 9990001112\nFINDINGS: clear lungs.", ["A B"]);
  assert.equal(out, "[identifier]\nFINDINGS: clear lungs.");
});

test("html, entities and control characters never reach the gate", () => {
  const out = scrubExcerpt("<b>IMPRESSION:</b>&nbsp;normal study\r\n<script>x=1</script>", []);
  assert.doesNotMatch(out, /[<>]/);
  assert.doesNotMatch(out, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  assert.match(out, /IMPRESSION: normal study/);
  assert.equal(gate(out).ok, true);
});

test("the excerpt is capped, and a short cell is not prose at all", () => {
  const long = scrubExcerpt("FINDINGS: " + "the lungs are clear. ".repeat(300), []);
  assert.ok(long.length <= 1200, "excerpt must fit the server limit, got " + long.length);
  assert.equal(gate(long).ok, true);
  assert.equal(scrubExcerpt("", []), "");
  assert.equal(scrubExcerpt("   \n  ", []), "");
});

test("narrativeExcerpt takes the longest prose in the rows and masks the patient's own values", () => {
  const rows = [
    { _rowIndex: 0, study: "CT Brain", date: "01/02/26", report: RAW_REPORT },
    { _rowIndex: 1, study: "X-Ray", date: "02/02/26", report: "short" },
  ];
  const identity = identityValues([{ name: "RAMESH KUMAR REDDY", uhid: "502862", bed: "A1" }]);
  assert.ok(identity.includes("RAMESH KUMAR REDDY"));
  const ex = narrativeExcerpt(rows, identity);
  assert.match(ex, /CT SCAN OF THE BRAIN/);
  assert.doesNotMatch(ex, /RAMESH/i);
  assert.equal(gate(ex).ok, true);
  // Keys the runtime owns are never mined for prose, and a short row yields nothing.
  assert.equal(narrativeExcerpt([{ _raw: "x".repeat(500) }], []), "");
  assert.equal(narrativeExcerpt([{ note: "too short" }], []), "");
  assert.equal(narrativeExcerpt(null, null), "");
});

test("the gate refuses a patient the phone failed to scrub", () => {
  assert.equal(gate("Patient 502862 attended today").ok, false);
  assert.match(gate("Patient 502862 attended today").reason, /excerpt carries a run of 3\+ digits/);
  assert.equal(gate("Write to doctor@hospital.in").ok, false);
  assert.match(gate("Write to doctor@hospital.in").reason, /excerpt carries an @/);
  assert.equal(gate("x".repeat(1201)).ok, false);
  assert.match(gate("x".repeat(1201)).reason, /excerpt longer than 1200/);
});

test("an excerpt is accepted for verify only, never for any other op", () => {
  assert.equal(phiGate({ op: "classify", origin: ORIGIN, headers: ["A"], excerpt: "hello" }).ok, false);
  assert.equal(phiGate({ op: "map-columns", origin: ORIGIN, resource: "labs", headers: ["A"], excerpt: "hello" }).ok, false);
});

/* ---- the prompt: the words must reach the model, with the question the owner asked --------------- */

const ENV = { CONNECT_AGENT_MODEL: "gemini-3.8-flash", CONNECT_AGENT_MODEL_PROVIDER: "vertex" };
const ask = async (payload, text) => {
  let prompt = "";
  const out = await askBrain({ env: ENV, generateImpl: async (req) => { prompt = req.prompt; return { text, model: "gemini-3.8-flash" }; }, payload });
  return { prompt, out };
};

test("with an excerpt the model is asked what the text IS, and told it was redacted", async () => {
  const excerpt = scrubExcerpt(RAW_REPORT, ["RAMESH KUMAR REDDY"]);
  const { prompt, out } = await ask(
    { op: "verify", origin: ORIGIN, resource: "radiology", headers: ["Study", "Date", "Report"], rowCount: 3, kind: "html", path: "/Doctor/Reports", excerpt },
    '{"ok":true,"resource":"radiology","confidence":0.95,"reason":"modality, findings and an impression"}',
  );
  assert.match(prompt, /CT SCAN OF THE BRAIN/);
  assert.match(prompt, /IMPRESSION: Normal study of the brain/);
  assert.match(prompt, /replaced by the marker \[identifier\]/);
  assert.match(prompt, /Say what this text IS/);
  assert.match(prompt, /columns AND the text below/);
  // No patient reaches the model even through the prompt.
  assert.doesNotMatch(prompt, /RAMESH|Beach Road/i);
  assert.equal(out.answer.ok, true);
  assert.equal(out.answer.resource, "radiology");
});

test("a demographics blob claimed as radiology comes back rejected, and the phone can act on it", async () => {
  const excerpt = scrubExcerpt(RAW_REPORT.split("\n").slice(0, 7).join("\n"), ["RAMESH KUMAR REDDY"]);
  const { out } = await ask(
    { op: "verify", origin: ORIGIN, resource: "radiology", headers: ["Name", "Age", "Address"], rowCount: 1, kind: "html", excerpt },
    '{"ok":false,"resource":"patient","confidence":0.92,"reason":"only a letterhead and an identifier block","suggestion":"other-endpoint"}',
  );
  assert.equal(out.answer.ok, false);
  assert.equal(out.answer.resource, "patient");
  assert.equal(out.answer.suggestion, "other-endpoint");
  // proveView drops a candidate on ok:false with confidence >= 0.7.
  assert.ok(Number(out.answer.confidence) >= 0.7);
});

test("without an excerpt the prompt still judges structure only", async () => {
  const { prompt } = await ask(
    { op: "verify", origin: ORIGIN, resource: "labs", headers: ["Test", "Result"], rowCount: 4, kind: "json" },
    '{"ok":true,"resource":"labs","confidence":0.8,"reason":"x"}',
  );
  assert.match(prompt, /STRUCTURE only/);
  assert.doesNotMatch(prompt, /Say what this text IS/);
});
