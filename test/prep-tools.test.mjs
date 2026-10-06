/* prep-tools.test.mjs - the owner-side PrepNucleus AI tools: tools/prep-vertex.mjs (client), tools/prep-measure.mjs
 * (Phase 0), tools/prep-screen-keys.mjs (Phase 1 key screen) and tools/prep-fill.mjs (Layer B fill and merge).
 * Vertex and GCS are a fake in this file: no request leaves the process, nothing is spent.
 * Plan: vault/plans/PrepNucleus.md 5.1, 6.3, 9.1, 10; vault/plans/PrepNucleus-LayerC.md 5 (Phase 0), 6 to 8.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-tools.test.mjs
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as V from "../tools/prep-vertex.mjs";
import * as M from "../tools/prep-measure.mjs";
import * as K from "../tools/prep-screen-keys.mjs";
import * as F from "../tools/prep-fill.mjs";
import * as C from "../tools/prep-classify.mjs";
import * as E from "../tools/prep-map-eval.mjs";
import { loadTaxonomy, subjectIndex } from "../tools/prep-build-bank.mjs";
import { normText, solveMatches } from "../functions/_prep-core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "fixtures", "prep-tools");
const CFG = { project: "proj-test", location: "us-central1", model: "gemini-3.1-flash-lite", bucket: "prep-test-bucket" };
const quiet = () => {};
const DASH = /[\u2013\u2014]/;   // en dash, em dash (escaped so this file stays free of them)

/* ---- the fake model ("brain"): answers by op, decided from the system prompt the core wrote ---- */
const COPY = "Differentiation syndrome presents with fever, weight gain, pulmonary infiltrates and serous effusions after treatment starts.";
const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar"];
function makeBrain(o = {}) {
  const keys = new Map(o.truth || []);   // normalised stem -> the option text the solver believes
  const seen = { facts: 0, mcq: 0, solve: 0, review: 0, mcqSystems: [] };
  function facts(user) {
    const f = [];
    for (const m of user.matchAll(/^\[(\d+)\] (.+)$/gm)) {
      const n = Number(m[1]), w = m[2].split(/\s+/);
      f.push({ ft: "Point: " + w.slice(0, 6).join(" "), cq: "What does the text say about " + w.slice(0, 3).join(" ").replace(/[0-9]/g, "") + "?", sn: [n], fk: "recall" });
    }
    return { f: f.slice(0, 15) };
  }
  function mcq(system, user) {
    seen.mcqSystems.push(system);
    const regen = /was rejected/.test(user);
    const q = [];
    for (const m of user.matchAll(/^\[(\d+)\] (.+)\n\s+source: (.+)$/gm)) {
      const fi = Number(m[1]), ft = m[2], src = m[3], w = WORDS[(fi + (regen ? 7 : 0)) % WORDS.length];
      let item = {
        st: `Which option best fits this teaching point ${w}: ${ft.replace(/^Point: /, "")}?`,
        key: { ot: "true statement " + w, wr: "It matches the stated point." },
        dis: [{ ot: "false statement one", wr: "Not what the text says.", et: "knowledge" }, { ot: "false statement two", wr: "A common confusion.", et: "confused" }, { ot: "false statement six", wr: "An exception, not the rule.", et: "exception" }],
        kp: "Remember the stated point " + w + ".", fi, dl: 2, cog: "recall",
      };
      if (/retinoic acid is given/i.test(src)) item.key = { ot: regen ? "45 mg/m2 daily" : "60 mg/m2 daily", wr: "Induction dose." }, item.dis = [{ ot: "15 mg/m2 daily", wr: "Too low.", et: "calc" }, { ot: "90 mg/m2 daily", wr: "Double.", et: "calc" }, { ot: "30 mg/m2 daily", wr: "Too low.", et: "calc" }];
      if (/coagulation/i.test(src) && !regen) item.kp = COPY;
      if (o.mcq) item = o.mcq(item, { fi, ft, src, regen, system }) || item;
      keys.set(normText(item.st), item.key.ot);
      q.push(item);
    }
    return { q };
  }
  function solve(user) {
    const s = [];
    for (const blk of user.replace(/^<questions>\n|\n<\/questions>$/g, "").split(/\n\n(?=Q\d+: )/)) {
      const m = /^Q(\d+): (.*)\n([\s\S]*)$/.exec(blk);
      if (!m) continue;
      const opts = m[3].split("\n").map((l) => l.replace(/^[A-D]\. /, ""));
      let pick = keys.get(normText(m[2]));
      if (o.solve) pick = o.solve({ stem: m[2], opts, believed: pick });
      s.push({ i: Number(m[1]), ot: pick == null ? opts[0] : pick });
    }
    return { s };
  }
  function review(user) {
    const n = (user.match(/^Q\d+: /gm) || []).length;
    return { g: Array.from({ length: n }, (_, i) => ({ i, g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true, old: false, why: "" })) };
  }
  function classify(sys, user) {
    const anatomy = /subject: Anatomy\./.test(sys), c = [];
    for (const m of user.matchAll(/^\[(\d+)\] Q: (.+)$/gm)) {
      const q = m[2];
      let id = "med-aml", conf = "high";
      if (/nerve|coronary|valve/i.test(q)) id = anatomy ? (/nerve/i.test(q) ? "ana-upper-limb-nerves" : "ana-heart") : "anatomy";
      else if (/philadelphia|imatinib|chronic myeloid/i.test(q)) id = "med-cml";
      else if (/UNKNOWNTOPIC/.test(q)) id = "made-up-module";
      else if (/splenomegaly/i.test(q)) conf = "low";
      c.push({ i: Number(m[1]), m: id, conf });
    }
    return { c };
  }
  return {
    keys, seen,
    answer(body) {
      const sys = body.systemInstruction.parts[0].text, user = body.contents[0].parts[0].text;
      let out;
      if (/You sort MBBS exam questions/.test(sys)) { seen.classify = (seen.classify || 0) + 1; out = classify(sys, user); }
      else if (/extract testable medical facts/.test(sys)) { seen.facts++; out = facts(user); }
      else if (/write single-best-answer MCQs/.test(sys)) { seen.mcq++; out = mcq(sys, user); }
      else if (/Answer each question as the examiner/.test(sys)) { seen.solve++; out = solve(user); }
      else { seen.review++; out = review(user); }
      const text = JSON.stringify(out);
      return { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: Math.ceil((sys.length + user.length) / 4), candidatesTokenCount: Math.ceil(text.length / 4), thoughtsTokenCount: 0 }, modelVersion: "gemini-3.1-flash-lite-fake" };
    },
  };
}

