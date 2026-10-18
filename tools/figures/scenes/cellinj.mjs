/* Cell injury and necrosis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cellinj.mjs [--print-model]
 * Static layout here; the hypoxic cell, pumps, particles and gauges move in cellinj.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage of injury", a: [0.3, 0.65, 1], names: ["reversible injury", "point of no return", "necrosis"], ticks: ["reversible", "no return", "necrosis"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "restore oxygen" },
    { label: "antioxidant" },
  ],
  status: "Injury: {level} · {drug} ·",
  drugNames: ["no treatment", "oxygen restored", "an antioxidant"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = S.level.a[level], oxy = drug === 1 ? 1 : 0, antiox = drug === 2 ? 1 : 0;
  const rescue = oxy * (level === 0 ? 0.5 : level === 1 ? 0.28 : 0.04);
  const ATP = cl(1 - 0.85 * a + rescue);
  const O2 = cl(1 - 0.75 * a + oxy * (level === 2 ? 0.08 : 0.45));
  const ROS = cl(0.1 + 0.7 * a - 0.48 * antiox - 0.06 * oxy);
  const Pump = cl(ATP * 1.05 - 0.04);
  const Swell = cl(0.08 + 0.85 * (1 - Pump) - 0.12 * oxy * (level === 0 ? 1 : 0.4));
  const Memb = cl((a - 0.35) * 1.25 + ROS * 0.32 - 0.14 * antiox - 0.06 * oxy * (level === 0 ? 1 : 0));
  const Leak = cl(Memb * 0.95 - 0.04);
  const Viab = cl(1 - Memb * 0.88 - (1 - ATP) * 0.18);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(ATP, 0.35, 0.65, ["depleted", "low", "preserved"]), w(Swell, 0.25, 0.55, ["normal volume", "swollen", "markedly swollen"]), w(Memb, 0.25, 0.6, ["intact", "injured", "ruptured"])];
  return { a, oxy, antiox, ATP, O2, ROS, Pump, Swell, Memb, Leak, Viab, words, readout: "ATP " + words[0] + " · cell " + words[1] + " · membrane " + words[2] };
}
const TESTS = [
  [0, 0, "ATP preserved · cell swollen · membrane intact"],
  [2, 0, "ATP depleted · cell markedly swollen · membrane ruptured"],
  [0, 1, "ATP preserved · cell normal volume · membrane intact"],
  [1, 2, "ATP low · cell markedly swollen · membrane injured"],
];

/* ---------------- static layout ---------------- */
const necBox = (id, x, y, name, inner) => `<g id="${id}" opacity="0.38"><rect class="ci-nbox" x="${x}" y="${y}" width="130" height="78" rx="10"/>${inner}<text class="sc-lab ci-nlab" x="${x + 65}" y="${y + 68}" text-anchor="middle">${name}</text></g>`;
const nec = [
  necBox("nb0", 660, 96, "Coagulative", `<ellipse class="ci-ghost" cx="695" cy="122" rx="16" ry="10"/><ellipse class="ci-ghost" cx="725" cy="122" rx="16" ry="10"/><ellipse class="ci-ghost" cx="710" cy="138" rx="16" ry="10"/>`),
  necBox("nb1", 806, 96, "Liquefactive", `<ellipse class="ci-liq" cx="848" cy="122" rx="22" ry="11"/><ellipse class="ci-liq" cx="868" cy="136" rx="16" ry="8"/><ellipse class="ci-liq" cx="832" cy="138" rx="13" ry="7"/>`),
  necBox("nb2", 660, 188, "Caseous", `<circle class="ci-dot" cx="688" cy="112" r="3"/><circle class="ci-dot" cx="706" cy="106" r="2.4"/><circle class="ci-dot" cx="722" cy="116" r="3"/><circle class="ci-dot" cx="698" cy="126" r="2.4"/><circle class="ci-dot" cx="716" cy="132" r="2.6"/><circle class="ci-dot" cx="734" cy="126" r="2.2"/>`.replace(/cy="1/g, 'cy="2')),
  necBox("nb3", 806, 188, "Fat", `<circle class="ci-vac" cx="842" cy="218" r="9"/><circle class="ci-vac" cx="866" cy="226" r="7"/><circle class="ci-vac" cx="850" cy="236" r="6"/><path class="ci-chalk" d="M830 214l28 10M836 240l30 -8"/>`),
].join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="620" height="396" rx="18"/>
<rect class="sc-tissue" x="644" y="44" width="302" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">HYPOXIC CELL</text>
<text class="sc-zone" x="664" y="68">NECROSIS PATTERNS</text>
<rect id="lumen" class="sc-lumen" x="34" y="84" width="560" height="34" rx="9"/>
${nec}
<text class="sc-lab" x="664" y="296">Which pattern appears depends</text>
<text class="sc-lab" x="664" y="312">on the tissue and the cause.</text>
<text class="sc-lab" x="664" y="340">Brain tends to liquefy after</text>
<text class="sc-lab" x="664" y="356">injury. Fat necrosis follows</text>
<text class="sc-lab" x="664" y="372">enzyme release in fatty tissue.</text>
<text class="sc-lab" x="664" y="400">Caseous change is classic in</text>
<text class="sc-lab" x="664" y="416">tuberculous granulomas.</text>
<g id="vessel"></g><g id="cellg"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cell-injury-necrosis", fig: "Fig 1", title: "Cell injury: hypoxia to necrosis", W, H, body,
  label: "An animated cell starved of oxygen. Oxygen delivery falls, ATP drops, ion pumps fail, water enters and the cell swells. Free radicals injure the membrane, enzymes leak out, and the cell passes a point of no return into necrosis. Four necrosis patterns are shown at the side. Gauges show ATP, swelling, membrane damage, enzyme leak, free radicals and viability. Treatment choices are restoring oxygen and an antioxidant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cellinj.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How cell injury develops.</strong> Loss of oxygen stops oxidative phosphorylation and ATP falls. The sodium-potassium pump and calcium pumps fail, sodium and water enter, and the cell and its organelles swell. Anaerobic glycolysis lowers pH. If oxygen returns at this stage the changes can reverse. With continued injury, membrane damage, calcium entry and free radical injury (lipid peroxidation, protein and DNA damage) make injury irreversible: membranes rupture, enzymes leak out and the cell dies by necrosis. Necrosis patterns include coagulative (architecture kept, most solid tissues), liquefactive (digested to liquid, brain and abscesses), caseous (cheese-like, tuberculous granulomas) and fat necrosis (enzyme action on fat, chalky deposits). This is standard teaching in pathology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Restoring oxygen early can rescue a reversibly injured cell but cannot revive necrotic tissue. An antioxidant limits free radical membrane injury but does not by itself restore ATP while hypoxia continues. These are teaching toggles only.",
  ],
  simplified: "Apoptosis and its pathways, reperfusion injury in detail, calcium signalling, lysosomal rupture, inflammation after necrosis, specific free radical species and scavengers, autophagy, and all drug names, doses and timing are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.cl-cellx{--cc:#8fc1a9}.cl-mito{--cc:#e8a34a}
.ci-mito-b{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.8;opacity:.9}
.ci-mito-f{fill:none;stroke:color-mix(in srgb,var(--c-neut) 45%,#000);stroke-width:.8;opacity:.7}
.ci-pump{fill:var(--anatomy-card);stroke:var(--anatomy-strong);stroke-width:1.1}
.ci-pump-d{fill:var(--c-good)}
.ci-nec{fill:#4a4048}
.ci-break{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.ci-nbox{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.ci-nlab{font-size:10px}
.ci-ghost{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.ci-liq{fill:color-mix(in srgb,var(--c-fl) 55%,var(--anatomy-paper));stroke:var(--c-fl);stroke-width:.8}
.ci-dot{fill:#e8e0c8;stroke:#b8ac84;stroke-width:.5}
.ci-vac{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.8}
.ci-chalk{stroke:#f2ead2;stroke-width:2.4;stroke-linecap:round}
.p-oxy{--cc:var(--c-fl)}.p-water{fill:var(--c-fl)}.p-enz{--cc:#ffd24a}.p-ros{--cc:#ff7a45}
.dr-g-fill.g-leak{fill:#ffd24a}.dr-g-fill.g-ros{fill:#ff7a45}
`,
});
