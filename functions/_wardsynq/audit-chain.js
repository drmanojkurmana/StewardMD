/* functions/_wardsynq/audit-chain.js - P2.17: tamper evidence for the clinical audit trail.
 *
 * WHAT IT IS. Every audit row the record repository writes is followed, in the SAME atomic write, by
 * one link row: (tenant, chain_seq, audit_id, prev_hash, row_hash), with
 *   row_hash = SHA-256(prev_hash || canonical JSON of the audit row as stored).
 * chain_seq is 1, 2, 3... per hospital with no gaps. A changed audit row no longer hashes to its
 * link; a removed audit row leaves a link pointing at nothing; a removed link leaves a missing number.
 *
 * WHY A SIDE TABLE AND NOT TWO NEW COLUMNS. connect_audit_event is live and shared with ABDM and the
 * rest of Connect (actor.js requestContextOf() already declined a migration on it), and the schema
 * files are applied with CREATE ... IF NOT EXISTS on every on-premise boot, where ALTER TABLE ADD
 * COLUMN is not re-runnable. A new table is.
 *
 * WHAT IT IS NOT. It is evidence, not prevention: someone who can write to the database can rebuild
 * the whole chain. The prevention is the BEFORE UPDATE / BEFORE DELETE triggers in
 * functions/db/wardsynq_schema.sql; this is what tells you when those were bypassed (a restore, a
 * dropped trigger, an import). The chain alone cannot see a rebuild that recomputes every hash, or
 * rows removed from the END (the head just moves back); that is what the outside anchors below are
 * for. What remains even with anchors: an attacker who controls BOTH the database and the anchor
 * store can move both together, and anything in the window before the first anchor. See
 * docs/BACKUP_DR.md.
 *
 * OUTSIDE ANCHORS. Once an hour the background tick copies the head ({seq, hash}) into a bounded log
 * (the last 200, `{seq, hash, at}`) kept OUTSIDE the database (KV in production), under
 * `wsq:auditanchor:<tenantId>`. checkAnchors() compares every stored anchor against the chain row at
 * that sequence number: a rebuild after an anchor reads `rewritten`, a removed tail reads
 * `truncated`. An older anchor is never overwritten by a different hash for the same seq; that
 * conflict is itself the tamper finding. Anchors are evidence, not prevention, and the first anchor
 * only covers what comes after it.
 *
 * ROWS WRITTEN BEFORE THIS EXISTED ARE THE UNCHAINED GENESIS ERA. They cannot be verified and are not
 * pretended to be. Link 1 names the newest of them (legacy_boundary) and its prev_hash is derived from
 * that name, so the boundary itself cannot be moved without breaking link 1.
 *
 * Storage-agnostic: pure functions plus verifyAuditChain() over the repository's optional
 * auditChainHead()/auditChainRows(). The anchors take an injected `{get(key), put(key, value)}`
 * store (KV-shaped), so this file still makes no platform calls. No PHI in any message here: seqs,
 * hashes and timestamps only.
 */

import { sha256Hex } from "./object-store.js";

const str = (v) => (v == null ? "" : String(v).trim());
const GENESIS_PREFIX = "wardsynq-audit-genesis:";
const VERIFY_DEFAULT = 500;
const VERIFY_MAX = 5000;
/* A lost race on chain_seq (another isolate or process extended the chain between our head read and
 * our write) retries this many times with a short jittered wait, then surfaces as a version conflict:
 * nothing landed, so a retry by the caller is safe. */
const APPEND_ATTEMPTS = 8;
const retryPause = (attempt) => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10 * attempt)));

/* ONE CHAIN EXTENSION AT A TIME PER STORE AND HOSPITAL, WITHIN THIS PROCESS. Without it a chart open
 * that fires a dozen audited reads at once makes a dozen writers race for the same link number, and
 * all but one retry, again and again, until some run out of attempts and a read fails. The primary
 * key still decides the races this lock cannot see (another isolate, another process).
 * ponytail: one chain per hospital serialises that hospital's audit writes; a per-shard chain is the
 * upgrade if one hospital ever contends past a D1 write per link. */
const LOCKS = new WeakMap();
function withChainLock(owner, tenantId, fn) {
  if (!LOCKS.has(owner)) LOCKS.set(owner, new Map());
  const m = LOCKS.get(owner);
  const run = (m.get(tenantId) || Promise.resolve()).then(fn);
  const tail = run.then(() => {}, () => {});
  m.set(tenantId, tail);
  tail.then(() => { if (m.get(tenantId) === tail) m.delete(tenantId); });
  return run;
}

