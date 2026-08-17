// G.711 mu-law codec + Plivo base64 framing (JS port of voice-service/app/audio/codec.py).
// Everything internal is 8 kHz mono PCM16 (Int16Array).
const BIAS = 0x84, CLIP = 32635;
const EXP_LUT = (() => {
  const a = [0, 0, 1, 1];
  for (const [v, n] of [[2, 4], [3, 8], [4, 16], [5, 32], [6, 64], [7, 128]]) for (let i = 0; i < n; i++) a.push(v);
  return a; // 256 entries
})();

export function linearToUlaw(s) {
  let sign = 0;
  if (s < 0) { s = -s; sign = 0x80; }
  if (s > CLIP) s = CLIP;
  s += BIAS;
  const exponent = EXP_LUT[(s >> 7) & 0xFF];
  const mantissa = (s >> (exponent + 3)) & 0x0F;
  return (~(sign | (exponent << 4) | mantissa)) & 0xFF;
}

export function ulawToLinear(u) {
  u = ~u & 0xFF;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0F;
  const s = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -s : s;
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// A Plivo inbound media frame (base64) -> Int16Array PCM16 @ 8k.
export function decodeFrame(b64, fmt) {
  const raw = b64ToBytes(b64);
  if (fmt === "mulaw") {
    const out = new Int16Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = ulawToLinear(raw[i]);
    return out;
  }
  // l16: little-endian PCM16 bytes
  const out = new Int16Array(raw.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (raw[i * 2] | (raw[i * 2 + 1] << 8)) << 16 >> 16;
  return out;
}

// Int16Array PCM16 @ 8k -> base64 payload for a Plivo playAudio frame.
export function encodeFrame(pcm, fmt) {
  if (fmt === "mulaw") {
    const u = new Uint8Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) u[i] = linearToUlaw(pcm[i]);
    return bytesToB64(u);
  }
  const b = new Uint8Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) { b[i * 2] = pcm[i] & 0xFF; b[i * 2 + 1] = (pcm[i] >> 8) & 0xFF; }
  return bytesToB64(b);
}

// Mean |amplitude| of a PCM16 frame — cheap energy for silence detection.
export function rms(pcm) {
  if (!pcm.length) return 0;
  let total = 0;
  for (let i = 0; i < pcm.length; i++) total += Math.abs(pcm[i]);
  return (total / pcm.length) | 0;
}

// Parse a WAV (from Sarvam TTS) -> { pcm: Int16Array, rate }. Minimal RIFF reader.
export function wavToPcm(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 8000, off = 12; // skip RIFF header
  let dataOff = -1, dataLen = 0;
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") rate = dv.getUint32(off + 12, true);
    else if (id === "data") { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size & 1);
  }
  if (dataOff < 0) return { pcm: new Int16Array(0), rate };
  const n = dataLen >> 1;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(dataOff + i * 2, true);
  return { pcm, rate };
}

// Linear resample (anti-aliased box filter on downsample) — mirrors app/audio/resample.py.
export function resample(pcm, srcHz, dstHz) {
  if (srcHz === dstHz || !pcm.length) return pcm;
  const nOut = Math.floor(pcm.length * dstHz / srcHz);
  const out = new Int16Array(nOut);
  if (dstHz < srcHz) {
    const win = srcHz / dstHz;
    for (let i = 0; i < nOut; i++) {
      let a = (i * win) | 0, b = ((i + 1) * win) | 0;
      if (b <= a) b = a + 1;
      if (b > pcm.length) b = pcm.length;
      let sum = 0;
      for (let j = a; j < b; j++) sum += pcm[j];
      out[i] = (sum / (b - a)) | 0;
    }
  } else {
    const ratio = dstHz / srcHz;
    for (let i = 0; i < nOut; i++) {
      const pos = i / ratio, j = pos | 0, frac = pos - j;
      out[i] = (j + 1 < pcm.length) ? (pcm[j] * (1 - frac) + pcm[j + 1] * frac) | 0 : pcm[pcm.length - 1];
    }
  }
  return out;
}
