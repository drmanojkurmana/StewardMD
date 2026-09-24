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
ok("overlay draws one tick per STRUCTURE (labels are deduped)", (svg.match(/class="atlas-tick/g) || []).length === 2);
ok("overlay draws one label per structure", (svg.match(/class="atlas-lab/g) || []).length === 2);
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
ok("selection marks the one label of the structure", (svg.match(/atlas-lab [lr] on"/g) || []).length === 1);
ok("selection marks every dot of the structure", (svg.match(/class="atlas-dot on"/g) || []).length === 2);
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

// --- scrub track thumbnails ---
const { trackThumbs } = mod.exports;
ok("trackThumbs is exported", typeof trackThumbs === "function");
const mkA = (n) => ({ slices: Array.from({ length: n }, (_, i) => ({ i: i + 1, img: "/a/" + String(i + 1).padStart(3, "0") + ".webp" })) });
ok("samples 5 thumbs from 24 slices", trackThumbs(mkA(24), 5).length === 5);
ok("first thumb is the first slice", trackThumbs(mkA(24), 5)[0].includes("001"));
ok("last thumb is the last slice", trackThumbs(mkA(24), 5)[4].includes("024"));
ok("thumbs come from the t/ directory", trackThumbs(mkA(24), 5)[0].includes("/t/"));
ok("thumbs are evenly spaced", trackThumbs(mkA(24), 5).join(",") === "/a/t/001.webp,/a/t/007.webp,/a/t/013.webp,/a/t/018.webp,/a/t/024.webp");
ok("thumbs strictly ascend", (() => { const n = trackThumbs(mkA(24), 5).map(u => +u.match(/(\d+)\.webp/)[1]); return n.every((v, k) => k === 0 || v > n[k - 1]); })());
ok("fewer slices than samples degrades gracefully", trackThumbs(mkA(3), 5).length === 3);
ok("single slice is safe", trackThumbs(mkA(1), 5).length === 1);
ok("empty atlas is safe", trackThumbs({ slices: [] }, 5).length === 0);
ok("null atlas is safe", trackThumbs(null, 5).length === 0);

// ===================== premium viewer helpers (2026-09-25) =====================
const P = mod.exports;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// --- exactly one tab stop per structure ---
const tabStops = (s) => [...s.matchAll(/<(?:circle|text)[^>]*tabindex="0"[^>]*>/g)].map((m) => (m[0].match(/data-atlas-s="([^"]+)"/) || [])[1]);
svg = overlaySvg(SLICE, ATL, B, 400, 800, { mode: "labels" });
ok("labels mode: one tab stop per structure", tabStops(svg).sort().join() === "fornix,sas");
ok("labels mode: the tab stop is the label, dots are hidden from AT",
   !/<circle class="atlas-dot[^>]*tabindex/.test(svg) && /<circle class="atlas-dot[^>]*aria-hidden="true"/.test(svg));
svg = overlaySvg(SLICE, ATL, imageBox(400, 800, 0.9, 0), 400, 800, { mode: "pins" });
ok("pins mode: one tab stop per structure", tabStops(svg).sort().join() === "fornix,sas");
ok("pins mode: every pin is still drawn", (svg.match(/class="atlas-dot/g) || []).length === 3);
ok("pins mode: no gutter labels", !svg.includes("atlas-lab"));
svg = overlaySvg(SLICE, ATL, imageBox(400, 800, 0.9, 0), 400, 800, { mode: "off" });
ok("off mode: a clean image", !svg.includes("atlas-dot") && !svg.includes("atlas-lab"));
svg = overlaySvg(SLICE, ATL, imageBox(400, 800, 0.9, 0), 400, 800, { mode: "off", sel: "fornix" });
ok("off mode still shows the selected structure, without tab stops",
   (svg.match(/class="atlas-dot/g) || []).length === 2 && !svg.includes("tabindex"));

// --- dedupe grouping ---
const G2 = P.groupPins([{ s: "a", x: 10, y: 10 }, { s: "b", x: 50, y: 50 }, { s: "a", x: 30, y: 20 }, { s: "a", x: 20, y: 30 }]);
ok("groupPins: one group per structure, first-appearance order", G2.length === 2 && G2[0].s === "a" && G2[1].s === "b");
ok("groupPins: keeps every point", G2[0].pts.length === 3);
ok("groupPins: mean position", near(G2[0].x, 20) && near(G2[0].y, 20));
ok("groupPins: empty in, empty out", P.groupPins([]).length === 0 && P.groupPins(null).length === 0);
const PANC = { categories: ATL.categories, structures: { p: { name: "Pancreas", category: "wm" } } };
const P4 = { i: 1, aspect: 1, pins: [{ s: "p", x: 40, y: 50 }, { s: "p", x: 45, y: 52 }, { s: "p", x: 55, y: 51 }, { s: "p", x: 60, y: 49 }] };
svg = overlaySvg(P4, PANC, imageBox(400, 800, 1, 90), 400, 800, { mode: "labels" });
ok("a 4-pin structure has one label", (svg.match(/class="atlas-lab/g) || []).length === 1);
ok("... with a leader to each of its pins", (svg.match(/class="atlas-lead/g) || []).length === 4);
// Real data: ct-live-torso-axial slice 6 carries 25 pins over 15 structures.
const TORSO = JSON.parse(readFileSync(join(ROOT, "atlas/ct-live-torso-axial/atlas.json"), "utf8"));
const t6 = TORSO.slices[5], uniq = new Set(t6.pins.map((p) => p.s)).size;
svg = overlaySvg(t6, TORSO, imageBox(390, 560, t6.aspect, 90), 390, 560, { mode: "labels" });
ok("torso slice 6: one label per structure (" + uniq + ")", (svg.match(/class="atlas-lab/g) || []).length === uniq);
ok("torso slice 6: one leader per pin (" + t6.pins.length + ")", (svg.match(/class="atlas-lead/g) || []).length === t6.pins.length);
ok("torso slice 6: both gutters are used", svg.includes("atlas-lab l") && svg.includes("atlas-lab r"));

// --- labels never go under a peeking sheet or above the stage ---
const labYs = (s, side) => [...s.matchAll(/class="atlas-lab ([lr])[^"]*" x="[\d.]+" y="([\d.]+)"/g)]
  .filter((m) => !side || m[1] === side).map((m) => +m[2]);
svg = overlaySvg(t6, TORSO, imageBox(390, 400, t6.aspect, 90), 390, 560, { mode: "labels", visH: 400 });
ok("labels stay inside the visible height (2-line label bottom included)", labYs(svg).every((y) => y + 13 + 4 <= 400));
ok("labels clear the top edge of the stage", labYs(svg).every((y) => y - 10 >= 0));
svg = overlaySvg(t6, TORSO, imageBox(390, 560, t6.aspect, 90), 390, 560, { mode: "labels" });
const gapsOf = (ys) => ys.sort((a, b) => a - b).slice(1).map((y, i) => y - ys[i]);
ok("labels in a column never overlap", ["l", "r"].every((sd) => gapsOf(labYs(svg, sd)).every((g) => g >= 17)));

// --- zoom box, clamp, zoom about a point ---
const base = { x: 0, y: 100, w: 400, h: 300 };
ok("zoomBox at s=1 is the base box", JSON.stringify(P.zoomBox(base, { s: 1, px: 0, py: 0 })) === JSON.stringify(base));
let zb = P.zoomBox(base, { s: 2, px: 0, py: 0 });
ok("zoomBox scales about the base centre", near(zb.w, 800) && near(zb.h, 600) && near(zb.x, -200) && near(zb.y, -50));
ok("clampZoom caps the scale", P.clampZoom(base, { s: 9, px: 0, py: 0 }, 400, 500, 6).s === 6);
ok("clampZoom floors the scale at 1", P.clampZoom(base, { s: 0.3, px: 50, py: 50 }, 400, 500).s === 1);
ok("an unzoomed image cannot be panned", (() => { const c = P.clampZoom(base, { s: 1, px: 80, py: -40 }, 400, 500); return c.px === 0 && c.py === 0; })());
zb = P.zoomBox(base, P.clampZoom(base, { s: 2, px: 5000, py: -5000 }, 400, 500));
ok("clamped pan: the image still covers the view horizontally", zb.x <= 1e-9 && zb.x + zb.w >= 400 - 1e-9);
ok("clamped pan: the image still covers the view vertically", zb.y <= 1e-9 && zb.y + zb.h >= 500 - 1e-9);
const z1 = P.zoomAt(base, { s: 1, px: 0, py: 0 }, 3, 100, 200), d1 = P.zoomBox(base, z1);
ok("zoomAt keeps the image point under the finger", near((100 - d1.x) / d1.w, 0.25) && near((200 - d1.y) / d1.h, 1 / 3));
const d2 = P.zoomBox(base, P.zoomAt(base, z1, 3, 100, 200, 150, 260));
ok("zoomAt with a moving midpoint pans with it", near((150 - d2.x) / d2.w, 0.25) && near((260 - d2.y) / d2.h, 1 / 3));
const pz = P.toScreen(d1, false, 25, 100 / 3);
ok("a pin under the focal point stays under it after zooming", near(pz.x, 100) && near(pz.y, 200));

// --- flipX (display-time mirror) ---
const fb = { x: 10, y: 20, w: 200, h: 100 };
const a0 = P.toScreen(fb, false, 30, 40), a1 = P.toScreen(fb, true, 30, 40);
ok("flip mirrors x about the image centre", near(a0.x + a1.x, 2 * (fb.x + fb.w / 2)));
ok("flip leaves y alone", near(a0.y, a1.y));
ok("toImage inverts toScreen (unflipped)", (() => { const q = P.toImage(fb, false, a0.x, a0.y); return near(q.x, 30) && near(q.y, 40); })());
ok("toImage inverts toScreen (flipped)", (() => { const q = P.toImage(fb, true, a1.x, a1.y); return near(q.x, 30) && near(q.y, 40); })());
const fdot = overlaySvg(ONE, ATL, B, 400, 800, { mode: "pins", flip: true }).match(/class="atlas-dot[^"]*" cx="([\d.]+)"/);
ok("overlaySvg mirrors pins when flipX", Math.abs(+fdot[1] - (B.x + (1 - 0.30) * B.w)) < 0.2);
const nf = overlaySvg(ONE, ATL, B, 400, 800, { mode: "labels", flip: true });
ok("a mirrored left-side pin gets a right-hand label", nf.includes("atlas-lab r") && !nf.includes("atlas-lab l"));

// --- orientation letters ---
svg = overlaySvg(ONE, ATL, B, 400, 800, { mode: "pins", orient: { left: "R", right: "L", top: "A", bottom: "P" } });
ok("orient letters are drawn", ["R", "L", "A", "P"].every((c) => svg.includes('aria-hidden="true">' + c + "</text>")));
ok("orient accepts only R L A P S I", !overlaySvg(ONE, ATL, B, 400, 800, { mode: "pins", orient: { left: "<b>" } }).includes("atlas-orient"));
ok("no orient data, no letters", !overlaySvg(ONE, ATL, B, 400, 800, { mode: "pins" }).includes("atlas-orient"));

// --- ruler ---
ok("rulerMm: the full width of a 300 mm image", near(P.rulerMm({ x: 0, y: 50 }, { x: 100, y: 50 }, [300, 200]), 300));
ok("rulerMm: anisotropic diagonal", near(P.rulerMm({ x: 0, y: 0 }, { x: 100, y: 100 }, [300, 400]), 500));
ok("rulerMm: no mm, no measurement", P.rulerMm({ x: 0, y: 0 }, { x: 1, y: 1 }, null) === null);
// Points are stored in image %, so a measurement taken zoomed and flipped equals the same
// two points measured unzoomed.
const zD = P.zoomBox(base, { s: 4, px: 30, py: -20 });
const m1 = P.toImage(zD, true, 120, 180), m2 = P.toImage(zD, true, 220, 260);
const s1 = P.toScreen(zD, true, m1.x, m1.y), s2 = P.toScreen(zD, true, m2.x, m2.y);
const pxDist = Math.hypot(s2.x - s1.x, s2.y - s1.y) / 4;          // unzoomed screen px
ok("ruler: zoomed+flipped taps map back to the same screen points", near(s1.x, 120) && near(s2.y, 260));
ok("ruler: mm is zoom-invariant", near(P.rulerMm(m1, m2, [base.w, base.h]), pxDist, 1e-6));
svg = overlaySvg(ONE, ATL, B, 400, 800, { mode: "off", ruler: { pts: [{ x: 0, y: 50 }, { x: 50, y: 50 }], mm: [300, 200] } });
ok("the ruler is drawn with its mm label", svg.includes("atlas-ruler") && svg.includes(">150 mm<"));

// --- Find it ---
const JP = [{ s: "aorta", x: 100, y: 100 }, { s: "ivc", x: 140, y: 100 }, { s: "aorta", x: 300, y: 300 }];
ok("judgeFind: a tap nearest the target is right", P.judgeFind(JP, 110, 102, "aorta", 50).ok === true);
ok("judgeFind: a tap nearest another structure is wrong and says which",
   P.judgeFind(JP, 132, 100, "aorta", 50).ok === false && P.judgeFind(JP, 132, 100, "aorta", 50).s === "ivc");
ok("judgeFind: any pin of a multi-pin structure counts", P.judgeFind(JP, 290, 310, "aorta", 50).ok === true);
ok("judgeFind: a tap far from every pin is wrong", P.judgeFind(JP, 600, 600, "aorta", 50).ok === false && P.judgeFind(JP, 600, 600, "aorta", 50).s === null);
ok("judgeFind: no pins is safe", P.judgeFind([], 1, 1, "x", 50).ok === false);

// --- quiz rendering ---
const PB = imageBox(400, 800, 0.9, 0);
svg = overlaySvg(SLICE, ATL, PB, 400, 800, { mode: "pins", quiz: { kind: "name", marks: {} } });
ok("Name it hides every name, even from AT", !svg.includes("Fornix") && !svg.includes("Subarachnoid"));
ok("Name it keeps one tab stop per structure", tabStops(svg).length === 2);
svg = overlaySvg(SLICE, ATL, PB, 400, 800, { mode: "pins", quiz: { kind: "name", marks: { fornix: true, sas: false } } });
ok("Name it colours self-marked pins", (svg.match(/atlas-dot big qok/g) || []).length === 2 && (svg.match(/atlas-dot big qbad/g) || []).length === 1);
ok("Find it shows no pins before the answer", !overlaySvg(SLICE, ATL, PB, 400, 800, { mode: "pins", quiz: { kind: "find" } }).includes("atlas-dot"));
svg = overlaySvg(SLICE, ATL, PB, 400, 800, { mode: "pins", quiz: { kind: "find", show: "fornix", ok: false, tap: { x: 80, y: 40 } } });
ok("Find it reveals the target's pins and marks the tap after answering",
   (svg.match(/class="atlas-dot/g) || []).length === 2 && svg.includes("atlas-tapmark qbad"));

// --- windows and default label mode ---
ok("windowUrl: the first window is the image itself", P.windowUrl("/atlas/m/007.webp", null) === "/atlas/m/007.webp");
ok("windowUrl: others live under w/<id>/ with the same NNN", P.windowUrl("/atlas/m/007.webp", "lung") === "/atlas/m/w/lung/007.webp");
ok("default mode: pins on a portrait phone", P.defaultLabelMode(390, 844) === "pins");
ok("default mode: labels on a tablet or desktop", P.defaultLabelMode(1024, 768) === "labels");
ok("default mode: pins on a short landscape phone", P.defaultLabelMode(844, 390) === "pins");

console.log(fail === 0 ? "ALL " + pass + " PASS" : pass + " pass / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
