/* Hypertensive emergency as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/htnemerg.mjs [--print-model]
 * Static layout here; flow, wall injury and organ damage move in htnemerg.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "How severe the pressure rise is", a: [0.4, 0.75, 1], names: ["urgency", "emergency", "malignant"], ticks: ["urgency", "emergency", "malignant"], start: 1 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "controlled gradual reduction" },
    { label: "organ-specific therapy" },
    { label: "oral therapy for urgency" },
  ],
  status: "Severity: {level} · {drug} ·",
  drugNames: ["no treatment", "controlled gradual reduction", "organ-specific therapy", "oral therapy for urgency"],
};
function modelOf(S, level, drug) {
  const a = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const eff = { grad: drug === 1 ? 1 : 0, organ: drug === 2 ? 1 : 0, oral: drug === 3 ? [0.8, 0.25, 0.1][level] : 0 };
  const P = cl(a * (1 - 0.52 * eff.grad - 0.18 * eff.organ - 0.55 * eff.oral));
  const B = cl((P - 0.32) * 1.55);
  const E = cl(B * 1.05 - 0.08 * eff.grad);
  const F = cl((E - 0.3) * 1.7);
  const O = cl(0.08 + 0.55 * F + 0.4 * B - 0.42 * eff.organ - 0.18 * eff.grad - 0.12 * eff.oral);
  const Perf = cl(1 - 0.85 * O);
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(P, 0.35, 0.65, ["lower", "high", "very high"]), w(F, 0.2, 0.5, ["intact", "injured", "necrotic"]), w(O, 0.25, 0.55, ["settled", "threatened", "damaged"])];
  return { a, grad: eff.grad, organ: eff.organ, oral: eff.oral, P, B, E, F, O, Perf, words, readout: "pressure " + words[0] + " · vessel wall " + words[1] + " · organs " + words[2] };
}
const TESTS = [
  [0, 0, "pressure high · vessel wall intact · organs settled"],
  [1, 0, "pressure very high · vessel wall necrotic · organs damaged"],
  [2, 0, "pressure very high · vessel wall necrotic · organs damaged"],
  [0, 3, "pressure lower · vessel wall intact · organs settled"],
];

/* ---------------- static layout ---------------- */
const CY = 200;
const body = `
<rect class="sc-tissue" x="14" y="44" width="540" height="396" rx="18"/>
<rect class="sc-tissue" x="566" y="44" width="380" height="396" rx="18"/>
<text class="sc-zone" x="34" y="68">ARTERIOLE UNDER PRESSURE</text>
<text class="sc-zone" x="586" y="68">TARGET ORGANS</text>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 38}" width="540" height="76"/>
<g id="rbcs"></g><g id="endo"></g><g id="fib"></g><g id="parts"></g>
<path class="htn-axl" d="M70 402H505M70 402V298"/>
<path class="htn-curve" d="M70 378L215 372C300 370 360 366 410 342C450 324 475 312 500 306"/>
<circle id="curvedot" class="htn-dot" cx="215" cy="372" r="6"/>
<text class="htn-ax" x="500" y="420" text-anchor="end">pressure rises</text>
<text class="htn-ax" x="62" y="308" text-anchor="middle" transform="rotate(-90 62 355)">flow to tissue</text>
<text class="htn-cap2" x="78" y="292">Autoregulation holds flow steady, then is overwhelmed</text>
<g class="hot" tabindex="0" data-info="Brain: pressure breakthrough swells the brain and confuses or fits the patient. This is hypertensive encephalopathy.">
<circle class="htn-org htn-brain" cx="660" cy="138" r="34"/><path class="htn-fold" d="M640 122c10-10 22-4 24 6M662 152c12 6 24-2 24-14M646 158c-10-4-12-18-4-26"/>
<path id="dmg-brain" class="htn-dmg" d="M646 116l8 14l-6 10l10 12M676 120l-6 12l8 10"/></g>
<text class="htn-cap" x="660" y="190">Brain</text><text class="htn-sub" x="660" y="205">encephalopathy</text>
<g class="hot" tabindex="0" data-info="Kidney: fibrinoid necrosis of small kidney arteries cuts filtration and can cause acute kidney injury.">
<ellipse class="htn-org htn-kidney" cx="852" cy="138" rx="30" ry="38" transform="rotate(18 852 138)"/><path class="htn-fold" d="M846 112c-8 16-8 34 2 52"/>
<path id="dmg-kidney" class="htn-dmg" d="M838 118l10 12l-8 12M862 130l-8 10l8 12"/></g>
<text class="htn-cap" x="852" y="190">Kidney</text><text class="htn-sub" x="852" y="205">acute injury</text>
<g class="hot" tabindex="0" data-info="Heart: the left ventricle strains against very high pressure, which can bring heart failure and chest pain.">
<path class="htn-org htn-heart" d="M660 238c-26-24-52 2-40 26c8 16 26 26 40 36c14-10 32-20 40-36c12-24-14-50-40-26Z"/>
<path id="dmg-heart" class="htn-dmg" d="M644 252l10 12l-6 12M676 250l-8 14l8 10"/></g>
<text class="htn-cap" x="660" y="322">Heart</text><text class="htn-sub" x="660" y="337">strain and failure</text>
<g class="hot" tabindex="0" data-info="Aorta: high pressure can tear the inner lining of the aorta. A dissection is a surgical emergency.">
<rect class="htn-org htn-aorta" x="834" y="232" width="36" height="70" rx="16"/><path class="htn-flap" d="M852 238v58"/>
<path id="dmg-aorta" class="htn-dmg" d="M852 244l10 14l-12 14l8 16"/></g>
<text class="htn-cap" x="852" y="322">Aorta</text><text class="htn-sub" x="852" y="337">tear or dissection</text>
<g class="hot" tabindex="0" data-info="Retina: swollen optic disc (papilloedema) with flame haemorrhages and exudates marks malignant hypertension in the eye.">
<ellipse class="htn-org htn-eye" cx="756" cy="382" rx="52" ry="24"/><circle class="htn-iris" cx="756" cy="382" r="13"/><circle class="htn-disc" cx="782" cy="382" r="7"/>
<path id="dmg-retina" class="htn-dmg" d="M724 372l12 8M788 392l10-6M734 394l10-8"/></g>
<text class="htn-cap" x="756" y="424">Retina</text><text class="htn-sub" x="756" y="438">papilloedema</text>
<g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "hypertensive-emergency", fig: "Fig 1", title: "Hypertensive emergency: pressure overwhelms autoregulation", W, H, body,
  label: "An animated arteriole and target organs in severe hypertension. Rising pressure first triggers autoregulatory narrowing, then overwhelms it: flow breaks through, the endothelium is injured, fibrinoid necrosis weakens the wall, and the brain, kidney, heart, aorta and retina are damaged. Gauges show pressure, breakthrough flow, wall injury, fibrinoid necrosis, organ damage and perfusion. Treatment choices are controlled gradual reduction, organ-specific therapy and oral therapy for urgency.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, targets or numbers are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "htnemerg.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>How a hypertensive emergency develops.</strong> When pressure rises, small arteries narrow to protect the tissue beyond them (autoregulation). If pressure rises too far or too fast, that protection is overwhelmed: the vessel is forced open, flow and pressure break through to fragile capillaries, the endothelium is injured, plasma proteins and fibrin enter the wall (fibrinoid necrosis), and the wall weakens and leaks. Target organs then fail: brain swelling (encephalopathy), acute kidney injury, heart strain and failure, a torn aorta, and retinal damage with a swollen optic disc (papilloedema). Malignant hypertension is the form with that eye picture. This is standard teaching in medicine and cardiology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> In an emergency the pressure is lowered in a controlled, gradual way so organ perfusion is not lost, alongside therapy aimed at the damaged organ. Urgency without organ damage is usually managed with oral therapy and close follow up. These are teaching toggles only.",
  ],
  simplified: "Secondary causes of hypertension, chronic autoregulatory resetting, drug choice, infusion agents, exact reduction targets and timing, pregnancy, and organ-specific procedures are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
  extraCss: `
