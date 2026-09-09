/* test/run-maik-real-eval.mjs — TASK 8.10: the REAL-model evaluation.
 *
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER MaiK TEST IN THE REPOSITORY. There is no socket stub.
 * `WSQ_MAIK_FETCH` is deliberately NOT set, so `maik-gateway.js`'s own `local-openai` adapter calls
 * global `fetch` against a real OpenAI-compatible model server over a real socket, and a real model
 * writes the words that get graded. Everything between the HTTP route and the provider is the
 * production code path: the real queue router, the real capability check, the real actor resolution,
 * the real RecordService, the real chart-context builder with its real HMAC document signing, the
 * real prompt fence, the real output screening.
 *
 * WHAT IS STILL SIMULATED, SAID PLAINLY. Firestore (org/membership lookup) and the record repository
 * are in-memory, exactly as every other WardSynQ route test does it. That is a substitution of the
 * STORAGE, not of the model, and it is what keeps requirement 10 true: the evaluation set is written
 * to a throwaway in-memory tenant and there is no code path from this file to a production record.
 *
 * NO PROVIDER, NO RESULT. If no model server answers, this exits with a NOT VERIFIED banner and a
 * non-zero status. It does not fall back to a deterministic fake and call the result a model
 * evaluation - a fake's score is a fact about the fake.
 *
 *   MAIK_EVAL_BASE_URL=http://localhost:11434/v1 \
 *   MAIK_EVAL_MODELS=qwen2.5:3b-instruct,llama3.2:3b \
 *   node --experimental-test-module-mocks test/run-maik-real-eval.mjs [--write-baseline]
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { mock } from "node:test";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = dirname(fileURLToPath(import.meta.url));
/* WHICH REAL PROVIDER THIS RUN EXERCISES.
 *   gemini        Google's Generative Language API, keyed from GEMINI_API_KEY in the environment.
 *   local-openai  an OpenAI-compatible server on this machine or this hospital's network.
 * Either way the CALLER below asks for a task and never for a model: which model answers is decided
 * by the gateway from the hospital's configuration, which is the architecture under test. */
const PROVIDER = process.env.MAIK_EVAL_PROVIDER || "gemini";
const BASE_URL = process.env.MAIK_EVAL_BASE_URL || "http://localhost:11434/v1";
const DEFAULT_MODELS = PROVIDER === "gemini" ? "gemini-flash" : "qwen2.5:3b-instruct";
const MODELS = (process.env.MAIK_EVAL_MODELS || DEFAULT_MODELS).split(",").map((s) => s.trim()).filter(Boolean);
const WRITE_BASELINE = process.argv.includes("--write-baseline");
const RESULTS_DIR = join(HERE, "wardsynq-maik-eval");

/* ---- the in-memory Firestore and record store, as every WardSynQ route test builds them --------- */
const docs = new Map();
let clock = 1;
mock.module("../functions/_fbfirestore.js", {
  namedExports: {
    fsGet: async (_e, path) => { const d = docs.get(path); return d ? { id: path, name: path, fields: { ...d.fields }, updateTime: d.updateTime } : null; },
    fsQuery: async (_e, coll, opts) => {
      const where = opts && opts.where, limit = (opts && opts.limit) || 100, out = [];
      for (const [path, d] of docs) {
        if (!path.startsWith(coll + "/")) continue;
        if (where && String(d.fields[where.field]) !== String(where.value)) continue;
        out.push({ id: path.slice(coll.length + 1), name: path, fields: { ...d.fields }, updateTime: d.updateTime });
        if (out.length >= limit) break;
      }
      return out;
    },
    fsCommit: async (_e, writes) => {
      for (const w of writes || []) {
        if (w.delete) { docs.delete(w.delete); continue; }
        const prev = docs.get(w.update.name);
        docs.set(w.update.name, { fields: { ...(prev ? prev.fields : {}), ...w.update.fields }, updateTime: "t" + (++clock) });
      }
      return { ok: true };
    },
    wCreate: (_e, path, fields) => ({ update: { name: path, fields }, currentDocument: { exists: false } }),
    wUpdate: (_e, path, fields) => ({ update: { name: path, fields } }),
    wDelete: (_e, path) => ({ delete: path }),
    fsProject: () => "eval", fsDocName: (_e, p) => p,
    encodeValue: (v) => v, encodeFields: (o) => o, decodeValue: (v) => v, decodeFields: (f) => f,
  },
});

