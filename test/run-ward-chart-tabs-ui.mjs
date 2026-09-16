/* BUG-MU2PM1D9: the chart header's grouped screens, in real headless Chrome over CDP against the real
 * ward.js and ward.css (test/ward-tablet-harness.html stubs only the network). Proves what the unit test
 * (test/ward-chart-tabs.test.mjs) cannot: real arrow keys move a roving tab stop, a category opens in
 * place, a screen opened any way brings its category back with it (this session, across a reload), and at
 * 390 px the category bar scrolls inside itself while the page never scrolls sideways.
 *
 *   node test/run-ward-chart-tabs-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 *   SHOTS=<dir> also writes chart-tabs-1280.png and chart-tabs-390.png there.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 9493, userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/ward-chart-tabs-chrome";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "file://" + join(HERE, "ward-tablet-harness.html");
const SHOTS = process.env.SHOTS || "";
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--allow-file-access-from-files", "--window-size=1280,900"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 1; const pending = new Map(); let ws, sessionId;
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const waitFor = async (js, n) => { for (let i = 0; i < (n || 40); i++) { await sleep(100); if (await ev(js)) return true; } return false; };
const view = () => ev(`return WARD._st.view;`);
const KEYS = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Enter: 13, Escape: 27, Tab: 9 };
const press = async (key) => {
  const code = KEYS[key];
  const down = code ? { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code } : { type: "keyDown", key, text: key };
  await call("Input.dispatchKeyEvent", down);
  if (key === "Enter") await call("Input.dispatchKeyEvent", { type: "char", key, text: "\r" });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key, ...(code ? { code: key, windowsVirtualKeyCode: code } : {}) });
  await sleep(80);
};
const focused = () => ev(`var a = document.activeElement; return a ? (a.id || a.getAttribute("data-w-act") || a.tagName) : "";`);
const size = (width, height) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
const selectedCat = () => ev(`var t = document.querySelector('.w-cnav [role="tab"][aria-selected="true"]'); return t ? t.id : "";`);
const shot = async (name) => { if (!SHOTS) return; const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(SHOTS, name), Buffer.from(r.result.data, "base64")); };

/* Every button the chart header carried before the grouping. */
const OLD = ["consultation", "workspace", "medrec", "ordersets", "pathways", "specialty", "infusions", "careplan", "tags", "patientsurgery", "wounds", "risks",
  "immunizations", "people", "documents", "forms", "referrals", "move", "timeline", "summary", "wardcloseopen", "followup", "oncologyopen",
  "cardiologyopen", "radiologyopen", "pharmacyopen", "txopen", "consentopen", "ipsopen", "completionopen", "roiopen", "tpaopen", "billingopen", "pcopy"];

const openChart = async () => {
  await ev(`WARD.open({ orgId: "org-tablet-harness" }); return true;`);
  await waitFor(`return !!document.querySelector('[data-w-act="open:enc-1"]');`);
  await ev(`document.querySelector('[data-w-act="open:enc-1"]').click(); return true;`);
  return waitFor(`return !!document.querySelector('.w-cnav [role="tablist"]') && document.querySelectorAll('[data-w-act^="mar:"]').length > 0;`);
};

