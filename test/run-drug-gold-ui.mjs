/* BUG-002 in the real app: a molecule whose monograph we ship must be findable and openable.
 *
 * QA searched a reserve antibiotic and got "No drugs match", although data/offline-clinical.json.gz
 * held its full authored monograph. The server indexes the Indian BRAND catalogue, so a drug nobody
 * sells here has no row; the only client fallback was the 109-molecule formulary in drugs.js.
 *
 * This harness has no network to the drug API (the sandbox blocks it), which is exactly the state
 * the bundled library exists for, and the state QA's screenshot showed. USAGE:
 *   node test/run-drug-gold-ui.mjs        (Playwright; serves the repo on :8997 itself)
 * SHOTS=<dir> also saves screenshots. */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8997/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }

let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8997"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const browser = await pw.chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.MEDDB && window.MEDAPI && window.SMD_OFFLINE_CLINICAL, null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  await page.waitForTimeout(6000);

  const type = async (q) => {
    await page.evaluate((qq) => { const i = document.querySelector("#dbSearch"); i.value = qq; i.dispatchEvent(new Event("input", { bubbles: true })); }, q);
    await page.waitForTimeout(3500);
    return page.evaluate(() => { const r = document.querySelector("#dbResults"); return r ? r.innerText : ""; });
  };

  await page.evaluate(() => MEDDB.openList());
  await page.waitForTimeout(1200);

  /* ── the reported bug ───────────────────────────────────────────────────────────────── */
  const cef = await type("Cefiderocol");
  ok(/Cefiderocol/.test(cef) && !/No drugs match/.test(cef), "the reported molecule is found, not 'No drugs match': " + cef.split("\n").slice(0, 3).join(" / "));
  if (SHOTS) await page.screenshot({ path: SHOTS + "/gold-search.png" });

  /* ── the 104 monographs no bundle contained until now ───────────────────────────────── */
  for (const q of ["Atropine sulfate", "Caspofungin acetate", "Enoxaparin sodium", "Clopidogrel bisulfate"]) {
    const t = await type(q);
    ok(new RegExp(q.split(" ")[0], "i").test(t) && !/No drugs match/.test(t), "supplement-only monograph is searchable: " + q);
  }

  /* ── a partial name, which is what actually gets typed on a phone ───────────────────── */
  const part = await type("cefider");
  ok(/Cefiderocol/.test(part), "a partial name finds it: " + part.split("\n").slice(0, 2).join(" / "));

  /* ── the empty state still tells the truth ──────────────────────────────────────────── */
  const none = await type("zzzznotadrug");
  ok(/No drugs match/.test(none), "nonsense still says so rather than showing loose matches: " + none.slice(0, 60));

  /* ── opening one renders the authored monograph, not a dead end ─────────────────────── */
  for (const name of ["Cefiderocol", "Caspofungin acetate"]) {
    await page.evaluate((n) => { MEDDB.openList(); MEDDB.openComposition(n); }, name);
    await page.waitForTimeout(6000);
    const d = await page.evaluate(() => {
      const c = document.querySelector("#dbMono");
      return { secs: [...(c ? c.querySelectorAll(".gd-h") : [])].map((x) => x.textContent.trim()), txt: c ? c.innerText : "" };
    });
    ok(d.secs.length >= 8 && /Quick Facts/.test(d.secs.join("|")) && /Dosage/.test(d.secs.join("|")),
      name + " opens on its full monograph (" + d.secs.length + " sections)");
    ok(!/No structured clinical record|Full monograph pending/.test(d.txt), name + " is not the 'pending' placeholder");
  }
  if (SHOTS) await page.screenshot({ path: SHOTS + "/gold-monograph.png" });

  /* ── the monograph must FIT the phone ───────────────────────────────────────────────── */
  // A bare `1fr` grid track carries an implicit min-width:auto, so one long value ("Serum
  // electrolytes, renal function, fluid balance, ECG (K+/Mg2+/Ca2+)") widened its own track and
  // pushed the right-hand column off the screen edge. Reported on the Electrolytes card.
  for (const name of ["Electrolytes", "Cefiderocol"]) {
    await page.evaluate((n) => { MEDDB.openList(); MEDDB.openComposition(n); }, name);
    await page.waitForTimeout(5000);
    const fit = await page.evaluate(() => {
      const host = document.querySelector("#dbMono");
      if (!host) return { err: "no #dbMono" };
      const over = [];
      host.querySelectorAll(".gd-qf,.gd-pk,.gd-2,.gd-chk,.gd-mon,.gd-kv,.gd-qf>div,.gd-pk>div").forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) over.push((el.className || el.tagName).toString().slice(0, 24));
      });
      // The dosage table is deliberately scrollable inside .gd-tw, so it is excluded above.
      return { over: over.slice(0, 6), pageScrolls: document.documentElement.scrollWidth > window.innerWidth + 1 };
    }, name);
    ok(fit.over && fit.over.length === 0, name + ": no card grid overflows its column (" + (fit.over || []).join(", ") + ")");
    ok(!fit.pageScrolls, name + ": the page does not scroll sideways");
  }

  /* ── the header gives the drug's name priority over the button label ────────────────── */
  const head = await page.evaluate(() => {
    const bb = document.querySelector("#dbBrandBtn"), t = document.querySelector("#dbTitle");
    if (!bb || !t) return { err: "no header" };
    const zero = getComputedStyle(bb).display === "none";     // no brands -> no "Available brands 0"
    bb.style.display = "";
    bb.innerHTML = '<span class="db-bb-lbl"><span class="db-bb-long">Available </span>Brands</span><span class="db-bb-ct">124</span>';
    return { zeroHidden: zero, title: t.textContent.trim(), clipped: t.scrollWidth > t.clientWidth + 1,
             pillRight: bb.getBoundingClientRect().right, vw: window.innerWidth };
  });
  ok(head.zeroHidden, "a molecule with no Indian brand shows no 'Available brands 0' pill");
  ok(!head.clipped && /Cefiderocol/i.test(head.title), "the drug name is not truncated by the brands pill: " + head.title);
  ok(head.pillRight <= head.vw + 1, "the pill stays inside the screen even with a 3-digit count");

  /* ── the library really is the whole library ────────────────────────────────────────── */
  const stats = await page.evaluate(() => SMD_OFFLINE_CLINICAL.stats());
  // 1,592 = the 1,541-row bundle plus the 51 supplement rows that are a genuinely new molecule.
  // The other 53 authored records are salt forms of a molecule the bundle already carries
  // ("Atropine sulfate" IS atropine) and are deliberately not shipped as a second row; the index
  // strips the counter-ion from a query instead, so those names are still findable.
  ok(stats && stats.struct > 1500 && stats.index === stats.struct,
    "bundle + supplement + index all loaded and agree: " + JSON.stringify(stats));

  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
} finally {
  await browser.close();
  if (serve) serve.kill();
}
process.exit(fails ? 1 : 0);
