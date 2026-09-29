import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

export function decodeHeader(text) {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const [record, nsigStr, fsStr, nsampStr] = lines[0].trim().split(/\s+/);
  const nsig = +nsigStr, fs = +fsStr, nsamp = +nsampStr;
  const signals = [];
  for (let i = 1; i <= nsig; i++) {
    const parts = lines[i].trim().split(/\s+/);
    const [file, fmt, gainSpec, adcres, adczero, initval, checksum, blocksize, ...descParts] = parts;
    const m = /^([\d.]+)(?:\(([-\d.]+)\))?\/(.+)$/.exec(gainSpec);
    if (!m) throw new Error("unrecognised gain spec: " + gainSpec);
    signals.push({
      file, fmt: +fmt, gain: +m[1], baseline: m[2] != null ? +m[2] : +adczero, units: m[3],
      adcres: +adcres, adczero: +adczero, initval: +initval, checksum: +checksum,
      blocksize: +blocksize, description: descParts.join(" "),
    });
  }
  const clinical = {};
  for (let i = nsig + 1; i < lines.length; i++) {
    const m = /^#([A-Za-z][A-Za-z0-9./() ]*?)\s+(-?[\d.]+)\s*$/.exec(lines[i]);
    if (m) clinical[m[1].trim()] = +m[2];
  }
  return { record, nsig, fs, nsamp, signals, clinical };
}

export function decodeSignal(buf, header) {
  const { nsig, nsamp, signals } = header;
  function readInterleaved(littleEndian) {
    const out = signals.map(() => new Int32Array(nsamp));
    for (let i = 0; i < nsamp; i++) {
      for (let ch = 0; ch < nsig; ch++) {
        const off = (i * nsig + ch) * 2;
        out[ch][i] = littleEndian ? buf.readInt16LE(off) : buf.readInt16BE(off);
      }
    }
    return out;
  }
  const le = readInterleaved(true);
  const matchesLE = signals.every((s, ch) => le[ch][0] === s.initval);
  if (matchesLE) return le;
  const be = readInterleaved(false);
  const matchesBE = signals.every((s, ch) => be[ch][0] === s.initval);
  if (matchesBE) return be;
  throw new Error("neither byte order matches the header's initial value; format " + signals[0].fmt + " assumption is wrong for this record");
}

// Physical units: (raw - baseline) / gain, per signal.
export function toPhysical(rawChannel, signal) {
  const out = new Float64Array(rawChannel.length);
  for (let i = 0; i < rawChannel.length; i++) out[i] = (rawChannel[i] - signal.baseline) / signal.gain;
  return out;
}

// Baseline: median of physiologically plausible samples (50-220 bpm), rounded to nearest 5 bpm.
// ponytail: this is a simplified baseline (true FIGO baseline excludes accelerations/decelerations
// iteratively); upgrade if a clinical reviewer flags cases where this disagrees with their read.
export function extractFeatures(fhr, fs) {
  const valid = Array.from(fhr).filter((v) => v >= 50 && v <= 220);
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const baseline = Math.round(median / 5) * 5;

  // Variability proxy: mean of the 1-minute rolling max-min range, banded per FIGO-style thresholds.
  const win = fs * 60;
  let sumRange = 0, nWin = 0;
  for (let i = 0; i + win <= fhr.length; i += win) {
    const seg = Array.from(fhr.slice(i, i + win)).filter((v) => v >= 50 && v <= 220);
    if (seg.length < win * 0.5) continue; // skip a window that's mostly dropout
    sumRange += Math.max(...seg) - Math.min(...seg);
    nWin++;
  }
  const meanRange = nWin ? sumRange / nWin : 0;
  const variabilityBand = meanRange < 5 ? "reduced" : meanRange > 25 ? "increased" : "normal";

  // Decelerations: a drop of >=15 bpm below baseline sustained for >=15s (FIGO 2015 definition).
  const minSamples = Math.round(15 * fs);
  let decelCount = 0, below = 0;
  for (let i = 0; i < fhr.length; i++) {
    const v = fhr[i];
    if (v >= 50 && v <= 220 && v <= baseline - 15) below++;
    else { if (below >= minSamples) decelCount++; below = 0; }
  }
  if (below >= minSamples) decelCount++;

  return { baseline, variabilityBand, decelCount, nWindowsUsed: nWin };
}

// A plain, readable FHR+UC trace. Not standard CTG graph paper (3cm/min, 1cm=30bpm),
// this is a teaching screen, not a printed strip; legibility on a phone matters more than
// paper-convention fidelity. Flagged in Review Focus / vault note for a clinician to confirm
// this reads clearly enough, or to ask for standard-scale graph paper styling later.
export function renderTraceSvg(fhr, uc, fs) {
  const W = 900, H_FHR = 260, H_UC = 100, PAD = 24;
  const n = fhr.length;
  const x = (i) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const yFhr = (v) => PAD + H_FHR - ((Math.min(Math.max(v, 50), 210) - 50) / 160) * H_FHR;
  const yUc = (v) => H_FHR + 40 + H_UC - (Math.min(Math.max(v, 0), 100) / 100) * H_UC;
  function path(samples, yFn) {
    let d = "", pen = false;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      if (v < 50 && yFn === yFhr) { pen = false; continue; } // gap on dropout, don't draw a false flat line
      d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + yFn(v).toFixed(1) + " ";
      pen = true;
    }
    return d.trim();
  }
  const fhrPath = path(Array.from(fhr), yFhr);
  const ucPath = path(Array.from(uc), yUc);
  return '<svg viewBox="0 0 ' + W + ' ' + (H_FHR + H_UC + 60) + '" xmlns="http://www.w3.org/2000/svg" role="img" ' +
    'aria-label="Fetal heart rate and uterine contraction trace">' +
    '<rect width="' + W + '" height="' + (H_FHR + H_UC + 60) + '" fill="#0b0b0d"/>' +
    '<path d="' + fhrPath + '" fill="none" stroke="#ff6b6b" stroke-width="1.5"/>' +
    '<path d="' + ucPath + '" fill="none" stroke="#4dabf7" stroke-width="1.5"/>' +
    '<text x="' + PAD + '" y="16" fill="#999" font-size="11">FHR (bpm)</text>' +
    '<text x="' + PAD + '" y="' + (H_FHR + 54) + '" fill="#999" font-size="11">Uterine activity</text>' +
    "</svg>";
}

