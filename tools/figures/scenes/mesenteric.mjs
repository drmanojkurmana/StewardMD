/* Acute mesenteric ischaemia as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/mesenteric.mjs [--print-model]
 * Static layout here; flow, injury and gauges move in mesenteric.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of bowel ischaemia", a: [0.3, 0.65, 1], names: ["early", "transmural", "infarcted"], ticks: ["early", "transmural", "infarcted"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "revascularisation" },
    { label: "resuscitation and anticoagulation" },
    { label: "bowel resection" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "revascularisation", "resuscitation and anticoagulation", "bowel resection"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const revasc = drug === 1 ? 1 : 0, resus = drug === 2 ? 1 : 0, resect = drug === 3 ? 1 : 0;
  const anticoag = resus;
  let occ = cl(a * 0.95 + 0.03);
  if (anticoag) occ *= 0.72;
  if (revasc) occ *= level === 2 ? 0.45 : 0.15;
  if (resect) occ *= 0.8;
  const F = cl(1 - occ + resus * 0.04 + resect * 0.04);
  const M = cl(a * 1.05 - (revasc ? (level === 2 ? 0.15 : 0.55) : 0) - (resect ? 0.7 : 0) - anticoag * 0.08);
  const Wd = cl((a - 0.22) * 1.35 - (revasc ? (level === 2 ? 0.1 : 0.45) : 0) - (resect ? 0.75 : 0) - anticoag * 0.05);
  const Pf = cl((a - 0.68) * 2.4 - resect * 0.85 - (revasc && level < 2 ? 0.3 : 0));
  const Sep = cl(Pf * 0.9 + Wd * 0.35 - resus * 0.12 - resect * 0.25);
  const La = cl(0.06 + 0.72 * Wd + 0.28 * (1 - F) - resus * 0.16 - revasc * 0.12 - resect * 0.5);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const bowel = resect ? "resected" : w(Wd, 0.22, 0.6, ["viable", "ischaemic", "infarcted"]);
  const words = [w(1 - F, 0.3, 0.7, ["good", "reduced", "poor"]), bowel, w(La, 0.25, 0.55, ["normal", "raised", "high"])];
  return { a, revasc, resus, anticoag, resect, occ, F, M, Wd, Pf, Sep, La, words, readout: "flow " + words[0] + " · bowel " + words[1] + " · lactate " + words[2] };
}
const TESTS = [
  [0, 0, "flow reduced · bowel viable · lactate normal"],
  [2, 0, "flow poor · bowel infarcted · lactate high"],
  [1, 1, "flow good · bowel viable · lactate normal"],
  [2, 3, "flow poor · bowel resected · lactate normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">MESENTERIC CIRCULATION</text>
<g id="bowelSlot"></g>
<ellipse id="tint" class="mes-tint" cx="665" cy="180" rx="122" ry="122" opacity="0"/>
<rect class="mes-aorta" x="56" y="96" width="44" height="190" rx="18"/>
<path id="vein" class="mes-vein" d="M790 220C835 245 855 300 860 360L860 420"/>
<path id="artery" class="mes-art" d="M100 148C300 148 480 146 560 144C610 143 650 146 685 150"/>
<path id="branch" class="mes-branch" d="M598 144C604 165 608 185 610 205"/>
<g id="flow"></g>
<g id="clot"></g>
<g id="stent"></g>
<rect class="mes-outer" x="400" y="305" width="380" height="110" rx="40"/>
<rect id="wallDark" class="mes-dark" x="400" y="305" width="380" height="110" rx="40" opacity="0"/>
<rect class="mes-muscle" x="410" y="315" width="360" height="90" rx="34"/>
<rect class="mes-sub" x="420" y="325" width="340" height="70" rx="28"/>
<rect id="mucosa" class="mes-mucosa" x="430" y="335" width="320" height="50" rx="22"/>
<rect id="mucDark" class="mes-mucdark" x="430" y="335" width="320" height="50" rx="22" opacity="0"/>
<rect class="mes-lumen" x="444" y="345" width="292" height="30" rx="15"/>
<g id="resectMark"></g>
<g id="perf"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "acute-mesenteric-ischaemia", fig: "Fig 1", title: "Acute mesenteric ischaemia: bowel losing its blood supply", W, H, body,
  label: "An animated superior mesenteric artery supplying real small bowel, with a magnified slice of the bowel wall below it. A clot blocks the artery and flow to the bowel falls. The inner mucosa is hurt first, then injury spreads through the full wall, then the bowel infarcts, may leak and cause sepsis, and lactate rises. Pain is severe early while signs are few. Revascularisation holds the artery open with a stent, resuscitation and anticoagulation coat the clot so it stops spreading, and resection cuts out dead bowel. Gauges show flow, mucosa, full wall, lactate, leak and sepsis.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "mesenteric.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With revascularisation",
  sourcesLis: [
    "<strong>How acute mesenteric ischaemia develops.</strong> The superior mesenteric artery may be blocked suddenly by an embolus, or by thrombosis on a narrowed artery, or flow may fall without a block (nonocclusive low flow), or the mesenteric vein may clot. The mucosa, the inner lining, is the most sensitive layer and is injured first; injury then spreads outward to become transmural. Typical teaching is severe pain out of proportion to the signs found on examination early on. With infarction the bowel may leak, spilling bowel contents and causing sepsis, while lactate rises as tissue is starved of oxygen. This is standard teaching in surgery and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Revascularisation to restore flow to salvageable bowel, resuscitation and anticoagulation to support circulation and stop clot spreading, and resection to remove infarcted bowel. These are teaching toggles only.",
  ],
  simplified: "Collateral supply, chronic mesenteric ischaemia, imaging and endovascular versus open techniques, vasopressors and other adjuncts, second-look surgery, short bowel after large resections, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.mes-aorta{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.mes-art{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 62%,var(--c-tis));stroke-width:22;stroke-linecap:round}
.mes-branch{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 62%,var(--c-tis));stroke-width:8;stroke-linecap:round}
.mes-vein{fill:none;stroke:#7a7fd0;stroke-width:12;stroke-linecap:round;opacity:.85}
.mes-tint{fill:#4a2c38;stroke:none}
.mes-outer{fill:color-mix(in srgb,var(--c-endo) 38%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}
.mes-muscle{fill:color-mix(in srgb,var(--c-rbc) 34%,var(--c-tis))}
.mes-sub{fill:color-mix(in srgb,var(--c-plt) 30%,var(--c-tis))}
.mes-mucosa{fill:#e88a7a}
.mes-lumen{fill:var(--anatomy-paper)}
.mes-dark{fill:#3a3238}
.mes-mucdark{fill:#5a3040}
.mes-clot{fill:#8e2432;stroke:#5e1420;stroke-width:1}
.mes-stent{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linejoin:round}
.mes-resect{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-dasharray:6 4}
.mes-staple{fill:none;stroke:var(--anatomy-strong);stroke-width:3;stroke-linecap:round}
.mes-perf{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.8}
.mes-cap{fill:var(--anatomy-strong);font-size:12px}
.p-lac{--cc:#ffd24a}
.p-spill{--cc:#b0894a}
.p-drip{--cc:#6fc3ff}
.cl-flow{--cc:var(--c-rbc)}
`,
});
