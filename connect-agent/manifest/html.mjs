// connect-agent/manifest/html.mjs -- dependency-free, security-hardened HTML parser + restricted CSS
// selector engine + record extractor for UNTRUSTED hospital EMR HTML.
//
// Runs server-side (Node + Cloudflare Workers WITHOUT nodejs_compat, so no DOM) and on the phone, so it
// is pure ES-module JS: no node: imports, no Node/Workers/DOM APIs, no dependencies. It parses
// attacker-controlled markup, so it is written to be safe over hostile input, not just correct over
// well-formed input:
//   - byte cap before parse, node-count and depth caps during tree build (return the partial tree,
//     never hang, never throw on deep nesting),
//   - null-proto objects for every attribute bag and record so a literal __proto__ / constructor /
//     prototype key can never reach a real prototype,
//   - hand-written scanners for tokenizing and onclick-argument parsing; the few regexes used run over
//     single characters or already-length-bounded selector tokens and have no nested quantifiers, so
//     there is no catastrophic-backtracking surface.
//
// Records feed connect-agent/manifest/interpret.mjs style consumers: extractRecords returns
// Array<Object(null-proto)> of string-valued records, one per matched row.

const DEFAULT_MAX_BYTES = 4_000_000;
const DEFAULT_MAX_NODES = 100_000;
const DEFAULT_MAX_DEPTH = 500;
const MAX_VALUE = 2000;        // per-field extracted value cap
const MAX_INNERHTML = 1_000_000; // bounded raw innerHTML slice
const MAX_SELECTOR = 200;

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const RAW = new Set(['script', 'style']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Implied end tags: opening the key tag auto-closes any currently-open tag in the value set (the common
// optional-end-tag rules, so `<td>a<td>b` yields siblings, not nesting).
const IMPLIED_CLOSE = Object.create(null);
IMPLIED_CLOSE.li = new Set(['li']);
IMPLIED_CLOSE.tr = new Set(['tr', 'td', 'th']);
IMPLIED_CLOSE.td = new Set(['td', 'th']);
IMPLIED_CLOSE.th = new Set(['td', 'th']);
IMPLIED_CLOSE.thead = new Set(['td', 'th', 'tr']);
IMPLIED_CLOSE.tbody = new Set(['td', 'th', 'tr']);
IMPLIED_CLOSE.tfoot = new Set(['td', 'th', 'tr']);
IMPLIED_CLOSE.option = new Set(['option']);
IMPLIED_CLOSE.p = new Set(['p']);
IMPLIED_CLOSE.dt = new Set(['dt', 'dd']);
IMPLIED_CLOSE.dd = new Set(['dt', 'dd']);

// Flat character-class gate, single bounded quantifier: linear, no backtracking. The full grammar is
// enforced by parseSelector/isValidSelector; this is the cheap static gate the schema layer can apply.
export const HTML_SELECTOR_RE = /^[\w\-.#[\]="':()>*,\s]{1,200}$/;

// ---------------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------------

const NAMED = Object.create(null);
NAMED.amp = '&'; NAMED.lt = '<'; NAMED.gt = '>'; NAMED.quot = '"';
NAMED.apos = "'"; NAMED.nbsp = ' ';

// One pass, no nested quantifiers, anchored by & and ;. Unknown entities are left literal.
const ENTITY_RE = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{1,10});/g;

function decodeEntities(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(ENTITY_RE, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    const v = NAMED[body];
    return v === undefined ? m : v;
  });
}

// ---------------------------------------------------------------------------------------------------
// Byte counting (no Buffer, no full-input allocation)
// ---------------------------------------------------------------------------------------------------

// Every UTF-16 code unit is at least one UTF-8 byte, so length > max already means over the cap; the
// scan then bounds cost to <= max iterations and exits early once the cap is passed.
function overByteCap(s, max) {
  if (s.length > max) return true;
  let b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { b += 4; i += 1; } // surrogate pair
    else b += 3;
    if (b > max) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// Tree nodes
// ---------------------------------------------------------------------------------------------------

class TextNode {
  constructor(value, parent) { this.value = value; this._parent = parent; }
}

class ElementNode {
  constructor(tagName, src) {
    this.tagName = tagName;
    this.attributes = Object.create(null); // null-proto: a __proto__ attribute is a safe own property
    this.childNodes = [];                  // mixed ElementNode / TextNode, in source order
    this._parent = null;
    this._src = src;
    this._innerStart = -1;
    this._innerEnd = -1;
  }

  get children() {
    return this.childNodes.filter((c) => c instanceof ElementNode);
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    return key in this.attributes ? this.attributes[key] : null;
  }

  get textContent() {
    let out = '';
    const visit = (node) => {
      for (const c of node.childNodes) {
        if (c instanceof TextNode) out += c.value;
        else if (c.tagName === 'script' || c.tagName === 'style') continue; // excluded from text
        else visit(c);
      }
    };
    visit(this);
    return out;
  }

  get innerHTML() {
    if (this._innerStart < 0) return '';
    const end = this._innerEnd >= 0 ? this._innerEnd : this._src.length;
    const raw = this._src.slice(this._innerStart, Math.max(this._innerStart, end));
    return raw.length > MAX_INNERHTML ? raw.slice(0, MAX_INNERHTML) : raw;
  }

  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
}

// ---------------------------------------------------------------------------------------------------
// parseHtml
// ---------------------------------------------------------------------------------------------------

const NAME_CHAR = /[a-zA-Z0-9:_-]/;
const WS = /\s/;

/** Read a start tag beginning at the first character of its name. Returns tag info + index past '>'. */
function readOpenTag(html, i, n) {
  let j = i;
  while (j < n && NAME_CHAR.test(html[j])) j += 1;
  const tagName = html.slice(i, j).toLowerCase();
  const attrs = Object.create(null);
  let selfClose = false;
  while (j < n) {
    while (j < n && WS.test(html[j])) j += 1;
    if (j >= n) break;
    if (html[j] === '>') { j += 1; break; }
    if (html[j] === '/') { if (html[j + 1] === '>') { selfClose = true; j += 2; break; } j += 1; continue; }
    let k = j;
    while (k < n && !WS.test(html[k]) && html[k] !== '=' && html[k] !== '>' && html[k] !== '/') k += 1;
    const name = html.slice(j, k).toLowerCase();
    j = k;
    while (j < n && WS.test(html[j])) j += 1;
    let value = '';
    if (html[j] === '=') {
      j += 1;
      while (j < n && WS.test(html[j])) j += 1;
      const q = html[j];
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, j + 1);
        if (end === -1) { value = html.slice(j + 1); j = n; } else { value = html.slice(j + 1, end); j = end + 1; }
      } else {
        let v = j;
        while (v < n && !WS.test(html[v]) && html[v] !== '>') v += 1;
        value = html.slice(j, v); j = v;
      }
    }
    if (name && !(name in attrs)) attrs[name] = decodeEntities(value); // first occurrence wins
  }
  return { tagName, attrs, selfClose, end: j };
}

