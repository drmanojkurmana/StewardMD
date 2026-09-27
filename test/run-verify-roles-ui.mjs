/* Verification roles in a real headless browser (audit 2026-09-26, findings 3 and 4).
 *
 *  1. The chooser offers FOUR roles: Medical student, Intern, PG Resident, Doctor (practising), all
 *     on screen at phone width. PG Resident takes the registration path (reg-no row shown), Intern
 *     and student the ID-review path (reg-no row hidden).
 *  2. A reviewed trainee (server status trainee_verified) sees their own verified state, and the
 *     chooser only offers the roles that can upgrade them.
 *  3. The Rx pad REFUSES a trainee in a plain sentence, and canPrescribe() is false.
 *  4. Control: a registered doctor (verified claim) is not refused.
 *
 * Firebase auth and /api/verify-doctor are stubbed in the page; no network, no real account.
 * USAGE: CHROME=/path/to/chrome CHROME_FLAGS=--no-sandbox node test/run-verify-roles-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8962/").replace(/\/?$/, "/");
const PORT = 9362, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/verify-roles-chrome-" + Date.now();
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8962"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

// Stub a signed-in Firebase user with the given claims, and GET /api/verify-doctor with `status`.
const stubUser = (claims, status) => `
  var CL = ${JSON.stringify(claims)}, ST = ${JSON.stringify(status)};
  var user = { uid: "t1", email: "t1@example.in", displayName: "T One",
    getIdToken: function () { return Promise.resolve("tok"); },
    getIdTokenResult: function () { return Promise.resolve({ claims: CL, token: "tok", expirationTime: new Date(Date.now() + 3e6).toUTCString() }); } };
  window.SMD_AUTH = { currentUser: user, onAuthStateChanged: function () { return function () {}; }, signOut: function () { return Promise.resolve(); } };
  var _f = window.__origFetch || window.fetch; window.__origFetch = _f;
  window.fetch = function (u, o) {
    if (String(u).indexOf("/api/verify-doctor") === 0) return Promise.resolve(new Response(JSON.stringify(ST), { status: 200, headers: { "Content-Type": "application/json" } }));
    return _f.apply(this, arguments);
  };
  return 1;`;

async function boot() {
  await call("Page.navigate", { url: BASE });
  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!(window.SMD_VERIFY && window.SMD_RX && document.getElementById("verifyGate"))`) === true) { ready = true; break; } }
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`);
  return ready;
}

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  ok(await boot(), "app loads with the verification gate and the prescription module");

  // ---- 1. the chooser ----------------------------------------------------------------------------
  await ev(stubUser({}, { status: "unverified" }));
  await ev(`SMD_VERIFY.openPanel(); return 1;`); await sleep(900);
  const ch = JSON.parse(await ev(`
    var host = document.getElementById("verifyRoles");
    var bs = [].slice.call(host.querySelectorAll("[data-role]"));
    return JSON.stringify({ n: bs.length,
      roles: bs.map(function (b) { return b.getAttribute("data-role"); }),
      labels: bs.map(function (b) { return (b.textContent || "").trim(); }),
      shown: bs.map(function (b) { var r = b.getBoundingClientRect(); return r.width > 0 && r.height >= 40 && r.left >= 0 && r.right <= innerWidth; }),
      on: (host.querySelector(".is-on") || {}).getAttribute ? host.querySelector(".is-on").getAttribute("data-role") : null,
      gate: getComputedStyle(document.getElementById("verifyGate")).display });`));
  ok(ch.gate !== "none", "the verification panel is open");
  ok(ch.n === 4, "the chooser offers four roles (" + ch.n + ")");
  ok(ch.labels.join("|") === "Medical student|Intern|PG Resident|Doctor (practising)", "labels: " + JSON.stringify(ch.labels));
  ok(ch.roles.join(",") === "student,intern,resident,doctor", "roles: " + JSON.stringify(ch.roles));
  ok(ch.shown.every(Boolean), "all four are on screen at 390px and a real tap target " + JSON.stringify(ch.shown));
  ok(ch.on === "doctor", "Doctor is the default selection (" + ch.on + ")");

  const pick = async (r) => { await ev(`document.querySelector('#verifyRoles [data-role="${r}"]').click(); return 1;`); await sleep(200);
    return JSON.parse(await ev(`var rr=document.getElementById("verifyRegRow"); return JSON.stringify({ reg: !!rr && getComputedStyle(rr).display !== "none",
      sub: (document.getElementById("verifySubtitle")||{}).textContent || "", btn: (document.getElementById("verifySubmit")||{}).textContent || "" });`)); };
  const res = await pick("resident");
  ok(res.reg, "PG Resident shows the registration-number row (same NMC/SMC path as Doctor)");
  ok(/full medical registration/i.test(res.sub) && /State Medical Council/.test(res.sub), "PG Resident copy: full registration, register check");
  const intern = await pick("intern");
  ok(!intern.reg, "Intern hides the registration-number row (ID review path)");
  ok(/provisional registration/i.test(intern.sub) && /stays locked/i.test(intern.sub), "Intern copy says the prescription generator stays locked");
  const stu = await pick("student");
  ok(!stu.reg && /Submit for review|Choose ID/.test(stu.btn), "Student goes to review (" + stu.btn + ")");
  ok(![res.sub, intern.sub, stu.sub].some((x) => x.indexOf("—") >= 0), "no em-dash in the chooser copy");
  // the submit carries the chosen role
  await ev(`window.__vbody=null; var _g=window.fetch; window.fetch=function(u,o){ if(String(u).indexOf("/api/verify-doctor")===0 && o && o.method==="POST"){ window.__vbody=JSON.parse(o.body); return Promise.resolve(new Response(JSON.stringify({status:"pending_review",provisionalDays:7}),{status:200})); } return _g.apply(this,arguments); };
    document.querySelector('#verifyRoles [data-role="resident"]').click();
    var inp=document.getElementById("verifyFile"); var dt=new DataTransfer(); dt.items.add(new File([new Uint8Array([1,2,3])],"cert.jpg",{type:"image/jpeg"})); inp.files=dt.files; inp.dispatchEvent(new Event("change"));
    document.getElementById("verifySubmit").click(); return 1;`);
  await sleep(900);
  ok(await ev(`return window.__vbody && window.__vbody.role;`) === "resident", "the upload is sent with role: resident");
  await ev(`try{document.getElementById("verifyGate").style.display="none";}catch(e){} return 1;`);

  // ---- 2. a reviewed trainee's own panel --------------------------------------------------------------
  await ev(stubUser({ traineeVerified: true, verifiedAt: Date.now() }, { status: "trainee_verified", role: "student", canPrescribe: false, regNo: "" }));
  await ev(`SMD_VERIFY.openPanel(); return 1;`); await sleep(900);
  const tp = JSON.parse(await ev(`
    var host = document.getElementById("verifyRoles");
    var vis = [].slice.call(host.querySelectorAll("[data-role]")).filter(function (b) { return b.style.display !== "none"; }).map(function (b) { return b.getAttribute("data-role"); });
    return JSON.stringify({ title: document.getElementById("verifyTitle").textContent, badge: document.getElementById("verifyBadge").textContent.trim(),
      sub: document.getElementById("verifySubtitle").textContent, vis: vis, on: host.querySelector(".is-on").getAttribute("data-role") });`));
  ok(tp.title === "Your student account is verified", "trainee title: " + tp.title);
  ok(tp.badge === "Verified student", "trainee badge: " + tp.badge);
  ok(/stays locked/.test(tp.sub) && tp.sub.indexOf("—") < 0, "trainee copy explains the locked prescription pad, no em-dash");
  ok(tp.vis.join(",") === "resident,doctor" && tp.on === "resident", "a trainee is offered only the upgrade roles " + JSON.stringify(tp));
  await ev(`try{document.getElementById("verifyGate").style.display="none";}catch(e){} return 1;`);

  // ---- 3. the Rx pad refuses a trainee ------------------------------------------------------------------
  const st = JSON.parse(await ev(`window.__st=null; Promise.all([SMD_VERIFY.isVerified(true), SMD_VERIFY.isTrainee(true)]).then(function(a){ window.__st=a; }); return "1";`) || "1");
  await sleep(500);
  ok(JSON.stringify(await ev(`return window.__st;`)) === "[false,true]", "SMD_VERIFY: isVerified false, isTrainee true for a trainee");
  await ev(`SMD_RX.open({ topic: "Test", regimen: [] }); return 1;`); await sleep(1200);
  const rx = JSON.parse(await ev(`var m=document.getElementById("rxTraineeMsg"); return JSON.stringify({ msg: m ? m.textContent : "", can: SMD_RX.canPrescribe(), docVerify: /Doctor Verification/.test(document.body.innerText) });`));
  ok(/^Medical students cannot create prescriptions/.test(rx.msg), "the Rx pad refuses in a plain sentence: " + JSON.stringify(rx.msg.slice(0, 80)));
  ok(rx.msg.indexOf("—") < 0, "no em-dash in the refusal");
  ok(rx.can === false, "SMD_RX.canPrescribe() is false for a trainee");
  const vi = await ev(`window.__vi=null; SMD_RX.verifiedInfo().then(function(v){window.__vi=v;}); return 1;`); await sleep(400);
  const info = await ev(`return JSON.stringify(window.__vi);`);
  ok(/"verified":false/.test(info) && /"trainee":true/.test(info), "verifiedInfo reports trainee, not verified " + info);

  // ---- 4. control: a registered doctor is not refused ----------------------------------------------------
  ok(await boot(), "reload for the doctor control");
  await ev(stubUser({ verified: true, verifiedAt: Date.now(), regNo: "112487" }, { status: "verified", role: "doctor", canPrescribe: true, regNo: "112487" }));
  await ev(`SMD_RX.open({ topic: "Test", regimen: [] }); return 1;`); await sleep(1500);
  const dr = JSON.parse(await ev(`return JSON.stringify({ trainee: !!document.getElementById("rxTraineeMsg"), docVerify: /Only verified doctors can create prescriptions/.test(document.body.innerText), can: SMD_RX.canPrescribe() });`));
  ok(!dr.trainee && !dr.docVerify, "a verified doctor gets the pad, not a refusal " + JSON.stringify(dr));
  ok(dr.can === true, "SMD_RX.canPrescribe() is true for a verified doctor");
} catch (e) {
  console.log("❌ harness error:", e && e.message || e); fails++;
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill("SIGKILL"); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
}
console.log(fails ? `\n❌ ${fails} FAILED` : "\n✅ ALL GREEN");
process.exit(fails ? 1 : 0);
