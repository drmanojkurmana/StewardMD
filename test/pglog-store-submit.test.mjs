/* test/pglog-store-submit.test.mjs — what the client does when the server says NO.
 *
 * Before: every failed submission was queued and retried forever, including a 400 the server would
 * give on every retry (a validation failure, an unknown supervisor). The resident saw "it will be
 * submitted when you are online" and nothing else, ever. Now:
 *   - offline / network / 5xx / 429 / 401 -> queued and retried
 *   - any other 4xx -> NOT queued; kept as a draft with lastError {code, message}, shown as "Fix"
 *   - flush() moves a 4xx out of the queue into that state instead of retrying it forever
 * Plus: drafts made before linking are stamped with the link, a retry after "create worked, submit
 * failed" does not POST a second copy, and the offline cold start has a cached /me to open with.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../pglog-store.js", import.meta.url), "utf8");
const MODEL_SRC = readFileSync(new URL("../pglog-model.js", import.meta.url), "utf8");

function loadStore(fetchImpl, opts = {}) {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const win = {
    SMD_PGLOG_FLAGS: { bool: (k) => k === "smd_pglog_server" },
    localStorage,
    navigator: { onLine: opts.offline ? false : true },
    SMD_IDTOKEN: () => "test-token",
    addEventListener() {},
    location: { origin: "https://stewardmd.in" },
    fetch: fetchImpl,
  };
  new Function("window", "module", MODEL_SRC)(win, { exports: {} });
  const mod = { exports: {} };
  new Function("window", "localStorage", "module", "document", "fetch", SRC)(win, localStorage, mod, { addEventListener() {} }, fetchImpl);
  return { store: win.SMD_PGLOG_STORE || mod.exports, win };
}

const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

/* A scriptable server. `submit` decides what /submit answers; creates are counted. */
function server(opts = {}) {
  const calls = { created: [], patched: [], submitted: [], urls: [] };
  let n = 0;
  const impl = (url, o) => {
    const u = String(url);
    calls.urls.push((o && o.method || "GET") + " " + u);
    const body = o && o.body ? JSON.parse(o.body) : {};
    if (opts.network) return Promise.reject(new TypeError("Failed to fetch"));
    if (/\/entries$/.test(u) && o.method === "POST") {
      if (opts.create) return opts.create(body);
      const id = "srv-" + (++n);
      calls.created.push({ id, body });
      return reply(200, { ok: true, entry: { id, status: "draft" } });
    }
    if (/\/entries\/[^/]+$/.test(u) && o.method === "PATCH") { calls.patched.push({ u, body }); return reply(200, { ok: true, entry: {} }); }
    if (/\/submit$/.test(u)) {
      calls.submitted.push(u);
      return opts.submit ? opts.submit(u) : reply(200, { ok: true, entry: { id: "x", status: "submitted" }, routing: "guide" });
    }
    if (/\/me\?/.test(u)) return opts.me ? opts.me(u) : reply(200, { ok: true, orgId: "org1", orgCode: "SMD-ABC123", role: "pg_resident", resident: { id: "res-1", programmeId: "p1" } });
    if (/\/dashboard\/resident/.test(u)) return reply(200, { ok: true, summary: { total: 3 } });
    return reply(200, { ok: true });
  };
  return { impl, calls };
}

const draft = (over = {}) => Object.assign({ kind: "procedure", occurredAt: "2026-08-20", procedureText: "Ascitic tap",
  role: "performed_supervised", supervisor: "fb:guide-1", residentId: "res-1" }, over);

test("a 4xx is NOT queued: the draft stays with lastError and shows up in failedDrafts()", async () => {
  const srv = server({ submit: () => reply(400, { error: "supervisor_unresolved",
    message: "That supervisor is not on your department's faculty list — pick another." }) });
  const { store } = loadStore(srv.impl);
  const d = store.saveDraft(draft());
  const r = await store.submitOrQueue(d.id);
  assert.equal(r.status, "needs_fix");
  assert.equal(r.lastError.code, "supervisor_unresolved");
  assert.doesNotMatch(r.lastError.message, /[—–]/, "no em-dash reaches the app");
  assert.equal(store.queued().length, 0, "not queued");
  const f = store.failedDrafts();
  assert.equal(f.length, 1);
  assert.equal(f[0].id, d.id);
  assert.equal(f[0].lastError.code, "supervisor_unresolved");
  assert.equal(store.getDraft(d.id).lastError.code, "supervisor_unresolved", "on the draft record too");
  // the legacy screens call queueDraft() after any failure: it must not re-queue a refused draft
  store.queueDraft(d.id);
  assert.equal(store.queued().length, 0);
});

