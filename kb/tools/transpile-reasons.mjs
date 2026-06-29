/* Build-time transpiler: legacy "why this" reason closures -> declarative template DSL.
 * Uses acorn (build-time only). Output is pure data; the runtime interpolator has NO eval.
 * Verifies byte-identical by fuzzing the template vs the original closure.
 *
 * Template DSL nodes:
 *   ["lit","str"]                              literal
 *   ["seq", node...]                           concatenation
 *   ["cond", rule, thenNode, elseNode]         ternary
 *   ["join", sep, fallback, [[rule,"str"]...]] [a&&"x",...].filter(Boolean).join(sep)||fallback
 *   ["var","_centor"]                          interpolate a derived counter's value
 * rule = the existing rule DSL ("x" | {allOf|anyOf|not} | {key,gte/...}).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const acorn = require(process.env.CLAUDE_JOB_DIR + "/tmp/transpiler-deps/node_modules/acorn");

const assoc = JSON.parse(readFileSync(process.env.CLAUDE_JOB_DIR + "/tmp/engine-assoc.json", "utf8"));
const dump = JSON.parse(readFileSync(process.env.CLAUDE_JOB_DIR + "/tmp/engine-dump.json", "utf8"));

function parseExpr(src) { return acorn.parse("(" + src + ")", { ecmaVersion: 2022 }).body[0].expression; }

// ---- AST expression (boolean) -> rule DSL ----
function exprToRule(n, alias) {
  if (n.type === "MemberExpression" && n.object.name === "e") return n.property.name;
  if (n.type === "UnaryExpression" && n.operator === "!") return { not: exprToRule(n.argument, alias) };
  if (n.type === "LogicalExpression") {
    const parts = []; (function flat(x) { if (x.type === "LogicalExpression" && x.operator === n.operator) { flat(x.left); flat(x.right); } else parts.push(exprToRule(x, alias)); })(n);
    return n.operator === "&&" ? { allOf: parts } : { anyOf: parts };
  }
  if (n.type === "BinaryExpression") {
    const keyName = n.left.type === "Identifier" ? (alias[n.left.name] || n.left.name) : (n.left.object && n.left.object.name === "e" ? n.left.property.name : null);
    const op = { ">=": "gte", ">": "gt", "<=": "lte", "<": "lt", "===": "eq" }[n.operator];
    const r = { key: keyName }; r[op] = n.right.value; return r;
  }
  if (n.type === "Identifier") return { key: alias[n.name] || n.name }; // truthy check on derived var (rare)
  throw new Error("exprToRule: " + n.type + " " + JSON.stringify(n.operator || ""));
}

// ---- AST expression -> template node ----
function exprToTpl(n, alias) {
  if (n.type === "Literal") return ["lit", String(n.value)];
  if (n.type === "Identifier") return ["var", alias[n.name] || n.name];
  if (n.type === "MemberExpression" && n.object.name === "e") return ["var", n.property.name];
  if (n.type === "TemplateLiteral") {
    const seq = ["seq"];
    for (let i = 0; i < n.quasis.length; i++) {
      if (n.quasis[i].value.cooked) seq.push(["lit", n.quasis[i].value.cooked]);
      if (i < n.expressions.length) seq.push(exprToTpl(n.expressions[i], alias));
    }
    return seq.length === 2 ? seq[1] : seq;
  }
  if (n.type === "ConditionalExpression") return ["cond", exprToRule(n.test, alias), exprToTpl(n.consequent, alias), exprToTpl(n.alternate, alias)];
  if (n.type === "LogicalExpression" && n.operator === "||") {
    // join(...) || fallback   OR   bare a||b template choice
    const fb = n.right.type === "Literal" ? String(n.right.value) : null;
    const left = joinNode(n.left, alias, fb);
    if (left) return left;
  }
  const jn = joinNode(n, alias, "");
  if (jn) return jn;
  throw new Error("exprToTpl: unsupported " + n.type);
}

// detect <ArrayExpression>.filter(Boolean).join(SEP) and build a join node
function joinNode(n, alias, fallback) {
  if (n.type !== "CallExpression") return null;
  // n = X.join(SEP); X = Y.filter(Boolean)
  if (!(n.callee.type === "MemberExpression" && n.callee.property.name === "join")) return null;
  const sep = n.arguments[0] && n.arguments[0].value != null ? String(n.arguments[0].value) : "";
  const filterCall = n.callee.object;
  if (!(filterCall.type === "CallExpression" && filterCall.callee.property && filterCall.callee.property.name === "filter")) return null;
  const arr = filterCall.callee.object;
  if (arr.type !== "ArrayExpression") return null;
  const terms = arr.elements.map((el) => {
    // el = LEFT && "STR"
    if (el.type === "LogicalExpression" && el.operator === "&&") return [exprToRule(el.left, alias), String(el.right.value)];
    throw new Error("join term not LEFT&&str: " + el.type);
  });
  return ["join", sep, fallback || "", terms];
}

// ---- derived counters from baseScore source (e.X&&a++ / e.X||a++) ----
function derivedCounter(baseSrc) {
  // returns rule[] of the counter conditions, or null if no counter
  if (!/a\+\+/.test(baseSrc.replace(/\s/g, ""))) return null;
  const s = baseSrc.replace(/\s+/g, "");
  const m = s.match(/return(.*),i;?\}$/); if (!m) return null;
  const terms = []; let depth = 0, cur = "";
  for (const ch of m[1]) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { terms.push(cur); cur = ""; } else cur += ch; }
  if (cur) terms.push(cur);
  const rules = [];
  for (const t of terms) {
    let mm;
    if ((mm = t.match(/^(.*)&&a\+\+$/))) rules.push(exprToRule(parseExpr(mm[1]), {}));
    else if ((mm = t.match(/^(.*)\|\|a\+\+$/))) rules.push({ not: exprToRule(parseExpr(mm[1]), {}) });
  }
  return rules.length ? rules : null;
}

// ---- transpile one reason closure ----
function transpile(id, reasonSrc, baseSrc) {
  const ast = parseExpr(reasonSrc); // ArrowFunctionExpression
  const alias = {};
  let derived = null;
  let bodyExpr;
  if (ast.body.type === "BlockStatement") {
    for (const st of ast.body.body) {
      if (st.type === "VariableDeclaration") for (const d of st.declarations) {
        // const i = e._X || 0
        if (d.init.type === "LogicalExpression" && d.init.left.type === "MemberExpression") { alias[d.id.name] = d.init.left.property.name; }
      }
      if (st.type === "ReturnStatement") bodyExpr = st.argument;
    }
    const dvar = Object.values(alias)[0];
    if (dvar) { const rules = derivedCounter(baseSrc || ""); if (rules) derived = { [dvar]: rules }; }
  } else bodyExpr = ast.body;
  const tpl = exprToTpl(bodyExpr, alias);
  return { template: tpl, derived };
}

// ---- pure runtime interpolator (mirrors what ships in reasoning.js) ----
function evalRule(rule, e) {
  if (rule == null) return true;
  if (typeof rule === "string") return !!e[rule];
  if (Array.isArray(rule)) return rule.every((r) => evalRule(r, e));
  if (rule.allOf) return rule.allOf.every((r) => evalRule(r, e));
  if (rule.anyOf) return rule.anyOf.some((r) => evalRule(r, e));
  if (Object.prototype.hasOwnProperty.call(rule, "not")) return !evalRule(rule.not, e);
  if (Object.prototype.hasOwnProperty.call(rule, "key")) { const v = e[rule.key]; if ("gte" in rule) return v >= rule.gte; if ("gt" in rule) return v > rule.gt; if ("lte" in rule) return v <= rule.lte; if ("lt" in rule) return v < rule.lt; if ("eq" in rule) return v === rule.eq; return !!v; }
  return false;
}
function render(node, e) {
  switch (node[0]) {
    case "lit": return node[1];
    case "seq": return node.slice(1).map((n) => render(n, e)).join("");
    case "cond": return evalRule(node[1], e) ? render(node[2], e) : render(node[3], e);
    case "join": { const arr = node[3].filter((t) => evalRule(t[0], e)).map((t) => t[1]); return arr.length ? arr.join(node[1]) : node[2]; }
    case "var": return String(e[node[1]] || 0);
  }
  return "";
}
// reason renderer: fold derived counters into the finding set so conditions AND
// interpolations read the same value, then render. (Ships in reasoning.js.)
function renderReason(node, e, derived) {
  let ee = e;
  if (derived) { ee = Object.assign({}, e); for (const k in derived) ee[k] = derived[k].filter((r) => evalRule(r, e)).length; }
  return render(node, ee);
}

// ---- run + verify ----
const out = {}; const dynamicIds = []; const constIds = [];
for (const id in assoc.reasoningSrc) {
  const src = assoc.reasoningSrc[id]; if (!src || src === "function(){}") continue;
  const isDyn = /\$\{|\?|\bif\s*\(|return/.test(src) && !/^e=>"[^"]*"$/.test(src.replace(/\s/g, ""));
  try {
    const { template, derived } = transpile(id, src, dump.syndromes[id] && dump.syndromes[id].baseSrc);
    out[id] = { template }; if (derived) out[id].derived = derived;
    (isDyn ? dynamicIds : constIds).push(id);
  } catch (e) { console.log("TRANSPILE FAIL " + id + ": " + e.message); }
}

// fuzz verification: original closure vs interpolator, byte-identical
let totalMism = 0, verified = 0;
for (const id in out) {
  const src = assoc.reasoningSrc[id];
  const origReason = (0, eval)("(" + src + ")");                       // build-time only
  const baseSrc = dump.syndromes[id] && dump.syndromes[id].baseSrc;
  const origBase = baseSrc ? (0, eval)("(" + baseSrc + ")") : null;     // sets e._centor side-effect
  // gather candidate keys from the closure source
  const keys = [...new Set([...src.matchAll(/e\.([a-zA-Z_]\w*)/g)].map((m) => m[1]))].filter((k) => k !== "_centor" && k !== "_anthonisen");
  const counterKeys = baseSrc ? [...new Set([...baseSrc.matchAll(/e\.([a-zA-Z_]\w*)/g)].map((m) => m[1]))].filter((k) => !k.startsWith("_")) : [];
  const allKeys = [...new Set([...keys, ...counterKeys])];
  let mism = 0;
  for (let n = 0; n < 4000; n++) {
    const e = {};
    allKeys.forEach((k) => { if (Math.random() < 0.5) e[k] = true; });
    const e2 = Object.assign({}, e);            // for original: let baseScore set _centor/_anthonisen
    if (origBase) { try { origBase(e2); } catch (x) {} }
    let a, b;
    try { a = origReason(e2); } catch (x) { a = "__ERR__" + x.message; }
    try { b = renderReason(out[id].template, e, out[id].derived); } catch (x) { b = "__ERR2__" + x.message; }
    if (a !== b) { mism++; if (mism <= 1) console.log("MISMATCH " + id + "\n  orig: " + JSON.stringify(a).slice(0, 120) + "\n  tpl:  " + JSON.stringify(b).slice(0, 120)); }
  }
  if (mism === 0) verified++; else totalMism += mism;
}
writeFileSync(process.env.CLAUDE_JOB_DIR + "/tmp/reasons.json", JSON.stringify(out, null, 1));
console.log("\ntranspiled: " + Object.keys(out).length + " (dynamic " + dynamicIds.length + ", constant " + constIds.length + ")");
console.log("fuzz-verified byte-identical: " + verified + "/" + Object.keys(out).length + (totalMism ? "  TOTAL MISMATCHES=" + totalMism : ""));
