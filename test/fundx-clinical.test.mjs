/* test/fundx-clinical.test.mjs — FundX Clinical Engine (rule-based, advisory). */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const win = {};
new Function("window", readFileSync(new URL("../fundx-clinical.js", import.meta.url), "utf8"))(win);
const C = win.SMD_FUNDX_CLINICAL;
ok("clinical: exposed", !!C && !!C.assessSync);

const clean = { quality: 90, confidence: 0.95, microaneurysms: 0, hemorrhages: 0, hard_exudates: 0, cotton_wool_spots: 0, optic_disc: { cup_disc_ratio: 0.4, edema: false }, macula: { visible: true, edema: false } };
let a = C.assessSync(clean, {});
ok("clinical: clean scan → none/routine", a.severity === "none" && a.urgency === "routine" && a.referral == null);
ok("clinical: clean scan → 12-month follow-up + advisory", a.followUp.interval === "12 months" && a.advisory === true);
ok("clinical: clean scan → good confidence", a.confidence > 0.6);
ok("clinical: output validates", C.validate(a).ok === true);

a = C.assessSync({ quality: 85, confidence: 0.9, hemorrhages: 10, hard_exudates: 6, optic_disc: { cup_disc_ratio: 0.4 } }, {});
ok("clinical: PDR features → severe + urgent + retina referral", a.severity === "severe" && a.urgency === "urgent" && a.referral && /Retina/.test(a.referral.to));

a = C.assessSync({ quality: 80, confidence: 0.9, optic_disc: { edema: true, cup_disc_ratio: 0.4 } }, {});
ok("clinical: disc oedema → EMERGENCY + safety flag", a.urgency === "emergency" && a.safetyFlags.indexOf("possible_emergency_evaluate_urgently") >= 0);

a = C.assessSync({ quality: 90, confidence: 0.9, optic_disc: { cup_disc_ratio: 0.75 } }, {});
ok("clinical: high CDR → glaucoma suspect + IOP/fields", a.primaryConsideration === "glaucoma_high" && a.investigations.indexOf("Intraocular pressure") >= 0 && a.referral.to === "Ophthalmology");

a = C.assessSync({ quality: 85, confidence: 0.9, macula: { edema: true }, optic_disc: { cup_disc_ratio: 0.4 } }, {});
ok("clinical: macular oedema → urgent retina referral + OCT", a.urgency === "urgent" && a.investigations.indexOf("OCT") >= 0);

a = C.assessSync({ quality: 85, confidence: 0.9, microaneurysms: 4, hemorrhages: 3, optic_disc: { cup_disc_ratio: 0.4 } }, {});
ok("clinical: moderate NPDR → moderate/soon + ophthalmology", a.severity === "moderate" && a.urgency === "soon");

a = C.assessSync(clean, { dx: "T2DM" });
ok("clinical: diabetic + no HbA1c → missingData HbA1c", a.missingData.indexOf("HbA1c") >= 0);

a = C.assessSync({ quality: 40, confidence: 0.9, microaneurysms: 2, optic_disc: { cup_disc_ratio: 0.4 } }, {});
ok("clinical: poor image quality → safety flag + reduced confidence", a.safetyFlags.indexOf("poor_image_quality") >= 0 && a.confidence < 0.5 && a.safetyFlags.indexOf("clinician_review_required") >= 0);

a = C.assessSync({ findings: { is_mock: true, quality: 90, confidence: 0.9, optic_disc: { cup_disc_ratio: 0.4 } } }, {});
ok("clinical: mock findings → flagged non-diagnostic", a.safetyFlags.indexOf("simulated_findings_not_diagnostic") >= 0);

ok("clinical: validate catches malformed", C.validate({}).ok === false);
ok("clinical: every conclusion is evidence-backed", C.assessSync({ quality: 85, confidence: 0.9, microaneurysms: 5, hemorrhages: 2, optic_disc: { cup_disc_ratio: 0.4 } }, {}).evidence.length > 0);

