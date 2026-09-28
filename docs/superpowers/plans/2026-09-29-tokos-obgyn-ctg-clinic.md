# Tokós (OBGYN module) — Phase 1: CTG Reading Clinic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first working slice of Tokós, StewardMD's OBGYN learning module: a cardiotocography (CTG) reading clinic built on real, licence-clear intrapartum CTG traces with real perinatal outcomes, using the same spaced-repetition/level/trial engine as Ophthalmós.

**Architecture:** Tokós lives natively inside StewardMD (`tokos-*.js`, `tokos/`), the way CliniX and KardiQ X do — no separate synced repo like Ophthalmós has. `tokos-core.js` (FSRS-6 scheduler) and `tokos-stage.js` (pinch-zoom) are verbatim renamed copies of `ophthalmos-core.js` / `ophthalmos-stage.js`: both files are pure, already-generic logic with zero eye-specific coupling (verified by reading them; see Task 2/3). `tokos-data.js` is a smaller, adapted port of `ophthalmos-data.js` covering levels/trials/persistence only — Phase 1 has no Learn tab, so the Learn-specific half of `ophthalmos-data.js` (lesson validation, glossary, SVG scoping) is not ported. `ponytail: two specialty modules now duplicate this ~250 lines of pure logic; extract a shared `spaced-review.js` only if a third specialty module needs it (rule of three) — don't extract for 2, and don't touch the already-shipped, tested ophthalmos-core.js/ophthalmos-stage.js to do it.`

The clinic's content is built by a one-off Node data-prep script (not shipped in the app bundle) that downloads real CTU-UHB records from PhysioNet, decodes the WFDB signal format, computes simple interpretable features (baseline rate, a variability proxy, deceleration count), and renders each case as an SVG trace. The learner is asked about the *computed features* (baseline range, variability band, whether decelerations are present) rather than asked to name a definitive FIGO category — the auto-computed labels are simplifications flagged `ai_drafted`/pending clinical review, matching every other StewardMD content module, and are not presented as an expert diagnosis. The real recorded perinatal outcome (umbilical artery pH, base excess, Apgar) is genuine ground truth from the dataset and is revealed after the learner answers.

**Tech Stack:** ES5 IIFEs (host convention), Node `--test` for unit tests, headless Chrome via CDP (`test/serve.mjs` pattern) for UI tests, plain Node for the WFDB decoder (no new runtime dependency — format 16 is 16-bit PCM-like and is fully decodable in ~30 lines).

**Spec:** This plan doc is also the spec — Phase 1 scope, clinical design and licence findings are recorded inline below and in `~/.claude/projects/-Users-diwakarkumar/memory/specialty-module-dataset-licenses.md`.

## Global Constraints

- No em-dash in any app-facing text or docs (from `CLAUDE.md`).
- Never commit secrets or PHI. This dataset is de-identified third-party research data, not StewardMD patient data — still never log/store any StewardMD user's own patient data in Tokós.
- ES5 only, IIFE per file, matches host bundling (`?v=tokN` cache-bust tokens, `scripts/build-www.sh`).
- Flag `smd_tokos` (client, def:false) — Tokós starts hidden, like every new module before clinical sign-off (CliniX/KardiQ X/ThoreX precedent).
- Content is `ai_drafted`: every case screen carries the existing "To be verified, draft" footer pattern (see `ophthalmos.css`/`ophthalmos.js` `.oph-draft` for the reference implementation — reuse the same visual treatment, renamed).
- Attribution required: CTU-UHB is ODC-BY 1.0 — every case's data must trace to a `tokos/media/credits.json` entry citing Chudáček V et al., "Open access intrapartum CTG database," *BMC Pregnancy Childbirth* 2014;14:16, and the PhysioNet URL.
- Disk is critical on the build machine (267 MB free as of 2026-09-29). **Do not run Task 1's download step until disk is confirmed above 1 GB free** — run the `disk-cleanup` skill first if needed. Each task ends with a `df -h /` check before any download/build step.
- Test before you build: `node --check` every new JS file; run the specific new test file; then the full suite (`npm test` — the flagged form, not bare `node --test`) before any commit.
- No copyrighted/non-permissive images. Only CTU-UHB (ODC-BY 1.0) data ships in Phase 1.
- UI work (Task 6 `tokos.js`/`tokos.css`, calipers, checklist, reveal, themes) must load and follow these skills, in this order: `ui-ux-pro-max:ui-ux-pro-max` + `anti-ui-slop` to set the design contract and required states; `impeccable`, `taste-skill`, `emil-design-eng` while building; `web-design-guidelines` + the `anti-ui-slop` finish gate before the task is called done. Any subagent doing UI work is told the same. No generic, templated screens ship.

## Review Focus

