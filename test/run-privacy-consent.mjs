/* StewardMD — Privacy consent gate (PR-A) regression.
 * Verifies: gate blocks until BOTH required boxes ticked; optional box independent;
 * consent persists and reads back as current; Privacy Notice link opens #privacyModal;
 * AI calls are guarded (trigger the gate when consent is missing).
 * USAGE: BASE=http://localhost:5173/ node test/run-privacy-consent.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
const BASE = (process.env.BASE || "http://localhost:5173/").replace(/\/?$/, "/");
const PORT = Number(process.env.CDP_PORT || 9601);
const CHROME = process.env.CHROME_BIN
  || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p))
  || "google-chrome";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${(process.env.CLAUDE_JOB_DIR || "/tmp")}/tmp/privacy-chrome`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
let id = 1; const pend = new Map(); let ws, sid;
const call = (m, p) => { const i = id++; return new Promise((r) => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId: sid })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return '__ERR__'+x.message}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fails++; };
try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }); sid = sessionId;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() }); await sleep(1500);
  await ev(`if(navigator.serviceWorker)navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));if(window.caches)caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)));return 1;`); await sleep(500);
  await call("Page.navigate", { url: BASE + "?cb=" + Date.now() + "r" });
  for (let i = 0; i < 90; i++) { await sleep(400); if (await ev(`return !!(window.SMD_PRIVACY&&window.SMD_CONSENT)`) === true) break; }

  chk("config single-sources versions (2026-07-05) + gate default ON",
    await ev(`return SMD_PRIVACY.privacyPolicyVersion==="2026-07-05" && SMD_PRIVACY.termsVersion==="2026-07-05" && SMD_PRIVACY.gateOn()===true`) === true);

  // clear any prior consent → gate is needed. Open it via ensure().
  await ev(`try{localStorage.removeItem("smd_consent_guest");}catch(e){} window.__ep = SMD_CONSENT.ensure(); return 1;`);
  await sleep(300);
  chk("gate opens when consent missing", await ev(`return !!document.getElementById("smdConsentBackdrop")`) === true);
  chk("no checkbox pre-selected", await ev(`return !document.getElementById("cgA").checked && !document.getElementById("cgB").checked && !document.getElementById("cgC").checked`) === true);
  chk("Continue disabled initially", await ev(`return document.getElementById("cgContinue").disabled===true`) === true);
  chk("Continue STILL disabled with only A", await ev(`var a=document.getElementById("cgA");a.checked=true;a.dispatchEvent(new Event("change",{bubbles:true}));return document.getElementById("cgContinue").disabled===true`) === true);
  chk("Continue ENABLED after A AND B (optional C not required)", await ev(`var b=document.getElementById("cgB");b.checked=true;b.dispatchEvent(new Event("change",{bubbles:true}));return document.getElementById("cgContinue").disabled===false`) === true);

  // opt into C, Continue → record persisted + gate closes + ensure() resolves true
  await ev(`var c=document.getElementById("cgC");c.checked=true;c.dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("cgContinue").click();return 1;`);
  await sleep(500);
  chk("gate closes after Continue", await ev(`return !document.getElementById("smdConsentBackdrop")`) === true);
  chk("ensure() resolved true", await ev(`return (await window.__ep)===true`) === true);
  const rec = await ev(`return JSON.stringify(await SMD_CONSENT.get())`);
  const r = JSON.parse(rec || "null");
  chk("consent record persisted with required timestamps + version", !!(r && r.consentAcceptedAt && r.clinicalAuthorityConfirmedAt && r.privacyPolicyVersion === "2026-07-05" && r.termsVersion === "2026-07-05"), r && r.privacyPolicyVersion);
  chk("optional improvement consent captured (C ticked)", !!(r && r.optionalImprovementConsent === true && r.optionalImprovementConsentAt));
  chk("record now reads as current", await ev(`return SMD_CONSENT.isCurrent(await SMD_CONSENT.get())===true`) === true);

  // withdraw optional consent → updates immediately
  await ev(`await SMD_CONSENT.setOptional(false); return 1;`);
  chk("withdrawing optional consent updates immediately", await ev(`var r=await SMD_CONSENT.get(); return r.optionalImprovementConsent===false && r.optionalImprovementConsentAt===null`) === true);

  // Privacy Notice link opens #privacyModal (upgraded content)
  await ev(`try{localStorage.removeItem("smd_consent_guest");}catch(e){} window.__ep2=SMD_CONSENT.ensure(); return 1;`); await sleep(200);
  await ev(`document.getElementById("cgPrivacyLink").click(); return 1;`); await sleep(200);
  chk("Privacy Notice link reveals #privacyModal", await ev(`var m=document.getElementById("privacyModal");return m && !m.classList.contains("hidden")`) === true);
  // Notice content verified against the CURRENT (Version 2.0) modal shipped on main — it is accurate:
  // anti-training claim present, providers + data-subject rights listed, and no false "not transmitted"
  // claim. (Does NOT assert a "7-day" deletion window: that lifecycle is PR-C and not built yet.)
  chk("Privacy Notice content is accurate (no false 'not transmitted' claim; lists providers + rights)",
    await ev(`var t=document.getElementById("privacyModal").innerText; return /not.*train/i.test(t) && /(Vertex|Firebase|Cloudflare)/i.test(t) && /(erasure|withdraw consent|access, correction)/i.test(t) && !/not transmitted to any server/i.test(t)`) === true);
  await ev(`if(window.closeModal)closeModal(); document.getElementById("cgCancel").click(); return 1;`); await sleep(150);

  // AI guard: with consent missing, an AI call triggers the gate (defense in depth)
  await ev(`try{localStorage.removeItem("smd_consent_guest");}catch(e){} return 1;`);
  chk("SMD_AI is privacy-guarded", await ev(`return !!(window.SMD_AI && SMD_AI.__privacyGuarded)`) === true);
  await ev(`window.__ai = (window.SMD_AI&&SMD_AI.research)?SMD_AI.research("test").catch(function(){return "rejected";}):null; return 1;`); await sleep(300);
  chk("AI call opens the consent gate when consent missing", await ev(`return !!document.getElementById("smdConsentBackdrop")`) === true);

  console.log(`\n${fails ? "❌ " + fails + " FAILED" : "✅ ALL GREEN — privacy consent gate (PR-A)"}`);
} finally { try { ws && ws.close(); } catch {} chrome.kill(); }
process.exitCode = fails ? 1 : 0;
