/* test/run-ward-dicom-viewer-ui.mjs - real headless Chrome: the in-app DICOM viewer on the Radiology screen.
 *
 *   node test/run-ward-dicom-viewer-ui.mjs      (CHROME=<path>; CHROME_FLAGS for e.g. --no-sandbox or a proxy; SHOTS=<dir>)
 *
 * The images are SYNTHETIC, built here byte by byte: a 64 x 64, 16-bit signed, explicit VR little endian CT stack with
 * rescale -1024, pixel spacing 0.5 mm, window 40/400, a left-to-right gradient from -1000 to +1000 HU, and a centre
 * square whose HU changes per slice (-400, -200, 0, 200, 400). No real patient image is used anywhere.
 *
 * The ward is driven through its own buttons: Radiology, the study's "View images", then the viewer's toolbar, the
 * mouse (CDP Input events, so pointer and wheel handlers run for real) and the keyboard. Pixels are read back from the
 * viewer's canvas: a window/level change and a slice change must change what is drawn, and by the amount the
 * arithmetic says. dicom-parser is loaded from cdn.jsdelivr.net with its SRI hash, exactly as in the app, so this
 * also proves the pinned hash matches the published file (it needs network access to jsdelivr).
 *
 * Routes answered with fixtures shaped like the server's (pinned in test/wardsynq-dicom-viewer.test.mjs):
 * GET /api/queue/ward/collections, /pending-tests, /fhir, /imaging-studies, /protocol-context, /imaging-series,
 * /imaging-instance. Prints PASS/FAIL per step; exits 1 on any FAIL.
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const SHOTS = process.env.SHOTS || (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-dicom-viewer-shots";
await mkdir(SHOTS, { recursive: true });

/* ---- a synthetic DICOM Part 10 file ----------------------------------------------------------------------------- */
const ROWS = 64, COLS = 64, SQUARE = [-400, -200, 0, 200, 400];
function even(s, pad) { return s.length % 2 ? s + pad : s; }
function el(group, elem, vr, value) {
  let body;
  if (value instanceof Uint8Array) body = value;
  else if (vr === "US") { body = new Uint8Array(2); new DataView(body.buffer).setUint16(0, value, true); }
  else if (vr === "UL") { body = new Uint8Array(4); new DataView(body.buffer).setUint32(0, value, true); }
  else body = new TextEncoder().encode(even(String(value), vr === "UI" ? "\0" : " "));
  const long = vr === "OB" || vr === "OW" || vr === "SQ" || vr === "UN" || vr === "UT";
  const head = new Uint8Array(long ? 12 : 8), dv = new DataView(head.buffer);
  dv.setUint16(0, group, true); dv.setUint16(2, elem, true); head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
  if (long) dv.setUint32(8, body.length, true); else dv.setUint16(6, body.length, true);
  const out = new Uint8Array(head.length + body.length); out.set(head); out.set(body, head.length); return out;
}
function cat(parts) { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function dicom(slice, sopUid, transferSyntax) {
  const px = new Uint8Array(ROWS * COLS * 2), dv = new DataView(px.buffer);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const inSquare = r >= 24 && r < 40 && c >= 24 && c < 40;
    const hu = inSquare ? SQUARE[slice] : Math.round(-1000 + c * (2000 / (COLS - 1)));
    dv.setInt16((r * COLS + c) * 2, hu + 1024, true);   // stored = HU - intercept
  }
  const ts = transferSyntax || "1.2.840.10008.1.2.1";
  const metaBody = cat([el(0x0002, 0x0001, "OB", new Uint8Array([0, 1])), el(0x0002, 0x0002, "UI", "1.2.840.10008.5.1.4.1.1.2"),
    el(0x0002, 0x0003, "UI", sopUid), el(0x0002, 0x0010, "UI", ts)]);
  const meta = cat([el(0x0002, 0x0000, "UL", metaBody.length), metaBody]);
  const ds = cat([
    el(0x0008, 0x0016, "UI", "1.2.840.10008.5.1.4.1.1.2"), el(0x0008, 0x0018, "UI", sopUid), el(0x0008, 0x0060, "CS", "CT"),
    el(0x0020, 0x0013, "IS", String(slice + 1)),
    el(0x0028, 0x0002, "US", 1), el(0x0028, 0x0004, "CS", "MONOCHROME2"), el(0x0028, 0x0010, "US", ROWS), el(0x0028, 0x0011, "US", COLS),
    el(0x0028, 0x0030, "DS", "0.5\\0.5"), el(0x0028, 0x0100, "US", 16), el(0x0028, 0x0101, "US", 16), el(0x0028, 0x0102, "US", 15),
    el(0x0028, 0x0103, "US", 1), el(0x0028, 0x1050, "DS", "40"), el(0x0028, 0x1051, "DS", "400"), el(0x0028, 0x1052, "DS", "-1024"),
    el(0x0028, 0x1053, "DS", "1"), el(0x7fe0, 0x0010, "OW", px)]);
  return cat([new Uint8Array(128), new TextEncoder().encode("DICM"), meta, ds]);
}

