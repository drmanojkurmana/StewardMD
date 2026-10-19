/* Malaria life cycle as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/malaria.mjs [--print-model]
 * Static layout here; sporozoites, liver stage, red-cell cycle, fever trace and gauges move in malaria.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Species and severity", a: [0, 1, 2], names: ["P. vivax (relapsing)", "P. falciparum (uncomplicated)", "P. falciparum (severe)"], ticks: ["vivax", "falciparum", "severe"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "blood schizonticide (for example an artemisinin combination)" },
    { label: "primaquine-type drug only" },
    { label: "chemoprophylaxis (blood-stage cover)" },
    { label: "radical cure (blood schizonticide plus primaquine-type)" },
  ],
  status: "{level} · {drug} ·",
  drugNames: ["no treatment", "a blood schizonticide", "a primaquine-type drug alone", "chemoprophylaxis", "radical cure"],
};
function modelOf(S, level, drug) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const base = [0.45, 0.5, 0.95][level], vivax = level === 0, severe = level === 2;
  const blood = drug === 1 || drug === 3 || drug === 4 ? 1 : 0, pq = drug === 2 || drug === 4 ? 1 : 0;
  const Pa = blood ? base * (drug === 3 ? 0.06 : 0.1) : base;
  const Hy = vivax ? (pq ? 0.02 : 0.85) : 0;
  const Gm = cl([0.5, 0.7, 0.75][level] * (blood ? 0.6 : 1) * (pq ? 0.1 : 1));
  const An = cl(0.08 + 0.85 * Pa * (severe ? 1 : 0.7));
  const F = cl(0.1 + 0.9 * Pa);
  const Sv = cl(Pa * [0.1, 0.25, 1][level]);
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(Pa, 0.15, 0.55, ["cleared", "moderate", "heavy"]), w(F, 0.25, 0.7, ["no fever", "periodic fever", "high periodic fever"]), w(Hy, 0.05, 0.4, ["none", "low", "high"])];
  return { Pa, Hy, Gm, An, F, Sv, blood, pq, prophy: drug === 3 ? 1 : 0, words, readout: "parasites " + words[0] + " · " + words[1] + " · relapse risk " + words[2] };
}
const TESTS = [
  [0, 0, "parasites moderate · periodic fever · relapse risk high"],
  [0, 1, "parasites cleared · no fever · relapse risk high"],
  [0, 4, "parasites cleared · no fever · relapse risk none"],
  [2, 0, "parasites heavy · high periodic fever · relapse risk none"],
];

/* ---------------- static layout ---------------- */
const CY = 372, HH = 46;
const body = `
<rect class="mal-zone" x="14" y="44" width="236" height="210" rx="16"/>
<rect class="mal-zone mal-liver" x="262" y="44" width="378" height="210" rx="16"/>
<rect class="mal-zone" x="652" y="44" width="294" height="210" rx="16"/>
<rect class="mal-zone mal-blood" x="14" y="266" width="${W - 28}" height="176" rx="16"/>
<g id="liverSlot"></g>
<g id="mosq"></g>
<rect class="mal-lumen" x="14" y="${CY - HH}" width="${W - 28}" height="${HH * 2}"/>
<rect id="calm" class="mal-calm" x="14" y="${CY - HH}" width="${W - 28}" height="${HH * 2}" opacity="0"/>
<path class="mal-wall" d="M14 ${CY - HH}H${W - 14}M14 ${CY + HH}H${W - 14}"/>
<g id="routes"></g><g id="liver"></g><g id="rbcs"></g><g id="parts"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "malaria-life-cycle", fig: "Fig 1", title: "Malaria: the parasite life cycle", W, H, body,
  label: "An animated malaria life cycle. A mosquito injects sporozoites, which travel to the liver and infect liver cells. The liver stage releases merozoites into the blood, where they invade red cells and repeat a cycle of ring, trophozoite and schizont that bursts the cell and causes a fever paroxysm. Some parasites become gametocytes taken up by a mosquito. Vivax can also leave dormant hypnozoites in the liver. Gauges show parasites, anaemia, fever, hypnozoite reservoir and severity.",
  caption: "Schematic, not to scale. Timing, counts and gauge levels are qualitative and illustrative; no doses, schedules or numbers are shown or implied.",
  scene: { CY, HH, W, H }, pageJs: readFileSync(join(HERE, "malaria.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With radical cure",
  extraCss: `