/**
 * parseHtml(html, opts) -> read-only #document ElementNode.
 * opts: { maxBytes, maxNodes, maxDepth }. Oversize input throws a plain Error BEFORE parsing; the node
 * and depth caps stop parsing and return the tree built so far.
 */
export function parseHtml(html, opts) {
  opts = opts || {};
  const maxBytes = opts.maxBytes == null ? DEFAULT_MAX_BYTES : opts.maxBytes;
  const maxNodes = opts.maxNodes == null ? DEFAULT_MAX_NODES : opts.maxNodes;
  const maxDepth = opts.maxDepth == null ? DEFAULT_MAX_DEPTH : opts.maxDepth;

  if (typeof html !== 'string') html = html == null ? '' : String(html);
  if (overByteCap(html, maxBytes)) throw new Error(`html.mjs: input exceeds maxBytes (${maxBytes})`);

  const src = html;
  const n = src.length;
  const root = new ElementNode('#document', src);
  root._innerStart = 0;
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let nodeCount = 0;
  let stopped = false;

  const addText = (t) => {
    if (!t) return;
    top().childNodes.push(new TextNode(decodeEntities(t), top()));
  };
  const closeTag = (name, ltPos) => {
    for (let s = stack.length - 1; s >= 1; s -= 1) {
      if (stack[s].tagName === name) {
        for (let k = stack.length - 1; k >= s; k -= 1) if (stack[k]._innerEnd < 0) stack[k]._innerEnd = ltPos;
        stack.length = s;
        return;
      }
    }
    // no matching open tag: ignore the stray end tag
  };

  let i = 0;
  while (i < n && !stopped) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { addText(src.slice(i)); break; }
    if (lt > i) addText(src.slice(i, lt));
    i = lt;
    const next = src[i + 1];
    if (next === undefined) { addText(src.slice(i)); break; }

    if (next === '!') {
      if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); i = e === -1 ? n : e + 3; continue; }
      if (src.startsWith('<![CDATA[', i)) { const e = src.indexOf(']]>', i + 9); i = e === -1 ? n : e + 3; continue; }
      const e = src.indexOf('>', i); i = e === -1 ? n : e + 1; continue; // doctype / declaration
    }
    if (next === '?') { const e = src.indexOf('>', i); i = e === -1 ? n : e + 1; continue; } // processing instruction

    if (next === '/') {
      let j = i + 2;
      while (j < n && NAME_CHAR.test(src[j])) j += 1;
      const name = src.slice(i + 2, j).toLowerCase();
      const e = src.indexOf('>', j);
      closeTag(name, i);
      i = e === -1 ? n : e + 1;
      continue;
    }

    if ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z')) {
      if (++nodeCount > maxNodes) { stopped = true; break; }
      const tag = readOpenTag(src, i + 1, n);
      // implied close of open siblings before this tag is placed (e.g. `<td>a<td>b` -> siblings)
      const implied = IMPLIED_CLOSE[tag.tagName];
      if (implied) {
        while (stack.length > 1 && implied.has(top().tagName)) {
          const popped = stack.pop();
          if (popped._innerEnd < 0) popped._innerEnd = i;
        }
      }
      const el = new ElementNode(tag.tagName, src);
      for (const k in tag.attrs) el.attributes[k] = tag.attrs[k];
      el._parent = top();
      top().childNodes.push(el);
      el._innerStart = tag.end;

      if (VOID.has(tag.tagName) || tag.selfClose) {
        el._innerEnd = tag.end;
        i = tag.end;
      } else if (RAW.has(tag.tagName)) {
        const lower = src.toLowerCase();
        const close = lower.indexOf('</' + tag.tagName, tag.end);
        const rawEnd = close === -1 ? n : close;
        const raw = src.slice(tag.end, rawEnd);
        if (raw) el.childNodes.push(new TextNode(raw, el)); // raw text, not entity-decoded, skipped by textContent
        el._innerEnd = rawEnd;
        if (close === -1) { i = n; } else { const gt = src.indexOf('>', close); i = gt === -1 ? n : gt + 1; }
      } else {
        if (stack.length - 1 >= maxDepth) { stopped = true; break; }
        stack.push(el);
        i = tag.end;
      }
      continue;
    }

    addText('<'); // '<' not followed by a tag: literal text
    i += 1;
  }

  for (const el of stack) if (el._innerEnd < 0) el._innerEnd = n;
  return root;
}