try {
  let ver, t = 0; while (t++ < 60) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {});
  await size(1280, 900);
  await call("Page.navigate", { url: URL });
  ok(await waitFor(`return window.__ready === true;`, 60), "real ward.js loaded into the harness");
  await ev(`sessionStorage.clear(); return true;`);
  ok(await openChart(), "the chart opened with its grouped header");

  // 1. Every old button is on the page exactly once, and each is inside a category panel (or beside the name).
  const where = JSON.parse(await ev(`return JSON.stringify(${JSON.stringify(OLD)}.map(function (a) {
    var hits = document.querySelectorAll('.w-chart-h [data-w-act="' + a + '"]'), p = hits[0] && hits[0].closest('[role="tabpanel"]');
    return { a: a, n: hits.length, cat: p ? p.getAttribute("aria-labelledby") : "" };
  }));`));
  ok(where.every((w) => w.n === 1), "all " + OLD.length + " old header buttons are present exactly once: " + JSON.stringify(where.filter((w) => w.n !== 1)));
  ok(where.filter((w) => !w.cat).map((w) => w.a).join() === "consultation,workspace", "every one but Consultation and Workspace sits in a category panel");
  ok((await selectedCat()) === "wCnav-overview", "a fresh session opens on Overview");
  ok(await ev(`return document.querySelectorAll('.w-cnav [role="tabpanel"]:not([hidden])').length === 1 && getComputedStyle(document.getElementById("wCnavP-admin")).display === "none";`), "only the chosen category's buttons are shown");

  // 2. Every button is reachable through its category: choose the category, the button is visible and opens its screen.
  for (const w of where.filter((x) => x.cat)) {
    await ev(`document.getElementById(${JSON.stringify(w.cat)}).click(); return true;`);
    const vis = await ev(`var b = document.querySelector('.w-chart-h [data-w-act="${w.a}"]').getBoundingClientRect(); return b.width > 0 && b.height >= 44;`);
    if (!vis) ok(false, w.a + " is visible and 44 px tall once " + w.cat + " is chosen");
  }
  ok(true, "each grouped button became visible (44 px tall) when its category was chosen");

  // 3. Keyboard: one tab stop in the bar, arrows rove, Home/End jump, Enter chooses.
  await ev(`document.getElementById("wCnav-overview").click(); document.getElementById("wCnav-overview").focus(); return true;`);
  ok(await ev(`return document.querySelectorAll('.w-cnav [role="tab"][tabindex="0"]').length === 1;`), "the category bar is a single tab stop");
  await press("ArrowRight");
  ok((await focused()) === "wCnav-orders", "ArrowRight moves focus to Orders");
  ok((await selectedCat()) === "wCnav-overview", "manual activation: moving focus does not swap the buttons");
  await press("End"); ok((await focused()) === "wCnav-admin", "End jumps to the last category");
  await press("ArrowRight"); ok((await focused()) === "wCnav-overview", "ArrowRight wraps to the first");
  await press("ArrowLeft"); ok((await focused()) === "wCnav-admin", "ArrowLeft wraps to the last");
  await press("Home"); ok((await focused()) === "wCnav-overview", "Home jumps to the first");
  await press("End"); await press("Enter");
  ok((await selectedCat()) === "wCnav-admin" && await ev(`return !document.getElementById("wCnavP-admin").hidden;`), "Enter chooses Admin and shows its buttons");
  ok((await view()) === "chart", "choosing a category does not leave the chart");
  await press("Tab");
  ok((await focused()) === "billingopen", "Tab goes from the bar to the category's first button (" + (await focused()) + ")");
  await press("ArrowRight"); ok((await focused()) === "tpaopen", "ArrowRight roves within the buttons");
  await press("ArrowLeft"); await press("ArrowLeft"); ok((await focused()) === "roiopen", "and wraps");

  // 4. A button opens the same screen it always did; back returns to the chart with that category and button remembered.
  await ev(`document.querySelector('[data-w-act="tpaopen"]').click(); return true;`);
  ok(await waitFor(`return WARD._st.view === "tpa";`), "TPA opens the TPA screen");
  await ev(`WARD._dispatch("back"); return true;`);
  ok(await waitFor(`return WARD._st.view === "chart" && !!document.querySelector(".w-cnav");`), "back returns to the chart");
  ok((await selectedCat()) === "wCnav-admin" && await ev(`return document.querySelector('[data-w-act="tpaopen"]').getAttribute("tabindex") === "0";`), "Admin is still chosen and TPA is its tab stop");

  // 5. A screen opened without the header (the "n" shortcut) brings its own category back with it.
  await ev(`document.activeElement && document.activeElement.blur(); return true;`);
  await press("n");
  ok((await view()) === "timeline", '"n" opens the timeline directly');
  /* Owner 2026-09-16: the timeline names who gave the dose, by name and employee id, with the identity on hover and on a tap. */
  ok(await waitFor(`var b = document.querySelector('#smdWard .w-timeline button.w-who'); return !!b && b.textContent === "Sister Anitha R (EMP-1042)";`), "the timeline names the nurse and her employee id");
  ok(await ev(`return document.querySelector('#smdWard .w-timeline button.w-who').title === "Name: Sister Anitha R · Employee ID: EMP-1042 · Role: nurse";`), "the whole identity is on hover");
  ok(await ev(`return window.__calls.filter(function (c) { return c.url.indexOf("/ward/staff-identities") >= 0; }).length >= 1;`), "the names came from /ward/staff-identities");
  await ev(`window.__toasts = []; window.toast = function (m) { window.__toasts.push(m); }; document.querySelector('#smdWard .w-timeline button.w-who').click(); return true;`);
  ok(await ev(`return window.__toasts.length === 1 && window.__toasts[0].indexOf("Employee ID: EMP-1042") >= 0 && WARD._st.view === "timeline";`), "a tap says the identity and leaves the timeline open");
  await press("Escape");
  ok(await waitFor(`return WARD._st.view === "chart";`) && (await selectedCat()) === "wCnav-overview", "back on the chart, Overview (where Timeline lives) is chosen");
  await ev(`WARD._dispatch("pharmacyopen"); return true;`);
  ok(await waitFor(`return WARD._st.view === "pharmacy";`), "a direct verb opens Pharmacy");
  await ev(`WARD._dispatch("back"); return true;`);
  ok(await waitFor(`return WARD._st.view === "chart";`) && (await selectedCat()) === "wCnav-specialty", "and returning shows the Specialty category");

  // 6. The choice lasts the session: a reload reopens the chart on the same category.
  await call("Page.navigate", { url: URL });
  await waitFor(`return window.__ready === true;`, 60);
  ok(await openChart(), "the chart reopened after a reload");
  ok((await selectedCat()) === "wCnav-specialty", "the last category is remembered for this session");
  await ev(`document.getElementById("wCnav-overview").click(); return true;`);
  await ev(`document.querySelector("#smdWard .w-canvas").scrollTop = 0; return true;`);
  await shot("chart-tabs-1280.png");

  // 7. Phone: the category bar scrolls inside itself; the page and the canvas never scroll sideways.
  await size(390, 844); await sleep(300);
  const phone = JSON.parse(await ev(`var bar = document.querySelector(".w-cnav-bar"), cv = document.querySelector("#smdWard .w-canvas"), last = document.getElementById("wCnav-admin");
    return JSON.stringify({ page: document.documentElement.scrollWidth - innerWidth, canvas: cv.scrollWidth - cv.clientWidth,
      barScroll: getComputedStyle(bar).overflowX, barRight: bar.getBoundingClientRect().right, vw: innerWidth,
      minH: Math.min.apply(null, [].map.call(document.querySelectorAll(".w-cnav-t"), function (b) { return b.getBoundingClientRect().height; })),
      btnRight: Math.max.apply(null, [].map.call(document.querySelectorAll('.w-cnav [role="tabpanel"]:not([hidden]) button'), function (b) { return b.getBoundingClientRect().right; })) });`));
  ok(phone.page <= 0 && phone.canvas <= 0, `390 px: no sideways scroll (page ${phone.page}, canvas ${phone.canvas})`);
  ok(phone.barScroll === "auto" && phone.barRight <= phone.vw, `390 px: the category bar scrolls inside itself (right edge ${phone.barRight})`);
  ok(phone.minH >= 44, `390 px: category tabs are 44 px targets (${phone.minH})`);
  ok(phone.btnRight <= phone.vw, `390 px: the open category's buttons wrap inside the screen (right edge ${phone.btnRight})`);
  await ev(`document.getElementById("wCnav-admin").focus(); return true;`);
  ok(await ev(`var a = document.getElementById("wCnav-admin").getBoundingClientRect(); return a.right <= innerWidth + 1 && a.left >= 0;`), "390 px: a focused category off the edge is scrolled into view");
  await ev(`document.getElementById("wCnav-overview").focus(); document.activeElement.blur(); return true;`);
  await shot("chart-tabs-390.png");
} catch (e) { ok(false, "harness error: " + (e && e.message || e)); }
finally { try { chrome.kill(); } catch {} }
console.log(fails ? `\n${fails} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