test("offline, a network failure and a 5xx are queued for retry", async () => {
  const off = loadStore(server().impl, { offline: true }).store;
  const a = off.saveDraft(draft());
  assert.equal((await off.submitOrQueue(a.id)).status, "queued");
  assert.equal(off.queued().length, 1);

  const net = loadStore(server({ network: true }).impl).store;
  const b = net.saveDraft(draft());
  const rb = await net.submitOrQueue(b.id);
  assert.equal(rb.status, "queued");
  assert.equal(rb.reason, "network");
  assert.equal(net.failedDrafts().length, 0);

  const five = loadStore(server({ submit: () => reply(503, { error: "server_error" }) }).impl).store;
  const c = five.saveDraft(draft());
  assert.equal((await five.submitOrQueue(c.id)).status, "queued");
  assert.equal(five.queued().length, 1);
});

test("the error classification", () => {
  const { store } = loadStore(server().impl);
  const R = store.isRetryable;
  for (const [e, want] of [
    [{ code: "offline" }, true], [{ code: "network" }, true], [{ code: "x", status: 500 }, true],
    [{ code: "x", status: 429 }, true], [{ code: "x", status: 401 }, true], [{ code: "x", status: 400 }, false],
    [{ code: "x", status: 403 }, false], [{ code: "x", status: 404 }, false], [{ code: "x", status: 409 }, false],
    [{ code: "no_draft" }, false]
  ]) assert.equal(R(e), want, JSON.stringify(e));
});

test("flush() stops retrying a 4xx forever: it moves to drafts with lastError", async () => {
  let refuse = true;
  const srv = server({ submit: () => refuse ? reply(400, { error: "validation", errors: [{ field: "role", message: "Choose your role." }] })
                                            : reply(200, { ok: true, entry: { id: "x", status: "submitted" } }) });
  const { store } = loadStore(srv.impl);
  const bad = store.saveDraft(draft());
  store.queueDraft(bad.id);
  const r = await store.flush();
  assert.equal(r.sent, 0);
  assert.equal(r.failed.length, 0);
  assert.deepEqual(r.needsFix.map((x) => x.id), [bad.id]);
  assert.equal(store.queued().length, 0, "out of the queue");
  assert.equal(store.failedDrafts()[0].lastError.message, "Fix this before sending: Choose your role.");
  assert.deepEqual(store.failedDrafts()[0].lastError.fields, ["role"]);
  // a second flush does not touch it again
  const before = srv.calls.submitted.length;
  await store.flush();
  assert.equal(srv.calls.submitted.length, before);

  // Fixing it (re-saving the SAME draft) clears the error and it can be sent.
  refuse = false;
  const fixed = store.saveDraft(Object.assign({}, store.getDraft(bad.id), { role: "assisted" }));
  assert.equal(fixed.id, bad.id, "re-saving updates that draft rather than minting a second");
  assert.equal(store.failedDrafts().length, 0);
  const again = await store.submitOrQueue(bad.id);
  assert.equal(again.status, "submitted");
  assert.equal(srv.calls.created.length, 1, "the server draft made on the first try is reused, not duplicated");
  assert.equal(srv.calls.patched.length, 1, "and brought up to date with the fix first");
  assert.equal(store.drafts().length, 0);
});

test("a fix saved in the same millisecond as the refused save still patches the server draft", async (t) => {
  // CI once ran the save and the re-save inside one millisecond: equal stamps skipped the PATCH.
  t.mock.method(Date, "now", () => 1700000000000);
  let refuse = true;
  const srv = server({ submit: () => refuse ? reply(400, { error: "validation", errors: [{ field: "role", message: "Choose your role." }] })
                                            : reply(200, { ok: true, entry: { id: "x", status: "submitted" } }) });
  const { store } = loadStore(srv.impl);
  const bad = store.saveDraft(draft());
  assert.equal((await store.submitOrQueue(bad.id)).status, "needs_fix");
  refuse = false;
  const fixed = store.saveDraft(Object.assign({}, store.getDraft(bad.id), { role: "assisted" }));
  assert.ok(fixed.updatedAt > bad.updatedAt, "the re-save is stamped later although the clock did not move");
  assert.equal((await store.submitOrQueue(bad.id)).status, "submitted");
  assert.equal(srv.calls.created.length, 1);
  assert.equal(srv.calls.patched.length, 1, "the server draft is brought up to date with the fix");
  assert.equal(srv.calls.patched[0].body.role, "assisted");
});

