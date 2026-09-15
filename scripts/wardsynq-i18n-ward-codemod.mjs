/* scripts/wardsynq-i18n-ward-codemod.mjs - puts every string ward.js WRITES on screen through the staff language.
 * Owner decision 2026-09-15: when a staff member picks a language, the whole staff interface changes, not the rail.
 *
 *   npm i --no-save --prefix /tmp/acorn acorn        (dev-time only; not a dependency of the app)
 *   ACORN=/tmp/acorn/node_modules/acorn node scripts/wardsynq-i18n-ward-codemod.mjs
 *
 * Re-runnable: a string already converted is an argument of wT/wTH/wTA/wTD and is left alone, and the EN catalog
 * block in wardsynq/site/i18n.js ("ward.js keys (ui-i18n-ward)") is rebuilt from what ward.js now calls, keeping
 * existing key names. Re-run it after merging other ward.js work, then review the diff.
 *
 * WHAT BECOMES A KEY. Text between tags, and title/placeholder/aria-label/alt values, in a string expression that
 * contains markup; plain strings only where they are shown (st.err/st.note, confirm/prompt/alert, toast, announce,
 * esc() fallbacks, label/title/err properties, return values of *View/*Html/*Label... functions). The English stays
 * inline in the call, so English output is byte for byte what it was, with or without i18n.js on the page. Each
 * edit replaces only the literal it splits, so comments and layout survive.
 * WHAT NEVER DOES. Anything recorded arrives as an expression, so it is a {placeholder} value, never a key.
 * Strings sent to the server (apiPost/apiGet/bedsideWrite arguments), compared (===, case, indexOf), used as
 * selectors, other attributes, module-level tables (translated at render time by hand through wTEn), units,
 * routes, frequencies, laterality and upper-case abbreviations are left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const acorn = require(process.env.ACORN || "acorn");

const ROOT = new URL("..", import.meta.url).pathname;
const FILE = ROOT + (process.argv[2] || "ward.js");
const I18N = ROOT + "wardsynq/site/i18n.js";
const PREFIX = "ward.";
const BLOCK_START = "    /* ward.js keys (ui-i18n-ward) */";
const BLOCK_END = "    /* end ward.js keys */";
const HELPERS = new Set(["wT", "wTH", "wTA", "wTD", "wTEn"]);

const src = readFileSync(FILE, "utf8");
const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script", preserveParens: true });

// ---- existing catalog block: keep key names stable across runs -------------------------------------------------
const i18nSrc = readFileSync(I18N, "utf8");
const keyOfText = new Map(), textOfKey = new Map();
{
  const s = i18nSrc.indexOf(BLOCK_START), e = i18nSrc.indexOf(BLOCK_END);
  if (s >= 0 && e > s) {
    for (const m of i18nSrc.slice(s, e).matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*"),?\s*$/gm)) {
      const k = JSON.parse(m[1]), v = JSON.parse(m[2]); keyOfText.set(v, k); textOfKey.set(k, v);
    }
  }
}

// ---- AST helpers -----------------------------------------------------------------------------------------------
const parentOf = new Map();
const kids = (node) => { const out = []; for (const k of Object.keys(node)) { if (k === "type" || k === "start" || k === "end") continue; const v = node[k]; if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && out.push(c)); else if (v && typeof v.type === "string") out.push(v); } return out; };
(function link(node, parent) { parentOf.set(node, parent); kids(node).forEach((c) => link(c, node)); })(ast, null);

const isStr = (n) => n && n.type === "Literal" && typeof n.value === "string";
const unparen = (n) => { while (n && n.type === "ParenthesizedExpression") n = n.expression; return n; };
function stringy(n) {
  n = unparen(n);
  if (!n) return false;
  if (isStr(n)) return true;
  if (n.type === "BinaryExpression" && n.operator === "+") return stringy(n.left) || stringy(n.right);
  if (n.type === "ConditionalExpression") return stringy(n.consequent) || stringy(n.alternate);
  if (n.type === "LogicalExpression") return stringy(n.right);
  return false;
}
function calleeName(c) {
  const f = unparen(c.callee);
  if (!f) return "";
  if (f.type === "Identifier") return f.name;
  if (f.type === "MemberExpression" && !f.computed && f.property.type === "Identifier") return f.property.name;
  return "";
}
const propName = (n) => (!n ? "" : n.type === "Identifier" ? n.name : isStr(n) ? n.value : "");
function composes(p, n) {
  if (!p) return false;
  if (p.type === "ParenthesizedExpression") return true;
  if (p.type === "BinaryExpression" && p.operator === "+" && stringy(p)) return true;
  if (p.type === "ConditionalExpression" && (p.consequent === n || p.alternate === n)) return true;
  if (p.type === "LogicalExpression" && p.right === n && stringy(p)) return true;
  return false;
}
const upOf = (n) => { let c = n, p = parentOf.get(n); while (p && p.type === "ParenthesizedExpression") { c = p; p = parentOf.get(p); } return { c, p }; };

