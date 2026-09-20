/* test/q-events-only-through-chain.test.mjs - G3: every hospital event-log row (q_events) is written through
 * functions/_q_audit_chain.js, so it carries a hash-chain link. A row created directly with
 * wCreate("q_events/...") would be unlinked after linking began, and Security review would report it as a
 * break. Three such writers slipped in from parallel work on 2026-09-14 (org settings, no-show recall, seed
 * sign-off); this keeps a fourth out.
 *
 * node --test test/q-events-only-through-chain.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function jsFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith(".js") ? [p] : [];
  });
}

test("no server code writes q_events except the audit chain module", () => {
  const offenders = jsFiles("functions")
    .filter((f) => !f.endsWith("_q_audit_chain.js"))
    .filter((f) => /["'`]q_events\/["'`]?\s*\+|["'`]q_events\/\$\{/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
