// scripts/edge/embed-parity.mjs: rank KB diseases for a DEVICE query vector.
//
// Device test for on-phone embed() (draft PR "NATIVE: on-phone embed()"): the phone resolves
// L.embed({text, kind:"query"}) -> {vector:[768]}; this script scores that vector against the
// shipped int8 bank (kb-vectors-q5.{json,i8}) with the same maths as kb/ai/embed-local.js
// (dequantise v = q/scale, L2-normalise the query, cosine top-K) and prints the top ids.
//
//   node scripts/edge/embed-parity.mjs --vectors kb-vectors-q5.json --i8 kb-vectors-q5.i8 \
//     --query query.json [--top 5]
//
// query.json is the device's resolved value: {vector:[...]} or a bare [...] array.
// Expected (ground truth from llama-server /v1/embeddings, Q5_K_XL, normalised):
//   "burning urination"      -> urinary-tract diseases in the top 5
//   "yellow eyes newborn"    -> neonatal_jaundice first
//
// Self-check without a device (bank self-consistency, no model needed):
//   node scripts/edge/embed-parity.mjs --vectors ... --i8 ... --selftest
// feeds dequantised row 0 back as the query; row 0 must rank first with score ~1.0.
import fs from "node:fs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const has = (k) => argv.includes(k);

function fail(msg) { console.error("embed-parity: " + msg); process.exit(1); }

function loadBank(metaPath, i8Path) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); }
  catch (e) { fail("cannot read meta " + metaPath + ": " + e.message); }
  if (!meta || !Array.isArray(meta.ids) || !meta.ids.length) fail("bad meta: ids missing");
  if (meta.dims !== 768) fail("bad meta: dims=" + meta.dims + " want 768");
  if (typeof meta.scale !== "number" || !(meta.scale > 0)) fail("bad meta: scale missing");
  let raw;
  try { raw = fs.readFileSync(i8Path); }
  catch (e) { fail("cannot read i8 " + i8Path + ": " + e.message); }
  const n = meta.ids.length * meta.dims;
  if (raw.length !== n) fail("i8 size " + raw.length + " != ids*dims " + n);
  // Dequantise v = q/scale, row-major Int8 -> Float64Array matrix (same as embed-local.js).
  const q = new Int8Array(raw.buffer, raw.byteOffset, raw.length);
  const matrix = new Float64Array(n);
  for (let i = 0; i < n; i++) matrix[i] = q[i] / meta.scale;
  return { ids: meta.ids, dims: meta.dims, matrix };
}

function normaliseInPlace(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s);
  if (n > 1e-12) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function topK(bank, qv, k) {
  if (!qv || qv.length !== bank.dims) fail("query vector length " + (qv && qv.length) + " != 768");
  const q = normaliseInPlace(Float64Array.from(qv));
  const scored = new Array(bank.ids.length);
  for (let i = 0; i < bank.ids.length; i++) {
    let s = 0;
    const off = i * bank.dims;
    for (let j = 0; j < bank.dims; j++) s += bank.matrix[off + j] * q[j];
    scored[i] = s;
  }
  const order = scored.map((_, i) => i).sort((a, b) => scored[b] - scored[a]);
  return order.slice(0, k).map((i) => ({ id: bank.ids[i], score: scored[i] }));
}

function loadQuery(p) {
  let j;
  try { j = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { fail("cannot read query " + p + ": " + e.message); }
  const v = Array.isArray(j) ? j : j.vector || j.embedding || j.data;
  if (!v || v.length !== 768) fail("query file must hold 768 floats ({vector:[...]} or [...])");
  return v.map(Number);
}

const metaPath = opt("--vectors", null), i8Path = opt("--i8", null);
if (!metaPath || !i8Path) fail("usage: embed-parity.mjs --vectors kb-vectors-q5.json --i8 kb-vectors-q5.i8 --query q.json [--top 5]");
const bank = loadBank(metaPath, i8Path);

if (has("--selftest")) {
  // Row 0 as its own query: must come back first at ~1.0 (bank self-consistency).
  const q = Array.from(bank.matrix.slice(0, bank.dims));
  const top = topK(bank, q, 3);
  console.log("selftest rows=" + bank.ids.length + " dims=" + bank.dims);
  for (const r of top) console.log("  " + r.id + " " + r.score.toFixed(4));
  if (top[0].id !== bank.ids[0] || top[0].score < 0.999) { console.error("SELFTEST FAIL"); process.exit(1); }
  console.log("SELFTEST OK");
  process.exit(0);
}

const qPath = opt("--query", null);
if (!qPath) fail("need --query <device vector json> or --selftest");
const top = topK(bank, loadQuery(qPath), Number(opt("--top", "5")) || 5);
for (const r of top) console.log(r.id + " " + r.score.toFixed(4));
