/* test/maik-feedback-admin-route.test.mjs — the admin/maik-feedback route, source-level.
 *
 * Same convention as test/research-web-fallback.test.mjs: functions/api/ai/[[path]].js is a
 * Cloudflare Pages function with runtime-only imports (KV, secrets), so this checks the SOURCE
 * for the two things that matter - the new segment is inside the SAME owner-gated (aiAdminAuthed)
 * block every other admin segment uses, and it is the only route that returns the free-text reasons
 * (the public /api/maik-feedback GET stays counts-only, per functions/api/maik-feedback.js).
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const SRC = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");

ok("_maik_feedback.js is imported", /import \{ getFeedback, getFeedbackAgg, clearFeedback \} from "\.\.\/\.\.\/_maik_feedback\.js";/.test(SRC));

const gateLine = SRC.match(/if \(seg === "admin\/model"[\s\S]*?"admin\/maik-feedback"\) \{/);
ok("admin/maik-feedback is inside the owner-gated admin segment list (not a separate, ungated branch)", !!gateLine);

const block = SRC.match(/if \(seg === "admin\/maik-feedback"\) \{[\s\S]*?\n    \}/);
ok("the admin/maik-feedback handler was found", !!block);
const b = block ? block[0] : "";
ok("GET returns both entries (with reasons) and the aggregate", /entries: await getFeedback\(store\)/.test(b) && /agg: await getFeedbackAgg\(store\)/.test(b));
ok("POST clears the log and audits the action, same pattern as admin/clientlog", /clearFeedback\(store\)/.test(b) && /auditRecord\(store, "maik-feedback", "cleared"/.test(b));

console.log(`maik-feedback-admin-route: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