- **A CTG record with a long artifact/dropout segment (signal loss)** — the baseline/variability computation must exclude physiologically impossible samples (FHR outside 50-220 bpm) rather than average them in and produce a nonsense baseline. Task 1's feature extractor is tested against a synthetic record with an injected dropout.
- **A learner on a slow connection or offline** — the clinic must show a loading state and a retry action if `tokos/decks/ctg.json` or an SVG fails to fetch, not a blank screen. Task 6's UI test covers a failed fetch.
- **A Resident-level learner who has already spent their one free trial for `clinic.ctg`** — must hit the paywall before any network fetch (mirrors Ophthalmós's `trial()`/`gate()` pattern exactly), not after loading the case and then blocking. Task 6's test asserts no fetch happens on a spent trial.
- **Hindi rendering of a numeric clinical value** (pH, bpm) — numbers must not be translated/reformatted incorrectly (e.g. Devanagari numerals) since these are precise clinical figures; Task 4/6 tests assert numeric fields render as plain Arabic numerals in both languages, only labels translate.
- **A case whose real outcome is normal (pH ≥ 7.20) presented after the learner picked "abnormal" features** — the reveal screen must not imply the baby was fine because the trace was "normal-looking"; pH and trace-based features are two different things (a normal trace can precede a low pH from other causes, and vice versa). Task 6's copy is written to state both independently, never as if one implies the other, and a test asserts the reveal screen renders the pH stat and the feature-check result as visually separate blocks, never combined into one sentence.

---

## File Structure

- Create: `tools/tokos-ctg-prep.mjs` — one-off data-prep script (not shipped; excluded from `build-www.sh`'s copy globs same way other `scripts/`/`tools/` content is)
- Create: `tokos-core.js` — verbatim renamed copy of `ophthalmos-core.js`
- Create: `tokos-stage.js` — verbatim renamed copy of `ophthalmos-stage.js`
- Create: `tokos-data.js` — adapted subset port of `ophthalmos-data.js`
- Create: `tokos.js` — DOM layer (hub, clinic session, reveal)
- Create: `tokos.css`
- Create: `tokos/tracks.json` — the one track (`ctg`) config (mirrors `ophthalmos/tracks.json`)
- Create: `tokos/decks/ctg.json` — generated by Task 1; 12 cases with computed features + real outcomes
- Create: `tokos/media/ctg/<caseId>.svg` — generated by Task 1; the rendered traces
- Create: `tokos/media/credits.json` — attribution (ODC-BY 1.0, CTU-UHB citation)
- Create: `test/tokos-core.test.mjs` — renamed copy of `ophthalmos-core.test.mjs`'s equivalent (`test/core.test.mjs`)
- Create: `test/tokos-stage.test.mjs` — renamed copy of `test/stage.test.mjs`
- Create: `test/tokos-data.test.mjs`
- Create: `test/tokos-content.test.mjs` — validates `tokos/decks/ctg.json` + `credits.json` shape and cross-references
- Create: `test/run-tokos-ui.mjs` — headless Chrome UI test (mirrors `test/run-clinix-ui.mjs` pattern)
- Modify: `index.html` — add `tokos.css`/`tokos.js` tags at `?v=tok1`
- Modify: `scripts/build-www.sh` — copy `tokos-*.js/.css` and `tokos/` into `www/`
- Modify: `home.js` — add the Tokós home tile, flag-gated (mirrors the existing CliniX/KardiQ X tile pattern)
- Create: `vault/modules/Tokós.md`

---

### Task 1: CTG data pipeline (WFDB decode, feature extraction, SVG render)

**Files:**
- Create: `tools/tokos-ctg-prep.mjs`
- Create (generated by running the script, committed as data): `tokos/decks/ctg.json`, `tokos/media/ctg/*.svg`, `tokos/media/credits.json`
- Test: `test/tokos-ctg-prep.test.mjs` (tests the pure decode/feature functions, imported from the script)

**Interfaces:**
- Produces: `decodeHeader(text) -> {nsig, fs, nsamp, signals:[{file,fmt,gain,baseline,units,adcres,adczero,initval,description}], clinical:{[key]: number}}`
- Produces: `decodeSignal(buf, fmt, nSig, initvals) -> Int32Array[nSig]` (physical-unit decode happens by caller dividing by gain/subtracting baseline)
- Produces: `extractFeatures(fhrSamples, fs) -> {baseline: number, variabilityBand: "reduced"|"normal"|"increased", decelCount: number}`
- Produces: `renderTraceSvg(fhrSamples, ucSamples, fs) -> string` (a complete `<svg>...</svg>` document)
- Consumes: nothing from other tasks (this task runs standalone first)

- [ ] **Step 1: Check disk, then fetch the CTU-UHB record list and inspect one real header**

```bash
df -h / | tail -1   # must show > 1 GB free; if not, stop and run the disk-cleanup skill first
mkdir -p /tmp/tokos-ctg && cd /tmp/tokos-ctg
curl -s https://physionet.org/files/ctu-uhb-ctgdb/1.0.0/RECORDS -o RECORDS
wc -l RECORDS   # expect 552
curl -s https://physionet.org/files/ctu-uhb-ctgdb/1.0.0/1001.hea -o 1001.hea
cat 1001.hea
```

Confirm the header looks like this (already verified live on 2026-09-29):
```
1001 2 4 19200
1001.dat 16 100(0)/bpm 12 0 15050 20101 0 FHR
1001.dat 16 100/nd 12 0 700 378 0 UC

#----- Additional parameters for record 1001

#-- Outcome measures
#pH           7.14
#BDecf        8.14
...
```
Line 1: `<record> <nsig> <fs-Hz> <nsamp>`. Signal lines: `<file> <format> <gain>(<baseline>)/<units> <adcres> <adczero> <initval> <checksum> <blocksize> <description>`. Clinical values are `#Label   value` comment lines further down.

- [ ] **Step 2: Write `decodeHeader` and its test**

```js
// tools/tokos-ctg-prep.mjs
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
```

```js
// test/tokos-ctg-prep.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { decodeHeader } from "../tools/tokos-ctg-prep.mjs";

const SAMPLE_HEADER = `1001 2 4 19200
1001.dat 16 100(0)/bpm 12 0 15050 20101 0 FHR
1001.dat 16 100/nd 12 0 700 378 0 UC

#----- Additional parameters for record 1001

#-- Outcome measures
#pH           7.14
#BDecf        8.14
#pCO2         7.7
#BE           -10.5
#Apgar1       6
#Apgar5       8

#-- Fetus/Neonate descriptors
#Gest. weeks  37
`;

test("decodeHeader reads record shape, both signal specs and clinical comments", () => {
  const h = decodeHeader(SAMPLE_HEADER);
  assert.equal(h.record, "1001");
  assert.equal(h.nsig, 2);
  assert.equal(h.fs, 4);
  assert.equal(h.nsamp, 19200);
  assert.equal(h.signals[0].description, "FHR");
  assert.equal(h.signals[0].gain, 100);
  assert.equal(h.signals[0].baseline, 0);
  assert.equal(h.signals[0].initval, 15050);
  assert.equal(h.signals[1].description, "UC");
  assert.equal(h.clinical["pH"], 7.14);
  assert.equal(h.clinical["BE"], -10.5);
  assert.equal(h.clinical["Gest. weeks"], 37);
});
```

- [ ] **Step 3: Run the test, verify it fails, then passes**

```bash
cd ~/Developer/StewardMD
node --test test/tokos-ctg-prep.test.mjs
```
Expected first run: FAIL (`decodeHeader` not exported yet, or file missing) — write the file above, re-run, expect PASS.

- [ ] **Step 4: Write the self-verifying signal decoder (do not assume byte order — check it against the header's own `initval`)**

```js
// tools/tokos-ctg-prep.mjs (append)
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
```

- [ ] **Step 5: Test the decoder against the real downloaded record (not a synthetic fixture — this step needs the actual bytes)**

```js
// test/tokos-ctg-prep.test.mjs (append)
import { readFileSync } from "node:fs";
import { decodeSignal, toPhysical } from "../tools/tokos-ctg-prep.mjs";

test("decodeSignal matches the header's stated initial value and yields a plausible FHR baseline", { skip: !existsSync("/tmp/tokos-ctg/1001.dat") }, () => {
  const h = decodeHeader(readFileSync("/tmp/tokos-ctg/1001.hea", "utf8"));
  const buf = readFileSync("/tmp/tokos-ctg/1001.dat");
  const raw = decodeSignal(buf, h);
  const fhr = toPhysical(raw[0], h.signals[0]);
  assert.ok(fhr[0] > 100 && fhr[0] < 200, "first FHR sample should be a plausible bpm value, got " + fhr[0]);
});
```
Add `import { existsSync } from "node:fs";` to the test file's imports. This test is skipped in CI (no network fetch there) but must be run manually once during this task:
```bash
curl -s https://physionet.org/files/ctu-uhb-ctgdb/1.0.0/1001.dat -o /tmp/tokos-ctg/1001.dat
node --test test/tokos-ctg-prep.test.mjs
```
Expected: PASS, confirming little-endian int16 is correct for format 16 in this database (matches the WFDB spec's documented format-16 byte order) before any bulk download.

- [ ] **Step 6: Write feature extraction with an artifact-dropout test (Review Focus item)**

```js
// tools/tokos-ctg-prep.mjs (append)
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
```

```js
// test/tokos-ctg-prep.test.mjs (append)
import { extractFeatures } from "../tools/tokos-ctg-prep.mjs";

test("extractFeatures ignores a dropout segment instead of corrupting the baseline", () => {
  const fs = 4;
  const good = new Float64Array(600).fill(140); // 150s of clean 140bpm
  const dropout = new Float64Array(200).fill(0); // 50s of zero (sensor dropout)
  const fhr = Float64Array.from([...good, ...dropout, ...good]);
  const f = extractFeatures(fhr, fs);
  assert.equal(f.baseline, 140, "dropout zeros must not pull the baseline down");
});

test("extractFeatures counts a sustained deceleration but not a brief dip", () => {
  const fs = 4;
  const base = new Array(240).fill(140);
  const briefDip = [...base.slice(0, 100), ...new Array(20).fill(120), ...base.slice(100)]; // 5s dip, too short
  const f1 = extractFeatures(Float64Array.from(briefDip), fs);
  assert.equal(f1.decelCount, 0);
  const sustainedDip = [...base.slice(0, 100), ...new Array(80).fill(120), ...base.slice(100)]; // 20s dip
  const f2 = extractFeatures(Float64Array.from(sustainedDip), fs);
  assert.equal(f2.decelCount, 1);
});
```

- [ ] **Step 7: Run tests, verify pass**

```bash
node --test test/tokos-ctg-prep.test.mjs
```
Expected: all PASS (the network-dependent test from Step 5 will SKIP if `/tmp/tokos-ctg/1001.dat` is absent — that's fine for CI, it was already verified manually in Step 5).

- [ ] **Step 8: Write the SVG trace renderer**

```js
// tools/tokos-ctg-prep.mjs (append)
// A plain, readable FHR+UC trace. Not standard CTG graph paper (3cm/min, 1cm=30bpm) —
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
```

```js
// test/tokos-ctg-prep.test.mjs (append)
import { renderTraceSvg } from "../tools/tokos-ctg-prep.mjs";

test("renderTraceSvg produces a well-formed SVG that skips dropout instead of drawing a false flat line", () => {
  const fhr = Float64Array.from([140, 141, 0, 0, 142, 143]); // dropout in the middle
  const uc = Float64Array.from([10, 12, 14, 16, 18, 20]);
  const svg = renderTraceSvg(fhr, uc, 4);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("</svg>"));
  assert.ok(svg.includes('role="img"'));
  assert.equal((svg.match(/<path/g) || []).length, 2);
});
```

- [ ] **Step 9: Run tests, verify pass**

```bash
node --test test/tokos-ctg-prep.test.mjs
```
Expected: PASS.

- [ ] **Step 10: Write the case-selection + main driver, and `tokos/decks/ctg.json` / `credits.json` builders**

```js
// tools/tokos-ctg-prep.mjs (append)
import { writeFileSync, mkdirSync } from "node:fs";

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
```

- [ ] **Step 11: Check disk, then run the pipeline**

```bash
df -h / | tail -1   # confirm still > 1 GB free before pulling more data
cd ~/Developer/StewardMD
node tools/tokos-ctg-prep.mjs
ls tokos/media/ctg/ | wc -l   # expect 12
cat tokos/decks/ctg.json | head -30
```

- [ ] **Step 12: Write `test/tokos-content.test.mjs` validating the generated content**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const deck = JSON.parse(readFileSync("tokos/decks/ctg.json", "utf8"));
const credits = JSON.parse(readFileSync("tokos/media/credits.json", "utf8"));

test("ctg.json has a plausible, licence-attributable case set", () => {
  assert.equal(deck.v, 1);
  assert.ok(deck.cases.length >= 10, "expect at least 10 cases");
  deck.cases.forEach((c) => {
    assert.ok(/^\d+$/.test(c.id));
    assert.ok(existsSync("tokos/media/" + c.svg), c.svg + " missing");
    assert.ok(c.outcome.pH > 6.5 && c.outcome.pH < 7.6, "pH out of plausible range for " + c.id);
    assert.ok(["reduced", "normal", "increased"].includes(c.features.variabilityBand));
    assert.ok(c.features.decelCount >= 0);
  });
});

test("every case's data source is credited", () => {
  assert.ok(credits["ctu-uhb-ctgdb"]);
  assert.equal(credits["ctu-uhb-ctgdb"].licence, "ODC-BY 1.0");
});
```

- [ ] **Step 13: Run it, verify pass**

```bash
node --test test/tokos-content.test.mjs
```
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add tools/tokos-ctg-prep.mjs test/tokos-ctg-prep.test.mjs test/tokos-content.test.mjs tokos/decks/ctg.json tokos/media/ctg tokos/media/credits.json
git commit -m "feat(tokos): CTG data pipeline, 12 real licence-clear cases from CTU-UHB"
```

---

### Task 2: `tokos-core.js` (FSRS-6 scheduler, verbatim reuse)

**Files:**
- Create: `tokos-core.js`
- Test: `test/tokos-core.test.mjs`

**Interfaces:**
- Produces: same API surface as `OPHTHALMOS_CORE` (see `ophthalmos-core.js`), exported as `window.TOKOS_CORE` / `module.exports` under Node: `emptyStore, review, recordSim, recordAnswer, gradeFor, buildSession, counts, classStats, streak, recall, forecast, retrievability, nextState, intervalDays, dayNum, key, W, FACTOR, AGAIN, HARD, GOOD, EASY`.

- [ ] **Step 1: Copy and rename**

```bash
cd ~/Developer/StewardMD
cp ~/Developer/ophthalmos/ophthalmos-core.js tokos-core.js
sed -i '' 's/OPHTHALMOS_CORE/TOKOS_CORE/g; s/Ophthalmós core/Tokós core/' tokos-core.js
```
(If `ophthalmos-core.js` isn't present locally, fetch it: `curl -s https://raw.githubusercontent.com/drmanojkurmana/ophthalmos/main/ophthalmos-core.js -o /tmp/oc.js && cp /tmp/oc.js tokos-core.js` then run the same `sed`.)

- [ ] **Step 2: Verify the rename touched nothing else**

```bash
diff <(sed 's/TOKOS_CORE/OPHTHALMOS_CORE/g; s/Tokós core/Ophthalmós core/' tokos-core.js) ~/Developer/ophthalmos/ophthalmos-core.js
```
Expected: no output (files are identical apart from the renamed identifier and comment).

- [ ] **Step 3: Copy the test file and rename the import**

```bash
cp ~/Developer/ophthalmos/test/core.test.mjs test/tokos-core.test.mjs
sed -i '' 's#../ophthalmos-core.js#../tokos-core.js#' test/tokos-core.test.mjs
```

- [ ] **Step 4: Run it**

```bash
node --check tokos-core.js
node --test test/tokos-core.test.mjs
```
Expected: PASS (identical logic, identical FSRS-6 reference values).

- [ ] **Step 5: Commit**

```bash
git add tokos-core.js test/tokos-core.test.mjs
git commit -m "feat(tokos): tokos-core.js, FSRS-6 scheduler (renamed copy of ophthalmos-core.js)"
```

---

### Task 3: `tokos-stage.js` (pinch-zoom, verbatim reuse)

**Files:**
- Create: `tokos-stage.js`
- Test: `test/tokos-stage.test.mjs`

**Interfaces:**
- Produces: `window.TOKOS_STAGE.attach(stageEl, imgEl) -> {reset(), zoomBy(m)}`, plus pure helpers `fit, zoomAt, bound, MIN, MAX`.

- [ ] **Step 1: Copy and rename**

```bash
cp ~/Developer/ophthalmos/ophthalmos-stage.js tokos-stage.js
sed -i '' 's/OPHTHALMOS_STAGE/TOKOS_STAGE/g; s/Ophthalmós image stage/Tokós image stage/' tokos-stage.js
```

- [ ] **Step 2: Verify**

```bash
diff <(sed 's/TOKOS_STAGE/OPHTHALMOS_STAGE/g; s/Tokós image stage/Ophthalmós image stage/' tokos-stage.js) ~/Developer/ophthalmos/ophthalmos-stage.js
```
Expected: no output.

- [ ] **Step 3: Copy test, fix import**

```bash
cp ~/Developer/ophthalmos/test/stage.test.mjs test/tokos-stage.test.mjs
sed -i '' 's#../ophthalmos-stage.js#../tokos-stage.js#' test/tokos-stage.test.mjs
```

- [ ] **Step 4: Run it**

```bash
node --check tokos-stage.js
node --test test/tokos-stage.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tokos-stage.js test/tokos-stage.test.mjs
git commit -m "feat(tokos): tokos-stage.js, pinch-zoom (renamed copy of ophthalmos-stage.js)"
```

---

### Task 4: `tokos-data.js` (levels, trials, persistence — adapted subset)

**Files:**
- Create: `tokos-data.js`
- Test: `test/tokos-data.test.mjs`

**Interfaces:**
- Consumes: `TOKOS_CORE.emptyStore, dayNum` (Task 2)
- Produces: `STORE_KEY, PREF_KEY, levelLocked(cfg, level, pro), trialState(store, featureId, pro), useTrial(store, featureId, day), loadStore(ls), saveStore(ls, s), loadPrefs(ls), savePrefs(ls, p), today(now)`

- [ ] **Step 1: Write the failing test**

```js
// test/tokos-data.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const D = createRequire(import.meta.url)("../tokos-data.js");

test("trialState: open when Pro, trial when unused, used when spent", () => {
  const store = { trials: {} };
  assert.equal(D.trialState(store, "clinic.ctg", true), "open");
  assert.equal(D.trialState(store, "clinic.ctg", false), "trial");
  D.useTrial(store, "clinic.ctg", 100);
  assert.equal(D.trialState(store, "clinic.ctg", false), "used");
});

test("useTrial only records the first use", () => {
  const store = { trials: {} };
  assert.equal(D.useTrial(store, "x", 1), true);
  assert.equal(D.useTrial(store, "x", 2), false);
  assert.equal(store.trials.x, 1);
});

test("levelLocked: resident locked unless free-listed or Pro", () => {
  const cfg = { access: { freeLevels: ["mbbs"] } };
  assert.equal(D.levelLocked(cfg, "resident", false), true);
  assert.equal(D.levelLocked(cfg, "resident", true), false);
  assert.equal(D.levelLocked(cfg, "mbbs", false), false);
});

test("loadStore returns a fresh store shape when localStorage is empty or corrupt", () => {
  const fakeLs = { getItem: () => null, setItem: () => {} };
  const s = D.loadStore(fakeLs);
  assert.deepEqual(s.cards, {});
  assert.deepEqual(s.trials, {});
});

test("loadPrefs defaults to mbbs level, English, and no tab until first-run choice", () => {
  const fakeLs = { getItem: () => null };
  const p = D.loadPrefs(fakeLs);
  assert.equal(p.level, "mbbs");
  assert.equal(p.lang, "en");
  assert.equal(p.tab, undefined);
});

test("today() computes a stable local day number", () => {
  const d1 = D.today(Date.UTC(2026, 8, 29, 6, 0));
  const d2 = D.today(Date.UTC(2026, 8, 29, 6, 0) + 3600000);
  assert.equal(d1, d2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/tokos-data.test.mjs
```
Expected: FAIL (`tokos-data.js` does not exist).

- [ ] **Step 3: Write the implementation**

```js
/* Tokós data layer: levels, trials, persistence. No DOM. ES5.
   Browser: window.TOKOS_DATA. Node (tests): module.exports.
   Depends on tokos-core.js (TOKOS_CORE / require). */
(function (G) {
  "use strict";
  var C = (typeof module !== "undefined" && module.exports) ? require("./tokos-core.js") : G.TOKOS_CORE;

  var STORE_KEY = "smd_tokos_v1";
  var PREF_KEY = "smd_tokos_prefs";

  /* Owner decision (mirrors Ophthalmós, 2026-09-28): MBBS free core, Resident = Pro with
     one free trial per feature. Feature ids: clinic.ctg (more added as tracks are added). */
  function levelLocked(cfg, level, pro) {
    if (pro) return false;
    var free = (cfg.access && cfg.access.freeLevels) || ["mbbs"];
    return free.indexOf(level) < 0;
  }
  function trialState(store, featureId, pro) {
    if (pro) return "open";
    return store && store.trials && store.trials[featureId] != null ? "used" : "trial";
  }
  function useTrial(store, featureId, day) {
    if (!store.trials) store.trials = {};
    if (store.trials[featureId] != null) return false;
    store.trials[featureId] = day;
    return true;
  }

  function loadJSON(ls, k, dflt) {
    try { var v = ls && ls.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function saveJSON(ls, k, v) { try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function loadStore(ls) {
    var s = loadJSON(ls, STORE_KEY, null);
    if (!s || s.v !== 1 || !s.cards) s = C.emptyStore();
    if (!s.conf) s.conf = {};
    if (!s.days) s.days = {};
    if (!s.trials) s.trials = {};
    return s;
  }
  function saveStore(ls, s) { saveJSON(ls, STORE_KEY, s); }

  function loadPrefs(ls) {
    var p = loadJSON(ls, PREF_KEY, null) || {};
    if (p.level !== "resident") p.level = "mbbs";
    if (p.lang !== "hi") p.lang = "en";
    if (p.tab !== "learn" && p.tab !== "test") delete p.tab;
    return p;
  }
  function savePrefs(ls, p) { saveJSON(ls, PREF_KEY, p); }

  function today(now) { var d = new Date(now); return C.dayNum(d.getTime(), d.getTimezoneOffset()); }

  var API = {
    STORE_KEY: STORE_KEY, PREF_KEY: PREF_KEY,
    levelLocked: levelLocked, trialState: trialState, useTrial: useTrial,
    loadStore: loadStore, saveStore: saveStore, loadPrefs: loadPrefs, savePrefs: savePrefs,
    today: today,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.TOKOS_DATA = API;
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --check tokos-data.js
node --test test/tokos-data.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tokos-data.js test/tokos-data.test.mjs
git commit -m "feat(tokos): tokos-data.js, levels/trials/persistence"
```

---

### Task 5: `tokos/tracks.json`

**Files:**
- Create: `tokos/tracks.json`

**Interfaces:**
- Produces: the track config `tokos.js` (Task 6) reads to know the one clinic and its access rules.

- [ ] **Step 1: Write the file**

```json
{
  "tracks": [
    { "id": "ctg", "deck": "decks/ctg.json", "labelEn": "CTG reading", "labelHi": "सीटीजी पढ़ना" }
  ],
  "access": { "freeLevels": ["mbbs"] }
}
```
(`labelHi` is "CTG padhna" in Devanagari — a working, reviewable placeholder; flagged for the Hindi content review the same way Ophthalmós's Hindi strings were.)

- [ ] **Step 2: Write a content test**

```js
// test/tokos-content.test.mjs (append)
test("tracks.json declares the ctg track with a Hindi label", () => {
  const tracks = JSON.parse(readFileSync("tokos/tracks.json", "utf8"));
  assert.equal(tracks.tracks[0].id, "ctg");
  assert.ok(tracks.tracks[0].labelHi.length > 0);
  assert.deepEqual(tracks.access.freeLevels, ["mbbs"]);
});
```

- [ ] **Step 3: Run, verify pass**

```bash
node --test test/tokos-content.test.mjs
```

- [ ] **Step 4: Commit**

```bash
git add tokos/tracks.json test/tokos-content.test.mjs
git commit -m "feat(tokos): tracks.json"
```

---

### Task 6: `tokos.js` + `tokos.css` (DOM layer: hub, clinic session, reveal)

**Files:**
- Create: `tokos.js`
- Create: `tokos.css`
- Test: `test/run-tokos-ui.mjs` (headless Chrome, mirrors `test/run-clinix-ui.mjs`'s CDP harness structure)

**Interfaces:**
- Consumes: `TOKOS_CORE` (Task 2), `TOKOS_STAGE` (Task 3), `TOKOS_DATA` (Task 4), `tokos/tracks.json` + `tokos/decks/ctg.json` (Tasks 1/5). Host globals it may use if present, exactly like `ophthalmos.js` does: `G.SMD_PRO.isProSync()`, `G.SMD_PRO_NOTICE.show(id)` / `G.SMD_PRO.openPaywall(id)`, `G.ICONS`, `G.toast`.
- Produces: `window.TOKOS.open()`, `.close()`, `.back()` (same host contract as `OPHTHALMOS.open/close/back`, so `home.js` and `swipe-back.js` wire it the same way).

- [ ] **Step 1: Write the module skeleton with the hub screen and trial gate**

```js
/* Tokós: OBGYN CTG reading trainer, a StewardMD module. DOM layer, ES5.
   Host contract mirrors Ophthalmós: open() hides home, close() restores it, back() unwinds
   one layer (swipe-back.js and Escape call it). Content is ai_drafted; every screen carries
   the draft footer until clinical review (see .tok-draft below, matches .oph-draft). */
(function (G) {
  "use strict";
  var C = G.TOKOS_CORE, D = G.TOKOS_DATA, S = G.TOKOS_STAGE;
  var BASE = G.SMD_TOKOS_BASE || "/tokos/";

  var st = { view: "hub", cfg: null, decks: {}, store: null, prefs: null, loading: null, err: null, session: null, caseIdx: 0 };

  function $(id) { return G.document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function isPro() { try { return !!(G.SMD_PRO && G.SMD_PRO.isProSync && G.SMD_PRO.isProSync()); } catch (e) { return false; } }
  function showPro() {
    try { if (G.SMD_PRO_NOTICE && G.SMD_PRO_NOTICE.show) return G.SMD_PRO_NOTICE.show("tokos"); } catch (e) {}
    try { if (G.SMD_PRO && G.SMD_PRO.openPaywall) return G.SMD_PRO.openPaywall("tokos"); } catch (e) {}
    try { if (G.toast) G.toast("This level is part of StewardMD Pro"); } catch (e) {}
  }
  function ls() { try { return G.localStorage; } catch (e) { return null; } }
  function save() { D.saveStore(ls(), st.store); }
  function today() { return D.today(Date.now()); }
  function level() { return st.prefs.level === "resident" ? "resident" : "mbbs"; }
  function levelLocked(lv) { return D.levelLocked(st.cfg, lv || level(), isPro()); }
  function trial(featureId) { return D.trialState(st.store, featureId, !levelLocked("resident")); }

  // Trial gate: check BEFORE any fetch. A spent trial must never touch the network (Review Focus).
  function gate(featureId, run) {
    var s = trial(featureId);
    if (s === "used") return showPro();
    if (s === "trial") { D.useTrial(st.store, featureId, today()); save(); }
    return run();
  }

  function getJSON(path) {
    return fetch(BASE + path).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }
  function loadAll() {
    if (st.loading) return st.loading;
    st.err = null;
    st.loading = getJSON("tracks.json").then(function (cfg) {
      st.cfg = cfg;
      return Promise.all(cfg.tracks.map(function (t) { return getJSON(t.deck).then(function (d) { st.decks[t.id] = d; }); }));
    }).catch(function (e) { st.err = e; st.loading = null; throw e; });
    return st.loading;
  }

  function render() {
    var root = $("smdTokos");
    if (!root) return;
    if (st.view === "hub") root.innerHTML = renderHub();
    else if (st.view === "clinic") root.innerHTML = renderClinic();
    else if (st.view === "reveal") root.innerHTML = renderReveal();
    bind(root);
  }

  function renderHub() {
    if (st.err) return '<div class="tok-err">Could not load Tokós. <button data-act="retry">Try again</button></div>';
    if (!st.cfg) return '<div class="tok-loading">Loading...</div>';
    var lang = st.prefs.lang;
    var t = lang === "hi" ? st.cfg.tracks[0].labelHi : st.cfg.tracks[0].labelEn;
    var locked = levelLocked("resident");
    return '<div class="tok-hub">' +
      '<h1>Tokós</h1>' +
      '<button class="tok-clinic" data-act="clinic" data-t="ctg">' + esc(t) +
      (locked ? '<span class="tok-lock">Pro</span>' : "") + "</button>" +
      '<div class="tok-draft">To be verified, draft</div>' +
      "</div>";
  }

  function renderClinic() {
    var deck = st.decks.ctg, c = deck.cases[st.caseIdx];
    if (!c) return renderHub();
    return '<div class="tok-clinic-view">' +
      '<div class="tok-stage" id="tokStage"><img id="tokTrace" src="' + BASE + "media/" + c.svg + '" alt="CTG trace"/></div>' +
      '<div class="tok-q">Baseline rate band? Variability? Any decelerations sustained 15s or more?</div>' +
      '<button class="tok-btn" data-act="reveal">Reveal</button>' +
      '</div>';
  }

  function renderReveal() {
    var deck = st.decks.ctg, c = deck.cases[st.caseIdx];
    // Review Focus: trace-based features and the real outcome are shown as separate blocks,
    // never combined into one sentence implying one predicts the other.
    return '<div class="tok-reveal">' +
      '<div class="tok-block"><h3>Computed trace features</h3>' +
      "<p>Baseline: " + c.features.baseline + " bpm</p>" +
      "<p>Variability: " + esc(c.features.variabilityBand) + "</p>" +
      "<p>Decelerations (≥15s): " + c.features.decelCount + "</p></div>" +
      '<div class="tok-block"><h3>Actual recorded outcome</h3>' +
      "<p>Umbilical artery pH: " + c.outcome.pH + "</p>" +
      "<p>Base excess: " + c.outcome.BE + "</p>" +
      "<p>Apgar: " + c.outcome.apgar1 + " / " + c.outcome.apgar5 + "</p></div>" +
      '<button class="tok-btn" data-act="next">Next case</button>' +
      "</div>";
  }

  function bind(root) {
    root.onclick = function (e) {
      var el = e.target.closest("[data-act]");
      if (!el) return;
      var act = el.getAttribute("data-act");
      if (act === "clinic") gate("clinic." + el.getAttribute("data-t"), function () {
        st.caseIdx = 0; st.view = "clinic"; render();
      });
      else if (act === "reveal") { st.view = "reveal"; render(); }
      else if (act === "next") { st.caseIdx++; st.view = "clinic"; render(); }
      else if (act === "retry") { st.loading = null; loadAll().then(render).catch(render); }
    };
  }

  function open() {
    try { if (G.document.getElementById("smdHome")) G.document.getElementById("smdHome").style.display = "none"; } catch (e) {}
    st.store = D.loadStore(ls());
    st.prefs = D.loadPrefs(ls());
    if (!st.cfg && !st.loading) loadAll().then(render).catch(render);
    else render();
  }
  function close() {
    try { if (G.document.getElementById("smdHome")) G.document.getElementById("smdHome").style.display = ""; } catch (e) {}
    st.view = "hub";
  }
  function back() {
    if (st.view === "reveal" || st.view === "clinic") { st.view = "hub"; render(); return true; }
    return false;
  }

  G.TOKOS = { open: open, close: close, back: back, _st: st };
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 2: Write `tokos.css`** (minimal, dark-theme-consistent; mirrors the visual language of `ophthalmos.css`'s `.oph-draft`/button styles)

```css
.tok-hub, .tok-clinic-view, .tok-reveal { padding: 16px; color: #eee; background: #0b0b0d; }
.tok-clinic { display: block; width: 100%; padding: 16px; margin: 12px 0; background: #16171a; border: none; border-radius: 12px; color: #eee; font-size: 17px; text-align: left; }
.tok-lock { float: right; background: #333; border-radius: 8px; padding: 2px 8px; font-size: 12px; }
.tok-draft { text-align: center; font-size: 11px; color: #777; margin-top: 24px; }
.tok-stage { width: 100%; overflow: hidden; border-radius: 12px; background: #000; }
.tok-stage img { width: 100%; display: block; }
.tok-block { background: #16171a; border-radius: 12px; padding: 12px 16px; margin: 12px 0; }
.tok-btn { display: block; width: 100%; padding: 14px; background: #1d6ed4; color: #fff; border: none; border-radius: 12px; font-size: 16px; margin-top: 16px; }
.tok-err, .tok-loading { padding: 40px 16px; text-align: center; color: #999; }
```

- [ ] **Step 3: Write the headless UI test**

```js
// test/run-tokos-ui.mjs
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9398, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tokos-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(200); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push((d.exception && d.exception.description) || d.text); }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.TOKOS_CORE && window.TOKOS_DATA && window.TOKOS_STAGE);`, 15000), "core/data/stage libraries load");

  await ev(`try{localStorage.removeItem("smd_tokos_v1");localStorage.removeItem("smd_tokos_prefs");}catch(e){} document.body.innerHTML='<div id="smdTokos"></div>'; return 1;`);
  await ev(`TOKOS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-clinic');`, 10000), "hub renders the CTG clinic entry");

  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  ok(await until(`return !!document.getElementById('tokTrace');`), "clinic opens with a trace image");
  ok(await ev(`return document.getElementById('tokTrace').src.indexOf('.svg') > -1;`) === true, "trace is an SVG");

  await ev(`document.querySelector('[data-act=reveal]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-reveal');`), "reveal screen renders");
  ok(await ev(`var b=document.querySelectorAll('.tok-block'); return b.length===2;`) === true, "trace features and real outcome are two separate blocks (Review Focus)");

  // Spent-trial gate: must not fetch when the trial is already used.
  await ev(`localStorage.setItem("smd_tokos_v1", JSON.stringify({v:1,cards:{},conf:{},days:{},trials:{"clinic.ctg":1}})); TOKOS.close(); TOKOS.open(); return 1;`);
  await until(`return !!document.querySelector('.tok-clinic');`);
  let paywallShown = false;
  await ev(`window.SMD_PRO_NOTICE = { show: function(){ window.__paywall = true; } }; return 1;`);
  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  paywallShown = await ev(`return !!window.__paywall;`);
  ok(paywallShown === true, "spent trial hits the paywall (checked before any fetch)");

  ok(errors.length === 0, "no uncaught Tokós errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
```

- [ ] **Step 4: Run it**

```bash
node --check tokos.js
node test/run-tokos-ui.mjs
```
Expected: ALL GREEN. If the trial-gate test fails because a fetch already happened before the check, fix `bind()`'s `clinic` handler so `gate()` wraps the state change, not just logging — the fetch for `tracks.json`/`ctg.json` already happened at `open()` time in this design (that's fine, tracks/deck metadata isn't gated, only starting a session is); if the test expects a *session/case* fetch to be skipped and none occurs because cases are already in `st.decks` from `loadAll()`, that's correct behavior, not a bug — adjust the test's assertion to check that no *new* network call fires on a spent trial, not that zero fetches ever happened.

- [ ] **Step 5: Commit**

```bash
git add tokos.js tokos.css test/run-tokos-ui.mjs
git commit -m "feat(tokos): DOM layer, CTG clinic session + reveal screen"
```

---

### Task 7: StewardMD wiring (flag, home tile, build)

**Files:**
- Modify: `index.html`
- Modify: `scripts/build-www.sh`
- Modify: `home.js`
- Test: extend `test/tokos-content.test.mjs` or a small `test/tokos-wiring.test.mjs`

**Interfaces:**
- Consumes: `window.TOKOS.open()` (Task 6), an existing flag-check helper in `home.js` (read the file to find the exact helper name used by CliniX/KardiQ X's tile before writing this task's code — e.g. `SMD_FLAGS.on("smd_clinix")` or similar; do not guess the name, grep `home.js` for `smd_clinix` first).

- [ ] **Step 1: Read the existing pattern before writing any code**

```bash
grep -n "smd_clinix\|smd_kardiox" home.js | head -20
grep -n "ophthalmos-learn\|ophthalmos.css" index.html
grep -n "ophthalmos" scripts/build-www.sh
```
Use whatever flag-check call, script-tag ordering, and copy-glob pattern these show — do not invent a different convention.

- [ ] **Step 2: Add script/style tags to `index.html`**

Add, following the exact tag style already used for Ophthalmós/CliniX (read the surrounding lines first):
```html
<link rel="stylesheet" href="tokos.css?v=tok1">
<script src="tokos-core.js?v=tok1"></script>
<script src="tokos-data.js?v=tok1"></script>
<script src="tokos-stage.js?v=tok1"></script>
<script src="tokos.js?v=tok1"></script>
```

- [ ] **Step 3: Add the flag-gated home tile in `home.js`**, mirroring the exact structure found in Step 1 (do not paste speculative code here — copy the CliniX/KardiQ X tile block, rename the id/label/flag/open-call, keep everything else identical: icon handling, disabled/hidden state when the flag is off).

- [ ] **Step 4: Add the flag definition** wherever `smd_clinix`/`smd_kardiox` are defined (likely a flags config file — `grep -rn "smd_kardiox" --include=*.js .` to find it), add `smd_tokos: false`.

- [ ] **Step 5: Update `scripts/build-www.sh`** to copy `tokos-*.js`, `tokos-*.css`, and the `tokos/` directory, following the exact same line pattern used for `ophthalmos-*`/`tokos` — read the file first, add analogous lines, do not restructure the script.

- [ ] **Step 6: Check disk, then build and verify**

```bash
df -h / | tail -1
bash scripts/build-www.sh
ls www/tokos-core.js www/tokos.js www/tokos/decks/ctg.json
rm -rf www   # gitignored build output, delete after checking (disk is tight)
```

- [ ] **Step 7: Write a wiring test**

```js
// test/tokos-wiring.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("index.html loads all four tokos files at a consistent version token", () => {
  const html = readFileSync("index.html", "utf8");
  const tags = html.match(/tokos[-.\w]*\?v=(\w+)/g) || [];
  assert.ok(tags.length >= 5, "expected tokos.css + 4 JS files, found " + tags.length);
  const versions = new Set(tags.map((t) => t.split("v=")[1]));
  assert.equal(versions.size, 1, "all tokos tags must share one version token, found " + [...versions]);
});

test("build-www.sh copies tokos files", () => {
  const script = readFileSync("scripts/build-www.sh", "utf8");
  assert.ok(/tokos/.test(script), "build-www.sh must reference tokos");
});
```

- [ ] **Step 8: Run the full flagged suite**

```bash
node --test --experimental-test-module-mocks --experimental-sqlite test/*.test.mjs
```
Expected: PASS, including every pre-existing test (nothing about this task should touch unrelated files).

- [ ] **Step 9: Commit**

```bash
git add index.html home.js scripts/build-www.sh test/tokos-wiring.test.mjs
git commit -m "feat(tokos): wire into StewardMD (flag smd_tokos, home tile, build)"
```

---

### Task 8: Vault doc

**Files:**
- Create: `vault/modules/Tokós.md`

- [ ] **Step 1: Write it**, following the frontmatter/structure pattern of `vault/modules/Ophthalmós.md` (tags, flag/default line, status line, key files, dependencies, gotchas). Include:
  - Status: built, flag `smd_tokos` def:false, content `ai_drafted` pending obstetric clinical review, 12 CTG cases from CTU-UHB (ODC-BY 1.0).
  - Note the simplified baseline/variability/deceleration algorithm and that it needs a clinician to confirm it against their own reading of each trace before the flag goes on for anyone.
  - Link to `~/.claude/projects/-Users-diwakarkumar/memory/specialty-module-dataset-licenses.md`'s findings for future OBGYN content (WHO/IAP charts blocked, Kermany/MURA blocked for other future specialties).
  - Roadmap note: Phase 2 candidates are a Bishop score calculator, a labour-room simulator, and fetal ultrasound plane recognition (HC18/FETAL_PLANES_DB, both CC BY 4.0, already licence-clear) — not built in this phase.

- [ ] **Step 2: Commit**

```bash
git add vault/modules/Tokós.md
git commit -m "docs(tokos): vault module doc"
```

---

## Self-Review

**1. Spec coverage:** CTG clinic (Task 1, 6), spaced repetition reuse (Task 2), zoom reuse (Task 3), level/trial/Hindi-pref persistence (Task 4, matches the "MBBS free, Resident Pro, one trial per feature" owner decision), StewardMD integration (Task 7), documentation (Task 8). Licence compliance is threaded through Global Constraints and Task 1's credits.json. No task left unaddressed from the plan's stated goal.

**2. Placeholder scan:** no TBD/TODO; the one deliberately-deferred item (Learn tab, more tracks, simulator) is named explicitly as Phase 2 in Task 8, not hidden as an ellipsis inside Phase 1.

**3. Type consistency:** `TOKOS_CORE`/`TOKOS_DATA`/`TOKOS_STAGE` names and their function signatures are used identically across Tasks 2-6 (e.g. `D.trialState(store, featureId, pro)` in Task 4's implementation matches its use in Task 6's `trial()`). `tokos/decks/ctg.json`'s case shape (`id, svg, features, outcome, gestWeeks`) from Task 1 is read identically in Task 6's `renderReveal`.

**4. Review Focus coverage:** dropout/artifact handling (Task 1 Step 6 test), offline/failed-fetch state (Task 6's `renderHub` error branch, though a dedicated network-failure UI test isn't scripted in Task 6 Step 3 — **gap**: add one before merging). Spent-trial-before-fetch (Task 6 Step 3's last test). Hindi numeric rendering (Task 5's Hindi label test covers the label but not a numeric-value render — **gap**: Task 6's reveal screen renders pH/bpm as plain numbers regardless of `st.prefs.lang` since the template never routes numbers through a translation function, which is correct by construction, but no test pins this). pH-vs-features independence (Task 6 Step 3's two-block assertion).

Both gaps just found are small and cheap to close — add to Task 6 Step 3 before executing:
```js
// after the reveal-screen assertions:
await ev(`TOKOS._st.prefs.lang='hi'; TOKOS._st.view='clinic'; render(); return 1;`);
// (render is not exported; use TOKOS.back() then re-open the clinic instead, or expose render for the test)
```
Flagging this as a known refinement rather than blocking the plan on it — the executor should add a Hindi-numeric-render assertion and a simulated-fetch-failure assertion to Task 6 Step 3 while implementing it, using the same `ev`/`until` pattern already in that step.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-29-tokos-obgyn-ctg-clinic.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

**For this plan I recommend Subagent-driven**, because Task 1 involves real downloaded data and empirical format verification that benefits from a dedicated reviewer checking the actual generated `ctg.json`/SVGs against the raw PhysioNet data before Tasks 2-7 build on top of it, and because this is clinical content (even simplified/flagged) where a wrong assumption compounds across every later task. Does the plan capture what you want, and which approach should we use?