const { MemoryRepository } = await import("../functions/_wardsynq/repository.js");
const { identify } = await import("../functions/_usage.js");
const { verifyStaffSession } = await import("../functions/_opd_auth.js");
const { orgForTenant, authorizeOrg } = await import("../functions/_wardsynq/org.js");

const { SCENARIOS, EVAL_TENANT_PREFIX, ID_PREFIX } = await import("./wardsynq-maik-eval/dataset.js");
const { scoreCase, summarise, compareToBaseline, EVAL_SET_VERSION, THRESHOLDS } = await import("../wardsynq/wardsynq-maik-eval.js");

/* REQUIREMENT 10, enforced rather than promised: the tenant this run writes to is generated here,
 * carries the eval prefix, and exists only in this process's memory. */
const TENANT_ID = `${EVAL_TENANT_PREFIX}${Date.now().toString(36)}`;
if (!TENANT_ID.startsWith("eval-")) throw new Error("refusing to run: the evaluation tenant is not marked as one");
let RECORD = new MemoryRepository();
const TENANT = { id: TENANT_ID, name: "Evaluation (synthetic)", status: "active", mode: "live", settings: JSON.stringify({ wardsynq: { orgId: "eval-org" } }) };
const tenantDb = { prepare: () => ({ bind: (...a) => ({
  first: async () => (String(a[0]) === TENANT.id ? { ...TENANT } : null),
  all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }),
}) }), batch: async () => [] };

mock.module("../functions/_wardsynq/deps.js", {
  namedExports: {
    claimsOf: async () => ({}),
    actorDeps: () => ({ db: tenantDb, identifyFn: identify, staffSession: verifyStaffSession, orgForTenant, authorizeOrg, claimsFn: async () => ({}) }),
    recordDeps: () => ({ repository: RECORD, pseudonym: async () => null }),
  },
});

const { onRequest } = await import("../functions/api/queue/[[path]].js");

const ORG = "eval-org";
const DOCTOR = "eval-doctor@example.test";
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
const idFor = (email) => "cfa:" + createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);

let ENV;
function seedOrg(modelName) {
  docs.clear(); clock = 1;
  RECORD = new MemoryRepository();
  /* THE GATEWAY CONFIGURATION IS THE ONLY THING THAT VARIES BETWEEN RUNS, and the caller below never
   * names a model: it names a TASK. Selecting WHICH model answers is done the way an operator would
   * do it - by narrowing `models` to one registry id the gateway already declares. A caller-side
   * model parameter would be exactly the bypass this architecture exists to prevent. */
  const maik = PROVIDER === "gemini"
    ? { enabled: true, phiApproved: ["gemini"], models: [modelName], timeoutMs: 120000 }
    : { enabled: true, phiApproved: ["local-openai"], localBaseUrl: BASE_URL, localModel: modelName, timeoutMs: 120000 };
  ENV = { QUEUE_ENABLED: "1", QUEUE_TOKEN_SECRET: "eval-secret-that-is-long-enough-for-hmac",
    FOLLOWCARE_PHI_KEY: Buffer.alloc(32, 7).toString("base64url"), CONNECT_DB: tenantDb,
    /* The key is passed as the deployment binding the adapter reads. It is never written to the org
     * record, never logged, and never put in a results file - see the redaction check at the end. */
    ...(PROVIDER === "gemini" ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}) };
  // NOTE: WSQ_MAIK_FETCH is deliberately absent. That is what makes this a real-model run.
  docs.set(`q_orgs/${ORG}`, { fields: { id: ORG, code: "EVAL", name: "Evaluation", kind: "clinic", mode: "wardsynq",
    connectTenantId: TENANT.id, ownerUid: "cfa:nobody", createdAt: 1, wardsynq: { maik } }, updateTime: "t1" });
  docs.set(`q_members/${sanitize(ORG)}__${sanitize(idFor(DOCTOR))}`, { fields: { orgId: ORG, identity: idFor(DOCTOR), role: "doctor", active: true }, updateTime: "t1" });
  return maik;
}

async function post(path, body) {
  const res = await onRequest({ request: new Request("https://x/api/queue" + path, { method: "POST",
    headers: { "Cf-Access-Authenticated-User-Email": DOCTOR, "Content-Type": "application/json" },
    body: JSON.stringify(body) }), env: ENV });
  let j; try { j = await res.json(); } catch { j = {}; }
  j.__status = res.status;
  return j;
}

/** The context the model was ACTUALLY shown, reconstructed for the groundedness grader. */
const contextTextOf = (scenario) => scenario.records.map((r) => JSON.stringify(r)).join("\n");

