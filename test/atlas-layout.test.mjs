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

// --- imageBox: letterbox the slice inside the stage, leaving both gutters clear ---
const { imageBox, overlaySvg } = mod.exports;
ok("imageBox is exported", typeof imageBox === "function");

// Tall stage, square image: width-constrained by the gutters.
let box = imageBox(400, 800, 1.0, 90);
ok("width-constrained box fits between the gutters", box.w <= 400 - 2 * 90 + 1e-9);
ok("width-constrained box keeps the aspect", Math.abs(box.w / box.h - 1.0) < 1e-9);
ok("width-constrained box is centred horizontally", Math.abs(box.x + box.w / 2 - 200) < 1e-9);
ok("width-constrained box is centred vertically", Math.abs(box.y + box.h / 2 - 400) < 1e-9);

// Short stage: height must become the constraint instead.
box = imageBox(400, 150, 1.0, 90);
ok("height-constrained box fits the stage", box.h <= 150 + 1e-9);
ok("height-constrained box keeps the aspect", Math.abs(box.w / box.h - 1.0) < 1e-9);
ok("box never exceeds the stage", box.x >= -1e-9 && box.y >= -1e-9 && box.w <= 400 + 1e-9);

// A tall, narrow slice must not overflow vertically either.
box = imageBox(400, 300, 0.5, 90);
ok("tall slice is height-constrained", box.h <= 300 + 1e-9 && Math.abs(box.w / box.h - 0.5) < 1e-9);

// Degenerate stage must not produce NaN.
box = imageBox(0, 0, 0.9, 90);
ok("degenerate stage yields finite numbers", [box.x, box.y, box.w, box.h].every(Number.isFinite));
box = imageBox(100, 800, 0.9, 90);   // gutters wider than the stage
ok("gutters wider than the stage clamp to zero, not negative", box.w >= 0 && Number.isFinite(box.w));

// --- overlaySvg ---
const ATL = {
  categories: { wm: { label: "White matter", color: "#ffffff" }, csf: { label: "CSF", color: "#7fd9e8" } },
  structures: { fornix: { name: "Fornix", category: "wm" }, sas: { name: "Subarachnoid space", category: "csf" } }
};
const SLICE = { i: 2, img: "/x.webp", aspect: 0.9, pins: [
  { s: "fornix", x: 48, y: 55 }, { s: "fornix", x: 52, y: 55 }, { s: "sas", x: 80, y: 40 }
] };
const B = imageBox(400, 800, 0.9, 90);
let svg = overlaySvg(SLICE, ATL, B, 400, 800, { sel: null, hidden: {} });
ok("overlay is an svg", svg.indexOf("<svg") === 0);
ok("overlay draws one dot per pin", (svg.match(/class="atlas-dot/g) || []).length === 3);
ok("overlay draws one leader line per pin", (svg.match(/class="atlas-lead/g) || []).length === 3);
ok("overlay draws one tick per pin", (svg.match(/class="atlas-tick/g) || []).length === 3);
ok("overlay uses both gutters", svg.includes('atlas-lab l') && svg.includes('atlas-lab r'));
ok("overlay uses the category colour", svg.includes("#7fd9e8"));
ok("overlay tags elements with their structure id", (svg.match(/data-atlas-s="fornix"/g) || []).length >= 2);
ok("overlay exposes an accessible name", svg.includes('aria-label="Fornix"'));
ok("overlay pins are focusable buttons", svg.includes('role="button"') && svg.includes('tabindex="0"'));
ok("overlay renders the label text", svg.includes("Fornix"));

// Leader-line geometry: every line must actually reach its dot.
const leads = [...svg.matchAll(/class="atlas-lead[^"]*" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)];
ok("leader lines are parseable", leads.length === 3);
ok("leader lines end inside the image box", leads.every((m) => {
  const x2 = +m[3], y2 = +m[4];
  return x2 >= B.x - 1 && x2 <= B.x + B.w + 1 && y2 >= B.y - 1 && y2 <= B.y + B.h + 1;
}));
ok("leader lines start in a gutter, not over the image", leads.every((m) => {
  const x1 = +m[1];
  return x1 <= 90 || x1 >= 400 - 90;
}));

// Pin y is a percentage of the IMAGE box; label y is placed down the full STAGE.
// A lone label must sit level with its dot, not drift by the letterbox offset —
// otherwise every leader line fans out diagonally instead of running across.
const ONE = { i: 1, aspect: 0.9, pins: [{ s: "fornix", x: 30, y: 55 }] };
const oneSvg = overlaySvg(ONE, ATL, B, 400, 800, { sel: null, hidden: {} });
const oneLead = oneSvg.match(/class="atlas-lead[^"]*" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
ok("a lone label sits level with its dot", Math.abs(+oneLead[2] - +oneLead[4]) < 1.0);
ok("the dot itself is at the image-box position",
   Math.abs(+oneLead[4] - (B.y + 0.55 * B.h)) < 1.0);
// And with heavy letterboxing the drift would be large, so this is a real guard.
const TALLBOX = imageBox(400, 800, 2.0, 90);   // wide image, tall stage => big letterbox
const tSvg = overlaySvg(ONE, ATL, TALLBOX, 400, 800, { sel: null, hidden: {} });
const tLead = tSvg.match(/class="atlas-lead[^"]*" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/);
ok("letterboxing does not desync label from dot", Math.abs(+tLead[2] - +tLead[4]) < 1.0);

// Selection: the chosen structure is marked on BOTH of its pins, others dim.
svg = overlaySvg(SLICE, ATL, B, 400, 800, { sel: "fornix", hidden: {} });
ok("selection marks every instance", (svg.match(/atlas-lab [lr] on"/g) || []).length === 2);
ok("selection dims the others", /atlas-lab [lr] dim"/.test(svg));
ok("selection thickens both leader lines", (svg.match(/atlas-lead on"/g) || []).length === 2);
ok("unselected dots dim too", /atlas-dot dim"/.test(svg));

// Hidden structures disappear entirely.
svg = overlaySvg(SLICE, ATL, B, 400, 800, { sel: null, hidden: { sas: true } });
ok("hidden structures are not drawn", !svg.includes("Subarachnoid"));
ok("hiding removes its dot", (svg.match(/class="atlas-dot/g) || []).length === 2);

// Robustness.
ok("empty slice renders an empty overlay",
   overlaySvg({ i: 1, aspect: 1, pins: [] }, ATL, B, 400, 800, { sel: null, hidden: {} }).indexOf("<svg") === 0);
ok("a pin naming an unknown structure is skipped",
   (overlaySvg({ i: 1, aspect: 1, pins: [{ s: "ghost", x: 5, y: 5 }] }, ATL, B, 400, 800, { sel: null, hidden: {} })
     .match(/class="atlas-dot/g) || []).length === 0);
const EVIL = { categories: { wm: { label: "w", color: "#fff" } }, structures: { z: { name: '"><script>x</script>', category: "wm" } } };
ok("overlay escapes hostile names",
   overlaySvg({ i: 1, aspect: 1, pins: [{ s: "z", x: 10, y: 10 }] }, EVIL, B, 400, 800, { sel: null, hidden: {} })
     .indexOf("<script>") === -1);
ok("a structure with a missing category still renders",
   overlaySvg({ i: 1, aspect: 1, pins: [{ s: "q", x: 10, y: 10 }] },
     { categories: {}, structures: { q: { name: "Q" } } }, B, 400, 800, { sel: null, hidden: {} })
     .indexOf("<svg") === 0);

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
