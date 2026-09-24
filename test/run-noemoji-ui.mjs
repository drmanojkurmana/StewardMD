/* emoji-icons.js in the real app: no emoji left in visible text on the main screens, icons drawn in
 * their place, typography kept, flag off restores emoji. USAGE: node test/run-noemoji-ui.mjs
 * (Playwright; serves the repo on :8991 itself). SHOTS=<dir> saves before/after screenshots. */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8991/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8991"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// Emoji still visible as text (typography excluded by the module's own classifier; inputs excluded).
const COUNT = () => {
  const E = window.SMD_EMOJI_ICONS, out = [], dashes = [], books = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    const p = n.parentElement;
    if (!p || p.closest("script,style,textarea,[contenteditable]")) continue;
    const r = p.getBoundingClientRect(); if (!r.width && !r.height) continue;   // not rendered
    if (E.has(n.nodeValue)) out.push(n.nodeValue.trim().slice(0, 40));
    if (/[\u2014\u2015]|(^|\s)--(\s|$)/.test(n.nodeValue)) dashes.push(n.nodeValue.trim().slice(0, 40));
    if (E.hasBooks && E.hasBooks(n.nodeValue)) books.push(n.nodeValue.trim().slice(0, 50));
  }
  const vis = Array.from(document.querySelectorAll(".smd-emo,.smd-emo-dot")).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; }).length;
  const empties = Array.from(document.querySelectorAll("*")).filter((e) => e.children.length === 0 && e.textContent === "\u2013" && e.getBoundingClientRect().width).length;
  return { left: out.length, sample: out.slice(0, 5), icons: vis, dashes: dashes.length, dsample: dashes.slice(0, 4), books: books.length, bsample: books.slice(0, 3), empties };
};

async function run(flagOff) {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (flagOff) await ctx.addInitScript(() => { try { localStorage.setItem("smd_noemoji", "0"); localStorage.setItem("smd_nodash", "0"); localStorage.setItem("smd_nobooks", "0"); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.SMD_EMOJI_ICONS && window.ICONS, null, { timeout: 30000 });
  await page.waitForTimeout(9000);
  await page.evaluate(() => ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => document.getElementById(k)?.remove()));
  const res = {};
  const screens = [
    ["home", async () => {}],
    ["search", async () => { await page.evaluate(() => document.getElementById("smdSearchBtn").click()); }],
    ["contact", async () => { await page.evaluate(() => { const p = document.getElementById("smdSearchPanel"); if (p) p.classList.remove("open"); openModal("contactModal"); }); }],
    ["storage", async () => { await page.evaluate(() => { try { closeModal(); } catch (e) {} const m = document.getElementById("storageChoiceModal"); if (m) { m.classList.remove("hidden"); m.style.display = "flex"; } }); }],
    ["library", async () => { await page.evaluate(() => { const m = document.getElementById("storageChoiceModal"); if (m) { m.classList.add("hidden"); m.style.display = ""; } SB.openRef("syndromes"); }); }],
    ["antibiogram", async () => { await page.evaluate(() => SB.openRef("antibiogram")); }],
    ["icu-patient", async () => { await page.evaluate(() => { try { SB.closeRef(); } catch (e) {} ICU.reset(); ICU.ingestPatient({ name: "TEST", age: 60, sex: "M", bed: "2", diagnosis: "Sepsis" }); ICU.open("treatment"); }); }],
    ["icu-overview", async () => { await page.evaluate(() => { try { ICU.open("overview"); } catch (e) {} }); }],
    ["maik", async () => { await page.evaluate(() => { try { SB.closeRef(); } catch (e) {} SMD_askMaik(""); }); }],
  ];
  for (const [name, go] of screens) {
    await go(); await page.waitForTimeout(1500);
    res[name] = await page.evaluate(COUNT);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/noemoji-${name}-${flagOff ? "before" : "after"}.png` });
  }
  const dialog = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 2500));
    let sent = null; const orig = window.SMD_PDF && window.SMD_PDF.fromHtml;
    return typeof window.confirm === "function" && window.confirm._smdNoEmoji === true
      && (window.SMD_PDF = { fromHtml: function (h) { return h; } }, window.SMD_PDF.fromHtml._smdNoEmoji === true && window.SMD_PDF.fromHtml("<p>✅ Done</p>") === "<p>Done</p>")
      && (window.SMD_NATIVE = { sharePdfFromHtml: function (h) { return h; } }, window.SMD_NATIVE.sharePdfFromHtml("<b>🩺 Note</b>") === "<b>Note</b>")
      && !!(navigator.clipboard && navigator.clipboard.writeText && navigator.clipboard.writeText._smdNoEmoji);
  });
  res.dialogWrapped = { left: 0, icons: 0, wrapped: dialog };
  await browser.close();
  return { res, errs };
}

const on = await run(false);
for (const [k, v] of Object.entries(on.res)) ok(v.left === 0, `${k}: no emoji left in visible text (${v.icons} icons on screen)` + (v.left ? " " + JSON.stringify(v.sample) : ""));
for (const [k, v] of Object.entries(on.res)) if (k !== "dialogWrapped") ok(v.dashes === 0, `${k}: no AI dashes left in visible text` + (v.dashes ? " " + JSON.stringify(v.dsample) : ""));
for (const [k, v] of Object.entries(on.res)) if (k !== "dialogWrapped") ok(v.books === 0, `${k}: no textbook names or page numbers in visible text` + (v.books ? " " + JSON.stringify(v.bsample) : ""));
ok(on.res["icu-overview"].empties > 5, "ICU empty vitals still show an empty marker (\u2013): " + on.res["icu-overview"].empties);
ok(on.res.contact.icons >= 5, "Contact Us shows icons where emoji were: " + on.res.contact.icons);
ok(Object.values(on.res).reduce((a, v) => a + v.icons, 0) > 0, "icons are drawn in place of emoji");
ok(on.res.dialogWrapped.wrapped, "alert/confirm/prompt, PDF export and clipboard are emoji-stripped at their entry points");
delete on.res.dialogWrapped;
const off = await run(true);
const offLeft = Object.values(off.res).reduce((a, v) => a + v.left, 0);
const offDash = Object.values(off.res).reduce((a, v) => a + (v.dashes || 0), 0);
ok(offDash > 0, `flag off: dashes as authored (${offDash} text nodes with em dashes)`);
ok(offLeft > 0, `flag smd_noemoji=0: emoji left as they were (${offLeft} text nodes with emoji)`);
const newErrs = on.errs.filter((e) => !off.errs.includes(e));
ok(newErrs.length === 0, "no page errors introduced " + JSON.stringify(newErrs));
if (serve) serve.kill();
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