/* ---- the fake Vertex + GCS: generateContent, batchPredictionJobs, GCS JSON API ---- */
function fakeVertex(brain, o = {}) {
  const gcs = new Map(), jobs = new Map(), reqs = [];
  let seq = 0, execCalls = 0;
  const fail = (o.fail || []).slice();
  const json = (x, status = 200, headers = {}) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json", ...headers } });
  function complete(j) {
    const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(j.b.inputConfig.gcsSource.uris[0]);
    const lines = gcs.get(m[1] + "/" + m[2]).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const out = lines.map((l) => { const r = { request: l.request, response: brain.answer(l.request), status: "" }; if (!o.dropKey) r.key = l.key; return r; });
    if (o.shuffleOut) out.reverse();
    const om = /^gs:\/\/([^/]+)\/(.+)$/.exec(j.b.outputConfig.gcsDestination.outputUriPrefix);
    const dir = om[2] + "prediction-model-2026-10-05T00:00:00Z";
    gcs.set(om[1] + "/" + dir + "/predictions.jsonl", out.map((x) => JSON.stringify(x)).join("\n") + "\n");
    j.outDir = `gs://${om[1]}/${dir}`;
    j.state = "JOB_STATE_SUCCEEDED";
  }
  const fetch = async (u, init = {}) => {
    const url = String(u), method = init.method || "GET";
    reqs.push({ url, method, body: init.body, headers: init.headers });
    let m;
    if (url.includes(":generateContent")) {
      if (fail.length) return json({ error: "busy" }, fail.shift(), { "retry-after": "0" });
      if (o.status) return json({ error: "bad" }, o.status);
      return json(brain.answer(JSON.parse(init.body)));
    }
    if ((m = /\/upload\/storage\/v1\/b\/([^/]+)\/o\?uploadType=media&name=(.+)$/.exec(url))) { gcs.set(decodeURIComponent(m[1]) + "/" + decodeURIComponent(m[2]), init.body); return json({}); }
    if (/\/batchPredictionJobs$/.test(url) && method === "POST") {
      const b = JSON.parse(init.body), name = `projects/${CFG.project}/locations/us-central1/batchPredictionJobs/${++seq}`;
      jobs.set(name, { b, state: "JOB_STATE_RUNNING" });
      return json({ name, state: "JOB_STATE_PENDING" });
    }
    if ((m = /\/v1\/(projects\/.+\/batchPredictionJobs\/\d+)$/.exec(url))) {
      const j = jobs.get(m[1]);
      if (!j) return json({ error: "not found" }, 404);
      if (j.state !== "JOB_STATE_SUCCEEDED" && !(o.hold && o.hold(j.b.displayName))) complete(j);
      return json({ name: m[1], state: j.state, createTime: "2026-10-05T00:00:00Z", endTime: j.state === "JOB_STATE_SUCCEEDED" ? "2026-10-05T00:20:00Z" : undefined, outputInfo: j.outDir ? { gcsOutputDirectory: j.outDir } : undefined });
    }
    if ((m = /\/storage\/v1\/b\/([^/]+)\/o\?prefix=([^&]+)/.exec(url))) {
      const b = decodeURIComponent(m[1]), pre = decodeURIComponent(m[2]);
      return json({ items: [...gcs.keys()].filter((k) => k.startsWith(b + "/" + pre)).map((k) => ({ name: k.slice(b.length + 1) })) });
    }
    if ((m = /\/storage\/v1\/b\/([^/]+)\/o\/(.+)\?alt=media$/.exec(url))) {
      const k = decodeURIComponent(m[1]) + "/" + decodeURIComponent(m[2]);
      return gcs.has(k) ? new Response(gcs.get(k), { status: 200 }) : json({}, 404);
    }
    return json({ error: "unexpected " + url }, 500);
  };
  const exec = async (cmd, args) => { execCalls++; assert.equal(cmd, "gcloud"); assert.deepEqual(args, ["auth", "print-access-token"]); return "ya29.fake-token\n"; };
  return {
    fetch, exec, gcs, jobs, reqs,
    get execCalls() { return execCalls; },
    created: () => [...jobs.values()].map((j) => j.b.displayName),
    gen: () => reqs.filter((r) => r.url.includes(":generateContent")),
    deps: (extra) => ({ fetch, exec, config: CFG, sleep: async () => {}, log: quiet, ...(extra || {}) }),
  };
}
const TMP = [];
after(() => { for (const d of TMP) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "prep-tools-")); TMP.push(d); return d; }
function copyBank(dst) { fs.cpSync(path.join(FIX, "bank", "v1"), path.join(dst, "bank", "v1"), { recursive: true }); return path.join(dst, "bank", "v1"); }
function hashTree(dir) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } };
  walk(dir);
  return out;
}
const readJ = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const subjects = loadTaxonomy(path.join(FIX, "tax"));
const SUBJ = Object.fromEntries(subjects.map((s) => [s.id, s]));

/* ================================================= prep-vertex ================================================= */
test("vertex: prices come from MODEL_RATES (Rs 96 per USD) and Batch is half", () => {
  assert.deepEqual(V.priceUsdPer1M("gemini-3.1-flash-lite"), { in: 0.25, out: 1.5 });
  assert.deepEqual(V.priceUsdPer1M("gemini-3.1-flash-lite", { batch: true }), { in: 0.125, out: 0.75 });
  assert.equal(V.costUsd({ inTok: 1e6, outTok: 5e5, thinkTok: 5e5 }, "gemini-3.1-flash-lite", { batch: true }), 0.125 + 0.75);
  assert.deepEqual(V.vertexConfig({}), { project: "", location: "global", model: "gemini-3.1-flash-lite", bucket: "" });
  assert.deepEqual(V.labelsFor("Measure 2026/10"), { app: "prep", run: "measure-2026-10" });
});

