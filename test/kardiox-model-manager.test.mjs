/* test/kardiox-model-manager.test.mjs — on-device model pack manager (SMD_KARDIOX_MODELMGR).
 * Fakes Capacitor Filesystem (in-memory) + fetch so the download/cache/delete/source logic is verified
 * headless (real on-device behaviour is validated on a flagship). */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log("  x FAIL:", n)); };

// in-memory fake Filesystem (base64 store) + native Capacitor
const store = {};
globalThis.window = globalThis;
globalThis.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    Filesystem: {
      stat: async ({ path }) => (path in store ? { size: store[path].length } : Promise.reject(new Error("nf"))),
      writeFile: async ({ path, data }) => { store[path] = data; },
      readFile: async ({ path }) => (path in store ? { data: store[path] } : Promise.reject(new Error("nf"))),
      deleteFile: async ({ path }) => { delete store[path]; },
    },
  },
};
// fake fetch: returns 4 deterministic bytes per file
let fetchCalls = 0;
globalThis.fetch = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => { fetchCalls++; return new Uint8Array([1, 2, 3, 4]).buffer; } });

new Function(readFileSync(new URL("../kardiox-model-manager.js", import.meta.url), "utf8"))();
const M = globalThis.SMD_KARDIOX_MODELMGR;

ok("module exposed", !!M && typeof M.ensure === "function" && typeof M.installed === "function");

// base64 round-trip
const rt = M._b64.b64ToU8(M._b64.abToB64(new Uint8Array([0, 255, 16, 200, 7]).buffer));
ok("base64 round-trip preserves bytes", rt.length === 5 && rt[1] === 255 && rt[3] === 200);

// not installed initially
ok("installed=false before download", (await M.installed("diagnosis")) === false);

// ensure downloads every file + reports progress to 1
let lastP = 0;
const res = await M.ensure("diagnosis", (p) => { lastP = p; });
const nFiles = M.PACKS.diagnosis.files.length;
ok("ensure downloaded all files", fetchCalls === nFiles && res.cached === true);
ok("progress reached 1.0", Math.abs(lastP - 1) < 1e-9);
ok("installed=true after download", (await M.installed("diagnosis")) === true);

// ensure again is a no-op (files present → no new fetches)
fetchCalls = 0; await M.ensure("diagnosis");
ok("re-ensure skips cached files (0 new downloads)", fetchCalls === 0);

// source returns cached bytes on native
const src = await M.source("ecglib_AFIB.onnx");
ok("source() returns bytes on native", src.bytes && src.bytes.length === 4 && src.bytes[0] === 1);

// remove clears the pack
await M.remove("diagnosis");
ok("remove() clears the cache", (await M.installed("diagnosis")) === false);

// web fallback: no native filesystem → source() gives a URL
globalThis.Capacitor.isNativePlatform = () => false;
const webSrc = await M.source("ecglib_AFIB.onnx");
ok("web fallback → source() returns a host URL", !!webSrc.url && webSrc.url.indexOf("models.stewardmd.in/kardiox") >= 0);

console.log(`kardiox-model-manager: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
