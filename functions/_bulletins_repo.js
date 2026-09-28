/* StewardMD - Clinical Bulletins: D1 data access. Binding env.UPDATES_DB (same database as Medical Updates).
 *
 * Visibility at the bedside is DERIVED (visibleWhere below), never a flag that writes must remember to reset:
 * a bulletin shows only while it is signed, unedited since signing, its source is unchanged, its review is
 * not due, its source row still exists, and the kill switch is off. Every state change and its audit row go
 * in one D1 batch, and the audit insert is conditioned on the change having happened.
 */
import { newId } from "./_updates_repo.js";
import { CANDIDATE_TYPES, MONTH_MS } from "./_bulletin_rules.js";

export function hasDb(env) { return !!(env && env.UPDATES_DB); }
function db(env) { return env.UPDATES_DB; }

const VISIBLE_WHERE =
  "b.status = 'signed' AND b.signed_hash = b.body_hash AND b.source_hash = u.content_hash AND b.review_due_ts > ?";
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
// source_changed | source_missing | review_due
export function stateOf(r, now) {
  if (r.status === "retracted") return "retracted";
  if (r.u_id == null) return "source_missing";
  if (r.status !== "signed") return r.source_hash !== r.u_hash ? "source_changed" : "draft";
  if (r.signed_hash !== r.body_hash) return "edited";
  if (r.source_hash !== r.u_hash) return "source_changed";
  if (!(r.review_due_ts > now)) return "review_due";
  return "live";
}

export async function listForQueue(env) {
  const rs = await db(env).prepare(
    "SELECT b.*, " + DZ + ", u.content_hash AS u_hash, u.id AS u_id, u.title AS u_title, u.organization AS u_org, " +
    "u.official_url AS u_url, u.published_ts AS u_published_ts, u.summary AS u_summary " +
    "FROM bulletins b LEFT JOIN updates u ON u.id = b.update_id WHERE b.status != 'retracted' ORDER BY b.updated_ts DESC LIMIT 300"
  ).all();
  return (rs.results || []).map((r) => Object.assign(r, { disease_ids: splitIds(r.dz) }));
}

// Recent updates of a bedside-relevant type that have no live or draft bulletin yet.
export async function listCandidates(env, sinceTs, limit) {
  const marks = CANDIDATE_TYPES.map(() => "?").join(",");
  const rs = await db(env).prepare(
    "SELECT u.id, u.type, u.title, u.organization, u.official_url, u.published_ts, u.summary, u.content_hash, u.doi, u.pmid FROM updates u " +
    "WHERE u.published_ts > ? AND u.type IN (" + marks + ") " +
    "AND NOT EXISTS (SELECT 1 FROM bulletins b WHERE b.update_id = u.id AND b.status != 'retracted') " +
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

/* Sign exactly the previewed text, against the source as it is now, in one conditional statement. */
export async function sign(env, { id, previewedHash, signer, now }) {
  const D = db(env);
  await D.batch([
    D.prepare(
      "UPDATE bulletins SET status='signed', signed_hash=body_hash, signed_uid=?, signed_name=?, signed_reg=?, signed_council=?, " +
      "signed_ts=?, review_due_ts = ? + review_months * " + MONTH_MS + ", updated_ts = MAX(?, updated_ts + 1) " +
      "WHERE id=? AND status != 'retracted' AND body_hash=? " +
      "AND source_hash = (SELECT content_hash FROM updates WHERE updates.id = bulletins.update_id)"
    ).bind(signer.uid, signer.name, signer.regNo, signer.council, now, now, now, id, previewedHash),
    D.prepare(
      "INSERT INTO bulletin_audit (id, bulletin_id, ts, actor_uid, action, body_hash, detail) SELECT " + AUDIT_ID +
      ", id, ?, ?, 'sign', body_hash, ? FROM bulletins WHERE id=? AND status='signed' AND signed_ts=? AND signed_uid=? AND body_hash=?"
    ).bind(now, signer.uid, (signer.name + ", Reg. No. " + signer.regNo).slice(0, 300), id, now, signer.uid, previewedHash),
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
    D.prepare("INSERT INTO bulletin_signers (uid, name, reg_no, council, active, added_by, added_ts) VALUES (?,?,?,?,1,?,?) " +
      "ON CONFLICT(uid) DO UPDATE SET name=excluded.name, reg_no=excluded.reg_no, council=excluded.council, active=1, added_by=excluded.added_by, added_ts=excluded.added_ts")
      .bind(s.uid, s.name, s.reg_no, s.council, ownerUid, now),
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