/** PURE. JSON with object keys sorted at every depth, so the same row always hashes the same. */
function canonicalJson(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

/** PURE. prev_hash of link 1, bound to the legacy boundary it names. */
const genesisHash = (legacyBoundary) => GENESIS_PREFIX + str(legacyBoundary);

/** row_hash = SHA-256(prev_hash || canonical JSON of the row). */
const chainHash = (prevHash, row) => sha256Hex(String(prevHash) + canonicalJson(row));

/**
 * The links for audit rows about to be written after `head` ({seq, hash} | null). Both repositories
 * call this so they cannot disagree about what a link is.
 * @returns {Promise<{chainSeq, auditId, prevHash, rowHash, legacyBoundary}[]>}
 */
async function nextLinks(head, rows, legacyBoundary) {
  const out = [];
  let seq = head ? head.seq : 0;
  let prev = head ? head.hash : genesisHash(legacyBoundary);
  for (const { auditId, row } of rows) {
    seq += 1;
    const rowHash = await chainHash(prev, row);
    out.push({ chainSeq: seq, auditId, prevHash: prev, rowHash, legacyBoundary: seq === 1 ? (legacyBoundary || null) : null });
    prev = rowHash;
  }
  return out;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Walks a bounded window of the chain. Never "ok" on a read that failed or came back short.
 *
 * opts.fromSeq: first link to check; default the newest `limit` links. opts.limit: at most VERIFY_MAX.
 * @returns {Promise<{status: "ok"|"empty"|"broken"|"gap"|"not_verified", message: string, ...}>}
 */
async function verifyAuditChain(repository, tenantId, opts) {
  const o = opts || {};
  const limit = Math.max(1, Math.min(VERIFY_MAX, Math.floor(Number(o.limit)) || VERIFY_DEFAULT));
  if (!repository || typeof repository.auditChainHead !== "function" || typeof repository.auditChainRows !== "function") {
    return { status: "not_verified", message: "Not verified: this deployment's storage cannot read the audit chain back." };
  }
  let head, rows;
  try {
    head = await repository.auditChainHead(tenantId);
    if (!head) return { status: "empty", checked: 0, message: "No audit rows have been written since tamper evidence was switched on, so there is nothing to verify yet." };
    const end = Number(head.seq);
    const start = o.fromSeq != null && Number.isFinite(Number(o.fromSeq)) ? Math.max(1, Math.floor(Number(o.fromSeq))) : Math.max(1, end - limit + 1);
    if (start > end) return { status: "not_verified", headSeq: end, message: `Not verified: row ${start} was asked for but the newest chained row is ${end}.` };
    const stop = Math.min(end, start + limit - 1);
    rows = await repository.auditChainRows(tenantId, Math.max(1, start - 1), stop);
    if (!Array.isArray(rows)) throw new Error("no rows");

    const bySeq = new Map(rows.map((r) => [Number(r.chainSeq), r]));
    const window = { fromSeq: start, toSeq: stop, headSeq: end, checked: 0 };
    let prev = null;
    if (start > 1) {
      const anchor = bySeq.get(start - 1);
      if (!anchor) return { status: "gap", ...window, atSeq: start - 1, message: `Gap: chained row ${start - 1} is missing. A row was removed from the audit trail.` };
      prev = anchor.rowHash;
    }
    for (let seq = start; seq <= stop; seq++) {
      const r = bySeq.get(seq);
      if (!r) return { status: "gap", ...window, atSeq: seq, message: `Gap: chained row ${seq} is missing. A row was removed from the audit trail.` };
      if (!r.row) return { status: "gap", ...window, atSeq: seq, auditId: r.auditId, message: `Gap: the audit row for chained row ${seq} (${r.auditId}) is missing. It was removed from the audit trail.` };
      const expectedPrev = seq === 1 ? genesisHash(r.legacyBoundary) : prev;
      if (r.prevHash !== expectedPrev) {
        return { status: "broken", ...window, atSeq: seq, auditId: r.auditId, expected: expectedPrev, found: r.prevHash,
          message: `Broken at chained row ${seq} (${r.auditId}): it does not follow the row before it. The audit trail was altered at or before this row.` };
      }
      const h = await chainHash(r.prevHash, r.row);
      if (h !== r.rowHash) {
        return { status: "broken", ...window, atSeq: seq, auditId: r.auditId, expected: h, found: r.rowHash,
          message: `Broken at chained row ${seq} (${r.auditId}): its contents no longer match what was written. The audit row was changed.` };
      }
      prev = r.rowHash;
      window.checked += 1;
    }
    const whole = start === 1 && stop === end;
    return { status: "ok", ...window, headHash: head.hash,
      message: whole ? `Intact: all ${plural(end, "chained row")} checked.` : `Intact: chained rows ${start} to ${stop} of ${end} checked (the newest ${plural(window.checked, "row")}).` };
  } catch (e) {
    return { status: "not_verified", message: "Not verified: the audit chain could not be read, so its integrity is unknown." };
  }
}

/* INDIA: Indian Medical Council regulation 1.3.1 keeps in-patient records at least three years, and the
 * audit of those records is kept at least as long. It is informational (nothing deletes on it) and above
 * the one-year log floor of DPDP Rules 2025 r.6(1)(e) and r.8(3); documents.js now keeps documents ten
 * years (retention.js) and audit rows are never deleted. No other region has a default here. */
const REGION_DEFAULT_YEARS = Object.freeze({ IN: { years: 3, source: "Indian Medical Council regulation 1.3.1 (records kept at least three years)" } });

/** PURE. The audit retention period to show. INFORMATIONAL: nothing anywhere deletes on it. */
function auditRetentionSetting(configured, region) {
  if (configured != null && configured !== "") {
    const n = Number(configured);
    if (Number.isFinite(n) && n > 0 && n <= 100) return { years: n, source: "configured" };
    return { years: null, source: "invalid", note: "The configured audit retention period is not a number of years, so it is treated as not configured." };
  }
  const d = REGION_DEFAULT_YEARS[str(region).toUpperCase() || "IN"];
  return d ? { years: d.years, source: "region-default", citation: d.source } : { years: null, source: "not-configured" };
}

/* OUTSIDE ANCHORS. The newest link copied somewhere a database write cannot move.
 *
 * WHY A SEPARATE STORE AND NOT ANOTHER TABLE. Another table in the same database shares the same
 * trust domain: anyone who can rebuild the chain can rebuild the anchors in the same transaction.
 * KV is written through a different binding with different credentials, so moving both means
 * compromising two places, not one. The anchors are still evidence, not prevention.
 *
 * WHY NEVER OVERWRITE. A rebuilt chain reuses the same sequence numbers with different hashes. If
 * anchoring replaced the old hash with the new one, the rebuild would erase its own evidence on the
 * next tick. So a seq that is already anchored keeps its FIRST hash; a head that disagrees with it
 * is left unrecorded and checkAnchors() reports it.
 */

const ANCHOR_PREFIX = "wsq:auditanchor:";
const ANCHOR_MAX = 200;

/** PURE. The store key for a hospital's anchor log. */
const anchorKey = (tenantId) => ANCHOR_PREFIX + str(tenantId);

/** PURE. A stored anchor is a seq, the hash the chain had there, and when it was copied.
 * A restarted log's oldest entry also carries `acknowledged` (see acknowledgeAnchorBreak): who said
 * the break was a legitimate restore, when, and under which incident. It rides on the entry so the
 * acknowledgement survives exactly as long as the log it restarted, and no longer. */
const anchorEntry = (seq, hash, at, acknowledged) => {
  const e = { seq: Number(seq), hash: String(hash), at: String(at) };
  if (acknowledged && typeof acknowledged === "object") e.acknowledged = { ...acknowledged };
  return e;
};

/** PURE. The acknowledgement on a restarted log's oldest entry, or null when there is none worth
 * naming. `by` and `incidentRef` are required: an acknowledgement that cannot say who or under
 * which incident is not one the health line may quote. */
function acknowledgedOf(a) {
  const k = a && a.acknowledged;
  if (!k || typeof k !== "object") return null;
  if (!str(k.by) || !str(k.incidentRef)) return null;
  return { by: str(k.by), reason: str(k.reason), incidentRef: str(k.incidentRef),
    previousStatus: str(k.previousStatus) || null,
    previousAtSeq: k.previousAtSeq != null && Number.isFinite(Number(k.previousAtSeq)) ? Number(k.previousAtSeq) : null };
}

const validAnchor = (a) => !!a && Number.isFinite(Number(a.seq)) && Number(a.seq) > 0 && typeof a.hash === "string" && a.hash.length > 0;

/**
 * PURE. Parses a stored anchor log. Returns the anchors (oldest first), [] when nothing was ever
 * stored, or null when something was stored that is not a log: corrupt is not empty, and must never
 * read as "nothing to compare yet".
 */
function parseAnchorLog(raw) {
  if (raw == null || raw === "") return [];
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); }
    catch { return null; }
  }
  if (!Array.isArray(v)) return null;
  return v.filter(validAnchor).map((a) => anchorEntry(a.seq, a.hash, a.at || "", a.acknowledged));
}

