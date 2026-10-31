/* PrepNucleus Sound provider-adapter interface tests (rs-sound, Phase 3 prerequisite).
   The registry rs-spotify will plug prep-sound-spotify.js into.
   node --test test/prep-sound-providers.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../prep-sound-providers.js");

test("shape: bad adapters are rejected with a named reason", () => {
  assert.throws(() => P.registerAdapter(null), /bad-adapter/);
  assert.throws(() => P.registerAdapter({ id: "x" }), /bad-adapter/);
  assert.throws(() => P.registerAdapter({ id: "x", capabilities: {}, getStatus() {}, dispose() {} }), /capability/);
});

test("registry: register, get, list, unregister", () => {
  const caps = {};
  for (const k of P.CAP_KEYS) caps[k] = false;
  caps.externalHandoff = true;
  const a = { id: "t-external", capabilities: caps, getStatus: async () => ({ ok: true, state: "ready" }), dispose: async () => {} };
  assert.equal(P.registerAdapter(a), true);
  assert.equal(P.getAdapter("t-external"), a);
  assert.ok(P.listAdapters().includes("t-external"));
  assert.equal(P.getAdapter("spotify_remote"), null, "rs-spotify has not mounted yet");
  assert.equal(P.unregisterAdapter("t-external"), true);
  assert.equal(P.getAdapter("t-external"), null);
});

test("rs-spotify mount point: a conforming spotify_remote adapter plugs in later", async () => {
  const caps = {};
  for (const k of P.CAP_KEYS) caps[k] = false;
  caps.remoteControls = true;
  const mini = { id: "spotify_remote", capabilities: caps, getStatus: async () => ({ ok: true, state: "ready" }), play: async () => ({ ok: true }), dispose: async () => {} };
  P.registerAdapter(mini);
  assert.equal(P.getAdapter("spotify_remote"), mini);
  assert.deepEqual(await mini.play(), { ok: true });
  P.unregisterAdapter("spotify_remote");
  assert.equal(P.getAdapter("spotify_remote"), null, "test cleans up after itself");
});

test("external adapter: every transport op is typed-unsupported; openExternal uses the injected opener", async () => {
  const opened = [];
  const a = P.makeExternalAdapter("spotify", (url) => opened.push(url));
  assert.equal(a.capabilities.remoteControls, false);
  assert.deepEqual(await a.play(), { ok: false, error: "unsupported:spotify:play" });
  assert.deepEqual(await a.next(), { ok: false, error: "unsupported:spotify:next" });
  assert.deepEqual(await a.setVolume(0.5), { ok: false, error: "unsupported:spotify:setVolume" });
  assert.deepEqual(await a.openExternal({ url: "https://open.spotify.com/" }), { ok: true });
  assert.deepEqual(opened, ["https://open.spotify.com/"]);
  assert.deepEqual(await a.openExternal({ url: "spotify:playlist:x" }), { ok: false, error: "unavailable:bad-url" }, "non-https never opens");
  assert.deepEqual(await a.openExternal({}), { ok: false, error: "unavailable:bad-url" });
  assert.deepEqual(await a.disconnect(), { ok: true });
});
