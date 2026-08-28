// Settings ▸ Apple Watch — connection label.
// The bug: a paired watch with the app installed but NOT reachable (watch off, out of
// range, app closed) read "Connected". Reachability is the only honest signal.
// Run: node test/watch-settings.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "watch-settings.js"), "utf8");

// Browser IIFE; give it just enough globals to load, then read its exports.
const mod = { exports: {} };
new Function("window", "document", "module", SRC)(
  {}, { getElementById: () => null, createElement: () => ({ style: {} }) }, mod
);
const { connLabel } = mod.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

ok("exported", typeof connLabel === "function");
const cases = [
  ["no plugin", {}, "Not supported", "smdaw-off"],
  ["unsupported", { supported: false, paired: true }, "Not supported", "smdaw-off"],
  ["no watch", { supported: true, paired: false }, "No watch paired", "smdaw-off"],
  ["paired, no app", { supported: true, paired: true }, "Paired — app not installed", "smdaw-off"],
  ["installed, asleep", { supported: true, paired: true, watchAppInstalled: true, reachable: false }, "Not connected", "smdaw-warn"],
  ["installed, live", { supported: true, paired: true, watchAppInstalled: true, reachable: true }, "Connected", "smdaw-ok"]
];
for (const [name, st, text, dot] of cases) {
  const r = connLabel(st);
  ok(name + " → " + text, r.text === text && r.dot === dot);
}

console.log((fail ? "FAILED " : "ok ") + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
