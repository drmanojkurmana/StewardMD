/* test/wardsynq-hl7-inbound.test.mjs - HL7 v2 into the record through the same pipeline. Pure.
 *
 * node --test test/wardsynq-hl7-inbound.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHl7 } from "../functions/_connect/connectors/hl7v2/parser.js";
import { validateBundle } from "../functions/_connect/canonical/validate.js";
import { hl7ToSccm, hl7Date, identifiersFrom, CODING_SYSTEMS } from "../functions/_wardsynq/hl7-normalize.js";
import { SUPPORTED, DEFAULT_PROFILE, profileFor, validateMessage, buildAck, hl7Enabled, ExchangeMessage, MESSAGE_TYPE } from "../functions/_wardsynq/hl7-inbound.js";
import { mapSccmBundle } from "../wardsynq/adapters/wardsynq-sccm-adapter.js";
import { RESOURCE_TYPES } from "../functions/_wardsynq/service.js";

const SRC = readFileSync(new URL("../functions/_wardsynq/hl7-inbound.js", import.meta.url), "utf8");
const CR = "\r";
/** A segment from {fieldNumber: value}, so the HL7 field positions in these fixtures are explicit rather than counted pipes. */
const S = (id, at) => { const n = Math.max(...Object.keys(at).map(Number)); const f = [id]; for (let i = 1; i <= n; i++) f.push(at[i] == null ? "" : String(at[i])); return f.join("|"); };
const PV1 = (over = {}) => S("PV1", { 1: "1", 2: "I", 3: "MED-A^12^B^GENHOSP", 7: "1234^Physician^Attending", 10: "MED", 19: "V-2026-001^^^GENHOSP", 44: "20260808100000", ...over });
const A01 = [
  "MSH|^~\\&|HIS|GENHOSP|WARDSYNQ|WSQ|20260808101500+0530||ADT^A01^ADT_A01|MSG0001|P|2.5.1",
  "EVN|A01|20260808101500",
  "PID|1||H-77^^^GENHOSP^MR~91-1234-5678-9012^^^NDHM^NI||Testcase^Partner^^^Dr||19750309|F|||12 Lane^^Town^^500001||9876543210",
  PV1(),
  "DG1|1||E11.9^Type 2 diabetes^I10|||A",
  "AL1|1|DA|PEN^Penicillin^L|SV|Anaphylaxis",
  "ZPI|1|custom-value|do-not-interpret",
].join(CR);
const ORU = [
  "MSH|^~\\&|LAB|GENHOSP|WARDSYNQ|WSQ|20260808120000||ORU^R01^ORU_R01|MSG0002|P|2.5.1",
  "PID|1||H-77^^^GENHOSP^MR||Testcase^Partner||19750309|F",
  PV1({ 44: null }),
  S("OBR", { 1: "1", 2: "PLC-9", 3: "FIL-9", 4: "RENAL^Renal profile^L", 7: "20260808113000", 25: "F" }),
  "OBX|1|NM|2160-0^Creatinine^LN||96|umol/L|60-110|N|||F|||20260808113000",
  "OBX|2|NM|2823-3^Potassium^LN||6.1|mmol/L|3.5-5.1|HH|||F",
  "OBX|3|ST|NOTE^Comment^L||haemolysed sample|||||F",
  "OBX|4|CE|K-INT^Interpretation^L||HIGH^High potassium^L|||||F",
  "OBX|5|NM|BAD^Bad number^L||not-a-number||||||F",
  "OBX|6|NM|GONE^Deleted^L||1||||||D",
].join(CR);

test("hl7Date never defaults: precision is kept, a zone is honoured, nonsense is null", () => {
  assert.equal(hl7Date("20260808101500+0530"), "2026-08-08T10:15:00+05:30");
  assert.equal(hl7Date("20260808"), "2026-08-08");
  assert.equal(hl7Date("202608"), "2026-08");
  assert.equal(hl7Date("2026"), "2026");
  assert.equal(hl7Date("2026080810"), "2026-08-08T10:00:00Z");
  assert.equal(hl7Date("yesterday"), null);
  assert.equal(hl7Date(""), null);
});

