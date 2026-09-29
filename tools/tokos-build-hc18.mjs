// Builds the Tokós head-biometry clinic deck from HC18 (Zenodo 1322001, CC BY 4.0), training set only.
// The sonographer's annotation is an ellipse drawn on the outer skull edge; this script recovers that ellipse
// from the annotation PNG (centre line of the drawn ring, by image moments), checks it reproduces the
// provided HC in mm, and stores the ground-truth ellipse, pixel size and HC per case.
//   TOKOS_TMP=<dir> node tools/tokos-build-hc18.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHttpZip, request, pool, evenPick, toWebp, imageSize, grayPixels, mergeCredits, MAX_WEBP_BYTES } from "./tokos-clinic-lib.mjs";

const ZIP_URL = "https://zenodo.org/api/records/1322001/files/training_set.zip/content";
const CSV_URL = "https://zenodo.org/api/records/1322001/files/training_set_pixel_size_and_HC.csv/content";
const TMP = join(process.env.TOKOS_TMP || join(tmpdir(), "tokos-build"), "hc18");
const OUT_DIR = "tokos/media/hc-biometry";
const OUT_DECK = "tokos/decks/hc-biometry.json";
const OUT_CREDITS = "tokos/media/credits.json";
const MAX_IMAGES = 100;

// Hadlock 1984, Radiology 152:497-501: GA (weeks) = 8.96 + 0.540 HC + 0.0003 HC^3, HC in cm.
// Verified 2026-09-29 against the Hologic SuperSonic MACH "Obstetrical References" (PM.LAB.175-A, Oct 2020),
// section "GA by HC - Hadlock1984": all 64 tabulated rows (HC 6.8 to 36.0 cm) are reproduced to within 0.0006 week,
// and its +/-2 SD column gives the tolerance bands below. The Radiology paper itself is paywalled and was not opened.
export const HADLOCK_HC = { c0: 8.96, c1: 0.54, c3: 0.0003 };
export const GA_HC_RANGE_MM = [68, 360];
export const GA_TOLERANCE = [
  { hcMm: [68, 144], sd2Weeks: 1.19 },
  { hcMm: [151, 219], sd2Weeks: 1.48 },
  { hcMm: [224, 280], sd2Weeks: 2.06 },
  { hcMm: [284, 325], sd2Weeks: 2.98 },
  { hcMm: [328, 360], sd2Weeks: 3.2 },
];
export const gaFromHcMm = (hcMm) => { const c = hcMm / 10; return HADLOCK_HC.c0 + HADLOCK_HC.c1 * c + HADLOCK_HC.c3 * c * c * c; };
// A value between two tabulated ranges takes the wider (next) tolerance; outside the range there is no estimate.
export function gaTolerance(hcMm) {
  if (hcMm < GA_HC_RANGE_MM[0] || hcMm > GA_HC_RANGE_MM[1]) return null;
  return GA_TOLERANCE.find((b) => hcMm <= b.hcMm[1]).sd2Weeks;
}

// Ramanujan's second approximation for the perimeter of an ellipse with semi-axes a, b.
export const ellipsePerimeter = (a, b) => { const h = ((a - b) / (a + b)) ** 2; return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))); };

// Second-moment ellipse of a pixel set: centre, semi-axes (a >= b) and major-axis angle (degrees, from +x toward +y).
// A filled ellipse has coordinate variances a^2/4 and b^2/4 along its axes; 1/12 is the variance of one pixel.
function moments(w, h, inSet) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inSet(x, y)) { n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
  if (!n) return null;
  const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx - 1 / 12, cyy = syy / n - my * my - 1 / 12, cxy = sxy / n - mx * my;
  const tr = cxx + cyy, d = Math.sqrt(Math.max(0, (tr * tr) / 4 - (cxx * cyy - cxy * cxy)));
  return { n, cx: mx, cy: my, a: 2 * Math.sqrt(tr / 2 + d), b: 2 * Math.sqrt(Math.max(0, tr / 2 - d)), angleDeg: (0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180) / Math.PI };
}