test("a retry after 'create worked, submit failed (5xx)' submits the SAME server draft", async () => {
  let fail = true;
  const srv = server({ submit: () => fail ? reply(502, {}) : reply(200, { ok: true, entry: { id: "srv-1", status: "submitted" } }) });
  const { store } = loadStore(srv.impl);
  const d = store.saveDraft(draft());
  assert.equal((await store.submitOrQueue(d.id)).status, "queued");
  fail = false;
  const r = await store.flush();
  assert.equal(r.sent, 1);
  assert.equal(srv.calls.created.length, 1, "one entry on the server, not two");
  assert.equal(srv.calls.patched.length, 0, "unchanged, so no edit was sent");
});

test("a draft made before linking is stamped with residentId / programmeId at submit", async () => {
  const srv = server();
  const { store } = loadStore(srv.impl);
  const d = store.saveDraft(draft({ residentId: "" }));
  assert.equal(d.residentId, "");
  // no link yet: stays queued rather than failing
  const r0 = await store.submitOrQueue(d.id);
  assert.equal(r0.status, "queued");
  assert.equal(r0.reason, "not_linked");
  assert.equal(srv.calls.created.length, 0);
  store.setContext({ orgId: "org1", residentId: "res-9", programmeId: "prog-9" });
  const r = await store.flush();
  assert.equal(r.sent, 1);
  assert.equal(srv.calls.created[0].body.residentId, "res-9");
  assert.equal(srv.calls.created[0].body.programmeId, "prog-9");
});

test("submitOrQueue reports how the entry was routed", async () => {
  const { store } = loadStore(server().impl);
  const d = store.saveDraft(draft({ supervisor: "" }));
  const r = await store.submitOrQueue(d.id);
  assert.equal(r.status, "submitted");
  assert.equal(r.routing, "guide");
});

test("cachedContext(): the last good /me + dashboard for THIS account and institution only", async () => {
  const { store } = loadStore(server().impl);
  assert.equal(store.cachedContext(), null, "nothing cached yet");
  store.setContext({ orgId: "org1" });
  const me = await store.me("org1");
  store.setContext({ residentId: me.resident.id, programmeId: me.resident.programmeId });
  await store.dashboard("res-1");
  const c = store.cachedContext();
  assert.ok(c, "cached");
  assert.equal(c.ctx.orgId, "org1");
  assert.equal(c.ctx.stale, true);
  assert.equal(c.dashboard.summary.total, 3);
  // Switch institution on this device: the mirror must not answer for it.
  store.setContext({ orgId: "SMD-OTHER1" });
  assert.equal(store.cachedContext(), null);
  // The code the user typed matches too.
  store.setContext({ orgId: "smd-abc123" });
  assert.ok(store.cachedContext());
});

test("a 403 on /me forgets the cached context and exposes the join request on the error", async () => {
  let forbid = false;
  const srv = server({ me: () => forbid
    ? reply(403, { error: "forbidden", message: "You are not part of this institution yet.", joinRequest: { status: "pending", orgName: "GMC" } })
    : reply(200, { ok: true, orgId: "org1", role: "pg_resident", resident: null }) });
  const { store } = loadStore(srv.impl);
  store.setContext({ orgId: "org1" });
  await store.me("org1");
  assert.ok(store.cachedContext());
  forbid = true;
  await assert.rejects(() => store.me("org1"), (e) => e.code === "forbidden" && e.status === 403 &&
    e.body.joinRequest.status === "pending");
  assert.equal(store.cachedContext(), null);
});

test("the onboarding calls hit the documented routes", async () => {
  const srv = server();
  const { store } = loadStore(srv.impl);
  await store.updateResident("r1", { guide: "fb:g" });
  await store.enrolBulk("org1", "p1", [{ email: "a@b.c" }]);
  await store.requestJoin("SMD-ABC123", "MD Medicine", "hi");
  await store.myJoinRequest();
  await store.joinRequests("org1");
  await store.approveJoinRequest("j1", { programmeId: "p1" });
  await store.rejectJoinRequest("j1", "no");
  await store.invites("org1");
  assert.deepEqual(srv.calls.urls, [
    "PATCH /api/pglog/residents/r1", "POST /api/pglog/enrol-bulk", "POST /api/pglog/join-request",
    "GET /api/pglog/join-request", "GET /api/pglog/join-requests?orgId=org1",
    "POST /api/pglog/join-requests/j1/approve", "POST /api/pglog/join-requests/j1/reject",
    "GET /api/pglog/invites?orgId=org1"
  ]);
});
