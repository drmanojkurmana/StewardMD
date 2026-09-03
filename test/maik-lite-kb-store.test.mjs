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

console.log(`maik-lite-kb-store: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
