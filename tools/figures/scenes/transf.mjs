/* Blood transfusion reactions as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/transf.mjs [--print-model]
 * Static layout here; the six reaction mechanisms and gauges animate in transf.page.js. Qualitative: no doses, no numbers. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ----------------
 * level = reaction type: 0 ABO acute haemolytic, 1 febrile non-haemolytic,
 * 2 allergic / anaphylactic, 3 TRALI, 4 TACO, 5 delayed haemolytic.
 * drug (treatment): 0 none, 1 stop, 2 stop+fluids, 3 stop+antihistamine/steroid,
 * 4 stop+diuretic. All treatments from 1 on include stopping the transfusion. */
const MD = {
  level: { label: "Reaction type", a: [0, 1, 2, 3, 4, 5], names: ["ABO acute haemolytic", "febrile non-haemolytic", "allergic / anaphylactic", "TRALI", "TACO", "delayed haemolytic"], ticks: ["ABO acute", "febrile", "allergic", "TRALI", "TACO", "delayed"], start: 0 },
  drugLabel: "Treatment",
  settings: [
    { label: "no treatment (transfusion continues)" },
    { label: "stop the transfusion" },
    { label: "stop transfusion and give fluids" },
    { label: "stop transfusion, antihistamine and steroid" },
    { label: "stop transfusion and give a diuretic" },
  ],
  status: "Reaction: {level} · {drug} ·",
  drugNames: ["no treatment", "transfusion stopped", "transfusion stopped with fluids", "transfusion stopped with antihistamine and steroid", "transfusion stopped with a diuretic"],
};
function modelOf(S, level, drug) {
  const t = S.level.a[level];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const R0 = [0.95, 0.55, 0.9, 0.85, 0.35, 0.65][t];
  const H0 = [0.95, 0.05, 0.08, 0.08, 0.04, 0.8][t];
  const L0 = [0.18, 0.05, 0.5, 0.95, 0.95, 0.05][t];
  const C0 = [0.9, 0.3, 0.7, 0.75, 0.9, 0.35][t];
  const redR = [[0, 0, 0, 0, 0, 0], [0.55, 0.6, 0.6, 0.5, 0.4, 0.1], [0.6, 0.6, 0.6, 0.5, 0.35, 0.15], [0.65, 0.7, 0.85, 0.55, 0.4, 0.25], [0.55, 0.6, 0.6, 0.5, 0.45, 0.1]][drug][t];
  const redH = [[0, 0, 0, 0, 0, 0], [0.5, 0, 0, 0, 0, 0.05], [0.55, 0, 0, 0, 0, 0.1], [0.5, 0, 0.1, 0, 0, 0.15], [0.45, 0, 0, 0, 0, 0.05]][drug][t];
  const dL = [[0, 0, 0, 0, 0, 0], [-0.05, 0, -0.1, -0.05, -0.1, 0], [0, 0, -0.05, 0.18, 0.22, 0], [-0.05, 0, -0.35, -0.05, -0.05, 0], [-0.02, 0, -0.08, -0.06, -0.55, 0]][drug][t];
  const dC = [[0, 0, 0, 0, 0, 0], [-0.2, -0.1, -0.25, -0.1, -0.2, -0.02], [-0.45, -0.15, -0.35, 0.1, 0.2, -0.08], [-0.25, -0.2, -0.5, -0.15, -0.2, -0.05], [0.15, -0.05, -0.2, -0.05, -0.55, 0.05]][drug][t];
  const R = cl(R0 * (1 - redR)), H = cl(H0 * (1 - redH)), L = cl(L0 + dL), C = cl(C0 + dC);
  const Sv = cl(0.35 * R + 0.25 * H + 0.2 * L + 0.2 * C);
  const w = (v, a, b, ws) => (v < a ? ws[0] : v < b ? ws[1] : ws[2]);
  const words = [w(R, 0.25, 0.6, ["low", "moderate", "high"]), w(H, 0.2, 0.55, ["little", "some", "marked"]), w(L, 0.25, 0.6, ["little", "some", "marked"]), w(Sv, 0.25, 0.55, ["mild", "moderate", "severe"])];
  return { type: t, drug, R, H, L, C, S: Sv, words, readout: "reaction " + words[0] + " · haemolysis " + words[1] + " · lung fluid " + words[2] + " · severity " + words[3] };
}
const TESTS = [
  [0, 0, "reaction high · haemolysis marked · lung fluid little · severity severe"],
  [0, 2, "reaction moderate · haemolysis some · lung fluid little · severity moderate"],
  [2, 3, "reaction low · haemolysis little · lung fluid little · severity mild"],
  [4, 4, "reaction low · haemolysis little · lung fluid some · severity mild"],
  [4, 2, "reaction low · haemolysis little · lung fluid marked · severity moderate"],
  [3, 4, "reaction moderate · haemolysis little · lung fluid marked · severity moderate"],
];

