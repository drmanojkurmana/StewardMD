/* test/wardsynq-hl7v2.test.mjs — ADT out. Pure, and the escaping is the point.
 *
 * node --test test/wardsynq-hl7v2.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, ts, dt, sex, segment, eventOf, adtMessage, valueType, obxStatus, oruMessage } from "../functions/_wardsynq/hl7v2.js";

const ENC = {
  id: "wsq-adm-1", class: "IPD", status: "in-progress", patientId: "pat-1",
  location: { ward: "Medical A", bed: "12" },
  periodStart: "2026-09-07T08:00:00.000Z", attendingId: "cfa:dr",
};
const PAT = { id: "pat-1", mrn: "SMD-1", name: "Asha Rao", dob: "1972-04-02", sex: "female" };
const msg = (over) => adtMessage({ encounter: ENC, patient: PAT, controlId: "c1", sendingFacility: "WSQ", now: "2026-09-07T09:00:00.000Z", ...(over || {}) });
const seg = (m, name) => m.split("\r").find((s) => s.startsWith(name + "|"));

test("EVERY DELIMITER IS ESCAPED, because HL7v2 has no quoting", () => {
  /* A patient whose name contains a pipe does not produce a slightly odd message. It produces one
   * whose every subsequent field is shifted, and the receiver does not error - it stores the wrong
   * data, silently, against the right patient. */
  assert.equal(esc("a|b"), "a\\F\\b");
  assert.equal(esc("a^b"), "a\\S\\b");
  assert.equal(esc("a~b"), "a\\R\\b");
  assert.equal(esc("a&b"), "a\\T\\b");
  assert.equal(esc("a\\b"), "a\\E\\b");
  /* THE BACKSLASH MUST GO FIRST. Escaping it last would re-escape the backslashes the other four
   * had just introduced, and `a|b` would reach the receiver as a literal backslash and an F. */
  assert.equal(esc("a\\|b"), "a\\E\\\\F\\b");
  // A newline inside a field ends the SEGMENT - the same corruption, easier to reach from free text.
  assert.equal(esc("line one\nline two"), "line one line two");

  const hostile = msg({ patient: { ...PAT, name: "Rao|Asha^X~Y&Z" } });
  const pid = seg(hostile, "PID");
  assert.ok(!pid.split("|").some((f) => f === "Asha"), "no field boundary was created by the name");
  assert.equal(pid.split("|").length, seg(msg(), "PID").split("|").length, "and the field count is unchanged");
});

test("A FIELD THE RECORD DOES NOT HAVE IS EMPTY, never a plausible value", () => {
  /* HL7v2 makes this easy to get wrong: a receiver will happily accept "U" for a sex nobody
   * recorded and store it as a finding. */
  assert.equal(sex(undefined), "");
  assert.equal(sex("unknown"), "");
  assert.deepEqual([sex("female"), sex("M"), sex("other")], ["F", "M", "O"]);

  // A record holding only a year knows the year and not the day. 19720101 would invent a birthday
  // that a receiving system then uses to match patients.
  assert.equal(dt("1972"), "");
  assert.equal(dt("1972-04"), "");
  assert.equal(dt("not a date"), "");
  assert.equal(dt("1972-04-02"), "19720402");
  assert.equal(dt("19720402"), "19720402");

  assert.equal(ts("nonsense"), "");
  assert.equal(ts("2026-09-07T09:00:00.000Z"), "20260907090000");

  const bare = msg({ patient: { id: "pat-1", mrn: "SMD-2" } });
  const f = seg(bare, "PID").split("|");
  assert.equal(f[7], undefined, "no dob and no sex means those fields are simply not there");
  assert.match(seg(bare, "PID"), /SMD-2/);
});

test("THE EVENT COMES FROM THE RECORD, so a message cannot announce an admission that ended", () => {
  assert.equal(eventOf(ENC), "A01");
  assert.equal(eventOf({ ...ENC, status: "finished" }), "A03");
  // An OPD visit is not an ADT admission, and a stay in neither state produces no message at all.
  assert.equal(eventOf({ ...ENC, class: "OPD" }), null);
  assert.equal(eventOf({ ...ENC, status: "planned" }), null);
  assert.equal(adtMessage({ encounter: { ...ENC, class: "OPD" }, patient: PAT }), null);
  assert.equal(adtMessage({ encounter: null }), null);
  // An event this file does not actually produce is refused rather than emitted mistyped.
  assert.equal(adtMessage({ encounter: ENC, patient: PAT, event: "A17" }), null);

  assert.match(seg(msg(), "MSH"), /ADT\^A01\^ADT_A01/);
  assert.match(seg(msg({ encounter: { ...ENC, status: "finished", periodEnd: "2026-09-09T10:00:00.000Z" } }), "MSH"), /ADT\^A03\^ADT_A03/);
});

