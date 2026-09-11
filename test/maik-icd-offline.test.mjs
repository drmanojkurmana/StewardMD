/* test/maik-icd-offline.test.mjs — maik-engine.js icdCandidates() offline fallback to the
 * on-device index (icd.js's window.SMD_ICD.localSearch, built from icd/icd10.min.json).
 *
 * Companion to test/maik-policy.test.mjs (leave that file to the concurrent edit on
 * maik-local.js/icu.js/medlist.js/surgx-screens.js - this file only loads maik-models.js +
 * maik-engine.js, same loader shape as that file's load()). The acceptance point: offline, with
 * an on-device index present, extract("...", "icd-suggest") reaches SMD_MAIK_LOCAL.icdRank with
 * the local candidates and never fetches - see test/maik-policy.test.mjs's "network OFF" case for
 * the complementary "no local index -> ICD_INDEX_OFFLINE, never invents a code" behaviour.
 *
 * node --test test/maik-icd-offline.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ENGINE = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");
const MODELS = readFileSync(new URL("../maik-models.js", import.meta.url), "utf8");

const AI_METHODS = ["explain", "explainGrounded", "explainGroundedStream", "refine", "vivaJudge", "extract", "research",
  "maik", "summary", "imagingSummary", "correlate", "translate", "transcribe", "vision", "visionText"];
const LOCAL_FNS = ["answer", "webAnswer", "vivaJudge", "opdSuggest", "assess", "scribeFill", "noteStructure", "icdRank",
  "reasoningExtract", "maikNext", "maikExtract", "summarize", "imagingSummary", "correlate", "translate"];

// Same shape as test/maik-policy.test.mjs's load() - the real registry runs the matcher on real
// caps/suitability; the on-device engine and the cloud transport are spies.
function load(o = {}) {
  const cloud = [], local = [], fetches = [];
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  const Llama = { available: async () => ({ available: true, loaded: false, debugBuild: true, availableMemory: 0 }), excludeFromBackup: async () => ({}) };
  const localSearchCalls = [];
  const win = {
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { Filesystem: {}, Llama } },
    localStorage: ls, navigator: { onLine: o.onLine !== false },
    fetch: async (url) => { fetches.push(url); return { ok: false }; }, // the server must never be reached in these tests
    SMD_PRO: { isProSync: () => true, proKnown: () => true },
    SMD_AI: {}, SMD_MAIK_LOCAL: { available: () => true, visionReady: () => false, currentPack: () => "maik-lite" },
    SMD_ICD: {
      localSearch: (q, limit) => {
        localSearchCalls.push([q, limit]);
        return o.localCandidates || [{ id: "icd10:E11.9", system: "ICD-10", code: "E11.9", title: "Type 2 diabetes mellitus without complications", chapter: "E11", is_leaf: 1 }];
      }
    }
  };
  AI_METHODS.forEach((m) => { win.SMD_AI[m] = (...a) => { cloud.push([m, a]); return Promise.resolve({ text: "CLOUD " + m, engine: "cloud", mode: a[1] }); }; });
  LOCAL_FNS.forEach((f) => { win.SMD_MAIK_LOCAL[f] = (...a) => { local.push([f, a]); return Promise.resolve({ text: "LOCAL " + f, engine: "local", kind: f }); }; });
  win.window = win;
  new Function("window", "localStorage", "navigator", MODELS)(win, ls, win.navigator);
  new Function("window", "localStorage", "navigator", ENGINE)(win, ls, win.navigator);
  const M = win.SMD_MAIK_MODELS, E = win.SMD_MAIK_ENGINE;
  M.setDevice(Object.assign({ platform: "android", ramGB: 8, ramGBMin: false, availGB: null, hardLimit: false, freeGB: null, battery: null, at: 1 }, o.device || {}));
  const install = (id) => { ls.setItem("smd_maik_pack_" + id, "1"); ls.setItem("smd_maik_packsha_" + id, M.PACKS[M.baseIdOf(id)].files[0].sha256); };
  const inst = o.installed || ["maik-lite"];
  inst.forEach(install);
  ls.setItem("smd_maik_local_bypass", "1");
  M.setActivePack(o.active || inst[0] || "maik-lite");
  E.install();
  E.setPref(o.pref || "local");
  return { win, A: win.SMD_AI, E, cloud, local, fetches, localSearchCalls };
}

test("LOCAL mode + offline: extract icd-suggest calls SMD_ICD.localSearch and ranks the local candidates via icdRank, never fetches", async () => {
  const { A, E, cloud, local, fetches, localSearchCalls } = load({ onLine: false });
  assert.equal(E.effective(), "local");

  const r = await A.extract("type 2 diabetes", "icd-suggest");

  assert.equal(fetches.length, 0, "the server is never reached while offline");
  assert.equal(cloud.length, 0, "no cloud AI inference");
  assert.equal(localSearchCalls.length, 1);
  assert.equal(localSearchCalls[0][0], "type 2 diabetes");

  const icdRankCall = local.find(([f]) => f === "icdRank");
  assert.ok(icdRankCall, "icdRank was called");
  const [, args] = icdRankCall;
  assert.equal(args[0], "type 2 diabetes", "the original text reaches the ranker");
  assert.equal(args[1][0].code, "E11.9", "the on-device candidates reach the ranker, not invented ones");
  assert.equal(args[1][0].id, "icd10:E11.9");

  assert.equal(r.text, "LOCAL icdRank");
});

test("LOCAL mode + offline + no on-device candidates: icdRank still runs with an empty list (never invents a code)", async () => {
  const { A, local, localSearchCalls } = load({ onLine: false, localCandidates: [] });
  await A.extract("some rare thing", "icd-suggest");
  assert.equal(localSearchCalls.length, 1);
  const icdRankCall = local.find(([f]) => f === "icdRank");
  assert.ok(icdRankCall);
  assert.deepEqual(icdRankCall[1][1], []);
});
