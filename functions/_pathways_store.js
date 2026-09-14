/* functions/_pathways_store.js - the hospital's clinical pathway definitions (hospital configuration).
 * The forms pattern (_forms_store.js): one editable draft per key; publishing creates an immutable
 * version with a create-only write; retiring a version is a separate create-only marker, so the
 * published definition itself is never rewritten. Every change audited. */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import { validatePathway, publishPathway, summary } from "./_wardsynq/pathways.js";

const COL = "q_pathway_defs";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const audit = (env, orgId, actor, action, meta) => qAudit(env, { hospitalId: orgId, ticketId: "", actor: actor || "", action, meta: String(meta || "").slice(0, 200) });
const rowsOf = async (env, orgId) => (await fsQuery(env, COL, { where: { field: "orgId", value: String(orgId) }, limit: 1000 })).map((x) => ({ ...x.fields, def: JSON.parse(x.fields.def || "{}") }));

export async function saveDraft(env, orgId, def, actorId) {
  if (!def || !/^[a-z][a-z0-9_]{0,59}$/.test(String(def.key || ""))) return { ok: false, error: "bad_key", message: "A pathway key is lower-case letters, digits and underscores." };
  const clean = { ...def }; delete clean.status; delete clean.version; delete clean.author; delete clean.publishedAt;
  const problems = validatePathway(clean);
  await fsCommit(env, [wUpdate(env, `${COL}/${sanitize(orgId)}__${def.key}__draft`, { orgId: String(orgId), key: def.key, version: 0, status: "draft", def: JSON.stringify({ ...clean, status: "draft" }), updatedAt: Date.now(), updatedBy: actorId })]);
  await audit(env, orgId, actorId, "pathways:draft_saved", `${def.key} problems=${problems.length}`);
  return { ok: true, key: def.key, problems };
}

export async function publish(env, orgId, key, actorId) {
  const d = await fsGet(env, `${COL}/${sanitize(orgId)}__${sanitize(key)}__draft`);
  if (!d) return { ok: false, error: "no_draft", message: "There is no draft of this pathway to publish." };
  const draft = JSON.parse(d.fields.def || "{}");
  const versions = (await rowsOf(env, orgId)).filter((r) => r.key === key && r.status === "published").map((r) => r.version);
  const version = (versions.length ? Math.max(...versions) : 0) + 1;
  let pub;
  try { pub = publishPathway(draft, version, new Date().toISOString(), actorId); } catch (e) { return { ok: false, error: e.code, message: e.message, problems: e.problems }; }
  try { await fsCommit(env, [wCreate(env, `${COL}/${sanitize(orgId)}__${key}__v${version}`, { orgId: String(orgId), key, version, status: "published", def: JSON.stringify(pub), publishedAt: Date.now(), publishedBy: actorId })]); }
  catch (e) { return { ok: false, error: "version_taken", message: "Someone published this pathway at the same moment; reload and try again." }; }
  await audit(env, orgId, actorId, "pathways:published", `${key} v${version}`);
  return { ok: true, key, version };
}

export async function retire(env, orgId, key, version, reason, actorId) {
  const v = Number(version);
  if (!(await fsGet(env, `${COL}/${sanitize(orgId)}__${sanitize(key)}__v${v}`))) return { ok: false, error: "not_found", message: "No published pathway with that key and version." };
  if (String(reason || "").trim().length < 5) return { ok: false, error: "reason_required", message: "Say why this version is being retired." };
  try { await fsCommit(env, [wCreate(env, `${COL}/${sanitize(orgId)}__${sanitize(key)}__v${v}__retired`, { orgId: String(orgId), key: String(key), version: v, status: "retired", def: "{}", reason: String(reason).trim().slice(0, 500), retiredAt: Date.now(), retiredBy: actorId })]); }
  catch (e) { return { ok: false, error: "already_retired", message: "That version is already retired." }; }
  await audit(env, orgId, actorId, "pathways:retired", `${key} v${v}`);
  return { ok: true, key, version: v };
}

/** Every published version with its retired flag, and (for the admin) the drafts. */
export async function listAll(env, orgId, nowMs) {
  const rows = await rowsOf(env, orgId);
  const retired = new Set(rows.filter((r) => r.status === "retired").map((r) => `${r.key}@${r.version}`));
  const published = rows.filter((r) => r.status === "published").sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version)
    .map((r) => summary(r.def, nowMs, retired.has(`${r.key}@${r.version}`)));
  return { ok: true, retired, published, drafts: rows.filter((r) => r.status === "draft").map((r) => ({ key: r.key, def: r.def, problems: validatePathway(r.def) })) };
}

/** One exact published version (what an enrolment is made against). */
export async function publishedVersion(env, orgId, key, version) {
  const d = await fsGet(env, `${COL}/${sanitize(orgId)}__${sanitize(key)}__v${Number(version)}`);
  return d ? JSON.parse(d.fields.def || "{}") : null;
}
