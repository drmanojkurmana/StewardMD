/* _runware.js — Runware transport shared by every AI path that used Google directly (owner, 2026-11-14:
 * Vertex credits exhausted, Runware credits available). Same Gemini models, Runware AIR ids.
 *
 * Two Runware surfaces:
 *  - TEXT: OpenAI-compatible Chat Completions (https://api.runware.ai/v1/chat/completions), streaming as
 *    OpenAI SSE. Documented with examples.
 *  - MEDIA (image / audio / pdf): Runware's native task API (POST https://api.runware.ai/v1, taskType
 *    "textInference"), whose model schema documents inputs.images / inputs.audios / inputs.documents.
 *    Chat Completions does not document media parts, so media never goes there.
 * Replies are returned in Gemini's shape so callers keep one parser. Key: RUNWARE_API_KEY (Cloudflare
 * secret, never in the repo). Nothing here logs content. */

export const RUNWARE_CHAT_URL = "https://api.runware.ai/v1/chat/completions";
export const RUNWARE_TASK_URL = "https://api.runware.ai/v1";

export function runwareKey(env) { return String((env && env.RUNWARE_API_KEY) || "").trim(); }
export function runwareAvailable(env) { return !!runwareKey(env); }

/* gemini-3.1-flash-lite -> google:gemini@3.1-flash-lite. RUNWARE_MODEL pins one AIR id for every call;
 * an id that already looks like an AIR id (has ":" and "@") is passed through. */
export function runwareModel(env, model) {
  const pin = String((env && env.RUNWARE_MODEL) || "").trim();
  if (pin) return pin;
  const m = String(model || "");
  if (m.indexOf(":") > 0 && m.indexOf("@") > 0) return m;
  const g = /^gemini-(.+)$/.exec(m);
  return g ? "google:gemini@" + g[1] : m;
}

function partMedia(p) {
  const inl = p && (p.inline_data || p.inlineData);
  if (!inl) return null;
  return { mime: String(inl.mime_type || inl.mimeType || ""), data: String(inl.data || "") };
}
export function hasMedia(parts) { return (parts || []).some(function (p) { return !!partMedia(p); }); }

/* Chat Completions body from Gemini-style inputs. Text parts only. */
export function chatBody(model, parts, o) {
  const text = (parts || []).map(function (p) { return (p && typeof p.text === "string") ? p.text : ""; }).join("\n\n");
  const messages = [];
  if (o.system) messages.push({ role: "system", content: String(o.system) });
  messages.push({ role: "user", content: text });
  const b = { model: model, messages: messages, temperature: typeof o.temperature === "number" ? o.temperature : 0.2, max_tokens: o.maxTokens || 1024 };
  if (o.json) b.response_format = { type: "json_object" };
  if (o.stream) { b.stream = true; b.stream_options = { include_usage: true }; }
  return b;
}

/* Native textInference task from Gemini-style inputs: text parts -> the user message, media parts ->
 * inputs.images (data URI) / inputs.audios / inputs.documents (base64). thinkingLevel "minimal": the
 * Google paths send thinkingBudget 0 for the same reason (hidden thinking eats the output budget). */
export function nativeTask(model, parts, o, uuid) {
  const text = [], images = [], audios = [], docs = [];
  for (const p of (parts || [])) {
    if (p && typeof p.text === "string") { text.push(p.text); continue; }
    const m = partMedia(p);
    if (!m) continue;
    if (m.mime.indexOf("image/") === 0) images.push("data:" + m.mime + ";base64," + m.data);
    else if (m.mime.indexOf("audio/") === 0 || m.mime.indexOf("video/webm") === 0) audios.push(m.data);
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
  const model = runwareModel(env, o.model);
  const media = hasMedia(parts);
  const url = media ? RUNWARE_TASK_URL : RUNWARE_CHAT_URL;
  const body = media ? [nativeTask(model, parts, o, uuid())] : chatBody(model, parts, o);
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

/* Streaming (text only): the raw upstream Response, OpenAI SSE. functions/_sse_parse.js reads it. */
export function runwareStreamFetch(env, parts, o) {
  return fetch(RUNWARE_CHAT_URL, { method: "POST", headers: { "Authorization": "Bearer " + runwareKey(env), "Content-Type": "application/json" },
    body: JSON.stringify(chatBody(runwareModel(env, o.model), parts, Object.assign({}, o, { stream: true }))), signal: o.signal });
}
