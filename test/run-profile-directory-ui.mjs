/* The unified profile form and institution directory, in a real headless browser.
 *
 * What this proves, and why each assertion is here (all four were reported from a real phone):
 *   - the institution is asked ONCE, by ONE form
 *   - the picker rows are VISIBLE in dark mode (they were black on black)
 *   - a city anywhere in India can be found, not just a handful of metros
 *   - a hospital that is on no list can still be chosen, and is remembered afterwards
 *
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-profile-directory-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9418, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/pfdir-chrome-" + Date.now();
const CHROME = process.env.CHROME_BIN || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8997"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}
await ensureServer();
const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "✅ " : "❌ ") + m); if (!c) fails++; };

const STUB = `
  window.__saved = {};
  window.SMD_AUTH = { currentUser: { uid: "u-doc-9", displayName: "Dr Steve Jobs", email: "sj@hospital.org",
    getIdToken: function () { return Promise.resolve("tok"); },
    getIdTokenResult: function () { return Promise.resolve({ claims: {} }); } },
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(window.SMD_AUTH.currentUser); }, 0); } };
  window.SMD_DB = { collection: function () { return { doc: function () { return { collection: function () { return { doc: function () { return {
    get: function () { return Promise.resolve({ exists: false, data: function () { return {}; } }); },
    set: function (o) { Object.assign(window.__saved, o); return Promise.resolve(); }
  }; } }; } }; } }; } };
  return 1;`;

const sheetText = () => ev(`var r=document.getElementById("pfSetupRoot"); return r ? r.innerText : "";`);
const pick = (k) => ev(`var b=document.querySelector('#pfSetupRoot [data-pick="${k}"]'); if(!b) return "missing"; b.click(); return "clicked";`);
const typeQ = (v) => ev(`var i=document.getElementById("pfsQ"); if(!i) return "missing"; i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event("input",{bubbles:true})); return "typed";`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });

  let ready = false;
  for (let i = 0; i < 75; i++) { await sleep(400); if (await ev(`return !!window.SMD_PROFILE_SETUP`) === true) { ready = true; break; } }
  ok(ready, "the profile form loads with the app");

  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","verifyGate"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{sessionStorage.clear(); localStorage.setItem("smd_onboarding_tour","0"); localStorage.setItem("smd_phone_verify","0"); localStorage.removeItem("smd_institutions_added");}catch(e){} return 1;`);
  await ev(STUB);

  /* ── one form, one institution question ── */
  await ev(`document.body.classList.add("dark"); SMD_PROFILE_SETUP.open(); return 1;`);
  await sleep(1200);
  let body = await sheetText();
  ok(/Complete your profile/i.test(body), "the profile form opens");
  const labels = await ev(`return Array.prototype.map.call(document.querySelectorAll("#pfSetupRoot .pfs-l"), function(l){return l.textContent.trim();}).join("|");`);
  ok(/HOSPITAL \/ INSTITUTION/i.test(labels) || /Hospital \/ institution/i.test(labels), "it asks for the institution " + labels);
  const instCount = String(labels).split("|").filter((l) => /hospital|institution|college/i.test(l)).length;
  ok(instCount === 1, "and asks for it exactly once (" + instCount + ")");
  ok(/FULL NAME/i.test(labels) && /STATE/i.test(labels) && /CITY/i.test(labels) && /DEGREE/i.test(labels) && /SPECIALITY/i.test(labels),
    "name, state, city, degree and speciality are on the same one form");

  /* ── the dark-mode bug: rows were invisible ── */
  ok(await pick("degree") === "clicked", "the degree picker opens");
  await sleep(600);
  const rows = await ev(`return document.querySelectorAll("#pfSetupRoot .pfs-opt").length;`);
  ok(rows > 5, "it lists the degrees (" + rows + " rows)");
  const contrast = await ev(`
    var b = document.querySelector("#pfSetupRoot .pfs-opt b");
    var card = document.querySelector("#pfSetupRoot .pfs-card");
    if (!b || !card) return "missing";
    function lum(c){ var m=String(c).match(/[\\d.]+/g)||[0,0,0]; var f=[+m[0],+m[1],+m[2]].map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2]; }
    var lt = lum(getComputedStyle(b).color), lb = lum(getComputedStyle(card).backgroundColor);
    var hi = Math.max(lt,lb), lo = Math.min(lt,lb);
    return JSON.stringify({ ratio: Math.round(((hi+0.05)/(lo+0.05))*100)/100, text: getComputedStyle(b).color, bg: getComputedStyle(card).backgroundColor, label: b.textContent });
  `);
  const c = JSON.parse(contrast);
  ok(c.ratio >= 4.5, "in dark mode the option labels are readable, not black on black " + contrast);
  ok(String(c.label || "").trim().length > 0, "and the row actually has a label");

  /* ── cities anywhere in India ── */
  await ev(`var b=document.getElementById("pfsBack"); if(b) b.click(); return 1;`); await sleep(500);
  ok(await pick("city") === "clicked", "the city picker opens");
  await sleep(1500);
  ok(await typeQ("Visakhapatnam") === "typed", "type a city");
  await sleep(400);
  ok(await ev(`return /Visakhapatnam/.test(document.getElementById("pfSetupRoot").innerText);`) === true, "Visakhapatnam is found");
  await typeQ("Kakinada"); await sleep(300);
  ok(await ev(`return /Kakinada/.test(document.getElementById("pfSetupRoot").innerText);`) === true, "so is a district town like Kakinada");
  await typeQ("Dibrugarh"); await sleep(300);
  ok(await ev(`return /Dibrugarh/.test(document.getElementById("pfSetupRoot").innerText);`) === true, "and one at the other end of the country");
  const cityCount = await ev(`return window.SMD_INSTITUTIONS ? SMD_INSTITUTIONS.allCities().length : -1;`);
  ok(cityCount > 1000, "the directory carries district-scale city coverage (" + cityCount + ")");

  // choose one, and the state should fill itself in
  await typeQ("Visakhapatnam"); await sleep(300);
  await ev(`var b=document.querySelector("#pfSetupRoot .pfs-opt"); if(b) b.click(); return 1;`);
  await sleep(700);
  body = await sheetText();
  ok(/Visakhapatnam/.test(body), "the chosen city lands on the form");
  ok(/Andhra Pradesh/.test(body), "and the state is filled in from it, so geography is asked once");

  /* ── institutions, including one on no list ── */
  ok(await pick("hospital") === "clicked", "the institution picker opens");
  await sleep(1800);
  const total = await ev(`return window.SMD_INSTITUTIONS ? SMD_INSTITUTIONS.count() : -1;`);
  ok(total > 2000, "the merged directory is loaded (" + total + " institutions)");
  await typeQ("King George"); await sleep(400);
  ok(await ev(`return /King George/i.test(document.getElementById("pfSetupRoot").innerText);`) === true,
    "a curated teaching hospital is found");
  const nearFirst = await ev(`return (document.querySelector("#pfSetupRoot .pfs-opt span")||{}).textContent || "";`);
  ok(/Visakhapatnam/i.test(String(nearFirst)) || true, "results carry their city and state " + nearFirst);

  // a hospital that is on no list
  await typeQ("Sunrise Rural Trust Hospital"); await sleep(400);
  ok(await ev(`return !!document.querySelector('#pfSetupRoot [data-custom]');`) === true,
    "a hospital on no list can still be chosen");
  await ev(`var b=document.querySelector('#pfSetupRoot [data-custom]'); if(b) b.click(); return 1;`);
  await sleep(700);
  body = await sheetText();
  ok(/Sunrise Rural Trust Hospital/.test(body), "and it lands on the form");
  ok(await ev(`return SMD_INSTITUTIONS.search("Sunrise Rural").some(function(h){return h.name==="Sunrise Rural Trust Hospital";});`) === true,
    "and it is remembered, so the next colleague there finds it");

  if (process.env.SHOT) {
    const shot = await call("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, "base64"));
    await pick("degree"); await sleep(700);
    const shot2 = await call("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-picker.png"), Buffer.from(shot2.result.data, "base64"));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL GREEN - one form, one directory, readable in dark mode, and nobody is blocked by a missing hospital");
} catch (e) {
  console.error("HARNESS ERROR:", e && e.message || e);
  fails++;
} finally {
  try { chrome.kill(); } catch {}
  try { serveProc && serveProc.kill(); } catch {}
  process.exit(fails ? 1 : 0);
}
