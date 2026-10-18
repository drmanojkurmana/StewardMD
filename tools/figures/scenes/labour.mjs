/* Labour physiology as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/labour.mjs [--print-model]
 * Static layout here; contractions, particles and gauges move in labour.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
/* Level is the stage of labour. Stretch of the cervix drives oxytocin release (the Ferguson
 * reflex); oxytocin and prostaglandins drive contractions; contractions push the presenting
 * part down and stretch the cervix further, so the loop reinforces itself until delivery. */
const MD = {
  level: { label: "Stage of labour", a: [0.22, 0.55, 0.9, 0.7], names: ["latent first stage", "active first stage", "second stage", "third stage"], ticks: ["latent", "active", "second", "third"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "none" },
    { label: "tocolytic (calms the uterus)" },
    { label: "oxytocin augmentation" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no treatment", "a tocolytic", "oxytocin augmentation"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level], aug = drug === 2 ? 1 : 0, toco = drug === 1 ? 1 : 0;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const st0 = [0.25, 0.6, 1, 0.3][level], pg0 = [0.35, 0.65, 0.9, 0.55][level];
  const Pg = cl(pg0 + aug * 0.05);
  const O0 = cl(0.08 + 0.72 * st0 * (0.55 + 0.45 * Pg) + aug * 0.4);
  const C0 = cl((0.05 + 0.75 * O0 * (0.5 + 0.5 * Pg) + 0.18 * Pg) * (toco ? 0.22 : 1));
  const St = cl(st0 + 0.18 * C0 * (level === 3 ? 0 : 1));
  const O = cl(0.08 + 0.72 * St * (0.55 + 0.45 * Pg) + aug * 0.4);
  const C = cl((0.05 + 0.75 * O * (0.5 + 0.5 * Pg) + 0.18 * Pg) * (toco ? 0.22 : 1));
  const d0 = [0.15, 0.55, 1, 1][level], de0 = [0.1, 0.45, 1, 1][level];
  const D = cl(d0 * (0.72 + 0.28 * Pg) + aug * 0.07 - toco * 0.1);
  const Desc = cl(de0 * (0.65 + 0.35 * C) + aug * 0.05 - toco * 0.08);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(C, 0.3, 0.62, ["mild", "regular", "strong"]), w(D, 0.3, 0.7, ["closed", "opening", "fully open"]), w(Desc, 0.3, 0.7, ["high", "descending", "delivered"])];
  return { a, aug, toco, stage: level, St, O, Pg, C, D, Desc, words, readout: "contractions " + words[0] + " · cervix " + words[1] + " · presenting part " + words[2] };
}
const TESTS = [
  [0, 0, "contractions mild · cervix closed · presenting part high"],
  [1, 0, "contractions regular · cervix opening · presenting part descending"],
  [1, 1, "contractions mild · cervix opening · presenting part high"],
  [1, 2, "contractions strong · cervix opening · presenting part descending"],
];

/* ---------------- static layout ---------------- */
const stageRows = ["Latent first stage", "Active first stage", "Second stage", "Third stage"].map((s, i) => {
  const y = 240 + i * 26;
  const info = ["Latent first stage: the cervix softens, effaces and begins to open. Contractions are mild and irregular.", "Active first stage: contractions strengthen, the cervix opens steadily and the presenting part descends.", "Second stage: the cervix is fully open and contractions with pushing move the baby down the birth canal to delivery.", "Third stage: after the baby is born, contractions separate and deliver the placenta and limit bleeding."][i];
  return `<g class="hot" tabindex="0" data-info="${esc(info)}"><rect id="stg${i}" class="lb-stageHi" x="642" y="${y - 15}" width="278" height="24" rx="7"/><text class="sc-lab lb-stageT" x="652" y="${y + 1}">${esc(s)}</text></g>`;
}).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="uterusG">
<g id="uterusSlot"></g>
<ellipse id="tone" class="lb-tone" cx="300" cy="232" rx="50" ry="95" opacity="0"/>
<ellipse id="flush" class="lb-flush" cx="300" cy="232" rx="52" ry="86" opacity="0"/>
<g id="placG"><ellipse class="lb-plac" cx="300" cy="168" rx="26" ry="14"/></g>
<path class="lb-memb" d="M260 178C288 158 330 164 348 196C360 236 352 280 330 302"/>
<g id="fetusG"><ellipse class="lb-fetus" cx="300" cy="215" rx="44" ry="36" transform="rotate(-18 300 215)"/><circle class="lb-fetus" cx="302" cy="272" r="27"/><circle class="lb-fetusH" cx="293" cy="261" r="9"/></g>
<g id="contrArcs" class="hot" tabindex="0" data-info="Contraction: the uterus squeezes from the top down. Watch the arcs flash with each squeeze." opacity="0"><path class="lb-arc" d="M248 118C275 102 325 102 352 118"/><path class="lb-arc" d="M232 132C265 110 335 110 368 132"/><path class="lb-arc" d="M262 102C285 90 315 90 338 102"/></g>
<g id="receptG"></g>
<g id="capsG" opacity="0"></g>
</g>
<g id="cervixG">
<rect id="cxL" class="lb-cervix" x="262" y="352" width="28" height="42" rx="8"/>
<rect id="cxR" class="lb-cervix" x="310" y="352" width="28" height="42" rx="8"/>
<g id="stretchTicks" opacity="0"><path class="lb-tick" d="M252 360l-8 -5M252 376l-9 0M350 360l8 -5M350 376l9 0"/></g>
<path id="guideL" class="lb-canal" d="M272 396C266 414 262 426 258 438"/>
<path id="guideR" class="lb-canal" d="M328 396C334 414 338 426 342 438"/>
</g>
<path id="bloodV" class="lb-blood" d="M743 173C620 128 450 128 352 148"/>
<path id="nerveP" class="lb-nerve" d="M338 388L500 388L610 330L686 155"/>
<g id="dripG" class="hot" tabindex="0" data-info="Oxytocin drip: extra oxytocin runs into the uterus and binds its receptors." opacity="0">
<rect class="lb-bag" x="60" y="58" width="64" height="40" rx="8"/>
<rect class="lb-bagF" x="66" y="78" width="52" height="14" rx="4"/>
<path class="lb-line" d="M92 98C120 120 150 140 179 159"/>
<circle id="drip0" class="sc-p p-oxy" r="2.6"/>
<circle id="drip1" class="sc-p p-oxy" r="2.6"/>
<circle id="drip2" class="sc-p p-oxy" r="2.6"/>
</g>
<g id="brainSlot"></g>
<rect class="lb-box" x="635" y="200" width="292" height="150" rx="12"/>
<text class="sc-zone" x="650" y="218">STAGES OF LABOUR</text>
${stageRows}
<text class="sc-lab lb-fb1" x="650" y="360">Stretch releases oxytocin,</text>
<text class="sc-lab" x="650" y="378">contractions add more stretch.</text>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.lb-memb{fill:none;stroke:var(--c-fl);stroke-width:1.2;stroke-dasharray:4 3;opacity:.8}
.lb-fetus{fill:color-mix(in srgb,var(--c-donor) 68%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-donor) 60%,#000);stroke-width:1}
.lb-fetusH{fill:color-mix(in srgb,var(--c-donor) 35%,#fff);stroke:none;opacity:.7}
.lb-plac{fill:color-mix(in srgb,var(--c-bad) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1}
.lb-cervix{fill:color-mix(in srgb,var(--c-endo) 72%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.lb-canal{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4}
.lb-blood{fill:none;stroke:var(--c-cyt);stroke-width:1.3;stroke-dasharray:5 4;stroke-linecap:round;stroke-linejoin:round;opacity:.55}
.lb-nerve{fill:none;stroke:var(--c-cyt2);stroke-width:1.3;stroke-dasharray:3 4;stroke-linecap:round;stroke-linejoin:round;opacity:.6}
.lb-arc{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.lb-tick{fill:none;stroke:var(--c-fl);stroke-width:1.6;stroke-linecap:round}
.lb-flush{fill:var(--c-bad);stroke:none}
.lb-tone{fill:var(--c-bad);stroke:none}
.lb-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.lb-stageHi{fill:var(--anatomy-lit);opacity:.06}
.lb-stageT{pointer-events:none}
.lb-fb1{fill:var(--anatomy-strong);font-weight:700}
.lb-bag{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.lb-bagF{fill:var(--c-cyt);stroke:none;opacity:.8}
.lb-line{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4}
.lb-rec{fill:var(--anatomy-paper);stroke:var(--c-cyt);stroke-width:1.4}
.lb-recB{fill:var(--c-cyt);stroke:var(--c-cyt);stroke-width:1.4}
.lb-capX{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round}
.lb-cap{fill:var(--anatomy-strong);font-size:12px}
.p-oxy{--cc:var(--c-cyt)}.p-pg{--cc:#ff9a3d}.p-nerve{--cc:var(--c-cyt2)}
.dr-g-fill.g-pg{fill:#ff9a3d}.dr-g-fill.g-oxy{fill:var(--c-cyt)}.dr-g-fill.g-str{fill:var(--c-fl)}
`;

buildScene({
  id: "labour-oxytocin", fig: "Fig 1", title: "Labour: stretch, oxytocin and prostaglandins", W, H, body, extraCss,
  label: "An animated uterus, cervix and birth canal with the feedback loop of labour. The presenting part stretches the cervix. Stretch signals travel to the hypothalamus, the posterior pituitary releases oxytocin, and oxytocin with prostaglandins from the membranes and decidua strengthens uterine contractions. Contractions push the presenting part down and stretch the cervix further, so the loop builds until delivery. Gauges show stretch, oxytocin, prostaglandins, contractions, cervical opening and descent. The stage slider moves through the stages of labour, and treatment choices include oxytocin augmentation and a tocolytic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "labour.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With oxytocin augmentation",
  sourcesLis: [
    "<strong>How labour is driven.</strong> As the presenting part descends it stretches the cervix and lower uterine segment. Stretch receptors send signals along pelvic nerves to the hypothalamus, and the posterior pituitary releases oxytocin in pulses: the Ferguson reflex. Oxytocin acts on myometrial oxytocin receptors, which become more numerous near term, and the uterus contracts from the fundus down. Stretched membranes and decidua also release prostaglandins, which soften and ripen the cervix, increase gap junctions between muscle cells and make the myometrium more sensitive to oxytocin. Each contraction increases stretch, so oxytocin release and contraction strength build in positive feedback until the baby is born, after which the stimulus falls away. This is standard teaching in physiology and obstetrics texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Oxytocin augmentation strengthens contractions when labour is slow. A tocolytic calms uterine contraction, shown here only as a teaching contrast. These are teaching toggles only.",
  ],
  simplified: "Fetal endocrine signals that help time the onset of labour, cervical scoring, pain pathways and analgesia, fetal monitoring, malpresentation, obstruction, uterine rupture, postpartum haemorrhage management, and all doses and clinical thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
