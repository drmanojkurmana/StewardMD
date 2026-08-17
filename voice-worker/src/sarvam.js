// Sarvam Saarika STT + Bulbul TTS over HTTPS (no GPU) — JS port of voice-service/app/{stt,tts}/sarvam.py.
import { b64ToBytes, wavToPcm, resample } from "./codec.js";

const LANG = { te: "te-IN", en: "en-IN", hi: "hi-IN", ta: "ta-IN", kn: "kn-IN", ml: "ml-IN",
  mr: "mr-IN", gu: "gu-IN", bn: "bn-IN", pa: "pa-IN", od: "od-IN" };
const lc = (l) => LANG[l] || "te-IN";

// Wrap an Int16Array (mono PCM16) as a WAV.
function pcmToWav(pcm, rate) {
  const dataLen = pcm.length * 2;
  const dv = new DataView(new ArrayBuffer(44 + dataLen));
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); wr(8, "WAVE");
  wr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wr(36, "data"); dv.setUint32(40, dataLen, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  return new Uint8Array(dv.buffer);
}

// PCM16 @ 8k -> transcript. Sarvam prefers 16k, so upsample (linear; no aliasing on upsample).
export async function sarvamSTT(cfg, pcm8k, lang) {
  if (!pcm8k || !pcm8k.length) return "";
  const wav = pcmToWav(resample(pcm8k, 8000, 16000), 16000);
  const fd = new FormData();
  fd.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  fd.append("language_code", lc(lang));
  if (cfg.sarvamSttModel) fd.append("model", cfg.sarvamSttModel);
  try {
    const r = await fetch("https://api.sarvam.ai/speech-to-text",
      { method: "POST", headers: { "api-subscription-key": cfg.sarvamKey }, body: fd });
    const j = await r.json();
    return (j.transcript || "").trim();
  } catch { return ""; }
}

// text -> PCM16 @ 8k (Sarvam returns 8k WAV directly, so no resample/aliasing).
export async function sarvamTTS(cfg, text, lang) {
  if (!text) return new Int16Array(0);
  const body = { text, language_code: lc(lang), speech_sample_rate: "8000", output_audio_codec: "wav" };
  if (cfg.sarvamTtsModel) body.model = cfg.sarvamTtsModel;
  if (cfg.sarvamSpeaker) body.speaker = cfg.sarvamSpeaker;
  if (cfg.sarvamPace) body.pace = Number(cfg.sarvamPace);
  if (cfg.sarvamLoudness) body.loudness = Number(cfg.sarvamLoudness);
  try {
    const r = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": cfg.sarvamKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const audios = j.audios || [];
    if (!audios.length) return new Int16Array(0);
    const { pcm, rate } = wavToPcm(b64ToBytes(audios[0]));
    return rate !== 8000 ? resample(pcm, rate, 8000) : pcm;
  } catch { return new Int16Array(0); }
}
