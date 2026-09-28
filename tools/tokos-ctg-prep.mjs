import { writeFileSync, mkdirSync } from "node:fs";

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
    let d = "";
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      if (v < 50 && yFn === yFhr) { d += " "; continue; } // gap on dropout, don't draw a false flat line
      d += (d.endsWith(" ") || !d ? "M" : "L") + x(i).toFixed(1) + "," + yFn(v).toFixed(1) + " ";
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
      citation: "Chudacek V, Spilka J, Bursa M, et al. Open access intrapartum CTG database. BMC Pregnancy Childbirth. 2014;14:16.",
      changes: "Decoded from WFDB signal format; baseline/variability/deceleration features computed by a simplified rule-based script, not an expert annotation; rendered as an SVG line trace of the last 10 minutes before delivery.",
    },
  }, null, 2));
  console.log("wrote " + cases.length + " cases");
}

if (import.meta.url === "file://" + process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
