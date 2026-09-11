/* test/maik-local-tasks.test.mjs - the on-device task layer (maik-local.js, 2026-09-11).
 *
 * A fake llama plugin answers every generate() with whatever the test scripted, so these check the
 * parts that must be right whatever the model says: the sanitizers (the contract), the windowing
 * (nothing silently dropped from a record longer than the 4K context), the rolling Scribe state,
 * ICD ranking that can only return supplied candidates, the translate guard, and persona modes.
 *
 * node --test test/maik-local-tasks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../maik-local.js", import.meta.url), "utf8");

function load() {
  const gen = [];
  let reply = () => "ok";
  const Llama = {
    available: async () => ({ available: true, loaded: true, debugBuild: true, availableMemory: 0 }),
    load: async () => ({}),
    generate: async (p) => { gen.push(p); return { text: reply(p) }; },
    release: async () => ({})
  };
  const PACKS = {
    "maik-lite": { label: "MAiK Lite", nCtx: 4096, nPredict: 512, noThink: true, files: [{ bytes: 1107408704 }] },
    "maik-mxcore": { label: "MAiK MxCore", nCtx: 4096, nPredict: 512, files: [{ bytes: 2489894976 }], vision: { bytes: 851252224 } }
  };
  const models = {
    PACKS, activePack: () => "maik-lite", installedCached: () => true, pathFor: async () => "/m.gguf",
    totalBytes: (id) => PACKS[id].files[0].bytes, hasVision: (id) => !!PACKS[id].vision, visionIdOf: (id) => id + "#vision", baseIdOf: (id) => id.split("#")[0]
  };
  const win = {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Capacitor: { isNativePlatform: () => true, Plugins: { Llama } },
    SMD_MAIK_MODELS: models, setTimeout, clearTimeout
  };
  win.window = win;
  new Function("window", "document", "setTimeout", "clearTimeout", SRC)(win, { addEventListener() {} }, setTimeout, clearTimeout);
  const L = win.SMD_MAIK_LOCAL;
  L.setIdleMs(50, 50);
  return { L, gen, setReply: (f) => { reply = f; } };
}
const json = (o) => JSON.stringify(o);

test("numbersIn ignores digits inside unit names; dropUnsupportedNumbers drops only the offending line", () => {
  const { L } = load();
  assert.deepEqual(L.numbersIn("BP 140/90, SpO2 96%, HbA1c 8.2, 1,500 ml"), ["140", "90", "96", "8.2", "1500"]);
  assert.deepEqual(L.numbersIn("3rd dose, 2nd day"), ["3", "2"], "ordinals count on the model side");
  assert.deepEqual(L.numbersIn("fever x3 days T101F BP120/80", true), ["3", "101", "120", "80"], "the source side is loose: x3, T101F, BP120/80 were all said");
  const r = L.dropUnsupportedNumbers("Fever 3 days\nEBL 200 ml\nPulse 88", "fever 3 days pulse 88");
  assert.equal(r.text, "Fever 3 days\nPulse 88"); assert.equal(r.dropped, 1);
  assert.deepEqual(L.dropUnsupportedNumbers(["a 5 mg", "b 7 mg"], "5 mg").items, ["a 5 mg"]);
  // Review findings: zero-padded dates, decimals and "x3" must not kill legitimate lines; a fabricated ordinal must.
  const z = L.dropUnsupportedNumbers("5 March 2026: BP 120/80\nDose 3 mg\n4th dose given", "05-03-2026: BP 120/80. Dose 3.0 mg. fever x3 days");
  assert.equal(z.text, "5 March 2026: BP 120/80\nDose 3 mg"); assert.equal(z.dropped, 1);
  assert.equal(L.canonNum("05"), "5"); assert.equal(L.canonNum("3.0"), "3"); assert.equal(L.canonNum(".5"), "0.5");
});

test("estTokens counts Indic script at more than one token per three characters; mergeText dedupes rewordings and caps", () => {
  const { L } = load();
  const te = "జ్వరం మూడు రోజులుగా ఉంది";
  assert.ok(L.estTokens(te) > te.length, "Indic: at least a token per character");
  assert.equal(L.estTokens("abcdefghij"), 3);
  assert.equal(L.mergeText("fever for 3 days with chills", "fever 3 days chills"), "fever for 3 days with chills", "a rewording is not new content");
  assert.equal(L.mergeText("fever 3 days", "productive cough"), "fever 3 days; productive cough");
  assert.ok(L.mergeText("x".repeat(1990), "new content here and more words").length <= 2000);
});

test("splitWindows: every character of a long record lands in exactly one window, none over budget", () => {
  const { L } = load();
  const lines = []; for (let i = 0; i < 400; i++) lines.push("2026-01-" + (i % 28 + 1) + " (Dr A): visit " + i + " fever " + (i + 100) + " noted; plan reviewed.");
  const text = lines.join("\n");
  assert.ok(L.estTokens(text) > 4096, "fixture must exceed the context");
  const wins = L.splitWindows(text, 800);
  assert.ok(wins.length >= 5);
  for (const w of wins) assert.ok(L.estTokens(w) <= 800, "window over budget");
  const strip = (s) => s.replace(/\s+/g, "");
  assert.equal(strip(wins.join("")), strip(text), "windows must reassemble to the source (nothing dropped)");
  const one = "x".repeat(5000);
  assert.ok(L.splitWindows(one, 300).every((w) => L.estTokens(w) <= 300), "an unbroken run is hard-cut, not dropped");
});

test("summarize(): a >4K record is processed in windows and reduced; no window content is skipped", async () => {
  const { L, gen, setReply } = load();
  setReply((p) => (/consecutive parts/.test(p.prompt) ? "Merged: problems, course" : "Part summary"));
  const lines = []; for (let i = 0; i < 700; i++) lines.push("2026-02-" + (i % 28 + 1) + ": consult " + i + ", BP " + (110 + (i % 40)) + "/80, plan reviewed.");
  assert.ok(L.estTokens(lines.join("\n")) > 4096, "fixture must exceed the context");
  const r = await L.summarize(lines.join("\n"));
  assert.equal(r.engine, "local"); assert.ok(r.windows >= 3, "windows: " + r.windows);
  const mapPrompts = gen.filter((p) => /=== ENTRIES ===/.test(p.prompt)).map((p) => p.prompt).join("\n");
  for (const l of lines) assert.ok(mapPrompts.indexOf(l) >= 0, "line missing from every window: " + l);
  assert.ok(gen.some((p) => /consecutive parts/.test(p.prompt)), "a reduce pass ran");
  assert.equal(r.text, "Merged: problems, course");
});

test("summarize(): a figure the record never stated is dropped from the output", async () => {
  const { L, setReply } = load();
  setReply(() => "Problems: fever 3 days\nCourse: EBL 900 ml noted\nPending: CBC\nSeen 1 March 2026");
  const r = await L.summarize("01-03-2026: fever 3 days. plan CBC.");
  assert.ok(r.text.indexOf("900") < 0, "invented figure removed"); assert.equal(r.droppedLines, 1);
  assert.ok(r.text.indexOf("Seen 1 March 2026") >= 0, "a re-formatted zero-padded date is not a fabricated number");
  assert.ok(r.text.indexOf("**") < 0, "plain text: the clinic summary is rendered escaped");
});

test("assess(): whitelist of five keys, Indic stripped, non-strings dropped, unsupported numbers dropped", async () => {
  const { L, setReply } = load();
  setReply(() => json({ cc: "fever x3 days (జ్వరం)", presentHx: ["array"], pastHx: "DM 10 years", provisionalDx: "viral fever", managementPlan: "paracetamol 650 mg", extra: "no" }));
  const r = await L.assess("fever three days, diabetic for 10 years, plan paracetamol 650 mg");
  assert.equal(r.kind, "assessment"); assert.equal(r.engine, "local");
  assert.deepEqual(Object.keys(r.fields).sort(), ["cc", "managementPlan", "pastHx", "provisionalDx"]);
  assert.equal(r.fields.cc, "fever x3 days");
  const r2 = await L.assess("fever three days");
  assert.equal(r2.fields.managementPlan, undefined, "650 mg was never spoken here");
});

test("scribeFill(): rolling window with running state; later text is not re-sent in full", async () => {
  const { L, gen, setReply } = load();
  setReply((p) => /different consult/.test(p.prompt) ? json({ en: "new consult", emrFields: {}, suggestions: {} })
    : /NEW TRANSCRIPT ===\n[\s\S]*second/.test(p.prompt)
    ? json({ en: "second part", emrFields: { htn: "Yes", presentHx: "headache 2 days" }, suggestions: { ddx: ["migraine", "tension headache"], investigations: [] } })
    : json({ en: "first part", emrFields: { cc: "fever 3 days", htn: "No", dm: "yes" }, suggestions: { provisionalDx: "viral fever", ddx: ["dengue", "Migraine"], investigations: ["CBC"] } }));
  // The second-pass reply re-emits dm as "No" (a small model echoing every key): it must not win.
  const second = { en: "second part", emrFields: { htn: "Yes", dm: "No", presentHx: "headache 2 days" }, suggestions: { ddx: ["migraine", "tension headache"], investigations: [] } };
  setReply((p) => /different consult/.test(p.prompt) ? json({ en: "new consult", emrFields: {}, suggestions: {} })
    : /NEW TRANSCRIPT ===\n[\s\S]*second/.test(p.prompt) ? json(second)
    : json({ en: "first part", emrFields: { cc: "fever 3 days", htn: "No", dm: "yes" }, suggestions: { provisionalDx: "viral fever", ddx: ["dengue", "Migraine"], investigations: ["CBC"] } }));
  const a = "Patient has fever for three days. " + "He is diabetic. ".repeat(80);   // ~1.3K chars, well past the 400-char overlap
  const r1 = await L.scribeFill(a);
  assert.equal(r1.emrFields.cc, "fever 3 days"); assert.equal(r1.emrFields.dm, "Yes", "yes/no normalised"); assert.equal(r1.emrFields.htn, "No");
  assert.ok(gen[gen.length - 1].prompt.indexOf("ALREADY CAPTURED") < 0, "first pass has nothing captured");
  const b = a + " Also a second complaint: headache for two days, and he is hypertensive.";
  const r2 = await L.scribeFill(b);
  const last = gen[gen.length - 1].prompt;
  assert.ok(last.indexOf("ALREADY CAPTURED") >= 0, "second pass carries the state");
  assert.ok(last.indexOf("second complaint") >= 0, "new text is sent");
  assert.ok((last.match(/He is diabetic\./g) || []).length < 40, "the whole earlier transcript is not re-sent (only the 400-char overlap)");
  assert.equal(r2.emrFields.cc, "fever 3 days", "earlier narrative kept");
  assert.equal(r2.emrFields.htn, "Yes", "a later No -> Yes is accepted");
  assert.equal(r2.emrFields.dm, "Yes", "a captured Yes is never flipped by a window that does not mention it");
  assert.equal(r2.emrFields.presentHx, "headache 2 days");
  assert.deepEqual(r2.suggestions.ddx, ["dengue", "Migraine", "tension headache"], "union, case-insensitive");
  assert.equal(r2.suggestions.provisionalDx, "viral fever", "kept when the new pass has none");
  assert.equal(r2.en, "first part second part");
  const r3 = await L.scribeFill("A different consult entirely.");
  assert.ok(gen[gen.length - 1].prompt.indexOf("ALREADY CAPTURED") < 0, "a transcript that does not extend the last one starts clean");
  assert.equal(r3.emrFields.cc, undefined);
});

test("noteStructure(): schema allow-list, never-AI-fillable keys dropped even when allowed, fabricated numbers dropped", async () => {
  const { L, setReply } = load();
  setReply(() => json({ fields: { findings: "inflamed appendix, no perforation", ebl: "EBL 200 ml", counts: "correct x2", procedure: "open appendicectomy", bogus: "x", drains: "not stated" } }));
  const r = await L.noteStructure("Open appendicectomy. Findings inflamed appendix no perforation. Blood loss minimal.",
    [{ k: "findings", label: "Findings" }, { k: "ebl", label: "Estimated blood loss" }, { k: "counts", label: "Counts" }, { k: "procedure", label: "Procedure" }, { k: "drains", label: "Drains" }], "operative");
  assert.equal(r.kind, "surgx-note"); assert.equal(r.engine, "local");
  assert.deepEqual(Object.keys(r.fields).sort(), ["findings", "procedure"]);
  assert.ok(r.dropped.indexOf("counts") >= 0, "counts are structurally unreachable");
  assert.ok(r.dropped.indexOf("ebl") >= 0, "200 was never said");
  assert.ok(r.dropped.indexOf("bogus") >= 0 && r.dropped.indexOf("drains") >= 0);
  assert.deepEqual(await L.noteStructure("x", []), { error: "no allowedFields" });
});

test("icdRank(): only supplied candidates survive; no candidates means no model call and no codes", async () => {
  const { L, gen, setReply } = load();
  const cands = [{ id: "icd10:E11.9", system: "ICD-10", code: "E11.9", title: "Type 2 diabetes mellitus without complications" }, { id: "icd11:5A11", system: "ICD-11", code: "5A11", title: "Type 2 diabetes mellitus" }];
  setReply(() => json({ suggestions: [{ id: "icd10:E11.9", confidence: "high", why: "stated T2DM", code: "WRONG" }, { id: "icd10:E10.9", confidence: "high", why: "invented" }, { id: "icd11:5A11", confidence: "silly" }] }));
  const r = await L.icdRank("type 2 diabetes", cands);
  assert.equal(r.suggestions.length, 2);
  assert.equal(r.suggestions[0].code, "E11.9", "the candidate's own code, never the model's transcription");
  assert.equal(r.suggestions[1].confidence, "medium", "unknown confidence normalised");
  assert.ok(!r.suggestions.some((s) => s.id === "icd10:E10.9"), "an id not in the candidates is dropped, not corrected");
  const n = gen.length;
  const empty = await L.icdRank("type 2 diabetes", []);
  assert.deepEqual(empty.suggestions, []); assert.equal(gen.length, n, "no candidates: the model is not even asked");
});

test("reasoningExtract(): a 500-key catalog is sliced across passes and only catalog keys survive", async () => {
  const { L, gen, setReply } = load();
  const cat = []; for (let i = 0; i < 500; i++) cat.push({ key: "f" + i, label: "finding number " + i + " with a long label" });
  setReply((p) => json({ findings: [/f7 =/.test(p.prompt) ? "f7" : "f499", "invented", "f2"], patient: { age: 45, sex: "male" }, unmatched: ["odd phrase"] }));
  const before = gen.length;
  const r = await L.reasoningExtract("45 year old man with fever", cat);
  assert.ok(r.passes >= 2, "passes: " + r.passes); assert.equal(gen.length - before, r.passes);
  assert.ok(r.findings.indexOf("invented") < 0);
  assert.ok(r.findings.indexOf("f7") >= 0 && r.findings.indexOf("f2") >= 0);
  assert.deepEqual(r.patient, { age: 45, sex: "male" });
});

test("maikNext / maikExtract: shapes and whitelists match the server sanitizers", async () => {
  const { L, setReply } = load();
  setReply(() => json({ action: "ask", question: "  Since when the pain?  ", language: "en", targetField: "onset", priority: "weird", reason: "next" }));
  const n = await L.maikNext({ targetField: "onset", targetHint: "onset of pain", language: "en", known: {} });
  assert.equal(n.action, "ask"); assert.equal(n.question, "Since when the pain?"); assert.equal(n.priority, "normal");
  setReply(() => json({ action: "dance", question: "x" }));
  assert.equal((await L.maikNext({})).action, "finish", "unknown action is a safe finish");
  setReply(() => json({ findings: [{ field: "hx.onset", value: "3 days", confidence: 0.9 }, { field: "notallowed", value: "x" }, { field: "side", value: "" }] }));
  const e = await L.maikExtract({ allowedFields: ["onset", "side"], question: "since when?" }, "three days");
  assert.deepEqual(e.findings, [{ field: "onset", value: "3 days", confidence: 0.9 }]);
});

test("imagingSummary / correlate: forbidden certainty phrases and unsupported figures are removed", async () => {
  const { L, setReply } = load();
  setReply(() => json({ summary: "Imaging is suggestive of consolidation; the patient definitely has pneumonia", positives: ["right lower lobe consolidation", "effusion 500 ml"], negatives: [], significance: [], differentials: ["pneumonia"], correlateWith: [], redFlags: [], nextChecks: [] }));
  const r = await L.imagingSummary({ reportText: "Right lower lobe consolidation. Small effusion.", modality: "CXR" });
  assert.equal(r.mode, "imaging"); assert.equal(r.summary.summary, "", "certainty phrase voids the sentence");
  assert.deepEqual(r.summary.positives, ["right lower lobe consolidation"], "500 ml was not in the report");
  setReply(() => json({ clinicalCorrelation: "Findings are suggestive of sepsis; consider correlation.", topConsiderations: ["sepsis"], whyFit: [], alternatives: [], whatDoesntFit: [], missing: [], redFlags: [], nextChecks: [], protocols: [] }));
  const c = await L.correlate({ imaging: { concepts: ["consolidation"] }, labs: { abnormalities: ["WBC 18000"] } });
  assert.equal(c.mode, "correlate"); assert.equal(c.correlation.topConsiderations[0], "sepsis");
  assert.deepEqual(await L.correlate({}), { error: "no-evidence" });
});

test("translate(): the guard refuses native script, lost numbers and invented numbers", async () => {
  const { L, setReply } = load();
  setReply(() => "Fever for 3 days, paracetamol 500 mg BD");
  assert.equal((await L.translate("జ్వరం 3 days, paracetamol 500 mg BD")).text, "Fever for 3 days, paracetamol 500 mg BD");
  setReply(() => "జ్వరం 3 days");
  assert.equal((await L.translate("జ్వరం 3 days")).reason, "native-script");
  setReply(() => "Fever for three days, paracetamol 500 mg BD");
  assert.equal((await L.translate("జ్వరం 3 days, paracetamol 500 mg BD")).reason, "number-lost");
  setReply(() => "Fever 3 days, paracetamol 500 mg BD x 5 days");
  assert.equal((await L.translate("జ్వరం 3 days, paracetamol 500 mg BD")).reason, "number-added");
});

test("persona modes: answer() with mode clinix-tutor / surgx-mentor runs on the persona prompt", async () => {
  const { L, gen, setReply } = load();
  setReply(() => "Because the diaphragm flattens.");
  await L.answer({ summary: "", question: "why is percussion hyperresonant in emphysema?" }, { mode: "clinix-tutor" });
  assert.equal(gen[gen.length - 1].system, L.TUTOR_SYS);
  await L.answer({ summary: "", question: "next step in a bleeding lap chole?" }, { mode: "surgx-mentor" });
  assert.equal(gen[gen.length - 1].system, L.SURG_SYS);
  await L.answer({ summary: "", question: "dose of amoxicillin in CAP?" }, {});
  assert.notEqual(gen[gen.length - 1].system, L.TUTOR_SYS, "no mode: the ordinary prompt");
});
