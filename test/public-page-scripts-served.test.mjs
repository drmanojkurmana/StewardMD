/* Every script and stylesheet a PUBLIC page loads is actually served on stewardmd.in.
 *
 * stewardmd.in is mobile-only: functions/_middleware.js answers 404 for any asset not on its allowlist. The
 * public pages (the OPD console, the wall display, the cashier station, the patient's queue page) are let in,
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
const PAGES = ["opd.html", "opd-display.html", "clinic-billing.html", "queue.html"];
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
