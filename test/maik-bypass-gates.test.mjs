/* test/maik-bypass-gates.test.mjs - the cloud paths that never went through SMD_AI (2026-09-11).
 *
 * The audit found five AI calls the answer-engine chooser could not see: SMD_AI.maik, the raw
 * /summary fetch in opd-emr.js, voice.js's tier-3 /api/ai/transcribe, the ICU imaging/correlate
 * calls, and readImage's cloud stage. The first four are now SMD_AI methods behind the router
 * (test/maik-policy.test.mjs). The two that do on-device work first (image engine, voice) ask
 * SMD_MAIK_ENGINE.cloudAllowed() before their cloud stage; that is what this file pins.
 *
 * node --test test/maik-bypass-gates.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const IMAGE = readFileSync(new URL("../image-engine.js", import.meta.url), "utf8");
const VOICE = readFileSync(new URL("../voice.js", import.meta.url), "utf8");
const REASON = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const OPD = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
const ENGINE = readFileSync(new URL("../maik-engine.js", import.meta.url), "utf8");

function loadImage({ cloudAllowed, visionReady, onLine = true }) {
  const win = {
    navigator: { onLine },
    SMD_MAIK_ENGINE: { cloudAllowed: () => cloudAllowed },
    SMD_MAIK_LOCAL: { answer: async () => ({ text: "{}" }), visionReady: () => visionReady, currentPack: () => "maik-mxcore" },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    document: (() => { const node = () => ({ setAttribute() {}, appendChild() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, querySelectorAll: () => [], querySelector: () => null, set innerHTML(_v) {}, get innerHTML() { return ""; }, addEventListener() {}, textContent: "" });
      return { createElement: node, getElementById: () => null, head: node(), body: node(), querySelector: () => null, querySelectorAll: () => [] }; })(),
    addEventListener() {}, Capacitor: { isNativePlatform: () => true, Plugins: {} }
  };
  win.window = win;
  new Function("window", "document", "localStorage", "navigator", IMAGE)(win, win.document, win.localStorage, win.navigator);
  return win.SMD_IMAGE_ENGINE;
}

test("image engine: with the Local engine selected AI Vision is never recommended, network or not", () => {
  assert.equal(loadImage({ cloudAllowed: true, visionReady: false }).recommendFor("monitor"), "ai", "cloud mode: unchanged");
  assert.equal(loadImage({ cloudAllowed: false, visionReady: true }).recommendFor("monitor"), "local", "local mode + projector: the on-device model");
  assert.equal(loadImage({ cloudAllowed: false, visionReady: false }).recommendFor("monitor"), "device", "local mode, no projector: private OCR, not the cloud");
  assert.equal(loadImage({ cloudAllowed: false, visionReady: false, onLine: true }).recommendFor("labs"), "device", "the network being ON changes nothing");
});

test("image engine: every dialog option map reads aiAvailable(), which reads the policy", () => {
  const i = IMAGE.indexOf("function aiAvailable()");
  assert.ok(i > 0);
  const body = IMAGE.slice(i, IMAGE.indexOf("\n  }", i));
  assert.match(body, /SMD_MAIK_ENGINE\.cloudAllowed/, "aiAvailable() consults the policy");
  assert.ok(!/lget\("smd_ai_vision"\) !== "0"/.test(IMAGE.replace(body, "")), "no other place reads the raw vision flag as availability");
});

test("voice: the tier-3 cloud transcriber is gated on the policy before the recorder starts", () => {
  const listen = VOICE.indexOf("function listen(");
  const tier3 = VOICE.indexOf("// 3) AI STT fallback");
  const gate = VOICE.indexOf("cloudAllowed()", listen > 0 ? listen : 0);
  assert.ok(gate > 0 && tier3 > gate, "the policy check precedes the tier-3 recorder");
  assert.match(VOICE.slice(gate, tier3), /stt-unavailable-local/, "and it reports a named reason");
  assert.match(VOICE.slice(gate, tier3), /stt-unavailable-offline/, "with a distinct reason when the clinician chose Cloud and is merely offline");
});

test("verifyGrounding (server model check of the answer text) honours the policy", () => {
  const i = REASON.indexOf("verifyGrounding: function (text, pkg)");
  assert.match(REASON.slice(i, i + 800), /SMD_MAIK_ENGINE\.cloudAllowed/);
});

test("readImage: the cloud text stage checks the policy alongside the vision flag and network", () => {
  const i = REASON.indexOf("readImage: function (dataUrl, kind)");
  const body = REASON.slice(i, i + 4000);
  assert.match(body, /cloudAllowed/);
  assert.match(body, /if \(!visionAiOn\(\) \|\| !online \|\| !cloudOk\)/);
});

test("opd-emr: the timeline summary goes through SMD_AI.summary, and no raw /summary fetch remains", () => {
  assert.match(OPD, /G\.SMD_AI\.summary\(text\)/);
  assert.ok(!/fetch\(base \+ "\/summary"/.test(OPD), "raw fetch removed");
});

test("specialist pipelines found by the static audit (ThoreX, SknX re-rank, PG logbook) are gated on the policy", () => {
  const THOREX = readFileSync(new URL("../thorex-llm.js", import.meta.url), "utf8");
  const SKNX = readFileSync(new URL("../sknx-llm.js", import.meta.url), "utf8");
  const PGLOG = readFileSync(new URL("../pglog-ai.js", import.meta.url), "utf8");
  const post = THOREX.slice(THOREX.indexOf("function post(kind, payload, opts)"), THOREX.indexOf("function post(kind, payload, opts)") + 900);
  assert.match(post, /SMD_MAIK_ENGINE\.cloudAllowed/, "thorex-llm post() is the single choke point");
  assert.ok(post.indexOf("cloudAllowed") < post.indexOf("doFetch"), "gate before the fetch");
  const rerank = SKNX.slice(SKNX.indexOf("function rerank(differential, history, opts)"), SKNX.indexOf("function rerank(differential, history, opts)") + 1200);
  assert.match(rerank, /SMD_MAIK_ENGINE\.cloudAllowed/);
  assert.ok(rerank.indexOf("cloudAllowed") < rerank.indexOf("/api/sknx/rerank"), "gate before the fetch; the deterministic differential passes through");
  const ask = PGLOG.slice(PGLOG.indexOf("function ask(prompt, opts)"), PGLOG.indexOf("function ask(prompt, opts)") + 900);
  assert.match(ask, /SMD_MAIK_ENGINE\.cloudAllowed/);
  assert.ok(ask.indexOf("cloudAllowed") < ask.indexOf("G.fetch(AI_URL"), "gate before the fetch");
});

test("router: every SMD_AI method that can reach a provider is decorated", () => {
  for (const m of ["maik", "summary", "imagingSummary", "correlate", "translate", "transcribe", "vision", "visionText"]) {
    assert.ok(new RegExp('"' + m + '"').test(ENGINE.slice(ENGINE.indexOf("function install()"), ENGINE.indexOf("function installWhenReady"))), m + " decorated");
  }
  const route = ENGINE.slice(ENGINE.indexOf("function route(kind, orig, self, args)"), ENGINE.indexOf("// If on-device is already the chosen engine"));
  const applies = route.split("orig.apply(self, args)").length - 1;
  assert.equal(applies, 2, "orig.apply appears exactly twice in route(): the cloud branch and the recovery switch");
});
