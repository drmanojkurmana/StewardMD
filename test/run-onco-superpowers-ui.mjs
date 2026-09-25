/* BUG-006 in the real app: the four oncology "superpower" buttons on a regimen card.
 *
 * QA reported that Cycle Timeline / Organ Dose / DDI Sentry / Genomics did nothing. Each is a
 * data-ot-act button on a selected protocol card; the handler in oncotree.js sets
 * st.superpowerModal and calls renderSuperpowerModal(). The failure mode that matters is not a
 * thrown error but a silent one: the tool module has not loaded, so the handler falls through to
 * superpowerNotice() and the doctor sees a "still loading" card that never resolves.
 *
 * So this clicks the real buttons and asserts each opens a modal with its OWN content, and
 * explicitly fails on the "still loading" notice rather than counting it as "a sheet appeared".
 *
 * USAGE: node test/run-onco-superpowers-ui.mjs   (Playwright; serves the repo on :8998 itself)
 * SHOTS=<dir> also saves screenshots. */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:8998/").replace(/\/?$/, "/");
const SHOTS = process.env.SHOTS || "";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }

let serve = null;
try { await fetch(BASE); } catch {
  serve = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), (BASE.match(/:(\d+)/) || [, "8998"])[1]], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }
}
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

// `marker` is the wrapper each tool renders its own body into. Asserting on it rather than on the
// length of the html matters: "no interactions found" is a correct 297-character answer for a
// single-agent endocrine regimen, and a length threshold would have called that a failure.
const TOOLS = [
  { act: "cycle-timeline",   title: /Cycle Calendar|Nadir Timeline/i,     marker: "ot-cycle-timeline-card" },
  { act: "organ-dose-check", title: /Organ Function|Calvert/i,            marker: "ot-organ-eval" },
  { act: "ddi-check",        title: /Interaction Sentry|DDI/i,            marker: "ot-ddi-eval" },
  { act: "genomics-drawer",  title: /Molecular Tumor Board|Precision/i,   marker: "ot-genomics-eval" }
];

const browser = await pw.chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => window.SMD_ONCOTREE, null, { timeout: 30000 });
  await page.evaluate(() => { ["introPoster", "splash", "accountGate", "introOverlay", "smdBootSplash"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); });
  await page.waitForTimeout(6000);

  // The tool modules load lazily beside the navigator; without them every button degrades to the
  // "still loading" notice, which is the exact regression this test is here to catch.
  await page.evaluate(() => SMD_ONCOTREE.open());
  await page.waitForTimeout(2500);
  const mods = await page.evaluate(() => ({
    timeline: !!window.SMD_ONCO_TIMELINE, organ: !!window.SMD_ONCO_ORGAN_DOSE,
    ddi: !!window.SMD_ONCO_DDI, genomics: !!window.SMD_ONCO_GENOMICS
  }));
  console.log("      tool modules: " + JSON.stringify(mods));

  // Reach real protocol data the way a doctor does: open a disease so its regimens load.
  await page.evaluate(() => {
    const d = document.querySelector("[data-ot-disease], .ot-disease");
    if (d) d.click();
  });
  await page.waitForTimeout(3000);
  const protoRef = await page.evaluate(() => {
    const p = SMD_ONCOTREE._st.protocols || {};
    const keys = Object.keys(p);
    return keys.length ? keys[0] : "";
  });
  ok(!!protoRef, "a disease's regimens loaded, so there is a real protocol to run the tools on: " + (protoRef || "NONE"));

  for (const t of TOOLS) {
    // The buttons live on a regimen card several answers deep. Rather than hard-code one pathway's
    // questions (which would break the moment the guideline changes), this puts a real button with
    // the real protocol ref into the navigator and clicks it, so the delegated handler, the lazily
    // loaded tool module and the protocol data are all exercised exactly as on the card. The card's
    // own markup is asserted from source below.
    const res = await page.evaluate(async (args) => {
      const [act, ref] = args;
      const st = SMD_ONCOTREE._st;
      st.superpowerModal = null;
      const host = document.querySelector(".ot-wrap, #otBody, .ot-body, #smdOncoTree") || document.body;
      const b = document.createElement("button");
      b.className = "ot-btn ghost sm t_super";
      b.setAttribute("data-ot-act", act);
      b.setAttribute("data-ot-proto", ref);
      host.appendChild(b);
      b.click();
      await new Promise((r) => setTimeout(r, 1200));
      b.remove();
      const m = st.superpowerModal;
      const el = document.querySelector(".ot-super-modal, #otSuperModal, .ot-modal, .oh-overlay");
      return {
        title: m ? String(m.title || "") : "",
        html: m ? String(m.html || "") : "",
        len: m ? String(m.html || "").length : 0,
        onScreen: !!(el && el.getBoundingClientRect().height > 0)
      };
    }, [t.act, protoRef]);

    const stillLoading = /still loading|Try again in a moment/i.test(res.html);
    ok(!!res.title, t.act + ": a sheet opened (title: " + (res.title || "NONE") + ")");
    ok(t.title.test(res.title), t.act + ": the sheet is its OWN tool, not another one's");
    ok(!stillLoading, t.act + ": real content, not the 'still loading' notice");
    ok(res.html.indexOf(t.marker) >= 0, t.act + ": the sheet holds this tool's own rendered body (." + t.marker + ")");
    if (SHOTS) await page.screenshot({ path: SHOTS + "/onco-" + t.act + ".png" });
    await page.evaluate(() => { SMD_ONCOTREE._st.superpowerModal = null; });
  }

  // The regimen card must still carry all four buttons, or the handlers above are unreachable.
  const src = await (await fetch(BASE + "oncotree.js")).text();
  for (const t of TOOLS) ok(src.includes('data-ot-act="' + t.act + '"'), t.act + ": the regimen card still renders its button");

  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
} finally {
  await browser.close();
  if (serve) serve.kill();
}
process.exit(fails ? 1 : 0);
