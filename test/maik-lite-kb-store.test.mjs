/* test/maik-lite-kb-store.test.mjs — regression for a real on-device crash (2026-09-03):
 * String.fromCharCode.apply(null, largeArray) blows the JS call-stack limit well before the
 * 2 MiB chunk size the downloader actually uses ("Maximum call stack size exceeded", caught live
 * via CDP against the real app). The fix sub-chunks in 0x8000-byte pieces before btoa(), the same
 * pattern already proven in maik-models.js's abToB64(). This file exercises that exact conversion
 * at the real chunk size, so a regression back to the naive one-shot call surfaces here, not on
 * a phone mid-download. */
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };

// Extracted verbatim from kb/ai/maik-lite-kb-store.js's chunk-conversion step.
function abToB64Chunked(ab) {
  var bytes = new Uint8Array(ab), bin = "", CH = 0x8000;
  for (var bi = 0; bi < bytes.length; bi += CH) bin += String.fromCharCode.apply(null, bytes.subarray(bi, bi + CH));
  return btoa(bin);
}
function abToB64Naive(ab) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(ab)));
}

const CHUNK_BYTES = 2 * 1024 * 1024;   // the real download chunk size
const buf = new Uint8Array(CHUNK_BYTES);
for (let i = 0; i < buf.length; i++) buf[i] = i % 256;

{
  let threw = null;
  try { abToB64Naive(buf.buffer); } catch (e) { threw = e; }
  ok("REGRESSION: the naive one-shot conversion actually does crash at real chunk size (proves this is a real bug, not a hypothetical)",
     threw && /call stack/i.test(threw.message));
}

{
  let threw = null, out = null;
  try { out = abToB64Chunked(buf.buffer); } catch (e) { threw = e; }
  ok("the sub-chunked conversion does not crash at the real 2 MiB chunk size", !threw);
  ok("and produces valid base64 matching Node's own encoder",
     out === Buffer.from(buf).toString("base64"));
}

{
  // Boundary cases: exactly one sub-chunk, and a size that does not divide evenly.
  const small = new Uint8Array(0x8000); for (let i = 0; i < small.length; i++) small[i] = (i * 7) % 256;
  ok("exact sub-chunk boundary matches Node's encoder", abToB64Chunked(small.buffer) === Buffer.from(small).toString("base64"));
  const odd = new Uint8Array(0x8000 + 137); for (let i = 0; i < odd.length; i++) odd[i] = (i * 13) % 256;
  ok("a size that does not divide evenly still matches Node's encoder", abToB64Chunked(odd.buffer) === Buffer.from(odd).toString("base64"));
}

// ── REGRESSION: loadBook() must request utf8, or Capacitor silently hands back base64 ──
// Real Capacitor Filesystem.readFile() returns BASE64 unless `encoding` is explicitly passed
// (exactly what ensure()'s own sha-256 check above relies on). loadBook() forgot the encoding
// option, so every JSONL line failed JSON.parse silently and the book built with ZERO rows -
// found live, 2026-09-03, on a KB that reported "installed" and passed its own sha-256 check.
// This mock reproduces Capacitor's real default so a regression back to no-encoding surfaces
// here, not as a silently-empty on-device index.
{
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const RAG = require("../kb/ai/maik-lite-rag.js");

  const jsonl = [{ i: 0, text: "x".repeat(300), headings: ["A"], pages: [1] },
                 { i: 1, text: "y".repeat(300), headings: ["B"], pages: [2] }].map((r) => JSON.stringify(r)).join("\n");

  function makeKbStore() {
    const Filesystem = {
      stat: async () => ({ size: 37976783 }),   // matches the module's BYTES constant exactly
      mkdir: async () => ({}),
      readFile: async (o) => {
        // The exact real-world behaviour: base64 by default, raw text only when asked.
        return { data: o.encoding === "utf8" ? jsonl : Buffer.from(jsonl, "utf8").toString("base64") };
      },
      appendFile: async () => ({}), deleteFile: async () => ({})
    };
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
    var store = {
      // Pre-seed BOTH markers so installed()/installedCached() short-circuit true and ensure()
      // never touches the network - the module's own sha256 constant, not the mock's fake content.
      "smd_maik_kb_installed": "1",
      "smd_maik_kb_sha": "96b4504ac62dfa50d672913aa7d52fbdb5f949de0b52dc9aed2fd73e74be480b"
    };
    const win = { Capacitor: { isNativePlatform: () => true, Plugins: { Filesystem } },
                  crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } }, localStorage: ls };
    win.window = win; win.self = win;
    const src = require("node:fs").readFileSync(require.resolve("../kb/ai/maik-lite-kb-store.js"), "utf8");
    const mod = { exports: {} };
    new Function("module", "self", "window", "localStorage", "btoa", "atob", "crypto", src)(
      mod, win, win, ls,
      (s) => Buffer.from(s, "binary").toString("base64"),
      (s) => Buffer.from(s, "base64").toString("binary"),
      win.crypto);
    return mod.exports;
  }

  const KB = makeKbStore();
  ok("pre-seeded markers mean the mock IS already installed (no network path taken)", KB.installedCached() === true);
  const bk = await KB.loadBook(RAG).catch((e) => { throw new Error("loadBook rejected: " + e.message); });
  ok("loadBook() parses real rows from the file (not zero, the live symptom of the encoding bug)",
     bk.rows.length === 2);
  ok("row content actually round-tripped correctly", bk.rows[0].headings[0] === "A" && bk.rows[1].headings[0] === "B");
}

console.log(`maik-lite-kb-store: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
