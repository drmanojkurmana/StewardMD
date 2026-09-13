/* functions/_forms_store.js — the hospital's form definitions (hospital configuration, not clinical data).
 * One editable draft per form key; publishing creates a new immutable version (create-only write), so a
 * saved response always points at a definition that can never change underneath it. Every change audited. */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import * as F from "../wardsynq/wardsynq-forms.js";

const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const audit = (env, orgId, actor, action, meta) => qAudit(env, { hospitalId: orgId, ticketId: "", actor: actor || "", action, meta: String(meta || "").slice(0, 200) });
const rowsOf = async (env, orgId) => (await fsQuery(env, "q_form_defs", { where: { field: "orgId", value: String(orgId) }, limit: 1000 })).map((x) => ({ ...x.fields, def: JSON.parse(x.fields.def || "{}") }));

export async function saveDraft(env, orgId, def, actorId) {
  if (!def || !/^[a-z][a-z0-9_]{0,59}$/.test(String(def.key || ""))) return { ok: false, error: "bad_key", message: "A form key is lower-case letters, digits and underscores." };
  const problems = F.validateDefinition(def);
  await fsCommit(env, [wUpdate(env, `q_form_defs/${sanitize(orgId)}__${def.key}__draft`, { orgId: String(orgId), key: def.key, version: 0, status: "draft", def: JSON.stringify({ ...def, status: "draft" }), updatedAt: Date.now(), updatedBy: actorId })]);
  await audit(env, orgId, actorId, "forms:draft_saved", `${def.key} problems=${problems.length}`);
  // A draft with problems is kept (so work is not lost) and every problem is returned; it cannot be published.
  return { ok: true, key: def.key, problems };
}

export async function publishForm(env, orgId, key, actorId) {
  const d = await fsGet(env, `q_form_defs/${sanitize(orgId)}__${sanitize(key)}__draft`);
  if (!d) return { ok: false, error: "no_draft", message: "There is no draft of this form to publish." };
  const draft = JSON.parse(d.fields.def || "{}");
  const versions = (await rowsOf(env, orgId)).filter((r) => r.key === key && r.status === "published").map((r) => r.version);
  const version = (versions.length ? Math.max(...versions) : 0) + 1;
  let pub;
  try { pub = F.publish(draft, version, new Date().toISOString()); } catch (e) { return { ok: false, error: e.code, message: e.message, problems: e.problems }; }
  try { await fsCommit(env, [wCreate(env, `q_form_defs/${sanitize(orgId)}__${key}__v${version}`, { orgId: String(orgId), key, version, status: "published", def: JSON.stringify(pub), publishedAt: Date.now(), publishedBy: actorId })]); }
  catch (e) { return { ok: false, error: "version_taken", message: "Someone published this form at the same moment; reload and try again." }; }
  await audit(env, orgId, actorId, "forms:published", `${key} v${version}`);
  return { ok: true, key, version };
}

/** Drafts and the latest published version of every form. */
export async function listDefinitions(env, orgId) {
  const rows = await rowsOf(env, orgId);
  const latest = {};
  for (const r of rows) if (r.status === "published" && (!latest[r.key] || r.version > latest[r.key].version)) latest[r.key] = r;
  return { ok: true, drafts: rows.filter((r) => r.status === "draft").map((r) => ({ key: r.key, def: r.def, problems: F.validateDefinition(r.def) })), published: Object.values(latest).map((r) => r.def) };
}

/** One exact published version (what a response is checked against). */
export async function publishedVersion(env, orgId, key, version) {
  const d = await fsGet(env, `q_form_defs/${sanitize(orgId)}__${sanitize(key)}__v${Number(version)}`);
  return d ? JSON.parse(d.fields.def || "{}") : null;
}
