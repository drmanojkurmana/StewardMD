// functions/_connect/connectors/file/csv.js — hand-written RFC-4180-ish delimited parser (no deps).
// Quoted fields with embedded delimiter/newline + escaped "". CRLF/LF, BOM stripped. Bounded by budget.
// Adversarial input -> WARN, never throw/hang.
const DEFAULT_BUDGET = { maxBytes: 5_000_000, maxRows: 100_000, maxCell: 100_000 };

export function sniffDelimiter(text) {
  const firstLine = String(text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/)[0] || "";
  const cand = [",", "\t", "|", ";"];
  let best = ",", bestN = -1;
  for (const d of cand) { const n = firstLine.split(d).length; if (n > bestN) { bestN = n; best = d; } }
  return best;
}

export function parseDelimited(text, opts = {}) {
  const budget = Object.assign({}, DEFAULT_BUDGET, opts.budget);
  const warnings = [];
  let s = String(text == null ? "" : text).replace(/^﻿/, "");
  if (s.length > budget.maxBytes) { s = s.slice(0, budget.maxBytes); warnings.push("input truncated at maxBytes"); }
  const delimiter = opts.delimiter || sniffDelimiter(s);
  const records = [];
  let row = [], cell = "", inQuotes = false, i = 0;
  const pushCell = () => { if (cell.length > budget.maxCell) { cell = cell.slice(0, budget.maxCell); warnings.push("cell truncated at maxCell"); } row.push(cell); cell = ""; };
  const pushRow = () => { pushCell(); if (row.length === 1 && row[0] === "") { row = []; return; } records.push(row); row = []; };
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushCell(); i++; continue; }
    if (ch === "\r") { if (s[i + 1] === "\n") i++; pushRow(); i++; if (records.length >= budget.maxRows) { warnings.push("rows truncated at maxRows"); break; } continue; }
    if (ch === "\n") { pushRow(); i++; if (records.length >= budget.maxRows) { warnings.push("rows truncated at maxRows"); break; } continue; }
    cell += ch; i++;
  }
  if (inQuotes) warnings.push("unterminated quote at EOF; field closed");
  if (cell.length || row.length) pushRow();

  if (!records.length) return { header: [], rows: [], delimiter, warnings };
  const rawHeader = records[0];
  const seen = {}, header = rawHeader.map((h) => { let name = String(h).trim(); if (seen[name]) { warnings.push("duplicate header '" + name + "' suffixed"); name = name + "_" + seen[name]; } seen[String(h).trim()] = (seen[String(h).trim()] || 0) + 1; return name; });
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length !== header.length) warnings.push("ragged row " + r + " (" + rec.length + " cols vs " + header.length + ")");
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = rec[c] != null ? rec[c] : null;
    rows.push(obj);
  }
  return { header, rows, delimiter, warnings };
}