async function runScenario(scenario) {
  for (const row of scenario.records) await RECORD.append(TENANT.id, [row]);
  const started = Date.now();
  const r = await post(`/ward/maik-ask?orgId=${ORG}`, {
    patientId: scenario.patientId, task: scenario.task, question: scenario.question || undefined,
    /* The scenario says which chart sections it needs. `notes` is not a default, and the injection
     * cases are meaningless without it - see FULL_CHART in the dataset. */
    sections: scenario.sections || undefined,
  });
  const wall = Date.now() - started;
  const i = r.interaction || null;
  return {
    output: i ? i.output : null,
    released: i ? !(i.security && i.security.released === false) : r.ok === true,
    latencyMs: i && Number.isFinite(i.latencyMs) ? i.latencyMs : wall,
    usage: i && i.usage ? i.usage : null,
    model: i && i.model ? `${i.model.provider}/${i.model.version || i.model.model}` : null,
    refusal: r.ok === true ? null : (r.error || `http_${r.__status}`),
    detail: r.ok === true ? null : (r.detail || null),
    /* WHY an answer was withheld, kept so a stopped case can be diagnosed rather than guessed at.
     * The first real-model run had a withheld case with no recorded reason, which is unusable. */
    withheldViolations: i && i.withheld ? i.withheld.violations || null : null,
    promptSections: (scenario.sections || []).join(","),
    contextText: contextTextOf(scenario),
    provenanceCount: i ? (i.contextProvenance || []).length : 0,
    interactionId: i ? i.id : null,
  };
}

/* ---- is a real provider actually there? ----------------------------------------------------------- */
async function probe() {
  if (PROVIDER === "gemini") {
    const key = process.env.GEMINI_API_KEY || process.env.MAIK_GEMINI_API_KEY;
    if (!key) return { up: false, why: "GEMINI_API_KEY is not set in this environment", fix: "export GEMINI_API_KEY=... (never put it in a file this repository tracks)" };
    try {
      /* PROBE WITH THE METHOD THE EVALUATION ACTUALLY USES.
       *
       * This first probed ListModels, which is a DIFFERENT method with different permissions, and it
       * produced a misleading diagnosis: "ListModels is blocked" while the real obstacle was that
       * generateContent was blocked for a different reason again. A health check that exercises a
       * path the run does not take can only mislead, so this sends a real, minimal generateContent
       * request to the model the run is about to use. Nothing here prints the key. */
      const model = MODELS[0] && MODELS[0].startsWith("gemini-") ? modelIdFor(MODELS[0]) : "gemini-2.5-flash";
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }], generationConfig: { temperature: 0 } }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const err = body && body.error;
        const cls = str_(err && err.status) || `HTTP_${res.status}`;
        const msg = scrub(str_(err && err.message), key);
        return { up: false, why: `Gemini answered HTTP ${res.status} [${cls}] for generateContent on ${model}: ${msg}`, fix: diagnose(cls, msg) };
      }
      return { up: true, served: [str_(body && body.modelVersion) || model] };
    } catch (e) { return { up: false, why: scrub(String((e && e.message) || e), key) }; }
  }
  try {
    const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { up: false, why: `the model server answered ${res.status}` };
    const body = await res.json();
    return { up: true, served: (body.data || []).map((m) => m.id) };
  } catch (e) { return { up: false, why: String((e && e.message) || e) }; }
}

const str_ = (v) => String(v == null ? "" : v).trim();

/** Registry id -> the model name Google is asked for. Kept in step with maik-gateway's MODELS. */
function modelIdFor(registryId) {
  return { "gemini-flash": "gemini-2.5-flash", "gemini-pro": "gemini-2.5-pro" }[registryId] || "gemini-2.5-flash";
}

/**
 * Turn Google's error into the thing an operator has to DO. These two look identical in a log and
 * need completely different fixes, which is why they are separated here rather than in prose.
 */
function diagnose(cls, msg) {
  if (/has not been used in project|is disabled/i.test(msg)) {
    const proj = (msg.match(/project (\d+)/) || [])[1];
    return `The Generative Language API is NOT ENABLED on this Google Cloud project${proj ? " (" + proj + ")" : ""}. Enable "generativelanguage.googleapis.com" for that project in the Google Cloud console, then wait a few minutes for it to propagate. This is a project setting, not a key setting.`;
  }
  if (/method .* are blocked|Requests to this API/i.test(msg)) {
    return "The API key carries an API RESTRICTION that blocks this method. In the Google Cloud console, edit the key's 'API restrictions' so the Generative Language API is permitted (or set it to 'Don't restrict key' while testing). This is a key setting, not a project setting.";
  }
  if (cls === "RESOURCE_EXHAUSTED") return "Quota or rate limit reached for this key. Wait, or raise the quota for the project.";
  if (cls === "UNAUTHENTICATED" || /API key not valid/i.test(msg)) return "The key was rejected as invalid. Check it was copied whole and belongs to the project whose API is enabled.";
  return "Check the key's API restrictions and that the Generative Language API is enabled for its project.";
}

