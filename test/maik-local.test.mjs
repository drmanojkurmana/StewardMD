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

// ── prompt builder ──
{
  ok("no package → empty prompt", L.buildPrompt(null) === "");

  const pkg = {
    question: "First-line treatment for febrile neutropenia?",
    grounding: [{
      name: "Febrile neutropenia", diseaseId: "fn",
      knowledge: [
        { section: "management", text: "Start piperacillin-tazobactam 4.5 g IV q6h within one hour.", source: { ref: "IDSA 2018", page: "e56" } },
        { section: "workup", text: "Blood cultures from two sites before antibiotics." }
      ]
    }],
    retrieved: [{ section: "escalation", diseaseId: "fn", text: "Add vancomycin for suspected line infection." }],
    treatment: { default: { tier: "empiric", line: "Pip-tazo monotherapy", source: "GIMSR HIC-3e", steps: ["Review at 48h", "De-escalate on cultures"] } },
    sources: [{ n: 1, title: "IDSA 2018" }]
  };
  const p = L.buildPrompt(pkg);
  ok("prompt includes the knowledge header", /RETRIEVED STEWARDMD KNOWLEDGE/.test(p));
  ok("prompt includes grounding text", /piperacillin-tazobactam 4\.5 g/.test(p));
  ok("prompt cites the grounding source", /IDSA 2018/.test(p));
  ok("prompt includes retrieved chunks", /Add vancomycin/.test(p));
  ok("prompt includes treatment resolution", /TREATMENT RESOLUTION/.test(p) && /Pip-tazo monotherapy/.test(p));
  ok("prompt includes treatment steps", /De-escalate on cultures/.test(p));
  ok("question is present", /First-line treatment for febrile neutropenia/.test(p));
  ok("question comes LAST (models attend to the end)", p.lastIndexOf("=== QUESTION ===") > p.lastIndexOf("TREATMENT RESOLUTION"));

  // de-duplication across grounding and retrieved
  const dup = {
    question: "q",
    grounding: [{ name: "x", knowledge: [{ section: "a", text: "Exactly the same sentence appears twice here." }] }],
    retrieved: [{ section: "b", text: "Exactly the same sentence appears twice here." }]
  };
  const dp = L.buildPrompt(dup);
  ok("duplicate chunk text emitted once", (dp.match(/Exactly the same sentence/g) || []).length === 1);

  // conversation history for bare follow-ups
  const hist = L.buildPrompt({ question: "and the dose?", history: [
    { role: "user", text: "meropenem in meningitis" }, { role: "assistant", text: "Meropenem is used for..." }] });
  ok("history included", /RECENT CONVERSATION/.test(hist) && /meropenem in meningitis/.test(hist));
  ok("history labels the speakers", /Doctor: /.test(hist) && /MaiK: /.test(hist));

  // empty package still yields a usable instruction rather than a bare prompt
  const bare = L.buildPrompt({});
  ok("packageless prompt still asks for something", /QUESTION/.test(bare) && bare.length > 20);
}

// ── low-confidence retrieval must NOT be labelled "primary source" ──
// Real failure this prevents: "pyogenic liver abscess" resolves to LIVER_ABSCESS by FALLBACK while
// AMOEBIC_LIVER_ABSCESS is an exact match, so the model was fed amoebic chunks under a header
// telling it they were authoritative - and answered metronidazole for a pyogenic abscess.
{
  const g = { question: "pyogenic liver abscess?", grounding: [{ name: "Liver Abscess", knowledge: [{ section: "management", text: "Metronidazole 750 mg TDS for amoebic liver abscess." }] }] };

  const confident = L.buildPrompt({ ...g, topicMatch: { confident: true, match: "exact" } });
  ok("confident match keeps the primary-source header", /RETRIEVED STEWARDMD KNOWLEDGE \(primary source\)/.test(confident));

  for (const weak of [{ confident: false }, { match: "fallback" }, { matched: false }]) {
    const p2 = L.buildPrompt({ ...g, topicMatch: weak });
    ok("weak match (" + JSON.stringify(weak) + ") is NOT called primary source", !/primary source/.test(p2));
    ok("weak match (" + JSON.stringify(weak) + ") warns it may be a different condition", /DIFFERENT condition/.test(p2));
    ok("weak match (" + JSON.stringify(weak) + ") tells the model to prefer established medicine", /established medicine/.test(p2));
  }

  // no topicMatch at all -> treat as confident (the old behaviour), so nothing regresses
  ok("absent topicMatch keeps the primary-source header", /primary source/.test(L.buildPrompt(g)));
}

// ── the budget must hold, or llama.cpp refuses the answer ──
{
  const huge = {
    question: "what now?",
    grounding: [{ name: "big", knowledge: Array.from({ length: 400 }, (_, i) => ({ section: "s" + i, text: "x".repeat(3000) + i })) }],
    retrieved: Array.from({ length: 400 }, (_, i) => ({ section: "r", text: "y".repeat(3000) + i }))
  };
  const p = L.buildPrompt(huge);
  ok("oversized package is clipped to the budget", p.length <= L.PROMPT_CHAR_BUDGET + 200);
  // Prefill is ~94% of time-to-first-word and linear in prompt tokens, so this budget IS the latency.
  ok("budget kept small enough to keep first-token latency sane", L.PROMPT_CHAR_BUDGET <= 3500);
  ok("no single chunk exceeds the per-chunk clip",
     !p.split("\n").some((line) => line.trim().startsWith("[") && line.length > 400));
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
