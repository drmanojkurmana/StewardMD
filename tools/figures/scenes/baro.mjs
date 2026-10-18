/* Baroreceptor blood pressure regulation as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/baro.mjs [--print-model]
 * Stretch sensors in the carotid sinus and aortic arch send afferent signals along the glossopharyngeal and vagus
 * nerves to the medullary vasomotor centre. Sympathetic and parasympathetic efferents then adjust heart rate,
 * heart force and arteriole tone, pulling pressure back toward its set point. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "What has happened", a: [0, 0.35, 0.75], names: ["normal", "standing up", "haemorrhage"], ticks: ["normal", "standing up", "haemorrhage"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "vasoconstrictor (vessels tightened)" },
    { label: "fluids (volume replaced)" },
  ],
  status: "Blood pressure regulation: {level} · {drug} ·",
  drugNames: ["no treatment", "a vasoconstrictor", "fluids"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const vaso = drug === 1 ? 1 : 0, flu = drug === 2 ? 1 : 0;
  const baseVol = [0.92, 0.7, 0.42][level];
  const vol = cl(baseVol + flu * 0.36);
  const press0 = cl(0.18 + 0.78 * vol);
  const err = 0.88 - press0;
  const sym = cl(0.42 + 1.25 * err);
  const vag = cl(0.58 - 1.25 * err);
  const hr = cl(0.38 + 0.48 * sym - 0.28 * vag + 0.18 * vol);
  const tone = cl(0.3 + 0.52 * sym + vaso * 0.3);
  const bp = cl(press0 + 0.2 * (sym - 0.42) + 0.14 * (tone - 0.52) + 0.08 * (hr - 0.58));
  const fir = cl(0.12 + 0.88 * bp);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(bp, 0.68, 0.84, ["low", "near normal", "normal"]), w(fir, 0.72, 0.85, ["low", "reduced", "brisk"]), w(sym, 0.5, 0.75, ["quiet", "raised", "high"]), w(hr, 0.6, 0.78, ["calm", "raised", "fast"])];
  return { vaso, flu, vol, press0, sym, vag, hr, tone, bp, fir, stand: level === 1 ? 1 : 0, haem: level === 2 ? 1 : 0, words, readout: "pressure " + words[0] + " · sensor firing " + words[1] + " · sympathetic " + words[2] + " · heart rate " + words[3] };
}
const TESTS = [
  [0, 0, "pressure normal · sensor firing brisk · sympathetic quiet · heart rate calm"],
  [1, 0, "pressure near normal · sensor firing reduced · sympathetic raised · heart rate raised"],
  [2, 0, "pressure low · sensor firing low · sympathetic high · heart rate fast"],
  [2, 2, "pressure near normal · sensor firing reduced · sympathetic raised · heart rate raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">SENSORS</text>
<text class="sc-zone" x="370" y="68">CONTROL CENTRE</text>
<text class="sc-zone" x="705" y="68">RESPONSE</text>
<text class="sc-zone sc-dim" x="34" y="312">ARTERIAL SYSTEM</text>
<g id="vessels">
<path class="baro-vessel-line" d="M165 330L165 138"/>
<rect id="baroLumen" class="sc-lumen" x="40" y="330" width="880" height="50" rx="25"/>
<g id="rbcs"></g>
</g>
<g id="links"></g>
<g id="nodes">
<g>
<rect class="baro-node" x="70" y="82" width="190" height="56" rx="14"/>
<g id="sensCar"><circle class="baro-sens" cx="100" cy="110" r="16"/><circle class="baro-sens-in" cx="100" cy="110" r="6"/></g>
<text class="baro-node-t" x="188" y="106" text-anchor="middle">Carotid sinus</text>
<text class="baro-node-s" x="188" y="124" text-anchor="middle">stretch sensors</text>
</g>
<g>
<rect class="baro-node" x="70" y="172" width="190" height="56" rx="14"/>
<g id="sensAor"><circle class="baro-sens" cx="100" cy="200" r="16"/><circle class="baro-sens-in" cx="100" cy="200" r="6"/></g>
<text class="baro-node-t" x="188" y="196" text-anchor="middle">Aortic arch</text>
<text class="baro-node-s" x="188" y="214" text-anchor="middle">stretch sensors</text>
</g>
<g>
<rect class="baro-node" x="370" y="120" width="220" height="70" rx="14"/>
<g id="medIcon"><circle class="baro-med" cx="408" cy="155" r="17"/><circle class="baro-med-in" cx="408" cy="155" r="7"/></g>
<text class="baro-node-t" x="505" y="150" text-anchor="middle">Medulla</text>
<text class="baro-node-s" x="505" y="168" text-anchor="middle">vasomotor centre</text>
</g>
<g>
<rect class="baro-node" x="705" y="77" width="180" height="56" rx="14"/>
<g id="heartIcon"><path class="baro-heart" d="M735 122C724 110 718 103 718 95C718 87 724 82 731 82C734 82 735 84 735 84C735 84 736 82 739 82C746 82 752 87 752 95C752 103 746 110 735 122Z"/></g>
<text class="baro-node-t" x="822" y="101" text-anchor="middle">Heart</text>
<text class="baro-node-s" x="822" y="119" text-anchor="middle">rate and force</text>
</g>
<g>
<rect class="baro-node" x="705" y="177" width="180" height="56" rx="14"/>
<circle class="baro-art-w" cx="735" cy="205" r="18"/><circle id="artLumen" class="baro-art-l" cx="735" cy="205" r="9"/>
<text class="baro-node-t" x="822" y="201" text-anchor="middle">Blood vessels</text>
<text class="baro-node-s" x="822" y="219" text-anchor="middle">arteriole tone</text>
</g>
</g>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "baroreceptor-bp-regulation", fig: "Fig 1", title: "Baroreceptors: keeping blood pressure steady", W, H, body,
  label: "An animated loop for blood pressure control. Stretch sensors in the carotid sinus and aortic arch fire along the glossopharyngeal and vagus nerves to the vasomotor centre in the medulla. When pressure falls, sensor firing falls, sympathetic outflow rises, vagus outflow falls, the heart beats faster and stronger, and arterioles tighten, pulling pressure back up. Standing up pools blood in the legs and haemorrhage loses volume, so both trigger this response. Gauges show pressure, sensor firing, sympathetic and vagus outflow, heart rate and vessel tone. Treatment choices tighten vessels or replace fluid volume.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "baro.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How the baroreceptor reflex works.</strong> Stretch receptors in the carotid sinus and aortic arch sense arterial pressure. Afferent signals travel in the glossopharyngeal nerve from the carotid sinus and in the vagus nerve from the aortic arch to the medulla, where the vasomotor centre sets sympathetic and parasympathetic outflow. A fall in pressure reduces sensor firing, so sympathetic outflow to the heart and arterioles rises and vagus outflow to the heart falls. Heart rate and force rise and vessels tighten, restoring pressure. A rise in pressure does the opposite. This negative feedback is standard teaching in physiology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Standing, haemorrhage and treatment ideas shown.</strong> Standing up lets blood pool in the leg veins, so less blood returns to the heart and pressure tends to fall until the reflex compensates. Haemorrhage loses circulating volume, giving a larger and more sustained fall. A vasoconstrictor tightens arterioles and fluids replace volume. These are teaching toggles only.",
  ],
  simplified: "Slower control by the kidney, hormones such as the renin-angiotensin system and antidiuretic hormone, chemoreceptor input, individual variation, fainting when compensation fails, and all doses and targets are left out. The response is shown at one settled moment rather than second by second, and counts and speeds are illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
.baro-node{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.baro-node-t{fill:var(--anatomy-strong);font:600 11px var(--anatomy-mono);pointer-events:none}
.baro-node-s{fill:var(--anatomy-text);font:10px var(--anatomy-mono);pointer-events:none;opacity:.85}
.baro-vessel-line{fill:none;stroke:var(--c-rbc);stroke-width:14;stroke-linecap:round;opacity:.45}
.baro-sens{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 65%,#000);stroke-width:1.2}
.baro-sens-in{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.8}
.baro-med{fill:color-mix(in srgb,var(--c-mac) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-mac) 60%,#000);stroke-width:1.2}
.baro-med-in{fill:color-mix(in srgb,var(--c-mac) 45%,#1a1030);opacity:.85}
.baro-heart{fill:color-mix(in srgb,var(--c-rbc) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 65%,#000);stroke-width:1.2}
.baro-art-w{fill:color-mix(in srgb,var(--c-sm) 58%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-sm) 65%,#000);stroke-width:1.2}
.baro-art-l{fill:color-mix(in srgb,var(--c-rbc) 22%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:.8}
.baro-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.baro-head{fill:var(--anatomy-mid)}
.baro-dot{fill:var(--c-neut)}.baro-dot.sym{fill:var(--c-cyt)}.baro-dot.vag{fill:var(--c-lymph)}
.baro-pool{fill:none;stroke:var(--c-lymph);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.baro-chev{fill:none;stroke:var(--c-cyt);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.p-baro-fl{fill:var(--c-fl)}.p-baro-bl{fill:var(--c-rbc)}
.dr-g-fill.g-sym{fill:var(--c-cyt)}.dr-g-fill.g-vag{fill:var(--c-lymph)}.dr-g-fill.g-hr{fill:var(--c-rbc)}.dr-g-fill.g-tone{fill:var(--c-sm)}.dr-g-fill.g-fir{fill:var(--c-neut)}
`,
});