test("ADT A01 -> SCCM 1.1: identifiers with their authorities, the visit number, the location as sent, diagnosis and allergy, Z-segments preserved and never read", () => {
  const msg = parseHl7(A01);
  const { sccm, kind, zSegments, warnings } = hl7ToSccm(msg, { tenantId: "t" });
  assert.deepEqual([kind.type, kind.event, kind.controlId, kind.sendingApp, kind.sendingFacility, kind.processingId], ["ADT", "A01", "MSG0001", "HIS", "GENHOSP", "P"]);
  assert.equal(validateBundle(sccm).ok, true, JSON.stringify(validateBundle(sccm).errors));
  assert.equal(sccm.patient.id, "H-77", "the sender's own id, not a hash: it has to be attributable");
  assert.deepEqual(sccm.patient.identifiers, [{ system: "GENHOSP", type: "MR", value: "H-77" }, { system: "NDHM", type: "NI", value: "91-1234-5678-9012" }]);
  assert.equal(sccm.patient.name.text, "Partner Testcase"); assert.equal(sccm.patient.gender, "female"); assert.equal(sccm.patient.birthDate, "1975-03-09");
  const e = sccm.encounters[0];
  assert.equal(e.id, "V-2026-001"); assert.equal(e.class, "IPD"); assert.equal(e.status, "in-progress");
  assert.equal(e.period.start, "2026-08-08T10:00:00Z");
  assert.deepEqual(e.location, { facility: "GENHOSP", ward: "MED-A", bed: "12-B" }, "the sender's ward and bed, as sent");
  assert.deepEqual(e.identifiers, [{ system: "GENHOSP", type: "VN", value: "V-2026-001" }]);
  assert.equal(sccm.conditions[0].code.coding[0].system, CODING_SYSTEMS.I10);
  assert.equal(sccm.conditions[0].code.coding[0].code, "E11.9");
  assert.equal(sccm.allergies[0].criticality, "high");
  assert.equal(sccm.allergies[0].reactions[0].text, "Anaphylaxis");
  assert.deepEqual(zSegments, [{ id: "ZPI", raw: "ZPI|1|custom-value|do-not-interpret" }]);
  assert.ok(!JSON.stringify(sccm).includes("do-not-interpret"), "nothing in the bundle came from the Z-segment");
  assert.equal(warnings.length, 0, JSON.stringify(warnings));

  // Through the SAME adapter, the same canonical entities a FHIR bundle would produce.
  sccm.meta.sourceConnector = "hl7v2-his-genhosp";
  const m = mapSccmBundle(sccm);
  assert.equal(m.patient.id, "hl7v2-his-genhosp-pat-h-77");
  assert.equal(m.patient.mrn, "H-77", "the MR-typed identifier is the MRN");
  const enc = m.entities.find((x) => x.resourceType === "Encounter");
  assert.equal(enc.class, "IPD"); assert.deepEqual(enc.location, { facilityId: "GENHOSP", ward: "MED-A", bed: "12-B" });
  assert.ok(enc.identifiers.some((i) => i.type === "VN" && i.value === "V-2026-001"));
  assert.equal(m.entities.find((x) => x.resourceType === "Condition").code, "E11.9");
});

