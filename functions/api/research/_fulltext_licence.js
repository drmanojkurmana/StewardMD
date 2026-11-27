/* Europe PMC full-text licence gate (ES module, server side).
 *
 * Rule 13 in docs/research/research-2.0b-database-terms.md treats an
 * unconfirmed open-access licence as all rights reserved. Full text may be
 * fetched, cached or sent to an AI only when the record is open access AND
 * carries a licence that permits commercial reuse: cc by, cc by-sa, cc0 or
 * public domain. Any NC or ND term, a missing licence, an unknown licence or
 * a record that is not open access is blocked. The same predicate is used by
 * the study card and by find-and-add studies so the rules cannot drift.
 */
export function fullTextAllowed(record) {
  if (!record || typeof record !== "object") return false;
  const flag = record.isOpenAccess;
  const open = flag === true || flag === 1 ||
    String(flag == null ? "" : flag).trim().toLowerCase() === "y" ||
    String(flag == null ? "" : flag).trim().toLowerCase() === "true";
  if (!open) return false;

  const raw = String(record.license || record.licence || "").trim().toLowerCase();
  if (!raw) return false;
  if (/\b(?:nc|nd)\b/.test(raw)) return false;
  if (/\b(?:non[\s-]?commercial|no[\s-]?deriv\w*)\b/.test(raw)) return false;

  if (/(^|[^a-z0-9])cc[\s-]?0([^a-z0-9]|$)/.test(raw)) return true;
  if (/\bpublic[\s-]domain\b/.test(raw)) return true;

  const norm = raw.replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
  return /^cc by(?: sa)?$/.test(norm);
}