/* Home-tile visibility for the four experimental imaging modules, exercised against the REAL
 * home.js source (the two gate functions are lifted out and run over stub globals) rather than a
 * reimplementation, so the test fails if the shipped logic drifts.
 *
 * What must hold: a Physician Pro sees the tiles with no localStorage flag; nobody else does; the
 * legacy tester paths (localStorage "1", ?thorex=1) keep working unchanged; and an explicit "off"
 * from a tester still wins over the paid tier. */
import assert from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "home.js"), "utf8");

// Lift the two gate functions verbatim out of home.js.
const grab = (name) => {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at > 0, name + " not found in home.js — the tile gate was renamed or removed");
  let depth = 0, i = src.indexOf("{", at);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error("unbalanced braces for " + name);
};
const GATE_SRC = grab("earlyAccessTier") + "\n" + grab("expTileOn") + "\nreturn expTileOn;";

// stub environment: { tier, store: {key: value}, search: "?thorex=1", mods: { THOREX: {isOn} } }
function gate(env) {
  const store = env.store || {};
  const win = Object.assign({ SMD_PRO: { tierSync: () => env.tier || "" } }, env.mods || {});
  const localStorage = { getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null) };
  const location = { search: env.search || "" };
  return new Function("window", "localStorage", "location", GATE_SRC)(win, localStorage, location);
}

const TILES = [
  ["smd_thorex", "thorex", "THOREX"],
  ["smd_kardiox", "kardiox", "KARDIOX"],
  ["smd_sknx", "sknx", "SKNX"],
  ["smd_fundx", "fundx", null]
];

test("physicianpro sees every tile with no localStorage flag set", () => {
  const on = gate({ tier: "physicianpro" });
  TILES.forEach(([k, p, m]) => assert.equal(on(k, p, m), true, p));
});

test("pro / physician / free / unknown tier see nothing and read no flag", () => {
  ["pro", "physician", "trainee", "coresident", "free", ""].forEach((tier) => {
    const on = gate({ tier });
    TILES.forEach(([k, p, m]) => assert.equal(on(k, p, m), false, tier + " " + p));
  });
});

test("legacy tester paths are unchanged: localStorage flag and query param", () => {
  TILES.forEach(([k, p, m]) => {
    assert.equal(gate({ tier: "free", store: { [k]: "1" } })(k, p, m), true, k + "=1");
    assert.equal(gate({ tier: "free", search: "?" + p + "=1" })(k, p, m), true, "?" + p + "=1");
    assert.equal(gate({ tier: "free", search: "?" + p + "=on" })(k, p, m), true, "?" + p + "=on");
    assert.equal(gate({ tier: "free", search: "?" + p + "=0" })(k, p, m), false, "?" + p + "=0");
  });
});

test("a module's own isOn() still wins first (the access-code path)", () => {
  assert.equal(gate({ tier: "free", mods: { THOREX: { isOn: () => true } } })("smd_thorex", "thorex", "THOREX"), true);
});

test("an explicit tester OFF beats the paid tier", () => {
  // A tester who set the flag to "0" (or used ?thorex=0) is deliberately checking the hidden state.
  TILES.forEach(([k, p, m]) => {
    assert.equal(gate({ tier: "physicianpro", store: { [k]: "0" } })(k, p, m), false, k + "=0");
    assert.equal(gate({ tier: "physicianpro", search: "?" + p + "=0" })(k, p, m), false, "?" + p + "=0");
  });
});

test("a missing SMD_PRO does not throw and denies", () => {
  const on = new Function("window", "localStorage", "location", GATE_SRC)({}, { getItem: () => null }, { search: "" });
  assert.equal(on("smd_thorex", "thorex", "THOREX"), false);
});
