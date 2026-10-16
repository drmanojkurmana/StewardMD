/* test/embed-local.test.mjs — on-phone semantic search (EmbeddingGemma 2).
 *
 * Pure-JS coverage for the local retrieval tier: the search-pack registry entry
 * (exact size/sha, never a chat model), the vector loader (IndexedDB cache then
 * bank fetch, strict validation), dequantise (v = q / scale), cosine top-K, the
 * tier-selection matrix (flag / pack / plugin / vectors), and the no-network
 * guarantee when the local tier serves from cache.
 *
 * Nothing here touches the network, the native bridge, or the DOM: fetch, the
 * IDB store, localStorage, Capacitor and SMD_MAIK_MODELS are all fakes.
 * Run: node test/embed-local.test.mjs  (also runs under `node --test` in CI)
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const DIMS = 768;
const EMBED_SHA = "a9d7a3b7eb421113f05e964e10882676f10fff83811b7876d5bb983db7c7ac41";

/* ── maik-models.js registry ─────────────────────────────────────────── */
function fakeLS(seed) {
  const s = Object.assign({}, seed);
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s };
}
function loadModels() {
  const win = { Capacitor: { isNativePlatform: () => false, Plugins: {} } };
  const mod = { exports: {} };
  new Function("module", "window", "localStorage", src("maik-models.js"))(mod, win, fakeLS());
  return mod.exports;
}
const M = loadModels();
{
  const f = M.pack("embedding-gemma-2").files[0];
  ok("embed pack file name", f.name === "embeddinggemma-2-UD-Q5_K_XL.gguf");
  ok("embed pack size is exactly 210,055,680 bytes", f.bytes === 210055680);
  ok("embed pack sha256 verified on MKK", f.sha256 === EMBED_SHA);
  ok("embed pack URL is the unsloth GGUF", f.url === "https://huggingface.co/unsloth/embeddinggemma-2-GGUF/resolve/main/embeddinggemma-2-UD-Q5_K_XL.gguf?download=true");
  ok("size label reads 210 MB", M.sizeLabel("embedding-gemma-2") === "210 MB");
  ok("isEmbed true for the search pack", M.isEmbed("embedding-gemma-2") === true);
  ok("isEmbed false for chat packs", M.isEmbed("maik-lite") === false && M.isEmbed("maik-mxcore") === false);
  ok("embedIds lists only the search pack", JSON.stringify(M.embedIds()) === JSON.stringify(["embedding-gemma-2"]));
  ok("packIds unchanged: no search pack in chat order", !M.packIds().includes("embedding-gemma-2"));
  ok("recommend never offers the search pack",
    !M.recommend({}, {}).recommended.concat(M.recommend({}, {}).unsuitable).some((r) => r.id === "embedding-gemma-2"));
  ok("setActivePack refuses the search pack", M.setActivePack("embedding-gemma-2") === "maik-lite");
  ok("setActivePack still takes chat packs", M.setActivePack("maik-mxcore") === "maik-mxcore");
  const c = M.caps("embedding-gemma-2");
  ok("caps resolves the search pack with a generous 6 GB floor", !!c && c.ramGB === 6 && c.bytes === 210055680);
  ok("caps still null for removed packs", M.caps("medmo-4b") === null && M.caps("no-such-pack") === null);
  let threw = false;
  try { M.pack("no-such-pack"); } catch (e) { threw = true; }
  ok("pack still throws for unknown ids", threw);
}

/* ── maik-engine.js: search row, never a chat row ─────────────────────── */
{
  const E = src("maik-engine.js");
  ok("engine renders a dedicated search section", E.includes("searchSectionHTML"));
  ok("search row carries the SEARCH pill, not a grade", E.includes('pill("SEARCH"'));
  ok("search row labelled Search on this phone", E.includes("Search on this phone"));
  ok("search row uses the same action buttons (download/delete wiring)", E.includes("actionBtnHTML(id, st, have)"));
  ok("chat shelves exclude the search pack", E.includes("!isEm(id)"));
  ok("answering picker excludes the search pack", E.includes("M.isEmbed(pid)"));
  ok("search row never takes the answering upgrade path", !/searchRowHTML[\s\S]{0,4000}data-me-upgrade/.test(E));
}

/* ── steward-ai.browser.js: tier order ───────────────────────────────── */
{
  const S = src("kb/ai/steward-ai.browser.js");
  const iLocal = S.indexOf("localDiseaseIds(opts.question");
  const iServer = S.indexOf("vectorDiseaseIds(opts.question");
  ok("local tier is attempted", iLocal > 0);
  ok("local tier runs before the server arm", iLocal > 0 && iServer > 0 && iLocal < iServer);
  ok("server arm still gated by smdHybridOn (cloudAllowed policy)", /!vecIds\.length && smdHybridOn\(\)/.test(S));
  ok("local tier has no cloud gate of its own", !/cloudAllowed[\s\S]{0,120}localDiseaseIds/.test(S) && !/localDiseaseIds[\s\S]{0,120}cloudAllowed/.test(S));
  ok("missing embed module falls back silently", S.includes('typeof E.localTier !== "function"'));
}

