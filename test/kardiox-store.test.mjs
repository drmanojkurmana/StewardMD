/* test/kardiox-store.test.mjs — encrypted on-device store: round-trip, at-rest encryption, wipe. */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const STORE = require("../kardiox-store.js");

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

function inspectKV() { const m = {}; return { m, get: k => Promise.resolve(k in m ? m[k] : null), set: (k, v) => { m[k] = v; return Promise.resolve(); }, del: k => { delete m[k]; return Promise.resolve(); }, keys: () => Promise.resolve(Object.keys(m)), clear: () => { Object.keys(m).forEach(k => delete m[k]); return Promise.resolve(); } }; }

const kv = inspectKV(), keyStore = inspectKV();
const S = STORE.makeStore({ kv, keyStore });

const af = { id: "a1", verdict: "Atrial fibrillation", createdAt: "Today 08:12", context: "Bed 14", confidence: 0.91, measurements: { qtcMs: 468, ventRateBpm: 128 }, findings: [{ id: "f1", title: "Irregularly irregular R-R" }] };

await S.save(af);
ok("save produces an encrypted record", !!kv.m["kx-ecg:a1"] && !!kv.m["kx-ecg:a1"].ct && !!kv.m["kx-ecg:a1"].iv);
ok("ENCRYPTED AT REST — no plaintext leaks", JSON.stringify(kv.m).indexOf("Atrial fibrillation") < 0 && JSON.stringify(kv.m).indexOf("Irregularly") < 0);
ok("a key was created (device-only)", !!keyStore.m["kx-ecg-key"]);

const got = await S.get("a1");
ok("round-trip decrypt preserves nested data", got && got.verdict === "Atrial fibrillation" && got.measurements.qtcMs === 468 && got.findings[0].title === "Irregularly irregular R-R");

await S.save({ id: "a2", verdict: "Normal sinus rhythm", createdAt: "Yesterday 17:40" });
ok("all() returns both decrypted", (await S.all()).length === 2);
ok("timeline() sorted by createdAt", (await S.timeline()).map(a => a.id).join(",").length > 0);
ok("search hits verdict", (await S.search("atrial")).length === 1 && (await S.search("zzz")).length === 0);
const info = await S.storageInfo();
ok("storageInfo counts records + bytes", info.count === 2 && info.bytes > 0);

await S.delete("a2");
ok("delete removes one", (await S.all()).length === 1);

// deleteAll: wipe records AND key irreversibly
ok("key present before wipe", keyStore.m["kx-ecg-key"] !== undefined);
await S.deleteAll();
ok("deleteAll wipes all records", (await S.all()).length === 0 && Object.keys(kv.m).length === 0);
ok("deleteAll wipes the key", keyStore.m["kx-ecg-key"] === undefined);

// after wipe, a fresh save works with a brand-new key
await S.save({ id: "a3", verdict: "Ventricular tachycardia" });
ok("save after wipe uses a fresh key", (await S.get("a3")).verdict === "Ventricular tachycardia" && keyStore.m["kx-ecg-key"] !== undefined);

console.log(`\nkardiox-store: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
