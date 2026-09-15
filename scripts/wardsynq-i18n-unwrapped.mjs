/* scripts/wardsynq-i18n-unwrapped.mjs - finds English a staff screen shows that does not go through the catalog.
 *
 *   node scripts/wardsynq-i18n-unwrapped.mjs [file ...]      lists every candidate as file:line  "literal"
 *
 * No parser dependency: a small tokenizer (strings, comments, regex literals) is enough to tell a string literal
 * that is an argument of a translation helper from one that is not, and what sits around it. A literal is a
 * CANDIDATE when its text would reach the screen as words: text between tags, a title/placeholder/aria-label/alt
 * value, or plain words (a space, a capitalised word, sentence punctuation). NOT candidates: literals directly inside
 * a helper call (wT/wTH/wTA/wTD/wTEn in ward.js; T/TS/t/tSafe on the site), strings sent to the server or used as
 * selectors, storage keys, patterns or comparisons, class lists, icon names, codes and units.
 * It is a heuristic: test/wardsynq-i18n-unwrapped.test.mjs pins its output for ward.js against an allowlist of the
 * deliberate exceptions, so a new unwrapped string fails there and a reviewer decides.
 */
import { readFileSync } from "node:fs";

const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "&&", "||", "==", "===", "!=", "!==", "<=", ">=", "+=", "-=", "=>"]);
const PUNCT3 = ["===", "!==", "&&=", "||=", "...", ">>>"], PUNCT2 = ["==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "=>", "++", "--", "<<", ">>"];

/** Tokens of an ES5 source: {t: "str"|"id"|"num"|"p"|"re"|"tpl", v, s, e}. Comments are dropped. */
export function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const prevSig = () => (out.length ? out[out.length - 1] : null);
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === '"' || c === "'") {
      const s = i; let v = ""; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") { v += src.slice(i, i + 2); i += 2; } else { v += src[i]; i++; }
      }
      i++;
      let val;
      try { val = Function("return " + src.slice(s, i))(); } catch (e) { val = v; }
      out.push({ t: "str", v: val, raw: src.slice(s, i), s, e: i });
      continue;
    }
    if (c === "`") {
      const s = i; i++;
      while (i < n && src[i] !== "`") { if (src[i] === "\\") i++; i++; }
      i++;
      out.push({ t: "tpl", v: src.slice(s + 1, i - 1), s, e: i });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const s = i; while (i < n && /[\w$]/.test(src[i])) i++;
      out.push({ t: "id", v: src.slice(s, i), s, e: i });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1]))) {
      const s = i; while (i < n && /[\w.]/.test(src[i])) i++;
      out.push({ t: "num", v: src.slice(s, i), s, e: i });
      continue;
    }
    if (c === "/") {
      const p = prevSig();
      if (!p || (p.t === "p" && REGEX_PREV.has(p.v)) || (p.t === "id" && REGEX_PREV.has(p.v))) {
        const s = i; i++; let cls = false;
        while (i < n) {
          const ch = src[i];
          if (ch === "\\") { i += 2; continue; }
          if (ch === "[") cls = true; else if (ch === "]") cls = false;
          else if (ch === "/" && !cls) break;
          else if (ch === "\n") break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/.test(src[i])) i++;
        out.push({ t: "re", v: src.slice(s, i), s, e: i });
        continue;
      }
    }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    const p = PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : c;
    out.push({ t: "p", v: p, s: i, e: i + p.length });
    i += p.length;
  }
  return out;
}

