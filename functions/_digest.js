/* StewardMD — Medical Updates: weekly "This Week in Medicine" digest.
 *
 * Synthesizes the week's stored updates into ONE briefing with a SINGLE AI call,
 * cached permanently in D1 (digests table). Reuses the Gemini transport + metering.
 * COPYRIGHT: works only from our own stored summaries/titles; original wording.
 */
import { callGemini } from "./api/ai/[[path]].js";
import { meterGate } from "./_summarize.js";
import { recordUsage, estTokens } from "./_usage.js";

const MODEL = "gemini-2.5-flash";   // synthesis benefits from the fuller model
const DIGEST_SYS =
  "You are a medical editor compiling a concise 'This Week in Medicine' briefing for busy clinicians. " +
  "You are given a list of THIS WEEK'S medical updates (guidelines, drug approvals, safety alerts, major trials) " +
  "with short summaries. Write an original weekly briefing — do NOT copy source wording.\n" +
  "Return ONLY JSON (no prose, no fence): {\"headline\":string, \"intro\":string, \"highlights\":[string], " +
  "\"sections\":[{\"label\":string, \"items\":[string]}]}. `intro` is 1-2 sentences. `highlights` are the 3-6 most " +
  "practice-relevant items as short standalone lines. `sections` group the rest by kind (e.g. 'Guidelines', " +
  "'Drug approvals', 'Safety alerts', 'Major trials') with short one-line entries. Keep it scannable. No text outside the JSON.";

function parseJsonLoose(t) { if (!t) return null; const m = String(t).match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch (e) { return null; } }
function arr(x, n) { return Array.isArray(x) ? x.filter(Boolean).map(String).slice(0, n || 12) : []; }

/** buildDigest(env, items) → { ok, data?, error? }  — items are rowToItem feed objects. */
export async function buildDigest(env, items) {
  if (!items || !items.length) return { ok: false, error: "no-items" };
  const lines = items.slice(0, 40).map((it) =>
    "- [" + (it.type || "update") + "] " + (it.organization || "") + ": " + it.title +
    (it.summary ? " — " + String(it.summary).slice(0, 180) : "")).join("\n");
  const prompt = DIGEST_SYS + "\n\n=== THIS WEEK'S UPDATES ===\n" + lines;
  const gate = await meterGate(env, "updates_digest");
  let lastErr = null;
  for (const model of [env.UPDATES_DIGEST_MODEL || MODEL, "gemini-2.5-flash-lite"]) {
    try {
      const text = await callGemini(Object.assign({}, env, { GEMINI_MODEL: model }), [{ text: prompt }], 1600, { temperature: 0.4 });
      const p = parseJsonLoose(text);
      if (p && (p.headline || p.intro || (p.highlights && p.highlights.length))) {
        const data = {
          headline: String(p.headline || "This Week in Medicine").slice(0, 160),
          intro: String(p.intro || "").slice(0, 600),
          highlights: arr(p.highlights, 8),
          sections: (Array.isArray(p.sections) ? p.sections : []).slice(0, 6).map((s) => ({ label: String(s.label || "").slice(0, 60), items: arr(s.items, 12) })),
          count: items.length,
        };
        if (gate.meter) { try { await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" }); } catch (e) {} }
        return { ok: true, data };
      }
      lastErr = new Error("digest returned unparseable JSON");
    } catch (e) { lastErr = e; }
  }
  if (gate.meter) { try { await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: 0, status: "failed" }); } catch (e) {} }
  return { ok: false, error: String((lastErr && lastErr.message) || lastErr || "digest failed") };
}
