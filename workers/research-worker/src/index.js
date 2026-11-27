// ResearchMD Phase 3 worker front door.
// Cron (every minute) -> D1 open-job check -> one named Durable Object -> container POST /drain.
// The container pulls the research-jobs queue itself; this Worker only wakes
// it and forwards config. fetch() returns 404: nothing here is public.
//
// Uses the current Durable Object Container API (ctx.container), not the
// legacy @cloudflare/containers Container class. Contract:
// docs/research/contracts/phase-3/worker-runtime.md.

import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
const IDLE_MS = 5 * 60 * 1000; // sleepAfter equivalent: setInactivityTimeout
const READY_ATTEMPTS = 60;
const READY_DELAY_MS = 500;

// Forwarded to the container process via start({env}). Secrets live in
// wrangler secrets; vars in wrangler.toml. Never hardcode values here.
const ENV_KEYS = [
  "CF_ACCOUNT_ID",
  "CF_QUEUE_ID",
  "CF_QUEUES_TOKEN",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "RESEARCH_CALLBACK_SECRET",
  "RESEARCH_CALLBACK_URL",
  "RESEARCH_GATEWAY_URL",
  "RESEARCH_API_URL",
  "RESEARCH_IPD_KEK",
  "DRAIN_TOKEN",
];

async function envFingerprint(env) {
  const text = Object.keys(env).sort().map((k) => k + "=" + env[k]).join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class ResearchWorkerContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Re-arm idle timeout and exit monitoring after a DO restart.
    if (ctx.container && ctx.container.running) {
      ctx.container.setInactivityTimeout(IDLE_MS).catch((err) => {
        console.error("setInactivityTimeout failed", err);
      });
      this.armMonitor();
    }
  }

  armMonitor() {
    this.ctx.waitUntil(
      this.ctx.container.monitor().catch((err) => {
        console.error("research container exited unexpectedly", err);
      })
    );
  }

  async drain() {
    const container = this.ctx.container;
    if (!container) throw new Error("container binding missing");
    const env = { RESEARCH_ENV: "production" };
    for (const key of ENV_KEYS) {
      const value = this.env[key];
      if (value !== undefined && value !== null && value !== "") env[key] = String(value);
    }
    // The container reads its env once, at start. A secret or var changed since then (e.g. R2 keys added
    // after the first deploy) left it running with the old set and every job stuck in "queued". Keep a
    // hash of the env (never the values) and restart the container when it changes.
    const fingerprint = await envFingerprint(env);
    if (container.running && (await this.ctx.storage.get("envFingerprint")) !== fingerprint) {
      console.log("research container env changed; restarting");
      await container.destroy("env changed").catch(() => {});
    }
    if (!container.running) {
      // enableInternet is required when passing options: the container calls
      // the Queues API, R2 and the Pages callback.
      container.start({ env, enableInternet: true });
      await container.setInactivityTimeout(IDLE_MS);
      await this.ctx.storage.put("envFingerprint", fingerprint);
      this.armMonitor();
    }
    const port = container.getTcpPort(PORT);
    // start() returns before the process is ready; poll /health first.
    let ready = false;
    for (let i = 0; i < READY_ATTEMPTS; i++) {
      try {
        const res = await port.fetch("http://container/health");
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, READY_DELAY_MS));
    }
    if (!ready) throw new Error("research container never became ready");
    const res = await port.fetch("http://container/drain", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Drain-Token": this.env.DRAIN_TOKEN || "",
      },
      body: "{}",
    });
    const text = await res.text();
    if (!res.ok) console.error("drain returned " + res.status + ": " + text);
    return { status: res.status, body: text };
  }
}

// Only rows this recent count as waiting work. Rows left in "queued" by a lost message would
// otherwise keep the container awake forever (lease is 2 h, so a live job is always newer).
// shortcut: a job older than 3 h whose message is still in the queue waits for the next new job; fine while jobs finish in minutes.
const OPEN_WINDOW_MS = 3 * 60 * 60 * 1000;
const OPEN_JOBS_SQL =
  "SELECT (SELECT COUNT(*) FROM research_job_runs WHERE status IN ('queued','running') AND created_ts > ?1)" +
  " + (SELECT COUNT(*) FROM research_stats_jobs WHERE status IN ('queued','running') AND created_ts > ?1) AS n";

// The cron must not wake the container when nothing is waiting: every /drain call counts as
// activity, so an unconditional drain kept the 4 GB container running 24/7.
export async function hasOpenJobs(env, now = Date.now()) {
  if (!env.RESEARCH_DB) return true; // no binding: keep the old always-drain behaviour
  try {
    const row = await env.RESEARCH_DB.prepare(OPEN_JOBS_SQL).bind(now - OPEN_WINDOW_MS).first();
    return Number((row && row.n) || 0) > 0;
  } catch (err) {
    console.error("research open-job check failed; draining anyway", String((err && err.message) || err));
    return true; // fail open: a D1 blip must not strand jobs
  }
}

export default {
  async scheduled(event, env, ctx) {
    if (!(await hasOpenJobs(env))) return;
    const stub = env.RESEARCH_WORKER.getByName("singleton");
    ctx.waitUntil(
      stub.drain().then((r) => {
        // drain_once returns counts only ({pulled, done, failed, ...}); safe to log.
        console.log("research drain " + r.status + " " + String(r.body || "").slice(0, 300));
      }).catch((err) => {
        console.error("research drain failed", String((err && err.message) || err));
      })
    );
  },

  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};