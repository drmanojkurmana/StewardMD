/* Research worker front door: the container is restarted when its forwarded env changes
 * (a secret added after the container started used to leave jobs stuck in "queued").
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-worker-env-restart.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Node cannot load the cloudflare:workers scheme; swap that one import for a stub base class. */
const src = readFileSync(new URL("../workers/research-worker/src/index.js", import.meta.url), "utf8")
  .replace('import { DurableObject } from "cloudflare:workers";',
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }");
const { ResearchWorkerContainer } = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));

function fakeCtx(running) {
  const calls = { start: [], destroy: 0 };
  const store = new Map();
  const container = {
    running,
    start(opts) { calls.start.push(opts); this.running = true; },
    async destroy() { calls.destroy++; this.running = false; },
    async setInactivityTimeout() {},
    monitor() { return new Promise(() => {}); },
    getTcpPort() { return { fetch: async () => new Response("{}", { status: 200 }) }; },
  };
  const ctx = {
    container,
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } },
    waitUntil() {},
  };
  return { ctx, calls, store };
}

test("restarts a running container whose env fingerprint is unknown or changed, never stores values", async () => {
  const { ctx, calls, store } = fakeCtx(true);
  const env = { DRAIN_TOKEN: "t", R2_ACCESS_KEY_ID: "fake-id", R2_SECRET_ACCESS_KEY: "fake-secret" };
  const w = new ResearchWorkerContainer(ctx, env);
  await w.drain();
  assert.equal(calls.destroy, 1, "running container with no fingerprint is restarted");
  assert.equal(calls.start.length, 1);
  assert.equal(calls.start[0].env.R2_ACCESS_KEY_ID, "fake-id", "new env forwarded");
  const fp = store.get("envFingerprint");
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.ok(!fp.includes("fake-secret"), "only a hash is stored");

  await w.drain();
  assert.equal(calls.destroy, 1, "same env: no restart");
  assert.equal(calls.start.length, 1);

  w.env = Object.assign({}, env, { R2_SECRET_ACCESS_KEY: "rotated" });
  await w.drain();
  assert.equal(calls.destroy, 2, "rotated secret: restart");
  assert.equal(calls.start.length, 2);
});
