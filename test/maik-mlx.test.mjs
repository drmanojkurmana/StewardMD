/* test/maik-mlx.test.mjs - MLX as a second on-device engine on iPhone (owner, 2026-09-28).
 *
 * The rules pinned here:
 *  1. Flag smd_maik_mlx is OFF by default and MLX exists only on iOS. Off (or on Android), nothing
 *     changes: no MLX ids, no MLX load, and maik-local.js gets the Llama plugin object itself.
 *  2. Registry: every MLX file is pinned to a Hugging Face commit with a sha256, weights download
 *     last, and the flat on-disk names never collide with a GGUF.
 *  3. Engine choice: MLX only when the flag is on, every MLX file is verified, the Mlx plugin is
 *     linked and the load is not for images. Anything else answers on llama.cpp.
 *  4. MLX never costs an answer: an MLX load failure falls back to the GGUF on llama.cpp and deletes
 *     nothing.
 *  5. The native plugin keeps the JS contract (method and event names) and is linked into the iOS
 *     app, which is on iOS 17 for it (owner, phase 4). Static checks; no Xcode here.
 *  6. Labs switch: shown on an iPhone build with the plugin, off by default; setMlxEnabled flips it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const MODELS_SRC = read("maik-models.js");
const LOCAL_SRC = read("maik-local.js");

function fakeLS(seed = {}) {
  const s = { ...seed };
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s };
}

/** maik-models.js on a fake device. `platform` is what Capacitor reports; `Llama` stubs the native side. */
function models({ platform = "ios", flag = null, Llama = {} } = {}) {
  const ls = fakeLS(flag == null ? {} : { smd_maik_mlx: flag });
  const win = {
    Capacitor: { isNativePlatform: () => true, getPlatform: () => platform, Plugins: { Llama, Filesystem: {} } },
    localStorage: ls
  };
  new Function("window", "localStorage", "setTimeout", MODELS_SRC)(win, ls, () => 0);
  return { M: win.SMD_MAIK_MODELS, ls };
}

/** Mark every MLX file of a pack as downloaded and verified, the way nativeDownload() does. */
function markInstalled(M, ls, id) {
  for (const sid of M.mlxIdsOf(id)) {
    const f = M.mlxFiles(id).find((x) => sid.endsWith(":" + x.file));
    ls.setItem("smd_maik_pack_" + sid, "1");
    ls.setItem("smd_maik_packsha_" + sid, f.sha256);
  }
}

test("flag off by default, and on Android: MLX is inert", () => {
  for (const [platform, flag] of [["ios", null], ["ios", "0"], ["android", "1"], ["web", "1"]]) {
    const { M, ls } = models({ platform, flag });
    assert.equal(M.mlxEnabled(), false, platform + " flag=" + flag);
    markInstalled(M, ls, "bonsai-ternary-8b");
    assert.equal(M.mlxReady("bonsai-ternary-8b"), false, "ready needs the flag and iOS");
  }
  const { M } = models({ platform: "ios", flag: "1" });
  assert.equal(M.mlxEnabled(), true);
});

test("registry: pinned, hashed, weights last, no name collisions", () => {
  const { M } = models();
  const withMlx = M.packIds().filter((id) => M.hasMlx(id));
  // Only MAiK Prime: the 8.62 GB MAiK Max 2 MLX build was dropped (owner, 2026-09-28).
  assert.deepEqual(withMlx.sort(), ["bonsai-ternary-8b"]);
  assert.equal(M.hasMlx("bonsai2-27b"), false);
  const ggufNames = new Set(M.packIds().flatMap((id) => M.PACKS[id].files.map((f) => f.name)));
  const seen = new Set();
  for (const id of withMlx) {
    const files = M.mlxFiles(id);
    assert.ok(files.some((f) => f.file === "config.json") && files.some((f) => f.file === "tokenizer.json"));
    for (const f of files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/, f.name);
      assert.ok(f.bytes > 0, f.name);
      assert.match(f.url, /\/resolve\/[0-9a-f]{40}\//, "pinned to a commit, never main: " + f.url);
      assert.ok(!ggufNames.has(f.name) && !seen.has(f.name), "unique on-disk name " + f.name);
      seen.add(f.name);
    }
    const ids = M.mlxIdsOf(id);
    assert.equal(ids.length, files.length);
    assert.ok(ids[ids.length - 1].endsWith(":model.safetensors"), "weights download last");
    assert.equal(M.mlxMainIdOf(id), ids[ids.length - 1]);
    for (const sid of ids) {
      assert.equal(M.isMlxId(sid), true);
      assert.equal(M.baseIdOf(sid), id);
      assert.equal(M.PACKS[sid], undefined, "sub-pack ids are not registry keys");
      assert.equal(M.totalBytes(sid), M.mlxFiles(id).find((f) => sid.endsWith(":" + f.file)).bytes);
    }
  }
  // Exact byte totals, from the Hugging Face API and the files hashed at the pinned commits.
  assert.equal(M.mlxBytes("bonsai-ternary-8b"), 3118 + 11422650 + 348 + 4063 + 64065 + 2303661704);
});

