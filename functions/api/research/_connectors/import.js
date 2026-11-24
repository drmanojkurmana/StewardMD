/* ResearchMD Phase 2.4 reference-file import parsers (ES module).
 * Contract: docs/research/contracts/phase-2/schemas/import-create.request.json.
 * RIS, BibTeX and CSV -> the connector normalise record shape, with source
 * "import:ris" | "import:bibtex" | "import:csv" (the 0002 records table).
 * Deterministic T0 code, no LLM. Parsers never touch D1 or R2; the API reads
 * the uploaded file from private R2 and persists the entries.
 *
 * externalId is never empty: DOI when present, else PMID, else a stable
 * FNV-1a hash of normalised title|year|first author, so re-importing the same
 * file hits the UNIQUE(project, source, external_id) constraint instead of
 * duplicating rows.
 */
import { ConnectorError } from "./_http.js";
import { normaliseDoi, normaliseTitle, firstAuthorKey } from "../_dedup.js";

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function yearOf(value) {
  const m = String(value === null || value === undefined ? "" : value).match(/[0-9]{4}/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return y >= 1000 && y <= 2999 ? y : null;
}

/* "Family, FM" / "Family FM" / "FM Family" -> "Family FM" (contract shape). */
function authorName(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.indexOf(",") >= 0) {
    const parts = s.split(",");
    const family = parts[0].trim();
    const rest = parts.slice(1).join(" ").trim();
    return (family + " " + rest).trim();
  }
  const tokens = s.split(/\s+/);
  if (tokens.length < 2) return s;
  /* "Smith J" / "Smith JA" are already family-first (the contract shape):
   * trailing initials stay put. "John Smith" is given-first: swap it. */
  const last = tokens[tokens.length - 1];
  if (/^[A-Z]{1,3}\.?$/.test(last)) return s;
  const family = last;
  const given = tokens.slice(0, -1).join(" ");
  return family + " " + given;
}

function finish(source, fields, extra) {
  const title = String(fields.title || "").trim();
  const authors = (fields.authors || []).map(authorName).filter(Boolean);
  const year = yearOf(fields.year);
  const doi = normaliseDoi(fields.doi);
  const rawPmid = String(fields.pmid || "").trim();
  const pmid = /^[0-9]+$/.test(rawPmid) ? rawPmid : "";
  let externalId = doi || pmid;
  if (!externalId) {
    const basis = normaliseTitle(title) + "|" + (year === null ? "" : year) + "|" + firstAuthorKey(authors);
    if (!normaliseTitle(title))
      throw new ConnectorError("invalid_search", "Import entry has no title, DOI or PMID");
    externalId = "t" + fnv1a(basis);
  }
  return { source, externalId, title, authors, year, doi, extra };
}

/* ---- RIS ------------------------------------------------------------------ */
export function parseRIS(text) {
  const lines = String(text || "").split(/\r\n|\r|\n/);
  const entries = [];
  let cur = null;
  let lastTag = "";
  const push = () => {
    if (!cur) return;
    const tags = cur.tags;
    const authors = [].concat(tags.AU || [], tags.A1 || [], tags.A2 || []);
    entries.push(finish("import:ris", {
      title: (tags.TI || tags.T1 || [])[0] || "",
      authors,
      year: (tags.PY || tags.Y1 || [])[0] || "",
      doi: (tags.DO || [])[0] || "",
      pmid: (tags.AN || tags.M3 || [])[0] || "",
    }, { tags }));
    cur = null;
  };
  for (const line of lines) {
    const m = line.match(/^([A-Z][A-Z0-9])  - ?(.*)$/);
    if (m) {
      const tag = m[1], value = m[2].trim();
      if (tag === "TY") { push(); cur = { tags: {} }; }
      if (!cur) cur = { tags: {} };
      if (tag === "ER") { push(); lastTag = ""; continue; }
      if (!cur.tags[tag]) cur.tags[tag] = [];
      cur.tags[tag].push(value);
      lastTag = tag;
    } else if (cur && lastTag && line.trim() && /^\s/.test(line)) {
      const arr = cur.tags[lastTag];
      arr[arr.length - 1] += " " + line.trim();
    }
  }
  push();
  if (!entries.length) throw new ConnectorError("invalid_search", "No RIS entries found (expected TY ... ER blocks)");
  return entries;
}