const OUT_DECK = "tokos/decks/ctg.json";
const OUT_MEDIA_DIR = "tokos/media/ctg";
const OUT_CREDITS = "tokos/media/credits.json";
const BASE_URL = "https://physionet.org/files/ctu-uhb-ctgdb/1.0.0/";

async function fetchText(path) {
  const r = await fetch(BASE_URL + path);
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.text();
}
async function fetchBuf(path) {
  const r = await fetch(BASE_URL + path);
  if (!r.ok) throw new Error(path + " " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Picks 12 records spread across the recorded pH range so the case set isn't all-normal.
// pH bands (obstetric convention): normal >= 7.20, borderline 7.10-7.19, acidotic < 7.10.
function pickSpread(headers, perBand) {
  const bands = { normal: [], borderline: [], acidotic: [] };
  headers.forEach((h) => {
    const ph = h.clinical["pH"];
    if (ph == null) return;
    if (ph >= 7.2) bands.normal.push(h);
    else if (ph >= 7.1) bands.borderline.push(h);
    else bands.acidotic.push(h);
  });
  const pick = (arr, n) => arr.slice(0, n); // deterministic: first n found, not random
  return [...pick(bands.normal, perBand), ...pick(bands.borderline, perBand), ...pick(bands.acidotic, perBand)];
}

async function main() {
  mkdirSync(OUT_MEDIA_DIR, { recursive: true });
  mkdirSync("tokos/decks", { recursive: true });
  const recordsText = await fetchText("RECORDS");
  const records = recordsText.trim().split("\n").slice(0, 60); // only scan the first 60 headers (tiny files) to find a spread
  const headers = [];
  for (const r of records) {
    const h = decodeHeader(await fetchText(r + ".hea"));
    if (h.clinical["pH"] != null) headers.push(h);
  }
  const chosen = pickSpread(headers, 4); // 4 per band = 12 cases
  const cases = [];
  for (const h of chosen) {
    const buf = await fetchBuf(h.record + ".dat");
    const raw = decodeSignal(buf, h);
    const fhr = toPhysical(raw[0], h.signals[0]);
    const uc = toPhysical(raw[1], h.signals[1]);
    const features = extractFeatures(fhr, h.fs);
    if (!features) continue;
    // Last 10 minutes before delivery, the clinically relevant window: fs*600 samples.
    const winLen = Math.min(fhr.length, h.fs * 600);
    const fhrWin = fhr.slice(fhr.length - winLen);
    const ucWin = uc.slice(uc.length - winLen);
    const svg = renderTraceSvg(fhrWin, ucWin, h.fs);
    writeFileSync(OUT_MEDIA_DIR + "/" + h.record + ".svg", svg);
    cases.push({
      id: h.record,
      svg: "ctg/" + h.record + ".svg",
      features,
      outcome: { pH: h.clinical["pH"], BE: h.clinical["BE"], apgar1: h.clinical["Apgar1"], apgar5: h.clinical["Apgar5"] },
      gestWeeks: h.clinical["Gest. weeks"],
    });
  }
  writeFileSync(OUT_DECK, JSON.stringify({ v: 1, id: "ctg", cases }, null, 2));
  writeFileSync(OUT_CREDITS, JSON.stringify({
    "ctu-uhb-ctgdb": {
      licence: "ODC-BY 1.0", route: "adapted",
      source: "https://physionet.org/content/ctu-uhb-ctgdb/1.0.0/",
      citation: "Chudáček V, Spilka J, Bursa M, et al. Open access intrapartum CTG database. BMC Pregnancy Childbirth. 2014;14:16.",
      changes: "Decoded from WFDB signal format; baseline/variability/deceleration features computed by a simplified rule-based script, not an expert annotation; features are computed over the last 60 minutes before delivery; the strip shows the last 30 minutes, rendered as an SVG line trace on a calibrated grid.",
    },
  }, null, 2));
  console.log("wrote " + cases.length + " cases");
}


// Tunable constants. A reviewing obstetrician may change the UC_* and QUALITY_* values; the FIGO
// thresholds are from the FIGO 2015 classification table and change only with the guideline.
export const CFG = {
  WINDOW_MIN: 60, STRIP_MIN: 30, FHR_MIN: 50, FHR_MAX: 210,
  UC_PROMINENCE: 15, UC_MIN_SEC: 30,          // rise above the 10th-percentile resting tone; min duration at half height
  DECEL_DROP: 15, DECEL_MIN_SEC: 15,
  PROLONGED_SEC: 180, PATH_DECEL_SEC: 300,    // FIGO: prolonged over 3 min; pathological over 5 min
  RED_VAR_PATH_MIN: 50, INC_VAR_PATH_MIN: 30, // FIGO: reduced over 50 min, increased over 30 min
  QUALITY_SUBOPTIMAL_PCT: 30,                 // Tokós threshold, not a FIGO number
};
const ok = (v) => v >= CFG.FHR_MIN && v <= CFG.FHR_MAX;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

export function signalQuality(fhr) {
  if (!fhr.length) return { lossPct: 100, suboptimal: true };
  let bad = 0;
  for (let i = 0; i < fhr.length; i++) if (!ok(fhr[i])) bad++;
  const lossPct = Math.round((bad / fhr.length) * 1000) / 10;
  return { lossPct, suboptimal: lossPct > CFG.QUALITY_SUBOPTIMAL_PCT };
}

// Pass 1: mean of the interquartile samples. Pass 2: mean of samples within 10 bpm of pass 1,
// which drops decelerations and accelerations. Rounded to 5 bpm as FIGO reports baseline.
export function twoPassBaseline(fhr) {
  const v = Array.from(fhr).filter(ok).sort((a, b) => a - b);
  if (!v.length) return null;
  const q1 = pct(v, 0.25), q3 = pct(v, 0.75);
  const prelim = mean(v.filter((x) => x >= q1 && x <= q3));
  const stable = v.filter((x) => Math.abs(x - prelim) <= 10);
  return Math.round((stable.length ? mean(stable) : prelim) / 5) * 5;
}

// Quality of the 30-min strip the learner sees. A lost UC channel reads as flat 0 in this data (see the
// review queue traces), so UC counts as present only where the sample is finite and above 0.
export function stripQuality(fhr, uc) {
  const pctOf = (n, d) => Math.round((n / d) * 1000) / 10;
  let bad = 0, up = 0;
  for (let i = 0; i < fhr.length; i++) if (!ok(fhr[i])) bad++;
  for (let i = 0; i < uc.length; i++) if (Number.isFinite(uc[i]) && uc[i] > 0) up++;
  return { fhrLossPct: fhr.length ? pctOf(bad, fhr.length) : 100, ucPresentPct: uc.length ? pctOf(up, uc.length) : 0 };
}
export const STRIP_MAX_FHR_LOSS = 15, STRIP_MIN_UC_PRESENT = 50;

export function baselineClass(b) {
  if (b < 100) return "severe_bradycardia";
  if (b < 110) return "bradycardia";
  if (b > 160) return "tachycardia";
  return "normal";
}

export function detectContractions(uc, fs) {
  const rest = pct(Array.from(uc).sort((a, b) => a - b), 0.1);
  const half = rest + CFG.UC_PROMINENCE / 2, top = rest + CFG.UC_PROMINENCE;
  const out = [];
  let start = -1, peak = -1;
  for (let i = 0; i <= uc.length; i++) {
    const above = i < uc.length && uc[i] >= half;
    if (above) {
      if (start < 0) { start = i; peak = i; }
      if (uc[i] > uc[peak]) peak = i;
    } else if (start >= 0) {
      if (uc[peak] >= top && i - start >= CFG.UC_MIN_SEC * fs) out.push({ start, end: i, peak });
      start = -1;
    }
  }
  return out;
}

export function detectDecels(fhr, fs, baseline) {
  const out = [];
  let start = -1, nadir = -1;
  for (let i = 0; i <= fhr.length; i++) {
    const low = i < fhr.length && ok(fhr[i]) && fhr[i] <= baseline - CFG.DECEL_DROP;
    if (low) {
      if (start < 0) { start = i; nadir = i; }
      if (fhr[i] < fhr[nadir]) nadir = i;
    } else if (start >= 0) {
      const durationSec = (i - start) / fs;
      if (durationSec >= CFG.DECEL_MIN_SEC) out.push({ start, end: i, nadir, durationSec, depth: Math.round(baseline - fhr[nadir]) });
      start = -1;
    }
  }
  return out;
}

// Per-minute amplitude of valid samples outside decelerations, as the 5th-to-95th percentile range:
// a plain max-min range read 2 of 5 real CTU-UHB records (1001, 1002) as "increased" because single
// artifact spikes inflate it; the trimmed range put all 5 in the normal band (11 to 24 bpm), checked
// 2026-09-29. A minute counts only when at least 60% of it is usable. band is FIGO's: reduced < 5,
// normal 5 to 25, increased > 25.
// ponytail: FIGO's "reduced for over 3 min during decelerations" criterion is not computed; add it
// if a reviewer disagrees with a case where it would have applied.
export function minuteVariability(fhr, fs, decels) {
  const inDecel = new Uint8Array(fhr.length);
  decels.forEach((d) => inDecel.fill(1, d.start, d.end));
  const win = fs * 60, ranges = [];
  let reducedMin = 0, increasedMin = 0;
  for (let i = 0; i + win <= fhr.length; i += win) {
    const seg = [];
    for (let j = i; j < i + win; j++) if (ok(fhr[j]) && !inDecel[j]) seg.push(fhr[j]);
    if (seg.length < win * 0.6) continue;
    seg.sort((a, b) => a - b);
    const r = pct(seg, 0.95) - pct(seg, 0.05);
    ranges.push(r);
    if (r < 5) reducedMin++;
    else if (r > 25) increasedMin++;
  }
  const sorted = ranges.slice().sort((a, b) => a - b);
  const medianRange = sorted.length ? pct(sorted, 0.5) : 0;
  const band = medianRange < 5 ? "reduced" : medianRange > 25 ? "increased" : "normal";
  return { reducedMin, increasedMin, assessedMin: ranges.length, medianRange: Math.round(medianRange * 10) / 10, band };
}

// Advisory only (Global Constraints): learners are never graded on this unless a reviewer confirmed it.
export function decelSubtype(d, contractions, fs) {
  if (d.durationSec >= CFG.PROLONGED_SEC) return "prolonged";
  if ((d.nadir - d.start) / fs < 30) return "variable";
  const c = contractions.find((k) => d.start <= k.end && d.end >= k.start - 30 * fs);
  if (!c) return "unclassified";
  const lag = (d.nadir - c.peak) / fs;
  if (lag > 20) return "late";
  if (Math.abs(lag) <= 15) return "early";
  return "unclassified";
}

// Low criteria (as used in the CTU-UHB literature): metabolic acidosis = pH < 7.05 and BDecf >= 12 mmol/L.
export function acidosisClass(c) {
  if (c.pH == null || Number.isNaN(c.pH)) return "unknown";
  if (c.pH >= 7.2) return "normal";
  if (c.BDecf == null || Number.isNaN(c.BDecf)) return "acidaemia_unspecified";
  return c.pH < 7.05 && c.BDecf >= 12 ? "metabolic" : "acidaemia_not_metabolic";
}

export function extractFIGOFeatures(fhrAll, ucAll, fs) {
  const n = Math.min(fhrAll.length, CFG.WINDOW_MIN * 60 * fs);
  const fhr = fhrAll.slice(fhrAll.length - n), uc = ucAll.slice(ucAll.length - n);
  const quality = signalQuality(fhr);
  if (quality.lossPct > 70) return null;
  const baseline = twoPassBaseline(fhr);
  const bClass = baselineClass(baseline);
  const decels = detectDecels(fhr, fs, baseline);
  const variability = minuteVariability(fhr, fs, decels);
  const contr = detectContractions(uc, fs);
  // Tachysystole: over 5 per 10 min averaged over the last 30 min (FIGO).
  const last30 = n - Math.min(n, 30 * 60 * fs);
  const count30 = contr.filter((c) => c.start >= last30).length;
  const minutes30 = (n - last30) / fs / 60;
  const per10 = minutes30 ? Math.round((count30 / minutes30) * 100) / 10 : 0;
  // Repetitive: decelerations with more than 50% of contractions (FIGO).
  const withDecel = contr.filter((c) => decels.some((d) => d.start >= c.start - 30 * fs && d.start <= c.end + 60 * fs)).length;
  const repetitive = contr.length > 0 && withDecel / contr.length > 0.5;
  const maxDecel = decels.reduce((m, d) => Math.max(m, d.durationSec), 0);

  let figo = "normal";
  if (baseline < 100 || variability.reducedMin > CFG.RED_VAR_PATH_MIN || variability.increasedMin > CFG.INC_VAR_PATH_MIN || maxDecel > CFG.PATH_DECEL_SEC) {
    figo = "pathological";
  } else if (bClass !== "normal" || variability.band !== "normal" || repetitive || maxDecel >= CFG.PROLONGED_SEC) {
    figo = "suspicious";
  }
  // ponytail: "repetitive late or prolonged decelerations for over 30 min" (pathological) needs typed
  // decelerations; left to the reviewer via case.review.figo until subtype is validated.
  return {
    window: { minutes: Math.round(n / fs / 60) },
    quality, baseline, baselineClass: bClass, variability,
    contractions: { count30, per10, tachysystole: per10 > 5 },
    decels: decels.map((d) => ({ startSec: Math.round(d.start / fs), durationSec: d.durationSec, depth: d.depth, subtypeSuggested: decelSubtype(d, contr, fs) })),
    repetitive, figoSuggested: figo,
  };
}

// Calibrated grid: a horizontal line every 10 bpm (major every 30), shaded 110 to 160 band, amber
// line at 100 (severe bradycardia), a major vertical line every minute and a minor one every 30 s.
// Colours live in tokos.css (tk-* classes) so the trace follows the monitor or paper theme and the
// inline SVG never carries a <style>. Axis numbers only: all words are in the bilingual HTML around it.
export const LAYOUT = { W: 1500, H: 460, padL: 40, padR: 12, yTop: 12, hFhr: 280, gap: 30, hUc: 110, fhrMin: 50, fhrMax: 210 };
export function yForBpm(L, bpm) {
  return L.yTop + L.hFhr - ((Math.min(Math.max(bpm, L.fhrMin), L.fhrMax) - L.fhrMin) / (L.fhrMax - L.fhrMin)) * L.hFhr;
}
export function renderCalibratedTraceSvg(fhr, uc, fs) {
  const L = Object.assign({}, LAYOUT);
  L.plotW = L.W - L.padL - L.padR;
  L.ucTop = L.yTop + L.hFhr + L.gap;
  L.durationSec = fhr.length / fs;
  const x = (i) => L.padL + ((i / fs) / L.durationSec) * L.plotW;
  const yUc = (v) => L.ucTop + L.hUc - (Math.min(Math.max(v, 0), 100) / 100) * L.hUc;
  const f1 = (n) => n.toFixed(1);
  const right = L.W - L.padR, bottom = L.ucTop + L.hUc;
  let g = '<rect class="tk-bg" x="0" y="0" width="' + L.W + '" height="' + L.H + '"/>';
  g += '<rect class="tk-band" x="' + L.padL + '" y="' + f1(yForBpm(L, 160)) + '" width="' + L.plotW + '" height="' + f1(yForBpm(L, 110) - yForBpm(L, 160)) + '"/>';
  for (let bpm = 60; bpm <= 200; bpm += 10) {
    const y = f1(yForBpm(L, bpm));
    g += '<line class="' + (bpm % 30 === 0 ? "tk-grid-major" : "tk-grid-minor") + '" x1="' + L.padL + '" y1="' + y + '" x2="' + right + '" y2="' + y + '"/>';
    if (bpm % 20 === 0) g += '<text class="tk-axis" x="' + (L.padL - 4) + '" y="' + y + '" text-anchor="end" dominant-baseline="middle">' + bpm + "</text>";
  }
  [110, 160].forEach((b) => { const y = f1(yForBpm(L, b)); g += '<line class="tk-line-normal" x1="' + L.padL + '" y1="' + y + '" x2="' + right + '" y2="' + y + '"/>'; });
  const y100 = f1(yForBpm(L, 100));
  g += '<line class="tk-line-100" x1="' + L.padL + '" y1="' + y100 + '" x2="' + right + '" y2="' + y100 + '"/>';
  for (let u = 0; u <= 100; u += 25) { const y = f1(yUc(u)); g += '<line class="tk-grid-minor" x1="' + L.padL + '" y1="' + y + '" x2="' + right + '" y2="' + y + '"/>'; }
  const mins = Math.floor(L.durationSec / 60);
  for (let m = 0; m <= mins; m++) {
    const xm = f1(L.padL + ((m * 60) / L.durationSec) * L.plotW);
    g += '<line class="tk-grid-major-t" x1="' + xm + '" y1="' + L.yTop + '" x2="' + xm + '" y2="' + bottom + '"/>';
    if (m % 5 === 0) g += '<text class="tk-axis" x="' + xm + '" y="' + (L.H - 4) + '" text-anchor="middle">' + m + "</text>";
    if (m < mins) { const xh = f1(L.padL + ((m * 60 + 30) / L.durationSec) * L.plotW); g += '<line class="tk-grid-minor-t" x1="' + xh + '" y1="' + L.yTop + '" x2="' + xh + '" y2="' + bottom + '"/>'; }
  }
  // 2 Hz is enough to see variability on a phone and halves the file. ponytail: plain decimation;
  // switch to min/max per bucket if a reviewer sees variability flattened at full zoom.
  const step = Math.max(1, Math.round(fs / 2));
  function path(s, yFn, isFhr) {
    let d = "", pen = false;
    for (let i = 0; i < s.length; i += step) {
      let bad = false;
      if (isFhr) for (let j = i; j < Math.min(s.length, i + step); j++) if (!(s[j] >= CFG.FHR_MIN && s[j] <= CFG.FHR_MAX)) bad = true;
      if (bad) { pen = false; continue; }
      d += (pen ? "L" : "M") + f1(x(i)) + "," + f1(yFn(s[i])) + " ";
      pen = true;
    }
    return d.trim();
  }
  g += '<path class="tk-fhr" d="' + path(fhr, (v) => yForBpm(L, v), true) + '"/>';
  g += '<path class="tk-uc" d="' + path(uc, yUc, false) + '"/>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.W + " " + L.H + '" width="' + L.W + '" height="' + L.H + '" class="tk-svg">' + g + "</svg>";
  return { svg, layout: L };
}

// Only real header fields. Birth weight and sex are outcomes: they go in the reveal, not the vignette.
// FIELD_OK lists the coded fields whose meaning was confirmed from the two sources (see mainV2 comment).
// None of the 0/1 codings could be confirmed, so no coded field is shown in the vignette.
const FIELD_OK = {};
export function vignetteFrom(c) {
  const v = { age: c["Age"], gravidity: c["Gravidity"], parity: c["Parity"], gestWeeks: c["Gest. weeks"], risks: [] };
  ["Diabetes", "Hypertension", "Preeclampsia", "Pyrexia", "Meconium"].forEach((k) => { if (FIELD_OK[k] && c[k] === 1) v.risks.push(k.toLowerCase()); });
  if (FIELD_OK.Induced && c["Induced"] != null) v.induced = c["Induced"] === 1;
  // II.stage max in the data is 30 (paper: stage 2 <= 30 min), so minutes. I.stage's unit is unconfirmed: not shown.
  if (c["II.stage"] != null) v.stage2Min = c["II.stage"];
  Object.keys(v).forEach((k) => { if (v[k] == null || Number.isNaN(v[k])) delete v[k]; });
  return v;
}

// Pick 12 teaching cases: a spread of archetypes where the dataset has them, then fill by pH band.
// Archetypes are SUGGESTIONS for the reviewer (docs/tokos/review-queue.md), never shown as confirmed.
const WANT = [
  ["normal_trace_normal_outcome", 3, (f, a) => f.figoSuggested === "normal" && a === "normal"],
  ["decelerations", 2, (f) => f.decels.length > 0 && f.figoSuggested !== "pathological"],
  ["pathological_trace", 2, (f) => f.figoSuggested === "pathological"],
  ["metabolic_acidosis", 2, (f, a) => a === "metabolic"],
  ["baseline_abnormal", 1, (f) => f.baselineClass !== "normal"],
  ["tachysystole", 1, (f) => f.contractions.tachysystole],
  ["reduced_variability", 1, (f) => f.variability.band === "reduced"],
];
export function pickCases(candsIn) {
  // Prefer traces with a contraction in the strip window, then the least signal loss (Array.sort is stable).
  const cands = candsIn.slice().sort((a, b) => (a.features.contractions.count30 > 0 ? 0 : 1) - (b.features.contractions.count30 > 0 ? 0 : 1) || a.features.quality.lossPct - b.features.quality.lossPct);
  const used = new Set(), out = [];
  WANT.forEach(([arch, n, test]) => {
    cands.filter((k) => !used.has(k.id) && test(k.features, k.acidosis)).slice(0, n).forEach((k) => { used.add(k.id); out.push(Object.assign({ archetypeSuggested: arch }, k)); });
  });
  cands.filter((k) => !used.has(k.id)).slice(0, 12 - out.length).forEach((k) => out.push(Object.assign({ archetypeSuggested: "fill" }, k)));
  return out.slice(0, 12);
}

// Runs fn over items, 6 at a time, keeping result order.
async function pool(items, fn, n = 6) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; out[j] = await fn(items[j]); } }));
  return out;
}

