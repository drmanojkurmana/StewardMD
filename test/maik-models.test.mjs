/* test/maik-models.test.mjs — MaiK on-device model pack manager.
 *
 * The download loop is the risky part: it must resume from a partial file, never base64 a whole
 * model, reject a non-GGUF body, restart a file that is longer than expected, and only mark the
 * pack installed when the byte count matches exactly.
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const SRC = src("maik-models.js");

const GGUF = [0x47, 0x47, 0x55, 0x46];   // "GGUF"

function fakeLS() {
  const s = {};
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s };
}

/**
 * Fake Capacitor Filesystem + a Range-aware fake server.
 * `serverBytes` is the file the server will serve; `onDisk` seeds a partial download.
 */
function load({ native = true, onDisk = null, serverBytes = null, badMagic = false, ignoreRange = false } = {}) {
  const files = new Map();
  if (onDisk != null) files.set("maik-models/medgemma-1.5-4b-it-Q4_K_M.gguf", onDisk);

  const calls = { ranges: [], appends: [], mkdir: 0, exclude: 0, deleted: [] };
  const Filesystem = {
    stat: async ({ path }) => {
      if (!files.has(path)) throw new Error("not found");
      return { size: files.get(path).length };
    },
    mkdir: async () => { calls.mkdir++; return {}; },
    appendFile: async ({ path, data }) => {
      const buf = Buffer.from(data, "base64");
      calls.appends.push(buf.length);
      files.set(path, Buffer.concat([files.get(path) || Buffer.alloc(0), buf]));
      return {};
    },
    deleteFile: async ({ path }) => { calls.deleted.push(path); files.delete(path); return {}; },
    getUri: async ({ path }) => ({ uri: "file:///var/mobile/Data/" + path })
  };
  const Llama = { excludeFromBackup: async () => { calls.exclude++; return { ok: true }; } };

  const win = {
    Capacitor: { isNativePlatform: () => native, Plugins: { Filesystem, Llama } },
    CapacitorWebFetch: async (url, init) => {
      const total = serverBytes ? serverBytes.length : 0;
      const m = /bytes=(\d+)-(\d+)/.exec((init && init.headers && init.headers.Range) || "");
      const from = m ? Number(m[1]) : 0;
      const to = m ? Number(m[2]) : total - 1;
      calls.ranges.push([from, to]);
      if (ignoreRange) {
        return { status: 200, headers: { get: () => null }, arrayBuffer: async () => bufToAB(serverBytes) };
      }
      let slice = serverBytes.subarray(from, Math.min(to + 1, total));
      if (badMagic && from === 0) {
        slice = Buffer.concat([Buffer.from("<html>err"), slice.subarray(9)]);
      }
      return {
        status: 206,
        headers: { get: (h) => (h === "Content-Range" ? `bytes ${from}-${to}/${total}` : null) },
        arrayBuffer: async () => bufToAB(slice)
      };
    }
  };
  const ls = fakeLS();
  new Function("window", "localStorage", "Buffer", SRC)(win, ls, Buffer);
  return { M: win.SMD_MAIK_MODELS, ls, files, calls };
}
function bufToAB(b) { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }

// Build a fake model file of `n` bytes that starts with the GGUF magic.
function fakeModel(n) {
  const b = Buffer.alloc(n, 0x41);
  Buffer.from(GGUF).copy(b, 0);
  return b;
}

// ── registry ──
{
  const { M } = load();
  ok("exposes API", !!M && typeof M.ensure === "function" && typeof M.pathFor === "function");
  ok("primary pack is MedGemma 1.5 4B", /MedGemma 1\.5 4B/.test(M.PACKS["maik-local-v1"].label));
  ok("primary pack exact byte count", M.totalBytes("maik-local-v1") === 2489894976);
  ok("primary pack sizeLabel", M.sizeLabel("maik-local-v1") === "2.49 GB");
  ok("comparison pack is Gemma 4 E2B", /Gemma 4 E2B/.test(M.PACKS["maik-local-e2b"].label));
  ok("Q5 quality pack present with the exact size", M.totalBytes("maik-local-v1-q5") === 2829699136);
  ok("Q5 pack still fits the 8 GB iPhone budget", M.totalBytes("maik-local-v1-q5") < 3.0e9);
  ok("Q5 pack sha256 is explicitly null, not a fake Xet oid", M.PACKS["maik-local-v1-q5"].files[0].sha256 === null);
  ok("E2B exact byte count", M.totalBytes("maik-local-e2b") === 3106738272);
  ok("E4B is NOT offered (4.98 GB will not fit the 8 GB floor device)",
     !Object.values(M.PACKS).some((p) => /E4B/.test(p.label)));
  ok("every pack clamps n_ctx to 4096", Object.values(M.PACKS).every((p) => p.nCtx === 4096));
  ok("chunked, not whole-file", M.CHUNK_BYTES > 0 && M.CHUNK_BYTES <= 64 * 1024 * 1024);
  let threw = false; try { M.totalBytes("nope"); } catch (e) { threw = true; }
  ok("unknown pack throws", threw);
}

