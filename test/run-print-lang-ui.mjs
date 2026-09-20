/* test/run-print-lang-ui.mjs - real headless Chrome, print preview of the bilingual prints (owner decision
 * 2026-09-15). The Patient copy (ward.js) and the discharge summary (discharge.js) are opened through their
 * own controllers, the second language is picked with the real <select> (which loads the real
 * wardsynq/site/i18n/<code>.js), and the page is then rendered with print media and printed to PDF.
 *
 *   node test/run-print-lang-ui.mjs        (CHROME=<path> to override; SHOTS=<dir> for screenshots)
 *
 * The two GET routes are answered with fixtures shaped like the server's (GET /api/queue/ward/patient-copy and
 * GET /api/queue/ward/discharge-summary, including `print`); the routes themselves are pinned in
 * test/wardsynq-print-lang-routes.test.mjs. Prints PASS/FAIL per step; exits 1 on any FAIL.
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/print-lang-shots";
await mkdir(SHOTS, { recursive: true });

const PRINT = { languagesEnabled: true, timeZone: "Asia/Kolkata", utcOffsetMinutes: 330 };
const COPY = {
  ok: true, patientId: "p1", statements: ["This is a summary your care team has given you. It is not your complete medical record."], clinicianWarnings: [],
  portalPreview: { checked: true, scopes: { "patient-copy": [], full: [] } }, print: PRINT,
  document: {
    patient: { name: "Deepa Kumari", mrn: "SMD-PRT-0042", dob: "1970-01-01" },
    diagnoses: [{ display: "Rheumatoid arthritis [M06.9]" }], allergies: [{ substance: "Penicillin", reaction: "rash" }],
    medicines: [
      { drug: "Methotrexate", dose: { value: 7.5, unit: "mg" }, route: "oral", frequency: "once weekly", patientInstructions: ["after-food", "do-not-drink-alcohol"] },
      { drug: "Digoxin", dose: { value: 0.125, unit: "mg" }, route: "oral", frequency: "OD", patientInstructions: ["in-the-morning"] },
      { drug: "Paracetamol", dose: { value: 500, unit: "mg" }, route: "oral", frequency: "PRN" },
    ],
    results: [{ name: "Serum creatinine", conclusion: "1.4 mg/dL", reportedAt: "2026-09-14T20:00:00.000Z" }], withheldResults: [], appointments: [],
  },
};
const SUMMARY = {
  ok: true, patientId: "p1", canAuthor: false, pending: [], print: PRINT,
  patient: { name: "Deepa Kumari", mrn: "SMD-PRT-0042", sex: "female" },
  encounter: { status: "finished", ward: "Medical A", bed: "12", admittedAt: "2026-09-07T20:00:00.000Z", dischargedAt: "2026-09-10T06:00:00.000Z", disposition: "home" },
  assembled: { admission: "Ward: Medical A, bed 12.", diagnoses: "Rheumatoid arthritis [M06.9] - confirmed", allergies: "Penicillin - rash", vitals: "Heart rate 88 /min",
    investigations: "Serum creatinine (completed)", medications: "Methotrexate - 7.5 mg, oral, once weekly (active)\nDigoxin - 0.125 mg, oral, OD (active)", assessment: "Not recorded.", plan: "Do not restart NSAIDs." },
  stored: { sections: {}, editedSections: [], signed: true, signedBy: "Dr Rao", noteId: "n1", version: 1, recordedAt: "2026-09-10T07:15:00.000Z" },
};
SUMMARY.stored.sections = { ...SUMMARY.assembled };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/queue")) {
    const body = url.pathname.endsWith("/ward/patient-copy") ? COPY : url.pathname.endsWith("/ward/discharge-summary") ? SUMMARY : { ok: true, patients: [] };
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); return;
  }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

const results = [];
const b = await launch({ port: Number(process.env.CDP_PORT || 9491), width: 1100, height: 1400 });
const { ev, until, nav, call } = b;
async function step(name, fn) {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e)]); }
  const last = results[results.length - 1]; console.log(last[0], name, last[2]);
}
const media = (m) => call("Emulation.setEmulatedMedia", { media: m });
const pdf = async (name) => {
  const r = await call("Page.printToPDF", { printBackground: false, paperWidth: 8.27, paperHeight: 11.69 });
  const data = r.result && r.result.data;
  if (!data) return "no PDF: " + JSON.stringify(r.error || r);
  await writeFile(SHOTS + "/" + name + ".pdf", Buffer.from(data, "base64"));
  return Buffer.from(data, "base64").subarray(0, 5).toString() === "%PDF-" ? true : "not a PDF";
};

try {
  await nav(BASE + "/test/print-lang-harness.html");
  await step("scripts load (i18n, print-lang, portal, ward, discharge)", async () => (await until("return !!(window.WARD && window.DISCHARGE && window.WSQPrint && window.WSQI18n && window.WSQPortal)", 8000)) === true || "not loaded");

  // ---- Patient copy (the prescription) ------------------------------------------------------------------
  await ev(`window.print = function () { window.__printed = (window.__printed || 0) + 1; }; WARD.open({ orgId: "org-t" }); WARD._st.sel = { patientId: "p1", encounterId: "e1", ward: "Medical A", bed: "12" }; WARD._dispatch("pcopy"); return 1;`);
  await step("Patient copy: the hospital has the option on, so the picker is offered, English only by default", async () =>
    (await until(`var s=document.getElementById("wPcopyLang"); return s && s.value === "" && !document.querySelector(".p-tr") ? true : null;`, 8000)) === true || "no picker");
  await step("Patient copy: picking Hindi loads the real hi.js and adds the marked translation beside the English", async () => {
    await ev(`var s=document.getElementById("wPcopyLang"); s.value="hi"; s.dispatchEvent(new Event("change",{bubbles:true})); return 1;`);
    const ok = await until(`var a=document.querySelectorAll("#smdWard aside.p-tr[data-print-lang=hi]"); return a.length >= 5 && !!document.querySelector('script[src*="/wardsynq/site/i18n/hi.js"]') ? a.length : null;`, 8000);
    return ok ? true : "no asides";
  });
  await media("print");
  await step("Patient copy print preview: the bar and picker are hidden, the English prescription and the translation both print", async () => {
    const r = await ev(`
      var vis = function (el) { return !!el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0; };
      var bar = document.querySelector("#smdWard .w-dt-bar"), txt = document.getElementById("smdWard").innerText;
      var asides = Array.prototype.slice.call(document.querySelectorAll("#smdWard aside.p-tr"));
      var tr = asides.map(function (a) { return a.innerText; }).join("\\n");
      if (vis(bar) || vis(document.getElementById("wPcopyLang"))) return "the bar prints";
      if (!asides.length || !asides.every(vis)) return "a translation block is hidden on paper";
      var need = ["Methotrexate", "7.5 mg", "once weekly", "0.125 mg", "PRN", "After food; Do not drink alcohol", "Rheumatoid arthritis [M06.9]", "01 Jan 1970", "15 Sep 2026, 01:30"];
      for (var i = 0; i < need.length; i++) if (txt.indexOf(need[i]) < 0) return "English missing: " + need[i];
      if (tr.indexOf("The English prescription is the authoritative one.") < 0) return "no English authority line";
      var bad = ["7.5", "0.125", "once weekly", "PRN", "M06.9", "creatinine"];
      for (var j = 0; j < bad.length; j++) if (tr.indexOf(bad[j]) >= 0) return "clinical text in the translation: " + bad[j];
      return true;`);
    return r;
  });
  await b.shot(SHOTS + "/patient-copy-print-hi.png");
  await step("Patient copy prints to a PDF (Chrome's print pipeline)", () => pdf("patient-copy-hi"));
  await media("screen");

  // ---- Discharge summary --------------------------------------------------------------------------------
  await ev(`DISCHARGE.open({ orgId: "org-t", encounterId: "e1", patientId: "p1" }); return 1;`);
  await step("Discharge summary: picker offered beside Print on the signed summary", async () =>
    (await until(`return document.getElementById("dPrintLang") && document.querySelector('[data-d-act="print"]') ? true : null;`, 8000)) === true || "no picker");
  await step("Discharge summary: pick Telugu, press Print; the printable carries the English summary and the marked translation", async () => {
    await ev(`var s=document.getElementById("dPrintLang"); s.value="te"; s.dispatchEvent(new Event("change",{bubbles:true})); window.__printed=0; return 1;`);
    await until(`return !!document.querySelector('script[src*="/wardsynq/site/i18n/te.js"]') || null;`, 5000);
    await ev(`document.querySelector('[data-d-act="print"]').click(); return 1;`);
    return (await until(`return window.__printed > 0 && document.querySelectorAll("#smdDischarge .d-print aside.p-tr[data-print-lang=te]").length >= 10 ? true : null;`, 8000)) === true || "not printed with the translation";
  });
  await media("print");
  await step("Discharge summary print preview: only the printable shows; English whole, translation marked, nothing clinical in it", async () => ev(`
    var vis = function (el) { return !!el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0; };
    var p = document.querySelector("#smdDischarge .d-print");
    if (!vis(p)) return "printable hidden";
    if (vis(document.querySelector("#smdDischarge .d-shell"))) return "the workstation prints";
    var txt = p.innerText, tr = Array.prototype.map.call(p.querySelectorAll("aside.p-tr"), function (a) { return a.innerText; }).join("\\n");
    var need = ["Methotrexate - 7.5 mg, oral, once weekly (active)", "Digoxin - 0.125 mg, oral, OD (active)", "Do not restart NSAIDs.", "Signed by Dr Rao on 10 Sep 2026, 12:45", "08 Sep 2026, 01:30"];
    for (var i = 0; i < need.length; i++) if (txt.indexOf(need[i]) < 0) return "English missing: " + need[i];
    if (tr.indexOf("The English discharge summary is the authoritative one.") < 0) return "no authority line";
    var bad = ["7.5", "0.125", "once weekly", "NSAIDs", "M06.9", "Dr Rao"];
    for (var j = 0; j < bad.length; j++) if (tr.indexOf(bad[j]) >= 0) return "clinical text in the translation: " + bad[j];
    return true;`));
  await b.shot(SHOTS + "/discharge-print-te.png");
  await step("Discharge summary prints to a PDF", () => pdf("discharge-te"));
  await step("no script errors on the page", async () => b.consoleLines.filter((l) => l.startsWith("EXC")).length === 0 || b.consoleLines.join(" | "));
} finally {
  b.close(); server.close();
}
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots and PDFs: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