// ---------------------------------------------------------------------------------------------------
// Selector engine (restricted grammar)
// ---------------------------------------------------------------------------------------------------

const IDENT = /[a-zA-Z0-9_-]/;
const ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const NTH_RE = /^:nth-of-type\((\d+)\)/;

function parseAttr(inner) {
  const eq = inner.indexOf('=');
  if (eq === -1) {
    const name = inner.trim();
    if (!ATTR_NAME_RE.test(name)) return null;
    return { name: name.toLowerCase(), value: null };
  }
  const name = inner.slice(0, eq).trim();
  if (!ATTR_NAME_RE.test(name)) return null;
  let val = inner.slice(eq + 1).trim();
  const first = val[0];
  const last = val[val.length - 1];
  if (val.length >= 2 && (first === '"' || first === "'") && last === first) val = val.slice(1, -1);
  return { name: name.toLowerCase(), value: val };
}

/** Parse one compound simple-selector (e.g. `div#id.a.b[x="y"]:nth-of-type(2)`). Null = unsupported. */
function parseCompound(str) {
  if (!str) return null;
  const simple = { tag: null, id: null, classes: [], attrs: [], nth: null };
  let i = 0;
  const n = str.length;
  if (str[i] === '*') { simple.tag = '*'; i += 1; }
  else if ((str[i] >= 'a' && str[i] <= 'z') || (str[i] >= 'A' && str[i] <= 'Z')) {
    let j = i + 1;
    while (j < n && /[a-zA-Z0-9-]/.test(str[j])) j += 1;
    simple.tag = str.slice(i, j).toLowerCase();
    i = j;
  }
  while (i < n) {
    const c = str[i];
    if (c === '#') {
      let j = i + 1; while (j < n && IDENT.test(str[j])) j += 1;
      if (j === i + 1) return null;
      simple.id = str.slice(i + 1, j); i = j;
    } else if (c === '.') {
      let j = i + 1; while (j < n && IDENT.test(str[j])) j += 1;
      if (j === i + 1) return null;
      simple.classes.push(str.slice(i + 1, j)); i = j;
    } else if (c === '[') {
      const end = str.indexOf(']', i);
      if (end === -1) return null;
      const attr = parseAttr(str.slice(i + 1, end));
      if (!attr) return null;
      simple.attrs.push(attr); i = end + 1;
    } else if (c === ':') {
      const m = NTH_RE.exec(str.slice(i));
      if (!m) return null;
      const num = parseInt(m[1], 10);
      if (!(num >= 1)) return null;
      simple.nth = num; i += m[0].length;
    } else {
      return null; // any other char is unsupported grammar
    }
  }
  return simple;
}

