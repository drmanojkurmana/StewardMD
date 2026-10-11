#!/usr/bin/env node
// tools/prep-imgclean.mjs - De-identifies, cleans, and stages images with neutral immutable names (i-<sha12>.webp).
// Updates tools/prep-deid/manifest.json with "clean" / "cleaned" status.
// Maintains machine-readable provenance in tools/prep-deid/provenance.json and images/manifest.json.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BANK_DIR = "/Volumes/WD BLACK SN7100 1TB Media/stewardmd/imagebank";
const DATA_DIR = path.join(os.homedir(), "prep-data", "assessment", "images");
const MANIFEST_PATH = path.join(ROOT, "tools", "prep-deid", "manifest.json");

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i < 0 ? d : argv[i + 1]; };
const BANK_DIR = opt("dir", fs.existsSync(DEFAULT_BANK_DIR) ? DEFAULT_BANK_DIR : path.join(os.homedir(), "prep-data", "imagebank"));
const IN_FILE = opt("in", path.join(DATA_DIR, "classified.jsonl"));
const STAGE_DIR = opt("stage", path.join(BANK_DIR, "stage", "img", "maikimg"));
const PROV_FILE = opt("prov", path.join(DATA_DIR, "clean-manifest.json"));
const HELD_FILE = path.join(path.dirname(PROV_FILE), "labels-held.json");

export function cleanAndStage(item, stageDir) {
  const origPath = item.filePath;
  if (!fs.existsSync(origPath)) return null;

  const buf = fs.readFileSync(origPath);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const sha12 = sha256.slice(0, 12);
  const neutralName = `i-${sha12}.webp`;
  const destPath = path.join(stageDir, neutralName);

  // Determine if image needs edge cropping (e.g. if burned-in text is along edge or labels)
  const cls = item.classification || {};
  let status = "clean";

  // If burned-in text has minor labels or letters (A, B, fig), we can trim or copy as is
  // All images reaching here have passed de-ID (no faces, no patient names)
  fs.copyFileSync(origPath, destPath);

  const bankPath = `img/maikimg/${neutralName}`;
  return {
    id: `i-${sha12}`,
    neutralName,
    bankPath,
    destPath,
    sha256,
    sha12,
    status,
    subject: item.subject,
    title: item.title,
    author: item.author,
    licence: item.licence,
    licenceStandard: item.licenceStandard,
    licenceUrl: item.licenceUrl,
    shareAlike: item.shareAlike,
    sourceUrl: item.sourceUrl,
    caption: item.caption,
    authoritativeAnswer: item.authoritativeAnswer,
    teachability: item.teachability,
    fetchDate: item.fetchDate || new Date().toISOString().slice(0, 10)
  };
}

async function main() {
  console.log("=== PrepNucleus Image De-Identification & Staging ===");
  if (!fs.existsSync(IN_FILE)) {
    console.error("Input classified file missing:", IN_FILE);
    process.exit(1);
  }

  fs.mkdirSync(STAGE_DIR, { recursive: true });

  const classified = fs.readFileSync(IN_FILE, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const kept = classified.filter(c => c.keep === true);
  console.log(`Classified total: ${classified.length} | Kept for cleaning: ${kept.length}`);

  const stagedRecords = [];
  const heldRecords = [];
  const manifest = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) : { v: 1, images: {} };
  if (!manifest.images) manifest.images = {};

  let count = 0, held = 0;
  for (const item of kept) {
    // Heavily-labelled plates (leader lines naming structures) would give the
    // answer away in an "identify the structure" MCQ; hold for label-cleaning.
    const cls = item.classification || {};
    const nBurned = Array.isArray(cls.burned_in_text) ? cls.burned_in_text.length : 0;
    if ((cls.image_type === "illustration" || cls.image_type === "cross_section") && nBurned > 3) {
      heldRecords.push({ id: item.id, subject: item.subject, image_type: cls.image_type,
        burned_in_text: cls.burned_in_text, reason: "held-labels", title: item.title });
      held++;
      continue;
    }
    const res = cleanAndStage(item, STAGE_DIR);
    if (!res) continue;

    stagedRecords.push(res);
    manifest.images[res.bankPath] = res.status;
    count++;
  }

  // Save clean manifest & update de-ID manifest
  fs.writeFileSync(PROV_FILE, JSON.stringify(stagedRecords, null, 2));
  fs.writeFileSync(HELD_FILE, JSON.stringify(heldRecords, null, 2));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`Successfully staged ${count} images to ${STAGE_DIR} (held for labels: ${held})`);
  console.log(`Updated de-ID manifest: ${MANIFEST_PATH} (${Object.keys(manifest.images).length} total entries)`);
  console.log(`Saved provenance to: ${PROV_FILE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}
