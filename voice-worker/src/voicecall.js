// VoiceCall Durable Object: holds one Plivo Audio-Streaming WebSocket for a call and runs the whole
// conversation loop on Cloudflare's edge (STT -> brain -> TTS), replacing the RunPod Python service.
import { decodeFrame, encodeFrame, rms } from "./codec.js";
import { sarvamSTT, sarvamTTS } from "./sarvam.js";
import { Brain, greetingText } from "./brain.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGES_BASE = "https://stewardmd.pages.dev/api/followcare";

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

  // Brain LLM — call Gemini directly (fast, one hop, no Pages reachability needed).
  async modelCall(prompt) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.cfg.geminiModel}:generateContent?key=${this.cfg.geminiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, response_mime_type: "application/json" } }),
      });
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
      this.greetPcm = await sarvamTTS(this.cfg, greetingText(lang), lang); // pre-synth for instant greeting
      return new Response(JSON.stringify({ ok: true, greetBytes: this.greetPcm.length }),
        { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/debug")) {
      return new Response(JSON.stringify({ call: this.call?.callId, log: this.log, facts: this._facts || {} }),
        { headers: { "Content-Type": "application/json" } });
    }
    if (request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      this._run(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("voicecall", { status: 200 });
  }

  _send(obj) { try { this.ws.send(JSON.stringify(obj)); } catch { /* closed */ } }

  async _play(pcm) {
    if (!pcm || !pcm.length) return;
    const ct = this.cfg.fmt === "mulaw" ? "audio/x-mulaw" : "audio/x-l16";
    for (let i = 0; i < pcm.length; i += 160) {          // 160 samples = 20ms @ 8k
      this._send({ event: "playAudio", media: { contentType: ct, sampleRate: "8000",
        payload: encodeFrame(pcm.subarray(i, i + 160), this.cfg.fmt) } });
      await sleep(20);                                    // pace ~ real time so we know when playback ends
    }
  }

  _run(ws) {
    this.ws = ws;
    const cfg = this.cfg, lang = (this.call && this.call.lang) || "te";
    const brain = new Brain(this.call || { lang }, cfg);
    this._facts = brain.facts;
    const started = Date.now();
    let mode = "await_start";   // await_start | speaking | listening | processing | done
    let buf = [], spoke = false, silenceMs = 0, elapsedMs = 0, noSpeechMs = 0, nudges = 0, turns = 0, emergency = false;
    const resetTurn = () => { buf = []; spoke = false; silenceMs = 0; elapsedMs = 0; noSpeechMs = 0; };

    const finalize = async (status) => {
      if (mode === "done") return;
      mode = "done";
      await this.pages("/voice/result", { episodeId: this.call?.episodeId, callId: this.call?.callId,
        answers: brain.facts, status: status || "completed", durationMs: Date.now() - started,
        ambulanceRequested: false, emergency });
      try { ws.close(); } catch {}
    };

    const say = async (turn) => {
      this.log.push(["YOU", turn.reply]);
      emergency = emergency || turn.emergency;
      await this._play(await sarvamTTS(cfg, turn.reply, lang));
    };

    const speakFirst = async () => {
      mode = "speaking";
      brain.turns.push(["YOU", greetingText(lang)]);
      this.log.push(["YOU", greetingText(lang)]);
      const firstP = brain.step(null, (p) => this.modelCall(p));  // first question computed while greeting plays
      if (this.greetPcm && this.greetPcm.length) await this._play(this.greetPcm);
      const turn = await firstP;
      await say(turn);
      if (turn.complete) return finalize("completed");
      resetTurn(); mode = "listening";
    };

    const endTurn = async () => {
      mode = "processing";
      const pcm = concatPcm(buf);
      resetTurn();
      const transcript = await sarvamSTT(cfg, pcm, lang);
      this.log.push(["PATIENT", transcript]);
      const turn = await brain.step(transcript || "(unclear)", (p) => this.modelCall(p));
      mode = "speaking";
      await say(turn);
      turns++;
      if (turn.complete || turns >= cfg.maxConvoTurns || Date.now() - started > cfg.convoMaxMs)
        return finalize("completed");
      resetTurn(); mode = "listening";
    };

    const noSpeech = async () => {
      nudges++;
      if (nudges > cfg.maxSilenceNudges) return finalize(brain.facts && Object.keys(brain.facts).length ? "completed" : "no_answer");
      mode = "speaking";
      const turn = await brain.step("(the patient has been silent - gently, warmly encourage them and kindly "
        + "re-ask the same thing in simpler words. Do NOT re-introduce yourself, do NOT hang up.)", (p) => this.modelCall(p));
      await say(turn);
      resetTurn(); mode = "listening";
    };

    ws.addEventListener("message", async (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      const ev = m.event;
      if (ev === "start") { if (mode === "await_start") await speakFirst(); return; }
      if (ev === "stop" || ev === "closed") { await finalize("completed"); return; }
      if (ev !== "media" || mode !== "listening") return;   // ignore audio while speaking/processing
      const frame = decodeFrame(m.media?.payload || "", cfg.fmt);
      elapsedMs += 20;
      if (rms(frame) >= cfg.energyThreshold) { spoke = true; silenceMs = 0; noSpeechMs = 0; buf.push(frame); }
      else if (spoke) {
        silenceMs += 20; buf.push(frame);
        if (silenceMs >= cfg.silenceMs) return void endTurn();
      } else {
        noSpeechMs += 20;
        if (noSpeechMs >= cfg.turnTimeoutMs) return void noSpeech();
      }
      if (buf.length && elapsedMs >= cfg.maxUtteranceMs) return void endTurn();
    });

    ws.addEventListener("close", () => { finalize("completed"); });
    ws.addEventListener("error", () => { finalize("completed"); });
  }
}