/* ---- BibTeX --------------------------------------------------------------- */
function bibValue(body, key) {
  const re = new RegExp("(?:^|[,{]\\s*)" + key + "\\s*=\\s*", "i");
  const m = body.match(re);
  if (!m) return "";
  let i = m.index + m[0].length;
  while (i < body.length && /\s/.test(body[i])) i++;
  if (body[i] === "{") {
    let depth = 0, start = i;
    for (; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}") { depth--; if (depth === 0) return body.slice(start + 1, i); }
    }
    return body.slice(start + 1);
  }
  if (body[i] === '"') {
    const end = body.indexOf('"', i + 1);
    return end < 0 ? body.slice(i + 1) : body.slice(i + 1, end);
  }
  const end = body.indexOf(",", i);
  return (end < 0 ? body.slice(i) : body.slice(i, end)).trim();
}

export function parseBibTeX(text) {
  const src = String(text || "");
  const entries = [];
  const re = /@([A-Za-z]+)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "preamble" || type === "string") continue;
    let i = m.index + m[0].length, depth = 1;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    const body = src.slice(start, depth === 0 ? i - 1 : i);
    const fields = {};
    for (const key of ["title", "author", "year", "date", "doi", "pmid", "journal", "volume", "number", "pages", "abstract", "url", "publisher"]) {
      const v = bibValue(body, key);
      if (v) fields[key] = v.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    }
    entries.push(finish("import:bibtex", {
      title: fields.title || "",
      authors: (fields.author || "").split(/\s+and\s+/i),
      year: fields.year || fields.date || "",
      doi: fields.doi || "",
      pmid: fields.pmid || "",
    }, { type, key: body.split(",")[0].trim(), fields }));
  }
  if (!entries.length) throw new ConnectorError("invalid_search", "No BibTeX entries found (expected @type{key, ...} blocks)");
  return entries;
}

/* ---- CSV ------------------------------------------------------------------ */
function splitCsvLine(line, delim) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const CSV_COLUMNS = {
  title: ["title", "article title", "ti"],
  authors: ["authors", "author", "au"],
  year: ["year", "pub year", "publication year", "py"],
  doi: ["doi", "do"],
  pmid: ["pmid", "pubmed id", "pubmed_id", "an"],
  journal: ["journal", "journal title", "source", "jo"],
  volume: ["volume", "vl"],
  issue: ["issue", "number", "is"],
  pages: ["pages", "sp"],
  abstract: ["abstract", "ab"],
  url: ["url", "ur"],
};

export function parseCSV(text) {
  const lines = String(text || "").split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new ConnectorError("invalid_search", "CSV needs a header row and at least one entry");
  const headerLine = lines[0];
  const delim = [",", "\t", ";"].map((d) => ({ d, n: headerLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const header = splitCsvLine(headerLine, delim).map((h) => h.toLowerCase().replace(/^["']|["']$/g, ""));
  const colOf = {};
  for (const [field, aliases] of Object.entries(CSV_COLUMNS)) {
    const idx = header.findIndex((h) => aliases.indexOf(h) >= 0);
    if (idx >= 0) colOf[field] = idx;
  }
  if (colOf.title === undefined && colOf.doi === undefined && colOf.pmid === undefined)
    throw new ConnectorError("invalid_search", "CSV header needs a title, doi or pmid column");
  const entries = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delim);
    const get = (f) => (colOf[f] === undefined ? "" : String(cells[colOf[f]] || "").replace(/^["']|["']$/g, ""));
    const extra = {};
    header.forEach((h, i) => { if (cells[i]) extra[h] = cells[i]; });
    entries.push(finish("import:csv", {
      title: get("title"),
      authors: get("authors").split(/\s*[;|]\s*|\s+and\s+/i),
      year: get("year"),
      doi: get("doi"),
      pmid: get("pmid"),
    }, { row: extra }));
  }
  if (!entries.length) throw new ConnectorError("invalid_search", "CSV has no entry rows");
  return entries;
}

export function parseImport(format, text) {
  if (format === "ris") return parseRIS(text);
  if (format === "bibtex") return parseBibTeX(text);
  if (format === "csv") return parseCSV(text);
  throw new ConnectorError("invalid_search", "format must be ris, bibtex or csv");
}