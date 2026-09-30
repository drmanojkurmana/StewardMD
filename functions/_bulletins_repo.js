/* StewardMD - Clinical Bulletins: D1 data access. Binding env.UPDATES_DB (same database as Medical Updates).
 *
 * Visibility at the bedside is DERIVED (visibleWhere below), never a flag that writes must remember to reset:
 * a bulletin shows only while it is signed, unedited since signing, its source is unchanged, its review is
 * not due, its source row still exists, and the kill switch is off. Every state change and its audit row go
 * in one D1 batch, and the audit insert is conditioned on the change having happened.
 */
import { newId } from "./_updates_repo.js";
import { CANDIDATE_TYPES, MONTH_MS, SECOND_READER_KINDS } from "./_bulletin_rules.js";

export function hasDb(env) { return !!(env && env.UPDATES_DB); }
function db(env) { return env.UPDATES_DB; }

// Second reader: a bulletin signed while the rule was on (second_required = 1) also needs a DIFFERENT signer to
// have confirmed this exact text. Switching the rule off releases them; switching it on applies from the next signing.
const SECOND_OFF = "COALESCE((SELECT value FROM bulletin_settings WHERE key = 'second_reader'), '1') = '0'";
const COSIGNED = "(b.cosigned_hash = b.body_hash AND b.cosigned_uid != '' AND b.cosigned_uid != b.signed_uid)";
const VISIBLE_WHERE =
  "b.status = 'signed' AND b.signed_hash = b.body_hash AND b.source_hash = u.content_hash AND b.review_due_ts > ? " +
  "AND (b.second_required = 0 OR " + COSIGNED + " OR " + SECOND_OFF + ")";
const AUDIT_ID = "'a' || lower(hex(randomblob(10)))";

function splitIds(s) { return s ? String(s).split("|").filter(Boolean).sort() : []; }
const DZ = "(SELECT group_concat(disease_id, '|') FROM bulletin_diseases d WHERE d.bulletin_id = b.id) AS dz";

/* ---------------- settings (kill switch) ---------------- */
export async function isEnabled(env) {
  const r = await db(env).prepare("SELECT value FROM bulletin_settings WHERE key = 'enabled'").first();
  return !r || r.value !== "0";
}
export async function setEnabled(env, on, uid, reason, now) {
  await db(env).batch([
    db(env).prepare("INSERT INTO bulletin_settings (key, value, updated_by, updated_ts) VALUES ('enabled', ?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_ts = excluded.updated_ts")
      .bind(on ? "1" : "0", uid, now),
    db(env).prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) VALUES (" + AUDIT_ID + ", '', ?, ?, ?, '', ?)")
      .bind(now, uid, on ? "kill_off" : "kill_on", String(reason || "").slice(0, 300)),
  ]);
}

// Second reader for approvals and safety alerts: on unless the owner switched it off.
export async function secondReaderOn(env) {
  const r = await db(env).prepare("SELECT value FROM bulletin_settings WHERE key = 'second_reader'").first();
  return !r || r.value !== "0";
}
export async function setSecondReader(env, on, uid, reason, now) {
  await db(env).batch([
    db(env).prepare("INSERT INTO bulletin_settings (key, value, updated_by, updated_ts) VALUES ('second_reader', ?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_ts = excluded.updated_ts")
      .bind(on ? "1" : "0", uid, now),
    db(env).prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) VALUES (" + AUDIT_ID + ", '', ?, ?, ?, '', ?)")
      .bind(now, uid, on ? "second_reader_on" : "second_reader_off", String(reason || "").slice(0, 300)),
  ]);
}

/* ---------------- public read ---------------- */
export async function listVisible(env, now, limit) {
  const rs = await db(env).prepare(
    "SELECT b.*, " + DZ + " FROM bulletins b JOIN updates u ON u.id = b.update_id WHERE " + VISIBLE_WHERE +
    " ORDER BY b.source_date DESC, b.id ASC LIMIT ?"
  ).bind(now, limit || 500).all();
  return (rs.results || []).map((r) => Object.assign(r, { disease_ids: splitIds(r.dz) }));
}

