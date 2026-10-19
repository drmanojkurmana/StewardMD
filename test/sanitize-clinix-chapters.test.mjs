/* test/sanitize-clinix-chapters.test.mjs - the native-bundle copyright sanitiser must not blank a CliniX pathway.
 * Regression (2026-10-20): scripts/sanitize-sources.mjs treated the JSON key `chapters` as a page locator and
 * emptied it in every clinix/diseases/*.json, so every pathway rendered "Nothing to show yet" on iOS and
 * Android while the headless tests (which serve the source files) passed.
 * Runs the real sanitiser over a copy of the real clinix/ content, like build-www.sh does.
 *   node --test test/sanitize-clinix-chapters.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every CliniX pathway keeps its chapters and skills through the sanitiser", () => {
  const www = mkdtempSync(join(tmpdir(), "san-"));
  cpSync(join(ROOT, "clinix"), join(www, "clinix"), { recursive: true });
  const r = spawnSync(process.execPath, [join(ROOT, "scripts/sanitize-sources.mjs"), www], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  let n = 0;
  for (const f of readdirSync(join(ROOT, "clinix/diseases"))) {
    const src = JSON.parse(readFileSync(join(ROOT, "clinix/diseases", f), "utf8"));
    const out = JSON.parse(readFileSync(join(www, "clinix/diseases", f), "utf8"));
    assert.equal(out.chapters.length, src.chapters.length, f + ": chapters blanked");
    const sk = (d) => d.chapters.reduce((a, c) => a + (c.skills || []).length, 0);
    assert.equal(sk(out), sk(src), f + ": chapter skills lost");
    n++;
  }
  assert.ok(n >= 20, "expected the shipped diseases, saw " + n);
});