/** Parse one comma group into ordered steps with combinators. Null = unsupported. */
function parseGroup(str) {
  const tokens = [];
  let cur = '';
  let bracket = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str[i];
    if (c === '[') bracket += 1;
    else if (c === ']') bracket -= 1;
    if (bracket === 0 && (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '>')) {
      if (cur) { tokens.push({ t: 'sel', v: cur }); cur = ''; }
      tokens.push({ t: 'comb', v: c === '>' ? 'child' : 'desc' });
      continue;
    }
    cur += c;
  }
  if (cur) tokens.push({ t: 'sel', v: cur });

  const steps = [];
  let pending = null;
  for (const tok of tokens) {
    if (tok.t === 'comb') {
      if (steps.length === 0) continue; // leading whitespace / combinator
      if (tok.v === 'child') pending = 'child';
      else if (pending !== 'child') pending = 'desc';
    } else {
      const simple = parseCompound(tok.v);
      if (!simple) return null;
      steps.push({ comb: steps.length === 0 ? 'root' : (pending || 'desc'), simple });
      pending = null;
    }
  }
  return steps.length ? steps : null;
}

const SELECTOR_CACHE = new Map();

/** parseSelector(sel) -> Array<groups> or null (unsupported / invalid). */
function parseSelector(sel) {
  if (typeof sel !== 'string' || sel.length === 0 || sel.length > MAX_SELECTOR) return null;
  if (!HTML_SELECTOR_RE.test(sel)) return null;
  if (SELECTOR_CACHE.has(sel)) return SELECTOR_CACHE.get(sel);
  const groups = [];
  for (const part of sel.split(',')) {
    const g = parseGroup(part.trim());
    if (!g) { SELECTOR_CACHE.set(sel, null); return null; }
    groups.push(g);
  }
  const result = groups.length ? groups : null;
  if (SELECTOR_CACHE.size < 500) SELECTOR_CACHE.set(sel, result);
  return result;
}

/** isValidSelector(sel) -> boolean. Bounded (length check first) and ReDoS-free. */
export function isValidSelector(sel) {
  return parseSelector(sel) !== null;
}

function matchSimple(el, s) {
  if (s.tag && s.tag !== '*' && el.tagName !== s.tag) return false;
  if (s.id !== null && el.getAttribute('id') !== s.id) return false;
  if (s.classes.length) {
    const cls = (el.getAttribute('class') || '').split(/\s+/);
    for (const c of s.classes) if (!cls.includes(c)) return false;
  }
  for (const a of s.attrs) {
    const v = el.getAttribute(a.name);
    if (a.value === null) { if (v === null) return false; }
    else if (v !== a.value) return false;
  }
  if (s.nth !== null) {
    const p = el._parent;
    if (!p) return false;
    let idx = 0;
    for (const sib of p.childNodes) {
      if (sib instanceof ElementNode && sib.tagName === el.tagName) { idx += 1; if (sib === el) break; }
    }
    if (idx !== s.nth) return false;
  }
  return true;
}