const EXCLUDE_CALLS = new Set(["apiGet", "apiPost", "apiPut", "apiDelete", "fetch", "fetchRetry", "bedsideWrite", "icdSearch",
  "getElementById", "querySelector", "querySelectorAll", "closest", "getAttribute", "setAttribute", "removeAttribute", "hasAttribute",
  "indexOf", "lastIndexOf", "includes", "split", "replace", "match", "test", "exec", "RegExp", "addEventListener", "removeEventListener",
  "getItem", "setItem", "removeItem", "createElement", "val", "checked", "ms", "log", "warn", "error", "info", "debug", "postMessage",
  "encodeURIComponent", "encodeURI", "localeCompare", "hasOwnProperty", "startsWith", "endsWith", "toLocaleString", "toLocaleDateString",
  "toLocaleTimeString", "DateTimeFormat", "dispatchEvent", "CustomEvent", "Event", "focus", "stringify", "parse", "offlineKey",
  "logDecisiveRead", "go", "download", "keyIntent", "matchMedia", "execCommand", "wT", "wTH", "wTA", "wTD", "wTEn", "chartNavSet",
  "chartNavNote", "open", "send", "Blob", "URL", "createObjectURL", "setTimeout", "setInterval", "WebSocket", "importScripts", "Function"]);
const DIALOG_CALLS = new Set(["confirm", "prompt", "alert"]);
/* esc(x || "fallback") is translated only from the markup around it (expand, below), where the scan knows whether
 * it sits in text or in a value="..." that a form would send. */
const SHOWN_CALLS = new Set(["toast", "announce"]);
const UI_STATE_PROP = /^(err|note|msg|message|notice|warning|toast)$|(Err|Error|Msg|Message|Note|Notice|Warning)$/;
const UI_OBJ_PROP = /^(err|detail|warning|label|title|hint|placeholder|heading|empty|help|caption|tip|subtitle)$|(Label|Title|Hint|Heading|Placeholder|Caption)$/;
const UI_VAR = /^(msg|message|label|title|heading|hint|empty|placeholder|warning|help|caption|tip)$|(Msg|Message|Label|Title|Hint|Heading|Empty|Warning)$/;
const UI_FN = /(View|Html|Card|Row|Label|Hint|Title|Bar|banner|Legend|Caption)$/;
const STATE_OBJ = new Set(["st", "state"]);

/* The file's own wrapping IIFE is not "a function": what sits directly in it runs once, at load. */
const isIife = (f) => { const u = upOf(f), s = u.p && upOf(u.p).p; return !!(u.p && u.p.type === "CallExpression" && u.p.callee === u.c && s && s.type === "ExpressionStatement" && parentOf.get(s) === ast); };
const inFunction = (n) => { for (let p = parentOf.get(n); p; p = parentOf.get(p)) if (/Function/.test(p.type)) return isIife(p) ? null : p; return null; };
function fnName(f) {
  if (!f) return "";
  if (f.id && f.id.name) return f.id.name;
  const p = parentOf.get(f);
  if (p && p.type === "VariableDeclarator" && p.id.type === "Identifier") return p.id.name;
  if (p && p.type === "Property") return propName(p.key);
  return "";
}

/* A label handed to a local helper - row("Doses in progress", n), settle(r, "Vitals saved.") - is translated only when
 * every use of that parameter inside the helper shows it: esc(label), label in markup text, st.note = label, or
 * passed on to another helper that does. Any other use (sent, compared, a property of an object, a method called
 * on it, returned) leaves the string alone. */
