import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapFetch, readToken } from "../tools/_bank-token.mjs";

test("the tools preload adds X-SMD-Tool only to bank URLs, and does nothing without a token", async () => {
  const seen = [];
  const real = async (u, o) => { seen.push({ u: String(u), h: new Headers((o && o.headers) || {}) }); return new Response("ok"); };
  const f = wrapFetch(real, "tok-0123456789abcdef0123456789");
  await f("https://stewardmd.in/api/prep/bank/v5/x/index.json", { cache: "no-store" });
  await f("https://stewardmd.in/api/other");
  await f("https://evil.example/api/prep/bank/x");
  assert.equal(seen[0].h.get("X-SMD-Tool"), "tok-0123456789abcdef0123456789");
  assert.equal(seen[1].h.get("X-SMD-Tool"), null);
  assert.equal(seen[2].h.get("X-SMD-Tool"), null, "never sent to another host");
  assert.equal(wrapFetch(real, ""), real);
  assert.equal(readToken({ SMD_TOOL_TOKEN: " abc " }, "/nonexistent"), "abc");
  assert.equal(readToken({}, "/nonexistent"), "");
});
