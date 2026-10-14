import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("build-www.sh ships prep/nucleus360 so the Nucleus360 hub has topics in the app bundle", () => {
  const sh = fs.readFileSync(path.join(root, "scripts/build-www.sh"), "utf8");
  assert.match(sh, /cp prep\/nucleus360\/\*\.json "\$WWW\/prep\/nucleus360\/"/);
  const topics = JSON.parse(fs.readFileSync(path.join(root, "prep/nucleus360/topics.json"), "utf8"));
  assert.ok(Array.isArray(topics.topics) && topics.topics.length >= 30, "topics.json must list the pre-built topics");
});
