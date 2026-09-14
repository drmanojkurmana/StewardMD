/* functions/_wardsynq/maik-gateway.js — TASK 8: how MaiK reaches a model when the record is involved.
 *
 * WHAT THIS IS NOT. It is not a rewrite of MaiK's existing paths. MaiK already answers a clinician's
 * own questions through functions/api/ai/[[path]].js and the maik-* client files, with an intent
 * firewall, budgets, quotas, circuit breakers and an answer cache, talking to Gemini/Vertex, Groq,
 * Cerebras and Workers AI. That side persists nothing clinical and stays exactly as it is. This
 * gateway is how MaiK reaches a model when it is reading or proposing changes to the WARDSYNQ
 * CLINICAL RECORD, and it exists because that path needs three things the other one does not have:
 *
 *   1. A PROVIDER-NEUTRAL CONTRACT. Every caller in the existing tree hard-codes its provider and
 *      model - a route file is the de-facto shared library, and two separate PROVIDERS registries
 *      exist, both shaped like Gemini's wire format. Nothing clinical should be written against one
 *      vendor's JSON. Here a caller names a TASK, never a model.
 *
 *   2. ROUTING BY PRIVACY. The existing selection routes by complexity, availability and cost, and
 *      by nothing else - there is no privacy dimension anywhere, and no redactor on any prompt path.
 *      Here, a request that carries patient data can only be answered by a provider this hospital
 *      has DECLARED it may send patient data to.
 *
 *   3. AN ANSWER THAT CAN BE RECORDED. Every call returns the provider, the model and the version
 *      that actually answered, with timings, so maik-interaction.js can write down what happened.
 *
 * PHI APPROVAL IS CONFIGURATION, NEVER CODE, AND THE DEFAULT IS NONE.
 *
 * Whether a hospital may send patient data to a given provider is a legal fact about that hospital -
 * a data-processing agreement, a jurisdiction, sometimes a specific region. It is not something a
 * source file can know, and a default of "approved" would be a piece of software deciding a
 * hospital's data-protection position on its behalf. So this ships with NOTHING approved: a
 * PHI-bearing task refuses until an administrator names the providers under
 * `wardsynq.maik.phiApproved`. A refusal is a sentence a person can act on, never a silent downgrade
 * to a provider that happens to be allowed - "route it somewhere else" is exactly how patient data
 * ends up where nobody agreed it could go.
 *
 * THE PHI CLAIM IS CHECKED, NOT TRUSTED. A caller declaring `phi: false` to reach a faster model is
 * the obvious way around the paragraph above, so the gateway INSPECTS what it was handed: a context
 * that carries patient content while claiming to be PHI-free is refused as a mislabelled request.
 * There is no de-identifier here. Stripping names out of clinical text and calling the result
 * anonymous is a research problem, and pretending to have solved it would be worse than not trying.
 *
 * STATUS: IMPLEMENTED and TESTED against deterministic in-process providers, and - since TASK 8.10 -
 * EXERCISED AGAINST REAL MODELS through this layer: a local OpenAI-compatible server and Google's
 * Gemini, both driven through the real HTTP route by test/run-maik-real-eval.mjs with no transport
 * stub. What that establishes is that the path works and what the answers score against a written
 * rubric; it is NOT clinical validation and nothing here claims to be. Turning a provider on remains
 * an operator act (a declared model + a declared PHI approval + a key), and the refusals are what
 * happens until then.
 */

const str = (v) => (v == null ? "" : String(v).trim());

/** What a caller asks for. A task, never a model - that is the whole point of the indirection. */
const TASK = Object.freeze({
  SUMMARISE: "summarise",       // condense what the record already holds, for a clinician to read
  DRAFT_NOTE: "draft-note",     // propose note text a clinician will accept, edit or reject
  EXPLAIN: "explain",           // explain something already computed (a safety verdict, a score)
  EXTRACT: "extract",           // pull structured fields out of text the record already holds
  ANSWER: "answer",             // answer a clinical question with no patient data in it at all
});

/** Where a model runs. It decides what leaving the building means. */
const LOCALITY = Object.freeze({
  ON_DEVICE: "on-device",   // the clinician's own phone or tablet; nothing leaves it
  LOCAL: "local",           // this hospital's own hardware, inside its own network
  CLOUD: "cloud",           // somebody else's computer
});

/**
 * THE GEMINI KEY, read from the environment and from nowhere else.
 *
 * It is never a configuration field on the org record: an API key in Firestore is a credential in a
 * clinical database, readable by everything that can read the org. It is a Worker/environment
 * binding, which is where secrets live in this deployment (`vault/Infra.md`), and it is read at the
 * moment of the call rather than captured, so rotating it does not need a redeploy of this module.
 *
 * `process.env` is checked only when it exists, because Cloudflare Workers has no process global -
 * the binding is the primary path and the process variable is what makes the evaluation harness and
 * local development work.
 */
