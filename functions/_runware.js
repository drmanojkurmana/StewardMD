/* _runware.js — Runware transport shared by every AI path that used Google directly (owner, 2026-11-14:
 * Vertex credits exhausted, Runware credits available). Same Gemini models, Runware AIR ids.
 *
 * Two Runware surfaces (shapes checked against the live API, 2026-11-14):
 *  - TEXT + IMAGE: OpenAI-compatible Chat Completions (https://api.runware.ai/v1/chat/completions),
 *    streaming as OpenAI SSE. Images ride as image_url parts (data URI). Default model GPT-6 Luna
 *    (openai:gpt@6-luna, $0.10 in / $0.50 out per 1M tokens): the cheapest strong model on Runware
 *    (owner: cheapest model). It is "compatible-only": the native API rejects it.
 *  - AUDIO / PDF: Runware's native task API (POST https://api.runware.ai/v1, taskType "textInference",
 *    inputs.audios / inputs.documents as raw base64). Luna cannot hear audio, so these go to Gemini 3.1
 *    Flash Lite ($0.25 / $1.50), the cheapest model the native API accepts with audio.
 *    Runware has no Gemini 2.x and no native Gemini 3.5 Flash Lite / 3.6 Flash, so the callers' Google
 *    model names are not mapped; only an explicit AIR id ("vendor:name@ver") from a caller is used.
 * Replies are returned in Gemini's shape so callers keep one parser. Key: RUNWARE_API_KEY (Cloudflare
 * secret, never in the repo). Nothing here logs content. */

export const RUNWARE_CHAT_URL = "https://api.runware.ai/v1/chat/completions";
export const RUNWARE_TASK_URL = "https://api.runware.ai/v1";

export function runwareKey(env) { return String((env && env.RUNWARE_API_KEY) || "").trim(); }
export function runwareAvailable(env) { return !!runwareKey(env); }

export const RUNWARE_DEFAULT_MODEL = "openai:gpt@6-luna";
export const RUNWARE_DEFAULT_NATIVE_MODEL = "google:gemini@3.1-flash-lite";
function isAir(m) { return m.indexOf(":") > 0 && m.indexOf("@") > 0; }
/* Text/image calls: RUNWARE_MODEL, else the caller's AIR id, else GPT-6 Luna. Audio/PDF calls (native):
 * RUNWARE_NATIVE_MODEL, else Gemini 3.1 Flash Lite. A Google model name (gemini-2.5-flash) is ignored. */
export function runwareModel(env, model, native) {
  const pin = String((env && env[native ? "RUNWARE_NATIVE_MODEL" : "RUNWARE_MODEL"]) || "").trim();
  if (pin) return pin;
  const m = String(model || "");
  if (!native && isAir(m)) return m;
  return native ? RUNWARE_DEFAULT_NATIVE_MODEL : RUNWARE_DEFAULT_MODEL;
}
/* reasoning_effort for Chat Completions: "none" by default (hidden reasoning is billed as output and
 * eats max_completion_tokens; Luna and Gemini both accept "none"). RUNWARE_REASONING overrides; "off"
 * omits the field for a pinned model that rejects it. */
function reasoningEffort(env) {
  const r = String((env && env.RUNWARE_REASONING) || "").trim().toLowerCase();
  return r === "off" ? "" : (r || "none");
}

function partMedia(p) {
  const inl = p && (p.inline_data || p.inlineData);
  if (!inl) return null;
  return { mime: String(inl.mime_type || inl.mimeType || ""), data: String(inl.data || "") };
}
export function hasMedia(parts) { return (parts || []).some(function (p) { return !!partMedia(p); }); }
/* Audio or a document (PDF): only the native task API takes these. Images do not need it. */
export function needsNative(parts) {
  return (parts || []).some(function (p) { const m = partMedia(p); return !!m && m.mime.indexOf("image/") !== 0; });
}

/* Chat Completions body from Gemini-style inputs. Text parts, plus images as image_url parts. */
export function chatBody(model, parts, o) {
  const text = [], images = [];
  for (const p of (parts || [])) {
    if (p && typeof p.text === "string") { text.push(p.text); continue; }
    const m = partMedia(p);
    if (m && m.mime.indexOf("image/") === 0) images.push("data:" + m.mime + ";base64," + m.data);
  }
  const messages = [];
  if (o.system) messages.push({ role: "system", content: String(o.system) });
  const t = text.join("\n\n");
  messages.push({ role: "user", content: images.length
    ? [{ type: "text", text: t || "." }].concat(images.map(function (u) { return { type: "image_url", image_url: { url: u } }; }))
    : t });
  // max_completion_tokens: OpenAI models reject max_tokens; Gemini accepts both (live-checked).
  const b = { model: model, messages: messages, temperature: typeof o.temperature === "number" ? o.temperature : 0.2, max_completion_tokens: o.maxTokens || 1024 };
  if (o.reasoning) b.reasoning_effort = o.reasoning;
  if (o.json) b.response_format = { type: "json_object" };
  if (o.stream) { b.stream = true; b.stream_options = { include_usage: true }; }
  return b;
}

/* Native textInference task from Gemini-style inputs: text parts -> the user message, media parts ->
 * inputs.images (data URI) / inputs.audios / inputs.documents (base64). thinkingLevel "minimal": the
 * Google paths send thinkingBudget 0 for the same reason (hidden thinking eats the output budget). */
