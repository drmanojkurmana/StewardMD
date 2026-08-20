/* test/maik-local.test.mjs — on-device MaiK answer engine (prompt builder + streaming contract).
 *
 * Two things here can silently ruin the feature:
 *   1. The prompt exceeding n_ctx 4096 — llama.cpp then refuses the whole answer.
 *   2. onDelta receiving DELTAS instead of ACCUMULATED text — home.js's typewriter would render
 *      "aababcabcd..." on screen. reasoning.js replay() calls onDelta(full.slice(0, i)).
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n); } };
const src = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const SRC = src("maik-local.js");

/**
 * @param tokens pieces the fake plugin will stream
 * @param opts.noPlugin simulate the web PWA (no capacitor-llama)
 */
function load({ tokens = ["Hel", "lo ", "world"], noPlugin = false, loadFails = null, loaded = false } = {}) {
  const calls = { load: [], generate: [], listeners: [], removed: 0 };
  let listener = null;

  const Llama = {
    available: async () => ({ available: true, loaded }),
    load: async (o) => {
      calls.load.push(o);
      if (loadFails) { const e = new Error(loadFails); e.code = loadFails; throw e; }
      loaded = true;
      return { loaded: true };
    },
    generate: async (o) => {
      calls.generate.push(o);
      let full = "";
      for (const t of tokens) { full += t; if (listener) listener({ text: t }); }
      return { text: full, ms: 1234 };
    },
    cancel: async () => ({}),
    release: async () => { loaded = false; return { released: true }; },
    addListener: (name, cb) => {
      calls.listeners.push(name);
      listener = cb;
      return { remove: () => { calls.removed++; listener = null; } };
    }
  };

  const win = {
    Capacitor: { isNativePlatform: () => true, Plugins: noPlugin ? {} : { Llama } },
    SMD_MAIK_MODELS: {
      PACKS: { "maik-local-v1": { label: "MedGemma 1.5 4B (Q4_K_M)", nCtx: 4096, nPredict: 512 } },
      pathFor: async () => "/var/mobile/Data/maik-models/medgemma.gguf"
    }
  };
  new Function("window", SRC)(win);
  return { L: win.SMD_MAIK_LOCAL, calls };
}

const { L } = load();

// ── availability: the module always loads, the plugin does not ──
{
  ok("exposes API", !!L && typeof L.answer === "function" && typeof L.buildPrompt === "function");
  ok("available() true when the plugin is present", L.available() === true);
  const web = load({ noPlugin: true });
  ok("available() false on the web PWA", web.L.available() === false);
}

// ── prompt builder: UNGROUNDED BY DESIGN ──
// The on-device engine answers from the model's own weights and must not touch StewardMD data.
// Grounding was 94% of time-to-first-word (1799 tok -> 130 s prefill on a Pixel 9) AND it caused a
// wrong answer when retrieval missed (amoebic chunks for a pyogenic question). KB only / MaiK Cloud
// remain the grounded engines.
{
  ok("no package -> empty prompt", L.buildPrompt(null) === "");

  const pkg = {
    question: "Empiric antibiotic for pyogenic liver abscess in an adult?",
    grounding: [{ name: "Amoebic Liver Abscess", diseaseId: "AMOEBIC_LIVER_ABSCESS",
                  knowledge: [{ section: "management", text: "Metronidazole 750 mg TDS for 7-10 days.", source: { ref: "Harrison 22e" } }] }],
    retrieved: [{ section: "escalation", diseaseId: "OTHER", text: "Add vancomycin for line infection." }],
    treatment: { default: { tier: "empiric", line: "Metronidazole then paromomycin", source: "Harrison", steps: ["step one"] } },
    sources: [{ n: 1, title: "Harrison 22e" }],
    topicMatch: { confident: false, match: "fallback" }
  };
  const p = L.buildPrompt(pkg);

  ok("prompt is ONLY the question", p === pkg.question);
  ok("no KB grounding text leaks in", !/Metronidazole 750 mg/.test(p));
  ok("no retrieved chunks leak in", !/vancomycin for line infection/.test(p));
  ok("no treatment resolution leaks in", !/paromomycin/.test(p));
  ok("no StewardMD headers at all", !/RETRIEVED|STEWARDMD|TREATMENT RESOLUTION|primary source/i.test(p));
  ok("no source refs leak in", !/Harrison/.test(p));
  ok("prompt stays tiny (this IS the latency)", p.length < 250);

  // conversation history IS kept - it is the clinician's own turns, not a StewardMD resource
  const hist = L.buildPrompt({ question: "and the dose?", history: [
    { role: "user", text: "meropenem in meningitis" }, { role: "assistant", text: "Meropenem is used for..." }] });
  ok("history kept so bare follow-ups work", /meropenem in meningitis/.test(hist) && /and the dose\?/.test(hist));
  ok("history labels the speakers", /Doctor: /.test(hist) && /MaiK: /.test(hist));
  ok("history is capped", L.HISTORY_TURNS <= 3);
  const longHist = L.buildPrompt({ question: "q", history: Array.from({ length: 20 }, (_, i) => ({ role: "user", text: "turn " + i })) });
  ok("long history is truncated, not sent whole", !/turn 0\b/.test(longHist) && /turn 19/.test(longHist));

  // no question at all still yields something usable
  ok("packageless prompt still asks for something", L.buildPrompt({}).length > 10);

  ok("system prompt makes no promise about retrieved knowledge",
     !/RETRIEVED|knowledge base|grounding/i.test(L.SYSTEM));
  ok("system prompt stays terse", L.SYSTEM.length < 500);
}