/* ---------------- single + queue ---------------- */
export async function getBulletin(env, id) {
  const r = await db(env).prepare(
    "SELECT b.*, " + DZ + ", u.content_hash AS u_hash, u.id AS u_id FROM bulletins b LEFT JOIN updates u ON u.id = b.update_id WHERE b.id = ?"
  ).bind(id).first();
  if (!r) return null;
  r.disease_ids = splitIds(r.dz);
  return r;
}

// Why a bulletin is or is not on the bedside right now. One of: live | draft | retracted | edited |
// source_changed | source_missing | awaiting_second | review_due. `secondOn`: the second-reader rule (default on).
export function isCosigned(r) { return !!(r.cosigned_hash && r.cosigned_hash === r.body_hash && r.cosigned_uid && r.cosigned_uid !== r.signed_uid); }
export function stateOf(r, now, secondOn) {
  if (r.status === "retracted") return "retracted";
  if (r.u_id == null) return "source_missing";
  if (r.status !== "signed") return r.source_hash !== r.u_hash ? "source_changed" : "draft";
  if (r.signed_hash !== r.body_hash) return "edited";
  if (r.source_hash !== r.u_hash) return "source_changed";
  if (Number(r.second_required) === 1 && secondOn !== false && !isCosigned(r)) return "awaiting_second";
  if (!(r.review_due_ts > now)) return "review_due";
  return "live";
}

export async function listForQueue(env) {
  const rs = await db(env).prepare(
    "SELECT b.*, " + DZ + ", u.content_hash AS u_hash, u.id AS u_id, u.title AS u_title, u.organization AS u_org, " +
    "u.official_url AS u_url, u.published_ts AS u_published_ts, u.summary AS u_summary, u.doi AS u_doi, u.pmid AS u_pmid, " +
    "u.branch AS u_branch, u.workspace AS u_workspace " +
    "FROM bulletins b LEFT JOIN updates u ON u.id = b.update_id WHERE b.status != 'retracted' ORDER BY b.updated_ts DESC LIMIT 300"
  ).all();
  return (rs.results || []).map((r) => Object.assign(r, { disease_ids: splitIds(r.dz) }));
}

// Recent updates of a bedside-relevant type that have no live or draft bulletin yet.
export async function listCandidates(env, sinceTs, limit) {
  const marks = CANDIDATE_TYPES.map(() => "?").join(",");
  const rs = await db(env).prepare(
    "SELECT u.id, u.type, u.title, u.organization, u.official_url, u.published_ts, u.summary, u.content_hash, u.doi, u.pmid, u.branch, u.workspace FROM updates u " +
    "WHERE u.published_ts > ? AND u.type IN (" + marks + ") " +
    "AND NOT EXISTS (SELECT 1 FROM bulletins b WHERE b.update_id = u.id AND b.status != 'retracted') " +
    "AND NOT EXISTS (SELECT 1 FROM bulletin_skips s WHERE s.update_id = u.id) " +
    // A head-crawled source stores its whole page as one item keyed by the page URL. Its title is the page's
    // ("EMA News and Updates"), its link the index, and its hash moves with every unrelated change on the page:
    // not something a doctor can sign against.
    "AND NOT EXISTS (SELECT 1 FROM sources src WHERE src.id = u.source_id AND u.doc_key IN (src.guideline_page, src.homepage)) " +
    "ORDER BY u.published_ts DESC LIMIT ?"
  ).bind(sinceTs, ...CANDIDATE_TYPES, limit || 50).all();
  return rs.results || [];
}

export async function getUpdateRow(env, updateId) {
  return await db(env).prepare("SELECT id, content_hash FROM updates WHERE id = ?").bind(updateId).first();
}

// Latest recorded source change for the re-review view (the pipeline's What's-Changed, when it has one).
export async function latestSourceChange(env, updateId) {
  return await db(env).prepare(
    "SELECT whats_changed_json, summary_json, created_ts FROM update_versions WHERE update_id = ? ORDER BY created_ts DESC LIMIT 1"
  ).bind(updateId).first();
}

