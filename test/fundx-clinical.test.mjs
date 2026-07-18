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

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