/* ── embed-local.js: loader, maths, tiers ────────────────────────────── */
function loadEmbed() {
  const mod = { exports: {} };
  new Function("module", src("kb/ai/embed-local.js"))(mod);
  return mod.exports;
}
function memStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    _m: m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, v); return null; }
  };
}
// 3-disease fixture at full 768 dims: A = e0, B = e1, C = zero vector (unit rows, like production).
function fixture() {
  const ids = ["flu-A", "tb-B", "zero-C"];
  const q = new Int8Array(ids.length * DIMS);
  q[0 * DIMS + 0] = 100;
  q[1 * DIMS + 1] = 100;
  const bytes = q.buffer.slice(0);
  const meta = { ids, dims: DIMS, scale: 100, model: "test" };
  return { ids, meta, bytes };
}
const unit = (i) => Array.from({ length: DIMS }, (_, j) => (j === i ? 1 : 0));

function globals({ flag, pack, embed, fetch } = {}) {
  const g = globalThis;
  const keep = { ls: g.localStorage, mm: g.SMD_MAIK_MODELS, cap: g.Capacitor, f: g.fetch };
  const s = {};
  if (flag) s["smd_local_embed"] = "1";
  g.localStorage = { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; } };
  g.SMD_MAIK_MODELS = pack ? { installedCached: (id) => id === "embedding-gemma-2" } : { installedCached: () => false };
  g.Capacitor = embed ? { Plugins: { Llama: { embed } } } : { Plugins: {} };
  if (fetch === null) delete g.fetch; else if (fetch !== undefined) g.fetch = fetch;
  return () => { g.localStorage = keep.ls; g.SMD_MAIK_MODELS = keep.mm; g.Capacitor = keep.cap; g.fetch = keep.f; };
}

{
  const E = loadEmbed();
  // dequantise: v = q / scale, exact binary fractions
  const dq = E.dequantise(new Int8Array([64, -128, 0]).buffer, 128);
  ok("dequantise divides by scale", dq[0] === 0.5 && dq[1] === -1 && dq[2] === 0);
  let bad = false;
  try { E.dequantise(new Int8Array([1, 2]).buffer, 0); } catch (e) { bad = true; }
  ok("dequantise rejects a non-positive scale", bad);

  // cosine top-K on the fixture (dequantised rows are e0, e1, zero)
  const { ids, meta } = fixture();
  const mat = E.dequantise(fixture().bytes, 100);
  const top = E.cosineTopK(mat, ids, new Float32Array(unit(0)), 3);
  ok("query e0 ranks A first with cosine about 1",
    top[0].id === "flu-A" && Math.abs(top[0].score - 1) < 1e-6);
  ok("orthogonal disease scores about 0", Math.abs(top[1].score) < 1e-6 && Math.abs(top[2].score) < 1e-6);
  ok("k larger than the pool clamps", E.cosineTopK(mat, ids, new Float32Array(unit(0)), 99).length === 3);
  ok("k of 0 gives []", E.cosineTopK(mat, ids, new Float32Array(unit(0)), 0).length === 0);
  ok("wrong query length gives []", E.cosineTopK(mat, ids, new Float32Array(4), 2).length === 0);
  ok("topDiseases with nothing loaded gives []", E.topDiseases(new Float32Array(unit(0)), 2).length === 0);
  void meta;
}