.mal-zone{fill:var(--c-tis);opacity:.5}.mal-liver{fill:color-mix(in srgb,#b36b3a 30%,var(--c-tis))}.mal-blood{fill:color-mix(in srgb,var(--c-rbc) 8%,var(--c-tis))}
.mal-lumen{fill:color-mix(in srgb,var(--c-rbc) 16%,var(--anatomy-paper))}.mal-calm{fill:var(--c-good)}.mal-wall{fill:none;stroke:var(--c-endo);stroke-width:3;opacity:.8}
.p-spz{fill:var(--c-bac);stroke:color-mix(in srgb,var(--c-bac) 50%,#000);stroke-width:.5}
.p-mer{fill:#ff9a3d}.p-gam{fill:#b46ad9}.p-par{fill:none;stroke:#8a5cd6;stroke-width:2.2}.p-pig{fill:#3a2a1a}.p-dot{fill:#8a5cd6}
.p-hyp{fill:#3a2a1a;stroke:#b36b3a;stroke-width:1.2}.p-pillm{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}.p-pillm2{fill:var(--c-good)}
.mal-mark{fill:var(--anatomy-paper);stroke:var(--c-bad);stroke-width:1.6}.mal-markx{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.mal-door{fill:none;stroke:var(--c-good);stroke-width:2;stroke-dasharray:5 3}
.mal-temp{fill:none;stroke:var(--c-bad);stroke-width:2;stroke-linejoin:round}.mal-norm{stroke:var(--anatomy-mid);stroke-dasharray:3 4;stroke-width:1}
.mal-gut{fill:color-mix(in srgb,#8a8f9c 35%,var(--anatomy-paper));stroke:var(--anatomy-mid)}.mal-gland{fill:color-mix(in srgb,var(--c-bac) 25%,var(--anatomy-paper));stroke:var(--anatomy-mid)}
.mal-body{fill:color-mix(in srgb,#8a8f9c 50%,var(--anatomy-paper));stroke:var(--anatomy-mid);stroke-width:1.2}.mal-wing{fill:var(--anatomy-card);stroke:var(--anatomy-mid);opacity:.7}
.mal-prob{fill:none;stroke:var(--anatomy-strong);stroke-width:2.4}.mal-leg{fill:none;stroke:var(--anatomy-mid);stroke-width:1.6}
.mal-route{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-dasharray:3 5;opacity:.7}
`,
  sourcesLis: [
    "<strong>The life cycle.</strong> An infected female Anopheles mosquito injects sporozoites. They reach the liver within minutes and enter liver cells. There they multiply as a liver schizont (no symptoms), which bursts and releases merozoites into the blood. In P. vivax and P. ovale some liver forms stay dormant as hypnozoites and can reactivate weeks or months later, causing relapse. In the blood, merozoites invade red cells and pass through ring, trophozoite and schizont stages. The red cell bursts, releasing merozoites that infect new cells, and the pigment and cytokines released cause the periodic fever paroxysm. Some parasites become male and female gametocytes, which a mosquito takes up so the sexual cycle can continue. This is standard teaching in microbiology, medicine and tropical-medicine texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Severe falciparum malaria.</strong> Infected red cells stick to the lining of small vessels (cytoadherence and sequestration), including in the brain, and haemolysis causes anaemia. Treatment ideas shown are by class only: blood schizonticides clear the blood stage, primaquine-type drugs clear hypnozoites and gametocytes, and chemoprophylaxis covers the blood stage. These are teaching toggles only.",
  ],
  simplified: "Species other than vivax and falciparum, drug resistance, G6PD testing before primaquine-type drugs, pregnancy and child dosing, severe-malaria management, vector control and vaccines, and all doses and schedules are left out. Counts, timing and gauge levels are illustrative, and the figure does not say how any patient should be treated.",
});