test("vertex: generateContent shape, gcloud token cached, labels, retry on 429 and 503 with backoff, usage recorded", async () => {
  const fv = fakeVertex(makeBrain(), { fail: [429, 503] });
  const sleeps = [];
  const vx = V.createVertex({ fetch: fv.fetch, exec: fv.exec, config: CFG, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
  const prompt = F.solvePrompt([{ id: "x", q: "Which is red?", o: ["Apple", "Sky", "Grass", "Snow"], a: 0 }]);
  const r = await vx.generate(prompt, { run: "unit-1", op: "solve" });
  assert.equal(r.status, 200);
  assert.deepEqual(sleeps, [1000, 2000], "exponential backoff");
  const g = fv.gen();
  assert.equal(g.length, 3);
  assert.equal(g[0].url, "https://us-central1-aiplatform.googleapis.com/v1/projects/proj-test/locations/us-central1/publishers/google/models/gemini-3.1-flash-lite:generateContent");
  assert.equal(g[2].headers.Authorization, "Bearer ya29.fake-token");
  const body = JSON.parse(g[2].body);
  assert.deepEqual(body.labels, { app: "prep", run: "unit-1" });
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.generationConfig.responseSchema && body.systemInstruction.parts[0].text);
  const rec = vx.log[0];
  for (const k of ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "cachedContentTokenCount", "finishReason", "modelVersion", "provider", "n429", "retries", "latencyMs"]) assert.ok(k in rec, k);
  assert.equal(rec.n429, 1); assert.equal(rec.retries, 2); assert.equal(rec.finishReason, "STOP"); assert.equal(rec.provider, "vertex");
  await vx.generate(prompt, { run: "unit-1" });
  assert.equal(fv.execCalls, 1, "the token is cached");
  // a non-retryable status throws and is still logged
  const fv2 = fakeVertex(makeBrain(), { status: 400 });
  const vx2 = V.createVertex({ fetch: fv2.fetch, exec: fv2.exec, config: { ...CFG, location: "global" }, sleep: async () => {} });
  await assert.rejects(vx2.generate(prompt, { run: "x" }), /400/);
  assert.equal(vx2.log[0].status, 400);
  assert.ok(fv2.gen()[0].url.startsWith("https://aiplatform.googleapis.com/v1/projects/proj-test/locations/global/"));
  // no project: refuses before any call
  await assert.rejects(V.createVertex({ fetch: fv2.fetch, exec: fv2.exec, config: { ...CFG, project: "" } }).generate(prompt, {}), /PREP_VERTEX_PROJECT/);
});

test("vertex: Batch round trip through GCS; outputs without our key are matched back by request hash", async () => {
  for (const dropKey of [false, true]) {
    const fv = fakeVertex(makeBrain(), { dropKey, shuffleOut: true });
    const vx = V.createVertex({ fetch: fv.fetch, exec: fv.exec, config: CFG, sleep: async () => {} });
    const items = [[{ id: "a", q: "Q one?", o: ["w", "x", "y", "z"], a: 0 }], [{ id: "b", q: "Q two?", o: ["p", "q", "r", "s"], a: 1 }]];
    const lines = items.map((g, i) => ({ key: "k" + i, request: V.requestBody(F.solvePrompt(g), { labels: V.labelsFor("r") }) }));
    const job = await vx.batch.submit({ name: "unit/stage", run: "r", lines });
    const created = [...fv.jobs.values()][0].b;
    assert.equal(created.model, "publishers/google/models/gemini-3.1-flash-lite");
    assert.deepEqual(created.labels, { app: "prep", run: "r" });
    assert.equal(created.inputConfig.instancesFormat, "jsonl");
    const uploaded = fv.gcs.get("prep-test-bucket/prep/r/unit/stage/input.jsonl").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(uploaded.map((l) => l.key), ["k0", "k1"]);
    assert.ok(uploaded.every((l) => !l.request.labels), "labels ride on the job, not on each line");
    const info = await vx.batch.wait(job.jobId, { pollMs: 0 });
    assert.equal(info.state, "JOB_STATE_SUCCEEDED");
    const res = await vx.batch.results(info, lines, { run: "r", op: "solve" });
    assert.equal(res.size, 2);
    assert.equal(JSON.parse(res.get("k0").text).s[0].ot, "w");
    assert.equal(vx.log.filter((x) => x.mode === "batch").length, 2);
    assert.ok(V.sumUsage(vx.log, CFG.model, { batch: true }).usd > 0);
  }
});

/* ================================================= prep-measure ================================================= */
test("measure: cost fit recovers a x pages + b x kept, and the catch rate counts what it should", () => {
  const rows = [{ pages: 2, kept: 10 }, { pages: 5, kept: 4 }, { pages: 1, kept: 7 }, { pages: 3, kept: 3 }].map((r) => ({ ...r, usd: r.pages * 0.01 + r.kept * 0.002 }));
  const fit = M.fitCost(rows);
  assert.ok(Math.abs(fit.a - 0.01) < 1e-9 && Math.abs(fit.b - 0.002) < 1e-9, JSON.stringify(fit));
  assert.ok(fit.maxRelErr < 1e-9);
  assert.equal(M.fitCost([{ pages: 0, kept: 10, usd: 0.5 }]).b, 0.05, "degenerate pages -> kept alone");
  assert.deepEqual(M.catchRate([{ caught: true }, { caught: false }, { caught: true }, { caught: true }]), { seeded: 4, caught: 3, rate: 0.75 });
  const pool = Array.from({ length: 9 }, (_, i) => ({ id: "i" + i, q: "Q" + i, o: ["a" + i, "b" + i, "c" + i, "d" + i], a: i % 4 }));
  const seeds = M.seedWrongKeys(pool, 50, "r");
  assert.equal(seeds.length, 9, "never more seeds than the pool");
  for (const s of seeds) {
    const src = pool.find((p) => p.id === s.from);
    assert.equal(s.o[s.trueA], src.o[src.a], "trueA follows the real key");
    assert.notEqual(s.a, s.trueA, "the seeded key is wrong");
  }
});

test("measure: --dry-run prints the plan and cost and makes zero calls", async () => {
  const fv = fakeVertex(makeBrain());
  const lines = [];
  const r = await M.main(["--src", path.join(FIX, "sources"), "--dry-run", "--target", "20"], fv.deps({ log: (s) => lines.push(s) }));
  assert.equal(r.dryRun, true);
  assert.equal(fv.reqs.length, 0); assert.equal(fv.execCalls, 0);
  assert.ok(r.totalUsd > 0 && r.perTemperature.calls.facts >= 1);
  assert.equal(r.sources.find((s) => s.name === "anaemia.txt").pages, 2, "form feeds count pages");
  assert.ok(lines.some((l) => /estimated total \$/.test(l)));
});