// Deck case for one scanned record k = {id, h, fhr, uc, features, stripQuality, acidosis, archetypeSuggested}; writes its SVG.
function caseFrom(k) {
  const { svg, layout } = renderCalibratedTraceSvg(k.fhr, k.uc, k.h.fs);
  writeFileSync(OUT_MEDIA_DIR + "/" + k.id + ".svg", svg);
  const c = k.h.clinical;
  return {
    id: k.id, svg: "ctg/" + k.id + ".svg", layout, archetypeSuggested: k.archetypeSuggested,
    vignette: vignetteFrom(c), features: Object.assign({ variabilityBand: k.features.variability.band, decelCount: k.features.decels.length }, k.features), figo: k.features.figoSuggested,
    outcome: { pH: c["pH"], BE: c["BE"], BDecf: c["BDecf"], pCO2: c["pCO2"], apgar1: c["Apgar1"], apgar5: c["Apgar5"], weightG: c["Weight(g)"] },
    acidosis: k.acidosis, stripQuality: k.stripQuality, qualityNote: "", review: null,
  };
}
function stripQualityNote(k, c) {
  const sb = twoPassBaseline(k.fhr), hi = Array.from(k.fhr).filter((v) => v > 180).length;
  const last5 = Array.from(k.fhr).slice(-5 * 60 * k.h.fs).filter((v) => v > 180).length;
  const notes = [];
  if (sb != null && Math.abs(sb - c.features.baseline) >= 10) notes.push("strip baseline " + sb + " differs from the " + c.features.window.minutes + " min baseline " + c.features.baseline);
  if (hi) notes.push(hi + " samples above 180 bpm in the strip" + (last5 ? " (" + last5 + " in the last 5 min)" : ""));
  return "strip FHR loss " + c.stripQuality.fhrLossPct + "%, UC present " + c.stripQuality.ucPresentPct + "%; " + (notes.length ? notes.join("; ") : "no artefact concern found by the checks") + ". Features are computed on the " + c.features.window.minutes + " min window.";
}