const STUDY_UID = "1.2.826.0.1.3680043.8.498.1", SERIES = "1.2.826.0.1.3680043.8.498.1.1", SERIES_J2K = "1.2.826.0.1.3680043.8.498.1.2";
const sop = (i) => "1.2.826.0.1.3680043.8.498.1.1." + (i + 1);
const SOP_J2K = "1.2.826.0.1.3680043.8.498.1.2.1";
const J2K = "1.2.840.10008.1.2.4.90";
const PATIENT = { encounterId: "e1", patientId: "p1", name: "Test Patient", mrn: "SMD-DV-0001", ward: "Medical A", bed: "3", admittedAt: "2026-09-20T04:00:00.000Z" };
const SERIES_ANSWER = (headerHidden) => ({
  ok: true, study: { id: "is1", studyUid: STUDY_UID, modality: "CT", started: "2026-09-24" },
  header: headerHidden ? null : { patientName: "Synthetic^Phantom", patientId: "PHANTOM-1", birthDate: null, sex: "O", studyDate: "20260924", studyDescription: "Phantom CT", accessionNumber: "ACC-DV-1" },
  headerHidden: !!headerHidden, truncated: false,
  series: [
    { seriesUid: SERIES, number: 1, modality: "CT", description: "Axial phantom", instances: SQUARE.map((_, i) => ({ sopUid: sop(i), number: i + 1, frames: 1 })) },
    { seriesUid: SERIES_J2K, number: 2, modality: "CT", description: "Compressed", instances: [{ sopUid: SOP_J2K, number: 1, frames: 1 }] },
  ],
});

