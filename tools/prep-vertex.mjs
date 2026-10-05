#!/usr/bin/env node
// PrepNucleus owner-side Vertex client. Dev-only, never shipped (tools/ is 404 on the web). Used by
// tools/prep-measure.mjs, tools/prep-screen-keys.mjs and tools/prep-fill.mjs. Plan: vault/plans/PrepNucleus.md 6.3,
// 9.1 and vault/plans/PrepNucleus-LayerC.md 5 (Phase 0 row).
//
// RUN (nothing to run directly; the tools import it). Environment read by every tool:
//   PREP_VERTEX_PROJECT   GCP project id that holds Vertex AI (required for any real call)
//   PREP_VERTEX_LOCATION  default us-central1 ("global" uses the global host)
//   PREP_MODEL            default gemini-3.1-flash-lite (MODEL_HARD_DEFAULT in functions/_ai_usage.js)
//   PREP_GCS_BUCKET       bucket for Batch input and output JSONL (required for Batch)
//   Auth: `gcloud auth print-access-token` (the owner's gcloud login or ADC), spawned once and cached 45 minutes.
//
// What it does
//   generate(prompt, opts)     one online generateContent call (Vertex), retry on 429 / 503 with backoff, usage recorded
//   batch.submit / get / wait / results / run
//                              Batch prediction: JSONL to GCS, batchPredictionJobs create, poll, read predictions JSONL
//   log                        one usage record per model response (online or batch): promptTokenCount,
//                              candidatesTokenCount, thoughtsTokenCount, cachedContentTokenCount, finishReason,
//                              modelVersion, provider, 429s, retries, latency, labels run
//   priceUsdPer1M / costUsd    from MODEL_RATES in functions/_ai_usage.js (INR per 1k at Rs 96 per USD); Batch is half
//
// Every network and process touch goes through injected `fetch` and `exec`, so tests never reach Google.
// Every request carries Vertex labels { app: "prep", run } so a run reconciles against Cloud Billing.
import { spawn } from "node:child_process";
import { MODEL_RATES, MODEL_HARD_DEFAULT } from "../functions/_ai_usage.js";
import { sha12 } from "../functions/_prep-core.js";

export const INR_PER_USD = 96;            // the rate functions/_ai_usage.js prices with
export const BATCH_DISCOUNT = 0.5;        // Vertex Batch prediction: half the online price (plan D8)
export const RETRY_STATUS = new Set([429, 503]);
export const TERMINAL = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED", "JOB_STATE_PARTIALLY_SUCCEEDED"]);
export const OK_STATES = new Set(["JOB_STATE_SUCCEEDED", "JOB_STATE_PARTIALLY_SUCCEEDED"]);