/**
 * PURE. Folds one head into the log, oldest first, bounded to ANCHOR_MAX. Never overwrites: a seq
 * already present with the same hash is already anchored (no duplicate written); a seq already
 * present with a DIFFERENT hash keeps its first hash and the new head is left out (conflict).
 */
function appendAnchorEntry(log, entry, max) {
  const kept = (log || []).filter(validAnchor).map((a) => anchorEntry(a.seq, a.hash, a.at, a.acknowledged));
  const same = kept.filter((a) => a.seq === entry.seq);
  if (same.length) {
    if (same.some((a) => a.hash === entry.hash)) {
      const first = same.filter((a) => a.hash === entry.hash)[0];
      return { log: kept, appended: false, status: "already", at: first.at };
    }
    return { log: kept, appended: false, status: "conflict", seq: entry.seq, expected: same[0].hash, found: entry.hash, at: same[0].at };
  }
  const next = kept.concat([anchorEntry(entry.seq, entry.hash, entry.at)]);
  const bound = Math.max(1, Math.floor(Number(max)) || ANCHOR_MAX);
  return { log: next.slice(-bound), appended: true, status: "ok" };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Copies the current head into the anchor log. Reads the head, appends `{seq, hash, at}`, keeps
 * the last ANCHOR_MAX. Returns `{status: "ok", ...}` on a stored anchor, `"already"` folded into
 * ok with `anchored: false` when this head is already the newest anchor, `"empty"` when the chain
 * has no rows yet (nothing stored), or `"conflict"` when the head disagrees with an older anchor
 * for the same seq (the old anchor is kept; checkAnchors() names it). A failed READ or WRITE
 * throws: nothing may report success when the anchor did not land, and writing blind over a log
 * that could not be read would destroy older anchors. The tick catches this and records it.
 */
async function anchorHead(repository, tenantId, anchorStore, nowIso) {
  if (!repository || typeof repository.auditChainHead !== "function") throw new Error("this deployment's storage cannot read the audit chain head");
  if (!anchorStore || typeof anchorStore.get !== "function" || typeof anchorStore.put !== "function") throw new Error("no anchor store was handed in");
  const head = await repository.auditChainHead(tenantId);
  if (!head) return { status: "empty", anchored: false, message: "No chained audit rows exist yet, so there is nothing to anchor." };
  const seq = num(head.seq != null ? head.seq : head.chainSeq);
  const hash = head.hash != null && head.hash !== "" ? String(head.hash) : (head.rowHash != null && head.rowHash !== "" ? String(head.rowHash) : "");
  if (seq == null || seq <= 0 || !hash) throw new Error("the audit chain head could not be read");
  const at = str(nowIso) || new Date().toISOString();
  const log = parseAnchorLog(await anchorStore.get(anchorKey(tenantId)));
  if (log === null) throw new Error("the stored anchor log could not be read");
  const folded = appendAnchorEntry(log, anchorEntry(seq, hash, at));
  if (!folded.appended && folded.status === "conflict") {
    return { status: "conflict", anchored: false, seq, expected: folded.expected, found: folded.found,
      message: `Not anchored: chained row ${seq} no longer matches the outside copy from ${folded.at || "an earlier run"}. The earlier copy was kept.` };
  }
  if (!folded.appended) {
    return { status: "ok", anchored: false, seq, hash, at: folded.at || at, anchors: folded.log.length,
      message: `Already anchored: chained row ${seq} matches the outside copy from ${folded.at || "an earlier run"}.` };
  }
  await anchorStore.put(anchorKey(tenantId), JSON.stringify(folded.log));
  return { status: "ok", anchored: true, seq, hash, at, anchors: folded.log.length,
    message: `Anchored chained row ${seq} outside the database (${folded.log.length} kept).` };
}

/**
 * Compares every stored anchor against the chain row at that seq. Never throws and never "ok" on
 * a read that failed. @returns ok | rewritten (names atSeq) | truncated (head below an anchor) |
 * no-anchors (nothing stored yet) | not-verified (a read failed).
 */
async function checkAnchors(repository, tenantId, anchorStore) {
  const fail = (message) => ({ status: "not-verified", message });
  if (!repository || typeof repository.auditChainHead !== "function" || typeof repository.auditChainRows !== "function") {
    return fail("Not verified: this deployment's storage cannot read the audit chain back, so anchors cannot be compared.");
  }
  if (!anchorStore || typeof anchorStore.get !== "function") {
    return fail("Not verified: the outside copy could not be read, so its integrity is unknown.");
  }
  let log;
  try { log = parseAnchorLog(await anchorStore.get(anchorKey(tenantId))); }
  catch { return fail("Not verified: the outside copy could not be read, so its integrity is unknown."); }
  if (log === null) return fail("Not verified: the stored outside copy is not readable, so its integrity is unknown.");
  if (!log.length) return { status: "no-anchors", message: "No outside copy has been recorded yet, so there is nothing outside the database to compare against." };
  const ordered = [...log].sort((a, b) => a.seq - b.seq);
  const newest = ordered[ordered.length - 1].seq;
  let headSeq;
  try {
    const head = await repository.auditChainHead(tenantId);
    headSeq = head ? num(head.seq != null ? head.seq : head.chainSeq) : 0;
    if (head && headSeq == null) return fail("Not verified: the audit chain head could not be read, so anchors cannot be compared.");
  } catch { return fail("Not verified: the audit chain head could not be read, so anchors cannot be compared."); }
  for (const a of ordered) {
    if (a.seq > headSeq) {
      return { status: "truncated", atSeq: a.seq, headSeq, anchors: ordered.length,
        message: `Truncated: the chain now ends at row ${headSeq}, below anchored row ${a.seq} from ${a.at || "an earlier run"}. Newest rows were removed from the audit trail below the application.` };
    }
    let link;
    try {
      const rows = await repository.auditChainRows(tenantId, a.seq, a.seq);
      link = Array.isArray(rows) ? rows[0] : null;
    } catch { return fail(`Not verified: chained row ${a.seq} could not be read back, so its anchor cannot be compared.`); }
    if (!link || link.rowHash !== a.hash) {
      return { status: "rewritten", atSeq: a.seq, expected: a.hash, found: link ? link.rowHash : null, headSeq, anchors: ordered.length,
        message: `Rewritten at chained row ${a.seq}: it no longer matches the outside copy from ${a.at || "an earlier run"}. The audit trail was changed below the application.` };
    }
  }
  const base = `Outside copy matches: all ${ordered.length} anchored rows still match the database (newest anchored row ${newest}, chain head ${headSeq}).`;
  /* An acknowledged restore stays VISIBLE, never silently green: the oldest entry of a restarted log
   * names who accepted the break, when, and under which incident. A health line that went back to up
   * with no trace of why would teach people the tamper line clears itself. */
  const ack = acknowledgedOf(ordered[0]);
  if (!ack) return { status: "ok", anchors: ordered.length, newestSeq: newest, headSeq, message: base };
  return { status: "ok", anchors: ordered.length, newestSeq: newest, headSeq,
    acknowledgement: { by: ack.by, reason: ack.reason, incidentRef: ack.incidentRef,
      previousStatus: ack.previousStatus, previousAtSeq: ack.previousAtSeq, at: ordered[0].at || null },
    message: `${base} Acknowledged restore by ${ack.by} on ${ordered[0].at || "an earlier run"}, incident ${ack.incidentRef}.` };
}

/* G12 ANCHOR STORE PORT. An anchor store is `{name, get(key) -> string|null, put(key, value)}` on
 * strings, and nothing else. Production hands in two, neither of them D1: KV (the router's
 * auditAnchorStore) and Firestore (functions/_q_audit_chain.js firestoreAnchorStore). The S3 bucket
 * planned for the AWS move (owner D12) is a third implementation of the same three members, not a
 * change here. Every function above still takes a single store, so one-store callers are unchanged.
 *
 * TWO STORES, TWO QUESTIONS. Does each copy match the database (checkAnchors, per store)? Do the
 * copies agree with each other (anchorDisagreement)? A disagreement is its own finding: an attacker
 * who controls the database and ONE store can make that store agree with a rebuilt chain, and only
 * the other store's different hash for the same row shows it. */

const ANCHOR_RANK = Object.freeze({ rewritten: 6, truncated: 6, disagree: 5, "not-verified": 4, "no-anchors": 3, ok: 1 });

/** PURE. What a caller handed in, as named stores: a store, an array of stores, or nothing. */
function anchorStoresOf(x) {
  const list = (Array.isArray(x) ? x : x ? [x] : []).filter((s) => s && typeof s.get === "function");
  return list.map((s, i) => ({ store: s, name: str(s.name) || (list.length === 1 ? "Outside copy" : `Outside copy ${i + 1}`) }));
}

/**
 * The lowest chained row two stores both anchored with DIFFERENT hashes, or null when every shared
 * row agrees. A store whose log cannot be read is skipped here: checkAnchors already names it.
 */
async function anchorDisagreement(tenantId, stores) {
  const logs = [];
  for (const s of anchorStoresOf(stores)) {
    let log = null;
    try { log = parseAnchorLog(await s.store.get(anchorKey(tenantId))); } catch { log = null; }
    if (log && log.length) logs.push({ name: s.name, bySeq: new Map(log.map((a) => [a.seq, a])) });
  }
  let found = null;
  for (let i = 0; i < logs.length; i++) for (let j = i + 1; j < logs.length; j++) {
    for (const [seq, a] of logs[i].bySeq) {
      const b = logs[j].bySeq.get(seq);
      if (b && b.hash !== a.hash && (!found || seq < found.seq)) found = { seq, copies: [{ name: logs[i].name, hash: a.hash, at: a.at || null }, { name: logs[j].name, hash: b.hash, at: b.at || null }] };
    }
  }
  if (!found) return null;
  return { ...found, message: `The outside copies disagree at chained row ${found.seq}: ${found.copies[0].name} and ${found.copies[1].name} hold different hashes for it. One of them was changed outside the application.` };
}

/**
 * Every store compared against the chain, and the stores compared with each other. One store
 * returns exactly what checkAnchors returns. Several return the worst status (rewritten or
 * truncated, then disagree, not-verified, no-anchors, ok), `stores` with each store's own result,
 * and `disagreement`. Never throws, never ok unless every store is ok.
 */
async function checkAnchorStores(repository, tenantId, stores) {
  const list = anchorStoresOf(stores);
  if (!list.length) return { status: "no-anchors", stores: [], message: "No anchor store was handed in, so there is nothing outside the database to compare against." };
  if (list.length === 1) return checkAnchors(repository, tenantId, list[0].store);
  const results = [];
  for (const s of list) results.push({ name: s.name, ...(await checkAnchors(repository, tenantId, s.store)) });
  const disagreement = await anchorDisagreement(tenantId, list.map((s) => s.store));
  let worst = results[0];
  for (const r of results) if ((ANCHOR_RANK[r.status] || 4) > (ANCHOR_RANK[worst.status] || 4)) worst = r;
  const status = disagreement && (ANCHOR_RANK[worst.status] || 4) < ANCHOR_RANK.disagree ? "disagree" : worst.status;
  const message = [disagreement ? disagreement.message : null, ...results.map((r) => `${r.name}: ${r.message}`)].filter(Boolean).join(" ");
  const out = { status, stores: results, disagreement, message };
  if (status === "rewritten" || status === "truncated") Object.assign(out, { atSeq: worst.atSeq, headSeq: worst.headSeq, expected: worst.expected, found: worst.found });
  if (status === "disagree") out.atSeq = disagreement.seq;
  if (status === "ok") { const ack = results.find((r) => r.acknowledgement); if (ack) out.acknowledgement = ack.acknowledgement; }
  return out;
}

/* ANCHOR ARCHIVE. acknowledgeAnchorBreak() below moves the broken log here before restarting it. The
 * key carries the acknowledgement time so every acknowledgement keeps its own archive, and archives
 * are write-once: nothing in this file ever deletes one, so the evidence of what the restore
 * discarded stays readable after the health line is back up. */

/** PURE. The archive key for a hospital's anchor log at one acknowledgement time. */
const anchorArchiveKey = (tenantId, iso) => ANCHOR_PREFIX + str(tenantId) + ":archived:" + str(iso);

/** The audit action recorded when an anchor break is acknowledged. The entry carries the previous
 * status, the row it broke at and the incident reference; the free-text reason lives on the anchor
 * entry (operational metadata, never patient data), not in the chained row. */
const ANCHOR_ACK_ACTION = "audit.anchor_acknowledged";

/**
 * Acknowledges a LEGITIMATE restore of the audit trail: after a Time Travel restore the anchor
 * comparison correctly reports rewritten/truncated, and stays that way, because no new anchor may
 * overwrite the evidence. The hospital owner says "we restored on purpose", and the log restarts
 * from the current head with that statement attached.
 *
 * Only a log checkAnchors() currently reports as rewritten or truncated may be acknowledged;
 * anything else is refused with nothing_to_acknowledge. On success the old log is moved UNCHANGED
 * to anchorArchiveKey() and a fresh one-entry log for the current head takes its place, and the
 * acknowledgement itself is written through the repository so it is chained like any other audit
 * row. The audit write happens FIRST, so the fresh anchor already covers the acknowledgement row.
 *
 * Never a half move: the archive is written before the log is replaced, and every failure leaves
 * the old log in place and says so. A failed archive changes nothing; a failed replace keeps the
 * archive and reports replace_failed, so a retry archives again rather than losing the old log; a
 * failed audit write stops before the store is touched at all. Nothing here throws and nothing
 * reports ok unless the fresh log landed.
 */
async function acknowledgeAnchorBreak(repository, tenantId, anchorStore, opts) {
  const o = opts || {};
  const by = str(o.by), reason = str(o.reason), incidentRef = str(o.incidentRef);
  const nowIso = str(o.nowIso) || new Date().toISOString();
  const fail = (status, error, message, extra) => ({ ok: false, status, error, message, ...(extra || {}) });
  /* G12: several stores. Every store that reads rewritten or truncated is restarted, and a store that
   * holds no anchors yet is seeded with the same fresh entry, under ONE chained acknowledgement. A
   * store that already matches is left alone, so a retry after a partial failure redoes only the rest. */
  if (Array.isArray(anchorStore) && anchorStore.length > 1) return acknowledgeAcrossStores(repository, tenantId, anchorStoresOf(anchorStore), { by, reason, incidentRef, nowIso }, fail);
  if (Array.isArray(anchorStore)) anchorStore = anchorStore[0];
  if (!anchorStore || typeof anchorStore.get !== "function" || typeof anchorStore.put !== "function") {
    return fail(503, "anchor_store_unavailable", "No outside copy store was handed in, so the anchor log cannot be acknowledged and nothing was changed.");
  }
  if (!repository || typeof repository.auditChainHead !== "function" || typeof repository.auditChainRows !== "function" || typeof repository.auditOnly !== "function") {
    return fail(502, "repository_unavailable", "This deployment's storage cannot write the acknowledgement, so the anchor log was left in place.");
  }
  const current = await checkAnchors(repository, tenantId, anchorStore);
  if (current.status !== "rewritten" && current.status !== "truncated") {
    return { ok: false, status: 409, error: "nothing_to_acknowledge", anchorStatus: current.status,
      message: current.status === "ok"
        ? "Nothing to acknowledge: the outside copy matches the database, so the anchor log was left in place."
        : `Nothing to acknowledge: the outside copy is ${current.status}, not rewritten or truncated, so the anchor log was left in place.` };
  }
  let raw;
  try { raw = await anchorStore.get(anchorKey(tenantId)); }
  catch { return fail(502, "anchor_unreadable", "The outside copy could not be read, so the anchor log was left in place."); }
  const log = parseAnchorLog(raw);
  if (log === null || !log.length) {
    return fail(502, "anchor_unreadable", "The stored outside copy is not a readable anchor log, so it was left in place rather than acknowledged blind.");
  }
  /* The acknowledgement is chained before anything is archived, so a later reader can see who said
   * the restore was legitimate without trusting the anchor store alone. A failed write stops here,
   * before the store is touched, and the break is still reported on the next check. */
  try {
    await repository.auditOnly(tenantId, { ts: nowIso, actor: by, connectorId: "wardsynq",
      action: ANCHOR_ACK_ACTION, scope: { previousStatus: current.status, previousAtSeq: current.atSeq != null ? current.atSeq : null, incidentRef },
      outcome: "ok", detail: `Anchor break acknowledged (was ${current.status} at chained row ${current.atSeq}): incident ${incidentRef}.` });
  } catch { return fail(502, "audit_failed", "The acknowledgement could not be written to the audit trail, so the anchor log was left in place."); }
  let head;
  try { head = await repository.auditChainHead(tenantId); }
  catch { return fail(502, "head_unreadable", "The acknowledgement was chained but the audit chain head could not be read back, so the anchor log was left in place."); }
  const seq = head ? num(head.seq != null ? head.seq : head.chainSeq) : null;
  const hash = head ? (head.hash != null && head.hash !== "" ? String(head.hash) : (head.rowHash != null && head.rowHash !== "" ? String(head.rowHash) : "")) : "";
  if (seq == null || seq <= 0 || !hash) {
    return fail(502, "head_unreadable", "The acknowledgement was chained but the audit chain head could not be read back, so the anchor log was left in place.");
  }
  const acknowledged = { by, reason, incidentRef, previousStatus: current.status, previousAtSeq: current.atSeq != null ? current.atSeq : null };
  const archiveKey = anchorArchiveKey(tenantId, nowIso);
  try { await anchorStore.put(archiveKey, typeof raw === "string" ? raw : JSON.stringify(log)); }
  catch { return fail(502, "archive_failed", "The old anchor log could not be archived, so it was left in place and nothing was acknowledged.", { archived: null }); }
  try { await anchorStore.put(anchorKey(tenantId), JSON.stringify([anchorEntry(seq, hash, nowIso, acknowledged)])); }
  catch {
    return fail(502, "replace_failed",
      "The old anchor log was archived but the fresh log could not be written, so the old log is still in place and nothing was acknowledged. Acknowledging again is safe: it archives again rather than deleting.",
      { archived: archiveKey, previousStatus: current.status, previousAtSeq: current.atSeq != null ? current.atSeq : null });
  }
  return { ok: true, status: "acknowledged", seq, hash, at: nowIso, by, incidentRef,
    previousStatus: current.status, previousAtSeq: current.atSeq != null ? current.atSeq : null,
    archived: archiveKey, anchors: 1,
    message: `Acknowledged: the anchor log that reported ${current.status} at chained row ${current.atSeq} is archived, and a fresh log starts at chained row ${seq}.` };
}

async function acknowledgeAcrossStores(repository, tenantId, list, k, fail) {
  if (list.length < 2 || list.some((s) => typeof s.store.put !== "function")) {
    return fail(503, "anchor_store_unavailable", "An outside copy store cannot be written, so the anchor logs cannot be acknowledged and nothing was changed.");
  }
  if (!repository || typeof repository.auditChainHead !== "function" || typeof repository.auditChainRows !== "function" || typeof repository.auditOnly !== "function") {
    return fail(502, "repository_unavailable", "This deployment's storage cannot write the acknowledgement, so the anchor logs were left in place.");
  }
  const current = await checkAnchorStores(repository, tenantId, list.map((s) => s.store));
  if (current.status !== "rewritten" && current.status !== "truncated") {
    return { ok: false, status: 409, error: "nothing_to_acknowledge", anchorStatus: current.status,
      message: current.status === "ok"
        ? "Nothing to acknowledge: every outside copy matches the database, so the anchor logs were left in place."
        : `Nothing to acknowledge: the outside copies read ${current.status}, not rewritten or truncated, so the anchor logs were left in place.` };
  }
  const targets = [];
  for (const [i, r] of current.stores.entries()) {
    if (r.status !== "rewritten" && r.status !== "truncated" && r.status !== "no-anchors") continue;
    let raw;
    try { raw = await list[i].store.get(anchorKey(tenantId)); }
    catch { return fail(502, "anchor_unreadable", `${list[i].name} could not be read, so the anchor logs were left in place.`); }
    const log = parseAnchorLog(raw);
    if (log === null || (r.status !== "no-anchors" && !log.length)) return fail(502, "anchor_unreadable", `${list[i].name} does not hold a readable anchor log, so the anchor logs were left in place rather than acknowledged blind.`);
    targets.push({ ...list[i], raw, log, seedOnly: r.status === "no-anchors" });
  }
  try {
    await repository.auditOnly(tenantId, { ts: k.nowIso, actor: k.by, connectorId: "wardsynq",
      action: ANCHOR_ACK_ACTION, scope: { previousStatus: current.status, previousAtSeq: current.atSeq != null ? current.atSeq : null, incidentRef: k.incidentRef },
      outcome: "ok", detail: `Anchor break acknowledged (was ${current.status} at chained row ${current.atSeq}): incident ${k.incidentRef}.` });
  } catch { return fail(502, "audit_failed", "The acknowledgement could not be written to the audit trail, so the anchor logs were left in place."); }
  let head;
  try { head = await repository.auditChainHead(tenantId); }
  catch { return fail(502, "head_unreadable", "The acknowledgement was chained but the audit chain head could not be read back, so the anchor logs were left in place."); }
  const seq = head ? num(head.seq != null ? head.seq : head.chainSeq) : null;
  const hash = head ? str(head.hash != null ? head.hash : head.rowHash) : "";
  if (seq == null || seq <= 0 || !hash) return fail(502, "head_unreadable", "The acknowledgement was chained but the audit chain head could not be read back, so the anchor logs were left in place.");
  const acknowledged = { by: k.by, reason: k.reason, incidentRef: k.incidentRef, previousStatus: current.status, previousAtSeq: current.atSeq != null ? current.atSeq : null };
  const archiveKey = anchorArchiveKey(tenantId, k.nowIso);
  const done = [], notSeeded = [];
  const already = () => (done.length ? `Already restarted: ${done.join(", ")}. ` : "");
  /* Broken stores first: they are the acknowledgement. Seeding an empty store is a convenience whose
   * failure is named but does not undo it; that store gets its copy on the next hourly anchor. */
  targets.sort((a, b) => Number(a.seedOnly) - Number(b.seedOnly));
  for (const t of targets) {
    if (t.seedOnly) {
      try { await t.store.put(anchorKey(tenantId), JSON.stringify([anchorEntry(seq, hash, k.nowIso, acknowledged)])); done.push(t.name); }
      catch { notSeeded.push(t.name); }
      continue;
    }
    try { await t.store.put(archiveKey, typeof t.raw === "string" ? t.raw : JSON.stringify(t.log)); }
    catch { return fail(502, "archive_failed", `${t.name}: the old anchor log could not be archived, so it was left in place. ${already()}Acknowledging again is safe.`, { archived: null, restarted: done }); }
    try { await t.store.put(anchorKey(tenantId), JSON.stringify([anchorEntry(seq, hash, k.nowIso, acknowledged)])); }
    catch { return fail(502, "replace_failed", `${t.name}: the fresh anchor log could not be written, so its old log is still in place. ${already()}Acknowledging again is safe: it archives again rather than deleting.`, { archived: archiveKey, restarted: done }); }
    done.push(t.name);
  }
  return { ok: true, status: "acknowledged", seq, hash, at: k.nowIso, by: k.by, incidentRef: k.incidentRef,
    previousStatus: current.status, previousAtSeq: current.atSeq != null ? current.atSeq : null, archived: archiveKey, restarted: done, notSeeded, anchors: 1,
    message: `Acknowledged: the anchor logs that reported ${current.status} at chained row ${current.atSeq} are archived, and fresh logs start at chained row ${seq} in ${done.join(" and ")}.` +
      (notSeeded.length ? ` ${notSeeded.join(" and ")} held no copy and could not be given one now; it gets one on the next hourly anchor.` : "") };
}

export { ANCHOR_RANK, anchorStoresOf, anchorDisagreement, checkAnchorStores, GENESIS_PREFIX, VERIFY_DEFAULT, VERIFY_MAX, APPEND_ATTEMPTS, ANCHOR_PREFIX, ANCHOR_MAX, ANCHOR_ACK_ACTION, retryPause, withChainLock, canonicalJson, genesisHash, chainHash, nextLinks, verifyAuditChain, auditRetentionSetting, anchorKey, anchorArchiveKey, anchorEntry, parseAnchorLog, appendAnchorEntry, anchorHead, checkAnchors, acknowledgeAnchorBreak };
