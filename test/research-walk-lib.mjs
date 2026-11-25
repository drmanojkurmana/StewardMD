// Headless walk shared by the five ResearchMD study types.
// Each walk starts at "What do you want to publish?" and ends when the
// manuscript DOCX export is delivered. The page is served on 127.0.0.1.
// Patient rows, dates, phones and Aadhaar-shaped numbers must not appear
// in any /api/research request body. Only a case_report_draft body may
// carry case text, and this walk never sends that task.
import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, readFile } from "node:fs";
import { extname, join, normalize } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const CHROME = process.env.CHROME || [
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find((p) => existsSync(p));

const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon"
};

const DATE_RE = /(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)|(?<!\d)\d{1,2}\/\d{1,2}\/\d{4}(?!\d)|(?<!\d)\d{1,2}-\d{1,2}-\d{4}(?!\d)/;
const PHONE_RE = /(?<!\d)[6-9]\d{9}(?!\d)/;
const AADHAAR_RE = /(?<!\d)\d{12}(?!\d)|(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}(?!\d)/;

function manuscriptFor(projectId, title) {
  return {
    id: "man_walk",
    projectId: projectId,
    version: 1,
    title: title,
    authors: ["A Clinician"],
    affiliations: "Teaching hospital",
    status: "draft",
    sections: [
      { id: "abstract", heading: "Abstract", level: 1, text: "This paper reports the study in plain words." },
      { id: "introduction", heading: "Introduction", level: 1, text: "The question is stated here." },
      { id: "methods", heading: "Methods", level: 1, text: "The method is described here." },
      { id: "results", heading: "Results", level: 1, text: "The result is described here." },
      { id: "discussion", heading: "Discussion", level: 1, text: "The meaning is described here." }
    ],
    tokens: {},
    references: [],
    approval: null,
    lock: null
  };
}

function leakReason(path, raw) {
  if (!path.startsWith("/api/research")) return "";
  const draft = path.indexOf("case_report_draft") >= 0 || raw.indexOf('"case_report_draft"') >= 0;
  if (DATE_RE.test(raw) || PHONE_RE.test(raw) || AADHAAR_RE.test(raw)) return "date, phone or Aadhaar-shaped number";
  if (!draft && /"rows"\s*:/.test(raw) && /"age"/.test(raw)) return "master chart row";
  if (/UHID|hospital number|Aadhaar/i.test(raw)) return "fixture or hospital identifier";
  return "";
}

