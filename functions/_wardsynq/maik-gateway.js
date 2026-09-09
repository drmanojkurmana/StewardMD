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
 * STATUS: IMPLEMENTED and TESTED against deterministic in-process providers. NOT verified against
 * any live model provider from this layer - the WardSynQ record has never been connected to one, and
 * this does not connect it. Wiring a real provider is an operator act (a declared model + a declared
 * PHI approval + a key), and the refusals are what happens until then.
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
 * THE MODEL REGISTRY. Declared, never discovered.
 *
 * A model this file does not list cannot be routed to, whatever an environment variable says: a
 * registry that grows from configuration is a registry an operator can point at anything. Adding a
 * model is a code change, reviewed like one. What configuration DOES decide is which of these are
 * available here (a key, a base URL) and which may receive patient data.
 *
 * `version` is what the provider is asked for. What actually answered is reported back by the
 * adapter and recorded, because a model id is a moving target and "gemini-2.5-flash" in March is not
 * the same weights as "gemini-2.5-flash" in September.
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
    candidates = candidates.filter((m) => m.provider === "wardsynq" || cfg.phiApproved.includes(m.provider) || cfg.phiApproved.includes(m.id));
    if (!candidates.length) {
      const floor = MODELS.find((m) => m.id === "wardsynq-deterministic" && m.tasks.includes(task));
      return refuse("no_phi_approved_model",
        "this request carries patient data and this hospital has approved no model provider to receive it. Name the providers it has a data agreement with under wardsynq.maik.phiApproved. Nothing was sent."
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
    out = await impl.generate({ system: c.system, prompt: c.prompt, context: c.context, model: chosen, config: c.config, env: c.env, fetchImpl: c.fetchImpl });
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

export { TASK, LOCALITY, MODELS, PROVIDERS, maikConfig, looksLikePhi, route, invoke, byId };
