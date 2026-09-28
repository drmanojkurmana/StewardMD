# Tokós (OBGYN module), Phase 1: CTG Reading Clinic, Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **v2 (2026-09-29):** the v1 plan unchanged (nothing deleted), plus improvements agreed in a Claude and Gemini review, each corrected where the review found an error. New tasks: **1b** (FIGO features, signal quality, acidosis class), **1c** (calibrated renderer), **1d** (case selection and vignettes), **6b** (digital calipers), **6c** (FIGO checklist, concordance, rationale, themes). **Execution order:** 1, 1b, 1c, 1d, 2, 3, 4, 5, 6, 6b, 6c, 7, 8. Where a v2 task supersedes a v1 function (`extractFeatures` -> `extractFIGOFeatures`, `renderTraceSvg` -> `renderCalibratedTraceSvg`, the Reveal button -> the checklist), the v1 function and its tests stay and keep passing; the driver and the UI switch to the v2 version.
>
> **Clinical standards cited:** FIGO Consensus Guidelines on Intrapartum Fetal Monitoring (2015), CTG chapter (classification table); NICE NG229 *Fetal monitoring in labour* (2022). Acidosis definitions (Task 1b) follow the Low criteria as used in the CTU-UHB literature, not NICE NG229. **Verify each citation against its source during Task 8 (vault doc)** before it appears in app text.

**Goal:** Ship the first working slice of Tokós, StewardMD's OBGYN learning module: a cardiotocography (CTG) reading clinic built on real, licence-clear intrapartum CTG traces with real perinatal outcomes, using the same spaced-repetition/level/trial engine as Ophthalmós.

**Architecture:** Tokós lives natively inside StewardMD (`tokos-*.js`, `tokos/`), the way CliniX and KardiQ X do, no separate synced repo like Ophthalmós has. `tokos-core.js` (FSRS-6 scheduler) and `tokos-stage.js` (pinch-zoom) are verbatim renamed copies of `ophthalmos-core.js` / `ophthalmos-stage.js`: both files are pure, already-generic logic with zero eye-specific coupling (verified by reading them; see Task 2/3). `tokos-data.js` is a smaller, adapted port of `ophthalmos-data.js` covering levels/trials/persistence only, Phase 1 has no Learn tab, so the Learn-specific half of `ophthalmos-data.js` (lesson validation, glossary, SVG scoping) is not ported. `ponytail: two specialty modules now duplicate this ~250 lines of pure logic; extract a shared `spaced-review.js` only if a third specialty module needs it (rule of three), don't extract for 2, and don't touch the already-shipped, tested ophthalmos-core.js/ophthalmos-stage.js to do it.`

The clinic's content is built by a one-off Node data-prep script (not shipped in the app bundle) that downloads real CTU-UHB records from PhysioNet, decodes the WFDB signal format, computes simple interpretable features (baseline rate, a variability proxy, deceleration count), and renders each case as an SVG trace. The learner is asked about the *computed features* (baseline range, variability band, whether decelerations are present) rather than asked to name a definitive FIGO category, the auto-computed labels are simplifications flagged `ai_drafted`/pending clinical review, matching every other StewardMD content module, and are not presented as an expert diagnosis. The real recorded perinatal outcome (umbilical artery pH, base excess, Apgar) is genuine ground truth from the dataset and is revealed after the learner answers.

**Tech Stack:** ES5 IIFEs (host convention), Node `--test` for unit tests, headless Chrome via CDP (`test/serve.mjs` pattern) for UI tests, plain Node for the WFDB decoder (no new runtime dependency, format 16 is 16-bit PCM-like and is fully decodable in ~30 lines).

**Spec:** This plan doc is also the spec, Phase 1 scope, clinical design and licence findings are recorded inline below and in `~/.claude/projects/-Users-diwakarkumar/memory/specialty-module-dataset-licenses.md`.

## Global Constraints

- No em-dash in any app-facing text or docs (from `CLAUDE.md`).
- Never commit secrets or PHI. This dataset is de-identified third-party research data, not StewardMD patient data, still never log/store any StewardMD user's own patient data in Tokós.
- ES5 only, IIFE per file, matches host bundling (`?v=tokN` cache-bust tokens, `scripts/build-www.sh`).
- Flag `smd_tokos` (client, def:false), Tokós starts hidden, like every new module before clinical sign-off (CliniX/KardiQ X/ThoreX precedent).
- Content is `ai_drafted`: every case screen carries the existing "To be verified, draft" footer pattern (see `ophthalmos.css`/`ophthalmos.js` `.oph-draft` for the reference implementation, reuse the same visual treatment, renamed).
- Attribution required: CTU-UHB is ODC-BY 1.0, every case's data must trace to a `tokos/media/credits.json` entry citing Chudáček V et al., "Open access intrapartum CTG database," *BMC Pregnancy Childbirth* 2014;14:16, and the PhysioNet URL.
- Disk is critical on the build machine (267 MB free as of 2026-09-29). **Do not run Task 1's download step until disk is confirmed above 1 GB free**, run the `disk-cleanup` skill first if needed. Each task ends with a `df -h /` check before any download/build step.
- Test before you build: `node --check` every new JS file; run the specific new test file; then the full suite (`npm test`, the flagged form, not bare `node --test`) before any commit.
- No copyrighted/non-permissive images. Only CTU-UHB (ODC-BY 1.0) data ships in Phase 1.
- **No fabricated clinical data (v2).** Vignettes use only fields present in the CTU-UHB `.hea` header (age, gravidity, parity, gestation, weight, sex, diabetes, hypertension, pre-eclampsia, induced, presentation, stage 1/2 durations, meconium, pyrexia, liquor praecox, pH, BE, BDecf, pCO2, Apgar 1/5). Never cervical dilation, oxytocin, or maternal vitals: the dataset does not record them.
- **Downloads stay in memory (v2).** The driver fetches only the headers it scans plus the candidate records' `.dat` files into Buffers (under 10 MB total transfer: 552 headers of about 1.5 KB plus up to 36 candidate `.dat` files of 75 to 150 KB, see Task 1d), writes only the output JSON/SVGs, and never writes raw records to disk. The one-record manual check in Task 1 Step 5 (`/tmp/tokos-ctg/1001.*`, ~80 KB) is the only exception and is deleted after that step. (Disk was 21 GB free on 2026-09-29 after cleanup; the `df -h /` checks stay.)
- **Clinical numerals are invariant (v2).** pH, bpm, seconds, kPa, mmol/L and Apgar render as plain ASCII digits in both English and Hindi; only labels translate. Enforced by a test in Task 6c.
- **Auto-derived labels are suggestions (v2).** The FIGO category, deceleration subtype and acidosis class computed by the pipeline are shown as "Rule-based, pending obstetrician review" until a reviewer confirms them per case (`case.review`). Learners are graded on deceleration subtype only where `case.review.decelType` exists.
- UI work (Task 6 `tokos.js`/`tokos.css`, calipers, checklist, reveal, themes) must load and follow these skills, in this order: `ui-ux-pro-max:ui-ux-pro-max` + `anti-ui-slop` to set the design contract and required states; `impeccable`, `taste-skill`, `emil-design-eng` while building; `web-design-guidelines` + the `anti-ui-slop` finish gate before the task is called done. Any subagent doing UI work is told the same. No generic, templated screens ship.

## Review Focus

