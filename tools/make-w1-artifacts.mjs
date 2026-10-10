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
const reviewItems = fs.readFileSync(path.join(BASE, "staged/gen/w1/review-queue.jsonl"), "utf8")
  .trim().split("\n").filter(Boolean).map(JSON.parse);

let reviewHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>PrepNucleus Wave 1 - Review Queue</title>
<style>
body { font: 10.5pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 16mm 14mm; color: #111; }
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
<h1>PrepNucleus Wave 1 - Clinician Review Queue</h1>
<div class="desc">3 items held from automated publication during Wave 1 checks (factual doubt, source grounding scope, competing best answer). These items remain out of the bank pending clinician review.</div>
`;

reviewItems.forEach((x, k) => {
  const whyText = (x.quality && x.quality.note) || (x.qg && x.qg.note) || (x.quality && x.quality.reason && x.quality.reason.join(", ")) || "Verification flagged";
  reviewHtml += `<div class="c">
<div class="h"><b>Item ${k + 1} of ${reviewItems.length}</b> &middot; <span class="id">${esc(x.id)}</span> &middot; Module: <b>${esc(x.t)}</b> &middot; Source: ${esc(x.src && x.src.maik ? "MaiK Grounding" : "AI")}</div>
<div class="q">${esc(x.q)}</div>
<ol type="A">${x.o.map((t, i) => `<li${i === x.a ? ' class="key"' : ""}>${esc(t)}${i === x.a ? " &nbsp;<b>(current key)</b>" : ""}</li>`).join("")}</ol>
<div class="w"><b>Flag reason:</b> ${esc(whyText)}</div>
<div class="exp"><b>Draft reasoning:</b> ${esc(x.exp)}</div>
<div class="y"><b>Clinician Decision:</b> &nbsp; Keep ${L[x.a]} &#9744; &nbsp;&nbsp; Change key to &nbsp;A &#9744; &nbsp;B &#9744; &nbsp;C &#9744; &nbsp;D &#9744; &nbsp;&nbsp; Rewrite / Hold &#9744;<br>Notes: _________________________________________________________________________________</div>
</div>`;
});

reviewHtml += `</body></html>`;
const reviewPdfPath = path.join(DESKTOP, "PrepNucleus-w1-review-queue.pdf");
renderPdf(reviewHtml, reviewPdfPath);
console.log("Wrote review queue PDF to:", reviewPdfPath);

// 2. Render 10-Item Sample PDF
const passedItems = fs.readFileSync(path.join(BASE, "staged/gen/w1/candidates-passed.jsonl"), "utf8")
  .trim().split("\n").filter(Boolean).map(JSON.parse);

// Pick 10 representative items: 5 medicine, 3 pathology, 2 pharmacology
const med = passedItems.filter(i => (i.sid || i.subject) === "medicine").slice(0, 5);
const pathItems = passedItems.filter(i => (i.sid || i.subject) === "pathology").slice(0, 3);
const pharm = passedItems.filter(i => (i.sid || i.subject) === "pharmacology").slice(0, 2);
const samples = [...med, ...pathItems, ...pharm];

let sampleHtml = `<!doctype html><html><head><meta charset="utf-8">
<title>PrepNucleus Wave 1 - Passed 10-Item Sample</title>
<style>
body { font: 10pt/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 14mm 12mm; color: #111; }
h1 { font-size: 16pt; margin: 0 0 4px; color: #0F3460; }
.desc { font-size: 9pt; color: #555; margin-bottom: 14px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
.c { border: 1px solid #bbb; border-radius: 6px; padding: 10px 12px; margin: 0 0 14px; page-break-inside: avoid; background: #fff; }
.h { font-size: 8.5pt; color: #555; margin-bottom: 4px; }
.id { font-family: ui-monospace, Menlo, monospace; font-weight: 600; color: #16213E; }
.q { font-weight: 600; font-size: 10.5pt; margin: 6px 0; color: #111; }
ol { margin: 4px 0 8px 18px; padding: 0; }
li { margin-bottom: 2px; }
li.key { background: #eef7ee; font-weight: 600; border-radius: 3px; padding: 1px 4px; }
.sec { margin-top: 6px; font-size: 9pt; }
.sec-title { font-weight: 600; color: #0F3460; margin-bottom: 2px; }
.pearl { background: #FFF8E7; padding: 5px 8px; border-radius: 4px; border-left: 3px solid #EFC07B; margin: 4px 0; }
.box { background: #F8F9FA; padding: 6px 8px; border-radius: 4px; margin: 4px 0; }
.tag { display: inline-block; background: #EAECEF; font-size: 8pt; padding: 1px 5px; border-radius: 3px; margin-right: 4px; color: #444; }
</style></head><body>
<h1>PrepNucleus Wave 1 - Published Item Sample (10 MCQs)</h1>
<div class="desc">Sample of 10 items released in Wave 1 (maik1 overlay) showing transferable clinical reasoning patterns, NBEMS rubric adherence, and verified answer keys.</div>
`;

samples.forEach((x, k) => {
  const xr = x.x || {};
  sampleHtml += `<div class="c">
<div class="h"><b>Item ${k + 1} of 10</b> &middot; <span class="id">${esc(x.id)}</span> &middot; Subject: <b>${esc(x.sid || x.subject)}</b> &middot; Module: <b>${esc(x.t)}</b> &middot; Cognitive: ${esc(x.cog || "recall")}</div>
<div class="q">${esc(x.q)}</div>
<ol type="A">${x.o.map((t, i) => `<li${i === x.a ? ' class="key"' : ""}>${esc(t)}${i === x.a ? " &nbsp;<b>[KEY]</b>" : ""}</li>`).join("")}</ol>
${xr.pearl ? `<div class="pearl"><b>Clinical Pearl:</b> ${esc(xr.pearl)}</div>` : ""}
<div class="box">
  <div class="sec"><b>Why Key:</b> ${esc(xr.key || x.exp)}</div>
  ${xr.clues ? `<div class="sec"><b>Clinical Clues:</b> ${esc(xr.clues)}</div>` : ""}
  ${xr.ddx ? `<div class="sec"><b>Differential Diagnosis:</b> ${esc(xr.ddx)}</div>` : ""}
  ${xr.mech ? `<div class="sec"><b>Pathophysiologic Mechanism:</b> ${esc(xr.mech)}</div>` : ""}
  ${xr.lo ? `<div class="sec"><b>Learning Objective:</b> ${esc(xr.lo)}</div>` : ""}
</div>
<div style="margin-top: 4px;">
  ${(x.tg || []).map(t => `<span class="tag">#${esc(t)}</span>`).join(" ")}
</div>
</div>`;
});

sampleHtml += `</body></html>`;
const samplePdfPath = path.join(DESKTOP, "PrepNucleus-w1-sample.pdf");
renderPdf(sampleHtml, samplePdfPath);
console.log("Wrote sample PDF to:", samplePdfPath);