function geminiKey(env) {
  const fromEnv = env && (env.GEMINI_API_KEY || env.MAIK_GEMINI_API_KEY);
  if (str(fromEnv)) return str(fromEnv);
  if (typeof process !== "undefined" && process && process.env) {
    return str(process.env.GEMINI_API_KEY || process.env.MAIK_GEMINI_API_KEY) || null;
  }
  return null;
}

/* S7 (owner, 2026-09-14): VERTEX AI IS THE PROVIDER WITH A PHI DATA AGREEMENT.
 *
 * The agreement is with the Google Cloud PROJECT this deployment runs MaiK under, so patient data may
 * reach Vertex only through that project's regional endpoint, authenticated as that project's service
 * account. The credentials are the ones functions/api/ai already uses for MaiK (GCP_PROJECT,
 * GCP_SA_EMAIL, and Workload Identity Federation or, legacy, a service-account key). No new binding.
 * Express mode (an API key, no project, no region) still answers requests that carry no patient data.
 *
 * PHI_CAPABLE is the platform's half of the approval and a hospital cannot widen it: AI Studio
 * ("gemini") has no data agreement, so naming it under phiApproved permits nothing. The hospital's
 * half is still wardsynq.maik.phiApproved, and the default is still none. */
const PHI_CAPABLE = Object.freeze(["wardsynq", "local-openai", "vertex"]);