export function vertexConfig(env = process.env) {
  return {
    project: String(env.PREP_VERTEX_PROJECT || "").trim(),
    location: String(env.PREP_VERTEX_LOCATION || "us-central1").trim(),
    model: String(env.PREP_MODEL || MODEL_HARD_DEFAULT).trim(),
    bucket: String(env.PREP_GCS_BUCKET || "").trim().replace(/^gs:\/\//, "").replace(/\/+$/, ""),
  };
}

// ---- prices ---------------------------------------------------------------------------------------------------------
const r6 = (x) => Math.round(x * 1e6) / 1e6;
/* priceUsdPer1M(model, { batch }) -> { in, out } USD per 1M tokens. MODEL_RATES is INR per 1k = USD per 1M x 0.096.
 * Output includes thinking tokens (Vertex bills thinking as output). Unknown model -> the default model's rate. */
export function priceUsdPer1M(model, opts = {}) {
  const r = MODEL_RATES[model] || MODEL_RATES[MODEL_HARD_DEFAULT];
  const k = opts.batch ? BATCH_DISCOUNT : 1, perUsd = INR_PER_USD / 1000;
  return { in: r6((r.in / perUsd) * k), out: r6((r.out / perUsd) * k) };
}
/* costUsd({ inTok, outTok, thinkTok }, model, { batch }) -> USD. Cached input is billed as input here (an upper
 * bound; prep sends no cached content). */
export function costUsd(u, model, opts = {}) {
  const p = priceUsdPer1M(model, opts);
  return ((u.inTok || 0) * p.in + ((u.outTok || 0) + (u.thinkTok || 0)) * p.out) / 1e6;
}
export const usdToInr = (usd) => usd * INR_PER_USD;
export const estTokens = (chars) => Math.ceil(Math.max(0, chars) / 4);
/* promptTokens(prompt) -> estimated input tokens of a core prompt (system + user + schema), chars / 4. */
export function promptTokens(prompt) {
  return estTokens(String(prompt.system || "").length + String(prompt.user || "").length + JSON.stringify(prompt.schema || {}).length);
}

// ---- labels and request body ----------------------------------------------------------------------------------------
/* Vertex label values: lower case letters, digits, "-" and "_", at most 63 chars. */
export function labelValue(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "none"; }
export function labelsFor(run, extra) {
  const out = { app: "prep", run: labelValue(run) };
  for (const [k, v] of Object.entries(extra || {})) out[labelValue(k)] = labelValue(v);
  return out;
}
/* requestBody(prompt, { temperature, labels }) -> a Vertex GenerateContentRequest for a core prompt
 * ({ system, user, schema, maxOut, temperature }). thinkingBudget 0 as the server's genBody; never thinkingLevel
 * with it (LayerC 7: that pair is a 400). */
export function requestBody(prompt, opts = {}) {
  const t = typeof opts.temperature === "number" ? opts.temperature : prompt.temperature;
  const b = {
    contents: [{ role: "user", parts: [{ text: String(prompt.user || "") }] }],
    systemInstruction: { parts: [{ text: String(prompt.system || "") }] },
    generationConfig: { temperature: t, maxOutputTokens: prompt.maxOut, responseMimeType: "application/json", responseSchema: prompt.schema, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (opts.labels) b.labels = opts.labels;
  return b;
}
/* readResponse(json) -> { text, finishReason, usage, modelVersion } from a GenerateContentResponse. Thought parts
 * (part.thought === true) are not answer text. */
export function readResponse(j) {
  const c = j && Array.isArray(j.candidates) ? j.candidates[0] : null;
  const parts = c && c.content && Array.isArray(c.content.parts) ? c.content.parts : [];
  const u = (j && j.usageMetadata) || {};
  return {
    text: parts.filter((p) => p && !p.thought && typeof p.text === "string").map((p) => p.text).join(""),
    finishReason: (c && c.finishReason) || (j && j.promptFeedback && j.promptFeedback.blockReason ? "BLOCKED:" + j.promptFeedback.blockReason : "NONE"),
    usage: {
      promptTokenCount: u.promptTokenCount | 0, candidatesTokenCount: u.candidatesTokenCount | 0,
      thoughtsTokenCount: u.thoughtsTokenCount | 0, cachedContentTokenCount: u.cachedContentTokenCount | 0,
    },
    modelVersion: (j && j.modelVersion) || "",
  };
}

// ---- Batch file format (CHECK AGAINST THE CURRENT VERTEX DOCS BEFORE THE FIRST REAL RUN) -----------------------------
// Written from memory of the Vertex "Batch prediction for Gemini" page; the three functions below are the only places
// that encode it, so a correction stays local.
//   batchLine: each input JSONL line is { "request": GenerateContentRequest }. We add a top-level "key" so outputs can
//     be matched. If Vertex rejects or drops unknown top-level fields, matching falls back to a hash of the request
//     (requestHash), which every output line echoes under "request". Per-request "labels" are left out of the lines
//     (the job carries { app, run }); check whether Batch accepts them before adding them back.
//   batchJobBody: POST .../locations/{loc}/batchPredictionJobs with model "publishers/google/models/{model}",
//     inputConfig { instancesFormat: "jsonl", gcsSource: { uris } }, outputConfig { predictionsFormat: "jsonl",
//     gcsDestination: { outputUriPrefix } }, labels. The finished job names its folder in outputInfo.gcsOutputDirectory.
//   outputLines: every *.jsonl object under that folder; each line { request, response?, status? }, where a non-empty
//     status string is a per-request error.
export function requestHash(req) {
  const r = req || {};
  return sha12(JSON.stringify([r.systemInstruction || null, r.contents || null, (r.generationConfig || {}).temperature]));
}
export function batchLine(key, request) {
  const r = { ...request };
  delete r.labels;
  return { key, request: r };
}
export function batchJobBody({ displayName, model, inputUri, outputPrefix, labels }) {
  return {
    displayName,
    model: `publishers/google/models/${model}`,
    inputConfig: { instancesFormat: "jsonl", gcsSource: { uris: [inputUri] } },
    outputConfig: { predictionsFormat: "jsonl", gcsDestination: { outputUriPrefix: outputPrefix } },
    labels,
  };
}
/* matchOutput(outLines, inLines) -> Map key -> { response | null, error }. A line with our key wins; otherwise the
 * request hash maps it back to every input key with that request. */
export function matchOutput(outLines, inLines) {
  const byHash = new Map();
  for (const l of inLines) { const h = requestHash(l.request); if (!byHash.has(h)) byHash.set(h, []); byHash.get(h).push(l.key); }
  const out = new Map();
  for (const o of outLines) {
    const keys = o && o.key != null ? [String(o.key)] : (byHash.get(requestHash(o && o.request)) || []);
    const err = o && o.status && typeof o.status === "string" ? o.status : (o && o.status && o.status.message) || "";
    for (const k of keys) if (!out.has(k) || (!out.get(k).response && o.response)) out.set(k, { response: (o && o.response) || null, error: err });
  }
  return out;
}

// ---- process helpers ------------------------------------------------------------------------------------------------
export function defaultExec(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", rej);
    p.on("close", (c) => (c === 0 ? res(out) : rej(new Error(`${cmd} exited ${c}: ${err.slice(-300)}`))));
  });
}
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function percentile(list, p) {
  const a = list.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[i];
}
function parseGs(uri) {
  const m = /^gs:\/\/([^/]+)\/?(.*)$/.exec(String(uri || ""));
  if (!m) throw new Error("not a gs:// uri: " + uri);
  return { bucket: m[1], name: m[2] };
}

/* createVertex({ env, config, fetch, exec, sleep, now, retries, backoffMs, random }) -> client.
 *   client.generate(prompt, { temperature, run, op, labels }) -> { text, finishReason, usage, modelVersion, latencyMs,
 *     status, n429, retries }; throws after the last retry or on any other non-2xx (the attempt is still logged).
 *   client.batch.run({ name, run, lines, poll, wait }) -> Map key -> { text, finishReason, usage, error }
 *   client.log: usage records. client.calls: count of HTTP requests made (any host). */
export function createVertex(o = {}) {
  const cfg = { ...vertexConfig(o.env || process.env), ...(o.config || {}) };
  const fetchFn = o.fetch || globalThis.fetch;
  const exec = o.exec || defaultExec;
  const sleep = o.sleep || realSleep;
  const now = o.now || Date.now;
  const random = o.random || Math.random;
  const maxRetries = o.retries == null ? 5 : o.retries;
  const backoffMs = o.backoffMs == null ? 1000 : o.backoffMs;
  const host = cfg.location === "global" ? "https://aiplatform.googleapis.com" : `https://${cfg.location}-aiplatform.googleapis.com`;
  const base = `${host}/v1/projects/${cfg.project}/locations/${cfg.location}`;
  const log = [];
  let tok = null, calls = 0;

  function need(what) {
    if (!cfg.project) throw new Error("set PREP_VERTEX_PROJECT (and run `gcloud auth login`) before a real run");
    if (what === "batch" && !cfg.bucket) throw new Error("set PREP_GCS_BUCKET for Batch input and output");
  }
  async function token() {
    if (tok && tok.exp > now()) return tok.value;
    const v = String(await exec("gcloud", ["auth", "print-access-token"])).trim();
    if (!v) throw new Error("gcloud auth print-access-token returned nothing");
    tok = { value: v, exp: now() + 45 * 60 * 1000 };
    return v;
  }
  /* http(url, init) -> { status, json, text, n429, retries }. Retries 429 and 503 (and network errors) with exponential
   * backoff plus jitter, honouring Retry-After when present. One 401 drops the cached token and retries once. */
  async function http(url, init = {}) {
    let n429 = 0, retries = 0, reauth = false;
    for (let attempt = 0; ; attempt++) {
      const headers = { Authorization: "Bearer " + (await token()), ...(init.headers || {}) };
      let r = null, netErr = null;
      calls++;
      try { r = await fetchFn(url, { ...init, headers }); } catch (e) { netErr = e; }
      const status = r ? r.status : 0;
      if (status === 429) n429++;
      if (status === 401 && !reauth) { reauth = true; tok = null; retries++; continue; }
      if ((netErr || RETRY_STATUS.has(status)) && attempt < maxRetries) {
        retries++;
        const ra = r && r.headers && typeof r.headers.get === "function" ? Number(r.headers.get("retry-after")) : NaN;
        const wait = Math.max(Number.isFinite(ra) ? ra * 1000 : 0, backoffMs * 2 ** attempt) + Math.floor(random() * backoffMs * 0.25);
        await sleep(wait);
        continue;
      }
      if (netErr) { const e = new Error("network: " + netErr.message); e.status = 0; e.n429 = n429; e.retries = retries; throw e; }
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      return { status, ok: status >= 200 && status < 300, json, text, n429, retries };
    }
  }

  async function generate(prompt, opts = {}) {
    need("online");
    const labels = opts.labels || labelsFor(opts.run || "adhoc");
    const body = requestBody(prompt, { temperature: opts.temperature, labels });
    const url = `${base}/publishers/google/models/${cfg.model}:generateContent`;
    const t0 = now();
    let res, err = null;
    try { res = await http(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch (e) { err = e; }
    const latencyMs = now() - t0;
    const rd = res && res.ok ? readResponse(res.json) : { text: "", finishReason: "ERROR", usage: readResponse(null).usage, modelVersion: "" };
    const rec = {
      mode: "online", op: opts.op || prompt.op || "", run: labels.run, temperature: body.generationConfig.temperature,
      ...rd.usage, finishReason: rd.finishReason, modelVersion: rd.modelVersion, provider: "vertex", model: cfg.model,
      status: res ? res.status : (err && err.status) || 0, n429: res ? res.n429 : (err && err.n429) || 0, retries: res ? res.retries : (err && err.retries) || 0, latencyMs,
    };
    log.push(rec);
    if (err) throw err;
    if (!res.ok) { const e = new Error(`generateContent ${res.status}: ${String(res.text).slice(0, 300)}`); e.status = res.status; throw e; }
    return { ...rd, latencyMs, status: res.status, n429: res.n429, retries: res.retries, body };
  }

  // ---- GCS (JSON API) ----
  async function gcsPut(bucket, name, text) {
    const r = await http(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    if (!r.ok) throw new Error(`GCS upload ${r.status}: ${String(r.text).slice(0, 200)}`);
    return `gs://${bucket}/${name}`;
  }
  async function gcsList(bucket, prefix) {
    const names = [];
    let page = "";
    for (;;) {
      const r = await http(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}${page ? "&pageToken=" + encodeURIComponent(page) : ""}`, { method: "GET" });
      if (!r.ok) throw new Error(`GCS list ${r.status}`);
      for (const it of (r.json && r.json.items) || []) names.push(it.name);
      page = r.json && r.json.nextPageToken;
      if (!page) return names;
    }
  }
  async function gcsGet(bucket, name) {
    const r = await http(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`, { method: "GET" });
    if (!r.ok) throw new Error(`GCS get ${r.status}`);
    return r.text;
  }

  // ---- Batch prediction ----
  const objPrefix = (run, name) => `prep/${labelValue(run)}/${String(name).replace(/[^A-Za-z0-9._/-]+/g, "-")}`;
  /* submit({ name, run, lines: [{ key, request }] }) -> { jobId, inputUri, outputPrefix, submittedAt } */
  async function submit({ name, run, lines }) {
    need("batch");
    const pre = objPrefix(run, name);
    const body = lines.map((l) => JSON.stringify(batchLine(l.key, l.request))).join("\n") + "\n";
    const inputUri = await gcsPut(cfg.bucket, `${pre}/input.jsonl`, body);
    const outputPrefix = `gs://${cfg.bucket}/${pre}/out/`;
    const r = await http(`${base}/batchPredictionJobs`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batchJobBody({ displayName: labelValue(run) + "-" + labelValue(name), model: cfg.model, inputUri, outputPrefix, labels: labelsFor(run) })) });
    if (!r.ok || !r.json || !r.json.name) throw new Error(`batchPredictionJobs create ${r.status}: ${String(r.text).slice(0, 300)}`);
    return { jobId: r.json.name, inputUri, outputPrefix, submittedAt: new Date(now()).toISOString() };
  }
  /* get(jobId) -> { state, outputDir, error, createTime, endTime } */
  async function get(jobId) {
    need("batch");
    const r = await http(`${host}/v1/${jobId}`, { method: "GET" });
    if (!r.ok || !r.json) throw new Error(`batchPredictionJobs get ${r.status}`);
    const j = r.json;
    return { jobId, state: j.state || "", outputDir: (j.outputInfo && j.outputInfo.gcsOutputDirectory) || "", error: j.error ? JSON.stringify(j.error).slice(0, 300) : "", createTime: j.createTime || "", endTime: j.endTime || "" };
  }
  /* wait(jobId, { pollMs, maxWaitMs }) -> the job info once terminal, or with pending: true when maxWaitMs ran out. */
  async function wait(jobId, w = {}) {
    const pollMs = w.pollMs == null ? 60000 : w.pollMs, maxWaitMs = w.maxWaitMs == null ? 24 * 3600 * 1000 : w.maxWaitMs;
    const t0 = now();
    for (;;) {
      const info = await get(jobId);
      if (TERMINAL.has(info.state)) return info;
      if (now() - t0 >= maxWaitMs) return { ...info, pending: true };
      await sleep(pollMs);
    }
  }
  /* results(info, inLines, { run, op }) -> Map key -> { text, finishReason, usage, modelVersion, error } and one
   * usage record per output line (mode "batch"). */
  async function results(info, inLines, meta = {}) {
    const { bucket, name } = parseGs(info.outputDir);
    const files = (await gcsList(bucket, name.replace(/\/?$/, "/"))).filter((n) => n.endsWith(".jsonl")).sort();
    const outLines = [];
    for (const f of files) for (const line of (await gcsGet(bucket, f)).split("\n")) { if (line.trim()) { try { outLines.push(JSON.parse(line)); } catch (e) { /* torn line */ } } }
    const m = matchOutput(outLines, inLines), out = new Map();
    for (const l of inLines) {
      const hit = m.get(l.key);
      const rd = hit && hit.response ? readResponse(hit.response) : { text: "", finishReason: "MISSING", usage: readResponse(null).usage, modelVersion: "" };
      const error = hit ? hit.error : "missing";
      out.set(l.key, { ...rd, error });
      log.push({ mode: "batch", op: meta.op || "", run: labelValue(meta.run || ""), temperature: (l.request.generationConfig || {}).temperature, ...rd.usage, finishReason: rd.finishReason, modelVersion: rd.modelVersion, provider: "vertex", model: cfg.model, status: error ? "error" : "ok", n429: 0, retries: 0, latencyMs: 0, job: info.jobId });
    }
    return out;
  }

  return {
    cfg, log, token, generate, http,
    get calls() { return calls; },
    gcs: { put: gcsPut, list: gcsList, get: gcsGet },
    batch: { submit, get, wait, results },
  };
}

/* sumUsage(records, model, { batch }) -> { calls, inTok, outTok, thinkTok, cachedTok, usd } over usage records. */
export function sumUsage(recs, model, opts = {}) {
  const s = { calls: 0, inTok: 0, outTok: 0, thinkTok: 0, cachedTok: 0, usd: 0 };
  for (const r of recs) {
    s.calls++; s.inTok += r.promptTokenCount | 0; s.outTok += r.candidatesTokenCount | 0; s.thinkTok += r.thoughtsTokenCount | 0; s.cachedTok += r.cachedContentTokenCount | 0;
    s.usd += costUsd({ inTok: r.promptTokenCount, outTok: r.candidatesTokenCount, thinkTok: r.thoughtsTokenCount }, model || r.model, { batch: opts.batch == null ? r.mode === "batch" : opts.batch });
  }
  s.usd = r6(s.usd);
  return s;
}