export function nativeTask(model, parts, o, uuid) {
  const text = [], images = [], audios = [], videos = [], docs = [];
  for (const p of (parts || [])) {
    if (p && typeof p.text === "string") { text.push(p.text); continue; }
    const m = partMedia(p);
    if (!m) continue;
    if (m.mime.indexOf("image/") === 0) images.push("data:" + m.mime + ";base64," + m.data);
    // WebM (Android WebView dictation) is sniffed as video/webm and refused in inputs.audios; as a
    // video Gemini transcribes its audio track at the same token cost (live-checked 2026-11-14).
    else if (m.mime.indexOf("webm") >= 0) videos.push(m.data);
    else if (m.mime.indexOf("audio/") === 0) audios.push(m.data);
    else docs.push(m.data);
  }
  const t = { taskType: "textInference", taskUUID: uuid, model: model, messages: [{ role: "user", content: text.join("\n\n") || "." }],
              settings: { temperature: typeof o.temperature === "number" ? o.temperature : 0.2, maxTokens: o.maxTokens || 1024, thinkingLevel: "minimal" },
              includeUsage: true };
  if (o.system) t.settings.systemPrompt = String(o.system);
  if (o.json) t.outputFormat = "JSON";
  const inputs = {};
  if (images.length) inputs.images = images;
  if (audios.length) inputs.audios = audios;
  if (videos.length) inputs.videos = videos;
  if (docs.length) inputs.documents = docs;
  if (Object.keys(inputs).length) t.inputs = inputs;
  return t;
}

const FINISH = { stop: "STOP", length: "MAX_TOKENS", content_filter: "SAFETY", tool_calls: "STOP", unknown: "" };
function finish(r) { return Object.prototype.hasOwnProperty.call(FINISH, r) ? FINISH[r] : String(r || "").toUpperCase(); }
function errOf(data) {
  if (!data || typeof data !== "object") return null;
  if (data.error) return { error: { message: String(data.error.message || data.error.code || data.error) } };
  if (Array.isArray(data.errors) && data.errors.length) { const e = data.errors[0] || {}; return { error: { message: String(e.message || e.code || "runware error") } }; }
  return null;
}
export function usageFromOpenAI(u) {
  if (!u) return null;
  return { promptTokenCount: u.prompt_tokens || 0, candidatesTokenCount: u.completion_tokens || 0,
           thoughtsTokenCount: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0,
           totalTokenCount: u.total_tokens || 0,
           cachedContentTokenCount: (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0 };
}
function usageFromNative(u) {
  if (!u) return null;
  return { promptTokenCount: u.promptTokens || 0, candidatesTokenCount: u.completionTokens || 0,
           thoughtsTokenCount: u.thinkingTokens || 0, totalTokenCount: u.totalTokens || 0 };
}
function gem(text, fr, usage) { return { candidates: [{ content: { parts: [{ text: text }] }, finishReason: fr }], usageMetadata: usage }; }

/* Chat Completions reply -> Gemini reply. */
export function runwareToGemini(data) {
  const e = errOf(data); if (e) return e;
  if (!data || typeof data !== "object") return data;
  const ch = data.choices && data.choices[0];
  if (!ch) return { candidates: [], usageMetadata: usageFromOpenAI(data.usage) };
  const msg = ch.message || {};
  const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map(function (x) { return (x && x.text) || ""; }).join("") : "";
  return gem(text, finish(ch.finish_reason), usageFromOpenAI(data.usage));
}
/* Native task reply ({ data: [ { text, finishReason, usage } ] }, or a bare array) -> Gemini reply. */
export function nativeToGemini(data) {
  const e = errOf(data); if (e) return e;
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
  const r = arr.find(function (x) { return x && x.taskType === "textInference"; }) || arr[0];
  if (!r) return { candidates: [] };
  return gem(String(r.text || ""), finish(r.finishReason), usageFromNative(r.usage));
}

function uuid() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
}

/* One call, either surface. o: { model, system, temperature, maxTokens, json, timeoutMs, signal }.
 * Returns { status, data } with data already in Gemini's shape. Throws only on network/abort. */
export async function runwareGenerate(env, parts, o, fetchImpl) {
  const f = fetchImpl || fetch;
  const media = needsNative(parts);
  const model = runwareModel(env, o.model, media);
  const url = media ? RUNWARE_TASK_URL : RUNWARE_CHAT_URL;
  const body = media ? [nativeTask(model, parts, o, uuid())] : chatBody(model, parts, Object.assign({}, o, { reasoning: reasoningEffort(env) }));
  let ctl = null, tm = null;
  if (!o.signal && o.timeoutMs) { ctl = new AbortController(); tm = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, o.timeoutMs); }
  try {
    const r = await f(url, { method: "POST", headers: { "Authorization": "Bearer " + runwareKey(env), "Content-Type": "application/json" },
                             body: JSON.stringify(body), signal: o.signal || (ctl && ctl.signal) });
    let data = null; try { data = await r.json(); } catch (e) { data = null; }
    return { status: r.status, data: media ? nativeToGemini(data) : runwareToGemini(data), model: model };
  } catch (e) {
    if (e && e.name === "AbortError") { const t = new Error("runware timeout"); t.timeout = true; throw t; }
    throw e;
  } finally { if (tm) clearTimeout(tm); }
}

/* Streaming (text and image): the raw upstream Response, OpenAI SSE. functions/_sse_parse.js reads it. */
export function runwareStreamFetch(env, parts, o) {
  return fetch(RUNWARE_CHAT_URL, { method: "POST", headers: { "Authorization": "Bearer " + runwareKey(env), "Content-Type": "application/json" },
    body: JSON.stringify(chatBody(runwareModel(env, o.model, false), parts, Object.assign({}, o, { stream: true, reasoning: reasoningEffort(env) }))), signal: o.signal });
}
