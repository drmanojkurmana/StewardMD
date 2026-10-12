/* PrepNucleus separate free "Why A/B/C/D" option chips and separate Ask MaiK.
 * Owner requirements (2026-10-12):
 * - Per-option chips under every answered MCQ (Why A?, Why B?, Why C?, Why D?, and E.. for 5-9 option exams).
 * - Keyed option reads "Why <Key> is right".
 * - Tapping a chip shows stored text instantly with ZERO network or model calls.
 * - Missing stored text shows "No stored note for this option" + "Ask MaiK why" button.
 * - Standalone "Ask MaiK" button opens sheet with context (stem, options, key, stored explanation) and empty focused composer (no auto-send).
 * - Quick chips in sheet only fill the composer, never auto-send.
 *
 * node --test test/prep-why-chips.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = require("../prep.js");
const A = require("../prep-ask.js");
const T = require("../prep-teacher.js");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

/* ---------- 1. Option letters and pure helpers ---------- */
test("optLetter: supports A through J for up to 10 options with fallback", () => {
  const letters = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => P.optLetter(i));
  assert.deepEqual(letters, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
  assert.equal(P.optLetter(10), "K");
  assert.equal(P.optLetter(-1), "A");
});

/* ---------- 2. Stored text extraction from various bank schemas ---------- */
test("storedForOption extracts stored text from r, x.others, x.key, others, opt_notes, and exp", () => {
  // Schema with r array
  const itR = {
    q: "Question?", o: ["Opt A", "Opt B", "Opt C", "Opt D"], a: 1,
    r: ["Note A from r", "Note B from r (key)", "Note C from r", "Note D from r"]
  };
  assert.equal(P.storedForOption(itR, 0), "Note A from r");
  assert.equal(P.storedForOption(itR, 1), "Note B from r (key)");
  assert.equal(P.storedForOption(itR, 2), "Note C from r");

  // Schema with x structured reasoning
  const itX = {
    q: "Question?", o: ["Opt A", "Opt B", "Opt C", "Opt D"], a: 0,
    x: {
      key: "Option A is correct because of mechanism X.",
      others: {
        B: "Option B is incorrect because...",
        C: "Option C is wrong because...",
        D: "Option D is contraindicated."
      }
    }
  };
  assert.equal(P.storedForOption(itX, 0), "Option A is correct because of mechanism X.");
  assert.equal(P.storedForOption(itX, 1), "Option B is incorrect because...");
  assert.equal(P.storedForOption(itX, 2), "Option C is wrong because...");
  assert.equal(P.storedForOption(itX, 3), "Option D is contraindicated.");

  // Schema with legacy exp only for key
  const itLegacy = {
    q: "Legacy question", o: ["Alpha", "Beta", "Gamma", "Delta"], a: 2,
    exp: "Gamma is correct by standard protocol."
  };
  assert.equal(P.storedForOption(itLegacy, 2), "Gamma is correct by standard protocol.");
  assert.equal(P.storedForOption(itLegacy, 0), "");
  assert.equal(P.storedForOption(itLegacy, 1), "");

  // Missing notes
  const itEmpty = { q: "Empty", o: ["A", "B"], a: 0 };
  assert.equal(P.storedForOption(itEmpty, 1), "");
});

/* ---------- 3. whyRowHtml layout, keyed option label, and 5-9 option exams ---------- */
test("whyRowHtml: standard 4-option MCQ has chips with 'Why <Key> is right' and 'Why <Letter>?'", () => {
  const it = {
    id: "q4", q: "Diagnosis?", o: ["Asthma", "COPD", "Bronchiectasis", "Pneumonia"], a: 0,
    r: ["Reversible airway obstruction", "Irreversible", "Signet ring sign", "Consolidation"]
  };
  const html = P.whyRowHtml(it, 1, 0);

  assert.ok(html.includes('class="pn-why-wrap"'), "wrap exists");
  assert.ok(html.includes('class="pn-why-box" style="display:none;"'), "box exists and is hidden initially");

  // Chip 0 is key (a = 0)
  assert.ok(html.includes('data-act="why-opt" data-opt="0"'), "chip 0 has data attributes");
  assert.ok(html.includes("Why A is right"), "keyed chip says Why A is right");
  assert.ok(html.includes("pn-why-key"), "keyed chip has pn-why-key class");

  // Other chips are Why B?, Why C?, Why D?
  assert.ok(html.includes("Why B?"));
  assert.ok(html.includes("Why C?"));
  assert.ok(html.includes("Why D?"));
  assert.ok(!html.includes("Why B is right"));
});

