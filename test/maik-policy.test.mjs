/* test/maik-policy.test.mjs - the hard Local / Cloud policy (maik-engine.js, 2026-09-11).
 *
 * THE ACCEPTANCE TEST: with the Local engine selected and the network ON, no cloud AI inference
 * happens for any feature. Every feature either runs on the on-device engine or returns a
 * structured LOCAL_CAPABILITY_REQUIRED result naming what is missing and which pack unlocks it on
 * THIS phone. Cloud mode is untouched. KB-only never spends.
 *
 * The REAL registry (maik-models.js) is loaded so the matcher runs on real caps and suitability;
 * the on-device engine and the cloud transport are spies. "Installed" is the registry's own
 * marker (localStorage) so installed() is the real one too.
 *
 * node --test test/maik-policy.test.mjs
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

function load(o = {}) {
  const cloud = [], local = [], fetches = [];
  const ls = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  const Llama = { available: async () => ({ available: true, loaded: false, debugBuild: true, availableMemory: 0 }), excludeFromBackup: async () => ({}) };
  const win = {
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: { Filesystem: {}, Llama } },
    localStorage: ls, navigator: { onLine: o.onLine !== false },
    fetch: async (url) => { fetches.push(url); return { ok: true, json: async () => ({ results: [{ id: "icd10:A00", system: "ICD-10", code: "A00", title: "Cholera" }] }) }; },
    SMD_PRO: { isProSync: () => true, proKnown: () => true },
    SMD_AI: {}, SMD_MAIK_LOCAL: { available: () => true, visionReady: (id) => !!o.visionReady && id === o.visionReady, currentPack: () => "maik-lite" }
  };
  AI_METHODS.forEach((m) => { win.SMD_AI[m] = (...a) => { cloud.push([m, a]); return Promise.resolve({ text: "CLOUD " + m, engine: "cloud", mode: a[1] }); }; });
  win.SMD_AI.researchSnippets = (...a) => { fetches.push("snippets"); return Promise.resolve({ sources: [{ title: "S", url: "https://x", site: "X", snippet: "s" }] }); };
  win.SMD_AI.evidence = (...a) => { fetches.push("evidence"); return Promise.resolve({ results: [] }); };
  LOCAL_FNS.forEach((f) => { win.SMD_MAIK_LOCAL[f] = (...a) => { local.push([f, a]); return Promise.resolve({ text: "LOCAL " + f, engine: "local", kind: f }); }; });
  win.window = win;
  new Function("window", "localStorage", "navigator", MODELS)(win, ls, win.navigator);
  new Function("window", "localStorage", "navigator", ENGINE)(win, ls, win.navigator);
  const M = win.SMD_MAIK_MODELS, E = win.SMD_MAIK_ENGINE;
  M.setDevice(Object.assign({ platform: "android", ramGB: 8, ramGBMin: false, availGB: null, hardLimit: false, freeGB: null, battery: null, at: 1 }, o.device || {}));
  const install = (id) => { ls.setItem("smd_maik_pack_" + id, "1"); ls.setItem("smd_maik_packsha_" + id, M.PACKS[M.baseIdOf(id)].files[0].sha256); };
  const inst = o.installed || ["maik-lite"];
  inst.forEach(install);
  if (o.visionReady) install(o.visionReady + "#vision");
  ls.setItem("smd_maik_local_bypass", "1");
  // The ANSWERING pack (activePack) is by design one that is installed; a pack the clinician has
  // asked for but not downloaded is KEY_PENDING, never active. So the default pin is the first
  // installed pack, as the real adoptPackWhenReady() would leave it.
  M.setActivePack(o.active || inst[0] || "maik-lite");
  E.install();
  E.setPref(o.pref || "local");
  const A = win.SMD_AI;
  return { win, ls, M, E, A, cloud, local, fetches, install };
}
const aiCloudCalls = (cloud) => cloud.filter(([m]) => AI_METHODS.indexOf(m) >= 0);

test("CLOUD mode: every AI method goes to the cloud transport, the on-device engine is never touched", async () => {
  const { A, cloud, local } = load({ pref: "cloud" });
  await A.explainGrounded({ question: "q" }, {}); await A.extract("t", "opd-scribe"); await A.maik("maik-ask-next", { language: "te" }, "");
  await A.summary("timeline"); await A.imagingSummary({ reportText: "r" }); await A.correlate({}); await A.translate("జ్వరం");
  await A.transcribe("data:audio"); await A.vision("data:image", "monitor"); await A.visionText("t", "labs"); await A.research("q", "evidence-review");
  assert.equal(aiCloudCalls(cloud).length, 11);
  assert.equal(local.length, 0);
});

test("LOCAL mode + network ON: no cloud AI inference for ANY feature; each runs locally or refuses with a named reason", async () => {
  const { A, E, cloud, local, fetches } = load({ onLine: true });
  assert.equal(E.effective(), "local"); assert.equal(E.cloudAllowed(), false);
  const r = {};
  r.explain = await A.explain("summary", "q");
  r.grounded = await A.explainGrounded({ question: "q" }, { depth: "concise" });
  r.stream = await A.explainGroundedStream({ question: "q" }, {}, () => {});
  r.refine = await A.refine("q");
  r.viva = await A.vivaJudge("q", "k", "a");
  r.web = await A.research("q", undefined, []);
  r.evidence = await A.research("q", "evidence-review", []);
  r.opd = await A.extract("t", "opd-suggest");
  r.assess = await A.extract("t", "assessment");
  r.scribe = await A.extract("t", "opd-scribe");
  r.note = await A.extract("t", "surgx-note", { allowedFields: [{ k: "findings", label: "Findings" }], noteType: "operative" });
  r.icd = await A.extract("type 2 diabetes", "icd-suggest");
  r.reason = await A.extract("t", "reasoning", [{ key: "fever", label: "Fever" }]);
  r.next = await A.maik("maik-ask-next", { language: "en", targetField: "onset" }, "");
  r.extract = await A.maik("maik-ask-extract", { allowedFields: ["onset"] }, "three days");
  r.summary = await A.summary("2026-01-01: visit");
  r.imaging = await A.imagingSummary({ reportText: "consolidation" });
  r.correlate = await A.correlate({ imaging: { concepts: ["x"] } });
  r.translateEn = await A.translate("fever 3 days");
  r.translateTe = await A.translate("జ్వరం 3 days");
  r.transcribe = await A.transcribe("data:audio");
  r.vision = await A.vision("data:image", "monitor");
  r.visionText = await A.visionText("BP 120/80", "monitor");

  assert.equal(aiCloudCalls(cloud).length, 0, "NO cloud AI call in Local mode: " + JSON.stringify(aiCloudCalls(cloud).map((c) => c[0])));
  const ran = local.map(([f]) => f);
  assert.deepEqual(ran, ["answer", "answer", "answer", "vivaJudge", "webAnswer", "opdSuggest", "assess", "scribeFill", "noteStructure", "icdRank", "reasoningExtract", "maikNext", "maikExtract", "summarize", "imagingSummary", "correlate", "translate"], "ran: " + JSON.stringify(ran));
  assert.equal(r.refine, null, "refine has no local router and no spend");
  assert.ok(fetches.indexOf("snippets") >= 0, "web research fetched raw snippets (retrieval, not inference)");
  assert.ok(fetches.some((u) => /\/api\/icd\/search\?q=type%202%20diabetes/.test(u)), "ICD candidates come from the ICD database, not a model");
  assert.equal(local.find(([f]) => f === "icdRank")[1][1][0].code, "A00", "the model only ranks the rows the database returned");
  assert.equal(local.find(([f]) => f === "noteStructure")[1][1][0].k, "findings", "allowedFields reach the local structurer");
  assert.equal(local.find(([f]) => f === "answer")[1][1].pack, "maik-lite", "the matched pack is passed to the engine");
  for (const k of ["evidence", "translateTe", "transcribe", "vision", "visionText"]) assert.equal(r[k].error, "LOCAL_CAPABILITY_REQUIRED", k);
  assert.equal(r.evidence.cloudOnly, true); assert.match(r.evidence.message, /MaiK Cloud feature/);
  assert.equal(r.translateTe.language, "te"); assert.match(r.translateTe.message, /Telugu/);
  assert.deepEqual(r.translateTe.recommendedModels, [], "no pack has passed the Telugu eval, so none is recommended");
  assert.match(r.transcribe.message, /Whisper/);
  assert.equal(r.vision.requiredCapabilities[0], "vision");
  assert.equal(r.vision.recommendedModels[0].id, "maik-mxcore", "the smallest pack that can see, on this phone");
  assert.equal(r.vision.cloud, true, "cloud is offered as an explicit alternative");
  assert.equal(r.summary.pack, "maik-lite");
});

test("LOCAL mode + network OFF: same behaviour; ICD candidates cannot be fetched so no code is produced", async () => {
  const { A, cloud, local, fetches } = load({ onLine: false });
  await A.explainGrounded({ question: "q" }, {}); await A.extract("t", "opd-scribe"); await A.summary("t");
  const icd = await A.extract("dm", "icd-suggest");
  assert.equal(aiCloudCalls(cloud).length, 0);
  assert.equal(icd.error, "ICD_INDEX_OFFLINE"); assert.match(icd.message, /no AI/);
  assert.equal(fetches.length, 0, "nothing fetched offline");
  assert.ok(!local.some(([f]) => f === "icdRank"), "no candidates, no ranking, no invented code");
});

test("capability failure: Lite installed, an image question -> LOCAL_CAPABILITY_REQUIRED with a vision-pack recommendation, never Gemini", async () => {
  const { win, A, cloud, local } = load();
  win.__MAIK_IMAGES = { attached: () => ["/tmp/x.jpg"], asked: () => false, markAsked() {} };
  const r = await A.explainGrounded({ question: "is this normal?" }, {});
  assert.equal(r.error, "LOCAL_CAPABILITY_REQUIRED"); assert.equal(r.feature, "vision"); assert.equal(r.currentModel, "MAiK Lite");
  assert.equal(r.recommendedModels[0].id, "maik-mxcore"); assert.equal(r.recommendedModels[0].level, "warn", "vision on an 8 GB phone is offered with its limitation named");
  assert.ok(r.recommendedModels[0].unlocks.some((u) => /image/i.test(u)));
  assert.equal(aiCloudCalls(cloud).length, 0); assert.equal(local.length, 0);
});

test("upgrade path: with MxCore + projector installed the image question runs locally on MxCore", async () => {
  const { win, A, local, cloud } = load({ installed: ["maik-lite", "maik-mxcore"], visionReady: "maik-mxcore", active: "maik-mxcore" });
  win.__MAIK_IMAGES = { attached: () => ["/tmp/x.jpg"], asked: () => false, markAsked() {} };
  const r = await A.explainGrounded({ question: "is this normal?" }, {});
  assert.equal(r.engine, "local"); assert.equal(local[0][0], "answer"); assert.equal(local[0][1][1].pack, "maik-mxcore"); assert.deepEqual(local[0][1][1].images, ["/tmp/x.jpg"]);
  assert.equal(aiCloudCalls(cloud).length, 0);
});

test("model switching: the pinned pack is respected when it qualifies; otherwise the prefer tier among installed packs", async () => {
  const a = load({ installed: ["maik-lite", "bonsai-ternary-8b"], active: "maik-lite" });
  await a.A.summary("t");
  assert.equal(a.local[0][1][1].pack, "maik-lite", "pinned Lite meets the floor, so it answers even though summary prefers a higher tier");
  // Pinned Swift (json 1): a structured feature cannot use it, so the matcher picks among the
  // OTHER installed packs: the preferred tier when the feature names one, else the smallest.
  const b = load({ installed: ["bonsai-8b", "maik-lite", "bonsai-ternary-8b"], active: "bonsai-8b" });
  await b.A.imagingSummary({ reportText: "r" });
  assert.equal(b.local[0][1][1].pack, "bonsai-ternary-8b", "pinned pack does not qualify: the installed pack at the preferred tier");
  await b.A.extract("t", "opd-suggest");
  assert.equal(b.local[1][1][1].pack, "maik-lite", "no preference: the smallest medical pack that qualifies");
  await b.A.explainGrounded({ question: "q" }, {});
  assert.equal(b.local[2][1][1].pack, "bonsai-8b", "a plain question: the pinned pack qualifies and answers");
  const c = load({ installed: ["bonsai-8b"], active: "bonsai-8b" });
  const r = await c.A.extract("t", "opd-scribe");
  assert.equal(r.error, "LOCAL_CAPABILITY_REQUIRED", "Swift is weak at strict JSON and is never used for extraction");
  assert.ok(r.recommendedModels.length && r.recommendedModels.every((x) => x.id !== "bonsai-8b"));
  assert.match(r.message, /structured-output/);
});

test("device gating: a 6 GB phone gets no 8 GB-floor recommendation, a 12 GB phone is offered Max", async () => {
  const six = load({ device: { ramGB: 6 } });
  const r6 = await six.A.vision("data:image", "monitor");
  assert.deepEqual(r6.recommendedModels, [], "no vision pack fits a 6 GB phone");
  assert.ok(r6.unsuitableModels.some((x) => x.id === "maik-mxcore" && /Needs a 8 GB phone/.test(x.reasons[0])));
  assert.match(r6.message, /not suitable for this phone/); assert.match(r6.message, /MaiK Cloud/);
  const twelve = load({ device: { ramGB: 12 } });
  const html = twelve.E.capsHTML();
  assert.ok(html.indexOf("LOCAL AI") >= 0 && html.indexOf("MAiK Lite") >= 0);
  assert.ok(/Bonsai Max[\s\S]*Runs well/.test(html), "Max is offered on 12 GB");
  const eight = load({ device: { ramGB: 8 } });
  assert.ok(/Bonsai Max[\s\S]*Not for this phone/.test(eight.E.capsHTML()), "and refused on 8 GB, with no download button");
  assert.ok(!/data-me-upgrade="bonsai-27b"/.test(eight.E.capsHTML()));
  assert.ok(/data-me-upgrade="maik-mxcore"/.test(eight.E.capsHTML()), "MxCore can be downloaded, only on a tap");
});

test("KB-only: answer kinds get the notice, structured kinds get { error: kb-only }, nothing reaches the cloud or a model", async () => {
  const { A, cloud, local } = load({ pref: "rag" });
  const n = await A.explainGrounded({ question: "q" }, {}); assert.match(n.text, /KB-only mode is on/);
  const x = await A.extract("t", "opd-suggest"); assert.equal(x.error, "kb-only");
  assert.equal(aiCloudCalls(cloud).length, 0); assert.equal(local.length, 0);
});

test("persona and tutor turns stay local: clinix-tutor mode is passed through to answer()", async () => {
  const { A, local } = load();
  await A.explainGroundedStream({ question: "why?" }, { depth: "concise", mode: "clinix-tutor" }, () => {});
  assert.equal(local[0][1][1].mode, "clinix-tutor");
});

test("recovery switch smd_maik_hard_local=0 restores the old fall-through (documented, off by default)", async () => {
  const { A, ls, E, cloud } = load();
  assert.equal(E.hardLocal(), true);
  ls.setItem("smd_maik_hard_local", "0");
  await A.translate("జ్వరం 3 days");
  assert.equal(aiCloudCalls(cloud).length, 1, "with the switch off, an unmatched feature falls through to the cloud as before");
});

test("a kind with no local implementation is refused WITHOUT a model recommendation (nothing unlocks code that does not exist)", async () => {
  const { A, cloud, local } = load({ installed: ["maik-lite", "maik-mxcore"] });
  const r = await A.extract("BP 120 over 80", "monitor");
  assert.equal(r.error, "LOCAL_CAPABILITY_REQUIRED"); assert.equal(r.noImpl, true);
  assert.deepEqual(r.recommendedModels, []); assert.match(r.message, /no on-device implementation/);
  assert.equal(aiCloudCalls(cloud).length, 0); assert.equal(local.length, 0);
  assert.equal((await A.vision("data:image", "monitor")).recommendedModels[0].unlocks.some((u) => /Scribe/.test(u)), true, "unlocks come from the registry caps, so structured output is listed");
});

test("cloud pref + offline: the installed model stands in, and refusals say 'offline' rather than 'switch to Cloud'", async () => {
  const { A, E } = load({ pref: "cloud", onLine: false });
  assert.equal(E.effective(), "local"); assert.equal(E.policyReason(), "offline");
  const r = await A.translate("జ్వరం 3 days");
  assert.equal(r.error, "LOCAL_CAPABILITY_REQUIRED"); assert.equal(r.offline, true); assert.equal(r.cloud, false);
  assert.match(r.message, /offline/); assert.ok(!/switch/i.test(r.message));
});

test("cloudAllowed() is the single signal image-engine.js and voice.js read", () => {
  const c = load({ pref: "cloud" }); assert.equal(c.E.cloudAllowed(), true);
  const l = load({ pref: "local" }); assert.equal(l.E.cloudAllowed(), false);
  const r = load({ pref: "rag" }); assert.equal(r.E.cloudAllowed(), false);
  const stale = load({ pref: "local", installed: [] }); assert.equal(stale.E.effective(), "rag"); assert.equal(stale.E.cloudAllowed(), false, "a Local pref with no pack is KB-only, never cloud");
});