// Calls whose string arguments never reach the screen as words.
const NOT_SHOWN_CALLS = new Set(["apiGet", "apiPost", "apiPut", "apiDelete", "api", "fetch", "fetchRetry", "icdSearch",
  "getElementById", "querySelector", "querySelectorAll", "closest", "getAttribute", "removeAttribute", "hasAttribute", "matches",
  "indexOf", "lastIndexOf", "includes", "split", "replace", "match", "test", "exec", "RegExp", "addEventListener", "removeEventListener",
  "getItem", "setItem", "removeItem", "createElement", "ms", "log", "warn", "error", "info", "debug", "postMessage", "join",
  "encodeURIComponent", "encodeURI", "localeCompare", "hasOwnProperty", "startsWith", "endsWith", "toLocaleString", "toLocaleDateString",
  "toLocaleTimeString", "DateTimeFormat", "dispatchEvent", "CustomEvent", "Event", "stringify", "parse", "go", "download", "matchMedia",
  "execCommand", "add", "remove", "toggle", "contains", "open", "send", "Blob", "URL", "createObjectURL", "setTimeout", "setInterval",
  "importScripts", "Function", "Error", "TypeError", "getPropertyValue", "setProperty", "lsGet", "lsSet", "track", "offlineKey", "logDecisiveRead",
  "keyIntent", "chartNavSet", "chartNavNote", "concat", "padStart", "slice", "substring", "charAt", "has", "get", "set", "delete", "require",
  "insertAdjacentHTML_position", "scrollIntoView", "canPlayType", "hasCap", "can", "cap", "icon", "decode", "encode", "subtle", "digest"]);
const COMPARE = new Set(["===", "!==", "==", "!=", "in", "case", "instanceof", "typeof"]);
const SHOWN_ATTRS = /\b(title|placeholder|aria-label|alt|aria-description|data-tip)\s*=\s*"([^"]*)"/g;

/* Clinical-shaped or code-shaped text that is never a key (units, routes, frequencies, abbreviations, product names). */
const CLINICAL = /^(mg|mcg|µg|ug|g|kg|ml|mL|L|IU|mmHg|bpm|%|°C|°F|mmol\/L|mg\/dL|g\/dL|PO|IV|IM|SC|SL|PR|NG|OD|BD|BID|TDS|TID|QID|QDS|HS|SOS|PRN|STAT|\/min|WardSynQ|MaiK|StewardMD|FHIR|HL7|DICOM|ICD-10|SNOMED CT|LOINC|ABDM|ABHA|NEWS2|PEWS|MEOWS|GCS|SpO2|SBAR|UHID|MRN|OT|ED|ICU|OPD|IPD|PDF|CSV|JSON|OK|am|pm|min|h|d)$/;

