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
  const tone = cl(0.3 + 0.52 * sym + vaso * 0.38);
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
<rect id="sensArt" class="baro-artery" x="132" y="100" width="16" height="238" rx="8"/>
<g id="cuffCar"><circle class="baro-cuff" cx="140" cy="110" r="13"/><circle class="baro-cuff-in" cx="140" cy="110" r="5.5"/></g>
<g id="cuffAor"><circle class="baro-cuff" cx="140" cy="200" r="13"/><circle class="baro-cuff-in" cx="140" cy="200" r="5.5"/></g>
<rect id="baroLumen" class="sc-lumen" x="40" y="330" width="880" height="50" rx="25"/>
<g id="rbcs"></g>
<path id="toneTop" class="baro-tone" d="M40 331L920 331" opacity="0"/>
<path id="toneBot" class="baro-tone" d="M40 381L920 381" opacity="0"/>
<g id="clamps" opacity="0"></g>
<g id="dockTube" opacity="0"></g>
<g id="brainSlot"></g>
<circle id="vasoDot" class="baro-vdot" cx="497" cy="204" r="7"/>
<g id="heartSlot"></g>
<g id="vessG"><rect id="vessWall" class="baro-wall" x="715" y="247" width="160" height="36" rx="18"/><rect id="vessLumen" class="baro-lumen-in" x="723" y="260" width="144" height="10" rx="5"/></g>
<g id="dockVess" opacity="0"></g>
<g id="links"></g>
<g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "baroreceptor-bp-regulation", fig: "Fig 1", title: "Baroreceptors: keeping blood pressure steady", W, H, body,
  label: "An animated loop for blood pressure control. Stretch sensors in the carotid sinus and aortic arch fire along the glossopharyngeal and vagus nerves to the vasomotor centre in the medulla. When pressure falls, sensor firing falls, sympathetic outflow rises, vagus outflow falls, the heart beats faster and stronger, and arterioles tighten, pulling pressure back up. Standing up pools blood in the legs and haemorrhage loses volume, so both trigger this response. Gauges show pressure, sensor firing, sympathetic and vagus outflow, heart rate and vessel tone. A vasoconstrictor visibly tightens the vessels and fluids visibly refill them.",
  caption: "Schematic, not to scale. Speeds, sizes and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "baro.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With fluids",
  sourcesLis: [
    "<strong>How the baroreceptor reflex works.</strong> Stretch receptors in the carotid sinus and aortic arch sense arterial pressure. Afferent signals travel in the glossopharyngeal nerve from the carotid sinus and in the vagus nerve from the aortic arch to the medulla, where the vasomotor centre sets sympathetic and parasympathetic outflow. A fall in pressure reduces sensor firing, so sympathetic outflow to the heart and arterioles rises and vagus outflow to the heart falls. Heart rate and force rise and vessels tighten, restoring pressure. A rise in pressure does the opposite. This negative feedback is standard teaching in physiology and medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Standing, haemorrhage and treatment ideas shown.</strong> Standing up lets blood pool in the leg veins, so less blood returns to the heart and pressure tends to fall until the reflex compensates. Haemorrhage loses circulating volume, giving a larger and more sustained fall. A vasoconstrictor tightens arterioles and fluids replace volume. These are teaching toggles only.",
  ],
  simplified: "Slower control by the kidney, hormones such as the renin-angiotensin system and antidiuretic hormone, chemoreceptor input, individual variation, fainting when compensation fails, and all doses and targets are left out. The response is shown at one settled moment rather than second by second, and counts and speeds are illustrative. The figure does not say how any patient should be treated.",
  extraCss: `
.baro-artery{fill:color-mix(in srgb,var(--c-rbc) 45%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.2}
.baro-cuff{fill:none;stroke:var(--c-neut);stroke-width:3}
.baro-cuff-in{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.8}
.baro-vdot{fill:var(--c-mac);stroke:color-mix(in srgb,var(--c-mac) 55%,#000);stroke-width:1}
.baro-wall{fill:color-mix(in srgb,var(--c-sm) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-sm) 65%,#000);stroke-width:1.2}
.baro-lumen-in{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 45%,#000);stroke-width:.8}
.baro-clamp{fill:color-mix(in srgb,var(--c-sm) 60%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-sm) 65%,#000);stroke-width:1.2}
.baro-drug{fill:var(--c-fl);stroke:color-mix(in srgb,var(--c-fl) 55%,#000);stroke-width:.8}
.baro-tone{fill:none;stroke:var(--c-sm);stroke-width:2.5;stroke-linecap:round}
.baro-arrow{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.baro-head{fill:var(--anatomy-mid)}
.baro-dot{fill:var(--c-neut)}.baro-dot.sym{fill:var(--c-cyt)}.baro-dot.vag{fill:var(--c-lymph)}
.baro-pool{fill:none;stroke:var(--c-lymph);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.baro-cap{fill:var(--anatomy-strong);font:12px var(--anatomy-mono)}
.p-baro-fl{fill:var(--c-fl)}.p-baro-bl{fill:var(--c-rbc)}
.dr-g-fill.g-sym{fill:var(--c-cyt)}.dr-g-fill.g-vag{fill:var(--c-lymph)}.dr-g-fill.g-hr{fill:var(--c-rbc)}.dr-g-fill.g-tone{fill:var(--c-sm)}.dr-g-fill.g-fir{fill:var(--c-neut)}
`,
});
