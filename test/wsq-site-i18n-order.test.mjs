/* test/wsq-site-i18n-order.test.mjs - the Order workstation's staff-language keys (ui-i18n-site).
 *
 * Every T()/TS() call in wardsynq/ui/wardsynq-app.js names an "order." key and carries its English
 * inline (the fallback when window.WSQI18n is absent). This checks the extractor's own view of that
 * source: one English per key, and every English is plain text (no HTML, no dash characters), the
 * same shape test/wsq-site-i18n-catalog.test.mjs holds the rest of the staff sources to.
 *
 * node --test test/wsq-site-i18n-order.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractKeys } from "./wsq-site-i18n-harness.mjs";

const orderKeys = () => extractKeys().filter((k) => k.key.startsWith("order."));

test("order.* keys are only extracted from the Order workstation", () => {
  const keys = orderKeys();
  assert.ok(keys.length > 0, "at least one order.* key is extracted");
  for (const k of keys) assert.ok(k.file.endsWith("wardsynq/ui/wardsynq-app.js"), `${k.key} unexpectedly came from ${k.file}`);
});

test("one English per order.* key", () => {
  const seen = new Map(), conflicts = [];
  for (const k of orderKeys()) {
    if (seen.has(k.key) && seen.get(k.key) !== k.en) conflicts.push(`${k.key}: "${seen.get(k.key)}" vs "${k.en}"`);
    else seen.set(k.key, k.en);
  }
  assert.deepEqual(conflicts, []);
});

test("order.* English is plain text: no HTML tags or entities, no em/en dash", () => {
  for (const k of orderKeys()) {
    assert.ok(!/<[a-z/]|&[a-z#0-9]+;/i.test(k.en), `${k.key} carries HTML: ${k.en}`);
    assert.ok(!/[–—]/.test(k.en), `${k.key} carries an en or em dash: ${k.en}`);
  }
});

test("order.* key names match the site's key pattern and stay under the order. prefix", () => {
  for (const k of orderKeys()) assert.match(k.key, /^order\.[\w.-]+$/, k.key);
});