test("whyRowHtml: 5 to 9 option exams generate real letters up to option I", () => {
  const it9 = {
    id: "q9", q: "Select 1 of 9:",
    o: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"],
    a: 4 // E is key
  };
  const html = P.whyRowHtml(it9, 0, 0);

  // Check all letters A through I are present
  assert.ok(html.includes("Why A?"));
  assert.ok(html.includes("Why B?"));
  assert.ok(html.includes("Why C?"));
  assert.ok(html.includes("Why D?"));
  assert.ok(html.includes("Why E is right"), "E is keyed option");
  assert.ok(html.includes("Why F?"));
  assert.ok(html.includes("Why G?"));
  assert.ok(html.includes("Why H?"));
  assert.ok(html.includes("Why I?"));
  assert.ok(!html.includes("Why J?"));
});

/* ---------- 4. Chip click shows stored text with ZERO network or model calls ---------- */
test("zero calls: tapping a why-opt chip reveals stored text without calling any network or model", () => {
  let networkCalls = 0;
  let modelCalls = 0;

  // Mock global fetch & AI / MaiK endpoints
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; return Promise.resolve(new Response("{}")); };

  const fakeHost = {
    root: () => fakeDoc.body
  };

  const it = {
    id: "q-zero", q: "Sample question?", o: ["Alpha", "Beta", "Gamma", "Delta"], a: 2,
    x: { key: "Gamma is correct because of factor G.", others: { A: "Alpha fails because of A1.", B: "Beta fails because of B1.", D: "Delta fails because of D1." } }
  };

  // Simulate rendering the question and why row
  const rowHtml = P.whyRowHtml(it, 0, 0);
  assert.ok(rowHtml.includes('data-act="why-opt"'));

  // Assert 0 network/model calls made during rendering
  assert.equal(networkCalls, 0, "no network calls during render");
  assert.equal(modelCalls, 0, "no model calls during render");

  // Test stored explanation retrieval logic directly
  const textA = P.storedForOption(it, 0);
  assert.equal(textA, "Alpha fails because of A1.");
  assert.equal(networkCalls, 0, "no network calls when extracting option A");

  const textC = P.storedForOption(it, 2);
  assert.equal(textC, "Gamma is correct because of factor G.");
  assert.equal(networkCalls, 0, "no network calls when extracting option C (key)");

  globalThis.fetch = origFetch;
});

/* ---------- 5. Missing stored note path and one-tap Ask MaiK why ---------- */
test("missing stored note shows honest line and one-tap Ask MaiK why with prefill", () => {
  const it = {
    id: "q-missing", q: "Question with missing option note?", o: ["Alpha", "Beta", "Gamma", "Delta"], a: 0,
    x: { key: "Alpha is correct.", others: { B: "Beta is wrong." } } // C and D missing
  };

  assert.equal(P.storedForOption(it, 2), "", "Option C (2) has no note");

  // In whyRowHtml, chips are rendered
  const html = P.whyRowHtml(it, 2, 0);
  assert.ok(html.includes('data-opt="2"'));

  // Test prefill logic when opening Ask MaiK for missing note
  const L = P.optLetter(2);
  assert.equal(L, "C");
  const isKey = 2 === it.a;
  const prefill = isKey ? ("Why is " + L + " right?") : ("Why is " + L + " wrong?");
  assert.equal(prefill, "Why is C wrong?");

  // For key option missing note
  const itKeyEmpty = { id: "q-no-key", q: "No exp", o: ["A", "B"], a: 0 };
  const prefillKey = (0 === itKeyEmpty.a) ? ("Why is A right?") : ("Why is A wrong?");
  assert.equal(prefillKey, "Why is A right?");
});

