/* test/maik-caps.test.mjs - capability metadata + device suitability in the model registry.
 *
 * Owner rule (2026-09-11): NEVER recommend a model that is unlikely to run well on the clinician's
 * actual phone. "Can be downloaded" is not "will run". These tests pin the verdicts for simulated
 * 6 / 8 / 12 GB phones, an iPhone whose total RAM cannot be read but whose jetsam budget can, low
 * storage and low battery, and the recommendation ranking (ok before warn, smallest first, never
 * the biggest by default, level "no" packs kept out of the recommended list).
 *
 * node --test test/maik-caps.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../maik-models.js", import.meta.url), "utf8");

function load(opts = {}) {
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  const Llama = { available: async () => ({ available: true, loaded: false, availableMemory: opts.availableMemory || 0, memoryIsHardLimit: !!opts.hard }), excludeFromBackup: async () => ({}) };
  const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => opts.platform || "ios", Plugins: { Filesystem: {}, Llama } }, localStorage: ls };
  if (opts.navigator) win.navigator = opts.navigator;
  win.window = win;
  new Function("window", "localStorage", "navigator", SRC)(win, ls, opts.navigator || undefined);
  return { M: win.SMD_MAIK_MODELS, ls };
}
const dev = (o) => Object.assign({ platform: "android", ramGB: null, ramGBMin: false, availGB: null, hardLimit: false, freeGB: null, battery: null, at: 1 }, o);
function installed(M, ls, id) { ls.setItem("smd_maik_pack_" + id, "1"); ls.setItem("smd_maik_packsha_" + id, M.PACKS[id].files[0].sha256); }

test("caps() reflects the registry: medical, KB, vision, json reliability, RAM floor", () => {
  const { M } = load();
  assert.equal(M.caps("maik-lite").medical, true);
  assert.equal(M.caps("maik-lite").kb, true);
  assert.equal(M.caps("maik-lite").vision, false, "Lite has no projector");
  assert.equal(M.caps("maik-mxcore").vision, true);
  assert.equal(M.caps("bonsai-8b").json, 1, "Swift: weak at strict formats");
  assert.equal(M.caps("bonsai-27b").ramGB, 12);
  assert.equal(M.caps("maik-mxcore#vision").id, "maik-mxcore", "the vision sub-pack resolves to its base");
  assert.equal(M.caps("nope"), null);
  assert.equal(M.caps("maik-lite").nCtx, 4096, "every pack loads at 4K");
  for (const id of M.packIds()) assert.ok(M.CAPS[id], "CAPS entry for " + id);
});

test("6 GB phone: Lite runs, the 8 GB-floor packs and Max do not", () => {
  const { M } = load();
  const d = dev({ ramGB: 6 });
  assert.equal(M.suitability("maik-lite", d).level, "ok");
  assert.equal(M.suitability("bonsai-8b", d).level, "ok");
  assert.equal(M.suitability("maik-mxcore", d).level, "no");
  assert.match(M.suitability("maik-mxcore", d).reasons[0], /Needs a 8 GB phone/);
  assert.equal(M.suitability("bonsai-27b", d).level, "no");
});

test("8 GB phone: MxCore ok, MxCore+vision warns, Apex and Horizon warn, Max is not for this phone", () => {
  const { M } = load();
  const d = dev({ ramGB: 8 });
  assert.equal(M.suitability("maik-mxcore", d).level, "ok");
  const v = M.suitability("maik-mxcore", d, { vision: true });
  assert.equal(v.level, "warn"); assert.match(v.reasons.join(" "), /headroom/);
  assert.equal(M.suitability("maik-apex", d).level, "warn");
  assert.equal(M.suitability("maik-horizon", d).level, "warn");
  const max = M.suitability("bonsai-27b", d);
  assert.equal(max.level, "no"); assert.match(max.reasons[0], /Needs a 12 GB phone/);
});

test("12 GB phone: Max runs well", () => {
  const { M } = load();
  assert.equal(M.suitability("bonsai-27b", dev({ ramGB: 12 })).level, "ok");
});

test("Android reports at most 8 (deviceMemory cap): Max is not recommended unless free memory argues for it", () => {
  const { M } = load();
  assert.equal(M.suitability("bonsai-27b", dev({ ramGB: 8, ramGBMin: true })).level, "no", "8+ with no free-memory reading: cannot confirm 12");
  assert.equal(M.suitability("bonsai-27b", dev({ ramGB: 8, ramGBMin: true, availGB: 6.5 })).level, "warn", "6.5 GB free argues for a 12 GB phone, but stays a warning");
});

test("iPhone: total RAM unreadable, the jetsam budget decides", () => {
  const { M } = load();
  const okBudget = dev({ platform: "ios", availGB: 5.0, hardLimit: true });
  assert.equal(M.suitability("maik-mxcore", okBudget).level, "ok", "3.4 GB need fits a 5 GB hard budget");
  const small = dev({ platform: "ios", availGB: 2.0, hardLimit: true });
  const s = M.suitability("maik-mxcore", small);
  assert.equal(s.level, "no"); assert.match(s.reasons.join(" "), /can hold about 2\.0 GB/);
  const lite = M.suitability("maik-lite", small);
  assert.equal(lite.level, "warn", "the weights load (1.1 GB x 1.15 fits) but KV + runtime push past the budget: a warning, same test as ensureLoaded");
  assert.match(lite.reasons.join(" "), /working memory/);
  const unknown = dev({ platform: "ios" });
  assert.equal(M.suitability("maik-mxcore", unknown).level, "warn", "nothing readable: an 8 GB-floor pack is a warning, never ok");
  assert.equal(M.suitability("bonsai-27b", unknown).level, "no", "unknown never upgrades a 12 GB-floor pack");
});

test("storage and battery: no room is no; low battery is a warning on large packs only", () => {
  const { M } = load();
  const noRoom = dev({ ramGB: 8, freeGB: 1.0 });
  assert.equal(M.suitability("maik-mxcore", noRoom).level, "no");
  assert.match(M.suitability("maik-mxcore", noRoom).reasons.join(" "), /free storage/);
  const lowBat = dev({ ramGB: 8, battery: { level: 0.1, charging: false } });
  assert.equal(M.suitability("maik-mxcore", lowBat).level, "warn");
  assert.equal(M.suitability("maik-lite", lowBat).level, "ok", "a 1.1 GB pack is not a battery concern");
  assert.equal(M.suitability("maik-mxcore", dev({ ramGB: 8, battery: { level: 0.1, charging: true } })).level, "ok");
});

test("recommend(): filters by capability, ranks ok before warn then smallest, keeps level-no packs aside", () => {
  const { M, ls } = load();
  const d8 = dev({ ramGB: 8 });
  const vis = M.recommend({ vision: true }, d8);
  assert.deepEqual(vis.recommended.map((x) => x.id), ["maik-mxcore", "maik-neural", "maik-horizon"], "only packs with a projector, smallest first");
  assert.ok(vis.recommended.every((x) => x.level === "warn"), "vision on 8 GB is a warning on every pack");
  assert.ok(vis.unsuitable.some((x) => x.id === "bonsai-27b"), "Max is listed as unsuitable, not hidden");
  const json = M.recommend({ json: 2 }, d8);
  assert.ok(!json.recommended.some((x) => x.id === "bonsai-8b"), "Swift is never offered for structured output");
  const reason = M.recommend({ reasoning: 2 }, d8);
  assert.ok(!reason.recommended.some((x) => x.id === "maik-lite"));
  assert.equal(M.recommend({ lang: "te" }, d8).recommended.length, 0, "no pack has passed the Telugu eval yet");
  const all = M.recommend({}, d8);
  assert.equal(all.recommended[0].id, "maik-lite", "with no requirement the smallest ok pack leads, never the biggest");
  assert.equal(all.recommended[0].installed, false);
  installed(M, ls, "maik-lite");
  assert.equal(M.recommend({}, d8).recommended[0].installed, true);
  const med = M.recommend({ medical: true, json: 2 }, d8).recommended;
  assert.equal(med.filter((x) => x.level === "ok")[0].medical, true, "medical packs rank first when asked for");
});

test("device(): refreshDevice() reads the plugin's memory report and the snapshot is what suitability uses", async () => {
  const { M } = load({ availableMemory: 3.2e9, hard: true, navigator: { onLine: true } });
  assert.equal(M.device().availGB, null, "nothing until refreshed");
  const d = await M.refreshDevice();
  assert.equal(Math.round(d.availGB * 10) / 10, 3.2);
  assert.equal(d.hardLimit, true);
  assert.equal(M.device().availGB, d.availGB);
  assert.equal(M.suitability("maik-mxcore").level, "warn", "2.49 GB of weights x1.15 fit a 3.2 GB hard budget (the loader accepts it), but with KV and runtime it is a warning");
  const tight = await (async () => { const t = load({ availableMemory: 2.5e9, hard: true, navigator: { onLine: true } }); await t.M.refreshDevice(); return t.M; })();
  assert.equal(tight.suitability("maik-mxcore").level, "no", "2.5 GB budget: the loader itself would refuse, so it is not for this phone");
  M.setDevice(dev({ ramGB: 12 }));
  assert.equal(M.suitability("bonsai-27b").level, "ok", "setDevice() is the simulation hook");
});