/* ---------------- static layout ---------------- */
const CARDS = [
  ["ABO ACUTE", "minutes", "IgM, complement"],
  ["FEBRILE", "during, hours", "anti-leucocyte, cytokines"],
  ["ALLERGIC", "minutes", "donor plasma, histamine"],
  ["TRALI", "within hours", "lung capillary leak"],
  ["TACO", "during, hours", "volume overload"],
  ["DELAYED", "days later", "IgG, spleen"],
];
const cards = CARDS.map((c, i) => { const x = 22 + i * 154;
  return `<g class="hot sc-card" id="card${i}" tabindex="0" data-info="${esc(["ABO incompatibility: recipient IgM against donor A or B antigen fixes complement and bursts donor red cells inside vessels within minutes.", "Febrile non-haemolytic reaction: recipient antibody to donor white cells, and cytokines stored in the unit, cause fever and rigors without haemolysis.", "Allergic reaction: recipient responds to donor plasma proteins. Histamine causes urticaria and flushing; severe cases progress to anaphylaxis.", "TRALI, transfusion-related acute lung injury: donor anti-leucocyte antibodies activate neutrophils in lung capillaries, which leak protein-rich fluid into alveoli. Breathing fails without volume overload.", "TACO, transfusion-associated circulatory overload: transfused volume raises filling pressures in a susceptible heart, causing cardiogenic pulmonary oedema.", "Delayed haemolytic reaction: an anamnestic IgG response to a minor red-cell antigen days later coats donor cells, which the spleen removes. Jaundice and a falling haemoglobin follow."][i])}"><rect class="sc-card-r" x="${x}" y="46" width="146" height="72" rx="12"/><text class="sc-zone" x="${x + 10}" y="66">${esc(c[0])}</text><text class="sc-lab" x="${x + 10}" y="86">${esc(c[1])}</text><text class="sc-lab sc-dim2" x="${x + 10}" y="104">${esc(c[2])}</text></g>`; }).join("");
const body = `
<rect class="sc-tissue" x="14" y="126" width="${W - 28}" height="316" rx="18"/>
${cards}
<g id="stage"></g>
<g id="over"></g>
<g id="panel"></g>`;

const extraCss = `
.sc-card-r{fill:var(--anatomy-card);stroke:var(--anatomy-faint);stroke-width:1}
.sc-card.on .sc-card-r{stroke:var(--anatomy-lit);stroke-width:2;fill:color-mix(in srgb,var(--anatomy-lit) 10%,var(--anatomy-card))}
.sc-dim2{opacity:.75}
.p-hb{--cc:#ff7a45}.p-cytk{--cc:var(--c-cyt)}.p-hist{--cc:#ff5e8a}.p-comp{--cc:#7fd3ff}.p-bili{--cc:#ffd24a}.p-oxy{--cc:#7fd3ff}.p-gran{--cc:#c978c9}
.ab-p{fill:none;stroke:var(--c-ab);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ab-igm{fill:none;stroke:#ff9a3d;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ag{fill:#ff9a3d;stroke:color-mix(in srgb,#ff9a3d 50%,#000);stroke-width:.5}
.tf-bag{fill:color-mix(in srgb,var(--c-rbc) 30%,var(--anatomy-card));stroke:var(--c-rbc);stroke-width:1.2}
.tf-tube{fill:none;stroke:var(--anatomy-mid);stroke-width:2.4;stroke-linecap:round}
.tf-clamp{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.6}
.tf-alv{fill:color-mix(in srgb,var(--c-fl) 12%,var(--anatomy-card));stroke:var(--c-endo);stroke-width:1.4}
.tf-cap{fill:none;stroke:var(--c-rbc);stroke-width:5;stroke-linecap:round;opacity:.55}
.tf-fluid{fill:var(--c-fl)}
.tf-therm{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}
.tf-merc{fill:var(--c-bad)}
.tf-skin{fill:color-mix(in srgb,var(--c-endo) 45%,var(--anatomy-card));stroke:var(--c-endo);stroke-width:1}
.tf-wheal{fill:#ff5e8a;opacity:.5}
.tf-heart{fill:color-mix(in srgb,var(--c-rbc) 55%,var(--anatomy-card));stroke:var(--c-rbc);stroke-width:1.2}
.tf-kid{fill:color-mix(in srgb,var(--c-graft) 60%,var(--anatomy-card));stroke:var(--c-graft);stroke-width:1.1}
.mk-c{fill:var(--anatomy-card);stroke:var(--c-bad);stroke-width:1.4}.mk-x{fill:none;stroke:var(--c-bad);stroke-width:1.8;stroke-linecap:round}
.mk-g{fill:none;stroke:var(--c-good);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.clk{fill:var(--anatomy-card);stroke:var(--anatomy-mid);stroke-width:1.2}.clk-h{stroke:var(--anatomy-strong);stroke-width:2;stroke-linecap:round}
.dmg{fill:var(--c-bad)}
`;