test("measure: full run on two sources at two temperatures with 50 seeds; report, labels, fit and catch rate", async () => {
  const out = tmpDir();
  // a solver that always picks option A: real items fail unless their key landed on A, seeds are caught unless the
  // seeded wrong key is A. The rate must follow exactly.
  for (const variant of ["perfect", "always-A"]) {
    const brain = makeBrain(variant === "always-A" ? { solve: ({ opts }) => opts[0] } : {});
    const fv = fakeVertex(brain);
    const rep = await M.main(["--src", path.join(FIX, "sources"), "--target", "8", "--temps", "1.0,0.2", "--run", "m-" + variant, "--out", out, "--batch"], fv.deps());
    const gen = fv.gen();
    assert.ok(gen.length > 10);
    for (const g of gen) assert.deepEqual(JSON.parse(g.body).labels, { app: "prep", run: V.labelValue("m-" + variant) });
    assert.deepEqual(Object.keys(rep.temps), ["1", "0.2"]);
    const temps = gen.map((g) => JSON.parse(g.body).generationConfig.temperature);
    assert.ok(temps.includes(1) && temps.includes(0.2));
    // finishReason counts cover every online call
    const fin = Object.values(rep.finish).reduce((a, o) => a + Object.values(o).reduce((x, y) => x + y, 0), 0);
    assert.equal(fin, rep.http.calls);
    assert.ok(rep.pct.facts.latencyMs.p50 != null && rep.pct.mcq.promptTokens.p90 >= rep.pct.mcq.promptTokens.p50);
    // fit is the least-squares fit of the report's own rows
    const refit = M.fitCost(rep.rows.filter((r) => r.kept > 0 || r.pages > 0));
    assert.ok(Math.abs(refit.a - rep.fit.a) < 1e-12 && Math.abs(refit.b - rep.fit.b) < 1e-12);
    assert.ok(rep.rows.every((r) => r.pages > 0 && r.usd > 0));
    // seeds
    assert.ok(rep.seeds.seeded >= 1 && rep.seeds.seeded <= 50);
    const expected = rep.seeds.list.filter((s) => (variant === "perfect" ? true : s.a !== 0)).length;
    assert.equal(rep.seeds.caught, expected);
    assert.equal(rep.seeds.rate, expected / rep.seeds.seeded);
    if (variant === "perfect") {
      assert.equal(rep.seeds.rate, 1);
      assert.equal(rep.seeds.pickedTrueKey, rep.seeds.seeded);
      assert.ok(rep.temps["1"].kept >= 6, "target reached");
      assert.equal(rep.temps["1"].rejects.solve || 0, 0);
    } else {
      assert.ok((rep.temps["1"].rejects.solve || 0) > 0, "solve rejects are counted per gate");
      assert.ok(rep.temps["1"].rejectRateByGate.solve > 0);
    }
    assert.ok(rep.batch && rep.batch.state === "JOB_STATE_SUCCEEDED" && rep.batch.turnaroundMs === 20 * 60000);
    assert.ok(rep.batch.usage.usd > 0 && rep.batch.usage.usd < rep.batch.onlineSameSetUsd, "Batch price is lower");
    const md = fs.readFileSync(path.join(out, "m-" + variant, "summary.md"), "utf8");
    assert.match(md, /Cost fit/); assert.match(md, /Seeded wrong keys/); assert.match(md, /p50 \/ p90/);
    assert.ok(fs.existsSync(path.join(out, "m-" + variant, "report.json")));
    assert.doesNotMatch(md, DASH);
  }
});

