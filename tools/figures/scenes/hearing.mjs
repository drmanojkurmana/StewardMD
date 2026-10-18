/* Hearing and its loss as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/hearing.mjs [--print-model]
 * Static layout here; sound, ossicles, basilar wave, hair cells, nerve pulses and gauges move in hearing.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Hearing state", a: [1, 0.25, 0.3], names: ["normal", "conductive loss", "sensorineural loss"], ticks: ["normal", "conductive", "sensorineural"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "hearing aid" },
    { label: "surgery for ossicular disease" },
    { label: "cochlear implant" },
  ],
  status: "Hearing: {level} · {drug} ·",
  drugNames: ["no treatment", "hearing aid", "ossicle surgery", "cochlear implant"],
};
function modelOf(S, level, drug) {
  const TBL = [
    { air: 1, bone: 1, coch: 0.95, wave: 1 },
    { air: 0.22, bone: 0.92, coch: 0.95, wave: 0.9 },
    { air: 0.28, bone: 0.28, coch: 0.4, wave: 0.3 },
  ];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const b = TBL[level];
  let air = b.air, bone = b.bone, coch = b.coch, wave = b.wave;
  const aid = drug === 1 ? 1 : 0, surg = drug === 2 ? 1 : 0, impl = drug === 3 ? 1 : 0;
  if (surg && level === 1) { air = 0.92; wave = 0.95; }
  const airHeard = cl(air * (aid ? 3.2 : 1) * coch);
  const boneHeard = cl(bone * coch);
  const waveEff = cl(wave * (air * (aid ? 1.5 : 1)) + (level === 1 && surg ? 0.75 : 0));
  const nerve = impl ? 0.85 : airHeard;
  const hearing = nerve;
  const cond = level === 1 ? 1 : 0, sens = level === 2 ? 1 : 0;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(airHeard, 0.35, 0.7, ["low", "reduced", "normal"]), w(boneHeard, 0.35, 0.7, ["low", "reduced", "normal"]), w(hearing, 0.35, 0.7, ["low", "reduced", "normal"])];
  return { air, bone, coch, wave, waveEff, airHeard, boneHeard, nerve, hearing, aid, surg, impl, cond, sens, words, readout: "air conduction " + words[0] + " · bone conduction " + words[1] + " · hearing " + words[2] };
}
const TESTS = [
  [0, 0, "air conduction normal · bone conduction normal · hearing normal"],
  [1, 0, "air conduction low · bone conduction normal · hearing low"],
  [2, 0, "air conduction low · bone conduction low · hearing low"],
  [1, 2, "air conduction normal · bone conduction normal · hearing normal"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="560" height="396" rx="18"/>
<rect class="sc-tissue" x="584" y="44" width="362" height="194" rx="18"/>
<rect class="sc-tissue" x="584" y="246" width="362" height="194" rx="18"/>
<text class="sc-zone" x="34" y="68">EAR: SOUND TO COCHLEA</text>
<text class="sc-zone" x="604" y="68">COCHLEA, UNROLLED</text>
<text class="sc-zone" x="604" y="270">FORK TESTS</text>
<g id="ear"></g>
<g id="coch"></g>
<g id="fork"></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

buildScene({
  id: "hearing-conductive-sensorineural", fig: "Fig 1", title: "Hearing: conductive and sensorineural loss", W, H, body,
  label: "An animated ear. Sound enters the external ear and ear canal, vibrates the tympanic membrane and the ossicles malleus, incus and stapes, and pushes at the oval window into the cochlea. An unrolled cochlea shows the basilar membrane, stiff base for high pitch and floppy apex for low pitch, with hair cells on it. Signals pass along the auditory nerve. Conductive loss blocks the air path while bone conduction is preserved. Sensorineural loss damages hair cells so air and bone conduction both fall. An inset shows Rinne and Weber tuning fork tests. Gauges show air and bone conduction, the basilar wave, hair cells, nerve signal and hearing. Treatments are a hearing aid, surgery for ossicular disease and a cochlear implant.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, frequencies or numbers are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "hearing.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How hearing works.</strong> The pinna and external ear canal guide sound to the tympanic membrane. Its vibration moves the ossicles, malleus, incus and stapes, in the middle ear. The stapes footplate pushes at the oval window, setting up a travelling wave on the basilar membrane inside the cochlea. The membrane is stiff and narrow at the base, which responds best to high pitch, and wide and floppy at the apex, which responds best to low pitch: this place code is tonotopy. Hair cells on the membrane bend with the wave and send signals along the auditory nerve. This is standard teaching in physiology and ENT texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Conductive and sensorineural loss.</strong> Conductive loss is a failure of sound to reach the cochlea, for example a blocked canal, a perforated eardrum or ossicular disease. Otosclerosis fixes the stapes at the oval window and is a classic conductive cause. Bone conduction, which shakes the cochlea through the skull, is preserved, so in the Rinne test bone conduction is louder than air conduction and in the Weber test sound lateralises to the affected ear. Sensorineural loss is damage to hair cells or the nerve, for example noise damage, which injures hair cells, and presbycusis, age related loss that affects high pitch first. Air and bone conduction both fall, Rinne still has air louder than bone, and Weber lateralises to the better ear. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> A hearing aid amplifies sound in the canal and helps when some hair cell function remains. Surgery for ossicular disease repairs or replaces a fixed or damaged ossicle, for example in otosclerosis, and restores the air path in conductive loss. A cochlear implant bypasses damaged hair cells and stimulates the auditory nerve directly with an electrode in the cochlea. These are teaching toggles only.",
  ],
  simplified: "Middle ear muscle reflexes, round window mechanics, cochlear fluids and potentials, outer and inner hair cell differences, central auditory pathways, grading of hearing loss, audiograms and tympanometry detail, and all device settings, surgical steps and numbers are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.hr-pinna{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1.4}
.hr-canal{fill:color-mix(in srgb,var(--c-fl) 18%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}
.hr-middle{fill:color-mix(in srgb,var(--c-plt) 14%,transparent);stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:4 3}
.hr-tm{fill:var(--c-endo);stroke:color-mix(in srgb,var(--c-endo) 55%,#000);stroke-width:1.4}
.hr-bone{fill:#e8dcc0;stroke:#9a8a68;stroke-width:1.3}
body[data-theme="light"] .hr-bone{fill:#d9c69a;stroke:#7a6a48}
.hr-oval{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:1.3}
.hr-cochlea{fill:color-mix(in srgb,var(--c-mac) 32%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.6}
.hr-spiral{fill:none;stroke:var(--c-mac);stroke-width:2.4;stroke-linecap:round}
.hr-nerve{fill:none;stroke:var(--c-plt);stroke-width:5;stroke-linecap:round}
.hr-membrane{fill:var(--c-good);stroke:color-mix(in srgb,var(--c-good) 55%,#000);stroke-width:1.2}
.hr-hair{fill:var(--c-neut);stroke:color-mix(in srgb,var(--c-neut) 55%,#000);stroke-width:.8}
.hr-wave{fill:none;stroke:var(--c-cyt);stroke-width:2.2;stroke-linecap:round}
.hr-head{fill:color-mix(in srgb,var(--c-eos) 34%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1.4}
.hr-earside{fill:var(--c-eos);stroke:color-mix(in srgb,var(--c-eos) 55%,#000);stroke-width:1}
.hr-fork{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4;stroke-linecap:round}
.hr-bar-tr{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:1}
.hr-bar-air{fill:var(--c-fl)}
.hr-bar-bone{fill:var(--c-plt)}
.hr-arrow{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.hr-device{fill:var(--c-cyt2);stroke:color-mix(in srgb,var(--c-cyt2) 55%,#000);stroke-width:1.2}
.hr-electrode{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:.7}
.hr-plaque{fill:var(--c-bad);stroke:color-mix(in srgb,var(--c-bad) 55%,#000);stroke-width:1}
.p-snd{--cc:var(--c-fl)}
.p-bonep{--cc:var(--c-plt)}
.p-nervep{--cc:var(--c-plt)}
.p-cochp{--cc:var(--c-cyt)}
.dr-g-fill.g-air{fill:var(--c-fl)}.dr-g-fill.g-bone{fill:var(--c-plt)}.dr-g-fill.g-wave{fill:var(--c-cyt)}.dr-g-fill.g-hair{fill:var(--c-neut)}
`,
});
