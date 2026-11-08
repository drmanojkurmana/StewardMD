#!/usr/bin/env node
// USAGE: node tools/lesson-shot.mjs <lessonKey> [--out DIR]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { freePort } from "../test/free-port.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  let key = null;
  let outDir = join(homedir(), "prep-data/assessment/shots");

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out" || a === "-o") {
      outDir = args[++i];
    } else if (a.startsWith("--out=")) {
      outDir = a.slice(6);
    } else if (!a.startsWith("-") && !key) {
      key = a;
    }
  }

  if (outDir.startsWith("~/")) {
    outDir = join(homedir(), outDir.slice(2));
  }
  return { key, outDir: resolve(outDir) };
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium"
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

const { key, outDir } = parseArgs();
if (!key) {
  console.error("Error: missing lesson key.\nUsage: node tools/lesson-shot.mjs <lessonKey> [--out DIR]");
  process.exit(1);
}

const chromeBin = findChrome();
if (!chromeBin) {
  console.error("Error: Chrome binary not found. Set CHROME environment variable.");
  process.exit(1);
}

const lessonPath = join(ROOT, "prep/lessons/v1", `${key}.json`);
if (!existsSync(lessonPath)) {
  console.error(`Error: lesson file not found: ${lessonPath}`);
  process.exit(1);
}

let lessonData;
try {
  lessonData = JSON.parse(readFileSync(lessonPath, "utf8"));
} catch (e) {
  console.error(`Error: failed to parse ${lessonPath}: ${e.message}`);
  process.exit(1);
}

const steps = Array.isArray(lessonData.steps) ? lessonData.steps : [];
// Identify one table or flow step if the lesson has one.
// If the first step (index 0) is already a table or flow, look for another table/flow step if one exists.
let tableStep = -1;
let flowStep = -1;
let tableStepNonZero = -1;
let flowStepNonZero = -1;
for (let i = 0; i < steps.length; i++) {
  const kind = steps[i]?.vis?.kind;
  if (kind === "table") {
    if (tableStep === -1) tableStep = i;
    if (i > 0 && tableStepNonZero === -1) tableStepNonZero = i;
  }
  if (kind === "flow") {
    if (flowStep === -1) flowStep = i;
    if (i > 0 && flowStepNonZero === -1) flowStepNonZero = i;
  }
}

let tfStep = -1;
if (tableStepNonZero !== -1) {
  tfStep = (flowStepNonZero !== -1) ? flowStepNonZero : tableStepNonZero;
} else if (flowStepNonZero !== -1) {
  tfStep = flowStepNonZero;
} else if (tableStep !== -1) {
  tfStep = tableStep;
} else if (flowStep !== -1) {
  tfStep = flowStep;
}

mkdirSync(outDir, { recursive: true });

const serverPort = await freePort();
const chromePort = await freePort();
const base = `http://127.0.0.1:${serverPort}/`;
const userDir = join(process.env.CLAUDE_JOB_DIR || "/tmp", `lesson-shot-${chromePort}-${Date.now()}`);

let serverProc = null;
let chromeProc = null;

function cleanup() {
  if (chromeProc) {
    try { chromeProc.kill("SIGKILL"); } catch {}
    chromeProc = null;
  }
  if (serverProc) {
    try { serverProc.kill("SIGKILL"); } catch {}
    serverProc = null;
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

serverProc = spawn("node", [join(ROOT, "test/serve.mjs"), ROOT, String(serverPort)], { stdio: "ignore" });
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(base);
    if (res.ok) break;
  } catch {}
  await sleep(150);
}