test("the segments carry what a receiver needs to place the patient", () => {
  const m = msg();
  assert.ok(m.startsWith("MSH|^~\\&|WardSynQ|WSQ|"), "MSH-2 declares the encoding characters it uses");
  assert.match(m, /\|2\.5\.1$|\|2\.5\.1\r/);
  // Segments are CR-separated, as the standard says - not LF, which is what a receiver written
  // against one vendor's output breaks on.
  assert.equal(m.split("\r").length, 4);
  assert.ok(!m.includes("\n"));

  // PID-3 carries the assigning authority: an identifier without one is how two hospitals' patients
  // get merged downstream.
  assert.match(seg(m, "PID"), /SMD-1\^\^\^WSQ\^MR/);

  const pv1 = seg(m, "PV1").split("|");
  assert.equal(pv1[2], "I", "an inpatient class");
  assert.equal(pv1[3], "Medical A^^12", "ward, no room recorded, bed");
  assert.equal(pv1[7], "cfa:dr", "PV1-7 attending");
  /* PV1-19, not PV1-18. Counting empty fields by eye put it one place early, where a receiver reads
   * it as the prior patient location - the same silent misplacement the escaping rules exist to
   * prevent, reached from the other direction. The segment is built by field number now. */
  assert.equal(pv1[19], "wsq-adm-1", "the visit number is the encounter");
  assert.equal(pv1[44], "20260907080000", "PV1-44 admit date/time");

  // A ward with no bed emits an empty bed component, never the ward name repeated into it.
  assert.equal(seg(msg({ encounter: { ...ENC, location: { ward: "Medical A" } } }), "PV1").split("|")[3], "Medical A^^");
});

/* ---- ORU: the result, going out ----------------------------------------------------------------- */

const REPORT = {
  id: "wsq-dr-1", patientId: "pat-1", serviceRequestId: "wsq-sr-1", code: "Renal profile",
  status: "final", reportedAt: "2026-09-07T10:00:00.000Z", conclusion: null,
  resultObservationIds: ["o1", "o2"],
};
const OBS = [
  { id: "o1", code: "2823-3", display: "Potassium", codeSystem: "http://loinc.org", value: 7.4, unit: "mmol/L", referenceRange: { low: 3.5, high: 5.1 }, sourceCritical: true },
  { id: "o2", code: "Culture", display: "Culture", codeSystem: "wardsynq-lab-local", value: "No growth at 48h", unit: null },
];
const oru = (over) => oruMessage({ report: REPORT, observations: OBS, patient: PAT, controlId: "c1", sendingFacility: "WSQ", now: "2026-09-07T11:00:00.000Z", ...(over || {}) });
const obx = (m, n) => m.split("\r").filter((s) => s.startsWith("OBX|"))[n].split("|");

test("A NON-NUMERIC RESULT IS SENT AS TEXT, with its type said", () => {
  const m = oru();
  assert.equal(obx(m, 0)[2], "NM", "a number is NM");
  /* "No growth at 48h" is a real laboratory answer. Sending it as numeric would have the receiver
   * parse it to zero or to nothing, and a culture that grew something would arrive as a number
   * nobody wrote. */
  assert.equal(obx(m, 1)[2], "ST");
  assert.equal(obx(m, 1)[5], "No growth at 48h");
  assert.equal(valueType(7.4), "NM");
  assert.equal(valueType("<0.01"), "ST", "a censored value is text, not a number");
  assert.equal(valueType(null), "ST");
});

test("THE ABNORMAL FLAG IS THE LABORATORY'S, never computed here", () => {
  const m = oru();
  // The potassium is 7.4 against a range topping out at 5.1, and the flag is present only because
  // the LAB said so. Deriving "H" from the range would be this file interpreting a result.
  assert.equal(obx(m, 0)[8], "AA");
  const unflagged = oru({ observations: [{ ...OBS[0], sourceCritical: false }] });
  assert.equal(obx(unflagged, 0)[8], "", "out of range and unflagged stays unflagged");
  // The range travels as reported.
  assert.equal(obx(m, 0)[7], "3.5-5.1");
});

test("a local code stays a local code, and a corrected report says so in every OBX", () => {
  const m = oru();
  assert.equal(obx(m, 0)[3], "2823-3^Potassium^http://loinc.org");
  // Nothing here promotes a local code to LOINC.
  assert.equal(obx(m, 1)[3], "Culture^Culture^wardsynq-lab-local");

  assert.equal(obxStatus("final"), "F");
  assert.equal(obxStatus("preliminary"), "P");
  assert.equal(obxStatus("corrected"), "C");
  const corrected = oru({ report: { ...REPORT, status: "corrected" } });
  assert.ok(corrected.split("\r").filter((s) => s.startsWith("OBX|")).every((s) => s.split("|")[11] === "C"));
});

test("ORU escapes exactly as ADT does, and sends nothing when there is nothing", () => {
  const hostile = oru({ observations: [{ ...OBS[1], value: "Grew E|coli^fast" }] });
  const f = obx(hostile, 0);
  assert.equal(f[5], "Grew E\\F\\coli\\S\\fast", "no field or component boundary is created by a result");
  assert.equal(f.length, obx(oru(), 1).length, "and the field count is unchanged");

  // A report with no observations is not an empty message, it is no message.
  assert.equal(oruMessage({ report: REPORT, observations: [] }), null);
  assert.equal(oruMessage({ report: null, observations: OBS }), null);

  // The laboratory's own conclusion travels in the segment for it, and only when there is one.
  assert.ok(!oru().includes("NTE|"));
  assert.match(oru({ report: { ...REPORT, conclusion: "Consistent with sepsis." } }), /NTE\|1\|L\|Consistent with sepsis\./);
});

test("EVN carries the event time from the record, not the time the message was built", () => {
  const admit = seg(msg(), "EVN").split("|");
  assert.equal(admit[1], "A01");
  assert.equal(admit[2], "20260907090000", "when the message was built");
  assert.equal(admit[6], "20260907080000", "and when the patient was actually admitted");

  const disch = seg(msg({ encounter: { ...ENC, status: "finished", periodEnd: "2026-09-09T10:30:00.000Z" } }), "EVN").split("|");
  assert.equal(disch[6], "20260909103000", "a discharge is timed by its discharge, not its admission");
});
