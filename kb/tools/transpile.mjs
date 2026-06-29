/* StewardMD KB P2a — transpiler: legacy closure source -> declarative DSL.
 *
 * Converts the live engine's `match: e=>...` and `baseScore: e=>...` closures
 * (extracted via .toString()) into the KB's declarative `rule` and `score`.
 * The conversion is verified case-by-case by test/run-kb-parity.mjs (fuzzed
 * against the live closures), so this transpiler is the migration tool, not a
 * trusted oracle — the fuzz is the oracle.
 *
 * Grammar handled (confirmed exhaustively over all 51 syndromes):
 *   match     : boolean expr over e.KEY / !e.KEY / && / || / ( )      [no comparisons]
 *   baseScore : e=>NUM
 *             | e=>{ let i=NUM [,a=0]; return <terms>, i }
 *     term    : COND && (i+=N) | COND && (i-=N)      -> {when:COND, add:±N}
 *             | COND || (i+=N)                       -> {when:{not:COND}, add:N}
 *             | e.KEY>=N && (i-=M)                    -> {when:{key:KEY,gte:N}, add:-M}
 *             | COND && a++ | COND || a++            -> counter term (×mult)
 *             | i += M*a                             -> counter multiplier
 *             | e._x = a                             -> side-effect, ignored
 *   COND is itself a boolean expr (parsed by the same boolean parser).
 */

/* ---------- boolean expression -> rule DSL ---------- */
function tokenize(expr) {
  const toks = []; let i = 0; const s = expr;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (c === "(") { toks.push({ t: "(" }); i++; continue; }
    if (c === ")") { toks.push({ t: ")" }); i++; continue; }
    if (c === "!") { toks.push({ t: "!" }); i++; continue; }
    if (s.startsWith("&&", i)) { toks.push({ t: "&&" }); i += 2; continue; }
    if (s.startsWith("||", i)) { toks.push({ t: "||" }); i += 2; continue; }
    if (s.startsWith("===", i)) { toks.push({ t: "op", v: "===" }); i += 3; continue; }
    if (s.startsWith("!==", i)) { toks.push({ t: "op", v: "!==" }); i += 3; continue; }
    if (s.startsWith(">=", i)) { toks.push({ t: "op", v: ">=" }); i += 2; continue; }
    if (s.startsWith("<=", i)) { toks.push({ t: "op", v: "<=" }); i += 2; continue; }
    if (c === ">") { toks.push({ t: "op", v: ">" }); i++; continue; }
    if (c === "<") { toks.push({ t: "op", v: "<" }); i++; continue; }
    if (s.startsWith("e.", i)) {
      i += 2; let id = "";
      while (i < s.length && /[A-Za-z0-9_$]/.test(s[i])) id += s[i++];
      toks.push({ t: "key", v: id }); continue;
    }
    if (/[0-9]/.test(c)) { let n = ""; while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++]; toks.push({ t: "num", v: parseFloat(n) }); continue; }
    if (/[A-Za-z_$]/.test(c)) { // bare identifier (e.g. true) — read & ignore-safe
      let id = ""; while (i < s.length && /[A-Za-z0-9_$]/.test(s[i])) id += s[i++]; toks.push({ t: "ident", v: id }); continue;
    }
    throw new Error("tokenize: unexpected '" + c + "' in: " + expr);
  }
  return toks;
}

export function parseRule(expr) {
  const toks = tokenize(expr); let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  function parseOr() {
    const parts = [parseAnd()];
    while (peek() && peek().t === "||") { next(); parts.push(parseAnd()); }
    return parts.length === 1 ? parts[0] : { anyOf: parts };
  }
  function parseAnd() {
    const parts = [parseUnary()];
    while (peek() && peek().t === "&&") { next(); parts.push(parseUnary()); }
    return parts.length === 1 ? parts[0] : { allOf: parts };
  }
  function parseUnary() {
    if (peek() && peek().t === "!") { next(); return { not: parseUnary() }; }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new Error("parse: unexpected end of: " + expr);
    if (tk.t === "(") { next(); const r = parseOr(); if (!peek() || next().t !== ")") throw new Error("parse: expected ) in: " + expr); return r; }
    if (tk.t === "key") {
      next();
      if (peek() && peek().t === "op") {
        const op = next().v; const numTok = next();
        if (!numTok || numTok.t !== "num") throw new Error("parse: expected number after " + op + " in: " + expr);
        const cmp = { key: tk.v };
        cmp[{ ">=": "gte", ">": "gt", "<=": "lte", "<": "lt", "===": "eq", "!==": "neq" }[op]] = numTok.v;
        return cmp;
      }
      return tk.v; // bare finding key
    }
    if (tk.t === "ident") { next(); return tk.v === "false" ? { not: [] } : { allOf: [] }; } // true -> always (allOf[]), false -> never
    throw new Error("parse: unexpected token " + JSON.stringify(tk) + " in: " + expr);
  }
  const r = parseOr();
  if (pos !== toks.length) throw new Error("parse: trailing tokens in: " + expr);
  return r;
}

