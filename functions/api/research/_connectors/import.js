/* ResearchMD Phase 2.4 reference-file import parsers (ES module).
 * Contract: docs/research/contracts/phase-2/schemas/import-create.request.json.
 * RIS, BibTeX, CSV, CSL-JSON, EndNote XML and NBIB -> the connector record
 * shape, with source "import:ris" | "import:bibtex" | "import:csv" |
 * "import:csl-json" | "import:endnote-xml" | "import:nbib".
 * Deterministic T0 code, no LLM. Parsers never touch D1 or R2; the API reads
 * the uploaded file from private R2 and persists the entries.
 *
 * externalId is never empty: DOI when present, else PMID, else a stable
 * FNV-1a hash of normalised title|year|first author, so re-importing the same
 * file hits the UNIQUE(project, source, external_id) constraint instead of
 * duplicating rows.
 */
import { ConnectorError } from "./_http.js";
import { normaliseDoi, normaliseTitle, firstAuthorKey, recordKeys } from "../_dedup.js";

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

/* ---- CSL-JSON (Zotero "Better CSL JSON", Mendeley CSL export) ----------- */
function cslText(value) {
  if (Array.isArray(value)) return value.map(cslText).filter(Boolean).join(" ");
  if (value && typeof value === "object") return "";
  return value == null ? "" : String(value);
}
function cslAuthor(raw) {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  if (raw.literal) return String(raw.literal);
  const family = String(raw.family || "").trim();
  const given = String(raw.given || "").trim();
  if (family && given) return family + ", " + given;
  return family || given;
}
function cslYear(item) {
  const issued = item && item.issued;
  const parts = issued && issued["date-parts"];
  if (Array.isArray(parts) && Array.isArray(parts[0]) && parts[0][0] != null) return parts[0][0];
  if (issued && typeof issued.raw === "string") return issued.raw;
  return item && (item.year || item.issued) ? (item.year || "") : "";
}
function cslItems(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.items)) return value.items;
  if (value && typeof value === "object") return [value];
  return [];
}
export function parseCSL(text) {
  let value;
  try { value = JSON.parse(String(text || "")); }
  catch (e) { throw new ConnectorError("invalid_search", "CSL-JSON is not valid JSON"); }
  const items = cslItems(value).filter((item) => item && typeof item === "object" && !Array.isArray(item));
  const entries = [];
  for (const item of items) {
    const authors = Array.isArray(item.author)
      ? item.author
      : (typeof item.author === "string" ? item.author.split(/\s+and\s+/i) : []);
    const pmid = String(item.PMID || item.pmid || "").replace(/\D/g, "");
    const doi = cslText(item.DOI || item.doi);
    entries.push(finish("import:csl-json", {
      title: cslText(item.title),
      authors: authors.map(cslAuthor),
      year: cslYear(item),
      doi,
      pmid,
    }, {
      type: cslText(item.type),
      key: cslText(item.id),
      pmid,
      containerTitle: cslText(item["container-title"]),
      volume: cslText(item.volume),
      issue: cslText(item.issue || item.number),
      page: cslText(item.page),
      abstract: cslText(item.abstract),
      url: cslText(item.URL || item.url),
    }));
  }
  if (!entries.length) throw new ConnectorError("invalid_search", "No CSL-JSON entries found");
  return entries;
}

