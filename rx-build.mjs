/* StewardMD — Prescription safety core (pure, unit-tested).
 *
 * Maps a regimen (drug names, optionally with a dose) to prescription lines, taking
 * doses/brands from the deterministic Drug Index FIRST. It NEVER silently invents a
 * dose: a drug not in the Index (and without a caller-supplied dose) gets a null dose
 * and `unverified:true` so the UI flags it "⚠ confirm" and the doctor fills it in.
 * The prescriber reviews, edits and signs — this only assembles a safe draft.
 *
 * Node + browser: ESM. The browser controller dynamic-imports it (`import('/rx-build.mjs')`).
 */

// Brand lists in the Drug Index include class abbreviations ("ppi","h2","laxative"…) as
// search aliases — never print those as a brand.
const CLASS_TOKENS = new Set([
  "ppi", "h2", "h2 blocker", "antiemetic", "laxative", "bulk-forming laxative", "prokinetic",
  "nsaid", "ssri", "snri", "opioid", "statin", "arb", "acei", "ccb", "beta blocker",
  "antibiotic", "antifungal", "antiviral", "antihistamine", "anticoagulant", "steroid"
]);

function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }

export function pickBrand(entry) {
  const brands = (entry && entry.brands) || [];
  const cls = norm(entry && entry.cls);
  const good = brands.find((b) => { const x = norm(b); return x && !CLASS_TOKENS.has(x) && cls.indexOf(x) < 0; });
  return good || brands[0] || null;
}

function findMatch(name, db) {
  const n = norm(name); if (!n) return null;
  return db.find((e) => norm(e.generic) === n)
    || db.find((e) => (e.brands || []).some((b) => norm(b) === n))
    || db.find((e) => norm(e.generic).split(" ")[0] === n)   // first word of generic (e.g. "psyllium")
    || null;
}

const ADVICE_RE = /lifestyle|dietary|\bdiet\b|advice|counsel|hydration|exercise|reassur|fluid intake|fibre|fiber/i;

/* regimen: [{ name|generic, dose?, freq?, duration?, source?('kb'|'ai'), isAdvice? }]
 * db: Drug Index entries [{ generic, cls, brands[], dose }]
 * → [{ drug, brand, dose, freq, duration, source, unverified, isAdvice }] */
export function buildRxLines(regimen, db) {
  if (!Array.isArray(regimen)) return [];
  db = Array.isArray(db) ? db : [];
  return regimen.map((line) => {
    if (!line) return null;
    if (line.isAdvice || ADVICE_RE.test(line.name || "")) {
      return { drug: line.name || "Advice", brand: null, dose: null, freq: null, duration: null, source: "advice", unverified: false, isAdvice: true };
    }
    const match = findMatch(line.name || line.generic, db);
    const hasDose = line.dose != null && line.dose !== "";
    const dose = hasDose ? line.dose : (match ? match.dose : null);
    const brand = match ? pickBrand(match) : (line.brand || null);
    let source, unverified;
    if (match && !hasDose) { source = "db"; unverified = false; }              // trusted Drug Index dose
    else if (hasDose && line.source) { source = line.source; unverified = (line.source === "ai"); }
    else if (hasDose && match) { source = "db"; unverified = false; }          // known drug, dose given
    else if (hasDose) { source = "ai"; unverified = true; }                    // dose but not in DB, no provenance → FLAG
    else { source = "none"; unverified = true; }                              // no dose at all → FLAG, blank for doctor
    return {
      drug: match ? match.generic : (line.name || line.generic || ""),
      brand: brand, dose: dose, freq: line.freq || null, duration: line.duration || null,
      source: source, unverified: unverified, isAdvice: false
    };
  }).filter(Boolean);
}