buildScene({
  id: "transfusion-reactions", fig: "Fig 1", title: "Blood transfusion reactions", W, H, body, extraCss,
  label: "An animated set of six transfusion reactions. ABO incompatibility bursts donor red cells through complement. A febrile reaction follows antibody to donor white cells and stored cytokines. An allergic reaction releases histamine to donor plasma proteins. TRALI leaks fluid into alveoli through injured lung capillaries. TACO floods the lungs from volume overload. A delayed reaction removes antibody-coated donor cells in the spleen days later. Gauges show reaction activity, haemolysis, lung fluid and severity. Treatment choices are stopping the transfusion, fluids, antihistamine with steroid, and a diuretic.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or numbers are shown or implied.",
  scene: { W }, pageJs: readFileSync(join(HERE, "transf.page.js"), "utf8"), modelOf, MD, tests: TESTS,
  withoutLabel: "Without treatment", withLabel: "With treatment",
  sourcesLis: [
    "<strong>ABO acute haemolytic reaction.</strong> Preformed recipient IgM against donor A or B antigens fixes complement on donor red cells, causing rapid intravascular haemolysis, free haemoglobin, hypotension, disseminated intravascular coagulation and kidney injury. Fever, flank pain and dark urine are classic teaching features. This is standard teaching in transfusion medicine and haematology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Febrile and allergic reactions.</strong> Febrile non-haemolytic reactions follow recipient antibody to donor leucocytes and cytokines that accumulate in stored components, producing fever and rigors without haemolysis. Allergic reactions follow recipient responses to donor plasma proteins, with histamine-mediated urticaria and flushing; severe reactions can progress to anaphylaxis with airway swelling and bronchospasm. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>TRALI and TACO.</strong> In TRALI (transfusion-related acute lung injury), donor anti-leucocyte antibodies and other mediators activate neutrophils sequestered in lung capillaries; the injured capillary leaks protein-rich fluid into alveoli, causing hypoxaemia without circulatory overload. In TACO (transfusion-associated circulatory overload), transfused volume raises cardiac filling pressures, especially with cardiac or renal susceptibility, causing cardiogenic pulmonary oedema with raised venous pressure and hypertension. Telling them apart matters because a diuretic helps TACO and not TRALI. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Delayed haemolytic reaction.</strong> A previously sensitised recipient mounts an anamnestic IgG response to a minor donor red-cell antigen (classically Kidd) days after transfusion. Antibody-coated donor cells are removed extravascularly, mainly in the spleen, with jaundice, fever and an unexpectedly falling haemoglobin. This is standard teaching and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Treatment ideas shown.</strong> Stopping the transfusion is the first step in any acute reaction and prevents more incompatible or offending component entering. Fluids support the circulation and kidney perfusion in haemolysis but can worsen lung fluid in TRALI and TACO. Antihistamine with steroid acts on allergic and febrile features. A diuretic unloads the circulation in TACO. Adrenaline for anaphylaxis, oxygen and ventilatory support, and component rechecking are essential in practice but are only noted here. They are teaching toggles only.",
  ],
  simplified: "Transfusion-associated graft-versus-host disease, post-transfusion purpura, bacterial contamination, iron overload, alloimmunisation without haemolysis, hypotensive reactions, oxygen and ventilation, adrenaline, antipyretics, laboratory rechecking and reporting, and all doses and thresholds are left out. Counts and speeds are illustrative, and the figure does not say how any patient should be treated.",
});
