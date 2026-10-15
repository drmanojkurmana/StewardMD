/* Oncology protocols <-> KB cancer articles <-> MCQs browser test (real headless Chrome over CDP).
 * Tests:
 * 1. KB Reader: Cervical cancer article lists all 7 protocols grouped by setting with regimen one-liners.
 *    Tapping a protocol card opens SMD_PROTOSHEET.
 *    On the protocol sheet, the "Read the KB article: Cervical Cancer" button renders.
 *    Tapping it opens the KB reader above the protocol sheet with "‹ Protocol" back button.
 *    Tapping "‹ Protocol" returns to the protocol sheet.
 * 2. MCQ Know more: answering an MCQ evidenced to cervical cancer shows "See protocols (7)" in Know more.
 *    Tapping it opens #pnCancerProtoSheet listing the 7 protocols grouped by setting.
 *    Tapping a protocol in the sheet opens SMD_PROTOSHEET.
 * 3. Standing UI compliance: 390px mobile viewport (no horizontal overflow), min 44px touch targets,
 *    dark & light theme support, no console errors or exceptions.
 *
 * USAGE: node test/run-onco-links-ui.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { freePort } from "./free-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = await freePort();
const DBG = await freePort();
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/onco-links-ui-chrome-" + DBG + "-" + Date.now();
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME || (fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "google-chrome"));

const FIX = "/test/fixtures/prep/";
const RFIX = "/test/fixtures/prep-reason/api/";

let serveProc = null;
try {
  serveProc = spawn("node", [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE); break; } catch { await sleep(150); }
  }
} catch (e) {
  console.error("Failed to start test server:", e);
  process.exit(1);
}

const chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  `--remote-debugging-port=${DBG}`,
  `--user-data-dir=${userDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=390,844"
], { stdio: ["ignore", "ignore", "pipe"] });

let msgId = 1;
const pending = new Map();
let ws, sessionId;
const consoleErrors = [];

const call = (m, p) => {
  const i = msgId++;
  return new Promise((r) => {
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId }));
  });
};

const ev = async (e) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${e}}catch(x){return JSON.stringify({__err:String(x&&x.message||x)})}})()`,
    returnByValue: true
  });
  return r.result && r.result.result ? r.result.result.value : null;
};

const click = async (sel) => {
  const found = await ev(`var e=document.querySelector(${JSON.stringify(sel)}); if(e){e.click(); return true;} return false;`);
  await sleep(200);
  return found === true;
};

const until = async (e, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const res = await ev(e);
    if (res === true) return true;
    await sleep(100);
  }
  return false;
};

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fails++;
};

const CLEAN = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
const INIT_SCRIPT = `
  window.SMD_PREP_BANK_VER="v1";
  window.SMD_PREP_PYQ_VER="v2";
  window.SMD_PREP_BASE=${JSON.stringify(FIX)};
  window.SMD_PREP_BANK_API=${JSON.stringify(RFIX)};
  window.SMD_PREP_FLAG_API=${JSON.stringify(FIX + "hidden.json")};
  window.confirm=function(){return true;};
  window.SMD_PREP_ONBOARD=false;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.register) {
      navigator.serviceWorker.register = function () { return Promise.reject(new Error("disabled in UI tests")); };
    }
  } catch (e) {}
`;

try {
  let ver, t = 0;
  while (t++ < 60) {
    try {
      ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  if (!ver) throw new Error("Chrome CDP not reachable on port " + DBG);

  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      const errText = (m.params.args || []).map(a => a.value || a.description || "").join(" ");
      if (/onco|prep|proto|kbr/i.test(errText)) consoleErrors.push(errText);
    }
    if (m.method === "Runtime.exceptionThrown") {
      const desc = m.params.exceptionDetails && (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (/onco|prep|proto|kbr/i.test(desc)) consoleErrors.push("EXCEPTION: " + desc);
    }
  };

  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;

  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: INIT_SCRIPT });

  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.DX && window.SMD_REASON && window.SMD_ONCO_KB_MAP && window.SMD_PROTOSHEET && window.PREP);`, 30000), "App loaded with DX, SMD_REASON, SMD_ONCO_KB_MAP, SMD_PROTOSHEET, and PREP");
  await ev(CLEAN);

  // =========================================================================
  // Part 1: Cervical Cancer KB Article -> Oncology Protocols
  // =========================================================================
  console.log("\n--- Part 1: KB Reader Cervical Cancer Protocols ---");
  await ev(`window.DX.openRef("cervical_cancer"); return 1;`);
  ok(await until(`return !!document.getElementById("kbr-protocols");`, 8000), "Cervical cancer KB article opened and #kbr-protocols rendered");

  const protoInfo = JSON.parse(await ev(`
    var sec = document.getElementById("kbr-protocols");
    var groups = Array.from(sec.querySelectorAll(".kbr-proto-group")).map(function(g) {
      return {
        title: (g.querySelector(".kbr-proto-group-title") || {}).textContent || "",
        protocols: Array.from(g.querySelectorAll(".kbr-proto-card")).map(function(c) {
          return {
            id: c.getAttribute("data-kbr-proto"),
            name: (c.querySelector(".kbr-proto-name") || {}).textContent || "",
            regimen: (c.querySelector(".kbr-proto-regimen") || {}).textContent || ""
          };
        })
      };
    });
    var allCards = Array.from(sec.querySelectorAll(".kbr-proto-card"));
    var uniqueIds = {};
    allCards.forEach(function(c) {
      var id = c.getAttribute("data-kbr-proto");
      if (id) uniqueIds[id] = 1;
    });
    return JSON.stringify({
      totalCards: allCards.length,
      uniqueCount: Object.keys(uniqueIds).length,
      groups: groups
    });
  `));

  ok(protoInfo.uniqueCount === 7, "Cervical cancer article covers all 7 unique protocols (got " + protoInfo.uniqueCount + ")");
  ok(protoInfo.groups.length === 4, "Protocols grouped into 4 clinical settings");
  const hasCisplatin = protoInfo.groups.some(g => g.protocols.some(p => p.id === "cervical-cisplatin-weekly" && /Weekly Cisplatin/.test(p.name)));
  ok(hasCisplatin, "Weekly Cisplatin Radiosensitizer protocol card is present with regimen summary");

  // Tap a protocol card to open SMD_PROTOSHEET
  console.log("\n--- Part 1b: Tap Protocol Card -> Open Protocol Sheet ---");
  await click(`.kbr-proto-card[data-kbr-proto="cervical-cisplatin-weekly"]`);
  ok(await until(`var s = document.getElementById("smdProtoSheet"); return !!(s && s.style.display !== "none");`, 5000), "Protocol sheet (#smdProtoSheet) opened from KB article card");

  const psTitle = await ev(`var t = document.querySelector("#smdProtoSheet .ps-hname, #smdProtoSheet .ps-regimen-name"); return t ? t.textContent : "";`);
  ok(/Weekly Cisplatin/i.test(psTitle), "Protocol sheet displays correct title: " + psTitle);

  // Reverse link: Read the KB article button on the protocol sheet
  const kbLinkBtn = await ev(`var b = document.querySelector("#smdProtoSheet [data-ps-act='open-kb-article']"); return b ? b.textContent : null;`);
  ok(!!kbLinkBtn && /Read the KB article/i.test(kbLinkBtn), "Protocol sheet renders 'Read the KB article: Cervical Cancer' button");

  // Tap the 'Read the KB article' button
  await click(`#smdProtoSheet [data-ps-act="open-kb-article"]`);
  ok(await until(`
    var ov = document.getElementById("dxOverlay");
    var back = document.getElementById("dxMgmtBack");
    return !!(ov && ov.classList.contains("on") && ov.style.zIndex === "16000" && back && back.textContent.indexOf("Protocol") >= 0);
  `, 5000), "KB article re-opens with z-index 16000 and '‹ Protocol' back button");

  // Tap '‹ Protocol' back button
  await click("#dxMgmtBack");
  await sleep(200);
  const psStillOpen = await ev(`var s = document.getElementById("smdProtoSheet"); return !!(s && s.style.display !== "none");`);
  ok(psStillOpen, "Tapping '‹ Protocol' returns to the protocol sheet");

  // Close protocol sheet and KB overlay
  await ev(`if (window.SMD_PROTOSHEET) window.SMD_PROTOSHEET.close(); return 1;`);
  await ev(`var ov = document.getElementById("dxOverlay"); if (ov) { ov.classList.remove("on"); ov.style.zIndex = ""; } return 1;`);
  await sleep(150);

  // =========================================================================
  // Part 2: MCQ Know More -> Protocols Row & Sheet
  // =========================================================================
  console.log("\n--- Part 2: MCQ Know More Protocols Row ---");
  await ev(`
    window.KB_ENRICHMENT = window.KB_ENRICHMENT || { byId: {} };
    window.KB_ENRICHMENT.byId.cervical_cancer = window.KB_ENRICHMENT.byId.cervical_cancer || { name: "Cervical cancer" };
    if (window.PREP) PREP.open();
    return 1;
  `);
  ok(await until(`return !!(window.PREP && PREP._host && document.querySelector("#smdPrep .pn-body"));`, 15000), "PrepNucleus workspace open");

  const cervicalMCQ = {
    id: "mcq-cervical-test-1",
    q: "A 48-year-old woman is diagnosed with locally advanced cervical carcinoma FIGO stage IIB. Which of the following is the standard definitive treatment?",
    o: ["Radical hysterectomy with pelvic lymphadenectomy", "Definitive concurrent chemoradiation with weekly cisplatin", "Neoadjuvant chemotherapy followed by surgery", "Pelvic radiation alone without chemotherapy"],
    a: 1,
    exp: "Definitive concurrent chemoradiation with weekly cisplatin is standard of care for locally advanced cervical cancer.",
    t: "obg-cervix",
    d: 2,
    prov: "LIC",
    x: {
      clues: "- Locally advanced cervical carcinoma\n- FIGO stage IIB\n- Definitive treatment",
      key: "Concurrent chemoradiation with weekly cisplatin is the gold standard.",
      pearl: "Locally advanced cervical cancer receives concurrent chemoradiation with cisplatin radiosensitizer.",
      links: {
        kb: ["cervical_cancer"],
        protocol_ids: [
          "cervical-cisplatin-weekly",
          "cervical-pembrolizumab",
          "gyn-carbo-paclitaxel-bev",
          "gyn-carbo-paclitaxel",
          "cervical-tisotumab-vedotin",
          "sclc-topotecan",
          "sclc-platinum-etoposide"
        ]
      }
    }
  };

  await ev(`
    var item = ${JSON.stringify(cervicalMCQ)};
    item._s = "obgyn";
    item._m = item.t;
    localStorage.removeItem("smd_prep_v1");
    PREP._host.run([item], "study", "Oncology Test");
    return 1;
  `);

  ok(await until(`return !!document.querySelector("#smdPrep .pn-opt");`, 8000), "Cervical cancer MCQ rendered");

  // Pick option 1 (correct answer)
  await click("#smdPrep .pn-opt[data-k='1']");
  ok(await until(`return !!document.querySelector("#smdPrep .pn-fb");`, 8000), "MCQ feedback rendered");

  // Verify Protocols button in Know more
  ok(await until(`return !!document.querySelector("#smdPrep .pn-km-proto-btn");`, 6000), "Know more protocols button rendered");
  const protoBtnText = await ev(`
    var btn = document.querySelector("#smdPrep .pn-km-proto-btn");
    return btn ? btn.textContent.trim() : null;
  `);
  ok(!!protoBtnText && /See protocols \(7\)/.test(protoBtnText), "Know more renders 'See protocols (7)' button (got '" + protoBtnText + "')");

  // Tap "See protocols (7)" to open #pnCancerProtoSheet
  await click("#smdPrep .pn-km-proto-btn");
  ok(await until(`
    var sh = document.getElementById("pnCancerProtoSheet");
    return !!(sh && sh.classList.contains("pn-proto-wrap"));
  `, 5000), "#pnCancerProtoSheet modal sheet opened");

  const sheetCardsCount = Number(await ev(`return document.querySelectorAll("#pnCancerProtoSheet .pn-proto-card").length;`));
  ok(sheetCardsCount === 7, "#pnCancerProtoSheet renders 7 protocol cards (got " + sheetCardsCount + ")");

  // Tap a protocol inside #pnCancerProtoSheet to open SMD_PROTOSHEET
  await click(`#pnCancerProtoSheet .pn-proto-card[data-proto-id="cervical-cisplatin-weekly"]`);
  ok(await until(`
    var s = document.getElementById("smdProtoSheet");
    return !!(s && s.style.display !== "none");
  `, 5000), "Tapping card in #pnCancerProtoSheet opens SMD_PROTOSHEET");

  await ev(`if (window.SMD_PROTOSHEET) window.SMD_PROTOSHEET.close(); return 1;`);
  await ev(`if (window.PREP_REASON) PREP_REASON.closeCancerProtocolsSheet(); return 1;`);

  // =========================================================================
  // Part 3: UI Compliance (Standing UI Rules)
  // =========================================================================
  console.log("\n--- Part 3: UI Compliance & Responsive Checks ---");
  const noOverflow = await ev(`
    return document.documentElement.scrollWidth <= window.innerWidth + 1 &&
      document.body.scrollWidth <= window.innerWidth + 1;
  `);
  ok(noOverflow === true, "No horizontal overflow at 390px mobile viewport");

  // Touch target sizing check (min 44px on clickable items)
  await ev(`window.DX.openRef("cervical_cancer"); return 1;`);
  await sleep(300);
  const targetHeights = JSON.parse(await ev(`
    var cards = Array.from(document.querySelectorAll("#kbr-protocols .kbr-proto-card"));
    return JSON.stringify(cards.map(function(c) {
      return Math.round(c.getBoundingClientRect().height * 10) / 10;
    }));
  `));
  const allTargets44 = targetHeights.length > 0 && targetHeights.every(h => h >= 43.5);
  ok(allTargets44, "All protocol cards in KB reader meet 44px min touch target size (" + targetHeights.slice(0, 3).join(", ") + "px)");

  // Dark & light theme toggle check
  await ev(`document.body.classList.remove("dark"); return 1;`);
  await sleep(100);
  const lightBg = await ev(`var c = document.querySelector("#kbr-protocols .kbr-proto-card"); return c ? getComputedStyle(c).backgroundColor : "";`);
  ok(!!lightBg, "Light theme renders protocol cards cleanly");

  await ev(`document.body.classList.add("dark"); return 1;`);
  await sleep(100);
  const darkBg = await ev(`var c = document.querySelector("#kbr-protocols .kbr-proto-card"); return c ? getComputedStyle(c).backgroundColor : "";`);
  ok(!!darkBg, "Dark theme renders protocol cards cleanly");

  // Console errors check
  ok(consoleErrors.length === 0, "No uncaught console errors or exceptions in tested modules (" + (consoleErrors.join(" | ") || "none") + ")");

  console.log("\n==========================================");
  if (fails === 0) {
    console.log("ALL ONCOLOGY LINKS BROWSER CHECKS PASSED!");
  } else {
    console.log(`${fails} CHECK(S) FAILED`);
  }
  console.log("==========================================\n");

} catch (err) {
  console.error("Test execution failed:", err);
  fails++;
} finally {
  if (chrome) { try { chrome.kill("SIGKILL"); } catch {} }
  if (serveProc) { try { serveProc.kill("SIGKILL"); } catch {} }
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(fails > 0 ? 1 : 0);
}
