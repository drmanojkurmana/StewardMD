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
function load({ tokens = ["Hel", "lo ", "world"], noPlugin = false, loadFails = null, loaded = false,
               mem = null, availableThrows = false } = {}) {
  const calls = { load: [], generate: [], listeners: [], removed: 0 };
  let listener = null;

  const Llama = {
    available: async () => {
      if (availableThrows) throw new Error("plugin says no");
      return Object.assign({ available: true, loaded }, mem || {});
    },
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
      PACKS: {
        "maik-mxcore": { label: "MAiK MxCore", actual: "MedGemma 1.5 4B (Q4_K_M)", nCtx: 4096, nPredict: 512 },
        "maik-apex": { label: "MAiK Apex", actual: "MedPsy 4B (Q5_K_M, imatrix)", nCtx: 4096, nPredict: 768, noThink: true, flagship: true },
        // Entry tier, Qwen3-1.7B based like Apex, so it needs the same thinking suppression.
        "maik-lite": { label: "MAiK Lite", actual: "MedPsy 1.7B (Q4_K_M, imatrix)", nCtx: 4096, nPredict: 512, noThink: true }
      },
      pathFor: async () => "/var/mobile/Data/maik-models/medgemma.gguf",
      totalBytes: () => 2.5e9
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
  // "dose?" (an aspect-only follow-up) so history is included at all - the point here is the CAP.
  const longHist = L.buildPrompt({ question: "dose?", history: Array.from({ length: 20 }, (_, i) => ({ role: "user", text: "turn " + i })) });
  ok("long history is truncated, not sent whole", !/turn 0\b/.test(longHist) && /turn 19/.test(longHist));

  // no question at all still yields something usable
  ok("packageless prompt still asks for something", L.buildPrompt({}).length > 10);

  ok("system prompt bans printed section labels (it was emitting a literal \"Bottom Line:\")",
     /no section labels/.test(L.SYSTEM) && /ONE plain sentence/.test(L.SYSTEM));
  ok("system prompt makes no promise about retrieved knowledge",
     !/RETRIEVED|knowledge base|grounding/i.test(L.SYSTEM));
  ok("system prompt stays terse", L.SYSTEM.length < 900);
  // Phrased positively: a 4B follows instructions far better than prohibitions. The old negative
  // wording ("not a made-up figure") produced "20 mg/kg" for adult IV magnesium.
  ok("dose rule tells it what TO do", /give the standard flat adult dose/i.test(L.SYSTEM));
  ok("dose rule shows a worked example", /2 g IV over 20 min/.test(L.SYSTEM));
  ok("mg/kg is scoped, not forbidden", /Use mg\/kg only when/.test(L.SYSTEM));
  ok("no bare prohibitions left", !/\bnot a made-up\b|\bNever invent\b/.test(L.SYSTEM));
  ok("asks for a verify line", /Verify against local protocol/.test(L.SYSTEM));
}

// ── greetings: "hi" must not become a clinical answer ──
// Reported from a real phone: "hi" came back as an answer about vancomycin. SYSTEM gives the model
// no way to NOT answer clinically, so with no question it invented a topic.
{
  const { L: LG } = load();
  for (const q of ["hi", "Hi", "hello", "hey", "hiya", "Hi there", "hello doctor", "good morning", "hey MaiK", "namaste"])
    ok(`greeting detected: ${JSON.stringify(q)}`, LG.isGreeting(q) === true);

  // THE regression this must never cause. A greeting carrying a real question routes CLINICAL -
  // "Hi rx of uti" once got a canned hello instead of an answer (see maik-greeting-route.test.mjs).
  for (const q of ["hi rx of uti", "hello what is the dose of vancomycin", "good morning, meropenem in meningitis",
                   "vancomycin dose", "hyponatremia", ""])
    ok(`NOT a greeting: ${JSON.stringify(q)}`, LG.isGreeting(q) === false);

  // The fix must not be paid for on every clinical answer: SYSTEM is prefill on the critical path.
  ok("SYSTEM is untouched by the greeting fix", LG.SYSTEM.length < 900);
  ok("greetings get their own, shorter prompt", LG.SYSTEM_GREET.length < LG.SYSTEM.length);
  ok("greeting prompt asks for one short sentence", /one short/i.test(LG.SYSTEM_GREET));
  ok("greeting prompt keeps it non-clinical", /nothing clinical/i.test(LG.SYSTEM_GREET));
  // No canned app-side string: the model still writes the words.
  ok("no scripted reply text anywhere", !/Hello\. I can help/i.test(SRC));
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
  ok("result names the MAiK tier, not the upstream model", r.model === "MAiK Lite");
}

// ── streaming contract: onDelta gets ACCUMULATED text ──
{
  const { L: L2, calls } = load({ tokens: ["Hel", "lo ", "world"] });
  const seen = [];
  const r = await L2.answer({ question: "hi" }, null, (t) => seen.push(t));
  ok("answer resolves with the full text", r.text === "Hello world");
  ok("answer is tagged engine=local", r.engine === "local");
  ok("answer reports the MAiK tier label", r.model === "MAiK Lite");
  ok("answer reports timing", r.ms === 1234);
  ok("onDelta called once per token", seen.length === 3);
  // Right-trimmed, because every delta goes through stripReasoning() on the way to the typewriter -
  // the trade for never rendering a leaked reasoning preamble on screen. The trailing space arrives
  // with the next word, so the render is unaffected.
  ok("onDelta receives ACCUMULATED text, not deltas",
     seen[0] === "Hel" && seen[1] === "Hello" && seen[2] === "Hello world");
  ok("each onDelta value extends the previous", seen.every((v, i) => i === 0 || v.startsWith(seen[i - 1])));
  ok("listener removed after the answer (no leak across questions)", calls.removed === 1);
  ok("greedy by default (reproducible answers)", calls.generate[0].temperature === 0);
  ok("nPredict capped from the pack", calls.generate[0].nPredict === 512);
  ok("system prompt sent", /clinical decision support/i.test(calls.generate[0].system));
  // Prefill is ~14 tok/s on-device and linear in prompt tokens, so every character here is latency:
  // roughly 1s per 14 tokens (~56 chars). The budget grew 600 -> 750 -> 900: the last step bought the
  // medical-only rule, the no-reasoning rule and the conditional dose rule for about 2s of prefill,
  // after the first draft of those three came in at 1055 chars and was rewritten tighter. The
  // no-section-labels rule, which cost ~17 tokens (~1.2s) and removed the literal "Bottom Line:"
  // the model was printing. Do not let it creep further without measuring.
  ok("system prompt kept terse (it is prefill on the critical path)", calls.generate[0].system.length < 900);
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


/* ── Thinking-mode suppression (MAiK Apex / Qwen3 base) ─────────────────────────────────────────
 * A reasoning-capable base emits <think> blocks by default. At nPredict 768 a long trace can consume
 * the whole budget, leaving a truncated thought and NO answer - and stripReasoning() then correctly
 * returns "", which on screen reads as the app being broken. Driven off the pack registry, never
 * hardcoded to a model name.
 *
 * REGRESSION (2026-09-03, found live): buildPrompt() used to ALSO push "<think>\n\n</think>" into
 * the QUESTION text, on the theory that the engine sends a raw completion with no chat template. It
 * does not - LlamaEngine.swift/.java apply the model's own template, which wraps this whole string
 * inside the USER turn. The "closed" block landed as noise inside the doctor's question while the
 * real assistant turn still opened blank, fixing nothing. buildPrompt now ONLY sends the cheap
 * "/no_think" hint; the actual fix is prefillEmptyThink on the options object passed to
 * L.generate(), which only the native side can apply at the true assistant-turn boundary.
 */
{
  const { L } = load();
  const q = { question: "empiric antibiotic for pyogenic liver abscess" };

  {
    const p = L.buildPrompt(q, "maik-apex");
    ok("a pack with noThink gets Qwen3's own switch", /\/no_think/.test(p));
    ok("buildPrompt does NOT inject a think tag into the question text", !/<think>/.test(p));
    ok("the question still precedes the switch", p.indexOf("liver abscess") < p.indexOf("/no_think"));
    // Same treatment for the 1.7B entry tier - this is the pack the slowdown was reported on.
    ok("MAiK Lite gets the switch too", /\/no_think/.test(L.buildPrompt(q, "maik-lite")));
  }
  ok("a pack without noThink does NOT", !/no_think/.test(L.buildPrompt(q, "maik-mxcore")));
  ok("no pack id given behaves as before", !/no_think/.test(L.buildPrompt(q)));
  ok("an unknown pack id does not crash or inject", !/no_think/.test(L.buildPrompt(q, "nope")));
  ok("the question still leads the prompt", /pyogenic liver abscess/.test(L.buildPrompt(q, "maik-apex")));

  // The switch must not defeat the topic-bleed fix that came before it.
  const hist = [{ role: "user", text: "Treatment of Fever" },
                { role: "assistant", text: "Acetaminophen 650 mg to 1 g orally." }];
  const p = L.buildPrompt({ question: "Polycystic Kidney Disease", history: hist }, "maik-apex");
  ok("noThink does not reintroduce history on a new topic", !/fever|Acetaminophen/i.test(p));
  const fu = L.buildPrompt({ question: "Side effects?", history: hist }, "maik-apex");
  ok("noThink still allows history on a real follow-up", /Acetaminophen/.test(fu) && /no_think/.test(fu));

  // stripReasoning is the backstop if the switch is ignored.
  ok("a leaked qwen-style think block is still stripped",
     L.stripReasoning("<think>weighing options</think>Pip-tazo 3.375 g IV q8h") === "Pip-tazo 3.375 g IV q8h");
}

// ── prefillEmptyThink: the ACTUAL fix reaches the native call, buildPrompt's tag injection does not ──
{
  const { L: L2, calls } = load();
  await L2.answer({ question: "Treatment of Pneumonia" }, { pack: "maik-lite" }, null);
  ok("noThink pack sets prefillEmptyThink on the native call", calls.generate[0].prefillEmptyThink === true);
  ok("the prompt sent to native carries no think tag (that landed in the user turn, uselessly)",
     !/<think>/.test(calls.generate[0].prompt));

  calls.generate.length = 0;
  await L2.answer({ question: "Treatment of Pneumonia" }, { pack: "maik-mxcore" }, null);
  ok("a pack without noThink does not set prefillEmptyThink", !calls.generate[0].prefillEmptyThink);
}


/* ── Image answers must INTERPRET, not transcribe ───────────────────────────────────────────────
 * From a side-by-side the owner ran: shown a cortisol report, ours produced eighteen lines of "The
 * lab ID is 60812702855. The ref id is not visible. The uhid is not visible." while ChatGPT gave two
 * salient values then an Interpretation section saying 6.2 ug/dL is borderline-low for an 8 AM
 * cortisol and NOT sufficient to diagnose or exclude adrenal insufficiency.
 *
 * The cause was my own prompt: "Describe only what is actually visible" and "read the values as
 * printed" are transcription instructions and the model obeyed them exactly.
 */
{
  const { L } = load();

  /* The format is DEMONSTRATED, not described.
   *
   * A 4B copies a worked example far more reliably than it follows a description, and the described
   * version demonstrably did not work. So the sentences that merely explained the shape were removed
   * and the example carries them - which also kept prefill flat (1041 -> 1060 chars) instead of paying
   * ~7 s more for an example bolted on top of the rules.
   *
   * These assertions therefore check what the EXAMPLE shows, not what the prose says.
   */
  ok("prompt says to report only what carries clinical meaning", /findings that carry clinical meaning/i.test(L.SYSTEM_IMAGE));
  ok("example demonstrates a value WITH its reference range", /6\.1 mmol\/L \(lab range 3\.5 to 5\.1\)/.test(L.SYSTEM_IMAGE));
  ok("example demonstrates an Interpretation section", /\*\*Interpretation\*\*/.test(L.SYSTEM_IMAGE));
  ok("example demonstrates committing with a threshold", /Above 6\.0 is where/.test(L.SYSTEM_IMAGE));
  ok("example demonstrates what it does NOT establish", /does not establish the cause/i.test(L.SYSTEM_IMAGE));
  ok("example demonstrates naming a next step", /^Next: /m.test(L.SYSTEM_IMAGE));
  ok("example demonstrates the closing verify line", /Verify against the original document/.test(L.SYSTEM_IMAGE));

  // CONTENT BLEED is the real hazard of few-shot on a small model: it will answer "potassium 6.1"
  // for a sodium report unless told not to.
  ok("prompt forbids reusing the example's content", /never reuse its test, its numbers or its conclusion/i.test(L.SYSTEM_IMAGE));
  ok("example is fenced so the model can see where it ends", (L.SYSTEM_IMAGE.match(/\n---/g) || []).length === 2);
  ok("example is labelled as shape only", /format example only/i.test(L.SYSTEM_IMAGE));

  // Prefill is the whole latency story, so the prompt must stay bounded even with an example in it.
  ok("prompt stays within its prefill budget", L.SYSTEM_IMAGE.length < 1200);

  // The exact instructions that produced the transcription are gone.
  ok("no longer says 'describe only what is visible'", !/Describe only what is actually visible/i.test(L.SYSTEM_IMAGE));
  ok("no longer asks to read values as printed", !/read the values as printed/i.test(L.SYSTEM_IMAGE));
  ok("explicitly says to skip empty fields", /Skip empty fields/i.test(L.SYSTEM_IMAGE));
  ok("explicitly says not to list what is missing", /do not list what is missing/i.test(L.SYSTEM_IMAGE));

  // PHI: the transcription echoed the patient's name back for no clinical reason.
  ok("image prompt forbids writing out patient identifiers",
     /Never write out patient names/i.test(L.SYSTEM_IMAGE) && /UHID/i.test(L.SYSTEM_IMAGE));
  ok("follow-up prompt forbids identifiers too", /Never write out patient names/i.test(L.SYSTEM_IMAGE_FOLLOWUP));

  // Still honest about a misread digit.
  ok("still tells the doctor to check the original", /Verify against the original document/.test(L.SYSTEM_IMAGE));
  ok("still handles an unreadable number without abandoning the reading",
     /unreadable/i.test(L.SYSTEM_IMAGE) && /do not\s+abandon the rest/i.test(L.SYSTEM_IMAGE));
}

/* ── A follow-up about the image answers the QUESTION ───────────────────────────────────────────
 * "is this normal?" used to re-read the picture and repeat the whole summary, because the image was
 * consumed on send and the first prompt ran again.
 */
{
  const { L } = load();
  ok("follow-up prompt exists", typeof L.SYSTEM_IMAGE_FOLLOWUP === "string" && L.SYSTEM_IMAGE_FOLLOWUP.length > 80);
  ok("follow-up answers directly", /answer the doctor's question about it DIRECTLY/i.test(L.SYSTEM_IMAGE_FOLLOWUP));
  ok("follow-up must not re-list the report", /Do not re-list the report/i.test(L.SYSTEM_IMAGE_FOLLOWUP));
  ok("follow-up commits on normal vs abnormal", /say normal, borderline or abnormal/i.test(L.SYSTEM_IMAGE_FOLLOWUP));
  ok("follow-up knows the image is already in play", /already being discussed/i.test(L.SYSTEM_IMAGE_FOLLOWUP));
  ok("the two image prompts are different", L.SYSTEM_IMAGE !== L.SYSTEM_IMAGE_FOLLOWUP);
}

if (fail) process.exit(1);

/* ── Regressions from a real device transcript (20 Aug 2026) ────────────────────────────────────
 * A doctor ran a normal clinical conversation on the phone and it produced three distinct failures.
 * Each one gets a test here, because each was invisible to every test that existed at the time.
 */
{
  const { L } = load();

  // 1. TOPIC BLEED. History was prepended to every prompt, so after "Treatment of Fever" the next
  //    question "Polycystic Kidney Disease" was answered as fever-with-renal-impairment. A doctor
  //    asked about one disease and got the treatment for another.
  ok("aspect-only question IS a follow-up (needs the previous turn)",
     L.isFollowUp("Side effects?") && L.isFollowUp("dose?") && L.isFollowUp("what about in children"));
  ok("a question naming its own subject is NOT a follow-up",
     !L.isFollowUp("Polycystic Kidney Disease") && !L.isFollowUp("Side effects of Linagliptin") &&
     !L.isFollowUp("Treatment of Fever") && !L.isFollowUp("empiric antibiotic for meningitis"));
  ok("a long question is never treated as a follow-up",
     !L.isFollowUp("what is the dose of magnesium in severe asthma in an adult patient"));

  const hist = [{ role: "user", text: "Treatment of Fever" },
                { role: "assistant", text: "Acetaminophen 650 mg to 1 g orally every 4 to 6 hours." }];
  const bled = L.buildPrompt({ question: "Polycystic Kidney Disease", history: hist });
  ok("new-topic question carries NO history (this is the fever/PKD bug)",
     !/fever/i.test(bled) && !/Acetaminophen/i.test(bled) && /Polycystic Kidney Disease/.test(bled));
  const cont = L.buildPrompt({ question: "Side effects?", history: hist });
  ok("aspect-only follow-up DOES carry history (else it is unanswerable)",
     /Recent conversation/.test(cont) && /Acetaminophen/.test(cont) && /Side effects\?/.test(cont));

  // 2. REASONING LEAK. An answer shipped starting "thought The user wants me to act as MaiK, a
  //    clinical decision support system. I need to provide..." - reciting the system prompt.
  ok("tagged reasoning is stripped",
     L.stripReasoning("<think>plan the answer</think>5 mg PO once daily") === "5 mg PO once daily");
  ok("unterminated reasoning keeps only what came before it",
     L.stripReasoning("5 mg PO once daily\n<thinking>ran out of budget") === "5 mg PO once daily");
  const leak = "thought The user wants me to act as MaiK. I need the standard dose.\n\n5 mg PO once daily";
  ok("bare 'thought' preamble is stripped", L.stripReasoning(leak) === "5 mg PO once daily");
  ok("gemma control tokens are stripped",
     L.stripReasoning("<start_of_turn>5 mg PO<end_of_turn>") === "5 mg PO");
  ok("an answer that merely begins with a normal word is untouched",
     L.stripReasoning("Thoughtful monitoring is required.") === "Thoughtful monitoring is required.");
  ok("plain text passes through unchanged",
     L.stripReasoning("  Ceftriaxone 2 g IV daily.  ") === "Ceftriaxone 2 g IV daily.");

  // 3. FORCED DOSE. The dose rule was unconditional, so a SIDE EFFECTS question opened with
  //    "Linagliptin 100 mg orally once daily is the standard first-line treatment" - wrong by 20x
  //    (it is 5 mg) and not what was asked.
  ok("dose rule is conditional on the question asking for a dose", /When asked for a dose/.test(L.SYSTEM));
  ok("prompt tells the model to answer only what was asked", /Answer exactly what was asked/.test(L.SYSTEM));
  ok("side effects / mechanism questions are named explicitly", /side effects, mechanism/.test(L.SYSTEM));
  ok("prompt asks for the final answer only", /never your reasoning/.test(L.SYSTEM));
  ok("prompt enforces medical-only scope", /Answer medical questions only/.test(L.SYSTEM));
  ok("no section labels are requested", /Bottom Line/.test(L.SYSTEM) && /no section labels/.test(L.SYSTEM));
  ok("default pack matches the real registry after the MAiK rebrand", L.DEFAULT_PACK === "maik-lite");

  /* 4. MEMORY PRE-FLIGHT. A 2.5 GB model on a phone with nothing free does not fail cleanly: it
   *    load/evict cycles (Android) or gets jetsam-killed (iOS), both of which present to the
   *    clinician as the app hanging. The refusal must fire in the fatal region, must NOT fire where
   *    mmap copes, and must never itself become the reason an answer fails.
   */
  const askOne = (o) => {
    const { L: E } = load(o);
    return E.answer({ question: "Ceftriaxone dose?" }, {}).then(r => r, e => ({ error: String(e) }));
  };
  const NEED = 2.5e9;

  // iOS: os_proc_available_memory() is a hard ceiling, so 1.15x the weights is required.
  await askOne({ mem: { availableMemory: NEED * 1.0, memoryIsHardLimit: true } })
    .then(r => ok("iOS refuses when the jetsam headroom is under 1.15x the weights",
                  /Not enough free memory/.test(r.error || "")));
  await askOne({ mem: { availableMemory: NEED * 1.3, memoryIsHardLimit: true } })
    .then(r => ok("iOS answers with headroom to spare", !r.error && /Hello world/.test(r.text)));

  // Android: availMem is free + reclaimable and llama.cpp mmaps, so the SAME ratio that blocks on
  // iOS must not block here - this is the measured Pixel case (2.1 GB free, 2.49 GB model, runs).
  await askOne({ mem: { availableMemory: NEED * 0.85, memoryIsHardLimit: false } })
    .then(r => ok("Android answers below the weight size (mmap pages in and out)",
                  !r.error && /Hello world/.test(r.text)));
  await askOne({ mem: { availableMemory: NEED * 0.06, memoryIsHardLimit: false } })
    .then(r => ok("Android still refuses in the measured thrash region (176 MB / 2.83 GB)",
                  /Not enough free memory/.test(r.error || "")));

  // The clinician gets a SENTENCE with both numbers and a next step, never the code.
  await askOne({ mem: { availableMemory: 1e6, memoryIsHardLimit: true } })
    .then(r => ok("refusal is actionable: numbers plus what to do, and never the raw code",
                  /1 MB free, 2\.5 GB needed/.test(r.error) && /Close some apps/.test(r.error) &&
                  !/low-memory/.test(r.error)));

  // Fail-open: an unmeasurable platform has NO opinion.
  await askOne({ mem: null })
    .then(r => ok("a platform that reports no memory figure does not block the answer",
                  !r.error && /Hello world/.test(r.text)));
  await askOne({ availableThrows: true })
    .then(r => ok("available() throwing does not block the answer",
                  !r.error && /Hello world/.test(r.text)));
}


console.log(`\nmaik-local: ${pass} passed, ${fail} failed`);