await (async () => {
  const def = await C.assess(clean, {});
  ok("router: default active is rules", def.provider === "rules" && def.fallback == null);
  C.register({ id: "llm", provider: "vertex", version: "gemini-x", available: () => true, assess: () => Promise.resolve(Object.assign(C.assessSync(clean, {}), { provider: "vertex" })) });
  C.setActive("llm");
  const r = await C.assess(clean, {});
  ok("router: valid LLM provider used", r.provider === "vertex" && r.fallback == null);
  C.register({ id: "bad", provider: "bad", available: () => true, assess: () => Promise.resolve({ nope: 1 }) });
  C.setActive("bad");
  const rb = await C.assess(clean, {});
  ok("router: invalid clinical response → rules fallback", rb.provider === "rules" && rb.fallback && rb.fallback.reason === "invalid_response");
  C.setActive("rules");
  ok("router: back to rules", C.getActive().id === "rules");
})();

// ---- Clinical report assembly (README 09) ----
const rec = {
  eye: "right", timestamp: 111, patientContext: { ref: "p1", name: "Test", dx: "T2DM" },
  quality: { overall: 82, accepted: true, retinalGate: true },
  vision: { findings: { quality: 82, confidence: 0.9, hemorrhages: 10, hard_exudates: 6, optic_disc: { cup_disc_ratio: 0.75 }, macula: { visible: true } } }
};
const rep = C.buildReport(rec);
ok("report: assembled with sections", rep.eye === "right" && rep.patient.ref === "p1" && rep.acquisitionQuality.score === 82 && !!rep.disclaimer);
ok("report: differential ranked most-severe first", rep.differential.length >= 1 && rep.differential[0].rank === 1 && rep.differential[0].severity === "severe");
ok("report: differential entries carry reasoning", typeof rep.differential[0].reasoning === "string" && rep.differential[0].reasoning.length > 0);
ok("report: severity + urgency + recommendations", rep.severity === "severe" && rep.urgency === "urgent" && rep.recommendations && rep.recommendations.referral && rep.recommendations.investigations.length > 0);
ok("report: urgent findings surfaced", Array.isArray(rep.urgentFindings));
const cleanRep = C.buildReport({ eye: "left", quality: { overall: 90, accepted: true }, vision: { findings: { quality: 90, confidence: 0.95, optic_disc: { cup_disc_ratio: 0.4 }, macula: { visible: true } } } });
ok("report: clean scan → none/routine + empty differential-ish", cleanRep.severity === "none" && cleanRep.urgency === "routine");
ok("report: uses a stored assessment when present", C.buildReport({ clinical: { severity: "moderate", urgency: "soon", considerations: [], safetyFlags: [], confidence: 0.7, disclaimer: "x" } }).severity === "moderate");

// ---- Clinician oversight (accept / reject / comment / edit) ----
let rv = C.newReview();
ok("oversight: new review is pending", rv.status === "pending" && rv.history.length === 0);
rv = C.applyReview(rv, "comment", { note: "vessels unclear" });
ok("oversight: comment sets note + logs history", rv.note === "vessels unclear" && rv.history.length === 1);
rv = C.applyReview(rv, "accept", {}, { by: "dr_k" });
ok("oversight: accept sets status + reviewer", rv.status === "accepted" && rv.reviewedBy === "dr_k" && rv.history.length === 2);
let rj = C.applyReview(C.newReview(), "reject");
ok("oversight: reject sets rejected", rj.status === "rejected");
let ed = C.applyReview(C.newReview(), "edit", { text: "Likely moderate NPDR; correlate clinically" });
ok("oversight: edit stores edited conclusion + status", ed.status === "edited" && /NPDR/.test(ed.editedConclusion));
ok("oversight: unknown action is a no-op", C.applyReview(C.newReview(), "bogus").status === "pending");
ok("oversight: does not mutate the input review (immutability)", (() => { const a = C.newReview(); const b = C.applyReview(a, "accept"); return a.status === "pending" && b.status === "accepted"; })());

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
