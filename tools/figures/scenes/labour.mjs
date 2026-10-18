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
  const y = 200 + i * 28;
  const info = ["Latent first stage: the cervix softens, effaces and begins to open. Contractions are mild and irregular.", "Active first stage: contractions strengthen, the cervix opens steadily and the presenting part descends.", "Second stage: the cervix is fully open and contractions with pushing move the baby down the birth canal to delivery.", "Third stage: after the baby is born, contractions separate and deliver the placenta and limit bleeding."][i];
  return `<g class="hot" tabindex="0" data-info="${esc(info)}"><rect id="stg${i}" class="lb-stageHi" x="642" y="${y - 15}" width="278" height="24" rx="7"/><text class="sc-lab lb-stageT" x="652" y="${y + 1}">${esc(s)}</text></g>`;
}).join("");
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">UTERUS, CERVIX AND BIRTH CANAL</text>
<text class="sc-zone" x="620" y="68">FEEDBACK LOOP</text>
<path class="lb-blood" d="M712 150C622 88 472 76 352 94"/>
<path class="lb-nerve" d="M338 388L618 388L674 300L704 168"/>
<rect class="lb-box" x="635" y="172" width="292" height="148" rx="12"/>
<text class="sc-zone" x="650" y="192">STAGES OF LABOUR</text>
${stageRows}
<text class="sc-lab lb-fb1" x="650" y="352">Positive feedback</text>
<text class="sc-lab" x="650" y="372">stretch lifts oxytocin,</text>
<text class="sc-lab" x="650" y="390">contraction lifts stretch.</text>
<text class="sc-lab" x="650" y="408">It ends when the baby is born.</text>
<g id="uterusG">
<path id="wall" class="lb-wall" d="M170 152C170 92 430 92 430 152C430 232 410 292 386 332L376 356L224 356L214 332C190 292 170 232 170 152Z"/>
<path class="lb-cavity" d="M196 156C196 114 404 114 404 156C404 226 390 276 370 312L362 332L238 332L230 312C210 276 196 226 196 156Z"/>
<g id="placG"><path class="lb-plac" d="M386 152C400 192 398 238 380 268C370 232 372 186 386 152Z"/></g>
<path class="lb-memb" d="M238 162C272 132 338 136 362 176C378 222 368 284 340 318L262 318C232 282 224 204 238 162Z"/>
<g id="fetusG"><ellipse class="lb-fetus" cx="298" cy="202" rx="57" ry="45" transform="rotate(-18 298 202)"/><circle class="lb-fetus" cx="302" cy="296" r="35"/><circle class="lb-fetusH" cx="290" cy="284" r="11"/></g>
<g id="contrArcs" opacity="0"><path class="lb-arc" d="M238 108C268 92 332 92 362 108"/><path class="lb-arc" d="M222 124C258 102 342 102 378 124"/><path class="lb-arc" d="M252 92C276 80 324 80 348 92"/></g>
<g id="tocoMark" opacity="0"><circle class="lb-blk" cx="428" cy="128" r="13"/><path class="lb-blkL" d="M419 137L437 119"/></g>
</g>
<g id="cervixG">
<rect id="cxL" class="lb-cervix" x="262" y="352" width="28" height="42" rx="8"/>
<rect id="cxR" class="lb-cervix" x="310" y="352" width="28" height="42" rx="8"/>
<g id="stretchTicks" opacity="0"><path class="lb-tick" d="M252 360l-8 -5M252 376l-9 0M350 360l8 -5M350 376l9 0"/></g>
<path id="guideL" class="lb-canal" d="M272 396C266 414 262 426 258 438"/>
<path id="guideR" class="lb-canal" d="M328 396C334 414 338 426 342 438"/>
</g>
<circle class="lb-brain" cx="726" cy="112" r="30"/>
<path class="lb-brainL" d="M706 100C714 92 728 90 736 98M710 122C720 128 734 126 740 116"/>
<ellipse class="lb-pit" cx="726" cy="150" rx="9" ry="12"/>
<g id="parts"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.lb-wall{fill:color-mix(in srgb,var(--c-endo) 42%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:2}
.lb-cavity{fill:color-mix(in srgb,var(--c-fl) 13%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-endo) 60%,var(--anatomy-mid));stroke-width:1}
.lb-memb{fill:none;stroke:var(--c-fl);stroke-width:1.2;stroke-dasharray:4 3;opacity:.8}
.lb-fetus{fill:color-mix(in srgb,var(--c-donor) 68%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-donor) 60%,#000);stroke-width:1}
.lb-fetusH{fill:color-mix(in srgb,var(--c-donor) 35%,#fff);opacity:.7}
.lb-plac{fill:color-mix(in srgb,var(--c-bad) 62%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-bad) 60%,#000);stroke-width:1}
.lb-cervix{fill:color-mix(in srgb,var(--c-endo) 72%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.lb-canal{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4}
.lb-blood{fill:none;stroke:var(--c-cyt);stroke-width:1.3;stroke-dasharray:5 4;opacity:.55}
.lb-nerve{fill:none;stroke:var(--c-cyt2);stroke-width:1.3;stroke-dasharray:3 4;opacity:.6}
.lb-arc{fill:none;stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.lb-tick{fill:none;stroke:var(--c-fl);stroke-width:1.6;stroke-linecap:round}
.lb-brain{fill:color-mix(in srgb,var(--c-mac) 45%,var(--anatomy-paper));stroke:var(--c-mac);stroke-width:1.4}
.lb-brainL{fill:none;stroke:color-mix(in srgb,var(--c-mac) 65%,#000);stroke-width:1.1}
.lb-pit{fill:var(--c-cyt);stroke:color-mix(in srgb,var(--c-cyt) 55%,#000);stroke-width:.8}
.lb-box{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.lb-stageHi{fill:var(--anatomy-lit);opacity:.06}
.lb-stageT{pointer-events:none}
.lb-fb1{fill:var(--anatomy-strong);font-weight:700}
.lb-blk{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.8}
.lb-blkL{stroke:var(--c-bad);stroke-width:2.2;stroke-linecap:round}
.p-oxy{--cc:var(--c-cyt)}.p-pg{--cc:#ff9a3d}.p-nerve{--cc:var(--c-cyt2)}
.dr-g-fill.g-pg{fill:#ff9a3d}.dr-g-fill.g-oxy{fill:var(--c-cyt)}.dr-g-fill.g-str{fill:var(--c-fl)}
`;

buildScene({
  id: "labour-oxytocin", fig: "Fig 1", title: "Labour: stretch, oxytocin and prostaglandins", W, H, body, extraCss,
  label: "An animated uterus, cervix and birth canal with the feedback loop of labour. The presenting part stretches the cervix. Stretch signals travel to the hypothalamus, the posterior pituitary releases oxytocin, and oxytocin with prostaglandins from the membranes and decidua strengthens uterine contractions. Contractions push the presenting part down and stretch the cervix further, so the loop builds until delivery. Gauges show stretch, oxytocin, prostaglandins, contractions, cervical opening and descent. The stage slider moves through the stages of labour, and treatment choices include oxytocin augmentation and a tocolytic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "labour.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With oxytocin augmentation",
  sourcesLis: [
    "<strong>How labour is driven.</strong> As the presenting part descends it stretches the cervix and lower uterine segment. Stretch receptors send signals along pelvic nerves to the hypothalamus, and the posterior pituitary releases oxytocin in pulses: the Ferguson reflex. Oxytocin acts on myometrial oxytocin receptors, which become more numerous near term, and the uterus contracts from the fundus down. Stretched membranes and decidua also release prostaglandins, which soften and ripen the cervix, increase gap junctions between muscle cells and make the myometrium more sensitive to oxytocin. Each contraction increases stretch, so oxytocin release and contraction strength build in positive feedback until the baby is born, after which the stimulus falls away. This is standard teaching in physiology and obstetrics texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Oxytocin augmentation strengthens contractions when labour is slow. A tocolytic calms uterine contraction, shown here only as a teaching contrast. These are teaching toggles only.",
  ],
  simplified: "Fetal endocrine signals that help time the onset of labour, cervical scoring, pain pathways and analgesia, fetal monitoring, malpresentation, obstruction, uterine rupture, postpartum haemorrhage management, and all doses and clinical thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any person should be treated.",
});
