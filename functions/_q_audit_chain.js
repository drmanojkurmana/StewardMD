/* functions/_q_audit_chain.js - G3: the hospital event log (q_events: sign-ins, staff and hospital
 * setting changes, queue, billing and group acts) chained the way the clinical audit trail is
 * (functions/_wardsynq/audit-chain.js), so a row changed or removed in Firestore itself shows.
 *
 * ONE COMMIT PER ROW. Each row is written as q_events/<hospital key>__c<seq> together with the head
 * doc q_audit_chain_head/<hospital key> = {seq, hash}, in ONE fsCommit. The row create carries
 * currentDocument.exists=false, so two writers that read the same head cannot both take the same
 * number: the loser's whole commit is refused, it re-reads the head and retries. That is the same
 * guard as the clinical chain's primary key. The row stores its own link: chainSeq (hashed with the
 * row), prevHash and rowHash, where rowHash = SHA-256(prevHash || canonical JSON of the row as stored,
 * without prevHash and rowHash).
 *
 * A CALLER'S OWN WRITES RIDE IN THE SAME COMMIT (appendOrgAudit extraWrites), so a hospital-group
 * membership change without its audit row still cannot exist. A refused commit whose head did NOT
 * move was refused by the caller's own guard, and that refusal is handed back unchanged.
 *
 * ROWS WITHOUT A LINK. Rows written before this existed have no rowHash and are named as unlinked,
 * never verified. The first linked row carries legacyBoundary (its own ts), so an unlinked row newer
 * than that is a row written since linking began without a link: a lost race after every retry
 * (qAudit is best-effort and still writes the row rather than lose it) or a row added outside the
 * application. The security review names both kinds.
 *
 * orgAuditChain() is the verification adapter: the same {auditChainHead, auditChainRows, auditOnly}
 * shape as the record repositories, so verifyAuditChain, the anchors and the owner acknowledgement in
 * audit-chain.js run over it unchanged. No PHI here: the event log is PHI-free by construction.
 */
import * as FS from "./_fbfirestore.js";
import { chainHash, genesisHash, withChainLock, retryPause, APPEND_ATTEMPTS } from "./_wardsynq/audit-chain.js";

const EVENTS = "q_events";
const HEADS = "q_audit_chain_head";
/* Anchors and verification name a chain by id. Clinical chains use the Connect tenant id; this prefix
 * keeps a hospital's event-log chain from ever sharing an anchor key with one. */
const CHAIN_PREFIX = "q:";
const READ_CHUNK = 100;
const LOCK_OWNER = {};
const LINK_FIELDS = ["prevHash", "rowHash"];

const newId = () => crypto.randomUUID().replace(/-/g, "");

/** PURE. A document-id-safe key per hospital id, injective: every character outside [A-Za-z0-9-] is
 * escaped to "_" + four hex digits, so "group:a" and "group-a" never share a chain. */
function chainKey(hospitalId) {
  const s = String(hospitalId == null ? "" : hospitalId);
  return s ? s.replace(/[^A-Za-z0-9-]/g, (ch) => "_" + ch.charCodeAt(0).toString(16).padStart(4, "0")) : "_none";
}
const rowPath = (key, seq) => `${EVENTS}/${key}__c${seq}`;
const headPath = (key) => `${HEADS}/${key}`;

/** PURE. The fixed PHI-free field allow-list every event-log row has always had. */
function eventFields(ev) {
  const e = ev || {};
  return { ts: Number.isInteger(e.ts) ? e.ts : Date.now(), hospitalId: String(e.hospitalId || ""), ticketId: String(e.ticketId || ""),
    actor: String(e.actor || ""), action: String(e.action || ""), meta: String(e.meta == null ? "" : e.meta).slice(0, 200) };
}

/** PURE. The row as hashed: the stored fields without the two link fields. */
function hashedRow(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) if (!LINK_FIELDS.includes(k)) out[k] = fields[k];
  return out;
}

async function readHead(env, key) {
  const d = await FS.fsGet(env, headPath(key));
  if (!d) return null;
  const seq = Number(d.fields && d.fields.seq), hash = d.fields && d.fields.hash;
  if (!Number.isInteger(seq) || seq <= 0 || typeof hash !== "string" || !hash) throw new Error("the event log chain head could not be read");
  return { seq, hash };
}

/**
 * Writes one event-log row linked to the one before it, plus any `extraWrites`, in ONE commit.
 * Returns {id, seq, hash}. Throws the commit's own error when it failed for any other reason than a
 * lost race, a precondition error when the caller's guard refused it, and code "contention" when every
 * attempt lost a race. Nothing is written by a throw.
 */
