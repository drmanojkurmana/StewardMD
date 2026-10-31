#!/usr/bin/env node
/* Render the PrepNucleus Sound first-party loops to WAV assets for the Android
   foreground service (local-plugins/capacitor-prep-sound). The web player
   synthesises these same recipes live (prep-sound-web.js TRACK_SYNTH); native
   MediaPlayer needs real files.

   Original generated audio only: seeded PRNG noise (white / Paul-Kellett pink),
   one-pole filters approximating the web BiquadFilter recipes, and sine pads.
   No samples, no downloads, no copyrighted material.

   Deterministic: fixed seeds + integer-exact PRNG, so re-running produces
   byte-identical files. Usage: node tools/prep-sound-render-wavs.mjs [--check]
   --check renders in memory and compares against the committed WAVs.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "local-plugins/capacitor-prep-sound/android/src/main/assets/prep-sound");
const SAMPLE_RATE = 22050;
const SECONDS = 5;
const FADE_SAMPLES = Math.floor(SAMPLE_RATE * 0.25); // loop crossfade

/** mulberry32: small deterministic PRNG, identical across Node versions. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paul Kellett pink-noise state machine, as in prep-sound-web.js. */
function pinkGenerator(rand) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  // Warm up so the loop starts in steady state.
  for (let i = 0; i < 2000; i++) step(rand() * 2 - 1);
  function step(w) {
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
    return v;
  }
  return () => step(rand() * 2 - 1);
}

function onePoleLowpassAlpha(freq) {
  const x = Math.exp((-2 * Math.PI * freq) / SAMPLE_RATE);
  return 1 - x;
}

/* Recipes mirror prep-sound-web.js TRACK_SYNTH (same gains; peaks stay low). */
export const RECIPES = {
  rain_soft: { seed: 101, color: "white", filterType: "bandpass", freq: 2200, gain: 0.10, pads: [], lfoRate: 0.2, lfoDepth: 0.035 },
  night_quiet: { seed: 202, color: "white", filterType: "lowpass", freq: 420, gain: 0.07, pads: [], lfoRate: 0, lfoDepth: 0 },
  deep_drone: { seed: 303, color: "pink", filterType: "lowpass", freq: 300, gain: 0.05, pads: [{ freq: 55, gain: 0.05 }, { freq: 82.5, gain: 0.03 }], lfoRate: 0.2, lfoDepth: 0.02 },
  ocean_slow: { seed: 404, color: "pink", filterType: "lowpass", freq: 900, gain: 0.09, pads: [], lfoRate: 0.2, lfoDepth: 0.04 },
};

export function renderTrack(id) {
  const r = RECIPES[id];
  if (!r) throw new Error("unknown track " + id);
  const n = SAMPLE_RATE * SECONDS;
  const rand = mulberry32(r.seed);
  const nextNoise = r.color === "pink" ? pinkGenerator(rand) : () => rand() * 2 - 1;
  const out = new Float32Array(n);
  // Simple resonant bandpass via two one-poles (high-pass by subtraction) for rain.
  let lp = 0, bpLp = 0;
  const alpha = onePoleLowpassAlpha(r.freq);
  for (let i = 0; i < n; i++) {
    const w = nextNoise();
    let v;
    if (r.filterType === "bandpass") {
      bpLp += alpha * (w - bpLp);
      lp += onePoleLowpassAlpha(400) * (w - lp);
      v = (bpLp - lp) * 2.2;
    } else {
      lp += alpha * (w - lp);
      v = lp;
    }
    let g = r.gain;
    if (r.lfoDepth) g += r.lfoDepth * Math.sin((2 * Math.PI * r.lfoRate * i) / SAMPLE_RATE);
    let s = v * g * 3.0; // pink/white filtered noise is quiet; stage up then soft-cap below
    for (const p of r.pads) s += Math.sin((2 * Math.PI * p.freq * i) / SAMPLE_RATE) * p.gain;
    out[i] = s;
  }
  // Seamless loop: crossfade the tail into the head.
  for (let i = 0; i < FADE_SAMPLES; i++) {
    const t = i / FADE_SAMPLES;
    const tailIdx = n - FADE_SAMPLES + i;
    out[tailIdx] = out[tailIdx] * (1 - t) + out[i] * t;
  }
  // Normalise to a low ceiling (web contract caps track gain at 0.2; keep peaks <= 0.5).
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0.5 ? 0.5 / peak : 1;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, out[i] * scale));
    pcm[i] = Math.round(s * 32767);
  }
  return pcm;
}

export function wavBytes(pcm) {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

export function renderAll() {
  const files = {};
  for (const id of Object.keys(RECIPES)) files[id + ".wav"] = wavBytes(renderTrack(id));
  return files;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes("--check");
  const files = renderAll();
  let failed = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(OUT_DIR, name);
    if (check) {
      const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
      const same = existing && existing.equals(bytes);
      console.log((same ? "OK  " : "DIFF") + " " + name + " (" + bytes.length + " bytes)");
      if (!same) failed++;
    } else {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(target, bytes);
      console.log("wrote " + name + " (" + bytes.length + " bytes)");
    }
  }
  if (failed) process.exit(1);
}