/* ---------------- writes ---------------- */

/* Create or edit. An edit of a signed bulletin returns it to draft and clears the signature on the row (the
 * audit keeps it). `expectUpdatedTs` guards the edit against a concurrent write. Returns the id, or null
 * when the edit lost a race or the bulletin is retracted. */
export async function saveDraft(env, { id, value, sourceHash, bodyHash, uid, now, expectUpdatedTs }) {
  const D = db(env);
  const isNew = !id;
  const bid = id || newId("b");
  const stmts = [];
  if (isNew) {
    stmts.push(D.prepare(
      "INSERT INTO bulletins (id, update_id, source_hash, status, kind, headline, what_changed, applies_to, evidence_type, evidence_note, " +
      "regulator, india_status, source_label, source_url, source_date, doi, pmid, review_months, body_hash, created_uid, created_ts, updated_ts) " +
      "VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(bid, value.update_id, sourceHash, value.kind, value.headline, value.what_changed, value.applies_to, value.evidence_type,
      value.evidence_note, value.regulator, value.india_status, value.source_label, value.source_url, value.source_date,
      value.doi, value.pmid, value.review_months, bodyHash, uid, now, now));
  } else {
    stmts.push(D.prepare(
      "UPDATE bulletins SET update_id=?, source_hash=?, status='draft', kind=?, headline=?, what_changed=?, applies_to=?, evidence_type=?, " +
      "evidence_note=?, regulator=?, india_status=?, source_label=?, source_url=?, source_date=?, doi=?, pmid=?, review_months=?, body_hash=?, " +
      "signed_hash='', signed_uid='', signed_name='', signed_reg='', signed_council='', signed_ts=0, review_due_ts=0, updated_ts=? " +
      "WHERE id=? AND status != 'retracted' AND updated_ts=?"
    ).bind(value.update_id, sourceHash, value.kind, value.headline, value.what_changed, value.applies_to, value.evidence_type,
      value.evidence_note, value.regulator, value.india_status, value.source_label, value.source_url, value.source_date,
      value.doi, value.pmid, value.review_months, bodyHash, now, bid, expectUpdatedTs));
  }
  // Everything below applies only if the row now carries this exact write.
  const mine = "EXISTS (SELECT 1 FROM bulletins WHERE id = ? AND body_hash = ? AND updated_ts = ? AND status = 'draft')";
  stmts.push(D.prepare("DELETE FROM bulletin_diseases WHERE bulletin_id = ? AND " + mine).bind(bid, bid, bodyHash, now));
  for (const d of value.disease_ids) {
    stmts.push(D.prepare("INSERT INTO bulletin_diseases (bulletin_id, disease_id) SELECT ?, ? WHERE " + mine).bind(bid, d, bid, bodyHash, now));
  }
  stmts.push(D.prepare(
    "INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID + ", ?, ?, ?, ?, ?, ? WHERE " + mine
  ).bind(bid, now, uid, isNew ? "draft" : "edit", bodyHash, "", bid, bodyHash, now));
  await D.batch(stmts);
  const after = await D.prepare("SELECT body_hash, updated_ts FROM bulletins WHERE id = ?").bind(bid).first();
  return after && after.body_hash === bodyHash && after.updated_ts === now ? bid : null;
}

/* Sign exactly the previewed text, against the source as it is now, in one conditional statement.
 * `secondOn`: an approval or safety alert then also needs a second reader. `warnings`: the pre-sign checks the
 * signer was shown (codes), kept in the audit for the correction-rate numbers. */