test("mlxReady only when every MLX file is verified; a moved hash un-readies it", () => {
  const { M, ls } = models({ flag: "1" });
  const id = "bonsai-ternary-8b";
  assert.equal(M.mlxReady(id), false);
  markInstalled(M, ls, id);
  assert.equal(M.mlxReady(id), true);
  // One stale hash (a re-pinned file) and the whole MLX build is not ready.
  ls.setItem("smd_maik_packsha_" + M.mlxMainIdOf(id), "0".repeat(64));
  assert.equal(M.mlxReady(id), false);
  // A pack without an MLX build is never ready.
  assert.equal(M.mlxReady("maik-lite"), false);
});

test("ensureMlx downloads the missing files in order through the native downloader; mlxPaths maps real names", async () => {
  const started = [];
  const Llama = {
    modelPath: async ({ name }) => ({ path: "/docs/maik-models/" + name, bytes: started.includes(name) ? size(name) : 0, partial: false, freeBytes: 50e9 }),
    downloadStart: async ({ name }) => { started.push(name); return { id: "dl-" + name }; },
    downloadStatus: async ({ name }) => ({ state: "done", bytes: size(name), onDisk: size(name), total: size(name), live: false }),
    modelVerify: async ({ name }) => ({ sha256: sha(name), bytes: size(name) }),
    excludeFromBackup: async () => ({ ok: true })
  };
  const { M, ls } = models({ flag: "1", Llama });
  const files = M.mlxFiles("bonsai-ternary-8b");
  function size(name) { return files.find((f) => f.name === name).bytes; }
  function sha(name) { return files.find((f) => f.name === name).sha256; }
  // config.json is already on disk: it must not download again.
  const cfg = M.mlxIdsOf("bonsai-ternary-8b").find((s) => s.endsWith(":config.json"));
  ls.setItem("smd_maik_pack_" + cfg, "1");
  ls.setItem("smd_maik_packsha_" + cfg, files.find((f) => f.file === "config.json").sha256);

  await M.ensureMlx("bonsai-ternary-8b");
  assert.equal(started.includes("tb8-mlx--config.json"), false, "an installed file is skipped");
  assert.equal(started.length, files.length - 1);
  assert.equal(started[started.length - 1], "tb8-mlx--model.safetensors", "weights last");
  assert.equal(M.mlxReady("bonsai-ternary-8b"), true);
  assert.equal(M.mlxBusy("bonsai-ternary-8b"), false);

  const mp = await M.mlxPaths("bonsai-ternary-8b");
  assert.equal(mp.files["config.json"], "/docs/maik-models/tb8-mlx--config.json");
  assert.equal(mp.files["model.safetensors"], "/docs/maik-models/tb8-mlx--model.safetensors");
  assert.equal(Object.keys(mp.files).length, files.length);
});

/* ── maik-local.js engine choice ─────────────────────────────────────────── */

function local({ mlxLinked = true, ready = true, mlxLoadFails = false } = {}) {
  const calls = [];
  const listeners = { Llama: new Set(), Mlx: new Set() };
  const mk = (name, loadFails) => ({
    available: async () => ({ available: true, loaded: calls.some((c) => c[0] === name + ".load:ok") }),
    load: async (a) => {
      calls.push([name + ".load", a]);
      if (loadFails) throw Object.assign(new Error("mlx load failed: not enough memory"), { code: "mlx-load-failed" });
      calls.push([name + ".load:ok"]);
      return { loaded: true };
    },
    generate: async (a) => {
      calls.push([name + ".generate", a]);
      for (const cb of listeners[name]) cb({ text: name + "-token", count: 1 });
      return { text: name + " answer", ms: 1 };
    },
    cancel: async () => { calls.push([name + ".cancel"]); },
    release: async () => { calls.push([name + ".release"]); return { released: true }; },
    addListener: (ev, cb) => { if (ev === "llamaToken") listeners[name].add(cb); return { remove: () => listeners[name].delete(cb) }; }
  });
  const Plugins = { Llama: Object.assign(mk("Llama"), { generateWithImage: async () => ({ text: "img" }) }) };
  if (mlxLinked) Plugins.Mlx = mk("Mlx", mlxLoadFails);
  const removed = [];
  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins },
    SMD_MAIK_MODELS: {
      PACKS: { "bonsai-ternary-8b": { label: "MAiK Prime", nCtx: 4096, nPredict: 512, noThink: true } },
      caps: () => ({ kb: false }), pathFor: async () => "/docs/maik-models/ternary-bonsai-8b-q2_0_g64.gguf",
      totalBytes: () => 2.31e9, mlxBytes: () => 2.32e9, mlxReady: () => ready,
      mlxPaths: async () => ({ files: { "config.json": "/docs/a", "tokenizer.json": "/docs/b", "model.safetensors": "/docs/c" } }),
      remove: (id) => { removed.push(id); return Promise.resolve(); }
    },
    localStorage: fakeLS()
  };
  new Function("window", "localStorage", LOCAL_SRC)(win, win.localStorage);
  return { L: win.SMD_MAIK_LOCAL, calls, removed, Plugins, listeners };
}

