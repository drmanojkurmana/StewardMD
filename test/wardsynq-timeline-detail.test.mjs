import { test } from "node:test";
import assert from "node:assert/strict";
import { timelineFromChart } from "../functions/_wardsynq/migrate-inpatient.js";

const meta = (at) => ({ effectiveAt: at, recordedAt: at });
const find = (evs, type) => evs.find((e) => e.resourceType === type);

const CHART = {
  Patient: [{
    resourceType: "Patient", id: "p1", name: "Ramesh Kumar", mrn: "MRN-77", dob: "1970-01-01",
    writtenBy: { id: "reception.02@demo.test" }, meta: meta("2026-09-10T08:00:00.000Z"),
  }],
  Encounter: [{
    resourceType: "Encounter", id: "e1", class: "IPD", status: "in-progress",
    location: { ward: "Ward A", bed: "3" },
    writtenBy: { id: "reception.02@demo.test" }, meta: meta("2026-09-10T08:05:00.000Z"),
  }],
  ClinicalNote: [{
    resourceType: "ClinicalNote", id: "n1", noteType: "progress", authorId: "dr.mehta@demo.test",
    signedBy: "dr.mehta@demo.test",
    sections: { assessment: "Community acquired pneumonia, right base.", plan: "Co-amoxiclav 1.2g IV TDS. Review in the morning." },
    meta: meta("2026-09-10T09:00:00.000Z"),
  }],
  ServiceRequest: [
    { resourceType: "ServiceRequest", id: "sr1", code: "CBC", category: "laboratory", status: "active",
      requesterId: "dr.mehta@demo.test", meta: meta("2026-09-10T09:10:00.000Z") },
    { resourceType: "ServiceRequest", id: "sr2", code: "Chest X-ray", category: "imaging", status: "active",
      priority: "urgent", requesterId: "dr.mehta@demo.test", meta: meta("2026-09-10T09:11:00.000Z") },
  ],
  DiagnosticReport: [{
    resourceType: "DiagnosticReport", id: "dr1", code: "CBC", status: "final", serviceRequestId: "sr1",
    conclusion: "Neutrophilia consistent with bacterial infection.", critical: false,
    writtenBy: { id: "lab.tech@demo.test" }, meta: meta("2026-09-10T11:00:00.000Z"),
  }],
  MedicationOrder: [{
    resourceType: "MedicationOrder", id: "mo1", drug: "Co-amoxiclav", dose: { value: 1.2, unit: "g" },
    route: "iv", frequency: "TDS", status: "active", prescriberId: "dr.mehta@demo.test",
    meta: meta("2026-09-10T09:20:00.000Z"),
  }],
};

test("the timeline says WHO did each thing, in words a person can read", () => {
  const { events } = timelineFromChart(CHART);
  assert.match(find(events, "ClinicalNote").label, /^dr\.mehta wrote a progress note/);
  assert.match(find(events, "MedicationOrder").label, /^dr\.mehta prescribed Co-amoxiclav/);
  assert.match(events.filter((e) => e.resourceType === "ServiceRequest")[0].label, /dr\.mehta ordered/);
  assert.equal(find(events, "ClinicalNote").who, "dr.mehta");
});

test("the note's actual words are on the timeline, headings and all", () => {
  const { events } = timelineFromChart(CHART);
  const note = find(events, "ClinicalNote");
  assert.ok(Array.isArray(note.body), "the note body is missing");
  assert.deepEqual(note.body.map((b) => b.heading), ["assessment", "plan"]);
  assert.match(note.body[0].text, /Community acquired pneumonia/);
  assert.match(note.body[1].text, /Co-amoxiclav 1\.2g IV TDS/);
  assert.equal(note.signedBy, "dr.mehta");
});

test("a patient being registered and checking in are events too", () => {
  const { events } = timelineFromChart(CHART);
  const reg = find(events, "Patient");
  assert.match(reg.label, /Ramesh Kumar registered/);
  assert.match(reg.label, /MRN-77/);
  assert.equal(reg.category, "registration");
  const visit = find(events, "Encounter");
  // An IPD stay is an admission; an outpatient visit is a check-in. One word for both reads wrong
  // in whichever half it does not belong to.
  assert.match(visit.label, /admitted/);
  assert.match(visit.label, /Ward A bed 3/);
  assert.equal(visit.category, "visit");
});

