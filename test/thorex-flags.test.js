const assert = require("assert");
const F = require("../thorex-flags.js");
// master default ON (private dev/testing; PUBLIC-RELEASE-GATE); bool coercion; set/get via a stubbed localStorage
global.localStorage = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })();
assert.equal(F.bool("smd_thorex"), false, "master OFF by default for public/release (unlocked per device via the Experimental access code)");
F.set("smd_thorex", true);
assert.equal(F.bool("smd_thorex"), true, "set flips it on");
assert.equal(F.get("smd_thorex_cloud"), null, "tri default is null (ask once)");
console.log("ok");
