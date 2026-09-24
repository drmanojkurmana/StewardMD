/* test/maik-memory.test.mjs — conversation memory (owner, 2026-09-24): "fix the saved chat memory",
 * "opening an old chat makes the chips not work", "memory big enough to remember the conversation
 * without eating tokens", "big context for offline models". Pinned at every layer. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const S = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

const gist = new Function(H.slice(H.indexOf("function maikGist("), H.indexOf("function maikRememberTurn(")) + "return maikGist;")();

test("an answer is remembered as a gist: opening line and the drug lines, no citations or footer", () => {
  const md = "First-line therapy is an ACE inhibitor or a thiazide [1].\n\nBackground paragraph that goes on about the physiology of the renin angiotensin system for a long while without numbers.\n- Amlodipine 5 to 10 mg daily\n- Losartan 50 mg daily\nVerify against local protocol.\nSource: StewardMD Knowledge Base";
  const g = gist(md, 1200);
  assert.match(g, /^First-line therapy is an ACE inhibitor or a thiazide\./);
  assert.match(g, /Amlodipine 5 to 10 mg daily/); assert.match(g, /Losartan 50 mg daily/);
  assert.doesNotMatch(g, /\[1\]|Source:|Verify against|renin angiotensin/);
  assert.ok(gist("x ".repeat(2000), 300).length <= 301, "the cap holds");
});

test("a reopened conversation rebuilds memory and re-wires its controls", () => {
  assert.equal((H.match(/body\.innerHTML = _maikBodyHTML; maikRestoreThread\(\);/g) || []).length, 2, "both restore paths");
  const fn = H.slice(H.indexOf("function maikRestoreThread()"), H.indexOf("function maikRestoreThread()") + 600);
  assert.match(fn, /_maikTurns = \[\];/); assert.match(fn, /maikRewire\(n, q\)/); assert.match(fn, /maikRememberTurn\(q, maikAnswerText\(n\)\)/);
  const rw = H.slice(H.indexOf("function maikRewire("), H.indexOf("function maikRestoreThread()"));
  for (const k of ["Copy", "Regenerate", "Edit", "Yes", "No", ".maik-rx"]) assert.ok(rw.includes(k), k);
});

test("chips that resend a question and figure cards are delegated, so a restored thread keeps them", () => {
  assert.match(H, /closest\("\[data-maik-send\]"\)/); assert.match(H, /closest\("\.maik-fig"\)/);
  assert.doesNotMatch(H, /qEl\.value = val; \} catch \(e\) \{\} send\(\); \}\);/);
  assert.doesNotMatch(H, /qEl\.value = base \+ s; \} catch \(e\) \{\} send\(\); \}\);/);
  assert.match(H, /rb\.setAttribute\("data-maik-web", q\)/);
});

test("the engines get 6 gisted turns plus the older topics, never whole answers", () => {
  assert.match(H, /pkg\.history = _maikTurns\.slice\(-6\)\.map\(function \(t\) \{ return \{ q: t\.q, a: t\.g \|\| t\.a \}; \}\);/);
  assert.match(H, /if \(_maikTurns\.length > 16\) _maikTurns\.shift\(\);/);
  assert.match(S, /clip\(h\.a, i === H\.length - 1 \? 1200 : 450\)/);
  assert.match(S, /EARLIER IN THIS CONVERSATION/);
});

function load(mem, { failBig = false } = {}) {
  const loads = [];
  const Llama = { available: async () => Object.assign({ available: true, loaded: false }, mem),
    load: async (o) => { loads.push(o.nCtx); if (failBig && o.nCtx > 4096) throw new Error("low-memory"); return { loaded: true }; },
    generate: async () => ({ text: "ok", ms: 5 }), cancel: async () => ({}), release: async () => ({ released: true }), addListener: () => ({ remove: () => {} }) };
  const PACKS = { "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true } };
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_RAG: require("../kb/ai/maik-lite-rag.js"), SMD_MAIK_GROUND: require("../kb/ai/maik-grounding.js"),
    SMD_MAIK_MODELS: { PACKS, caps: () => ({ kb: true, kvGBat4k: 0.47 }), pathFor: async () => "/tmp/x.gguf", totalBytes: () => 1.1e9, isInstalled: () => true },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }
  };
  new Function("window", "localStorage", SRC)(win, win.localStorage);
  return { L: win.SMD_MAIK_LOCAL, loads, PACKS };
}

test("offline: an 8K window when the phone has room, 4K when it cannot tell or the load is refused", async () => {
  let t = load({ availableMemory: 5e9, memoryIsHardLimit: true }); await t.L.warm("maik-lite");
  assert.deepEqual(t.loads, [8192]); assert.equal(t.PACKS["maik-lite"]._ctx, 8192);
  t = load({ availableMemory: 1.5e9, memoryIsHardLimit: true }); await t.L.warm("maik-lite");
  assert.deepEqual(t.loads, [4096], "not enough headroom on iOS");
  t = load({}); await t.L.warm("maik-lite");
  assert.deepEqual(t.loads, [4096], "no reading: stay at the proven size");
  t = load({ availableMemory: 5e9, memoryIsHardLimit: true }, { failBig: true }); await t.L.warm("maik-lite");
  assert.deepEqual(t.loads, [8192, 4096], "a refused 8K falls back"); assert.equal(t.PACKS["maik-lite"]._ctx, 4096);
});

test("offline: the 8K window carries twice the turns", async () => {
  const hist = [];
  for (const d of ["amlodipine", "losartan", "hydrochlorothiazide", "chlorthalidone"]) hist.push({ q: "hypertension " + d + "?", a: "Hypertension: " + d + " is used." });
  const pkg = { question: "hypertension chlorthalidone dose", history: hist };
  const t = load({ availableMemory: 5e9, memoryIsHardLimit: true });
  const small = t.L.buildPrompt(pkg, "maik-lite");
  await t.L.warm("maik-lite");
  const big = t.L.buildPrompt(pkg, "maik-lite");
  assert.equal((small.match(/^Doctor:/gm) || []).length, 2);
  assert.equal((big.match(/^Doctor:/gm) || []).length, 4);
});