const seen = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (body, status) => { res.writeHead(status || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/api/queue/")) {
    const sub = url.pathname.replace(/^\/api\/queue\/ward\//, "");
    seen.push({ sub, q: Object.fromEntries(url.searchParams), staff: req.headers["x-staff-token"] || null });
    if (sub === "list") return send({ ok: true, patients: [PATIENT], region: "IN" });
    if (sub === "collections") return send({ ok: true, requests: [{ serviceRequestId: "sr1", code: "CT-HEAD", display: "CT head", category: "imaging", patientId: "p1", priority: "routine", collection: { state: "none" } }] });
    if (sub === "pending-tests") return send({ ok: true, pending: [] });
    if (sub === "fhir") return send({ resourceType: "Bundle", entry: [] });
    if (sub === "protocol-context") return send({ ok: true, contrastAllergies: [], renal: null });
    if (sub === "imaging-studies") return send({ ok: true, templates: [], orders: [{ serviceRequestId: "sr1", display: "CT head",
      study: { id: url.searchParams.get("patientId") === "p-none" ? "is-x" : "is1", studyUid: STUDY_UID, inAppViewer: true, accessionNumber: "ACC-DV-1", modality: "CT", started: "2026-09-24", seriesCount: 2, instanceCount: 6 },
      viewer: { available: false, detail: "No viewer configured." } }] });
    if (sub === "imaging-series") {
      const id = url.searchParams.get("studyId");
      if (id === "is-noarchive") return send({ ok: false, error: "no_archive", detail: "No DICOMweb archive is configured for this hospital." }, 409);
      return send(SERIES_ANSWER(id === "is-hidden"));
    }
    if (sub === "imaging-instance") {
      const s = url.searchParams.get("sopUid");
      if (s === SOP_J2K) { const b = dicom(0, SOP_J2K, J2K); res.writeHead(200, { "Content-Type": "application/dicom", "Cache-Control": "private, no-store" }); res.end(b); return; }
      const i = SQUARE.findIndex((_, k) => sop(k) === s);
      if (i < 0 || url.searchParams.get("seriesUid") !== SERIES) return send({ ok: false, error: "not_in_archive" }, 404);
      res.writeHead(200, { "Content-Type": "application/dicom", "Cache-Control": "private, no-store" }); res.end(dicom(i, s)); return;
    }
    return send({ ok: true });
  }
  const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { const b = await readFile(p); res.writeHead(200, { "Content-Type": TYPES[extname(p)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

const results = [];
const b = await launch({ port: Number(process.env.CDP_PORT || 9497), width: 1100, height: 900 });
const { ev, until, call } = b;
async function step(name, fn) {
  try { const r = await fn(); results.push([r === true ? "PASS" : "FAIL", name, r === true ? "" : String(r)]); }
  catch (e) { results.push(["FAIL", name, String(e && e.message || e)]); }
  const last = results[results.length - 1]; console.log(last[0], name, last[2]);
}
const readout = () => ev(`var r=document.getElementById("wDvRo"); return r ? r.innerText : "";`);
const message = () => ev(`var m=document.getElementById("wDvMsg"); return m && !m.hidden ? m.innerText : "";`);
/* The canvas pixel (R) at a point of the IMAGE, from the same fit arithmetic the engine draws with (zoom 1, no pan). */
const pixelAt = (ix, iy) => ev(`var c=document.getElementById("wDvCanvas"); var s=Math.min(c.width/${COLS}, c.height/${ROWS}); var x0=(c.width-${COLS}*s)/2, y0=(c.height-${ROWS}*s)/2;
  return c.getContext("2d").getImageData(Math.floor(x0+(${ix}+0.5)*s), Math.floor(y0+(${iy}+0.5)*s), 1, 1).data[0];`);
/* The page (CSS px) point of an image point, for real mouse input. */
const pagePoint = async (ix, iy) => JSON.parse(await ev(`var c=document.getElementById("wDvCanvas"), r=c.getBoundingClientRect(); var s=Math.min(r.width/${COLS}, r.height/${ROWS});
  return JSON.stringify([r.left+(r.width-${COLS}*s)/2+${ix}*s, r.top+(r.height-${ROWS}*s)/2+${iy}*s]);`));
async function drag(from, to) {
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0], y: from[1] });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: from[0], y: from[1], button: "left", buttons: 1, clickCount: 1 });
  for (let k = 1; k <= 5; k++) await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: from[0] + (to[0] - from[0]) * k / 5, y: from[1] + (to[1] - from[1]) * k / 5, button: "left", buttons: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: to[0], y: to[1], button: "left", buttons: 0, clickCount: 1 });
}
/* A slice change is announced at once and drawn when its image has arrived: wait for the pixels, not the readout. */
const centreBecomes = async (want) => { for (let i = 0; i < 40; i++) { const v = await pixelAt(32, 32); if (near(v, want)) return v; await b.sleep(125); } return pixelAt(32, 32); };
const key = async (k) => { await call("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k }); await call("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k }); };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 2 : tol);
/* Expected grey for an HU at window (ww, wc), the engine's own linear map. */
const grey = (hu, ww, wc) => Math.max(0, Math.min(255, (hu - (wc - ww / 2)) * 255 / Math.max(1, ww)));