/* ---- EndNote XML ---------------------------------------------------------- */
function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function xmlBlock(xml, tag) {
  const m = String(xml || "").match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  return m ? m[1] : "";
}
function xmlPlain(xml, tag) {
  const inner = xmlBlock(xml, tag);
  if (!inner) return "";
  return decodeXml(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function xmlAll(xml, tag) {
  const re = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "gi");
  const out = [];
  let m;
  const src = String(xml || "");
  while ((m = re.exec(src))) {
    const text = decodeXml(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}
function doiLike(value) {
  const s = String(value || "").trim();
  return /^10\.\d{4,}\/\S+$/.test(s) ? s : "";
}
export function parseEndNoteXML(text) {
  const src = String(text || "");
  const records = [];
  const re = /<record\b[^>]*>([\s\S]*?)<\/record>/gi;
  let m;
  while ((m = re.exec(src))) records.push(m[1]);
  if (!records.length) throw new ConnectorError("invalid_search", "No EndNote XML records found (expected a record element)");
  const entries = [];
  for (const rec of records) {
    const titles = xmlBlock(rec, "titles");
    const title = xmlPlain(titles || rec, "title");
    const authorsBlock = xmlBlock(rec, "authors");
    const authors = xmlAll(authorsBlock || rec, "author");
    const dates = xmlBlock(rec, "dates");
    const year = xmlPlain(dates || rec, "year");
    const electronic = xmlPlain(rec, "electronic-resource-num");
    const isbn = xmlPlain(rec, "isbn");
    const accession = xmlPlain(rec, "accession-num");
    const doi = doiLike(electronic) || doiLike(isbn) || doiLike(accession);
    const pmid = /^\d+$/.test(accession) && !doiLike(accession) ? accession : "";
    const journal = xmlPlain(rec, "secondary-title") || xmlPlain(rec, "full-title");
    entries.push(finish("import:endnote-xml", {
      title, authors, year, doi, pmid,
    }, {
      journal,
      volume: xmlPlain(rec, "volume"),
      issue: xmlPlain(rec, "number"),
      pages: xmlPlain(rec, "pages"),
      abstract: xmlPlain(rec, "abstract"),
      pmid,
      recNumber: xmlPlain(rec, "rec-number"),
    }));
  }
  if (!entries.length) throw new ConnectorError("invalid_search", "No EndNote XML records found (expected a record element)");
  return entries;
}

/* ---- NBIB (PubMed MEDLINE) ------------------------------------------------ */
export function parseNBIB(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const records = [];
  let cur = null;
  let last = "";
  const push = () => {
    if (!cur) return;
    records.push(cur);
    cur = null;
    last = "";
  };
  for (const line of lines) {
    const tagLine = line.match(/^([A-Z][A-Z0-9]{1,3})\s*-\s?(.*)$/);
    if (tagLine) {
      const tag = tagLine[1];
      const value = tagLine[2].trim();
      if (tag === "PMID" && cur) push();
      if (!cur) cur = { tags: {} };
      if (!cur.tags[tag]) cur.tags[tag] = [];
      cur.tags[tag].push(value);
      last = tag;
    } else if (cur && last && /^\s{3,}\S/.test(line)) {
      const arr = cur.tags[last];
      arr[arr.length - 1] += " " + line.trim();
    }
  }
  push();
  const entries = [];
  for (const rec of records) {
    const tags = rec.tags;
    const lid = [].concat(tags.LID || [], tags.AID || []).join(" ");
    const doiMatch = lid.match(/10\.\d{4,}\/\S+/);
    const doi = doiMatch ? doiMatch[0].replace(/[.,;]+$/, "").replace(/\s*\[doi\]$/i, "") : "";
    const pmid = ((tags.PMID || [])[0] || "").replace(/\D/g, "");
    const authors = (tags.FAU && tags.FAU.length ? tags.FAU : (tags.AU || []));
    entries.push(finish("import:nbib", {
      title: (tags.TI || [])[0] || "",
      authors,
      year: (tags.DP || tags.DEP || [])[0] || "",
      doi,
      pmid,
    }, {
      pmid,
      journal: (tags.JT || tags.TA || [])[0] || "",
      volume: (tags.VI || [])[0] || "",
      issue: (tags.IP || [])[0] || "",
      pages: (tags.PG || [])[0] || "",
      abstract: (tags.AB || []).join(" "),
    }));
  }
  if (!entries.length) throw new ConnectorError("invalid_search", "No NBIB records found (expected PMID lines)");
  return entries;
}

/* True when entry matches an existing project record on DOI, PMID, or
 * normalised title + year + first author (the _dedup.js keys). Returns the
 * existing id, or "" when there is no match. Within one new file, callers
 * pass only records that were already stored before this import. */
export function matchesExistingRecord(existing, entry) {
  const extra = entry && entry.extra && typeof entry.extra === "object" ? entry.extra : {};
  const keys = recordKeys({
    source: entry && entry.source,
    externalId: entry && entry.externalId,
    title: entry && entry.title,
    authors: entry && entry.authors,
    year: entry && entry.year,
    doi: entry && entry.doi,
    pmid: (entry && entry.pmid) || extra.pmid || "",
    extra,
  });
  if (!keys.doi && !keys.pmid && !keys.title) return "";
  for (const rec of existing || []) {
    const rk = recordKeys(rec);
    if (keys.doi && rk.doi && keys.doi === rk.doi) return rec.id || "match";
    if (keys.pmid && rk.pmid && keys.pmid === rk.pmid) return rec.id || "match";
    if (keys.title && rk.title && keys.title === rk.title) return rec.id || "match";
  }
  return "";
}

const IMPORT_PARSERS = {
  ris: parseRIS,
  bibtex: parseBibTeX,
  csv: parseCSV,
  "csl-json": parseCSL,
  csl: parseCSL,
  json: parseCSL,
  "endnote-xml": parseEndNoteXML,
  endnote: parseEndNoteXML,
  xml: parseEndNoteXML,
  nbib: parseNBIB,
  medline: parseNBIB,
};

export function parseImport(format, text) {
  const parser = IMPORT_PARSERS[format];
  if (!parser) throw new ConnectorError("invalid_search", "format must be ris, bibtex, csv, csl-json, endnote-xml or nbib");
  return parser(text);
}