test("ADT A03 finishes the visit, A02 moves it, A08 is an update of the same visit, an unknown class is named", () => {
  const a03 = hl7ToSccm(parseHl7(A01.replace("ADT^A01^ADT_A01", "ADT^A03^ADT_A03").replace("EVN|A01", "EVN|A03").replace(PV1(), PV1({ 45: "20260810090000" }))), {});
  assert.equal(a03.sccm.encounters[0].status, "finished");
  assert.equal(a03.sccm.encounters[0].period.end, "2026-08-10T09:00:00Z");
  const a02 = hl7ToSccm(parseHl7(A01.replace("ADT^A01^ADT_A01", "ADT^A02^ADT_A02").replace("MED-A^12^B", "ICU^3^A")), {});
  assert.deepEqual(a02.sccm.encounters[0].location, { facility: "GENHOSP", ward: "ICU", bed: "3-A" });
  assert.equal(a02.sccm.encounters[0].id, "V-2026-001", "the same visit: the record versions, it does not fork");
  const weird = hl7ToSccm(parseHl7(A01.replace("PV1|1|I|", "PV1|1|Q|")), {});
  assert.equal(weird.sccm.encounters[0].class, null);
  assert.ok(weird.warnings.some((w) => /PV1-2 patient class "Q"/.test(w)));
});

test("ORU R01 -> report over typed observations: NM, SN-like, ST, CE; the laboratory's flag carried never recomputed; deleted and unparseable named", () => {
  const { sccm, warnings } = hl7ToSccm(parseHl7(ORU), {});
  assert.equal(validateBundle(sccm).ok, true, JSON.stringify(validateBundle(sccm).errors));
  const rep = sccm.diagnosticReports[0];
  assert.equal(rep.id, "FIL-9"); assert.equal(rep.status, "final"); assert.equal(rep.effectiveDateTime, "2026-08-08T11:30:00Z");
  assert.deepEqual(rep.basedOn, { type: "ServiceRequest", id: "PLC-9" });
  assert.equal(sccm.serviceRequests[0].id, "PLC-9"); assert.equal(sccm.serviceRequests[0].status, "completed");
  assert.equal(sccm.observations.length, 5, "six OBX, one deleted (D) not carried");
  const [cr, k, note, interp, bad] = sccm.observations;
  assert.equal(cr.code.coding[0].system, "http://loinc.org"); assert.equal(cr.value.value, 96); assert.equal(cr.value.unit, "umol/L"); assert.equal(cr.referenceRange.text, "60-110"); assert.equal(cr.interpretation.text, "N");
  assert.equal(k.interpretation.text, "HH", "the laboratory's own flag, verbatim");
  assert.equal(note.value.text, "haemolysed sample");
  assert.equal(interp.value.coding[0].code, "HIGH");
  assert.equal(bad.value.text, "not-a-number"); assert.ok(warnings.some((w) => /typed NM but carries/.test(w)));
  assert.ok(warnings.some((w) => /marked D \(deleted\/wrong\) and was not carried/.test(w)));
  assert.equal(rep.results.length, 5); assert.equal(rep.results[0].id, cr.id);
  assert.equal(k.effectiveDateTime, "2026-08-08T11:30:00Z", "an OBX with no OBX-14 takes the report's time, never now");
});

test("THE INTEGRATION PROFILE only narrows, and refuses before content is looked at", () => {
  assert.equal(hl7Enabled(null), false); assert.equal(hl7Enabled({ inbound: { enabled: "true" } }), false); assert.equal(hl7Enabled({ inbound: { enabled: true } }), true);
  const def = profileFor(null);
  assert.deepEqual(def.messages, SUPPORTED); assert.deepEqual(def.processingIds, ["P"]); assert.equal(def.keepRaw, false);
  const narrow = profileFor({ profile: { messages: ["ORU^R01", "MDM^T02"], sendingApplications: ["LAB"], processingIds: ["P", "T"], keepRaw: true } });
  assert.deepEqual(narrow.messages, ["ORU^R01"], "MDM is not supported and cannot be enabled by a profile");
  assert.deepEqual(narrow.sendingApplications, ["LAB"]); assert.equal(narrow.keepRaw, true);
  const msg = parseHl7(A01), kind = hl7ToSccm(msg, {}).kind;
  assert.deepEqual(validateMessage(msg, kind, def), []);
  const p = validateMessage(msg, kind, narrow);
  assert.ok(p.some((x) => x.code === "200" && /ADT\^A01 is not a message this hospital accepts/.test(x.detail)));
  assert.ok(p.some((x) => x.code === "207" && /"HIS" is not registered/.test(x.detail)));
  const training = hl7ToSccm(parseHl7(A01.replace("|MSG0001|P|", "|MSG0001|T|")), {});
  assert.ok(validateMessage(parseHl7(A01.replace("|MSG0001|P|", "|MSG0001|T|")), training.kind, def).some((x) => x.code === "202"), "a training message does not enter a production record");
  const noPv1 = parseHl7(A01.split(CR).filter((l) => !l.startsWith("PV1")).join(CR));
  assert.ok(validateMessage(noPv1, kind, def).some((x) => x.code === "100" && /PV1 is missing/.test(x.detail)));
  const noId = parseHl7(A01.replace("PID|1||H-77^^^GENHOSP^MR~91-1234-5678-9012^^^NDHM^NI||", "PID|1||||"));
  assert.ok(validateMessage(noId, kind, def).some((x) => x.code === "101" && /PID-3/.test(x.detail)));
  assert.ok(validateMessage({ segments: [], encoding: {} }, { controlId: "" }, def).some((x) => /no MSH/.test(x.detail)));
});

