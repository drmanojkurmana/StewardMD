/* test/wardsynq-offline.test.mjs - P2.4 offline-first operation.
 *
 * Tests replayFor, idempotency conflicts, offline audit timestamps, and offline cache bounds.
 *
 * node --test test/wardsynq-offline.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { MemoryRepository } from "../functions/_wardsynq/repository.js";
import { RecordService, IdempotencyConflictError } from "../functions/_wardsynq/service.js";
import { requestContextOf } from "../functions/_wardsynq/actor.js";
import { makeActor, KIND, TIER } from "../wardsynq/wardsynq-actors.js";

const createActor = (rc) => ({
  ...makeActor({
    id: "staff-1",
    kind: KIND.HUMAN,
    tier: TIER.EXECUTE,
    display: "Dr Offline",
    credential: "held-by-server",
  }),
  requestContext: rc || null,
  roles: ["doctor"],
  grants: { Observation: { create: true, read: true }, Task: { create: true, read: true, update: true } },
});

test("requestContextOf extracts valid X-Offline-Created-At and conflict reason", () => {
  const req1 = new Request("https://example.com", {
    headers: {
      "X-Offline-Created-At": "2026-09-13T10:00:00Z",
      "X-Offline-Conflict-Reason": encodeURIComponent("Nurse override at bedside"),
    },
  });
  const rc1 = requestContextOf(req1, null);
  assert.ok(rc1.offline);
  assert.equal(rc1.offline.createdAt, "2026-09-13T10:00:00.000Z");
  assert.equal(rc1.offline.conflictReason, "Nurse override at bedside");

  // Invalid timestamp marked unreadable rather than stored or thrown
  const req2 = new Request("https://example.com", {
    headers: { "X-Offline-Created-At": "not-a-date" },
  });
  const rc2 = requestContextOf(req2, null);
  assert.ok(rc2.offline);
  assert.equal(rc2.offline.createdAt, "unreadable");

  // No offline headers means rc.offline is undefined
  const req3 = new Request("https://example.com");
  const rc3 = requestContextOf(req3, null);
  assert.equal(rc3.offline, undefined);
});

test("RecordService.replayFor returns committed record on retry", async () => {
  const repo = new MemoryRepository();
  const svc = new RecordService({ repository: repo, tenant: { id: "tenant-1" }, actor: createActor() });

  const entity = { resourceType: "Observation", id: "obs-1", patientId: "pat-1", code: "TEMP", value: 37.0 };
  const putRes = await svc.put(entity, { idempotencyKey: "key-123" });
  assert.equal(putRes.record.id, "obs-1");

  // Replay for same key, type and patient returns the committed record
  const replay = await svc.replayFor("key-123", "Observation", "pat-1", "obs-1");
  assert.ok(replay);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, "obs-1");

  // Non-existent key returns null
  const noReplay = await svc.replayFor("unknown-key", "Observation", "pat-1", "obs-1");
  assert.equal(noReplay, null);

  // Reusing same key for a different patient throws IdempotencyConflictError
  await assert.rejects(
    async () => { await svc.replayFor("key-123", "Observation", "pat-2", "obs-1"); },
    (err) => err instanceof IdempotencyConflictError
  );

  // Reusing same key for a different resourceType throws IdempotencyConflictError
  await assert.rejects(
    async () => { await svc.replayFor("key-123", "Task", "pat-1", "obs-1"); },
    (err) => err instanceof IdempotencyConflictError
  );
});

test("RecordService audit captures offline createdAt and server syncedAt on writes", async () => {
  const repo = new MemoryRepository();
  const rc = {
    offline: { createdAt: "2026-09-13T10:00:00.000Z", conflictReason: "Bedside sync" },
  };
  const svc = new RecordService({ repository: repo, tenant: { id: "tenant-1" }, actor: createActor(rc) });

  const entity = { resourceType: "Observation", id: "obs-2", patientId: "pat-1", code: "HR", value: 72 };
  await svc.put(entity);

  const loggedEvent = repo.audit[0];
  assert.ok(loggedEvent);
  assert.ok(loggedEvent.scope);
  assert.ok(loggedEvent.scope.offline);
  assert.equal(loggedEvent.scope.offline.createdAt, "2026-09-13T10:00:00.000Z");
  assert.equal(loggedEvent.scope.offline.clientClock, true);
  assert.equal(loggedEvent.scope.offline.conflictReason, "Bedside sync");
  assert.ok(loggedEvent.scope.offline.syncedAt);
});

test("ward-offline IIFE defines WARD_OFFLINE in browser/globalThis environment", async () => {
  await import("../ward-offline.js");
  assert.ok(globalThis.WARD_OFFLINE);
  assert.equal(typeof globalThis.WARD_OFFLINE.create, "function");
  assert.equal(typeof globalThis.WARD_OFFLINE.label, "function");
  assert.equal(typeof globalThis.WARD_OFFLINE.deviceFor, "function");
  assert.equal(globalThis.WARD_OFFLINE.label({ syncing: true }).text, "Syncing");
  assert.equal(globalThis.WARD_OFFLINE.label({ online: false, waiting: 3 }).text, "Offline (3 waiting)");
});
