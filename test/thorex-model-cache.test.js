/* test/thorex-model-cache.test.js — on-device model download/cache (thorex-model-cache.js + its wiring
 * into thorex-ort.js's getSession()) verification.
 *
 * Proves the "download once, then run fully offline" contract with fully injected fakes (no real
 * browser Cache API / IndexedDB / network required — everything is a Node-testable stub):
 *   (a) a cache MISS fetches the model, streams progress up to 1.0, and stores the bytes in the cache.
 *   (b) a second load with the SAME (now-populated) cache returns the bytes WITHOUT calling fetch again
 *       — the offline-after-first-run guarantee.
 *   (c) a fetch failure (network error or non-OK response) rejects with a typed `model_unavailable`
 *       error — never a fabricated/empty result.
 *   (d) the IndexedDB fallback path (when the Cache API is unavailable) round-trips correctly, and the
 *       existing model-run path (thorex-ort.js's getSession -> onnxruntime-node) still produces a valid
 *       inference session/result when the bytes are sourced through the cache instead of a raw file path
 *       — proving the caching layer is a drop-in in front of the pre-existing session-creation code.
 *
 * If onnxruntime-node is unavailable in this environment, the (d)-integration half honestly SKIPS (same
 * convention as thorex-ort.test.js) while every pure cache-logic assertion above still runs.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const MC = require("../thorex-model-cache.js");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };

// ── Fake Cache API (mirrors `caches.open(name) -> {match(url), put(url, response)}`) ─────────────────
function makeFakeCacheApi() {
  const cachesByName = new Map();
  let openCalls = 0;
  return {
    openCalls: () => openCalls,
    open: (name) => {
      openCalls++;
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      const store = cachesByName.get(name);
      return Promise.resolve({
        match: (url) => Promise.resolve(store.has(url) ? { arrayBuffer: () => Promise.resolve(store.get(url)) } : undefined),
        put: (url, response) => Promise.resolve(response.arrayBuffer()).then((ab) => { store.set(url, ab); })
      });
    },
    _raw: cachesByName
  };
}

// ── Fake fetch: streams a Buffer's bytes in chunks, honoring Content-Length + body.getReader(). ──────
function makeFakeFetch(bytesByUrl, opts) {
  opts = opts || {};
  let callCount = 0;
  const chunkSize = opts.chunkSize || 1024;
  function fetchImpl(url) {
    callCount++;
    if (opts.fail) return Promise.reject(new Error("simulated network failure"));
    const buf = bytesByUrl[url];
    if (!buf) return Promise.resolve({ ok: false, status: 404, headers: { get: () => null } });
    let offset = 0;
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (k) => (String(k).toLowerCase() === "content-length" ? String(buf.length) : null) },
      body: {
        getReader: () => ({
          read: () => {
            if (offset >= buf.length) return Promise.resolve({ done: true, value: undefined });
            const end = Math.min(offset + chunkSize, buf.length);
            const chunk = new Uint8Array(buf.subarray(offset, end));
            offset = end;
            return Promise.resolve({ done: false, value: chunk });
          }
        })
      },
      arrayBuffer: () => Promise.resolve(new Uint8Array(buf).buffer)
    });
  }
  fetchImpl.callCount = () => callCount;
  return fetchImpl;
}

// ── Fake IndexedDB (mirrors the event-based IDBRequest/IDBTransaction API idbGet/idbPut use). ────────
function makeFakeIndexedDB() {
  const store = new Map();
  let dbCreated = false;
  function req() { return { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null }; }
  const db = {
    objectStoreNames: { contains: () => dbCreated },
    createObjectStore: () => { dbCreated = true; return {}; },
    transaction: () => {
      const tx = { oncomplete: null, onerror: null };
      tx.objectStore = () => ({
        get: (key) => {
          const r = req();
          setTimeout(() => { r.result = store.has(key) ? store.get(key) : undefined; if (r.onsuccess) r.onsuccess(); }, 0);
          return r;
        },
        put: (value, key) => {
          const r = req();
          setTimeout(() => { store.set(key, value); if (r.onsuccess) r.onsuccess(); if (tx.oncomplete) tx.oncomplete(); }, 0);
          return r;
        }
      });
      return tx;
    }
  };
  return {
    open: () => {
      const r = req();
      setTimeout(() => { r.result = db; if (!dbCreated && r.onupgradeneeded) r.onupgradeneeded(); if (r.onsuccess) r.onsuccess(); }, 0);
      return r;
    },
    _store: store
  };
}

function u8Equal(a, b) {
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  if (av.length !== bv.length) return false;
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
  return true;
}

const URL = "https://fake-host.example/thorex_clinical.onnx";
const PAYLOAD = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));

// ── (a) cache MISS: fetches, reports progress to 1.0, stores the bytes. ───────────────────────────────
async function testCacheMissFetchesAndStores() {
  const cacheApi = makeFakeCacheApi();
  const fetchSpy = makeFakeFetch({ [URL]: PAYLOAD });
  const progress = [];
  const bytes = await MC.loadModelBytes(URL, { fetch: fetchSpy, caches: cacheApi, onProgress: (p) => progress.push(p) });

  ok("(a) fetch was called exactly once on a cold cache", fetchSpy.callCount() === 1);
  ok("(a) returned bytes match the fetched payload exactly", u8Equal(bytes, PAYLOAD));
  ok("(a) progress was reported and reached 1.0 (fully downloaded)", progress.length > 0 && progress[progress.length - 1] === 1);
  ok("(a) progress ticked incrementally (streamed, not a single 0->1 jump) for a multi-chunk download", progress.length > 2);
  ok("(a) progress never exceeds 1.0 or goes negative", progress.every((p) => p >= 0 && p <= 1));
  ok("(a) the bytes were stored in the Cache API store under the model URL", cacheApi._raw.get(MC.DEFAULT_CACHE_NAME).has(URL));
  return cacheApi;
}

// ── (b) SAME cache, fresh fetch spy: cache hit must return bytes WITHOUT calling fetch. ──────────────
async function testCacheHitSkipsFetch(cacheApi) {
  const fetchSpy = makeFakeFetch({ [URL]: PAYLOAD }); // would satisfy the request if called — it must NOT be
  const progress = [];
  const bytes = await MC.loadModelBytes(URL, { fetch: fetchSpy, caches: cacheApi, onProgress: (p) => progress.push(p) });

  ok("(b) fetch was NOT called on a warm cache (offline-capable)", fetchSpy.callCount() === 0);
  ok("(b) cached bytes match the originally-fetched payload exactly", u8Equal(bytes, PAYLOAD));
  ok("(b) a cache hit still reports progress=1.0 (immediate, no partial ticks)", progress.length === 1 && progress[0] === 1);
}

// ── (c) fetch failure (network error) on an empty cache -> typed model_unavailable, no fabrication. ──
async function testFetchFailureIsTypedModelUnavailable() {
  const cacheApi = makeFakeCacheApi(); // empty — forces a fetch attempt
  const fetchSpy = makeFakeFetch({}, { fail: true });
  let caught = null;
  try { await MC.loadModelBytes("https://fake-host.example/does-not-exist.onnx", { fetch: fetchSpy, caches: cacheApi }); }
  catch (e) { caught = e; }
  ok("(c) a network failure rejects (never resolves with fabricated bytes)", !!caught);
  ok("(c) the rejection carries the typed `model_unavailable` code", caught && caught.code === "model_unavailable");

  // Also cover the non-OK-HTTP-status flavor of the same failure (e.g. a 404 from a misconfigured base).
  let caught404 = null;
  try { await MC.loadModelBytes("https://fake-host.example/also-missing.onnx", { fetch: makeFakeFetch({}), caches: makeFakeCacheApi() }); }
  catch (e) { caught404 = e; }
  ok("(c) a non-OK HTTP response also rejects with `model_unavailable`", caught404 && caught404.code === "model_unavailable");

  // And the "nothing cached, no fetch available at all" flavor.
  let caughtNoFetch = null;
  try { await MC.loadModelBytes("https://fake-host.example/no-fetch.onnx", { fetch: null, caches: makeFakeCacheApi() }); }
  catch (e) { caughtNoFetch = e; }
  ok("(c) no fetch available + nothing cached also rejects with `model_unavailable`", caughtNoFetch && caughtNoFetch.code === "model_unavailable");
}

// ── (d) IndexedDB fallback (Cache API unavailable) round-trips correctly. ────────────────────────────
async function testIndexedDbFallback() {
  const idb = makeFakeIndexedDB();
  const url2 = "https://fake-host.example/thorex_xraydar.onnx";
  const payload2 = Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 7) % 256));
  const fetchSpy = makeFakeFetch({ [url2]: payload2 });

  const bytes = await MC.loadModelBytes(url2, { fetch: fetchSpy, caches: null, indexedDB: idb });
  ok("(d) IndexedDB path: first load fetches (Cache API explicitly unavailable)", fetchSpy.callCount() === 1);
  ok("(d) IndexedDB path: returned bytes match the fetched payload", u8Equal(bytes, payload2));

  const fetchSpy2 = makeFakeFetch({ [url2]: payload2 });
  const bytes2 = await MC.loadModelBytes(url2, { fetch: fetchSpy2, caches: null, indexedDB: idb });
  ok("(d) IndexedDB path: second load is served from IndexedDB WITHOUT re-fetching", fetchSpy2.callCount() === 0);
  ok("(d) IndexedDB path: bytes served from IndexedDB match the original payload", u8Equal(bytes2, payload2));
}

// ── (e) integration: thorex-ort.js's getSession() routes through the cache and still produces a valid
//    onnxruntime-node session/inference result — the "existing model-run path still works" guarantee.
//    Uses the REAL clinical model file (read via a fake fetch) so this is a genuine session-creation
//    proof, not just a bytes round-trip.
async function testExistingModelRunPathStillWorks() {
  let ort;
  try { ort = require("onnxruntime-node"); }
  catch (e) {
    console.log("thorex-model-cache: onnxruntime-node not available in this environment (" + e.message + ") — SKIPPING the model-run integration check; pure cache-logic assertions above still ran.");
    return;
  }
  const MODEL_PATH = path.join(__dirname, "..", "models", "thorex_clinical.onnx");
  const LABELS_PATH = path.join(__dirname, "..", "models", "thorex_clinical_labels.json");
  if (!fs.existsSync(MODEL_PATH)) {
    console.log("thorex-model-cache: model file not found at " + MODEL_PATH + " — SKIPPING the model-run integration check.");
    return;
  }
  const modelBuf = fs.readFileSync(MODEL_PATH);
  const labels = JSON.parse(fs.readFileSync(LABELS_PATH, "utf8"));

  // (e1) loadModelBytes + a direct onnxruntime-node session creation from the cached bytes. Large chunk
  // size here (this is a real ~27MB model file) — the small default chunk size is what part (a) above
  // uses to prove incremental progress ticks; this is proving session-creation correctness, not chunking.
  const cacheApi = makeFakeCacheApi();
  const modelUrl = "https://fake-host.example/thorex_clinical.onnx";
  const fetchSpy = makeFakeFetch({ [modelUrl]: modelBuf }, { chunkSize: 4 * 1024 * 1024 });
  const cachedBytes = await MC.loadModelBytes(modelUrl, { fetch: fetchSpy, caches: cacheApi });
  ok("(e1) cached model bytes exactly match the on-disk model file size", cachedBytes.byteLength === modelBuf.length);
  const session = await ort.InferenceSession.create(new Uint8Array(cachedBytes));
  ok("(e1) a real onnxruntime-node InferenceSession was created from cached bytes", !!session && typeof session.run === "function");

  // (e2) the FULL integration: thorex-ort.js's analyzeImage()/getSession() given `caches`+`fetch` opts
  // (no modelBytes/local-path shortcut) must transparently route through the model cache and still
  // resolve a normal analysis — proving thorex-ort.js's cacheInfraAvailable()/getSession() wiring works
  // end-to-end, not just the standalone loadModelBytes() unit above.
  global.window = global; // thorex-ort.js resolves window.SMD_THOREX_MODELS this way
  const MODELS = require("../thorex-models.js");
  global.window.SMD_THOREX_MODELS = MODELS;
  delete require.cache[require.resolve("../thorex-ort.js")];
  const ORT_ENGINE = require("../thorex-ort.js");

  const SIZE = 224;
  const pixels = new Float32Array(SIZE * SIZE).fill(128);
  const cacheApi2 = makeFakeCacheApi();
  const fetchSpy2 = makeFakeFetch({ [modelUrl]: modelBuf }, { chunkSize: 4 * 1024 * 1024 });
  const analysis = await ORT_ENGINE.analyzeImage(
    { width: SIZE, height: SIZE, data: pixels },
    { ort, modelUrl, labels, caches: cacheApi2, fetch: fetchSpy2, id: "cache-integration" }
  );
  ok("(e2) analyzeImage() sourced the model through the cache (fetch called on a cold cache)", fetchSpy2.callCount() === 1);
  ok("(e2) analyzeImage() resolved a normal clinical analysis via the cached session", MODELS.clinicalEngine(analysis) && MODELS.clinicalEngine(analysis).engine === "torchxrayvision");
  ok("(e2) the model bytes ended up stored in the fake Cache API (offline-capable on the next run)", cacheApi2._raw.get(MC.DEFAULT_CACHE_NAME).has(modelUrl));
}

(async () => {
  const cacheApi = await testCacheMissFetchesAndStores();
  await testCacheHitSkipsFetch(cacheApi);
  await testFetchFailureIsTypedModelUnavailable();
  await testIndexedDbFallback();
  await testExistingModelRunPathStillWorks();

  console.log(`\nthorex-model-cache: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.log("  ✗ FAIL: test suite threw:", e && e.stack || e);
  console.log(`\nthorex-model-cache: ${pass} passed, ${fail + 1} failed`);
  process.exit(1);
});
