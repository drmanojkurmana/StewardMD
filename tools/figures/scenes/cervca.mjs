/* Cervical carcinogenesis as an animated, working scene (original drawing; Anima styling, Anatomy page shell).
 *   node tools/figures/scenes/cervca.mjs [--print-model]
 * Static layout here; HPV, epithelial change, invasion and gauges move in cervca.page.js. Qualitative: no doses, no numeric thresholds. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildScene, esc } from "./bio-scene.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 960, H = 610;

/* ---------------- model ---------------- */
const MD = {
  level: { label: "Stage", a: [0.35, 0.7, 1], names: ["HPV infection", "CIN", "invasive cancer"], ticks: ["infection", "CIN", "invasive"], start: 0 },
  drugLabel: "Prevention and treatment",
  settings: [
    { label: "no intervention" },
    { label: "vaccination and screening" },
    { label: "LEEP excision" },
    { label: "surgery and chemoradiation" },
  ],
  status: "Stage: {level} · {drug} ·",
  drugNames: ["no intervention", "vaccination and screening", "LEEP excision", "surgery and chemoradiation"],
};
function modelOf(S, level, drug) {
  const baseH = [0.85, 0.8, 0.72][level];
  const baseD = [0.15, 0.7, 0.95][level];
  const baseI = [0.02, 0.08, 0.92][level];
  const prevent = [0.85, 0.4, 0.05];
  const excise = [0.25, 0.9, 0.2];
  const radical = [0.1, 0.45, 0.8];
  const cl = (v) => Math.max(0, Math.min(1, v));
  const eff = drug === 1 ? prevent[level] : drug === 2 ? excise[level] : drug === 3 ? radical[level] : 0;
  const H = cl(baseH * (1 - (drug === 1 ? 0.8 * prevent[level] : 0)) * (1 - 0.15 * eff));
  const D = cl(baseD * (1 - eff));
  const I = cl(baseI * (1 - (drug === 3 ? 0.8 : drug === 2 ? excise[level] * 0.4 : drug === 1 ? 0.05 : 0)));
  const P = cl((0.22 + 0.72 * D) * (1 - 0.35 * eff) + 0.18 * I);
  const R = eff;
  const w = (v, x, y, ws) => (v < x ? ws[0] : v < y ? ws[1] : ws[2]);
  const words = [w(H, 0.3, 0.62, ["cleared", "present", "persistent"]), w(D, 0.3, 0.62, ["few", "some", "many"]), w(I, 0.2, 0.55, ["none", "possible", "present"])];
  return { a: S.level.a[level], eff, H, D, I, P, R, words, readout: "HPV " + words[0] + " · abnormal cells " + words[1] + " · invasion " + words[2] };
}
const TESTS = [
  [0, 0, "HPV persistent · abnormal cells few · invasion none"],
  [1, 0, "HPV persistent · abnormal cells many · invasion none"],
  [2, 0, "HPV persistent · abnormal cells many · invasion present"],
  [1, 2, "HPV persistent · abnormal cells few · invasion none"],
];

/* ---------------- static layout ---------------- */
const body = `
<rect class="sc-tissue" x="14" y="44" width="${W - 28}" height="396" rx="18"/>
<rect class="cc-side" x="656" y="44" width="290" height="396" rx="18"/>
<text class="sc-zone" x="292" y="68">CERVIX</text>
<text class="sc-zone" x="676" y="68">INSIDE THE CELL</text>
<g id="uterusSlot"></g>
<path id="canal" class="cc-canal2" d="M150 246 C210 258 250 280 298 302"/>
<rect class="cc-stroma" x="286" y="344" width="344" height="84" rx="10"/>
<path id="bm" class="cc-bm" d="M286 340L630 340"/>
<g id="epi"></g>
<g id="nests"></g><g id="vessels"></g>
<g id="mol"></g><g id="parts"></g><g id="treat"></g><g id="over"></g><g id="panel"></g>`;

