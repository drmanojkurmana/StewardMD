// Loads ku.js in a stubbed sandbox and checks the pure client logic (no network).
// Run: node test/ku-client.test.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../ku.js", import.meta.url), "utf8");

let _uid = "anon";
const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const SMD_ACCOUNT = { uid: () => _uid, onChange: () => {} };
const window = { SMD_ACCOUNT: SMD_ACCOUNT, addEventListener: () => {}, AI_PROXY: null, firebase: undefined };
// Run ku.js with these as locals (mirrors browser globals resolving off window).
new Function("window", "SMD_ACCOUNT", "localStorage", "firebase", "fetch", "setTimeout",
  src)(window, SMD_ACCOUNT, localStorage, undefined, () => {}, () => 0);

const KU = window.SMD_KU;
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("✗ FAIL:", n); } };

ok("SMD_KU exposed", !!KU);
// signed out → emit is a no-op
KU.emit("read", "cap");
ok("no-op when signed out", KU._queue().length === 0);
ok("signedIn() false when anon", KU.signedIn() === false);

// sign in
_uid = "user123";
ok("signedIn() true", KU.signedIn() === true);
KU.emit("read", "cap");
ok("emits when signed in", KU._queue().length === 1);
KU.emit("read", "cap");
ok("in-batch dedup (same type+refId)", KU._queue().length === 1);
KU.emit("read", "dka");
ok("distinct refId queues", KU._queue().length === 2);
KU.emit("calc", "crcl");
ok("distinct type queues", KU._queue().length === 3);
KU.emit("bogus", "");
ok("empty refId ignored", KU._queue().length === 3);
KU.emit(null, "x");
ok("missing type ignored", KU._queue().length === 3);

ok("balance default 0", KU.balance() === 0);
// cache reconcile via saveCache path (simulate a server response through onChange listener)
let got = null; KU.onChange((c) => { got = c; });

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
