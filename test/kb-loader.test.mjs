// test/kb-loader.test.mjs — the KB loader / license gate (Phase 2b): plaintext mode is unchanged; the
// runtime decrypt matches the build-time encrypt; the .enc URL + apiBase are right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { encryptBuffer } from "../scripts/encrypt-kb.mjs";

const SRC = readFileSync(new URL("../kb-loader.js", import.meta.url), "utf8");

// Load the browser IIFE with stubbed globals (crypto/atob/fetch/TextDecoder are Node 26 globals).
function load({ enc = 0, hostname = "localhost", readyState = "complete" } = {}) {
  const win = { SMD_KB_ENC: enc };
  const doc = {
    readyState,
    head: { appendChild(s) { setTimeout(() => { if (s.onload) s.onload(); }, 0); } },
    createElement() { let ol; return { set onload(f) { ol = f; }, get onload() { return ol; }, set onerror(f) {}, set src(v) {}, set text(v) {} }; },
    getElementById() { return null; }, body: { appendChild() {} },
  };
  const raf = (cb) => setTimeout(cb, 0);
  const ls = { getItem: () => null, setItem: () => {} };
  new Function("window", "document", "location", "requestAnimationFrame", "localStorage", SRC)(win, doc, { hostname }, raf, ls);
  return win;
}

test("SMD_KB_READY is a Promise + test hooks exposed", () => {
  const w = load();
  assert.ok(w.SMD_KB_READY && typeof w.SMD_KB_READY.then === "function");
  assert.ok(w.SMD_KBL && typeof w.SMD_KBL._decrypt === "function");
});

test("_encUrl rewrites .js?v -> .js.enc?v (and no-query -> .enc)", () => {
  const w = load();
  assert.equal(w.SMD_KBL._encUrl("/kb/dist/kb.core.js?v=gold363"), "/kb/dist/kb.core.js.enc?v=gold363");
  assert.equal(w.SMD_KBL._encUrl("/kb/dist/kb.core.js"), "/kb/dist/kb.core.js.enc");
});

test("_apiBase: relative on stewardmd.in, absolute in-app", () => {
  assert.equal(load({ hostname: "stewardmd.in" }).SMD_KBL._apiBase(), "");
  assert.equal(load({ hostname: "localhost" }).SMD_KBL._apiBase(), "https://stewardmd.in");
});

test("_decrypt matches the build-time encrypt (encrypt-kb.mjs) exactly", async () => {
  const w = load();
  const key = randomBytes(32);
  const js = 'window.KB={diseases:[{id:"x"}]};';
  const enc = encryptBuffer(js, key);
  const ab = enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength);
  const out = await w.SMD_KBL._decrypt(ab, new Uint8Array(key));
  assert.equal(out, js);
});

test("plaintext mode (SMD_KB_ENC=0) resolves SMD_KB_READY -> flag-off is unchanged behaviour", async () => {
  const w = load({ enc: 0 });
  assert.equal(await w.SMD_KB_READY, true);
});
