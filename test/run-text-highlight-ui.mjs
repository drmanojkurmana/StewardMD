/* text-highlight.js in the real app: the PrepNucleus Learn reader (sample lesson sur-breast-cancer) and a
 * KB-reader-shaped container. Select text -> palette under it -> colour, Bold, Remove; highlights come back after a
 * page turn and after a reload; tapping a highlight edits it; the list jumps to it; flag smd_hl=0 turns it off.
 * USAGE: node test/run-text-highlight-ui.mjs  (Playwright; serves the repo itself). SHOTS=<dir> saves screenshots. */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort } from "./free-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (await freePort()) + "/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";
const FIX = "/test/fixtures/prep-lessons/";
const MID = "sur-breast-cancer";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), BASE.match(/:(\d+)/)[1]], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const errors = [];
const browser = await pw.chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(`window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.SMD_PREP_FLAG_API="/test/fixtures/prep/hidden.json"; window.SMD_PREP_ONBOARD=false; window.SMD_PREP_VOICE=false;`);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { if (/highlight|SMD_HL|smd-hl/.test(String(e.stack || e))) errors.push(String(e)); });
  const clean = () => page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  const openLesson = async () => {
    await page.evaluate(() => PREP.open({ subject: "surgery" }));
    await page.waitForSelector(`#smdPrep .pn-mod[data-m=${MID}]`, { timeout: 20000 });
    await page.evaluate((m) => document.querySelector(`#smdPrep .pn-mod[data-m=${m}]`).click(), MID);
    await page.waitForSelector("#smdPrep [data-act=l-open]", { timeout: 8000 });
    await page.evaluate(() => document.querySelector("#smdPrep [data-act=l-open]").click());
    await page.waitForSelector("#smdPrep .pn-lsn-tx", { timeout: 8000 });
  };
  // Select the given word (n-th occurrence) inside a container, the way a long-press does.
  const select = (sel, word, from = 0) => page.evaluate(([sel, word, from]) => {
    const root = document.querySelector(sel), w = document.createTreeWalker(root, 4);
    let n, seen = 0;
    while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(word); if (i >= 0 && seen++ >= from) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; } }
    return false;
  }, [sel, word, from]);
  const palOn = () => page.waitForFunction(() => { const p = document.querySelector(".smd-hlp"); return p && p.classList.contains("on"); }, null, { timeout: 3000 }).then(() => true, () => false);
  const saved = (key) => page.evaluate((k) => (JSON.parse(localStorage.getItem("smd_hl_v1") || "{}")[k] || []), key);

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.PREP, null, { timeout: 30000 });
  await page.evaluate(() => { localStorage.setItem("smd_prep", "1"); localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_hl_v1"); indexedDB.deleteDatabase("prep-bank"); });
  await page.goto(BASE + "?prep=1", { waitUntil: "load" });
  await page.waitForFunction(() => !!(window.PREP && window.SMD_HL), null, { timeout: 30000 });
  await clean();
  await page.evaluate(() => document.body.classList.add("dark"));
  ok(await page.evaluate(() => typeof SMD_HL.apply === "function" && SMD_HL.enabled()), "text-highlight.js loads, on by default");

  await openLesson();
  const key = await page.getAttribute("#smdPrep .pn-lsn-tx", "data-hl-key");
  ok(/^ls:.+:0$/.test(key || ""), "lesson text carries data-hl-key (" + key + ")");
  const text0 = await page.evaluate(() => document.querySelector("#smdPrep .pn-lsn-tx").textContent);
  const word = (text0.match(/\b[a-z]{7,}\b/i) || [])[0];
  ok(!!word, "picked a word from step 1: " + word);

  // ---- select -> palette under the selection
  await select("#smdPrep .pn-lsn-tx", word);
  ok(await palOn(), "selecting text in the lesson shows the palette");
  const geo = await page.evaluate(() => { const p = document.querySelector(".smd-hlp").getBoundingClientRect(), r = getSelection().getRangeAt(0).getBoundingClientRect(); return { below: p.top >= r.bottom, inside: p.left >= 0 && p.right <= innerWidth, dots: document.querySelectorAll(".smd-hlp-dot").length, bold: !!document.querySelector('.smd-hlp [data-hl-act=b]'), x: !!document.querySelector('.smd-hlp [data-hl-act=x]') }; });
  ok(geo.below && geo.inside, "palette sits under the selection, on screen");
  ok(geo.dots === 7 && geo.bold && geo.x, "7 colours, Bold and Remove");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "hl-palette.png") });

  // ---- yellow
  await page.click('.smd-hlp [data-hl-act=c][data-c="1"]');
  ok(await page.evaluate((w) => { const m = document.querySelectorAll('#smdPrep .pn-lsn-tx mark.smd-hl[data-hl-c="1"]'); return m.length >= 1 && Array.from(m).map((x) => x.textContent).join("") === w; }, word), "yellow mark wraps exactly the selected word");
  ok(await page.evaluate(() => getComputedStyle(document.querySelector("mark.smd-hl")).backgroundColor !== "rgba(0, 0, 0, 0)"), "the mark is visibly tinted");
  let s = await saved(key);
  ok(s.length === 1 && s[0].q === word && s[0].c === 1 && !s[0].b, "saved on the device under the step key");

  // ---- palette stays on the new highlight: add Bold
  ok(await page.evaluate(() => document.querySelector(".smd-hlp").classList.contains("on") && document.querySelector('.smd-hlp-dot[data-c="1"]').classList.contains("on")), "palette stays open with yellow marked");
  await page.click(".smd-hlp [data-hl-act=b]");
  ok(await page.evaluate(() => { const m = document.querySelector("#smdPrep mark.smd-hl"); return m.classList.contains("smd-hl-b") && +getComputedStyle(m).fontWeight >= 700; }), "Bold adds weight to the same highlight");
  s = await saved(key);
  ok(s.length === 1 && s[0].b === true && s[0].c === 1, "colour and bold kept together");
  ok(await page.evaluate(() => document.querySelectorAll(".smd-hlp-list .smd-hlp-item").length === 1), "the palette lists the page's highlight");

  // ---- Bold only, on a second word
  const word2 = (text0.match(/\b[a-z]{6,}\b/gi) || []).find((w) => w !== word && text0.indexOf(w) > text0.indexOf(word) + word.length);
  await page.evaluate(() => { document.querySelector(".smd-hlp").classList.remove("on"); });
  await select("#smdPrep .pn-lsn-tx", word2);
  ok(await palOn(), "second selection opens the palette");
  await page.click(".smd-hlp [data-hl-act=b]");
  ok(await page.evaluate((w) => { const m = Array.from(document.querySelectorAll("#smdPrep mark.smd-hl.smd-hl-b")).find((x) => x.textContent === w); return !!m && !m.hasAttribute("data-hl-c"); }, word2), "Bold alone makes bold text with no colour (" + word2 + ")");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "hl-step.png") });

  // ---- page turn and back: highlights return
  await page.evaluate(() => document.querySelector("#smdPrep [data-act=l-next]").click());
  await page.waitForFunction(() => /Step 2/.test(document.querySelector("#smdPrep .pn-t p").textContent));
  ok(await page.evaluate(() => !document.querySelector("#smdPrep mark.smd-hl")), "step 2 has none of step 1's highlights");
  await page.evaluate(() => document.querySelector("#smdPrep [data-act=l-prev]").click());
  await page.waitForFunction(() => /Step 1/.test(document.querySelector("#smdPrep .pn-t p").textContent));
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => document.querySelectorAll("#smdPrep .pn-lsn-tx mark.smd-hl").length >= 2), "back on step 1 both highlights are drawn again");

  // ---- reload the app: still there
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!(window.PREP && window.SMD_HL), null, { timeout: 30000 });
  await clean();
  await openLesson();
  await page.waitForTimeout(100);
  ok(await page.evaluate((w) => { const m = document.querySelector('#smdPrep mark.smd-hl[data-hl-c="1"]'); return !!m && m.textContent === w && m.classList.contains("smd-hl-b"); }, word), "after a reload the yellow bold highlight comes back");

  // ---- tap an existing highlight: edit, then Remove
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.click('#smdPrep mark.smd-hl[data-hl-c="1"]');
  ok(await palOn(), "tapping a highlight opens the palette for it");
  ok(await page.evaluate(() => document.querySelector('.smd-hlp-dot[data-c="1"]').getAttribute("aria-pressed") === "true" && document.querySelector(".smd-hlp [data-hl-act=b]").getAttribute("aria-pressed") === "true"), "it shows the current colour and bold as pressed");
  await page.click('.smd-hlp [data-hl-act=c][data-c="3"]');
  ok(await page.evaluate(() => !!document.querySelector('#smdPrep mark.smd-hl[data-hl-c="3"]') && !document.querySelector('#smdPrep mark.smd-hl[data-hl-c="1"]')), "a new colour recolours it in place");
  ok((await saved(key)).some((r) => r.c === 3), "the new colour is saved");
  await page.click(".smd-hlp [data-hl-act=x]");
  ok(await page.evaluate(() => !document.querySelector('#smdPrep mark.smd-hl[data-hl-c="3"]') && !document.querySelector(".smd-hlp").classList.contains("on")), "Remove unwraps it and closes the palette");
  ok(await page.evaluate((t) => document.querySelector("#smdPrep .pn-lsn-tx").textContent === t, text0), "the step text is unchanged after all of it");
  ok((await saved(key)).length === 1, "one highlight left in storage");

  // ---- a selection gesture does not turn the page
  await select("#smdPrep .pn-lsn-tx", word);
  const stepBefore = await page.evaluate(() => document.querySelector("#smdPrep .pn-t p").textContent);
  const box = await page.evaluate(() => { const r = document.querySelector("#smdPrep .pn-lsn-tx").getBoundingClientRect(); return { x: r.left + r.width * 0.8, y: r.top + 10 }; });
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector("#smdPrep #pnLsn") || document.querySelector("#smdPrep .pn-lsn-tx");
    const mk = (t, cx) => new PointerEvent(t, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: cx, clientY: y, isPrimary: true });
    el.dispatchEvent(mk("pointerdown", x)); el.dispatchEvent(mk("pointerup", x - 200));
  }, box);
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.querySelector("#smdPrep .pn-t p").textContent) === stepBefore, "a horizontal drag while text is selected keeps the step");
  await page.evaluate(() => { getSelection().removeAllRanges(); document.querySelector(".smd-hlp").classList.remove("on"); });

  // ---- KB-reader-shaped container (same opt-in as reasoning.js: .kbr-read data-hl-key="kb:<id>")
  await page.evaluate(() => {
    PREP.close && PREP.close();
    const d = document.createElement("div"); d.id = "hlKb"; d.style.cssText = "position:fixed;inset:80px 16px auto;z-index:99999;background:#111;color:#eee;padding:12px;font:17px/1.5 sans-serif";
    d.innerHTML = '<div class="kbr-read" data-hl-key="kb:test-disease"><p>Start <b>ceftriaxone</b> early in sepsis.</p><ul><li>Give fluids early, 30 mL/kg.</li></ul><button>Save</button></div>';
    document.body.appendChild(d);
  });
  // select across the bold term and the paragraph end
  await page.evaluate(() => { const p = document.querySelector("#hlKb p"), r = document.createRange(); r.setStart(p.firstChild, 6); r.setEnd(p.lastChild, 6); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  ok(await palOn(), "KB reader text shows the palette");
  await page.click('.smd-hlp [data-hl-act=c][data-c="2"]');
  ok(await page.evaluate(() => Array.from(document.querySelectorAll('#hlKb mark.smd-hl[data-hl-c="2"]')).map((m) => m.textContent).join("") === "ceftriaxone early" && !!document.querySelector("#hlKb b mark.smd-hl")), "a highlight can cross a bold term (one mark per text node)");
  await page.evaluate(() => { const r = document.querySelector("#hlKb .kbr-read"); r.innerHTML = r.innerHTML.replace(/<mark[^>]*>|<\/mark>/g, ""); });
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => document.querySelectorAll("#hlKb mark.smd-hl").length === 2), "re-rendered KB content gets its highlight back");
  ok((await saved("kb:test-disease")).length === 1, "KB highlight saved under kb:<id>");

  // ---- the list jumps to a highlight
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.click('#hlKb mark.smd-hl');
  await palOn();
  ok(await page.evaluate(() => document.querySelectorAll(".smd-hlp-item").length === 1 && /ceftriaxone early/.test(document.querySelector(".smd-hlp-item").textContent)), "the list shows the page's highlight text");
  await page.click(".smd-hlp-item");
  ok(await page.evaluate(() => !document.querySelector(".smd-hlp").classList.contains("on")), "tapping a listed highlight closes the palette (and scrolls to it)");

  // ---- flag off
  await page.evaluate(() => { localStorage.setItem("smd_hl", "0"); });
  await page.evaluate(() => { const r = document.querySelector("#hlKb li"), g = document.createRange(); g.selectNodeContents(r); const s = getSelection(); s.removeAllRanges(); s.addRange(g); });
  ok(!(await palOn()), "smd_hl=0: no palette");
  await page.evaluate(() => { localStorage.removeItem("smd_hl"); document.getElementById("hlKb").remove(); });

  ok(errors.length === 0, "no highlight errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (e) { console.log("FAIL harness: " + (e && e.stack || e)); fails++; }
finally { await browser.close(); if (serve) serve.kill(); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
