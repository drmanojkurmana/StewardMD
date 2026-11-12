/* test/run-image-report-ui.mjs - headless: tap an image in a disease article, it opens full screen, Report sends a
 * ticket of kind "image"; the Image Library viewer reports the same way; an icon does not open.
 * USAGE: node test/run-image-report-ui.mjs   (static server started here; SHOTS=<dir> for screenshots)
 * The sign-in and /api/support are stubbed in the page: the payload is checked, nothing is sent. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = await import("/opt/node22/lib/node_modules/playwright/index.mjs"); }
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
const PORT = 8000 + Math.floor(Math.random() * 900), SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const srv = spawn(process.execPath, [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
/* Which watermark look shows on an overlay: big = the PrepNucleus centre mark, by = the PrepNucleus corner lockup,
 * sm = the small StewardMD corner. Also where the shown corner sits against the overlay's bottom right. */
const LOOK = `(w) => { const vis = (s) => { const e = w.querySelector(s); return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0; };
  const o = w.getBoundingClientRect(), c = w.querySelector(vis(".smd-wm-sm") ? ".smd-wm-sm" : ".smd-wm-by"), r = c && c.getBoundingClientRect();
  return { big: vis(".smd-wm-big"), by: vis(".smd-wm-by"), sm: vis(".smd-wm-sm"), corner: r ? Math.round((o.right - r.right) + (o.bottom - r.bottom)) : -1, small: r ? Math.round(r.width / o.width * 100) : -1 }; }`;

