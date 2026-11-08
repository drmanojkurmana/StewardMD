/* test/image-report.test.mjs - tap any image to open it, and report it (correction, copyright, a better image).
 * Owner 2026-11-05: "every image should be zoomable on click and a report button to report corrections or copyright or
 * add correct image so admin will check and approve".
 * Server: functions/_support.js (ticket kind "image"), functions/api/support.js (action "image").
 * Client: image-zoom.js (pure parts), prep-viewer.js (Report button), admin/index.html (approve / decline).
 * node --test --experimental-test-module-mocks test/image-report.test.mjs */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const WHO = { current: { id: "fb:u1", guest: false, email: "a@x.in", name: "Asha" } };
const realUsage = await import("../functions/_usage.js");
function memKV() {
  const m = new Map();
  return { _m: m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const STORE = memKV();
mock.module("../functions/_usage.js", { namedExports: { ...realUsage, identify: async () => WHO.current, usageKv: () => STORE } });
const route = await import("../functions/api/support.js");
const S = await import("../functions/_support.js");
const post = async (body) => { const r = await route.onRequestPost({ request: new Request("https://x/api/support", { method: "POST", body: JSON.stringify(body) }), env: {} }); return { status: r.status, body: await r.json() }; };
const JPEG = "data:image/jpeg;base64," + Buffer.from("better-image").toString("base64");

test("an image report becomes a ticket of kind image with its address, reason and where it was seen", async () => {
  const r = await post({ action: "image", image: { src: "/api/prep/bank/v1/kb/media/meningitis-fig3.webp", title: "Meningitis Brain MRI", where: "Acute Bacterial Meningitis", route: "#kb", reason: "correction" }, text: "The FLAIR label is on the wrong side" });
  assert.equal(r.status, 200);
  const t = r.body.ticket;
  assert.equal(t.kind, "image");
  assert.equal(t.image.reason, "correction");
  assert.equal(t.image.src, "/api/prep/bank/v1/kb/media/meningitis-fig3.webp");
  assert.match(t.subject, /^Image: Something in it is wrong - Meningitis Brain MRI/);
  assert.match(t.messages[0].text, /FLAIR label/);
  assert.equal(t.hasShot, false);
});

test("a better image offered is stored like a bug screenshot; copyright reports keep their reason", async () => {
  const r = await post({ action: "image", image: { src: "https://upload.wikimedia.org/x.jpg", title: "Fig", reason: "better" }, shot: JPEG });
  assert.equal(r.status, 200);
  assert.equal(r.body.ticket.hasShot, true);
  assert.ok(STORE._m.get(S.shotKey(r.body.ticket.id)), "attached image kept for the admin");
  const c = await post({ action: "image", image: { src: "/a.png", reason: "copyright" }, text: "This is from a paid atlas" });
  assert.equal(c.body.ticket.image.reason, "copyright");
});

test("an image report needs an address the app loads; unknown reasons fall back; a plain create cannot claim kind image", async () => {
  assert.equal((await post({ action: "image", image: { src: "javascript:alert(1)" } })).status, 400);
  assert.equal((await post({ action: "image", image: { src: "//evil.example/x.png" } })).status, 400);
  assert.equal(S.cleanImageMeta({ src: "/x.png", reason: "nonsense" }).reason, "correction");
  const p = await post({ action: "create", kind: "image", text: "hello" });
  assert.equal(p.body.ticket.kind, "help");
});

test("image reports need a signed-in doctor", async () => {
  const keep = WHO.current; WHO.current = null;
  try { const r = await post({ action: "image", image: { src: "/x.png" } }); assert.ok(r.status === 401 || r.status === 403, "status " + r.status); }
  finally { WHO.current = keep; }
});

test("image-zoom.js: icons, small images and images inside buttons or links do not open; content images do", () => {
  const require = createRequire(import.meta.url);
  const Z = require("../image-zoom.js");
  const img = (o) => Object.assign({ tagName: "IMG", src: "/x.png", className: "", id: "", alt: "",
    getBoundingClientRect: () => ({ width: o.w || 320, height: o.h || 200 }), closest: (sel) => (o.inside && sel.indexOf(o.inside) >= 0 ? {} : null) }, o.extra || {});
  assert.equal(Z._qualifies(img({})), true);
  assert.equal(Z._qualifies(img({ w: 40, h: 40 })), false);
  assert.equal(Z._qualifies(img({ extra: { className: "rnav-icon" } })), false);
  assert.equal(Z._qualifies(img({ inside: "button" })), false);
  assert.equal(Z._qualifies(img({ inside: "a[href]" })), false);
  assert.equal(Z._qualifies(img({ inside: ".igl-overlay" })), false);
  assert.equal(Z._qualifies({ tagName: "SVG" }), false);
});

test("the viewer has the Report button, the admin console approves or declines, the app loads both files", () => {
  const pv = readFileSync(new URL("../prep-viewer.js", import.meta.url), "utf8");
  assert.match(pv, /data-pv="report"/);
  assert.match(pv, /a === "report"/);
  const admin = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
  assert.match(admin, /image:"Image"/);
  assert.match(admin, /bgApproveBtn/);
  assert.match(admin, /bgDeclineBtn/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<script src="\/image-zoom\.js\?v=[^"]+" defer>/);
  assert.match(html, /<link rel="stylesheet" href="\/image-viewer\.css\?v=[^"]+">/);
  assert.match(readFileSync(new URL("../image-viewer.css", import.meta.url), "utf8"), /\.pv-stage/);
});

test("watermark: one big faint PrepNucleus mark and a Powered by StewardMD line; Commons images get the line only; off by flag", () => {
  const require = createRequire(import.meta.url);
  const W = require("../image-watermark.js");
  const ours = W.html("/api/prep/bank/v1/kb/media/x.webp", true);
  assert.equal((ours.match(/class="smd-wm-big"/g) || []).length, 1, "exactly one big mark (owner 2026-11-07: many marks irritate)");
  assert.doesNotMatch(ours, /<i>StewardMD<\/i>/, "no repeated diagonal marks any more");
  assert.match(ours, /class="smd-wm-by"[\s\S]*PrepNucleus[\s\S]*Powered by[\s\S]*Steward<b>MD<\/b>/, "the home lockup: PrepNucleus, Powered by StewardMD");
  assert.match(ours, /aria-hidden="true"/);
  const ext = W.html("https://upload.wikimedia.org/wikipedia/commons/a/b/c.jpg", true);
  assert.doesNotMatch(ext, /smd-wm-big/, "no big mark across an image that is not ours");
  assert.match(ext, /smd-wm--ext/);
  assert.match(ext, /smd-wm-by/);
  assert.equal(W._external("https://thumb.wikimedia.org/x.png"), true);
  assert.equal(W._external("/logo.png"), false);
  const css = readFileSync(new URL("../image-viewer.css", import.meta.url), "utf8");
  assert.match(css, /\.smd-wm \{[^}]*pointer-events: none/, "the watermark never takes a tap");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf("/image-watermark.js") > 0 && html.indexOf("/image-watermark.js") < html.indexOf("/image-zoom.js"), "loaded with the app");
});