/* ================================================= prep-screen-keys ================================================= */
test("screen-keys: blind solve in Batch, key never sent, only mismatches flagged disputed, index recomputed, resumable", async () => {
  const dir = tmpDir(), bank = copyBank(dir), work = path.join(dir, "screen");
  const files = ["med-aml", "med-cml"].map((m) => path.join(bank, "medicine", "mcq", m + ".json"));
  const before = files.flatMap((f) => readJ(f).items);
  const byStem = new Map(before.map((it) => [normText(it.q), it]));
  // the solver: agrees with the key, except two items (picks another option) and one reply that names no option
  const brain = makeBrain({ solve: ({ stem }) => {
    const it = byStem.get(normText(stem));
    if (it.id === "lic-aml-3") return it.o[0];
    if (it.id === "lic-cml-4") return it.o[0];
    if (it.id === "lic-aml-2") return "Something else entirely";
    return it.o[it.a];
  } });
  const fv = fakeVertex(brain);
  const r = await K.main(["--bank", bank, "--work", work, "--tax", path.join(FIX, "tax"), "--run", "screen-t"], fv.deps());
  // request bodies: stems and options only
  const input = [...fv.gcs.entries()].filter(([k]) => k.endsWith("input.jsonl")).flatMap(([, v]) => v.trim().split("\n").map((l) => JSON.parse(l)));
  assert.ok(input.length >= 2);
  let moved = 0;
  for (const l of input) {
    const s = JSON.stringify(l.request);
    assert.doesNotMatch(s, /Key:|"a":|Explanation for/);
    const user = l.request.contents[0].parts[0].text;
    for (const it of before) {
      if (!user.includes(it.q)) continue;
      const blk = user.slice(user.indexOf(it.q)).split("\n").slice(1, 5).map((x) => x.replace(/^[A-D]\. /, ""));
      assert.deepEqual([...blk].sort(), [...it.o].sort());
      if (blk.indexOf(it.o[it.a]) !== it.a) moved++;
    }
  }
  assert.ok(moved > 0, "options are shuffled, so the key position is not the file's");
  assert.ok(!input.some((l) => l.request.contents[0].parts[0].text.includes(before.find((x) => x.id === "lic-cml-3").q)), "an already flagged item is not sent");
  // the key never changes the prompt: same items with another key give the same requests
  const alt = before.filter((x) => !x.flags).map((x) => ({ ...x, a: (x.a + 1) % 4 }));
  assert.deepEqual(K.linesFor(alt, 7).map((l) => l.request), K.linesFor(before.filter((x) => !x.flags), 7).map((l) => l.request));
  // only the two disagreements are flagged
  const after = files.flatMap((f) => readJ(f).items);
  const disputed = after.filter((x) => (x.flags || []).includes("disputed")).map((x) => x.id).sort();
  assert.deepEqual(disputed, ["lic-aml-3", "lic-cml-4"]);
  assert.deepEqual(after.find((x) => x.id === "lic-cml-3").flags, ["dup-key"]);
  for (const it of after) if (!["lic-aml-3", "lic-cml-4"].includes(it.id)) assert.deepEqual(it, before.find((x) => x.id === it.id));
  // index recomputed with the builder's rules
  const ix = readJ(path.join(bank, "medicine", "index.json"));
  assert.deepEqual(ix, subjectIndex(SUBJ.medicine, after));
  assert.equal(ix.counts.flagged, 3); assert.equal(ix.counts.total, 6);
  assert.equal(ix.topics.find((t) => t.id === "med-aml").count, 4);
  const man = readJ(path.join(bank, "manifest.json")).subjects.find((s) => s.id === "medicine");
  assert.equal(man.index, crypto.createHash("sha256").update(fs.readFileSync(path.join(bank, "medicine", "index.json"))).digest("hex"));
  const rep = r.report.find((x) => x.id === "medicine");
  assert.deepEqual([rep.screened, rep.agree, rep.disputed, rep.unmatched, rep.nopick], [8, 5, 2, 1, 0]);
  assert.equal(rep.rate, 0.625);
  const screenFile = fs.readdirSync(bank).find((f) => /^screen-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.equal(readJ(path.join(bank, screenFile)).subjects[0].rate, 0.625);
  // resume: nothing is resubmitted, nothing changes
  const jobs = fv.jobs.size, snap = hashTree(path.join(bank, "medicine"));
  await K.main(["--bank", bank, "--work", work, "--tax", path.join(FIX, "tax")], fv.deps());
  assert.equal(fv.jobs.size, jobs);
  assert.deepEqual(hashTree(path.join(bank, "medicine")), snap);
});

test("screen-keys: a half-finished screen resumes by polling the recorded job, never resubmitting", async () => {
  const dir = tmpDir(), bank = copyBank(dir), work = path.join(dir, "screen");
  let hold = true;
  const fv = fakeVertex(makeBrain({ solve: ({ opts }) => opts[0] }), { hold: () => hold });
  const r1 = await K.main(["--bank", bank, "--work", work, "--tax", path.join(FIX, "tax"), "--no-wait"], fv.deps());
  assert.deepEqual(r1.pending, ["medicine"]);
  const st = readJ(path.join(work, "state.json"));
  assert.equal(st.subjects.medicine.status, "submitted");
  assert.ok(st.subjects.medicine.jobId);
  hold = false;
  await K.main(["--bank", bank, "--work", work, "--tax", path.join(FIX, "tax")], fv.deps());
  assert.equal(fv.jobs.size, 1, "one job in all");
  assert.equal(readJ(path.join(work, "state.json")).subjects.medicine.status, "applied");
});

test("screen-keys: --dry-run estimates from the real prompts with zero calls", async () => {
  const dir = tmpDir(), bank = copyBank(dir);
  const fv = fakeVertex(makeBrain());
  const r = await K.main(["--bank", bank, "--work", path.join(dir, "w"), "--tax", path.join(FIX, "tax"), "--dry-run", "--assume-items", "170000"], fv.deps());
  assert.equal(fv.reqs.length, 0); assert.equal(fv.execCalls, 0);
  assert.equal(r.total.items, 8); assert.equal(r.total.requests, 2);
  assert.ok(r.total.usd > 0 && r.assumed.usd > r.total.usd);
  assert.ok(!fs.existsSync(path.join(dir, "w")), "a dry run writes nothing");
});

/* ================================================= prep-fill ================================================= */
function fillArgs(dir, extra) {
  return ["--shortfall", path.join(FIX, "shortfall.json"), "--packs", path.join(FIX, "packs"), "--work", path.join(dir, "work"), "--out", path.join(dir, "fill"),
    "--bank", path.join(dir, "bank", "v1"), "--tax", path.join(FIX, "tax"), "--run", "fill-test", "--usmle-share", "0.5", "--poll-sec", "0", ...(extra || [])];
}
const STAGES = ["01-facts", "02-mcq", "03-solve", "04-review", "02-mcq.r1", "03-solve.r1", "04-review.r1"];

test("fill: four Batch stages, gates reject a pack copy and an ungrounded number, regenerate once, SMD/AI items with no book or page", async () => {
  const dir = tmpDir(); copyBank(dir);
  const brain = makeBrain();
  const fv = fakeVertex(brain);
  const r = await F.main(fillArgs(dir), fv.deps());
  assert.deepEqual(r.errors, []); assert.deepEqual(r.pending, []);
  // stage files and job ids
  for (const mod of ["med-aml", "sca-hfref"]) {
    const st = readJ(path.join(dir, "work", mod, "state.json"));
    for (const s of ["01-facts", "02-mcq", "03-solve", "04-review"]) {
      assert.equal(st.stages[s].status, "done", mod + " " + s);
      assert.ok(st.stages[s].jobId, "Batch job id recorded");
      assert.ok(fs.existsSync(path.join(dir, "work", mod, s + ".jsonl")));
    }
  }
  const aml = readJ(path.join(dir, "fill", "med-aml.json"));
  assert.ok(aml.stats.rejected["verbatim-pack"] >= 1, JSON.stringify(aml.stats));
  assert.ok(aml.stats.rejected.g9b >= 1, JSON.stringify(aml.stats));
  assert.equal(aml.stats.regenerated, 2, JSON.stringify(aml.stats));
  const st = readJ(path.join(dir, "work", "med-aml", "state.json"));
  for (const s of ["02-mcq.r1", "03-solve.r1", "04-review.r1"]) assert.ok(st.stages[s].jobId, "regeneration ran through " + s);
  assert.equal(readJ(path.join(dir, "work", "med-aml", "02-mcq.r1.json")).items.length, 2);
  // the regenerated questions on the two rejected facts were accepted
  assert.ok(aml.items.some((it) => it.o.includes("45 mg/m2 daily") && it.o[it.a] === "45 mg/m2 daily"));
  assert.ok(!aml.items.some((it) => it.o[it.a] === "60 mg/m2 daily"));
  assert.ok(!aml.items.some((it) => it.kp === COPY));
  assert.equal(aml.items.length, Math.min(aml.need, aml.stats.facts), "every fact accepted after one regeneration");
  assert.equal(aml.need, Math.max(10, Math.min(100, Math.round(1.5 * aml.stats.facts))) - 5);
  for (const it of aml.items.concat(readJ(path.join(dir, "fill", "sca-hfref.json")).items)) {
    assert.equal(it.prov, "SMD"); assert.equal(it.gen, "AI");
    assert.deepEqual(Object.keys(it.src), ["sn"], "no doc name, page or heading on the item");
    assert.ok(it.rv && it.rv.solved && it.rv.pass);
    assert.ok(Array.isArray(it.r) && it.r.length === 4 && it.exp === it.r[it.a]);
    assert.ok(it.o.length === 4 && it.a >= 0 && it.a <= 3 && it.d >= 1 && it.d <= 3);
  }
  const outText = fs.readFileSync(path.join(dir, "fill", "med-aml.json"), "utf8");
  assert.doesNotMatch(outText, /harrison|\bp\. ?812|chapter 102|example\.org/i, "no book name, page or url in the output");
  assert.deepEqual(aml.srcPack, ["aml-notes-1"]);
  assert.doesNotMatch(outText, DASH);
  // profiles: MBBS with usmle gets USMLE vignettes on some groups; SS gets NEET-SS
  assert.ok(aml.items.some((it) => (it.ex || []).includes("usmle")) && aml.items.some((it) => !it.ex), "USMLE share");
  assert.ok(aml.items.every((it) => !it.ex || (it.ex.length === 1 && it.ex[0] === "usmle")));
  assert.ok(brain.seen.mcqSystems.some((s) => /for USMLE preparation/.test(s)));
  assert.ok(brain.seen.mcqSystems.some((s) => /for NEET-PG preparation/.test(s)));
  const ss = readJ(path.join(dir, "fill", "sca-hfref.json"));
  assert.ok(ss.items.length > 0 && ss.items.every((it) => !it.ex));
  const ssMcq = readJ(path.join(dir, "work", "sca-hfref", "02-mcq.json")).items;
  assert.ok(ssMcq.length > 0);
  const ssReq = fs.readFileSync(path.join(dir, "work", "sca-hfref", "02-mcq.jsonl"), "utf8");
  assert.match(ssReq, /for NEET-SS preparation/); assert.doesNotMatch(ssReq, /for USMLE preparation/);
  // the solve requests are blind: stems and options only
  for (const mod of ["med-aml", "sca-hfref"]) {
    const reqs = fs.readFileSync(path.join(dir, "work", mod, "03-solve.jsonl"), "utf8");
    assert.doesNotMatch(reqs, /Key:|reason:|Pearl:/);
  }
  // facts never showed the model a page
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "work", "med-aml", "01-facts.jsonl"), "utf8"), /\(page \d/);
});

