import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

test("bank client fails open when no session can be minted (server in shadow mode)", async () => {
  const calls = [];
  globalThis.SMD_IDTOKEN = () => "tok";
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || null });
    if (String(url).endsWith("/api/prep/session")) return { ok: false, status: 403, json: async () => ({ code: "origin-required", message: "no" }) };
    return { ok: true, status: 200, json: async () => ({ items: [1] }) };
  };
  const C = require("../prep-bank-client.js");
  const j = await C.fetchBankJSON("/api/prep/bank/v5/ss-medical-oncology/mcq/son-prostate-local.json");
  assert.deepEqual(j, { items: [1] });
  const last = calls[calls.length - 1];
  assert.match(last.url, /son-prostate-local\.json$/);
  assert.equal(last.headers, null, "asked without proof headers");
});

test("bank client: a 401 to an unsigned request says the sign-in expired, not 'need a connection'", async () => {
  globalThis.SMD_IDTOKEN = () => null;
  delete globalThis.SMD_IDTOKEN_REFRESH;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ code: "app-binding-required" }) });
  const C = require("../prep-bank-client.js");
  const fallback = "Questions need a connection. Check the connection and try again.";
  await assert.rejects(C.fetchBankJSON("/api/prep/bank/v5/pyq-ss/index.json"), (e) => e.code === "signin-expired");
  assert.match(globalThis.PREP_BANK_MSG(fallback), /sign-in has expired.*sign in again/i);
  globalThis.SMD_IDTOKEN = () => "tok";
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [], sessionId: "s", sessionKey: "k" }) });
  await C.fetchBankJSON("/api/prep/bank/v5/pyq-ss/index.json");
  assert.equal(globalThis.PREP_BANK_MSG(fallback), fallback, "a later success clears it");
});
