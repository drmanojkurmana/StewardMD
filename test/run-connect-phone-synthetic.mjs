/* test/run-connect-phone-synthetic.mjs - Headless Chrome CDP test for connect-agent/phone/**.
 *
 * Implements the ConnectBrowser plugin interface (local-plugins/capacitor-connect-browser/README.md)
 * over the Chrome DevTools Protocol -- Page.addScriptToEvaluateOnNewDocument for initScript,
 * Runtime.evaluate for evaluate, Page.navigate for navigate/open -- and runs runPhoneDiscovery()
 * against the synthetic, non-GHIS EMR in test/connect-agent/synthetic-emr-server.mjs, with the local
 * defaultPlanner and an in-process fake `api` (discovery -> compileManifest, evidence -> echo).
 *
 * CONTRACT DEVIATION (not owned by this task -- see report): connect-agent/phone/CONTRACT.md
 * documents the phone spec shape as `createCollector().collect()`'s output, which is
 * `{version:3, browser:"phone-ios"|"phone-android", ...}`. connect-agent/manifest/compile.mjs
 * hard-requires `spec.version === 2` (it only accepts the legacy discoverAuthorizedEmr() shape).
 * api.discovery below overrides version to 2 before calling compileManifest so this test can exercise
 * the real compiler; the broker route that will eventually wrap compileManifest server-side needs the
 * same fix (or compile.mjs needs to accept version 3), which is outside connect-agent/phone/** and
 * this task's ownership.
 *
 * Proves the phone engine end to end against real HTTP, real cookies, and a real DOM/browser -- not a
 * fake fetch or a fake snapshot.
 *
 * Usage: node test/run-connect-phone-synthetic.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { startSyntheticEmr } from "./connect-agent/synthetic-emr-server.mjs";
import { compileManifest } from "../connect-agent/manifest/compile.mjs";
import { runPhoneDiscovery } from "../connect-agent/phone/index.mjs";
import { defaultPlanner } from "../connect-agent/phone/explore.mjs";
import { createPluginClient } from "../connect-agent/phone/plugin-client.mjs";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DBG = 9387;
const userDir = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/connect-phone-synthetic-chrome";

let fails = 0;
const ok = (c, m) => {
  console.log((c ? "PASS " : "FAIL ") + m);
  if (!c) fails++;
};

// --- minimal CDP client (same pattern as test/run-connect-agent-boot-ui.mjs) -------------------

let msgId = 1;
const pending = new Map();
let ws, sessionId;

const call = (m, p) => {
  const i = msgId++;
  return new Promise((r) => {
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId }));
  });
};

async function attach() {
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true });
  sessionId = sid;
  await call("Runtime.enable", {});
  await call("Page.enable", {});
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    const r = await call("Runtime.evaluate", { expression: "document.readyState === 'complete'", returnByValue: true });
    if (r.result && r.result.result && r.result.result.value === true) return true;
    await sleep(150);
  }
  return false;
}

// --- CDP-backed "ConnectBrowser" plugin -----------------------------------------------------------

function makeCdpPlugin() {
  return {
    platform: "ios",
    async open({ url, initScript }) {
      if (initScript) await call("Page.addScriptToEvaluateOnNewDocument", { source: initScript });
      await call("Page.navigate", { url });
      await waitReady();
      return { ok: true };
    },
    async navigate({ url }) {
      await call("Page.navigate", { url });
      await waitReady();
      return { ok: true };
    },
    async evaluate({ expression }) {
      const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) {
        throw new Error((r.result.exceptionDetails.text || "evaluate failed") + (r.result.exceptionDetails.exception ? ": " + (r.result.exceptionDetails.exception.description || r.result.exceptionDetails.exception.value) : ""));
      }
      const v = r.result && r.result.result ? r.result.result.value : null;
      return { result: v === undefined ? null : v };
    },
    async currentUrl() {
      const r = await call("Runtime.evaluate", { expression: "location.href", returnByValue: true });
      return { url: r.result && r.result.result ? r.result.result.value : null };
    },
    async setMode() { return { ok: true }; },
    async drainRequests() { return { requests: [] }; },
    async close() { return { ok: true }; },
  };
}

// --- login helper: real form submission, real Set-Cookie ------------------------------------------

async function loginViaBrowser(loginUrl, creds) {
  await call("Page.navigate", { url: loginUrl });
  await waitReady();
  // NOT form.submit(): the login page's submit button has id="submit", and a named form control's id
  // shadows HTMLFormElement.prototype.submit as an own property (a real DOM gotcha, verified live --
  // form.submit() throws "document.getElementById(...).submit is not a function"). Click the button
  // instead, exactly like a real doctor would.
  const script = `
    document.getElementById('u').value = ${JSON.stringify(creds.username)};
    document.getElementById('p').value = ${JSON.stringify(creds.password)};
    document.getElementById('submit').click();
    true;
  `;
  await call("Runtime.evaluate", { expression: script });
  await sleep(500);
  await waitReady();
}

async function main() {
  const emr = await startSyntheticEmr();

  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run",
    "--disable-gpu",
    "--mute-audio",
  ], { stdio: "ignore" });

  try {
    let ver, t = 0;
    while (t++ < 60) {
      try { ver = await (await fetch(`http://localhost:${DBG}/json/version`)).json(); break; }
      catch { await sleep(200); }
    }
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };

    await attach();
    await loginViaBrowser(`${emr.origin}/login`, emr.creds);

    const authed = await call("Runtime.evaluate", { expression: "document.getElementById('ready') && document.getElementById('ready').textContent", returnByValue: true });
    ok((authed.result && authed.result.result && authed.result.result.value || "").includes("authenticated"), "real login via a form POST reached the authenticated worklist page");

    const deployment = { id: "dep-synthetic", origins: [emr.origin, emr.apiOrigin] };
    const rawPlugin = makeCdpPlugin();
    // Exercises connect-agent/phone/plugin-client.mjs for real: the six-method client explorePhone/
    // createCollector expect, adapted from the CDP-backed plugin above exactly as it would be from the
    // real Capacitor ConnectBrowser plugin.
    const plugin = createPluginClient({ plugin: rawPlugin, storeId: "test-store", origins: deployment.origins, title: "Synthetic EMR" });

    let discoveryCall = null;
    let evidenceCall = null;
    const api = {
      plan: (args) => defaultPlanner(args),
      progress: async () => ({ ok: true }),
      discovery: async ({ spec, steps }) => {
        discoveryCall = { spec, steps };
        const compileSpec = { ...spec, version: 2 };
        const { manifest } = await compileManifest(compileSpec, { manifestId: "synthetic-phone-emr", timezone: "Asia/Kolkata" });
        const probes = manifest.operations.map((op, i) => {
          const originEntry = manifest.origins.find((o) => o.id === op.originId);
          const origin = (originEntry && originEntry.origin) || deployment.origins[0];
          const path = op.pathTemplate.replace(/\{[a-zA-Z]+\}/, "pt-482910");
          return { opId: `op-${i}`, method: op.method, url: `${origin}${path}` };
        });
        return { candidateVersionId: "ver_synthetic", manifest, probes, capabilities: [] };
      },
      evidence: async ({ probes }) => {
        evidenceCall = probes;
        return { capabilities: probes.map((p) => ({ operation: p.opId, proven: p.status === 200 })), evidenceHash: "sha256:test", state: "AWAITING_APPROVAL" };
      },
    };

    const progressEvents = [];
    const result = await runPhoneDiscovery({
      plugin, api, session: { id: "phone-session-1" }, deployment,
      startUrl: `${emr.origin}/worklist`,
      onProgress: (p) => progressEvents.push(p.phase),
      caps: { maxSteps: 6, maxMs: 30000, maxDepth: 4, waitMs: 700 },
    });

    ok(progressEvents.includes("DISCOVERING") && progressEvents.includes("DONE"), `onProgress fired through the phases (saw: ${progressEvents.join(",")})`);

    const jsonEvents = result.spec.events.filter((e) => e.responseShape);
    ok(jsonEvents.length > 0, `at least one JSON endpoint was discovered with a response shape (found ${jsonEvents.length}: ${jsonEvents.map((e) => e.path).join(", ")})`);

    const patientStep = result.steps.find((s) => s.toUrl && /\/patients\//.test(s.toUrl));
    ok(!!patientStep, `at least one patient-level step was taken (steps: ${JSON.stringify(result.steps.map((s) => ({ action: s.action || "click", toUrl: s.toUrl })))})`);

    ok(!!result.manifest, "discovery result carried a compiled manifest");
    const hasListResults = !!result.manifest && result.manifest.operations.some((op) => op.type === "list_results");
    ok(hasListResults, `compiled manifest has a list_results-type operation (types: ${result.manifest ? result.manifest.operations.map((o) => o.type).join(",") : "none"})`);

    ok(result.probes.length > 0, "probePhone produced at least one probe result");
    const probe200 = result.probes.some((p) => p.status === 200);
    ok(probe200, `at least one probe returned status 200 (statuses: ${result.probes.map((p) => p.status).join(",")})`);

    ok(evidenceCall !== null, "api.evidence was called with the probe results");
    ok(!!result.evidenceHash, "final view carries an evidenceHash from api.evidence");

    console.log(fails === 0 ? "\nALL GREEN - connect-phone-synthetic test passed" : `\n${fails} FAILED`);
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
