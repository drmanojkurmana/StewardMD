/* content-crypt + encrypt-bundle round-trip tests (Security 4).
 * Run: node --test test/content-crypt.test.mjs
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  encryptBuffer, decryptBuffer, isSmde1, MAGIC, IV_LEN,
} from "../tools/encrypt-bundle.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = randomBytes(32);
const KEY_B64 = KEY.toString("base64");
const KEY_ID = "test-v1";

describe("encrypt-bundle SMDE1 format", () => {
  it("round-trips JSON", () => {
    const plain = Buffer.from(JSON.stringify({ hello: "world", n: 42 }), "utf8");
    const enc = encryptBuffer(plain, KEY, KEY_ID);
    assert.equal(isSmde1(enc), true);
    assert.equal(enc.subarray(0, 5).toString("ascii"), "SMDE1");
    const { keyId, plaintext } = decryptBuffer(enc, KEY);
    assert.equal(keyId, KEY_ID);
    assert.deepEqual(JSON.parse(plaintext.toString("utf8")), { hello: "world", n: 42 });
  });

  it("rejects tampered ciphertext", () => {
    const enc = Buffer.from(encryptBuffer(Buffer.from('{"a":1}'), KEY, KEY_ID));
    enc[enc.length - 5] ^= 0xff;
    assert.throws(() => decryptBuffer(enc, KEY));
  });

  it("rejects wrong key", () => {
    const enc = encryptBuffer(Buffer.from('{"a":1}'), KEY, KEY_ID);
    assert.throws(() => decryptBuffer(enc, randomBytes(32)));
  });

  it("surfaces key id from header for wrong-id handling", () => {
    const enc = encryptBuffer(Buffer.from('{"a":1}'), KEY, "other-id");
    assert.equal(isSmde1(enc), true);
    const idLen = enc[5];
    const gotId = enc.subarray(6, 6 + idLen).toString("utf8");
    assert.equal(gotId, "other-id");
    // Decrypt with a map that lacks other-id → missing key error
    assert.throws(() => decryptBuffer(enc, (id) => (id === KEY_ID ? KEY : null)), /missing key/);
  });
});

function loadContentCrypt(harness) {
  const src = readFileSync(path.join(ROOT, "content-crypt.js"), "utf8");
  const g = {
    window: null,
    console,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    TextDecoder,
    TextEncoder,
    crypto: globalThis.crypto,
    fetch: harness.fetch,
    localStorage: harness.localStorage,
    document: harness.document,
    Capacitor: harness.Capacitor,
    SMD_AUTH: harness.SMD_AUTH,
    SMD_IDTOKEN: harness.SMD_IDTOKEN,
    SMD_API_BASE: "",
    location: { hostname: "localhost" },
    dispatchEvent: () => {},
    Event: class { constructor(t) { this.type = t; } },
  };
  g.window = g;
  g.globalThis = g;
  vm.runInNewContext(src, g, { filename: "content-crypt.js" });
  return g;
}

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe("SMD_CONTENT loader", () => {
  it("passthrough plain JSON", async () => {
    const body = JSON.stringify({ ok: true, x: 1 });
    const g = loadContentCrypt({
      fetch: async () => ({
        ok: true, status: 200,
        arrayBuffer: async () => Buffer.from(body),
        json: async () => JSON.parse(body),
      }),
      localStorage: memStorage(),
      document: { getElementById: () => null, createElement: () => ({ setAttribute() {}, style: {}, onclick: null }), body: { appendChild() {} } },
      Capacitor: null,
      SMD_AUTH: null,
      SMD_IDTOKEN: () => null,
    });
    const j = await g.SMD_CONTENT.fetchJSON("/kb/protocols/index.json");
    // JSON.compare across the vm sandbox (Object realm differs) — stringify.
    assert.equal(JSON.stringify(j), JSON.stringify({ ok: true, x: 1 }));
    assert.equal(g.SMD_CONTENT.covers("/kb/foo.json"), true);
    assert.equal(g.SMD_CONTENT.covers("/prep/taxonomy.json"), false);
    assert.equal(g.SMD_CONTENT.covers("/prep/bank/v1/x/index.json"), true);
  });

  it("decrypts SMDE1 with a stored key", async () => {
    const plain = { drugs: ["amox"], n: 2 };
    const enc = encryptBuffer(Buffer.from(JSON.stringify(plain)), KEY, KEY_ID);
    const store = memStorage();
    const g = loadContentCrypt({
      fetch: async () => ({
        ok: true, status: 200,
        arrayBuffer: async () => enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength),
      }),
      localStorage: store,
      document: { getElementById: () => null, createElement: () => ({ setAttribute() {}, style: {}, onclick: null }), body: { appendChild() {} } },
      Capacitor: null,
      SMD_AUTH: null,
      SMD_IDTOKEN: () => null,
    });
    await g.SMD_CONTENT.storeKey(KEY_ID, KEY_B64);
    const j = await g.SMD_CONTENT.fetchJSON("/data/neo/foo.json?v=1");
    assert.equal(JSON.stringify(j), JSON.stringify(plain));
  });

  it("shows offline-unlock state when key is missing", async () => {
    const enc = encryptBuffer(Buffer.from('{"a":1}'), KEY, KEY_ID);
    let appended = null;
    const g = loadContentCrypt({
      fetch: async (url) => {
        if (String(url).indexOf("/api/content-key") >= 0) {
          return { ok: false, status: 401, json: async () => ({ error: "auth" }) };
        }
        return {
          ok: true, status: 200,
          arrayBuffer: async () => enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength),
        };
      },
      localStorage: memStorage(),
      document: {
        getElementById: (id) => (appended && appended.id === id ? appended : null),
        createElement: (tag) => {
          const el = {
            id: "", tagName: tag, style: {}, onclick: null,
            setAttribute(k, v) { this[k] = v; },
            innerHTML: "",
          };
          return el;
        },
        body: { appendChild(el) { appended = el; } },
      },
      Capacitor: null,
      SMD_AUTH: null,
      SMD_IDTOKEN: () => null,
    });
    await assert.rejects(() => g.SMD_CONTENT.fetchJSON("/kb/antibiogram/antibiogram.json"), /content-key-missing/);
    assert.ok(appended, "unlock UI should be mounted");
    assert.equal(appended.id, "smdContentUnlock");
    assert.match(appended.innerHTML, /Connect to the internet once to unlock the library/);
  });

  it("rejects tampered SMDE1 in the browser path", async () => {
    const enc = Buffer.from(encryptBuffer(Buffer.from('{"a":1}'), KEY, KEY_ID));
    enc[enc.length - 3] ^= 0xaa;
    const g = loadContentCrypt({
      fetch: async () => ({
        ok: true, status: 200,
        arrayBuffer: async () => enc.buffer.slice(enc.byteOffset, enc.byteOffset + enc.byteLength),
      }),
      localStorage: memStorage(),
      document: { getElementById: () => null, createElement: () => ({ setAttribute() {}, style: {}, onclick: null }), body: { appendChild() {} } },
      Capacitor: null,
      SMD_AUTH: null,
      SMD_IDTOKEN: () => null,
    });
    await g.SMD_CONTENT.storeKey(KEY_ID, KEY_B64);
    await assert.rejects(() => g.SMD_CONTENT.fetchJSON("/kb/x.json"), /content-decrypt-failed|decrypt/i);
  });
});

describe("GET /api/content-key auth", () => {
  let onRequest;
  before(async () => {
    // Dynamic import of the Pages Function.
    const mod = await import("../functions/api/content-key.js");
    onRequest = mod.onRequest;
  });

  it("denies without App Check or ID token", async () => {
    const req = new Request("https://stewardmd.in/api/content-key", { method: "GET" });
    const res = await onRequest({
      request: req,
      env: { SMD_CONTENT_KEYS: JSON.stringify({ [KEY_ID]: KEY_B64 }), SMD_CONTENT_KEY_ID: KEY_ID },
      waitUntil() {},
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, "auth");
    assert.match(res.headers.get("Cache-Control") || "", /no-store/);
  });

  it("returns key when App Check test gate passes", async () => {
    globalThis.__SMD_TEST_APPCHECK_OK = true;
    try {
      const req = new Request("https://stewardmd.in/api/content-key", {
        method: "GET",
        headers: { "X-Firebase-AppCheck": "dummy" },
      });
      const res = await onRequest({
        request: req,
        env: { SMD_CONTENT_KEYS: JSON.stringify({ [KEY_ID]: KEY_B64 }), SMD_CONTENT_KEY_ID: KEY_ID },
        waitUntil() {},
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.keyId, KEY_ID);
      assert.equal(body.key, KEY_B64);
      assert.match(res.headers.get("Cache-Control") || "", /private, no-store/);
    } finally {
      delete globalThis.__SMD_TEST_APPCHECK_OK;
    }
  });

  it("404s for unknown keyId", async () => {
    globalThis.__SMD_TEST_APPCHECK_OK = true;
    try {
      const req = new Request("https://stewardmd.in/api/content-key?keyId=nope", {
        method: "GET",
        headers: { "X-Firebase-AppCheck": "dummy" },
      });
      const res = await onRequest({
        request: req,
        env: { SMD_CONTENT_KEYS: JSON.stringify({ [KEY_ID]: KEY_B64 }) },
        waitUntil() {},
      });
      assert.equal(res.status, 404);
    } finally {
      delete globalThis.__SMD_TEST_APPCHECK_OK;
    }
  });
});
