// VoiceCall Durable Object: holds one Plivo Audio-Streaming WebSocket for a call and runs the whole
// conversation loop on Cloudflare's edge (STT -> brain -> TTS), replacing the RunPod Python service.
import { decodeFrame, encodeFrame, rms } from "./codec.js";
import { sarvamSTT, sarvamTTS } from "./sarvam.js";
import { Brain, greetingText } from "./brain.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const PAGES_BASE = "https://stewardmd.pages.dev/api/followcare";
const LC = { te: "te-IN", en: "en-IN", hi: "hi-IN", ta: "ta-IN", kn: "kn-IN", ml: "ml-IN",
  mr: "mr-IN", gu: "gu-IN", bn: "bn-IN", pa: "pa-IN", od: "od-IN" };

function cfgFrom(env) {
  return {
    sarvamKey: env.SARVAM_API_KEY,
    sarvamTtsModel: env.SARVAM_TTS_MODEL || "bulbul:v2",
    sarvamSpeaker: env.SARVAM_SPEAKER || "",
    sarvamSttModel: env.SARVAM_STT_MODEL || "saarika:v2.5",
    sarvamPace: env.SARVAM_PACE || "0.9",
    sarvamLoudness: env.SARVAM_LOUDNESS || "1.3",
    agentName: env.VOICE_AGENT_NAME || "Maithri",
    convoFallback: env.VOICE_CONVO_FALLBACK || "క్షమించండి, దయచేసి మళ్ళీ చెప్పగలరా?",
    energyThreshold: +(env.VOICE_ENERGY_THRESHOLD || 350),
    silenceMs: +(env.VOICE_SILENCE_MS || 500),
    turnTimeoutMs: +(env.VOICE_CONVO_TURN_TIMEOUT || 12) * 1000,
    maxUtteranceMs: +(env.VOICE_MAX_UTTERANCE_MS || 15000),
    maxSilenceNudges: +(env.VOICE_MAX_SILENCE_NUDGES || 2),
    maxConvoTurns: +(env.VOICE_MAX_CONVO_TURNS || 18),
    convoMaxMs: +(env.VOICE_CONVO_MAX_SECONDS || 300) * 1000,
    fmt: env.VOICE_AUDIO_FORMAT || "mulaw",
    voiceToken: env.FOLLOWCARE_VOICE_SERVICE_TOKEN || "",
    geminiKey: env.GEMINI_API_KEY || "",
    geminiModel: env.VOICE_GEMINI_MODEL || "gemini-flash-latest",
    sarvamLlm: env.SARVAM_LLM || "sarvam-105b",          // India-hosted LLM (fast, consistent) for the brain
    vadSilenceMs: +(env.VOICE_VAD_SILENCE_MS || 300),   // Sarvam realtime end-of-turn silence (lower = snappier)
    bargeIn: env.VOICE_BARGE_IN === "1",                 // opt-in: let the patient interrupt the bot mid-sentence
    langAuto: env.VOICE_LANG_AUTO === "1",               // opt-in: detect the caller's language instead of call.lang
  };
}

function concatPcm(frames) {
  let len = 0;
  for (const f of frames) len += f.length;
  const out = new Int16Array(len);
  let o = 0;
  for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
}

