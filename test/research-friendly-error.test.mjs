/* test/research-friendly-error.test.mjs — the shared ResearchMD error mapper.
 *
 * Every ResearchMD screen routes server errors through SMD.p2.friendlyError /
 * SMD.p2.errHtml (research.js). The contract: users never see a raw code or HTTP
 * status in the message or an action button; the code lives only in a collapsed
 * "Details for support" line. Each known code maps to one plain sentence and one
 * sensible next action. research.js is node-safe (module.exports = SMD), so we
 * exercise the real functions here rather than grepping the source.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SMD = require("../research.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

const F = SMD.p2.friendlyError;
const E = SMD.p2.errHtml;

ok("friendlyError and errHtml are exported on SMD.p2", typeof F === "function" && typeof E === "function");

// --- friendlyError: one plain sentence + one action per code -----------------
{
  const f = F({ code: "project_not_found", status: 404 });
  ok("project_not_found: friendly message", f.message === "We could not open this project on your account.");
  ok("project_not_found: save-or-back action", f.action === "save-or-back");
}
{
  const f = F({ code: "unauthorized", status: 401 });
  ok("unauthorized: sign-in message", f.message === "Please sign in to use ResearchMD.");
  ok("unauthorized: signin action", f.action === "signin" && f.actionLabel === "Sign in");
}
ok("bare 401 also maps to sign-in", F({ status: 401 }).action === "signin");
{
  const f = F({ code: "not_member", status: 403 });
  ok("not_member: friendly message", f.message === "We could not open this project on your account.");
  ok("not_member: says who can fix it", /owner/.test(f.sub || ""));
  ok("not_member: back action", f.action === "back" && f.actionLabel === "Back to projects");
}
ok("forbidden maps like not_member", F({ code: "forbidden" }).action === "back");
ok("bare 403 maps like not_member", F({ status: 403 }).action === "back");
{
  const f = F({ code: "insufficient_credits" });
  ok("insufficient_credits: token message", f.message === "You need more MaiK tokens for this step.");
  ok("insufficient_credits: credits action", f.action === "credits" && f.actionLabel === "Add tokens");
}
{
  const f = F({ code: "network", status: 0 });
  ok("network: connection message", f.message === "No connection right now. Your work is saved; try again in a moment.");
  ok("network: retry action", f.action === "retry" && f.actionLabel === "Try again");
}
ok("status 0 maps to network retry", F({ status: 0 }).action === "retry");
ok("5xx maps to network retry", F({ status: 503 }).message === F({ code: "network" }).message);
ok("http_503 code parses to a 5xx retry", F({ code: "http_503" }).action === "retry");
ok("unknown code falls back to a generic retry", F({ code: "weird_code", status: 418 }).message === "Something went wrong on our side.");
ok("no code and no status passes a plain message through", F({ message: "Study label and citation are required." }).message === "Study label and citation are required.");
ok("empty error still gives a generic retry", F(null).action === "retry");

// --- errHtml: no raw code in the message or buttons; code only in details ----
{
  const h = E({ code: "project_not_found", status: 404 });
  ok("errHtml renders an alert banner", /rmd-banner-error/.test(h) && /role="alert"/.test(h));
  ok("errHtml shows the friendly message", /We could not open this project on your account/.test(h));
  ok("errHtml offers Back to projects", /data-rmd-action="projects"/.test(h));
  ok("errHtml keeps the code in collapsed details", /<details class="rmd-banner-details">/.test(h) && /Details for support/.test(h));
  ok("errHtml puts Code: only inside the details", h.indexOf("Code:") > h.indexOf("<details"));
  ok("errHtml does not leak HTTP into a button", !/<button[^>]*>[^<]*HTTP/.test(h));
}
{
  // With a local-only active project, the 404 card also offers to save it.
  SMD.store = { getActiveProject: () => ({ id: "prj_local", serverId: null }) };
  const h = E({ code: "project_not_found", status: 404 });
  ok("local-only 404 offers Save it to my account", /data-rmd-action="save"/.test(h) && /Save it to my account/.test(h));
  SMD.store = { getActiveProject: () => ({ id: "prj_srv", serverId: "prj_srv" }) };
  const h2 = E({ code: "project_not_found", status: 404 });
  ok("server-backed 404 does not offer a save button", !/data-rmd-action="save"/.test(h2));
  delete SMD.store;
}
{
  const h = E({ code: "unauthorized", status: 401 });
  ok("sign-in banner offers a Sign in action", /data-rmd-action="signin"/.test(h) && /Please sign in to use ResearchMD/.test(h));
}
{
  const h = E({ code: "insufficient_credits" });
  ok("credits banner offers Add tokens", /data-rmd-action="credits"/.test(h) && /Add tokens/.test(h));
}
{
  const h = E({ code: "not_member", status: 403 });
  ok("role banner shows the owner sub-line", /rmd-banner-sub/.test(h) && /Only the project owner can fix this/.test(h));
}
{
  const h = E({ code: "network", status: 0 }, "proto-retry");
  ok("retryAttr is preserved on the Try again button", /data-rmd="proto-retry"/.test(h) && /Try again/.test(h));
  const h2 = E({ code: "network", status: 0 });
  ok("without retryAttr the button uses the shell retry action", /data-rmd-action="retry"/.test(h2));
}
{
  const h = E({ message: "Study label and citation are required." });
  ok("a plain local message renders without a support-details block", !/Details for support/.test(h));
  ok("a plain local message is shown verbatim", /Study label and citation are required/.test(h));
}

console.log(`research-friendly-error: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
