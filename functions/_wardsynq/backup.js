/* functions/_wardsynq/backup.js — getting the record back, and knowing it is all there.
 *
 * A backup nobody has restored is a rumour. The record store is append-only and versioned, which
 * makes it unusually easy to back up and unusually easy to restore WRONG in a way that looks fine: a
 * dump missing some rows restores without error and produces a chart with a hole in it. Every query
 * still answers, `latest()` still returns something, and the something it returns is a version of the
 * truth that a clinician never saw.
 *
 * So the export is trivial and the IMPORT IS WHERE THE WORK IS. `verifyPlan` refuses a restore that
 * cannot be shown to be complete, and it says which resource is short rather than "checksum failed".
 *
 * THREE THINGS THAT MAKE A RESTORE UNSAFE, all of them silent without this file:
 *
 *   1. A GAP IN A VERSION CHAIN. Versions are 1..n with no holes. A chain that reads 1, 2, 4 means
 *      version 3 was written and is now missing - which is a clinical fact somebody recorded and the
 *      restored record denies. This is the one that matters most and the one a row count cannot see.
 *
 *   2. A TRUNCATED DUMP. The last line of a file cut off mid-write parses as nothing or as half a
 *      row. Counted and named, never skipped.
 *
 *   3. A CHANGED BODY. The row is present and its content is not what was written. Detected by
 *      comparing a digest computed over the canonical body, not by trusting the file.
 *
 * IT NEVER REPAIRS ANYTHING. A gap is reported, never filled by renumbering the versions that did
 * survive - which would produce a chain that passes every check and describes a history that did not
 * happen. Restoring a short chain is a decision for a human who knows what was lost.
 */

const str = (v) => (v == null ? "" : String(v).trim());

/** The columns a row must carry to be restorable at all. */
const REQUIRED = Object.freeze(["tenant_id", "resource_type", "id", "version", "recorded_at", "body"]);

/**
 * PURE. A stable digest of one row's restorable content. Deliberately over the BODY plus the
 * identity columns, not over the whole row: `seq` is assigned by the destination database and will
 * legitimately differ after a restore, so including it would make every correct restore fail.
 */
function digestOf(row) {
  const r = row || {};
  const s = `${str(r.tenant_id)}|${str(r.resource_type)}|${str(r.id)}|${Number(r.version)}|${str(r.body)}`;
  // FNV-1a, 32-bit, as a hex string. Not a security hash and not claimed to be one: it detects
  // corruption and truncation, which is what a restore check needs. Nothing here defends against a
  // deliberate forgery - the append-only store and the audit do that.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** PURE. One export line: the row, plus its digest. JSON Lines, so a partial file is partly usable. */
function exportLine(row) {
  const r = row || {};
  return JSON.stringify({
    tenant_id: r.tenant_id, resource_type: r.resource_type, id: r.id, version: Number(r.version),
    patient_id: r.patient_id == null ? null : r.patient_id,
    recorded_at: r.recorded_at, effective_at: r.effective_at == null ? null : r.effective_at,
    actor_id: r.actor_id == null ? null : r.actor_id, actor_kind: r.actor_kind == null ? null : r.actor_kind,
    body: r.body,
    d: digestOf(r),
  });
}

/** PURE. The whole export, as a string. Ordered by seq so a reader can follow the write order. */
function exportLines(rows) {
  return (rows || []).filter(Boolean).map(exportLine).join("\n");
}

/**
 * PURE. Reads a dump and says whether it can be restored.
 *
 * Returns `{ok, rows, problems, resources, counts}`. `ok` is false whenever ANY problem was found:
 * a partial restore is a decision, not a default.
 */
function verifyPlan(text) {
  const lines = String(text == null ? "" : text).split("\n");
  const rows = [], problems = [];
  let blank = 0;

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) { blank++; return; }
    let row;
    // A dump cut off mid-write leaves a line that is not JSON. Named with its line number, because
    // "the file is corrupt" is not something an operator at 04:00 can act on.
    try { row = JSON.parse(t); } catch { problems.push({ line: i + 1, reason: "unparseable", detail: t.slice(0, 60) }); return; }
    const missing = REQUIRED.filter((k) => row[k] === undefined || row[k] === null || row[k] === "");
    if (missing.length) { problems.push({ line: i + 1, reason: "incomplete_row", missing }); return; }
    if (!Number.isInteger(row.version) || row.version < 1) { problems.push({ line: i + 1, reason: "bad_version", detail: String(row.version) }); return; }
    if (row.d && digestOf(row) !== row.d) {
      problems.push({ line: i + 1, reason: "digest_mismatch", resource: `${row.resource_type}/${row.id}`, version: row.version });
      return;
    }
    rows.push(row);
  });

  /* THE VERSION CHAINS. This is the check a row count cannot make: a dump can be the right length,
   * parse perfectly, and still be missing version 3 of one resource. */
  const chains = new Map();
  for (const r of rows) {
    const key = `${r.tenant_id}/${r.resource_type}/${r.id}`;
    const seen = chains.get(key) || new Set();
    if (seen.has(r.version)) problems.push({ reason: "duplicate_version", resource: key, version: r.version });
    seen.add(r.version);
    chains.set(key, seen);
  }
  for (const [key, seen] of chains) {
    const versions = [...seen].sort((a, b) => a - b);
    const highest = versions[versions.length - 1];
    const gaps = [];
    for (let v = 1; v <= highest; v++) if (!seen.has(v)) gaps.push(v);
    /* NEVER RENUMBERED. Filling a gap by shifting the versions that survived would produce a chain
     * that passes every check and describes a history that did not happen. */
    if (gaps.length) problems.push({ reason: "version_gap", resource: key, missing: gaps, highest });
  }

  return {
    ok: problems.length === 0,
    rows, problems,
    resources: chains.size,
    counts: { lines: lines.length, blank, restorable: rows.length, problems: problems.length },
  };
}

export { REQUIRED, digestOf, exportLine, exportLines, verifyPlan };