// ── install marker ──
{
  const { M, ls } = load();
  ok("installedCached false before download", M.installedCached("maik-local-v1") === false);
  ls.setItem("smd_maik_pack_maik-local-v1", "1");
  ok("installedCached true once marked", M.installedCached("maik-local-v1") === true);
}

// ── cold download of a small fake model ──
{
  const SIZE = 5_000_000;
  const server = fakeModel(SIZE);
  const { M, ls, files, calls } = load({ serverBytes: server });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;         // shrink the pack for the test
  const seen = [];
  const r = await M.ensure("maik-local-v1", (f) => seen.push(f));
  ok("cold download resolves installed", r && r.installed === true);
  ok("file fully written", files.get("maik-models/medgemma-1.5-4b-it-Q4_K_M.gguf").length === SIZE);
  ok("started at byte 0", calls.ranges[0][0] === 0);
  ok("directory created", calls.mkdir === 1);
  ok("excluded from iCloud backup", calls.exclude === 1);
  ok("marker written", ls._s["smd_maik_pack_maik-local-v1"] === "1");
  ok("progress reported and reaches 1", seen.length > 0 && seen[seen.length - 1] === 1);
  ok("progress is monotonic", seen.every((v, i) => i === 0 || v >= seen[i - 1]));
  ok("no single append larger than the chunk size", Math.max(...calls.appends) <= M.CHUNK_BYTES);
}

// ── RESUME from a partial file ──
{
  const SIZE = 5_000_000, HAVE = 2_000_000;
  const server = fakeModel(SIZE);
  const { M, files, calls } = load({ serverBytes: server, onDisk: server.subarray(0, HAVE) });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;
  const notes = [];
  await M.ensure("maik-local-v1", (f, n) => { if (n) notes.push(n); });
  ok("resume starts at the existing byte offset", calls.ranges[0][0] === HAVE);
  ok("resume did NOT refetch from 0", !calls.ranges.some((r) => r[0] === 0));
  ok("resumed file is complete and correct", Buffer.compare(files.get("maik-models/medgemma-1.5-4b-it-Q4_K_M.gguf"), server) === 0);
  ok("resume is surfaced to the user", notes.some((n) => /Resuming/i.test(n)));
}

// ── already complete: no network at all ──
{
  const SIZE = 5_000_000;
  const server = fakeModel(SIZE);
  const { M, calls } = load({ serverBytes: server, onDisk: server });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;
  const notes = [];
  await M.ensure("maik-local-v1", (f, n) => { if (n) notes.push(n); });
  ok("complete file triggers zero range requests", calls.ranges.length === 0);
  ok("complete file says so", notes.some((n) => /Already downloaded/i.test(n)));
}

// ── a file LONGER than expected is corrupt: delete and restart ──
{
  const SIZE = 5_000_000;
  const server = fakeModel(SIZE);
  const { M, files, calls } = load({ serverBytes: server, onDisk: Buffer.concat([server, Buffer.alloc(999)]) });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;
  await M.ensure("maik-local-v1", () => {});
  ok("oversize file deleted", calls.deleted.length === 1);
  ok("oversize file re-downloaded from 0", calls.ranges[0][0] === 0);
  ok("restarted file ends at the right size", files.get("maik-models/medgemma-1.5-4b-it-Q4_K_M.gguf").length === SIZE);
}

// ── an HTML error page saved as a model must be rejected ──
{
  const SIZE = 5_000_000;
  const { M, ls } = load({ serverBytes: fakeModel(SIZE), badMagic: true });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;
  let err = null;
  await M.ensure("maik-local-v1", () => {}).catch((e) => { err = e; });
  ok("non-GGUF body rejected", !!err && /GGUF/.test(err.message));
  ok("marker NOT written on a failed download", !("smd_maik_pack_maik-local-v1" in ls._s));
}