export async function sign(env, { id, previewedHash, signer, now, secondOn, warnings }) {
  const D = db(env);
  const kinds = SECOND_READER_KINDS.map((k) => "'" + k + "'").join(",");
  const detail = (signer.name + ", Reg. No. " + signer.regNo + ((warnings || []).length ? " | warnings: " + warnings.join(",") : "")).slice(0, 300);
  await D.batch([
    D.prepare(
      "UPDATE bulletins SET status='signed', signed_hash=body_hash, signed_uid=?, signed_name=?, signed_reg=?, signed_council=?, " +
      "signed_ts=?, review_due_ts = ? + review_months * " + MONTH_MS + ", updated_ts = MAX(?, updated_ts + 1), " +
      "second_required = CASE WHEN ? = 1 AND kind IN (" + kinds + ") THEN 1 ELSE 0 END, " +
      "cosigned_hash='', cosigned_uid='', cosigned_name='', cosigned_reg='', cosigned_council='', cosigned_ts=0, " +
      "returned_note='', returned_uid='', returned_ts=0 " +
      "WHERE id=? AND status != 'retracted' AND body_hash=? " +
      "AND source_hash = (SELECT content_hash FROM updates WHERE updates.id = bulletins.update_id)"
    ).bind(signer.uid, signer.name, signer.regNo, signer.council, now, now, now, secondOn === false ? 0 : 1, id, previewedHash),
    D.prepare(
      "INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID +
      ", id, ?, ?, 'sign', body_hash, ? FROM bulletins WHERE id=? AND status='signed' AND signed_ts=? AND signed_uid=? AND body_hash=?"
    ).bind(now, signer.uid, detail, id, now, signer.uid, previewedHash),
  ]);
  const r = await getBulletin(env, id);
  if (!r) return { ok: false, code: "not-found" };
  if (r.status === "signed" && r.signed_ts === now && r.signed_uid === signer.uid && r.signed_hash === previewedHash) return { ok: true, row: r };
  if (r.status === "retracted") return { ok: false, code: "retracted" };
  if (r.body_hash !== previewedHash) return { ok: false, code: "changed" };
  if (r.u_id == null) return { ok: false, code: "source-missing" };
  if (r.source_hash !== r.u_hash) return { ok: false, code: "source-changed" };
  return { ok: false, code: "conflict" };
}

/* Second reader confirms the exact text the first signer signed. Must be a different signer. */
export async function cosign(env, { id, previewedHash, signer, now }) {
  const D = db(env);
  const before = await getBulletin(env, id);
  if (!before) return { ok: false, code: "not-found" };
  if (before.signed_uid === signer.uid) return { ok: false, code: "same-signer" };
  if (before.status !== "signed" || Number(before.second_required) !== 1) return { ok: false, code: "not-awaiting-second" };
  await D.batch([
    D.prepare(
      "UPDATE bulletins SET cosigned_hash=body_hash, cosigned_uid=?, cosigned_name=?, cosigned_reg=?, cosigned_council=?, cosigned_ts=?, " +
      "updated_ts = MAX(?, updated_ts + 1) WHERE id=? AND status='signed' AND second_required=1 AND signed_hash=body_hash AND body_hash=? " +
      "AND signed_uid != ? AND cosigned_hash != body_hash " +
      "AND source_hash = (SELECT content_hash FROM updates WHERE updates.id = bulletins.update_id)"
    ).bind(signer.uid, signer.name, signer.regNo, signer.council, now, now, id, previewedHash, signer.uid),
    D.prepare(
      "INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID +
      ", id, ?, ?, 'cosign', body_hash, ? FROM bulletins WHERE id=? AND cosigned_ts=? AND cosigned_uid=? AND cosigned_hash=?"
    ).bind(now, signer.uid, (signer.name + ", Reg. No. " + signer.regNo).slice(0, 300), id, now, signer.uid, previewedHash),
  ]);
  const r = await getBulletin(env, id);
  if (r && r.cosigned_ts === now && r.cosigned_uid === signer.uid && r.cosigned_hash === previewedHash) return { ok: true, row: r };
  if (r && r.body_hash !== previewedHash) return { ok: false, code: "changed" };
  if (r && r.u_id != null && r.source_hash !== r.u_hash) return { ok: false, code: "source-changed" };
  return { ok: false, code: "conflict" };
}

