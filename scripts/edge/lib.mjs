// scripts/edge/lib.mjs — load the real StewardMD modules in Node for the Edge dataset tools.
// The generator and scorer must use the SAME candidate code the app runs (edge-router.js), so
// training data, tests and production never disagree about what the options were.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DIR = path.join(ROOT, "vault", "plans", "edge-data", "dataset");
// edge-router-2 (2026-10-01): same labels as -1; route_by/candidates recomputed after Layer 0 learned exact
// tool titles and generic drug names (Hinglish/Tenglish rules coverage 0% -> 77%).
export const SCHEMA_VERSION = "edge-router-2";

// Home tool tiles, read from home.js (the HOME_TOOLS literal) so the list cannot drift.
export function homeTools() {
  const s = fs.readFileSync(path.join(ROOT, "home.js"), "utf8");
  const a = s.indexOf("var HOME_TOOLS = [");
  const seg = s.slice(a, s.indexOf("\n  ];", a));
  const re = /\{\s*act:\s*"([^"]+)"[^}]*?tt:\s*"([^"]+)"(?:[^}]*?sub:\s*"([^"]*)")?/g;
  const out = []; let m;
  while ((m = re.exec(seg))) out.push({ act: m[1], tt: JSON.parse('"' + m[2] + '"'), sub: m[3] || "" });
  return out;
}

let loaded = null;
export function loadApp() {
  if (loaded) return loaded;
  const store = { smd_edge: "1" };
  globalThis.window = globalThis;
  globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }), addEventListener() {},
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { appendChild() {}, classList: { add() {}, remove() {} } }, head: { appendChild() {} } };
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const tools = homeTools();
  globalThis.SMD_HOME_TOOLS = () => tools;
  const req = ["calculators.js", "clinical-params.js", "calc-prefill.js", "search.js", "edge-runtime.js", "edge-router.js"];
  const opt = ["drugs.js", "drug-lexicon.js", "drug-link.js"];
  req.forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
  opt.forEach((f) => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }); } catch (e) {} });
  // Memoise the two pure lookups the candidate code repeats for every row (the same words recur
  // thousands of times). Node-only: the app itself is untouched, and results are identical.
  const memo = (obj, name, keyOf) => {
    const fn = obj && obj[name]; if (typeof fn !== "function") return;
    const cache = new Map();
    obj[name] = function () { const k = keyOf.apply(null, arguments); if (!cache.has(k)) cache.set(k, fn.apply(obj, arguments)); return cache.get(k); };
  };
  const S = globalThis.SMD_SEARCH;
  memo(S, "rank", (q, items, o) => q + "|" + (items ? items.length + ":" + (items[0] && items[0].cat) : "") + "|" + JSON.stringify(o || {}));
  memo(globalThis.MEDCALC, "find", (q) => String(q));
  loaded = { E: globalThis.SMD_EDGE, M: globalThis.MEDCALC, P: globalThis.SMD_CPARAMS, tools };
  return loaded;
}

// The Knowledge Base for KB-page rules (MaiKKB + symptoms). SMD_REASON.hasDiseaseRef is reduced to its
// enrichment lookup (reasoning.js also checks SYNDROMES / DDX_NI, which only ADD pages), so a page this
// offers always exists in the app. ~1 s; only --kb and the KB tests load it.
export const KB_EVAL = path.join(ROOT, "vault", "plans", "edge-data", "kb", "kb-nav.jsonl");
let kbLoaded = false;
export function loadKB() {
  const app = loadApp();
  if (!kbLoaded) {
    ["kb/dist/kb.core.js", "kb/dist/kb.clinical.js", "kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.expanded.js", "kb/dist/kb.rag.js",
      "kb/ai/maik-kb.js", "kb/ai/maik-symptoms.js"].forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
    globalThis.SMD_REASON = { hasDiseaseRef: (id) => !!(globalThis.KB_ENRICHMENT && globalThis.KB_ENRICHMENT.byId && globalThis.KB_ENRICHMENT.byId[id]) };
    kbLoaded = true;
  }
  return app;
}

export function sha(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
// Deterministic 0..1 from a string (split assignment never changes between runs).
export function unit(s) { return parseInt(sha(s).slice(0, 8), 16) / 0xffffffff; }

// Round 3 (Edge-Runbook 5e). Keys held out of r3 training AND its dev split, so only the frozen test4 set
// has them: targets ("calculator:gos", "kb:dic") 8%, ambiguous names ("amb:wells") 30%.
export function t4Held(key) { return unit("t4hold:" + key) < (key.startsWith("amb:") ? 0.3 : 0.08); }
// Short names a clinician uses for two or more different modules ("wells": DVT or PE; "insulin": drug, tool or
// calculator). The router must pass on them (danger, "ambiguous"), in training and in test4 alike.
export const AMBIGUOUS_NAMES = ["wells", "timi", "insulin", "mrc", "ipss", "egfr", "gfr", "cci", "homa", "fisher", "gds", "framingham",
  "cam", "lvh", "dlbcl", "retic", "bmr", "coma score", "sah grade", "copd score"];

export function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}