test("fill: resumes a half-finished module without re-calling completed stages", async () => {
  const dir = tmpDir(); copyBank(dir);
  const brain = makeBrain();
  let hold = true;
  const fv = fakeVertex(brain, { hold: (name) => hold && /03-solve/.test(name) });
  const r1 = await F.main(fillArgs(dir, ["--module", "med-aml", "--no-wait"]), fv.deps());
  assert.deepEqual(r1.pending, ["med-aml"]);
  const st1 = readJ(path.join(dir, "work", "med-aml", "state.json"));
  assert.equal(st1.stages["01-facts"].status, "done"); assert.equal(st1.stages["02-mcq"].status, "done");
  assert.equal(st1.stages["03-solve"].status, "submitted");
  assert.ok(!st1.stages["04-review"]);
  assert.ok(!fs.existsSync(path.join(dir, "fill", "med-aml.json")));
  const facts1 = brain.seen.facts, mcq1 = brain.seen.mcq;
  hold = false;
  const r2 = await F.main(fillArgs(dir, ["--module", "med-aml"]), fv.deps());
  assert.deepEqual(r2.pending, []);
  assert.equal(brain.seen.facts, facts1, "facts stage not called again");
  const created = fv.created();
  for (const s of STAGES) assert.equal(created.filter((n) => n === "fill-test-med-aml-" + s.replace(".", "-")).length, 1, "one job for " + s);
  assert.ok(brain.seen.mcq > mcq1, "only the regeneration mcq ran after the resume");
  assert.ok(readJ(path.join(dir, "fill", "med-aml.json")).items.length > 0);
  // a third run calls nothing at all
  const n = fv.reqs.length;
  await F.main(fillArgs(dir, ["--module", "med-aml"]), fv.deps());
  assert.equal(fv.reqs.filter((x) => /batchPredictionJobs$/.test(x.url) && x.method === "POST").length, created.length);
  assert.equal(fv.reqs.length, n, "everything comes from the saved stage outputs");
});

test("fill: --merge writes v2 from v1 plus the accepted items and never touches v1", async () => {
  const dir = tmpDir(); const bank = copyBank(dir);
  const fv = fakeVertex(makeBrain());
  await F.main(fillArgs(dir), fv.deps());
  const v1 = hashTree(bank);
  const v2 = path.join(dir, "bank", "v2");
  const r = await F.main(["--merge", "--from", bank, "--to", v2, "--out", path.join(dir, "fill"), "--tax", path.join(FIX, "tax")], fv.deps());
  assert.deepEqual(hashTree(bank), v1, "v1 unchanged");
  const aml = readJ(path.join(dir, "fill", "med-aml.json")).items, hf = readJ(path.join(dir, "fill", "sca-hfref.json")).items;
  assert.equal(r.added, aml.length + hf.length);
  const mod = readJ(path.join(v2, "medicine", "mcq", "med-aml.json")).items;
  assert.equal(mod.filter((x) => x.prov === "LIC").length, 5);
  assert.equal(mod.filter((x) => x.prov === "SMD").length, aml.length);
  const all = ["med-aml", "med-cml"].flatMap((m) => readJ(path.join(v2, "medicine", "mcq", m + ".json")).items);
  const ix = readJ(path.join(v2, "medicine", "index.json")), ref = subjectIndex(SUBJ.medicine, all);
  assert.equal(ix.v, 2);
  assert.deepEqual(ix.counts, ref.counts);
  assert.equal(ix.topics.find((t) => t.id === "med-aml").count, 5 + aml.length);
  assert.equal(ix.usmle, ref.usmle);
  assert.equal(ix.smd, aml.length);
  const ssIx = readJ(path.join(v2, "ss-cardiology", "index.json"));
  const t = ssIx.topics.find((x) => x.id === "sca-hfref");
  assert.equal(t.count, hf.length); assert.equal(t.lic, "StewardMD");
  assert.ok(fs.existsSync(path.join(v2, "ss-cardiology", "search.json")));
  assert.equal(readJ(path.join(v2, "manifest.json")).v, 2);
  assert.ok(fs.existsSync(path.join(v2, "medicine", "mcq", "med-cml.json")), "untouched modules are copied");
  assert.throws(() => F.mergeBank({ subjects, fromDir: bank, toDir: v2, fillDir: path.join(dir, "fill"), log: quiet }), /exists/);
  assert.equal(fv.reqs.filter((x) => x.url.includes("aiplatform")).length > 0, true);
});

test("fill: --dry-run estimates per module and for the whole fill with zero calls", async () => {
  const dir = tmpDir(); copyBank(dir);
  const fv = fakeVertex(makeBrain());
  const r = await F.main(fillArgs(dir, ["--dry-run"]), fv.deps());
  assert.equal(fv.reqs.length, 0); assert.equal(fv.execCalls, 0);
  assert.equal(r.modules.length, 2);
  assert.ok(r.total.usd > 0);
  assert.ok(!fs.existsSync(path.join(dir, "work")), "a dry run writes nothing");
  const whole = await F.main(["--dry-run", "--assume", "neet-pg=1900,neet-ss=22000,usmle=3000", "--tax", path.join(FIX, "tax")], fv.deps());
  assert.equal(fv.reqs.length, 0);
  assert.equal(whole.total.n, 26900);
  const per100 = whole.rows.find((x) => x.profile === "neet-pg").per100;
  assert.ok(per100 > 0.03 && per100 < 0.15, "per 100 NEET items near the plan's $0.08: " + per100);
  assert.ok(whole.rows.find((x) => x.profile === "usmle").per100 > per100, "vignettes cost more");
});