/* Second reader sends it back to the first signer with what to fix: back to draft, signature cleared. */
export async function sendBack(env, { id, note, uid, now }) {
  const D = db(env);
  const before = await getBulletin(env, id);
  if (!before) return { ok: false, code: "not-found" };
  if (before.signed_uid === uid) return { ok: false, code: "same-signer" };
  await D.batch([
    D.prepare(
      "UPDATE bulletins SET status='draft', signed_hash='', signed_uid='', signed_name='', signed_reg='', signed_council='', signed_ts=0, " +
      "review_due_ts=0, returned_note=?, returned_uid=?, returned_ts=?, updated_ts = MAX(?, updated_ts + 1) " +
      "WHERE id=? AND status='signed' AND second_required=1 AND cosigned_hash != body_hash AND signed_uid != ?"
    ).bind(note, uid, now, now, id, uid),
    D.prepare(
      "INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID +
      ", id, ?, ?, 'return', body_hash, ? FROM bulletins WHERE id=? AND returned_ts=? AND returned_uid=? AND status='draft'"
    ).bind(now, uid, note, id, now, uid),
  ]);
  const r = await getBulletin(env, id);
  return r && r.returned_ts === now && r.returned_uid === uid ? { ok: true, row: r } : { ok: false, code: "not-awaiting-second" };
}

export async function retract(env, { id, reason, uid, now }) {
  const D = db(env);
  const before = await D.prepare("SELECT status FROM bulletins WHERE id = ?").bind(id).first();
  if (!before) return { ok: false, code: "not-found" };
  if (before.status === "retracted") return { ok: false, code: "already-retracted" };
  await D.batch([
    D.prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID +
      ", id, ?, ?, 'retract', body_hash, ? FROM bulletins WHERE id = ? AND status != 'retracted'").bind(now, uid, reason, id),
    D.prepare("UPDATE bulletins SET status='retracted', retract_reason=?, updated_ts = MAX(?, updated_ts + 1) WHERE id=? AND status != 'retracted'").bind(reason, now, id),
  ]);
  return { ok: true };   // a concurrent second retract is a no-op in its own transaction (audit insert sees 'retracted')
}

// Called when a Medical Update is deleted: its bulletins can no longer show; say why in the queue and audit.
export async function retractForDeletedUpdate(env, updateId, now) {
  const D = db(env);
  await D.batch([
    D.prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID +
      ", id, ?, '', 'source_deleted', body_hash, 'source update deleted' FROM bulletins WHERE update_id = ? AND status != 'retracted'").bind(now, updateId),
    D.prepare("UPDATE bulletins SET status='retracted', retract_reason='source deleted', updated_ts = MAX(?, updated_ts + 1) WHERE update_id=? AND status != 'retracted'").bind(now, updateId),
  ]);
}

export async function listAudit(env, bulletinId, limit) {
  const rs = await db(env).prepare("SELECT ts, actor_uid, action, body_hash, detail FROM bulletin_audit WHERE bulletin_id = ? ORDER BY ts DESC LIMIT ?")
    .bind(bulletinId, limit || 50).all();
  return rs.results || [];
}

/* ---------------- skip (not for the disease page) ---------------- */
export async function setSkip(env, { updateId, uid, now, undo }) {
  const D = db(env);
  await D.batch([
    undo ? D.prepare("DELETE FROM bulletin_skips WHERE update_id = ?").bind(updateId)
      : D.prepare("INSERT OR IGNORE INTO bulletin_skips (update_id, uid, ts) VALUES (?,?,?)").bind(updateId, uid, now),
    D.prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) VALUES (" + AUDIT_ID + ", '', ?, ?, ?, '', ?)")
      .bind(now, uid, undo ? "unskip" : "skip", String(updateId).slice(0, 80)),
  ]);
}