async function appendOrgAudit(env, ev, extraWrites) {
  const f = eventFields(ev);
  const key = chainKey(f.hospitalId);
  /* ponytail: one chain per hospital serialises that hospital's event-log writes (a head read plus a
   * commit each); a sharded chain is the upgrade if a hospital's log contends past one head doc. */
  return withChainLock(LOCK_OWNER, key, async () => {
    let head = await readHead(env, key);
    for (let attempt = 1; attempt <= APPEND_ATTEMPTS; attempt++) {
      const seq = head ? head.seq + 1 : 1;
      const row = { ...f, chainSeq: seq, ...(seq === 1 ? { legacyBoundary: String(f.ts) } : {}) };
      const prevHash = head ? head.hash : genesisHash(row.legacyBoundary);
      const rowHash = await chainHash(prevHash, row);
      const id = `${key}__c${seq}`;
      try {
        await FS.fsCommit(env, [...(extraWrites || []),
          FS.wCreate(env, rowPath(key, seq), { ...row, prevHash, rowHash }),
          FS.wUpdate(env, headPath(key), { seq, hash: rowHash, updatedAt: Date.now() })]);
        return { id, seq, hash: rowHash };
      } catch (e) {
        if (!(e && e.code === "precondition")) throw e;
        const now = await readHead(env, key);
        if ((now ? now.seq : 0) === (head ? head.seq : 0)) throw e;   // not a race: the caller's guard, or a head that no longer names the newest row
        head = now;
        await retryPause(attempt);
      }
    }
    throw Object.assign(new Error("event_log_chain_contention"), { code: "contention" });
  });
}

/**
 * Best-effort event-log write (qAudit's contract: never blocks the action). Linked when it can be.
 * When linking loses every race, or the head no longer names the newest row, the row is still written
 * UNLINKED under a random id rather than lost, and the security review names it. Returns
 * {linked: true, seq} | {linked: false} | {written: false}; never throws.
 */
async function writeOrgAudit(env, ev) {
  try {
    const r = await appendOrgAudit(env, ev);
    return { linked: true, seq: r.seq };
  } catch (e) {
    if (!(e && (e.code === "precondition" || e.code === "contention"))) return { written: false };
    try { await FS.fsCommit(env, [FS.wCreate(env, `${EVENTS}/${newId()}`, eventFields(ev))]); return { linked: false }; }
    catch { return { written: false }; }
  }
}

async function readMany(env, paths) {
  if (typeof FS.fsBatchGet === "function") {
    const out = new Map();
    for (let i = 0; i < paths.length; i += READ_CHUNK) for (const [p, d] of await FS.fsBatchGet(env, paths.slice(i, i + READ_CHUNK))) out.set(p, d);
    return out;
  }
  return new Map(await Promise.all(paths.map(async (p) => [p, await FS.fsGet(env, p)])));
}

/** The verification adapter for one hospital's event log (see the header). */
function orgAuditChain(env, hospitalId) {
  const key = chainKey(hospitalId);
  return {
    chainId: CHAIN_PREFIX + String(hospitalId || ""),
    auditChainHead: () => readHead(env, key),
    async auditChainRows(_chainId, fromSeq, toSeq) {
      const seqs = [];
      for (let s = Math.max(1, Number(fromSeq)); s <= Number(toSeq); s++) seqs.push(s);
      const docs = await readMany(env, seqs.map((s) => rowPath(key, s)));
      const out = [];
      for (const s of seqs) {
        const d = docs.get(rowPath(key, s));
        if (!d || !d.fields) continue;
        out.push({ chainSeq: s, auditId: d.id || `${key}__c${s}`, prevHash: d.fields.prevHash, rowHash: d.fields.rowHash,
          legacyBoundary: d.fields.legacyBoundary == null ? null : d.fields.legacyBoundary, row: hashedRow(d.fields) });
      }
      return out;
    },
    /** The acknowledgement of an anchor break, chained like any other row. Throws when it did not land. */
    async auditOnly(_chainId, e) {
      await appendOrgAudit(env, { hospitalId, actor: e && e.actor, action: e && e.action, meta: (e && e.detail) || "" });
    },
    /** When linking began (ms), from the first linked row; null before any, throws on a failed read. */
    async chainStart() {
      const d = await FS.fsGet(env, rowPath(key, 1));
      const ms = d && d.fields ? Number(d.fields.legacyBoundary) : NaN;
      return Number.isFinite(ms) ? ms : null;
    },
  };
}

export { EVENTS, HEADS, CHAIN_PREFIX, chainKey, eventFields, hashedRow, appendOrgAudit, writeOrgAudit, orgAuditChain };