/** What is missing for the project-scoped Vertex path, by binding name. Empty when it can run. */
function vertexProjectMissing(env) {
  const e = env || {};
  const missing = ["GCP_PROJECT", "GCP_SA_EMAIL"].filter((k) => !str(e[k]));
  if (!(str(e.GCP_WIF_PRIVATE_KEY) && str(e.GCP_WIF_AUDIENCE)) && !str(e.GCP_SA_PRIVATE_KEY)) missing.push("GCP_WIF_PRIVATE_KEY and GCP_WIF_AUDIENCE (or GCP_SA_PRIVATE_KEY)");
  return missing;
}

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function rsJwt(pem, header, claims) {
  const input = `${b64u(new TextEncoder().encode(JSON.stringify(header)))}.${b64u(new TextEncoder().encode(JSON.stringify(claims)))}`;
  const der = Uint8Array.from(atob(String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return `${input}.${b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)))}`;
}

/* An OAuth access token for the project's service account. Mirrors functions/api/ai/[[path]].js
 * (keyless WIF: self-signed OIDC -> STS -> IAM Credentials; legacy SA-JWT) rather than importing a
 * route file. ponytail: per-isolate cache, same as the AI route. */
let vertexToken = null;
async function vertexAccessToken(env, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  if (vertexToken && vertexToken.exp > now + 60 && vertexToken.sa === env.GCP_SA_EMAIL) return vertexToken.value;
  const f = fetchImpl || fetch;
  const postJson = async (url, body, headers) => (await f(url, { method: "POST", headers: { "Content-Type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) })).json();
  let value, exp = now + 3600;
  if (str(env.GCP_WIF_PRIVATE_KEY)) {
    const oidc = await rsJwt(env.GCP_WIF_PRIVATE_KEY, { alg: "RS256", typ: "JWT", kid: env.GCP_WIF_KID || undefined },
      { iss: env.GCP_WIF_ISSUER || "https://stewardmd.in", sub: env.GCP_WIF_SUBJECT || "maik-worker", aud: env.GCP_WIF_AUDIENCE, iat: now, exp: now + 3600 });
    const sts = await postJson("https://sts.googleapis.com/v1/token", { grantType: "urn:ietf:params:oauth:grant-type:token-exchange", audience: env.GCP_WIF_AUDIENCE,
      scope: "https://www.googleapis.com/auth/cloud-platform", requestedTokenType: "urn:ietf:params:oauth:token-type:access_token", subjectToken: oidc, subjectTokenType: "urn:ietf:params:oauth:token-type:jwt" });
    if (!sts || !sts.access_token) throw new Error("the Google STS token exchange failed");
    const ic = await postJson(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(env.GCP_SA_EMAIL)}:generateAccessToken`,
      { scope: ["https://www.googleapis.com/auth/cloud-platform"] }, { Authorization: `Bearer ${sts.access_token}` });
    if (!ic || !ic.accessToken) throw new Error("service account impersonation failed");
    value = ic.accessToken;
    if (ic.expireTime) exp = Math.floor(Date.parse(ic.expireTime) / 1000);
  } else {
    const jwt = await rsJwt(env.GCP_SA_PRIVATE_KEY, { alg: "RS256", typ: "JWT" },
      { iss: env.GCP_SA_EMAIL, sub: env.GCP_SA_EMAIL, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/cloud-platform", iat: now, exp: now + 3600 });
    const r = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}` });
    const j = await r.json();
    if (!j || !j.access_token) throw new Error("the service-account token exchange failed");
    value = j.access_token;
    if (j.expires_in) exp = now + Number(j.expires_in);
  }
  vertexToken = { value, exp, sa: env.GCP_SA_EMAIL };
  return value;
}

/**
 * PURE. Remove a secret from anything about to be surfaced.
 *
 * Provider errors get put into refusal messages, refusal messages get recorded on MaiKInteraction
 * rows and printed in logs, and a provider that echoes the request back in its error body would
 * otherwise write the key into the clinical record. This is belt and braces over never putting the
 * key in a URL, and it is cheap.
 */
function scrubSecret(text, secret) {
  const t = str(text);
  const k = str(secret);
  if (!k || k.length < 8) return t;
  return t.split(k).join("[redacted]");
}

/**
 * Configuration status, for an operator, WITHOUT the secret (TASK 8.10 requirement 7).
 *
 * Reports whether each provider could be reached and why not, naming the environment variable that
 * would fix it. It deliberately returns no key material and no fingerprint of one: "is it the right
 * key" is answered by making a call, not by comparing hashes in a status endpoint.
 */
function maikStatus(env, config) {
  const cfg = maikConfig(config);
  const keyPresent = !!geminiKey(env);
  const vertexMissing = vertexProjectMissing(env);
  return {
    enabled: cfg.enabled,
    phiApproved: cfg.phiApproved,
    allow: cfg.allow,
    timeoutMs: cfg.timeoutMs,
    providers: [
      { provider: "wardsynq", configured: true, detail: "always available; assembles the record and generates nothing" },
      { provider: "local-openai", configured: !!(cfg.localBaseUrl && cfg.localModel),
        detail: cfg.localBaseUrl && cfg.localModel ? `configured for ${cfg.localModel}` : "set wardsynq.maik.localBaseUrl and localModel" },
      { provider: "gemini", configured: keyPresent,
        credentialSource: "GEMINI_API_KEY (environment binding)",
        surface: "AI Studio (generativelanguage.googleapis.com)",
        detail: keyPresent ? "an API key is present in the environment" : "no GEMINI_API_KEY is set in the environment" },
      { provider: "vertex", configured: keyPresent || !vertexMissing.length,
        credentialSource: vertexMissing.length ? "GEMINI_API_KEY (environment binding)" : "GCP_PROJECT and service account (environment bindings)",
        surface: vertexMissing.length
          ? "Vertex AI express mode (aiplatform.googleapis.com), publisher path, no project or region in the URL"
          : `Vertex AI project endpoint (${vertexRegion(env)}-aiplatform.googleapis.com), region ${vertexRegion(env)}`,
        phiCapable: !vertexMissing.length,
        detail: !vertexMissing.length
          ? "the project's service account is configured; patient data may go here once this hospital approves Vertex"
          : `patient data cannot go to Vertex on this server: the project credentials are missing (${vertexMissing.join(", ")}).`
            + (keyPresent ? " Express mode, with no service account, no ADC and no region, answers requests without patient data." : "") },
    ],
    models: MODELS.map((m) => ({
      id: m.id, provider: m.provider, model: m.model, locality: m.locality, tasks: m.tasks,
      available: m.serverReachable !== false && m.available(env, cfg),
      autoSelect: m.autoSelect !== false,
      phiApproved: phiAllowed(m, cfg, env),
    })),
    /* Said explicitly so a green status is not misread: configuration is not approval. */
    note: "A model being available means it can be reached. Whether patient data may be sent to it is wardsynq.maik.phiApproved, which is a separate decision and defaults to none.",
  };
}

/**
 * THE MODEL REGISTRY. Declared, never discovered.
 *
 * A model this file does not list cannot be routed to, whatever an environment variable says: a
 * registry that grows from configuration is a registry an operator can point at anything. Adding a
 * model is a code change, reviewed like one. What configuration DOES decide is which of these are
 * available here (a key, a base URL) and which may receive patient data.
 *
 * `version` is what the provider is asked for. What actually answered is reported back by the
 * adapter and recorded, because a model id is a moving target and "gemini-3.6-flash" in March is not
 * the same weights as "gemini-3.6-flash" in September.
 */
const MODELS = Object.freeze([
  {
    id: "wardsynq-deterministic",
    provider: "wardsynq", model: "deterministic", version: "1",
    locality: LOCALITY.LOCAL,
    tasks: [TASK.SUMMARISE, TASK.EXPLAIN, TASK.EXTRACT],
    latency: "instant", cost: "none",
    /* THE FLOOR, and it is not a placeholder. It generates nothing: it assembles what the record
     * already says, in a fixed order, and marks every gap as a gap. It never runs against a model,
     * so it can never hallucinate; its ceiling is that it can only reorganise, never explain.
     *
     * IT IS NEVER CHOSEN AUTOMATICALLY, and that is deliberate. Falling back to it when no model is
     * approved would hand a ward an assembled summary where it asked for an AI one - safe, because
     * nothing is sent anywhere, and misleading, because the ward would believe AI was working. A
     * silent substitution of one answer-producer for another is the thing this gateway refuses to
     * do. So a hospital that has approved nothing gets a REFUSAL that names this as the thing that
     * can still run, and a caller that wants it asks for it by name. */
    available: () => true,
    autoSelect: false,
  },
  {
    id: "on-device-medgemma",
    provider: "on-device", model: "medgemma-1.5-4b-it", version: "Q4_K_M",
    locality: LOCALITY.ON_DEVICE,
    tasks: [TASK.ANSWER, TASK.EXPLAIN],
    latency: "slow", cost: "none",
    /* The weights this product already downloads and runs through llama.cpp (maik-local.js,
     * local-plugins/capacitor-llama). It is listed so the routing table tells the truth about what
     * this deployment can reach, and it is NOT reachable from the server: on-device means the model
     * is on the clinician's device, so a server-side call to it does not exist. A task routed here
     * is answered by the client or not at all. */
    available: () => false,
    serverReachable: false,
  },
  /* GEMINI, on Google's infrastructure. TASK 8.10 added these because the evaluation of a real model
   * needed a real external provider, and because a hospital with no on-premises GPU has no other way
   * to reach a capable model at all.
   *
   * TWO ENTRIES, NOT A CONFIGURABLE MODEL NAME. Which Gemini models exist here is a code decision,
   * reviewed like one, exactly as the paragraph above this registry requires: a `geminiModel` string
   * in configuration would be a registry an operator could point at any model Google ever ships,
   * including one nobody assessed. A hospital narrows this with `wardsynq.maik.models`; it cannot
   * widen it.
   *
   * CLOUD locality is the whole point of the ranking below: these sort BELOW anything running on the
   * hospital's own hardware, so a site with a local model keeps using it, and Gemini is reached only
   * when it is the best thing this hospital has approved. And `phiApproved` still gates it: being in
   * this registry does not mean patient data may go there. */
  {
    id: "gemini-flash",
    /* MODEL IDS RETIRE, AND THE REGISTRY IS WHERE THAT IS ABSORBED. `gemini-2.5-flash` began
     * answering NOT_FOUND with "no longer available to new users - use models/gemini-3.6-flash", so
     * the id moved and nothing else did: no caller names a model, so no caller changed. `version`
     * is what is ASKED for; what actually answered is whatever the API reports back, and that is
     * what gets recorded on the interaction. */
    provider: "gemini", model: "gemini-3.6-flash", version: "gemini-3.6-flash",
    locality: LOCALITY.CLOUD,
    tasks: [TASK.SUMMARISE, TASK.DRAFT_NOTE, TASK.EXPLAIN, TASK.EXTRACT, TASK.ANSWER],
    latency: "medium", cost: "metered",
    available: (env) => !!geminiKey(env),
  },
  {
    id: "gemini-pro",
    // Retired the same way, and Google's own named replacement for it.
    provider: "gemini", model: "gemini-3.1-pro-preview", version: "gemini-3.1-pro-preview",
    locality: LOCALITY.CLOUD,
    tasks: [TASK.SUMMARISE, TASK.DRAFT_NOTE, TASK.EXPLAIN, TASK.EXTRACT, TASK.ANSWER],
    latency: "slow", cost: "metered",
    /* Opt-in by name. Two models from one provider would otherwise be chosen between by latency rank
     * alone, which is not a clinical decision this file should be making silently. */
    available: (env) => !!geminiKey(env),
    autoSelect: false,
  },
  /* THE SAME GEMINI WEIGHTS, REACHED THROUGH VERTEX AI INSTEAD OF AI STUDIO.
   *
   * These are a separate provider rather than a flag on the entries above, because the two are
   * different services with different hosts, different billing and different failure modes: AI
   * Studio bills prepaid credits on generativelanguage.googleapis.com, Vertex bills the Google Cloud
   * project on aiplatform.googleapis.com. A hospital approving one has not approved the other, and
   * `phiApproved` naming "gemini" must not silently permit "vertex" - which it does not, because
   * approval matches on the provider id.
   *
   * EXPRESS MODE is what makes an API key work here at all. The project-path endpoints
   * (/projects/<id>/locations/<region>/...) require an OAuth bearer token and the
   * aiplatform.endpoints.predict permission; the publisher-path endpoint below accepts the same API
   * key as AI Studio and needs no service account, no ADC and no region. That is a deliberate
   * limitation to record: this adapter cannot reach a project-scoped or regionally-pinned Vertex
   * deployment, and a hospital that needs data residency in a named region needs the OAuth path,
   * which is a different adapter and a different credential. */
  {
    id: "vertex-flash",
    provider: "vertex", model: "gemini-3.6-flash", version: "gemini-3.6-flash",
    locality: LOCALITY.CLOUD,
    tasks: [TASK.SUMMARISE, TASK.DRAFT_NOTE, TASK.EXPLAIN, TASK.EXTRACT, TASK.ANSWER],
    latency: "medium", cost: "metered",
    available: (env) => !!geminiKey(env) || !vertexProjectMissing(env).length,
  },
  {
    id: "vertex-pro",
    provider: "vertex", model: "gemini-3.1-pro-preview", version: "gemini-3.1-pro-preview",
    locality: LOCALITY.CLOUD,
    tasks: [TASK.SUMMARISE, TASK.DRAFT_NOTE, TASK.EXPLAIN, TASK.EXTRACT, TASK.ANSWER],
    latency: "slow", cost: "metered",
    available: (env) => !!geminiKey(env) || !vertexProjectMissing(env).length,
    autoSelect: false,
  },
  {
    id: "hospital-local",
    provider: "local-openai", model: null, version: null,
    locality: LOCALITY.LOCAL,
    tasks: [TASK.SUMMARISE, TASK.DRAFT_NOTE, TASK.EXPLAIN, TASK.EXTRACT, TASK.ANSWER],
    latency: "medium", cost: "none",
    /* A model on this hospital's own hardware, spoken to over the OpenAI-compatible API almost every
     * local server implements (llama.cpp's server, vLLM, Ollama). The model NAME is configuration
     * because the hospital chose which weights to run; the PROVIDER is not. */
    available: (env, cfg) => !!(cfg && str(cfg.localBaseUrl) && str(cfg.localModel)),
  },
]);

const byId = (id) => MODELS.find((m) => m.id === str(id)) || null;
const vertexRegion = (env) => str(env && env.GCP_LOCATION) || "asia-south1";

/** PURE. May patient data go to this model: the platform can carry it AND this hospital approved it. */
function phiAllowed(m, cfg, env) {
  if (m.provider === "wardsynq") return true;
  if (!PHI_CAPABLE.includes(m.provider)) return false;
  if (m.provider === "vertex" && vertexProjectMissing(env).length) return false;
  return cfg.phiApproved.includes(m.provider) || cfg.phiApproved.includes(m.id);
}

/** PURE. This hospital's MaiK configuration, with every default fail-closed. */
function maikConfig(config) {
  const c = (config && typeof config === "object") ? config : {};
  return {
    enabled: c.enabled === true,
    /* THE ONLY PLACE PHI APPROVAL COMES FROM. Empty means no provider may receive patient data,
     * which is what a hospital that has not thought about it should get. */
    phiApproved: Array.isArray(c.phiApproved) ? c.phiApproved.map(str).filter(Boolean) : [],
    localBaseUrl: str(c.localBaseUrl) || null,
    localModel: str(c.localModel) || null,
    // A hospital may narrow the registry further; it may never widen it.
    allow: Array.isArray(c.models) ? c.models.map(str).filter(Boolean) : null,
    timeoutMs: Number.isFinite(Number(c.timeoutMs)) ? Math.max(1000, Math.min(120000, Number(c.timeoutMs))) : 20000,
  };
}

/** PURE. Does this text look like it carries patient data? Used to CHECK a `phi: false` claim. */
function looksLikePhi(context) {
  if (context == null) return false;
  if (typeof context === "object") {
    /* A context built by maik-chart-context.js carries its own provenance: if it names record versions, it
     * came out of a patient's chart and it is PHI, whatever the caller said. */
    if (Array.isArray(context.provenance) && context.provenance.length) return true;
    if (str(context.patientId)) return true;
    return looksLikePhi(JSON.stringify(context.content == null ? context : context.content));
  }
  const s = String(context);
  if (!s) return false;
  /* Deliberately crude and deliberately one-directional: this is a check on a CLAIM, not a
   * classifier. It can only refuse; it never approves anything, because "no pattern matched" is not
   * evidence that text is anonymous. The patterns are the ones a WardSynQ record actually produces. */
  return /\b(mrn|uhid|abha|patient id|date of birth|dob)\b/i.test(s)
    || /\bwsq-|\bfhir-|\bhl7v2-/i.test(s)
    || /\b\d{2}[/-]\d{2}[/-]\d{4}\b/.test(s);
}

/** A refusal a person can act on. Never an exception a caller might catch and retry elsewhere. */
const refuse = (code, detail) => ({ ok: false, code, detail });

/**
 * PURE. Which model answers this request, or why none may.
 *
 * ctx: { task, phi, config, env, prefer? }
 * Returns { ok: true, model } or a refusal.
 */
function route(ctx) {
  const c = ctx || {};
  const cfg = maikConfig(c.config);
  if (!cfg.enabled) return refuse("maik_disabled", "MaiK is not enabled for this hospital. It is off unless wardsynq.maik.enabled is true: a clinical system does not acquire a model by default.");
  const task = str(c.task);
  if (!Object.values(TASK).includes(task)) return refuse("unknown_task", `"${task}" is not a task this gateway routes; a caller names a task, never a model`);

  const phi = c.phi !== false;
  /* THE CLAIM IS CHECKED. A caller that says "no patient data" to reach a faster or unapproved model
   * is the obvious way around the approval rule, so the context is inspected rather than believed. */
  if (!phi && looksLikePhi(c.context)) {
    return refuse("mislabelled_phi", "this request declares that it carries no patient data, and it does; it is refused as mislabelled rather than routed on the strength of the claim");
  }

  const wanted = str(c.prefer);
  let candidates = MODELS.filter((m) => m.tasks.includes(task));
  if (cfg.allow) candidates = candidates.filter((m) => cfg.allow.includes(m.id));
  candidates = candidates.filter((m) => m.serverReachable !== false && m.available(c.env, cfg));
  // Opt-in only: a model marked autoSelect:false is reachable by name and never by default.
  candidates = candidates.filter((m) => m.autoSelect !== false || m.id === wanted);
  if (!candidates.length) return refuse("no_model", `no model this hospital has configured can do "${task}"`);

  if (phi) {
    /* PATIENT DATA GOES ONLY WHERE THIS HOSPITAL SAID IT MAY. An on-device or in-hospital model is
     * not automatically approved either: "local" is an architecture, and approval is a decision. The
     * deterministic assembler is the one exception, because it sends the data nowhere at all - it
     * runs in this process, on rows the caller already read. */
    const beforeApproval = candidates;
    candidates = candidates.filter((m) => phiAllowed(m, cfg, c.env));
    /* Why an approval did not take, in words: one naming a provider the platform has no data agreement
     * with, or Vertex approved on a server without the project credentials. */
    const why = [
      ...cfg.phiApproved.filter((p) => MODELS.some((m) => (m.provider === p || m.id === p) && !PHI_CAPABLE.includes(m.provider)))
        .map((p) => `"${p}" has no patient-data agreement with this platform, so approving it permits nothing`),
      ...(cfg.phiApproved.includes("vertex") && vertexProjectMissing(c.env).length
        ? [`Vertex is approved but this server lacks the project credentials patient data needs (${vertexProjectMissing(c.env).join(", ")})`] : []),
    ];
    /* A NAMED MODEL DROPPED HERE SAYS WHY IT WAS DROPPED. Without this, asking for a model the
     * hospital has not approved for patient data falls through to "not a model this hospital can
     * use", which sends an operator to look at the registry when the thing to change is the approval
     * list. The REFUSAL IS IDENTICAL either way - nothing is sent - and only the sentence differs. */
    if (wanted && beforeApproval.some((m) => m.id === wanted) && !candidates.some((m) => m.id === wanted)) {
      const m = beforeApproval.find((x) => x.id === wanted);
      return refuse("no_phi_approved_model",
        `"${wanted}" runs on provider "${m.provider}", which this hospital has not approved to receive patient data. Approval is per provider under wardsynq.maik.phiApproved, so approving one provider never approves another.${why.length ? " " + why.join(". ") + "." : ""} Nothing was sent.`);
    }
    if (!candidates.length) {
      const floor = MODELS.find((m) => m.id === "wardsynq-deterministic" && m.tasks.includes(task));
      return refuse("no_phi_approved_model",
        "this request carries patient data and this hospital has approved no model provider to receive it. Name the providers it has a data agreement with under wardsynq.maik.phiApproved."
        + (why.length ? " " + why.join(". ") + "." : "") + " Nothing was sent."
        + (floor ? " A deterministic assembly of what the record already says can run without any model and without sending anything anywhere; ask for \"wardsynq-deterministic\" by name if that is wanted." : ""));
    }
  }

  const preferred = wanted ? candidates.find((m) => m.id === wanted) : null;
  if (wanted && !preferred) return refuse("model_unavailable", `"${wanted}" is not a model this hospital can use for "${task}"`);
  /* Order of preference among the models a hospital HAS approved: its own hardware first, then the
   * clinician's own device, then somebody else's computer. Privacy, then latency. */
  const rank = (m) => (m.locality === LOCALITY.LOCAL ? 0 : m.locality === LOCALITY.ON_DEVICE ? 1 : 2);
  const model = preferred || [...candidates].sort((a, b) => rank(a) - rank(b))[0];
  return { ok: true, model };
}

/**
 * The Google generateContent wire format, shared by AI Studio and Vertex AI.
 *
 * The two services speak the SAME request and response shape and differ only in host, path and which
 * bill they land on - so one implementation serves both, and a bug fixed in the error handling is
 * fixed for both. `surface` is carried into error messages because "Gemini refused" is ambiguous
 * when two entirely separate services can both refuse.
 *
 * THE KEY GOES IN A HEADER, NEVER IN THE URL. Google's APIs accept `?key=`, and a URL carrying a
 * credential ends up in proxy logs, error messages, browser history and any exception that prints a
 * request. `x-goog-api-key` keeps it out of every one of those, and scrubSecret covers the case where
 * the provider echoes it back in an error body.
 *
 * A BLOCKED ANSWER IS A REFUSAL, NOT AN EMPTY ONE. Safety filters fire on clinical text more than
 * people expect - a medication list reads like drug content to a general-purpose classifier. If
 * nothing comes back, this says WHY, so a clinician is never shown silence that looks like "nothing
 * to report" and an operator can tell a block from an outage.
 */
async function googleGenerate(req, opts) {
  const cfg = maikConfig(req.config);
  let bearer = null;
  try { bearer = opts.bearer ? await opts.bearer() : null; }
  catch (e) { throw new Error(`${opts.surface} could not be authorised: ${str(e && e.message)}`); }
  const key = bearer ? null : geminiKey(req.env);
  if (!bearer && !key) throw new Error(`no Google API key is present in the environment (GEMINI_API_KEY) for ${opts.surface}`);
  const model = str(req.model && req.model.model) || "gemini-3.6-flash";
  const url = opts.urlFor(model);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs) : null;
  try {
    const res = await (req.fetchImpl || fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : { "x-goog-api-key": key }) },
      body: JSON.stringify({
        ...(str(req.system) ? { systemInstruction: { parts: [{ text: str(req.system) }] } } : {}),
        contents: [{ role: "user", parts: [{ text: str(req.prompt) }] }],
        generationConfig: { temperature: 0 },
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      /* The API's own error CLASS is the useful part for diagnosis - PERMISSION_DENIED and
       * RESOURCE_EXHAUSTED need completely different fixes - so it is surfaced, scrubbed. */
      const err = body && body.error;
      const cls = str(err && err.status) || `HTTP_${res.status}`;
      const msg = scrubSecret(scrubSecret(str(err && err.message), key), bearer);
      throw new Error(`${opts.surface} refused the request [${cls}]${msg ? ": " + msg : ""}`);
    }

    const cand = body && Array.isArray(body.candidates) ? body.candidates[0] : null;
    const blocked = body && body.promptFeedback && str(body.promptFeedback.blockReason);
    if (blocked) throw new Error(`${opts.surface} blocked the PROMPT before answering [${blocked}]. Nothing was generated.`);
    const finish = str(cand && cand.finishReason);
    const text = str(cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.map((x) => str(x && x.text)).filter(Boolean).join("")
      : "");
    if (!text) {
      throw new Error(finish && finish !== "STOP"
        ? `${opts.surface} returned no text [${finish}] - the answer was cut off or filtered, not empty of findings`
        : `${opts.surface} returned no text`);
    }

    const u = body && body.usageMetadata;
    return {
      text,
      /* What ACTUALLY answered. `modelVersion` is Google's own report and is the thing worth
       * recording: "gemini-3.6-flash" is a moving pointer and the served version is not. */
      model: { provider: opts.providerId, model, version: str(body && body.modelVersion) || model },
      usage: u ? {
        in: u.promptTokenCount ?? null, out: u.candidatesTokenCount ?? null, total: u.totalTokenCount ?? null,
        /* Vertex reports these and AI Studio does not. `thoughts` matters for cost: reasoning tokens
         * are billed and are invisible in the answer, so a run that looks cheap by output length is
         * not. `trafficType` says whether this was on-demand or provisioned throughput. */
        thoughts: u.thoughtsTokenCount ?? null,
        trafficType: str(u.trafficType) || null,
      } : null,
      generated: true,
    };
  } catch (e) {
    // Last line of defence: nothing leaves this adapter carrying the key, including an abort.
    throw new Error(scrubSecret(scrubSecret(str(e && e.message) || `${opts.surface} could not be reached`, key), bearer));
  } finally { if (timer) clearTimeout(timer); }
}

/* ---- providers ---------------------------------------------------------------------------------- */

/**
 * The provider contract, in one place: `generate(req) -> { text, model, usage? }`.
 * `req` is { system, prompt, model, config, env, signal }. A provider never sees the record, never
 * decides what it may be sent, and never writes anything - it is transport and nothing else.
 */
const PROVIDERS = Object.freeze({
  /* The deterministic assembler. It answers from the context it was given, in a fixed order, and
   * says plainly what the context did not contain. No model, no network, no generation. */
  wardsynq: {
    generate: async (req) => {
      const c = (req && req.context) || {};
      const rows = Array.isArray(c.sections) ? c.sections : [];
      const body = rows.length
        ? rows.map((s) => `${str(s.title)}\n${str(s.text) || "Not recorded."}`).join("\n\n")
        : "Not recorded.";
      return { text: body, model: { provider: "wardsynq", model: "deterministic", version: "1" }, usage: null, generated: false };
    },
  },
  /* GEMINI over the Generative Language API.
   *
   * THE KEY GOES IN A HEADER, NEVER IN THE URL. Google's API accepts `?key=`, and a URL carrying a
   * credential ends up in proxy logs, error messages, browser history and any exception that prints
   * a request. `x-goog-api-key` keeps it out of every one of those, and scrubSecret covers the case
   * where the provider echoes it back in an error body.
   *
   * A BLOCKED ANSWER IS A REFUSAL, NOT AN EMPTY ONE. Gemini's safety filters fire on clinical text
   * more than people expect - a medication list reads like drug content to a general-purpose
   * classifier. If nothing comes back, this says WHY, so a clinician is never shown silence that
   * looks like "nothing to report" and an operator can tell a block from an outage. */
  gemini: {
    generate: async (req) => googleGenerate(req, {
      providerId: "gemini",
      urlFor: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      surface: "AI Studio (generativelanguage.googleapis.com)",
    }),
  },
  /* Vertex AI. Patient data: the project's regional endpoint under its service account, the path the
   * PHI agreement covers, and nothing else. Anything else keeps express mode while a key exists, so a
   * caller that never carried PHI (the Connect agent brain, the evaluation harness) is unchanged. */
  vertex: {
    generate: async (req) => {
      const env = req.env || {};
      if (!vertexProjectMissing(env).length && (req.phi || !geminiKey(env))) {
        const region = vertexRegion(env);
        return googleGenerate(req, {
          providerId: "vertex",
          bearer: () => vertexAccessToken(env, req.fetchImpl),
          urlFor: (model) => `https://${region}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(env.GCP_PROJECT)}/locations/${region}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
          surface: `Vertex AI project endpoint (${region}-aiplatform.googleapis.com)`,
        });
      }
      if (req.phi) throw new Error(`patient data is not sent to Vertex express mode; the project credentials are missing (${vertexProjectMissing(env).join(", ")})`);
      return googleGenerate(req, {
        providerId: "vertex",
        urlFor: (model) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
        surface: "Vertex AI express mode (aiplatform.googleapis.com)",
      });
    },
  },
  /* A model on this hospital's own hardware, over the OpenAI-compatible chat API. No key is sent
   * anywhere off-site because there is no off-site: the base URL is the hospital's own. */
  "local-openai": {
    generate: async (req) => {
      const cfg = maikConfig(req.config);
      const url = `${String(cfg.localBaseUrl).replace(/\/+$/, "")}/chat/completions`;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs) : null;
      try {
        const res = await (req.fetchImpl || fetch)(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.localModel, messages: [
            ...(str(req.system) ? [{ role: "system", content: str(req.system) }] : []),
            { role: "user", content: str(req.prompt) },
          ], temperature: 0 }),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (!res.ok) throw new Error(`the local model answered ${res.status}`);
        const body = await res.json();
        const text = str(body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content);
        if (!text) throw new Error("the local model returned no text");
        return {
          text,
          // What ACTUALLY answered, as the server reported it - not what we asked for.
          model: { provider: "local-openai", model: str(body.model) || cfg.localModel, version: str(body.model) || cfg.localModel },
          usage: body && body.usage ? { in: body.usage.prompt_tokens || null, out: body.usage.completion_tokens || null } : null,
          generated: true,
        };
      } finally { if (timer) clearTimeout(timer); }
    },
  },
});

/**
 * Ask a model. ctx: { task, phi, context, system, prompt, config, env, fetchImpl?, providers? }
 *
 * Returns { ok, text, model: {provider, model, version}, generated, latencyMs, usage } or a refusal.
 * A provider failure is a refusal with a reason, never an exception thrown at a clinical caller and
 * never a silent fallback to a different model - the answer says which model answered, so a caller
 * that got an answer from somewhere else must be told.
 */
async function invoke(ctx) {
  const c = ctx || {};
  const decision = route(c);
  if (!decision.ok) return decision;
  const chosen = decision.model;
  const impl = (c.providers || PROVIDERS)[chosen.provider];
  if (!impl) return refuse("no_provider", `no adapter for provider "${chosen.provider}"`);

  const startedAt = Date.now();
  let out;
  try {
    out = await impl.generate({ system: c.system, prompt: c.prompt, context: c.context, model: chosen, config: c.config, env: c.env, fetchImpl: c.fetchImpl, phi: c.phi !== false });
  } catch (e) {
    return refuse("model_unavailable", `${chosen.id} could not answer: ${str(e && e.message) || "unavailable"}. Nothing was written.`);
  }
  const text = str(out && out.text);
  if (!text) return refuse("empty_answer", `${chosen.id} returned nothing`);
  return {
    ok: true, text,
    model: (out && out.model) || { provider: chosen.provider, model: chosen.model, version: chosen.version },
    // Whether a model GENERATED this or the record was merely reorganised. A reader must be able to
    // tell an assembled summary from a written one, and the interaction record carries it.
    generated: out.generated !== false,
    latencyMs: Date.now() - startedAt,
    usage: (out && out.usage) || null,
    routedTo: chosen.id,
  };
}

export { TASK, LOCALITY, MODELS, PROVIDERS, PHI_CAPABLE, maikConfig, looksLikePhi, route, invoke, byId, maikStatus, scrubSecret, geminiKey, googleGenerate, vertexProjectMissing, phiAllowed };