.htn-axl{stroke:var(--anatomy-mid);stroke-width:1.2;fill:none}
.htn-curve{stroke:var(--c-fl);stroke-width:2.4;fill:none;stroke-linecap:round}
.htn-dot{fill:var(--c-bad);stroke:var(--anatomy-paper);stroke-width:1.4}
.htn-ax{fill:var(--anatomy-text);font-size:10px}
.htn-cap2{fill:var(--anatomy-strong);font-size:10.5px;font-weight:600}
.htn-cap{fill:var(--anatomy-strong);font-size:11px;font-weight:600;text-anchor:middle}
.htn-sub{fill:var(--anatomy-text);font-size:9.5px;text-anchor:middle}
.htn-org{stroke-width:1.2}
.htn-brain{fill:#e9a2b3;stroke:#b45a74}
.htn-kidney{fill:#c9788a;stroke:#8f3f55}
.htn-heart{fill:#d63a4a;stroke:#8f1f2c}
.htn-aorta{fill:#e07856;stroke:#9c4526}
.htn-eye{fill:#f2ead8;stroke:#9a8a68}
.htn-iris{fill:#5fa8d3;stroke:#2f6a94;stroke-width:1}
.htn-disc{fill:#f6c453;stroke:#b98a1f;stroke-width:1}
.htn-fold{fill:none;stroke:#8f3f55;stroke-width:1.4;opacity:.65}
.htn-flap{fill:none;stroke:#7a2d16;stroke-width:1.6}
.htn-dmg{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linecap:round;opacity:0}
.htn-fibp{fill:var(--c-bad);stroke:#7a161c;stroke-width:.8}
.p-surge{fill:none;stroke:var(--c-bad);stroke-width:1.6}
.p-leak2{fill:var(--c-fl)}
.dr-g-fill.g-break{fill:var(--c-fl)}
.dr-g-fill.g-wall{fill:var(--c-cyt)}
.dr-g-fill.g-fib{fill:var(--c-plt)}
`,
});