const names = (calls) => calls.map((c) => c[0]);

test("no Mlx plugin linked: Llama object used as before, nothing new called", async () => {
  const { L, calls } = local({ mlxLinked: false });
  assert.equal(await L.warm("bonsai-ternary-8b"), true);
  assert.equal(L.engine(), "llama");
  assert.deepEqual(names(calls).filter((n) => n.startsWith("Mlx")), []);
  assert.ok(calls.find((c) => c[0] === "Llama.load")[1].path.endsWith(".gguf"));
});

test("MLX ready: the model loads and answers on Mlx with the real file names", async () => {
  const { L, calls } = local({ ready: true });
  assert.equal(L.engineFor("bonsai-ternary-8b"), "mlx");
  assert.equal(L.engineFor("bonsai-ternary-8b", { vision: true }), "llama", "images stay on llama.cpp");
  assert.equal(await L.warm("bonsai-ternary-8b"), true);
  assert.equal(L.engine(), "mlx");
  const load = calls.find((c) => c[0] === "Mlx.load")[1];
  assert.deepEqual(Object.keys(load.files).sort(), ["config.json", "model.safetensors", "tokenizer.json"]);
  assert.equal(load.nCtx > 0, true);
  assert.equal(names(calls).includes("Llama.load"), false, "the GGUF is not loaded as well");
  assert.equal(names(calls).includes("Mlx.generate"), true);
  assert.equal(names(calls).includes("Llama.generate"), false);
});

test("MLX not ready: llama.cpp even with the plugin linked", async () => {
  const { L, calls } = local({ ready: false });
  await L.warm("bonsai-ternary-8b");
  assert.equal(L.engine(), "llama");
  assert.deepEqual(names(calls).filter((n) => n.startsWith("Mlx.load")), []);
});

test("MLX load failure: answers on llama.cpp, deletes nothing, stays on llama.cpp for the session", async () => {
  const { L, calls, removed } = local({ ready: true, mlxLoadFails: true });
  assert.equal(await L.warm("bonsai-ternary-8b"), true);
  assert.equal(L.engine(), "llama");
  const n = names(calls);
  assert.ok(n.indexOf("Mlx.load") < n.indexOf("Llama.load"), "tried MLX first, then the GGUF");
  assert.ok(n.includes("Mlx.release"), "MLX released before the GGUF loads");
  assert.ok(n.indexOf("Mlx.release") < n.indexOf("Llama.load"));
  assert.deepEqual(removed, [], "an MLX fault never deletes the pack");
  assert.equal(L.engineFor("bonsai-ternary-8b"), "llama", "not retried this session");
});

test("a streamed MLX answer reaches answer()'s listener through the adapter, then detaches", async () => {
  const { L, calls, listeners } = local({ ready: true });
  const seen = [];
  const r = await L.answer("Hello", { pack: "bonsai-ternary-8b" }, (t) => seen.push(t));
  assert.equal(L.engine(), "mlx");
  assert.ok(names(calls).includes("Mlx.generate"), "generated on MLX");
  assert.ok(seen.some((t) => /Mlx-token/.test(t)), "the MLX token was painted: " + JSON.stringify(seen));
  assert.ok(r && /Mlx/.test(JSON.stringify(r)), "the answer came from MLX");
  assert.equal(listeners.Mlx.size + listeners.Llama.size, 0, "listeners removed on both plugins");
});

/* ── native plugin: contract and linking (static; no Xcode in CI) ── */

