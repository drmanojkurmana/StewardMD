/* Case file timeline and case-series chart helpers (plan item 2 and 3).
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-casefile.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const CF = require("../research-screen-casefile.js");
const SRC = readFileSync(new URL("../research-screen-casefile.js", import.meta.url), "utf8");

test("no em or en dashes in the case file screen source", () => {
  const dashes = SRC.match(/[–—]/g) || [];
  assert.equal(dashes.length, 0);
});

test("buildTimeline sorts dated entries and numbers days from first presentation", () => {
  const cf = CF.emptyCasefile();
  cf.presentingDate = "2026-03-02";
  cf.presenting = "Chest pain for 2 hours";
  cf.diagnosisDate = "2026-03-02";
  cf.diagnosis = "Myocardial infarction (heart attack)";
  cf.investigations = [
    { date: "2026-03-08", test: "Repeat troponin I", value: "0.9", unit: "ng/mL" },
    { date: "2026-03-03", test: "Echocardiography", value: "LVEF 35 percent", unit: "" }
  ];
  cf.treatmentDate = "2026-03-02";
  cf.treatment = "Standard care";
  cf.outcomeDate = "2026-03-09";
  cf.outcome = "Discharged on day 7";
  cf.followupDate = "2026-04-13";
  cf.followup = "Asymptomatic at 6 weeks";
  const tl = CF.buildTimeline(cf);
  assert.equal(tl.length, 7);
  assert.deepEqual(tl.map((e) => e.day), [0, 0, 0, 1, 6, 7, 42]);
  assert.deepEqual(tl.map((e) => e.date), [
    "2026-03-02", "2026-03-02", "2026-03-02", "2026-03-03",
    "2026-03-08", "2026-03-09", "2026-04-13"
  ]);
  assert.equal(tl[0].text, "Presenting complaint: Chest pain for 2 hours");
  assert.equal(tl[3].text, "Echocardiography: LVEF 35 percent");
  assert.equal(tl[4].text, "Repeat troponin I: 0.9 ng/mL");
  assert.equal(tl[6].text, "Follow-up: Asymptomatic at 6 weeks");
});

test("same-day entries keep CARE order (presentation before diagnosis before treatment)", () => {
  const cf = CF.emptyCasefile();
  cf.presentingDate = "2026-01-10";
  cf.presenting = "Fever";
  cf.treatmentDate = "2026-01-10";
  cf.treatment = "Antibiotics";
  cf.diagnosisDate = "2026-01-10";
  cf.diagnosis = "Sepsis (blood infection)";
  const tl = CF.buildTimeline(cf);
  assert.deepEqual(tl.map((e) => e.text), [
    "Presenting complaint: Fever",
    "Diagnosis: Sepsis (blood infection)",
    "Treatment: Antibiotics"
  ]);
  assert.deepEqual(tl.map((e) => e.day), [0, 0, 0]);
});

test("missing presentation date falls back to the earliest dated entry as Day 0", () => {
  const cf = CF.emptyCasefile();
  cf.presenting = "Cough";
  cf.investigations = [
    { date: "2026-05-20", test: "Chest X-ray", value: "Consolidation", unit: "" },
    { date: "2026-05-18", test: "CRP", value: "120", unit: "mg/L" }
  ];
  cf.outcomeDate = "2026-05-25";
  cf.outcome = "Recovered";
  const tl = CF.buildTimeline(cf);
  assert.equal(tl.length, 4);
  assert.equal(tl[0].text, "CRP: 120 mg/L");
  assert.equal(tl[0].day, 0);
  assert.equal(tl[1].day, 2);
  assert.equal(tl[2].day, 7);
  const undated = tl[3];
  assert.equal(undated.date, null);
  assert.equal(undated.day, null);
  assert.equal(undated.text, "Presenting complaint: Cough");
});

test("undated entries come after dated ones, in CARE order", () => {
  const cf = CF.emptyCasefile();
  cf.presentingDate = "2026-02-01";
  cf.presenting = "Rash";
  cf.history = "No prior illness";
  cf.diagnosis = "Drug eruption";
  cf.investigations = [{ date: "", test: "Skin biopsy", value: "Spongiosis", unit: "" }];
  cf.followup = "Resolved";
  const tl = CF.buildTimeline(cf);
  assert.equal(tl.length, 4);
  assert.equal(tl[0].day, 0);
  assert.equal(tl[0].text, "Presenting complaint: Rash");
  assert.deepEqual(tl.slice(1).map((e) => e.day), [null, null, null]);
  assert.deepEqual(tl.slice(1).map((e) => e.text), [
    "Skin biopsy: Spongiosis",
    "Diagnosis: Drug eruption",
    "Follow-up: Resolved"
  ]);
});

test("invalid dates are treated as undated and never throw", () => {
  const cf = CF.emptyCasefile();
  cf.presentingDate = "2026-02-30";
  cf.presenting = "Pain";
  cf.investigations = [
    { date: "02/03/2026", test: "ECG", value: "Normal", unit: "" },
    { date: "2026-13-01", test: "Bloods", value: "Normal", unit: "" }
  ];
  const tl = CF.buildTimeline(cf);
  assert.equal(tl.length, 3);
  assert.ok(tl.every((e) => e.day === null && e.date === null));
});

test("empty text fields are skipped; bad input never throws", () => {
  assert.deepEqual(CF.buildTimeline(null), []);
  assert.deepEqual(CF.buildTimeline(undefined), []);
  assert.deepEqual(CF.buildTimeline({}), []);
  assert.deepEqual(CF.buildTimeline("not an object"), []);
  const cf = CF.emptyCasefile();
  cf.presentingDate = "2026-01-01";
  cf.investigations = [{ date: "2026-01-02", test: "", value: "", unit: "" }];
  assert.deepEqual(CF.buildTimeline(cf), []);
  assert.deepEqual(CF.buildTimeline({ investigations: "bad" }), []);
});

test("investigation text handles missing test, value or unit gracefully", () => {
  const cf = CF.emptyCasefile();
  cf.presentingDate = "2026-01-01";
  cf.presenting = "Fever";
  cf.investigations = [
    { date: "2026-01-01", test: "", value: "Positive", unit: "" },
    { date: "2026-01-01", test: "Widal", value: "", unit: "" },
    { date: "2026-01-01", test: "Platelets", value: "90", unit: "" }
  ];
  const tl = CF.buildTimeline(cf);
  assert.equal(tl[1].text, "Positive");
  assert.equal(tl[2].text, "Widal");
  assert.equal(tl[3].text, "Platelets: 90");
});

test("example case file builds a full zinc phosphide MI timeline", () => {
  const tl = CF.buildTimeline(CF.exampleCasefile());
  assert.equal(tl.length, 9);
  assert.equal(tl[0].day, 0);
  assert.equal(tl[0].date, "2026-03-02");
  assert.deepEqual(tl.map((e) => e.day), [0, 0, 0, 0, 0, 1, 6, 7, 42]);
  assert.ok(tl.some((e) => e.text.indexOf("Troponin I: 8.4 ng/mL") === 0));
  assert.ok(tl.some((e) => e.text.indexOf("Diagnosis: Acute anterior ST elevation myocardial infarction (heart attack)") === 0));
});

test("chartFromCasefiles makes one row per patient with sorted test columns", () => {
  const records = [
    {
      id: "2",
      value: Object.assign(CF.emptyCasefile(), {
        age: "51", sex: "Female", diagnosis: "Poisoning",
        investigations: [
          { date: "2026-01-02", test: "Troponin I", value: "2.1", unit: "ng/mL" },
          { date: "2026-01-02", test: "ECG", value: "ST elevation", unit: "" }
        ]
      })
    },
    {
      id: "1",
      value: Object.assign(CF.emptyCasefile(), {
        age: "34", sex: "Male", diagnosis: "Poisoning",
        investigations: [
          { date: "2026-03-02", test: "Troponin I", value: "8.4", unit: "ng/mL" }
        ]
      })
    }
  ];
  const chart = CF.chartFromCasefiles(records);
  assert.deepEqual(chart.columns, ["Patient", "Age", "Sex", "Diagnosis", "ECG", "Troponin I (ng/mL)"]);
  assert.deepEqual(chart.rows, [
    ["2", "51", "Female", "Poisoning", "ST elevation", "2.1"],
    ["1", "34", "Male", "Poisoning", "", "8.4"]
  ]);
});

test("chartFromCasefiles tolerates bad input", () => {
  assert.deepEqual(CF.chartFromCasefiles(null), { columns: ["Patient", "Age", "Sex", "Diagnosis"], rows: [] });
  assert.deepEqual(CF.chartFromCasefiles("bad"), { columns: ["Patient", "Age", "Sex", "Diagnosis"], rows: [] });
  const chart = CF.chartFromCasefiles([{ id: "1", value: null }]);
  assert.deepEqual(chart.rows, [["1", "", "", ""]]);
});

test("normCasefile never throws and keeps only known string fields", () => {
  const cf = CF.normCasefile({ age: 34, sex: "Male", name: "Should not persist", investigations: [{ test: "ECG", value: 5 }] });
  assert.equal(cf.age, "");
  assert.equal(cf.sex, "Male");
  assert.equal(Object.prototype.hasOwnProperty.call(cf, "name"), false);
  assert.equal(cf.investigations[0].value, "5");
  assert.equal(cf.investigations[0].unit, "");
});
