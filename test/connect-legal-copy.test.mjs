/* AgentConnect told doctors that linking their hospital EMR needed "ZERO IT SETUP" and that
 * "no IT approvals required". StewardMD cannot make that claim on a hospital's behalf: access to
 * a hospital system is governed by that hospital's IT and information-governance policy, and
 * telling a clinician otherwise invites them to breach it. This pins the safer wording. */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BANNED = [/no IT approvals required/i, /zero IT setup/i, /no IT permissions? (needed|required)/i, /without IT approval/i];

function appSources() {
  return readdirSync(ROOT).filter((f) => f.endsWith(".js") && !f.startsWith("vendor")).map((f) => [f, readFileSync(join(ROOT, f), "utf8")]);
}

test("no screen claims the hospital's IT approval is unnecessary", () => {
  const hits = [];
  for (const [file, src] of appSources()) for (const re of BANNED) if (re.test(src)) hits.push(`${file}: ${re}`);
  assert.deepEqual(hits, [], "found a claim that bypasses hospital IT governance");
});

test("the AgentConnect card points the clinician at their hospital's policy", () => {
  const src = readFileSync(join(ROOT, "home.js"), "utf8");
  assert.match(src, /information-governance policy/, "tells the user the hospital policy still applies");
  assert.match(src, /read only what your account is already permitted to see/, "scopes access to the clinician's own permissions");
});

test("the card still states the true, safe claim: it changes nothing in the EMR", () => {
  const src = readFileSync(join(ROOT, "home.js"), "utf8");
  assert.match(src, /makes no changes to your hospital/i, "read-only promise kept");
});
