// Anatomy Atlas — pure layout helpers.
// layoutGutter must never overlap labels or push them out of bounds; wrapLabel must
// clamp to maxLines and signal truncation; playheadPct must match the measured
// reference positions (10/24 -> ~39%, 20/24 -> ~83%).
// Run: node test/atlas-layout.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "atlas.js"), "utf8");

// atlas.js is a browser IIFE; give it just enough globals to load, then read its exports.
const mod = { exports: {} };
new Function("window", "document", "module", SRC)(
  { addEventListener() {} },
  { addEventListener() {}, getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }) },
  mod
);
const { layoutGutter, wrapLabel, playheadPct } = mod.exports;

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("x FAIL:", n); } };

ok("exports are present", typeof layoutGutter === "function" && typeof wrapLabel === "function" && typeof playheadPct === "function");

// --- layoutGutter ---
const GAP = 6.5, PAD = 2;
const gaps = (out) => out.slice(1).map((o, i) => o.labelY - out[i].labelY);

ok("empty in, empty out", layoutGutter([], GAP, PAD).length === 0);

const one = layoutGutter([{ s: "a", x: 10, y: 50 }], GAP, PAD);
ok("single label keeps its y", one.length === 1 && Math.abs(one[0].labelY - 50) < 1e-9);

// Three pins crammed into 4% of height must spread to at least GAP apart.
const tight = layoutGutter([{ s: "a", x: 1, y: 50 }, { s: "b", x: 1, y: 51 }, { s: "c", x: 1, y: 54 }], GAP, PAD);
ok("crammed labels all returned", tight.length === 3);
ok("crammed labels respect gap", gaps(tight).every((g) => g >= GAP - 1e-9));
ok("crammed labels stay in bounds", tight.every((o) => o.labelY >= PAD - 1e-9 && o.labelY <= 100 - PAD + 1e-9));

// A column that would overflow the bottom must be shifted up, not clipped.
const low = layoutGutter([{ s: "a", x: 1, y: 90 }, { s: "b", x: 1, y: 93 }, { s: "c", x: 1, y: 99 }], GAP, PAD);
ok("overflowing column respects gap", gaps(low).every((g) => g >= GAP - 1e-9));
ok("overflowing column stays in bounds", low.every((o) => o.labelY <= 100 - PAD + 1e-9 && o.labelY >= PAD - 1e-9));

// Saturating column: 14 labels * 6.5 gap = 84.5 < 96 usable, so it must still fit.
const many = layoutGutter(Array.from({ length: 14 }, (_, i) => ({ s: "s" + i, x: 1, y: 40 + i * 0.2 })), GAP, PAD);
ok("14 labels all returned", many.length === 14);
ok("14 labels respect gap", gaps(many).every((g) => g >= GAP - 1e-9));
ok("14 labels stay in bounds", many.every((o) => o.labelY >= PAD - 1e-9 && o.labelY <= 100 - PAD + 1e-9));

// Order must follow pin.y so leader lines do not cross unnecessarily.
const ordered = layoutGutter([{ s: "c", x: 1, y: 80 }, { s: "a", x: 1, y: 10 }, { s: "b", x: 1, y: 45 }], GAP, PAD);
ok("output sorted by pin.y", ordered.map((o) => o.pin.s).join("") === "abc");
ok("pin objects passed through", ordered[0].pin.y === 10);

// --- wrapLabel ---
ok("short name is one line", JSON.stringify(wrapLabel("Fornix", 12, 2)) === JSON.stringify(["Fornix"]));
const w2 = wrapLabel("Superior frontal gyrus", 12, 2);
ok("long name wraps to 2 lines", w2.length === 2);
ok("truncated name ends with ellipsis", w2[1].slice(-1) === "…");
ok("wrapped lines respect maxChars", w2.every((l) => l.length <= 12));
const w1 = wrapLabel("Superior frontal gyrus", 12, 1);
ok("maxLines 1 is honoured", w1.length === 1 && w1[0].slice(-1) === "…");
const wlong = wrapLabel("Sternocleidomastoid", 8, 2);
ok("over-long single word is hard-cut", wlong.every((l) => l.length <= 8));
ok("empty name yields empty array", wrapLabel("", 12, 2).length === 0);
ok("exact-fit name is not ellipsised", wrapLabel("Thalamus", 8, 2).join("") === "Thalamus");

// --- playheadPct ---
ok("first slice is 0%", playheadPct(1, 24) === 0);
ok("last slice is 100%", playheadPct(24, 24) === 100);
ok("10/24 matches reference ~39%", Math.abs(playheadPct(10, 24) - 39.13) < 0.1);
ok("20/24 matches reference ~83%", Math.abs(playheadPct(20, 24) - 82.6) < 0.1);
ok("single-slice module does not divide by zero", playheadPct(1, 1) === 0);

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