// ── a server that ignores Range cannot be used to resume ──
{
  const SIZE = 5_000_000;
  const server = fakeModel(SIZE);
  const { M } = load({ serverBytes: server, onDisk: server.subarray(0, 2_000_000), ignoreRange: true });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;
  let err = null;
  await M.ensure("maik-local-v1", () => {}).catch((e) => { err = e; });
  ok("range-ignoring server surfaces a clear error", !!err && /resume/i.test(err.message));
}

// ── size mismatch is caught even when the transfer 'succeeded' ──
{
  const SIZE = 5_000_000;
  const { M, ls } = load({ serverBytes: fakeModel(SIZE - 1000) });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;          // claim more than the server has
  let err = null;
  await M.ensure("maik-local-v1", () => {}).catch((e) => { err = e; });
  ok("short file rejected on verify", !!err && /size mismatch/.test(err.message));
  ok("marker NOT written on size mismatch", !("smd_maik_pack_maik-local-v1" in ls._s));
}

// ── delete ──
{
  const SIZE = 5_000_000;
  const server = fakeModel(SIZE);
  const { M, ls, files } = load({ serverBytes: server, onDisk: server });
  M.PACKS["maik-local-v1"].files[0].bytes = SIZE;
  ls.setItem("smd_maik_pack_maik-local-v1", "1");
  await M.remove("maik-local-v1");
  ok("delete removes the file", !files.has("maik-models/medgemma-1.5-4b-it-Q4_K_M.gguf"));
  ok("delete clears the marker", !("smd_maik_pack_maik-local-v1" in ls._s));
}

// ── path handed to the native plugin ──
{
  const { M } = load();
  const p = await M.pathFor("maik-local-v1");
  ok("pathFor strips the file:// scheme for the plugin", p === "/var/mobile/Data/maik-models/medgemma-1.5-4b-it-Q4_K_M.gguf");
}

// ── web PWA: refuse rather than pretend ──
{
  const { M } = load({ native: false });
  let err = null;
  await M.ensure("maik-local-v1", () => {}).catch((e) => { err = e; });
  ok("non-native ensure() rejects with a clear reason", !!err && /native app/i.test(err.message));
  ok("non-native installed() is false", (await M.installed("maik-local-v1")) === false);
}

// ── NATIVE background download (OS DownloadManager) ──
// The JS chunk loop dies when the app backgrounds, which is exactly when someone starts a 2.5 GB
// download and switches apps. On native the transfer belongs to the OS.
function loadNative({ script = [], onDisk = 0, freeBytes = 50e9, existingId = null } = {}) {
  const calls = { start: 0, status: 0, cancel: 0, del: 0, chunkRanges: 0 };
  let step = 0;
  const Llama = {
    downloadStart: async () => { calls.start++; return { id: "77", path: "/ext/maik-models/m.gguf" }; },
    downloadStatus: async () => { calls.status++; return script[Math.min(step++, script.length - 1)]; },
    downloadCancel: async () => { calls.cancel++; },
    modelPath: async () => ({ path: "/ext/maik-models/m.gguf", bytes: onDisk, freeBytes }),
    modelDelete: async () => { calls.del++; return { ok: true }; }
  };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama, Filesystem: {
      stat: async () => { throw new Error("nope"); }, mkdir: async () => ({}),
      appendFile: async () => ({}), deleteFile: async () => ({}), getUri: async () => ({ uri: "file:///x" }) } } },
    CapacitorWebFetch: async () => { calls.chunkRanges++; throw new Error("chunk loop must NOT run on native"); }
  };
  const ls = fakeLS();
  if (existingId) ls.setItem("smd_maik_dlid_maik-local-v1", existingId);
  new Function("window", "localStorage", "Buffer", SRC)(win, ls, Buffer);
  return { M: win.SMD_MAIK_MODELS, ls, calls };
}

