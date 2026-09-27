/* StewardMD - metamorphic (invariance) test of the note reader, real browser.
 * Idea from Laya's research/eval/metamorphic.py: a transformation that keeps the meaning must keep the answer.
 * Probes, built from the app's own phrasing table (DX._nlpCtx()):
 *   pos    "{s}." / "Has {s}." / "Complains of {s}." / "{s} noted."            -> the finding is read
 *   neg    "No {s}." / "Denies {s}." / "Negative for {s}." / "Without {s}." /
 *          "He denies {s}." / "{s}: absent."                                   -> the finding is NOT read
 *   list   "No {a}, {b} or {c}." in every order                                -> none of them is read
 *   filler "{s}. Seen in the evening clinic."                                  -> still read
 * Chart texts (gold train + dev listed case by case; test and held-out sets reported as counts only):
 *   upper case, doubled spaces, a neutral sentence before and after            -> the same findings
 * USAGE: BASE=http://localhost:8804/ CHROME=<chrome> node test/run-nlp-metamorphic.mjs [--check]
 *   --check  exit 1 if any count is above kb/validation/nlp-metamorphic-floors.json (a ceiling per check)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE || "http://localhost:8804/").replace(/\/?$/, "/");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP = Number(process.env.CDP_PORT || 9771);
const JOB = process.env.CLAUDE_JOB_DIR || "/tmp";
const CHECK = process.argv.includes("--check"), WRITE = process.argv.includes("--write-ceilings");
const CEIL_FILE = join(ROOT, "kb", "validation", "nlp-metamorphic-floors.json");
const lit = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));

let serveProc = null;
try { await fetch(BASE); } catch {
  const m = BASE.match(/^http:\/\/localhost:(\d+)\//);
  if (m) { serveProc = spawn("node", [join(ROOT, "test", "serve.mjs"), ROOT, m[1]], { stdio: "ignore" }); for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } } }
}
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${JOB}/nlp-meta-prof-${process.pid}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });
let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
async function load(url) {
  await call("Page.navigate", { url });
  for (let i = 0; i < 150; i++) {
    await sleep(300);
    const r = await ev(`if(window.SMD_KB_READY&&!window.__t){window.__t=1;SMD_KB_READY.then(function(){window.__t=2;});}
      return window.__t===2&&!!(window.SMD_REASON&&window.DX&&window.KB_CORE&&DX._nlpCtx);`);
    if (r === true) return true;
  }
  return false;
}

// gold chart text, as the dx audit writes it
const UNIT = /^(10e\d+|x10e\d+|mg|g|mmol|umol|ng|pg|u|iu|ml|dl|l|ul|pct|percent|meq|mcg|ug|mm|mmhg|sec|s|per|fl|mm3|hr|min)$/i;
function labText(k, v) {
  const parts = String(k).split("_"), i = parts.findIndex((p, j) => j > 0 && UNIT.test(p));
  if (i < 0) return parts.join(" ") + " " + v;
  const unit = parts.slice(i).map((p) => /^10e\d+$/i.test(p) ? "x10^" + p.slice(3) : p).join("/").replace(/^(x10\^\d+)\//, "$1/");
  return parts.slice(0, i).join(" ") + " " + v + " " + unit;
}
function chartText(c) {
  if (c.text) return c.text;
  return [c.presentingComplaint || c.chiefComplaint || "", c.history || "", c.examination || "",
    c.vitals ? "Vitals: " + Object.entries(c.vitals).map(([k, v]) => k + " " + v).join(", ") : "",
    c.labs ? "Labs: " + Object.entries(c.labs).map(([k, v]) => labText(k, v)).join("; ") : "",
    typeof c.imaging === "string" ? c.imaging : "", typeof c.microbiology === "string" ? c.microbiology : ""].join(". ");
}
const splits = JSON.parse(readFileSync(join(ROOT, "kb", "validation", "splits.json"), "utf8")).splits || {};
const texts = [];
const gold = JSON.parse(readFileSync(join(ROOT, "kb", "validation", "cases.json"), "utf8"));
for (const f of readdirSync(join(ROOT, "kb", "validation", "cases")).filter((x) => x.endsWith(".json")).sort()) gold.push(JSON.parse(readFileSync(join(ROOT, "kb", "validation", "cases", f), "utf8")));
gold.forEach((c) => texts.push({ id: c.id, open: splits[c.id] === "train" || splits[c.id] === "dev", t: chartText(c) }));
for (const f of ["dx-heldout.json", "dx-heldout-2.json"]) JSON.parse(readFileSync(join(ROOT, "test", f), "utf8")).forEach((c) => texts.push({ id: c.id, open: false, t: chartText(c) }));

const counts = {}, examples = {};
const bump = (k, ex) => { counts[k] = (counts[k] || 0) + 1; if (ex && (examples[k] = examples[k] || []).length < 12) examples[k].push(ex); };
let failed = false;
try {
  let ver; for (let t = 0; t < 60; t++) { try { ver = await (await fetch(`http://localhost:${CDP}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  sessionId = (await call("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await call("Runtime.enable");
  if (!(await load(BASE))) throw new Error("app did not load (DX._nlpCtx missing?)");
  await ev(`DX.findingCatalog(); return 1`);
  // batch reader in the page: [text] -> [[present keys]]
  await ev(`window.__rd = function (arr) { return arr.map(function (t) { var e = DX.extractText(t); return e.present.slice().sort(); }); }; return 1`);
  const read = async (arr) => JSON.parse(await ev(`return JSON.stringify(window.__rd(${lit(arr)}));`));
  const ctx = JSON.parse(await ev(`var c = DX._nlpCtx(); return JSON.stringify(c);`));

  // ---- probes: one plain synonym per finding (letters and spaces only, 4+ characters) ----
  const probe = [];
  // findings that ARE a resolution or a course ("fully resolved") have no natural negated form
  const NO_NEG_FORM = { clinicallyImproving: 1 };
  for (const k of Object.keys(ctx.syn || {})) {
    if ((ctx.numeric || {})[k] || NO_NEG_FORM[k]) continue;
    const s = (ctx.syn[k] || []).map((x) => String(x).trim()).find((x) => /^[a-z][a-z '-]{3,}$/.test(x) && !/^(no|not|non)\b/.test(x));
    if (s) probe.push({ k, s });
  }
  const baseRead = await read(probe.map((p) => p.s + "."));
  const live = probe.filter((p, i) => baseRead[i].includes(p.k));   // only phrases the reader finds on their own
  counts["probe.findings"] = live.length;
  const POS = ["Has {s}.", "Complains of {s}.", "C/o {s}.", "{s} noted.", "{S}. Seen in the evening clinic.", "Seen in clinic.\n{S} for 2 days."];
  const NEG = ["No {s}.", "Denies {s}.", "Negative for {s}.", "Without {s}.", "He denies {s}.", "{S}: absent.", "No evidence of {s}.", "No signs of {s}.",
    "Nil {s}.", "{S} ruled out."];
  const fill = (tpl, s) => tpl.replace("{s}", s).replace("{S}", s.charAt(0).toUpperCase() + s.slice(1));
  for (const [name, tpls, want] of [["pos", POS, true], ["neg", NEG, false]]) {
    const items = []; live.forEach((p) => tpls.forEach((tpl) => items.push({ p, text: fill(tpl, p.s) })));
    const out = await read(items.map((x) => x.text));
    items.forEach((x, i) => { if (out[i].includes(x.p.k) !== want) bump("probe." + name, `${x.p.k}: "${x.text}"`); });
  }
  // British / American spelling of the same phrase (notes in India are mostly British spelling)
  const SPELL = [[/haem/g, "hem"], [/hem(?!i)/g, "haem"], [/oedema/g, "edema"], [/(^|[^o])edema/g, "$1oedema"], [/oea/g, "ea"], [/diarrhea/g, "diarrhoea"],
    [/anaem/g, "anem"], [/anem/g, "anaem"], [/colour/g, "color"], [/color/g, "colour"], [/oesoph/g, "esoph"], [/esoph/g, "oesoph"], [/aemia/g, "emia"], [/([^a])emia/g, "$1aemia"]];
  const sp = []; live.forEach((p) => SPELL.forEach(([re, to]) => { const v = p.s.replace(re, to); if (v !== p.s && !sp.some((x) => x.text === v + ".")) sp.push({ p, text: v + "." }); }));
  const spo = await read(sp.map((x) => x.text));
  sp.forEach((x, i) => { if (!spo[i].includes(x.p.k)) bump("probe.spelling", `${x.p.k}: "${x.p.s}" -> "${x.text}"`); });
  counts["probe.spellingVariants"] = sp.length;
  // negated lists, every order of three findings (deterministic groups of three)
  const tri = []; for (let i = 0; i + 2 < live.length; i += 3) tri.push([live[i], live[i + 1], live[i + 2]]);
  const PERM = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const litems = []; tri.forEach((g) => PERM.forEach((o) => litems.push({ g, text: `No ${g[o[0]].s}, ${g[o[1]].s} or ${g[o[2]].s}.` })));
  const lout = await read(litems.map((x) => x.text));
  litems.forEach((x, i) => { const hit = x.g.filter((p) => lout[i].includes(p.k)).map((p) => p.k); if (hit.length) bump("probe.list", `${hit.join(",")}: "${x.text}"`); });

  // ---- chart texts: meaning-preserving edits ----
  const T = {
    upper: (t) => t.toUpperCase(),
    spaces: (t) => t.replace(/ /g, "  "),
    neutral: (t) => "Seen in the evening clinic. " + t + " Reviewed with the registrar.",
    lines: (t) => t.replace(/\. /g, ".\n"),   // one statement per line, as notes are often typed
    reversed: (t) => t.split(/(?<=\.)\s+/).reverse().join(" "),   // same statements, another order (tracked, not zero)
  };
  const base = await read(texts.map((x) => x.t));
  for (const [name, fn] of Object.entries(T)) {
    const out = await read(texts.map((x) => fn(x.t)));
    texts.forEach((x, i) => {
      const a = base[i], b = out[i]; if (a.join() === b.join()) return;
      const gained = b.filter((k) => !a.includes(k)), lost = a.filter((k) => !b.includes(k));
      bump("chart." + name, x.open ? `${x.id}: +[${gained}] -[${lost}]` : null);
    });
  }

  // ---- the engine (Laya tests option-order robustness): the same findings in another key order must give the
  // same differential (top 5) and the same antibiotic answer; so must assessing twice
  const gcases = gold.filter((c) => c.findings && Object.keys(c.findings).length);
  const eng = JSON.parse(await ev(`var cs = ${lit(gcases.map((c) => ({ id: c.id, open: splits[c.id] === "train" || splits[c.id] === "dev", k: Object.keys(c.findings).filter((k) => c.findings[k]) })))};
    function run(keys) { var f = {}; keys.forEach(function (k) { f[k] = true; }); var a = SMD_REASON.assess(f);
      var all = [].concat(a.infectious || [], a.nonInfectious || []).sort(function (x, y) { return ((y.rank != null ? y.rank : y.confidence) - (x.rank != null ? x.rank : x.confidence)) || (y.confidence - x.confidence); });
      return all.slice(0, 5).map(function (x) { return x.id; }).join(",") + "|" + a.gate.cls; }
    var out = { order: [], repeat: [] };
    cs.forEach(function (c) { var a = run(c.k), b = run(c.k.slice().reverse()), r = run(c.k);
      if (a !== b) out.order.push(c.open ? c.id + ": " + a + " vs " + b : null); if (a !== r) out.repeat.push(c.open ? c.id : null); });
    return JSON.stringify(out);`));
  eng.order.forEach((x) => bump("engine.order", x)); eng.repeat.forEach((x) => bump("engine.repeat", x));

  for (const k of Object.keys(counts).sort()) {
    console.log(`${k.padEnd(18)} ${counts[k]}`);
    (examples[k] || []).forEach((e) => console.log("    " + e));
  }
  const ceilings = (() => { try { return JSON.parse(readFileSync(CEIL_FILE, "utf8")); } catch { return {}; } })();
  if (WRITE) {
    const ALL = ["probe.pos", "probe.neg", "probe.list", "probe.spelling", "chart.upper", "chart.spaces", "chart.neutral", "chart.lines", "chart.reversed", "engine.order", "engine.repeat"];
    const out = {}; for (const k of ALL) out[k] = counts[k] || 0;
    writeFileSync(CEIL_FILE, JSON.stringify(out, null, 2) + "\n"); console.log("ceilings written");
  }
  if (CHECK) {
    for (const [k, v] of Object.entries(ceilings)) if ((counts[k] || 0) > v) { console.log(`ABOVE CEILING ${k}: ${counts[k] || 0} (ceiling ${v})`); failed = true; }
    console.log(failed ? "FAIL: note reader invariance" : "ALL GREEN: note reader invariance");
  }
} catch (e) { console.error("HARNESS ERROR:", e.message); failed = true; }
finally { chrome.kill(); if (serveProc) serveProc.kill(); setTimeout(() => process.exit(failed ? 1 : 0), 300); }
