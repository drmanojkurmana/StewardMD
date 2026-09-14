/* P2.16: the nurse's round at tablet sizes and the keyboard layer, in real headless Chrome over CDP.
 *
 * The unit test (test/ward-keyboard.test.mjs) proves what the map binds; this proves what only a real
 * browser can: that dose actions are at least 44 px and inside the viewport with no horizontal scroll
 * at 1024x768, that the "next due" header stays in view while the round scrolls, that landscape is two
 * panes and portrait one column, and that real key presses navigate while typing in a field does not.
 *
 *   node test/run-ward-tablet-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9396, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-tablet-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-tablet-harness.html");
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1024,768"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (js, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (await ev(js)) return true; } return false; };
const view = () => ev(`return WARD._st.view;`);
/* A real key press through the browser's input pipeline, landing on whatever has focus. */
const press = async (key) => {
  const special = { Escape: { code: "Escape", windowsVirtualKeyCode: 27 } }[key];
  const down = special ? { type: "rawKeyDown", key, ...special } : { type: "keyDown", key, text: key };
  await call("Input.dispatchKeyEvent", down);
  await call("Input.dispatchKeyEvent", { type: "keyUp", key, ...(special || {}) });
  await sleep(60);
};
const size = (width, height) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false,
  screenOrientation: width > height ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });

/* Every dose action button: its box, and whether anything scrolls sideways. */
const measureRound = () => ev(`
  var btns = [].slice.call(document.querySelectorAll('[data-w-act^="mar:"]'));
  var cv = document.querySelector("#smdWard .w-canvas");
  return JSON.stringify({
    n: btns.length, vw: innerWidth,
    minH: Math.min.apply(null, btns.map(function (b) { return b.getBoundingClientRect().height; })),
    maxRight: Math.max.apply(null, btns.map(function (b) { return b.getBoundingClientRect().right; })),
    minLeft: Math.min.apply(null, btns.map(function (b) { return b.getBoundingClientRect().left; })),
    canvasSide: cv.scrollWidth - cv.clientWidth, pageSide: document.documentElement.scrollWidth - innerWidth,
    ctl: document.querySelector(".w-mar-ctl").getBoundingClientRect().toJSON(), doses: document.querySelector(".w-mar-doses").getBoundingClientRect().toJSON(),
  });`);

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await size(1024, 768);
  await call("Page.navigate", { url: URL });

  let ready = null;
  for (let i = 0; i < 50; i++) { await sleep(150); ready = await ev(`return window.__ready;`); if (ready === true) break; }
  ok(ready === true, `real ward.js loaded into the harness (${ready})`);
  await ev(`WARD.open({ orgId: "org-tablet-harness" }); return true;`);
  ok(await waitFor(`return !!document.querySelector('[data-w-act="open:enc-1"]');`), "the ward list rendered at 1024x768");

  // 1. Keyboard on the list: "?" shows the sheet, Escape closes it.
  await press("?");
  ok(await ev(`var s = document.getElementById("wKeys"); return !!s && s.getBoundingClientRect().height > 0 && /Keyboard shortcuts/.test(s.textContent);`), '"?" shows the shortcut sheet');
  await press("Escape");
  ok(await ev(`return !document.getElementById("wKeys");`), "Escape closes it");
  ok(await waitFor(`var l = document.getElementById("wKeysLive"); return !!l && /closed/i.test(l.textContent);`), "the change is announced in a live region");

  // 2. "/" focuses the search; typing g then c there types, it does not navigate.
  await press("/");
  ok(await ev(`return document.activeElement && document.activeElement.id === "wQ";`), '"/" focuses the patient search');
  await press("g"); await press("c");
  ok((await view()) === "list" && (await ev(`return document.getElementById("wQ").value;`)) === "gc", "g then c typed into the search stays on the list");
  await ev(`var q = document.getElementById("wQ"); q.value = ""; q.dispatchEvent(new Event("input", { bubbles: true })); q.blur(); return true;`);
  await press("g"); await press("c");
  ok((await view()) === "critsboard", "g then c, outside a field, opens the critical results board");
  await press("g"); await press("l");
  ok((await view()) === "labboard", "g then l opens the laboratory board");
  await press("g"); await press("w");
  ok((await view()) === "list", "g then w returns to the ward list");
  ok(await ev(`return document.querySelector('[data-w-act="close"]').getAttribute("aria-label") === "Close the ward";`), "the icon-only close button has a name");

  // 3. The chart and the round, landscape tablet.
  await ev(`document.querySelector('[data-w-act="open:enc-1"]').click(); return true;`);
  ok(await waitFor(`return document.querySelectorAll('[data-w-act^="mar:"]').length > 5;`), "the chart opened with the real round");
  await ev(`document.activeElement && document.activeElement.blur(); return true;`);
  let m = JSON.parse(await measureRound());
  ok(m.minH >= 44, `every dose action is at least 44 px tall (smallest ${m.minH}px, ${m.n} buttons)`);
  ok(m.maxRight <= m.vw && m.minLeft >= 0, `every dose action is inside the 1024 px viewport (right edge ${m.maxRight})`);
  ok(m.canvasSide <= 0 && m.pageSide <= 0, `nothing scrolls sideways (canvas ${m.canvasSide}, page ${m.pageSide})`);
  ok(m.ctl.right <= m.doses.left && Math.abs(m.ctl.top - m.doses.top) < 4, "landscape: scan controls and doses are two panes side by side");
  ok(/Next due:\s*Piperacillin/.test(await ev(`return document.querySelector(".w-mar .w-next").textContent;`)), "the header names the next dose to act on");
  ok(await ev(`var b = document.querySelector('.w-mar .w-card-h [data-w-act="round"]').getBoundingClientRect(); return b.height >= 44 && b.width >= 44;`), "the round's icon button is a 44 px target");

  // Scroll the round under the header: the header, with "next due", stays at the top of the canvas.
  const stuck = JSON.parse(await ev(`
    var cv = document.querySelector("#smdWard .w-canvas"), card = document.querySelector(".w-mar");
    cv.scrollTop = card.offsetTop - cv.offsetTop + 300;
    var h = card.querySelector(".w-card-h").getBoundingClientRect(), c = cv.getBoundingClientRect(), k = card.getBoundingClientRect();
    return JSON.stringify({ headTop: h.top, canvasTop: c.top, cardTop: k.top });`));
  ok(stuck.cardTop < stuck.canvasTop - 100 && Math.abs(stuck.headTop - stuck.canvasTop) <= 2, `the "next due" header stays in view while the round scrolls (header ${stuck.headTop}, canvas ${stuck.canvasTop})`);
  await call("Page.captureScreenshot", { format: "png" }).then((r) => import("node:fs").then((fs) => fs.writeFileSync((process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-tablet-landscape.png", Buffer.from(r.result.data, "base64"))));

  // 4. Chart keys: v focuses the vitals card's own control, n opens notes, Escape goes back.
  await ev(`document.querySelector("#smdWard .w-canvas").scrollTop = 0; document.activeElement && document.activeElement.blur(); return true;`);
  await press("v");
  ok(await ev(`return document.activeElement && document.activeElement.getAttribute("data-w-act") === "flowsheet";`), '"v" brings the vitals flowsheet into view and focuses it');
  await ev(`document.activeElement.blur(); return true;`);
  await press("n");
  ok((await view()) === "timeline", '"n" opens notes and timeline');
  await press("Escape");
  ok((await view()) === "chart", "Escape goes back to the chart");
  // Typing in a vitals box: shortcuts do not fire, and after leaving the field they refuse to discard it.
  await ev(`document.getElementById("wv_pulse") ? document.getElementById("wv_pulse").focus() : document.querySelector("[id^=wv_]").focus(); return true;`);
  await press("8"); await press("n");
  ok((await view()) === "chart", "a key typed in a vitals field does not navigate");
  await press("Escape");
  ok(await ev(`return !document.activeElement || document.activeElement === document.body;`), "Escape in a field only leaves the field");
  await press("n");
  ok((await view()) === "chart", "a shortcut will not discard typed vitals");
  ok(await waitFor(`return /unsaved entries/.test(document.getElementById("wKeysLive").textContent);`), "and says why");
  const posts = JSON.parse(await ev(`return JSON.stringify(window.__calls.filter(function (c) { return c.method !== "GET"; }).map(function (c) { return c.url; }));`));
  ok(posts.length === 0, "no key press sent a write (" + JSON.stringify(posts) + ")");

  // 5. Portrait tablet: one column, still 44 px, still inside the viewport.
  await ev(`document.querySelectorAll("#smdWard input").forEach(function (i) { i.value = i.defaultValue; }); return true;`);
  await size(768, 1024); await sleep(250);
  m = JSON.parse(await measureRound());
  ok(m.ctl.bottom <= m.doses.top + 1, "portrait: one column, controls above the doses");
  ok(m.minH >= 44 && m.maxRight <= m.vw && m.canvasSide <= 0 && m.pageSide <= 0, `portrait: actions 44 px and inside 768 px with no sideways scroll (min ${m.minH}, right ${m.maxRight})`);

  // 6. The nurse worklist: sticky "next due" bar, two panes in landscape, one column in portrait.
  await size(1024, 768);
  await ev(`WARD.open({ orgId: "org-tablet-harness", act: "nurseworklist" }); return true;`);
  ok(await waitFor(`return document.querySelectorAll(".w-nw .w-mini-row").length === 5;`), "the nurse worklist rendered");
  ok(/Next due: 1 overdue/.test(await ev(`return document.querySelector(".w-nw .w-next").textContent;`)), "its bar carries the shift's next-due line");
  const wl = JSON.parse(await ev(`var r = document.querySelectorAll(".w-nw .w-mini-row"), a = r[0].getBoundingClientRect(), b = r[1].getBoundingClientRect();
    var btns = [].slice.call(document.querySelectorAll(".w-nw button"));
    return JSON.stringify({ sameRow: Math.abs(a.top - b.top) < 2 && b.left > a.right - 1, minH: Math.min.apply(null, btns.map(function (x) { return x.getBoundingClientRect().height; })),
      side: document.querySelector("#smdWard .w-canvas").scrollWidth - document.querySelector("#smdWard .w-canvas").clientWidth,
      sticky: getComputedStyle(document.querySelector(".w-nw > .w-dt-bar")).position });`));
  ok(wl.sameRow, "landscape: patients in two panes");
  ok(wl.minH >= 44 && wl.side <= 0, `worklist buttons at least 44 px (min ${wl.minH}) with no sideways scroll`);
  ok(wl.sticky === "sticky", "the worklist bar is sticky");
  await size(768, 1024); await sleep(250);
  ok(await ev(`var r = document.querySelectorAll(".w-nw .w-mini-row"); return r[1].getBoundingClientRect().top >= r[0].getBoundingClientRect().bottom;`), "portrait: the worklist is one column");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
