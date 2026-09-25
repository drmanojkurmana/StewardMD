/* SCRATCH (not committed): NFC walk-in / follow-up / empty-tag browser verification.
 * Real headless Chrome + CDP against the REAL smd-nfc.js + patient-register.js.
 *   node /tmp/run-nfc-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";

const ROOT = "/Users/diwakarkumar/Developer/StewardMD/.claude/worktrees/whatsapp-bugs-atoz";
const PORT = 8817, DBG = 9417;
const userDir = "/tmp/nfc-ui-chrome";
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serveProc = spawn("node", [ROOT + "/test/serve.mjs", ROOT, String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "--mute-audio", "--window-size=430,900"], { stdio: "ignore" });

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise(r => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (expr, want, tries = 40) => {
  for (let i = 0; i < tries; i++) { await sleep(120); const v = await ev(expr); if (v === want) return true; }
  return false;
};

const NFC_SRC = readFileSync(ROOT + "/smd-nfc.js", "utf8");
const REG_SRC = readFileSync(ROOT + "/patient-register.js", "utf8");
const putSrc = async (name, src) => {
  const b64 = Buffer.from(src, "utf8").toString("base64");
  await ev(`var s=document.createElement("script");s.textContent=atob("${b64}");document.head.appendChild(s);window.__loaded_${name}=true;return 1;`);
};

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.navigate", { url: "about:blank" });
  await sleep(400);

  // ---- A. real smd-nfc.js: empty-tag sheet + UHID routing ----
  await putSrc("nfc", NFC_SRC);
  ok(await ev(`return window.__loaded_nfc === true && typeof window.SMD_NFC.initAppListener;`) === "function", "real smd-nfc.js loaded with initAppListener");
  await ev(`
    window.__uhids = []; window.__written = [];
    window.Capacitor = { Plugins: { NfcPlugin: {
      isAvailable: function(){ return Promise.resolve({available:true, enabled:true}); },
      startScan: function(){ return Promise.resolve({status:"listening"}); },
      stopScan: function(){ return Promise.resolve({status:"stopped"}); },
      openSettings: function(){ return Promise.resolve({}); },
      writeTag: function(o){ window.__written.push(o); return Promise.resolve({success:true, uid:"04AA"}); },
      addListener: function(evt, cb){ if(evt==="tagDiscovered") window.__emitTag = cb; return Promise.resolve({remove:function(){}}); }
    }}};
    window.__booted = false;
    window.SMD_NFC.initAppListener({
      onUhid: function(u){ window.__uhids.push(u); },
      currentPatient: { name: "Asha Kumar", uhid: "SMD-Q-1" },
      patients: [{ name: "Ravi Rao", uhid: "SMD-Q-2" }]
    }).then(function(){ window.__booted = true; });
    return 1;`);
  ok(await waitFor(`return window.__booted;`, true), "initAppListener boots against the native mock");
  await ev(`window.__emitTag({uid:"04B2", formattedUid:"04:B2", text:"", url:""}); return 1;`);
  ok(await waitFor(`return !!document.getElementById("smdNfcEmpty");`, true), "blank tag opens the empty-tag sheet");
  ok(await ev(`return document.getElementById("smdNfcEmpty").textContent;`).then(t => t.includes("NFC Tag Detected (Empty / Blank)") && t.includes("Tag Serial: 04:B2") && t.includes("This physical file tag is empty. Would you like to write a patient UHID to it?")), "sheet shows title, serial and prompt");
  ok(await ev(`var b=document.querySelector('#smdNfcEmpty [data-nfc-pick="SMD-Q-1"]'); return b ? b.textContent : null;`) === "Write Current Patient (Asha Kumar · SMD-Q-1)", "option 1 writes the current patient");
  ok(await ev(`var b=document.querySelector('#smdNfcEmpty [data-nfc-pick="SMD-Q-2"]'); return b ? b.textContent : null;`) === "Ravi Rao · SMD-Q-2", "option 2 quick-picks today's patients");
  ok(await ev(`return !!document.getElementById("smdNfcUhid") && !!document.getElementById("smdNfcWrite");`) === true, "option 3 has UHID input + Write to Tag");
  await ev(`document.querySelector('#smdNfcEmpty [data-nfc-pick="SMD-Q-1"]').click(); return 1;`);
  ok(await waitFor(`return window.__written.length;`, 1), "tapping the current patient writes the tag");
  ok(await ev(`return JSON.stringify(window.__written[0]);`) === JSON.stringify({ text: "SMD-Q-1", url: "https://stewardmd.in/opd?uid=SMD-Q-1" }), "write payload is text + /opd deep link");
  ok(await waitFor(`return document.getElementById("smdNfcStatus").textContent;`, "\u2713 NFC Tag Written!"), "status narrates success");
  // typed-UHID flow
  await ev(`document.getElementById("smdNfcCancel").click(); return 1;`);
  await ev(`window.__emitTag({uid:"04C3", formattedUid:"04C3", text:"", url:""}); return 1;`);
  ok(await waitFor(`return !!document.getElementById("smdNfcEmpty");`, true), "second blank tag reopens the sheet (single instance)");
  await ev(`document.getElementById("smdNfcUhid").value = "SMD-TYPED-5"; document.getElementById("smdNfcWrite").click(); return 1;`);
  ok(await waitFor(`return window.__written.length;`, 2), "typed UHID writes on Write to Tag");
  ok(await ev(`return window.__written[1].text;`) === "SMD-TYPED-5", "typed value is the payload");
  await ev(`document.getElementById("smdNfcCancel").click(); return 1;`);
  // UHID tag routes to onUhid, no sheet
  await ev(`window.__emitTag({uid:"04D4", text:"SMD-F-9", url:"https://stewardmd.in/opd?uid=SMD-F-9"}); return 1;`);
  ok(await waitFor(`return window.__uhids.join(",");`, "SMD-F-9"), "UHID tag routes to onUhid");
  ok(await ev(`return !!document.getElementById("smdNfcEmpty");`) === false, "no sheet for a UHID tag");

  // ---- B. real patient-register.js: done card NFC write end to end ----
  await putSrc("reg", REG_SRC);
  await ev(`
    window.__labelled = null;
    window.openFileLabel = function(mrn){ window.__labelled = mrn; };
    window.SMD_PATIENTREG.open({ mode: "native", submit: function(){ return Promise.resolve({ ok: true, mrn: "SMD-W-3" }); } });
    return 1;`);
  await ev(`document.getElementById("pr_name").value = "Walkin Test"; return 1;`);
  await ev(`document.querySelector('[data-seg="gender"] .pr-segb[data-v="male"]').click(); return 1;`);
  await ev(`document.getElementById("pr_ageYears").value = "40"; document.getElementById("pr_mobile").value = "9876543210"; return 1;`);
  await ev(`document.querySelector('[data-a="save"]').click(); return 1;`);
  ok(await waitFor(`return !!document.getElementById("prWriteNfc");`, true), "done card carries the Write NFC Tag button");
  ok(await ev(`return !!document.querySelector('[data-a="print-label"]');`) === true, "done card carries File Label where openFileLabel exists");
  await ev(`document.getElementById("prWriteNfc").click(); return 1;`);
  ok(await waitFor(`return document.getElementById("prWriteNfc").textContent;`, "\u2713 NFC Tag Written!"), "tap writes the new UHID to the tag");
  ok(await ev(`return JSON.stringify(window.__written[window.__written.length-1]);`) === JSON.stringify({ text: "SMD-W-3", url: "https://stewardmd.in/opd?uid=SMD-W-3" }), "register write payload is the new MRN + deep link");
  await ev(`document.querySelector('[data-a="print-label"]').click(); return 1;`);
  ok(await ev(`return window.__labelled;`) === "SMD-W-3", "File Label opens for the new MRN");
  // failure path: a rejected write says so and stays retryable
  await ev(`window.Capacitor.Plugins.NfcPlugin.writeTag = function(){ return Promise.reject(new Error("tap failed")); }; document.getElementById("prWriteNfc").click(); return 1;`);
  ok(await waitFor(`return document.getElementById("prWriteNfc").textContent;`, "Could not write the tag. Try again."), "a failed write says so");
  ok(await ev(`return document.getElementById("prWriteNfc").disabled;`) === false, "the button stays retryable after failure");
  await ev(`window.Capacitor.Plugins.NfcPlugin.writeTag = function(o){ window.__written.push(o); return Promise.resolve({success:true}); }; return 1;`);

  // ---- C. opd.html loads clean with the new code ----
  const errors = [];
  const onMsg = (e) => { try { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception.description || "").slice(0, 300)); } catch {} };
  ws.addEventListener("message", onMsg);
  await call("Page.navigate", { url: BASE + "opd.html" });
  await sleep(3500);
  ok(errors.length === 0, "opd.html loads with no page exceptions" + (errors.length ? (" — " + errors.join(" | ")) : ""));
  ok(await ev(`return typeof window.openFileLabel;`) === "function", "console exposes openFileLabel for the shared sheet");

  console.log(fails === 0 ? "ALL NFC UI CHECKS PASSED" : fails + " FAILURES");
} finally {
  try { ws && ws.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { serveProc.kill(); } catch {}
  process.exit(fails === 0 ? 0 : 1);
}
