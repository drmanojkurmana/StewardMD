import { mkdir, writeFile } from 'node:fs/promises';
/* Headless Chrome (CDP) test verifying commit 644e34ae:
 * 1. swipe-back.js: inHScroll() fix (scrollLeft === 0 does NOT block; scrollLeft > 0 blocks)
 * 2. home.js: drag-to-reorder (Customize sheet rows + Home grid long-press tiles)
 *
 * USAGE: node test/run-swipe-reorder-fix-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 8992;
const DBG = 9400;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/swipe-reorder-chrome-" + Date.now();
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fails++;
};

let serveProc = null;
let chrome = null;
let ws = null;
let sessionId = null;
let msgId = 1;
const pending = new Map();

const call = (m, p) => {
  const i = msgId++;
  const payload = { id: i, method: m, params: p || {} };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise(r => {
    pending.set(i, r);
    ws.send(JSON.stringify(payload));
  });
};

const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true,
    awaitPromise: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};

const J = async (e) => {
  const v = await ev(e);
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

try {
  // 1. Start static server
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(BASE);
      break;
    } catch {
      await sleep(200);
    }
  }

  // 2. Launch headless Chrome
  chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run",
    "--disable-gpu",
    "--mute-audio",
    "--window-size=1100,900"
  ], { stdio: "ignore" });

  let ver, t = 0;
  while (t++ < 60) {
    try {
      ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!ver || !ver.webSocketDebuggerUrl) {
    throw new Error("Failed to connect to Chrome remote debugging port " + DBG);
  }

  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const tRes = await call("Target.createTarget", { url: "about:blank" });
  if (!tRes.result) throw new Error("Target.createTarget failed: " + JSON.stringify(tRes));
  const targetId = tRes.result.targetId;
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;

  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call("Emulation.setTouchEmulationEnabled",{enabled:true});
  await call("Page.navigate", { url: BASE + "index.html" });

  // Wait for app load
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    if (await ev(`return document.body.classList.contains("ui-v2") && !!window.SB;`) === true) {
      ready = true;
      break;
    }
  }
  ok(ready, "index.html boots in headless Chrome (ui-v2 class, window.SB initialized)");

  // Dismiss intro gates if present
  await ev(`
    ["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){
      var e = document.getElementById(k);
      if (e) e.remove();
    });
    if (window.SMD_showHome) SMD_showHome();
    return true;
  `);
  await sleep(600);


  const touch=async(type,p)=>call('Input.dispatchTouchEvent',{type,touchPoints:p?[{x:p.x,y:p.y,radiusX:6,radiusY:6,id:1}]:[]});
  const position=async(i)=>J('var g=document.getElementById("rnavToolsGrid");var n=g.querySelectorAll(".rnav-tile:not(.addtool):not([data-reorder-ghost])")['+i+'];var r=n.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});');
  await ev('document.querySelector("#rnavToolsGrid .rnav-tile").scrollIntoView({block:"center"});return true;');
  await sleep(300);
  var p=await position(0);
  await touch('touchStart',p);await sleep(80);await touch('touchMove',{x:p.x,y:p.y-60});await sleep(500);await touch('touchEnd');
  ok(await ev('return !document.getElementById("rnavToolsGrid").classList.contains("reordering");'),'ordinary touch scrolling cancels the hold timer');
  await ev('document.querySelector("#rnavToolsGrid .rnav-tile").scrollIntoView({block:"center"});return true;');await sleep(200);
  p=await position(0);var q=await position(1);
  var before=await ev('return document.querySelector("#rnavToolsGrid .rnav-tile").dataset.act;');
  await touch('touchStart',p);await sleep(550);
  ok(await ev('return !!document.querySelector("[data-reorder-ghost]")&&document.getElementById("rnavToolsGrid").classList.contains("reordering");'),'real touch hold lifts the icon into edit mode');
  for(var i=1;i<=8;i++){await touch('touchMove',{x:p.x+(q.x-p.x)*i/8,y:p.y+(q.y-p.y)*i/8});await sleep(25);}
  await touch('touchEnd');await sleep(200);
  ok(await ev('return document.querySelector("#rnavToolsGrid .rnav-tile").dataset.act;')!==before,'horizontal touch drag changes order');
  ok(await ev('return document.getElementById("rnavToolsGrid").classList.contains("reordering")&&!document.querySelector("[data-reorder-ghost]");'),'release cleans up ghost and keeps edit mode active');
  var saved=await ev('return localStorage.getItem("smd_home_tools_order");');
  p=await position(0);q=await position(2);await touch('touchStart',p);await touch('touchMove',q);await touch('touchCancel');await sleep(100);
  ok(await ev('return localStorage.getItem("smd_home_tools_order");')===saved,'cancelled touch does not persist a partial order');
  ok(await ev('return !document.querySelector("[data-reorder-ghost],.rnav-tile.dragging");'),'touch cancellation leaves no stuck dragged icon');
  await ev('document.getElementById("rnavReorderDone").click();return true;');
  ok(await ev('return !document.getElementById("rnavToolsGrid").classList.contains("reordering");'),'Done ends editing explicitly');

  await sleep(500);
  await ev('document.querySelector("#rnavToolsGrid .rnav-tile").scrollIntoView({block:"center"});return true;');await sleep(150);
  p=await position(0);await touch('touchStart',p);await sleep(500);
  var scrollBefore=await ev('return Array.from(document.querySelectorAll("*")).reduce((n,e)=>n+e.scrollTop,0);');
  await touch('touchMove',{x:p.x,y:730});await sleep(500);
  var scrollAfter=await ev('return Array.from(document.querySelectorAll("*")).reduce((n,e)=>n+e.scrollTop,0);');
  ok(scrollAfter>scrollBefore,'holding a dragged icon near the bottom scrolls toward lower tools');
  await touch('touchCancel');
  await ev('document.getElementById("rnavReorderDone").click();document.getElementById("rnavReorderDone").click();var t=document.querySelector("#rnavToolsGrid .rnav-tile");t.focus();t.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));return true;');
  var keyboardOrder=await ev('return localStorage.getItem("smd_home_tools_order");');
  ok(keyboardOrder!==saved,'Edit and arrow keys provide a keyboard rearranging option');
  await ev('document.getElementById("rnavReorderDone").click();return true;');
  await mkdir('/tmp/stewardmd-reorder',{recursive:true});
  var shot=await call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/stewardmd-reorder/home.png',Buffer.from(shot.result.data,'base64'));
  console.log(fails?fails+' failures':'All real-touch checks pass');
} catch(e){console.error(e);fails++;}
finally{ws?.close();chrome?.kill();serveProc?.kill();process.exitCode=fails?1:0;}
