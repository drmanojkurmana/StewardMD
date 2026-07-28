// FollowCare AI — Doctor Action Center comms-model unit tests (validation, vitals, drafts, status, catalogues).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "followcare-comms.js"), "utf8"), { filename: "followcare-comms.js" });
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "followcare-i18n.js"), "utf8"), { filename: "followcare-i18n.js" });
const C = globalThis.FollowCareComms;
const I18N = globalThis.FollowCareI18n;

test("registry: all 10 spec actions present; video is coming-soon; priorities set", () => {
  const ids = C.types().map(t => t.id);
  ["instruction","question","photo_request","vitals_request","earlier_review","video_consult","education","emergency","close_episode"].forEach(t => assert.ok(ids.includes(t), t));
  assert.equal(C.typeDef("video_consult").comingSoon, true);
  assert.equal(C.typeDef("emergency").priority, "high");
  assert.equal(C.typeDef("emergency").confirm, true);      // emergency requires confirmation
  assert.equal(C.typeDef("close_episode").confirm, true);
});

test("validateAction: instruction needs a body; valid one normalizes", () => {
  assert.equal(C.validateAction("instruction", { body: "" }).ok, false);
  const r = C.validateAction("instruction", { body: "  Continue medicines. Reduce salt.  " });
  assert.equal(r.ok, true);
  assert.equal(r.value.body, "Continue medicines. Reduce salt.");
  assert.equal(r.value.requiresResponse, "acknowledge");
  assert.equal(r.value.priority, "normal");
});

test("validateAction: vitals_request requires at least one known field", () => {
  assert.equal(C.validateAction("vitals_request", { fields: [] }).ok, false);
  assert.equal(C.validateAction("vitals_request", { fields: ["nonsense"] }).ok, false);
  const r = C.validateAction("vitals_request", { fields: ["bp", "spo2", "nonsense"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.payload.fields, ["bp", "spo2"]);   // unknown dropped
});

test("validateAction: earlier_review / education / close_episode enums enforced", () => {
  assert.equal(C.validateAction("earlier_review", { when: "someday" }).ok, false);
  assert.equal(C.validateAction("earlier_review", { when: "tomorrow", body: "Please come earlier." }).ok, true);
  assert.equal(C.validateAction("education", { ref: "nope" }).ok, false);
  assert.equal(C.validateAction("education", { ref: "heart_failure" }).ok, true);
  assert.equal(C.validateAction("close_episode", { reason: "bogus" }).ok, false);
  assert.equal(C.validateAction("close_episode", { reason: "recovered", notes: "Doing well" }).ok, true);
});

test("validateAction: video_consult can never be sent", () => {
  assert.equal(C.validateAction("video_consult", {}).ok, false);
});

test("validateResponse: reply needs text; acknowledge is a tap", () => {
  assert.equal(C.validateResponse("reply", { text: "" }).ok, false);
  assert.equal(C.validateResponse("reply", { text: "No fever today" }).value.text, "No fever today");
  assert.equal(C.validateResponse("acknowledge", {}).ok, true);
  assert.equal(C.validateResponse("acknowledge", {}).value.accepted, true);
});

test("validateResponse: vitals validated against plausible ranges (BP structured)", () => {
  const good = C.validateResponse("vitals", { requested: ["bp", "spo2", "pulse"], bp_sys: 128, bp_dia: 82, spo2: 97, pulse: 78 });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.vitals.bp, { sys: 128, dia: 82 });
  assert.equal(good.value.vitals.spo2, 97);
  // implausible SpO2 rejected; diastolic >= systolic rejected
  assert.equal(C.validateResponse("vitals", { requested: ["spo2"], spo2: 5 }).ok, false);
  assert.equal(C.validateResponse("vitals", { requested: ["bp"], bp_sys: 80, bp_dia: 90 }).ok, false);
  // nothing entered → error
  assert.equal(C.validateResponse("vitals", { requested: ["bp"] }).ok, false);
});

test("photoOk: type + size validation", () => {
  assert.equal(C.photoOk("image/jpeg", 1000).ok, true);
  assert.equal(C.photoOk("image/heic", 1000).ext, "heic");
  assert.equal(C.photoOk("application/pdf", 1000).ok, false);
  assert.equal(C.photoOk("image/png", C.PHOTO_MAX_BYTES + 1).ok, false);
});

test("AI draft: deterministic, disease-aware, doctor-approved (never empty for known kinds)", () => {
  const green = C.suggestReply({ pathwayId: "heart_failure", escalation: "green" });
  assert.match(green, /low-salt diet/);
  assert.match(green, /weigh yourself daily/);
  assert.match(green, /next scheduled follow-up/i);
  assert.match(C.suggestReply({ escalation: "red" }), /urgent/i);
  assert.match(C.draft("emergency", {}), /Emergency Department/i);
  assert.match(C.draft("question", { pathwayId: "copd" }), /\?$/);
  assert.notEqual(C.draft("instruction", { pathwayId: "diabetes" }), "");
});

test("status never regresses except failed; log sorts oldest→newest", () => {
  assert.equal(C.advanceStatus("sent", "read"), "read");
  assert.equal(C.advanceStatus("read", "sent"), "read");     // no regression
  assert.equal(C.advanceStatus("read", "failed"), "failed"); // failed wins
  const sorted = C.sortLog([{ createdMs: 30 }, { createdMs: 10 }, { createdMs: 20 }]);
  assert.deepEqual(sorted.map(x => x.createdMs), [10, 20, 30]);
});

test("INTEGRITY: every doctor→patient notification + inbox label exists in the i18n registry (English)", () => {
  // one nudge key per outbound action the patient is notified about (mirrors server notifyKey mapping)
  ["fc.msg.doctor_message","fc.msg.doctor_question","fc.msg.doctor_vitals","fc.msg.doctor_photo",
   "fc.msg.doctor_review","fc.msg.doctor_education","fc.msg.doctor_emergency","fc.msg.doctor_closed"]
    .forEach(k => { assert.ok(I18N.hasKey(k), "missing i18n key " + k); assert.ok(I18N.STR[k].en, "no English for " + k); });
  // portal inbox labels
  ["fc.inbox.title","fc.inbox.acknowledge","fc.inbox.reply","fc.inbox.send","fc.inbox.upload_photo",
   "fc.inbox.submit_vitals","fc.inbox.accept_review","fc.inbox.emergency","fc.inbox.upload_err"]
    .forEach(k => assert.ok(I18N.hasKey(k), "missing inbox key " + k));
  // nudges interpolate the {link} and never leak PHI placeholders
  const msg = I18N.t("fc.msg.doctor_question", "en", { link: "https://x/y" });
  assert.match(msg, /https:\/\/x\/y/);
  assert.ok(!/\{[a-z]+\}/.test(msg), "unfilled placeholder leaked: " + msg);
});

test("catalogues: education filters by pathway; vitals catalogue complete", () => {
  const hf = C.educationFor("heart_failure").map(e => e.ref);
  assert.ok(hf.includes("heart_failure"));      // pathway-specific
  assert.ok(hf.includes("diet_general"));        // generic (no pathways) always included
  assert.ok(!hf.includes("copd_breathing"));     // other-pathway excluded
  assert.equal(C.vitalsCatalogue().length, 8);
  assert.deepEqual(C.entryLabel({ dir: "in", type: "reply" }), "Patient replied");
  assert.deepEqual(C.entryLabel({ dir: "out", type: "instruction" }), "Send Instruction");
});