/** The text of a literal that would reach the screen as words: [] when none. */
export function visibleText(v) {
  const out = [];
  if (/<\/?[A-Za-z!]|>/.test(v) || /\b[\w-]+\s*=\s*"/.test(v)) {
    for (const m of v.matchAll(SHOWN_ATTRS)) if (wordy(m[2].replace(/&[a-z]+;|&#\d+;/g, " "), false)) out.push(m[2]);
    let s = v;
    // an attribute name with its value opened or closed in this literal: never words
    const firstLt = s.indexOf("<"), firstGt = s.indexOf(">");
    if (firstGt >= 0 && (firstLt < 0 || firstGt < firstLt)) {
      const head = s.slice(0, firstGt);
      if (/["'=]/.test(head) || !head.trim() || /^\s*\/\s*$/.test(head) || /^[\w-]+$/.test(head.trim())) s = s.slice(firstGt + 1);
    }
    s = s.replace(/<[^<>]*>/g, "\n");
    const lastLt = s.lastIndexOf("<");
    if (lastLt >= 0 && s.indexOf(">", lastLt) < 0) s = s.slice(0, lastLt);
    if (!/[<>]/.test(v.replace(/<[^<>]*>/g, "")) && /^\s*[\w-]+\s*=\s*"|"\s*$|^[^<>]*"\s+[\w-]+=/.test(s)) s = "";   // an attribute fragment
    for (const part of s.split("\n")) {
      const t = part.replace(/&[a-z]+;|&#\d+;/g, " ").trim();
      if (wordy(t, true)) out.push(t);
    }
    return out;
  }
  const t = v.replace(/&[a-z]+;|&#\d+;/g, " ");
  if (wordy(t, false)) out.push(t.trim());
  return out;
}
function wordy(t, inMarkup) {
  const x = t.trim();
  if (!/[A-Za-z]{2}/.test(x)) return false;
  if (CLINICAL.test(x) || /^[A-Z0-9][A-Z0-9_\-.\/ +]{0,11}$/.test(x)) return false;            // codes, abbreviations
  if (/^(https?:|\/|#\/|#|\.\/|mailto:|tel:|data:)/.test(x)) return false;                     // links and paths
  if (/^[a-z][\w]*(\.[\w-]+)+$/.test(x) || /^[a-z]+(_[a-z0-9]+)+$/.test(x)) return false;      // keys, codes
  if (/^\d+(\.\d+)?\s?(mg|mcg|ml|mL|g|kg|%|h|min|d)$/.test(x)) return false;
  if (inMarkup) return /[A-Za-z]{2,}/.test(x) && !/^[\w-]+$/.test(x) || /^[A-Z][a-z]+$/.test(x) || /^[a-z]{3,}$/.test(x);
  // plain: words with a space, a capitalised word, or a sentence
  if (/^[\w\-:.\/#?=&%+@$]+$/.test(x) && !/^[A-Z][a-z]{2,}([ .!?]|$)/.test(x) && !(/^\s|\s$/.test(t) && /^[a-z]{3,}$/.test(x))) return false;
  if (/^[a-z0-9]+([-_][a-z0-9]+)*( [a-z0-9]+([-_][a-z0-9]+)*)*$/.test(x) && x.split(" ").some((w) => /-/.test(w))) return false;   // a class list
  if (/^[a-z-]+:[^;]+;/.test(x) || /;\s*[a-z-]+\s*:/.test(x)) return false;                     // inline CSS
  if (/^[a-z]+\([^)]*\)$/.test(x)) return false;                                               // css function
  return true;
}

/** Enclosing call name of token index i ("" when not inside a call's parentheses), and the argument index. */
function scan(src, opts) {
  const helpers = new Set(opts.helpers);
  const toks = tokenize(src);
  const stack = [];   // {name, arg}  one entry per "(" / "[" / "{"
  const found = [];
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    if (k.t === "p" && (k.v === "(" || k.v === "[" || k.v === "{")) {
      const p = toks[i - 1];
      let name = "";
      if (k.v === "(" && p && p.t === "id" && !/^(if|for|while|switch|catch|function|return|typeof)$/.test(p.v)) name = p.v;
      // a function body ends the search for the call a literal sits in: setTimeout(function () { ... }) shows what it renders
      stack.push({ ch: k.v, name, arg: 0, body: k.v === "{" && p && (p.v === ")" || p.v === "=>") });
      continue;
    }
    if (k.t === "p" && (k.v === ")" || k.v === "]" || k.v === "}")) { stack.pop(); continue; }
    if (k.t === "p" && k.v === "," && stack.length) { stack[stack.length - 1].arg++; continue; }
    if (k.t !== "str") continue;
    const top = stack[stack.length - 1];
    // a literal inside a translation helper's own argument list is handled (its key, English, wrap names)
    if (top && top.ch === "(" && helpers.has(top.name)) continue;
    /* The call this literal is an argument of: object and array literals in between are part of the argument, a
     * function body is not (what a callback renders is its own). */
    let call = null;
    for (let j = stack.length - 1; j >= 0; j--) { if (stack[j].body) break; if (stack[j].ch === "(") { call = stack[j]; break; } }
    if (call && NOT_SHOWN_CALLS.has(call.name)) continue;
    const text = visibleText(k.v);
    if (!text.length) continue;
    const prev = toks[i - 1], next = toks[i + 1];
    if (prev && (COMPARE.has(prev.v))) continue;
    if (next && (COMPARE.has(next.v) || (next.v === ":" && top && top.ch === "{" && prev && (prev.v === "{" || prev.v === ",")))) continue;   // an object key
    if (prev && prev.v === "[" && toks[i - 2] && (toks[i - 2].t === "id" || toks[i - 2].v === ")" || toks[i - 2].v === "]")) continue;   // x["key"]
    if (top && top.ch === "(" && top.name === "setAttribute" && top.arg === 0) continue;
    if (top && top.ch === "(" && top.name === "setAttribute" && top.arg === 1) {
      const a0 = toks.slice(0, i).reverse().find((x) => x.t === "str");
      if (!a0 || !/^(title|placeholder|aria-label|alt)$/.test(a0.v)) continue;
    }
    // x.className = "...", el.id = "...", location.hash = "..."
    if (prev && prev.v === "=" && toks[i - 2] && toks[i - 2].t === "id" && /^(className|href|src|id|type|name|value|lang|dir|hash|cssText|htmlFor|download|accept|autocomplete|inputMode|pattern|action|method|target|rel|cursor|display|background|color|width|height|position)$/.test(toks[i - 2].v) && toks[i - 3] && toks[i - 3].v === ".") continue;
    // a single class or boolean attribute appended to markup: " selected", " warn"
    if (/^\s*[a-z][\w-]*\s*$/.test(k.v) && opts.classes && opts.classes.has(k.v.trim())) continue;
    // a table's English read through the catalog at render time (wTEn): the value is in the catalog, and the literal
    // is an element of a table, not text glued into markup
    const inTable = prev && /^[\[,:]$/.test(prev.v) && next && /^[,\]}]$/.test(next.v);
    if (inTable && opts.known && opts.known.has(k.v)) continue;
    if (k.v === "use strict" || /^Bearer $/.test(k.v)) continue;
    if (opts.skip && opts.skip(k, toks, i)) continue;
    found.push({ line: src.slice(0, k.s).split("\n").length, value: k.v, text, s: k.s, e: k.e });
  }
  return found;
}

export const WARD_HELPERS = ["wT", "wTH", "wTA", "wTD", "wTEn"];
export const SITE_HELPERS = ["T", "TS", "t", "tSafe"];

const BOOL_ATTRS = ["selected", "checked", "disabled", "hidden", "readonly", "required", "multiple", "open", "autofocus", "novalidate"];
const ROOT = new URL("..", import.meta.url).pathname;
/** Class names the staff stylesheets define, plus boolean attributes. */
export function classVocabulary() {
  const out = new Set(BOOL_ATTRS);
  for (const f of ["ward.css", "discharge.css", "wardsynq/site/shell.css", "wardsynq/ui/wardsynq.css", "patient-register.css"]) {
    let css = ""; try { css = readFileSync(ROOT + f, "utf8"); } catch (e) { continue; }
    for (const m of css.matchAll(/\.([A-Za-z][\w-]*)/g)) out.add(m[1]);
  }
  return out;
}
/** Every English value of the EN catalog. */
export function catalogEnglish() {
  const win = {};
  new Function("window", "document", "location", "localStorage", readFileSync(ROOT + "wardsynq/site/i18n.js", "utf8"))(win, { documentElement: {}, head: { appendChild() {} }, createElement: () => ({}), addEventListener() {}, querySelectorAll: () => [] }, { hash: "", search: "" }, { getItem: () => null, setItem() {} });
  return new Set(Object.values(win.WSQI18n._catalogs.en));
}

/** Candidates in one file: [{line, value, text}]. */
export function unwrapped(src, helpers, extra) {
  return scan(src, Object.assign({ helpers: helpers || WARD_HELPERS, classes: classVocabulary(), known: catalogEnglish() }, extra || {}));
}

if (import.meta.url === "file://" + process.argv[1]) {
  const ctx = process.argv.includes("--ctx");
  const files = process.argv.slice(2).filter((a) => a !== "--ctx");
  let total = 0;
  for (const f of files.length ? files : ["ward.js"]) {
    const src = readFileSync(ROOT + f, "utf8");
    const helpers = /^wardsynq\/(site|ui)\//.test(f) ? SITE_HELPERS : WARD_HELPERS;
    const list = unwrapped(src, helpers);
    total += list.length;
    const lines = src.split("\n");
    for (const x of list) console.log(f + ":" + x.line + "\t" + JSON.stringify(x.value) + (ctx ? "\n    " + lines[x.line - 1].trim().slice(0, 300) : ""));
  }
  console.error("candidates:", total);
}
