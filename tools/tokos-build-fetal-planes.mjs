// Builds the Tokós fetal-planes clinic deck from FETAL_PLANES_DB (Zenodo 3904280, CC BY 4.0).
// Reads members of the 2 GB zip with HTTP range requests (only the ~150 chosen images travel), keeps raw
// files in TOKOS_TMP (default: the OS temp dir), writes bundled WebP (at most 40 KB each), the deck and credits.
//   node tools/tokos-build-fetal-planes.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHttpZip, pool, evenPick, toWebp, imageSize, mergeCredits, MAX_WEBP_BYTES } from "./tokos-clinic-lib.mjs";

const ZIP_URL = "https://zenodo.org/api/records/3904280/files/FETAL_PLANES_ZENODO.zip/content";
const TMP = join(process.env.TOKOS_TMP || join(tmpdir(), "tokos-build"), "fetal");
const OUT_DIR = "tokos/media/fetal-planes";
const OUT_DECK = "tokos/decks/fetal-planes.json";
const OUT_CREDITS = "tokos/media/credits.json";
const MAX_IMAGES = 150;
// Scanner preset text sits in the top-right corner and can name the answer ("Cardiac", "qCERVIX").
// Checked on the contact sheets of the chosen images: the block is inside x > 0.84, y < 0.21 of the frame.
const MASK = { x: 0.84, y: 0, w: 0.16, h: 0.21 };

// Fine labels (Resident) and the MBBS group each rolls into. `plane` and `brain` are the dataset's own
// Plane and Brain_plane column values, which are the expert (B.V-A.) ground truth.
export const CLASSES = [
  { id: "fetal-abdomen", plane: "Fetal abdomen", brain: "Not A Brain", group: "abdomen", n: 18, label: { en: "Fetal abdomen", hi: "भ्रूण का पेट (उदर)" } },
  { id: "brain-transthalamic", plane: "Fetal brain", brain: "Trans-thalamic", group: "brain", n: 18, label: { en: "Brain, trans-thalamic", hi: "मस्तिष्क, ट्रांस-थैलेमिक" } },
  { id: "brain-transcerebellar", plane: "Fetal brain", brain: "Trans-cerebellum", group: "brain", n: 18, label: { en: "Brain, trans-cerebellar", hi: "मस्तिष्क, ट्रांस-सेरिबेलर" } },
  { id: "brain-transventricular", plane: "Fetal brain", brain: "Trans-ventricular", group: "brain", n: 18, label: { en: "Brain, trans-ventricular", hi: "मस्तिष्क, ट्रांस-वेंट्रिकुलर" } },
  { id: "brain-other", plane: "Fetal brain", brain: "Other", group: "brain", n: 6, label: { en: "Brain, other plane", hi: "मस्तिष्क, अन्य प्लेन" } },
  { id: "fetal-femur", plane: "Fetal femur", brain: "Not A Brain", group: "femur", n: 18, label: { en: "Fetal femur", hi: "भ्रूण की जाँघ की हड्डी (फीमर)" } },
  { id: "fetal-thorax", plane: "Fetal thorax", brain: "Not A Brain", group: "thorax", n: 18, label: { en: "Fetal thorax", hi: "भ्रूण का वक्ष (छाती)" } },
  { id: "maternal-cervix", plane: "Maternal cervix", brain: "Not A Brain", group: "cervix", n: 18, label: { en: "Maternal cervix", hi: "माँ की ग्रीवा (सर्विक्स)" } },
  { id: "other", plane: "Other", brain: "Not A Brain", group: "other", n: 18, label: { en: "Other plane", hi: "अन्य प्लेन" } },
];
export const GROUPS = [
  { id: "abdomen", label: { en: "Fetal abdomen", hi: "भ्रूण का पेट (उदर)" } },
  { id: "brain", label: { en: "Fetal brain", hi: "भ्रूण का मस्तिष्क" } },
  { id: "femur", label: { en: "Fetal femur", hi: "भ्रूण की जाँघ की हड्डी (फीमर)" } },
  { id: "thorax", label: { en: "Fetal thorax", hi: "भ्रूण का वक्ष (छाती)" } },
  { id: "cervix", label: { en: "Maternal cervix", hi: "माँ की ग्रीवा (सर्विक्स)" } },
  { id: "other", label: { en: "Other plane", hi: "अन्य प्लेन" } },
];

// The CSV is semicolon separated and its last header has a trailing space ("Train ").
export function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const keys = lines[0].split(";").map((k) => k.trim());
  return lines.slice(1).map((l) => {
    const v = l.split(";").map((x) => x.trim());
    return Object.fromEntries(keys.map((k, i) => [k, v[i]]));
  });
}

// Deterministic pick: one image per patient (the first by name), an even spread over patient numbers.
// Returns the primary picks then reserves (used only when a primary fails the quality gate).
export function pickClass(rows, cls) {
  const seen = new Set(), uniq = [];
  // US_Machine "Other" (342 images) are exports from unlisted scanners with on-screen text outside the masked corner
  // (seen: Spanish menu text and a heart-rate trace), so they are left out.
  rows.filter((r) => r.Plane === cls.plane && r.Brain_plane === cls.brain && r.US_Machine !== "Other")
    .sort((a, b) => a.Patient_num - b.Patient_num || (a.Image_name < b.Image_name ? -1 : 1))
    .forEach((r) => { if (!seen.has(r.Patient_num)) { seen.add(r.Patient_num); uniq.push(r); } });
  const primary = evenPick(uniq, cls.n);
  const used = new Set(primary.map((r) => r.Image_name));
  const reserve = evenPick(uniq, Math.min(uniq.length, cls.n * 2)).filter((r) => !used.has(r.Image_name));
  return { primary, reserve };
}