export async function mainV2() {
  // Header field codings, checked 2026-09-29 against https://physionet.org/content/ctu-uhb-ctgdb/1.0.0/ and
  // Chudacek 2014, BMC Pregnancy Childbirth 14:16 (incl. Additional file 3). Neither source has a field-by-field
  // coding table for the .hea files. What is and is not confirmed:
  //  CONFIRMED: Deliv. type: 1 = vaginal (506 records), 2 = caesarean (46 records). Paper: "506 intrapartum recordings
  //    delivered vaginally" (operative vaginal included) and "only 46 cesarean section (CS) deliveries"; counts match exactly.
  //  CONFIRMED (by value range): II.stage is in minutes: max over 552 records is 30, paper criterion "Duration of stage 2 <= 30 minutes".
  //    I.stage: unit unconfirmed (median 220, one outlier 393425), so it is not shown.
  //  NOT CONFIRMED, so left out of FIELD_OK and never shown in a vignette:
  //    Diabetes, Hypertension, Preeclampsia, Pyrexia, Meconium, Liq. praecox, Induced: the paper names these as
  //    included factors ("gestational diabetes, preeclampsia, maternal fever (>37.5C), hypertension and meconium stained
  //    fluid"; "induced delivery") but never states the 0/1 coding, and Additional file 3 counts do not reconcile with the
  //    .hea values (e.g. paper Diabetes 394 of 506 vs header Diabetes=1 in 37 of 552; paper Hypertension 6 vs header 44).
  //    Presentation: paper says O = occipital, B = breech (16 B in total) but the header holds 1/2/3 (499/18/32, 3 missing): mapping unknown.
  //    Sex: paper says only "sex"; header 1/2 (286/266): mapping unknown (used nowhere).
  //    Rec. type: header 1/2/12/-1; paper says only "type of measurement (ultrasound or direct scalp electrode)": mapping unknown.
  //  Units NOT stated in either source: pCO2 (header median 7.0, range 0.7-12.3: consistent with kPa, not mmHg, but
  //    unconfirmed) and BDecf (median 4.13, range -3.4 to 26.11: mmol/L is the standard unit, unconfirmed).
  //    The app shows pCO2 in kPa and BDecf in mmol/L and flags both in the review queue for the reviewer to confirm.
  mkdirSync(OUT_MEDIA_DIR, { recursive: true });
  const ids = (await fetchText("RECORDS")).trim().split("\n");
  const headers = (await pool(ids, async (id) => decodeHeader(await fetchText(id + ".hea")))).filter((h) => h.clinical["pH"] != null);
  // Stage A (headers only): up to 30 per pH band (about 90 .dat files, under 15 MB, in memory only).
  const band = (ph) => (ph >= 7.2 ? 0 : ph >= 7.05 ? 1 : 2);
  const perBand = [[], [], []];
  headers.forEach((h) => { const b = band(h.clinical["pH"]); if (perBand[b].length < 30) perBand[b].push(h); });
  // Stage B: features for each candidate, in memory only.
  const cands = (await pool(perBand.flat(), async (h) => {
    const raw = decodeSignal(await fetchBuf(h.record + ".dat"), h);
    const fhr = toPhysical(raw[0], h.signals[0]), uc = toPhysical(raw[1], h.signals[1]);
    const features = extractFIGOFeatures(fhr, uc, h.fs);
    if (!features || features.quality.suboptimal) return null;
    const n = Math.min(fhr.length, CFG.STRIP_MIN * 60 * h.fs);
    const sFhr = fhr.slice(fhr.length - n), sUc = uc.slice(uc.length - n);
    const stripQ = stripQuality(sFhr, sUc);
    if (stripQ.fhrLossPct > STRIP_MAX_FHR_LOSS || stripQ.ucPresentPct < STRIP_MIN_UC_PRESENT) return null;
    return { id: h.record, h, fhr: sFhr, uc: sUc, features, stripQuality: stripQ, acidosis: acidosisClass(h.clinical) };
  })).filter(Boolean);
  const chosen = pickCases(cands);
  const cases = chosen.map(caseFrom);
  // The quality note needs the raw signal, so it is written into the deck too: the Review Desk shows it per case.
  cases.forEach((c, i) => { c.qualityNote = stripQualityNote(chosen[i], c); });
  writeFileSync(OUT_DECK, JSON.stringify({ v: 2, id: "ctg", cases }, null, 1));
  mkdirSync("docs/tokos", { recursive: true });
  writeReviewQueue(cases, cases.map((c) => c.qualityNote));
  console.log("wrote " + cases.length + " cases; archetypes: " + cases.map((c) => c.archetypeSuggested).join(", "));
}

