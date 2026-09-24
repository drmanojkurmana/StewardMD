/* openmed-ner.js on the REAL runtime: the app page, the vendored onnxruntime-web (WASM, the same
 * loader ThoreX uses), and the lookup-table fixture ONNX from test/fixtures/openmed-ner (same I/O
 * contract as OpenMed's -onnx-android export). Also proves the shipped defaults: both flags off,
 * nothing downloaded, and no request to huggingface.co even with a flag on (licence unverified).
 * USAGE: node test/run-openmed-ner-ui.mjs      (needs Playwright; serves the repo on :8991 itself)
 */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8991"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  const page = await browser.newPage();
  const hf = []; page.on("request", (r) => { if (/huggingface\.co/.test(r.url())) hf.push(r.url()); });
  await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(4000);

  const d = await page.evaluate(async () => {
    const N = window.SMD_OPENMED_NER;
    localStorage.setItem("smd_openmed_pharma", "1");            // flag ON, pack still unverified
    const gated = await N.extract("pharma", "Start warfarin 5 mg");
    localStorage.removeItem("smd_openmed_pharma");
    return { loaded: !!N, pharma: N.status("pharma"), disease: N.status("disease"), gated };
  });
  ok(d.loaded, "openmed-ner.js loaded in the app page");
  ok(d.pharma.reason === "flag-off" && d.disease.reason === "flag-off", "both flags OFF by default");
  ok(d.gated.length === 0, "flag on but licence unverified: extract returns []");

  const r = await page.evaluate(async () => {
    const N = window.SMD_OPENMED_NER;
    const ort = await window.SMD_THOREX_ORT.loadOrtWeb("/vendor/onnxruntime-web");
    const pack = (kind) => { const b = N.PACKS[kind], files = {};
      for (const k in b.files) files[k] = { name: b.files[k].name, sha256: "0".repeat(64) };
      return Object.assign({}, b, { files, licence: { verified: true } }); };
    const loadBytes = (kind) => (p, f) => fetch("/test/fixtures/openmed-ner/" + kind + "/" + f.name).then((x) => x.arrayBuffer());
    const t0 = performance.now();
    const drugs = await N.extract("pharma", "Give paracetamol 500 mg and warfarin 5 mg od; start linezolid 600 mg bd with insulin glargine.",
      { pack: pack("pharma"), loadBytes: loadBytes("pharma"), ort });
    const dx = await N.diseases("Community acquired pneumonia with type 2 diabetes mellitus and chronic kidney disease stage 3",
      { pack: pack("disease"), loadBytes: loadBytes("disease"), ort });
    const rows = await window.SMD_SCRIBEICD.suggest("Community acquired pneumonia with type 2 diabetes mellitus and chronic kidney disease stage 3", {
      search: (q) => Promise.resolve([{ code: "X" + q.length, title: q }]),
      extract: (t) => N.diseases(t, { pack: pack("disease"), loadBytes: loadBytes("disease"), ort }) });
    const G = window.SMD_MAIK_GROUND, P = [{ text: "Fever in adults: give paracetamol 500 mg every 6 hours as needed." }];
    const swap = "For fever in adults give aspirin 500 mg every 6 hours as needed.";
    const names = await N.drugNames(swap + "\n" + P[0].text, { pack: pack("pharma"), loadBytes: loadBytes("pharma"), ort });
    const g = G.groundAnswer(swap, P, "fever?", { drugs: names });
    return { ms: Math.round(performance.now() - t0), ortVersion: ort.env && ort.env.versions && ort.env.versions.common,
      drugs: drugs.map((e) => e.text), dx, icd: rows.map((x) => x.span), names, grounded: g.stats };
  });
  console.log(JSON.stringify(r));
  ok(JSON.stringify(r.drugs) === JSON.stringify(["paracetamol", "warfarin", "linezolid", "insulin glargine"]), "pharma on real onnxruntime-web: " + r.drugs.join(", "));
  ok(JSON.stringify(r.dx) === JSON.stringify(["Community acquired pneumonia", "type 2 diabetes mellitus", "chronic kidney disease stage 3"]), "disease on real onnxruntime-web");
  ok(r.icd.length === 3, "ICD suggestions: one per condition");
  ok(JSON.stringify(r.names) === JSON.stringify(["aspirin", "paracetamol"]) && r.grounded.unsupported === 1 && r.grounded.supported === 0,
     "grounding with tagger names removes the swapped drug");
  ok(hf.length === 0, "no request to huggingface.co (" + hf.length + ")");
} finally {
  await browser.close(); if (serve) serve.kill();
}
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
