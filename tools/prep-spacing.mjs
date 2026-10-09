// Run-together word repair for legacy bank text (MedMCQA explanations, stems and options lost their line breaks, so
// "petrotympanic fissureThe chorda" and "cell cycle.Phase"). Deterministic and conservative: a space goes in only when
// both halves are known words (frequent in the bank, or in the system word list), the left half is a plain word (no
// inner capital, not a prefix such as "endo" or "hyper"), and the join is not a known product or eponym (MacConkey,
// GeneXpert). Two rules:
//   R1  lower then Upper inside a token:          "fissureThe"   -> "fissure The"
//   R2  . ; : with no space before a capital word: "cycle.Phase"  -> "cycle. Phase"   (not ratios: "Cervix:Body ratio")
// Meaning never changes: only a space is added. Used by tools/prep-item-edits.mjs --spacing.
import fs from "node:fs";

const BRANDS = new Set("macconkey morconkey macneal crofab digifab proseal promark genexpert truenat checkmate pubmed youtube powerpoint whatsapp medmcqa statpearls thinprep surepath ligasure cyberknife gammaknife pillcam ambisome novoseven hemocue mammaprint iodohippurate".split(" "));
const PREFIX = new Set("hyper hypo endo exo extra trans iodo methyl phospho pro intra inter micro macro neo non para peri poly post pre pseudo sub super supra ultra anti auto bio de re ortho meta mono di tri multi semi hemi retro infra co mid".split(" "));
const R1 = /(?<![A-Za-z])([A-Za-z]*?[a-z]{2,})([A-Z][a-z]{2,})(?![A-Za-z])/g;
const R2 = /(?<![A-Za-z.])([A-Za-z]*[a-z]{2,})([.;:])([A-Z][a-z]{2,})(?![A-Za-z])/g;

/* makeKnown(itemLists, dictPath?) -> (word) => boolean. A word is known when it occurs at least 20 times in the bank text
   (stems and explanations) or is in the word list (/usr/share/dict/words by default, skipped when missing). */
export function makeKnown(itemLists, dictPath = "/usr/share/dict/words") {
  const cnt = new Map();
  for (const items of itemLists) for (const it of items) for (const k of ["q", "exp"]) {
    const v = it && it[k];
    if (typeof v === "string") for (const w of v.match(/[A-Za-z]+/g) || []) { const l = w.toLowerCase(); cnt.set(l, (cnt.get(l) || 0) + 1); }
  }
  const dict = new Set();
  try { for (const w of fs.readFileSync(dictPath, "utf8").split("\n")) if (w.length >= 3) dict.add(w.trim().toLowerCase()); } catch (e) { /* no word list */ }
  return (w) => { const l = String(w).toLowerCase(); return (cnt.get(l) || 0) >= 20 || dict.has(l); };
}

function ok(a, b, known) {
  return known(a) && known(b) && !/[A-Z]/.test(a.slice(1)) && !BRANDS.has((a + b).toLowerCase()) &&
    !PREFIX.has(a.toLowerCase()) && !(a.toLowerCase() === "mm" && /^Hg/.test(b));
}

export function fixSpacing(s, known) {
  if (typeof s !== "string" || !s) return s;
  const t = s.replace(R1, (m, a, b) => (ok(a, b, known) ? a + " " + b : m));
  return t.replace(R2, (m, a, p, b, off, str) => {
    const after = str.slice(off + m.length);
    if (p === ":" && /^\s*(ratio|partition|index)/i.test(after)) return m;
    return ok(a, b, known) ? a + p + " " + b : m;
  });
}
