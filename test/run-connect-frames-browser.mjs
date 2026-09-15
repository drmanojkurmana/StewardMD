/* test/run-connect-frames-browser.mjs - THE EMR IN A FRAMESET.
 *
 * A great many hospital systems still in daily use are framesets: a nav frame on the left, a content
 * frame that holds every clinical screen, and a top document that is nothing but <frameset>. To the
 * crawl that top document has no table, no text and no controls - it reads as a dead page, and the
 * hospital cannot be integrated at all.
 *
 * The frames here are same-origin, which is what a hospital's own frameset is. A cross-origin frame
 * is none of the agent's business and must be skipped without throwing.
 *
 * Usage: node test/run-connect-frames-browser.mjs
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { deepCrawlClinical } from "../connect-agent/phone/deep-crawl.mjs";
import { readRowsExpression } from "../connect-agent/phone/runtime.mjs";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DBG = 9395;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/connect-frames-chrome";

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const PAGE = (body) => `<!doctype html><html><head><title>Frameset EMR</title></head>${body}</html>`;

function startFramesetEmr() {
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0];
    const html = (b) => { res.writeHead(200, { "content-type": "text/html" }); res.end(b); };
    if (path === "/" || path === "/index.html") {
      // The top document really is nothing but a frameset: no table, no text, no link.
      return html(PAGE(`<frameset cols="180,*">
        <frame name="nav" src="/nav.html">
        <frame name="main" src="/worklist.html">
      </frameset>`));
    }
    if (path === "/nav.html") {
      return html(PAGE(`<body><ul>
        <li><a href="/worklist.html" target="main">In patients</a></li>
        <li><a href="/labs.html" target="main">Lab reports</a></li>
      </ul></body>`));
    }
    if (path === "/worklist.html") {
      return html(PAGE(`<body><h2>Admitted patients</h2>
        <table id="wardTable" class="table">
          <thead><tr><th>UHID</th><th>Patient name</th><th>Ward</th><th>Bed</th></tr></thead>
          <tbody>
            <tr onclick="openPatient('MR100001','IP900001')"><td>MR100001</td><td>Synthetic Testpatient One</td><td>Medicine</td><td>B-12</td></tr>
            <tr onclick="openPatient('MR100002','IP900002')"><td>MR100002</td><td>Synthetic Testpatient Two</td><td>Medicine</td><td>B-14</td></tr>
          </tbody>
        </table>
        <script>function openPatient(a,b){ location.href = '/patient.html'; }</script></body>`));
    }
    if (path === "/patient.html") {
      return html(PAGE(`<body><h2>Patient record</h2>
        <ul><li><a href="/labs.html">Lab reports</a></li><li><a href="/meds.html">Medications</a></li></ul></body>`));
    }
    if (path === "/labs.html") {
      return html(PAGE(`<body><table id="labTable"><thead><tr><th>Date</th><th>Test</th><th>Result</th><th>Unit</th></tr></thead>
        <tbody><tr><td>01/02/26</td><td>Haemoglobin</td><td>11.2</td><td>g/dL</td></tr></tbody></table></body>`));
    }
    if (path === "/meds.html") {
      return html(PAGE(`<body><table id="medTable"><thead><tr><th>Drug</th><th>Dose</th><th>Route</th></tr></thead>
        <tbody><tr><td>Amoxicillin</td><td>500 mg</td><td>Oral</td></tr></tbody></table></body>`));
    }
    res.writeHead(404); res.end("no");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
    }));
  });
}

async function main() {
  const emr = await startFramesetEmr();
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${userDir}`,
    "--no-first-run", "--disable-gpu", "--mute-audio",
  ], { stdio: "ignore" });
  let ws;
  try {
    let ver;
    for (let i = 0; i < 150 && !ver; i += 1) {
      try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch { await sleep(200); }
    }
    if (!ver) throw new Error("chrome did not expose CDP");
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 1; const pending = new Map(); let sessionId;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    const call = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId })); });
    const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
    ({ result: { sessionId } } = await call("Target.attachToTarget", { targetId, flatten: true }));
    await call("Runtime.enable");
    await call("Page.navigate", { url: emr.origin + "/" });
    const evaluate = async ({ expression }) => {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error("page error: " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return { result: r.result?.result?.value ?? null };
    };
    for (let i = 0; i < 60; i += 1) {
      const done = await evaluate({ expression: 'document.readyState === "complete"' });
      if (done.result === true) break;
      await sleep(200);
    }

    // The premise: the top document is empty. If this stops being true the test proves nothing.
    const topTables = await evaluate({ expression: "document.querySelectorAll('table').length" });
    ok(topTables.result === 0, `the top document holds no table at all (it is a frameset): ${topTables.result}`);
    const framed = await evaluate({ expression: "window.frames.length" });
    ok(framed.result === 2, `the clinical screens live in ${framed.result} frames`);

    const client = { evaluate, async wait({ ms }) { await sleep(Math.min(ms, 300)); }, async currentUrl() { return { url: emr.origin + "/" }; } };
    const { observedViews, stopReason } = await deepCrawlClinical({ client, caps: { maxMs: 60000, waitMs: 300 } });

    ok(stopReason !== "session-expired-or-shell", `a frameset EMR is not a dead page (stopReason: ${stopReason})`);
    const worklist = observedViews.find((v) => v.resourceHint === "worklist");
    ok(!!worklist, `the ward list inside the frame was captured (views: ${observedViews.map((v) => v.resourceHint).join(",") || "none"})`);
    if (worklist) {
      ok(/wardTable/.test(worklist.rowsSelector || ""), `its rows are anchored on the real table (${worklist.rowsSelector})`);
      ok(Array.isArray(worklist.headers) && worklist.headers.includes("Patient name"), `its headers came from the frame (${(worklist.headers || []).join(", ")})`);
      ok(Array.isArray(worklist.framePath) && worklist.framePath.length > 0, `the view remembers which frame it came from (framePath: ${JSON.stringify(worklist.framePath)})`);

      // AND THE APPROVED ADAPTER CAN READ IT BACK. Reading `document` here would read the <frameset>.
      const read = await evaluate({ expression: readRowsExpression(worklist) });
      let rows = [];
      try { rows = JSON.parse(read.result || "[]"); } catch { rows = []; }
      ok(rows.length === 2, `the adapter read the ward rows out of the frame (${rows.length} rows)`);
      const names = rows.map((r) => Object.values(r).join(" ")).join(" | ");
      ok(/Testpatient One/.test(names) && /MR100001/.test(names), `the rows carry what the doctor sees (${names.slice(0, 90)})`);
    }

    console.log(fails === 0 ? "\nALL GREEN - connect-frames-browser test passed" : `\n${fails} FAILED`);
  } catch (e) {
    console.error("HARNESS ERROR:", (e && e.stack) || e);
    fails++;
  } finally {
    try { ws && ws.close(); } catch {}
    chrome.kill();
    await emr.close();
    process.exit(fails === 0 ? 0 : 1);
  }
}

await main();
