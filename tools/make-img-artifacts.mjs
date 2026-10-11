#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DESKTOP = path.join(os.homedir(), "Desktop");
const IMG_DIR = "/Volumes/WD BLACK SN7100 1TB Media/stewardmd/imagebank/stage/img/maikimg";
const PASSED_FILE = "/Users/diwakarkumar/prep-data/assessment/images/candidates-passed.jsonl";
const REVIEW_FILE = "/Users/diwakarkumar/prep-data/assessment/images/review-queue.jsonl";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const L = ["A", "B", "C", "D"];

function getImageDataUri(imgName) {
  if (!imgName) return null;
  const p = path.join(IMG_DIR, imgName);
  if (fs.existsSync(p)) {
    const b64 = fs.readFileSync(p).toString("base64");
    return `data:image/webp;base64,${b64}`;
  }
  return null;
}

function renderPdf(html, pdfPath) {
  const tmpHtml = path.join(os.tmpdir(), "temp-" + Date.now() + ".html");
  fs.writeFileSync(tmpHtml, html);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pdfchrome-"));
  const r = spawnSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--user-data-dir=${prof}`,
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    "file://" + tmpHtml
  ], { timeout: 60000 });
  fs.rmSync(prof, { recursive: true, force: true });
  fs.rmSync(tmpHtml, { force: true });
  if (!fs.existsSync(pdfPath)) {
    throw new Error("Chrome PDF rendering failed: " + String(r.stderr));
  }
}

function renderJpg(html, imgPath, width = 1200, height = 3600) {
  const tmpHtml = path.join(os.tmpdir(), "temp-jpg-" + Date.now() + ".html");
  fs.writeFileSync(tmpHtml, html);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "jpgchrome-"));
  const r = spawnSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--user-data-dir=${prof}`,
    `--window-size=${width},${height}`,
    `--screenshot=${imgPath}`,
    "file://" + tmpHtml
  ], { timeout: 60000 });
  fs.rmSync(prof, { recursive: true, force: true });
  fs.rmSync(tmpHtml, { force: true });
  if (!fs.existsSync(imgPath)) {
    throw new Error("Chrome JPG rendering failed: " + String(r.stderr));
  }
}

// 1. Generate Review Queue PDF
const reviewItems = fs.readFileSync(REVIEW_FILE, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);

let reviewHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>PrepNucleus Image Programme - Clinician Review Queue</title>
<style>
body { font: 10pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 14mm 12mm; color: #111; }
h1 { font-size: 15pt; margin: 0 0 4px; color: #0F3460; }
.desc { font-size: 9pt; color: #555; margin-bottom: 14px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
.c { border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; margin: 0 0 14px; page-break-inside: avoid; background: #fff; }
.h { font-size: 8.5pt; color: #555; margin-bottom: 6px; }
.id { font-family: ui-monospace, Menlo, monospace; font-weight: 600; color: #16213E; }
.row { display: flex; gap: 14px; align-items: flex-start; }
.img-box { flex: 0 0 180px; text-align: center; }
.img-box img { max-width: 180px; max-height: 180px; border-radius: 4px; border: 1px solid #ddd; object-fit: contain; }
.content-box { flex: 1; }
.q { font-weight: 500; font-size: 10pt; margin: 4px 0 6px; color: #111; }
ol { margin: 4px 0 6px 18px; padding: 0; }
li { margin-bottom: 2px; font-size: 9.5pt; }
li.key { background: #eef7ee; font-weight: 600; border-radius: 3px; padding: 1px 4px; }
.flag { font-size: 9pt; color: #8A3B00; background: #FFF8F0; padding: 5px 8px; border-radius: 4px; margin: 5px 0; border-left: 3px solid #E67E22; }
.credit { font-size: 8pt; color: #666; margin-top: 4px; }
.decision { margin-top: 8px; font-size: 8.5pt; border-top: 1px dashed #ccc; padding-top: 5px; color: #333; line-height: 1.6; }
</style></head><body>
<h1>PrepNucleus Image Programme - Clinician Review Queue</h1>
<div class="desc">${reviewItems.length} items held from automated publication during dual-model blind verification. These items remain out of the bank pending clinician adjudication.</div>
`;

reviewItems.forEach((x, k) => {
  const imgName = Array.isArray(x.img) ? x.img[0] : x.img;
  const imgUri = getImageDataUri(imgName);
  const flagReason = x.reviewReason || "Blind verification disagreement";

  reviewHtml += `<div class="c">
<div class="h"><b>Item ${k + 1} of ${reviewItems.length}</b> &middot; <span class="id">${esc(x.id)}</span> &middot; Subject: <b>${esc(x.sid)}</b> &middot; Module: <b>${esc(x.t)}</b></div>
<div class="row">
  ${imgUri ? `<div class="img-box"><img src="${imgUri}" alt="review image"><div class="credit">${esc(x.licence)}</div></div>` : ""}
  <div class="content-box">
    <div class="q">${esc(x.q)}</div>
    <ol type="A">${x.o.map((t, i) => `<li${i === x.a ? ' class="key"' : ""}>${esc(t)}${i === x.a ? " &nbsp;<b>(draft key)</b>" : ""}</li>`).join("")}</ol>
    <div class="flag"><b>Flag:</b> ${esc(flagReason)}</div>
    <div class="credit"><b>Attribution:</b> ${esc(x.title || "")} &middot; Author: ${esc(x.credit || "Unknown")} &middot; ${esc(x.licence || "")}</div>
    <div class="decision"><b>Clinician Decision:</b> &nbsp; Keep ${L[x.a]} &#9744; &nbsp;&nbsp; Change key to &nbsp;A &#9744; &nbsp;B &#9744; &nbsp;C &#9744; &nbsp;D &#9744; &nbsp;&nbsp; Reject &#9744;<br>Notes: __________________________________________________________________________</div>
  </div>
</div>
</div>`;
});

reviewHtml += `</body></html>`;
const reviewPdfPath = path.join(DESKTOP, "PrepNucleus-img-review-queue.pdf");
renderPdf(reviewHtml, reviewPdfPath);
console.log("Wrote review queue PDF to:", reviewPdfPath);

// 2. Load Passed Items
const passedItems = fs.readFileSync(PASSED_FILE, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const pathItems = passedItems.filter(i => (i.sid || i.subject) === "pathology");
const anatItems = passedItems.filter(i => (i.sid || i.subject) === "anatomy");
const surgItems = passedItems.filter(i => (i.sid || i.subject) === "surgery");

// 3. Render 12-Item Sample Sheet (4 Path, 4 Anat, 4 Surg) for JPG and PDF
const sample12 = [
  ...pathItems.slice(0, 4),
  ...anatItems.slice(0, 4),
  ...surgItems.slice(0, 4)
];

let sheetHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>PrepNucleus Wave 1 - 12-Item Image MCQ Sample Sheet</title>
<style>
body { font: 9.5pt/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 12mm 10mm; color: #111; background: #fafafa; }
h1 { font-size: 16pt; margin: 0 0 4px; color: #0F3460; text-align: center; }
.desc { font-size: 9pt; color: #555; margin-bottom: 14px; text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { border: 1px solid #ccc; border-radius: 6px; padding: 10px; background: #fff; page-break-inside: avoid; display: flex; flex-direction: column; }
.card-hdr { font-size: 8pt; color: #555; margin-bottom: 4px; display: flex; justify-content: space-between; }
.id { font-family: ui-monospace, Menlo, monospace; font-weight: 600; color: #16213E; }
.img-wrap { text-align: center; margin: 4px 0 6px; }
.img-wrap img { max-width: 100%; max-height: 180px; border-radius: 4px; border: 1px solid #eee; object-fit: contain; }
.q { font-weight: 600; font-size: 9pt; margin: 4px 0 6px; color: #111; }
ol { margin: 2px 0 6px 16px; padding: 0; }
li { margin-bottom: 2px; font-size: 8.5pt; }
li.key { background: #eef7ee; font-weight: 600; border-radius: 3px; padding: 1px 3px; color: #1b5e20; }
.credit-line { font-size: 7.5pt; color: #777; margin-top: auto; padding-top: 4px; border-top: 1px dotted #eee; }
.badge { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 7.5pt; font-weight: 600; text-transform: uppercase; }
.badge-pathology { background: #e3f2fd; color: #0d47a1; }
.badge-anatomy { background: #e8f5e9; color: #1b5e20; }
.badge-surgery { background: #fff3e0; color: #e65100; }
</style></head><body>
<h1>PrepNucleus Wave 1 - Image MCQs Sample Sheet (12 Items)</h1>
<div class="desc">Representative 12-item sample across Pathology, Anatomy, and Surgery released in Wave 1 (maikimg1) with verified licences and NBEMS clinical vignettes.</div>
<div class="grid">
`;

sample12.forEach((x, k) => {
  const imgName = Array.isArray(x.img) ? x.img[0] : x.img;
  const imgUri = getImageDataUri(imgName);
  const sid = x.sid || x.subject;

  sheetHtml += `<div class="card">
  <div class="card-hdr">
    <span><b>#${k + 1}</b> &middot; <span class="id">${esc(x.id)}</span></span>
    <span class="badge badge-${esc(sid)}">${esc(sid)}</span>
  </div>
  ${imgUri ? `<div class="img-wrap"><img src="${imgUri}" alt="mcq image"></div>` : ""}
  <div class="q">${esc(x.q)}</div>
  <ol type="A">${x.o.map((t, i) => `<li${i === x.a ? ' class="key"' : ""}>${esc(t)}${i === x.a ? " [KEY]" : ""}</li>`).join("")}</ol>
  <div class="credit-line">
    <b>Credit:</b> ${esc(x.credit || "Wikimedia Commons")} &middot; <b>Licence:</b> ${esc(x.licence)}
  </div>
</div>`;
});

sheetHtml += `</div></body></html>`;

const sampleSheetPdf = path.join(DESKTOP, "PrepNucleus-img-sample-sheet.pdf");
const sampleSheetJpg = path.join(DESKTOP, "PrepNucleus-img-sample-sheet.jpg");
renderPdf(sheetHtml, sampleSheetPdf);
renderJpg(sheetHtml, sampleSheetJpg, 1200, 2600);
console.log("Wrote 12-item sample sheet PDF to:", sampleSheetPdf);
console.log("Wrote 12-item sample sheet JPG to:", sampleSheetJpg);

// 4. Render 10-Item Detailed Sample PDF (4 Path, 3 Anat, 3 Surg) with Full Pearls & Reasons
const sample10 = [
  ...pathItems.slice(0, 4),
  ...anatItems.slice(0, 3),
  ...surgItems.slice(0, 3)
];

let sample10Html = `<!doctype html><html><head><meta charset="utf-8">
<title>PrepNucleus Wave 1 - Published Image MCQs (10 Items)</title>
<style>
body { font: 9.5pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 14mm 12mm; color: #111; }
h1 { font-size: 15pt; margin: 0 0 4px; color: #0F3460; }
.desc { font-size: 9pt; color: #555; margin-bottom: 14px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
.c { border: 1px solid #bbb; border-radius: 6px; padding: 10px 12px; margin: 0 0 14px; page-break-inside: avoid; background: #fff; }
.h { font-size: 8.5pt; color: #555; margin-bottom: 6px; display: flex; justify-content: space-between; }
.id { font-family: ui-monospace, Menlo, monospace; font-weight: 600; color: #16213E; }
.row { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 8px; }
.img-box { flex: 0 0 200px; text-align: center; }
.img-box img { max-width: 200px; max-height: 200px; border-radius: 4px; border: 1px solid #ddd; object-fit: contain; }
.content-box { flex: 1; }
.q { font-weight: 600; font-size: 10pt; margin: 2px 0 6px; color: #111; }
ol { margin: 2px 0 6px 18px; padding: 0; }
li { margin-bottom: 2px; font-size: 9pt; }
li.key { background: #eef7ee; font-weight: 600; border-radius: 3px; padding: 1px 4px; color: #1b5e20; }
.pearl { background: #FFF8E7; padding: 5px 8px; border-radius: 4px; border-left: 3px solid #EFC07B; margin: 4px 0; font-size: 8.5pt; }
.box { background: #F8F9FA; padding: 6px 8px; border-radius: 4px; margin: 4px 0; font-size: 8.5pt; }
.sec { margin-top: 3px; }
.sec-title { font-weight: 600; color: #0F3460; }
.credit { font-size: 8pt; color: #666; margin-top: 4px; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 8pt; font-weight: 600; text-transform: uppercase; }
.badge-pathology { background: #e3f2fd; color: #0d47a1; }
.badge-anatomy { background: #e8f5e9; color: #1b5e20; }
.badge-surgery { background: #fff3e0; color: #e65100; }
</style></head><body>
<h1>PrepNucleus Wave 1 - Published Image MCQs (10-Item Sample)</h1>
<div class="desc">Sample of 10 image-based items released in Wave 1 (maikimg1) showing verified image attribution, single-best-answer NBEMS vignettes, and structured explanations.</div>
`;

sample10.forEach((x, k) => {
  const imgName = Array.isArray(x.img) ? x.img[0] : x.img;
  const imgUri = getImageDataUri(imgName);
  const sid = x.sid || x.subject;
  const xr = x.x || {};

  sample10Html += `<div class="c">
<div class="h">
  <span><b>Item ${k + 1} of 10</b> &middot; <span class="id">${esc(x.id)}</span> &middot; Module: <b>${esc(x.t)}</b></span>
  <span class="badge badge-${esc(sid)}">${esc(sid)}</span>
</div>
<div class="row">
  ${imgUri ? `<div class="img-box"><img src="${imgUri}" alt="mcq image"><div class="credit">Licence: ${esc(x.licence)}</div></div>` : ""}
  <div class="content-box">
    <div class="q">${esc(x.q)}</div>
    <ol type="A">${x.o.map((t, i) => `<li${i === x.a ? ' class="key"' : ""}>${esc(t)}${i === x.a ? " &nbsp;<b>[KEY]</b>" : ""}</li>`).join("")}</ol>
    <div class="credit"><b>Attribution:</b> ${esc(x.title || "")} &middot; Author: ${esc(x.credit || "Wikimedia Commons")} &middot; <a href="${esc(x.sourceUrl || "#")}">${esc(x.licence)}</a></div>
  </div>
</div>
${xr.pearl ? `<div class="pearl"><b>Clinical Pearl:</b> ${esc(xr.pearl)}</div>` : ""}
<div class="box">
  <div class="sec"><b>Why Key:</b> ${esc(xr.key || x.exp)}</div>
  ${xr.clues ? `<div class="sec"><b>Clinical Clues:</b> ${esc(xr.clues)}</div>` : ""}
  ${xr.mech ? `<div class="sec"><b>Pathophysiologic Mechanism:</b> ${esc(xr.mech)}</div>` : ""}
  ${xr.lo ? `<div class="sec"><b>Learning Objective:</b> ${esc(xr.lo)}</div>` : ""}
</div>
</div>`;
});

sample10Html += `</body></html>`;

const sample10Pdf = path.join(DESKTOP, "PrepNucleus-img-sample-10.pdf");
renderPdf(sample10Html, sample10Pdf);
console.log("Wrote 10-item sample PDF to:", sample10Pdf);
