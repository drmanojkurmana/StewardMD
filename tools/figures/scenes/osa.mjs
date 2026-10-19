/* Obstructive sleep apnoea as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/osa.mjs [--print-model]
 * Static layout here; airway, real lung, brain and heart organs, blood and gauges move in osa.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How crowded and collapsible the airway is", a: [0.3, 0.65, 1], names: ["mild", "moderate", "severe"], ticks: ["mild", "moderate", "severe"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "weight loss and side sleeping" },
    { label: "surgery or jaw device" },
    { label: "CPAP (splints the airway open)" },
  ],
  status: "Airway tendency: {level} · {drug} ·",
  drugNames: ["no treatment", "weight loss and side sleeping", "surgery or a jaw device", "CPAP"],
};
function modelOf(S, level, drug) {
  const TF = [1, 0.55, 0.38, 0.12];
  const a = S.level.a[level], tf = TF[drug];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const wl = drug === 1 ? 1 : 0, surg = drug === 2 ? 1 : 0, cpap = drug === 3 ? 1 : 0;
  const C = cl(a * tf);
  const A = C;
  const oxy = cl(0.05 + 0.9 * C);
  const co2 = cl(0.05 + 0.85 * C);
  const aro = cl(0.05 + 0.88 * C);
  const frag = aro;
  const symp = cl(0.05 + 0.55 * aro + 0.4 * oxy);
  const sleepy = frag;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(C, 0.25, 0.55, ["rare", "recurrent", "frequent"]), w(oxy, 0.3, 0.6, ["shallow", "deep", "very deep"]), w(frag, 0.3, 0.6, ["settled", "broken", "fragmented"]), w(symp, 0.3, 0.6, ["low", "raised", "high"])];
  return { a, tf, wl, cpap, surg, C, A, oxy, co2, aro, frag, symp, sleepy, words, readout: "apnoeas " + words[0] + " · oxygen dips " + words[1] + " · sleep " + words[2] + " · sympathetic activity " + words[3] };
}
const TESTS = [
  [2, 0, "apnoeas frequent · oxygen dips very deep · sleep fragmented · sympathetic activity high"],
  [2, 3, "apnoeas rare · oxygen dips shallow · sleep settled · sympathetic activity low"],
  [0, 0, "apnoeas recurrent · oxygen dips deep · sleep broken · sympathetic activity raised"],
  [1, 1, "apnoeas recurrent · oxygen dips deep · sleep broken · sympathetic activity raised"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">THROAT IN SLEEP</text>
<text class="sc-zone" x="410" y="68">LUNGS AND BLOOD</text>
<text class="sc-zone" x="680" y="68">BRAIN AND HEART</text>
<g id="airwayG">
  <circle class="osa-skin" cx="190" cy="200" r="108"/>
  <rect class="osa-skin" x="232" y="272" width="98" height="112" rx="18"/>
  <polygon class="osa-skin" points="84,182 56,204 86,216"/>
  <circle class="osa-eye" cx="138" cy="164" r="6"/>
  <circle class="osa-ear" cx="216" cy="196" r="14"/>
  <rect class="osa-air" x="86" y="178" width="152" height="14" rx="7"/>
  <rect class="osa-air" x="86" y="226" width="112" height="10" rx="5"/>
  <rect id="airLumen" class="osa-air" x="262" y="178" width="58" height="168" rx="10"/>
  <rect class="osa-wall" x="320" y="148" width="26" height="202" rx="12"/>
  <rect class="osa-muscle" x="312" y="160" width="8" height="178" rx="4"/>
  <g id="fatPad"><ellipse class="osa-fat" cx="330" cy="368" rx="58" ry="28"/></g>
  <g id="palateG"><path class="osa-palate" d="M232 190 C258 188 270 206 264 240 C250 244 238 226 232 208 Z"/></g>
  <g id="tongueG"><ellipse class="osa-tongue" cx="202" cy="272" rx="62" ry="30"/><ellipse class="osa-tongue2" cx="182" cy="260" rx="34" ry="16"/></g>
  <g id="jawG" opacity="0"><rect class="osa-device" x="92" y="238" width="48" height="13" rx="6"/><path class="osa-arrow" d="M92 258 L62 258 M70 250 L60 258 L70 266"/></g>
  <g id="cpapG" opacity="0"><rect class="osa-mask" x="52" y="158" width="72" height="72" rx="20"/><path class="osa-strap" d="M120 168 C170 150 220 150 258 172"/><path class="osa-pressure" d="M132 185 l14 0 M138 178 l8 7 l-8 7 M162 185 l14 0 M168 178 l8 7 l-8 7 M192 185 l14 0 M198 178 l8 7 l-8 7"/></g>
  <g id="posG" opacity="0"><path class="osa-moon" d="M352 92 a22 22 0 1 0 14 38 a17 17 0 1 1 -14 -38 Z"/><path class="osa-arrow2" d="M296 118 C318 106 340 112 352 128 M344 122 L353 129 L344 136"/></g>
</g>
<path id="trachea" class="osa-tube" d="M291 330 L315 384 L515 232"/>
<rect class="osa-chest" x="394" y="158" width="242" height="214" rx="58"/>
<g id="lungSlotL"></g>
<g id="lungSlotR"></g>
<ellipse id="duskL" class="osa-dusk" cx="455" cy="258" rx="46" ry="60" opacity="0"/>
<ellipse id="duskR" class="osa-dusk" cx="575" cy="258" rx="46" ry="60" opacity="0"/>
<rect id="oxyVessel" class="osa-vessel" x="560" y="388" width="169" height="22" rx="11"/>
<rect id="oxyOverlay" class="osa-desat" x="560" y="388" width="169" height="22" rx="11" opacity="0"/>
<g id="bloodG"></g>
<g id="brainSlot"></g>
<g id="brainFx">
  <text id="zzz" class="osa-zzz" x="850" y="100">Z z</text>
  <g id="arousalG" opacity="0"><path class="osa-burst" d="M742 92 l-10 -18 M786 82 l0 -22 M830 92 l10 -18 M706 130 l-20 -8 M866 130 l20 -8"/></g>
</g>
<g id="heartSlot"></g>
<g id="sympG" opacity="0"><path class="osa-burst" d="M724 300 l-22 -12 M724 330 l-24 0 M848 300 l22 -12 M848 330 l24 0"/></g>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.osa-skin{fill:#e8b48c}.osa-eye{fill:#2b2118}.osa-ear{fill:#d99f73}
body[data-theme="light"] .osa-skin{fill:#eebd97}body[data-theme="light"] .osa-ear{fill:#dda273}
.osa-air{fill:#bfe6f5}.osa-wall{fill:#c9788a}.osa-muscle{fill:#e5484d}
.osa-fat{fill:#f2d27a}.osa-palate{fill:#e9a2b3}.osa-tongue{fill:#d96a7a}.osa-tongue2{fill:#e88a96}
.osa-tube{fill:none;stroke:#bfe6f5;stroke-width:26;stroke-linecap:round;stroke-linejoin:round}
.osa-chest{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.osa-dusk{fill:#4a6fa5;stroke:none}
.osa-vessel{fill:#d63a4a}.osa-desat{fill:#4a6fa5}
.osa-zzz{fill:var(--anatomy-strong);font-size:20px;font-weight:700;pointer-events:none}
.osa-burst{fill:none;stroke:#e9b84a;stroke-width:2.4;stroke-linecap:round}
.osa-mask{fill:#7ab8ff;stroke:#2f7ad8;stroke-width:2}.osa-strap{fill:none;stroke:var(--anatomy-mid);stroke-width:3}
.osa-pressure{fill:none;stroke:#2f7ad8;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.osa-device{fill:#3ddc97;stroke:#0f9f76;stroke-width:1.4}.osa-arrow{fill:none;stroke:#0f9f76;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.osa-moon{fill:var(--anatomy-hi);stroke:none}.osa-arrow2{fill:none;stroke:var(--anatomy-hi);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.osa-cpapdot{fill:#dff4fd;stroke:#2f7ad8;stroke-width:.7}
.osa-cap{fill:var(--anatomy-strong);font-size:12px}
.p-air{fill:#dff4fd;stroke:#7ab8ff;stroke-width:.7}.p-co2{fill:#ff9a3d;stroke:#c25e10;stroke-width:.6}.p-symp{fill:#e9b84a;stroke:#b8860b;stroke-width:.6}
.dr-g-fill.g-osa{fill:#e9a2b3}.dr-g-fill.g-osa2{fill:#38d1ff}
`;

buildScene({
  id: "obstructive-sleep-apnoea", fig: "Fig 1", title: "Obstructive sleep apnoea: the airway closes in sleep", W, H, body, extraCss,
  label: "An animated upper airway, real lungs, brain and heart in sleep. Sleep relaxes the muscles that hold the throat open. In a crowded airway the tongue and soft palate fall back and the throat closes. Airflow stops, oxygen falls and carbon dioxide rises, the brain briefly wakes, sleep breaks up, and nightly surges strain the heart and vessels. A slider sets how crowded and collapsible the airway is, and each treatment is shown working on the drawing. Gauges show collapse, apnoeas, oxygen dips, arousals, sympathetic activity and daytime sleepiness. Treatments are weight loss and side sleeping, surgery or a jaw device, and CPAP.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or device settings are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "osa.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With CPAP",
  sourcesLis: [
    "<strong>How obstructive sleep apnoea develops.</strong> During sleep the neuromuscular tone that keeps the upper airway open falls. If the pharyngeal airway is already crowded, by obesity and fat around the neck, a large tongue, a long soft palate, or inherited airway shape, the negative pressure of breathing in pulls it shut. Episodes of apnoea occur many times a night in adults, more often as severity rises. Each episode lowers ventilation, so oxygen falls and carbon dioxide rises, until arousal briefly restores muscle tone and breathing. Repeated arousals fragment sleep and cause daytime sleepiness. Sympathetic surges with each arousal raise pressure in the chest and circulation and are linked to hypertension, arrhythmia and pulmonary hypertension. Prevalence is higher with obesity and the condition is under recognised, including in women. This is standard respiratory and sleep teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Weight loss and positional therapy (sleeping on the side, which helps when collapse is worse lying flat), surgery or a mandibular advancement device which moves the tongue and jaw forward, and CPAP which uses pressure to splint the airway open. These are teaching toggles only.",
  ],
  simplified: "Central sleep apnoea, detailed sleep staging, airway imaging and endoscopy, exact diagnostic thresholds, device pressures and surgical procedures, and associated conditions beyond the main pathway are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