// ---------- extension: scan all 552 records for the archetypes the first 90 did not give ----------
// FIGO 2015 sinusoidal pattern (guideline text read 2026-09-29): a regular, smooth, undulating signal resembling a
// sine wave, amplitude 5-15 bpm, 3-5 cycles per minute, lasting more than 30 min, with absent accelerations.
// Detection is a screen for the reviewer, not a diagnosis: 5-minute blocks pass when at least half of the detrended
// power sits at 3-5 cycles per minute, the peak-to-trough range (5th to 95th percentile) is 5-15 bpm, and there is no
// acceleration (15 bpm above baseline for 15 s); 7 blocks in a row (35 min) count as "found", 3 in a row as "near".
export const SINUS = { CPM_MIN: 3, CPM_MAX: 5, AMP_MIN: 5, AMP_MAX: 15, BLOCK_MIN: 5, MIN_BLOCKS: 7, NEAR_BLOCKS: 3, BAND_FRAC: 0.5, MIN_VALID: 0.85 };

export function detectSinusoidalLike(fhrAll, fs, baseline) {
  const n = Math.min(fhrAll.length, CFG.WINDOW_MIN * 60 * fs);
  const fhr = fhrAll.slice(fhrAll.length - n);
  const sec = Math.floor(n / fs), B = SINUS.BLOCK_MIN * 60, nb = Math.floor(sec / B);
  const x = new Float64Array(sec); // 1 Hz series: mean of the valid samples in each second
  for (let t = 0; t < sec; t++) {
    let sum = 0, c = 0;
    for (let j = 0; j < fs; j++) { const v = fhr[t * fs + j]; if (ok(v)) { sum += v; c++; } }
    x[t] = c ? sum / c : NaN;
  }
  const flags = [];
  for (let k = 0; k < nb; k++) {
    const seg = Array.from(x.subarray(k * B, (k + 1) * B));
    if (seg.filter(Number.isFinite).length < B * SINUS.MIN_VALID) { flags.push(false); continue; }
    for (let i = 0; i < B; i++) { // fill dropouts by linear interpolation (nearest value at the ends)
      if (Number.isFinite(seg[i])) continue;
      let l = i - 1, r = i + 1;
      while (l >= 0 && !Number.isFinite(seg[l])) l--;
      while (r < B && !Number.isFinite(seg[r])) r++;
      seg[i] = l < 0 ? seg[r] : r >= B ? seg[l] : seg[l] + ((seg[r] - seg[l]) * (i - l)) / (r - l);
    }
    const pre = [0]; seg.forEach((v, i) => pre.push(pre[i] + v));
    const d = seg.map((v, i) => { const a = Math.max(0, i - 30), b = Math.min(B, i + 31); return v - (pre[b] - pre[a]) / (b - a); }); // minus a 61 s centred mean
    let band = 0, all = 0;
    for (let f = 0.6; f <= 10.001; f += 0.2) {
      const w = (2 * Math.PI * f) / 60; let re = 0, im = 0;
      for (let t = 0; t < B; t++) { re += d[t] * Math.cos(w * t); im += d[t] * Math.sin(w * t); }
      const pw = re * re + im * im; all += pw;
      if (f >= SINUS.CPM_MIN - 0.001 && f <= SINUS.CPM_MAX + 0.001) band += pw;
    }
    const s = d.slice().sort((a, b) => a - b), amp = pct(s, 0.95) - pct(s, 0.05);
    let run = 0, accel = false;
    for (let t = 0; t < B; t++) { if (seg[t] >= baseline + 15) { if (++run >= 15) accel = true; } else run = 0; }
    flags.push(all > 0 && band / all >= SINUS.BAND_FRAC && amp >= SINUS.AMP_MIN && amp <= SINUS.AMP_MAX && !accel);
  }
  let longest = 0, cur = 0;
  flags.forEach((f) => { cur = f ? cur + 1 : 0; longest = Math.max(longest, cur); });
  return { blocks: flags.length, longestRunBlocks: longest, minutes: longest * SINUS.BLOCK_MIN, found: longest >= SINUS.MIN_BLOCKS, near: longest >= SINUS.NEAR_BLOCKS };
}

