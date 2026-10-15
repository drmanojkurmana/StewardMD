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
