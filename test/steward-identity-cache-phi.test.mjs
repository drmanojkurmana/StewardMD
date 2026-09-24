/* No patient data on the disk (steward-identity-resolver.js cache). The cache used to write the whole
 * record - name, phone, encounter, queue ticket - to localStorage in plain text, never cleared on sign-out.
 * The disk now keeps a hint (StewardID -> patient id) that expires; the record stays in memory only.
 * node --test test/steward-identity-cache-phi.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function freshResolver() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i], get length() { return store.size; },
  };
  delete require.cache[require.resolve("../steward-identity-resolver.js")];
  return { R: require("../steward-identity-resolver.js"), store };
}

test("resolving a patient writes NO name, phone or visit to localStorage", () => {
  const { R, store } = freshResolver();
  const sid = R.mintStewardId();
  const patient = { name: "Asha Rao", mobile: "9876500001", stewardId: sid };
  const res = R.resolvePatientIdentity({ type: "manual", value: sid }, { patientStore: { [sid]: patient } });
  assert.ok(res && res.ok, JSON.stringify(res));
  const disk = [...store.values()].join(" ");
  assert.ok(store.size > 0, "a hint is kept");
  assert.ok(!/Asha|9876500001|encounter|ticket/i.test(disk), "no patient data on disk: " + disk.slice(0, 200));
  assert.match(disk, /"exp":\d+/, "and the hint expires");
});

test("a full record left on disk by the old version is thrown away, not served", () => {
  const { R, store } = freshResolver();
  store.set("steward.identity.cache.SMP-OLD", JSON.stringify({ stewardId: "SMP-OLD", patient: { name: "Old Leak" }, exp: Date.now() + 1e9 }));
  R.resolvePatientIdentity({ type: "manual", value: "SMP-OLD" }, {});
  assert.ok(![...store.values()].join(" ").includes("Old Leak"), "the pre-fix record is deleted");
});

test("clearCache on sign-out leaves nothing behind", () => {
  const { R, store } = freshResolver();
  const sid = R.mintStewardId();
  R.resolvePatientIdentity({ type: "manual", value: sid }, { patientStore: { [sid]: { name: "X", stewardId: sid } } });
  R.clearCache();
  assert.equal([...store.keys()].filter((k) => k.startsWith("steward.identity.cache.")).length, 0);
});
