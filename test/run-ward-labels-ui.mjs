/* test/run-ward-labels-ui.mjs - real headless Chrome: printed labels and camera scanning on the ward screens.
 *
 *   node test/run-ward-labels-ui.mjs        (CHROME=<path> to override; SHOTS=<dir> for PDFs and screenshots)
 *
 * The ward is driven through its own buttons (ward.js dispatch). Each label is captured where ward-labels.js hands it to
 * the browser's print (printDocument), then opened on its own and printed to PDF with the page size the label asks for:
 * one page, the hospital's size, and its barcode decoded by Chrome's own BarcodeDetector (an independent decoder).
 * The camera path runs with a stubbed BarcodeDetector and getUserMedia: the scan fills the same field a wedge scanner
 * types into, nothing is sent until the same button is pressed, and a browser without the API says so.
 *
 * Routes are answered with fixtures shaped like the server's: GET /api/queue/ward/list, /ward/label-data,
 * /ward/staff-identities, /ward/collections, /ward/pending-tests, /ward/results-to-verify, /ward/cultures-in-progress,
 * /ward/criticals, /ward/tag-log, /ward/verification-queue, /ward/dispenses; POST /ward/admit, /ward/collect,
 * /ward/specimen-outcome, /ward/tag-verify. The routes themselves are pinned in test/wardsynq-labels-routes.test.mjs.
 * Prints PASS/FAIL per step; exits 1 on any FAIL.
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-labels-shots";
await mkdir(SHOTS, { recursive: true });

const MRN = "SMD-LBL-0042", ACC = "ACC-60916T1015300";
const LABELS = { sizes: { wristband: { widthMm: 75, heightMm: 25 }, specimen: { widthMm: 50, heightMm: 25 }, pharmacy: { widthMm: 75, heightMm: 50 }, slip: { widthMm: 80, heightMm: 60 } }, timeZone: "Asia/Kolkata", utcOffsetMinutes: 330 };
const PATIENT = { encounterId: "e1", patientId: "p1", name: "Deepa Kumari", mrn: MRN, ward: "Medical A", bed: "12", admittedAt: "2026-09-15T04:00:00.000Z" };
const LABEL_DATA = (pid) => ({
  ok: true, patient: { patientId: pid, name: "Deepa Kumari", mrn: MRN, dob: "1970-01-01", dobApproximate: false, ageYears: 56, sex: "female" },
  allergies: pid === "p-unread" ? null : ["Penicillin"], band: { value: MRN, from: "record", bedsideValue: MRN, tagsUnread: false, matchesBedside: true }, labels: LABELS,
});
const COLLECTED = { serviceRequestId: "sr1", code: "CBC", display: "Complete blood count", patientId: "p1", priority: "routine",
  collection: { state: "collected", at: "2026-09-16T04:45:00.000Z", by: "cfa:n1", specimenId: "spec1", accessionNumber: ACC, specimenType: "Whole blood" } };
const UNCOLLECTED = { serviceRequestId: "sr2", code: "K", display: "Serum potassium", patientId: "p1", priority: "routine", collection: { state: "none" } };

const posts = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (body, status) => { res.writeHead(status || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/api/queue/")) {
    const sub = url.pathname.replace(/^\/api\/queue\/ward\//, "");
    let body = null;
    if (req.method === "POST") { let raw = ""; for await (const c of req) raw += c; try { body = JSON.parse(raw); } catch { body = {}; } posts.push({ sub, body }); }
    if (sub === "list") return send({ ok: true, patients: [PATIENT], region: "IN", labels: LABELS });
    if (sub === "label-data") return send(LABEL_DATA(url.searchParams.get("patientId")));
    if (sub === "staff-identities") return send({ ok: true, identities: { "cfa:n1": { name: "Asha Rao", employeeId: "E102", role: "nurse" }, "cfa:ph1": { name: "Pharm Lee", employeeId: "P9", role: "pharmacy" } } });
    if (sub === "collections") return send({ ok: true, requests: [UNCOLLECTED, COLLECTED] });
    if (sub === "pending-tests") return send({ ok: true, pending: [] });
    if (sub === "results-to-verify") return send({ ok: true, results: [] });
    if (sub === "cultures-in-progress") return send({ ok: true, cultures: [], histopathology: [] });
    if (sub === "criticals") return send({ ok: true, loops: [] });
    if (sub === "tag-log") return send({ ok: true, tags: [], active: [] });
    if (sub === "alert-cover") return send({ ok: true, wards: [] });
    if (sub === "tag-verify") return send({ ok: true, matches: true });
    if (sub === "verification-queue") return send({ ok: true, unverified: 0, allergies: [], orders: [{ orderId: "o1", drug: "Ceftriaxone", dose: { value: 1, unit: "g" }, route: "IV", frequency: "BD", state: "verified", safety: { blocks: [], warnings: [] } }] });
    if (sub === "dispenses") return send({ ok: true, labels: LABELS, dispenses: [{ dispenseId: "d1", orderId: "o1", drug: "Ceftriaxone", quantity: { value: 10, unit: "vial" }, batch: "B12", expiry: "2027-01-31", dispensedBy: "cfa:ph1", dispensedAt: "2026-09-16T05:30:00.000Z" }] });
    if (sub === "admit") return send({ ok: true, written: 1, patientId: "p1", encounterId: "e1" });
    if (sub === "collect") return send({ ok: true, written: 1, specimenId: "spec2", serviceRequestId: body.serviceRequestId, patientId: "p1", accessionNumber: "ACC-60916T1100000", specimenType: body.specimenType, collectedBy: "cfa:n1", collectedAt: "2026-09-16T05:30:00.000Z", state: "collected" });
    if (sub === "specimen-outcome") {
      const scanned = String(body.scannedAccession || "").trim().toUpperCase();
      if (scanned && scanned !== ACC) return send({ ok: false, error: "wrong_specimen_scan", written: 0 }, 409);
      return send({ ok: true, written: 1, specimenId: body.specimenId, state: body.state });
    }
    return send({ ok: true });
  }
  if (url.pathname === "/__label") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(DOCS[Number(url.searchParams.get("i"))] || ""); return; }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
const DOCS = [];
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

const results = [];
const b = await launch({ port: Number(process.env.CDP_PORT || 9493), width: 1100, height: 1300 });
const { ev, until, nav, call } = b;
async function step(name, fn) {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e)]); }
  const last = results[results.length - 1]; console.log(last[0], name, last[2]);
}
const docCount = () => ev("return window.__docs.length");
const lastDoc = () => ev("return window.__docs[window.__docs.length - 1]");
const banner = () => ev(`var b=document.querySelector("#smdWard .w-err, #smdWard .w-ok, #smdWard .w-refusal"); return b ? b.innerText : "";`);
const click = (sel) => ev(`var x=document.querySelector(${JSON.stringify(sel)}); if(!x) return "no " + ${JSON.stringify(sel)}; x.click(); return true;`);
const postsOf = (sub) => posts.filter((p) => p.sub === sub);
/* The camera stubs. mode: "found" (reads `code`), "none" (sees nothing until cancelled), "denied", "absent" (no API). */
const camera = (mode, code) => ev(`
  if (${JSON.stringify(mode)} === "absent") { window.BarcodeDetector = undefined; return true; }
  window.BarcodeDetector = function () {};
  window.BarcodeDetector.prototype.detect = function () { return Promise.resolve(${JSON.stringify(mode)} === "found" ? [{ rawValue: ${JSON.stringify(code || "")}, format: "qr_code" }] : []); };
  navigator.mediaDevices.getUserMedia = function () {
    if (${JSON.stringify(mode)} === "denied") { var e = new Error("denied"); e.name = "NotAllowedError"; return Promise.reject(e); }
    var cv = document.createElement("canvas"); cv.width = 32; cv.height = 32; return Promise.resolve(cv.captureStream(5));
  };
  return true;`);

