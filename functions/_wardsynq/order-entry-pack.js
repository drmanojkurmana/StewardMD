/* functions/_wardsynq/order-entry-pack.js - order entry's rule pack: rulepack.js getRulePack() plus the National Formulary of
 * India tables the owner has SIGNED OFF (owner decision 2026-10-04; seed-signoff.js list "nfi-tables").
 *
 * An unsigned table adds nothing and is described on the pack (clinicalTables), so the order check says "NFI table loaded,
 * awaiting clinical sign-off" instead of reading as checked (migrate-emar.js coverageFindings). The sign-off records are read
 * at most once a minute per isolate: a new sign-off takes effect within a minute, and a table's content only changes with a
 * deploy, which is a new isolate. Records that cannot be read are not cached, and while they cannot be read no table is
 * applied: a sign-off that cannot be confirmed is not assumed.
 *
 * A separate file from rulepack.js so the tests that substitute the compiled pack keep doing so unchanged.
 */
import { getRulePack } from "./rulepack.js";
import { withNfiTables } from "../../wardsynq/adapters/nfi-rules.js";
import { nfiSignoffState } from "./seed-signoff.js";
import { listSignoffs } from "../_seed_signoff_store.js";

const SIGNOFF_TTL_MS = 60 * 1000;
let _signoffs = null;            // { at, records }
let _byState = new WeakMap();    // base pack -> Map("<table states>" -> derived pack)

/** @param {object} env the Worker env (sign-off records are read from it) @param {{listSignoffs?: Function}} [deps] tests */
async function orderEntryRulePack(env, deps) {
  const base = getRulePack();
  if (!base) return base;
  let records = null;
  const now = Date.now();
  if (_signoffs && now - _signoffs.at < SIGNOFF_TTL_MS) records = _signoffs.records;
  else {
    try { records = await ((deps && deps.listSignoffs) || listSignoffs)(env); _signoffs = { at: now, records }; }
    catch (e) { records = null; }
  }
  const state = await nfiSignoffState(records);
  const key = Object.keys(state).sort().map((k) => k + ":" + state[k]).join("|");
  if (!_byState.has(base)) _byState.set(base, new Map());
  const cache = _byState.get(base);
  if (!cache.has(key)) cache.set(key, withNfiTables(base, state));
  return cache.get(key);
}
/** Tests only: forget the cached sign-off records and derived packs. */
function resetOrderEntryRulePack() { _signoffs = null; _byState = new WeakMap(); }

export { orderEntryRulePack, resetOrderEntryRulePack };