test("fill helpers: sentences, pages and headings; book and locator check", () => {
  const s = F.splitSentences("# Title one\n\nFirst sentence e.g. this one stays whole. Second sentence here.\n\fShort Heading\nThird on page two.");
  assert.deepEqual(s.map((x) => [x.p, x.h, x.tx]), [[1, "Title one", "First sentence e.g. this one stays whole."], [1, "Title one", "Second sentence here."], [2, "Short Heading", "Third on page two."]]);
  const base = { q: "Which drug?", o: ["a", "b", "c", "d"], r: ["", "", "", ""], kp: "", exp: "" };
  assert.equal(F.bookProblem(base, []), false);
  assert.equal(F.bookProblem({ ...base, kp: "As in Robbins pathology." }, []), true);
  assert.equal(F.bookProblem({ ...base, exp: "See page 812 for details." }, []), true);
  assert.equal(F.bookProblem({ ...base, q: "Harrison sulcus is seen in?" }, []), false, "an eponym is not a book");
  assert.equal(F.bookProblem({ ...base, q: "Harrison sulcus is seen in?" }, ["Harrison"]), true, "a pack avoid term is");
  assert.deepEqual(F.groupProfiles(4, SUBJ.medicine, 0.5), ["neet-pg", "usmle", "neet-pg", "usmle"]);
  assert.deepEqual(F.groupProfiles(2, SUBJ["ss-cardiology"], 0.5), ["neet-ss", "neet-ss"]);
  assert.ok(solveMatches("x", { o: ["x", "y", "z", "w"], a: 0 }));
});

test("no em or en dash in the tools or this test", () => {
  for (const f of ["tools/prep-classify.mjs", "tools/prep-map-eval.mjs", "prep/eval/labels-anatomy.json", "tools/prep-vertex.mjs", "tools/prep-measure.mjs", "tools/prep-screen-keys.mjs", "tools/prep-fill.mjs", "test/prep-tools.test.mjs"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(HERE, "..", f), "utf8"), DASH, f);
  }
});

/* ================================================= prep-classify ================================================= */
const MED = path.join(FIX, "medmcqa");
const clsArgs = (dir, extra) => ["--tax", path.join(FIX, "tax"), "--out", path.join(dir, "build"), "--medmcqa", MED, "--run", "cls-test", "--poll-sec", "0", ...(extra || [])];
const inputLines = (fv, sub) => [...fv.gcs.entries()].filter(([k]) => k.endsWith(`/${sub}/input.jsonl`)).flatMap(([, v]) => v.trim().split("\n").map((l) => JSON.parse(l)));

