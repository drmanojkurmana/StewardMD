// MaiK V4 benchmark runner — scores the LIVE prod semantic router, respecting the 3s per-IP rate limit.
import fs from "node:fs";
import path from "node:path";
const DIR = ""+process.env.HOME+"/Developer/StewardMD/test/router-bench";
const ENDPOINT = "https://stewardmd.in/api/ai/route";
const PER_SPEC = Number(process.argv[2] || 30);   // queries per specialty (30 = all)
const CONC = 6;                                    // router type is rate-limit-exempt → parallel OK

const bank = [];
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith(".json") || f.startsWith("results")) continue;
  try { const a = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); if (Array.isArray(a)) a.slice(0, PER_SPEC).forEach(x => bank.push({ ...x, spec: f.replace(".json", "") })); } catch (e) {}
}
console.log("bank size:", bank.length, "| concurrency", CONC);

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const GEN = new Set("syndrome disease disorder acute chronic the a an of category type primary secondary score criteria".split(" "));
const toks = s => norm(s).split(" ").filter(w => w.length >= 4 && !GEN.has(w));
const acr = s => norm(s).split(" ").filter(Boolean).map(w => w[0]).join("");
const compact = s => norm(s).replace(/ /g, "");
function conceptMatch(gold, got) {
  if (!got) return false;
  const gn = norm(gold), rn = norm(got); if (!gn) return true;
  const g = toks(gold), r = toks(got);
  if (g.length && g.filter(w => rn.includes(w)).length / g.length >= 0.5) return true;
  if (r.length && r.filter(w => gn.includes(w)).length / r.length >= 0.5) return true;
  const cg = compact(gold), cr = compact(got);
  if (cg.length <= 7 && acr(got).includes(cg)) return true;   // gold acronym == initials of got expansion
  if (cr.length <= 7 && acr(gold).includes(cr)) return true;
  if (cg.length >= 5 && cr.includes(cg)) return true;
  return false;
}
const INTENT_EQ = { causes: "differential", etiology: "differential", diagnosis: "investigation", management: "treatment", prophylaxis: "prevention" };
const ieq = i => INTENT_EQ[i] || i || "";
async function one(item) {
  const t0 = Date.now(); let j = {};
  try { const r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "Origin": "https://stewardmd.in" }, body: JSON.stringify({ q: item.q }) }); j = await r.json(); } catch (e) { j = { _err: String(e) }; }
  const got = j.primaryConcept || j.topic || "";
  return { q: item.q, spec: item.spec, gold: item.concept, got, goldI: item.intent, gotI: j.intent || "", cOK: conceptMatch(item.concept, got), iOK: ieq(j.intent) === ieq(item.intent), aOK: (!!j.ambiguous) === (!!item.ambiguous), quota: (j.error === "quota" || j.error === "route-failed"), ms: Date.now() - t0 };
}
const results = new Array(bank.length); let idx = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (idx < bank.length) { const k = idx++; results[k] = await one(bank[k]); } }));
const valid = results.filter(r => !r.quota);
const n = valid.length;
const c = valid.filter(r => r.cOK).length, ii = valid.filter(r => r.iOK).length, a = valid.filter(r => r.aOK).length;
const lat = valid.map(r => r.ms).sort((x, y) => x - y);
const pct = x => n ? Math.round(100 * x / n) + "%" : "n/a";
console.log("\n=== MaiK V4 ROUTER BENCHMARK (live prod, rate-limit respected) ===");
console.log("scored (non-quota):", n + "/" + results.length, "| quota-skipped:", results.length - n);
console.log("concept accuracy  :", c + "/" + n, "(" + pct(c) + ")");
console.log("intent accuracy   :", ii + "/" + n, "(" + pct(ii) + ")");
console.log("ambiguity accuracy:", a + "/" + n, "(" + pct(a) + ")");
console.log("router latency ms : p50", lat[Math.floor(n * 0.5)] || 0, "| p90", lat[Math.floor(n * 0.9)] || 0);
console.log("\n=== concept misses (gold -> got) ===");
valid.filter(r => !r.cOK).slice(0, 15).forEach(r => console.log("  " + JSON.stringify(r.q), "|", JSON.stringify(r.gold), "->", JSON.stringify(r.got)));
console.log("\n=== intent misses ===");
valid.filter(r => !r.iOK).slice(0, 12).forEach(r => console.log("  " + JSON.stringify(r.q), "|", r.goldI, "->", r.gotI));
fs.writeFileSync(path.join(DIR, "results.json"), JSON.stringify(results, null, 1));