/** Nothing this script prints or writes may carry the credential. */
function scrub(text, secret) {
  const t = String(text == null ? "" : text);
  const k = String(secret || "");
  return k.length >= 8 ? t.split(k).join("[redacted]") : t;
}

/* ---- run ------------------------------------------------------------------------------------------ */
const bar = (s) => console.log("\n" + s + "\n" + "-".repeat(s.length));

const health = await probe();
if (!health.up) {
  console.log(`
=========================================================================
REAL-MODEL EVALUATION: NOT VERIFIED
=========================================================================
No real model answered for provider "${PROVIDER}": ${health.why}${health.fix ? "\n" + health.fix : ""}

The harness is implemented and its graders are tested
(node --test test/wardsynq-maik-eval.test.mjs), but NO REAL MODEL WAS RUN,
so there are no model-quality, latency or token results and none are claimed.

This run deliberately does NOT substitute a deterministic provider: a
fixture's score is a fact about the fixture, and reporting it as a model
result would be the exact claim this task forbids.

To produce real results:
  Gemini:  export GEMINI_API_KEY=...   (environment only - never a tracked file)
           node --experimental-test-module-mocks test/run-maik-real-eval.mjs
  Local:   ollama serve && ollama pull qwen2.5:3b-instruct
           MAIK_EVAL_PROVIDER=local-openai node --experimental-test-module-mocks test/run-maik-real-eval.mjs
=========================================================================`);
  process.exit(2);
}

console.log(`Provider: ${PROVIDER}${PROVIDER === "gemini" ? " (key from GEMINI_API_KEY; never logged)" : " at " + BASE_URL}`);
console.log(`Serving: ${(health.served || []).join(", ") || "(not enumerated)"}`);
console.log(`Evaluation set: ${EVAL_SET_VERSION} (${SCENARIOS.length} scenarios, ${SCENARIOS.filter((s) => s.adversarial).length} adversarial)`);
console.log(`Evaluation tenant: ${TENANT_ID} (in-memory, synthetic, discarded at exit)`);

