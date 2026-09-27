/* Shake to report a bug, driven in a real headless browser against the real app.
 * Owner request 2026-09-26. Stubs: a signed-in account and /api/support answered in-page. No network.
 * USAGE: BASE=http://localhost:8997/ CHROME=<chrome binary> node test/run-bug-report-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const PORT = 9411, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/bugr-chrome-" + Date.now();
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


// A signed-in doctor and an in-page /api/support server that behaves like functions/api/support.js.
const STUB = `
  window.__calls = []; window.__tickets = [];
  window.SMD_AUTH = { currentUser: { uid: "u-doc-1", getIdToken: function () { return Promise.resolve("tok"); }, getIdTokenResult: function () { return Promise.resolve({ claims: { phoneVerified: true } }); } },
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(window.SMD_AUTH.currentUser); }, 0); } };
  var _f = window.fetch;
  window.fetch = function (u, o) {
    u = String(u);
    if (u.indexOf("/api/support") < 0) return _f.apply(this, arguments);
    o = o || {}; var body = {}; try { body = JSON.parse(o.body || "{}"); } catch (e) {}
    window.__calls.push({ method: o.method || "GET", url: u, body: body, auth: o.headers && o.headers.Authorization });
    var reply = function (j, s) { return Promise.resolve({ ok: (s || 200) < 400, status: s || 200, json: function () { return Promise.resolve(j); }, blob: function () { return Promise.resolve(new Blob(["x"], { type: "image/jpeg" })); } }); };
    if ((o.method || "GET") === "GET") return reply({ ok: true, tickets: window.__tickets });
    if (body.action === "bug") {
      var now = Date.now(), t = { id: "SMD-ABC123", kind: "bug", subject: "Bug: " + body.text.split("\\n")[0], status: "open", createdAt: now, dueAt: now + 86400000,
        hasShot: !!body.shot, bug: body.bug, messages: [{ from: "user", text: body.text, ts: now }] };
      window.__tickets.unshift(t); return reply({ ok: true, ticket: t });
    }
    if (body.action === "seen") { window.__tickets.forEach(function (t) { if (t.id === body.id) t.userUnread = false; }); return reply({ ok: true }); }
    if (body.action === "reply") { var tt = window.__tickets.filter(function (t) { return t.id === body.id; })[0]; tt.messages.push({ from: "user", text: body.text, ts: Date.now() }); return reply({ ok: true, ticket: tt }); }
    return reply({ error: "bad" }, 400);
  };
  return 1;`;

// Values travel as CDP ARGUMENTS, never spliced into page code (CodeQL: code construction).
async function fn(decl, ...args) {
  const g = await call("Runtime.evaluate", { expression: "globalThis" });
  const r = await call("Runtime.callFunctionOn", { objectId: g.result.result.objectId, functionDeclaration: decl, returnByValue: true, arguments: args.map((value) => ({ value })) });
  return r.result && r.result.result ? r.result.result.value : null;
}
const text = (id) => fn('function (id) { var r = document.getElementById(id); return r ? r.innerText : ""; }', id);
const on = (id) => fn('function (id) { var r = document.getElementById(id); return !!(r && r.classList.contains("on")); }', id);
const waitFor = async (expr, ms = 8000) => { const t0 = Date.now(); do { if (await ev(expr) === true) return true; await sleep(150); } while (Date.now() - t0 < ms); return false; };
// A hand shake: alternating hard swings ~120 ms apart (the detector counts one peak per swing).
// The swing direction alternates in the page (a counter), so no value is spliced into page code.
const shake = async () => { for (let i = 0; i < 6; i++) { await ev(`window.__sw=(window.__sw||0)+1; window.dispatchEvent(new DeviceMotionEvent("devicemotion",{accelerationIncludingGravity:{x:(window.__sw%2?22:-22),y:4,z:9.8}})); return 1;`); await sleep(120); } };

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: BASE });
  ok(await waitFor(`return !!(window.SMD_BUGS && window.SMD_BUGS._shake)`, 30000), "bug-report.js loads with the app");
  await ev(`["introPoster","splash","accountGate","introOverlay","smdBootSplash","verifyGate","phvRoot","pfSetupRoot"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); try{localStorage.setItem("smd_onboarding_tour","0");localStorage.removeItem("smd_shake_report");localStorage.removeItem("smd_bug_outbox");}catch(e){} document.querySelectorAll(".smdt-wel,.smdt-card").forEach(function(e){e.remove()}); return 1;`);
  await ev(STUB);
  // Owner's iPhone, 2026-09-27: the Display "screen size" setting zooms the whole document
  // (home.js applyD). Run the whole flow zoomed, the way that phone was.
  await fn("function (z) { document.documentElement.style.zoom = z; return 1; }", process.env.ZOOM || "1.15");

  // ── a real shake (DeviceMotion events) opens the report sheet; a single bump does not ──
  await ev(`window.dispatchEvent(new DeviceMotionEvent("devicemotion",{accelerationIncludingGravity:{x:0,y:0,z:9.8}})); window.dispatchEvent(new DeviceMotionEvent("devicemotion",{accelerationIncludingGravity:{x:20,y:0,z:9.8}})); return 1;`);
  await sleep(1500);
  ok(await on("bugrRoot") === false, "a single bump does not open anything");
  await shake();
  ok(await waitFor(`var r=document.getElementById("bugrRoot"); return !!(r && r.classList.contains("on") && /Report a problem/.test(r.innerText));`, 15000), "shaking the phone opens Report a problem");
  ok(/fix it within 24 hours/.test(await text("bugrRoot")), "it promises a fix within 24 hours");

  // ── point at a button ──
  await ev(`document.getElementById("bgPoint").click(); return 1;`);
  ok(await waitFor(`return !!document.getElementById("bugrPick")`), "Point at the problem shows the picker");
  await sleep(450);   // the picker ignores taps for 350 ms while the closing sheet settles the page
  // A real, small control that is actually what a finger at its centre would hit (not a stack of
  // tiles or a gap between them), the way a doctor points at "the button that does not work".
  const target = JSON.parse(await ev(`var pk=document.getElementById("bugrPick"); pk.style.pointerEvents="none"; var b=[].slice.call(document.querySelectorAll("button,[data-act]")).filter(function(x){var r=x.getBoundingClientRect(); if(!(r.width>30&&r.height>20&&r.width<260&&r.height<200&&r.top>80&&r.bottom<innerHeight*0.8&&!x.closest("#bugrPick"))) return false; var h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return !!(h&&x.contains(h)); })[0]; pk.style.pointerEvents=""; var r=b.getBoundingClientRect(); b.setAttribute("data-bugtest","1"); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});`));
  await call("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  ok(await waitFor(`var b=document.querySelector("#bugrPick .bp-box"); return !!(b && b.style.display==="block")`), "tapping outlines the element in red");
  ok(await ev(`return !!document.querySelector("#bugrPick .bp-use")`) === true, "and offers Use this");
  // Owner's iPhone, 2026-09-27: the outline landed above and smaller than the tapped tile because the
  // page was still moving. Move the page AFTER the tap: the outline must follow the element.
  // Compare in the SAME units (both getBoundingClientRect). The 4 px padding is overlay px, so it is
  // scaled by the zoom too; allow for it.
  const gap = () => ev(`var pk=document.getElementById("bugrPick"), b=pk.querySelector(".bp-box").getBoundingClientRect(), t=pk.__node.getBoundingClientRect(), p=4*pk.getBoundingClientRect().width/pk.clientWidth; return Math.max(Math.abs((b.left+p)-t.left),Math.abs((b.top+p)-t.top),Math.abs((b.width-2*p)-t.width),Math.abs((b.height-2*p)-t.height));`);
  ok(await fn('function (x, y) { var r = document.getElementById("bugrPick").__node.getBoundingClientRect(); return x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1; }', target.x, target.y) === true, "the picked control is the one under the finger");
  ok(await gap() <= 2, "the outline sits exactly on it, with the page zoomed (gap " + Math.round(await gap()) + " px)");
  // The page scrolls under the picker after the tap: the outline follows.
  await ev(`var n=document.querySelector("[data-bugtest]"), s=n; while (s && s!==document.body && !(s.scrollHeight>s.clientHeight+20 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s=s.parentElement; window.__scr=(s&&s!==document.body)?s:document.scrollingElement; window.__scr.scrollTop+=80; return 1;`);
  await sleep(200);
  ok(await gap() <= 2, "when the page scrolls after the tap, the outline follows the element (gap " + Math.round(await gap()) + " px)");
  await ev(`window.__scr.scrollTop-=80; return 1;`); await sleep(150);
  // Where the element is on screen, as a fraction of the screen: the outline in the SCREENSHOT must match.
  await ev(`var pk=document.getElementById("bugrPick"), o=pk.getBoundingClientRect(), r=pk.__node.getBoundingClientRect(); var c=function(v){return Math.max(0,Math.min(1,v));}; window.__want={l:c((r.left-o.left)/o.width), t:c((r.top-o.top)/o.height), r:c((r.right-o.left)/o.width), b:c((r.bottom-o.top)/o.height), pw:pk.clientWidth, ph:pk.clientHeight}; return 1;`);
  await ev(`document.querySelector("#bugrPick .bp-use").click(); return 1;`);
  ok(await waitFor(`var r=document.getElementById("bugrRoot"); return !!(r && r.classList.contains("on") && /What went wrong/.test(r.innerText));`), "then asks what went wrong");
  ok(/You pointed at/.test(await text("bugrRoot")), "showing what was pointed at");
  const hasThumb = await ev(`var i=document.querySelector("#bugrRoot .bg-thumb img"); return !!(i && /^data:image\\/jpeg/.test(i.src));`);
  ok(hasThumb === true, "with the screenshot preview and an Include screenshot choice");
  // The screenshot must show the app, not a black frame (a transparent capture encodes as black JPEG).
  await ev(`window.__lum=null; var i=document.querySelector("#bugrRoot .bg-thumb img"); var im=new Image(); im.onload=function(){ var c=document.createElement("canvas"); c.width=40; c.height=80; var g=c.getContext("2d"); g.drawImage(im,0,0,40,80); var d=g.getImageData(0,0,40,80).data, s=0; for(var k=0;k<d.length;k+=4) s+=d[k]+d[k+1]+d[k+2]; window.__lum=s/(d.length/4)/3; }; im.src=i.src; return 1;`);
  ok(await waitFor(`return window.__lum !== null`) && await ev(`return window.__lum > 80`) === true, "the screenshot is not a black frame: mean luminance " + Math.round(await ev(`return window.__lum`)));
  // The red outline drawn into the screenshot sits on the element that was pointed at.
  await ev(`window.__red=null; var i=document.querySelector("#bugrRoot .bg-thumb img"); var im=new Image(); im.onload=function(){ var c=document.createElement("canvas"); c.width=im.naturalWidth; c.height=im.naturalHeight; var g=c.getContext("2d"); g.drawImage(im,0,0); var d=g.getImageData(0,0,c.width,c.height).data, x0=1e9,y0=1e9,x1=-1,y1=-1; for(var y=0;y<c.height;y++) for(var x=0;x<c.width;x++){ var k=(y*c.width+x)*4; if(d[k]>200&&d[k+1]<110&&d[k+2]<110){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } } window.__red = x1<0 ? {none:true} : {l:x0/c.width, t:y0/c.height, r:x1/c.width, b:y1/c.height}; }; im.src=i.src; return 1;`);
  ok(await waitFor(`return window.__red !== null`) && await ev(`var r=window.__red, w=window.__want; return !r.none && ["l","t","r","b"].every(function(k){ var e=0.012+7/((k==="l"||k==="r")?w.pw:w.ph); return Math.abs(r[k]-w[k])<e; });`) === true,
     "the red outline in the screenshot is on the pointed element, with the page zoomed " + await ev(`return JSON.stringify({got:window.__red, want:window.__want})`));
  // ...and not a BLANK one (owner's iPhone, 2026-09-27: page-colour frame with only the red box).
  // A real screen has contrast: tiles, text, the teal banner. Measure the spread, not the mean.
  await ev(`window.__sd=null; var i=document.querySelector("#bugrRoot .bg-thumb img"); var im=new Image(); im.onload=function(){ var c=document.createElement("canvas"); c.width=90; c.height=190; var g=c.getContext("2d"); g.drawImage(im,0,0,90,190); var d=g.getImageData(0,0,90,190).data, n=0, s=0, s2=0; for(var k=0;k<d.length;k+=4){ var l=(d[k]+d[k+1]+d[k+2])/3; if (d[k]>200 && d[k+1]<110 && d[k+2]<110) continue; s+=l; s2+=l*l; n++; } var m=s/n; window.__sd=Math.sqrt(s2/n-m*m); }; im.src=i.src; return 1;`);
  ok(await waitFor(`return window.__sd !== null`) && await ev(`return window.__sd > 25`) === true, "the screenshot shows the app screen, not a blank page (contrast " + Math.round(await ev(`return window.__sd`)) + ")");
  // Settled (no half-faded sheet): the card is fully opaque and on top of the app.
  await sleep(700);
  ok(await ev(`var c=document.querySelector("#bugrRoot .bg-card"); var r=c.getBoundingClientRect(); var e=document.elementFromPoint(r.left+30,r.top+30); return getComputedStyle(document.getElementById("bugrRoot")).opacity==="1" && getComputedStyle(c).opacity==="1" && c.contains(e);`) === true, "the sheet is opaque and on top (not faded over the app)");
  ok(await ev(`var t=document.querySelector("#bugrRoot .bg-el"); return !!t && t.innerText.length < 90;`) === true, "the pointed element is named briefly");
  if (process.env.SHOT) { const s = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-write.png"), Buffer.from(s.result.data, "base64")); }

  // ── empty text is caught; then send ──
  await ev(`document.getElementById("bgSend").click(); return 1;`); await sleep(200);
  ok(/a few words/.test(await text("bugrRoot")), "an empty description is caught in the sheet");
  await ev(`var t=document.getElementById("bgText"); t.value="Tapping this does nothing"; return 1;`);
  await ev(`document.getElementById("bgSend").click(); return 1;`);
  ok(await waitFor(`return /Thank you/.test((document.getElementById("bugrRoot")||{}).innerText||"")`, 15000), "Send shows the thank-you");
  ok(/within 24 hours/.test(await text("bugrRoot")) && /SMD-ABC123/.test(await text("bugrRoot")), "with the report id and the 24-hour promise");
  const sent = JSON.parse(await ev(`return JSON.stringify(window.__calls.filter(function(c){return c.body.action==="bug"})[0]);`));
  ok(sent && sent.auth === "Bearer tok", "sent to /api/support with the account token");
  ok(sent.body.text === "Tapping this does nothing" && /^data:image\/jpeg;base64,/.test(sent.body.shot), "with the text and the screenshot");
  ok(sent.body.bug && sent.body.bug.element && sent.body.bug.element.rect && sent.body.bug.element.rect.w > 0, "and the pointed element with its position");
  ok(sent.body.bug.screen && sent.body.bug.screen.w === 390, "and the screen size");
  await ev(`document.getElementById("bgDone").click(); return 1;`);

  // ── sidebar: Bug Report Centre in, AgentConnect and My Clinic out ──
  await ev(`try{localStorage.setItem("smd_personal_clinic","1")}catch(e){} try { if (window.SB && SB.open) SB.open(); } catch (e) {} return 1;`);
  ok(await waitFor(`return !!document.querySelector('[data-sbr-act="bugs"]')`), "the sidebar has Bug Report Centre");
  ok(await ev(`return !document.querySelector('[data-sbr-act="agentconnect"]') && !document.querySelector('[data-sbr-act="clinic"]');`) === true, "AgentConnect and My Clinic are gone from the sidebar (even with My Clinic switched on)");
  await ev(`document.querySelector('[data-sbr-act="bugs"]').click(); return 1;`);
  ok(await waitFor(`var r=document.getElementById("bugcRoot"); return !!(r && r.classList.contains("on") && /SMD-ABC123/.test(r.innerText));`), "the Centre lists the report");
  ok(/Fix due in 24 h/.test(await text("bugcRoot")), "with the time left on the 24-hour promise");

  // ── the developer replies: badge, thread, doctor answers back ──
  await ev(`window.__tickets[0].messages.push({from:"support",text:"Thanks, fixed in the next update.",ts:Date.now()}); window.__tickets[0].userUnread=true; SMD_BUGS.closeCentre(); SMD_BUGS.openCentre(); return 1;`);
  ok(await waitFor(`return !!document.querySelector("#bugcRoot .bc-dot")`), "a developer reply shows as unread");
  await ev(`document.querySelector("#bugcRoot [data-bc]").click(); return 1;`);
  ok(await waitFor(`return /StewardMD developer/.test(document.getElementById("bugcRoot").innerText) && /fixed in the next update/.test(document.getElementById("bugcRoot").innerText)`), "the thread shows the developer's reply");
  ok(await ev(`return window.__calls.some(function(c){return c.body.action==="seen"})`) === true, "opening it marks it read");
  await ev(`document.getElementById("bcTx").value="Thank you"; document.getElementById("bcSend").click(); return 1;`);
  ok(await waitFor(`return window.__calls.some(function(c){return c.body.action==="reply" && c.body.text==="Thank you"})`), "the doctor can reply back");
  if (process.env.SHOT) { const s = await call("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(process.env.SHOT.replace(/\.png$/, "-centre.png"), Buffer.from(s.result.data, "base64")); }
  ok(await ev(`return !/[\\u{1F300}-\\u{1FAFF}\\u2014]/u.test(document.getElementById("bugcRoot").innerText)`) === true, "no emoji and no em-dash in the Centre");
  await ev(`SMD_BUGS.closeCentre(); return 1;`);

  // ── switched off: shaking does nothing ──
  await ev(`localStorage.setItem("smd_shake_report","0"); return 1;`);
  await sleep(4200); await shake(); await sleep(1500);
  ok(await on("bugrRoot") === false, "with Shake to report off, a shake does nothing");

  console.log(fails === 0 ? "\nALL GREEN - shake to report, point at the problem, 24-hour promise, Bug Report Centre with developer replies" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
