/* functions/_seed_signoff_store.js - D10 clinical seed data sign-off records (Firestore I/O).
 *
 * q_seed_signoffs/<list>__<item>__<fingerprint prefix>, created once and never rewritten: a record for
 * content that later changed simply stops matching (see _wardsynq/seed-signoff.js). The record and its
 * audit row (q_events, hospitalId "platform") go in ONE commit, so a sign-off without its audit row cannot
 * exist, and a second sign-off of the same content fails the create precondition.
 */
import { fsQuery, fsCommit, wCreate } from "./_fbfirestore.js";

export async function listSignoffs(env) {
  return (await fsQuery(env, "q_seed_signoffs", { limit: 2000 })).map((r) => Object.assign({ id: r.id }, r.fields));
}
/** Throws { code: "precondition" } when this exact content is already signed. */
export async function createSignoff(env, id, rec, actorId) {
  await fsCommit(env, [
    wCreate(env, "q_seed_signoffs/" + id, rec),
    wCreate(env, "q_events/" + crypto.randomUUID().replace(/-/g, ""), { ts: Date.now(), hospitalId: "platform", ticketId: "", actor: String(actorId || ""),
      action: "seed:signoff", meta: JSON.stringify({ list: rec.listId, item: rec.itemId, version: rec.version }).slice(0, 200) }),
  ]);
}
