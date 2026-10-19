/* Haemolytic anaemia and G6PD deficiency as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/haemol.mjs [--print-model]
 * Static layout here; cells, particles and gauges move in haemol.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Haemolysis driver", a: [0.65, 0.75, 1], names: ["G6PD trigger", "autoimmune", "severe haemolysis"], ticks: ["G6PD trigger", "autoimmune", "severe"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment" },
    { label: "remove the trigger" },
    { label: "steroid (for autoimmune)" },
    { label: "transfusion and splenectomy" },
  ],
  status: "Driver: {level} · {drug} ·",
  drugNames: ["no treatment", "trigger removed", "a steroid", "transfusion and splenectomy"],
};
function modelOf(S, level, drug) {
  const base = S.level.a[level], cl = (v) => Math.max(0, Math.min(1, v));
  const eff = [[0, 0, 0], [0.85, 0.2, 0.15], [0.05, 0.8, 0.45], [0.1, 0.3, 0.25]][drug][level];
  const intraFrac = [0.45, 0.2, 0.5][level];
  const H = cl(base * (1 - eff));
  const Intra = cl(H * intraFrac);
  const ExtraRaw = cl(H * (1 - intraFrac));
  const Extra = cl(ExtraRaw * (drug === 3 ? 0.45 : 1));
  const EffH = cl(Intra + Extra);
  const Bili = cl(0.08 + 0.9 * EffH);
  const Retic = cl(0.08 + 0.82 * EffH - (drug === 3 ? 0.08 : 0));
  const Spleen = drug === 3 ? 0.08 : cl(0.18 + 0.9 * Extra);
  const Ana = cl(0.02 + 0.78 * EffH - 0.34 * Retic - (drug === 3 ? 0.3 : 0));
  const Ox = cl([0.9, 0.1, 0.65][level] * (1 - eff));
  const Ab = cl([0.1, 0.95, 0.65][level] * (1 - eff));
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(EffH, 0.25, 0.7, ["low", "raised", "high"]), w(Bili, 0.3, 0.7, ["normal", "raised", "high"]), w(Retic, 0.3, 0.65, ["low", "raised", "high"]), w(Ana, 0.2, 0.45, ["mild", "moderate", "severe"])];
  return { base, eff, H, Intra, Extra, ExtraRaw, EffH, Bili, Retic, Spleen, Ana, Ox, Ab, Heinz: Ox, Coat: Ab, mode: level, drug, words, readout: "haemolysis " + words[0] + " · bilirubin " + words[1] + " · reticulocytes " + words[2] + " · anaemia " + words[3] };
}
const TESTS = [
  [0, 0, "haemolysis raised · bilirubin raised · reticulocytes raised · anaemia moderate"],
  [0, 1, "haemolysis low · bilirubin normal · reticulocytes low · anaemia mild"],
  [1, 2, "haemolysis low · bilirubin normal · reticulocytes low · anaemia mild"],
  [2, 0, "haemolysis high · bilirubin high · reticulocytes high · anaemia severe"],
];

/* ---------------- static layout ---------------- */
const CY = 260;
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<g id="marrowG"><rect class="hm-marrow" x="30" y="70" width="190" height="120" rx="16"/><circle class="hm-prog" cx="70" cy="105" r="9"/><circle class="hm-prog" cx="105" cy="130" r="11"/><circle class="hm-prog" cx="145" cy="102" r="8"/><circle class="hm-prog" cx="175" cy="135" r="10"/><circle class="hm-prog" cx="125" cy="160" r="9"/></g>
<path class="hm-marrow-out" d="M125 190L125 218"/>
<g id="heinzG"><ellipse class="hm-inset" cx="360" cy="132" rx="36" ry="24"/><circle class="hm-heinz" cx="348" cy="124" r="4.5"/><circle class="hm-heinz" cx="366" cy="138" r="5"/><circle class="hm-heinz" cx="376" cy="120" r="3.6"/></g>
<g id="abG"><ellipse class="hm-inset" cx="530" cy="132" rx="36" ry="24"/><path class="hm-abY" d="M500 118L508 126M508 126L506 136M508 126L516 120"/><path class="hm-abY" d="M552 142L544 134M544 134L546 124M544 134L536 140"/><path class="hm-abY" d="M530 106L530 116M530 116L524 124M530 116L536 124"/></g>
<rect id="lumen" class="sc-lumen" x="14" y="${CY - 38}" width="${W - 28}" height="76"/>
<rect class="hm-wall" x="14" y="${CY - 42}" width="${W - 28}" height="5"/>
<rect class="hm-wall" x="14" y="${CY + 37}" width="${W - 28}" height="5"/>
<g id="spleenSlot"></g>
<g id="liverSlot"></g>
<g id="treatG"></g>
<g id="rbcs"></g><g id="doomed"></g><g id="parts"></g><g id="phag"></g><g id="over"></g><g id="panel"></g>`;

const extraCss = `
.hm-marrow{fill:color-mix(in srgb,var(--c-endo) 30%,var(--anatomy-paper));stroke:var(--c-endo);stroke-width:1}
.hm-prog{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:.7}
.hm-marrow-out{fill:none;stroke:var(--c-endo);stroke-width:2;stroke-dasharray:3 4;opacity:.6}
.hm-trig{fill:#ff9a3d;stroke:#a85e14;stroke-width:1}
.hm-lid{fill:none;stroke:var(--c-bad);stroke-width:3;stroke-linecap:round}
.hm-lid-ring{fill:none;stroke:var(--c-bad);stroke-width:1.6;opacity:.8}
.hm-bag{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-paper));stroke:color-mix(in srgb,var(--c-rbc) 60%,#000);stroke-width:1.2}
.hm-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:2}
.hm-drop{fill:var(--c-rbc);stroke:none}
.hm-ghost{fill:none;stroke:var(--anatomy-mid);stroke-width:1.4;stroke-dasharray:6 5}
.hm-ring{fill:none;stroke:#4fae9e;stroke-width:1.4}
.hm-cap{fill:var(--anatomy-strong)}
.hm-inset{fill:var(--c-rbc);stroke:color-mix(in srgb,var(--c-rbc) 55%,#000);stroke-width:1}
.hm-heinz{fill:#24122e;stroke:#120818;stroke-width:.6}
.hm-abY{fill:none;stroke:var(--c-ab);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.hm-wall{fill:var(--c-endo);opacity:.75}
.hm-retic-dot{fill:#5b2a86}
.p-ox{--cc:#ff9a3d}.p-hb{--cc:var(--c-rbc)}.p-bili{--cc:#e8c832}
.p-ster{fill:var(--anatomy-paper);stroke:var(--anatomy-mid);stroke-width:.6}
.p-ster2{fill:#4fae9e}
.dr-g-fill.g-haem{fill:var(--c-bad)}.dr-g-fill.g-bili{fill:#d9b51f}.dr-g-fill.g-retic{fill:var(--c-good)}.dr-g-fill.g-spleen{fill:#b04a5a}.dr-g-fill.g-ana{fill:var(--c-bad)}
.hm-burst{fill:none;stroke:var(--c-bad);stroke-width:1.4}
`;

buildScene({
  id: "haemolytic-anaemia-g6pd", fig: "Fig 1", title: "Haemolytic anaemia: red cell destruction", W, H, body, extraCss,
  label: "An animated blood vessel, bone marrow, spleen and liver. Red cells are destroyed inside the vessel or taken to the spleen and eaten there. In G6PD deficiency an oxidant trigger damages red cells and forms Heinz bodies. In warm autoimmune haemolysis antibody coats red cells for splenic removal. Breakdown raises unconjugated bilirubin toward the liver, the marrow answers with reticulocytes, and the spleen enlarges. Gauges show haemolysis, bilirubin, reticulocytes, spleen size and anaemia. Treatments remove the trigger, give a steroid, or transfuse with splenectomy.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or values are shown or implied.",
  scene: { CY, W, H }, pageJs: readFileSync(join(HERE, "haemol.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without treatment", withLabel: "With transfusion and splenectomy",
  sourcesLis: [
    "<strong>How red cells are destroyed.</strong> Haemolysis is shortened red cell survival. Extravascular haemolysis is mainly removal of rigid, damaged or antibody coated red cells by macrophages in the spleen. Intravascular haemolysis is rupture inside the vessel, releasing haemoglobin into plasma. Breakdown of haem raises unconjugated bilirubin, which travels to the liver; the marrow responds with reticulocytosis, and chronic splenic removal can enlarge the spleen. This is standard teaching in haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>G6PD deficiency and warm antibody disease.</strong> In G6PD deficiency, oxidant stress from a trigger injures red cells, denatured haemoglobin forms Heinz bodies, and rigid cells are pitted and removed in the spleen or burst in the vessel. In warm autoimmune haemolytic anaemia, warm reactive antibody coats red cells and splenic macrophages remove them. Removing an oxidant trigger, steroids for autoimmune disease, transfusion support and splenectomy in selected cases are shown only as teaching toggles for which step each acts on.",
  ],
  simplified: "Haptoglobin, lactate dehydrogenase, urinary findings, direct antiglobulin testing, blood film details beyond Heinz bodies, cold antibody disease, inherited membrane and enzyme defects other than G6PD, infection and drug lists, and all doses and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
