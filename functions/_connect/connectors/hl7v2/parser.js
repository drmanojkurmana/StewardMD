// functions/_connect/connectors/hl7v2/parser.js — hand-written HL7 v2 pipe/hat parser (no deps).
// Untrusted wire input: adversarially hardened -> WARN, never throw/hang. Encoding is discovered from the
// message (MSH-1 field sep, MSH-2 = comp/rep/esc/sub); never assume defaults. Bounded by opts.budget.
// (DUAL-ADVERSARIAL: appsec + redteam.)
const DEFAULT_BUDGET = { maxBytes: 1_000_000, maxSegments: 5000, maxFieldsPerSegment: 512, maxWarnings: 500 };

export function parseHl7(text, opts = {}) {
  const budget = Object.assign({}, DEFAULT_BUDGET, opts.budget);
  const warnings = [];
  const warn = (m) => { if (warnings.length < budget.maxWarnings) warnings.push(m); else if (warnings.length === budget.maxWarnings) warnings.push("warnings truncated at maxWarnings"); };
  let s = String(text == null ? "" : text);
  if (s.length > budget.maxBytes) { s = s.slice(0, budget.maxBytes); warn("message truncated at maxBytes"); }
  s = s.replace(/^﻿/, "");
  const mshIdx = s.indexOf("MSH");
  if (mshIdx !== 0) { warn("message does not begin with MSH"); if (mshIdx < 0) return { segments: [], encoding: enc("|", "^~\\&", null), warnings }; s = s.slice(mshIdx); }
  const fieldSep = s[3] || "|";                                // MSH-1 = the char right after "MSH"
  const secondSep = s.indexOf(fieldSep, 4);
  const msh2 = secondSep >= 0 ? s.slice(4, secondSep) : s.slice(4);   // the ACTUAL MSH-2 field (not a blind slice) — warns if empty/short/colliding
  const encoding = enc(fieldSep, msh2, warn);

  const rawSegs = s.split(/\r\n|\r|\n/);
  const segments = [];
  let processed = 0;
  for (let i = 0; i < rawSegs.length; i++) {
    if (processed >= budget.maxSegments) { warn("segment flood truncated at maxSegments"); break; }
    const line = rawSegs[i];
    if (line.length === 0) continue;
    processed++;                                               // count every non-empty line (malformed included) so a flood is bounded
    const id = line.slice(0, 3);
    if (!/^[A-Za-z0-9]{3}$/.test(id)) { warn("skipped malformed segment header"); continue; }
    let fields;
    // MSH-1 is the field-sep value; split the whole line so MSH-2 = next field and MSH-9/10 align faithfully.
    if (id === "MSH") fields = ["MSH", fieldSep].concat(line.split(encoding.field).slice(1));
    else fields = line.split(encoding.field);
    if (fields.length > budget.maxFieldsPerSegment) { fields = fields.slice(0, budget.maxFieldsPerSegment); warn("field flood truncated in " + id); }
    segments.push({ id, fields });
  }
  return { segments, encoding, warnings };
}

function enc(field, encChars, warn) {
  const c = String(encChars || "");
  if (warn && c.length !== 4) warn("MSH-2 encoding chars malformed (length " + c.length + "); defaulted — MSH field alignment may be off");
  let comp = c[0] || "^", rep = c[1] || "~", esc = c[2] || "\\", sub = c[3] || "&";
  // A separator that collides with the field sep would corrupt the split; warn and use a safe default.
  if (warn && (comp === field || rep === field || esc === field || sub === field)) warn("MSH-2 encoding char collides with the field separator; using safe defaults");
  if (comp === field) comp = "^";
  if (rep === field) rep = "~";
  return { field: field || "|", comp, rep, esc, sub };
}

// ---- pure accessors: return null for anything missing, NEVER throw ----
export const segs = (msg, id) => (msg && msg.segments ? msg.segments.filter((s) => s.id === id) : []);
export const seg = (msg, id) => segs(msg, id)[0] || null;
export const field = (sg, n) => { if (!sg || !sg.fields) return null; const i = Number(n); if (!Number.isInteger(i) || i < 0) return null; return sg.fields[i] != null ? sg.fields[i] : null; };   // integer index only (no prototype/"length" leak)
export const rep = (sg, n, r, encoding) => { const f = field(sg, n); if (f == null) return null; const parts = f.split((encoding && encoding.rep) || "~"); return parts[r] != null ? parts[r] : null; };
export const comp = (sg, n, c, encoding, r = 0) => { const v = rep(sg, n, r, encoding); if (v == null) return null; const parts = v.split((encoding && encoding.comp) || "^"); return parts[c] != null ? parts[c] : null; };
export const subcomp = (sg, n, c, sc, encoding, r = 0) => { const cv = comp(sg, n, c, encoding, r); if (cv == null) return null; const parts = cv.split((encoding && encoding.sub) || "&"); return parts[sc] != null ? parts[sc] : null; };

export function decodeEsc(value, encoding) {
  if (value == null) return null;
  const e = (encoding && encoding.esc) || "\\";
  const map = { F: encoding && encoding.field || "|", S: encoding && encoding.comp || "^", T: encoding && encoding.sub || "&", R: encoding && encoding.rep || "~", E: e };
  let out = "", i = 0;
  while (i < value.length) {
    if (value[i] === e) {
      const end = value.indexOf(e, i + 1);
      if (end < 0) { out += value.slice(i); break; }           // unterminated escape -> pass through verbatim
      const code = value.slice(i + 1, end);
      if (map[code] != null && code.length === 1) out += map[code];
      else if (code === ".br") out += "\n";
      else if (code[0] === "X") { const hex = code.slice(1); out += /^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0 ? hexToStr(hex) : value.slice(i, end + 1); }
      else out += value.slice(i, end + 1);                      // unknown escape -> verbatim
      i = end + 1;
    } else { out += value[i]; i++; }
  }
  return out;
}
function hexToStr(hex) { let o = ""; for (let i = 0; i < hex.length; i += 2) o += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16)); return o; }