export class VoiceCall {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.cfg = cfgFrom(env);
    this.call = null;
    this.greetPcm = null;
    this.ws = null;
    this.log = [];   // dialogue for /debug
  }

  // Brain LLM — Sarvam's India-hosted LLM (fast + consistent, same region as STT/TTS). Falls back to Vertex
  // (via Pages /voice/nlu) if Sarvam is unavailable.
  async modelCall(prompt) {
    try {
      const r = await fetch("https://api.sarvam.ai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", "api-subscription-key": this.cfg.sarvamKey },
        body: JSON.stringify({ model: this.cfg.sarvamLlm, temperature: 0.3, max_tokens: 400, reasoning_effort: null,
          messages: [{ role: "user", content: prompt }] }) });
      const j = await r.json();
      const t = j?.choices?.[0]?.message?.content;
      if (t) return t;
    } catch { /* fall through */ }
    try {
      const r = await fetch(PAGES_BASE + "/voice/nlu", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Voice-Token": this.cfg.voiceToken },
        body: JSON.stringify({ prompt, maxTokens: 400 }) });
      const j = await r.json();
      return (j && j.text) || "";
    } catch { return ""; }
  }

  // Post call telemetry/result back to the FollowCare Pages API (edge fetch, not datacenter-IP-blocked).
  async pages(path, body) {
    try {
      await fetch(PAGES_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Voice-Token": this.cfg.voiceToken },
        body: JSON.stringify(body),
      });
    } catch { /* best-effort telemetry */ }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/prepare")) {
      const body = await request.json();
      this.call = body.call || {};
      const lang = this.call.lang || "te";
      this.greetPcm = await this.ttsCached(greetingText(lang), lang); // pre-synth (KV-cached) for instant greeting
      return new Response(JSON.stringify({ ok: true, greetBytes: this.greetPcm.length }),
        { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/debug")) {
      return new Response(JSON.stringify({ call: this.call?.callId, log: this.log, facts: this._facts || {} }),
        { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/timing")) {   // measure this DO's round-trips to Sarvam + Gemini
      const out = {};
      let t = Date.now();
      try {
        const r = await fetch("https://api.sarvam.ai/speech-to-text-realtime/ws?model=saaras:v3-realtime&encoding=mulaw&sample_rate=8000&endpointing=vad&language_code=te-IN",
          { headers: { Upgrade: "websocket", "api-subscription-key": this.cfg.sarvamKey } });
        const w = r.webSocket; w.accept();
        await new Promise((res) => { w.addEventListener("message", () => res()); setTimeout(res, 5000); });
        out.stt_connect_ms = Date.now() - t; try { w.close(); } catch {}
      } catch (e) { out.stt_err = String(e); }
      t = Date.now();
      try { await this.modelCall('reply STRICT JSON {"reply":"hi"}'); out.gemini_tiny_ms = Date.now() - t; } catch (e) { out.gemini_err = String(e); }
      t = Date.now();
      try { const b = new Brain({ lang: "te", disease: "Heart Failure", dayOffset: 3 }, this.cfg); b.turns.push(["YOU", "hi"], ["PATIENT", "బానే ఉంది"]); await b.step(null, (p) => this.modelCall(p)); out.gemini_real_ms = Date.now() - t; } catch (e) { out.gemini_real_err = String(e); }
      t = Date.now();
      try {
        const r = await fetch("https://api.sarvam.ai/v1/chat/completions", { method: "POST",
          headers: { "Content-Type": "application/json", "api-subscription-key": this.cfg.sarvamKey },
          body: JSON.stringify({ model: "sarvam-m", messages: [{ role: "user", content: 'reply STRICT JSON {"reply":"hi"}' }], max_tokens: 100 }) });
        const j = await r.json(); out.sarvamm_ms = Date.now() - t; out.sarvamm_ok = !!(j.choices && j.choices.length); out.sarvamm_body = j.choices ? "" : JSON.stringify(j).slice(0, 120);
      } catch (e) { out.sarvamm_err = String(e); }
      for (const mdl of ["gemini-flash-lite-latest", "gemini-2.0-flash"]) {
        t = Date.now();
        try {
          const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + mdl + ":generateContent?key=" + this.cfg.geminiKey,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: 'reply STRICT JSON {"reply":"hi"}' }] }], generationConfig: { response_mime_type: "application/json", thinkingConfig: { thinkingBudget: 0 } } }) });
          const j = await r.json(); out[mdl] = r.status === 200 ? (Date.now() - t) : ("err" + r.status);
        } catch (e) { out[mdl] = "ex"; }
      }
      t = Date.now();
      try { const pcm = await sarvamTTS(this.cfg, "మంచిదండి, మీ బరువు ఏమైనా పెరిగిందా అండి?", "te"); out.batch_tts_ms = Date.now() - t; out.batch_tts_bytes = pcm.length; } catch (e) { out.batch_tts_err = String(e); }
      t = Date.now();
      try {
        const r = await fetch(PAGES_BASE + "/voice/nlu", { method: "POST",
          headers: { "Content-Type": "application/json", "X-Voice-Token": this.cfg.voiceToken },
          body: JSON.stringify({ prompt: 'reply STRICT JSON {"reply":"hi"}' }) });
        const j = await r.json(); out.nlu_ms = Date.now() - t; out.nlu_ok = j.ok; out.nlu_len = (j.text || "").length;
      } catch (e) { out.nlu_err = String(e); }
      t = Date.now();
      try {
        const r = await fetch("https://api.sarvam.ai/text-to-speech/ws?model=bulbul:v2&send_completion_event=true",
          { headers: { Upgrade: "websocket", "api-subscription-key": this.cfg.sarvamKey } });
        const w = r.webSocket; w.accept();
        const done = new Promise((res) => { w.addEventListener("message", (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.type === "audio") res(); }); setTimeout(res, 6000); });
        w.send(JSON.stringify({ type: "config", data: { language_code: "te-IN", speaker: "anushka", model: "bulbul:v2", speech_sample_rate: "8000", output_audio_codec: "mulaw" } }));
        w.send(JSON.stringify({ type: "text", data: { text: "నమస్కారం" } }));
        w.send(JSON.stringify({ type: "flush" }));
        await done; out.tts_firstaudio_ms = Date.now() - t; try { w.close(); } catch {}
      } catch (e) { out.tts_err = String(e); }
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    }
    if (request.headers.get("Upgrade") === "websocket") {
      if (!this.call) {   // first WS access (near India) creates the DO here; load the payload from KV
        try {
          const callId = url.pathname.split("/").pop();
          const raw = await this.env.VOICE_KV.get("call:" + callId);
          if (raw) this.call = JSON.parse(raw);
        } catch { /* the loop still runs with defaults */ }
      }
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      this._run(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("voicecall", { status: 200 });
  }

  _send(obj) {
    try { this.ws.send(JSON.stringify(obj)); if (this._trace) this._trace.sent = (this._trace.sent || 0) + 1; }
    catch (e) { if (this._trace) { this._trace.sendErr = (this._trace.sendErr || 0) + 1; if (this._trace.errors.length < 3) this._trace.errors.push("send:" + String(e).slice(0, 100)); } }
  }

  // TTS with a cross-call KV cache keyed by lang+text. The greeting (same every call) and any repeated fixed
  // phrase become a KV read instead of a Sarvam TTS call - cheaper and instant. Unique LLM replies bypass it.
  async ttsCached(text, lang) {
    if (!text) return new Int16Array(0);
    const key = "tts:" + lang + ":" + shash(text);
    try { const b = await this.env.VOICE_KV.get(key, "arrayBuffer"); if (b && b.byteLength) return new Int16Array(b); } catch {}
    const pcm = await sarvamTTS(this.cfg, text, lang);
    try { if (pcm && pcm.length) await this.env.VOICE_KV.put(key, pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength), { expirationTtl: 2592000 }); } catch {}
    return pcm;
  }

  async _play(pcm) {
    if (!pcm || !pcm.length) return;
    if (this._trace) this._trace.playFrames += Math.ceil(pcm.length / 160);
    const ct = this.cfg.fmt === "mulaw" ? "audio/x-mulaw" : "audio/x-l16";
    for (let i = 0; i < pcm.length; i += 160) {          // 160 samples = 20ms @ 8k
      if (this._abort) break;                            // barge-in: patient started speaking, stop playback
      this._send({ event: "playAudio", media: { contentType: ct, sampleRate: "8000",
        payload: encodeFrame(pcm.subarray(i, i + 160), this.cfg.fmt) } });
      await sleep(20);                                    // pace ~ real time so we know when playback ends
    }
  }

  // Streaming TTS: forward Sarvam's mu-law audio chunks to Plivo AS they generate, so the agent starts
  // speaking ~0.3s after the reply is decided instead of waiting for the whole clip. Falls back to batch.
  async streamTts(text, lang) {
    if (!text) return;
    let ws2 = null, totalBytes = 0, startPlay = 0;
    try {
      const u = "https://api.sarvam.ai/text-to-speech/ws?model=" + this.cfg.sarvamTtsModel + "&send_completion_event=true";
      const resp = await fetch(u, { headers: { Upgrade: "websocket", "api-subscription-key": this.cfg.sarvamKey } });
      ws2 = resp.webSocket;
      if (!ws2) return this._play(await sarvamTTS(this.cfg, text, lang));
      ws2.accept();
      const done = new Promise((resolve) => {
        ws2.addEventListener("message", (e) => {
          let m; try { m = JSON.parse(e.data); } catch { return; }
          if (m.type === "audio" && m.data?.audio) {
            if (!startPlay) startPlay = Date.now();
            totalBytes += Math.floor(m.data.audio.length * 3 / 4);   // base64 -> raw mu-law bytes (8000/s)
            this._send({ event: "playAudio", media: { contentType: "audio/x-mulaw", sampleRate: "8000", payload: m.data.audio } });
          } else if (m.type === "event" && m.data?.event_type === "final") resolve();
        });
        ws2.addEventListener("close", () => resolve());
        ws2.addEventListener("error", () => resolve());
        setTimeout(resolve, 15000);
      });
      ws2.send(JSON.stringify({ type: "config", data: {
        language_code: LC[lang] || "te-IN", speaker: this.cfg.sarvamSpeaker || "anushka",
        model: this.cfg.sarvamTtsModel, speech_sample_rate: "8000", output_audio_codec: "mulaw",
        pace: Number(this.cfg.sarvamPace), loudness: Number(this.cfg.sarvamLoudness) } }));
      ws2.send(JSON.stringify({ type: "text", data: { text } }));
      ws2.send(JSON.stringify({ type: "flush" }));
      await done;
      // Let the buffered audio finish playing before we listen again (avoid hearing our own voice).
      const remainMs = (totalBytes / 8000) * 1000 - (startPlay ? Date.now() - startPlay : 0);
      if (remainMs > 0) await sleep(remainMs);
    } catch {
      try { await this._play(await sarvamTTS(this.cfg, text, lang)); } catch {}
    } finally {
      try { ws2 && ws2.close(); } catch {}
    }
  }

  _run(ws) {
    this.ws = ws;
    const cfg = this.cfg, lang = (this.call && this.call.lang) || "te";
    const autoLang = cfg.langAuto || lang === "auto";   // per-call: language "auto" -> auto STT + LLM switch (Option B); a specific language -> clean fixed STT (Option A)
    const brain = new Brain(this.call || { lang }, cfg);
    this._facts = brain.facts;
    const started = Date.now();
    const trace = { wsOpen: new Date().toISOString(), events: {}, greetBytes: 0, playFrames: 0, errors: [] };
    this._trace = trace;
    const saveTrace = () => { try { return this.env.VOICE_KV.put("trace:" + (this.call?.callId || "x"), JSON.stringify(trace), { expirationTtl: 1800 }); } catch {} };
    let mode = "await_start";   // await_start | speaking | listening | processing | done
    let turns = 0, nudges = 0, emergency = false, alerted = false, sttWs = null, idleTimer = null, bargeText = null, greeted = false, sttLang = null;
    this._abort = false;

    const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };
    const armIdle = () => { clearIdle(); idleTimer = setTimeout(() => { if (mode === "listening") noSpeech(); }, cfg.turnTimeoutMs); };

    // Real-time red-flag escalation: the instant an emergency is confirmed, page the on-call doctor (server sends
    // WhatsApp/SMS) - do NOT wait for the call to end. Fire-and-forget, once per call.
    const escalate = () => {
      if (!emergency || alerted) return;
      alerted = true;
      this.pages("/voice/alert", { episodeId: this.call?.episodeId, callId: this.call?.callId,
        phone: this.call?.phone, firstName: this.call?.firstName, disease: this.call?.disease,
        reason: "red flag confirmed during FollowCare voice call", transcript: this.log.slice(-8) });
    };

    const finalize = async (status) => {
      if (mode === "done") return;
      mode = "done"; clearIdle();
      trace.status = status; try { await saveTrace(); } catch {}
      try { sttWs && sttWs.close(); } catch {}
      try { await this.env.VOICE_KV.put("log:" + (this.call?.callId || "x"), JSON.stringify(this.log), { expirationTtl: 1800 }); } catch {}
      await this.pages("/voice/result", { episodeId: this.call?.episodeId, callId: this.call?.callId,
        answers: brain.facts, status: status || "completed", durationMs: Date.now() - started,
        ambulanceRequested: false, emergency, patientStatement: brain.doctorNote || "",
        transcript: this.log, conversational: true });
      try { ws.close(); } catch {}
    };

    const say = async (turn) => {
      this.log.push(["YOU", turn.reply]);
      emergency = emergency || turn.emergency; escalate();
      await this._play(await sarvamTTS(cfg, turn.reply, brain.lang));   // TTS in the CURRENT language (may switch to match the patient)
    };

    // A finished patient utterance (from Sarvam VAD) -> brain -> speak.
    const handleTurn = async (text) => {
      if (mode !== "listening") return;
      mode = "processing"; clearIdle();
      const t0 = Date.now();
      this.log.push(["PATIENT", text]);
      const turn = await brain.step(text || "(unclear)", (p) => this.modelCall(p));
      const tLlm = Date.now() - t0;
      if (!autoLang && brain.lang !== sttLang) { try { sttWs && sttWs.close(); } catch {} sttWs = null; await openStt(); }   // fixed-lang mode only; with auto STT there is no reopen (it already hears every language)
      mode = "speaking";
      const t1 = Date.now();
      const pcm = await sarvamTTS(cfg, turn.reply, brain.lang);
      this.log.push(["TIMING", `llm=${tLlm}ms tts=${Date.now() - t1}ms`]);
      this.log.push(["YOU", turn.reply]);
      emergency = emergency || turn.emergency; escalate();
      await this._play(pcm);
      if (this._abort) { this._abort = false; mode = "listening"; if (bargeText) { const t = bargeText; bargeText = null; return handleTurn(t); } }   // barge-in: act on what they interrupted with
      turns++;
      if (turn.complete || turns >= cfg.maxConvoTurns || Date.now() - started > cfg.convoMaxMs)
        return finalize("completed");
      mode = "listening"; armIdle();
    };

    const noSpeech = async () => {
      if (mode !== "listening") return;
      nudges++;
      if (nudges > cfg.maxSilenceNudges) return finalize(Object.keys(brain.facts).length ? "completed" : "no_answer");
      mode = "speaking"; clearIdle();
      const turn = await brain.step(null, (p) => this.modelCall(p), true);   // nudge: re-ask same topic, do not advance
      await say(turn);
      mode = "listening"; armIdle();
    };

    // Open Sarvam realtime STT — forward Plivo mu-law straight in; its VAD returns final transcripts instantly.
    const openStt = async () => {
      try {
        const u = "https://api.sarvam.ai/speech-to-text-realtime/ws?model=saaras:v3-realtime&encoding=mulaw"
          + "&sample_rate=8000&endpointing=vad&stream_type=fast&silence_duration_ms=" + (this.cfg.vadSilenceMs || 300)
          + "&language_code=" + (autoLang ? "auto" : (LC[brain.lang] || "te-IN"));
        sttLang = brain.lang;
        const resp = await fetch(u, { headers: { Upgrade: "websocket", "API-SUBSCRIPTION-KEY": cfg.sarvamKey } });
        sttWs = resp.webSocket;
        if (!sttWs) return;
        sttWs.accept();
        sttWs.addEventListener("message", (e) => {
          let m; try { m = JSON.parse(e.data); } catch { return; }
          if (m.event === "transcript.final" && (m.text || "").trim()) {
            const txt = m.text.trim();
            if (cfg.bargeIn && greeted && mode === "speaking") { bargeText = txt; this._abort = true; }   // barge-in: interrupt the bot
            else handleTurn(txt);
          }
        });
        sttWs.addEventListener("close", () => { sttWs = null; });
        sttWs.addEventListener("error", () => { sttWs = null; });
      } catch { sttWs = null; }
    };

    const speakFirst = async () => {
      mode = "speaking";
      brain.turns.push(["YOU", greetingText(lang)]);
      this.log.push(["YOU", greetingText(lang)]);
      const firstP = brain.step(null, (p) => this.modelCall(p));   // compute first question...
      const greetP = (this.greetPcm && this.greetPcm.length)       // ...while synthesizing the greeting (in India, fast)
        ? Promise.resolve(this.greetPcm) : this.ttsCached(greetingText(lang), lang).catch(() => null);
      const gp = await greetP;
      trace.greetBytes = (gp && gp.length) || 0; saveTrace();
      if (gp && gp.length) await this._play(gp);
      saveTrace();   // persist playFrames + send counts AFTER the greeting actually played
      const turn = await firstP;
      await say(turn);
      if (turn.complete) return finalize("completed");
      greeted = true; mode = "listening"; armIdle();   // barge-in becomes allowed only after the greeting + first question
    };

    ws.addEventListener("message", async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { trace.events["_nonjson"] = (trace.events["_nonjson"] || 0) + 1; return; }
      const ev = m.event;
      trace.events[ev] = (trace.events[ev] || 0) + 1;
      if (ev !== "media") saveTrace();   // persist on every non-media event so a stuck call still leaves a trail
      if (ev === "start") { if (mode === "await_start") { await openStt(); await speakFirst(); } return; }
      if (ev === "stop" || ev === "closed") return void finalize("completed");
      if (ev !== "media") return;
      // Forward the caller's mu-law audio to Sarvam realtime STT. Normally only while listening; with barge-in on
      // (after the greeting) also while the bot speaks, so an interruption is detected.
      if (sttWs && (mode === "listening" || (cfg.bargeIn && greeted && mode === "speaking"))) { try { sttWs.send(JSON.stringify({ event: "audio_input", audio: m.media?.payload || "" })); } catch {} }
    });

    ws.addEventListener("close", () => finalize("completed"));
    ws.addEventListener("error", () => finalize("completed"));
  }
}