export function matchToRule(matchSrc) {
  // strip arrow / function wrapper to the boolean expression
  let s = matchSrc.trim();
  let m = s.match(/^\(?e\)?\s*=>\s*([\s\S]+)$/) || s.match(/^function\s*\([^)]*\)\s*\{\s*return\s+([\s\S]+?);?\s*\}$/);
  if (!m) throw new Error("matchToRule: unrecognized: " + matchSrc);
  return parseRule(m[1].replace(/;?\s*$/, ""));
}

/* ---------- baseScore -> {base, modifiers} ---------- */
function splitTopCommas(body) {
  const out = []; let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((t) => t.trim()).filter(Boolean);
}

export function baseScoreToModel(baseSrc) {
  const s = baseSrc.replace(/\s+/g, "");
  // form 1: e=>NUM
  let m = s.match(/^\(?e\)?=>(-?\d+(?:\.\d+)?)$/);
  if (m) return { base: parseFloat(m[1]), modifiers: [] };
  // form 2: e=>{let i=NUM[,a=0];return <body>,i}
  m = s.match(/^\(?e\)?=>\{leti=(-?\d+(?:\.\d+)?)(?:,a=0)?;return(.*),i;?\}$/) ||
      s.match(/^function\([^)]*\)\{leti=(-?\d+(?:\.\d+)?)(?:,a=0)?;return(.*),i;?\}$/);
  if (!m) throw new Error("baseScoreToModel: unrecognized: " + baseSrc);
  let base = parseFloat(m[1]);
  const terms = splitTopCommas(m[2]);
  const modifiers = [];
  const counterTerms = [];
  let mult = 0;
  for (const term of terms) {
    let t;
    if (/^e\._\w+=a$/.test(term)) continue;                       // side-effect (e._centor=a)
    if ((t = term.match(/^i\+=(-?\d+(?:\.\d+)?)\*a$/))) { mult = parseFloat(t[1]); continue; } // counter multiplier
    if ((t = term.match(/^i\+=(-?\d+(?:\.\d+)?)$/))) { base += parseFloat(t[1]); continue; }   // unconditional add
    if ((t = term.match(/^(.*)&&\(i\+=(-?\d+(?:\.\d+)?)\)$/))) { modifiers.push({ when: parseRule(t[1]), add: parseFloat(t[2]) }); continue; }
    if ((t = term.match(/^(.*)&&\(i-=(-?\d+(?:\.\d+)?)\)$/))) { modifiers.push({ when: parseRule(t[1]), add: -parseFloat(t[2]) }); continue; }
    if ((t = term.match(/^(.*)\|\|\(i\+=(-?\d+(?:\.\d+)?)\)$/))) { modifiers.push({ when: { not: parseRule(t[1]) }, add: parseFloat(t[2]) }); continue; }
    if ((t = term.match(/^(.*)\|\|\(i-=(-?\d+(?:\.\d+)?)\)$/))) { modifiers.push({ when: { not: parseRule(t[1]) }, add: -parseFloat(t[2]) }); continue; }
    if ((t = term.match(/^(.*)&&a\+\+$/))) { counterTerms.push({ when: parseRule(t[1]) }); continue; }
    if ((t = term.match(/^(.*)\|\|a\+\+$/))) { counterTerms.push({ when: { not: parseRule(t[1]) } }); continue; }
    throw new Error("baseScoreToModel: unrecognized term '" + term + "' in: " + baseSrc);
  }
  // expand counter terms with the multiplier
  for (const ct of counterTerms) modifiers.push({ when: ct.when, add: mult });
  return { base, modifiers };
}
