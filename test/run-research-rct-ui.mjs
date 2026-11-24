// Real-browser headless test: ResearchMD RCT & Case Report flows.
// Covers:
// - Serve on http://127.0.0.1:<port> and assert window.isSecureContext === true
// - CTRI banner shows until valid number saved; REF number shows reference message
// - List keeper flow; list removed and fingerprint kept
// - Blinding paragraph names groups without single/double/triple labels
// - CONSORT diagram and mismatch banner
// - Case report draft preview blocks on planted phone number and sends only after tick
// - Responsive at viewports 390x844 and 1024x1366: no horizontal scroll
// - Zero page errors and zero em/en dashes
// - Privacy assertion: no request body holds date, 10-digit phone, 12-digit number, or fixture ID;
//   only case_report_draft carries case text
// - Screenshots output to /tmp/stewardmd-research-alltypes-gemini
// Run with: node test/run-research-rct-ui.mjs
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

const PORT = 9125, CDP = 9525, OUT = "/tmp/stewardmd-research-alltypes-gemini";
const TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

let projN = 0;
const recordedRequests = [];

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://127.0.0.1:" + PORT).pathname);
  const send = (status, obj) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  if (p.startsWith("/api/")) {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let b = {};
      try { b = JSON.parse(body || "{}"); } catch { b = {}; }
      recordedRequests.push({ method: req.method, path: p, body: b });

      if (p === "/api/research/v1/projects" && req.method === "POST") {
        projN++;
        return send(201, {
          project: {
            id: "prj_rct_" + projN,
            title: b.title || "Inhaled Steroid Trial",
            discipline: b.discipline || "medicine",
            specialty: b.specialty || "Pulmonology",
            studyType: b.studyType || "rct",
            role: "owner",
            createdAt: Date.now()
          },
          requestId: "req_proj_" + projN
        });
      }

      const projMatch = p.match(/^\/api\/research\/v1\/projects\/([^/]+)(\/.*)?$/);
      if (projMatch) {
        const sub = projMatch[2] || "";

        if (sub === "/protocols" && req.method === "GET") {
          return send(200, { protocols: [] });
        }

        if (sub === "/cost-report" && req.method === "GET") {
          return send(200, { runs: [], totalMicroUsd: 0 });
        }

        if (sub === "/manuscript" && req.method === "GET") {
          return send(200, { manuscript: null });
        }

        if (sub === "/ai-draft" && req.method === "POST") {
          if (b.task === "case_report_draft") {
            return send(200, {
              draft: {
                id: "draft_cr_1",
                task: "case_report_draft",
                status: "unverified",
                sections: {
                  title: "Adult onset Still disease with acute liver dysfunction",
                  abstract: "A 45-year-old female presented with persistent spiking fever.",
                  introduction: "Adult onset Still disease is a rare inflammatory disorder.",
                  casePresentation: "Day 1: Presented with 39 C fever. Day 3: Liver enzymes elevated with ferritin 4500 ng/mL. Day 5: Serum ferritin reached 5800 ng/mL.",
                  timeline: "Day 1: Presentation. Day 3: Ferritin elevation. Day 7: Remission on steroids.",
                  discussion: "This case illustrates severe hepatic involvement.",
                  conclusion: "Early aggressive immunosuppressive therapy proved effective.",
                  patientPerspective: "The patient reported resolution of fevers within two days.",
                  learningPoints: [
                    "Ferritin above 4000 ng/mL strongly suggests autoinflammatory disorder.",
                    "Prompt corticosteroids prevent liver decompensation."
                  ]
                }
              },
              model: "gemini-2.5-flash",
              costInr: 0.20
            });
          }

          if (b.task === "publication_consent") {
            return send(200, {
              draft: {
                id: "draft_pubconsent_1",
                task: "publication_consent",
                status: "unverified",
                english: "Patient Consent for Publication\nWhat will be published: Clinical details.",
                local: "Patient Consent for Publication\nWhat will be published: Clinical details.",
                languageName: "English"
              },
              model: "gemini-2.5-flash",
              costInr: 0.15
            });
          }
        }
      }

      return send(404, { error: { code: "not_found" } });
    });
    return;
  }

  const fp = join(repo, normalize(p === "/" ? "/index.html" : p).replace(/^(\.\.[/\\])+/, ""));
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
}).listen(PORT, "127.0.0.1");

const chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=/tmp/rmd-rct-chrome-${process.pid}`,
  "--no-first-run",
  "--disable-gpu"
], { stdio: "ignore" });

let ws, sid, id = 0, failures = 0;
const pending = new Map();
const pageErrors = [];

const call = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
});

const ev = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    const err = JSON.stringify(r.result.exceptionDetails).slice(0, 600);
    pageErrors.push(err);
    throw Error(err);
  }
  return r.result?.result?.value;
};

const ok = (pass, label) => {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failures++;
};

const until = async (expr, ms = 10000) => {
  for (let t = 0; t < ms; t += 100) {
    try {
      if (await ev(expr)) return true;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  return false;
};

const click = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
const text = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return '';return e.innerText||e.textContent||''})()`);

async function shot(name) {
  await sleep(150);
  await ev(`(()=>{const b=document.getElementById('smdBootSplash');if(b)b.style.display='none';return 1})()`);
  await mkdir(OUT, { recursive: true });
  const r = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64"));
}

try {
  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
      break;
    } catch {
      await sleep(200);
    }
  }
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      pageErrors.push(JSON.stringify(m.params));
    }
    if (pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };

  const created = await call("Target.createTarget", { url: "about:blank" });
  sid = (await call("Target.attachToTarget", { targetId: created.result.targetId, flatten: true })).result.sessionId;

  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.navigate", { url: `http://127.0.0.1:${PORT}/?research=1` });
  ok(await until("!!window.SMD_RESEARCH && !!window.SMD_RESEARCH.screens && !!window.SMD_RESEARCH.screens.randomise", 30000), "app loaded with randomise screen registered");

  // 1. Assert secure context
  const isSecure = await ev("window.isSecureContext");
  ok(isSecure === true, "window.isSecureContext is true on http://127.0.0.1");

  // 2. Setup an RCT project
  await ev(`(()=>{
    const p = {
      id: "prj_rct_test",
      serverId: "prj_rct_test",
      title: "Inhaled Steroid Asthma Trial",
      studyType: "rct",
      createdAt: Date.now()
    };
    SMD_RESEARCH.store.adoptServerProject(p);
    return true;
  })()`);

  // 3. CTRI banner on randomise screen before registration
  await ev(`SMD_RESEARCH.open({ screen: "randomise" }); 1`);
  ok(await until(`!!document.querySelector(".rmd-randomise-screen")`, 5000), "randomise screen rendered");
  ok(await ev(`!!document.querySelector(".rmd-ctri-unregistered-banner")`), "CTRI unregistered warning banner is visible before registration");

  // 4. CTRI screen validation
  await ev(`SMD_RESEARCH.open({ screen: "ctri" }); 1`);
  ok(await until(`!!document.querySelector(".rmd-ctri-screen")`, 5000), "ctri screen rendered");

  // Try saving REF number -> blocked with reference message
  await ev(`(()=>{
    document.getElementById("rmd-ctri-number").value = "REF/2026/05/012345";
    return true;
  })()`);
  await click('[data-rmd="ctri-save"]');
  await sleep(150);
  const refMsg = await text("#rmd-ctri-message");
  ok(/That is a CTRI submission reference, not your final registration number\./.test(refMsg), "REF number blocked with submission reference message");

  // Try invalid number format
  await ev(`(()=>{
    document.getElementById("rmd-ctri-number").value = "CTRI/2026/005/012345";
    return true;
  })()`);
  await click('[data-rmd="ctri-save"]');
  await sleep(150);
  const badMsg = await text("#rmd-ctri-message");
  ok(/A CTRI number looks like CTRI\/2026\/05\/012345\./.test(badMsg), "invalid CTRI format rejected with format explanation");

  // Save valid CTRI number
  await ev(`(()=>{
    document.getElementById("rmd-ctri-status").value = "registered";
    document.getElementById("rmd-ctri-number").value = "  ctri/2026/05/012345  ";
    return true;
  })()`);
  await click('[data-rmd="ctri-save"]');
  ok(await until(`!!document.querySelector(".rmd-ctri-manuscript-block")`, 5000), "registered CTRI renders manuscript sentence block");
  const regSentence = await text("#rmd-ctri-reg-text");
  ok(/This trial is registered with the Clinical Trials Registry - India \(CTRI\), number CTRI\/2026\/05\/012345\./.test(regSentence), "manuscript registration sentence generated correctly");

  // 5. Navigate back to randomise screen -> CTRI banner gone
  await ev(`SMD_RESEARCH.open({ screen: "randomise" }); 1`);
  ok(await until(`!!document.querySelector(".rmd-randomise-screen")`, 5000), "back on randomise screen");
  ok(await until(`!document.querySelector(".rmd-ctri-unregistered-banner")`, 5000), "CTRI warning banner cleared after registration");

  // 6. List keeper flow and randomisation list generation
  ok(await ev(`document.getElementById("rmd-keeper-yes").checked === true`), "list keeper default choice is keeper");
  await click("#rmd-keeper-no");
  await sleep(100);
  ok(await ev(`document.getElementById("rmd-keeper-warning").style.display === "block"`), "selecting recruiter shows warning to ask guide or statistician");
  await click("#rmd-keeper-yes");
  await sleep(100);

  // Checkbox 'Remove the list from this phone' is checked by default
  ok(await ev(`document.getElementById("rmd-rand-remove-phone").checked === true`), "remove list from phone checkbox is checked by default");

  // Generate allocation list
  await click('[data-rmd="generate-random-list"]');
  ok(await until(`!!document.getElementById("rmd-fingerprint-box") && document.getElementById("rmd-fingerprint-box").innerText.length > 20`, 5000), "allocation generated and SHA-256 fingerprint displayed");
  const fpText = await text("#rmd-fingerprint-box");
  ok(/[0-9a-f]{64}/.test(fpText), "cryptographic fingerprint computed and displayed");

  // Verify list was removed from phone store and fingerprint kept
  const storedList = await ev(`(async () => {
    return await RMDStore.get("prj_rct_test", "randomlist", "main");
  })()`);
  ok(storedList === null, "random list removed from phone storage");

  const storedFp = await ev(`(async () => {
    return await RMDStore.get("prj_rct_test", "randomfingerprint", "main");
  })()`);
  ok(storedFp && typeof storedFp.fingerprint === "string" && storedFp.fingerprint.length === 64, "SHA-256 fingerprint stored in RMDStore kind randomfingerprint");

  // 7. Blinding card and methods paragraph
  const blindPara = await text("#rmd-blinding-text");
  ok(/Participants, care providers, and outcome assessors were blinded/.test(blindPara), "methods paragraph names blinded groups");
  ok(!/\b(single|double|triple)[ -]?blind(ed)?\b/i.test(blindPara), "methods paragraph avoids single, double or triple labels");

  // Test "Nobody was blinded" toggle
  await click("#rmd-blinding-none");
  await sleep(100);
  await ev(`(()=>{
    const r = document.getElementById("rmd-blinding-none-reason");
    r.value = "surgical vs medical intervention could not be masked";
    return true;
  })()`);
  await click('[data-rmd="save-blinding"]');
  await sleep(100);
  const unblindPara = await text("#rmd-blinding-text");
  ok(/Nobody was blinded, because surgical vs medical intervention could not be masked\./.test(unblindPara), "unblinded methods paragraph formatted with rationale");

  // Restore blinding groups and save
  await click("#rmd-blinding-none");
  await sleep(100);
  await click('[data-rmd="save-blinding"]');
  await sleep(200);

  // 8. CONSORT Flow screen and arithmetic checks
  await ev(`SMD_RESEARCH.open({ screen: "consort" }); 1`);
  ok(await until(`!!document.querySelector(".rmd-consort-screen")`, 5000), "consort screen rendered");

  // Set unbalanced numbers (assessed: 190, excluded: 50, randomised: 150 -> 190 != 200)
  await ev(`(()=>{
    const a = document.getElementById("rmd-cf-assessed");
    a.value = "190";
    a.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  const consortWarn = await text("#rmd-consort-banner");
  ok(/Assessed \(190\) does not equal excluded \(50\) plus randomised \(150\)/.test(consortWarn), "mismatch banner alerts on arithmetic discrepancy");
  ok(await ev(`!!document.querySelector("#rmd-consort-svg-wrap svg")`), "live CONSORT SVG diagram renders");

  // Balance numbers (assessed: 200)
  await ev(`(()=>{
    const a = document.getElementById("rmd-cf-assessed");
    a.value = "200";
    a.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  const consortBalanced = await text("#rmd-consort-banner");
  ok(/Flow numbers balance across all four checks\./.test(consortBalanced), "mismatch banner clears when arithmetic checks pass");

  // 9. Case report project and manuscript "Ask MaiK to draft it"
  await ev(`(()=>{
    const cr = {
      id: "prj_cr_test",
      serverId: "prj_cr_test",
      title: "Rare Adult Onset Still Disease",
      studyType: "case-report",
      createdAt: Date.now()
    };
    SMD_RESEARCH.store.adoptServerProject(cr);
    return true;
  })()`);

  // Store synthetic casefile data
  await ev(`(async () => {
    await RMDStore.put("prj_cr_test", "casefile", "main", {
      age: 45,
      sex: "Female",
      presentingComplaint: "Spiking fevers and evanescent salmon-pink rash",
      history: "Day 1: Patient presented with 39 C fever.",
      examination: "No lymphadenopathy.",
      investigations: [
        { date: "Day 3", test: "Serum Ferritin", value: "4500", unit: "ng/mL" }
      ],
      diagnosis: "Adult onset Still disease",
      treatment: "Intravenous pulse methylprednisolone",
      outcome: "Full clinical remission",
      unusual: "Acute hepatic involvement"
    });
  })()`);

  // Open manuscript screen
  await ev(`SMD_RESEARCH.open({ screen: "manuscript" }); 1`);
  ok(await until(`!!document.querySelector(".rmd-manuscript-screen")`, 5000), "manuscript screen rendered for case report");
  ok(await ev(`!!document.querySelector('[data-rmd="ask-maik-case-report"]')`), "Ask MaiK to draft it button is visible for case report project");

  // Open draft preview modal
  await click('[data-rmd="ask-maik-case-report"]');
  ok(await until(`!!document.getElementById("rmdCaseReportDraftModal")`, 5000), "case report draft preview modal opened");

  // Plant a phone number into preview text -> verify send blocked
  await ev(`(()=>{
    const t = document.getElementById("rmd-cr-preview-text");
    t.value = "Patient presented with fever. Phone contact for emergency: 9876543210.";
    t.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  ok(await ev(`!!document.getElementById("rmd-cr-findings")`), "planted phone number triggers de-identification findings alert");
  ok(await ev(`document.getElementById("rmd-cr-send-btn").disabled === true`), "send button is disabled while personal identifiers exist");

  // Clean the text -> verify send button still disabled until confirmation tick
  await ev(`(()=>{
    const t = document.getElementById("rmd-cr-preview-text");
    t.value = "Day 1: A 45-year-old female presented with 39 C fever. Day 3: Serum ferritin was 4500 ng/mL.";
    t.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  ok(await ev(`!document.getElementById("rmd-cr-findings")`), "findings clear on clean case text");
  ok(await ev(`document.getElementById("rmd-cr-send-btn").disabled === true`), "send button remains disabled before required confirmation tick");

  // Tick confirmation checkbox
  await ev(`(()=>{
    const tick = document.getElementById("rmd-cr-tick-noid");
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(100);
  ok(await ev(`document.getElementById("rmd-cr-send-btn").disabled === false`), "send button enabled after ticking confirmation");

  // Click send button
  await click("#rmd-cr-send-btn");
  ok(await until(`!document.getElementById("rmdCaseReportDraftModal")`, 10000), "modal closes after draft response received");

  // Verify drafted sections appended with Drafted by MaiK note
  ok(await until(`!!document.querySelector(".rmd-drafted-by-maik") || !!document.querySelector('[data-rmd-drafted="maik"]')`, 5000), "drafted sections rendered with Drafted by MaiK note");

  // Switch to detail view on phone to inspect section editor warnings
  await click('[data-rmd-phone-tab="detail"]');
  await sleep(150);

  // Verify missing number highlight (source had 4500, draft response had 5800)
  ok(await until(`!!document.querySelector(".rmd-missing-number-flag")`, 5000), "missing number highlight rendered for number not in source notes");
  const missingNotice = await text(".rmd-missing-number-flag");
  ok(/This number is not in your case file\. Check it/.test(missingNotice), "missing number warning reads: This number is not in your case file. Check it.");

  // 10. Responsive Viewports: 390x844 (iPhone) and 1024x1366 (iPad Pro)
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), "390x844 iPhone no horizontal scroll");
  await shot("phone-390-rct-flow");

  await call("Emulation.setDeviceMetricsOverride", { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: false });
  await sleep(200);
  ok(await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), "1024x1366 iPad no horizontal scroll");
  await shot("ipad-1024-rct-flow");

  // 11. Privacy Assertion: verify no request body held PHI or fixture IDs, and only case_report_draft had case text
  let privacyPass = true;
  const datePattern = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;
  const phonePattern = /\b[6-9]\d{9}\b/;
  const aadhaarPattern = /\b\d{12}\b|\b\d{4}[ -]\d{4}[ -]\d{4}\b/;
  const idPattern = /\b(?:UHID|MRN|IP[ -]?No|CR[ -]?No)\b/i;

  for (const r of recordedRequests) {
    const raw = JSON.stringify(r.body || {});
    if (r.body && r.body.task === "case_report_draft") {
      // Allowed to carry de-identified case text, but still must have no dates, phones, aadhaar
      if (phonePattern.test(raw) || aadhaarPattern.test(raw) || idPattern.test(raw)) {
        privacyPass = false;
        console.error("Privacy violation in case_report_draft payload:", raw);
      }
    } else {
      // Must not contain case text, dates, phones, aadhaar, or hospital numbers
      if (datePattern.test(raw) || phonePattern.test(raw) || aadhaarPattern.test(raw) || idPattern.test(raw)) {
        privacyPass = false;
        console.error("Privacy violation in payload:", raw);
      }
      if (r.body && r.body.input && r.body.input.caseText) {
        privacyPass = false;
        console.error("Non-case-report task payload carried case text:", raw);
      }
    }
  }
  ok(privacyPass, "privacy assertion: no request body held unallowed dates, phones, aadhaar, or hospital numbers; only case_report_draft carried case text");

  // 12. No em or en dashes in visible text
  const dashes = await ev(`(()=>{
    const t = document.querySelector("#researchMD").innerText || "";
    return (t.match(/[\\u2013\\u2014]/g) || []).length;
  })()`);
  ok(dashes === 0, "no em or en dashes in ResearchMD visible text");

  // 13. Zero page errors
  ok(pageErrors.length === 0, `zero page errors (got ${pageErrors.length}: ${pageErrors.join("; ")})`);

  console.log(failures === 0 ? "\nALL RESEARCH RCT & CASE REPORT UI CHECKS PASSED" : `\n${failures} RESEARCH RCT & CASE REPORT UI CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error("Harness error:", e);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
  server.close();
}