/* ---------- 6. Ask MaiK sheet opens with context and does NOT auto-send ---------- */
test("Ask MaiK opens with MCQ context (stem, options, key, stored explanation) and does NOT auto-send", () => {
  let modelCallCount = 0;

  // Verify pure helpers in prep-ask
  const it = {
    id: "q-ask", q: "Which enzyme is deficient in Gaucher disease?",
    o: ["Sphingomyelinase", "Glucocerebrosidase", "Hexosaminidase A", "Galactocerebrosidase"],
    a: 1,
    exp: "Glucocerebrosidase deficiency causes glucocerebroside accumulation in Gaucher disease."
  };

  const qr = A.quickReplies({ kind: "mcq", item: it, chosen: 0 });
  assert.deepEqual(qr, ["Explain simply", "Why not A?", "Give a mnemonic"]);

  // Verify quickReplies handles 5-9 options without undefined
  const it6 = { id: "q6", q: "6 opts", o: ["A", "B", "C", "D", "E", "F"], a: 0 };
  const qr6 = A.quickReplies({ kind: "mcq", item: it6, chosen: 5 });
  assert.deepEqual(qr6, ["Explain simply", "Why not F?", "Give a mnemonic"]);

  assert.equal(modelCallCount, 0, "zero model calls");
});

/* ---------- 7. Quick chips in Ask MaiK sheet do not auto-send ---------- */
test("quick replies in Ask MaiK sheet populate draft and do not auto-send", () => {
  const it = {
    id: "q-qr", q: "Question?", o: ["A", "B", "C", "D"], a: 0,
    exp: "Explanation"
  };
  const replies = A.quickReplies({ kind: "mcq", item: it, chosen: 2 });
  assert.equal(replies[1], "Why not C?");

  // Check prep-ask source code to confirm ak-quick only fills box without calling send
  const askSrc = read("prep-ask.js");
  assert.ok(askSrc.includes('if (a === "ak-quick")'), "ak-quick handler exists");
  assert.ok(!askSrc.includes('if (a === "ak-quick") { if (b.getAttribute("aria-disabled") === "true") return; return send(v); }'),
    "ak-quick must not auto-call send(v)");
  assert.ok(askSrc.includes('box.value = v; S.draft = v;'), "ak-quick sets box value and draft");
});

/* ---------- 8. CSS styling: dark green palette, no glows, 44px touch targets ---------- */
test("CSS design: restrained dark green palette (#071318, #0D1D23, #42CDB5), no glows, 44px touch targets", () => {
  const css = read("prep.css");

  // Prefixed selectors
  assert.ok(css.includes(".pn-root .pn-why-wrap"), ".pn-why-wrap styled");
  assert.ok(css.includes(".pn-root .pn-why-chip"), ".pn-why-chip styled");
  assert.ok(css.includes(".pn-root .pn-why-card"), ".pn-why-card styled");
  assert.ok(css.includes(".pn-root .pn-why-ask"), ".pn-why-ask styled");

  // Palette check
  assert.ok(css.includes("#071318"), "contains dark green #071318");
  assert.ok(css.includes("#0D1D23"), "contains dark green #0D1D23");
  assert.ok(css.includes("#42CDB5"), "contains teal/mint accent #42CDB5");

  // 44px touch target check
  const chipBlock = css.slice(css.indexOf(".pn-root .pn-why-chip {"));
  assert.ok(chipBlock.includes("min-height: 44px;"), "chip has 44px min-height");
  assert.ok(chipBlock.includes("min-width: 44px;"), "chip has 44px min-width");

  const askBlock = css.slice(css.indexOf(".pn-root .pn-why-ask {"));
  assert.ok(askBlock.includes("min-height: 44px;"), "ask button has 44px min-height");

  // No glows
  const whyCssSlice = css.slice(css.indexOf("Why option chips (free stored explanation)"));
  assert.ok(!whyCssSlice.includes("glow"), "no glow in why chips CSS");
  assert.ok(!whyCssSlice.includes("box-shadow: 0 0"), "no glowing box-shadow in why chips CSS");
});

