// Verifies the SW "reload tabs on activate" decision: reload ONLY on a genuine
// upgrade (a previous stewardmd-* cache existed), never on first install.
// The pure decision fn is defined in sw.js as swShouldReloadClients(cacheKeys, CACHE).
// Run: node test/sw-activate.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

// Extract the pure fn from sw.js without executing the SW (which needs `self`).
const m = src.match(/function swShouldReloadClients\([^]*?\n}/);
if (!m) { console.log("✗ FAIL: swShouldReloadClients not found in sw.js"); process.exit(1); }
const swShouldReloadClients = new Function(m[0] + "; return swShouldReloadClients;")();

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("✗ FAIL:", n); } };

ok("first install (no caches) → NO reload", swShouldReloadClients([], "stewardmd-gold299") === false);
ok("first install (only current cache) → NO reload", swShouldReloadClients(["stewardmd-gold299"], "stewardmd-gold299") === false);
ok("upgrade (old stewardmd cache present) → reload", swShouldReloadClients(["stewardmd-gold298"], "stewardmd-gold299") === true);
ok("upgrade (old + new present) → reload", swShouldReloadClients(["stewardmd-gold298", "stewardmd-gold299"], "stewardmd-gold299") === true);
ok("unrelated caches only → NO reload", swShouldReloadClients(["some-other-cache"], "stewardmd-gold299") === false);
ok("null/garbage input → NO reload (safe)", swShouldReloadClients(null, "stewardmd-gold299") === false);

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
