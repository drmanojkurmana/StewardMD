// connect-agent/runner.mjs -- Long-lived Node runner process for StewardMD Connect Hospital.
// Polls /runner/jobs/lease, drives Camofox discovery, compiles and validates candidate manifests,
// and reports each stage via /runner/jobs/:id/report with HMAC signing.
// NEVER executes inside a Cloudflare Pages request handler.
import { hmacHex } from "../functions/_connect/agent/hmac.js";
import { discoverAuthorizedEmr, attachToTab, PHASE_AGENT_READ } from "./discovery.mjs";
import { compileManifest } from "./manifest/compile.mjs";
import { validateCandidate } from "./manifest/validate.mjs";
import { createCamofoxClient } from "./camofox-client.mjs";

export async function signRunnerRequest({ method, pathname, body, runnerKey, runnerId, timestamp, nonce }) {
  const ts = timestamp || Date.now();
  const n = nonce || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  const rawBody = typeof body === "string" ? body : (body ? JSON.stringify(body) : "");
  const canonicalMsg = `${method.toUpperCase()}\n${pathname}\n${ts}\n${n}\n${rawBody}`;
  const sig = await hmacHex(runnerKey, canonicalMsg);
  return {
    headers: {
      "content-type": "application/json",
      "x-smd-timestamp": String(ts),
      "x-smd-nonce": String(n),
      "x-smd-signature": sig,
      "x-smd-runner-id": String(runnerId || "runner"),
    },
    body: rawBody,
  };
}

function mapSafeErrorCode(err, stage) {
  if (stage === "DISCOVERING") return "E_DISCOVERY_FAILED";
  if (stage === "COMPILING") return "E_COMPILE_FAILED";
  if (stage === "VALIDATING") return "E_VALIDATION_FAILED";
  const msg = String(err && err.message ? err.message : "").toLowerCase();
  if (msg.includes("discovery") || msg.includes("camofox") || msg.includes("tab")) return "E_DISCOVERY_FAILED";
  if (msg.includes("compile") || msg.includes("manifest")) return "E_COMPILE_FAILED";
  if (msg.includes("validat")) return "E_VALIDATION_FAILED";
  return "E_JOB_FAILED";
}