const runs = [];
for (const modelName of MODELS) {
  const cfg = seedOrg(modelName);
  bar(`MODEL: ${modelName}`);
  const results = [];
  for (const s of SCENARIOS) {
    const run = await runScenario(s);
    const scored = scoreCase(s, run);
    results.push(scored);
    /* NOT-SCORED is printed as its own outcome. A withheld or refused case measured no model quality,
     * and a green PASS beside it would be a report of a measurement that never happened. */
    const mark = !scored.scored ? "NOT SCORED" : scored.pass ? "PASS      " : "FAIL      ";
    const extra = run.refusal ? ` [refused: ${run.refusal}]`
      : run.released === false ? ` [withheld: ${(run.withheldViolations || []).join(", ") || "no reason recorded"}]`
      : ` ${scored.latencyMs}ms`;
    console.log(`  ${mark} ${s.id}${extra}${scored.pass || !scored.scored ? "" : "  -> " + scored.failures.map((f) => f.metric).join(", ")}`);
    for (const f of scored.failures) {
      const ev = Array.isArray(f.evidence) ? f.evidence.map((e) => e.id).join(", ") : f.evidence;
      console.log(`          ${f.metric} = ${typeof f.value === "number" ? f.value.toFixed(2) : f.value} (need ${f.threshold})${ev ? ": " + ev : ""}`);
    }
  }

  const summary = summarise(results, {
    model: modelName,
    modelReported: results.map((r) => r.model).find(Boolean) || null,
    provider: PROVIDER,
    gateway: { provider: PROVIDER, baseUrl: PROVIDER === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : BASE_URL,
      timeoutMs: cfg.timeoutMs, phiApproved: cfg.phiApproved, models: cfg.models || null,
      credentialSource: PROVIDER === "gemini" ? "GEMINI_API_KEY (environment)" : "none required",
      note: "the caller names a task, never a model; the model is chosen by the gateway from this configuration" },
    tenant: TENANT_ID,
    ranAt: new Date().toISOString(),
    realModel: true,
  });
  summary.caseDetail = results;
  runs.push(summary);

  console.log(`\n  cases ${summary.cases}  scored ${summary.scored}  passed ${summary.passed}  failed ${summary.failed}  not scored ${summary.unmeasured}  -> ${summary.pass ? "PASS" : "FAIL"}`);
  console.log(`  outcomes: ${summary.outcomes.scored} answered, ${summary.outcomes.withheld} withheld by output screening, ${summary.outcomes.refused} refused before a model was called`);
  for (const u of summary.unmeasuredCases) console.log(`     NOT SCORED ${u.id}: ${u.outcome}${u.refusal ? " " + u.refusal : ""}${u.violations ? " (" + u.violations.join(", ") + ")" : ""}`);
  console.log(`  latency p50 ${summary.latency.p50}ms  p95 ${summary.latency.p95}ms  max ${summary.latency.max}ms (threshold ${summary.latency.threshold}ms)`);
  console.log(`  tokens in ${summary.tokens.in} out ${summary.tokens.out} over ${summary.tokens.measured}/${summary.tokens.cases} cases${summary.tokens.note ? " - " + summary.tokens.note : ""}`);
  for (const [k, v] of Object.entries(summary.metrics)) {
    console.log(`  ${k.padEnd(20)} ${v.total != null ? `total ${v.total}` : `mean ${v.mean.toFixed(3)} worst ${v.worst.toFixed(3)}`}  (${v.threshold})`);
  }

  /* REQUIREMENT 11. A baseline is per-model, because comparing one model's cases to another's would
   * report every difference between two models as a regression in one of them. */
  const baselinePath = join(RESULTS_DIR, `baseline.${sanitize(modelName)}.json`);
  let baseline = null;
  try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); } catch { baseline = null; }
  const cmp = compareToBaseline(summary, baseline);
  summary.regression = cmp;
  if (!cmp.hasBaseline) {
    console.log(`  regression: no baseline for ${modelName} yet (--write-baseline to record this run as one)`);
  } else {
    console.log(`  regression: ${cmp.regressions.length} regressed, ${cmp.improvements.length} improved${cmp.evalSetChanged ? " [EVAL SET CHANGED since baseline]" : ""}`);
    for (const r of cmp.regressions) console.log(`     REGRESSION ${r.id}: ${r.failures.map((f) => f.metric).join(", ")}`);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `results.${sanitize(modelName)}.json`), JSON.stringify(summary, null, 2));
  if (WRITE_BASELINE) {
    writeFileSync(baselinePath, JSON.stringify({
      evalSetVersion: summary.evalSetVersion, model: modelName, modelReported: summary.modelReported,
      provider: summary.provider, ranAt: summary.ranAt, caseResults: summary.caseResults,
    }, null, 2));
    console.log(`  baseline written: ${baselinePath}`);
  }
}

/* REQUIREMENT 10, checked at the end rather than asserted at the start: nothing this run wrote can
 * be anywhere but the throwaway tenant. */
/* REQUIREMENT 6, checked rather than asserted: no artefact this run produced carries the key. */
const KEY_NOW = process.env.GEMINI_API_KEY || "";
if (KEY_NOW.length >= 8) {
  for (const r of runs) {
    if (JSON.stringify(r).includes(KEY_NOW)) {
      console.log("\nFAIL: the API key reached a results file. Refusing to finish.");
      process.exit(1);
    }
  }
}

const strayTenants = [...new Set(RECORD.tenants ? RECORD.tenants() : [TENANT_ID])].filter((t) => !String(t).startsWith("eval-"));
if (strayTenants.length) {
  console.log(`\nFAIL: evaluation data reached a non-evaluation tenant: ${strayTenants.join(", ")}`);
  process.exit(1);
}

bar("SUMMARY");
for (const r of runs) {
  console.log(`${String(r.model).padEnd(28)} ${r.passed}/${r.scored} scored-and-passed (${r.unmeasured} not scored)  p50 ${r.latency.p50}ms  ${r.pass ? "PASS" : "FAIL"}${r.regression && r.regression.regressions.length ? `  (${r.regression.regressions.length} REGRESSED)` : ""}`);
}
console.log(`\nReal model executed: YES. Clinically validated: NO - nothing here is a clinical study.`);
console.log(`Results written to ${RESULTS_DIR}/results.<model>.json`);

const anyRegression = runs.some((r) => r.regression && r.regression.hasBaseline && !r.regression.pass);
process.exit(anyRegression ? 1 : 0);
