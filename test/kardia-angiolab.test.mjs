/* Angio Lab: the AngioView coronary simulator, shipped whole under
 * kardia/angiolab and opened from the Kardia tab beside Echo Lab.
 * Run: node --test --experimental-test-module-mocks --experimental-sqlite test/kardia-angiolab.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

test("Angio Lab ships the AngioView app and its anatomy", () => {
  for (const f of [
    "kardia/angiolab/index.html",
    "kardia/angiolab/kardia-embed.js",
    "kardia/angiolab/vercel-noop.js",
    "kardia/angiolab/assets/index-DN5WvsiQ.js",
    "kardia/angiolab/assets/index-Chn8ROhg.css",
    "kardia/angiolab/privacy.html",
    "kardia/angiolab/support.html",
    "kardia/angiolab/anatomy/coronary-left.json",
    "kardia/angiolab/anatomy/coronary-right.json",
    "kardia/angiolab/anatomy/coronary-co.json",
    "kardia/angiolab/anatomy/grafts-right.json",
    "kardia/angiolab/anatomy/heart.glb",
    "kardia/angiolab/anatomy/heart-lite.glb",
    "kardia/angiolab/anatomy/thorax.glb",
    "kardia/angiolab/anatomy/thorax-lite.glb",
    "kardia/angiolab/anatomy/thorax-extra.glb"
  ]) assert.ok(existsSync(f), f);
});

test("bundle paths stay inside the Angio Lab folder", () => {
  const js = readFileSync("kardia/angiolab/assets/index-DN5WvsiQ.js", "utf8");
  assert.equal(js.includes("/anatomy/"), false, "no site-root anatomy path");
  assert.ok(js.includes("anatomy/coronary-"), "coronary fetch is relative");
  assert.ok(js.includes("baseUrl??`anatomy/`") || js.includes("baseUrl??\"anatomy/\""), "mesh base is relative");
  assert.equal(js.includes("app-store-badge"), false);
  assert.ok(js.includes("privacy.html") && js.includes("support.html"));
  assert.ok(js.includes("vercel-noop.js") && !js.includes("/_vercel/"));
  assert.ok(js.includes("Tp=function(e){return`/kardia/angiolab/`+e}"), "chunk preload stays under the Angio Lab folder");
  assert.ok(js.includes("children:`AngioLAB`"));
  assert.equal(js.includes("AngioView"), false);
  assert.equal(js.includes("Get the iPhone app"), false);
  assert.equal(js.includes("apps.apple.com"), false);
  assert.equal(js.includes("app-store-badge"), false);
  const html = readFileSync("kardia/angiolab/index.html", "utf8");
  assert.ok(html.includes("kardia-embed.js"));
  assert.ok(html.includes("assets/index-DN5WvsiQ.js"));
  assert.equal(html.includes("apple-itunes-app"), false, "no App Store banner inside the app");
  assert.equal(html.includes("angioview.com"), false);
});

test("Kardia opens Angio Lab in a frame next to Echo Lab and the build ships it", () => {
  const src = readFileSync("kardia.js", "utf8");
  assert.ok(src.includes('["echo", "angio", "learn", "practice", "cases", "calc", "kardiox"]'));
  assert.ok(src.includes('echoBase() + "angiolab/index.html"'));
  assert.ok(src.includes('id="krdAngioFrame"'));
  assert.ok(src.includes('data-act="kangio-retry"'));
  const css = readFileSync("kardia.css", "utf8");
  assert.ok(css.includes(".krd-angio-frame"));
  const b = readFileSync("scripts/build-www.sh", "utf8");
  assert.ok(b.includes("cp -R kardia/angiolab/."));
  assert.ok(b.includes('"$WWW/kardia/angiolab/"'));
});
