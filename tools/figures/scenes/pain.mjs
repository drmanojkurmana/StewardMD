/* Pain pathway and opioids as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/pain.mjs [--print-model]
 * Static layout here; signals, receptors and gauges move in pain.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Pain intensity", a: [0.35, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "NSAID (less prostaglandin sensitisation)" },
    { label: "opioid (spinal and brain receptors)" },
    { label: "local anaesthetic block (nerve conduction blocked)" },
  ],
  status: "Pain: {level} · {drug} ·",
  drugNames: ["no treatment", "an NSAID", "an opioid", "a local anaesthetic block"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const nsaid = drug === 1 ? 1 : 0, opi = drug === 2 ? 1 : 0, la = drug === 3 ? 1 : 0;
  const Sns = cl(a * (nsaid ? 0.3 : 1));
  const P = cl(a * (nsaid ? 0.45 : 1));
  const T = cl(P * (la ? 0.05 : 1));
  const Desc = cl(opi ? 0.9 : 0.25);
  const Horn = cl(T * (opi ? 0.38 : 1) * (1 - 0.18 * Desc));
  const Asc = Horn;
  const Pain = cl(Asc * (opi ? 0.62 : 1));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.3, 0.6, ["low", "moderate", "high"]), w(Horn, 0.3, 0.6, ["low", "moderate", "high"]), w(Pain, 0.25, 0.55, ["mild", "moderate", "severe"])];
  return { a, nsaid, opi, la, Sns, P, T, Desc, Horn, Asc, Pain, words, readout: "peripheral firing " + words[0] + " · dorsal horn relay " + words[1] + " · pain felt " + words[2] };
}
const TESTS = [
  [1, 0, "peripheral firing high · dorsal horn relay high · pain felt severe"],
  [1, 1, "peripheral firing low · dorsal horn relay low · pain felt moderate"],
  [1, 2, "peripheral firing high · dorsal horn relay low · pain felt mild"],
  [1, 3, "peripheral firing high · dorsal horn relay low · pain felt mild"],
];

/* ---------------- static layout ---------------- */
/* Skin, ganglion and brain are real organ art placed in pain.page.js; the cord
 * column stays schematic. Nerve, tract and descending paths are rewired there
 * from the organ ports so signals meet real anatomy. */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">PERIPHERY</text>
<text class="sc-zone" x="360" y="68">SPINAL CORD AND BRAIN</text>
<rect class="pn-cord" x="385" y="165" width="115" height="245" rx="28"/>
<ellipse class="pn-horn" cx="422" cy="305" rx="30" ry="42"/>
<circle class="pn-horncell" cx="425" cy="308" r="10"/>
<path id="nervePath" class="pn-nerve" d="M125 360L255 332L345 323L422 308"/>
<path id="tractPath" class="pn-tract" d="M472 300L472 210C472 170 540 150 600 165C640 175 665 195 690 220"/>
<path id="descPath" class="pn-desc" d="M790 260C740 290 660 300 600 305C540 310 480 310 445 308"/>
<g id="skinSlot"></g>
<g id="gangSlot"></g>
<g id="brainSlot"></g>
<g id="skinTerm"></g>
<g id="parts"></g>
<g id="dyn"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.pn-bolt{fill:none;stroke:#ff9a3d;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.pn-iglow{fill:#ff9a3d;stroke:none}
.pn-nerve{fill:none;stroke:var(--c-neut);stroke-width:3;stroke-linecap:round}
.pn-cord{fill:color-mix(in srgb,var(--c-lymph) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.pn-horn{fill:color-mix(in srgb,var(--c-cyt) 24%,transparent);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:1}
.pn-horncell{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:1}
.pn-tract{fill:none;stroke:var(--c-cyt2);stroke-width:3;stroke-linecap:round}
.pn-desc{fill:none;stroke:var(--c-good);stroke-width:2.6;stroke-linecap:round;stroke-dasharray:6 4}
.pn-glow{fill:var(--c-bad);stroke:none}
.pn-hornglow{fill:var(--c-cyt2);stroke:none}
.pn-recp{fill:none;stroke:#ffd24a;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pn-recglow{fill:#ffd24a;stroke:none}
.pn-op{fill:#7fe6a8;stroke:color-mix(in srgb,#7fe6a8 55%,#000);stroke-width:.8}
.pn-cuff{fill:color-mix(in srgb,var(--anatomy-paper) 82%,var(--c-bad));stroke:var(--c-bad);stroke-width:2.4}
.pn-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.pn-xp{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pn-cap{fill:var(--anatomy-strong);font-size:13px}
.p-pg{--cc:#ff9a3d}.p-ap{--cc:#ffd24a}.p-desc{--cc:var(--c-good)}
.dr-g-fill.g-pg{fill:#ff9a3d}.dr-g-fill.g-ap{fill:#ffd24a}.dr-g-fill.g-horn{fill:var(--c-cyt)}.dr-g-fill.g-asc{fill:var(--c-cyt2)}.dr-g-fill.g-desc{fill:var(--c-good)}.dr-g-fill.g-pain{fill:var(--c-bad)}
.pn-term{stroke:var(--c-neut);stroke-width:1.8;stroke-linecap:round;fill:none}
`;

buildScene({
  id: "opioid-pain-pathway", fig: "Fig 1", title: "Pain pathway and opioids", W, H, body, extraCss,
  label: "An animated pain pathway. A nociceptor in injured skin fires along a peripheral nerve through the dorsal root ganglion into the dorsal horn of the spinal cord. A second neuron crosses and rises in the spinothalamic tract to the thalamus and then to the somatosensory cortex, where pain is felt. A descending pathway from the brainstem back to the dorsal horn can damp the relay. Opioid receptors are marked in the dorsal horn, thalamus and brainstem. Gauges show sensitisation, nociceptor firing, dorsal horn relay, ascending signal, descending inhibition and pain felt. Treatment choices are an NSAID, an opioid and a local anaesthetic block.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pain.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With nerve block",
  sourcesLis: [
    "<strong>How pain reaches the brain.</strong> Tissue injury releases prostaglandins and other mediators that sensitise nociceptors, the free nerve endings that detect harmful stimuli. Their fibres enter the spinal cord through the dorsal root and synapse in the dorsal horn (notably the substantia gelatinosa). Second order neurons cross to the opposite side and ascend in the spinothalamic tract to the thalamus, which relays to the somatosensory cortex where pain is localised and felt. A descending pathway from the periaqueductal grey and rostral ventromedial medulla returns to the dorsal horn and can inhibit the relay, a form of gate control. This is standard teaching in neuroanatomy, physiology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Where the treatments act.</strong> NSAIDs block cyclo-oxygenase, so fewer prostaglandins are made and nociceptors are less sensitised at the injury site. Opioids act mainly at mu opioid receptors: in the dorsal horn they reduce transmitter release from the incoming fibre and damp the second order neuron, and in the brainstem and higher centres they strengthen descending inhibition and reduce the felt intensity of pain. Local anaesthetics block voltage gated sodium channels in the peripheral nerve, so action potentials cannot pass the blocked segment and the signal never reaches the cord. These are teaching toggles only.",
  ],
  simplified: "Fast and slow pain fibres, wide dynamic range neurons, peripheral and central sensitisation over time, neuropathic pain, emotion and attention circuits, other opioid receptor types and side effects, adjuvant drugs, and all doses and routes are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