chromeProc = spawn(chromeBin, [
  "--headless=new",
  "--no-sandbox",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${userDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "about:blank"
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeErr = "";
chromeProc.stderr.on("data", (d) => { chromeErr += d; });

let versionInfo = null;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${chromePort}/json/version`);
    versionInfo = await r.json();
    if (versionInfo?.webSocketDebuggerUrl) break;
  } catch {}
  await sleep(150);
}

if (!versionInfo?.webSocketDebuggerUrl) {
  console.error("Error: Chrome remote debugging did not start: " + chromeErr.slice(-500));
  cleanup();
  process.exit(1);
}

let msgId = 1;
const pending = new Map();
const ws = new WebSocket(versionInfo.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let sessionId = undefined;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};

const call = (method, params) => {
  const id = msgId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const req = { id, method, params: params || {} };
    if (sessionId) req.sessionId = sessionId;
    ws.send(JSON.stringify(req));
  });
};

const ev = async (expression) => {
  const r = await call("Runtime.evaluate", {
    expression: `(function(){try{${expression}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`,
    returnByValue: true
  });
  return r.result && r.result.result ? r.result.result.value : undefined;
};

const until = async (expr, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await ev(expr)) === true) return true;
    await sleep(120);
  }
  return false;
};

const shotCall = async () => {
  await sleep(250);
  await ev(`document.getAnimations().forEach(function(a){try{var t=a.effect&&a.effect.getTiming();if(t&&t.iterations!==Infinity)a.finish();}catch(e){}});return 1;`);
  const r = await call("Page.captureScreenshot", { format: "png" });
  return r.result && r.result.data ? Buffer.from(r.result.data, "base64") : null;
};

try {
  const target = await call("Target.createTarget", { url: "about:blank" });
  const attached = await call("Target.attachToTarget", { targetId: target.result.targetId, flatten: true });
  sessionId = attached.result.sessionId;

  await call("Runtime.enable", {});
  await call("Page.enable", {});
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  });

  const firstStepBold = (steps[0]?.tx || "").match(/\*\*([^*]+)\*\*/)?.[1] || null;

  const stubScript = `
    window.SMD_PREP_VOICE = false;
    window.confirm = function(){ return true; };
    window.SMD_PREP_ONBOARD = false;
    try {
      localStorage.setItem("smd_prep", "1");
      localStorage.setItem("smd_prep_v1", JSON.stringify({ v: 1, pl: { ob: 1, exam: "neet-pg", date: "2027-05-01", min: 60, rem: 0 } }));
    } catch (e) {}
    window.SpeechSynthesisUtterance = function (t) { this.text = t; this.rate = 1; this.lang = ""; };
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      speaking: false,
      speak: function (u) { var self = this; self.speaking = true; setTimeout(function () { self.speaking = false; if (u.onend) u.onend({}); }, 100); },
      cancel: function () { this.speaking = false; }
    } });
  `;
  await call("Page.addScriptToEvaluateOnNewDocument", { source: stubScript });

  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k);if(e)e.remove();});return 1;`;

  await call("Page.navigate", { url: base + "?prep=1" });
  await until(`return !!window.PREP;`, 25000);
  await ev(`
    try {
      localStorage.setItem("smd_prep", "1");
      localStorage.setItem("smd_prep_v1", JSON.stringify({ v: 1, pl: { ob: 1, exam: "neet-pg", date: "2027-05-01", min: 60, rem: 0 } }));
    } catch (e) {}
    return 1;
  `);
  await ev(clean);

  // Drive route into PrepNucleus Learn: open PrepNucleus, then open the lesson
  await ev(`
    if (window.PREP && window.PREP.open) {
      window.PREP.open();
    }
    return 1;
  `);
  await until(`return !!(window.PREP && window.PREP._host && window.PREP_LESSONS);`, 25000);

  const lessonSub = lessonData.subject || "";
  const lessonMod = lessonData.module || lessonData.id || key;
  const lessonKey = lessonData.id || key;

  const openLesson = async () => {
    // Navigate via Learn tab if available, or directly through PREP_LESSONS
    await ev(`
      (function() {
        var btn = document.querySelector('.pnv-tab[data-tab="learn"]');
        if (btn) btn.click();
      })();
      return 1;
    `);
    await sleep(150);

    await ev(`
      (function() {
        var host = window.PREP._host;
        window.PREP_LESSONS._l.jumpStep = null;
        window.PREP_LESSONS.open(${JSON.stringify(lessonSub)}, ${JSON.stringify(lessonMod)}, host, ${JSON.stringify(lessonKey)}, true);
      })();
      return 1;
    `);
    const opened = await until(`return !!document.querySelector("#smdPrep #pnLsn .pn-lsn-tx");`, 15000);
    if (!opened) {
      console.error("Error: lesson viewer failed to open (#smdPrep #pnLsn .pn-lsn-tx not found).");
      process.exit(1);
    }
    await sleep(200);
  };

  const goToStep = async (targetIndex) => {
    await ev(`
      (function() {
        var L = window.PREP_LESSONS._l;
        if (!L || L.i === ${targetIndex}) return 1;
        var diff = ${targetIndex} - L.i;
        var actName = diff > 0 ? "l-next" : "l-prev";
        var count = Math.abs(diff);
        for (var step = 0; step < count; step++) {
          var btn = document.querySelector('[data-act="' + actName + '"]');
          if (btn) btn.click();
        }
        return 1;
      })();
    `);
    const stepped = await until(`return !!(window.PREP_LESSONS._l && window.PREP_LESSONS._l.i === ${targetIndex} && document.querySelector("#smdPrep #pnLsn .pn-lsn-tx"));`, 10000);
    if (!stepped) {
      console.error(`Error: failed to navigate to step ${targetIndex}.`);
      process.exit(1);
    }
    await sleep(300);
  };

  const verifyStep0BoldTerm = async () => {
    if (!firstStepBold) return;
    const pageText = await ev(`return document.body ? (document.body.innerText || document.body.textContent || "") : "";`);
    if (!pageText || !pageText.includes(firstStepBold)) {
      console.error(`Error: first step bold term "${firstStepBold}" was not present in page text at capture time.`);
      process.exit(1);
    }
  };

  const themes = [
    { name: "dark", setup: `document.body.classList.add("dark"); if(document.getElementById("pnNoTr")) document.getElementById("pnNoTr").remove(); return 1;` },
    { name: "light", setup: `if(!document.getElementById("pnNoTr")){var t=document.createElement("style");t.id="pnNoTr";t.textContent="*{transition:none!important}";document.head.appendChild(t);}document.body.classList.remove("dark");return 1;` }
  ];

  for (const th of themes) {
    await ev(th.setup);

    // First step
    await openLesson();
    await goToStep(0);
    await verifyStep0BoldTerm();
    const bufStep0 = await shotCall();
    if (bufStep0) {
      const outPath = join(outDir, `${key}-${th.name}.png`);
      writeFileSync(outPath, bufStep0);
      console.log(`Saved: ${outPath}`);
    }

    // One table/flow step if the lesson has one and it is not step 0
    if (tfStep > 0) {
      await goToStep(tfStep);
      const bufTf = await shotCall();
      if (bufTf) {
        const kind = steps[tfStep]?.vis?.kind || "visual";
        const outPath = join(outDir, `${key}-${kind}-${th.name}.png`);
        writeFileSync(outPath, bufTf);
        console.log(`Saved: ${outPath}`);
      }
    }
  }

  console.log("Done.");
} finally {
  cleanup();
}
