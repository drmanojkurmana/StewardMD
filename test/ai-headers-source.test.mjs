// test/ai-headers-source.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "reasoning.js"), "utf8");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };
const fn = src.slice(src.indexOf("function aiHeaders"), src.indexOf("function aiHeaders") + 900);

ok(/SMD_IDTOKEN/.test(fn), "aiHeaders reads the CACHED token (SMD_IDTOKEN), not getIdToken");
ok(!/getIdToken\(\)/.test(fn), "aiHeaders never calls getIdToken() synchronously (no hang path)");
ok(/X-SMD-Device/.test(fn) && /SMD_DEVICEID/.test(fn), "aiHeaders attaches X-SMD-Device from the cache");
ok(/smd_ai_idtoken/.test(fn), "token attach is flag-guarded (smd_ai_idtoken)");
console.log(`\nALL ${pass} PASS`);
