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

console.log(fails === 0 ? "\nALL PASS — MaiK grounds drug doses" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