// Match steps right-to-left. Ancestor climbing stops below `scope`, keeping a scoped query self-contained.
function matchFrom(el, steps, idx, scope) {
  if (!matchSimple(el, steps[idx].simple)) return false;
  if (idx === 0) return true;
  const comb = steps[idx].comb;
  const parent = el._parent && el._parent !== scope ? el._parent : null;
  if (comb === 'child') return parent ? matchFrom(parent, steps, idx - 1, scope) : false;
  let p = parent; // descendant
  while (p) {
    if (matchFrom(p, steps, idx - 1, scope)) return true;
    p = p._parent && p._parent !== scope ? p._parent : null;
  }
  return false;
}

/** matchSelector(el, sel) -> boolean. Exported for reuse; unsupported selectors match nothing. */
export function matchSelector(el, sel) {
  const groups = parseSelector(sel);
  if (!groups || !(el instanceof ElementNode)) return false;
  return groups.some((g) => matchFrom(el, g, g.length - 1, null));
}

function queryAll(scope, sel) {
  const groups = parseSelector(sel);
  if (!groups) return []; // unsupported grammar: no matches, never a throw
  const acc = [];
  const collect = (el) => {
    for (const c of el.childNodes) if (c instanceof ElementNode) { acc.push(c); collect(c); }
  };
  collect(scope);
  const res = [];
  for (const el of acc) {
    for (const g of groups) {
      if (matchFrom(el, g, g.length - 1, scope)) { res.push(el); break; }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------
// extractRecords
// ---------------------------------------------------------------------------------------------------

function cap(v) {
  const s = String(v == null ? '' : v).trim();
  return s.length > MAX_VALUE ? s.slice(0, MAX_VALUE) : s;
}

/** Scan quoted string literals only (' or "), never eval/Function/regex. Returns them in order. */
function quotedArgs(s) {
  const args = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < n && s[j] !== c) { buf += s[j]; j += 1; }
      args.push(buf);
      i = j + 1;
    } else i += 1;
  }
  return args;
}

function applyRule(row, rule) {
  if (!rule || typeof rule !== 'object') return '';

  if (Number.isInteger(rule.cell)) {
    const cells = row.querySelectorAll('td');
    const cell = cells[rule.cell];
    return cell ? cell.textContent : '';
  }

  if (typeof rule.selector === 'string') {
    const el = row.querySelector(rule.selector);
    if (!el) return '';
    const attr = rule.attr;
    if (attr === 'text' || attr === undefined) return el.textContent;
    if (attr === 'html') return el.innerHTML;
    if (typeof attr === 'string' && attr[0] === '@') return el.getAttribute(attr.slice(1)) || '';
    return '';
  }

  if (Number.isInteger(rule.onclickArg)) {
    let attrName = 'onclick';
    if (typeof rule.source === 'string' && rule.source[0] === '@') attrName = rule.source.slice(1);
    const raw = row.getAttribute(attrName);
    if (!raw) return '';
    const args = quotedArgs(raw);
    return rule.onclickArg < args.length ? args[rule.onclickArg] : '';
  }

  return '';
}

/**
 * extractRecords(htmlOrDoc, spec, opts) -> Array<Object(null-proto)> of string-valued records.
 * spec = { rows: <selector>, fields: { <key>: <rule> } }. If rows matches nothing, returns [].
 */
export function extractRecords(htmlOrDoc, spec, opts) {
  const root = typeof htmlOrDoc === 'string' ? parseHtml(htmlOrDoc, opts) : htmlOrDoc;
  if (!spec || typeof spec !== 'object') return [];
  if (typeof spec.rows !== 'string' || !spec.fields || typeof spec.fields !== 'object') return [];

  const rows = root.querySelectorAll(spec.rows);
  if (!rows.length) return [];

  const fieldNames = Object.keys(spec.fields);
  const out = [];
  for (const row of rows) {
    const rec = Object.create(null); // null-proto record
    for (const key of fieldNames) {
      if (FORBIDDEN_KEYS.has(key)) continue; // defense in depth: never a hostile record key
      rec[key] = cap(applyRule(row, spec.fields[key]));
    }
    out.push(rec);
  }
  return out;
}
