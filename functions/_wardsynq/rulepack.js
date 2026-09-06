/* functions/_wardsynq/rulepack.js — loads the real StewardMD interaction/allergy content into a
 * compiled SafetyEngine rule pack, once per Worker isolate.
 *
 * The ONLY file that imports the raw JSON directly (matching the existing bare-JSON-import pattern
 * already used for kb/protocols/rchop.json in functions/api/queue/[[path]].js) — kept separate from
 * rx-safety.js so that file stays testable with a small fixture pack, without pulling in the real
 * (large) dataset or the Cloudflare-bundler-specific bare-JSON-import behaviour Node's own ESM
 * loader does not accept without an import attribute.
 *
 * UNAPPROVED CONTENT — see rx-safety.js's header and vault/modules/WardSynQ.md's STATUS line.
 */
import { buildRulePack } from "../../wardsynq/adapters/wardsynq-rules-stewardmd.js";
import RAW_INTERACTION_RULES from "../../data/interaction-rules.json";
import ALLERGY_SEED from "../../wardsynq/data/allergy-classes.seed.json";

let _pack = null;
function getRulePack() {
  if (!_pack) _pack = buildRulePack(RAW_INTERACTION_RULES, ALLERGY_SEED, {});
  return _pack;
}

export { getRulePack };