- **A CTG record with a long artifact/dropout segment (signal loss)**, the baseline/variability computation must exclude physiologically impossible samples (FHR outside 50-220 bpm) rather than average them in and produce a nonsense baseline. Task 1's feature extractor is tested against a synthetic record with an injected dropout.
- **A learner on a slow connection or offline**, the clinic must show a loading state and a retry action if `tokos/decks/ctg.json` or an SVG fails to fetch, not a blank screen. Task 6's UI test covers a failed fetch.
- **A Resident-level learner who has already spent their one free trial for `clinic.ctg`**, must hit the paywall before any network fetch (mirrors Ophthalmós's `trial()`/`gate()` pattern exactly), not after loading the case and then blocking. Task 6's test asserts no fetch happens on a spent trial.
- **Hindi rendering of a numeric clinical value** (pH, bpm), numbers must not be translated/reformatted incorrectly (e.g. Devanagari numerals) since these are precise clinical figures; Task 4/6 tests assert numeric fields render as plain Arabic numerals in both languages, only labels translate.
- **A case whose real outcome is normal (pH ≥ 7.20) presented after the learner picked "abnormal" features**, the reveal screen must not imply the baby was fine because the trace was "normal-looking"; pH and trace-based features are two different things (a normal trace can precede a low pH from other causes, and vice versa). Task 6's copy is written to state both independently, never as if one implies the other, and a test asserts the reveal screen renders the pH stat and the feature-check result as visually separate blocks, never combined into one sentence.

### Review Focus additions (v2)

- **Duration-based FIGO criteria on a short window.** "Reduced variability for more than 50 min" cannot be judged on a 10-minute strip. Features are computed over the last 60 minutes of each record (or the whole record if shorter, stored as `window.minutes`), and the strip shows the last 30 minutes. Task 1b tests a 60-minute synthetic trace with 55 reduced minutes (pathological) and one with 20 (not pathological on that criterion).
- **Tachysystole is not an FHR category driver.** FIGO classifies the CTG from FHR features; tachysystole is a separate flag with its own action. A trace with normal FHR features and 6 contractions per 10 minutes is category Normal plus a tachysystole flag. Task 1b tests this.
- **Caliper readings under zoom.** A caliper span measured at zoom 1 and at zoom 3 must read the same bpm and seconds. Task 6b maps pointer positions through `getScreenCTM().inverse()` into viewBox units; its unit test covers the pure math and Task 6c's UI test covers the zoomed case.
- **A record whose header lacks pH, BDecf or pCO2.** The acidosis class must be `unknown` and the reveal says "not recorded", never `undefined` or `NaN`. Task 1b tests a header missing BDecf.
- **Inline trace SVG must not leak styles.** The renderer emits class names only and no `<style>` element (an inline `<style>` would restyle the whole app; Ophthalmós needed `scopeSvg` for exactly this). Task 1c asserts no `<style` in the output.

---

## File Structure

- Create: `tools/tokos-ctg-prep.mjs`, one-off data-prep script (not shipped; excluded from `build-www.sh`'s copy globs same way other `scripts/`/`tools/` content is)
- Create: `tokos-core.js`, verbatim renamed copy of `ophthalmos-core.js`
- Create: `tokos-stage.js`, verbatim renamed copy of `ophthalmos-stage.js`
- Create: `tokos-data.js`, adapted subset port of `ophthalmos-data.js`
- Create: `tokos.js`, DOM layer (hub, clinic session, reveal)
- Create: `tokos.css`
- Create: `tokos/tracks.json`, the one track (`ctg`) config (mirrors `ophthalmos/tracks.json`)
- Create: `tokos/decks/ctg.json`, generated by Task 1; 12 cases with computed features + real outcomes
- Create: `tokos/media/ctg/<caseId>.svg`, generated by Task 1; the rendered traces
- Create: `tokos/media/credits.json`, attribution (ODC-BY 1.0, CTU-UHB citation)
- Create: `test/tokos-core.test.mjs`, renamed copy of `ophthalmos-core.test.mjs`'s equivalent (`test/core.test.mjs`)
- Create: `test/tokos-stage.test.mjs`, renamed copy of `test/stage.test.mjs`
- Create: `test/tokos-data.test.mjs`
- Create: `test/tokos-content.test.mjs`, validates `tokos/decks/ctg.json` + `credits.json` shape and cross-references
- Create: `test/run-tokos-ui.mjs`, headless Chrome UI test (mirrors `test/run-clinix-ui.mjs` pattern)
- Modify: `index.html`, add `tokos.css`/`tokos.js` tags at `?v=tok1`
- Modify: `scripts/build-www.sh`, copy `tokos-*.js/.css` and `tokos/` into `www/`
- Modify: `home.js`, add the Tokós home tile, flag-gated (mirrors the existing CliniX/KardiQ X tile pattern)
- Create: `vault/modules/Tokós.md`
- Create (v2): `tokos-calipers.js`, `test/tokos-calipers.test.mjs`, `tokos/rationale.json`, `docs/tokos/review-queue.md` (generated reviewer queue), `test/tokos-wiring.test.mjs`

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
Expected first run: FAIL (`decodeHeader` not exported yet, or file missing), write the file above, re-run, expect PASS.

- [ ] **Step 4: Write the self-verifying signal decoder (do not assume byte order, check it against the header's own `initval`)**

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

- [ ] **Step 5: Test the decoder against the real downloaded record (not a synthetic fixture, this step needs the actual bytes)**

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
Expected: all PASS (the network-dependent test from Step 5 will SKIP if `/tmp/tokos-ctg/1001.dat` is absent, that's fine for CI, it was already verified manually in Step 5).

- [ ] **Step 8: Write the SVG trace renderer**

```js
// tools/tokos-ctg-prep.mjs (append)
// A plain, readable FHR+UC trace. Not standard CTG graph paper (3cm/min, 1cm=30bpm) , 
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

### Task 1b (v2): FIGO 2015 features, signal quality, acidosis class

**Files:**
- Modify: `tools/tokos-ctg-prep.mjs` (append; v1's `extractFeatures` stays and its tests keep passing)
- Test: `test/tokos-ctg-prep.test.mjs` (append)

**Interfaces:**
- Consumes: `decodeHeader`, `decodeSignal`, `toPhysical` (Task 1)
- Produces: `CFG` (tunable constants), `signalQuality(fhr) -> {lossPct, suboptimal}`, `twoPassBaseline(fhr) -> number|null`, `baselineClass(b) -> "severe_bradycardia"|"bradycardia"|"normal"|"tachycardia"`, `detectContractions(uc, fs) -> [{start, end, peak}]` (sample indices), `detectDecels(fhr, fs, baseline) -> [{start, end, nadir, durationSec, depth}]`, `minuteVariability(fhr, fs, decels) -> {reducedMin, increasedMin, assessedMin, medianRange, band}`, `decelSubtype(decel, contractions, fs) -> "early"|"late"|"variable"|"prolonged"|"unclassified"`, `acidosisClass(clinical) -> "normal"|"metabolic"|"acidaemia_not_metabolic"|"acidaemia_unspecified"|"unknown"`, `extractFIGOFeatures(fhr, uc, fs) -> {window, quality, baseline, baselineClass, variability, contractions, decels, repetitive, figoSuggested}`

- [ ] **Step 1: Write the failing tests**

```js
// test/tokos-ctg-prep.test.mjs (append)
import {
  CFG, signalQuality, twoPassBaseline, baselineClass, detectContractions, detectDecels,
  minuteVariability, decelSubtype, acidosisClass, extractFIGOFeatures,
} from "../tools/tokos-ctg-prep.mjs";

const FS = 4;
// n minutes of FHR: 140 bpm with a 12 bpm peak-to-trough wave (normal variability) or flat (reduced).
function fhrMinutes(spec) {
  const out = [];
  spec.forEach(([mins, kind]) => {
    for (let i = 0; i < mins * 60 * FS; i++) out.push(kind === "flat" ? 140 : 140 + 6 * Math.sin((2 * Math.PI * i) / (FS * 20)));
  });
  return Float64Array.from(out);
}
const restUc = (mins) => new Float64Array(mins * 60 * FS).fill(10);

test("signalQuality reports percent loss and flags over 30%", () => {
  const f = Float64Array.from([...new Array(60).fill(140), ...new Array(40).fill(0)]);
  assert.deepEqual(signalQuality(f), { lossPct: 40, suboptimal: true });
  assert.equal(signalQuality(new Float64Array(100).fill(140)).suboptimal, false);
});

test("twoPassBaseline ignores recurrent deep decelerations", () => {
  const f = fhrMinutes([[30, "wave"]]);
  for (let k = 0; k < 10; k++) for (let i = 0; i < 40 * FS; i++) f[k * 180 * FS + i] = 90; // ten 40 s drops to 90
  assert.equal(twoPassBaseline(f), 140);
});

test("baselineClass uses FIGO bands", () => {
  assert.equal(baselineClass(95), "severe_bradycardia");
  assert.equal(baselineClass(105), "bradycardia");
  assert.equal(baselineClass(140), "normal");
  assert.equal(baselineClass(165), "tachycardia");
});

test("reduced variability for 55 of 60 min is pathological; 20 of 60 is not", () => {
  const a = extractFIGOFeatures(fhrMinutes([[55, "flat"], [5, "wave"]]), restUc(60), FS);
  assert.equal(a.variability.reducedMin, 55);
  assert.equal(a.figoSuggested, "pathological");
  const b = extractFIGOFeatures(fhrMinutes([[20, "flat"], [40, "wave"]]), restUc(60), FS);
  assert.equal(b.variability.reducedMin, 20);
  assert.notEqual(b.figoSuggested, "pathological");
});

test("a single artifact spike does not flip a minute's variability band", () => {
  const f = fhrMinutes([[10, "wave"]]);
  for (let m = 0; m < 10; m++) f[m * 60 * FS + 30] = 205; // one spike per minute, still inside 50-210
  assert.equal(minuteVariability(f, FS, []).band, "normal");
});

test("a single deceleration over 5 min is pathological; 3 to 5 min is suspicious", () => {
  const long = fhrMinutes([[60, "wave"]]);
  for (let i = 20 * 60 * FS; i < 20 * 60 * FS + 320 * FS; i++) long[i] = 90;
  assert.equal(extractFIGOFeatures(long, restUc(60), FS).figoSuggested, "pathological");
  const mid = fhrMinutes([[60, "wave"]]);
  for (let i = 20 * 60 * FS; i < 20 * 60 * FS + 200 * FS; i++) mid[i] = 90;
  assert.equal(extractFIGOFeatures(mid, restUc(60), FS).figoSuggested, "suspicious");
});

test("tachysystole is a separate flag, not an FHR category driver", () => {
  const uc = restUc(60);
  for (let s = 0; s < 3600; s += 100) for (let i = s * FS; i < (s + 60) * FS; i++) uc[i] = 60; // 6 per 10 min
  const f = extractFIGOFeatures(fhrMinutes([[60, "wave"]]), uc, FS);
  assert.equal(f.contractions.tachysystole, true);
  assert.equal(f.figoSuggested, "normal");
});

test("detectContractions measures above resting tone, so drift does not create contractions", () => {
  const uc = new Float64Array(600 * FS);
  for (let i = 0; i < uc.length; i++) uc[i] = 10 + (i / uc.length) * 12; // slow drift of 12 units, no contraction
  assert.equal(detectContractions(uc, FS).length, 0);
  for (let i = 100 * FS; i < 160 * FS; i++) uc[i] += 30; // one 60 s contraction
  assert.equal(detectContractions(uc, FS).length, 1);
});

test("decelSubtype: late when the nadir lags the contraction peak by over 20 s", () => {
  const c = [{ start: 0, end: 60 * FS, peak: 30 * FS }];
  assert.equal(decelSubtype({ start: 20 * FS, end: 90 * FS, nadir: 60 * FS, durationSec: 70 }, c, FS), "late");
  assert.equal(decelSubtype({ start: 0, end: 60 * FS, nadir: 32 * FS, durationSec: 60 }, c, FS), "early");
  assert.equal(decelSubtype({ start: 25 * FS, end: 50 * FS, nadir: 35 * FS, durationSec: 25 }, c, FS), "variable");
  assert.equal(decelSubtype({ start: 0, end: 200 * FS, nadir: 60 * FS, durationSec: 200 }, c, FS), "prolonged");
});

test("acidosisClass follows the Low criteria and never invents a missing value", () => {
  assert.equal(acidosisClass({ pH: 7.0, BDecf: 14 }), "metabolic");
  assert.equal(acidosisClass({ pH: 7.15, BDecf: 6 }), "acidaemia_not_metabolic");
  assert.equal(acidosisClass({ pH: 7.1 }), "acidaemia_unspecified");
  assert.equal(acidosisClass({ pH: 7.25, BDecf: 3 }), "normal");
  assert.equal(acidosisClass({}), "unknown");
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --test test/tokos-ctg-prep.test.mjs
```
Expected: FAIL (`extractFIGOFeatures` and the other v2 functions are not exported).

- [ ] **Step 3: Implement**

```js
// tools/tokos-ctg-prep.mjs (append)
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
```

- [ ] **Step 4: Run, verify pass (v1 tests included)**

```bash
node --test test/tokos-ctg-prep.test.mjs
```
Expected: all PASS. If "twoPassBaseline ignores recurrent deep decelerations" fails by 5 bpm, print the pass-1 and pass-2 values and check the drop share: ten 40 s drops in 30 min is 22% of samples, under the 25% the interquartile pass removes.

- [ ] **Step 5: Commit**

```bash
git add tools/tokos-ctg-prep.mjs test/tokos-ctg-prep.test.mjs
git commit -m "feat(tokos): FIGO 2015 features, signal quality, acidosis class"
```

---

### Task 1c (v2): Calibrated trace renderer

**Files:**
- Modify: `tools/tokos-ctg-prep.mjs` (append; v1's `renderTraceSvg` and its test stay)
- Test: `test/tokos-ctg-prep.test.mjs` (append)

**Interfaces:**
- Consumes: `CFG` (Task 1b)
- Produces: `LAYOUT` constants, `yForBpm(layout, bpm)`, `renderCalibratedTraceSvg(fhr, uc, fs) -> {svg, layout}` where `layout = {W, H, padL, plotW, yTop, hFhr, fhrMin, fhrMax, ucTop, hUc, durationSec}` is stored per case in `ctg.json` and read by the calipers (Task 6b).

- [ ] **Step 1: Write the failing tests**

```js
// test/tokos-ctg-prep.test.mjs (append)
import { renderCalibratedTraceSvg, yForBpm } from "../tools/tokos-ctg-prep.mjs";

test("calibrated renderer: 110/160 band, amber 100 line, one major line per minute, no <style>", () => {
  const fhr = new Float64Array(30 * 60 * 4).fill(140), uc = new Float64Array(30 * 60 * 4).fill(10);
  const { svg, layout } = renderCalibratedTraceSvg(fhr, uc, 4);
  assert.ok(!/<style/i.test(svg), "inline SVG must not carry a <style> element");
  assert.ok(svg.includes('class="tk-band"'));
  assert.equal((svg.match(/class="tk-line-normal"/g) || []).length, 2);
  assert.equal((svg.match(/class="tk-line-100"/g) || []).length, 1);
  assert.equal((svg.match(/class="tk-grid-major-t"/g) || []).length, 31);
  assert.equal(layout.durationSec, 1800);
  assert.ok(svg.includes('y1="' + yForBpm(layout, 110).toFixed(1) + '"'));
});

test("calibrated renderer breaks the FHR path on dropout and on values over 210", () => {
  const fhr = Float64Array.from([140, 141, 0, 0, 142, 143, 250, 144, 145]);
  const { svg } = renderCalibratedTraceSvg(fhr, new Float64Array(9).fill(10), 4);
  const d = /class="tk-fhr" d="([^"]*)"/.exec(svg)[1];
  assert.equal((d.match(/M/g) || []).length, 3);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --test test/tokos-ctg-prep.test.mjs
```

- [ ] **Step 3: Implement**

```js
// tools/tokos-ctg-prep.mjs (append)
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
  const x = (i) => L.padL + (i / Math.max(1, fhr.length - 1)) * L.plotW;
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
      if (isFhr && !(s[i] >= CFG.FHR_MIN && s[i] <= CFG.FHR_MAX)) { pen = false; continue; }
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
```

Note: the dropout test uses `fs = 4`, so `step = 2`; the test's sample positions are chosen so every run still starts with its own `M` after decimation. If decimation hides a run, set `fs = 2` in that test (step 1) rather than weakening the assertion.

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/tokos-ctg-prep.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add tools/tokos-ctg-prep.mjs test/tokos-ctg-prep.test.mjs
git commit -m "feat(tokos): calibrated CTG renderer (10 bpm grid, 110-160 band, 100 bpm line, minute ticks)"
```

---

### Task 1d (v2): Case selection by computed features, vignettes from real fields, review queue

**Files:**
- Modify: `tools/tokos-ctg-prep.mjs` (new `mainV2()`; v1's `main()` stays but is no longer the entry point)
- Create (generated): `tokos/decks/ctg.json` (replaces the v1-generated file), `tokos/media/ctg/*.svg`, `docs/tokos/review-queue.md`
- Test: `test/tokos-content.test.mjs` (append)

**Interfaces:**
- Consumes: Tasks 1, 1b, 1c
- Produces: case shape `{id, svg, layout, vignette, features, figo, outcome, acidosis, review: null}`, read by Tasks 6, 6b, 6c.

- [ ] **Step 1: Confirm the header field codings before using them**

Read the field descriptions on https://physionet.org/content/ctu-uhb-ctgdb/1.0.0/ and the Chudáček 2014 paper. Record the meaning of the coded fields `Presentation`, `Sex`, `Deliv. type`, `Rec. type`, `Diabetes`, `Hypertension`, `Preeclampsia`, `Pyrexia`, `Meconium`, `Liq. praecox`, `Induced` (for example whether 1 means yes, or 1 means cephalic) in a comment at the top of `mainV2()`. **Any field whose coding cannot be confirmed from those two sources is not shown in the vignette.** Also confirm the units of `pCO2` (the 1001 header shows 7.7, consistent with kPa) and `BDecf` (mmol/L).

- [ ] **Step 2: Write `vignetteFrom` and `mainV2`**

```js
// tools/tokos-ctg-prep.mjs (append)
// Only real header fields. Birth weight and sex are outcomes: they go in the reveal, not the vignette.
// FIELD_OK lists the coded fields whose meaning Step 1 confirmed; leave a field out if it was not confirmed.
const FIELD_OK = { Diabetes: true, Hypertension: true, Preeclampsia: true, Pyrexia: true, Meconium: true, Induced: true };
export function vignetteFrom(c) {
  const v = { age: c["Age"], gravidity: c["Gravidity"], parity: c["Parity"], gestWeeks: c["Gest. weeks"], risks: [] };
  ["Diabetes", "Hypertension", "Preeclampsia", "Pyrexia", "Meconium"].forEach((k) => { if (FIELD_OK[k] && c[k] === 1) v.risks.push(k.toLowerCase()); });
  if (FIELD_OK.Induced && c["Induced"] != null) v.induced = c["Induced"] === 1;
  if (c["I.stage"] != null) v.stage1Min = c["I.stage"];
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
export function pickCases(cands) {
  const used = new Set(), out = [];
  WANT.forEach(([arch, n, test]) => {
    cands.filter((k) => !used.has(k.id) && test(k.features, k.acidosis)).slice(0, n).forEach((k) => { used.add(k.id); out.push(Object.assign({ archetypeSuggested: arch }, k)); });
  });
  cands.filter((k) => !used.has(k.id)).slice(0, 12 - out.length).forEach((k) => out.push(Object.assign({ archetypeSuggested: "fill" }, k)));
  return out.slice(0, 12);
}

export async function mainV2() {
  mkdirSync(OUT_MEDIA_DIR, { recursive: true });
  const ids = (await fetchText("RECORDS")).trim().split("\n");
  const headers = [];
  for (const id of ids) {
    const h = decodeHeader(await fetchText(id + ".hea"));
    if (h.clinical["pH"] != null) headers.push(h);
  }
  // Stage A (headers only): up to 12 per pH band, so the .dat downloads stay under ~36 files.
  const band = (ph) => (ph >= 7.2 ? 0 : ph >= 7.05 ? 1 : 2);
  const perBand = [[], [], []];
  headers.forEach((h) => { const b = band(h.clinical["pH"]); if (perBand[b].length < 12) perBand[b].push(h); });
  // Stage B: features for each candidate, in memory only.
  const cands = [];
  for (const h of perBand.flat()) {
    const raw = decodeSignal(await fetchBuf(h.record + ".dat"), h);
    const fhr = toPhysical(raw[0], h.signals[0]), uc = toPhysical(raw[1], h.signals[1]);
    const features = extractFIGOFeatures(fhr, uc, h.fs);
    if (!features || features.quality.suboptimal) continue;
    const n = Math.min(fhr.length, CFG.STRIP_MIN * 60 * h.fs);
    cands.push({ id: h.record, h, fhr: fhr.slice(fhr.length - n), uc: uc.slice(uc.length - n), features, acidosis: acidosisClass(h.clinical) });
  }
  const chosen = pickCases(cands);
  const cases = chosen.map((k) => {
    const { svg, layout } = renderCalibratedTraceSvg(k.fhr, k.uc, k.h.fs);
    writeFileSync(OUT_MEDIA_DIR + "/" + k.id + ".svg", svg);
    const c = k.h.clinical;
    return {
      id: k.id, svg: "ctg/" + k.id + ".svg", layout, archetypeSuggested: k.archetypeSuggested,
      vignette: vignetteFrom(c), features: k.features, figo: k.features.figoSuggested,
      outcome: { pH: c["pH"], BE: c["BE"], BDecf: c["BDecf"], pCO2: c["pCO2"], apgar1: c["Apgar1"], apgar5: c["Apgar5"], weightG: c["Weight(g)"] },
      acidosis: k.acidosis, review: null,
    };
  });
  writeFileSync(OUT_DECK, JSON.stringify({ v: 2, id: "ctg", cases }, null, 1));
  mkdirSync("docs/tokos", { recursive: true });
  writeFileSync("docs/tokos/review-queue.md", "# Tokós CTG review queue\n\nFor an obstetrician: confirm or correct each suggested label, then set `review` in `tokos/decks/ctg.json` to `{\"by\": \"<name>\", \"date\": \"YYYY-MM-DD\", \"figo\": \"...\", \"decelType\": \"...\" }`. Until then the app shows every label as rule-based.\n\n" +
    cases.map((c) => "## " + c.id + " (" + c.archetypeSuggested + ")\n- Trace: `tokos/media/" + c.svg + "`\n- Suggested FIGO: " + c.figo + "; baseline " + c.features.baseline + " (" + c.features.baselineClass + "); variability " + c.features.variability.band + " (median range " + c.features.variability.medianRange + " bpm, reduced " + c.features.variability.reducedMin + " min); decelerations " + c.features.decels.map((d) => d.durationSec + " s " + d.subtypeSuggested).join(", ") + "; contractions " + c.features.contractions.per10 + " per 10 min\n- Outcome: pH " + c.outcome.pH + ", BDecf " + c.outcome.BDecf + ", acidosis " + c.acidosis + "\n").join("\n"));
  console.log("wrote " + cases.length + " cases; archetypes: " + cases.map((c) => c.archetypeSuggested).join(", "));
}
```

Change the script's entry line to run `mainV2` instead of `main`:
```js
if (import.meta.url === "file://" + process.argv[1]) mainV2().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Extend the content test**

```js
// test/tokos-content.test.mjs (append)
test("v2 cases carry layout, vignette from real fields only, suggested labels and a null review", () => {
  const banned = ["cervix", "dilation", "oxytocin", "bp", "pulse", "temperature"];
  deck.cases.forEach((c) => {
    assert.ok(c.layout && c.layout.plotW > 0 && c.layout.durationSec > 0, c.id + " layout");
    Object.keys(c.vignette).forEach((k) => assert.ok(!banned.some((b) => k.toLowerCase().includes(b)), c.id + " invented field " + k));
    assert.ok(["normal", "suspicious", "pathological"].includes(c.figo));
    assert.ok(["normal", "metabolic", "acidaemia_not_metabolic", "acidaemia_unspecified", "unknown"].includes(c.acidosis));
    assert.ok(c.review === null || typeof c.review.by === "string");
    assert.ok(!("weightG" in c.vignette), "birth weight is an outcome, not a vignette field");
  });
});
```
The v1 content test ("plausible, licence-attributable case set") keeps passing: it reads `c.features.variabilityBand` and `c.features.decelCount`. **Keep those two v1 fields** by adding to the case object in `mainV2`: `features: Object.assign({ variabilityBand: k.features.variability.band, decelCount: k.features.decels.length }, k.features)`.

- [ ] **Step 4: Run the pipeline and the tests**

```bash
df -h / | tail -1
node tools/tokos-ctg-prep.mjs
node --test test/tokos-content.test.mjs test/tokos-ctg-prep.test.mjs
du -sh tokos/media/ctg
```
Expected: 12 cases (fewer only if the dataset lacks an archetype; the log says which were filled), tests PASS, SVGs under about 150 KB each.

- [ ] **Step 5: Look at every trace yourself**

Open each SVG (`open tokos/media/ctg/*.svg`, or screenshot them through the Task 6 UI test harness). For each, check the grid and path render and that the suggested labels are not obviously wrong. Note anything odd in `docs/tokos/review-queue.md`. This is not clinical sign-off: it catches pipeline bugs before a clinician's time is spent.

- [ ] **Step 6: Commit**

```bash
git add tools/tokos-ctg-prep.mjs test/tokos-content.test.mjs tokos/decks/ctg.json tokos/media/ctg docs/tokos/review-queue.md
git commit -m "feat(tokos): pick 12 cases by computed features, real-field vignettes, reviewer queue"
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

### Task 4: `tokos-data.js` (levels, trials, persistence, adapted subset)

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
(`labelHi` is "CTG padhna" in Devanagari, a working, reviewable placeholder; flagged for the Hindi content review the same way Ophthalmós's Hindi strings were.)

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
Expected: ALL GREEN. If the trial-gate test fails because a fetch already happened before the check, fix `bind()`'s `clinic` handler so `gate()` wraps the state change, not just logging, the fetch for `tracks.json`/`ctg.json` already happened at `open()` time in this design (that's fine, tracks/deck metadata isn't gated, only starting a session is); if the test expects a *session/case* fetch to be skipped and none occurs because cases are already in `st.decks` from `loadAll()`, that's correct behavior, not a bug, adjust the test's assertion to check that no *new* network call fires on a spent trial, not that zero fetches ever happened.

- [ ] **Step 5: Commit**

```bash
git add tokos.js tokos.css test/run-tokos-ui.mjs
git commit -m "feat(tokos): DOM layer, CTG clinic session + reveal screen"
```

---

### Task 6b (v2): Digital calipers (`tokos-calipers.js`)

**Files:**
- Create: `tokos-calipers.js`
- Test: `test/tokos-calipers.test.mjs`

**Interfaces:**
- Consumes: a case's `layout` (Task 1c), an inline trace `<svg>` element (Task 6c)
- Produces: `window.TOKOS_CALIPERS = { yForBpm, bpmAt, secAt, deltaBpm, deltaSec, readout, toViewBox, attach }`; `attach(svg, layout, onChange) -> { setMode("bpm"|"time"), set(key, value), readout(lang), destroy() }`. All positions are **viewBox units**, so readings do not change with CSS scale, pinch-zoom or pan.

- [ ] **Step 1: Write the failing test**

```js
// test/tokos-calipers.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderCalibratedTraceSvg, yForBpm } from "../tools/tokos-ctg-prep.mjs";
const K = createRequire(import.meta.url)("../tokos-calipers.js");
const { layout: L } = renderCalibratedTraceSvg(new Float64Array(30 * 60 * 4).fill(140), new Float64Array(30 * 60 * 4).fill(10), 4);

test("caliper y mapping agrees with the renderer", () => {
  assert.equal(K.yForBpm(L, 110).toFixed(3), yForBpm(L, 110).toFixed(3));
  assert.equal(Math.round(K.bpmAt(L, yForBpm(L, 137))), 137);
});

test("deltaBpm between the 160 and 110 lines is 50; deltaSec over 100 s of plot is 100", () => {
  assert.equal(K.deltaBpm(L, yForBpm(L, 160), yForBpm(L, 110)), 50);
  const x1 = L.padL + L.plotW * 0.2, x2 = x1 + (100 / L.durationSec) * L.plotW;
  assert.equal(K.deltaSec(L, x1, x2), 100);
});

test("readouts use a colon, no em-dash, and ASCII digits in Hindi", () => {
  const st = { mode: "bpm", y1: yForBpm(L, 150), y2: yForBpm(L, 138), x1: 0, x2: 0 };
  const en = K.readout(L, st, "en"), hi = K.readout(L, st, "hi");
  assert.match(en, /^Range: 12 bpm, normal/);
  assert.ok(!/—/.test(en + hi));
  assert.ok(/12/.test(hi) && !/[०-९]/.test(hi));
  const t = K.readout(L, { mode: "time", x1: L.padL, x2: L.padL + (200 / L.durationSec) * L.plotW, y1: 0, y2: 0 }, "en");
  assert.match(t, /^Span: 3 min 20 s \(200 s\), prolonged/);
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
node --test test/tokos-calipers.test.mjs
```

- [ ] **Step 3: Implement**

```js
/* Tokós digital calipers: measure bpm range and time span on the CTG strip. ES5.
   Positions are viewBox units of the inline trace SVG (layout from tokos/decks/ctg.json), mapped from
   the pointer through getScreenCTM().inverse(), so zoom and pan never change a reading. */
(function (G) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var WORDS = {
    en: { range: "Range", span: "Span", min: "min", s: "s", reduced: "reduced (below 5)", normal: "normal (5 to 25)", increased: "increased (above 25)",
      short: "shorter than a deceleration (under 15 s)", decel: "deceleration length (15 s to 3 min)", prolonged: "prolonged (3 to 5 min)", over5: "over 5 min" },
    hi: { range: "रेंज", span: "अवधि", min: "मिनट", s: "सेकंड", reduced: "कम (5 से कम)", normal: "सामान्य (5 से 25)", increased: "अधिक (25 से ऊपर)",
      short: "डिसेलेरेशन से छोटा (15 s से कम)", decel: "डिसेलेरेशन जितना (15 s से 3 मिनट)", prolonged: "लंबा (3 से 5 मिनट)", over5: "5 मिनट से अधिक" }
  };
  function yForBpm(L, bpm) { return L.yTop + L.hFhr - ((Math.min(Math.max(bpm, L.fhrMin), L.fhrMax) - L.fhrMin) / (L.fhrMax - L.fhrMin)) * L.hFhr; }
  function bpmAt(L, y) { return L.fhrMax - ((y - L.yTop) / L.hFhr) * (L.fhrMax - L.fhrMin); }
  function secAt(L, x) { return ((x - L.padL) / L.plotW) * L.durationSec; }
  function deltaBpm(L, y1, y2) { return Math.round(Math.abs(bpmAt(L, y1) - bpmAt(L, y2))); }
  function deltaSec(L, x1, x2) { return Math.round(Math.abs(secAt(L, x2) - secAt(L, x1))); }
  function readout(L, st, lang) {
    var w = WORDS[lang === "hi" ? "hi" : "en"];
    if (st.mode === "bpm") {
      var d = deltaBpm(L, st.y1, st.y2);
      return w.range + ": " + d + " bpm, " + (d < 5 ? w.reduced : d > 25 ? w.increased : w.normal);
    }
    var s = deltaSec(L, st.x1, st.x2), m = Math.floor(s / 60), r = s % 60;
    var label = s < 15 ? w.short : s < 180 ? w.decel : s <= 300 ? w.prolonged : w.over5;
    return w.span + ": " + (m ? m + " " + w.min + " " : "") + r + " " + w.s + " (" + s + " s), " + label;
  }
  function toViewBox(svg, clientX, clientY) {
    var p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function attach(svg, L, onChange) {
    var st = { mode: "bpm", y1: yForBpm(L, 160), y2: yForBpm(L, 110), x1: L.padL + L.plotW * 0.4, x2: L.padL + L.plotW * 0.5 };
    var g = G.document.createElementNS(NS, "g"); g.setAttribute("class", "tk-cal"); svg.appendChild(g);
    function mk() {
      var vis = G.document.createElementNS(NS, "line"), hit = G.document.createElementNS(NS, "line");
      vis.setAttribute("class", "tk-cal-line"); hit.setAttribute("class", "tk-cal-hit");
      g.appendChild(vis); g.appendChild(hit);
      hit.addEventListener("pointerdown", function (e) {
        e.stopPropagation(); e.preventDefault(); // the stage must not pan while a caliper moves
        try { hit.setPointerCapture(e.pointerId); } catch (x) {}
        function move(ev) {
          var p = toViewBox(svg, ev.clientX, ev.clientY), f = hit.getAttribute("data-key"); // y1/y2 in bpm mode, x1/x2 in time mode
          if (st.mode === "bpm") st[f] = Math.min(Math.max(p.y, L.yTop), L.yTop + L.hFhr);
          else st[f] = Math.min(Math.max(p.x, L.padL), L.padL + L.plotW);
          draw();
        }
        function up() { hit.removeEventListener("pointermove", move); hit.removeEventListener("pointerup", up); hit.removeEventListener("pointercancel", up); }
        hit.addEventListener("pointermove", move); hit.addEventListener("pointerup", up); hit.addEventListener("pointercancel", up);
      });
      return [vis, hit];
    }
    var a = mk(), b = mk();
    function place(pair, v) {
      pair.forEach(function (l) {
        if (st.mode === "bpm") { l.setAttribute("x1", L.padL); l.setAttribute("x2", L.padL + L.plotW); l.setAttribute("y1", v); l.setAttribute("y2", v); }
        else { l.setAttribute("y1", L.yTop); l.setAttribute("y2", L.yTop + L.hFhr); l.setAttribute("x1", v); l.setAttribute("x2", v); }
      });
    }
    function draw() {
      a[1].setAttribute("data-key", st.mode === "bpm" ? "y1" : "x1"); b[1].setAttribute("data-key", st.mode === "bpm" ? "y2" : "x2");
      place(a, st.mode === "bpm" ? st.y1 : st.x1); place(b, st.mode === "bpm" ? st.y2 : st.x2);
      if (onChange) onChange(st);
    }
    draw();
    return {
      setMode: function (m) { st.mode = m === "time" ? "time" : "bpm"; draw(); },
      set: function (k, v) { st[k] = v; draw(); },
      state: function () { return st; },
      readout: function (lang) { return readout(L, st, lang); },
      destroy: function () { if (g.parentNode) g.parentNode.removeChild(g); }
    };
  }
  var API = { yForBpm: yForBpm, bpmAt: bpmAt, secAt: secAt, deltaBpm: deltaBpm, deltaSec: deltaSec, readout: readout, toViewBox: toViewBox, attach: attach };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.TOKOS_CALIPERS = API;
})(typeof window !== "undefined" ? window : this);
```

`draw()` sets each hit line's `data-key` for the current mode (`y1`/`y2` or `x1`/`x2`), and `move` reads it, so one pair of lines serves both modes. The Task 6c UI test drags a handle to check this.

- [ ] **Step 4: Run, verify pass**

```bash
node --check tokos-calipers.js
node --test test/tokos-calipers.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add tokos-calipers.js test/tokos-calipers.test.mjs
git commit -m "feat(tokos): digital calipers in viewBox units (bpm range, time span)"
```

---

### Task 6c (v2): FIGO checklist, grading, rationale, themes, inline trace

UI task: load and follow `ui-ux-pro-max:ui-ux-pro-max` and `anti-ui-slop` (design contract and required states: loading, error, empty session, locked, trial, answered, submitted, session done), then `impeccable`, `taste-skill`, `emil-design-eng` while building, then `web-design-guidelines` and the `anti-ui-slop` finish gate.

**Files:**
- Modify: `tokos-data.js` (add pure checklist and grading functions)
- Modify: `test/tokos-data.test.mjs` (append)
- Create: `tokos/rationale.json`
- Modify: `tokos.js`, `tokos.css`
- Modify: `test/run-tokos-ui.mjs` (append steps; adapt two v1 steps, see Step 7)
- Modify: `index.html` (add `tokos-calipers.js` before `tokos.js`, same `?v=` token) in Task 7

**Interfaces:**
- Consumes: case shape (Task 1d), `TOKOS_CALIPERS` (Task 6b), `TOKOS_CORE.review/buildSession/GOOD...` (Task 2)
- Produces (in `TOKOS_DATA`): `QUESTIONS`, `checklistFor(case, level) -> [questionId]`, `truthFor(case) -> {uc, baseline, variability, decels, decelType?, figo, action}`, `gradeChecklist(ids, answers, truth) -> {matches, total, pct, grade, perQ}`, `rationaleKeys(case) -> [key]`

- [ ] **Step 1: Write the failing data tests**

```js
// test/tokos-data.test.mjs (append)
const C = createRequire(import.meta.url)("../tokos-core.js");
const baseCase = {
  figo: "suspicious", acidosis: "metabolic", review: null, vignette: { risks: ["pyrexia"] },
  features: { baselineClass: "tachycardia", variability: { band: "normal" }, contractions: { tachysystole: false }, decels: [{ durationSec: 200, subtypeSuggested: "late" }] },
};

test("MBBS answers 5 questions; Resident adds action, and decelType only when a reviewer confirmed it", () => {
  assert.deepEqual(D.checklistFor(baseCase, "mbbs"), ["uc", "baseline", "variability", "decels", "figo"]);
  assert.deepEqual(D.checklistFor(baseCase, "resident"), ["uc", "baseline", "variability", "decels", "figo", "action"]);
  const reviewed = Object.assign({}, baseCase, { review: { by: "Dr X", decelType: "late" } });
  assert.ok(D.checklistFor(reviewed, "resident").includes("decelType"));
});

test("truthFor derives from features, and a reviewer's label wins over the rule", () => {
  const t = D.truthFor(baseCase);
  assert.deepEqual([t.uc, t.baseline, t.decels, t.figo, t.action], ["normal", "tachycardia", "prolonged", "suspicious", "suspicious"]);
  assert.equal(D.truthFor(Object.assign({}, baseCase, { review: { figo: "pathological" } })).figo, "pathological");
});

test("grading: all right is EASY, a wrong FIGO category caps at HARD, under half is AGAIN", () => {
  const ids = D.checklistFor(baseCase, "mbbs"), t = D.truthFor(baseCase);
  const right = {}; ids.forEach((q) => (right[q] = t[q]));
  assert.equal(D.gradeChecklist(ids, right, t).grade, C.EASY);
  assert.equal(D.gradeChecklist(ids, Object.assign({}, right, { figo: "normal" }), t).grade, C.HARD);
  assert.equal(D.gradeChecklist(ids, { uc: "tachysystole", baseline: "normal", variability: "reduced", decels: "none", figo: "suspicious" }, t).grade, C.AGAIN);
});

test("rationaleKeys picks the teaching points this case shows, always ending with trace_vs_outcome", () => {
  const k = D.rationaleKeys(baseCase);
  assert.ok(k.includes("baseline.tachycardia") && k.includes("decels.prolonged") && k.includes("acidosis.metabolic") && k.includes("risk.pyrexia"));
  assert.equal(k[k.length - 1], "trace_vs_outcome");
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
node --test test/tokos-data.test.mjs
```

- [ ] **Step 3: Implement in `tokos-data.js`** (add inside the IIFE, and to `API`)

```js
  /* ---------- FIGO checklist (v2). MBBS: 5 reading questions. Resident: plus the FIGO action, and the
     deceleration type only where an obstetrician confirmed it (case.review.decelType). ---------- */
  var QUESTIONS = {
    uc: ["normal", "tachysystole"],
    baseline: ["severe_bradycardia", "bradycardia", "normal", "tachycardia"],
    variability: ["reduced", "normal", "increased"],
    decels: ["none", "present", "prolonged", "over5"],
    decelType: ["early", "late", "variable", "prolonged"],
    figo: ["normal", "suspicious", "pathological"],
    action: ["normal", "suspicious", "pathological"] // answer ids reuse the category; labels carry the FIGO action text
  };
  function checklistFor(c, level) {
    var q = ["uc", "baseline", "variability", "decels", "figo"];
    if (level !== "resident") return q;
    if (c.review && c.review.decelType) q.push("decelType");
    q.push("action");
    return q;
  }
  function truthFor(c) {
    var f = c.features, r = c.review || {}, maxD = 0;
    (f.decels || []).forEach(function (d) { if (d.durationSec > maxD) maxD = d.durationSec; });
    var figo = r.figo || c.figo;
    var t = {
      uc: f.contractions.tachysystole ? "tachysystole" : "normal",
      baseline: r.baselineClass || f.baselineClass,
      variability: r.variability || f.variability.band,
      decels: !f.decels || !f.decels.length ? "none" : maxD > 300 ? "over5" : maxD >= 180 ? "prolonged" : "present",
      figo: figo, action: figo
    };
    if (r.decelType) t.decelType = r.decelType;
    return t;
  }
  function gradeChecklist(ids, answers, truth) {
    var perQ = {}, m = 0;
    ids.forEach(function (q) { perQ[q] = answers[q] === truth[q]; if (perQ[q]) m++; });
    var pct = ids.length ? m / ids.length : 0, g;
    if (pct < 0.5) g = C.AGAIN;
    else if (!perQ.figo) g = C.HARD; // the overall category is the clinically critical call
    else if (pct < 0.8) g = C.HARD;
    else if (pct < 1) g = C.GOOD;
    else g = C.EASY;
    return { matches: m, total: ids.length, pct: pct, grade: g, perQ: perQ };
  }
  function rationaleKeys(c) {
    var t = truthFor(c), k = [];
    if (t.baseline !== "normal") k.push("baseline." + t.baseline);
    if (t.variability !== "normal") k.push("variability." + t.variability);
    if (t.decels !== "none") k.push("decels." + t.decels);
    if (t.uc === "tachysystole") k.push("uc.tachysystole");
    if (c.acidosis === "metabolic" || c.acidosis === "acidaemia_not_metabolic") k.push("acidosis." + c.acidosis);
    ((c.vignette && c.vignette.risks) || []).forEach(function (r) { if (r === "pyrexia" || r === "preeclampsia") k.push("risk." + r); });
    k.push("trace_vs_outcome");
    return k;
  }
```
Add `QUESTIONS: QUESTIONS, checklistFor: checklistFor, truthFor: truthFor, gradeChecklist: gradeChecklist, rationaleKeys: rationaleKeys` to `API`.

- [ ] **Step 4: Run, verify pass**

```bash
node --test test/tokos-data.test.mjs
```

- [ ] **Step 5: Write `tokos/rationale.json`** (ai_drafted; every entry goes on the obstetrician's review list, and the Hindi on the Hindi review list)

```json
{
  "v": 1, "review": "ai_drafted",
  "baseline.tachycardia": { "en": "A baseline above 160 bpm can come from maternal fever, infection, drugs or dehydration, or from rising fetal catecholamines as the fetus compensates for falling oxygen.", "hi": "160 bpm से अधिक बेसलाइन माँ के बुखार, संक्रमण, दवाओं या पानी की कमी से हो सकती है, या तब जब घटती ऑक्सीजन की भरपाई के लिए भ्रूण में कैटेकोलामाइन बढ़ते हैं।" },
  "baseline.bradycardia": { "en": "A baseline of 100 to 109 bpm can be normal in a post-term fetus. Look at variability and decelerations before reading it as hypoxia.", "hi": "100 से 109 bpm की बेसलाइन पोस्ट-टर्म भ्रूण में सामान्य हो सकती है। इसे हाइपोक्सिया मानने से पहले परिवर्तनशीलता और डिसेलेरेशन देखें।" },
  "baseline.severe_bradycardia": { "en": "A baseline below 100 bpm means the fetal heart cannot keep up its output. FIGO classes it as pathological.", "hi": "100 bpm से कम बेसलाइन का अर्थ है कि भ्रूण का हृदय अपना आउटपुट बनाए नहीं रख पा रहा। FIGO इसे पैथोलॉजिकल मानता है।" },
  "variability.reduced": { "en": "Variability shows the autonomic nervous system adjusting the heart rate beat to beat. It falls in fetal sleep (usually under 50 minutes), with some drugs, and when hypoxia depresses the central nervous system.", "hi": "परिवर्तनशीलता दिखाती है कि स्वायत्त तंत्रिका तंत्र हर धड़कन पर हृदय गति को समायोजित कर रहा है। यह भ्रूण की नींद (आमतौर पर 50 मिनट से कम), कुछ दवाओं, और हाइपोक्सिया से केंद्रीय तंत्रिका तंत्र के दबने पर घटती है।" },
  "variability.increased": { "en": "Increased (saltatory) variability can signal rapidly developing hypoxaemia, often alongside repeated decelerations.", "hi": "बढ़ी हुई (साल्टेटरी) परिवर्तनशीलता तेज़ी से बढ़ते हाइपोक्सीमिया का संकेत हो सकती है, अक्सर बार-बार डिसेलेरेशन के साथ।" },
  "decels.present": { "en": "A deceleration is a reflex. Cord compression raises fetal blood pressure and baroreceptors slow the heart through the vagus nerve; less oxygen from the placenta during a contraction slows it through chemoreceptors.", "hi": "डिसेलेरेशन एक रिफ्लेक्स है। कॉर्ड दबने से भ्रूण का रक्तचाप बढ़ता है और बैरोरिसेप्टर वेगस तंत्रिका से हृदय को धीमा करते हैं; संकुचन के दौरान प्लेसेंटा से कम ऑक्सीजन मिलने पर कीमोरिसेप्टर इसे धीमा करते हैं।" },
  "decels.prolonged": { "en": "A deceleration longer than 3 minutes suggests fetal hypoxaemia. FIGO treats one longer than 5 minutes as pathological.", "hi": "3 मिनट से लंबा डिसेलेरेशन भ्रूण हाइपोक्सीमिया का संकेत देता है। FIGO 5 मिनट से लंबे को पैथोलॉजिकल मानता है।" },
  "decels.over5": { "en": "A deceleration lasting over 5 minutes is pathological under FIGO 2015: the fetus is short of oxygen now and action is needed now.", "hi": "5 मिनट से अधिक चलने वाला डिसेलेरेशन FIGO 2015 में पैथोलॉजिकल है: भ्रूण को अभी ऑक्सीजन कम मिल रही है और अभी कार्रवाई ज़रूरी है।" },
  "uc.tachysystole": { "en": "More than 5 contractions in 10 minutes leaves too little time between them for the placenta to refill with oxygenated blood. FIGO handles it apart from the heart-rate category: reduce or stop oxytocin if it is running, and consider tocolysis.", "hi": "10 मिनट में 5 से अधिक संकुचन होने पर उनके बीच प्लेसेंटा को ऑक्सीजन वाला रक्त भरने का समय नहीं मिलता। FIGO इसे हृदय-गति वर्गीकरण से अलग मानता है: यदि ऑक्सीटोसिन चल रहा है तो घटाएं या रोकें, और टोकोलाइसिस पर विचार करें।" },
  "acidosis.metabolic": { "en": "pH below 7.05 with a base deficit of 12 mmol/L or more is metabolic acidosis: tissues switched to anaerobic metabolism and lactic acid built up. This is the pattern linked with neonatal injury.", "hi": "7.05 से कम pH के साथ 12 mmol/L या अधिक बेस डेफिसिट मेटाबोलिक एसिडोसिस है: ऊतक एनारोबिक मेटाबोलिज़्म पर चले गए और लैक्टिक एसिड जमा हुआ। यही पैटर्न नवजात को चोट से जुड़ा है।" },
  "acidosis.acidaemia_not_metabolic": { "en": "pH below 7.20 without a high base deficit points to a mainly respiratory acidaemia: carbon dioxide built up for a short time, often late in labour, and it clears quickly after birth.", "hi": "उच्च बेस डेफिसिट के बिना 7.20 से कम pH मुख्यतः श्वसन एसिडीमिया दर्शाता है: कार्बन डाइऑक्साइड थोड़े समय के लिए जमा हुई, अक्सर प्रसव के अंत में, और जन्म के बाद जल्दी साफ हो जाती है।" },
  "risk.pyrexia": { "en": "Maternal fever raises the fetal baseline and can signal chorioamnionitis, which lowers the fetus's tolerance of hypoxia.", "hi": "माँ का बुखार भ्रूण की बेसलाइन बढ़ाता है और कोरियोएम्नियोनाइटिस का संकेत हो सकता है, जिससे भ्रूण की हाइपोक्सिया सहने की क्षमता घटती है।" },
  "risk.preeclampsia": { "en": "Pre-eclampsia can reduce placental reserve, so the fetus may decompensate sooner under the stress of contractions.", "hi": "प्री-एक्लेम्पसिया प्लेसेंटा के रिज़र्व को कम कर सकता है, इसलिए संकुचनों के तनाव में भ्रूण जल्दी विफल हो सकता है।" },
  "trace_vs_outcome": { "en": "The trace and the cord blood result are separate pieces of evidence. A reassuring trace can come before a low pH, and a worrying trace can end with a normal pH.", "hi": "ट्रेस और कॉर्ड ब्लड का परिणाम अलग-अलग प्रमाण हैं। आश्वस्त करने वाले ट्रेस के बाद भी pH कम हो सकता है, और चिंताजनक ट्रेस के बाद भी pH सामान्य हो सकता है।" }
}
```
Add a content test: every key `rationaleKeys` can return exists in `rationale.json` with non-empty `en` and `hi`, and no value contains an em-dash.

```js
// test/tokos-content.test.mjs (append)
test("rationale.json covers every key rationaleKeys can return, in both languages, with no em-dash", () => {
  const R = JSON.parse(readFileSync("tokos/rationale.json", "utf8"));
  const keys = ["baseline.tachycardia", "baseline.bradycardia", "baseline.severe_bradycardia", "variability.reduced", "variability.increased",
    "decels.present", "decels.prolonged", "decels.over5", "uc.tachysystole", "acidosis.metabolic", "acidosis.acidaemia_not_metabolic",
    "risk.pyrexia", "risk.preeclampsia", "trace_vs_outcome"];
  keys.forEach((k) => {
    assert.ok(R[k] && R[k].en && R[k].hi, "missing " + k);
    assert.ok(!/—/.test(R[k].en + R[k].hi), "em-dash in " + k);
  });
});
```

- [ ] **Step 6: Build the clinic screens in `tokos.js`**

Replace v1's `renderClinic`, `renderReveal` and the `clinic`/`reveal`/`next` branches of `bind` with the code below. Keep v1's `gate`, `getJSON`, `loadAll`, `open`, `close`, `back` and the error/loading branches of `renderHub`. Also:
- **v1 bug fixed here:** v1 gated every clinic start behind the Resident trial, which charged MBBS learners a trial for a free level. Gate only when `level() === "resident"`.
- Load `tokos/rationale.json` in `loadAll()` alongside the tracks (`st.rationale`).
- Add hub controls: a language toggle (`data-act="lang"`, English / हिन्दी) and a level switch (`data-act="level"`, MBBS / Resident, the Pro lock badge on Resident when locked). Both save with `D.savePrefs`.

```js
  var L10N = {
    en: { contractions: "Contractions", baseline: "Baseline heart rate", variability: "Variability", decels: "Decelerations", decelType: "Deceleration type",
      figo: "Overall (FIGO 2015)", action: "Next step", submit: "Check my reading", next: "Next case", done: "Session done", caliper: "Calipers",
      bpmMode: "Measure bpm", timeMode: "Measure time", grid: "1 major square = 1 minute", quality: "Signal quality", rule: "Rule-based, pending obstetrician review",
      yours: "Yours", key: "Answer", features: "Trace features", outcome: "Recorded outcome at birth", why: "Why", notRecorded: "not recorded", nextReview: "Next review in",
      days: "days", vignette: "Patient", weeks: "weeks", age: "Age", gp: "G/P", stage1: "First stage", stage2: "Second stage", min: "min", induced: "Induced labour",
      risks: { diabetes: "Diabetes", hypertension: "Hypertension", preeclampsia: "Pre-eclampsia", pyrexia: "Maternal fever", meconium: "Meconium" },
      opts: {
        uc: { normal: "5 or fewer in 10 min", tachysystole: "More than 5 in 10 min (tachysystole)" },
        baseline: { severe_bradycardia: "Below 100", bradycardia: "100 to 109", normal: "110 to 160", tachycardia: "Above 160" },
        variability: { reduced: "Below 5 bpm", normal: "5 to 25 bpm", increased: "Above 25 bpm" },
        decels: { none: "None", present: "Present, under 3 min", prolonged: "Prolonged, 3 to 5 min", over5: "Over 5 min" },
        decelType: { early: "Early", late: "Late", variable: "Variable", prolonged: "Prolonged" },
        figo: { normal: "Normal", suspicious: "Suspicious", pathological: "Pathological" },
        action: { normal: "No intervention needed to improve fetal oxygenation", suspicious: "Correct reversible causes, monitor closely or add other methods", pathological: "Act now: correct reversible causes, add other methods, or expedite delivery if that is not possible" }
      } },
    hi: { contractions: "संकुचन", baseline: "बेसलाइन हृदय गति", variability: "परिवर्तनशीलता", decels: "डिसेलेरेशन", decelType: "डिसेलेरेशन का प्रकार",
      figo: "कुल वर्गीकरण (FIGO 2015)", action: "अगला कदम", submit: "मेरी रीडिंग जांचें", next: "अगला केस", done: "सत्र पूरा", caliper: "कैलिपर",
      bpmMode: "bpm मापें", timeMode: "समय मापें", grid: "1 बड़ा खाना = 1 मिनट", quality: "सिग्नल गुणवत्ता", rule: "नियम-आधारित, प्रसूति विशेषज्ञ की समीक्षा बाकी",
      yours: "आपका", key: "उत्तर", features: "ट्रेस की विशेषताएं", outcome: "जन्म के समय दर्ज परिणाम", why: "क्यों", notRecorded: "दर्ज नहीं", nextReview: "अगली समीक्षा",
      days: "दिन में", vignette: "मरीज़", weeks: "सप्ताह", age: "आयु", gp: "G/P", stage1: "पहला चरण", stage2: "दूसरा चरण", min: "मिनट", induced: "प्रेरित प्रसव",
      risks: { diabetes: "मधुमेह", hypertension: "उच्च रक्तचाप", preeclampsia: "प्री-एक्लेम्पसिया", pyrexia: "माँ को बुखार", meconium: "मेकोनियम" },
      opts: {
        uc: { normal: "10 मिनट में 5 या कम", tachysystole: "10 मिनट में 5 से अधिक (टैकीसिस्टोल)" },
        baseline: { severe_bradycardia: "100 से कम", bradycardia: "100 से 109", normal: "110 से 160", tachycardia: "160 से अधिक" },
        variability: { reduced: "5 bpm से कम", normal: "5 से 25 bpm", increased: "25 bpm से अधिक" },
        decels: { none: "कोई नहीं", present: "मौजूद, 3 मिनट से कम", prolonged: "लंबा, 3 से 5 मिनट", over5: "5 मिनट से अधिक" },
        decelType: { early: "अर्ली", late: "लेट", variable: "वेरिएबल", prolonged: "प्रोलॉन्ग्ड" },
        figo: { normal: "सामान्य", suspicious: "संदिग्ध", pathological: "पैथोलॉजिकल" },
        action: { normal: "भ्रूण ऑक्सीजनेशन सुधारने के लिए किसी हस्तक्षेप की आवश्यकता नहीं", suspicious: "प्रतिवर्ती कारणों को ठीक करें, कड़ी निगरानी रखें या अन्य तरीके जोड़ें", pathological: "तुरंत कार्रवाई: प्रतिवर्ती कारण ठीक करें, अन्य तरीके जोड़ें, या संभव न हो तो प्रसव शीघ्र कराएं" }
      } }
  };
  var QLABEL = { uc: "contractions", baseline: "baseline", variability: "variability", decels: "decels", decelType: "decelType", figo: "figo", action: "action" };
  function W() { return L10N[st.prefs.lang === "hi" ? "hi" : "en"]; }
  function num(v, unit) { return v == null || v !== v ? W().notRecorded : String(v) + (unit ? " " + unit : ""); } // plain ASCII digits in both languages

  function startSession() {
    var deck = st.decks.ctg, lv = level();
    var sched = { id: "ctg." + lv, items: deck.cases.map(function (c) { return { id: c.id, a: c.figo, c: c }; }) };
    st.session = { list: C.buildSession(sched, st.store, today(), { size: 12, newCap: 12 }), i: 0, answers: {}, result: null };
    st.view = "clinic"; render();
  }
  function current() { var s = st.session; return s && s.list[s.i] ? s.list[s.i].c : null; }

  function renderVignette(c) {
    var v = c.vignette || {}, w = W(), bits = [];
    if (v.gestWeeks != null) bits.push(v.gestWeeks + " " + w.weeks);
    if (v.age != null) bits.push(w.age + " " + v.age);
    if (v.gravidity != null && v.parity != null) bits.push(w.gp + " " + v.gravidity + "/" + v.parity);
    if (v.stage2Min != null) bits.push(w.stage2 + " " + v.stage2Min + " " + w.min);
    if (v.induced) bits.push(w.induced);
    var chips = (v.risks || []).map(function (r) { return '<span class="tok-chip">' + esc(w.risks[r] || r) + "</span>"; }).join("");
    return '<section class="tok-vignette" aria-label="' + esc(w.vignette) + '"><p>' + esc(bits.join(" · ")) + "</p>" + (chips ? '<div class="tok-chips">' + chips + "</div>" : "") + "</section>";
  }

  function renderClinic() {
    var c = current();
    if (!c) return renderDone();
    var w = W(), ids = D.checklistFor(c, level()), a = st.session.answers;
    var q = ids.map(function (id) {
      return '<fieldset class="tok-q" data-q="' + id + '"><legend>' + esc(w[QLABEL[id]]) + "</legend>" +
        D.QUESTIONS[id].map(function (o) {
          var on = a[id] === o;
          return '<button type="button" class="tok-opt' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-act="ans" data-q="' + id + '" data-o="' + o + '">' + esc(w.opts[id][o]) + "</button>";
        }).join("") + "</fieldset>";
    }).join("");
    var all = ids.every(function (id) { return a[id]; });
    return '<div class="tok-clinic-view">' + renderVignette(c) +
      '<div class="tok-strip-head"><span>' + esc(w.grid) + '</span><span class="tok-quality">' + esc(w.quality) + ": " + (100 - c.features.quality.lossPct).toFixed(0) + "%</span></div>" +
      '<div class="tok-stage" id="tokStage"><div class="tok-loading" id="tokTraceSlot">...</div></div>' +
      '<div class="tok-cal-bar"><button type="button" data-act="cal" data-m="bpm" aria-pressed="true">' + esc(w.bpmMode) + '</button><button type="button" data-act="cal" data-m="time" aria-pressed="false">' + esc(w.timeMode) + '</button><output id="tokCalOut" aria-live="polite"></output></div>' +
      q + '<button type="button" class="tok-btn" data-act="reveal"' + (all ? "" : " disabled") + ">" + esc(w.submit) + "</button>" +
      '<div class="tok-draft">To be verified, draft</div></div>';
  }

  // Inline SVG so the calipers can map pointer positions into viewBox units. Our own generated file
  // (Task 1c): class names only, no <style>, no scripts.
  function mountTrace(c) {
    var slot = $("tokTraceSlot"); if (!slot) return;
    fetch(BASE + "media/" + c.svg).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (txt) {
      var stage = $("tokStage"); if (!stage) return;
      stage.innerHTML = txt;
      var svg = stage.querySelector("svg"); svg.id = "tokTrace"; svg.setAttribute("data-src", c.svg);
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "CTG, " + c.layout.durationSec / 60 + " min");
      st._stage = S.attach(stage, svg); st._stage.reset();
      if (G.ResizeObserver) new G.ResizeObserver(function () { st._stage.reset(); }).observe(stage);
      st._cal = G.TOKOS_CALIPERS.attach(svg, c.layout, function () { var o = $("tokCalOut"); if (o) o.textContent = st._cal ? st._cal.readout(st.prefs.lang) : ""; });
      var o = $("tokCalOut"); if (o) o.textContent = st._cal.readout(st.prefs.lang);
    }).catch(function () {
      var s2 = $("tokStage"); if (s2) s2.innerHTML = '<div class="tok-err">Could not load this trace. <button type="button" data-act="retrace">Try again</button></div>';
    });
  }

  function renderReveal() {
    var c = current(), w = W(), res = st.session.result, t = res.truth, o = c.outcome;
    var rows = res.ids.map(function (id) {
      var ok = res.perQ[id];
      return '<tr class="' + (ok ? "ok" : "no") + '"><th scope="row">' + esc(w[QLABEL[id]]) + "</th><td>" + esc(w.opts[id][st.session.answers[id]]) + "</td><td>" + esc(w.opts[id][t[id]]) + '</td><td aria-label="' + (ok ? "match" : "no match") + '">' + (ok ? "✓" : "✗") + "</td></tr>";
    }).join("");
    var why = D.rationaleKeys(c).map(function (k) { var r = st.rationale && st.rationale[k]; return r ? "<li>" + esc(r[st.prefs.lang] || r.en) + "</li>" : ""; }).join("");
    // The two .tok-block sections stay separate (Review Focus): trace features, then the recorded outcome.
    return '<div class="tok-reveal">' +
      '<table class="tok-concord"><thead><tr><th></th><th>' + esc(w.yours) + "</th><th>" + esc(w.key) + "</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>" +
      (c.review ? "" : '<p class="tok-rule">' + esc(w.rule) + "</p>") +
      '<div class="tok-block"><h3>' + esc(w.features) + "</h3><p>Baseline: " + num(c.features.baseline, "bpm") + "</p><p>Variability: " + esc(c.features.variability.band) + " (" + num(c.features.variability.medianRange, "bpm") + ")</p><p>Decelerations: " + c.features.decels.length + "</p><p>Contractions: " + num(c.features.contractions.per10) + " / 10 min</p></div>" +
      '<div class="tok-block"><h3>' + esc(w.outcome) + "</h3><p>pH: " + num(o.pH) + "</p><p>BDecf: " + num(o.BDecf, "mmol/L") + "</p><p>pCO2: " + num(o.pCO2, "kPa") + "</p><p>Apgar: " + num(o.apgar1) + " / " + num(o.apgar5) + "</p><p>Weight: " + num(o.weightG, "g") + "</p></div>" +
      '<section class="tok-why"><h3>' + esc(w.why) + "</h3><ul>" + why + "</ul></section>" +
      '<p class="tok-next">' + esc(w.nextReview) + " " + res.ivl + " " + esc(w.days) + "</p>" +
      '<button type="button" class="tok-btn" data-act="next">' + esc(w.next) + "</button>" +
      '<div class="tok-draft">To be verified, draft</div></div>';
  }
  function renderDone() {
    return '<div class="tok-reveal"><h2>' + esc(W().done) + '</h2><button type="button" class="tok-btn" data-act="hub">OK</button></div>';
  }

  function submit() {
    var c = current(), ids = D.checklistFor(c, level()), t = D.truthFor(c);
    var g = D.gradeChecklist(ids, st.session.answers, t);
    var card = C.review(st.store, "ctg." + level(), c.id, g.grade, today());
    Object.keys(t).forEach(function (q) { if (ids.indexOf(q) >= 0) C.recordAnswer(st.store, "ctg." + level() + "." + q, t[q], st.session.answers[q]); });
    save();
    st.session.result = { ids: ids, perQ: g.perQ, truth: t, ivl: card[3] - today() };
    st.view = "reveal"; render();
  }
```

`render()` calls `mountTrace(current())` after `root.innerHTML = renderClinic()`. `bind` adds:
```js
      else if (act === "ans") { st.session.answers[el.getAttribute("data-q")] = el.getAttribute("data-o"); render(); }
      else if (act === "reveal") { if (!el.disabled) submit(); }
      else if (act === "next") { st.session.i++; st.session.answers = {}; st.session.result = null; st.view = "clinic"; render(); }
      else if (act === "cal") { st._cal && st._cal.setMode(el.getAttribute("data-m")); [].forEach.call(root.querySelectorAll('[data-act=cal]'), function (b) { b.setAttribute("aria-pressed", String(b === el)); }); }
      else if (act === "retrace") { mountTrace(current()); }
      else if (act === "hub") { st.view = "hub"; render(); }
      else if (act === "lang") { st.prefs.lang = st.prefs.lang === "hi" ? "en" : "hi"; D.savePrefs(ls(), st.prefs); render(); }
      else if (act === "level") { st.prefs.level = st.prefs.level === "resident" ? "mbbs" : "resident"; D.savePrefs(ls(), st.prefs); render(); }
```
and the clinic entry becomes:
```js
      if (act === "clinic") { if (level() === "resident") gate("clinic.ctg", startSession); else startSession(); }
```
Re-rendering the clinic view after an answer must not refetch the trace: keep the mounted `<svg>` by rendering the checklist into its own container (`#tokChecklist`) and only replacing that container on `ans`. Expose `_cal` and `_stage` on `TOKOS` for the UI test (`G.TOKOS = { ..., get _cal() {...} }` is ES5-safe via `Object.defineProperty`).

- [ ] **Step 7: Themes in `tokos.css`** (append; the colour roles below are the design contract, final values come out of the UI skills' pass)

```css
/* Monitor (dark, default) and paper (light) themes. Read vault/modules/Appearance.md for how the host
   marks its light theme and add that selector next to the media query below; do not guess it. */
.tok-root { --tk-bg: #0b0f17; --tk-grid: #1e293b; --tk-grid-major: #334155; --tk-band: rgba(16,185,129,.06); --tk-normal: #10b981; --tk-amber: #f59e0b; --tk-fhr: #22c55e; --tk-uc: #f43f5e; --tk-axis: #94a3b8; --tk-cal: #38bdf8; }
@media (prefers-color-scheme: light) { .tok-root { --tk-bg: #fdfaf3; --tk-grid: #f3c9c9; --tk-grid-major: #e59a9a; --tk-band: rgba(16,185,129,.08); --tk-normal: #0f766e; --tk-amber: #b45309; --tk-fhr: #111827; --tk-uc: #1d4ed8; --tk-axis: #6b7280; --tk-cal: #7c3aed; } }
.tk-bg { fill: var(--tk-bg); } .tk-band { fill: var(--tk-band); }
.tk-grid-minor, .tk-grid-minor-t { stroke: var(--tk-grid); stroke-width: .6; } .tk-grid-minor-t { stroke-dasharray: 2 3; }
.tk-grid-major, .tk-grid-major-t { stroke: var(--tk-grid-major); stroke-width: 1; }
.tk-line-normal { stroke: var(--tk-normal); stroke-width: 1.4; stroke-dasharray: 5 4; } .tk-line-100 { stroke: var(--tk-amber); stroke-width: 1.4; stroke-dasharray: 5 4; }
.tk-axis { fill: var(--tk-axis); font: 11px ui-monospace, monospace; }
.tk-fhr { fill: none; stroke: var(--tk-fhr); stroke-width: 1.8; stroke-linejoin: round; } .tk-uc { fill: none; stroke: var(--tk-uc); stroke-width: 1.6; }
.tk-cal-line { stroke: var(--tk-cal); stroke-width: 2; } .tk-cal-hit { stroke: transparent; stroke-width: 48; cursor: grab; touch-action: none; }
.tok-opt[aria-pressed="true"] { outline: 2px solid var(--tk-cal); }
@media (prefers-reduced-motion: reduce) { .tok-root * { transition: none !important; animation: none !important; } }
```
Add `tok-root` to the module's root container.

- [ ] **Step 8: Extend the UI test** (append to `test/run-tokos-ui.mjs`; adapt two v1 steps)

Adapt v1 steps, keeping what each asserted:
- "trace is an SVG": now `return document.getElementById('tokTrace').getAttribute('data-src').endsWith('.svg')`, after `until` the inline SVG exists.
- "reveal screen renders": answer every question first (`document.querySelectorAll('[data-act=ans]')` first option of each `fieldset`), then click `[data-act=reveal]`. The two-`.tok-block` assertion is unchanged.
- "spent trial hits the paywall": set `prefs.level` to `resident` in `smd_tokos_prefs` before reopening (MBBS is free and no longer gated).

New steps:
```js
  // MBBS: 5 questions; submit disabled until all answered
  await ev(`localStorage.removeItem("smd_tokos_v1"); localStorage.setItem("smd_tokos_prefs", JSON.stringify({level:"mbbs",lang:"en",tab:"test"})); TOKOS.close(); TOKOS.open(); return 1;`);
  await until(`return !!document.querySelector('[data-act=clinic]');`);
  await ev(`document.querySelector('[data-act=clinic]').click(); return 1;`);
  ok(await until(`return document.querySelectorAll('.tok-q').length === 5;`), "MBBS checklist has 5 questions");
  ok(await ev(`return document.querySelector('[data-act=reveal]').disabled;`) === true, "submit disabled until every question is answered");

  // Calipers read the same before and after zoom (drag in screen space, measured in viewBox units)
  ok(await until(`return !!(TOKOS._cal && document.getElementById('tokTrace'));`), "calipers attached to the inline trace");
  const drag = async (key, bpm) => ev(`var svg=document.getElementById('tokTrace'), K=TOKOS_CALIPERS, L=TOKOS._st.session.list[TOKOS._st.session.i].c.layout;
    var hit=[].filter.call(svg.querySelectorAll('.tk-cal-hit'),function(h){return h.getAttribute('data-key')==='${key}';})[0];
    var m=svg.getScreenCTM(), from=svg.createSVGPoint(); from.x=L.padL+L.plotW/2; from.y=+hit.getAttribute('y1'); from=from.matrixTransform(m);
    var to=svg.createSVGPoint(); to.x=from.x; to.y=K.yForBpm(L,${bpm}); to=to.matrixTransform(m);
    function pe(t,p){ hit.dispatchEvent(new PointerEvent(t,{bubbles:true,pointerId:7,clientX:p.x,clientY:p.y})); }
    pe('pointerdown',from); pe('pointermove',{x:from.x,y:to.y}); pe('pointerup',{x:from.x,y:to.y}); return document.getElementById('tokCalOut').textContent;`);
  await drag("y1", 160); const r1 = await drag("y2", 110);
  await ev(`TOKOS._stage.zoomBy(3); return 1;`); await sleep(300);
  await drag("y1", 160); const r2 = await drag("y2", 110);
  ok(/Range: 5[0-1] bpm/.test(r1) && r1 === r2, "caliper reads ~50 bpm at zoom 1 and zoom 3: " + r1 + " | " + r2);

  // Grading writes an FSRS card under the level's deck key
  await ev(`[].forEach.call(document.querySelectorAll('.tok-q'),function(f){f.querySelector('[data-act=ans]').click();}); return 1;`);
  await ev(`document.querySelector('[data-act=reveal]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-concord');`), "concordance table shows after submit");
  ok(await ev(`var s=JSON.parse(localStorage.getItem('smd_tokos_v1')); return Object.keys(s.cards).some(function(k){return k.indexOf('ctg.mbbs:')===0;});`) === true, "FSRS card saved under ctg.mbbs");
  ok(await ev(`return document.querySelectorAll('.tok-why li').length >= 1;`) === true, "rationale shown");

  // Hindi: labels translate, clinical numbers stay ASCII
  await ev(`TOKOS._st.prefs.lang='hi'; TOKOS._render(); return 1;`);
  ok(await ev(`var t=document.querySelector('.tok-reveal').textContent; return /pH: \\d\\.\\d+/.test(t) && !/[\\u0966-\\u096F]/.test(t);`) === true, "Hindi reveal keeps pH as ASCII digits");

  // Offline: failed load shows an error with Try again, and recovers
  await ev(`window.__f=window.fetch; window.fetch=function(){return Promise.reject(new Error('offline'));}; TOKOS._st.cfg=null; TOKOS._st.loading=null; TOKOS.close(); TOKOS.open(); return 1;`);
  ok(await until(`return !!document.querySelector('.tok-err [data-act=retry]');`), "offline load shows Try again");
  await ev(`window.fetch=window.__f; document.querySelector('[data-act=retry]').click(); return 1;`);
  ok(await until(`return !!document.querySelector('[data-act=clinic]');`), "Try again recovers");
```
Expose `TOKOS._render = render` for the Hindi step.

- [ ] **Step 9: Run everything**

```bash
node --check tokos.js tokos-data.js tokos-calipers.js
node --test test/tokos-data.test.mjs test/tokos-content.test.mjs test/tokos-calipers.test.mjs
node test/run-tokos-ui.mjs
```
Expected: all PASS, ALL GREEN. Then screenshot (390x844 @2x) the hub, a vignette plus trace, the checklist half answered, calipers in both modes, the reveal, and the same four in Hindi and in the light theme, into `$CLAUDE_JOB_DIR/tmp/tokos-shots/`, look at each, and run the `web-design-guidelines` review and the `anti-ui-slop` finish gate.

- [ ] **Step 10: Commit**

```bash
git add tokos.js tokos.css tokos-data.js tokos/rationale.json test/tokos-data.test.mjs test/tokos-content.test.mjs test/run-tokos-ui.mjs
git commit -m "feat(tokos): FIGO checklist, concordance grading, rationale, calipers in the clinic, themes"
```

---

### Task 7: StewardMD wiring (flag, home tile, build)

**Files:**
- Modify: `index.html`
- Modify: `scripts/build-www.sh`
- Modify: `home.js`
- Test: extend `test/tokos-content.test.mjs` or a small `test/tokos-wiring.test.mjs`

**Interfaces:**
- Consumes: `window.TOKOS.open()` (Task 6), an existing flag-check helper in `home.js` (read the file to find the exact helper name used by CliniX/KardiQ X's tile before writing this task's code, e.g. `SMD_FLAGS.on("smd_clinix")` or similar; do not guess the name, grep `home.js` for `smd_clinix` first).

- [ ] **Step 1: Read the existing pattern before writing any code**

```bash
grep -n "smd_clinix\|smd_kardiox" home.js | head -20
grep -n "ophthalmos-learn\|ophthalmos.css" index.html
grep -n "ophthalmos" scripts/build-www.sh
```
Use whatever flag-check call, script-tag ordering, and copy-glob pattern these show, do not invent a different convention.

- [ ] **Step 2: Add script/style tags to `index.html`**

Add, following the exact tag style already used for Ophthalmós/CliniX (read the surrounding lines first):
```html
<link rel="stylesheet" href="tokos.css?v=tok1">
<script src="tokos-core.js?v=tok1"></script>
<script src="tokos-data.js?v=tok1"></script>
<script src="tokos-stage.js?v=tok1"></script>
<script src="tokos-calipers.js?v=tok1"></script>  <!-- v2 -->
<script src="tokos.js?v=tok1"></script>
```

- [ ] **Step 3: Add the flag-gated home tile in `home.js`**, mirroring the exact structure found in Step 1 (do not paste speculative code here, copy the CliniX/KardiQ X tile block, rename the id/label/flag/open-call, keep everything else identical: icon handling, disabled/hidden state when the flag is off).

- [ ] **Step 4: Add the flag definition** wherever `smd_clinix`/`smd_kardiox` are defined (likely a flags config file, `grep -rn "smd_kardiox" --include=*.js .` to find it), add `smd_tokos: false`.

- [ ] **Step 5: Update `scripts/build-www.sh`** to copy `tokos-*.js`, `tokos-*.css`, and the `tokos/` directory, following the exact same line pattern used for `ophthalmos-*`/`tokos`, read the file first, add analogous lines, do not restructure the script.

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
  assert.ok(tags.length >= 6, "expected tokos.css + 5 JS files (v2 adds tokos-calipers.js), found " + tags.length);
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
  - (v2) The FIGO rules and thresholds in `CFG`, which are guideline values and which are Tokós choices (`UC_PROMINENCE`, `UC_MIN_SEC`, `QUALITY_SUBOPTIMAL_PCT`, the 5th-95th percentile variability range), the reviewer workflow (`docs/tokos/review-queue.md` -> `case.review`), and the MBBS vs Resident checklist difference. Verify the FIGO 2015 and NICE NG229 citations against the source documents here, and correct the plan's wording if a section reference is wrong.
  - Roadmap note: Phase 2 candidates are a Bishop score calculator, a labour-room simulator, and fetal ultrasound plane recognition (HC18/FETAL_PLANES_DB, both CC BY 4.0, already licence-clear), not built in this phase.

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

**4. Review Focus coverage:** dropout/artifact handling (Task 1 Step 6 test), offline/failed-fetch state (Task 6's `renderHub` error branch, though a dedicated network-failure UI test isn't scripted in Task 6 Step 3, **gap**: add one before merging). Spent-trial-before-fetch (Task 6 Step 3's last test). Hindi numeric rendering (Task 5's Hindi label test covers the label but not a numeric-value render, **gap**: Task 6's reveal screen renders pH/bpm as plain numbers regardless of `st.prefs.lang` since the template never routes numbers through a translation function, which is correct by construction, but no test pins this). pH-vs-features independence (Task 6 Step 3's two-block assertion).

Both gaps just found are small and cheap to close, add to Task 6 Step 3 before executing:
```js
// after the reveal-screen assertions:
await ev(`TOKOS._st.prefs.lang='hi'; TOKOS._st.view='clinic'; render(); return 1;`);
// (render is not exported; use TOKOS.back() then re-open the clinic instead, or expose render for the test)
```
Flagging this as a known refinement rather than blocking the plan on it, the executor should add a Hindi-numeric-render assertion and a simulated-fetch-failure assertion to Task 6 Step 3 while implementing it, using the same `ev`/`until` pattern already in that step.

---

Plan complete and saved to `docs/superpowers/plans/2026-09-29-tokos-obgyn-ctg-clinic.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

**For this plan I recommend Subagent-driven**, because Task 1 involves real downloaded data and empirical format verification that benefits from a dedicated reviewer checking the actual generated `ctg.json`/SVGs against the raw PhysioNet data before Tasks 2-7 build on top of it, and because this is clinical content (even simplified/flagged) where a wrong assumption compounds across every later task. Does the plan capture what you want, and which approach should we use?

---

## Self-Review (v2)

**Coverage of the review decisions:** FIGO thresholds (Task 1b tests: over 5 min pathological, 3 to 5 min suspicious, reduced variability over 50 min); deceleration type advisory and graded only when reviewed (1b `decelSubtype`, 6c `checklistFor`); vignettes from real fields only (Global Constraints, 1d Step 1 coding check, 1d content test bans invented fields); record list chosen by computed features then confirmed (1d `pickCases`, review queue, Step 5 visual check); contraction threshold relative to resting tone (1b drift test); calipers in viewBox units with a colon readout (6b tests, 6c zoom drag test); nothing removed from v1 (every v1 task and test is still here; three v1 UI assertions are adapted, not dropped, and each adaptation is named in 6c Step 8); signal-quality badge, acidosis class, 100 bpm line, pyrexia/pre-eclampsia chips, "1 major square = 1 minute" caption (1b, 1c, 6c).

**Checked by running, 2026-09-29:** the Task 1, 1b and 1c code and tests, and the 6b caliper code and tests, were extracted from this document and run: 19 pass, 1 skipped (network). The decoder was then run on real CTU-UHB records 1001 to 1005: byte order confirmed against the header, baselines 120 to 150 bpm, a 30-minute strip is about 81 KB. That run found the max-min variability range reading 2 of 5 records as "increased"; Task 1b now uses the 5th-95th percentile range (all 5 normal, 11 to 24 bpm) with a spike test.

**Found while merging, fixed in v2:** v1 gated every clinic start behind the Resident trial, so MBBS learners (free) would have spent a trial. 6c gates only the Resident level and adapts the v1 paywall test to set the Resident level. Both earlier drafts also let tachysystole raise the FIGO category; FIGO classifies from FHR features, so 1b keeps tachysystole as a separate flag with its own test.

**Not verified yet (owner or reviewer):** FIGO 2015 and NICE NG229 section references (Task 8); the CTU-UHB field codings (1d Step 1); every suggested label (obstetrician, via the review queue); the Hindi strings in 6b, 6c and `rationale.json` (Hindi reviewer); the final colours (UI skills pass in 6c).

