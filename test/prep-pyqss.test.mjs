import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseCsv, buildItems, analyse, assertClean, shuffleOptions, remapLetters } from "../tools/pyq-ss-build.mjs";
const require = createRequire(import.meta.url);
const PQ = require("../prep-pyqss.js");

const H = "Question_Number,Exam_Year,Topic_Domain,Cancer_Site,Specific_Subtopic,Core_Concept,Question_Stem,Option_A,Option_B,Option_C,Option_D,Correct_Answer,Detailed_Explanation,High_Yield_Takeaway,Standard_Reference,Source_Video_Session,Timestamp,YouTube_Timestamp_URL,Recurrence_And_Repeat_Notes";
const row = (n, sess, stem, exp, rep) => [n, "2025", "Breast Oncology", "Breast", "Topic " + (n.length % 2), "Staging", stem, "A. one", "B. two", "C. three", "D. four", "Option A - one", exp, "kp", "ref", sess, "00:01:00", "http://www.youtube.com/watch?v=x", rep].map((x) => '"' + x + '"').join(",");
const CSV = [H,
  row("Q1", "NEET-SS Dec 2025 - Recall: Medical Oncology I (Marrow SS)", "Stem one [Directly audible from slide]", "Option A is correct because X. As Dr. Vijay summarizes, Option B is wrong.", "Repeated in 2025"),
  row("Q2", "NEET SS 2024 Medical Oncology Recall Session (Part 2) — DocTutorials", "[Incomplete Recall Slide Logged at 01:00:00]: placeholder", "Logged for completeness of Marrow Part II", ""),
  row("Q3", "NEET SS 2025 Medical Oncology Recall — DocTutorials (Dr. Vijay)", "Stem three", "Marrow failure is a disease term.", "")].join("\n");

test("build drops placeholders, names no source, keeps the key through the shuffle", () => {
  const items = buildItems(parseCsv(CSV));
  assert.equal(items.length, 2);
  assertClean(items);
  items.forEach((it) => assert.equal(it.o[it.a], "one"));
  assert.equal(items[0].q, "Stem one");
  const m = /^Option ([A-D]) is correct/.exec(items[0].exp);
  assert.equal("ABCD".indexOf(m[1]), items[0].a);
  assert.match(items[1].exp, /Marrow failure/);
  assert.deepEqual(items.map((i) => i.src), ["neet-ss-onc-2025-s1", "neet-ss-onc-2025-s3"]);
});
test("a source name that survives fails the build", () => { assert.throws(() => assertClean({ x: "from Marrow Part II" })); });
test("shuffle is deterministic and skips relative options", () => {
  assert.deepEqual(shuffleOptions("a", ["w", "x", "y", "z"], 0), shuffleOptions("a", ["w", "x", "y", "z"], 0));
  assert.deepEqual(shuffleOptions("a", ["w", "x", "y", "All of the above"], 3).o, ["w", "x", "y", "All of the above"]);
  assert.equal(remapLetters("Option A and B beat Option C", [1, 0, 2, 3]), "Option B and A beat Option C");
});
test("analysis counts, tiers and must-do", () => {
  const items = buildItems(parseCsv(CSV)), an = analyse(items);
  assert.equal(an.total, 2); assert.equal(an.domains[0].tier, 1);
  assert.ok(an.mustDo.some((t) => t.rep > 0));
  assert.equal(PQ.mustItems(items, an).length, 2); // same subtopic asked twice
  assert.equal(PQ.paperTitle({ year: 2025, session: "set-3" }), "NEET-SS 2025 · Recall set 3");
});
