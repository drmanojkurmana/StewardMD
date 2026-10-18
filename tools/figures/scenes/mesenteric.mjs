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
  level: { label: "Stage of bowel ischaemia", a: [0.3, 0.65, 1], names: ["early", "transmural", "infarcted"], ticks: ["early", "transmural", "infarcted"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "resuscitation and anticoagulation" },
    { label: "revascularisation" },
    { label: "bowel resection" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "resuscitation and anticoagulation", "revascularisation", "bowel resection"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level];
  const resus = drug >= 1 ? 1 : 0, anticoag = drug === 1 ? 1 : 0, revasc = drug === 2 ? 1 : 0, resect = drug === 3 ? 1 : 0;
  let occ = cl(a * 0.95);
  if (anticoag) occ *= 0.88;
  if (revasc) occ *= level === 2 ? 0.45 : 0.18;
  if (resect) occ *= 0.55;
  const F = cl(1 - occ + resus * 0.04);
  const M = cl(a * 1.05 - (revasc ? (level === 2 ? 0.15 : 0.55) : 0) - (resect ? 0.7 : 0) - anticoag * 0.08);
  const Wd = cl((a - 0.22) * 1.35 - (revasc ? (level === 2 ? 0.1 : 0.45) : 0) - (resect ? 0.75 : 0) - anticoag * 0.05);
  const Pf = cl((a - 0.68) * 2.4 - resect * 0.85 - (revasc && level < 2 ? 0.3 : 0));
  const Sep = cl(Pf * 0.9 + Wd * 0.35 - resus * 0.12 - resect * 0.25);
  const La = cl(0.06 + 0.72 * Wd + 0.28 * (1 - F) - resus * 0.16 - (revasc ? 0.12 : 0) - (resect ? 0.18 : 0));
  const Pain = cl(0.25 + 0.7 * M - resus * 0.08);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const bowel = resect ? "resected" : w(Wd, 0.22, 0.6, ["viable", "ischaemic", "infarcted"]);
  const words = [w(1 - F, 0.3, 0.7, ["good", "reduced", "poor"]), bowel, w(La, 0.25, 0.55, ["normal", "raised", "high"])];
  return { a, resus, anticoag, revasc, resect, occ, F, M, Wd, Pf, Sep, La, Pain, words, readout: "flow " + words[0] + " · bowel " + words[1] + " · lactate " + words[2] };
}
const TESTS = [
  [0, 0, "flow good · bowel viable · lactate normal"],
  [2, 0, "flow poor · bowel infarcted · lactate high"],
  [1, 2, "flow good · bowel viable · lactate normal"],
  [2, 3, "flow reduced · bowel resected · lactate normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">MESENTERIC CIRCULATION</text>
<text class="sc-zone sc-dim" x="604" y="68">BOWEL, CUT OPEN</text>
<rect class="mes-aorta" x="56" y="96" width="44" height="190" rx="18"/>
<path class="mes-vein" d="M100 196C220 204 340 214 470 238C540 250 590 258 628 264"/>
<path class="mes-art" d="M100 142C220 152 320 162 430 196C520 224 580 240 626 252"/>
<path class="mes-art-hi" d="M100 142C220 152 320 162 430 196C520 224 580 240 626 252"/>
<g id="flow"></g>
<g id="clot"></g>
<g id="stent"></g>
<rect class="mes-outer" x="400" y="260" width="500" height="150" rx="70"/>
<rect id="wallDark" class="mes-dark" x="400" y="260" width="500" height="150" rx="70" opacity="0"/>
<rect class="mes-muscle" x="412" y="272" width="476" height="126" rx="60"/>
<rect class="mes-sub" x="424" y="284" width="452" height="102" rx="50"/>
<rect id="mucosa" class="mes-mucosa" x="436" y="296" width="428" height="78" rx="38"/>
<rect id="mucDark" class="mes-mucdark" x="436" y="296" width="428" height="78" rx="38" opacity="0"/>
<rect class="mes-lumen" x="452" y="308" width="396" height="54" rx="26"/>
<g id="resectMark"></g>
<g id="parts"></g>
<g id="perf"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "acute-mesenteric-ischaemia", fig: "Fig 1", title: "Acute mesenteric ischaemia: bowel losing its blood supply", W, H, body,
  label: "An animated superior mesenteric artery supplying a loop of bowel cut open to show its wall layers. A clot or embolus blocks the artery, or flow falls, or the vein blocks. The inner mucosa is hurt first, then injury spreads through the full wall, then the bowel infarcts, may perforate and cause sepsis, and lactate rises. Pain is severe early while signs are few. Gauges show flow, mucosa, full wall, lactate, leak and sepsis. Treatment choices include resuscitation and anticoagulation, revascularisation and bowel resection.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "mesenteric.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How acute mesenteric ischaemia develops.</strong> The superior mesenteric artery may be blocked suddenly by an embolus, or by thrombosis on a narrowed artery, or flow may fall without a block (nonocclusive low flow), or the mesenteric vein may clot. The mucosa, the inner lining, is the most sensitive layer and is injured first; injury then spreads outward to become transmural. Typical teaching is severe pain out of proportion to the signs found on examination early on. With infarction the bowel may perforate, spilling bowel contents and causing sepsis, while lactate rises as tissue is starved of oxygen. This is standard teaching in surgery and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Resuscitation and anticoagulation to support circulation and stop clot spreading, revascularisation to restore flow to salvageable bowel, and resection to remove infarcted bowel. These are teaching toggles only.",
  ],
  simplified: "Collateral supply, chronic mesenteric ischaemia, imaging and endovascular versus open techniques, vasopressors and other adjuncts, second-look surgery, short bowel after large resections, and all doses and targets are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.mes-aorta{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--c-tis));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1}
.mes-art{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 62%,var(--c-tis));stroke-width:22;stroke-linecap:round}
.mes-art-hi{fill:none;stroke:color-mix(in srgb,var(--c-rbc) 30%,#fff);stroke-width:6;stroke-linecap:round;opacity:.5}
.mes-vein{fill:none;stroke:#7a7fd0;stroke-width:12;stroke-linecap:round;opacity:.85}
.mes-outer{fill:color-mix(in srgb,var(--c-endo) 38%,var(--c-tis));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}
.mes-muscle{fill:color-mix(in srgb,var(--c-rbc) 34%,var(--c-tis))}
.mes-sub{fill:color-mix(in srgb,var(--c-plt) 30%,var(--c-tis))}
.mes-mucosa{fill:#e88a7a}
.mes-lumen{fill:var(--anatomy-paper)}
.mes-dark{fill:#3a3238}
.mes-mucdark{fill:#5a3040}
.mes-clot{fill:#8e2432;stroke:#5e1420;stroke-width:1}
.mes-veinclot{fill:#4a4a8e;stroke:#2c2c5e;stroke-width:1}
.mes-stent{fill:none;stroke:var(--anatomy-strong);stroke-width:1.6;stroke-linejoin:round}
.mes-perf{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.8}
.mes-resect{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-dasharray:6 4}
.p-lac{--cc:#ffd24a}
.p-spill{--cc:#b0894a}
.cl-flow{--cc:var(--c-rbc)}
`,
});
