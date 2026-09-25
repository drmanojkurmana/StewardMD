/* Every script and stylesheet a PUBLIC page loads is actually served on stewardmd.in.
 *
 * stewardmd.in is mobile-only: functions/_middleware.js answers 404 for any asset not on its allowlist. The
 * public pages (the OPD console, the wall display, the cashier station, the patient's queue page and video waiting
 * page) are let in,
 * but a page let in without its scripts fails SILENTLY: no console error, the feature is just not there. It
 * bit patient-register.js, its stylesheet, the schemes tool, the barcode and QR on the file label, and then
 * (found 2026-09-25) the OPD pulse, the offline desk, the live stream and the token slip printer. This asks the
 * real middleware for each same-origin asset each public page references, so the next one fails here instead.
 *
 * node --test test/public-page-scripts-served.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { onRequest } = await import("../functions/_middleware.js");
const PAGES = ["opd.html", "opd-display.html", "clinic-billing.html", "queue.html", "tele.html"];
const read = (f) => { try { return readFileSync(new URL("../" + f, import.meta.url), "utf8"); } catch (e) { return null; } };

async function served(path) {
  let passed = false;
  const res = await onRequest({ request: new Request("https://stewardmd.in" + path), env: {}, next: async () => { passed = true; return new Response("asset"); }, params: {}, waitUntil() {} });
  return passed && res.status === 200;
}

for (const page of PAGES) {
  const html = read(page);
  if (html == null) continue;
  test(page + ": every same-origin script and stylesheet it loads gets past the stewardmd.in gate", async () => {
    const refs = [...html.matchAll(/<(?:script[^>]+src|link[^>]+href)="(\/[^"?#]+\.(?:js|css))(?:\?[^"]*)?"/g)].map((m) => m[1]);
    const blocked = [];
    for (const p of [...new Set(refs)]) if (!(await served(p))) blocked.push(p);
    assert.deepEqual(blocked, [], page + " loads these, and stewardmd.in answers 404 for them");
  });
}

/* The patient's video waiting page (tele.html) is reached from the SMS link /tele?t=<token>: the page itself, in both
 * spellings, gets past the gate, and so does everything it references (self-hosted fonts, the logo mask). */
test("tele.html: the video waiting page and every same-origin asset it references are served", async () => {
  const html = read("tele.html");
  assert.ok(html, "tele.html exists at the repo root");
  // The page itself must reach the static asset, not the marketing fallback (which also calls next(), with /_site/).
  for (const p of ["/tele", "/tele.html", "/tele/"]) {
    let asked = null;
    const res = await onRequest({ request: new Request("https://stewardmd.in" + p + "?t=abc"), env: {}, next: async (r) => { asked = r ? new URL(r.url).pathname : p; return new Response("page"); }, params: {}, waitUntil() {} });
    assert.equal(res.status, 200, p + " answers 200");
    assert.equal(asked, p, p + " is served as itself on stewardmd.in, not swapped for the marketing page");
  }
  const refs = [...html.matchAll(/(?:src|href)=["']?(\/[^"'?#) ]+)|url\((\/[^)?#]+)\)/g)].map((m) => m[1] || m[2]).filter((p) => !/^\/api\//.test(p) && !/^\/copyright$/.test(p));
  assert.ok(refs.length > 0, "tele.html references its fonts and logo");
  const blocked = [];
  for (const p of [...new Set(refs)]) if (!(await served(p))) blocked.push(p);
  assert.deepEqual(blocked, [], "tele.html loads these, and stewardmd.in answers 404 for them");
});