test("classify: 10 items a request with the module list and other subjects; stem, key and 200 explanation chars only", async () => {
  const dir = tmpDir();
  const brain = makeBrain(), fv = fakeVertex(brain);
  const r = await C.main(clsArgs(dir), fv.deps());
  assert.deepEqual(r.pending, []);
  const lines = inputLines(fv, "medicine");
  assert.equal(lines.length, 2, "12 Medicine items -> 10 + 2");
  const rows = fs.readFileSync(path.join(MED, "train.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const l of lines) {
    const req = l.request, user = req.contents[0].parts[0].text;
    assert.equal(req.generationConfig.temperature, 0);
    const sch = req.generationConfig.responseSchema;
    assert.deepEqual(Object.keys(sch.properties), ["c"]);
    assert.deepEqual(sch.properties.c.items.propertyOrdering, ["i", "m", "conf"]);
    assert.deepEqual(sch.properties.c.items.properties.conf.enum, ["high", "low"]);
    assert.deepEqual(sch.properties.c.items.properties.m.enum, ["med-aml", "med-cml", "anatomy"]);
    assert.match(user, /^med-aml \| Haematology > Acute myeloid leukaemia \| acute myeloid leukemia/m);
    assert.match(user, /other-subject \(answer with one of these subject ids when the item is not Medicine\): anatomy\n/);
    assert.ok((user.match(/^\[\d+\] Q: /gm) || []).length <= 10);
    for (const row of rows) {
      if (!user.includes(row.question)) continue;
      const key = [row.opa, row.opb, row.opc, row.opd][row.cop];
      assert.ok(user.includes("Key: " + key));
      const at = user.indexOf("Q: " + row.question), end = user.indexOf("\n[", at);
      const blk = user.slice(at + 3 + row.question.length, end < 0 ? undefined : end);
      for (const o of [row.opa, row.opb, row.opc, row.opd]) if (o !== key && !key.includes(o)) assert.ok(!blk.includes(o), "a distractor is not sent: " + o);
    }
    assert.doesNotMatch(user, /TAILMARKER/, "nothing past 200 explanation characters");
    for (const m of user.matchAll(/^    Note: (.*)$/gm)) assert.ok(m[1].length <= 200);
  }
  assert.ok(lines.some((l) => /Note: The PML-RARA fusion blocks/.test(l.request.contents[0].parts[0].text)));
  assert.equal(inputLines(fv, "dental").length, 0);
  const med = readJ(path.join(dir, "build", "llm-medicine.json"));
  assert.equal(med.model, "gemini-3.1-flash-lite"); assert.equal(med.run, "cls-test");
  assert.deepEqual(med.map.m01, ["med-aml", "high"]);
  assert.deepEqual(med.map.m02, ["med-cml", "high"]);
  assert.deepEqual(med.map.m06, ["anatomy", "high"], "another subject's item names that subject");
  assert.equal(med.map.m11[1], "low");
  assert.ok(!("m09" in med.map), "an unknown id is left out");
  assert.equal(Object.keys(med.map).length, 11);
  const ana = readJ(path.join(dir, "build", "llm-anatomy.json"));
  assert.deepEqual(ana.map.a01, ["ana-upper-limb-nerves", "high"]);
  assert.deepEqual(ana.map.a02, ["ana-heart", "high"]);
  assert.deepEqual(inputLines(fv, "anatomy")[0].request.generationConfig.responseSchema.properties.c.items.properties.m.enum, ["ana-upper-limb-nerves", "ana-heart", "medicine"]);
});

test("classify: a half-finished run resumes from the recorded job ids; a finished one calls nothing", async () => {
  const dir = tmpDir();
  let hold = true;
  const fv = fakeVertex(makeBrain(), { hold: (n) => hold && /medicine/.test(n) });
  const r1 = await C.main(clsArgs(dir, ["--no-wait"]), fv.deps());
  assert.deepEqual(r1.pending, ["medicine"]);
  assert.equal(readJ(path.join(dir, "build", "classify", "state.json")).subjects.medicine.status, "submitted");
  assert.ok(fs.existsSync(path.join(dir, "build", "llm-anatomy.json")) && !fs.existsSync(path.join(dir, "build", "llm-medicine.json")));
  hold = false;
  const r2 = await C.main(clsArgs(dir), fv.deps());
  assert.deepEqual(r2.pending, []);
  assert.equal(fv.jobs.size, 2, "one job per subject, never resubmitted");
  const n = fv.reqs.length;
  await C.main(clsArgs(dir), fv.deps());
  assert.equal(fv.reqs.length, n);
});

test("classify: --sample sends only the labelled items to a separate file; --dry-run makes zero calls", async () => {
  const dir = tmpDir();
  const fv = fakeVertex(makeBrain());
  await C.main(clsArgs(dir, ["--sample", path.join(FIX, "labels-anatomy-sample.json")]), fv.deps());
  assert.equal(inputLines(fv, "medicine").length, 0);
  const lines = inputLines(fv, "anatomy");
  assert.equal(lines.length, 1);
  const user = lines[0].request.contents[0].parts[0].text;
  assert.equal((user.match(/^\[\d+\] Q: /gm) || []).length, 3);
  assert.doesNotMatch(user, /spiral groove/, "an unlabelled item is not sent");
  assert.ok(fs.existsSync(path.join(dir, "build", "llm-anatomy.sample.json")) && !fs.existsSync(path.join(dir, "build", "llm-anatomy.json")));
  const sc = E.scoreMapping(readJ(path.join(FIX, "labels-anatomy-sample.json")).labels, E.fromLlm(readJ(path.join(dir, "build", "llm-anatomy.sample.json")), SUBJ.anatomy));
  assert.equal(sc.agree, 3);
  const fv2 = fakeVertex(makeBrain());
  const d1 = await C.main(clsArgs(tmpDir(), ["--dry-run"]), fv2.deps());
  assert.equal(d1.total.items, 16); assert.equal(d1.total.requests, 3);
  assert.ok(d1.total.usd > 0);
  const d2 = await C.main(["--tax", path.join(FIX, "tax"), "--out", path.join(tmpDir(), "b"), "--dry-run", "--assume-items", "1000"], fv2.deps({ env: {} }));
  assert.equal(d2.total.items, 1000);
  assert.equal(fv2.reqs.length, 0); assert.equal(fv2.execCalls, 0);
});

/* ================================================= prep-map-eval ================================================= */
test("map-eval: the scorer counts best, ok, mixed, moved out and missing as the plan says", () => {
  const labels = [
    { id: "1", best: "ana-heart", ok: [] }, { id: "2", best: "ana-heart", ok: ["ana-upper-limb-nerves"] },
    { id: "3", best: "ana-heart", ok: [] }, { id: "4", best: "mixed", ok: [] }, { id: "5", best: "mixed", ok: ["ana-heart"] },
    { id: "6", best: "mixed", ok: [] }, { id: "7", best: "ana-heart", ok: [] }, { id: "8", best: "mixed", ok: [] },
  ];
  const assign = new Map([
    ["1", { kind: "module", m: "ana-heart" }], ["2", { kind: "module", m: "ana-upper-limb-nerves" }], ["3", { kind: "module", m: "ana-upper-limb-nerves" }],
    ["4", { kind: "moved", to: "physiology" }], ["5", { kind: "module", m: "ana-heart" }], ["6", { kind: "module", m: "ana-heart" }],
    ["7", { kind: "mixed" }], ["8", { kind: "mixed" }],
  ]);
  const r = E.scoreMapping(labels.concat([{ id: "9", best: "ana-heart", ok: [] }]), assign);
  assert.equal(r.n, 9); assert.equal(r.agree, 5); assert.equal(r.missing, 1);
  assert.deepEqual([r.inSubject.n, r.inSubject.agree], [5, 2]);
  assert.deepEqual([r.labelledMixed.n, r.labelledMixed.agree], [4, 3]);
  assert.equal(r.pairs["ana-heart -> ana-upper-limb-nerves"], 1);
  assert.equal(r.pairs["ana-heart -> mixed"], 1);
  assert.equal(r.pairs["mixed -> ana-heart"], 1);
  assert.equal(r.pairs["ana-heart -> missing"], 1);
  assert.equal(E.agrees({ best: "x", ok: [] }, undefined), false);
});

test("map-eval: scores a built bank across subjects and an llm file, with --high", () => {
  const dir = tmpDir(), bank = copyBank(dir);
  fs.mkdirSync(path.join(bank, "ss-cardiology", "mcq"), { recursive: true });
  fs.writeFileSync(path.join(bank, "ss-cardiology", "mcq", "sca-hfref.json"), JSON.stringify({ topic: "sca-hfref", items: [{ id: "lic-moved", q: "q", o: ["a", "b", "c", "d"], a: 0, exp: "", t: "sca-hfref", d: 1 }] }));
  const lab = { subject: "medicine", labels: [
    { id: "lic-aml-1", best: "med-aml", ok: [] }, { id: "lic-cml-2", best: "med-aml", ok: ["med-cml"] }, { id: "lic-aml-2", best: "med-cml", ok: [] },
    { id: "lic-moved", best: "mixed", ok: [] }, { id: "nowhere", best: "med-aml", ok: [] },
  ] };
  const lp = path.join(dir, "labels.json");
  fs.writeFileSync(lp, JSON.stringify(lab));
  const out = [];
  const r = E.main(["--labels", lp, "--bank", bank, "--tax", path.join(FIX, "tax")], { log: (s) => out.push(s) });
  assert.deepEqual([r.overall.n, r.overall.agree, r.overall.missing], [5, 3, 1]);
  assert.equal(r.subjects[0].subject, "medicine");
  assert.ok(out.some((l) => /med-cml -> med-aml/.test(l)) && out.some((l) => /^overall: 3 of 5 agree \(60\.0%\)/.test(l)));
  const llm = path.join(dir, "llm-medicine.json");
  fs.writeFileSync(llm, JSON.stringify({ subject: "medicine", map: { "lic-aml-1": ["med-aml", "high"], "lic-cml-2": ["med-cml", "low"], "lic-aml-2": ["med-cml", "high"], "lic-moved": ["anatomy", "high"] } }));
  const r2 = E.main(["--labels", lp, "--llm", llm, "--tax", path.join(FIX, "tax")], { log: quiet });
  assert.equal(r2.overall.agree, 4);
  const r3 = E.main(["--labels", lp, "--llm", llm, "--tax", path.join(FIX, "tax"), "--high"], { log: quiet });
  assert.equal(r3.overall.agree, 3, "a low-confidence answer counts as mixed under --high");
  // the saved Anatomy sample is well formed and names the subject and the labeller
  const saved = readJ(path.join(HERE, "..", "prep", "eval", "labels-anatomy.json"));
  assert.equal(saved.subject, "anatomy"); assert.match(saved.labeller, /not a doctor/);
  assert.equal(saved.labels.length, 120);
  assert.ok(saved.labels.every((l) => typeof l.id === "string" && typeof l.best === "string" && Array.isArray(l.ok) && Object.keys(l).length === 3));
});
