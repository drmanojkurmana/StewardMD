/* ResearchMD Phase 2.4 deterministic dedup (T0 code, no LLM; ES module).
 * Contract: docs/research/contracts/phase-2/schemas/dedup-run.request.json.
 * Matching order: DOI exact (normalised), then PMID exact, then normalised
 * title + year + first author. Groups keep every record; nothing is deleted,
 * so PRISMA can account for every identified record. The earliest record
 * (created_ts, then id) is canonical. Pure functions: the API persists groups.
 */

/* DOI exact key: lowercase, strip resolver prefix and "doi:" label, trim
 * trailing punctuation. 10.1000/ABC and https://doi.org/10.1000/abc are one. */
export function normaliseDoi(value) {
  let d = String(value || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  d = d.replace(/[.,;:\s]+$/, "");
  return d.indexOf("10.") === 0 ? d : "";
}

/* Title key: lowercase, punctuation stripped, whitespace collapsed. */
export function normaliseTitle(value) {
  return String(value || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* First-author key: the family name. The contract author shape is "Family FM"
 * (family first); "Family, FM" is also accepted. Lowercased, punctuation
 * stripped. Given-first input ("FM Family") must be converted by the parser
 * before dedup (import.js authorName does this). */
export function firstAuthorKey(authors) {
  const first = Array.isArray(authors) ? String(authors[0] || "") : String(authors || "");
  if (!first.trim()) return "";
  const family = first.indexOf(",") >= 0 ? first.split(",")[0] : first.trim().split(/\s+/)[0];
  return family.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pmidOf(rec) {
  if (rec.source === "pubmed") {
    const m = String(rec.externalId || "").match(/^[0-9]+$/);
    return m ? m[0] : "";
  }
  const extra = rec.extra || rec.metadata || {};
  const pmid = String(rec.pmid || extra.pmid || "").trim();
  return /^[0-9]+$/.test(pmid) ? pmid : "";
}

/* The three match keys for one record. A key is "" when it cannot match. */
export function recordKeys(rec) {
  const title = normaliseTitle(rec.title);
  const author = firstAuthorKey(rec.authors);
  const year = rec.year === null || rec.year === undefined ? null : Number(rec.year);
  return {
    doi: normaliseDoi(rec.doi || (rec.source === "crossref" ? rec.externalId : "")),
    pmid: pmidOf(rec),
    title: title && author && year !== null && Number.isFinite(year)
      ? title + "|" + year + "|" + author
      : "",
  };
}

/* Union-find over the records; deterministic regardless of input order. */
export function dedupRecords(records) {
  const parent = new Map();
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== cur) { const next = parent.get(cur); parent.set(cur, root); cur = next; }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const hi = ra > rb ? ra : rb, lo = ra > rb ? rb : ra;
    parent.set(hi, lo);
  };
  const byId = new Map();
  for (const rec of records) {
    parent.set(rec.id, rec.id);
    byId.set(rec.id, rec);
  }
  const doiSeen = new Map(), pmidSeen = new Map(), titleSeen = new Map();
  for (const rec of records) {
    const keys = recordKeys(rec);
    for (const [key, seen] of [["doi", doiSeen], ["pmid", pmidSeen], ["title", titleSeen]]) {
      const v = keys[key];
      if (!v) continue;
      if (seen.has(v)) union(rec.id, seen.get(v));
      else seen.set(v, rec.id);
    }
  }
  const clusters = new Map();
  for (const rec of records) {
    const root = find(rec.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(rec.id);
  }
  const order = (id) => {
    const r = byId.get(id);
    return [r.createdTs === undefined || r.createdTs === null ? 0 : r.createdTs, String(id)];
  };
  const groups = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => {
      const oa = order(a), ob = order(b);
      return oa[0] - ob[0] || (oa[1] < ob[1] ? -1 : oa[1] > ob[1] ? 1 : 0);
    });
    groups.push({ canonicalRecordId: members[0], memberIds: members.slice() });
  }
  groups.sort((a, b) => (a.canonicalRecordId < b.canonicalRecordId ? -1 : a.canonicalRecordId > b.canonicalRecordId ? 1 : 0));
  const duplicatesRemoved = groups.reduce((n, g) => n + g.memberIds.length - 1, 0);
  return { groups, duplicatesRemoved };
}