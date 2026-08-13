/* Phase 0: oncology data-architecture checks - deterministic cycle id + rchop.json validates
 * against the protocol schema via the wired kb/tools/validate-content.mjs. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ONCO = require(join(ROOT, "functions", "_onco_store.js"));

test("cycle id is deterministic and doc-id-safe (mirrors memberId sanitize)", () => {
  assert.equal(ONCO._cycleId("TP-abc/123", 3), "TP-abc-123__3");
  assert.equal(ONCO._cycleId("TP-abc/123", 3), ONCO._cycleId("TP-abc/123", 3)); // stable
});

test("rchop.json validates against protocol.schema.json (validator wired for protocols/)", () => {
  // Run the real validator; capture stdout even if OTHER kb dirs fail, then assert protocols passed.
  let out;
  try { out = execFileSync("node", [join(ROOT, "kb/tools/validate-content.mjs")], { cwd: ROOT, encoding: "utf8" }); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); }
  // no per-file protocol error lines, and the summary marks the dir clean
  assert.ok(!/✗ protocols\//.test(out), "a protocols/*.json file failed schema validation:\n" + out);
  assert.match(out, /✓ protocols/);
});