// Adds up to maxNew cases to the committed deck (the first 12 stay byte for byte as they are) from a scan of every
// record, in memory. Prints what the scan found. Run --queue-only afterwards to refresh docs/tokos/review-queue.md.
export async function mainExtend(maxNew = 8) {
  const deckText = readFileSync(OUT_DECK, "utf8");
  const deck = JSON.parse(deckText);
  if (JSON.stringify(deck, null, 1) !== deckText) throw new Error(OUT_DECK + " does not round-trip through JSON.stringify(_, null, 1); refusing to rewrite it");
  const have = new Set(deck.cases.map((c) => c.id));
  mkdirSync(OUT_MEDIA_DIR, { recursive: true });
  const ids = (await fetchText("RECORDS")).trim().split("\n");
  const headers = (await pool(ids, async (id) => decodeHeader(await fetchText(id + ".hea")))).filter((h) => h.clinical["pH"] != null);
  const scan = { records: ids.length, withPH: headers.length, decoded: 0, extracted: 0, gatePassed: 0, tachysystole: 0, reduced: 0, sinusoidalFound: 0, sinusoidalNear: 0, maxLongestRunBlocks: 0 };
  const cands = (await pool(headers, async (h) => {
    const raw = decodeSignal(await fetchBuf(h.record + ".dat"), h);
    scan.decoded++;
    const fhrAll = toPhysical(raw[0], h.signals[0]), ucAll = toPhysical(raw[1], h.signals[1]);
    const features = extractFIGOFeatures(fhrAll, ucAll, h.fs);
    if (!features) return null;
    scan.extracted++;
    if (features.quality.suboptimal) return null;
    const n = Math.min(fhrAll.length, CFG.STRIP_MIN * 60 * h.fs);
    const sFhr = fhrAll.slice(fhrAll.length - n), sUc = ucAll.slice(ucAll.length - n);
    const stripQ = stripQuality(sFhr, sUc);
    if (stripQ.fhrLossPct > STRIP_MAX_FHR_LOSS || stripQ.ucPresentPct < STRIP_MIN_UC_PRESENT) return null;
    scan.gatePassed++;
    const sinus = detectSinusoidalLike(fhrAll, h.fs, features.baseline);
    scan.maxLongestRunBlocks = Math.max(scan.maxLongestRunBlocks, sinus.longestRunBlocks);
    // per10 above 8 is more likely a noisy toco than 8 real contractions in 10 min, so it is not offered as tachysystole.
    const tachy = features.contractions.tachysystole && features.contractions.per10 <= 8, red = features.variability.band === "reduced";
    if (tachy) scan.tachysystole++;
    if (red) scan.reduced++;
    if (sinus.found) scan.sinusoidalFound++;
    else if (sinus.near) scan.sinusoidalNear++;
    if (!(tachy || red || sinus.found) || have.has(h.record)) return null;
    return { id: h.record, h, fhr: sFhr, uc: sUc, features, stripQuality: stripQ, acidosis: acidosisClass(h.clinical), sinus, tachy, red };
  })).filter(Boolean);
  const order = (a, b) => (a.features.contractions.count30 > 0 ? 0 : 1) - (b.features.contractions.count30 > 0 ? 0 : 1) || a.features.quality.lossPct - b.features.quality.lossPct;
  const used = new Set(), out = [];
  const take = (arch, n, test) => cands.filter((k) => !used.has(k.id) && test(k)).sort(order).slice(0, n).forEach((k) => { used.add(k.id); out.push(Object.assign({ archetypeSuggested: arch }, k)); });
  take("sinusoidal_like", 2, (k) => k.sinus.found);
  take("tachysystole", 3, (k) => k.tachy);
  take("reduced_variability", 3, (k) => k.red);
  take("tachysystole", maxNew - out.length, (k) => k.tachy);
  take("reduced_variability", maxNew - out.length, (k) => k.red);
  const fresh = out.slice(0, maxNew).map((k) => { const c = caseFrom(k); c.qualityNote = stripQualityNote(k, c); return c; });
  deck.cases.push(...fresh);
  writeFileSync(OUT_DECK, JSON.stringify(deck, null, 1));
  console.log("scan " + JSON.stringify(scan));
  console.log("added " + fresh.length + ": " + fresh.map((c) => c.id + " " + c.archetypeSuggested + " figo " + c.figo + " per10 " + c.features.contractions.per10 + " var " + c.features.variability.band + " pH " + c.outcome.pH).join("; "));
}

