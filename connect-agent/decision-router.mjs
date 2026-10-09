/* connect-agent/decision-router.mjs
 *
 * Fast decision layer for AgentConnect.
 *
 * Jev is used only for bounded orchestration decisions: whether a discovery task
 * needs deeper review and whether Gemini should be asked to propose a field mapping.
 * Gemini is used only on value-free response shapes plus synthetic fixtures.
 *
 * Safety boundary:
 * - no patient rows, credentials, cookies, tokens, or screenshots are sent here
 * - Jev never executes tools and never creates clinical decisions
 * - Gemini suggestions are validated by compile.mjs before entering a manifest
 * - if either service is unavailable, the deterministic compiler continues unchanged
 */

const JEV_URL = "https://thejevai.com/v1/systemone";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function trim(s, n = 12000) {
  return String(s == null ? "" : s).slice(0, n);
}

function jsonHeaders(token) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

export function aiEnabled(env = process.env) {
  return !!(env.JEV_API_KEY || env.CONNECT_AGENT_JEV_API_KEY || env.GEMINI_API_KEY || env.CONNECT_AGENT_GEMINI_API_KEY);
}

export async function jevDecide({ state, questions, apiKey = process.env.JEV_API_KEY || process.env.CONNECT_AGENT_JEV_API_KEY, fetchFn = globalThis.fetch }) {
  if (!apiKey) return null;
  const res = await fetchFn(JEV_URL, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
  const body = await res.json();
  return body;
}

export async function routeDiscovery({ spec, fetchFn = globalThis.fetch, apiKey }) {
  const events = Array.isArray(spec?.events) ? spec.events : [];
  const state = {
    eventCount: events.length,
    methods: [...new Set(events.map((e) => String(e.method || "").toUpperCase()))],
    statusClasses: [...new Set(events.map((e) => Math.floor(Number(e.status || 0) / 100)))],
    hasNonJson: events.some((e) => !/json/i.test(String(e.contentType || ""))),
    hasWrite: events.some((e) => !["GET", "HEAD"].includes(String(e.method || "").toUpperCase())),
    hasAmbiguousPaths: events.some((e) => !/^\\/[^?]*$/.test(String(e.path || ""))),
  };
  const questions = {
    route: {
      type: "choice",
      instructions: "Choose the safest next compiler route for this observed EMR discovery.",
      criteria: {
        proceed_fast: "The evidence is read-only, JSON-shaped, and sufficiently regular for deterministic compilation.",
        deep_review: "The discovery is usable but contains ambiguity that should receive a secondary mapping review.",
        block: "The discovery contains write operations or insufficient evidence for safe compilation.",
      },
    },
  };
  return jevDecide({ state, questions, fetchFn, apiKey });
}

export async function suggestMappingsWithGemini({
  operationType,
  resource,
  sanitizedShape,
  fixture = null,
  unmappedFields,
  fetchFn = globalThis.fetch,
  apiKey = process.env.GEMINI_API_KEY || process.env.CONNECT_AGENT_GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
}) {
  if (!apiKey || !Array.isArray(unmappedFields) || !unmappedFields.length) return null;

  const system = [
    "You are the StewardMD AgentConnect adapter mapping assistant.",
    "Return JSON only.",
    "You may suggest mappings only for the requested canonical fields.",
    "Use only keys visible in the supplied value-free response shape.",
    "Never invent an endpoint, method, origin, identifier, patient value, or clinical fact.",
    "Allowed transforms: pick, toDate, toNumber, coalesce. A const literal may only be proposed when it is already evident from the operation type.",
    "If uncertain, omit the field.",
  ].join(" ");

  const prompt = {
    operationType,
    resource,
    unmappedFields,
    responseShape: sanitizedShape,
    syntheticFixture: fixture,
    output: { fields: "object mapping canonical field names to compiler expressions" },
  };

  const url = `${GEMINI_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: JSON.stringify(prompt) }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 700 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function createConnectAi({ env = process.env, fetchFn = globalThis.fetch } = {}) {
  const jevKey = env.JEV_API_KEY || env.CONNECT_AGENT_JEV_API_KEY;
  const geminiKey = env.GEMINI_API_KEY || env.CONNECT_AGENT_GEMINI_API_KEY;
  return {
    enabled: !!(jevKey || geminiKey),
    async routeDiscovery(spec) {
      if (!jevKey) return null;
      try { return await routeDiscovery({ spec, fetchFn, apiKey: jevKey }); }
      catch { return null; }
    },
    async suggestMapping(args) {
      if (!geminiKey) return null;
      try { return await suggestMappingsWithGemini({ ...args, fetchFn, apiKey: geminiKey }); }
      catch { return null; }
    },
  };
}