try {
  await b.nav(BASE + "/test/ward-dicom-viewer-harness.html");
  await step("scripts load (i18n, ward); the viewer engine is NOT loaded before it is asked for", async () =>
    (await until("return window.WARD && window.WSQI18n ? true : null", 8000)) === true && (await ev("return !window.WardDicom")) === true || "not loaded, or the engine loaded eagerly");
  await ev(`try { localStorage.setItem("smd_opd_staff_tok", "staff-tok-1"); } catch (e) {} WARD.open({ orgId: "org-t" }); return 1;`);
  await ev(`WARD._st.sel = ${JSON.stringify(PATIENT)}; WARD._dispatch("radiologyopen:sr1"); return 1;`);

  await step("Radiology: the study with an archive connected offers View images, and says the pixels are not stored", async () => {
    const ok = await until(`var b=document.querySelector('#smdWard [data-w-act="dicomview:is1"]'); return b && /View images/.test(b.innerText) ? true : null;`, 8000);
    if (!ok) return "no View images button: " + (await ev(`return (document.querySelector("#smdWard")||{}).innerText.slice(0,600)`));
    return (await ev(`return /not stored by WardSynQ/.test(document.querySelector("#smdWard").innerText) && !/Images open in the hospital's own viewer/.test(document.querySelector("#smdWard").innerText)`)) === true || "wrong hint";
  });
  const localBefore = await ev(`return JSON.stringify(Object.keys(localStorage).sort())`);

  await ev(`document.querySelector('#smdWard [data-w-act="dicomview:is1"]').click(); return 1;`);
  await step("View images: the dark layer opens on document.body (outside #smdWard) and the first slice is drawn", async () => {
    const drawn = await until(`return /Image 1 of 5[\\s\\S]*Window 400, level 40/.test((document.getElementById("wDvRo")||{}).innerText||"") ? true : null;`, 15000);
    if (!drawn) return "not drawn: msg=" + (await message()) + " console=" + b.consoleLines.join(" | ");
    return (await ev(`var o=document.getElementById("wDicom"); return !!o && o.parentNode === document.body && !document.getElementById("smdWard").contains(o) && o.getAttribute("role") === "dialog";`)) === true || "wrong parent";
  });
  await b.shot(SHOTS + "/viewer-open.png");
  await step("dicom-parser came from jsdelivr with the pinned SRI hash (the browser checked it)", async () =>
    (await ev(`var s=[].slice.call(document.scripts).filter(function(x){return /dicom-parser@1\\.8\\.21/.test(x.src)})[0]; return !!(s && s.integrity && s.crossOrigin === "anonymous" && window.dicomParser);`)) === true || "parser not loaded with SRI");
  await step("the viewer is on top of the ward: the canvas, not a ward element, is what a touch at its centre hits", async () =>
    (await ev(`var c=document.getElementById("wDvCanvas"), r=c.getBoundingClientRect(); return document.elementFromPoint(r.left+r.width/2, r.top+r.height/2) === c || (document.elementFromPoint(r.left+r.width/2, r.top+r.height/2)||{}).className;`)));
  await step("header: the archive's patient and study line is shown to a caller allowed to read the patient", async () =>
    /Synthetic\^Phantom/.test(await ev(`return document.getElementById("wDvHd").innerText`)) && /Phantom CT/.test(await ev(`return document.getElementById("wDvHd").innerText`)) || "header: " + (await ev(`return document.getElementById("wDvHd").innerText`)));
  await step("the images were fetched with the ward's own credential, naming the record's study id and never a study UID", async () => {
    const inst = seen.filter((x) => x.sub === "imaging-instance");
    if (!inst.length) return "no instance request";
    return inst.every((x) => x.staff === "staff-tok-1" && x.q.studyId === "is1" && !("studyUid" in x.q) && x.q.orgId === "org-t") || JSON.stringify(inst[0]);
  });

  await step("first draw uses the file's own window 40/400: the centre (-400 HU) is black, the gradient's right edge (+1000 HU) white, its middle (0 HU) mid-grey", async () => {
    const c = await pixelAt(32, 32), right = await pixelAt(63, 5), mid = await pixelAt(31, 5);
    const midHu = Math.round(-1000 + 31 * (2000 / 63));
    return c === 0 && right === 255 && near(mid, grey(midHu, 400, 40), 3) && /Window 400, level 40/.test(await readout()) || `c=${c} right=${right} mid=${mid} (want ~${grey(midHu, 400, 40).toFixed(0)}) ro=${await readout()}`;
  });
  await step("a CT preset (Lung 1500/-600) redraws: the centre changes from 0 to the value the lung window gives -400 HU", async () => {
    await ev(`document.querySelector('#wDicom [data-dv-preset="lung"]').click(); return 1;`);
    const c = await pixelAt(32, 32);
    return near(c, grey(-400, 1500, -600)) && /Window 1500, level -600/.test(await readout()) || `c=${c} want ~${grey(-400, 1500, -600).toFixed(0)} ro=${await readout()}`;
  });
  await step("window/level by dragging (the W/L tool, real mouse): the readout and the drawn pixels both change", async () => {
    await ev(`document.querySelector('#wDicom [data-dv-tool="wl"]').click(); return 1;`);
    if ((await ev(`return document.querySelector('#wDicom [data-dv-tool="wl"]').getAttribute("aria-pressed")`)) !== "true") return "tool not pressed";
    const before = await pixelAt(32, 32), roBefore = await readout();
    const from = await pagePoint(20, 20); await drag(from, [from[0] + 60, from[1] + 40]);
    const after = await pixelAt(32, 32), ro = await readout();
    const m = /Window (\d+), level (-?\d+)/.exec(ro);
    if (!m) return "no readout: " + ro;
    const ww = +m[1], wc = +m[2];
    return ro !== roBefore && after !== before && ww > 1500 && wc > -600 && near(after, grey(-400, ww, wc), 3) || `before=${before} after=${after} ro=${ro} want ~${grey(-400, ww, wc).toFixed(0)}`;
  });
  await ev(`document.querySelector('#wDicom [data-dv-preset="lung"]').click(); document.querySelector('#wDicom [data-dv-tool="scroll"]').click(); return 1;`);
  await step("stack scroll by mouse wheel: slice 2 is drawn and its centre (-200 HU) is brighter than slice 1's", async () => {
    const before = await pixelAt(32, 32);
    const p = await pagePoint(32, 32);
    await call("Input.dispatchMouseEvent", { type: "mouseWheel", x: p[0], y: p[1], deltaX: 0, deltaY: 100 });
    if (!(await until(`return /Image 2 of 5/.test(document.getElementById("wDvRo").innerText) ? true : null;`, 5000))) return "no slice change: " + (await readout());
    const after = await centreBecomes(grey(-200, 1500, -600));
    return near(after, grey(-200, 1500, -600)) && after > before || `before=${before} after=${after}`;
  });
  await step("stack scroll by keyboard (End, then ArrowUp) and by dragging with the scroll tool", async () => {
    await key("End");
    if (!(await until(`return /Image 5 of 5/.test(document.getElementById("wDvRo").innerText) ? true : null;`, 5000))) return "End: " + (await readout());
    const c5 = await centreBecomes(grey(400, 1500, -600));
    if (!near(c5, grey(400, 1500, -600))) return "slice 5 centre wrong: " + c5;
    await key("ArrowUp");
    if (!(await until(`return /Image 4 of 5/.test(document.getElementById("wDvRo").innerText) ? true : null;`, 5000))) return "ArrowUp: " + (await readout());
    const p = await pagePoint(32, 20); await drag(p, [p[0], p[1] - 40]);
    return (await until(`return /Image [1-3] of 5/.test(document.getElementById("wDvRo").innerText) ? true : null;`, 5000)) === true || "drag: " + (await readout());
  });
  await step("zoom in and reset: the readout shows the zoom, Reset puts the file's window and 100% back", async () => {
    await ev(`document.querySelector('#wDicom [data-dv-act="zoomin"]').click(); return 1;`);
    if (!/Zoom 125%/.test(await readout())) return "zoom: " + (await readout());
    await ev(`document.querySelector('#wDicom [data-dv-act="reset"]').click(); return 1;`);
    const ro = await readout();
    return !/Zoom/.test(ro) && /Window 400, level 40/.test(ro) || "reset: " + ro;
  });
  await step("measure: a line across 32 image pixels at 0.5 mm spacing reads 16.0 mm, and draws on the image", async () => {
    await ev(`document.querySelector('#wDicom [data-dv-tool="measure"]').click(); return 1;`);
    const a = await pagePoint(16, 10.5), z = await pagePoint(48, 10.5);
    const before = await pixelAt(32, 10);
    await drag(a, z);
    const ro = await readout(), after = await pixelAt(32, 10);
    return /Length 16\.0 mm/.test(ro) && after !== before || `ro=${ro} before=${before} after=${after}`;
  });
  await b.shot(SHOTS + "/viewer-measure.png");
  await step("a series in a transfer syntax the viewer cannot decode (JPEG 2000) says so, naming the syntax; nothing is drawn wrongly", async () => {
    await ev(`document.querySelector('#wDicom [data-dv-series="1"]').click(); return 1;`);
    const msg = await until(`var m=document.getElementById("wDvMsg"); return m && !m.hidden && /cannot decode/.test(m.innerText) ? m.innerText : null;`, 8000);
    return !!msg && msg.includes(J2K) && (await pixelAt(32, 32)) === 0 || "msg=" + (await message());
  });
  await step("every control is at least 44 px and has an accessible name", async () =>
    (await ev(`var bad=[].slice.call(document.querySelectorAll("#wDicom button")).filter(function(x){var r=x.getBoundingClientRect(); return r.width<44||r.height<44||!(x.getAttribute("aria-label")||x.innerText.trim());}).map(function(x){return x.outerHTML.slice(0,80)}); return bad.length ? bad.join(" ; ") : true;`)));
  await step("a ward repaint while the viewer is open leaves it open", async () => {
    await ev(`WARD._dispatch("radiologyload"); return 1;`);
    await b.sleep(600);
    return (await ev(`return !!document.getElementById("wDicom")`)) === true || "the layer was wiped";
  });
  await step("Close removes the layer; nothing was written to localStorage, and no Cache API cache exists", async () => {
    await ev(`document.querySelector('#wDicom [data-dv-act="close"]').click(); return 1;`);
    if (await ev(`return !!document.getElementById("wDicom")`)) return "still open";
    const after = await ev(`return JSON.stringify(Object.keys(localStorage).sort())`);
    const caches = await ev(`return window.caches ? caches.keys().then(function(k){return k.length}) : 0`);
    return after === localBefore && caches === 0 || `localStorage ${localBefore} -> ${after}; caches=${caches}`;
  });
  await step("Escape closes the viewer", async () => {
    await ev(`WARD._dispatch("dicomview:is1"); return 1;`);
    if (!(await until(`return /Image 1 of 5/.test((document.getElementById("wDvRo")||{}).innerText||"") ? true : null;`, 8000))) return "did not reopen";
    await key("Escape");
    return (await until(`return !document.getElementById("wDicom") || null;`, 3000)) === true || "still open";
  });
  await step("a caller not allowed to read the patient: no patient line, and the viewer says why", async () => {
    await ev(`WARD._dispatch("dicomview:is-hidden"); return 1;`);
    if (!(await until(`return /Image 1 of 5/.test((document.getElementById("wDvRo")||{}).innerText||"") ? true : null;`, 8000))) return "did not open";
    const hd = await ev(`return document.getElementById("wDvHd").innerText`), note = await ev(`var n=document.getElementById("wDvNote"); return n.hidden ? "" : n.innerText`);
    await ev(`document.querySelector('#wDicom [data-dv-act="close"]').click(); return 1;`);
    return !/Synthetic/.test(hd) && /Patient details are not shown/.test(note) || `hd=${hd} note=${note}`;
  });
  await step("no archive connected (409 no_archive): one plain sentence, no crash", async () => {
    await ev(`WARD._dispatch("dicomview:is-noarchive"); return 1;`);
    const msg = await until(`var m=document.getElementById("wDvMsg"); return m && /No imaging archive is connected/.test(m.innerText) ? m.innerText : null;`, 8000);
    await ev(`var c=document.querySelector('#wDicom [data-dv-act="close"]'); if (c) c.click(); return 1;`);
    return !!msg || "msg=" + (await message());
  });
  await step("Telugu: the viewer's toolbar and readout come from the catalog", async () => {
    const loaded = await ev(`return new Promise(function(res){ var s=document.createElement("script"); s.src="/wardsynq/site/i18n/te.js"; s.onload=function(){res(true)}; s.onerror=function(){res(false)}; document.head.appendChild(s); })`);
    if (!loaded) return "te.js did not load";
    await ev(`window.WSQ = window.WSQ || {}; WSQ.state = WSQ.state || {}; WSQ.state.navLang = "te"; WARD._dispatch("dicomview:is1"); return 1;`);
    const ok = await until(`var o=document.getElementById("wDicom"); return o && /ఇమేజ్ 1 \\/ 5/.test((document.getElementById("wDvRo")||{}).innerText||"") ? true : null;`, 8000);
    const label = await ev(`return document.querySelector('#wDicom [data-dv-act="close"]').getAttribute("aria-label")`);
    await ev(`document.querySelector('#wDicom [data-dv-act="close"]').click(); WSQ.state.navLang = "en"; return 1;`);
    return ok === true && label === "వ్యూయర్ మూసివేయండి" || `ok=${ok} label=${label} ro=${await readout()}`;
  });
  const errs = b.consoleLines.filter((l) => l.startsWith("EXC"));
  await step("no uncaught exception on the page", async () => errs.length === 0 || errs.join(" | "));
} finally {
  b.close(); server.close();
}
const failed = results.filter((r) => r[0] !== "PASS");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
