/* Privacy mode UI test (plan B2, privacy-mode.js), in real headless Chrome against the real index.html.
 * Verifies, with invented patients only (no real PHI):
 *   - the home header carries one "Privacy mode" toggle, aria-pressed false, mode off by default;
 *   - one tap turns it on: identifiers leave the rendered text (innerText) of the ICU board, the ICU patient
 *     banner, the OPD EMR header, the OPD queue (incl. the "waited N minutes" sentence) and the WardSynQ ward
 *     list, while clinical values (bed, age/sex, diagnosis, labs, meds) stay visible; the masks are drawn;
 *   - the DOM data is untouched (textContent still holds the real values) and @media print shows them;
 *   - identifier inputs draw as dots; a screen it cannot mask raises the "not masked" label;
 *   - the choice survives a reload in the same session; the kill switch removes the toggle and forces it off;
 *   - no uncaught JS error comes from the privacy code.
 * USAGE: node test/run-privacy-mode-ui.mjs   (CHROME=/path/to/chrome, BASE=http://localhost:8981/)
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8981/").replace(/\/?$/, "/");
const PORT = 9481;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/privacy-mode-ui-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8981"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-sandbox", "--disable-gpu", "--mute-audio", "--hide-scrollbars"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => {
  const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : null;
};
let fails = 0;
const ok = (c, m, got) => { console.log((c ? "PASS " : "FAIL ") + m + (c || got === undefined ? "" : "  [got: " + JSON.stringify(got) + "]")); if (!c) fails++; };

// Invented identifiers. None of these is a real person or a real hospital number.
const PT = { name: "Testa Fakepatient", mrn: "UHID99990001234" };
const OPD = { name: "Opdfake Personname", mrn: "MR99990005678", phone: "9000000001" };
const Q = { name: "Queuefake Personone" };
const WP = { name: "Wardfake Patientname", mrn: "MRN99990009012" };

async function fresh(url, prep) {
  await call("Page.navigate", { url });
  await sleep(500);
  await ev(`localStorage.clear(); sessionStorage.clear(); ${prep || ""} return 1;`);
  await call("Page.navigate", { url });
  await waitApp();
}
async function waitApp() {
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    if (await ev(`return !!(document.readyState === "complete" && window.SMD_PRIVACY_MODE && window.ICU && ICU.ingestPatient && window.OPDEMR && window.QUEUE && window.WARD && document.getElementById("homeV2"));`) === true) break;
  }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","disclaimerModal"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
}
// innerText of a subtree, the text a person (or a screen share) actually sees
const seen = (sel) => ev(`var el=document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText : null;`);
// textContent: what is in the DOM. Each "masked" check below first proves the identifier WAS rendered, so a
// renderer that silently dropped it cannot pass as masked.
const inDom = (sel) => ev(`var el=document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent : null;`);
const has = (s, w) => typeof s === "string" && s.indexOf(w) >= 0;

try {
  let ver, t = 0;
  while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params && m.params.exceptionDetails;
      errors.push((d && d.exception && d.exception.description) || (d && d.text) || "unknown");
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  /* ---------- 1. the toggle, default off ---------- */
  await fresh(BASE, `localStorage.setItem("smd_icu_groups","0");`);
  const btn = JSON.parse(await ev(`var b=document.querySelector("#homeV2 .smd-pv-btn"); return JSON.stringify(b ? {label:b.getAttribute("aria-label"), pressed:b.getAttribute("aria-pressed"), n:document.querySelectorAll(".smd-pv-btn").length, inHeader:!!b.closest(".rnav-head, .v3-header")} : null);`));
  ok(btn && btn.label === "Privacy mode" && btn.inHeader, "one toggle named \"Privacy mode\" sits in the home header", btn);
  ok(btn && btn.n === 1, "exactly one toggle", btn && btn.n);
  ok(btn && btn.pressed === "false", "aria-pressed is false by default", btn && btn.pressed);
  ok(await ev(`return document.documentElement.classList.contains("smd-privacy");`) === false, "mode is off by default");

  /* ---------- 2. ICU board: the name shows while off ---------- */
  await ev(`ICU.reset(); ICU.ingestPatient({name:${JSON.stringify(PT.name)}, mrn:${JSON.stringify(PT.mrn)}, age:61, sex:"M", bed:"7", diagnosis:"Septic shock"}); ICU.open(); return 1;`);
  await sleep(900);
  let board = await seen("#icuRoot");
  ok(has(board, PT.name), "privacy off: the ICU board shows the patient name");

  /* ---------- 3. one tap: identifiers leave the screen, clinical content stays ---------- */
  await ev(`document.querySelector("#homeV2 .smd-pv-btn").click(); return 1;`);
  await sleep(300);
  ok(await ev(`return document.querySelector("#homeV2 .smd-pv-btn").getAttribute("aria-pressed");`) === "true", "aria-pressed turns true");
  board = await seen("#icuRoot");
  ok(!has(board, "Testa") && !has(board, "Fakepatient"), "privacy on: the patient name is not in the ICU board's rendered text", board && board.slice(0, 160));
  ok(has(board, "Septic shock") && has(board, "61/M") && has(board, "Bed 7"), "the diagnosis, age/sex and bed stay visible on the board");
  const after = await ev(`var el=document.querySelector("#icuRoot [data-phi]"); return el ? getComputedStyle(el,"::after").content : null;`);
  ok(after === '"T. F."', "the board draws the initials in place of the name", after);

  await ev(`document.querySelector("#icuRoot .icu-v2-card").click(); return 1;`);
  await sleep(800);
  const banner = await seen(".icu-v2-banner-id");
  ok(banner != null && !has(banner, "Testa") && !has(banner, PT.mrn) && !has(banner, "99990001234"), "the ICU patient banner hides the name and the UHID", banner);
  ok(has(banner, "Septic shock") && has(banner, "61/M"), "the banner keeps the diagnosis and age/sex", banner);
  const tc = await ev(`return document.querySelector(".icu-v2-banner-id").textContent;`);
  ok(has(tc, PT.name) && has(tc, PT.mrn), "the DOM still holds the real name and UHID (data untouched, only drawn masked)");
  const idMask = await ev(`var els=document.querySelectorAll(".icu-v2-banner-meta [data-phi]"); return els.length ? getComputedStyle(els[0],"::after").content : null;`);
  ok(idMask === '"•••• 1234"', "the UHID is drawn as dots and its last 4", idMask);

  await call("Emulation.setEmulatedMedia", { media: "print" });
  const printed = await seen(".icu-v2-banner-id");
  await call("Emulation.setEmulatedMedia", { media: "" });
  ok(has(printed, PT.name), "@media print shows the real name (print and PDF are never masked)", printed);
  await ev(`ICU.close && ICU.close(); return 1;`);

  /* ---------- 4. OPD EMR header, OPD queue, ward list (the real renderers, the real CSS) ---------- */
  await ev(`var h=document.createElement("div"); h.id="pvHost"; h.style.cssText="position:relative;z-index:1"; document.body.appendChild(h);
    h.innerHTML = OPDEMR._render({ patient: { name: ${JSON.stringify(OPD.name)}, mrn: ${JSON.stringify(OPD.mrn)} }, phone: ${JSON.stringify(OPD.phone)},
      labs: [{ serviceName: "Serum creatinine 2.4 mg/dL", orderDate: "01-Aug-2026", department: "Biochemistry", status: "Reported", renderId: "R1", episodeId: "E1" }],
      radiology: [], medications: [{ drugText: "Ceftriaxone 1 g", route: "IV", dosage: "1 g", frequency: "BD", duration: "5 days", dateTime: "01-Aug-2026 10:00" }] });
    return 1;`);
  const emrDom = await inDom("#pvHost");
  ok(has(emrDom, OPD.name) && has(emrDom, OPD.mrn) && has(emrDom, OPD.phone), "OPD EMR header rendered the name, MR number and phone into the DOM");
  const emr = await seen("#pvHost");
  ok(!has(emr, "Opdfake") && !has(emr, OPD.mrn) && !has(emr, OPD.phone), "OPD EMR header: name, MR number and phone are not in the rendered text", emr && emr.slice(0, 200));
  ok(has(emr, "Ceftriaxone 1 g") && has(emr, "Serum creatinine"), "OPD EMR keeps the medicines and labs visible");

  await ev(`document.getElementById("pvHost").innerHTML = QUEUE._render({ session: { doctorName: "Dr Test", department: "General Medicine OPD", doctorStatus: "consulting" }, view: "dashboard", me: {},
      tickets: [{ id: "t1", name: ${JSON.stringify(Q.name)}, mrnLast4: "0001", status: "waiting", visitType: "new", token: "A12", registeredAt: Date.now() - 45 * 60000 }] }); return 1;`);
  const qDom = await inDom("#pvHost");
  ok((qDom.split(Q.name).length - 1) >= 2, "the queue rendered the name in its row and in the insight sentence", qDom && qDom.split(Q.name).length - 1);
  const queue = await seen("#pvHost");
  ok(has(queue, "has waited"), "the queue insight sentence rendered", queue && queue.slice(0, 120));
  ok(!has(queue, "Queuefake") && !has(queue, "Personone"), "OPD queue: the name is masked in the row and in the \"has waited\" sentence", queue && queue.slice(0, 300));
  ok(has(queue, "A12"), "the token number stays visible (not an identifier)");

  await ev(`var s = Object.assign({}, WARD._st, { loaded: true, view: "list", q: "", busy: false, err: "",
      patients: [{ patientId: "wsq-pat-fake1", encounterId: "wsq-enc-fake1", name: ${JSON.stringify(WP.name)}, mrn: ${JSON.stringify(WP.mrn)}, ward: "Medical A", bed: "12", class: "inpatient", admittedAt: Date.now() - 86400000 }] });
    document.getElementById("pvHost").innerHTML = WARD._render(s); return 1;`);
  const wDom = await inDom("#pvHost");
  ok(has(wDom, WP.name) && has(wDom, WP.mrn), "the ward list rendered the name and MRN into the DOM");
  const ward = await seen("#pvHost");
  ok(has(ward, "Medical A") || has(ward, "inpatient") || has(ward, "Inpatient"), "the ward list keeps the ward / class visible", ward && ward.slice(0, 200));
  ok(!has(ward, "Wardfake") && !has(ward, WP.mrn), "WardSynQ ward list: name and MRN are not in the rendered text", ward && ward.slice(0, 300));
  ok(await ev(`return !!document.querySelector("#pvHost #wQ[data-phi-input]");`) === true, "the ward search box (names, MRNs) is marked as an identifier input");

  /* ---------- 5. inputs draw as dots; an unmasked screen says so ---------- */
  await ev(`document.getElementById("pvHost").innerHTML = '<input id="pvIn" data-phi-input value="Inputfake Name">'; return 1;`);
  const sec = await ev(`return getComputedStyle(document.getElementById("pvIn")).webkitTextSecurity;`);
  ok(sec === "disc", "an identifier input draws as dots while on", sec);
  ok(await ev(`return document.getElementById("pvIn").value;`) === "Inputfake Name", "and its value is untouched");
  ok(await ev(`var t=document.getElementById("smdPrivacyTag"); return !t || getComputedStyle(t).display === "none";`) === true, "no warning label on a masked screen");
  await ev(`document.getElementById("pvHost").innerHTML = '<div data-phi-unmasked style="height:40px">uncovered screen</div>'; return 1;`);
  await sleep(1100);
  const tag = await ev(`var t=document.getElementById("smdPrivacyTag"); return t && getComputedStyle(t).display !== "none" ? t.innerText : null;`);
  ok(has(tag, "not masked"), "a screen it cannot mask raises the \"not masked\" label", tag);
  await ev(`document.getElementById("pvHost").innerHTML = ""; return 1;`);
  await sleep(1100);
  ok(await ev(`var t=document.getElementById("smdPrivacyTag"); return getComputedStyle(t).display === "none";`) === true, "the label goes once that screen closes");
  ok(await ev(`var f=document.getElementById("smdPrivacyFrame"); return !!f && getComputedStyle(f).display === "block" && getComputedStyle(f).pointerEvents === "none";`) === true,
    "the persistent frame is on screen and never takes a tap");

  /* ---------- 6. persists for the session; off again with one tap ---------- */
  await call("Page.navigate", { url: BASE }); await waitApp();
  ok(await ev(`return document.documentElement.classList.contains("smd-privacy") && document.querySelector("#homeV2 .smd-pv-btn").getAttribute("aria-pressed") === "true";`) === true,
    "after a reload in the same session it is still on");
  await ev(`document.querySelector("#homeV2 .smd-pv-btn").click(); return 1;`); await sleep(200);
  ok(await ev(`return !document.documentElement.classList.contains("smd-privacy") && sessionStorage.getItem("smd_privacy_mode") === null;`) === true, "one more tap turns it off");

  /* ---------- 7. kill switch ---------- */
  await fresh(BASE, `localStorage.setItem("smd_privacy_mode_enabled","0"); sessionStorage.setItem("smd_privacy_mode","1");`);
  ok(await ev(`return document.querySelectorAll(".smd-pv-btn").length;`) === 0, "kill switch: no toggle in the header");
  ok(await ev(`return document.documentElement.classList.contains("smd-privacy");`) === false, "kill switch: the mode is forced off even if the session had it on");

  const ours = errors.filter((x) => /privacy|SMD_PRIVACY_MODE|phi\(|phiWho|wrapIn|smd-pv/i.test(x));
  ok(ours.length === 0, "no uncaught JS error from the privacy code (" + (ours.length ? ours.join(" | ") : "none") + ")");
  if (errors.length) console.log("note: " + errors.length + " unrelated page error(s) were seen (not from privacy mode): " + errors.map((x) => String(x).split("\n").slice(0, 4).join(" / ")).join(" | "));
} catch (e) {
  console.log("HARNESS ERROR: " + (e && e.stack || e));
  fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
console.log(fails === 0 ? "ALL PASS" : fails + " FAILED");
process.exit(fails === 0 ? 0 : 1);
