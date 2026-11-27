/* Drugs screen: molecules with no Indian brand (the Oxandrolone report, 2026-11-27).
 * Real headless Chromium against the repo served by test/serve.mjs. The brand API is stubbed to answer
 * nothing, which is what api.stewardmd.in returns for a molecule nobody sells in India, so the
 * screen must fall through to the bundled monograph index (FDA-label rows, synonyms) and, for a
 * name that is nowhere, show the explained empty state.
 * USAGE: node test/run-drug-missing-ui.mjs   (PORT=8911 by default)
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || "8911";
const BASE = `http://localhost:${PORT}/`;
const srv = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), PORT], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await sleep(200); } }

let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/api.stewardmd.in/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) }));
  await page.goto(BASE);
  await page.waitForFunction(() => !!(window.MEDDB && MEDDB.openList && window.SMD_OFFLINE_CLINICAL), null, { timeout: 40000 });
  await page.evaluate(() => { ["smdBootSplash", "introPoster", "splash", "accountGate", "introOverlay"].forEach((k) => { const e = document.getElementById(k); if (e) e.remove(); }); MEDDB.openList(); });
  await page.waitForSelector("#dbSearch");
  async function search(q) {
    if (!(await page.$("#dbSearch"))) { await page.evaluate(() => { MEDDB.close(); MEDDB.openList(); }); await page.waitForSelector("#dbSearch"); }
    await page.fill("#dbSearch", q);
    await page.waitForFunction(() => { const r = document.querySelector("#dbResults"); return r && !/Searching/.test(r.textContent) && r.textContent.trim().length > 0; }, null, { timeout: 15000 });
    await sleep(400);
    return page.evaluate(() => document.querySelector("#dbResults").innerText);
  }
  const ox = await search("Oxandrolone");
  ok(/oxandrolone/i.test(ox) && !/No drugs match/.test(ox), "Oxandrolone is found (FDA-label monograph row): " + ox.split("\n").slice(0, 3).join(" | "));
  await page.screenshot({ path: process.env.SHOT || join(process.env.TMPDIR || "/tmp", "drug-missing-oxandrolone.png") });
  const syn = await search("benzylpenicillin");
  ok(/Penicillin G/.test(syn), "benzylpenicillin finds Penicillin G");
  const co = await search("cotrimoxazole");
  ok(/Co-Trimoxazole/i.test(co), "cotrimoxazole (no hyphen) finds Co-Trimoxazole");
  const none = await search("Zzqxolone");
  ok(/No drugs match/.test(none) && /not be marketed in India/.test(none), "a name that is nowhere explains why: " + none.replace(/\n/g, " "));
  ok(!/[—]/.test(none), "empty state has no em-dash");
  // Opening the Oxandrolone row loads its label monograph.
  await search("Oxandrolone");
  await page.click('#dbResults .db-comp[data-comp="oxandrolone"]');
  await page.waitForFunction(() => /peliosis hepatis/i.test(document.body.innerText), null, { timeout: 15000 }).then(() => ok(true, "opening Oxandrolone shows its FDA label (boxed warning)"), () => ok(false, "opening Oxandrolone shows its FDA label"));
  // Draft monographs (data/authored/, smd_drug_drafts default OFF): hidden until the flag is on.
  const offRes = await search("Oxetacaine");
  ok(/No drugs match/.test(offRes), "drafts OFF: Oxetacaine (draft only) is not listed");
  await page.evaluate(() => { localStorage.setItem("smd_drug_drafts", "1"); });
  const onRes = await search("Oxetacaine");
  ok(/Oxetacaine/.test(onRes) && /draft monograph/.test(onRes) && !/No drugs match/.test(onRes), "drafts ON: Oxetacaine is listed as a draft monograph");
  await page.click('#dbResults .db-comp[data-comp="Oxetacaine"]');
  await page.waitForFunction(() => /Draft monograph\./.test(document.body.innerText) && /gastritis/i.test(document.body.innerText), null, { timeout: 15000 })
    .then(() => ok(true, "opening a draft shows the Draft banner and its content"), () => ok(false, "opening a draft shows the Draft banner"));
  await sleep(1200);
  await page.screenshot({ path: process.env.SHOT2 || join(process.env.TMPDIR || "/tmp", "drug-draft-oxetacaine.png") });
  // A catalogue combination whose component is spelled differently resolves per component.
  const combo = await page.evaluate(() => window.SMD_OFFLINE_CLINICAL && SMD_OFFLINE_CLINICAL.structured
    ? SMD_OFFLINE_CLINICAL.structured("Piperacillin + Tazobactum").then((r) => JSON.stringify(r.components.map((c) => [c.name, !!c.data])))
    : "no-structured");
  ok(/\["Tazobactum",true\]/.test(combo || ""), "Piperacillin + Tazobactum: the Tazobactum component resolves (" + combo + ")");
  await page.evaluate(() => localStorage.removeItem("smd_drug_drafts"));
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `${fails} FAILED` : "ALL PASS");
process.exit(fails ? 1 : 0);
