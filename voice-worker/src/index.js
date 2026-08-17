// stewardmd-voice Worker: telephony + orchestration for FollowCare voice calls. No GPU, no RunPod.
// Plivo -> this Worker -> VoiceCall Durable Object (holds the WS, runs the loop) -> Sarvam + Gemini(via Pages).
import { VoiceCall } from "./voicecall.js";
export { VoiceCall };

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const PAGES_BASE = "https://stewardmd.pages.dev/api/followcare";

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
      return env.VOICE.get(env.VOICE.idFromName(callId)).fetch(request);
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
        await env.VOICE.get(env.VOICE.idFromName(call.callId)).fetch("https://do/prepare",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ call }) });
        if (body.dryDial) { out.push({ callId: call.callId, prepared: true }); continue; }  // offline WS test - no phone
        out.push({ callId: call.callId, phone: call.phone, plivo_ok: await plivoOriginate(env, call.phone, call.callId, base) });
      }
      return json({ originated: out });
    }

    // Debug: read a call's dialogue back (token-gated).
    if (path.startsWith("/voice/debug/")) {
      if ((request.headers.get("X-Voice-Token") || "") !== (env.FOLLOWCARE_VOICE_SERVICE_TOKEN || ""))
        return json({ error: "unauthorized" }, 401);
      const callId = decodeURIComponent(path.split("/").pop() || "");
      return env.VOICE.get(env.VOICE.idFromName(callId)).fetch("https://do/debug");
    }

    if (path === "/health") return json({ ok: true });
    return new Response("stewardmd-voice", { status: 200 });
  },
};
