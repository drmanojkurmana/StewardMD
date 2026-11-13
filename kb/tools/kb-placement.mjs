/* StewardMD: where an image lives in the Knowledge Library the app ships.
 *
 * kb/reference holds more articles than the app bundles: kb.enrichment*.js (the KB reader's data) is built from a
 * snapshot, and articles added later with PrepNucleus lesson batches (e.g. "acute_coronary_syndrome_long_case") are
 * not in it. Opening one shows a bare page titled with its raw id. Their figures are real and are reused by the
 * lessons, so they are placed in the shipped article on the same topic instead ("Acute Coronary Syndrome Long Case"
 * -> "Acute coronary syndrome"), and the Image Library links there (owner 2026-11-13).
 *
 * Used by kb/tools/build-kb-v2.mjs (puts the figure on the shipped article's page) and
 * tools/build-image-library.mjs (the "Read the article" target). Pure apart from reading files. */
import fs from "node:fs";
import path from "node:path";

/* Ids the KB reader opens with content: KB_ENRICHMENT.byId, plus the diagnostic diseases (kb/diseases). */
export function shippedKbIds(root) {
  const w = {};
  for (const f of ["kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js"]) {
    let src; try { src = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
    try { new Function("window", src)(w); } catch { /* a malformed shard leaves the ids already read */ }
  }
  const ids = new Set(Object.keys((w.KB_ENRICHMENT && w.KB_ENRICHMENT.byId) || {}));
  for (const f of listJSON(path.join(root, "kb/diseases"))) {
    const d = readJSON(path.join(root, "kb/diseases", f));
    if (d && d.id) ids.add(d.id);
  }
  return ids;
}

/* Topic words a reference title carries on top of the condition itself. */
const SUFFIX = /\b(long|short) case\b|\bspot diagnosis\b|\bclinical case\b|\bosce( station)?\b|\bviva\b/g;
export function normName(s) {
  return String(s == null ? "" : s).toLowerCase()
    .replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}

/* placement(root) -> { shipped:Set, target(id) -> shipped id | null, name(id) -> display name }.
   target(id): the id itself when shipped; else the one shipped article whose name or alias matches the same topic.
   A name that matches two different shipped articles places nowhere (no guessing). */
export function placement(root) {
  const shipped = shippedKbIds(root);
  const docs = new Map();
  for (const dir of ["kb/diseases", "kb/reference"]) {
    for (const f of listJSON(path.join(root, dir))) {
      const d = readJSON(path.join(root, dir, f));
      if (d && d.id && !docs.has(d.id)) docs.set(d.id, d);
    }
  }
  const byName = new Map();
  const add = (n, id) => { const k = normName(n); if (!k || k.length < 3) return; const cur = byName.get(k); byName.set(k, cur && cur !== id ? "" : id); };
  for (const id of shipped) {
    const d = docs.get(id); if (!d) continue;
    add(d.name, id); add(id.replace(/_/g, " "), id);
    for (const a of d.aliases || []) if (typeof a === "string" && a.length <= 60) add(a, id);
  }
  // Exact names win over aliases: re-assert every shipped article's own name.
  for (const id of shipped) { const d = docs.get(id); if (d && d.name) byName.set(normName(d.name), id); }
  const target = (id) => {
    if (!id) return null;
    if (shipped.has(id)) return id;
    const d = docs.get(id); if (!d) return null;
    for (const n of candidates(d.name, id)) { const t = byName.get(n); if (t) return t; }
    return null;
  };
  const name = (id) => { const d = docs.get(id); return (d && d.name) || id; };
  return { shipped, target, name, docs };
}

/* The names a compound title can stand for, most specific first: the whole title, then its lead clause ("Acute
   Leukaemias: Classification and Emergencies" -> "acute leukaemias"), each also in the singular. Exact lookups only. */
export function candidates(title, id) {
  const out = [];
  const push = (s) => { const k = normName(s); if (k && out.indexOf(k) < 0) out.push(k); const one = singular(k); if (one && out.indexOf(one) < 0) out.push(one); };
  push(title); push(String(id || "").replace(/_/g, " "));
  const lead = String(title || "").split(/[:,;]| - | and the | with /)[0];
  if (lead && lead !== title) push(lead);
  return out;
}
function singular(k) {
  return k.split(" ").map((w, i, a) => (i === a.length - 1 && w.length > 4 && /[^s]s$/.test(w) && !/(sis|xis|tis|us|ss|ics)$/.test(w)) ? w.slice(0, -1) : w).join(" ");
}

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function listJSON(dir) { try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort(); } catch { return []; } }
