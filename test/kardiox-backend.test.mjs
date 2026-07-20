/* test/kardiox-backend.test.mjs — health-gated backend activation (mock ↔ RemoteAnalyzer). */
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

globalThis.window = globalThis;
const ls = {};
globalThis.localStorage = { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } };
globalThis.location = { search: "" };
let fetchOk = true, fetchCalls = 0;
globalThis.fetch = () => { fetchCalls++; return Promise.resolve({ ok: fetchOk, json: () => Promise.resolve({ status: "ok" }) }); };

const load = (f) => new Function(read(f))();
load("kardiox-flags.js");
load("kardiox-models.js");
load("kardiox-net.js");
load("kardiox-providers.js");
const P = globalThis.SMD_KARDIOX_PROVIDERS;

ok("flag registered", !!globalThis.SMD_KARDIOX_FLAGS.DEFS.smd_kardiox_backend);
ok("default OFF → mock analyzer", P.current().analyzer.kind === "mock" && P.backendActive() === false);

ls.smd_kardiox_backend = "1";
fetchOk = true;
const healthy = await P.checkBackend();
ok("flag on + health OK → remote analyzer", healthy === true && fetchCalls >= 1 && P.current().analyzer.kind === "remote" && P.backendActive() === true);

fetchOk = false;
const bad = await P.checkBackend();
ok("flag on + health FAIL → mock fallback", bad === false && P.current().analyzer.kind === "mock" && P.backendActive() === false);

ls.smd_kardiox_backend = "0";
await P.checkBackend();
ok("flag off again → mock", P.current().analyzer.kind === "mock");

console.log(`\nkardiox-backend: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