// ── an ungrounded answer must NOT claim StewardMD citations ──
{
  const { L: L2 } = load();
  const r = await L2.answer({ question: "x", sources: [{ n: 1, title: "Harrison 22e" }] }, null, null);
  ok("sources are empty - nothing was cited because nothing was read", Array.isArray(r.sources) && r.sources.length === 0);
  ok("result flags itself ungrounded", r.grounded === false);

  // home.js renders citations from the PACKAGE (SMD_MaiK.sourceList(pkg)), not from the result, so
  // the package's citation-bearing fields must be cleared or the UI shows borrowed sources.
  const pkg2 = { question: "x", grounding: [{ name: "A", knowledge: [{ text: "t" }] }],
                 retrieved: [{ text: "u" }], treatment: { default: { line: "l" } },
                 sources: [{ n: 1, title: "Harrison 22e" }] };
  await L2.answer(pkg2, null, null);
  ok("package grounding cleared so the UI cannot cite it", pkg2.grounding.length === 0);
  ok("package retrieved cleared", pkg2.retrieved.length === 0);
  ok("package sources cleared", pkg2.sources.length === 0);
  ok("package treatment removed", pkg2.treatment === undefined);
  ok("result still names the model", /MedGemma/.test(r.model));
}

// ── streaming contract: onDelta gets ACCUMULATED text ──
{
  const { L: L2, calls } = load({ tokens: ["Hel", "lo ", "world"] });
  const seen = [];
  const r = await L2.answer({ question: "hi" }, null, (t) => seen.push(t));
  ok("answer resolves with the full text", r.text === "Hello world");
  ok("answer is tagged engine=local", r.engine === "local");
  ok("answer reports the model label", /MedGemma/.test(r.model));
  ok("answer reports timing", r.ms === 1234);
  ok("onDelta called once per token", seen.length === 3);
  ok("onDelta receives ACCUMULATED text, not deltas",
     seen[0] === "Hel" && seen[1] === "Hello " && seen[2] === "Hello world");
  ok("each onDelta value extends the previous", seen.every((v, i) => i === 0 || v.startsWith(seen[i - 1])));
  ok("listener removed after the answer (no leak across questions)", calls.removed === 1);
  ok("greedy by default (reproducible answers)", calls.generate[0].temperature === 0);
  ok("nPredict capped from the pack", calls.generate[0].nPredict === 512);
  ok("system prompt sent", /clinical decision support/i.test(calls.generate[0].system));
  ok("system prompt kept terse (it is prefill on the critical path)", calls.generate[0].system.length < 600);
  ok("model loaded with the clamped context", calls.load[0].nCtx === 4096);
}

// ── the model is loaded once, not per question ──
{
  const { L: L2, calls } = load();
  await L2.answer({ question: "one" }, null, null);
  await L2.answer({ question: "two" }, null, null);
  ok("second question reuses the loaded model", calls.load.length === 1);
  ok("both questions generated", calls.generate.length === 2);
}

// ── the plugin drops the model on pause: we must reload, not answer into the void ──
{
  const { L: L2, calls } = load();
  await L2.answer({ question: "one" }, null, null);
  calls.generate.length = 0;
  // simulate a background/foreground cycle
  await L2.release();
  await L2.answer({ question: "after resume" }, null, null);
  ok("model reloaded after release()", calls.load.length === 2);
  ok("answer still produced after a resume", calls.generate.length === 1);
}

// ── failures surface as {error}, never a hung promise ──
{
  const { L: L2 } = load({ loadFails: "low-memory" });
  const r = await L2.answer({ question: "x" }, null, null);
  ok("load failure becomes {error} with the plugin's code", r.error === "low-memory");

  const web = load({ noPlugin: true });
  const r2 = await web.L.answer({ question: "x" }, null, null);
  ok("no plugin → {error}, not a throw", !!r2.error && /native app/i.test(r2.error));
}

// ── a throwing onDelta must not kill the answer ──
{
  const { L: L2 } = load();
  const r = await L2.answer({ question: "x" }, null, () => { throw new Error("render blew up"); });
  ok("answer survives a throwing onDelta", r.text === "Hello world");
}

console.log(`\nmaik-local: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