try {
  await nav(BASE + "/test/ward-labels-harness.html");
  await step("scripts load (i18n, print-lang, ward-labels, ward)", async () => (await until("return !!(window.WARD && window.WARD_LABELS && window.WSQPrint)", 8000)) === true || "not loaded");
  // Keep the real BarcodeDetector for decoding the printed labels; capture each print instead of opening a dialog.
  await ev(`window.__realBD = window.BarcodeDetector; window.__docs = []; WARD_LABELS.printDocument = function (doc) { window.__docs.push(doc); return true; }; window.__gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia; return 1;`);
  await ev(`WARD.open({ orgId: "org-t" }); WARD._dispatch("board"); return 1;`);
  await until(`return WARD._st.labels ? true : null;`, 3000);

  // ---- admission: the wristband and ID slip are offered where the admission lands ---------------------------------
  await step("admission: admitting from the bed board lands on the ward list with Print wristband and Print ID slip offered", async () => {
    await ev(`var s = WARD._st; s.admitTarget = { ward: "Medical A", bed: "12" }; s.mrnLookup = { mrn: ${JSON.stringify(MRN)}, name: "Deepa Kumari" }; WARD._dispatch("admitconfirm"); return 1;`);
    const ok = await until(`var o=document.querySelector("#smdWard .w-labeloffer"); return o && WARD._st.view === "list" && o.querySelector('[data-w-act="labelprint:wristband"]') && o.querySelector('[data-w-act="labelprint:slip"]') && /Deepa Kumari/.test(o.innerText) ? true : null;`, 8000);
    return ok === true || "no offer: " + (await banner());
  });
  await b.shot(SHOTS + "/admission-offer.png");
  await step("Print wristband: one label document with name, MRN, DOB and age, sex, the allergy, the QR, at 75 x 25 mm; the screen says the dialog opened", async () => {
    const n = await docCount();
    await click('#smdWard [data-w-act="labelprint:wristband"]');
    if (!(await until(`return window.__docs.length === ${n + 1} || null;`, 5000))) return "nothing printed: " + (await banner());
    const doc = await lastDoc(); DOCS.push(doc);
    for (const s of ["Deepa Kumari", MRN, "1970-01-01", "(56 y)", "female", "ALLERGY: Penicillin", "@page{size:75mm 25mm;margin:0}", 'class="qr"']) if (!doc.includes(s)) return "missing " + s;
    return /print dialog is open for the wristband/.test(await banner()) || "note: " + (await banner());
  });
  await step("Print ID slip: name, age and sex, Code 128 of the MRN, ward and bed, at 80 x 60 mm", async () => {
    await click('#smdWard [data-w-act="labelprint:slip"]');
    if (!(await until(`return window.__docs.length === 2 || null;`, 5000))) return "nothing printed: " + (await banner());
    const doc = await lastDoc(); DOCS.push(doc);
    for (const s of ["Deepa Kumari", "56 y", "Medical A", "@page{size:80mm 60mm;margin:0}", 'class="bc"', 'aria-label="' + MRN + '"']) if (!doc.includes(s)) return "missing " + s;
    return true;
  });
  await step("a wristband whose allergies could not be read is NOT printed, and the screen says why", async () => {
    await ev(`WARD._st.labelOffer.patientId = "p-unread"; return 1;`);
    await click('#smdWard [data-w-act="labelprint:wristband"]');
    await until(`return /allergies could not be read/.test((document.querySelector("#smdWard .w-err")||{}).innerText || "") || null;`, 5000);
    return (await docCount()) === 2 && /allergies could not be read/.test(await banner()) || "printed anyway or no error: " + (await banner());
  });
  await ev(`WARD._dispatch("labeloffer-x"); return 1;`);

  // ---- the Wristband screen: print, and camera scanning into the check ---------------------------------------------
  await ev(`WARD._st.sel = ${JSON.stringify({ ...PATIENT })}; WARD._dispatch("tags"); return 1;`);
  await until(`return document.getElementById("wTgScan") || null;`, 5000);
  await step("Wristband screen: Scan with camera beside the check and the issue fields; Print wristband and ID slip", async () => ev(`
    var need = ['[data-w-act="camscan:wTgScan"]', '[data-w-act="camscan:wTgCode"]', '[data-w-act="tagprint:wristband"]', '[data-w-act="tagprint:slip"]'];
    for (var i = 0; i < need.length; i++) if (!document.querySelector("#smdWard " + need[i])) return "missing " + need[i];
    return true;`));
  await step("camera: a browser without BarcodeDetector says so plainly and fills nothing; typed input still works", async () => {
    await camera("absent");
    await click('#smdWard [data-w-act="camscan:wTgScan"]');
    const msg = await until(`var e=document.querySelector("#smdWard .w-err"); return e && /cannot scan with the camera/.test(e.innerText) ? e.innerText : null;`, 3000);
    if (!msg) return "no fallback message: " + (await banner());
    if (await ev(`return document.querySelector(".w-camscan") ? "overlay" : document.getElementById("wTgScan").value;`)) return "something opened or was filled";
    return postsOf("tag-verify").length === 0 || "a check was sent";
  });
  await step("camera: a read fills the field and sends nothing; pressing Check sends it through POST /ward/tag-verify exactly as typed input", async () => {
    await camera("found", MRN);
    await click('#smdWard [data-w-act="camscan:wTgScan"]');
    const filled = await until(`return document.getElementById("wTgScan").value === ${JSON.stringify(MRN)} && !document.querySelector(".w-camscan") ? true : null;`, 5000);
    if (!filled) return "not filled: " + (await banner());
    if (postsOf("tag-verify").length) return "sent before the button was pressed";
    await click('#smdWard [data-w-act="tagverify"]');
    const sent = await until(`return true;`, 200) && (await (async () => { for (let i = 0; i < 20 && !postsOf("tag-verify").length; i++) await b.sleep(100); return postsOf("tag-verify")[0]; })());
    if (!sent) return "not sent";
    return sent.body.scannedCode === MRN && sent.body.patientId === "p1" && sent.body.tagType === "wristband" || JSON.stringify(sent.body);
  });
  await step("camera: permission refused says so; Cancel closes the camera and leaves the field and the screen as they were", async () => {
    await ev(`document.getElementById("wTgScan").value = ""; return 1;`);
    await camera("denied");
    await click('#smdWard [data-w-act="camscan:wTgScan"]');
    if (!(await until(`var e=document.querySelector("#smdWard .w-err"); return e && /camera was not allowed/.test(e.innerText) ? true : null;`, 3000))) return "no denied message: " + (await banner());
    await ev(`WARD._dispatch("dismiss"); return 1;`);
    await camera("none");
    await click('#smdWard [data-w-act="camscan:wTgScan"]');
    if (!(await until(`return document.querySelector(".w-camscan video") ? true : null;`, 3000))) return "no camera layer";
    await b.shot(SHOTS + "/camera-layer.png");
    await ev(`document.querySelector(".w-camscan button").click(); return 1;`);
    const gone = await until(`return !document.querySelector(".w-camscan") ? true : null;`, 3000);
    return gone === true && (await ev(`return document.getElementById("wTgScan").value === "" && !document.querySelector("#smdWard .w-err");`)) === true || "layer stayed or state changed";
  });

  // ---- eMAR bedside scan -------------------------------------------------------------------------------------------
  await ev(`WARD._dispatch("dismiss"); var s = WARD._st; s.view = "chart"; s.due = []; WARD._dispatch("round"); return 1;`);
  await step("eMAR: Scan with camera beside the wristband and the drug scan fields", async () => {
    const ok = await until(`return document.getElementById("wScanP") && document.querySelector('#smdWard [data-w-act="camscan:wScanP"]') && document.querySelector('#smdWard [data-w-act="camscan:wScanD"]') ? true : null;`, 5000);
    return ok === true || "missing on the chart";
  });

  // ---- laboratory board: receive by scanning, tube label, Collect ---------------------------------------------------
  await ev(`WARD._st.sel = null; WARD._dispatch("labboard"); return 1;`);
  await until(`return document.getElementById("wSpecScan") || null;`, 8000);
  await step("lab board: a typed label that is on no tube in transit is refused on the screen and nothing is sent", async () => {
    await ev(`document.getElementById("wSpecScan").value = "ACC-NOT-HERE"; return 1;`);
    await click('#smdWard [data-w-act="specscanreceive"]');
    const msg = await until(`var e=document.querySelector("#smdWard .w-err"); return e && /No sample in transit/.test(e.innerText) ? true : null;`, 3000);
    return msg === true && postsOf("specimen-outcome").length === 0 || "sent or no message: " + (await banner());
  });
  await step("lab board: the camera reads the tube, the field is filled, Receive sends POST /ward/specimen-outcome with the scanned label for the server to check", async () => {
    await ev(`WARD._dispatch("dismiss"); document.getElementById("wSpecScan").value = ""; return 1;`);
    await camera("found", " " + ACC.toLowerCase());
    await click('#smdWard [data-w-act="camscan:wSpecScan"]');
    if (!(await until(`return document.getElementById("wSpecScan").value.trim() === ${JSON.stringify(ACC.toLowerCase())} || null;`, 5000))) return "not filled";
    if (postsOf("specimen-outcome").length) return "sent before the button";
    await click('#smdWard [data-w-act="specscanreceive"]');
    for (let i = 0; i < 30 && !postsOf("specimen-outcome").length; i++) await b.sleep(100);
    const p = postsOf("specimen-outcome")[0];
    if (!p) return "not sent";
    return p.body.specimenId === "spec1" && p.body.state === "received" && p.body.scannedAccession.trim() === ACC.toLowerCase() || JSON.stringify(p.body);
  });
  await ev(`WARD._dispatch("labboard"); return 1;`);
  await until(`return document.querySelector('#smdWard [data-w-act="speclabel:sr1"]') || null;`, 8000);
  await step("lab board: Print tube label on a collected sample carries patient, MRN, accession (Code 128), test, specimen type, collected at and by, at 50 x 25 mm", async () => {
    const n = await docCount();
    await click('#smdWard [data-w-act="speclabel:sr1"]');
    if (!(await until(`return window.__docs.length === ${n + 1} || null;`, 5000))) return "nothing printed: " + (await banner());
    const doc = await lastDoc(); DOCS.push(doc);
    for (const s of ["Deepa Kumari", MRN, ACC, "Complete blood count", "Whole blood", "16 Sep 2026, 10:15", "Asha Rao (E102)", "@page{size:50mm 25mm;margin:0}", 'aria-label="' + ACC + '"']) if (!doc.includes(s)) return "missing " + s;
    return true;
  });
  await step("Collect: the wristband question has Scan with camera; a collection offers Print tube label on the board", async () => {
    await click('#smdWard [data-w-act="collectspecimen:sr2"]');
    if (!(await until(`return document.querySelector('#smdWard .w-ask [data-w-act="camscan:wAsk_scanned"]') ? true : null;`, 3000))) return "no camera in the Collect question";
    await camera("found", MRN);
    await click('#smdWard [data-w-act="camscan:wAsk_scanned"]');
    if (!(await until(`return document.getElementById("wAsk_scanned") && document.getElementById("wAsk_scanned").value === ${JSON.stringify(MRN)} ? true : null;`, 5000))) return "the question's field was not filled";
    await ev(`var t=document.getElementById("wAsk_specimenType"); t.value="Serum"; t.dispatchEvent(new Event("input",{bubbles:true})); return 1;`);
    await click('#smdWard [data-w-act="askok"]');
    const offer = await until(`var o=document.querySelector("#smdWard .w-labeloffer"); return o && /Serum potassium/.test(o.innerText) && o.querySelector('[data-w-act="labelprint:specimen"]') ? true : null;`, 8000);
    if (!offer) return "no offer: " + (await banner());
    const c = postsOf("collect")[0];
    return c && c.body.scannedPatientBarcode === MRN && c.body.specimenType === "Serum" || "collect body: " + JSON.stringify(c && c.body);
  });
  await b.shot(SHOTS + "/lab-board.png");

  // ---- pharmacy dispense -----------------------------------------------------------------------------------------------
  await ev(`WARD._dispatch("labeloffer-x"); WARD._st.labels = null; WARD._st.sel = ${JSON.stringify({ ...PATIENT })}; WARD._dispatch("pharmacyopen"); return 1;`);
  await until(`return document.querySelector('#smdWard [data-w-act="phpick:o1"]') || null;`, 8000);
  await ev(`WARD._dispatch("phpick:o1"); return 1;`);
  await step("pharmacy: Scan with camera beside the batch; the dispense row prints the label with patient, drug, dose, route, frequency, quantity, batch, expiry, dispensed by, at 75 x 50 mm", async () => {
    if (!(await until(`return document.querySelector('#smdWard [data-w-act="camscan:wPhBatch"]') && document.querySelector('#smdWard [data-w-act="pharmlabel:d1"]') ? true : null;`, 5000))) return "missing buttons";
    const n = await docCount();
    await click('#smdWard [data-w-act="pharmlabel:d1"]');
    if (!(await until(`return window.__docs.length === ${n + 1} || null;`, 5000))) return "nothing printed (label settings come with the dispense list): " + (await banner());
    const doc = await lastDoc(); DOCS.push(doc);
    for (const s of ["Deepa Kumari", MRN, "Ceftriaxone", "1 g · IV · BD", "10 vial", "B12", "2027-01-31", "Pharm Lee (P9)", "@page{size:75mm 50mm;margin:0}"]) if (!doc.includes(s)) return "missing " + s;
    return true;
  });
  await step("no script errors on the ward page", async () => b.consoleLines.filter((l) => l.startsWith("EXC")).length === 0 || b.consoleLines.join(" | "));

  // ---- print preview of every captured label, and an independent decode of its barcode -------------------------------
  const EXPECT = [["wristband", 75, 25, "qr_code", MRN], ["slip", 80, 60, "code_128", MRN], ["specimen", 50, 25, "code_128", ACC], ["pharmacy", 75, 50, null, null]];
  for (let i = 0; i < EXPECT.length; i++) {
    const [kind, w, h, format, value] = EXPECT[i];
    await nav(BASE + "/__label?i=" + i);
    await until(`return document.querySelector(".lbl") ? true : null;`, 3000);
    await step(`${kind} print preview: exactly one ${w} x ${h} mm page`, async () => {
      const r = await call("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
      const data = r.result && r.result.data;
      if (!data) return "no PDF: " + JSON.stringify(r.error || r);
      const pdf = Buffer.from(data, "base64"); await writeFile(`${SHOTS}/${kind}.pdf`, pdf);
      const text = pdf.toString("latin1");
      const pages = (text.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
      const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
      if (!box) return "no MediaBox";
      const mm = (pt) => (Number(pt) * 25.4) / 72;
      if (Math.abs(mm(box[1]) - w) > 1 || Math.abs(mm(box[2]) - h) > 1) return `page is ${mm(box[1]).toFixed(1)} x ${mm(box[2]).toFixed(1)} mm`;
      return pages === 1 || pages + " pages";
    });
    if (format) await step(`${kind}: the printed ${format} decodes to ${value} (Chrome's BarcodeDetector)`, async () => ev(`
      var svg = document.querySelector(".lbl svg." + (${JSON.stringify(format)} === "qr_code" ? "qr" : "bc"));
      if (!svg) return "no barcode";
      var vb = svg.viewBox.baseVal, scale = ${JSON.stringify(format)} === "qr_code" ? 8 : 3;
      var cw = vb.width * scale, ch = ${JSON.stringify(format)} === "qr_code" ? vb.height * scale : 120;
      var img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg)); await img.decode();
      var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch; var g = cv.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, cw, ch);
      var found = await new BarcodeDetector({ formats: [${JSON.stringify(format)}] }).detect(cv);
      return found.length && found[0].rawValue === ${JSON.stringify(value)} ? true : "decoded: " + JSON.stringify(found.map(function (f) { return f.rawValue; }));`));
  }
} finally {
  b.close(); server.close();
}
if (!process.env.SHOTS) await rm(SHOTS, { recursive: true, force: true });
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
process.exit(failed.length ? 1 : 0);
