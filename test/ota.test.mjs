/* test/ota.test.mjs — OTA update system, Phase 1 (functions/_ota.js).
 *
 * Every assertion here traces back to the failure that killed the last version of this system:
 * a stale bundle silently downgrading installs because the kill mechanism needed a redeploy to
 * re-arm. So the load-bearing checks are: staging a build never touches the live channel; the
 * kill switch works without any of the publish/rollback machinery; a rollback increases the
 * version number rather than moving it backward; and a device is never offered a bundle its
 * native build can't run or a version it already has.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as OTA from "../functions/_ota.js";
import { onRequest } from "../functions/api/ota/[[path]].js";

// A fake R2 bucket — just enough of the real R2Bucket surface (.get/.put) for _ota.js to run
// against, backed by an in-memory Map so nothing here touches the network.
function fakeR2() {
  const store = new Map();
  return {
    _store: store,
    async get(key) {
      if (!store.has(key)) return null;
      const v = store.get(key);
      return { text: async () => v.text, body: v.text, size: v.size, httpMetadata: v.httpMetadata };
    },
    async put(key, value, opts) {
      const text = typeof value === "string" ? value : String(value);
      store.set(key, { text, size: text.length, httpMetadata: (opts && opts.httpMetadata) || {} });
    },
  };
}

test("a staged candidate is invisible to devices until published", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json", message: "fix" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [{ path: "icu.js", hash: "h1", size: 10 }] }));
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, false, "no channel published yet -> no update, even though a candidate exists");
  assert.equal(check.reason, "no-channel");
});

test("publish moves the candidate to the live channel, versioned from 1", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json", message: "fix" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [{ path: "icu.js", hash: "h1", size: 10 }] }));
  const channel = await OTA.publish(r2, { by: "owner@x.com" });
  assert.equal(channel.version, 1);
  assert.equal(channel.commit, "abc123");
  assert.equal(channel.publishedBy, "owner@x.com");
  const history = await OTA.getHistory(r2);
  assert.equal(history.length, 1);
  assert.equal(history[0].action, "publish");
});

test("publish with nothing staged fails explicitly, does not fabricate a channel", async () => {
  const r2 = fakeR2();
  const res = await OTA.publish(r2, { by: "owner@x.com" });
  assert.equal(res.error, "no-candidate");
  assert.equal(await OTA.getChannel(r2), null);
});

test("a device already on the live version is told there is nothing to do", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", zipHash: "z", zipSize: 1, files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  const upToDate = await OTA.checkForDevice(r2, { version: 1, nativeBuild: 7 });
  assert.equal(upToDate.ota, false);
  assert.equal(upToDate.reason, "up-to-date");
  const behind = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(behind.ota, true);
  assert.equal(behind.version, 1);
});

test("a device is never offered a release its native build can't run", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", zipHash: "z", zipSize: 1, files: [] }));
  await OTA.publish(r2, { by: "owner@x.com", minNativeBuild: 9 });
  const tooOld = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(tooOld.ota, false);
  assert.equal(tooOld.reason, "native-build-too-old");
  const okBuild = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 9 });
  assert.equal(okBuild.ota, true);
});

test("THE load-bearing one: the kill switch beats everything, and needs no publish state to work", async () => {
  const r2 = fakeR2();
  // No candidate, no channel, no history — kill must still work on a completely empty store.
  const state = await OTA.setKill(r2, { on: true, by: "owner@x.com" });
  assert.equal(state.on, true);
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, false);
  assert.equal(check.reason, "disabled");
});

test("kill switch overrides an ALREADY-LIVE channel — an armed release goes dark instantly", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", zipHash: "z", zipSize: 1, files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  assert.equal((await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 })).ota, true, "sanity: live before kill");
  await OTA.setKill(r2, { on: true, by: "owner@x.com" });
  assert.equal((await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 })).ota, false, "dark after kill");
  await OTA.setKill(r2, { on: false, by: "owner@x.com" });
  assert.equal((await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 })).ota, true, "restored after un-kill");
});

test("rollback republishes an old version under a NEW, higher version number", async () => {
  const r2 = fakeR2();
  // v1
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "v1commit", manifestKey: "ota/manifests/v1commit.json" }));
  await r2.put("ota/manifests/v1commit.json", JSON.stringify({ commit: "v1commit", zipHash: "zip1", zipSize: 1, files: [{ path: "a.js", hash: "ha", size: 1 }] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  // v2 — a bad release
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "v2commit", manifestKey: "ota/manifests/v2commit.json" }));
  await r2.put("ota/manifests/v2commit.json", JSON.stringify({ commit: "v2commit", zipHash: "zip2", zipSize: 1, files: [{ path: "a.js", hash: "hb", size: 1 }] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  let channel = await OTA.getChannel(r2);
  assert.equal(channel.version, 2);
  assert.equal(channel.commit, "v2commit");

  // roll back to v1's content
  const rolled = await OTA.rollback(r2, { toVersion: 1, by: "owner@x.com" });
  assert.equal(rolled.version, 3, "rollback is version 3, NOT a reversion to version 1 — a device that only trusts 'newer' must still take it");
  assert.equal(rolled.commit, "v1commit", "but the CONTENT is v1's — the bad v2 build is gone from the live channel");

  const history = await OTA.getHistory(r2);
  assert.equal(history[0].action, "rollback");
  assert.equal(history[0].rollbackOf, 1);

  // a device that had already taken v2 (version 2) must still see the rollback as an update
  const deviceOnBadV2 = await OTA.checkForDevice(r2, { version: 2, nativeBuild: 7 });
  assert.equal(deviceOnBadV2.ota, true, "a device on the bad release must be offered the rollback");
  assert.equal(deviceOnBadV2.version, 3);
  const back = await OTA.getManifest(r2, deviceOnBadV2.commit);
  assert.equal(back.files[0].hash, "ha", "the file it downloads is v1's content, not v2's");
});

test("rolling back to a version that never existed fails explicitly", async () => {
  const r2 = fakeR2();
  const res = await OTA.rollback(r2, { toVersion: 999, by: "owner@x.com" });
  assert.equal(res.error, "version-not-found");
});

test("a missing manifest fails the device check closed, never half-answers", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  // simulate the manifest object having gone missing from R2 after the channel already points at it
  r2._store.delete("ota/manifests/abc123.json");
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, false);
  assert.equal(check.reason, "manifest-missing");
});

test("history is capped, newest first", async () => {
  const r2 = fakeR2();
  for (let i = 1; i <= 5; i++) {
    await r2.put("ota/candidate.json", JSON.stringify({ commit: "c" + i, manifestKey: "ota/manifests/c" + i + ".json" }));
    await r2.put("ota/manifests/c" + i + ".json", JSON.stringify({ commit: "c" + i, files: [] }));
    await OTA.publish(r2, { by: "owner@x.com" });
  }
  const history = await OTA.getHistory(r2);
  assert.equal(history.length, 5);
  assert.equal(history[0].commit, "c5", "newest entry first");
  assert.equal(history[4].commit, "c1", "oldest entry last");
});

test("checkForDevice carries the zip hash/size through for the client to download", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", zipHash: "deadbeef", zipSize: 12345, files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, true);
  assert.equal(check.zipHash, "deadbeef");
  assert.equal(check.zipSize, 12345);
});

test("a manifest with no zip fails closed, same as a missing manifest — nothing for the device to fetch", async () => {
  const r2 = fakeR2();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", files: [] }));   // no zipHash
  await OTA.publish(r2, { by: "owner@x.com" });
  const check = await OTA.checkForDevice(r2, { version: 0, nativeBuild: 7 });
  assert.equal(check.ota, false);
  assert.equal(check.reason, "manifest-missing");
});

// ---- router: the ONE thing _ota.js can't do (it has no notion of the request's own origin) ----
function fakeR2Env(prime) {
  const r2 = fakeR2();
  const ctx = { env: { OTA_R2: r2 }, r2 };
  if (prime) prime(r2);
  return ctx;
}
test("router builds an ABSOLUTE zipUrl from the live request's origin — capacitor-updater downloads outside the WebView, a relative path would fail silently on-device", async () => {
  const { env, r2 } = fakeR2Env();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", zipHash: "feedface", zipSize: 99, files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  const request = new Request("https://stewardmd.in/api/ota/check?version=0&nativeBuild=7");
  const res = await onRequest({ request, env, params: { path: ["check"] } });
  const body = await res.json();
  assert.equal(body.ota, true);
  assert.equal(body.zipUrl, "https://stewardmd.in/api/ota/file/feedface", `got ${body.zipUrl}`);
});
test("router sends the per-file list only when asked (files=1) - ~150KB of JSON must not ride every launch/resume check", async () => {
  const { env, r2 } = fakeR2Env();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", zipHash: "feedface", zipSize: 99, files: [{ path: "a.js", hash: "h1", size: 5 }] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  const plain = await (await onRequest({ request: new Request("https://stewardmd.in/api/ota/check?version=0&nativeBuild=7"), env, params: { path: ["check"] } })).json();
  assert.equal(plain.ota, true);
  assert.equal(plain.files, undefined, "a plain check carries no file list");
  const full = await (await onRequest({ request: new Request("https://stewardmd.in/api/ota/check?version=0&nativeBuild=7&files=1"), env, params: { path: ["check"] } })).json();
  assert.deepEqual(full.files, [{ path: "a.js", hash: "h1", size: 5, download_url: "https://stewardmd.in/api/ota/file/h1" }], "files=1 returns path, hash, size and download_url for the delta install");
});
test("router never caches the check response — an edge/browser cache saying 'no update' forever would be its own silent staleness bug", async () => {
  const { env, r2 } = fakeR2Env();
  const request = new Request("https://stewardmd.in/api/ota/check");
  const res = await onRequest({ request, env, params: { path: ["check"] } });
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
test("router rejects a malformed hash before it ever reaches R2", async () => {
  const { env } = fakeR2Env();
  const request = new Request("https://stewardmd.in/api/ota/file/not-a-real-hash");
  const res = await onRequest({ request, env, params: { path: ["file", "not-a-real-hash"] } });
  assert.equal(res.status, 400);
});
test("router serves a content-addressed file as immutable-cacheable — it can never mean different content", async () => {
  const { env, r2 } = fakeR2Env();
  const hash = "a".repeat(64);
  await r2.put("ota/files/" + hash, "the-bytes", { httpMetadata: { contentType: "application/zip" } });
  const request = new Request("https://stewardmd.in/api/ota/file/" + hash);
  const res = await onRequest({ request, env, params: { path: ["file", hash] } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Cache-Control"), /^public, max-age=31536000, immutable/);
  assert.equal(await res.text(), "the-bytes");
});
test("router serves EVERY file as opaque binary - Cloudflare injects a script into text/html, which broke the sha256 of every .html file and sank the delta install (2026-10-27)", async () => {
  const { env, r2 } = fakeR2Env();
  const hash = "b".repeat(64);
  await r2.put("ota/files/" + hash, "<html>x</html>", { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  const res = await onRequest({ request: new Request("https://stewardmd.in/api/ota/file/" + hash), env, params: { path: ["file", hash] } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/octet-stream", "a text/html type is what Cloudflare rewrites");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(res.headers.get("Cache-Control"), /no-transform/);
  assert.equal(await res.text(), "<html>x</html>", "bytes unchanged");
});
test("router: admin routes are refused without an owner token — this endpoint controls what every phone runs", async () => {
  const { env } = fakeR2Env();
  const request = new Request("https://stewardmd.in/api/ota/publish", { method: "POST", body: "{}" });
  const res = await onRequest({ request, env, params: { path: ["publish"] } });
  assert.equal(res.status, 403);
});

test("getFile fetches the exact content-addressed key, nothing else", async () => {
  const r2 = fakeR2();
  await r2.put("ota/files/deadbeef", "file-bytes");
  const obj = await OTA.getFile(r2, "deadbeef");
  assert.equal(await obj.text(), "file-bytes");
  assert.equal(await OTA.getFile(r2, "not-there"), null);
});

// ---- OTA lock: App Check / ID token gate + signed file URLs (sec-ota-lock) ----------------
const OTA_SECRET = "test-ota-url-secret-fixture-do-not-use-in-prod";
const HASH64 = "c".repeat(64);

async function primeChannel(env, r2, files) {
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "lock1", manifestKey: "ota/manifests/lock1.json" }));
  await r2.put("ota/manifests/lock1.json", JSON.stringify({
    commit: "lock1", zipHash: HASH64, zipSize: 42,
    files: files || [{ path: "x.js", hash: HASH64, size: 42 }],
  }));
  await OTA.publish(r2, { by: "owner@x.com" });
  await r2.put("ota/files/" + HASH64, "locked-bytes");
}

function captureWarn() {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => { lines.push(a.map(String).join(" ")); };
  return {
    lines,
    restore() { console.warn = orig; },
    shadow() { return lines.filter((l) => l.indexOf("[ota-shadow] would-deny") >= 0); },
  };
}

test("signFileQuery / verifyFileQuery: round-trip, expired and bad sig rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  const q = await OTA.signFileQuery(OTA_SECRET, HASH64, now);
  assert.ok(q && q.exp === now + OTA.FILE_URL_TTL_SEC && q.sig && q.query.indexOf("exp=") === 0);
  assert.equal((await OTA.verifyFileQuery(OTA_SECRET, HASH64, q.exp, q.sig, now)).ok, true);
  assert.equal((await OTA.verifyFileQuery(OTA_SECRET, HASH64, q.exp, q.sig, q.exp + 1)).reason, "expired");
  assert.equal((await OTA.verifyFileQuery(OTA_SECRET, HASH64, q.exp, "deadbeef", now)).reason, "bad-sig");
  assert.equal((await OTA.verifyFileQuery(OTA_SECRET, HASH64, q.exp, "", now)).reason, "missing-sig");
  assert.equal((await OTA.verifyFileQuery(null, HASH64, q.exp, q.sig, now)).reason, "no-secret");
  assert.equal(await OTA.signFileQuery(null, HASH64, now), null);
});

test("shadow (OTA_ENFORCE off): check without token still serves; file without sig still serves and logs would-deny when secret is set", async () => {
  const { env, r2 } = fakeR2Env();
  env.OTA_URL_SECRET = OTA_SECRET;
  await primeChannel(env, r2);
  const w = captureWarn();
  try {
    const check = await onRequest({
      request: new Request("https://stewardmd.in/api/ota/check?version=0&nativeBuild=7"),
      env, params: { path: ["check"] },
    });
    assert.equal(check.status, 200);
    const body = await check.json();
    assert.equal(body.ota, true);
    assert.match(body.zipUrl, /\?exp=\d+&sig=[0-9a-f]+$/, "secret set → signed zipUrl even in shadow");
    assert.ok(w.shadow().some((l) => /missing-auth/.test(l)), "shadow logs would-deny missing-auth: " + JSON.stringify(w.shadow()));

    const bare = await onRequest({
      request: new Request("https://stewardmd.in/api/ota/file/" + HASH64),
      env, params: { path: ["file", HASH64] },
    });
    assert.equal(bare.status, 200, "shadow still serves unsigned file");
    assert.equal(await bare.text(), "locked-bytes");
    assert.ok(w.shadow().some((l) => /missing-sig/.test(l)), "shadow logs would-deny missing-sig");
  } finally { w.restore(); }
});

test("shadow without secret: unsigned URLs, no file gate", async () => {
  const { env, r2 } = fakeR2Env();
  await primeChannel(env, r2);
  const w = captureWarn();
  try {
    const body = await (await onRequest({
      request: new Request("https://stewardmd.in/api/ota/check?version=0&nativeBuild=7"),
      env, params: { path: ["check"] },
    })).json();
    assert.equal(body.zipUrl, "https://stewardmd.in/api/ota/file/" + HASH64, "no secret → unsigned");
    const file = await onRequest({
      request: new Request("https://stewardmd.in/api/ota/file/" + HASH64),
      env, params: { path: ["file", HASH64] },
    });
    assert.equal(file.status, 200);
  } finally { w.restore(); }
});

test("enforce ON: /check without App Check and without ID token → 401", async () => {
  const { env, r2 } = fakeR2Env();
  env.OTA_ENFORCE = "1";
  env.OTA_URL_SECRET = OTA_SECRET;
  await primeChannel(env, r2);
  const res = await onRequest({
    request: new Request("https://stewardmd.in/api/ota/check?version=0&nativeBuild=7"),
    env, params: { path: ["check"] },
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthorized");
});

test("enforce ON: /file with bad or expired sig → 403; valid sig serves", async () => {
  const { env, r2 } = fakeR2Env();
  env.OTA_ENFORCE = "1";
  env.OTA_URL_SECRET = OTA_SECRET;
  await primeChannel(env, r2);
  const now = Math.floor(Date.now() / 1000);
  const good = await OTA.signFileQuery(OTA_SECRET, HASH64, now);

  const missing = await onRequest({
    request: new Request("https://stewardmd.in/api/ota/file/" + HASH64),
    env, params: { path: ["file", HASH64] },
  });
  assert.equal(missing.status, 403);

  const bad = await onRequest({
    request: new Request("https://stewardmd.in/api/ota/file/" + HASH64 + "?exp=" + good.exp + "&sig=00"),
    env, params: { path: ["file", HASH64] },
  });
  assert.equal(bad.status, 403);

  const expired = await onRequest({
    request: new Request("https://stewardmd.in/api/ota/file/" + HASH64 + "?exp=" + (now - 10) + "&sig=" + good.sig),
    env, params: { path: ["file", HASH64] },
  });
  assert.equal(expired.status, 403);

  const ok = await onRequest({
    request: new Request("https://stewardmd.in/api/ota/file/" + HASH64 + "?" + good.query),
    env, params: { path: ["file", HASH64] },
  });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "locked-bytes");
});

test("enforce ON: valid Firebase ID token unlocks /check; manifest download_url carries sig/exp", async () => {
  // Mint a Firebase ID token against a stub JWKS (same shape as test/cf-access-verify.test.mjs).
  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const jwk = Object.assign({}, pub, { kid: "ota-f1", alg: "RS256", use: "sig" });
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "ota-f1", typ: "JWT" }));
  const p = b64u(JSON.stringify({
    aud: "stewardmd-498ec", iss: "https://securetoken.google.com/stewardmd-498ec",
    sub: "ota-user-1", iat: now, exp: now + 600, email: "doc@example.com",
  }));
  const idTok = h + "." + p + "." + b64u(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p)
  ));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    if (String(u).indexOf("securetoken@system.gserviceaccount.com") >= 0) {
      return new Response(JSON.stringify({ keys: [jwk] }));
    }
    return realFetch(u, i);
  };
  try {
    const { env, r2 } = fakeR2Env();
    env.OTA_ENFORCE = "1";
    env.OTA_URL_SECRET = OTA_SECRET;
    await primeChannel(env, r2, [{ path: "a.js", hash: HASH64, size: 42 }]);
    const res = await onRequest({
      request: new Request("https://stewardmd.in/api/ota/check?version=0&nativeBuild=7&files=1", {
        headers: { Authorization: "Bearer " + idTok },
      }),
      env, params: { path: ["check"] },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ota, true);
    assert.match(body.zipUrl, new RegExp("/api/ota/file/" + HASH64 + "\\?exp=\\d+&sig=[0-9a-f]+$"));
    assert.ok(Array.isArray(body.files) && body.files.length === 1);
    assert.match(body.files[0].download_url, /\?exp=\d+&sig=[0-9a-f]+$/);
    assert.equal(body.files[0].path, "a.js");
    assert.equal(body.files[0].hash, HASH64);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("probe stays public (no auth, no sig) under enforce", async () => {
  const { env } = fakeR2Env();
  env.OTA_ENFORCE = "1";
  const res = await onRequest({
    request: new Request("https://stewardmd.in/api/ota/probe?n=1024"),
    env, params: { path: ["probe"] },
  });
  assert.equal(res.status, 200);
  assert.equal((await res.text()).length, 1024);
});
test("every /check is counted by app version and credential (rollout gate for OTA_ENFORCE)", async () => {
  const { env, r2 } = fakeR2Env();
  await r2.put("ota/candidate.json", JSON.stringify({ commit: "abc123", manifestKey: "ota/manifests/abc123.json" }));
  await r2.put("ota/manifests/abc123.json", JSON.stringify({ commit: "abc123", zipHash: "feedface", zipSize: 99, files: [] }));
  await OTA.publish(r2, { by: "owner@x.com" });
  const rows = [];
  env.UPDATES_DB = { prepare: (sql) => ({ bind: (...a) => ({ sql, a }) }), batch: async (st) => { st.forEach((s) => { if (/ai_counters \(day, k, n\)/.test(s.sql)) rows.push(s.a[1]); }); return []; } };
  const pending = [];
  await onRequest({ request: new Request("https://stewardmd.in/api/ota/check?version=694&nativeBuild=7"), env, params: { path: ["check"] }, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.deepEqual(rows, ["ota.auth.694.none"]);
});
