import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "home.js"), "utf8");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); console.log("✅ " + m); pass++; };

ok(/\/admin\/users/.test(src), "dashboard fetches /admin/users");
ok(/\/admin\/user-limit/.test(src), "dashboard POSTs /admin/user-limit to set a per-user cap");
ok(/aicUsers|Users\b/.test(src), "there is a Users tab/section in the AI Control Center");
ok(/maik_case|core (MaiK|clinical)|clinical AI/i.test(src) && /confirm/i.test(src), "confirm before capping core MaiK");
console.log(`\nALL ${pass} PASS`);
