// ResearchMD Phase 3 worker front door.
// Cron (every 10 minutes) -> one named Durable Object -> container POST /drain,
// repeated while jobs keep coming, then the container is stopped.
// The container pulls the research-jobs queue itself; this Worker only wakes
// it and forwards config. fetch() returns 404: nothing here is public.
//
// Uses the current Durable Object Container API (ctx.container), not the
// legacy @cloudflare/containers Container class. Contract:
// docs/research/contracts/phase-3/worker-runtime.md.

import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
// Backstop only: drain() stops the container itself once the queue is empty.
// Containers bill memory and disk for every second they run, so an idle
// container must not be kept warm (owner, 2026-11-27).
const IDLE_MS = 60 * 1000; // sleepAfter equivalent: setInactivityTimeout
// Drain rounds per wake: keep pulling while a round found work, up to this cap.
const MAX_ROUNDS = 20;
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
    // A tick that lands while an earlier drain is still working must not
    // start a second loop: the first one's stop would cut its jobs short.
    if (this.busy) return { status: 202, body: "busy" };
    this.busy = true;
    try {
      return await this.drainRounds();
    } finally {
      this.busy = false;
    }
  }

  async drainRounds() {
    const container = this.ctx.container;
    if (!container) throw new Error("container binding missing");
    if (!container.running) {
      const env = { RESEARCH_ENV: "production" };
      for (const key of ENV_KEYS) {
        const value = this.env[key];
        if (value !== undefined && value !== null && value !== "") env[key] = String(value);
      }
      // enableInternet is required when passing options: the container calls
      // the Queues API, R2 and the Pages callback.
      container.start({ env, enableInternet: true });
      await container.setInactivityTimeout(IDLE_MS);
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
    let res = null;
    let text = "";
    for (let round = 0; round < MAX_ROUNDS; round++) {
      res = await port.fetch("http://container/drain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Drain-Token": this.env.DRAIN_TOKEN || "",
        },
        body: "{}",
      });
      text = await res.text();
      if (!res.ok) {
        console.error("drain returned " + res.status + ": " + text);
        break;
      }
      let pulled = 0;
      try {
        pulled = Number(JSON.parse(text).pulled) || 0;
      } catch {
        pulled = 0;
      }
      if (pulled === 0) break; // queue empty
    }
    // Nothing left to do: stop the container now rather than paying for idle
    // minutes. The next cron tick starts it again.
    try {
      if (typeof container.destroy === "function") await container.destroy();
    } catch (err) {
      console.error("container stop failed; inactivity timeout will stop it", err);
    }
    return { status: res.status, body: text };
  }
}

export default {
  async scheduled(event, env, ctx) {
    const stub = env.RESEARCH_WORKER.getByName("singleton");
    ctx.waitUntil(
      stub.drain().catch((err) => {
        console.error("research drain failed", err);
      })
    );
  },

  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};