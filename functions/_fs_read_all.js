/* functions/_fs_read_all.js - read EVERY Firestore row matching equality filters, in pages ordered by document name.
 * Moved here from _clinic_billing_store.js (R3-1) so the org, queue and accounts stores share it without importing
 * billing (which imports the queue engine). A single query used to be read as the whole answer, so past its limit
 * rows vanished silently. maxRows is the hard bound: past it the answer carries truncated:true, and readAllOrThrow
 * refuses instead of handing back part of a list. */
import { fsQuery } from "./_fbfirestore.js";

export const PAGE_SIZE = 500;
export async function readAll(env, collectionId, where, maxRows) {
  const rows = [];
  let after = null;
  for (;;) {
    const page = (await fsQuery(env, collectionId, { where, limit: PAGE_SIZE, orderByName: true, ...(after ? { startAfter: after } : {}) })) || [];
    rows.push(...page);
    if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
    after = page[page.length - 1].name;
  }
}
/* The whole list or an error (507, `code`): for lists a partial answer would misrepresent (a bed board, a queue). */
export async function readAllOrThrow(env, collectionId, where, maxRows, code) {
  const { rows, truncated } = await readAll(env, collectionId, where, maxRows);
  if (truncated) throw Object.assign(new Error(code), { status: 507, detail: `More than ${maxRows} rows.` });
  return rows;
}