test("ACKs are ER7 with every value escaped, MSA-2 echoing the control id, and ERR naming what went wrong", () => {
  const kind = { type: "ADT", event: "A01", controlId: "MSG|0001", sendingApp: "HIS^X", sendingFacility: "GEN&HOSP", processingId: "P" };
  const ack = buildAck(kind, { code: "AE", text: "held for a person: see ExchangeException/x", errors: [{ code: "207", name: "Application internal error", segment: "PID", detail: "held: wsq-xchg-1" }] }, { now: "2026-08-08T10:16:00.000Z", facility: "WSQ Ward", controlId: "ACK-1" });
  const lines = ack.split("\r").filter(Boolean);
  assert.match(lines[0], /^MSH\|\^~\\&\|WardSynQ\|WSQ Ward\|HIS\\S\\X\|GEN\\T\\HOSP\|20260808101600\|\|ACK\^A01\^ACK\|ACK-1\|P\|2\.5\.1$/);
  assert.equal(lines[1], "MSA|AE|MSG\\F\\0001|held for a person: see ExchangeException/x");
  assert.equal(lines[2], "ERR||PID^1|207^Application internal error^HL70357|E||||held: wsq-xchg-1");
  assert.ok(ack.endsWith("\r"));
  assert.ok(RESOURCE_TYPES.includes(MESSAGE_TYPE));
  const r = ExchangeMessage({ id: "m", source: "hl7v2-his", controlId: "c", type: "ADT", event: "A01", receivedAt: "t", digest: "d", raw: "MSH|...", zSegments: [{ id: "ZPI", raw: "ZPI|1" }] });
  assert.equal(r.protocol, "hl7v2"); assert.deepEqual(r.zSegments, [{ id: "ZPI", raw: "ZPI|1" }]);
  // Said in code: the gateway lands through fhir-inbound's landBundle and nothing of its own.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(/landBundle\(request, env, \{/.test(code));
  assert.ok(!/governed\.put\(|repository\.append\(/.test(code), "no write path of its own beyond the receipt through governedForIngest");
  assert.ok(!/zSegments\[\d\]\.raw\.split|parse.*Z/.test(code), "Z-segments are never parsed");
});

test("identifiersFrom carries every repetition with authority and type; a repetition with no value is skipped", () => {
  const msg = parseHl7("MSH|^~\\&|A|B|C|D|20260101||ADT^A01|1|P|2.5\rPID|1||X1^^^AUTH&1.2&ISO^MR~^^^NDHM^NI~Y2^^^^PI");
  const pid = msg.segments[1];
  assert.deepEqual(identifiersFrom(pid, msg.encoding), [{ system: "AUTH", type: "MR", value: "X1" }, { system: null, type: "PI", value: "Y2" }]);
});