/* ---------------- signers ---------------- */
export async function getSigner(env, uid) {
  return await db(env).prepare("SELECT * FROM bulletin_signers WHERE uid = ?").bind(uid).first();
}
export async function listSigners(env) {
  const rs = await db(env).prepare("SELECT * FROM bulletin_signers ORDER BY active DESC, added_ts DESC").all();
  return rs.results || [];
}
export async function upsertSigner(env, s, ownerUid, now) {
  const D = db(env);
  await D.batch([
    D.prepare("INSERT INTO bulletin_signers (uid, name, reg_no, council, active, added_by, added_ts, specialties) VALUES (?,?,?,?,1,?,?,?) " +
      "ON CONFLICT(uid) DO UPDATE SET name=excluded.name, reg_no=excluded.reg_no, council=excluded.council, active=1, added_by=excluded.added_by, " +
      "added_ts=excluded.added_ts, specialties=excluded.specialties")
      .bind(s.uid, s.name, s.reg_no, s.council, ownerUid, now, (s.specialties || []).join(",")),
    D.prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) VALUES (" + AUDIT_ID + ", '', ?, ?, 'signer_add', '', ?)")
      .bind(now, ownerUid, (s.uid + " " + s.name + ", Reg. No. " + s.reg_no + ", " + s.council).slice(0, 300)),
  ]);
}
export async function deactivateSigner(env, uid, ownerUid, now) {
  const D = db(env);
  await D.batch([
    D.prepare("INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID +
      ", '', ?, ?, 'signer_remove', '', uid FROM bulletin_signers WHERE uid = ? AND active = 1").bind(now, ownerUid, uid),
    D.prepare("UPDATE bulletin_signers SET active = 0 WHERE uid = ?").bind(uid),
  ]);
}

/* ---------------- numbers: are we getting better? ----------------
 * All from D1 and the append-only audit, over a window (default 90 days):
 *  - days from the source's publication to the disease page (first signature, or the second reader's when needed)
 *  - coverage: source items of a bedside type published in the window, by source: live, signed once, skipped, waiting
 *  - correction rate: bulletins first signed in the window that were later edited, sent back or retracted
 *    (a source deletion is not a correction)
 *  - backlog: items waiting, the oldest wait, drafts, second reads waiting
 *  - per signer: signatures and second reads; signatures made with pre-sign warnings showing */
