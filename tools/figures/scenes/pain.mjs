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
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">PERIPHERY</text>
<text class="sc-zone" x="360" y="68">SPINAL CORD AND BRAIN</text>
<rect class="pn-skin" x="30" y="330" width="200" height="78" rx="10"/>
<path class="pn-skinline" d="M30 348H230M30 372H230"/>
<path class="pn-bolt" d="M62 302L50 322L60 322L48 344"/>
<g id="skinTerm"></g>
<path class="pn-nerve" d="M110 350C180 342 240 333 320 323C360 318 390 314 425 308"/>
<ellipse class="pn-drg" cx="255" cy="332" rx="20" ry="12"/>
<rect class="pn-cord" x="385" y="165" width="115" height="245" rx="28"/>
<ellipse class="pn-horn" cx="422" cy="305" rx="30" ry="42"/>
<circle class="pn-horncell" cx="425" cy="308" r="10"/>
<path class="pn-tract" d="M462 300L462 185C462 152 545 136 633 135"/>
<ellipse class="pn-thal" cx="685" cy="135" rx="52" ry="34"/>
<ellipse class="pn-cortex" cx="840" cy="118" rx="82" ry="52"/>
<path class="pn-strip" d="M782 92C812 74 868 74 898 96"/>
<path class="pn-descorigin" d="M742 158C700 182 642 196 620 205"/>
<circle class="pn-pag" cx="605" cy="212" r="15"/>
<circle class="pn-rvm" cx="548" cy="272" r="12"/>
<path class="pn-desc" d="M596 224C582 244 566 258 556 268C524 294 486 303 452 307"/>
<g id="parts"></g>
<g id="dyn"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.pn-skin{fill:color-mix(in srgb,var(--c-endo) 26%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1}
.pn-skinline{stroke:color-mix(in srgb,var(--c-endo) 60%,#000);stroke-width:.7;opacity:.6}
.pn-bolt{fill:none;stroke:#ff9a3d;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.pn-nerve{fill:none;stroke:var(--c-neut);stroke-width:3;stroke-linecap:round}
.pn-drg{fill:color-mix(in srgb,var(--c-neut) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-neut) 60%,#000);stroke-width:1}
.pn-cord{fill:color-mix(in srgb,var(--c-lymph) 16%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.pn-horn{fill:color-mix(in srgb,var(--c-cyt) 24%,transparent);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:1}
.pn-horncell{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:1}
.pn-tract{fill:none;stroke:var(--c-cyt2);stroke-width:3;stroke-linecap:round}
.pn-thal{fill:color-mix(in srgb,var(--c-cyt2) 22%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-cyt2) 60%,#000);stroke-width:1.2}
.pn-cortex{fill:color-mix(in srgb,var(--c-mast) 20%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-mast) 55%,#000);stroke-width:1.2}
.pn-strip{fill:none;stroke:var(--c-bad);stroke-width:5;stroke-linecap:round;opacity:.55}
.pn-descorigin{fill:none;stroke:var(--c-good);stroke-width:1.4;stroke-dasharray:4 4;opacity:.6}
.pn-pag{fill:color-mix(in srgb,var(--c-good) 28%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-good) 60%,#000);stroke-width:1.2}
.pn-rvm{fill:color-mix(in srgb,var(--c-good) 20%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:1}
.pn-desc{fill:none;stroke:var(--c-good);stroke-width:2.6;stroke-linecap:round;stroke-dasharray:6 4}
.pn-glow{fill:var(--c-bad)}
.pn-thalglow{fill:var(--c-cyt2)}
.pn-recp{fill:none;stroke:#ffd24a;stroke-width:2;stroke-linecap:round}
.pn-recglow{fill:#ffd24a}
.pn-xc{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}
.pn-xp{stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.p-pg{--cc:#ff9a3d}.p-ap{--cc:#ffd24a}.p-desc{--cc:var(--c-good)}
.dr-g-fill.g-pg{fill:#ff9a3d}.dr-g-fill.g-ap{fill:#ffd24a}.dr-g-fill.g-horn{fill:var(--c-cyt)}.dr-g-fill.g-asc{fill:var(--c-cyt2)}.dr-g-fill.g-desc{fill:var(--c-good)}.dr-g-fill.g-pain{fill:var(--c-bad)}
.pn-term{stroke:var(--c-neut);stroke-width:1.8;stroke-linecap:round;fill:none}
`;

buildScene({
  id: "opioid-pain-pathway", fig: "Fig 1", title: "Pain pathway and opioids", W, H, body, extraCss,
  label: "An animated pain pathway. A nociceptor in injured skin fires along a peripheral nerve through the dorsal root ganglion into the dorsal horn of the spinal cord. A second neuron crosses and rises in the spinothalamic tract to the thalamus and then to the somatosensory cortex, where pain is felt. A descending pathway from the brainstem back to the dorsal horn can damp the relay. Opioid receptors are marked in the dorsal horn, thalamus and brainstem. Gauges show sensitisation, nociceptor firing, dorsal horn relay, ascending signal, descending inhibition and pain felt. Treatment choices are an NSAID, an opioid and a local anaesthetic block.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "pain.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How pain reaches the brain.</strong> Tissue injury releases prostaglandins and other mediators that sensitise nociceptors, the free nerve endings that detect harmful stimuli. Their fibres enter the spinal cord through the dorsal root and synapse in the dorsal horn (notably the substantia gelatinosa). Second order neurons cross to the opposite side and ascend in the spinothalamic tract to the thalamus, which relays to the somatosensory cortex where pain is localised and felt. A descending pathway from the periaqueductal grey and rostral ventromedial medulla returns to the dorsal horn and can inhibit the relay, a form of gate control. This is standard teaching in neuroanatomy, physiology and pharmacology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Where the treatments act.</strong> NSAIDs block cyclo-oxygenase, so fewer prostaglandins are made and nociceptors are less sensitised at the injury site. Opioids act mainly at mu opioid receptors: in the dorsal horn they reduce transmitter release from the incoming fibre and damp the second order neuron, and in the brainstem and higher centres they strengthen descending inhibition and reduce the felt intensity of pain. Local anaesthetics block voltage gated sodium channels in the peripheral nerve, so action potentials cannot pass the blocked segment and the signal never reaches the cord. These are teaching toggles only.",
  ],
  simplified: "Fast and slow pain fibres, wide dynamic range neurons, peripheral and central sensitisation over time, neuropathic pain, emotion and attention circuits, other opioid receptor types and side effects, adjuvant drugs, and all doses and routes are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