const b = await pw.chromium.launch({ args: ["--no-sandbox"] });
try {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.addInitScript("window.__wmLook = " + LOOK);
  await p.addInitScript(() => {
    window.__sent = [];
    const real = window.fetch;
    window.fetch = function (u, o) {
      if (String(u).indexOf("/api/support") >= 0 && o && o.method === "POST") { window.__sent.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ ok: true, ticket: { id: "SMD-TEST01" } }), { status: 200 })); }
      return real.apply(this, arguments);
    };
  });
  await p.goto(`http://127.0.0.1:${PORT}/?tour=0`);
  await p.waitForFunction(() => window.DX && DX.openRef && window.SMD_IMGZOOM, null, { timeout: 40000 });
  await p.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash", "smdApplock"].forEach((k) => document.getElementById(k)?.remove()); DX.openRef("MENINGITIS", { standalone: true }); });
  await p.waitForSelector("#kbr-patho .kbr-fig img", { timeout: 20000 });
  const img = await p.$("#kbr-patho .kbr-fig img");
  await img.scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  // StewardMD watermark (variant E, three marks): on the article figure, over the image's own box
  const fw = await p.evaluate(() => { const h = document.querySelector("#kbr-patho .kbr-fig .smd-wm-host"), i = h && h.querySelector("img"), w = h && h.querySelector(".smd-wm");
    if (!w) return null; const a = i.getBoundingClientRect(), b = w.getBoundingClientRect(); return { look: window.__wmLook(w), dx: Math.abs(a.left - b.left) + Math.abs(a.right - b.right), dy: Math.abs(a.top - b.top) + Math.abs(a.bottom - b.bottom), pe: getComputedStyle(w).pointerEvents }; });
  ok(fw && fw.dx < 3 && fw.dy < 3 && fw.pe === "none", "article figure carries the watermark on its own box " + JSON.stringify(fw));
  ok(fw && fw.look.sm && !fw.look.big && !fw.look.by && fw.look.corner >= 0 && fw.look.corner < 30 && fw.look.small < 40,
    "outside PrepNucleus: one small StewardMD logo in the bottom right corner, no PrepNucleus marks " + JSON.stringify(fw && fw.look));
  // Press and hold fades the marks; lifting brings them back.
  const hold = await p.evaluate(async () => { const h = document.querySelector("#kbr-patho .kbr-fig .smd-wm-host"), i = h.querySelector("img"), w = h.querySelector(".smd-wm"), r = i.getBoundingClientRect();
    const o = { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    i.dispatchEvent(new PointerEvent("pointerdown", o)); await new Promise((z) => setTimeout(z, 120)); const early = w.classList.contains("smd-wm-peek");
    await new Promise((z) => setTimeout(z, 300)); const held = w.classList.contains("smd-wm-peek"); await new Promise((z) => setTimeout(z, 200)); const c = w.querySelector(".smd-wm-sm"), op = +getComputedStyle(c).opacity, wop = +getComputedStyle(w).opacity, bigop = +getComputedStyle(w.querySelector(".smd-wm-big")).opacity;
    i.dispatchEvent(new PointerEvent("pointerup", o)); const after = w.classList.contains("smd-wm-peek");
    i.dispatchEvent(new PointerEvent("pointerdown", o)); i.dispatchEvent(new PointerEvent("pointermove", Object.assign({}, o, { clientX: o.clientX + 40 }))); await new Promise((z) => setTimeout(z, 400));
    const moved = w.classList.contains("smd-wm-peek"); i.dispatchEvent(new PointerEvent("pointerup", o));
    return { early, held, op, wop, bigop, after, moved }; });
  ok(!hold.early && hold.held && hold.op < 0.3 && hold.wop === 1 && hold.bigop > 0.1 && !hold.after && !hold.moved, "press and hold fades the corner badge only (centre mark stays), release restores it, a drag does not fade it " + JSON.stringify(hold));
  if (SHOTS) { await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + "/figure-wm.png" }); }
  await img.click(); await p.waitForSelector(".pv", { timeout: 8000 }).catch(() => {});
  ok(!!(await p.$(".pv")), "tapping an article image opens the full-screen viewer");
  ok(!!(await p.$('.pv [data-pv="report"]')), "the viewer has a Report button");
  await p.waitForTimeout(500);
  const vw = await p.evaluate(() => { const i = document.querySelector(".pv .pv-img"), w = document.querySelector(".pv .smd-wm--follow"); if (!i || !w) return null;
    const a = i.getBoundingClientRect(), b = w.getBoundingClientRect(); return { d: Math.round(Math.abs(a.left - b.left) + Math.abs(a.top - b.top) + Math.abs(a.width - b.width)), look: window.__wmLook(w) }; });
  ok(vw && vw.d < 4, "the viewer image carries the watermark on the picture " + JSON.stringify(vw));
  ok(vw && vw.look.sm && !vw.look.big && !vw.look.by, "the viewer opened outside PrepNucleus shows the small StewardMD corner only " + JSON.stringify(vw && vw.look));
  await p.click('.pv [data-pv="in"]'); await p.waitForTimeout(450);
  const zw = await p.evaluate(() => { const i = document.querySelector(".pv .pv-img"), w = document.querySelector(".pv .smd-wm--follow"); const a = i.getBoundingClientRect(), b = w.getBoundingClientRect(); return Math.round(Math.abs(a.width - b.width) + Math.abs(a.left - b.left)); });
  ok(zw < 4, "zooming in, the watermark zooms with the image (off by " + zw + " px)");
  await p.click('.pv [data-pv="fit"]'); await p.waitForTimeout(400);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/viewer.png" });
  await p.click('.pv [data-pv="report"]'); await p.waitForSelector(".izr", { timeout: 4000 }).catch(() => {}); await p.waitForTimeout(500);
  ok(!(await p.$(".pv")) && !!(await p.$(".izr")), "Report closes the viewer and opens the report form");
  await p.check('.izr input[value="copyright"]');
  await p.fill("#izrT", "Looks copied from a textbook");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/report.png" });
  // signed in only for the send (signing in at boot brings up the App Lock chooser over everything)
  await p.evaluate(() => Object.defineProperty(window, "SMD_AUTH", { configurable: true, value: { currentUser: { getIdToken: () => Promise.resolve("t") } } }));
  await p.click(".izr-send"); await p.waitForTimeout(500);
  const sent = await p.evaluate(() => window.__sent.slice(-1)[0]);
  ok(sent && sent.action === "image" && sent.image.reason === "copyright", "it sends action image with the reason");
  ok(sent && /\/api\/prep\/bank\/|^https:/.test(sent.image.src), "with the image's address: " + (sent && sent.image.src));
  ok(sent && /Pathophysiology|Pathogenesis/.test(sent.image.title) && /Meningitis/.test(sent.image.where), "with its title and where it was seen: " + (sent && sent.image.title + " / " + sent.image.where));
  ok(/Sent/.test(await p.evaluate(() => (document.querySelector("#izrM") || {}).textContent || "")), "the doctor sees it was sent");

  // An icon is not an image to open.
  await p.waitForTimeout(2000);
  const iconOpened = await p.evaluate(() => { const i = document.createElement("img"); i.className = "x-icon"; i.src = "/icons/icon-192.png"; i.style.cssText = "position:fixed;left:10px;top:200px;width:24px;height:24px;z-index:99999"; document.body.appendChild(i); i.click(); return new Promise((r) => setTimeout(() => r(!!document.querySelector(".pv")), 300)); });
  ok(!iconOpened, "a small icon does not open the viewer");

  // Image Library viewer: Report reaches the same form.
  await p.evaluate(() => { document.querySelector(".izr")?.remove(); window.SMD_IMGLIB.open({ system: "eye" }); });
  await p.waitForSelector(".igl-card", { timeout: 20000 });
  const tw = await p.evaluate(() => [...document.querySelectorAll(".igl-thumb")].slice(0, 40).map((t) => { const im = t.querySelector("img"), w = t.querySelector(".smd-wm"); return { ext: /wikimedia/.test(im.src), w: !!w, marks: w ? w.querySelectorAll(".smd-wm-big").length : 0 }; }));
  ok(tw.length && tw.every((t) => t.w), "every Image Library thumbnail carries the watermark");
  ok(tw.every((t) => (t.ext ? t.marks === 0 : t.marks === 1)), "Commons images get the Powered by line only, ours the big mark too");
  const tl = await p.evaluate(`[...document.querySelectorAll(".igl-thumb .smd-wm")].slice(0, 40).map((w) => ({ ext: w.classList.contains("smd-wm--ext"), look: window.__wmLook(w) }))`);
  ok(tl.length && tl.every((t) => t.look.by && !t.look.sm && t.look.big === !t.ext), "Image Library: the PrepNucleus look (centre mark on ours, corner lockup on all), no StewardMD corner " + JSON.stringify(tl[0]));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/library-wm.png" });
  await p.click(".igl-card"); await p.waitForSelector('[data-igl="vreport"]', { timeout: 5000 }).catch(() => {});
  ok(!!(await p.$('[data-igl="vreport"]')), "the Image Library viewer has Report");
  await p.waitForFunction(() => { const i = document.querySelector(".igl-vimg"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(300);
  const iv = await p.evaluate(`(() => { const im = document.querySelector(".igl-vimg"); window.__ivdbg = [im.naturalWidth, im.offsetWidth, im.offsetHeight, im.src.slice(0, 80)]; const v = document.querySelector(".igl-viewer"), w = v.querySelector(".smd-wm--follow"); const all = [...document.querySelectorAll(".igl-body .smd-wm")];
    return { z: getComputedStyle(v).zIndex, iso: getComputedStyle(v).isolation, follow: w ? window.__wmLook(w) : null, under: all.length, img: window.__ivdbg }; })()`);
  ok(iv.z === "5" && iv.iso === "isolate", "the Image Library viewer stacks above the grid, so thumbnail marks do not show through it " + JSON.stringify(iv));
  ok(iv.follow && iv.follow.big && iv.follow.by && !iv.follow.sm && iv.follow.corner < 40, "the Image Library viewer: one centre PrepNucleus mark and the lockup in the corner " + JSON.stringify(iv.follow));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/library-viewer.png" });
  const barOk = await p.evaluate(() => { const bar = document.querySelector(".igl-vbar"); return bar && bar.scrollWidth <= bar.clientWidth + 1; });
  ok(barOk, "the Image Library viewer bar fits 390 px");
  await p.click('[data-igl="vreport"]');
  ok(!!(await p.$(".izr")), "Image Library Report opens the report form");
  ok(!errs.length, "no uncaught error" + (errs.length ? ": " + errs.slice(0, 2).join(" | ") : ""));
} finally { await b.close(); srv.kill(); }
console.log(fails ? fails + " FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
