/* Dose-text parser for the dose calculator (build time only; owner, 2026-09-28).
 *
 * Our monographs store doses as prose ("15 mg/kg/day IM/IV divided q8-12h (max 1.5 g/day)").
 * This turns the parts a calculator can use into numbers, and leaves everything else as text.
 *
 * THE RULE: a number becomes a calculation only when the pattern around it is unambiguous. When in
 * doubt the row stays "text" and the app shows the sentence, never a guess. Every extracted value
 * carries `src`, the exact substring it came from, and verifyRow() rejects any rule whose src is not
 * found verbatim in the source sentence (the round-trip check).
 */

// Units we calculate with, normalised. mcg and ug and µg are the same thing written three ways.
const UNIT = {
  mg: "mg", mcg: "mcg", "µg": "mcg", ug: "mcg", microgram: "mcg", micrograms: "mcg", g: "g", gm: "g", gram: "g", grams: "g",
  unit: "units", units: "units", iu: "IU", ml: "mL", mmol: "mmol", meq: "mEq", ng: "ng"
};
const UNIT_RE = "(mg|mcg|µg|ug|micrograms?|gm|grams?|g|units?|IU|mL|mmol|mEq|ng)";
const NUM = "(\\d+(?:\\.\\d+)?)";
const RANGE = NUM + "(?:\\s*(?:-|–|to)\\s*" + NUM + ")?";
// per time after the /kg: /day, /dose, /h, /min, /week. "/kg/day" and "/kg per day" both appear.
const PER = "(?:\\s*(?:/|per)\\s*(24\\s*h(?:ours?|rs?)?|day|dose|hour|hr|h|minute|min|week|wk|d)\\b)?";

// value [range] unit /kg [per time]
const PERKG = new RegExp(RANGE + "\\s*" + UNIT_RE + "\\s*/\\s*kg" + PER, "gi");
// value [range] unit /m2 [per time]
const PERM2 = new RegExp(RANGE + "\\s*" + UNIT_RE + "\\s*/\\s*m(?:2|²|\\^2)" + PER, "gi");
// a plain amount: value [range] unit, NOT followed by /kg or /m2 or another unit fraction
const FIXED = new RegExp(RANGE + "\\s*" + UNIT_RE + "(?!\\s*/\\s*(?:kg|m2|m²|m\\^2|mL|L|min|\\d+\\s*mL))\\b" + PER, "gi");
// max 1.5 g/day, maximum 4 g per day, not to exceed 1.5 g/day, up to 2 g
// Words in front of an amount that make it a ceiling, not a dose. "Up to" is NOT here: in our
// monographs "Up to 5 mg/kg/day" is the dose itself (an upper end), handled as upTo below.
const CAP_PRE = /(?:max(?:imum)?\.?(?:\s+(?:daily|single|total))?(?:\s+dose)?|not (?:to )?exceed(?:ing)?|no more than|should not exceed|total (?:adult )?dose (?:not )?(?:to )?exceed(?:ing)?)\s*(?:of\s*)?[:=]?\s*$/i;
const UPTO_PRE = /\bup to\s*$/i;

function unit(u) { return UNIT[String(u || "").toLowerCase()] || null; }
function per(p) {
  p = String(p || "").toLowerCase().replace(/\s+/g, "");
  if (!p) return null;
  if (/^24h/.test(p)) return "day";
  if (p === "d" || p === "day") return "day";
  if (p === "dose") return "dose";
  if (p === "h" || p === "hr" || p === "hour") return "h";
  if (p === "min" || p === "minute") return "min";
  if (p === "week" || p === "wk") return "week";
  return null;
}
const num = (s) => (s == null ? null : Number(s));

/* Which population a row is for. Row fields: c (context), r (route or population), d, t, n. */
export function population(row) {
  const s = [row.c, row.r].join(" ").toLowerCase();
  if (/\b(neonat|preterm|newborn)/.test(s)) return "neonate";
  if (/\b(paediatric|pediatric|child|children|infant|adolescent|kids?)\b/.test(s)) {
    if (/\badult\b/.test(s) && /\b(adult|child)\b.*\/|\badult\/child|adult and child|adult\/pediatric|adults? and children/.test(s)) return "any";
    return "child";
  }
  if (/\b(adult|elderly|geriatric)\b/.test(s)) return "adult";
  return "any";
}