test("every event carries a category, so the screen can colour and filter it", () => {
  const { events } = timelineFromChart(CHART);
  assert.ok(events.every((e) => typeof e.category === "string" && e.category));
  const cats = {};
  for (const e of events) cats[e.resourceType] = e.category;
  assert.equal(cats.ClinicalNote, "note");
  assert.equal(cats.ServiceRequest, "investigation");
  assert.equal(cats.DiagnosticReport, "result");
  assert.equal(cats.MedicationOrder, "medication");
});

test("an investigation says whether its report is back, and names it so it can be opened", () => {
  const { events } = timelineFromChart(CHART);
  const srs = events.filter((e) => e.resourceType === "ServiceRequest");
  const cbc = srs.find((e) => e.id === "sr1");
  const xray = srs.find((e) => e.id === "sr2");

  assert.equal(cbc.reportReady, true);
  assert.equal(cbc.reportId, "dr1");
  assert.equal(cbc.reportStatus, "final");

  // Still waiting - and it says so rather than looking identical to the finished one.
  assert.equal(xray.reportReady, false);
  assert.equal(xray.reportId, undefined);
});

test("a corrected report supersedes the preliminary one it corrects", () => {
  const chart = {
    ...CHART,
    DiagnosticReport: [
      { resourceType: "DiagnosticReport", id: "dr-prelim", code: "CBC", status: "preliminary",
        serviceRequestId: "sr1", meta: meta("2026-09-10T10:00:00.000Z") },
      { resourceType: "DiagnosticReport", id: "dr-final", code: "CBC", status: "corrected",
        serviceRequestId: "sr1", meta: meta("2026-09-10T12:00:00.000Z") },
    ],
  };
  const { events } = timelineFromChart(chart);
  const cbc = events.filter((e) => e.resourceType === "ServiceRequest").find((e) => e.id === "sr1");
  assert.equal(cbc.reportId, "dr-final");
  assert.equal(cbc.reportStatus, "corrected");
});

test("an imaging study answers its order the same way a report does", () => {
  const chart = {
    ServiceRequest: [{ resourceType: "ServiceRequest", id: "sr2", code: "Chest X-ray", category: "imaging",
      requesterId: "dr.m@x.test", status: "active", meta: meta("2026-09-10T09:00:00.000Z") }],
    ImagingStudy: [{ resourceType: "ImagingStudy", id: "img1", modality: "CR", status: "available",
      serviceRequestId: "sr2", meta: meta("2026-09-10T10:00:00.000Z") }],
  };
  const { events } = timelineFromChart(chart);
  const sr = events.find((e) => e.resourceType === "ServiceRequest");
  assert.equal(sr.reportReady, true);
  assert.equal(sr.reportId, "img1");
  assert.equal(sr.reportIsImaging, true);
});

test("a critical result is marked critical, on the result and on the order that asked for it", () => {
  const chart = {
    ServiceRequest: [{ resourceType: "ServiceRequest", id: "sr9", code: "Potassium", requesterId: "dr.m@x.test",
      status: "active", meta: meta("2026-09-10T09:00:00.000Z") }],
    DiagnosticReport: [{ resourceType: "DiagnosticReport", id: "dr9", code: "Potassium", status: "final",
      serviceRequestId: "sr9", critical: true, meta: meta("2026-09-10T10:00:00.000Z") }],
  };
  const { events } = timelineFromChart(chart);
  assert.equal(events.find((e) => e.resourceType === "DiagnosticReport").critical, true);
  assert.equal(events.find((e) => e.resourceType === "ServiceRequest").critical, true);
});

test("a record written by an opaque account is not given an invented name", () => {
  const chart = {
    ClinicalNote: [{ resourceType: "ClinicalNote", id: "n9", noteType: "progress", sections: { narrative: "Seen." },
      authorId: "fb:DcGIzIXwxURU0G9L4J5jehluENl1", meta: meta("2026-09-10T09:00:00.000Z") }],
  };
  const { events } = timelineFromChart(chart);
  assert.equal(events[0].who, "a clinician account");
  assert.match(events[0].label, /^a clinician account wrote a progress note/);
});

test("events stay newest first, and a record with no timestamp is counted rather than dropped", () => {
  const chart = {
    ...CHART,
    Condition: [{ resourceType: "Condition", id: "c-no-time", display: "Asthma", meta: {} }],
  };
  const { events, withoutTimestamp } = timelineFromChart(chart);
  assert.equal(withoutTimestamp, 1);
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i - 1].at >= events[i].at, "out of order at " + i);
  }
});
