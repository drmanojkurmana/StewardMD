import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* sw.js caches static assets keyed on the FULL URL including the query string, so content JSON
 * fetched without a ?v= can never be updated on a device that already cached it. surgx-content.js
 * was fixed; this pins the same behaviour for clinix-content.js so it cannot regress. */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_VERSION = JSON.parse(readFileSync(join(ROOT, "clinix/manifest.json"), "utf8")).contentVersion;

function loadWithFakeFetch() {
  const calls = [];
  const manifest = {
    contentVersion: CONTENT_VERSION,
    systems: [{ id: "s1", skillPacks: ["p1"], diseases: [{ id: "d1", file: "diseases/d1.json" }] }],
    skillPacks: [{ id: "p1", file: "packs/p1.json" }]
  };
  const body = (u) =>
    u.indexOf("media/manifest.json") >= 0 ? { media: {} }
      : u.indexOf("manifest.json") >= 0 ? manifest
      : u.indexOf("packs/") >= 0 ? { skills: {} }
      : { id: "d1" };

  globalThis.window = {
    fetch(url, init) { calls.push({ url, init }); return Promise.resolve({ ok: true, json: () => Promise.resolve(body(url)) }); }
  };
  // Fresh module instance per test: the loader memoises its catalog.
  const require = createRequire(import.meta.url);
  const path = require.resolve("../clinix-content.js");
  delete require.cache[path];
  return { API: require(path), calls };
}

test("the catalog is fetched no-store and WITHOUT a ?v= (it carries the version)", async () => {
  const { API, calls } = loadWithFakeFetch();
  await API.loadCatalog();
  const c = calls.find((c) => c.url.indexOf("/clinix/manifest.json") >= 0);
  assert.ok(c, "manifest.json was not fetched");
  assert.equal(c.url.indexOf("?v="), -1, "the manifest must not be version-busted by itself");
  assert.deepEqual(c.init, { cache: "no-store" }, "the manifest must never be served stale");
});

test("every other content fetch carries ?v=<contentVersion>", async () => {
  const { API, calls } = loadWithFakeFetch();
  await API.loadDisease("d1");
  const others = calls.filter((c) => c.url.indexOf("/clinix/manifest.json") < 0);
  assert.ok(others.length >= 3, "expected disease + media + pack fetches, saw " + others.length);
  for (const c of others) {
    assert.ok(c.url.indexOf("?v=" + encodeURIComponent(CONTENT_VERSION)) > 0,
      c.url + " is fetched without the content version, so sw.js can pin it forever");
  }
});
