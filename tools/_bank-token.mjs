/* Preload for repo tools and CI that read the gated bank (since PREP_BANK_ENFORCE=1 they get 401 without this).
 *   NODE_OPTIONS=--import=./tools/_bank-token.mjs node tools/prep-ids.mjs verify
 * Adds X-SMD-Tool: <secret> to every fetch aimed at /api/prep/bank/ on stewardmd.in. The secret comes from
 * $SMD_TOOL_TOKEN (CI: the SMD_TOOL_TOKEN repo secret) or ~/.config/stewardmd/tool-token. The server only holds its SHA-256
 * (KV key bank:tool-hash). With no secret this does nothing, so tools behave exactly as before. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function readToken(env = process.env, home = os.homedir()) {
  let t = String(env.SMD_TOOL_TOKEN || "").trim();
  if (!t) { try { t = fs.readFileSync(path.join(home, ".config/stewardmd/tool-token"), "utf8").trim(); } catch (e) {} }
  return t;
}
export function wrapFetch(realFetch, token) {
  if (!token) return realFetch;
  return function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (!/^https:\/\/(?:www\.)?stewardmd\.in\/api\/prep\/bank\//.test(url)) return realFetch(input, init);
    const headers = new Headers((init && init.headers) || (typeof input !== "string" && input.headers) || {});
    headers.set("X-SMD-Tool", token);
    return realFetch(input, { ...(init || {}), headers });
  };
}
globalThis.fetch = wrapFetch(globalThis.fetch, readToken());
