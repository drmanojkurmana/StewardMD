import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../prep-bank-client.js", import.meta.url), "utf8");
const RAW = "/api/prep/bank/v16/ss-radiology/img/i-ce7200d1d00d.webp";
const KEY = "ab".repeat(32);

function loadClient() {
  const calls = [];
  const sandbox = {
    console,
    SMD_IDTOKEN: () => "tok-test",
    SMD_DEVICEID: () => "dev-test",
    fetch: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/api/prep/session")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessionId: "sess-1", sessionKey: KEY, expiresAt: Math.floor(Date.now() / 1000) + 600, uid: "u1" }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    },
  };
  vm.runInNewContext(SRC, sandbox, { filename: "prep-bank-client.js" });
  return { client: sandbox.PREP_BANK_CLIENT, calls, sessionCalls: () => calls.filter((u) => u.endsWith("/api/prep/session")).length };
}

function fakeImg(src) {
  const attrs = { src };
  return {
    src,
    dataset: {},
    setAttribute(k, v) { attrs[k] = String(v); if (k === "src") this.src = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    _attrs: attrs,
  };
}

test("no session: signImageUrl returns unsigned and triggers exactly one session mint", async () => {
  const { client, sessionCalls } = loadClient();
  assert.ok(client.ensureSession, "ensureSession exported");
  assert.ok(client.resignImg, "resignImg exported");
  const a = client.signImageUrl(RAW);
  const b = client.signImageUrl(RAW);
  const c = client.signImageUrl(RAW);
  assert.equal(a, RAW);
  assert.equal(b, RAW);
  assert.equal(c, RAW);
  await client.ensureSession();
  assert.equal(sessionCalls(), 1, "exactly one session mint for repeated unsigned signs");
});

test("after mint: signImageUrl returns signed url with s, exp and sig", async () => {
  const { client } = loadClient();
  await client.ensureSession();
  const signed = client.signImageUrl(RAW);
  assert.match(signed, /\?s=sess-1&exp=\d+&sig=[0-9a-f]{64}$/);
  assert.ok(signed.startsWith(RAW + "?s="));
});

test("resignImg sets a signed src after an img error and retries only once", async () => {
  const { client, sessionCalls } = loadClient();
  const img = fakeImg(RAW);
  const first = await client.resignImg(img, RAW);
  assert.equal(first, true);
  assert.match(img.src, /\?s=sess-1&exp=\d+&sig=[0-9a-f]{64}$/);
  assert.equal(img.getAttribute("data-smd-resigned"), "1");
  const afterFirst = img.src;
  const second = await client.resignImg(img, RAW);
  assert.equal(second, false, "second retry is a no-op");
  assert.equal(img.src, afterFirst, "src unchanged on second retry");
  assert.equal(sessionCalls(), 1);
});

test("resignImg leaves non-gated images alone", async () => {
  const { client } = loadClient();
  const img = fakeImg("/api/prep/bank/v1/lessons/media/neck-us.webp");
  assert.equal(await client.resignImg(img), false);
  assert.equal(img.src, "/api/prep/bank/v1/lessons/media/neck-us.webp");
});