{
  const SIZE = 2489894976;
  const { M, ls, calls } = loadNative({ script: [
    { state: "running", bytes: 5e8, total: SIZE, onDisk: 5e8 },
    { state: "running", bytes: 15e8, total: SIZE, onDisk: 15e8 },
    { state: "done", bytes: SIZE, total: SIZE, onDisk: SIZE }
  ] });
  const seen = [];
  const r = await M.ensure("maik-local-v1", (f, n) => seen.push(n || f));
  ok("native: resolves installed", r && r.installed === true);
  ok("native: handed to the OS downloader", calls.start === 1);
  ok("native: NEVER runs the JS chunk loop", calls.chunkRanges === 0);
  ok("native: polled to completion", calls.status >= 3);
  ok("native: marker written", ls._s["smd_maik_pack_maik-local-v1"] === "1");
  ok("native: download id cleared when done", !("smd_maik_dlid_maik-local-v1" in ls._s));
  ok("native: state says it ran in the background", M.state("maik-local-v1").background === true);
  ok("native: tells the user it is a background transfer", seen.some((n) => /background/i.test(String(n))));
}

// re-attach to a transfer that outlived the app
{
  const SIZE = 2489894976;
  const { M, calls } = loadNative({ existingId: "42", script: [
    { state: "running", bytes: 9e8, total: SIZE, onDisk: 9e8 },
    { state: "done", bytes: SIZE, total: SIZE, onDisk: SIZE }
  ] });
  const notes = [];
  await M.ensure("maik-local-v1", (f, n) => { if (n) notes.push(n); });
  ok("re-attach: did NOT start a second download", calls.start === 0);
  ok("re-attach: surfaced that it resumed", notes.some((n) => /Resuming in the background/i.test(n)));
}

// a paused transfer (no connection) is reported, not treated as failure
{
  const SIZE = 2489894976;
  const { M } = loadNative({ script: [
    { state: "paused", bytes: 3e8, total: SIZE, onDisk: 3e8, reason: 2 },
    { state: "done", bytes: SIZE, total: SIZE, onDisk: SIZE }
  ] });
  const notes = [];
  await M.ensure("maik-local-v1", (f, n) => { if (n) notes.push(n); });
  ok("paused is surfaced as waiting, not failed", notes.some((n) => /Waiting for a connection/i.test(n)));
}

// OS reports done but the file is short -> reject, do not mark installed
{
  const SIZE = 2489894976;
  const { M, ls } = loadNative({ script: [{ state: "done", bytes: SIZE, total: SIZE, onDisk: SIZE - 4096 }] });
  let err = null;
  await M.ensure("maik-local-v1", () => {}).catch((e) => { err = e; });
  ok("short file rejected even when the OS says done", !!err && /size mismatch/.test(err.message));
  ok("no install marker on a short file", !("smd_maik_pack_maik-local-v1" in ls._s));
}

// pre-flight: refuse politely instead of filling the device
{
  const { M, calls } = loadNative({ freeBytes: 1e9, script: [{ state: "done", onDisk: 0 }] });
  let err = null;
  await M.ensure("maik-local-v1", () => {}).catch((e) => { err = e; });
  ok("refuses when free space is short", !!err && /not enough free space/.test(err.message));
  ok("did not start a doomed download", calls.start === 0);
}

// already on disk -> no download at all
{
  const { M, calls } = loadNative({ onDisk: 2489894976, script: [{ state: "none" }] });
  const r = await M.ensure("maik-local-v1", () => {});
  ok("already-complete file skips the OS download", r.installed === true && calls.start === 0);
}

// failure reason surfaced
{
  const { M } = loadNative({ script: [{ state: "failed", bytes: 1e8, total: 2489894976, reason: 1004 }] });
  let err = null;
  await M.ensure("maik-local-v1", () => {}).catch((e) => { err = e; });
  ok("OS failure reason surfaced", !!err && /reason 1004/.test(err.message));
}

// delete goes through the plugin on native
{
  const { M, calls, ls } = loadNative({ onDisk: 2489894976, script: [{ state: "none" }] });
  ls.setItem("smd_maik_pack_maik-local-v1", "1");
  await M.remove("maik-local-v1");
  ok("native delete uses the plugin", calls.del === 1);
  ok("native delete clears the marker", !("smd_maik_pack_maik-local-v1" in ls._s));
}

// path comes from the plugin on native (DownloadManager cannot write the internal files dir)
{
  const { M } = loadNative({ script: [{ state: "none" }] });
  ok("pathFor asks the plugin on native", (await M.pathFor("maik-local-v1")) === "/ext/maik-models/m.gguf");
}

console.log(`\nmaik-models: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
