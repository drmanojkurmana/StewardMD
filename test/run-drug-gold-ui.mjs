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

  /* ── the library really is the whole library ────────────────────────────────────────── */
  const stats = await page.evaluate(() => SMD_OFFLINE_CLINICAL.stats());
  ok(stats && stats.struct > 1600 && stats.index > 1600, "bundle + supplement + index all loaded: " + JSON.stringify(stats));

  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
} finally {
  await browser.close();
  if (serve) serve.kill();
}
process.exit(fails ? 1 : 0);
