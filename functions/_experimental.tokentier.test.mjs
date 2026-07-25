import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, readTokenTier } from "./_experimental.js";

const SECRET = "test-secret";

test("tier round-trips through the signed token", async () => {
  const tok = await signToken({ f: "thorex", u: "uid1", d: "dev1", p: "ios", a: 123, t: "v2beta" }, SECRET);
  assert.equal(await readTokenTier(tok, SECRET), "v2beta");
});

test("tampered/absent tier reads as v1", async () => {
  const tok = await signToken({ f: "thorex", u: "uid1", d: "dev1", p: "ios", a: 123 }, SECRET);
  assert.equal(await readTokenTier(tok, SECRET), "v1");
});
