/* test/wardsynq-site-cdp.mjs - one real headless Chrome for the wardsynq.com journeys.
 *
 * Hand-rolled CDP over WebSocket, the same shape test/run-live-smoke.mjs uses, exported once so
 * run-wardsynq-com-journey.mjs (deployed) and any local variant share it. No dependency added.
 *
 *   const b = await launch({ port, headers });   // headers: extra HTTP headers on every request
 *   await b.nav(url); await b.ev("return document.title"); await b.until(expr, ms); b.close()
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launch(opts) {
  opts = opts || {};
  const port = Number(opts.port || 9470);
  const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/wsq-site-chrome-" + port;
  // A fresh profile every launch: a session left in localStorage by the previous run must never
  // let a journey skip its own sign-in step.
  try { const { rmSync } = await import("node:fs"); rmSync(userDir, { recursive: true, force: true }); } catch {}
  const chrome = spawn(CHROME, [...(process.env.CHROME_FLAGS || "").split(" ").filter(Boolean), "--headless=new", `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--mute-audio", `--window-size=${opts.width || 1200},${opts.height || 900}`], { stdio: "ignore" });
  let msgId = 1; const pending = new Map(); let ws, sessionId;
  const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
  let ver, t = 0;
  while (t++ < 80) { try { ver = await (await fetch(`http://localhost:${port}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) { try { chrome.kill("SIGKILL"); } catch {} throw new Error("Chrome devtools endpoint never came up"); }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const consoleLines = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") consoleLines.push("EXC " + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) consoleLines.push(m.params.type.toUpperCase() + " " + m.params.args.map((a) => a.value || a.description || "").join(" "));
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("Network.enable", {});
  await call("Network.setCacheDisabled", { cacheDisabled: true });
  if (opts.headers) await call("Network.setExtraHTTPHeaders", { headers: opts.headers });
  if (opts.mobile) await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const ev = async (expr) => {
    const r = await call("Runtime.evaluate", { expression: `(async function(){try{${expr}}catch(x){return '__ERR__'+(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return "__ERR__" + (r.result.exceptionDetails.text || "exception");
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const until = async (expr, ms, every) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) { const v = await ev(expr); if (v && !String(v).startsWith("__ERR__")) return v; await sleep(every || 250); }
    return null;
  };
  const nav = async (url) => { await call("Page.navigate", { url }); await sleep(300); };
  const shot = async (path) => { const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result && r.result.data) { const { writeFileSync } = await import("node:fs"); writeFileSync(path, Buffer.from(r.result.data, "base64")); } };
  const type = async (id, text) => { await ev(`var i=document.getElementById(${JSON.stringify(id)}); if(!i) return 'no #'+${JSON.stringify(id)}; i.focus(); i.value=${JSON.stringify(text)}; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;`); };
  const click = async (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return 'no '+${JSON.stringify(sel)}; b.click(); return 1;`);
  const close = () => { try { ws.close(); } catch {} try { chrome.kill("SIGKILL"); } catch {} };
  return { call, ev, until, nav, shot, type, click, close, consoleLines, sleep };
}
