/* The institution handle is EITHER a human-facing SMD-XXXXXX code (canonically upper-case) or a
 * 32-char Firestore document id (lower-case hex, case-SENSITIVE). pglog-screens.js upper-cased
 * everything typed into the setup field, so a pasted org id was stored as 349CDC... and every
 * server call 404'd on a document id that does not exist. Three "fixes" chased the symptom on the
 * render side before anyone looked at what was being SENT. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function loadStore() {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  const win = { localStorage, addEventListener() {}, navigator: { onLine: true }, location: { origin: "https://x" } };
  const mod = { exports: {} };
  new Function("window", "localStorage", "module", "document", "fetch",
               readFileSync("pglog-store.js", "utf8"))(win, localStorage, mod, { addEventListener() {} }, () => {});
  return win.SMD_PGLOG_STORE || mod.exports;
}

const HEX_LOWER = "349cdc32210144cca031cccd1e0e20d4";

test("a pasted 32-char org id keeps its case", () => {
  const s = loadStore();
  s.setContext({ orgId: HEX_LOWER });
  assert.equal(s.context().orgId, HEX_LOWER);
});

test("an org id stored upper-case heals on read", () => {
  const s = loadStore();
  s.setContext({ orgId: HEX_LOWER.toUpperCase() });
  assert.equal(s.context().orgId, HEX_LOWER, "must fold to the real document id, not stay upper");
});

test("an SMD code is still canonicalised upper", () => {
  const s = loadStore();
  s.setContext({ orgId: "smd-ab12cd" });
  assert.equal(s.context().orgId, "SMD-AB12CD");
});

test("a 31- or 33-char string is not treated as a document id", () => {
  const s = loadStore();
  s.setContext({ orgId: "349cdc32210144cca031cccd1e0e20d" });      // 31
  assert.equal(s.context().orgId, "349CDC32210144CCA031CCCD1E0E20D");
});

test("clearing the handle still works", () => {
  const s = loadStore();
  s.setContext({ orgId: HEX_LOWER });
  s.setContext({ orgId: "" });
  assert.equal(s.context().orgId, "");
});