// Ellipse drawn by the sonographer, from the annotation image (a thin white ring on black). The ring's outer
// edge (filled region) and inner edge (hole) both have moment ellipses; the drawn ellipse is their mean.
export function ellipseFromAnnotation({ w, h, data }) {
  const ring = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ring[i] = data[i] > 127 ? 1 : 0;
  const outside = new Uint8Array(w * h), stack = [];
  const push = (x, y) => { const i = y * w + x; if (!ring[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  const F = moments(w, h, (x, y) => !outside[y * w + x]);
  const H = moments(w, h, (x, y) => !outside[y * w + x] && !ring[y * w + x]);
  if (!F || !H || H.n < 100) return null; // ring not closed
  return { cx: (F.cx + H.cx) / 2, cy: (F.cy + H.cy) / 2, a: (F.a + H.a) / 2, b: (F.b + H.b) / 2, angleDeg: F.angleDeg, closureGapPx: Math.hypot(F.cx - H.cx, F.cy - H.cy) };
}

// The CSV columns are: filename, pixel size (mm per pixel), head circumference (mm).
export function parseHcCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map((l) => {
    const [filename, px, hc] = l.split(",");
    const m = /^(\d+)_(\d?)HC\.png$/.exec(filename);
    return { filename, base: filename.replace(/\.png$/, ""), patient: m ? +m[1] : NaN, repeat: m ? m[2] : "", pixelMm: +px, hcMm: +hc };
  });
}

// One image per patient (the plain _HC file where there is one), HC inside the formula's range, an even spread over HC.
export function pickCases(rows) {
  const byPatient = new Map();
  rows.filter((r) => r.hcMm >= GA_HC_RANGE_MM[0] && r.hcMm <= GA_HC_RANGE_MM[1]).forEach((r) => {
    const cur = byPatient.get(r.patient);
    if (!cur || (r.repeat === "" && cur.repeat !== "")) byPatient.set(r.patient, r);
  });
  const sorted = [...byPatient.values()].sort((a, b) => a.hcMm - b.hcMm || a.patient - b.patient);
  const primary = evenPick(sorted, MAX_IMAGES);
  const used = new Set(primary.map((r) => r.base));
  return primary.concat(evenPick(sorted, Math.min(sorted.length, MAX_IMAGES * 2)).filter((r) => !used.has(r.base)));
}

// Quality gate: the ring is closed and concentric, and the recovered ellipse reproduces the provided HC to 0.5 percent.
export const MAX_HC_ERR = 0.005, MAX_CLOSURE_PX = 1.5;

async function main() {
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const csvFile = join(TMP, "training_set_pixel_size_and_HC.csv");
  if (!existsSync(csvFile)) writeFileSync(csvFile, (await request(CSV_URL)).buf);
  const rows = parseHcCsv(readFileSync(csvFile, "utf8"));
  const queue = pickCases(rows);
  const zip = await openHttpZip(ZIP_URL);
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const fetchTo = async (name) => {
    const f = join(TMP, name);
    if (!existsSync(f)) writeFileSync(f, await zip.read(byName.get("training_set/" + name)));
    return f;
  };
  const ok = [];
  for (let i = 0; i < queue.length && ok.length < MAX_IMAGES; ) {
    const batch = queue.slice(i, i + Math.min(6, MAX_IMAGES - ok.length));
    i += batch.length;
    const files = await pool(batch, async (r) => [await fetchTo(r.filename), await fetchTo(r.base + "_Annotation.png")], 6);
    batch.forEach((r, j) => {
      const ell = ellipseFromAnnotation(grayPixels(files[j][1]));
      if (!ell || ell.closureGapPx > MAX_CLOSURE_PX) return;
      const hcFit = ellipsePerimeter(ell.a, ell.b) * r.pixelMm;
      if (Math.abs(hcFit - r.hcMm) / r.hcMm > MAX_HC_ERR) return;
      ok.push({ row: r, img: files[j][0], ell });
    });
    console.log(ok.length + " accepted after " + i + " tried");
  }
  if (ok.length < MAX_IMAGES) console.warn("only " + ok.length + " passed the gate");

  // Pseudo-random but fixed order, so the deck is not sorted by HC (a learner could read the trend off the order).
  const order = ok.map((o, k) => [(k * 37) % ok.length, o]).sort((x, y) => x[0] - y[0] || 0).map((x) => x[1]);
  const cases = [], files = {};
  order.forEach((o, k) => {
    const id = "hc-" + String(k + 1).padStart(3, "0");
    const rel = "hc-biometry/" + id + ".webp";
    const orig = imageSize(o.img);
    const w = toWebp(o.img, "tokos/media/" + rel);
    if (w.bytes > MAX_WEBP_BYTES) throw new Error(id + " is over 40 KB");
    const s = w.w / orig.w; // bundled pixels per original pixel (aspect ratio is kept)
    const r1 = (v) => Math.round(v * 10) / 10;
    // Canvas coordinates: pixel i covers [i, i+1), so a pixel-index centre moves by 0.5 before scaling.
    const ellipse = { cx: r1((o.ell.cx + 0.5) * s), cy: r1((o.ell.cy + 0.5) * s), a: r1(o.ell.a * s), b: r1(o.ell.b * s), angleDeg: r1(o.ell.angleDeg) };
    const mmPerPx = Math.round((o.row.pixelMm / s) * 1e6) / 1e6;
    files[rel] = o.row.filename;
    cases.push({
      id, img: rel, w: w.w, h: w.h, mmPerPx, hcMm: o.row.hcMm, ellipse,
      hcFromEllipseMm: Math.round(ellipsePerimeter(ellipse.a, ellipse.b) * mmPerPx * 100) / 100,
      gaWeeks: Math.round(gaFromHcMm(o.row.hcMm) * 10) / 10, gaTol2SDWeeks: gaTolerance(o.row.hcMm),
      review: "ai_drafted",
    });
  });

  const paper = "van den Heuvel TLA, de Bruijn D, de Korte CL, van Ginneken B. Automated measurement of fetal head circumference using 2D ultrasound images. PLoS ONE. 2018;13(8):e0200412. doi:10.1371/journal.pone.0200412";
  const deck = {
    v: 1, id: "hc-biometry", review: "ai_drafted",
    title: { en: "Fetal head circumference", hi: "भ्रूण के सिर की परिधि" },
    source: {
      dataset: "HC18", url: "https://zenodo.org/records/1322001", doi: "10.5281/zenodo.1322001", licence: "CC BY 4.0", credit: "hc18", paper,
      labelledBy: "Ground truth is the ellipse the examining sonographer drew on the outer edge of the skull during the scan (paper, Materials and methods).",
    },
    coordinates: "Ellipse and image coordinates are in pixels of the bundled WebP (canvas convention: pixel i covers [i, i+1), origin top-left, y down). a >= b are semi-axes. angleDeg is the major-axis angle from +x toward +y (clockwise on screen), in (-90, 90]. hcMm is the dataset's HC; hcFromEllipseMm recomputes it from the stored ellipse with Ramanujan's second approximation, mmPerPx being the dataset pixel size divided by the resize scale.",
    perimeter: "pi (a + b) (1 + 3h / (10 + sqrt(4 - 3h))), h = ((a - b) / (a + b))^2 (Ramanujan, second approximation); it reproduced the dataset HC to 0.01 mm on the three images checked by hand and within 0.5 percent on every image in this deck.",
    gaFromHc: {
      formula: "GA (weeks) = 8.96 + 0.540 x HC + 0.0003 x HC^3, HC in cm",
      coefficients: HADLOCK_HC, validHcMm: GA_HC_RANGE_MM,
      tolerance2SD: GA_TOLERANCE, toleranceGap: "An HC between two tabulated ranges takes the wider (next) tolerance.",
      source: {
        primary: "Hadlock FP, Deter RL, Harrist RB, Park SK. Estimating fetal age: computer-assisted analysis of multiple fetal growth parameters. Radiology. 1984;152(2):497-501.",
        verifiedAgainst: "Hologic SuperSonic MACH Obstetrical References, PM.LAB.175-A (Oct 2020), section GA by HC - Hadlock1984: 64 of 64 tabulated rows reproduced to within 0.0006 week; the +/-2 SD column gives the tolerance bands. Secondary source; the paper itself was paywalled.",
        url: "https://www.hologic.com/file/37096/download?token=a-BSqXqL",
      },
    },
    cases,
  };
  writeFileSync(OUT_DECK, JSON.stringify(deck, null, 1) + "\n");
  mergeCredits(OUT_CREDITS, {
    hc18: {
      licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", route: "adapted",
      source: "https://zenodo.org/records/1322001", doi: "10.5281/zenodo.1322001", author: "van den Heuvel TLA, de Bruijn D, de Korte CL, van Ginneken B (Radboud University Medical Center)",
      citation: paper,
      changes: "Selected " + cases.length + " of the 999 training images (one per patient, HC 68 mm or more, even spread over HC). Resized to 640 px wide and converted from PNG to WebP. The ground-truth ellipse was recovered from the provided annotation image (centre line of the drawn ring, by image moments) and stored as numbers; the annotation image itself is not shipped. HC in mm and pixel size are the dataset's own CSV values.",
      files,
    },
  });
  console.log("wrote " + cases.length + " cases to " + OUT_DECK);
}

if (import.meta.url === "file://" + process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