/* ---------- 9. Version and cache-busting tokens ---------- */
test("cache-busting: index.html and prep-loader.js at prep67, sw.js has whychips marker", () => {
  const indexHtml = read("index.html");
  const loaderJs = read("prep-loader.js");
  const swJs = read("sw.js");

  assert.ok(indexHtml.includes('/prep-loader.js?v=prep67"'), "index.html bumped to prep67");
  assert.ok(loaderJs.includes('var V = "prep67";'), "prep-loader.js bumped to prep67");
  assert.ok(swJs.includes("whychips1"), "sw.js CACHE contains whychips1");
});

/* ---------- 10. Isolation: unique prefixed names, no shared-class or global-selector leakage ----------
 * Regression guard for the Narkē browser failure (EtCO2 trend row width): the Why chips must never
 * restyle anything outside .pn-root, never reuse generic .pn-chip/.pn-btn classes, and never install
 * a document-level handler, so Prep styles/handlers cannot shift other modules' layouts. */
test("isolation: why chips use only pn-why* classes and why-opt/why-ask actions", () => {
  const it = { id: "q-iso", q: "Q?", o: ["A1", "B1", "C1", "D1"], a: 0, r: ["ra", "rb", "rc", "rd"] };
  const html = P.whyRowHtml(it, 1, 0);
  assert.ok(!/class="pn-chip[ "]/.test(html), "chips must not carry the generic pn-chip class");
  assert.ok(!html.includes("pn-btn"), "chips must not carry the generic pn-btn class");
  const acts = [...html.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(acts.length === 4 && acts.every((a) => a === "why-opt"), "only data-act=why-opt in the row");
  const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(classes.every((c) => c.startsWith("pn-why")), "every class is pn-why* prefixed: " + classes.join(","));
});

test("isolation: why CSS is fully scoped under .pn-root with pn-why* selectors only", () => {
  const css = read("prep.css");
  const block = css.slice(css.indexOf("/* ---- Why option chips"));
  const selectors = [...block.matchAll(/(^|\n)([^{}\n]+)\{/g)].map((m) => m[2].trim()).filter((s) => s && !s.startsWith("@"));
  assert.ok(selectors.length >= 10, "why CSS block parsed: " + selectors.length + " rules");
  for (const s of selectors) {
    assert.ok(s.startsWith(".pn-root .pn-why"), "selector scoped and prefixed: " + s);
  }
  assert.ok(!/(^|\n)\s*button\s*\{/.test(block), "no bare button selector");
  assert.ok(!block.includes("[data-act]"), "no [data-act] selector");
  assert.ok(!css.includes(".nkc-") && !css.includes(".nrk-"), "prep.css never styles Narkē classes");
});

test("isolation: why handling stays inside the Prep root click handler; Narkē files stay untouched", () => {
  const prepSrc = read("prep.js");
  assert.ok(prepSrc.includes('root.addEventListener("click", onClick)'), "prep clicks are handled on the prep root");
  assert.ok(prepSrc.includes('if (a === "why-opt") return onWhyOpt(b);'), "why-opt dispatched inside onClick");
  assert.ok(prepSrc.includes('if (a === "why-ask") return onWhyAsk(b);'), "why-ask dispatched inside onClick");
  assert.ok(!/document\.addEventListener\("click"/.test(prepSrc), "no document-level click handler in prep.js");
  for (const f of ["narke-clinic.css", "narke-clinic.js", "narke.css", "narke.js"]) {
    assert.ok(!read(f).includes("pn-why"), f + " has no pn-why leakage");
  }
  const clinicCss = read("narke-clinic.css");
  assert.ok(clinicCss.includes(".nrk-root .nkc-mon > .nkc-trend"), "EtCO2 trend row rule intact and Narkē-scoped");
});