buildScene({
  id: "cervical-cancer-hpv", fig: "Fig 1", title: "Cervical cancer: HPV infection to invasion", W, H, body,
  label: "An animated cervix seen from the uterus down to its lining. HPV enters through the cervix and reaches basal cells. Viral E6 removes p53 and E7 switches off Rb, so abnormal cells fill more of the lining in CIN and then break through the basement membrane in invasive cancer. A side panel shows p53, Rb and cell division. Gauges show HPV, abnormal cells, invasion, growth signals and treatment response. Choices are vaccination with screening, LEEP excision, and surgery with chemoradiation.",
  caption: "Schematic, not to scale. Speeds, counts and gauge levels are qualitative and illustrative; no doses, thresholds or drug names beyond the class are shown or implied.",
  scene: { W, H }, pageJs: readFileSync(join(HERE, "cervca.page.js"), "utf8"), modelOf, MD, tests: TESTS, organs: true,
  withoutLabel: "Without intervention", withLabel: "With surgery and chemoradiation",
  sourcesLis: [
    "<strong>How cervical cancer develops.</strong> Persistent infection of the cervical transformation zone with high risk human papillomavirus types, most often HPV 16 and HPV 18, is the central cause. Virus reaches basal epithelial cells. Viral E6 protein targets the tumour suppressor p53 for degradation, and viral E7 protein binds and inactivates Rb. Loss of these controls lets damaged cells survive and divide. Abnormal cells first occupy part of the epithelium in cervical intraepithelial neoplasia (CIN 1 to CIN 3), then breach the basement membrane as invasive carcinoma, usually squamous cell carcinoma. This is standard teaching in pathology, gynaecology and oncology texts and was not checked against a linked source here, so it is flagged for review.",
    "<strong>Prevention, screening and treatment ideas shown.</strong> HPV vaccination prevents new high risk infection. Screening by cervical cytology and by HPV testing finds precancer so it can be treated. LEEP excision removes the transformation zone in CIN. Invasive cancer is shown treated by surgery and by chemoradiation. These are teaching toggles only.",
  ],
  simplified: "Other HPV types, immune clearance and regression of CIN, adenocarcinoma and glandular lesions, staging, imaging, biopsy, fertility sparing choices, radiotherapy planning, chemotherapy choice, HIV and immune suppression, and all doses and test intervals are left out. Counts and speeds are illustrative, and the figure does not say how any person should be screened or treated.",
  extraCss: `
body{--c-epi:#e9a2b3;--c-dys:#b678e8;--c-basal:#d9788f;--c-e6:#e5484d;--c-e7:#f08a4b;--c-p53:#3ddc97;--c-rb:#7ab8ff;--c-div:#e9b84a;--c-inv:#d66a6a;--c-hpv:#7fcf6a;--c-abx:#5ec1a0}
body[data-theme="light"]{--c-epi:#d9788f;--c-dys:#7c3aed;--c-basal:#c45a72;--c-e6:#c42a3d;--c-e7:#e06a25;--c-p53:#0f9f76;--c-rb:#2f7ad8;--c-div:#d99a1f;--c-inv:#c44a4a;--c-hpv:#4fa63c;--c-abx:#2f9f7c}
.cc-side{fill:var(--anatomy-card);opacity:.55;stroke:var(--anatomy-faint);stroke-width:1}
.cc-canal2{fill:none;stroke:var(--c-lymph);stroke-width:9;stroke-linecap:round;opacity:.5}
.cc-stroma{fill:color-mix(in srgb,var(--c-endo) 18%,var(--anatomy-paper));stroke:var(--anatomy-faint);stroke-width:1}
.cc-bm{fill:none;stroke:var(--anatomy-strong);stroke-width:3;stroke-linecap:round}
.cc-vessel{fill:none;stroke:var(--c-rbc);stroke-width:5;stroke-linecap:round;opacity:.55}
.cc-bond{fill:none;stroke:var(--anatomy-mid);stroke-width:1.2}
.cc-ring{fill:none;stroke:var(--c-good);stroke-width:2;stroke-dasharray:5 4}
.cc-ray{fill:none;stroke:var(--c-neut);stroke-width:2.4;stroke-linecap:round;opacity:.85}
.cc-cone{fill:color-mix(in srgb,var(--c-neut) 18%,transparent);stroke:var(--c-neut);stroke-width:2;stroke-dasharray:6 4}
.cc-scan{fill:none;stroke:var(--c-abx);stroke-width:2;stroke-linecap:round;opacity:.8}
.cc-ab{fill:none;stroke:var(--c-abx);stroke-width:1.8;stroke-linecap:round}
.cc-cap{fill:var(--anatomy-strong);font-size:12px}
.cc-metdot{fill:var(--anatomy-paper);opacity:.8}
.cl-epi{--cc:var(--c-epi)}.cl-dys{--cc:var(--c-dys)}.cl-basal{--cc:var(--c-basal)}.cl-e6{--cc:var(--c-e6)}.cl-e7{--cc:var(--c-e7)}.cl-p53{--cc:var(--c-p53)}.cl-rb{--cc:var(--c-rb)}.cl-div{--cc:var(--c-div)}.cl-inv{--cc:var(--c-inv)}
.p-hpv{--cc:var(--c-hpv)}.p-e6{--cc:var(--c-e6)}.p-e7{--cc:var(--c-e7)}.p-chemo{--cc:var(--c-cyt)}.p-trap{--cc:var(--c-abx)}
.dr-g-fill.g-dys{fill:var(--c-dys)}.dr-g-fill.g-hpv{fill:var(--c-hpv)}
`,
});
