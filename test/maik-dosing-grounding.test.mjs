/* Regression guard: MaiK must GROUND drug DOSES, not just drug names.
 *
 * Bug (19 Jul 2026, TestFlight screenshot): asked for "the specific dosing for atropine or
 * pralidoxime" in organophosphate poisoning, MaiK described the management and RE-OFFERED the
 * dose ("I can give you the standard adult dosing … if you'd like") instead of giving it — a
 * no-progress loop. Root cause: resolveTreatment() flattened each rich drugRef object
 * {composition,dose,route,freq,why} down to just x.composition (the NAME), so the grounding
 * package (and the server prompt) never carried "1.8–3 mg IV" / "30 mg/kg". The model had the
 * rationale but no numbers, so it hedged.
 *
 * This test asserts the resolved treatment now exposes structured dosing, and that the server
 * prompt serialises it. USAGE: node test/maik-dosing-grounding.test.mjs (also under `npm test`). */
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStewardAI } from "../kb/ai/interface.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const tx = JSON.parse(fs.readFileSync(join(ROOT, "kb/treatments/organophosphate.json"), "utf8"));
const ai = createStewardAI({ treatments: { organophosphate: tx } }, { flags: { ai: true } });
const r = ai.resolveTreatment("organophosphate");

ok(r && r.default, "resolveTreatment returns a default recommendation");
// Names still present (backward compat — server + addDrug consume these as strings)
ok(Array.isArray(r.default.drugRefs) && r.default.drugRefs.every((x) => typeof x === "string"),
  "default.drugRefs stays a string[] of names (backward compatible)");
// THE FIX: structured dosing survives resolution
const dosing = r.default.dosing || [];
ok(Array.isArray(dosing) && dosing.length >= 2, "default.dosing carries the drug regimens");
const atr = dosing.find((d) => /atropine/i.test(d.drug || ""));
const pra = dosing.find((d) => /pralidoxime/i.test(d.drug || ""));
ok(atr && /mg/.test(atr.dose || ""), "atropine dose survives (contains a mg figure): " + (atr && atr.dose));
ok(pra && /mg\/kg/.test(pra.dose || ""), "pralidoxime dose survives (mg/kg loading): " + (pra && pra.dose));
ok(atr && /secretion/i.test(atr.why || ""), "atropine 'why' (titrate to secretions) survives");
// Regimen steps also carried (the model needs the sequence, not only the drugs)
ok(Array.isArray(r.default.steps) && r.default.steps.length >= 3, "default.steps (regimen sequence) carried");

// ---- server serialisation guard (renderGroundedPrompt is inside the Worker, not exported) ----
const srv = fs.readFileSync(join(ROOT, "functions/api/ai/[[path]].js"), "utf8");
ok(/t\.default\.dosing/.test(srv), "server prompt serialises t.default.dosing");
ok(/deliver it now|never (?:re-?offer|repeat the same offer)/i.test(srv),
  "server prompt forbids re-offering what an affirmative follow-up asked for");

// ---- round 2: sibling bugs of the SAME class (structured data dropped before it reaches the model/UI) ----
// A2 — the first fix carried dose/route/freq but DROPPED duration + coverage (149/61 drugRefs carry them).
const acs = JSON.parse(fs.readFileSync(join(ROOT, "kb/treatments/acs.json"), "utf8"));
const acsDosing = (createStewardAI({ treatments: { acs } }, { flags: { ai: true } }).resolveTreatment("acs").default.dosing) || [];
const tica = acsDosing.find((d) => /ticagrelor/i.test(d.drug || ""));
ok(tica && /12 months/i.test(tica.duration || ""), "A2: regimen DURATION survives resolution (ticagrelor 12 months): " + (tica && tica.duration));
ok(/d\.duration/.test(srv), "A2: server prompt serialises dosing duration");
ok(/clip\(JSON\.stringify\(pc\.cultures\), 900\)/.test(srv), "A2: culture-panel clip widened so multi-organism sensitivities aren't truncated");

const home = fs.readFileSync(join(ROOT, "home.js"), "utf8");
const rx = fs.readFileSync(join(ROOT, "prescription.js"), "utf8");
const reas = fs.readFileSync(join(ROOT, "reasoning.js"), "utf8");

// D — offer capture now catches the model's OWN coached bare "Want X?" phrasing (previously missed → "Yes" lost the offer)
const OFFER_RE = /\b(?:would you like|shall i|do you want|want(?: me to)?|should i|i can(?: also)?)\b([^?]*)\?/i;
ok(OFFER_RE.test("Want the paediatric dose?") && OFFER_RE.test("Want the pregnancy-safe options?"), "D: offer capture catches bare 'Want X?'");
ok(/want\(\?: me to\)\?/.test(home), "D: home.js offer regex widened to bare 'want'");

// B — 'dose?' follow-up now resolves a drug instead of the clarify looping on its own suggested example
ok(/_tp\.dosing\[0\]\.drug/.test(home), "B: MaiK sets lastDrug from the answer's treatment (was never assigned → dead branch)");
ok(/_pop \+ " dosing of " \+ _drug/.test(home), "B: 'dose?'/'X dose' resolves to a real dosing query (no clarify loop)");

// C — Rx 'pre-fill from this' reads the structured dosing (real dose), not names only
ok(/t\.default\.dosing/.test(rx) && /source: dose \? "kb"/.test(rx), "C: prescription pre-fill reads pkg.treatment dosing (real, trusted dose)");

// F — safety-panel Alternatives carry duration + coverage (not just drug · dose)
ok(/duration: a\.duration/.test(reas) && /coverage: a\.coverage/.test(reas), "F: safety-panel Alternatives carry duration + coverage");

// G — antibiotic-stewardship STRUCTURE reaches the model (sibling of the dose bug).
// kb/ai/steward-ai.browser.js builds pkg.refs.stewardship {coverageMatrix, regimens,
// toxicityFactors, deescalation, framework}, but renderGroundedPrompt() serialised ONLY
// refs.drug/calculators/icuProtocols — so "when can I de-escalate/narrow antibiotics?" and
// "what's the coverage matrix?" fell back to general knowledge (framework/deescalation are
// partly reachable as retrieval chunks; coverageMatrix/regimens/toxicityFactors had NO path).
// The serializer must now emit a compact stewardship block.
ok(/rf\.stewardship|refs\.stewardship/.test(srv),
  "G: server prompt serialises refs.stewardship (was dropped — sibling of the dose-grounding bug)");
ok(/coverageMatrix/.test(srv),
  "G: server prompt serialises the antibiotic coverage matrix (organism × drug grid)");
ok(/\bdeescalation\b/.test(srv),
  "G: server prompt serialises de-escalation guidance");
ok(/toxicityFactors/.test(srv),
  "G: server prompt serialises key toxicity/severity factors");

console.log(fails === 0 ? "\nALL PASS — MaiK grounds drug doses" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