/* Which weight to multiply by. The monograph says so in words; we only switch away from actual
 * body weight when it does. */
export function weightBasis(text) {
  const s = String(text || "").toLowerCase();
  if (/adjusted (body )?weight|\badjbw\b/.test(s)) return "adjusted";
  if (/ideal (body )?weight|\bibw\b|lean (body )?weight/.test(s)) return "ideal";
  return "actual";
}

/* Label for one component when a sentence holds several ("Loading 10 mg/kg, then 7.5 mg/kg"). */
function labelBefore(text, idx) {
  const pre = text.slice(Math.max(0, idx - 40), idx).toLowerCase();
  if (/load(ing)?\b[^,;.]*$/.test(pre)) return "loading";
  if (/(then|maintenance|followed by)\b[^,;.]*$/.test(pre)) return "maintenance";
  if (/(initial|start(ing)?)\b[^,;.]*$/.test(pre)) return "initial";
  return null;
}

/* One dosage row -> { kind, parts[], caps[], basis, pop, src } where kind is
 *   perkg  at least one per-kg amount (calculable with weight)
 *   perm2  per m2 only (calculable with weight + height)
 *   fixed  plain amounts only (not weight-based)
 *   text   nothing we can calculate with (shown as the sentence) */
export function parseRow(row) {
  const d = String(row.d || "");
  const all = [d, row.t, row.n].filter(Boolean).join(" | ");
  const parts = [], caps = [];
  // Scan one text for amounts. Each match is a dose part, a cap, or an "up to" upper end, decided by
  // the words just before it. Matches inside an earlier match (a per-kg amount also looks like a
  // plain amount) are skipped.
  const scan = (text, re, perKind, into) => {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text))) {
      const u = unit(m[3]); if (!u) continue;
      if (perKind === "fixed" && u === "mL") continue;
      const lo = num(m[1]), hi = num(m[2]);
      if (!(lo > 0) || (hi != null && !(hi >= lo))) continue;
      const pre = text.slice(Math.max(0, m.index - 45), m.index);
      const item = { per: perKind, lo, hi: hi != null ? hi : null, unit: u, time: per(m[4]), label: labelBefore(text, m.index), src: m[0], at: m.index, end: m.index + m[0].length };
      if (CAP_PRE.test(pre)) { into.caps.push({ value: hi != null ? hi : lo, unit: u, per: perKind === "fixed" ? null : perKind, time: item.time, src: m[0], at: m.index, end: item.end }); continue; }
      if (UPTO_PRE.test(pre)) { item.upTo = true; item.hi = hi != null ? hi : lo; item.lo = null; }
      into.parts.push(item);
    }
  };
  const inD = { parts: [], caps: [] };
  scan(d, PERKG, "kg", inD);
  scan(d, PERM2, "m2", inD);
  const covered = (x) => inD.parts.concat(inD.caps).some((y) => x.at >= y.at && x.end <= y.end && y !== x);
  if (!inD.parts.length) {
    const fx = { parts: [], caps: [] };
    scan(d, FIXED, "fixed", fx);
    fx.parts.forEach((p) => { if (!covered(p)) inD.parts.push(p); });
    fx.caps.forEach((c) => { if (!covered(c)) inD.caps.push(c); });
  } else {
    // Plain-amount ceilings next to per-kg doses ("15 mg/kg/day (max 1.5 g/day)").
    const fx = { parts: [], caps: [] };
    scan(d, FIXED, "fixed", fx);
    fx.caps.forEach((c) => { if (!covered(c)) inD.caps.push(c); });
  }
  // Ceilings written in the timing / notes fields ("Max 15 mg/kg/day; total adult dose not to exceed 1.5 g/day").
  [row.t, row.n].filter(Boolean).forEach((tx) => {
    const o = { parts: [], caps: [] };
    scan(tx, PERKG, "kg", o); scan(tx, PERM2, "m2", o);
    const cov = (x) => o.caps.some((y) => x.at >= y.at && x.end <= y.end && y !== x);
    const f = { parts: [], caps: [] }; scan(tx, FIXED, "fixed", f);
    o.caps.concat(f.caps.filter((c) => !cov(c))).forEach((c) => caps.push(c));
  });
  inD.parts.forEach((p) => { delete p.at; delete p.end; parts.push(p); });
  inD.caps.concat(caps.splice(0)).forEach((c) => { delete c.at; delete c.end; caps.push(c); });
  let kind = parts.some((p) => p.per === "kg") ? "perkg" : parts.some((p) => p.per === "m2") ? "perm2" : parts.length ? "fixed" : "text";
  return { kind, parts, caps, basis: weightBasis(all), pop: population(row), c: row.c || "", r: row.r || "", t: row.t || "", n: row.n || "", d };
}

