#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DESKTOP = path.join(os.homedir(), "Desktop");
const BASE = "/Users/diwakarkumar/prep-data/assessment";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const L = ["A", "B", "C", "D"];

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

// 1. Render Review Queue PDF
const reviewFile = path.join(BASE, "staged/gen/w9/review-queue.jsonl");
const reviewItems = fs.existsSync(reviewFile)
  ? fs.readFileSync(reviewFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse).slice(0, 50)
  : [];

let reviewHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>PrepNucleus Wave 9 - Review Queue (USMLE Step 1 Pilot)</title>
<style>
body { font: 10pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 16mm 14mm; color: #111; }
h1 { font-size: 16pt; margin: 0 0 4px; color: #0F3460; }
.desc { font-size: 9.5pt; color: #555; margin-bottom: 16px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
.c { border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; margin: 0 0 14px; page-break-inside: avoid; background: #fff; }
.h { font-size: 9pt; color: #555; margin-bottom: 6px; }
.id { font-family: ui-monospace, Menlo, monospace; font-weight: 600; color: #16213E; }
.q { font-weight: 500; font-size: 10.5pt; margin: 6px 0 8px; color: #111; }
ol { margin: 4px 0 8px 20px; padding: 0; }
li { margin-bottom: 3px; }
li.key { background: #eef7ee; font-weight: 600; border-radius: 3px; padding: 1px 4px; }
.w { font-size: 9.5pt; color: #8A3B00; background: #FFF8F0; padding: 6px 8px; border-radius: 4px; margin: 6px 0; border-left: 3px solid #E67E22; }
.y { margin-top: 8px; font-size: 9.5pt; border-top: 1px dashed #ccc; padding-top: 6px; line-height: 1.8; color: #333; }
.exp { font-size: 9pt; color: #444; margin-top: 6px; background: #f8f9fa; padding: 6px 8px; border-radius: 4px; }
</style></head><body>
<h1>PrepNucleus Wave 9 - Clinician Review Queue (USMLE Step 1 Pilot)</h1>
<div class="desc">${reviewItems.length} items held from automated publication during Wave 9 checks (held for clinician review; &lt;=50 items). These items remain out of the bank pending clinician review.</div>
`;

reviewItems.forEach((x, k) => {
  const whyText = (x.quality && x.quality.note) || (x.qg && x.qg.note) || (x.quality && x.quality.reason && x.quality.reason.join(", ")) || "Verification flagged";
  reviewHtml += `<div class="c">
<div class="h"><b>Item ${k + 1} of ${reviewItems.length}</b> &middot; <span class="id">${esc(x.id)}</span> &middot; Module: <b>${esc(x.t)}</b> &middot; Tier: <b>${x.tier || (x.quality && x.quality.prov && x.quality.prov.tier) || "Unknown"}</b></div>
<div class="q">${esc(x.q)}</div>
<ol type="A">${(x.o || []).map((t, i) => `<li${i === x.a ? ' class="key"' : ""}>${esc(t)}${i === x.a ? " &nbsp;<b>(current key)</b>" : ""}</li>`).join("")}</ol>
<div class="w"><b>Flag reason:</b> ${esc(whyText)}</div>
<div class="exp"><b>Draft reasoning:</b> ${esc(x.exp || "")}</div>
<div class="y"><b>Clinician Decision:</b> &nbsp; Keep ${L[x.a]} &#9744; &nbsp;&nbsp; Change key to &nbsp;A &#9744; &nbsp;B &#9744; &nbsp;C &#9744; &nbsp;D &#9744; &nbsp;&nbsp; Rewrite / Hold &#9744;<br>Notes: _________________________________________________________________________________</div>
</div>`;
});

reviewHtml += `</body></html>`;
const reviewPdfPath = path.join(DESKTOP, "PrepNucleus-w9-review-queue.pdf");
renderPdf(reviewHtml, reviewPdfPath);
console.log("Wrote review queue PDF to:", reviewPdfPath);

// 2. Render 10-Item Sample PDF
const passedFile = path.join(BASE, "staged/gen/w9/candidates-passed.jsonl");
const passedItems = fs.existsSync(passedFile)
  ? fs.readFileSync(passedFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  : [];

// Pick 10 representative items across USMLE Step 1 basic science subjects
const subjectsPick = [
  "pharmacology", "pathology", "anatomy", "physiology", "biochemistry", "microbiology"
];
const samples = [];
for (const s of subjectsPick) {
  const item = passedItems.find(i => (i.sid || i.subject) === s);
  if (item && !samples.some(x => x.id === item.id)) samples.push(item);
}
if (samples.length < 10) {
  for (const it of passedItems) {
    if (!samples.some(x => x.id === it.id)) samples.push(it);
    if (samples.length === 10) break;
  }
}

let sampleHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>PrepNucleus Wave 9 - Passed 10-Item Sample (USMLE Step 1 Pilot)</title>
<style>
body { font: 9.5pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 14mm 12mm; color: #111; }
h1 { font-size: 16pt; margin: 0 0 4px; color: #0F3460; }
.desc { font-size: 9pt; color: #555; margin-bottom: 14px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
.c { border: 1px solid #bbb; border-radius: 6px; padding: 10px 12px; margin: 0 0 14px; page-break-inside: avoid; background: #fff; }
.h { font-size: 8.5pt; color: #555; margin-bottom: 6px; }
.id { font-family: ui-monospace, Menlo, monospace; font-weight: 600; color: #16213E; }
.q { font-weight: 500; font-size: 10pt; margin: 6px 0 8px; color: #111; }
ol { margin: 4px 0 8px 18px; padding: 0; }
li { margin-bottom: 3px; }
li.key { background: #eef7ee; font-weight: 600; border-radius: 3px; padding: 1px 4px; color: #1b5e20; }
.box { background: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; margin: 4px 0; font-size: 8.5pt; }
.box b { color: #0F3460; }
.pearl { background: #fffde7; border-left: 3px solid #fbc02d; padding: 5px 8px; margin: 4px 0; font-size: 8.5pt; }
.opt-reasons { margin-top: 4px; font-size: 8.5pt; color: #333; }
</style></head><body>
<h1>PrepNucleus Wave 9 - 10-Item Representative Sample (USMLE Step 1 Pilot)</h1>
<div class="desc">10 verified and released items across USMLE Step 1 basic science disciplines testing mechanistic understanding of pathophysiological processes, pharmacotherapy mechanisms, microbiological identification, anatomical relations, and clinical biochemical pathways.</div>
`;

samples.forEach((x, k) => {
  const r = x.x || {};
  sampleHtml += `<div class="c">
<div class="h"><b>Sample Item ${k + 1} of ${samples.length}</b> &middot; <span class="id">${esc(x.id)}</span> &middot; Subject: <b>${esc(x.sid || x.subject)}</b> &middot; Module: <b>${esc(x.t)}</b> &middot; Tier: <b>${x.tier || "3"}</b> &middot; Exam: <b>${esc(x.exam || "usmle-step-1")}</b></div>
<div class="q">${esc(x.q)}</div>
<ol type="A">${(x.o || []).map((t, i) => `<li${i === x.a ? ' class="key"' : ""}>${esc(t)}${i === x.a ? " &nbsp;<b>&check; (Correct Key)</b>" : ""}</li>`).join("")}</ol>
<div class="box"><b>Key Reasoning:</b> ${esc(r.key || x.exp)}</div>
${r.clues ? `<div class="box"><b>Clues:</b> ${esc(Array.isArray(r.clues) ? r.clues.join("; ") : r.clues)} &middot; <b>Mechanism:</b> ${esc(r.mech || "")}</div>` : ""}
${r.pearl ? `<div class="pearl"><b>Clinical Pearl:</b> ${esc(r.pearl)}</div>` : ""}
${r.others ? `<div class="opt-reasons"><b>Distractor Explanations:</b><br>${Object.entries(r.others).map(([letter, reason]) => `&bull; <b>Option ${letter}:</b> ${esc(reason)}`).join("<br>")}</div>` : ""}
</div>`;
});

sampleHtml += `</body></html>`;
const samplePdfPath = path.join(DESKTOP, "PrepNucleus-w9-sample.pdf");
renderPdf(sampleHtml, samplePdfPath);
console.log("Wrote sample PDF to:", samplePdfPath);