export async function processJob({ job, session, deployment }, options = {}) {
  const runnerKey = options.runnerKey || process.env.RUNNER_HMAC_KEY || process.env.CONNECT_AGENT_RUNNER_KEY;
  if (!runnerKey) throw new Error("RUNNER_HMAC_KEY missing");
  const runnerId = options.runnerId || process.env.RUNNER_ID || "runner-1";
  const baseUrl = options.baseUrl || process.env.CONNECT_BROKER_URL || "http://127.0.0.1:8788/api/connect/agent/runner/";
  const fetchFn = options.fetch || globalThis.fetch;
  const camofoxClient = options.camofoxClient || createCamofoxClient({
    baseUrl: process.env.CAMOFOX_URL,
    accessKey: process.env.CAMOFOX_ACCESS_KEY,
  });

  let currentStage = "DISCOVERING";

  async function sendReport(stage, outcome, extra = {}) {
    currentStage = stage;
    const reportUrl = new URL(`jobs/${encodeURIComponent(job.id)}/report`, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
    const payload = {
      stage,
      outcome,
      runnerId,
      ...extra,
    };
    const { headers, body } = await signRunnerRequest({
      method: "POST",
      pathname: reportUrl.pathname,
      body: payload,
      runnerKey,
      runnerId,
    });
    const res = await fetchFn(reportUrl.toString(), {
      method: "POST",
      headers,
      body,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Report HTTP ${res.status}: ${errText}`);
    }
    return res.json().catch(() => ({ ok: true }));
  }

  try {
    // --- STAGE 1: DISCOVERING ---
    await sendReport("DISCOVERING", "progress");

    let spec;
    const startUrl = (deployment?.origins && deployment.origins[0]) || job.startUrl;
    if (!startUrl) throw new Error("Missing startUrl for discovery");
    const allowedOrigins = (deployment?.origins && deployment.origins.length) ? deployment.origins : [new URL(startUrl).origin];

    if (session && session.state === "AUTHENTICATED" && session.tabId) {
      const collector = await attachToTab({
        tabId: session.tabId,
        userId: session.runnerRef,
        client: camofoxClient,
        policy: session.policy || null,
        phase: PHASE_AGENT_READ,
      });
      await collector.observe({ ms: options.discoveryWaitMs || 800 });
      spec = collector.collect({ allowedOrigins });
      await collector.detach().catch(() => {});
    } else {
      spec = await discoverAuthorizedEmr({
        startUrl,
        allowedOrigins,
        userId: session?.runnerRef || `runner-user-${job.id}`,
        sessionKey: `runner-ses-${job.id}`,
        client: camofoxClient,
        waitMs: options.discoveryWaitMs || 800,
        policy: session?.policy || null,
      });
    }

    if (!spec || !Array.isArray(spec.events)) {
      throw new Error("Discovery produced invalid spec");
    }

    await sendReport("DISCOVERING", "success");

    // --- STAGE 2: COMPILING ---
    await sendReport("COMPILING", "progress");

    const manifestId = `manifest-${job.deploymentId || job.id}`;
    const timezone = options.timezone || process.env.MANIFEST_TIMEZONE || "Asia/Kolkata";

    const { manifest } = await compileManifest(spec, {
      manifestId,
      timezone,
    });

    if (!manifest) throw new Error("Compiler produced no manifest");

    await sendReport("COMPILING", "success");

    // --- STAGE 3: VALIDATING ---
    await sendReport("VALIDATING", "progress");

    const fixture = options.validationFixture || job.validationFixture || { routes: {} };
    const validation = await validateCandidate({ manifest, fixture });

    if (!validation.ok && validation.checks && validation.checks.some((c) => c.name === "schema" && !c.ok)) {
      throw new Error("Candidate validation failed schema checks");
    }

    const candidateVersionId = "ver_" + (manifest.contentHash ? manifest.contentHash.replace(/^sha256:/, "").slice(0, 16) : Date.now().toString(36));

    // Terminal success report: records candidate version ID and validation evidence
    // Does NOT call activation.js -- human reviewer approval is required to activate
    await sendReport("VALIDATING", "success", {
      candidateVersionId,
      manifest,
      evidenceHash: validation.evidenceHash,
    });

    return { ok: true, manifest, candidateVersionId, validation };
  } catch (err) {
    const safeCode = mapSafeErrorCode(err, currentStage);
    try {
      await sendReport(currentStage, "failure", { errorCode: safeCode });
    } catch {}
    return { ok: false, stage: currentStage, errorCode: safeCode };
  }
}

export async function pollAndProcessOnce(options = {}) {
  const runnerKey = options.runnerKey || process.env.RUNNER_HMAC_KEY || process.env.CONNECT_AGENT_RUNNER_KEY;
  if (!runnerKey) throw new Error("RUNNER_HMAC_KEY missing");
  const runnerId = options.runnerId || process.env.RUNNER_ID || "runner-1";
  const baseUrl = options.baseUrl || process.env.CONNECT_BROKER_URL || "http://127.0.0.1:8788/api/connect/agent/runner/";
  const fetchFn = options.fetch || globalThis.fetch;

  const leaseUrl = new URL("jobs/lease", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  const leaseBody = { runnerId, ttlMs: options.leaseTtlMs || 30000 };
  const { headers, body } = await signRunnerRequest({
    method: "POST",
    pathname: leaseUrl.pathname,
    body: leaseBody,
    runnerKey,
    runnerId,
  });

  const res = await fetchFn(leaseUrl.toString(), {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Lease HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  if (!data || !data.job) {
    return { leased: false, job: null };
  }

  const result = await processJob({
    job: data.job,
    session: data.session,
    deployment: data.deployment,
  }, options);

  return { leased: true, job: data.job, result };
}

export async function startRunner(options = {}) {
  let running = true;
  let inFlight = null;

  const shutdown = async () => {
    running = false;
    if (inFlight) {
      try { await inFlight; } catch {}
    }
  };

  const sigtermHandler = () => { shutdown().catch(() => {}).finally(() => process.exit(0)); };
  process.on("SIGTERM", sigtermHandler);
  process.on("SIGINT", sigtermHandler);

  const intervalMs = options.pollIntervalMs || Number(process.env.POLL_INTERVAL_MS) || 5000;

  try {
    while (running) {
      try {
        inFlight = pollAndProcessOnce(options);
        await inFlight;
      } catch (err) {
        // A crash mid-job must not wedge the loop - wrap each cycle in try/catch.
      } finally {
        inFlight = null;
      }
      if (running) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  } finally {
    process.removeListener("SIGTERM", sigtermHandler);
    process.removeListener("SIGINT", sigtermHandler);
  }
}

import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startRunner().catch((e) => {
    console.error("Runner stopped with error:", e.message);
    process.exit(1);
  });
}