test("capacitor-mlx keeps the JS contract and is linked into the iOS app on iOS 17", () => {
  const plugin = read("local-plugins/capacitor-mlx/ios/Sources/MlxPlugin/MlxPlugin.swift");
  const engine = read("local-plugins/capacitor-mlx/ios/Sources/MlxPlugin/MlxEngine.swift");
  const pkg = read("local-plugins/capacitor-mlx/Package.swift");
  assert.match(plugin, /jsName = "Mlx"/);
  for (const m of ["available", "load", "generate", "cancel", "release"]) {
    assert.match(plugin, new RegExp('CAPPluginMethod\\(name: "' + m + '"'), m);
  }
  for (const ev of ["llamaToken", "llamaReleased", "llamaError"]) assert.ok(plugin.includes('"' + ev + '"'), ev);
  assert.match(plugin, /getObject\("files"\)/, "load takes the files map maik-local.js sends");
  assert.match(plugin, /prefillEmptyThink/, "noThink packs keep thinking off");
  assert.match(engine, /enable_thinking/);
  assert.match(pkg, /\.iOS\(\.v17\)/);
  // The owner's forks (branch stewardmd-ios27): mlx-swift carries the Xcode 27.2 std::system fix, and
  // mlx-swift-lm's own Package.swift pins that same mlx-swift commit, so both pins must stay in step.
  assert.match(pkg, /drmanojkurmana\/mlx-swift-lm\.git", revision: "7354dce7a8f62142994acd180e2dc134cb46483f"/, "fork pinned to a full commit");
  assert.match(pkg, /drmanojkurmana\/mlx-swift\.git", revision: "757b0a04aa8ee27b99b7026f6c5d7fc9629f757e"/, "mlx-swift pinned to the commit mlx-swift-lm pins");
  assert.doesNotMatch(pkg, /\.package\(url: "https:\/\/github\.com\/Layr-Labs\//, "no Layr-Labs pin left beside the forks");
  const rootPkg = JSON.parse(read("package.json"));
  assert.equal(rootPkg.dependencies["@stewardmd/capacitor-mlx"], "file:local-plugins/capacitor-mlx");
  const spm = read("ios/App/CapApp-SPM/Package.swift");
  assert.match(spm, /platforms: \[\.iOS\(\.v17\)\]/, "CapApp-SPM at MLX's floor");
  assert.match(spm, /\.package\(name: "StewardmdCapacitorMlx", path: "\.\.\/\.\.\/\.\.\/local-plugins\/capacitor-mlx"\)/);
  assert.match(spm, /\.product\(name: "StewardmdCapacitorMlx", package: "StewardmdCapacitorMlx"\)/);
  // Capacitor's CLI reads the FIRST IPHONEOS_DEPLOYMENT_TARGET when it regenerates CapApp-SPM, so
  // every iPhone target must be at 17 or above, or `cap sync` writes .v16 back and the build breaks.
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  const targets = [...pbx.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g)].map((m) => Number(m[1]));
  assert.ok(targets.length >= 4 && targets.every((v) => v >= 17), "all iOS targets >= 17: " + targets);
  // Selftest names must match what maik-models.js stores.
  const { M } = models();
  assert.ok(!plugin.includes('"tb2-27b-mlx"'), "the dropped 27B MLX build is not benchmarked");
  for (const id of ["bonsai-ternary-8b"]) {
    for (const f of M.mlxFiles(id)) assert.ok(plugin.includes('"' + f.file + '"'), "selftest lists " + f.file);
    assert.ok(plugin.includes('"' + M.mlxFiles(id)[0].name.split("--")[0] + '"'), "selftest prefix for " + id);
  }
});

test("Labs switch: offered only on an iPhone build with the Mlx plugin, off by default", () => {
  const plain = models({ platform: "ios" });
  assert.equal(plain.M.mlxAvailable(), false, "no Mlx plugin: no switch");
  // models() never adds an Mlx plugin; build one device the way the linked build exposes it.
  const ls = fakeLS();
  const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { Llama: {}, Mlx: {}, Filesystem: {} } }, localStorage: ls };
  new Function("window", "localStorage", "setTimeout", MODELS_SRC)(win, ls, () => 0);
  const M = win.SMD_MAIK_MODELS;
  assert.equal(M.mlxAvailable(), true);
  assert.equal(M.mlxEnabled(), false, "off by default");
  assert.equal(M.setMlxEnabled(true), true);
  assert.equal(ls.getItem("smd_maik_mlx"), "1");
  assert.equal(M.setMlxEnabled(false), false);
  assert.equal(ls.getItem("smd_maik_mlx"), null);
  const android = new Function("window", "localStorage", "setTimeout", MODELS_SRC);
  const lsA = fakeLS(), winA = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { Llama: {}, Mlx: {} } }, localStorage: lsA };
  android(winA, lsA, () => 0);
  assert.equal(winA.SMD_MAIK_MODELS.mlxAvailable(), false, "never on Android");
});