const DAY_MS = 86400000;
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export async function metrics(env, now, windowDays) {
  const D = db(env), days = windowDays || 90, since = now - days * DAY_MS;
  const audit = (await D.prepare("SELECT bulletin_id, ts, actor_uid, action, detail FROM bulletin_audit WHERE bulletin_id != '' AND ts >= ? ORDER BY ts ASC")
    .bind(since).all()).results || [];
  const firstSign = new Map(), firstCosign = new Map(), corrected = new Set(), warned = new Set();
  const bySigner = new Map();
  const bump = (uid, k) => { const o = bySigner.get(uid) || { signs: 0, cosigns: 0, returns: 0 }; o[k]++; bySigner.set(uid, o); };
  for (const a of audit) {
    if (a.action === "sign") {
      bump(a.actor_uid, "signs");
      if (!firstSign.has(a.bulletin_id)) firstSign.set(a.bulletin_id, a.ts);
      if (/\| warnings: /.test(a.detail || "")) warned.add(a.bulletin_id);
    } else if (a.action === "cosign") {
      bump(a.actor_uid, "cosigns");
      if (!firstCosign.has(a.bulletin_id)) firstCosign.set(a.bulletin_id, a.ts);
    } else if (a.action === "return") {
      bump(a.actor_uid, "returns");
      if (firstSign.has(a.bulletin_id)) corrected.add(a.bulletin_id);
    } else if ((a.action === "edit" || a.action === "retract") && firstSign.has(a.bulletin_id) && a.ts > firstSign.get(a.bulletin_id)) {
      corrected.add(a.bulletin_id);
    }
  }
  const ids = Array.from(firstSign.keys());
  const rows = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rs = (await D.prepare("SELECT b.id, b.kind, b.second_required, u.published_ts FROM bulletins b LEFT JOIN updates u ON u.id = b.update_id WHERE b.id IN (" +
      chunk.map(() => "?").join(",") + ")").bind(...chunk).all()).results || [];
    for (const r of rs) rows.set(r.id, r);
  }
  const lag = [];
  for (const id of ids) {
    const r = rows.get(id);
    if (!r || !r.published_ts) continue;
    const onPage = Number(r.second_required) === 1 ? firstCosign.get(id) : firstSign.get(id);
    if (onPage) lag.push((onPage - r.published_ts) / DAY_MS);
  }
  lag.sort((a, b) => a - b);

  const marks = CANDIDATE_TYPES.map(() => "?").join(",");
  const cov = (await D.prepare(
    "SELECT COALESCE(s.name, u.organization, u.source_id) AS source, u.source_id, " +
    "COUNT(*) AS total, " +
    "SUM(CASE WHEN EXISTS (SELECT 1 FROM bulletins b WHERE b.update_id = u.id AND b.status = 'signed' AND b.signed_hash = b.body_hash) THEN 1 ELSE 0 END) AS signed, " +
    "SUM(CASE WHEN EXISTS (SELECT 1 FROM bulletin_skips k WHERE k.update_id = u.id) THEN 1 ELSE 0 END) AS skipped, " +
    "SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM bulletins b WHERE b.update_id = u.id AND b.status != 'retracted') " +
    "AND NOT EXISTS (SELECT 1 FROM bulletin_skips k WHERE k.update_id = u.id) THEN 1 ELSE 0 END) AS waiting, " +
    "MIN(CASE WHEN NOT EXISTS (SELECT 1 FROM bulletins b WHERE b.update_id = u.id AND b.status != 'retracted') " +
    "AND NOT EXISTS (SELECT 1 FROM bulletin_skips k WHERE k.update_id = u.id) THEN u.published_ts END) AS oldest_waiting " +
    "FROM updates u LEFT JOIN sources s ON s.id = u.source_id " +
    "WHERE u.published_ts > ? AND u.type IN (" + marks + ") " +
    "AND NOT EXISTS (SELECT 1 FROM sources src WHERE src.id = u.source_id AND u.doc_key IN (src.guideline_page, src.homepage)) " +
    "GROUP BY u.source_id ORDER BY total DESC"
  ).bind(since, ...CANDIDATE_TYPES).all()).results || [];
  const tot = cov.reduce((a, r) => ({ total: a.total + r.total, signed: a.signed + r.signed, skipped: a.skipped + r.skipped, waiting: a.waiting + r.waiting,
    oldest: r.oldest_waiting && (!a.oldest || r.oldest_waiting < a.oldest) ? r.oldest_waiting : a.oldest }), { total: 0, signed: 0, skipped: 0, waiting: 0, oldest: 0 });

  const drafts = (await D.prepare("SELECT COUNT(*) AS n FROM bulletins WHERE status = 'draft'").first()).n;
  const second = (await D.prepare("SELECT COUNT(*) AS n FROM bulletins b WHERE b.status = 'signed' AND b.second_required = 1 AND b.signed_hash = b.body_hash AND NOT " + COSIGNED).first()).n;
  const signers = (await listSigners(env)).filter((s) => s.active === 1).map((s) => Object.assign({ uid: s.uid, name: s.name }, bySigner.get(s.uid) || { signs: 0, cosigns: 0, returns: 0 }));
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  return {
    window_days: days,
    signed: ids.length,
    days_to_page: { median: r1(quantile(lag, 0.5)), p90: r1(quantile(lag, 0.9)), n: lag.length },
    correction: { corrected: corrected.size, of: ids.length, rate: ids.length ? Math.round((corrected.size / ids.length) * 1000) / 10 : null },
    signed_with_warnings: warned.size,
    coverage: { total: tot.total, signed: tot.signed, skipped: tot.skipped, waiting: tot.waiting,
      by_source: cov.slice(0, 12).map((r) => ({ source: r.source || "", total: r.total, signed: r.signed, skipped: r.skipped, waiting: r.waiting })) },
    backlog: { waiting: tot.waiting, oldest_days: tot.oldest ? Math.floor((now - tot.oldest) / DAY_MS) : null, drafts, second_reads: second },
    signers,
  };
}