export const MIN_SIDE_PX = 400, MIN_WEBP_BYTES = 4000;

async function main() {
  mkdirSync(TMP, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const zip = await openHttpZip(ZIP_URL);
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const csvFile = join(TMP, "data.csv");
  if (!existsSync(csvFile)) writeFileSync(csvFile, await zip.read(byName.get("FETAL_PLANES_DB_data.csv")));
  const rows = parseCsv(readFileSync(csvFile, "utf8"));
  console.log(rows.length + " rows in the dataset CSV");

  // Fetch raw PNGs into TMP (cached), convert to a scratch WebP and gate on size and content.
  const fetchRaw = async (r) => {
    const f = join(TMP, r.Image_name + ".png");
    if (!existsSync(f)) writeFileSync(f, await zip.read(byName.get("Images/" + r.Image_name + ".png")));
    return f;
  };
  const chosen = [];
  for (const cls of CLASSES) {
    const { primary, reserve } = pickClass(rows, cls);
    const queue = primary.concat(reserve), ok = [];
    const scratch = join(TMP, "scratch-" + cls.id + ".webp");
    for (let i = 0; i < queue.length && ok.length < cls.n; ) {
      // Fetch a batch in parallel (Zenodo allows about 133 requests a minute), then gate in order.
      const batch = queue.slice(i, i + Math.min(4, cls.n - ok.length));
      i += batch.length;
      const files = await pool(batch, fetchRaw, 4);
      batch.forEach((r, j) => {
        const dims = imageSize(files[j]);
        if (Math.min(dims.w, dims.h) < MIN_SIDE_PX) return;
        const w = toWebp(files[j], scratch, { mask: MASK });
        if (w.bytes < MIN_WEBP_BYTES) return; // near-blank frame
        ok.push({ row: r, file: files[j], cls });
      });
    }
    if (ok.length < cls.n) console.warn("only " + ok.length + " of " + cls.n + " passed the gate for " + cls.id);
    chosen.push(ok);
    console.log(cls.id + ": " + ok.length);
  }

  // Interleave the classes so ids and file order do not correlate with the answer.
  const ordered = [];
  for (let k = 0; ordered.length < chosen.reduce((s, c) => s + c.length, 0); k++) chosen.forEach((c) => { if (c[k]) ordered.push(c[k]); });
  const cases = [], files = {};
  ordered.slice(0, MAX_IMAGES).forEach((o, i) => {
    const id = "fp-" + String(i + 1).padStart(3, "0");
    const rel = "fetal-planes/" + id + ".webp";
    const w = toWebp(o.file, "tokos/media/" + rel, { mask: MASK });
    if (w.bytes > MAX_WEBP_BYTES) throw new Error(id + " is over 40 KB");
    files[rel] = o.row.Image_name + ".png";
    cases.push({ id, img: rel, w: w.w, h: w.h, label: o.cls.id, group: o.cls.group, machine: o.row.US_Machine, review: "ai_drafted" });
  });

  const deck = {
    v: 1, id: "fetal-planes", review: "ai_drafted",
    title: { en: "Fetal ultrasound planes", hi: "भ्रूण अल्ट्रासाउंड प्लेन" },
    source: {
      dataset: "FETAL_PLANES_DB", url: "https://zenodo.org/records/3904280", doi: "10.5281/zenodo.3904280", licence: "CC BY 4.0", credit: "fetal-planes-db",
      paper: "Burgos-Artizzu XP, Coronado-Gutierrez D, Valenzuela-Alcaraz B, et al. Evaluation of deep convolutional neural networks for automatic classification of common maternal fetal ultrasound planes. Sci Rep. 2020;10:10200. doi:10.1038/s41598-020-67076-5",
      labelledBy: "Ground truth is the dataset's own expert label (one maternal-fetal medicine clinician, per the dataset README).",
    },
    classes: CLASSES.map((c) => ({ id: c.id, group: c.group, label: c.label, count: cases.filter((k) => k.label === c.id).length })),
    groups: GROUPS,
    levels: {
      mbbs: { options: GROUPS.map((g) => g.id), answer: "group" },
      resident: { options: CLASSES.map((c) => c.id), answer: "label" },
    },
    cases,
  };
  writeFileSync(OUT_DECK, JSON.stringify(deck, null, 1) + "\n");
  mergeCredits(OUT_CREDITS, {
    "fetal-planes-db": {
      licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/", route: "adapted",
      source: "https://zenodo.org/records/3904280", doi: "10.5281/zenodo.3904280",
      author: "Burgos-Artizzu XP, Coronado-Gutierrez D, Valenzuela-Alcaraz B, Bonet-Carne E, Eixarch E, Crispi F, Gratacos E (BCNatal, Barcelona Center for Maternal-Fetal and Neonatal Medicine)",
      citation: "Burgos-Artizzu XP, Coronado-Gutierrez D, Valenzuela-Alcaraz B, et al. Evaluation of deep convolutional neural networks for automatic classification of common maternal fetal ultrasound planes. Sci Rep. 2020;10:10200. doi:10.1038/s41598-020-67076-5",
      changes: "Selected " + cases.length + " of 12,400 images (one per patient, even spread over the dataset, balanced across classes; the 342 images from unlisted scanners, US_Machine Other, were not used). Resized to at most 640 px on the long side and converted from PNG to WebP. The top-right corner (right 16 percent, top 21 percent of the frame) is blacked out to hide the scanner's on-screen preset text, which can name the plane. Labels are the dataset's own; the Brain_plane value Trans-cerebellum is written trans-cerebellar.",
      files,
    },
  });
  console.log("wrote " + cases.length + " cases to " + OUT_DECK);
}

if (import.meta.url === "file://" + process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
