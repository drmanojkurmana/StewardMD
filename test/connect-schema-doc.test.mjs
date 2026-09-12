/* The generated ES-module twin of the manifest schema must never drift from schema.json.
 *
 * schema-doc.mjs exists because Cloudflare's esbuild cannot parse the import attribute Node requires
 * for a JSON module (`with { type: 'json' }`), and that one parse error silently failed every Pages
 * build. The twin removes the syntax; this test removes the risk of the twin going stale. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import SCHEMA_DOC from "../connect-agent/manifest/schema-doc.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "connect-agent", "manifest");

test("schema-doc.mjs matches schema.json (run: node scripts/gen-schema-doc.mjs)", () => {
  const json = JSON.parse(readFileSync(join(DIR, "schema.json"), "utf8"));
  assert.deepEqual(SCHEMA_DOC, json);
});