/* Round-trip check: every extracted number must be quoted from the sentence it came from. */
export function verifyRow(rule, row) {
  const all = [row.d, row.t, row.n].filter(Boolean).join(" | ");
  const bad = [];
  rule.parts.forEach((p) => { if (row.d.indexOf(p.src) < 0) bad.push(p.src); var v = p.lo != null ? p.lo : p.hi; if (p.src.indexOf(String(v)) < 0 && p.src.indexOf(String(v).replace(/^0\./, ".")) < 0) bad.push(p.src); });
  rule.caps.forEach((cp) => { if (all.indexOf(cp.src) < 0 || cp.src.indexOf(String(cp.value)) < 0) bad.push(cp.src); });
  return bad;
}

/* ── Renal: CrCl / eGFR bands, plus dialysis ─────────────────────────────────────────────────────
 * "CrCl 26-50 give recommended dose every 12 h; CrCl 10-25 give half dose every 12 h; CrCl <10 ..."
 * Each band keeps its advice as text; `factor` and `every` are filled only for the plain cases
 * (half dose, 50%, every N h) so the app can compute them, and anything else is shown as written. */
const BAND = /(\b(?:CrCl|creatinine clearance|eGFR|GFR|Clcr)\b[^;:.,0-9<>≤≥]{0,25}?)?\(?\s*(<=|>=|≤|≥|<|>|below|less than|under|above|greater than|over|at least|of)?\s*(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*\)?\s*(mL\/min(?:\/1\.73\s*m(?:2|²))?)?/gi;
const WORD_OP = { below: "<", "less than": "<", under: "<", above: ">", "greater than": ">", over: ">", "at least": ">=", of: null };

function bandBounds(op, a, b) {
  if (op && Object.prototype.hasOwnProperty.call(WORD_OP, op.toLowerCase())) op = WORD_OP[op.toLowerCase()];
  a = Number(a); b = b != null ? Number(b) : null;
  if (b != null) return { lo: Math.min(a, b), hi: Math.max(a, b) };
  if (op === "<" ) return { lo: 0, hi: a - 0.0001 };
  if (op === "<=" || op === "≤") return { lo: 0, hi: a };
  if (op === ">") return { lo: a + 0.0001, hi: Infinity };
  if (op === ">=" || op === "≥") return { lo: a, hi: Infinity };
  return null;
}
function actionOf(text) {
  const s = text.toLowerCase(), out = {};
  if (/\bhalf (the )?(usual |recommended |normal )?dose\b/.test(s)) out.factor = 0.5;
  const pct = s.match(/\b(\d{2})\s*%\s*(of\s+(the\s+)?(usual|normal|recommended)\s+dose)?/); if (pct && !out.factor && /reduce|give|of (the )?(usual|normal|recommended)/.test(s)) out.factor = /reduce/.test(s) ? (100 - Number(pct[1])) / 100 : Number(pct[1]) / 100;
  if (/\b(avoid|contraindicated|not recommended|do not use)\b/.test(s)) out.avoid = true;
  const ev = s.match(/\b(?:every|q)\s*(\d{1,2})\s*(?:h|hr|hours?)\b/); if (ev) out.every = Number(ev[1]);
  if (/no (dose |dosage )?adjustment/.test(s)) out.none = true;
  return out;
}

/* Read the bands out of a renal note. A band is a clearance bound that has the measure word (CrCl,
 * eGFR...) or a severity word just before it, or "mL/min" right after it; its advice is the text up to
 * the next band or the end of the sentence. Advice that still mentions CrCl/eGFR means a band was
 * missed inside it, so that band is marked `mixed` and the app shows the whole note instead. */
export function parseRenal(text) {
  const s = String(text || "");
  const out = { bands: [], dialysis: null, measure: /egfr|\bgfr\b|1\.73/i.test(s) && !/crcl|creatinine clearance/i.test(s) ? "eGFR" : "CrCl" };
  if (!s) return out;
  const dia = s.split(/(?<=[.;])\s+/).filter((x) => /dialys|\bHD\b|\bESRD\b|\bCRRT\b|\bCAPD\b/.test(x));
  if (dia.length) out.dialysis = dia.join(" ").replace(/\s+/g, " ").trim();
  const re = new RegExp(BAND.source, "gi"); let m; const found = [];
  while ((m = re.exec(s))) {
    if (!m[3]) continue;
    const pre = s.slice(Math.max(0, m.index - 30), m.index) + (m[1] || "");
    const hasMeasure = !!m[1] || /(crcl|creatinine clearance|egfr|\bgfr|clcr|mild|moderate|severe|normal)\W{0,3}\(?\s*$/i.test(pre);
    if (!hasMeasure && !m[5]) continue;
    if (Number(m[3]) > 200) continue;                          // not a clearance
    let op = m[2] ? m[2].toLowerCase() : null;
    // "eGFR is below 30": the lazy measure group can swallow the word operator; take it back.
    if (!op && m[1]) { const w = m[1].match(/(below|less than|under|above|greater than|over|at least)\s*$/i); if (w) op = w[1].toLowerCase(); }
    if (m[4] == null && !op) continue;                          // a lone number is not a band
    const bb = bandBounds(op, m[3], m[4]); if (!bb) continue;
    found.push({ at: m.index, end: m.index + m[0].length, src: m[0].trim(), lo: bb.lo, hi: bb.hi });
  }
  const sentenceOf = (at) => {
    const st = Math.max(s.lastIndexOf(". ", at) + 1, 0), en0 = s.indexOf(". ", at), en = en0 < 0 ? s.length : en0 + 1;
    return { st, en, text: s.slice(st, en).trim() };
  };
  found.forEach((f, i) => {
    // Advice BEFORE the number ("Contraindicated when eGFR is below 30"): the band sits mid-sentence
    // after several words. Use the whole sentence, unless that sentence holds other bands too (a
    // header like "adjust for CrCl <=50: CrCl 26-50 ..., or a compound rule), which is dropped.
    const clauseSt = Math.max(s.lastIndexOf(".", f.at), s.lastIndexOf(";", f.at), s.lastIndexOf(":", f.at)) + 1;
    const lead = s.slice(clauseSt, f.at).replace(/\b(crcl|creatinine clearance|egfr|gfr|clcr|mild|moderate|severe|normal|renal|impairment|is|if|when)\b/gi, "").replace(/[^a-z]+/gi, " ").trim();
    if (lead.split(" ").filter(Boolean).length >= 3) {
      const sen = sentenceOf(f.at);
      if (found.some((g) => g !== f && g.at >= sen.st && g.at < sen.en)) return;
      const band = Object.assign({ lo: f.lo, hi: f.hi === Infinity ? null : f.hi, src: f.src, advice: sen.text, sentence: true }, actionOf(sen.text));
      out.bands.push(band); return;
    }
    let stop = i + 1 < found.length ? found[i + 1].at : s.length;
    const dot = s.slice(f.end).search(/\.\s|\.$/); if (dot >= 0) stop = Math.min(stop, f.end + dot);
    // Walk back over the next band's measure word ("...every 12 h; CrCl 10-25") so it is not advice.
    let advice = s.slice(f.end, stop).replace(/[;,]?\s*(?:and\s+(?:for\s+)?)?(?:crcl|creatinine clearance|egfr|gfr|clcr|mild|moderate|severe|normal)?\s*\(?\s*$/i, "");
    advice = advice.replace(/^[\s:,)\-–]+/, "").replace(/\s+/g, " ").trim();
    if (!advice && lead) {
      // Nothing after the number ("Contraindicated when eGFR is below 30 mL/min."): the sentence is the advice.
      const sen = sentenceOf(f.at);
      if (!found.some((g) => g !== f && g.at >= sen.st && g.at < sen.en)) out.bands.push(Object.assign({ lo: f.lo, hi: f.hi === Infinity ? null : f.hi, src: f.src, advice: sen.text, sentence: true }, actionOf(sen.text)));
      return;
    }
    if (!advice) return;
    const band = Object.assign({ lo: f.lo, hi: f.hi === Infinity ? null : f.hi, src: f.src, advice: advice }, actionOf(advice));
    if (/\b(crcl|egfr|gfr|clcr|creatinine clearance)\b/i.test(advice)) band.mixed = true;
    out.bands.push(band);
  });
  out.bands.sort((a, b) => a.lo - b.lo);
  return out;
}

/* ── Hepatic: Child-Pugh classes ─────────────────────────────────────────────────────────────── */
export function parseHepatic(text) {
  const s = String(text || ""), out = { classes: {} };
  if (!s) return out;
  // Hepatic notes name the class mid-sentence ("no adjustment in mild (Child-Pugh A) or moderate
  // (Child-Pugh B) impairment; not studied in severe (Child-Pugh C)"), so each class gets the CLAUSE
  // that mentions it, not the text after it. A class mentioned in two clauses keeps both.
  const clauses = s.split(/;\s+|(?<=\.)\s+(?=[A-Z])/).map((c) => c.trim()).filter(Boolean);
  clauses.forEach((c) => {
    const letters = new Set();
    const re = /Child[- ]?Pugh\s*(?:class(?:es)?\s*|score\s*)?([ABC])(?:\s*(?:or|and|\/|-|–|to)\s*(?:class\s*)?([ABC]))?/gi; let m;
    while ((m = re.exec(c))) {
      const A = m[1].toUpperCase(), B = m[2] ? m[2].toUpperCase() : null;
      const L = ["A", "B", "C"];
      (B && /-|–|to/.test(m[0].slice(m[0].indexOf(A) + 1)) ? L.slice(L.indexOf(A), L.indexOf(B) + 1) : [A].concat(B ? [B] : [])).forEach((x) => letters.add(x));
    }
    letters.forEach((L) => {
      const act = actionOf(c);
      if (!out.classes[L]) out.classes[L] = Object.assign({ advice: c }, act);
      else { out.classes[L].advice += " " + c; Object.assign(out.classes[L], act); }
    });
  });
  return out;
}

/* A whole monograph -> the record the app ships. */
export function parseDrug(g) {
  const rows = (g.dosage || []).map((r) => {
    const rule = parseRow(r), bad = verifyRow(rule, r);
    if (bad.length) { rule.kind = "text"; rule.parts = []; rule.caps = []; rule.rejected = bad; }
    return rule;
  });
  const kinds = rows.map((r) => r.kind);
  return {
    name: g.generic, cls: g.cls || "",
    kind: kinds.indexOf("perkg") >= 0 ? "perkg" : kinds.indexOf("perm2") >= 0 ? "perm2" : kinds.indexOf("fixed") >= 0 ? "fixed" : "text",
    rows,
    quick: ((g.quick || []).find((q) => /adult dose/i.test(q[0])) || [])[1] || "",
    renal: Object.assign({ text: g.renal || "" }, parseRenal(g.renal)),
    hepatic: Object.assign({ text: g.hepatic || "" }, parseHepatic(g.hepatic))
  };
}
