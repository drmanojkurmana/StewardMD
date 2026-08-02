import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "id-token.js"), "utf8");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

ok(/window\.SMD_IDTOKEN\s*=/.test(src), "exposes window.SMD_IDTOKEN");
ok(/window\.SMD_DEVICEID\s*=/.test(src), "exposes window.SMD_DEVICEID");
ok(/requestIdleCallback/.test(src), "fetches the token off the load-critical path (requestIdleCallback)");
ok(/getIdToken/.test(src) && /SMD_DEVICE/.test(src), "caches Firebase getIdToken + SMD_DEVICE.getId");
ok(/50\s*\*\s*60|3000000|refresh/i.test(src), "refreshes the token periodically");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
ok(/id-token\.js/.test(html), "id-token.js is loaded from index.html");
console.log(`\nALL ${pass} PASS`);