export async function runResearchWalk(cfg) {
  if (!CHROME) {
    console.log("FAIL Chrome not found");
    process.exit(1);
  }
  const port = cfg.port;
  const cdp = cfg.cdp;
  const out = "/tmp/stewardmd-research-walk-" + cfg.name;
  const recorded = [];
  let projN = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:" + port);
    const p = decodeURIComponent(url.pathname);
    const send = (status, obj) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(obj));
    };
    if (p.startsWith("/api/")) {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = {};
        if (raw) {
          try { body = JSON.parse(raw); } catch { body = raw; }
        }
        recorded.push({ method: req.method, path: p, raw: raw, body: body });
        if (p === "/api/research/v1/projects" && req.method === "POST") {
          projN += 1;
          const id = "prj_walk_" + cfg.name + "_" + projN;
          return send(201, {
            project: {
              id: id,
              title: body.title || cfg.title,
              discipline: body.discipline || "medicine",
              specialty: body.specialty || "",
              studyType: body.studyType || cfg.studyType,
              researchQuestion: body.researchQuestion || "",
              role: "owner"
            },
            requestId: "req_walk_" + projN
          });
        }
        const man = p.match(/^\/api\/research\/v1\/projects\/([^/]+)\/manuscript$/);
        if (man && req.method === "GET") {
          return send(200, { manuscript: manuscriptFor(decodeURIComponent(man[1]), cfg.title) });
        }
        if (/\/manuscript\/versions$/.test(p) && req.method === "GET") {
          return send(200, { versions: [{ id: "man_walk", version: 1, title: cfg.title, status: "draft", sectionCount: 5, referenceCount: 0 }] });
        }
        if (/\/manuscript\/export$/.test(p) && req.method === "POST") {
          return send(200, { gatesPassed: true, format: "docx" });
        }
        if (/\/manuscript\/sections\//.test(p) && req.method === "PUT") {
          return send(200, { section: body, version: 1, tokens: {} });
        }
        if (/\/protocols$/.test(p) && req.method === "GET") return send(200, { protocols: [] });
        if (/\/find-studies$/.test(p) && req.method === "POST") return send(200, { results: [] });
        if (/\/checklists\/[^/]+$/.test(p) && req.method === "GET") {
          return send(200, { checklist: { id: "walk", name: "Checklist", sections: [] } });
        }
        if (/\/checklist-snapshot$/.test(p)) return send(200, { snapshot: {} });
        if (/\/checklist-manual\//.test(p)) return send(200, { entries: {} });
        if (/\/format-check/.test(p)) return send(200, { checks: [] });
        if (/\/cost-report$/.test(p)) return send(200, { runs: [], totalMicroUsd: 0 });
        if (/\/ai-draft$/.test(p) && req.method === "POST") {
          return send(200, { draft: { id: "draft_walk", task: body.task || "", status: "unverified", sections: {} }, costInr: 0 });
        }
        return send(200, { ok: true });
      });
      return;
    }
    const rel = normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, "");
    const fp = join(repo, rel);
    if (!fp.startsWith(repo)) {
      res.writeHead(403);
      res.end("403");
      return;
    }
    readFile(fp, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("404");
        return;
      }
      res.writeHead(200, {
        "content-type": TYPES[extname(fp)] || "application/octet-stream",
        "cache-control": "no-store, no-cache, must-revalidate"
      });
      res.end(data);
    });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  const chrome = spawn(CHROME, [
    "--headless=new",
    "--no-sandbox",
    "--remote-debugging-port=" + cdp,
    "--user-data-dir=/tmp/rmd-walk-chrome-" + cfg.name + "-" + process.pid,
    "--no-first-run",
    "--disable-gpu"
  ], { stdio: "ignore" });

  let ws;
  let sid;
  let id = 0;
  let failures = 0;
  const pending = new Map();
  const pageErrors = [];

  const call = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
  });

  const ev = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      throw Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const ok = (pass, label) => {
    console.log((pass ? "PASS" : "FAIL") + " " + label);
    if (!pass) failures += 1;
  };

  const until = async (expr, ms = 10000) => {
    for (let t = 0; t < ms; t += 100) {
      try {
        if (await ev(expr)) return true;
      } catch {
        /* page busy */
      }
      await sleep(100);
    }
    return false;
  };

  const setViewport = async (width, height, mobile) => {
    await call("Emulation.setDeviceMetricsOverride", {
      width: width,
      height: height,
      deviceScaleFactor: 2,
      mobile: mobile
    });
    await sleep(150);
  };
  const docFits = () => ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth");

  const click = (sel) => ev("(()=>{const b=document.querySelector(" + JSON.stringify(sel) + ");if(!b)return false;b.click();return true})()");
  const text = (sel) => ev("(()=>{const e=document.querySelector(" + JSON.stringify(sel) + ");if(!e)return '';return e.innerText||e.textContent||''})()");

  async function shot(name) {
    try {
      await mkdir(out, { recursive: true });
      const r = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(out + "/" + name + ".png", Buffer.from(r.result.data, "base64"));
    } catch {
      /* screenshot is evidence, not a gate */
    }
  }

  try {
    let version;
    for (let i = 0; i < 80; i++) {
      try {
        version = await (await fetch("http://127.0.0.1:" + cdp + "/json/version")).json();
        break;
      } catch {
        await sleep(200);
      }
    }
    if (!version) throw Error("Chrome debugger did not start");
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.exceptionThrown") pageErrors.push(JSON.stringify(m.params).slice(0, 400));
      if (pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };

    const created = await call("Target.createTarget", { url: "about:blank" });
    sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;
    await call("Runtime.enable");
    await call("Page.enable");
    await call("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true
    });
    await call("Page.navigate", { url: "http://127.0.0.1:" + port + "/?research=1" });
    ok(await until("!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.screens && !!window.SMD_RESEARCH.screens.start", 45000), cfg.name + " app loaded");
    ok(await ev("window.isSecureContext === true"), cfg.name + " secure context on 127.0.0.1");
    ok(await ev("location.hostname === '127.0.0.1'"), cfg.name + " page host is 127.0.0.1");

    await ev("SMD_RESEARCH.open({screen:'start'});1");
    ok(await until("!!document.querySelector('.rmd-start-screen')", 8000), cfg.name + " start screen rendered");
    const ask = await text(".rmd-start-screen");
    ok(ask.indexOf("What do you want to publish?") >= 0, cfg.name + " asks what to publish");
    ok(await docFits(), cfg.name + " 390x844 no horizontal scroll on the question");
    await setViewport(1024, 1366, false);
    ok(await docFits(), cfg.name + " 1024x1366 no horizontal scroll on the question");
    await setViewport(390, 844, true);
    await shot("01-question");

    ok(await click('[data-rmd-start-choice="' + cfg.choice + '"]'), cfg.name + " choice " + cfg.choice + " clicked");
    ok(await until("!!document.querySelector('#rmdStartForm')", 4000), cfg.name + " naming form appears");
    await ev("(()=>{var el=document.getElementById('rmd_start_title'); if(el) el.value=" + JSON.stringify(cfg.title) + "; return 1})()");
    ok(await click('[data-rmd="start-create"]'), cfg.name + " create clicked");
    const createdOk = await until("(()=>{var p=SMD_RESEARCH.store.getActiveProject(); return !!(p && p.serverId && p.studyType===" + JSON.stringify(cfg.studyType) + ");})()", 8000);
    ok(createdOk, cfg.name + " project created on the mocked server");
    if (!createdOk) {
      console.log("START TEXT " + (await text("#rmdScreenBody")).slice(0, 300));
    }

    const steps = cfg.steps;
    const total = cfg.total;
    for (let i = 0; i < steps.length; i++) {
      const n = i + 1;
      const label = steps[i][1];
      const expr = "(()=>{var b=document.querySelector('#rmdStepBanner'); if(!b) return false; var t=b.innerText||b.textContent||''; return t.indexOf('Step " + n + " of " + total + "')>=0 && t.indexOf(" + JSON.stringify(label) + ")>=0;})()";
      const seen = await until(expr, 8000);
      ok(seen, cfg.name + " step " + n + " of " + total + " " + label);
      if (!seen) console.log("BANNER " + (await text("#rmdStepBanner")).slice(0, 240));
      const banner = await text("#rmdStepBanner");
      ok(banner.indexOf("Next:") >= 0, cfg.name + " step " + n + " shows Next");
      ok(await docFits(), cfg.name + " step " + n + " 390x844 no horizontal scroll");
      await setViewport(1024, 1366, false);
      ok(await docFits(), cfg.name + " step " + n + " 1024x1366 no horizontal scroll");
      await setViewport(390, 844, true);
      if (i < steps.length - 1) {
        const advanced = await click('#rmdHelpWrap [data-rmd-action="help-next"]');
        ok(advanced, cfg.name + " Next advances from " + label);
        await sleep(200);
      }
    }

    ok(await until("!!document.querySelector('[data-rmd=\"manuscript-export\"]')", 8000), cfg.name + " Download Word file is on the manuscript");
    await shot("02-manuscript");
    ok(await click('[data-rmd="manuscript-export"]'), cfg.name + " export clicked");
    const delivered = await until("(()=>{var e=document.querySelector('.rmd-manuscript-screen'); if(!e) return false; return (e.textContent||'').indexOf('Your file is ready to save or share.')>=0;})()", 8000);
    ok(delivered, cfg.name + " DOCX export delivered");
    if (!delivered) console.log("MANUSCRIPT " + (await text(".rmd-manuscript-screen")).slice(0, 400));
    const exported = recorded.some((r) => r.method === "POST" && /\/manuscript\/export$/.test(r.path) && r.body && r.body.format === "docx");
    ok(exported, cfg.name + " export request asked for docx");
    await shot("03-docx");
    ok(await docFits(), cfg.name + " 390x844 no horizontal scroll after the export");
    await setViewport(1024, 1366, false);
    ok(await docFits(), cfg.name + " 1024x1366 no horizontal scroll after the export");
    await shot("04-tablet");
    await setViewport(390, 844, true);

    const shell = await ev("(()=>{var e=document.querySelector('#researchMD'); return e ? (e.innerText||'') : '';})()");
    ok(shell.indexOf("\u2014") < 0 && shell.indexOf("\u2013") < 0, cfg.name + " no em or en dash in the shell");

    let privacy = true;
    const leaks = [];
    for (let i = 0; i < recorded.length; i++) {
      const why = leakReason(recorded[i].path, recorded[i].raw || "");
      if (why) {
        privacy = false;
        leaks.push(recorded[i].method + " " + recorded[i].path + " " + why);
      }
    }
    ok(privacy, cfg.name + " privacy: research request bodies hold no chart row, date, phone, Aadhaar or hospital id (" + recorded.length + " api bodies)");
    if (leaks.length) console.log(leaks.slice(0, 8).join("\n"));

    if (pageErrors.length) console.log("PAGE ERRORS\n" + pageErrors.slice(0, 6).join("\n"));
    ok(pageErrors.length === 0, cfg.name + " zero page errors (" + pageErrors.length + ")");

    console.log(failures === 0 ? "ALL " + cfg.name.toUpperCase() + " WALK CHECKS PASSED" : failures + " " + cfg.name.toUpperCase() + " WALK CHECK(S) FAILED");
  } catch (e) {
    console.log("FAIL exception: " + (e && e.message ? e.message : e));
    failures += 1;
  } finally {
    try { if (ws) ws.close(); } catch { /* closed */ }
    try { chrome.kill("SIGTERM"); } catch { /* gone */ }
    await new Promise((resolve) => server.close(resolve));
  }
  process.exit(failures === 0 ? 0 : 1);
}