// loader: cache hit costs zero fetches; validation rejects bad files
{
  const E = loadEmbed();
  const { meta, bytes } = fixture();
  const calls = [];
  const fx = async (url) => { calls.push(url); throw new Error("must not fetch"); };
  const restore = globals({ fetch: fx });
  const store = memStore({ "v1/kb/kb-vectors-q5.json": meta, "v1/kb/kb-vectors-q5.i8": bytes });
  const v = await E.loadVectors({ fetch: fx, store });
  ok("cache hit loads 3 diseases at 768 dims", v.ids.length === 3 && v.dims === 768 && v.scale === 100);
  ok("cache hit performs zero fetches", calls.length === 0);
  ok("second call reuses memory, still zero fetches", (await E.loadVectors({ fetch: fx, store })).ids.length === 3 && calls.length === 0);
  ok("cached matrix ranks A first", E.topDiseases(new Float32Array(unit(0)), 1)[0].id === "flu-A");
  restore();
}
{
  const E = loadEmbed();
  const restore = globals({ fetch: async () => { throw new Error("offline"); } });
  let rejected = false;
  try { await E.loadVectors({ fetch: async () => { throw new Error("offline"); }, store: memStore() }); }
  catch (e) { rejected = true; }
  ok("offline with cold cache rejects (caller falls back)", rejected);
  restore();
}
for (const [name, m, b] of [
  ["dims mismatch", { ids: ["x"], dims: 100, scale: 1 }, new ArrayBuffer(DIMS)],
  ["byte length mismatch", { ids: ["x", "y"], dims: DIMS, scale: 1 }, new ArrayBuffer(DIMS)],
  ["missing ids", { dims: DIMS, scale: 1 }, new ArrayBuffer(0)]
]) {
  const E = loadEmbed();
  const restore = globals({});
  let rejected = false;
  try {
    await E.loadVectors({ fetch: async () => { throw new Error("must not fetch"); }, store: memStore({ "v1/kb/kb-vectors-q5.json": m, "v1/kb/kb-vectors-q5.i8": b }) });
  } catch (e) { rejected = true; }
  ok("loader rejects " + name, rejected);
  restore();
}
// loader fetch path: meta then bytes, stored back under the bank paths
{
  const E = loadEmbed();
  const { meta, bytes } = fixture();
  const seen = [];
  const fx = async (url) => {
    seen.push(url);
    if (url.endsWith(".json")) return { ok: true, json: async () => meta };
    return { ok: true, arrayBuffer: async () => bytes.slice(0) };
  };
  const restore = globals({ fetch: fx });
  const store = memStore();
  const v = await E.loadVectors({ fetch: fx, store });
  ok("fetch path loads and validates", v.ids.length === 3 && v.dims === 768);
  ok("fetch path hits meta then bytes", seen.length === 2 && seen[0].endsWith("kb-vectors-q5.json") && seen[1].endsWith("kb-vectors-q5.i8"));
  ok("fetch path caches under the bank paths", store._m.has("v1/kb/kb-vectors-q5.json") && store._m.has("v1/kb/kb-vectors-q5.i8"));
  restore();
}

// tier matrix: flag x pack x plugin x vectors
async function tier({ flag, pack, embedVec, cold, embedThrows }) {
  const E = loadEmbed();
  const { meta, bytes } = fixture();
  const fetchCalls = [];
  const fx = async () => { fetchCalls.push(1); throw new Error("must not fetch"); };
  const seenKind = [];
  const embed = embedThrows
    ? async () => { throw new Error("native failed"); }
    : embedVec
      ? async (arg) => { seenKind.push(arg && arg.kind); return { vector: embedVec }; }
      : null;
  const restore = globals({ flag, pack, embed, fetch: fx });
  const store = cold ? memStore() : memStore({ "v1/kb/kb-vectors-q5.json": meta, "v1/kb/kb-vectors-q5.i8": bytes });
  const ids = await E.localTier("fever with rash", 2, { fetch: fx, store });
  restore();
  return { ids, fetchCalls: fetchCalls.length, seenKind };
}
{
  const full = await tier({ flag: true, pack: true, embedVec: unit(0) });
  ok("full tier returns ranked disease ids", JSON.stringify(full.ids) === JSON.stringify(["flu-A", "tb-B"]));
  ok("serving from cache performs zero fetches", full.fetchCalls === 0);
  ok("native embed is asked for kind query", JSON.stringify(full.seenKind) === JSON.stringify(["query"]));

  const off = await tier({ flag: false, pack: true, embedVec: unit(0) });
  ok("flag off gives [] with zero fetches", off.ids.length === 0 && off.fetchCalls === 0);

  const nopack = await tier({ flag: true, pack: false, embedVec: unit(0) });
  ok("pack missing gives []", nopack.ids.length === 0);

  const noplug = await tier({ flag: true, pack: true, embedVec: null });
  ok("no native embed gives []", noplug.ids.length === 0);

  const throws = await tier({ flag: true, pack: true, embedVec: unit(0), embedThrows: true });
  ok("native failure gives []", throws.ids.length === 0);

  const E2 = loadEmbed();
  const restore = globals({ flag: true, pack: true, embed: async () => ({ vector: unit(0).slice(0, 4) }) });
  const { meta, bytes } = fixture();
  const odd = await E2.localTier("fever", 2, { fetch: async () => { throw new Error("x"); }, store: memStore({ "v1/kb/kb-vectors-q5.json": meta, "v1/kb/kb-vectors-q5.i8": bytes }) });
  ok("wrong-length native vector gives []", odd.length === 0);
  restore();

  const E3 = loadEmbed();
  const restore3 = globals({ flag: true, pack: true, embed: async () => ({ vector: unit(0) }) });
  const emptyQ = await E3.localTier("   ", 2, { fetch: async () => { throw new Error("x"); }, store: memStore() });
  ok("blank query gives [] without fetching", emptyQ.length === 0);
  restore3();
}

console.log(fail === 0 ? ("ALL " + pass + " PASS") : (pass + " pass / " + fail + " FAIL"));
process.exit(fail ? 1 : 0);
