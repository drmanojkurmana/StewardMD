/* test/maik-engine.test.mjs — MaiK answer-engine chooser + SMD_AI router decorator.
 *
 * Covers the contract the offline feature depends on:
 *   • default is "cloud" (an untouched install must behave EXACTLY as before)
 *   • rag  → no paid call ever leaves; a real {text} notice is returned so home.js renders it
 *   • local→ SMD_MAIK_LOCAL.answer, with pkg/opts/onDelta passed through for replay()
 *   • a stale "local" pref (no gate / no runtime / no pack) degrades to KB-only, never dead-ends
 *   • rag/local force KB-first ON (smd_maik_llm_first=0) so Tier 0 still produces an answer
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const SRC = src("maik-engine.js");

function fakeLS() {
  const s = {};
  return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: (k) => { delete s[k]; }, _s: s };
}

// Build a window with a spy SMD_AI. `env` lets a test switch the gate/runtime/pack on.
function load(env = {}) {
  const calls = [];
  const win = {
    SMD_AI: {
      explain: (...a) => { calls.push(["explain", a]); return Promise.resolve({ text: "CLOUD explain" }); },
      explainGrounded: (...a) => { calls.push(["explainGrounded", a]); return Promise.resolve({ text: "CLOUD grounded" }); },
      explainGroundedStream: (...a) => { calls.push(["explainGroundedStream", a]); return Promise.resolve({ text: "CLOUD stream" }); },
      refine: (...a) => { calls.push(["refine", a]); return Promise.resolve({ topic: "CLOUD refine" }); },
      route: function (q) { return this.refine(q); }
    }
  };
  if (env.gate) win.SMD_XACCESS = { isActiveCached: (f) => f === "maik_local" };
  if (env.runtime) {
    win.SMD_MAIK_LOCAL = { answer: (...a) => { calls.push(["local", a]); return Promise.resolve({ text: "LOCAL answer" }); } };
  }
  if (env.pack) win.SMD_MAIK_MODELS = { installedCached: () => true };
  const ls = fakeLS();
  new Function("window", "localStorage", SRC)(win, ls);
  return { win, ls, calls, E: win.SMD_MAIK_ENGINE };
}

// ── preference basics ──
{
  const { E, ls } = load();
  ok("exposes API", !!E && typeof E.getPref === "function" && typeof E.settingsHTML === "function");
  ok("default pref is cloud", E.getPref() === "cloud");
  ok("effective() is cloud by default", E.effective() === "cloud");
  ok("unknown stored value falls back to cloud", (ls.setItem("stewardmd.maikEngine", "bogus"), E.getPref() === "cloud"));
  E.setPref("rag"); ok("setPref rag persists", E.getPref() === "rag");
  ok("rag forces KB-first ON (llm_first=0)", ls._s.smd_maik_llm_first === "0");
  E.setPref("cloud"); ok("cloud restores llm_first default (key removed)", !("smd_maik_llm_first" in ls._s));
  E.setPref("local"); ok("local forces KB-first ON", ls._s.smd_maik_llm_first === "0");
  E.setPref("nonsense"); ok("setPref sanitises unknown → cloud", E.getPref() === "cloud");
}

// ── install() decorates exactly once ──
{
  const { win, E } = load();
  const afterLoad = win.SMD_AI.explainGrounded;
  ok("install() ran at load (function replaced)", typeof afterLoad === "function");
  ok("second install() is a no-op", E.install() === false && win.SMD_AI.explainGrounded === afterLoad);
}

// ── cloud: pass-through, untouched ──
{
  const { win, E, calls } = load();
  E.setPref("cloud");
  await win.SMD_AI.explainGrounded({ q: 1 }, { depth: "concise" });
  await win.SMD_AI.explainGroundedStream({ q: 2 }, {}, () => {});
  await win.SMD_AI.refine("sepsis");
  ok("cloud: all three reach the original", calls.length === 3);
  ok("cloud: grounded args untouched", calls[0][0] === "explainGrounded" && calls[0][1][0].q === 1 && calls[0][1][1].depth === "concise");
  const r = await win.SMD_AI.explainGrounded({});
  ok("cloud: returns the original result", r.text === "CLOUD grounded");
}

// ── rag: nothing paid leaves, and a renderable notice comes back ──
{
  const { win, E, calls } = load();
  E.setPref("rag");
  const g = await win.SMD_AI.explainGrounded({ q: 1 });
  const s = await win.SMD_AI.explainGroundedStream({ q: 1 }, {}, () => {});
  const x = await win.SMD_AI.explain("summary", "question");
  const rf = await win.SMD_AI.refine("sepsis");
  ok("rag: ZERO paid calls made", calls.length === 0);
  ok("rag: grounded returns text, not an error", !!g.text && !g.error);
  ok("rag: stream returns text too", !!s.text && !s.error);
  ok("rag: plain explain returns text", !!x.text);
  ok("rag: refine returns null (callers treat null as no-refinement)", rf === null);
  ok("rag: notice names the setting to change", /Settings/.test(g.text) && /MaiK Cloud/.test(g.text));
  ok("rag: notice tagged engine=rag", g.engine === "rag");
  // must not trip maikRenderAnswer's "limited material" regex, which would swallow the notice
  const swallow = /\b(no (relevant |specific )?information|does not (cover|contain)|unable to (find|answer)|i (don'?t|do not) have (enough|any))\b/i;
  ok("rag: notice survives the render regex", !swallow.test(g.text));
}

// ── local: routes to the plugin, passes pkg/opts/onDelta through ──
{
  const { win, E, calls } = load({ gate: true, runtime: true, pack: true });
  ok("localReady() true when gate+runtime+pack present", E.localReady() === true);
  E.setPref("local");
  ok("effective() is local when ready", E.effective() === "local");
  const cb = () => {};
  const r = await win.SMD_AI.explainGroundedStream({ q: 7 }, { depth: "deep" }, cb);
  ok("local: answer() called", calls.length === 1 && calls[0][0] === "local");
  ok("local: pkg passed through", calls[0][1][0].q === 7);
  ok("local: opts passed through", calls[0][1][1].depth === "deep");
  ok("local: onDelta passed through (replay reuse)", calls[0][1][2] === cb);
  ok("local: returns the local text", r.text === "LOCAL answer");
  // plain explain has a (summary, question) signature — must be normalised into a pkg
  calls.length = 0;
  await win.SMD_AI.explain("SUM", "Q");
  ok("local: explain() normalised to a package", calls[0][1][0].summary === "SUM" && calls[0][1][0].question === "Q");
}

// ── local degrades to KB-only rather than dead-ending ──
{
  const noGate = load({ runtime: true, pack: true });
  noGate.E.setPref("local");
  ok("local without gate → effective rag", noGate.E.effective() === "rag");
  const r1 = await noGate.win.SMD_AI.explainGrounded({});
  ok("local without gate → KB-only notice, no paid call", !!r1.text && noGate.calls.length === 0);

  const noPack = load({ gate: true, runtime: true });
  noPack.E.setPref("local");
  ok("local without the model pack → effective rag", noPack.E.effective() === "rag");

  const noRt = load({ gate: true, pack: true });
  noRt.E.setPref("local");
  ok("local without the native runtime → effective rag", noRt.E.effective() === "rag");
}

// ── a throwing local engine surfaces an error instead of hanging the bubble ──
{
  const { win, E } = load({ gate: true, runtime: true, pack: true });
  win.SMD_MAIK_LOCAL.answer = () => Promise.reject(new Error("oom"));
  E.setPref("local");
  const r = await win.SMD_AI.explainGrounded({});
  ok("local: rejection becomes {error}", r.error === "oom");
}

// ── settings markup ──
{
  const { E } = load();
  const h = E.settingsHTML();
  ok("settings: one .me-seg host", (h.match(/class="me-seg"/g) || []).length === 1);
  ok("settings: three engine options", (h.match(/data-me-opt="/g) || []).length === 3);
  ok("settings: labels present", /KB only/.test(h) && /MaiK Cloud/.test(h) && /On-device model/.test(h));
  ok("settings: cloud is checked by default", /data-me-opt="cloud" role="radio" aria-checked="true"/.test(h));
  ok("settings: local disabled without a gate", /data-me-opt="local"[^>]*aria-disabled="true"/.test(h));
  ok("settings: no model row without gate+runtime", !/data-me-model/.test(h));

  const ready = load({ gate: true, runtime: true });
  const h2 = ready.E.settingsHTML();
  ok("settings: gated+runtime shows a download row", /data-me-model="download"/.test(h2));
  ok("settings: download copy promises resume", /resumes if interrupted/i.test(h2));
  ok("settings: no Wi-Fi-only restriction in the copy", /Wi-Fi or mobile data/.test(h2));

  const installed = load({ gate: true, runtime: true, pack: true });
  const h3 = installed.E.settingsHTML();
  ok("settings: installed shows a delete row", /data-me-model="delete"/.test(h3));
  ok("settings: local option enabled once ready", !/data-me-opt="local"[^>]*aria-disabled="true"/.test(h3));
}

console.log(`\nmaik-engine: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
