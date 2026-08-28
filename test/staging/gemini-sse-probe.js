/* test/staging/gemini-sse-probe.js — ISOLATED Cloudflare Worker probe for the zero-byte SSE fault.
 *
 * NOT part of the app. Deploy to a SEPARATE staging Worker (never the Pages project) and hit it once:
 *
 *   wrangler dev  test/staging/gemini-sse-probe.js --var GEMINI_MODEL:gemini-2.5-flash
 *   # then: curl "http://localhost:8787/?mode=stream"   /   "?mode=json"   /   "?mode=both"
 *
 * Needs ONE secret: GEMINI_API_KEY. It sends a fixed, non-clinical prompt and logs NO PHI - the only
 * content it ever echoes is its own literal question and byte counts.
 *
 * WHAT IT ANSWERS (the things production could not tell us):
 *   • raw upstream status, statusText, and ALL response headers
 *   • content-type, transfer-encoding, content-length
 *   • time to first BYTE off the upstream body (not time to first parsed token)
 *   • total body byte count, chunk count, and the first bytes seen verbatim
 *   • the full read lifecycle:每 read() -> {done, byteLength} with timestamps
 *   • generateContent vs streamGenerateContent from the SAME runtime, same key, same model
 *
 * The production symptom to reproduce: streamGenerateContent?alt=sse returns 200 and then yields ZERO
 * bytes - not even our own {"done":true} - meaning the ReadableStream produced nothing at all.
 */

const DEV_HOST = "https://generativelanguage.googleapis.com/v1beta/models";
const PROMPT = "List three colours as a numbered list."; // deliberately trivial + non-clinical

function body(maxTokens) {
  return {
    contents: [{ role: "user", parts: [{ text: PROMPT }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens || 256, thinkingConfig: { thinkingBudget: 0 } }
  };
}

async function probeStream(env, model) {
  const t0 = Date.now();
  const url = `${DEV_HOST}/${model}:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
  const tHeaders = Date.now() - t0;
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = k.toLowerCase().includes("key") ? "<redacted>" : v; });

  const out = {
    mode: "streamGenerateContent?alt=sse",
    status: r.status, statusText: r.statusText, ok: r.ok,
    msToHeaders: tHeaders, hasBody: !!r.body, headers,
    reads: [], totalBytes: 0, chunks: 0, msToFirstByte: null, firstBytes: "", parsedDeltas: 0
  };
  if (!r.body) { out.note = "no body on the upstream response"; return out; }

  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", first = true;
  for (;;) {
    const t = Date.now();
    let res;
    try { res = await reader.read(); }
    catch (e) { out.reads.push({ at: Date.now() - t0, error: String(e && e.message).slice(0, 120) }); break; }
    out.reads.push({ at: Date.now() - t0, waitedMs: Date.now() - t, done: res.done, bytes: res.value ? res.value.byteLength : 0 });
    if (res.done) break;
    out.chunks++; out.totalBytes += res.value.byteLength;
    if (first && res.value.byteLength) { out.msToFirstByte = Date.now() - t0; first = false; }
    const s = dec.decode(res.value, { stream: true });
    if (out.firstBytes.length < 400) out.firstBytes += s.slice(0, 400 - out.firstBytes.length);
    buf += s;
    const blocks = buf.split("\n\n"); buf = blocks.pop();
    for (const b of blocks) {
      const d = b.split("\n").filter((l) => l.indexOf("data:") === 0).map((l) => l.slice(5).trim()).join("");
      if (!d || d === "[DONE]") continue;
      try { const j = JSON.parse(d); const c = j.candidates && j.candidates[0]; if (c && c.content && c.content.parts) out.parsedDeltas++; } catch (e) {}
    }
    if (out.reads.length > 400) { out.note = "read cap hit"; break; }
  }
  out.msTotal = Date.now() - t0;
  return out;
}

async function probeJson(env, model) {
  const t0 = Date.now();
  const url = `${DEV_HOST}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
  const tHeaders = Date.now() - t0;
  const text = await r.text();
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  let usage = null;
  try { usage = JSON.parse(text).usageMetadata || null; } catch (e) {}
  return {
    mode: "generateContent", status: r.status, ok: r.ok, msToHeaders: tHeaders, msTotal: Date.now() - t0,
    bytes: text.length, headers, usage, firstBytes: text.slice(0, 200)
  };
}

export default {
  async fetch(request, env) {
    if (!env || !env.GEMINI_API_KEY) return new Response("set GEMINI_API_KEY on this staging worker", { status: 500 });
    const u = new URL(request.url);
    const mode = u.searchParams.get("mode") || "both";
    const model = u.searchParams.get("model") || env.GEMINI_MODEL || "gemini-2.5-flash";
    const out = { model, at: new Date().toISOString() };
    try {
      if (mode === "stream" || mode === "both") out.stream = await probeStream(env, model);
      if (mode === "json" || mode === "both") out.json = await probeJson(env, model);
    } catch (e) {
      out.error = String((e && e.message) || e).slice(0, 300);
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
  }
};