const FN_DECLS = new Map();
(function collect(n) {
  if (n.type === "FunctionDeclaration" && n.id) { if (!FN_DECLS.has(n.id.name)) FN_DECLS.set(n.id.name, []); FN_DECLS.get(n.id.name).push(n); }
  if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init && /Function/.test(n.init.type)) { if (!FN_DECLS.has(n.id.name)) FN_DECLS.set(n.id.name, []); FN_DECLS.get(n.id.name).push(n.init); }
  kids(n).forEach(collect);
})(ast);
function paramFlavor(fname, idx, depth) {
  const decls = FN_DECLS.get(fname);
  if (!decls || decls.length !== 1 || depth > 2 || idx < 0) return null;
  const f = decls[0], prm = f.params[idx];
  if (!prm || prm.type !== "Identifier") return null;
  const uses = [];
  (function w(x) {
    if (x !== f && /Function/.test(x.type) && x.params.some((q) => q.type === "Identifier" && q.name === prm.name)) return;   // shadowed
    if (x.type === "Identifier" && x.name === prm.name && x !== prm) {
      const par = parentOf.get(x);
      if (!(par.type === "MemberExpression" && par.property === x && !par.computed) && !(par.type === "Property" && par.key === x)) uses.push(x);
    }
    kids(x).forEach(w);
  })(f.body);
  if (!uses.length) return null;
  let raw = false, escd = false;
  for (const u of uses) {
    let c = u, p = parentOf.get(u);
    while (p && (p.type === "ParenthesizedExpression" || (p.type === "LogicalExpression" && p.left !== c) || (p.type === "LogicalExpression" && p.operator === "||") || (p.type === "ConditionalExpression" && p.test !== c))) { c = p; p = parentOf.get(p); }
    if (!p) return null;
    // only tested for being there: harmless
    if ((p.type === "IfStatement" || p.type === "ConditionalExpression" || p.type === "WhileStatement") && p.test === c) continue;
    if (p.type === "UnaryExpression" && p.operator === "!") continue;
    if (p.type === "LogicalExpression" && p.left === c && p.operator === "&&") continue;
    if (p.type === "CallExpression" && p.arguments.includes(c)) {
      const nm = calleeName(p);
      if (nm === "esc" || nm === "toast" || nm === "announce" || ((nm === "alert" || nm === "prompt" || nm === "confirm") && p.arguments[0] === c)) { escd = true; continue; }
      const cal = unparen(p.callee);
      if (cal.type === "Identifier" && cal.name !== fname) { const fl = paramFlavor(cal.name, p.arguments.indexOf(c), depth + 1); if (fl === "plain") { escd = true; continue; } if (fl === "html") { raw = true; continue; } }
      return null;
    }
    if (p.type === "AssignmentExpression" && p.right === c && p.left.type === "MemberExpression" && UI_STATE_PROP.test(propName(p.left.property))) {
      let root = p.left.object; while (root.type === "MemberExpression") root = root.object;
      if (root.type === "Identifier" && STATE_OBJ.has(root.name)) { escd = true; continue; }
    }
    if (p.type === "BinaryExpression" && p.operator === "+") {
      // the chain around it must be markup, and the literal right before it must leave text, not an attribute value
      let top = p; while (parentOf.get(top) && parentOf.get(top).type === "BinaryExpression" && parentOf.get(top).operator === "+") top = parentOf.get(top);
      if (!/[<>]/.test(allLitsOf(top))) return null;
      const before = litBefore(top, u);
      if (before == null || /=s*["']?$/.test(before) || !/>[^<]*$/.test(before)) return null;
      raw = true; continue;
    }
    return null;
  }
  return raw && escd ? null : raw ? "html" : "plain";
}
function allLitsOf(n) { const a = []; (function w(x) { if (isStr(x)) a.push(x.value); kids(x).forEach(w); })(n); return a.join(""); }
/** The literal text that precedes node u in the + chain top (all literals before u's start, joined). */
function litBefore(top, u) { const a = []; (function w(x) { if (x.start >= u.start) return; if (isStr(x) && x.end <= u.start) a.push(x.value); kids(x).forEach(w); })(top); return a.length ? a.join("") : null; }

/** "html" | "plain" | "dialog" | null (leave alone) for the root string expression n. */
function contextOf(n, hasHtml) {
  for (let c = n, p = parentOf.get(n); p; c = p, p = parentOf.get(p)) {
    if (p.type === "CallExpression" && calleeName(p) === "bedsideWrite" && p.arguments[4] === c && !hasHtml) return "plain";
    if ((p.type === "CallExpression" || p.type === "NewExpression") && p.arguments.includes(c) && EXCLUDE_CALLS.has(calleeName(p))) return null;
    if (p.type === "Property" && p.key === c) return null;
    if (p.type === "MemberExpression" && p.property === c) return null;
    if (p.type === "SwitchCase" && p.test === c) return null;
    if (p.type === "BinaryExpression" && p.operator !== "+") return null;
    if (/Function/.test(p.type)) break;
  }
  const { c, p } = upOf(n);
  if (!p) return null;
  if (p.type === "ExpressionStatement") return null;
  if (p.type === "MemberExpression" || p.type === "SwitchCase" || (p.type === "Property" && p.key === c)) return null;
  if (p.type === "AssignmentExpression" && p.left.type === "MemberExpression" && /^(className|href|src|id|type|name|value|lang|dir|hash|cssText|htmlFor|download|accept|autocomplete|inputMode|pattern|action|method|target|rel|cursor|display)$/.test(propName(p.left.property))) return null;
  if (!inFunction(n)) return null;
  if (p.type === "CallExpression" && p.arguments.includes(c)) {
    const nm = calleeName(p);
    // only the question: a prompt's second argument is a default answer, which is sent
    if (DIALOG_CALLS.has(nm)) return hasHtml || p.arguments[0] !== c ? null : "dialog";
    if (hasHtml) return "html";
    if (SHOWN_CALLS.has(nm)) return "plain";
    const callee = unparen(p.callee);
    return callee.type === "Identifier" ? paramFlavor(callee.name, p.arguments.indexOf(c), 0) : null;
  }
  if (hasHtml) return "html";
  if (p.type === "AssignmentExpression" && p.right === c && p.left.type === "MemberExpression") {
    const obj = p.left.object, pn = propName(p.left.property);
    if (/^(textContent|innerText|title|placeholder)$/.test(pn)) return "plain";
    let root = obj; while (root.type === "MemberExpression") root = root.object;
    return root.type === "Identifier" && STATE_OBJ.has(root.name) && UI_STATE_PROP.test(pn) ? "plain" : null;
  }
  if (p.type === "Property" && p.value === c) {
    // An object handed to the server by variable is the risk; only plainly presentational keys pass, plus the
    // {err} that problem() returns.
    return UI_OBJ_PROP.test(propName(p.key)) ? "plain" : null;
  }
  if (p.type === "VariableDeclarator" && p.init === c && p.id.type === "Identifier" && UI_VAR.test(p.id.name)) return "plain";
  if (p.type === "ReturnStatement" && UI_FN.test(fnName(inFunction(n)))) return "plain";
  return null;
}

// ---- composition: literal text with markers for everything else, and where each char came from -----------------
const M0 = "\u0001", M1 = "\u0002";
function compose(n, items, org) {
  n = n.type === "ParenthesizedExpression" ? n : n;
  if (isStr(n)) { for (let k = 0; k < n.value.length; k++) org.push({ lit: n, off: k }); return n.value; }
  if (n.type === "BinaryExpression" && n.operator === "+" && stringy(n)) {
    const l = stringy(n.left) && n.left.type !== "ParenthesizedExpression" ? compose(n.left, items, org) : mark(n.left, items, org);
    const r = isStr(n.right) ? compose(n.right, items, org) : mark(n.right, items, org);
    return l + r;
  }
  return mark(n, items, org);
}
function mark(n, items, org) {
  items.push({ node: n });
  const m = M0 + (items.length - 1) + M1;
  for (let k = 0; k < m.length; k++) org.push({ item: items.length - 1 });
  return m;
}

const edits = [];   // {start, end, text, dead}
function srcWithEdits(start, end) {
  let out = "", pos = start;
  for (const e of edits.filter((x) => !x.dead && x.start >= start && x.end <= end).sort((a, b) => a.start - b.start)) {
    if (e.start < pos) continue;
    out += src.slice(pos, e.start) + e.text; pos = e.end;
  }
  return out + src.slice(pos, end);
}
function pushEdit(start, end, text) {
  for (const e of edits) if (!e.dead && e.start >= start && e.end <= end) e.dead = true;
  edits.push({ start, end, text });
}

function slug(text) {
  const words = text.replace(/\{\w+\}/g, " ").replace(/&[a-z]+;/g, " ").replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  // kebab-case: a camelCase or snake_case key reads as an identifier ("highAlert", "HIGH_ALERT", "rulePack") to the
  // source guards in the tests, which forbid a formulary or a safety engine in the UI
  return words.length ? words.map((w) => w.toLowerCase()).join("-").slice(0, 48).replace(/-$/, "") : "text";
}
function keyFor(text) {
  if (keyOfText.has(text)) return keyOfText.get(text);
  const base = PREFIX + slug(text);
  let k = base, i = 2;
  while (textOfKey.has(k) && textOfKey.get(k) !== text) k = base + i++;
  keyOfText.set(text, k); textOfKey.set(k, text);
  return k;
}
function varName(n) {
  n = unparen(n);
  if (!n) return "v";
  if (n.type === "Identifier") return n.name;
  if (n.type === "MemberExpression") return n.computed ? varName(n.object) : propName(n.property) || "v";
  if (n.type === "CallExpression") {
    const nm = calleeName(n);
    if (nm === "ms") return "icon";
    if (n.arguments.length && /^(esc|when|dose|String|Number|trim)$/.test(nm)) return varName(n.arguments[0]);
    return nm || "v";
  }
  if (n.type === "LogicalExpression") return varName(n.left);
  return "v";
}
/** Does n already carry a translated string (a wT* call inside)? Then it is not a recorded value. */
function hasHelper(n) { let found = false; (function w(x) { if (found) return; if (x.type === "CallExpression" && HELPERS.has(calleeName(x))) { found = true; return; } kids(x).forEach(w); })(n); return found; }
function isData(n) {
  n = unparen(n);
  if (n.type === "Identifier" || n.type === "MemberExpression") return true;
  if (n.type === "CallExpression" && /^(esc|when|dose|String)$/.test(calleeName(n))) return !stringy(n.arguments[0] || null) && !hasHelper(n);
  return false;
}

const CLINICAL = /^(mg|mcg|µg|ug|g|kg|ml|mL|L|IU|mmHg|bpm|%|°C|°F|mmol\/L|mg\/dL|g\/dL|PO|IV|IM|SC|SL|PR|NG|OD|BD|BID|TDS|TID|QID|QDS|HS|SOS|PRN|STAT|Q\d+H|\/min|Left|Right|Bilateral|Oral|Intravenous|Intramuscular|Subcutaneous|Topical|Inhaled|Rectal|Sublingual|Nasal|Once daily|Twice daily|WardSynQ|MaiK|FHIR|HL7|DICOM|ICD-10|SNOMED CT|LOINC)$/i;
const SAFETY = /\b(critical|allerg\w*|interaction|refused|refusal|not saved|nothing was saved|was not|could not|did not|failed|contraindicat\w*|overdose|dose limit|maximum dose|ceiling|exceeds|unsafe|warning|danger|do not)\b/i;
const NO_DUAL_TAGS = new Set(["button", "option", "a", "label", "summary", "th", "select", "legend"]);
const ATTRS = new Set(["title", "placeholder", "aria-label", "alt"]);
const VOID = new Set(["input", "br", "hr", "img", "meta", "link", "col", "source", "wbr"]);
let calls = 0;

/**
 * Scans one composed string expression and records its translations as literal-level edits.
 * flavor: "html" | "plain" | "dialog". st: { mode: "text"|"tag"|"quote"|"attr", stack }, mutated (the state after).
 */
function transformNode(node, flavor, st) {
  const items = [], org = [], s = compose(node, items, org), reps = [];
  const markerAt = (i) => { if (s[i] !== M0) return null; const j = s.indexOf(M1, i); return { idx: Number(s.slice(i + 1, j)), end: j + 1 }; };

  const expand = (idx) => {
    const it = items[idx];
    if (it.done) return;
    it.done = true;
    const n = unparen(it.node);
    const sub = (b) => { if (!b || !stringy(b)) return; const save = JSON.stringify(st); transformNode(unparen(b), flavor, st); const after = JSON.stringify(st); Object.assign(st, JSON.parse(save)); return after; };
    if (n.type === "ConditionalExpression" && stringy(n)) { const a = sub(n.consequent); sub(n.alternate); if (a) Object.assign(st, JSON.parse(a)); }
    else if (n.type === "LogicalExpression" && stringy(n)) sub(n.right);
    else if ((n.type === "BinaryExpression" && n.operator === "+" && stringy(n)) || isStr(n)) { const a = sub(n); if (a) Object.assign(st, JSON.parse(a)); }
    else if (flavor === "html" && n.type === "CallExpression" && calleeName(n) === "esc" && n.arguments.length === 1 && stringy(n.arguments[0]) && (st.mode === "text" || st.mode === "attr")) {
      const top = st.stack[st.stack.length - 1] || "";
      if (!/^(textarea|script|style|pre|code|kbd|option)$/.test(top)) transformNode(unparen(n.arguments[0]), "plain", st);
    }
  };

  const translateRun = (a, b, kind) => {
    const isMarker = (i) => org[i] && org[i].item != null;
    // A recorded value next to the words stays inside the sentence ("{n} refused"); an icon or markup does not.
    const keepEdge = (i) => isData(items[org[i].item].node);
    const skipMarker = (i) => { const m = markerAt(i); return m ? m.end : i + 1; };
    // trim: leading whitespace, punctuation, entities and markers; trailing whitespace and markers
    let ca = a;
    for (;;) {
      if (ca >= b) break;
      if (isMarker(ca)) { if (keepEdge(ca)) break; ca = skipMarker(ca); continue; }
      if (/[\s:;,|·•()\-\/+=]/.test(s[ca])) { ca++; continue; }
      const ent = /^&(middot|nbsp|bull|rarr|larr|times|ndash|#\d+);/.exec(s.slice(ca, Math.min(b, ca + 10)));
      if (ent) { ca += ent[0].length; continue; }
      break;
    }
    let cb = b;
    for (;;) {
      if (cb <= ca) break;
      if (s[cb - 1] === M1) { let j = cb - 1; while (s[j] !== M0) j--; if (keepEdge(j)) break; cb = j; continue; }
      if (/[\s(]/.test(s[cb - 1])) { cb--; continue; }
      const ent = /&(nbsp|middot);$/.exec(s.slice(Math.max(ca, cb - 8), cb));
      if (ent) { cb -= ent[0].length; continue; }
      break;
    }
    if (cb <= ca) return;
    const coreStr = s.slice(ca, cb), litText = coreStr.replace(/\u0001\d+\u0002/g, "").replace(/&[a-z]+;|&#\d+;/g, " ");
    const lt = litText.trim();
    if (/\b\d+(\.\d+)?\s?(mg|mcg|ml|iu|mmol|kg\/m2|units?|g|kg|mmhg|%)(\b|\s|$)/i.test(litText)) return;   // clinical-shaped: a dose, a volume
    if (/^units?$/.test(lt)) return;
    if (!/[A-Za-z]{2}/.test(litText) || /[{}\u0003]/.test(litText) || CLINICAL.test(lt) || /^[A-Z0-9][A-Z0-9_\-.\/]{1,7}$/.test(lt)) return;
    if (flavor !== "html" && /^[\w\-.:\/#?=&%+]+$/.test(lt) && !/^[A-Z][a-z]+[.!?]?$/.test(lt)) return;
    if (/^(https?:|\/api\/|\/ward\/|#\/|mailto:)/.test(lt) || (flavor !== "html" && /^[a-z]+(-[a-z0-9]+)+$/.test(lt)) || /^[a-z]+_[a-z_]+$/.test(lt)) return;
    const topTag = st.stack[st.stack.length - 1] || "";
    if (/^(textarea|script|style|pre|code|kbd)$/.test(topTag)) return;
    const names = new Set(), vars = [], wrap = [];
    let tpl = "";
    for (let i = ca; i < cb;) {
      const m = markerAt(i);
      if (!m) { tpl += s[i]; i++; continue; }
      expand(m.idx);
      const it = items[m.idx];
      let nm = varName(it.node).replace(/\W/g, "") || "v";
      if (/^\d/.test(nm)) nm = "v" + nm;
      let k = nm, j = 2; while (names.has(k)) k = nm + j++;
      names.add(k);
      vars.push(k + ": " + srcWithEdits(it.node.start, it.node.end));
      if (kind === "text" && flavor === "html" && isData(it.node)) wrap.push(k);
      tpl += "{" + k + "}";
      i = m.end;
    }
    const key = keyFor(tpl);
    const dual = kind === "text" && flavor === "html" && SAFETY.test(tpl) && !NO_DUAL_TAGS.has(topTag);
    const fn = kind === "attr" ? "wTA" : flavor === "html" ? "wTH" : flavor === "dialog" ? "wTD" : "wT";
    let call = fn + "(" + JSON.stringify(key) + ", " + JSON.stringify(tpl);
    if (vars.length || wrap.length || dual) call += ", " + (vars.length ? "{ " + vars.join(", ") + " }" : "null");
    if (wrap.length || dual) call += ", " + JSON.stringify(wrap.join(" "));
    if (dual) call += ", 1";
    call += ")";
    const edgeA = org[ca].lit ? { l: org[ca].lit, o: org[ca].off } : { l: items[org[ca].item].node, o: 0, node: true };
    const edgeB = org[cb - 1].lit ? { l: org[cb - 1].lit, o: org[cb - 1].off + 1 } : { l: items[org[cb - 1].item].node, o: -1, node: true };
    reps.push({ l1: edgeA.l, o1: edgeA.o, n1: !!edgeA.node, l2: edgeB.l, o2: edgeB.o, n2: !!edgeB.node, call });
    calls++;
  };

  if (flavor !== "html") {
    for (let i = 0; i < s.length;) { const m = markerAt(i); if (m) { expand(m.idx); i = m.end; } else i++; }
    translateRun(0, s.length, "text");
  } else {
    let runStart = -1, attrStart = -1, tagBuf = "";
    for (let i = 0; i < s.length;) {
      const m = markerAt(i), ch = s[i];
      if (st.mode === "text") {
        if (runStart < 0) runStart = i;
        if (m) { expand(m.idx); i = m.end; continue; }
        if (ch === "<" && /[A-Za-z\/!]/.test(s[i + 1] || "")) { translateRun(runStart, i, "text"); runStart = -1; st.mode = "tag"; tagBuf = ""; i++; continue; }
        i++; continue;
      }
      if (st.mode === "tag") {
        if (m) { expand(m.idx); tagBuf += "\u0003"; i = m.end; continue; }
        if (ch === '"') {
          const am = /([\w-]+)\s*=\s*$/.exec(tagBuf);
          if (am && ATTRS.has(am[1].toLowerCase())) { st.mode = "attr"; attrStart = i + 1; } else st.mode = "quote";
          i++; continue;
        }
        if (ch === ">") {
          const tm = /^\s*(\/?)([A-Za-z][\w-]*)/.exec(tagBuf);
          if (tm) {
            const name = tm[2].toLowerCase();
            if (tm[1]) { const at = st.stack.lastIndexOf(name); if (at >= 0) st.stack.length = at; }
            else if (!VOID.has(name) && !/\/\s*$/.test(tagBuf)) st.stack.push(name);
          }
          st.mode = "text"; i++; continue;
        }
        tagBuf += ch; i++; continue;
      }
      if (st.mode === "quote") {
        if (m) { expand(m.idx); i = m.end; continue; }
        if (ch === '"') { st.mode = "tag"; tagBuf += '""'; }
        i++; continue;
      }
      if (st.mode === "attr") {
        if (attrStart < 0) attrStart = i;
        if (m) { expand(m.idx); i = m.end; continue; }
        if (ch === '"') { translateRun(attrStart, i, "attr"); attrStart = -1; st.mode = "tag"; tagBuf += '""'; i++; continue; }
        i++; continue;
      }
    }
    if (st.mode === "text" && runStart >= 0) translateRun(runStart, s.length, "text");
    else if (st.mode === "attr" && attrStart >= 0) translateRun(attrStart, s.length, "attr");
  }

  // literal-level edits: consecutive replacements that share a literal become one edit
  reps.sort((x, y) => x.l1.start - y.l1.start || x.o1 - y.o1);
  for (let i = 0; i < reps.length;) {
    const r0 = reps[i];
    const pieces = [];
    if (!r0.n1 && r0.o1 > 0) pieces.push(JSON.stringify(r0.l1.value.slice(0, r0.o1)));
    pieces.push(r0.call);
    let cur = r0; i++;
    while (i < reps.length && !cur.n2 && reps[i].l1 === cur.l2) {
      const gap = cur.l2.value.slice(cur.o2, reps[i].o1);
      if (gap) pieces.push(JSON.stringify(gap));
      pieces.push(reps[i].call); cur = reps[i]; i++;
    }
    if (!cur.n2 && cur.o2 < cur.l2.value.length) pieces.push(JSON.stringify(cur.l2.value.slice(cur.o2)));
    pushEdit(r0.l1.start, cur.l2.end, pieces.join(" + "));
  }
}

// ---- roots, innermost first ------------------------------------------------------------------------------------
const roots = [];
(function walk(n) { kids(n).forEach(walk); if (n.type !== "ParenthesizedExpression" && stringy(n)) { const u = upOf(n); if (!composes(u.p, u.c)) roots.push(n); } })(ast);
roots.sort((a, b) => (a.end - a.start) - (b.end - b.start));
const insideHelper = (n) => { for (let p = parentOf.get(n); p; p = parentOf.get(p)) if (p.type === "CallExpression" && HELPERS.has(calleeName(p))) return true; return false; };
const allLits = (n) => { const a = []; (function w(x) { if (isStr(x)) a.push(x.value); kids(x).forEach(w); })(n); return a.join(""); };

/* ---- PASS 2 (PASS=2, run automatically after pass 1): module-level word tables ------------------------------------
 * A table (var X = {code: "Words"} or [["code", "Words"]] or [{k: "code", l: "Words"}]) is read once at load, so its
 * words are translated where they are READ: X[code], X[i][1], and p[1] / p.l inside X.map(function (p) {...}) become
 * wTEn(...), which looks the English up in the catalog. Every prose value of such a table goes into the catalog. */
const PASS2 = process.env.PASS === "2";
const tableTexts = new Set();
const proseValue = (v) => typeof v === "string" && /[A-Za-z]{2}/.test(v) && /[A-Z ]/.test(v) && !/^[A-Z0-9_\-]{1,10}$/.test(v) &&
  !/^[a-z0-9]+([-_ .][a-z0-9]+)*$/.test(v) || (typeof v === "string" && / /.test(v) && /^[a-z]/.test(v) && !/[_\/#]/.test(v));
const proseOk = (v) => proseValue(v) && !CLINICAL.test(v.trim()) && !/[{}<>]/.test(v) && !/^(\/|#|https?:)/.test(v) &&
  !/\b\d+(\.\d+)?\s?(mg|mcg|ml|iu|mmol|kg\/m2|units?|g|kg|mmhg|%)(\b|\s|$)/i.test(v);
const tables = new Map();   // name -> { map: bool, idx: Set<number>, props: Set<string> }
for (const stmt of kids(ast)) void stmt;
(function findTables(n) {
  if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init && !inFunction(n) && /^[A-Z][A-Z0-9_]+$/.test(n.id.name) && n.id.name !== "CHART_CATS" && n.id.name !== "SHORTCUTS") {
    const t = { map: false, idx: new Set(), props: new Set() }, texts = [];
    if (n.init.type === "ObjectExpression") {
      for (const p of n.init.properties) if (p.value && isStr(p.value) && proseOk(p.value.value)) { t.map = true; texts.push(p.value.value); }
    } else if (n.init.type === "ArrayExpression") {
      for (const el of n.init.elements) {
        if (el && el.type === "ArrayExpression") el.elements.forEach((x, i) => { if (i > 0 && isStr(x) && proseOk(x.value)) { t.idx.add(i); texts.push(x.value); } });
        if (el && el.type === "ObjectExpression") el.properties.forEach((p) => { if (p.value && isStr(p.value) && proseOk(p.value.value) && !/^(k|key|id|code|act|value|unit|u|loinc|type|kind)$/.test(propName(p.key))) { t.props.add(propName(p.key)); texts.push(p.value.value); } });
      }
    }
    if (t.map || t.idx.size || t.props.size) { tables.set(n.id.name, t); texts.forEach((x) => tableTexts.add(x)); }
  }
  kids(n).forEach(findTables);
})(ast);

const unwrapNames = new Map();   // a wTH call -> var names that now hold translated table words (not lang="en")
function shownValue(m) {
  if (!inFunction(m)) return false;
  const { c, p } = upOf(m);
  if (!p) return false;
  if (p.type === "CallExpression" && calleeName(p) === "wTEn") return false;
  for (let cc = m, pp = parentOf.get(m); pp; cc = pp, pp = parentOf.get(pp)) {
    if (pp.type === "CallExpression" && HELPERS.has(calleeName(pp)) && pp.arguments[2] === cc && cc.type === "ObjectExpression") {
      const prop = cc.properties.find((x) => x.value.start <= m.start && x.value.end >= m.end);
      if (prop && calleeName(pp) === "wTH" && isStr(pp.arguments[3])) { if (!unwrapNames.has(pp)) unwrapNames.set(pp, new Set()); unwrapNames.get(pp).add(propName(prop.key)); }
      break;
    }
    if (pp.type === "CallExpression" && HELPERS.has(calleeName(pp))) return false;
    if (/Function/.test(pp.type)) break;
  }
  if (p.type === "MemberExpression" && p.object === c) return false;
  if (p.type === "CallExpression" && p.callee === c) return false;
  if (p.type === "AssignmentExpression" && p.left === c) return false;
  if (p.type === "UnaryExpression" || p.type === "UpdateExpression") return false;
  for (let cc = m, pp = parentOf.get(m); pp; cc = pp, pp = parentOf.get(pp)) {
    if ((pp.type === "CallExpression" || pp.type === "NewExpression") && pp.arguments.includes(cc) && EXCLUDE_CALLS.has(calleeName(pp)) && !HELPERS.has(calleeName(pp))) return false;
    if (pp.type === "BinaryExpression" && pp.operator !== "+") return false;
    if (pp.type === "SwitchCase" && pp.test === cc) return false;
    if (pp.type === "Property" && pp.key === cc) return false;
    if (pp.type === "IfStatement" && pp.test === cc) return false;
    if (/Function/.test(pp.type)) break;
  }
  if (p.type === "LogicalExpression" && p.left === c && parentOf.get(p) && /IfStatement|ConditionalExpression/.test(parentOf.get(p).type) && parentOf.get(p).test === p) return false;
  return true;
}
function wrapEdit(m) { edits.push({ start: m.start, end: m.end, text: "wTEn(" + src.slice(m.start, m.end) + ")" }); calls++; }
if (PASS2) {
  (function walk(n) {
    kids(n).forEach(walk);
    if (n.type !== "MemberExpression") return;
    // X[code] (a map) or X[i][j] (pairs) or X[i].prop (objects)
    const o = n.object;
    if (n.computed && o.type === "Identifier" && tables.has(o.name) && tables.get(o.name).map && shownValue(n)) return wrapEdit(n);
    if (n.computed && o.type === "MemberExpression" && o.computed && o.object.type === "Identifier" && tables.has(o.object.name) && n.property.type === "Literal" && tables.get(o.object.name).idx.has(n.property.value) && shownValue(n)) return wrapEdit(n);
    if (!n.computed && o.type === "MemberExpression" && o.computed && o.object.type === "Identifier" && tables.has(o.object.name) && tables.get(o.object.name).props.has(propName(n.property)) && shownValue(n)) return wrapEdit(n);
    // p[j] / p.prop where p is the first parameter of X.map/forEach/filter/some(function (p) {...})
    if (o.type === "Identifier") {
      for (let f = inFunction(n); f; f = inFunction(f)) {
        if (!f.params.length || f.params[0].type !== "Identifier" || f.params[0].name !== o.name) continue;
        const call = upOf(f).p;
        if (!call || call.type !== "CallExpression" || !call.arguments.includes(upOf(f).c)) break;
        const callee = unparen(call.callee);
        if (callee.type !== "MemberExpression" || !/^(map|forEach|filter|some|every|reduce)$/.test(propName(callee.property))) break;
        let tbl = unparen(callee.object);
        while (tbl && tbl.type === "CallExpression" && unparen(tbl.callee).type === "MemberExpression" && /^(filter|slice|concat)$/.test(propName(unparen(tbl.callee).property))) tbl = unparen(unparen(tbl.callee).object);
        if (!tbl || tbl.type !== "Identifier" || !tables.has(tbl.name)) break;
        const t = tables.get(tbl.name);
        if ((n.computed && n.property.type === "Literal" && t.idx.has(n.property.value)) || (!n.computed && t.props.has(propName(n.property)))) { if (shownValue(n)) wrapEdit(n); }
        break;
      }
    }
  })(ast);
}

for (const r of PASS2 ? [] : roots) {
  if (insideHelper(r)) continue;
  const lits = allLits(r);
  const hasHtml = /[<>]/.test(lits);
  const flavor = contextOf(r, hasHtml);
  if (!flavor) continue;
  const fi = lits.search(/[<>]/);
  const st = { mode: "text", stack: [] };
  if (flavor === "html" && fi >= 0 && lits[fi] === ">") st.mode = /^\s*"/.test(lits) ? "quote" : "tag";
  transformNode(r, flavor, st);
}

for (const [call, names] of unwrapNames) {
  const lit = call.arguments[3], keep = lit.value.split(" ").filter((x) => x && !names.has(x)).join(" ");
  edits.push({ start: lit.start, end: lit.end, text: JSON.stringify(keep) });
}
const live = edits.filter((e) => !e.dead).sort((a, b) => b.start - a.start);
let outSrc = src;
for (const e of live) outSrc = outSrc.slice(0, e.start) + e.text + outSrc.slice(e.end);
writeFileSync(FILE, outSrc);

// ---- the EN block, from what the file now calls ----------------------------------------------------------------
const used = new Map();
for (const m of outSrc.matchAll(/\bwT[HADS]?\(("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")/g)) {
  const k = JSON.parse(m[1]), v = JSON.parse(m[2]);
  if (used.has(k) && used.get(k) !== v) throw new Error("key " + k + " has two English texts");
  used.set(k, v);
}
for (const m of outSrc.matchAll(/\bwTEn\(("(?:[^"\\]|\\.)*")\)/g)) { const v = JSON.parse(m[1]); used.set(keyFor(v), v); }
for (const v of tableTexts) used.set(keyFor(v), v);
// discharge.js (the discharge workstation, "ward.dc-*") and patient-register.js (the check-in sheet, "ward.reg-*")
// write their own wT/wTH/wTD calls by hand, with their keys in this same block; they are collected here so a re-run of this codemod does not drop them.
{
  for (const f of ["discharge.js", "patient-register.js"]) {
    const dc = readFileSync(ROOT + f, "utf8");
    for (const m of dc.matchAll(/\bwT[HADS]?\(("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")/g)) used.set(JSON.parse(m[1]), JSON.parse(m[2]));
  }
}
// ward-offline.js takes ward.js's lookup as tr(key, english, vars): its keys are written there by hand, and its WORDS
// table (plus the "write"/"record" fallbacks) is looked up as ward.offline-word-<kind>.
{
  const off = readFileSync(ROOT + "ward-offline.js", "utf8");
  for (const m of off.matchAll(/\btr\(("ward\.[^"]*"), ("(?:[^"\\]|\\.)*")/g)) used.set(JSON.parse(m[1]), JSON.parse(m[2]));
  const words = /var WORDS = (\{[^}]*\});/.exec(off);
  if (words) for (const [k, v] of Object.entries(Function("return " + words[1])())) used.set("ward.offline-word-" + k, v);
  used.set("ward.offline-word-write", "write"); used.set("ward.offline-word-record", "record");
}
// CHART_CATS and SHORTCUTS are read through wTEn by hand (chartNavHtml, keySheetHtml): their words are catalogued too.
(function handTables(n) {
  if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && (n.id.name === "CHART_CATS" || n.id.name === "SHORTCUTS") && !inFunction(n)) {
    (function w(x) { if (x.type === "Property" && /^(label|title)$/.test(propName(x.key)) && isStr(x.value)) used.set(keyFor(x.value.value), x.value.value); kids(x).forEach(w); })(n.init);
  }
  kids(n).forEach(handTables);
})(ast);
console.log("edits:", live.length, "calls:", calls, "keys:", used.size);
const entries = [...used.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => "    " + JSON.stringify(k) + ": " + JSON.stringify(v));
const block = BLOCK_START + "\n" + entries.join(",\n") + "\n" + BLOCK_END;
let i18nOut = i18nSrc;
const s0 = i18nOut.indexOf(BLOCK_START), e0 = i18nOut.indexOf(BLOCK_END);
if (s0 >= 0 && e0 > s0) i18nOut = i18nOut.slice(0, s0) + block + i18nOut.slice(e0 + BLOCK_END.length);
else {
  const endEn = i18nOut.indexOf("\n  };\n\n  var CATALOGS");
  if (endEn < 0) throw new Error("cannot find the end of EN in i18n.js");
  i18nOut = i18nOut.slice(0, endEn) + ",\n\n" + block + i18nOut.slice(endEn);
}
writeFileSync(I18N, i18nOut);
if (!PASS2) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, ...process.argv.slice(2)], { env: { ...process.env, PASS: "2" }, stdio: "inherit" });
  process.exit(r.status || 0);
}
