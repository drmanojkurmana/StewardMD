import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../prep-bank-client.js");

test("public lesson and KB figures route to media.stewardmd.in", () => {
  assert.equal(C.publicMediaUrl("/api/prep/bank/v1/lessons/media/med-headache-fig1.webp"), "https://media.stewardmd.in/v1/lessons/media/med-headache-fig1.webp");
  assert.equal(C.publicMediaUrl("https://stewardmd.in/api/prep/bank/v1/kb/media/acne-1.webp"), "https://media.stewardmd.in/v1/kb/media/acne-1.webp");
  assert.equal(C.publicMediaUrl("https://stewardmd.in/api/prep/bank/v1/lessons/media/x-diagram.svg?s=a&exp=1&sig=b"), "https://media.stewardmd.in/v1/lessons/media/x-diagram.svg");
});

test("gated images and other bank files never route to the public host", () => {
  for (const u of [
    "/api/prep/bank/v2/pyq/img/q-12.webp",
    "/api/prep/bank/img/maikimg/i-abcdef1234.webp",
    "/api/prep/bank/v7/ss-radiology/img/ct-head.webp",
    "/api/prep/bank/v5/ent/mcq/ent-sinusitis.json",
    "/api/prep/bank/v1/lessons/med-headache.json",
    "/api/prep/bank/v1/lessons/media/../../mcq/x.webp",
    "/prep/lessons/media/local.webp",
  ]) assert.equal(C.publicMediaUrl(u), u, u);
});

test("kill switch SMD_PUBLIC_MEDIA = '' keeps the bank URL", () => {
  globalThis.SMD_PUBLIC_MEDIA = "";
  try { assert.equal(C.publicMediaUrl("/api/prep/bank/v1/lessons/media/a-b.webp"), "/api/prep/bank/v1/lessons/media/a-b.webp"); }
  finally { delete globalThis.SMD_PUBLIC_MEDIA; }
});

test("a media-host miss falls back to the bank URL once", () => {
  globalThis.SMD_API_BASE = "https://stewardmd.in";
  try {
    const el = { a: {}, getAttribute(k) { return this.a[k]; }, setAttribute(k, v) { this.a[k] = v; this.src = v; } };
    el.setAttribute("src", "https://media.stewardmd.in/v1/lessons/media/new-fig.webp");
    assert.equal(C.mediaFallback(el), true);
    assert.equal(el.src, "https://stewardmd.in/api/prep/bank/v1/lessons/media/new-fig.webp");
    assert.equal(C.mediaFallback(el), false, "only once");
    const other = { getAttribute() { return "https://stewardmd.in/api/prep/bank/v2/pyq/img/q.webp"; } };
    assert.equal(C.mediaFallback(other), false);
  } finally { delete globalThis.SMD_API_BASE; }
});
