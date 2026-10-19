/* Spinal cord lesions as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cord.mjs [--print-model]
 * Static layout here; tract signals, lesion shading, body map and gauges move in cord.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Lesion pattern", a: [0, 1, 2, 3], names: ["hemisection", "anterior cord", "central cord", "complete"], ticks: ["hemisection", "anterior", "central", "complete"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "steroid concept (calm swelling)" },
    { label: "rehabilitation (retrain pathways)" },
    { label: "decompress (free the cord)" },
  ],
  status: "Lesion: {level} · {drug} ·",
  drugNames: ["no treatment", "a steroid concept", "rehabilitation", "decompression"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const BASE = [
    { m: 0.60, p: 0.80, s: 0.75, infl: 0.35 },
    { m: 0.90, p: 0.10, s: 0.90, infl: 0.42 },
    { m: 0.45, p: 0.20, s: 0.78, infl: 0.32 },
    { m: 1.00, p: 1.00, s: 1.00, infl: 0.50 },
  ];
  const RED = [0.45, 0.50, 0.35, 0.08];
  const base = BASE[t];
  const steroid = drug === 1 ? 1 : 0, rehab = drug === 2 ? 1 : 0, decomp = drug === 3 ? 1 : 0;
  const rec = decomp ? RED[t] : steroid ? 0.15 : rehab ? 0.05 : 0;
  const Mtr = cl(base.m * (1 - rec));
  const Prop = cl(base.p * (1 - rec));
  const Pain = cl(base.s * (1 - rec));
  const Inflam = cl(base.infl * (steroid ? 0.35 : decomp ? 0.60 : 1));
  const Func = cl(1 - (0.45 * Mtr + 0.30 * Prop + 0.25 * Pain) + (rehab ? 0.22 : decomp ? 0.10 : steroid ? 0.05 : 0));
  const Spared = cl(1 - (Mtr + Prop + Pain) / 3);
  const squeeze = decomp ? 0.06 : steroid ? 0.18 : rehab ? 0.45 : 0.50;
  const train = rehab ? 0.32 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(Mtr, 0.35, 0.70, ["preserved", "weak", "lost"]), w(Prop, 0.35, 0.70, ["preserved", "reduced", "lost"]), w(Pain, 0.35, 0.70, ["preserved", "reduced", "lost"])];
  return { type: t, decomp, steroid, rehab, rec, squeeze, train, Mtr, Prop, Pain, Inflam, Func, Spared, words, readout: "motor " + words[0] + " · proprioception " + words[1] + " · pain and temperature " + words[2] };
}
const TESTS = [
  [0, 0, "motor weak · proprioception lost · pain and temperature lost"],
  [1, 0, "motor lost · proprioception preserved · pain and temperature lost"],
  [2, 0, "motor weak · proprioception preserved · pain and temperature lost"],
  [2, 3, "motor preserved · proprioception preserved · pain and temperature reduced"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="500" height="396" rx="18"/>
<rect class="sc-tissue" x="530" y="44" width="416" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">SPINAL CORD, CROSS SECTION</text>
<text class="sc-zone" x="550" y="68">BODY BELOW THE LEVEL</text>
<text class="sc-lab" x="265" y="112" text-anchor="middle">POSTERIOR</text>
<text class="sc-lab" x="265" y="360" text-anchor="middle">ANTERIOR</text>
<defs>
<clipPath id="cordclip"><ellipse cx="265" cy="238" rx="148" ry="105"/></clipPath>
<pattern id="cdhatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="transparent"/><line x1="0" y1="0" x2="0" y2="7" stroke="#7ab8ff" stroke-width="2.4" opacity="0.55"/></pattern>
</defs>
<g id="cordwrap">
<ellipse class="cd-canal" cx="265" cy="238" rx="168" ry="122"/>
<ellipse id="inflamHalo" class="cd-inflam" cx="265" cy="238" rx="158" ry="115"/>
<ellipse class="cd-cord" cx="265" cy="238" rx="148" ry="105"/>
<path class="cd-root" d="M150 165L118 140M380 165L412 140M155 315L122 342M375 315L408 342"/>
<path class="cd-gray" d="M212 192Q265 216 318 192Q334 226 318 260Q338 298 300 314Q276 276 265 260Q254 276 230 314Q192 298 212 260Q196 226 212 192Z"/>
<g clip-path="url(#cordclip)">
<path class="cd-dorsal" d="M265 133L237 136Q229 176 250 206L265 211Z"/>
<path class="cd-dorsal" d="M265 133L293 136Q301 176 280 206L265 211Z"/>
<ellipse class="cd-cst" cx="168" cy="206" rx="20" ry="29"/>
<ellipse class="cd-cst" cx="362" cy="206" rx="20" ry="29"/>
<ellipse class="cd-stt" cx="176" cy="288" rx="25" ry="20"/>
<ellipse class="cd-stt" cx="354" cy="288" rx="25" ry="20"/>
<rect id="lesionHemi" class="cd-lesion" x="265" y="130" width="150" height="216" opacity="0"/>
<rect id="lesionAnt" class="cd-lesion" x="115" y="202" width="300" height="144" opacity="0"/>
<g id="lesionCentral" opacity="0"><ellipse class="cd-lesion" cx="265" cy="238" rx="58" ry="44"/><rect class="cd-lesion" x="202" y="227" width="126" height="22"/></g>
<ellipse id="lesionComplete" class="cd-lesion" cx="265" cy="238" rx="148" ry="105" opacity="0"/>
<ellipse id="syrinx" class="cd-syrinx" cx="265" cy="238" rx="29" ry="19" opacity="0"/>
<ellipse id="squeeze" class="cd-squeeze" cx="265" cy="238" rx="148" ry="105" opacity="0.5"/>
<ellipse id="trainGlow" class="cd-train" cx="265" cy="238" rx="148" ry="105" opacity="0"/>
<g id="detour" opacity="0"><path class="cd-detour" d="M170 190C130 230 130 280 175 325"/><path class="cd-detour" d="M360 190C400 230 400 280 355 325"/></g>
</g>
<circle class="cd-centre" cx="265" cy="238" r="6"/>
<path class="cd-fissure" d="M265 343L265 318"/>
<g id="compressArrows" opacity="0.85"><path class="cd-arrow" d="M92 238H132M122 228L134 238L122 248"/><path class="cd-arrow" d="M438 238H398M408 228L396 238L408 248"/></g>
<g id="decompressArrows" opacity="0"><path class="cd-arrow cd-arrow-out" d="M132 238H92M102 228L90 238L102 248"/><path class="cd-arrow cd-arrow-out" d="M398 238H438M428 228L440 238L428 248"/></g>
</g>
<g id="brainSlot"></g>
<path id="linkDown" class="cd-link" d="M448 128L405 152L370 182"/>
<path id="linkUp" class="cd-link" d="M258 148L330 124L412 128"/>
<g id="bodywrap">
<path class="cd-levelLine" d="M560 148H916"/>
<circle class="cd-skin" cx="738" cy="106" r="24"/>
<path class="cd-skin" d="M726 128H750V150H726Z"/>
<path class="cd-skin" d="M688 148H788L800 262H676Z"/>
<path class="cd-skin" d="M688 154L656 164L642 252L664 258L684 202Z"/>
<path class="cd-skin" d="M788 154L820 164L834 252L812 258L792 202Z"/>
<path class="cd-skin" d="M684 262H732L727 378H690Z"/>
<path class="cd-skin" d="M744 262H792L786 378H751Z"/>
<path id="shR" class="cd-shadeMotor" d="M738 148H788L800 262H738Z M744 262H792L786 378H751Z M788 154L820 164L834 252L812 258L792 202Z" opacity="0"/>
<path id="shL" class="cd-shadeMotor" d="M688 148H738V262H676Z M684 262H732L727 378H690Z M688 154L656 164L642 252L664 258L684 202Z" opacity="0"/>
<path id="shPainR" class="cd-shadePain" d="M738 148H788L800 262H738Z M744 262H792L786 378H751Z" opacity="0"/>
<path id="shPainL" class="cd-shadePain" d="M688 148H738V262H676Z M684 262H732L727 378H690Z" opacity="0"/>
<path id="cape" class="cd-shadePain" d="M676 148H800L806 208H670Z M656 164L820 164L834 252L812 258L800 208H676L664 258L642 252Z" opacity="0"/>
<path id="legTrainL" class="cd-legtrain" d="M684 262H732L727 378H690Z" opacity="0"/>
<path id="legTrainR" class="cd-legtrain" d="M744 262H792L786 378H751Z" opacity="0"/>
<path class="cd-midline" d="M738 150V378"/>
</g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
body{--c-dorsal:#5ec1a0;--c-cst:#e5484d;--c-stt:#7ab8ff;--c-gray:#b7a1e6;--c-skin:#e8c39a;--c-cord:#efe6da}
body[data-theme="light"]{--c-dorsal:#2f9f7c;--c-cst:#c42a3d;--c-stt:#2f7ad8;--c-gray:#8f72d0;--c-skin:#d9a06a;--c-cord:#f7efe2}
.cd-canal{fill:color-mix(in srgb,var(--anatomy-mid) 18%,transparent);stroke:var(--anatomy-mid);stroke-width:1.2;stroke-dasharray:5 4}
.cd-cord{fill:var(--c-cord);stroke:var(--anatomy-mid);stroke-width:1.4}
.cd-gray{fill:var(--c-gray);opacity:.72;stroke:color-mix(in srgb,var(--c-gray) 55%,#000);stroke-width:.8}
.cd-dorsal{fill:var(--c-dorsal);stroke:color-mix(in srgb,var(--c-dorsal) 55%,#000);stroke-width:.9;opacity:.92}
.cd-cst{fill:var(--c-cst);stroke:color-mix(in srgb,var(--c-cst) 55%,#000);stroke-width:.9;opacity:.88}
.cd-stt{fill:var(--c-stt);stroke:color-mix(in srgb,var(--c-stt) 55%,#000);stroke-width:.9;opacity:.88}
.cd-centre{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.cd-fissure{stroke:var(--anatomy-mid);stroke-width:1.6;fill:none}
.cd-root{stroke:var(--anatomy-mid);stroke-width:1.6;fill:none;stroke-linecap:round}
.cd-lesion{fill:var(--c-bad);stroke:var(--c-bad);stroke-width:1;stroke-dasharray:4 3}
.cd-syrinx{fill:var(--anatomy-paper);stroke:var(--c-stt);stroke-width:1.4}
.cd-inflam{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-dasharray:6 5;opacity:0}
.cd-squeeze{fill:var(--c-bad);stroke:none}
.cd-train{fill:var(--c-good);stroke:none}
.cd-detour{fill:none;stroke:var(--c-good);stroke-width:5;stroke-linecap:round;stroke-dasharray:12 8}
.cd-link{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:4 4}
.cd-legtrain{fill:var(--c-good);stroke:none}
.cd-cap{fill:var(--anatomy-strong);font-size:12px}
.cd-arrow{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.cd-arrow-out{stroke:var(--c-good)}
.cd-skin{fill:var(--c-skin);stroke:color-mix(in srgb,var(--c-skin) 55%,#000);stroke-width:.9;opacity:.94}
.cd-shadeMotor{fill:var(--c-cst);stroke:none}
.cd-shadePain{fill:url(#cdhatch);stroke:var(--c-stt);stroke-width:.8}
.cd-levelLine{stroke:var(--c-bad);stroke-width:1.6;stroke-dasharray:6 4;fill:none}
.cd-midline{stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 4;fill:none;opacity:.6}
.p-dorsal{--cc:var(--c-dorsal)}.p-cst{--cc:var(--c-cst)}.p-stt{--cc:var(--c-stt)}.p-det{--cc:var(--c-good)}.p-sw{--cc:var(--c-neut)}
.dr-g-fill.g-prop{fill:var(--c-cyt)}.dr-g-fill.g-pain{fill:var(--c-stt)}.dr-g-fill.g-inflam{fill:var(--c-neut)}
`;

buildScene({
  id: "spinal-cord-lesions", fig: "Fig 1", title: "Spinal cord lesions: tracts, levels and patterns", W, H, body, extraCss,
  label: "An animated spinal cord cross section and body map. The brain sends movement signals down the cord and the skin sends feeling signals up. Dorsal columns carry proprioception upward on the same side and cross in the medulla. The spinothalamic tract carries pain and temperature, crosses in the cord near the level of entry, then rises on the opposite side. The corticospinal tract carries motor commands downward, mostly crossing at the pyramids. Lesion patterns include hemisection, anterior cord, central cord and complete transection. A slider sets the pattern, and treatment choices show decompression, a steroid concept and rehabilitation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cord.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With decompression",
  sourcesLis: [
    "<strong>How cord lesions are localised.</strong> A spinal cord lesion is placed by its level and by which tracts it interrupts. Ascending dorsal columns carry proprioception, vibration and fine touch from a sensory nerve on the same side up through cord segments, crossing only in the medulla, so a cord lesion usually loses these senses ipsilaterally below the lesion. Spinothalamic fibres from pain and temperature nerves cross in the anterior white commissure within a segment or two of entry and then ascend contralaterally, so pain and temperature loss is usually on the opposite side and starts a little below the level. Descending corticospinal fibres mostly cross at the medullary pyramids and run in the lateral cord, so a cord lesion gives upper motor neuron signs: weakness with spasticity, brisk reflexes and an upgoing plantar response below the lesion, with lower motor neuron signs only at the level where anterior horn cells or the nerve root are damaged. Vertebral bodies and the cord segment do not align exactly, and cervical segments sit higher than the same numbered vertebral bodies. This is standard teaching in clinical neurology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>The patterns shown.</strong> Complete transection interrupts every tract, with paralysis and loss of sensory and autonomic function below the level, first flaccid in spinal shock and later spastic. Brown-Sequard hemisection gives ipsilateral motor and proprioception loss with contralateral pain and temperature loss. Anterior cord syndrome from anterior spinal artery or compression damage spares the dorsal columns while motor and pain and temperature are lost below. Central cord injury and syringomyelia, usually idiopathic or linked to a Chiari malformation, expand around the central canal, interrupt crossing pain and temperature fibres first and give a cape like suspended sensory loss over the shoulders and arms, with upper limbs often weaker than lower limbs. Extrinsic compression from vertebral, disc, tumour, abscess or inflammation can mimic these patterns and is a surgical urgency. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Decompression relieves extrinsic compression of the cord. A steroid concept stands for calming secondary inflammation and swelling after acute injury, shown only as a concept with no agent or dose implied. Rehabilitation trains spared pathways, strength, transfers and bladder and bowel routines and prevents complications. These are teaching toggles only.",
  ],
  simplified: "Exact dermatomes and myotomes, bladder, bowel and sexual dysfunction in detail, spinal shock timing, autonomic dysreflexia, every cause of myelopathy including metabolic and infectious causes, imaging, surgical indications and all drug doses are left out. The lesion level is shown as cervical for illustration. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
