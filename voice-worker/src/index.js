// stewardmd-voice Worker: telephony + orchestration for FollowCare voice calls. No GPU, no RunPod.
// Plivo -> this Worker -> VoiceCall Durable Object (holds the WS, runs the loop) -> Sarvam + Gemini(via Pages).
import { VoiceCall } from "./voicecall.js";
export { VoiceCall };

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const PAGES_BASE = "https://stewardmd.pages.dev/api/followcare";

// The DO must run NEAR Sarvam + the caller (India) or every STT/TTS/LLM hop crosses an ocean = lag.
const doStub = (env, callId) =>
  env.VOICE.get(env.VOICE.idFromName(callId), { locationHint: env.VOICE_DO_LOCATION || "apac" });

function answerXml(wssUrl, fmt, rate) {
  const ct = fmt === "mulaw" ? `audio/x-mulaw;rate=${rate}` : `audio/x-l16;rate=${rate}`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>`
    + `<Stream bidirectional="true" keepCallAlive="true" contentType="${ct}" audioTrack="inbound" streamTimeout="86400">`
    + `${wssUrl}</Stream></Response>`;
}

async function plivoOriginate(env, to, callId, base) {
  const auth = btoa(`${env.PLIVO_AUTH_ID}:${env.PLIVO_AUTH_TOKEN}`);
  const body = { from: env.PLIVO_FROM, to, answer_url: `${base}/plivo/answer?callId=${callId}`,
    answer_method: "POST", hangup_url: `${base}/plivo/hangup?callId=${callId}` };
  if (env.VOICE_AMD) body.machine_detection = env.VOICE_AMD;   // default OFF (live answers); set to enable AMD
  try {
    const r = await fetch(`https://api.plivo.com/v1/Account/${env.PLIVO_AUTH_ID}/Call/`, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Basic " + auth },
      body: JSON.stringify(body) });
    return [200, 201, 202].includes(r.status);
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.host;
    const base = env.VOICE_PUBLIC_BASE || `https://${host}`;
    const path = url.pathname;
    const fmt = env.VOICE_AUDIO_FORMAT || "mulaw";
    const rate = +(env.VOICE_SAMPLE_RATE || 8000);

    // Plivo hits this when the call is answered -> return the audio-stream XML pointing at the per-call DO.
    if (path === "/plivo/answer") {
      const callId = url.searchParams.get("callId") || "";
      return new Response(answerXml(`wss://${host}/plivo/stream/${callId}`, fmt, rate),
        { headers: { "Content-Type": "application/xml" } });
    }
    // The bidirectional audio WebSocket -> route to the DO instance for this call.
    if (path.startsWith("/plivo/stream/")) {
      const callId = decodeURIComponent(path.split("/").pop() || "");
      return doStub(env, callId).fetch(request);
    }
    if (path === "/plivo/hangup") return json({ ok: true });

    // Originate: pull the queue from Pages (or accept a relayed {call}), prepare the DO, dial. Token-gated.
    if (path === "/voice/originate" && request.method === "POST") {
      if ((request.headers.get("X-Voice-Token") || "") !== (env.FOLLOWCARE_VOICE_SERVICE_TOKEN || ""))
        return json({ error: "unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      let calls = [];
      if (body.call) calls = [body.call];
      else {
        const r = await fetch(PAGES_BASE + "/voice/queue",
          { headers: { "X-Voice-Token": env.FOLLOWCARE_VOICE_SERVICE_TOKEN } });
        calls = (await r.json().catch(() => ({}))).calls || [];
      }
      const out = [];
      for (const call of calls) {
        if (body.lang) call.lang = body.lang;
        if (body.phone) call.phone = body.phone;
        if (!call.callId) call.callId = "call-" + Date.now();
        // Stash the payload in KV and do NOT touch the DO here — the DO is then created near INDIA when Plivo
        // connects the WebSocket (India edge), instead of near this originate call. Fixes trans-ocean lag.
        await env.VOICE_KV.put("call:" + call.callId, JSON.stringify(call), { expirationTtl: 900 });
        if (body.dryDial) { out.push({ callId: call.callId, prepared: true }); continue; }  // offline WS test
        out.push({ callId: call.callId, phone: call.phone, plivo_ok: await plivoOriginate(env, call.phone, call.callId, base) });
      }
      return json({ originated: out });
    }

    // Debug: read a call's dialogue back (token-gated).
    if (path.startsWith("/voice/debug/")) {
      if ((request.headers.get("X-Voice-Token") || "") !== (env.FOLLOWCARE_VOICE_SERVICE_TOKEN || ""))
        return json({ error: "unauthorized" }, 401);
      const callId = decodeURIComponent(path.split("/").pop() || "");
      return doStub(env, callId).fetch("https://do/debug");
    }

    // Diagnostic: can we open an outbound WebSocket from the edge? ?u=echo tests a known echo server.
    if (path === "/test/stt") {
      const which = url.searchParams.get("u");
      const u = which === "echo" ? "https://ws.postman-echo.com/raw"
        : "https://api.sarvam.ai/speech-to-text-realtime/ws?model=saaras:v3-realtime&encoding=mulaw"
        + "&sample_rate=8000&endpointing=vad&language_code=te-IN";
      try {
        const resp = await fetch(u, { headers: { Upgrade: "websocket", "API-SUBSCRIPTION-KEY": env.SARVAM_API_KEY } });
        const w = resp.webSocket;
        if (!w) return json({ ok: false, status: resp.status, webSocket: false, body: (await resp.text()).slice(0, 300) });
        w.accept();
        const msgs = [];
        await new Promise((res) => { w.addEventListener("message", (e) => { msgs.push(String(e.data).slice(0, 200)); res(); }); setTimeout(res, 4000); });
        try { w.close(); } catch {}
        return json({ ok: true, status: resp.status, webSocket: true, msgs });
      } catch (e) { return json({ ok: false, error: String(e) }); }
    }

    // Diagnostic: open Sarvam streaming TTS, send config+text+flush, report the event types that come back.
    if (path === "/test/tts") {
      const u = "https://api.sarvam.ai/text-to-speech/ws?model=" + (env.SARVAM_TTS_MODEL || "bulbul:v2") + "&send_completion_event=true";
      try {
        const resp = await fetch(u, { headers: { Upgrade: "websocket", "api-subscription-key": env.SARVAM_API_KEY } });
        const w = resp.webSocket;
        if (!w) return json({ ok: false, status: resp.status, body: (await resp.text()).slice(0, 300) });
        w.accept();
        const events = [];
        w.addEventListener("message", (e) => {
          let m; try { m = JSON.parse(e.data); } catch { events.push("nonjson"); return; }
          events.push(m.type === "audio" ? "audio:" + ((m.data?.audio || "").length) + "b" : m.type + ":" + JSON.stringify(m.data || {}).slice(0, 90));
        });
        const cfg = { language_code: "te-IN", speaker: env.SARVAM_SPEAKER || "anushka",
          model: env.SARVAM_TTS_MODEL || "bulbul:v2", speech_sample_rate: "8000", output_audio_codec: "mulaw", pace: 0.9 };
        w.send(JSON.stringify({ type: "config", data: cfg }));
        w.send(JSON.stringify({ type: "text", data: { text: "నమస్కారం, మీరు ఎలా ఉన్నారు?" } }));
        w.send(JSON.stringify({ type: "flush" }));
        await new Promise((res) => setTimeout(res, 5000));
        try { w.close(); } catch {}
        return json({ ok: true, events });
      } catch (e) { return json({ ok: false, error: String(e) }); }
    }

    if (path === "/test/timing") return doStub(env, "timing-fixed").fetch("https://do/timing");

    if (path === "/health") return json({ ok: true });
    return new Response("stewardmd-voice", { status: 200 });
  },
};