// ---------- docs/tokos/review-queue.md: the obstetrician's sign-off instrument ----------
const QUEUE = "docs/tokos/review-queue.md";
// Everything from this line down is hand-maintained; a regeneration keeps it as it is.
export const HAND_MARK = "<!-- hand-maintained below: tools/tokos-ctg-prep.mjs keeps this section on regeneration -->";

export function reviewQueueMd(cases, qNotes, rationaleKeys, hand) {
  const Q = createRequire(import.meta.url)("../tokos-data.js").QUESTIONS;
  const vals = (q) => Q[q].map((v) => "`" + v + "`").join(", ");
  const decelText = (c) => (c.features.decels.length ? c.features.decels.map((d) => d.durationSec + " s " + d.subtypeSuggested + " (suggested)").join(", ") : "none");
  const head = [
    "# Tokós CTG review queue", "",
    "Reviews are done in the app: Review Desk (Home > Add Tool > Review content), Tokós tab. Each case and each block of teaching text is one item there; Read it opens the case in Tokós. The reviewer approves, approves after minor edits, or asks for changes, then exports, and the owner applies the export with `node scripts/apply-reviews.mjs <file.json>`. This file remains the pipeline notes: the suggested labels, outcome and quality note per case, and the field reference below.", "",
    "Tokós is on for all users while the app is in testing (owner decision 2026-09-29). Until a case has a complete review the app shows its labels as \"Rule-based, pending obstetrician review\".", "",
    "## How a review is recorded", "",
    "Approving a case in the Review Desk sets `review` on the case in `tokos/decks/ctg.json` to the suggested labels as approved (a correction goes through Needs changes, then an edit here by hand). Every field the app reads:", "",
    "- `by`, `date` (`YYYY-MM-DD`): who reviewed and when.",
    "- `uc`: " + vals("uc") + ". Contractions answer.",
    "- `baselineClass`: " + vals("baseline") + ". Baseline answer.",
    "- `variability`: " + vals("variability") + ". Variability answer.",
    "- `decels`: " + vals("decels") + ". Decelerations answer.",
    "- `decelType`: " + vals("decelType") + ". Setting it also turns on the Resident deceleration type question for this case.",
    "- `figo`: " + vals("figo") + ". Overall category; the Resident Next step answer follows it.",
    "- `complete`: `true` only when every graded field above was checked for this case (a field left out means you agree with the suggested label). This is the only thing that removes the rule-based banner.", "",
    "A field left out keeps the suggested label. A value not in its list is ignored and the suggested label is used.", "",
    "## Content to review", "",
    "- `tokos/rationale.json`: all " + rationaleKeys.length + " teaching points shown under Why on the reveal, English and Hindi: " + rationaleKeys.map((k) => "`" + k + "`").join(", ") + ".",
    "- `tokos.js`, `L10N.en.opts` and `L10N.hi.opts`: the checklist option labels, and under `action` the three FIGO next-step strings graded at Resident level.",
    "- `tokos-calipers.js`, `WORDS`: the caliper verdict text (variability bands for a bpm range, deceleration length bands for a time span), English and Hindi.", "",
    "## Units and fields", "",
    "Please also confirm units: the sources do not state them for pCO2 and BDecf. The app shows pCO2 in kPa (header median 7.0, range 0.7 to 12.3) and BDecf in mmol/L. Risk-factor and Induced fields are not shown because their 0/1 coding is unconfirmed.", "",
  ].join("\n");
  const body = cases.map((c, i) => "## " + c.id + " (" + c.archetypeSuggested + ")\n- Trace: `tokos/media/" + c.svg + "`\n- Suggested FIGO: " + c.figo + "; baseline " + c.features.baseline + " (" + c.features.baselineClass + "); variability " + c.features.variability.band + " (median range " + c.features.variability.medianRange + " bpm, reduced " + c.features.variability.reducedMin + " min); decelerations " + decelText(c) + "; contractions " + c.features.contractions.per10 + " per 10 min\n- Outcome: pH " + c.outcome.pH + ", BDecf " + c.outcome.BDecf + ", acidosis " + c.acidosis + "\n- Quality note: " + qNotes[i] + "\n").join("\n");
  return head + "\n" + body + "\n" + (hand || HAND_MARK + "\n");
}
function writeReviewQueue(cases, qNotes) {
  const old = existsSync(QUEUE) ? readFileSync(QUEUE, "utf8") : "";
  const at = old.indexOf(HAND_MARK);
  const R = JSON.parse(readFileSync("tokos/rationale.json", "utf8"));
  writeFileSync(QUEUE, reviewQueueMd(cases, qNotes, Object.keys(R).filter((k) => k !== "v" && !/^review/.test(k)), at >= 0 ? old.slice(at) : null));
}
// --queue-only: rewrite the queue from the committed deck without touching the network, the deck or the SVGs.
// Quality notes need the raw signal, so they come from the deck (case.qualityNote, written by the full run).
function queueOnly() {
  const cases = JSON.parse(readFileSync(OUT_DECK, "utf8")).cases;
  const notes = cases.map((c) => {
    if (!c.qualityNote) throw new Error("no qualityNote for case " + c.id + " in " + OUT_DECK + "; run the full pipeline");
    return c.qualityNote;
  });
  writeReviewQueue(cases, notes);
  console.log("rewrote " + QUEUE + " for " + cases.length + " cases");
}

if (import.meta.url === "file://" + process.argv[1]) {
  if (process.argv.includes("--queue-only")) queueOnly();
  else if (process.argv.includes("--extend")) mainExtend().catch((e) => { console.error(e); process.exit(1); });
  else mainV2().catch((e) => { console.error(e); process.exit(1); });
}
