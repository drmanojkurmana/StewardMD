/* Two-receptor figure generator (Anima kit, MIT: prep/figures/ANIMA-LICENSE.txt).
 *   ANIMA_DIR=/path/to/anima node tools/figures/gpcr2.mjs tools/figures/specs/<id>.json [--register]
 * writes prep/figures/<id>.html and <id>-light.html; --register also merges the spec's "registry" block into prep/figures/figures.json.
 * One nerve terminal releases a transmitter onto two target cells; each cell has one G protein-coupled receptor, its G protein, an
 * effector enzyme, a second messenger and an end node. A slider sets the natural drive, a selector sets a drug class (blocker,
 * agonist or none) and a small model turns both into a qualitative response per cell. Spec fields: tools/figures/README.md.
 * Everything shown is qualitative and illustrative: no doses, affinities or concentrations. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ANIMA = process.env.ANIMA_DIR || "/home/user/garinmckayl/anima";
const { BIO_CSS, blobOf, blobSvg, membraneOf, membraneSvg } = await import(pathToFileURL(join(ANIMA, "kit/blob.mjs")));
const { figureSvg, pageHtml, pathOf, plateHtml } = await import(pathToFileURL(join(ANIMA, "kit/iso-kit.mjs")));

const specPath = process.argv[2];
if (!specPath) throw new Error("usage: gpcr2.mjs <spec.json> [--register]");
const S = JSON.parse(readFileSync(resolve(specPath), "utf8"));
const WIDTH = 960, HEIGHT = 640;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------------- model (also runs in the page) ---------------- */
function modelOf(S, level, drug) {
  const a = S.level.a[level], dr = S.drugs[drug];
  const act = S.cols.map((c, i) => {
    const e = (dr.cols && dr.cols[i]) || {}, b = e.b || 0, g = e.g || 0, x = Math.min(1, a + g);
    return Math.max(0, Math.min(1, x * (1 - b * (1 - 0.5 * x))));
  });
  const word = (v, c) => { const w = c.words || S.words || ["baseline", "modest", "strong"]; return v < 0.2 ? w[0] : v < 0.6 ? w[1] : w[2]; };
  const words = act.map((v, i) => word(v, S.cols[i]));
  const readout = S.readout.replace(/\{(\d)\}/g, (_, k) => words[+k]);
  return { act, words, readout, b: S.cols.map((c, i) => ((dr.cols && dr.cols[i]) || {}).b || 0), g: S.cols.map((c, i) => ((dr.cols && dr.cols[i]) || {}).g || 0) };
}
for (const t of S.tests || []) {
  const r = modelOf(S, t[0], t[1]).readout;
  if (r !== t[2]) throw new Error(`${S.id}: model readout "${r}" != "${t[2]}" at level ${t[0]}, drug ${t[1]}`);
}

/* ---------------- geometry ---------------- */
const FP = { origin: [0, 0], scale: 1 / Math.sqrt(1.6), azimuth: 90, elevation: 0 };
const W = (x, y) => [x, 0, -y];
const ringE = (cx, cy, rx, ry, n = 30, phase = 0, wob = 0.035) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const w = 1 + wob * Math.sin(a * 3 + phase) + (wob / 2) * Math.cos(a * 5 - phase); return W(cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w); });
const ringS = (cx, cy, rx, ry, pw = 3, n = 56) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a); return W(cx + Math.sign(c) * Math.abs(c) ** (2 / pw) * rx, cy + Math.sign(s) * Math.abs(s) ** (2 / pw) * ry); });
const f1 = (v) => +v.toFixed(1);
const MEM = { y0: 300, y1: 326 }, SITES = [330, 570], TERM = { cx: 480, cy: 114, rx: 236, ry: 96 };
const VES = [[298, 106], [330, 188], [440, 108], [570, 188], [612, 112], [662, 160], [350, 150], [510, 128]];
const AC_RX = 62, AC_CY = 362;
const POS = [{ cx: 120, acx: 330, cell: [30, 450] }, { cx: 600, acx: 810, cell: [510, 930] }];
const COLS = S.cols.map((c, i) => {
  const p = POS[i];
  return Object.assign({ sign: "+", eff: "AC", msg: "cAMP", end: { kind: "pka" }, gprot: "Gαs", inv: false }, c, p, {
    home: [p.cx + 26, 356], bg: [p.cx - 28, 360], dock: [p.acx - 66, 366], pka: [p.acx, 536], i,
  });
});
const minus = (c) => c.sign === "−";

const terminalBlob = blobOf(ringS(TERM.cx, TERM.cy, TERM.rx - 4, TERM.ry - 4, 3), FP, { tone: "hi", id: "terminal", highlight: 0.85, shade: 0.93 });
const terminalMembrane = membraneOf(ringS(TERM.cx, TERM.cy, TERM.rx + 2, TERM.ry + 2, 3), ringS(TERM.cx, TERM.cy, TERM.rx - 4, TERM.ry - 4, 3), FP, { tone: "mid" });
const vesicles = VES.map(([x, y], i) => ({ x, y, blob: blobOf(ringE(0, 0, 16, 16, 22, i, 0.02), FP, { tone: "lit", highlight: 0.62, shade: 0.9 }) }));
const alphaBlob = (i) => blobOf(ringE(0, 0, 31, 20, 26, i, 0.03), FP, { tone: "hi", highlight: 0.7, shade: 0.9 });
const bgBlob = (i) => blobOf(ringE(0, 0, 19, 15, 22, i, 0.03), FP, { tone: "mid", highlight: 0.7, shade: 0.9 });
const acBlob = (c, i) => blobOf(ringE(c.acx, AC_CY, AC_RX, 32, 36, 0.7 + i, 0.02), FP, { tone: "hi", id: "ac" + i, highlight: 0.8, shade: 0.92 });
const pkaR = blobOf(ringE(0, 0, 23, 14, 24, 0.4, 0.02), FP, { tone: "mid", highlight: 0.7, shade: 0.9 });
const pkaC = (i) => blobOf(ringE(0, 0, 20, 17, 24, i + 1, 0.03), FP, { tone: "hi", highlight: 0.7, shade: 0.9 });
const nodeBlob = (i) => blobOf(ringE(0, 0, 34, 20, 26, i + 3, 0.03), FP, { tone: "hi", highlight: 0.7, shade: 0.9 });

const HX = [-39, -26, -13, 0, 13, 26, 39], HTOP = [300, 296, 292, 304, 292, 296, 300], HBOT = [330, 334, 337, 333, 337, 334, 330];
const capsule = (x, y0, y1, w) => `<rect class="dr-hx" x="${f1(x - w / 2)}" y="${y0}" width="${w}" height="${y1 - y0}" rx="${w / 2}"/><path class="dr-hx-hi" d="M${f1(x - w / 4)} ${y0 + 7}V${y1 - 7}"/>`;
const receptor = (cx) => [0, 6, 1, 5, 2, 4, 3].map((i) => capsule(cx + HX[i], HTOP[i], HBOT[i], 11)).join("");
const acHelices = (acx) => { const out = []; for (const [x0, n] of [[acx - 70, 6], [acx + 15, 6]]) for (let i = 0; i < n; i++) out.push(capsule(x0 + i * 10, 296 + (i % 2) * 3, 336 - (i % 2) * 2, 9)); return out.join(""); };
const dotAt = (x, y) => `<circle class="dr-dot" cx="${x}" cy="${y}" r="1.7"/>`;
const label = (text, [tx, ty], [px, py], anchor = "start", cls = "") => {
  const sx = anchor === "end" ? tx + 4 : anchor === "start" ? tx - 4 : tx;
  const sy = anchor === "middle" ? (py < ty ? ty - 13 : ty + 4) : ty - 4;
  return `<path class="dr-leader" d="${pathOf([[sx, sy], [px, py]])}"/>${dotAt(px, py)}<text class="dr-label ${cls}" x="${tx}" y="${ty}" text-anchor="${anchor}">${text}</text>`;
};
const chip = (id, text, cls) => `<g id="${id}" class="dr-chip ${cls}"><rect x="-17" y="-8" width="34" height="16" rx="8"/><text x="0" y="4" text-anchor="middle">${text}</text></g>`;
const hex = (x, y, r) => pathOf(Array.from({ length: 6 }, (_, k) => [x + Math.cos((k * Math.PI) / 3) * r, y + Math.sin((k * Math.PI) / 3) * r]), true);
const sub = (n) => `<tspan class="dr-sub" dy="3">${n}</tspan><tspan dy="-3">`;

/* ---------------- molecules (flat skeletal formulas, schematic) ---------------- */
function catechol(extra) {
  const L = 26, c = [70, 100];
  const v = (k) => [c[0] + Math.cos(((-90 + 60 * k) * Math.PI) / 180) * L, c[1] + Math.sin(((-90 + 60 * k) * Math.PI) / 180) * L];
  const dir = (deg) => [Math.cos((deg * Math.PI) / 180) * L, Math.sin((deg * Math.PI) / 180) * L];
  const add = (p, d) => [p[0] + d[0], p[1] + d[1]];
  const V = [0, 1, 2, 3, 4, 5].map(v);
  const Ca = add(V[1], dir(-30)), Cb = add(Ca, dir(30)), N = add(Cb, dir(-30));
  const O3 = add(V[3], dir(90)), O4 = add(V[4], dir(150));
  const bond = (a, b) => `<path class="dr-bond" d="${pathOf([a, b])}"/>`;
  const inner = (a, b) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, vx = c[0] - mx, vy = c[1] - my, d = Math.hypot(vx, vy), o = 4.4, s = 0.16; const p = (Q, R) => [Q[0] + (R[0] - Q[0]) * s + (vx / d) * o, Q[1] + (R[1] - Q[1]) * s + (vy / d) * o]; return `<path class="dr-bond" d="${pathOf([p(a, b), p(b, a)])}"/>`; };
  const atom = (p, t, s2) => `<circle class="dr-atom-bg" cx="${f1(p[0])}" cy="${f1(p[1])}" r="9"/><text class="dr-atom" x="${f1(p[0])}" y="${f1(p[1] + 4)}" text-anchor="middle">${t}${s2 ? `<tspan class="dr-sub" dy="3">${s2}</tspan>` : ""}</text>`;
  let out = "";
  for (let k = 0; k < 6; k++) out += bond(V[k], V[(k + 1) % 6]);
  out += inner(V[0], V[1]) + inner(V[2], V[3]) + inner(V[4], V[5]);
  out += bond(V[1], Ca) + bond(Ca, Cb) + bond(Cb, N) + bond(V[3], O3) + bond(V[4], O4);
  out += atom(O3, "OH") + atom(O4, "OH") + atom(N, "NH", "2");
  if (extra === "oh") { const OHa = add(Ca, dir(-90)); out += bond(Ca, OHa) + atom(OHa, "OH"); }
  return out;
}
function acetylcholine() {
  // CH3-C(=O)-O-CH2-CH2-N+(CH3)3 as a zigzag chain; the carbonyl O sits above the second carbon (double bond drawn as two short lines)
  const P = [[16, 118], [44, 102], [72, 118], [100, 102], [128, 118], [156, 102]];
  const bond = (a, b) => `<path class="dr-bond" d="${pathOf([a, b])}"/>`;
  const atom = (p, t, s2) => `<circle class="dr-atom-bg" cx="${f1(p[0])}" cy="${f1(p[1])}" r="9"/><text class="dr-atom" x="${f1(p[0])}" y="${f1(p[1] + 4)}" text-anchor="middle">${t}${s2 ? `<tspan class="dr-sub" dy="3">${s2}</tspan>` : ""}</text>`;
  const Oc = [44, 72], M1 = [156, 72], M2 = [182, 117], M3 = [130, 86];
  let out = "";
  for (let k = 0; k < 5; k++) out += bond(P[k], P[k + 1]);
  out += bond([P[1][0] - 3, P[1][1]], [Oc[0] - 3, Oc[1]]) + bond([P[1][0] + 3, P[1][1]], [Oc[0] + 3, Oc[1]]);
  out += bond(P[5], M1) + bond(P[5], M2) + bond(P[5], M3);
  out += atom(Oc, "O") + atom(P[2], "O") + atom(P[5], "N⁺") + atom(M1, "CH", "3") + atom(M2, "CH", "3") + atom(M3, "CH", "3") + atom(P[0], "CH", "3");
  return out;
}
function moleculeSvg(m) {
  if (!m || m.draw === "none") return "";
  const body = m.draw === "acetylcholine" ? acetylcholine() : catechol(m.draw === "noradrenaline" ? "oh" : "");
  const cx = m.draw === "acetylcholine" ? 90 : 70;
  return `<g class="hot" tabindex="0" data-info="${esc(m.info)}" aria-label="${esc(m.name)} structural formula">${body}</g>` +
    `<text class="dr-label dr-name" x="${f1(cx + 20)}" y="188" text-anchor="middle">${esc(m.name)}</text><text class="dr-label dr-muted" x="${f1(cx + 20)}" y="204" text-anchor="middle">${m.formula}</text>`;
}

/* ---------------- one column ---------------- */
const alphaGroup = (c) => `<g id="${c.key}-alpha" class="dr-alpha" transform="translate(${c.home[0]} ${c.home[1]})">${blobSvg(alphaBlob(c.i + 2))}<text class="dr-prot" x="0" y="4" text-anchor="middle">${c.gprot}</text><g transform="translate(0 26)">${chip(`${c.key}-gdp`, "GDP", "dr-gdp")}${chip(`${c.key}-gtp`, "GTP", "dr-gtp")}</g></g>`;
const bgGroup = (c) => `<g class="dr-bg" transform="translate(${c.bg[0]} ${c.bg[1]})">${blobSvg(bgBlob(c.i + 1))}<text class="dr-prot" x="0" y="4" text-anchor="middle">βγ</text></g>`;
const railOf = (c) => { const x2 = c.acx - AC_RX, y2 = 366, k = minus(c) ? "red" : "green"; return `<path class="dr-rail dr-rail-${k}" d="${pathOf([[c.home[0], c.home[1]], [x2, y2]])}"/><path class="dr-rail-head dr-rail-${k}" d="M${x2} ${y2}l-9 -4.5v9z"/>`; };
const lipid = `<pattern id="lipid" x="0" y="${MEM.y0}" width="9" height="${MEM.y1 - MEM.y0}" patternUnits="userSpaceOnUse"><circle class="dr-head" cx="4.5" cy="4" r="3"/><circle class="dr-head" cx="4.5" cy="22" r="3"/><path class="dr-tail" d="M3.6 7V13M5.4 7V13M3.6 19V13M5.4 19V13"/></pattern>`;
const EFF = { AC: ["Adenylyl cyclase (AC)", "a membrane enzyme that makes cAMP from ATP"], PLC: ["Phospholipase C (PLC)", "a membrane enzyme that splits PIP2 into IP3 and DAG; IP3 releases calcium from the endoplasmic reticulum"] };

function endNode(c) {
  const k = c.end.kind || "pka", x = c.pka[0], y = c.pka[1];
  if (k === "pka") {
    return `<g class="hot" id="${c.key}-pka" tabindex="0" data-info="${esc(c.info.end)}">
<g id="${c.key}-c1" class="dr-pkac" transform="translate(${x - 46} ${y})">${blobSvg(pkaC(c.i * 2))}<text class="dr-prot" x="0" y="4" text-anchor="middle">C</text></g>
<g id="${c.key}-c2" class="dr-pkac" transform="translate(${x + 46} ${y})">${blobSvg(pkaC(c.i * 2 + 1))}<text class="dr-prot" x="0" y="4" text-anchor="middle">C</text></g>
<g transform="translate(${x} ${y})">${blobSvg(pkaR)}<text class="dr-prot" x="0" y="4" text-anchor="middle">R</text></g></g>`;
  }
  return `<g class="hot" id="${c.key}-pka" tabindex="0" data-info="${esc(c.info.end)}"><g id="${c.key}-c1" class="dr-pkac" transform="translate(${x} ${y})">${blobSvg(nodeBlob(c.i))}<text class="dr-prot" x="0" y="4" text-anchor="middle">${esc(c.end.label)}</text></g></g>`;
}
const colSvg = (c) => {
  const i = c.i, cellPath = `M${c.cell[0]} ${MEM.y0}H${c.cell[1]}V600Q${c.cell[1]} 630 ${c.cell[1] - 30} 630H${c.cell[0] + 30}Q${c.cell[0]} 630 ${c.cell[0]} 600Z`;
  const eff = EFF[c.eff], gp = c.gprot, k = minus(c) ? "red" : "green";
  const effInfo = `${eff[0]}: ${eff[1]}. ${gp}·GTP ${minus(c) ? "inhibits it (−)" : "stimulates it (+)"}. Several isoforms exist; they are not distinguished here.`;
  const gInfo = `Heterotrimeric G protein under the receptor: ${gp} plus the βγ pair. Resting: α carries GDP and sits with βγ. When the receptor is activated, α swaps GDP for GTP; α·GTP separates from βγ and ${minus(c) ? "inhibits" : "stimulates"} ${c.eff === "AC" ? "adenylyl cyclase" : "phospholipase C"} until its own GTPase turns GTP back to GDP and α rejoins βγ. βγ has effectors of its own, not drawn.`;
  const mlabel = c.msg === "cAMP" ? "ATP → cAMP" : "PIP2 → IP3 + DAG";
  const drugHex = `<g class="hot dr-block" id="${c.key}-block" tabindex="0" data-info="${esc(S.blockInfo)}"><path class="dr-block-hex" d="${hex(c.cx, 298, 8.5)}"/><path class="dr-block-x" d="M${c.cx - 3.5} 294.5L${c.cx + 3.5} 301.5M${c.cx + 3.5} 294.5L${c.cx - 3.5} 301.5"/></g>` +
    (S.agonistInfo ? `<g class="hot dr-agdrug" id="${c.key}-agdrug" tabindex="0" data-info="${esc(S.agonistInfo)}"><path class="dr-ag-hex" d="${hex(c.cx, 298, 8.5)}"/></g>` : "");
  const cx2 = c.cx + 85;
  return [
    `<g class="hot" tabindex="0" data-info="${esc(c.info.cell)}"><path class="dr-cell" d="${cellPath}"/></g>`,
    `<g class="hot" tabindex="0" data-info="Plasma membrane: a lipid bilayer (heads outside, tails inside; schematic) that the receptor and the effector enzyme span."><path class="dr-memband" d="M${c.cell[0]} ${MEM.y0}H${c.cell[1]}V${MEM.y1}H${c.cell[0]}Z"/><path class="dr-memfill" d="M${c.cell[0]} ${MEM.y0}H${c.cell[1]}V${MEM.y1}H${c.cell[0]}Z" fill="url(#lipid)"/><path class="dr-memedge" d="M${c.cell[0]} ${MEM.y0}H${c.cell[1]}M${c.cell[0]} ${MEM.y1}H${c.cell[1]}"/></g>`,
    `<g class="hot dr-ac" id="${c.key}-ac" tabindex="0" data-info="${esc(effInfo)}">${acHelices(c.acx)}${blobSvg(acBlob(c, i))}<text class="dr-prot" x="${c.acx}" y="${AC_CY - 2}" text-anchor="middle">${c.eff}</text><text id="${c.key}-plus" class="dr-sign dr-${minus(c) ? "minus" : "plus"}" x="${c.acx}" y="${AC_CY + 20}" text-anchor="middle">${c.sign}</text></g>`,
    railOf(c),
    `<g class="hot dr-rec ${minus(c) ? "dr-rr" : "dr-rg"}" id="${c.key}-rec" tabindex="0" data-info="${esc(c.info.rec)}">${receptor(c.cx)}</g>`,
    `<g class="hot" tabindex="0" id="${c.key}-g" data-info="${esc(gInfo)}">${bgGroup(c)}${alphaGroup(c)}</g>`,
    `<path class="dr-track" d="M${c.acx} ${AC_CY + 32} V${c.pka[1] - 24}"/><path class="dr-rail-head dr-track-head" d="M${c.acx} ${c.pka[1] - 22}l-4.5 -9h9z"/>`,
    `<g id="${c.key}-cAMPs"></g>`,
    endNode(c),
    `<text id="${c.key}-out" class="dr-out" x="${c.pka[0]}" y="600" text-anchor="middle">${esc(c.out)}</text>`,
    `<g id="${c.key}-bound"><circle id="${c.key}-da" class="dr-da" r="5"/></g>`,
    drugHex,
    `<text id="${c.key}-step" class="dr-step" x="${cx2}" y="424" text-anchor="middle"></text>`,
    `<text class="dr-label dr-muted" x="${c.acx + 14}" y="424" text-anchor="start">${mlabel}</text>`,
    `<text class="dr-title dr-${k}" x="${cx2}" y="462" text-anchor="middle">${esc(c.name)} · ${esc(c.organ)}</text><text class="dr-label" x="${cx2}" y="481" text-anchor="middle">${esc(c.sub)}</text>`,
  ].join("");
};

const body = [
  `<defs>${lipid}</defs>`,
  `<ellipse class="dr-halo" cx="480" cy="626" rx="430" ry="16"/>`,
  `<g class="hot" tabindex="0" data-info="${esc(S.terminal.info)}">${blobSvg(terminalBlob)}${membraneSvg(terminalMembrane)}</g>`,
  `<text class="dr-label dr-name" x="480" y="50" text-anchor="middle">${esc(S.terminal.label)}</text>`,
  ...vesicles.map((v, i) => {
    const dots = [[-6, -4], [5, -6], [-1, 3], [7, 4], [-8, 6]].map(([a, b]) => `<circle class="dr-vdot" cx="${a}" cy="${b}" r="2.1"/>`).join("");
    const dock = i === 1 || i === 3;
    return `<g class="hot dr-ves" ${dock ? `id="ves-${i === 1 ? 0 : 1}"` : ""} tabindex="0" data-info="Synaptic vesicle holding ${esc(S.terminal.vesicle)} (dots). Docked at the membrane, it fuses and releases its contents. Drawn larger than life with an arbitrary number of dots." transform="translate(${v.x} ${v.y})">${blobSvg(v.blob)}${dots}</g>`;
  }).join(""),
  COLS.map(colSvg).join(""),
  `<g id="cleft"></g>`, `<g id="puffs"></g>`,
  moleculeSvg(S.molecule),
  label("vesicle", [758, 114], [VES[5][0] + 14, VES[5][1] - 8], "start"),
  label("membrane", [38, 284], [58, MEM.y0 + 6], "start"),
  `<g class="dr-key"><circle class="dr-da" cx="752" cy="178" r="5"/><text class="dr-label" x="768" y="182">${esc(S.terminal.keyLabel)}</text>
<g transform="translate(752 204)">${chip("k-gdp", "GDP", "dr-gdp dr-on")}</g><text class="dr-label" x="776" y="208">on α: resting</text>
<g transform="translate(752 228)">${chip("k-gtp", "GTP", "dr-gtp dr-on")}</g><text class="dr-label" x="776" y="232">on α: active</text>
<path class="dr-block-hex" d="${hex(752, 252, 7)}" style="opacity:1"/><text class="dr-label" x="768" y="256">${esc(S.blockKey || "blocker (generic)")}</text>${S.agonistInfo ? `<path class="dr-ag-hex" d="${hex(752, 276, 7)}" style="opacity:1"/><text class="dr-label" x="768" y="280">${esc(S.agonistKey || "agonist drug (generic)")}</text>` : ""}</g>`,
].join("");

const svg = figureSvg({ width: WIDTH, height: HEIGHT, label: S.ariaLabel, body, className: "dr-fig" });
const framed = plateHtml({ fig: "Fig 1", title: S.title, hint: "hover or focus a part · space: pause", readout: modelOf(S, S.level.start ?? 1, 0).readout, caption: S.caption, body: `<div class="dr-svg">${svg}</div>` });
const controls = `
<div class="dr-controls">
  <label class="dr-range"><span>${esc(S.level.label)}</span><input id="level" type="range" min="0" max="2" step="1" value="${S.level.start ?? 1}" aria-valuetext="${esc(S.level.names[S.level.start ?? 1])}"><span class="dr-ticks">${S.level.ticks.map((t) => `<i>${esc(t)}</i>`).join("")}</span></label>
  <label class="dr-range"><span>${esc(S.drugLabel)}</span><select id="drug">${S.drugs.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join("")}</select></label>
  <button id="pause" type="button" aria-pressed="false">Pause motion</button>
</div>
<p id="status" class="dr-status" aria-live="polite"></p>
<p id="info" class="dr-info" aria-live="polite">Hover or focus a labelled part for a one-line explanation.</p>`;
const sources = `<footer class="bio-sources">
<h2>What the figure shows, and how sure we are</h2>
<ul>
${S.sources.map((x) => `<li>${x}</li>`).join("\n")}
</ul>
<p><strong>What was simplified.</strong> ${S.simplified}</p>
<p>Interactive figure drawn with the <a href="https://github.com/Garinmckayl/anima">Anima</a> kit (MIT licence).</p>
<p>For education only; this figure is not medical advice and says nothing about any person’s treatment or any medicine.</p>
</footer>`;

/* ---------------- the page script ---------------- */
const script = `
const S = ${JSON.stringify({ level: S.level, drugs: S.drugs.map((d) => ({ label: d.label, cols: d.cols || [] })), cols: S.cols.map((c) => ({ words: c.words || null })), words: S.words || null, readout: S.readout, status: S.status, drugNames: S.drugs.map((d) => d.status || d.label) })};
const modelOf = ${modelOf.toString()};
const DATA = ${JSON.stringify({ cols: COLS.map((c) => ({ key: c.key, cx: c.cx, acx: c.acx, home: c.home, dock: c.dock, pka: c.pka, inv: !!c.inv, msg: c.msg, end: c.end.kind || "pka", name: c.name, organ: c.organ })), sites: SITES, ves: [VES[1], VES[3]] })};
const NS = "http://www.w3.org/2000/svg";
const svg = document.querySelector(".dr-fig");
const $ = (id) => svg.querySelector("#" + id);
const readout = document.querySelector("[data-readout]");
const levelBox = document.getElementById("level"), drugBox = document.getElementById("drug"), pauseBtn = document.getElementById("pause");
const info = document.getElementById("info"), statusEl = document.getElementById("status");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const T = 9000;
const clamp = (v) => Math.max(0, Math.min(1, v));
const ease = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const seg = (p, a, b) => clamp((p - a) / (b - a));
const frac = (v) => v - Math.floor(v);
const mk = (name, attrs, parent) => { const el = document.createElementNS(NS, name); for (const k in attrs) el.setAttribute(k, attrs[k]); parent.appendChild(el); return el; };
const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const tr = (el, p) => el.setAttribute("transform", "translate(" + p[0].toFixed(1) + " " + p[1].toFixed(1) + ")");
let level = ${S.level.start ?? 1}, drug = 0, playing = !reduce.matches, visible = true, sim = reduce.matches ? 0.45 * T : 0, last = 0, frame = 0;
{ const q = new URLSearchParams(location.search), d0 = +q.get("d"), nm = (q.get("name") || "").replace(/[^A-Za-z0-9 \\-]/g, "").slice(0, 40);
  if (d0 > 0 && d0 < S.drugs.length) { drug = d0; drugBox.value = String(d0); }
  const l0 = q.get("l"); if (l0 === "0" || l0 === "2") { level = +l0; levelBox.value = l0; levelBox.setAttribute("aria-valuetext", S.level.names[level]); }
  if (nm) { const p = document.createElement("p"); p.className = "dr-status"; p.textContent = nm + ": the selector below is set to this drug's class. Drug classes overlap, so check the drug's own details."; statusEl.before(p); } }
let M = modelOf(S, level, drug);
const C = DATA.cols.map((d, i) => ({ d, i, alpha: $(d.key + "-alpha"), gdp: $(d.key + "-gdp"), gtp: $(d.key + "-gtp"), da: $(d.key + "-da"), rec: $(d.key + "-rec"), step: $(d.key + "-step"),
  block: $(d.key + "-block"), agd: $(d.key + "-agdrug"), plus: $(d.key + "-plus"), ac: $(d.key + "-ac"), c1: $(d.key + "-c1"), c2: $(d.key + "-c2"), out: $(d.key + "-out"), pool: $(d.key + "-cAMPs"),
  off: i * 0.23, seed: i * 0.37, text: "", s: 0, camp: 0, pkaS: null, bl: 0, ag: 0 }));
const NC = 10, NP = 12;
const pools = { cleft: $("cleft"), puffs: $("puffs") };
const cleft = Array.from({ length: NC }, () => { const g = mk("g", { class: "dr-particle" }, pools.cleft); mk("circle", { class: "dr-p-halo", r: 8 }, g); mk("circle", { class: "dr-da", r: 4.6 }, g); return { g, a: 0 }; });
C.forEach((c) => { c.camps = Array.from({ length: NP }, () => { const g = mk("g", { class: "dr-particle" }, c.pool); mk("circle", { class: c.d.msg === "cAMP" ? "dr-camp" : "dr-ca", r: 4.4 }, g); mk("circle", { class: "dr-camp-dot", r: 1.5 }, g); return { g, a: 0 }; }); });
const puffs = DATA.sites.map(() => Array.from({ length: 5 }, () => mk("circle", { class: "dr-da", r: 2.6 }, pools.puffs)));
const vesEl = [$("ves-0"), $("ves-1")];
const STEPS = ["1 · agonist binds", "2 · α swaps GDP for GTP", "3 · α·GTP leaves βγ", "4 · α·GTP acts on effector", "5 · GTP → GDP", "6 · α rejoins βγ"];
function cycle(c) {
  const x = sim / T + c.off, n = Math.floor(x), p = x - n, act = M.act[c.i];
  const active = frac(n * 0.618034 + c.seed) < act - 0.0001 || (!playing && sim === 0.45 * T && act > 0.02);
  return { p, active };
}
function drawRec(c) {
  const { p, active } = cycle(c), d = c.d, pocket = [d.cx, 296], side = c.i === 0 ? -16 : 16;
  let step = -1, alphaPos = d.home, gdp = 1, gtp = 0, da = 0, daPos = pocket, on = 0;
  if (active) {
    if (p < 0.15) { step = 0; daPos = lerp([d.cx + side, 246], pocket, ease(p / 0.15)); da = seg(p, 0, 0.04); on = ease(p / 0.15); }
    else if (p < 0.3) { step = 1; da = 1; on = 1; gdp = 1 - ease(seg(p, 0.15, 0.22)); gtp = ease(seg(p, 0.22, 0.3)); }
    else if (p < 0.55) { step = 2; da = 1; on = 1; gdp = 0; gtp = 1; alphaPos = lerp(d.home, d.dock, ease(seg(p, 0.3, 0.55))); }
    else if (p < 0.72) { step = 3; da = 1 - ease(seg(p, 0.58, 0.7)); daPos = lerp(pocket, [d.cx + side, 246], ease(seg(p, 0.58, 0.7))); on = 1 - ease(seg(p, 0.6, 0.72)); gdp = 0; gtp = 1; alphaPos = d.dock; }
    else if (p < 0.92) { step = 4; gdp = ease(seg(p, 0.72, 0.76)); gtp = 1 - gdp; alphaPos = lerp(d.dock, d.home, ease(seg(p, 0.74, 0.92))); }
    else { step = 5; gdp = 1; }
  } else if (c.bl > 0.3 && p > 0.05 && p < 0.4) {
    const u = seg(p, 0.05, 0.4), tri = Math.sin(u * Math.PI);
    daPos = [d.cx + 14 * u - 6, 246 + 34 * tri]; da = tri > 0.04 ? 0.9 : 0;
  }
  tr(c.alpha, alphaPos);
  c.gdp.style.opacity = gdp.toFixed(2); c.gtp.style.opacity = gtp.toFixed(2);
  c.gdp.setAttribute("transform", "translate(0 " + ((1 - gdp) * 9).toFixed(1) + ")");
  c.gtp.setAttribute("transform", "translate(0 " + ((1 - gtp) * 9).toFixed(1) + ")");
  tr(c.da, daPos); c.da.style.opacity = da.toFixed(2);
  c.rec.style.setProperty("--on", on.toFixed(2));
  const act = M.act[c.i];
  const text = active ? STEPS[step] : (c.bl > 0.3 ? "pocket held by the blocker" : act < 0.2 ? "waiting for the agonist" : "waiting for the next binding");
  if (text !== c.text) { c.text = text; c.step.textContent = text; }
}
function draw(dt) {
  const k = dt >= 1000 ? 1 : 1 - Math.exp(-dt / 700);
  C.forEach((c) => {
    const act = M.act[c.i], bl = M.b[c.i], ag = M.g[c.i], inv = c.d.inv;
    c.s += (act - c.s) * k; c.camp += (act - c.camp) * k; c.bl += (bl - c.bl) * k; c.ag += (ag - c.ag) * k;
    drawRec(c);
    c.plus.style.opacity = (0.22 + 0.78 * clamp(c.s / 0.85)).toFixed(2);
    c.ac.style.setProperty("--s1", c.s.toFixed(2));
    const lvlMsg = inv ? 0.15 + 0.85 * (1 - clamp(c.camp / 0.85)) : clamp(c.camp / 0.85);
    const nCamp = Math.round(lvlMsg * NP);
    c.camps.forEach((p, i) => {
      p.a += ((i < nCamp ? 1 : 0) - p.a) * (dt >= 1000 ? 1 : 1 - Math.exp(-dt / 500));
      if (p.a < 0.02) { p.g.style.opacity = 0; return; }
      const u = frac(sim / 4200 + i / NP);
      tr(p.g, [c.d.acx + Math.sin(i * 2.3 + sim / 700) * 8 * (0.4 + u), 394 + 6 + (c.d.pka[1] - 26 - 394 - 6) * u]);
      p.g.style.opacity = (p.a * (u < 0.1 ? u / 0.1 : u > 0.9 ? (1 - u) / 0.1 : 1)).toFixed(2);
    });
    const on = lvlMsg > (inv ? 0.5 : 0.3) ? 1 : 0;
    c.pkaS = (c.pkaS == null ? on : c.pkaS) + (on - (c.pkaS == null ? on : c.pkaS)) * k;
    if (c.d.end === "pka") { tr(c.c1, [c.d.pka[0] - 46 - 24 * c.pkaS, c.d.pka[1] + 4 * c.pkaS]); tr(c.c2, [c.d.pka[0] + 46 + 24 * c.pkaS, c.d.pka[1] + 4 * c.pkaS]); c.c2.style.setProperty("--on", c.pkaS.toFixed(2)); }
    c.c1.style.setProperty("--on", c.pkaS.toFixed(2));
    c.out.style.opacity = (0.3 + 0.7 * clamp(c.camp / 0.6)).toFixed(2);
    c.block.style.opacity = (c.bl > 0.02 ? 0.35 + 0.65 * c.bl : 0).toFixed(2);
    if (c.agd) c.agd.style.opacity = (c.ag > 0.02 ? 0.35 + 0.65 * clamp(c.ag / 0.5) : 0).toFixed(2);
  });
  const nc = [3, 6, 10][level];
  cleft.forEach((p, i) => {
    p.a += ((i < nc ? 1 : 0) - p.a) * (dt >= 1000 ? 1 : 1 - Math.exp(-dt / 400));
    if (p.a < 0.02) { p.g.style.opacity = 0; return; }
    const site = DATA.sites[i % 2], tgt = DATA.cols[Math.floor(i / 2) % 2].cx;
    const u = frac(sim / 5200 + i * 0.173), wob = Math.sin(sim / 520 + i * 2.1) * 6, tx = tgt + 26 * Math.sin(i + 1) * 0.5;
    tr(p.g, [site + (tx - site) * ease(u) + wob * (1 - u), 218 + 56 * u + Math.sin(u * 6 + i) * 5]);
    p.g.style.opacity = (p.a * (u < 0.08 ? u / 0.08 : u > 0.88 ? (1 - u) / 0.12 : 1)).toFixed(2);
  });
  const period = [9000, 4600, 2400][level];
  vesEl.forEach((v, s) => {
    const x = (sim + s * period * 0.5) % period, dur = 1300, u = x < dur ? x / dur : -1;
    const sq = u < 0 ? 0 : Math.sin(Math.PI * Math.min(1, u * 1.2));
    v.setAttribute("transform", "translate(" + DATA.ves[s][0] + " " + (DATA.ves[s][1] + sq * 6).toFixed(1) + ") scale(" + (1 + 0.22 * sq).toFixed(3) + " " + (1 - 0.35 * sq).toFixed(3) + ")");
    puffs[s].forEach((p, j) => {
      if (u < 0.25) { p.style.opacity = 0; return; }
      const w = (u - 0.25) / 0.75, a = (j - 2) * 0.55;
      p.setAttribute("cx", (DATA.sites[s] + Math.sin(a) * 26 * w).toFixed(1)); p.setAttribute("cy", (214 + Math.cos(a) * 34 * w).toFixed(1));
      p.style.opacity = (1 - w).toFixed(2);
    });
  });
}
function publish() {
  M = modelOf(S, level, drug);
  if (M.readout !== readout.textContent) readout.textContent = M.readout;
  statusEl.textContent = S.status.replace("{level}", S.level.names[level]).replace("{drug}", S.drugNames[drug]) + " " + DATA.cols.map((d, i) => d.name + " (" + d.organ + ") " + M.words[i]).join(" · ") + ". Qualitative, illustrative.";
}
function tick(now) { frame = 0; if (!playing || !visible) return; const dt = Math.min(64, now - (last || now)); last = now; sim += dt; draw(dt); frame = requestAnimationFrame(tick); }
function still() { draw(1000); }
function start() { if (playing && visible && !frame) { last = 0; frame = requestAnimationFrame(tick); } }
function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; }
levelBox.addEventListener("input", () => { level = +levelBox.value; levelBox.setAttribute("aria-valuetext", S.level.names[level]); publish(); if (!playing) still(); });
drugBox.addEventListener("change", () => { drug = +drugBox.value; publish(); if (!playing) still(); });
function setPlaying(v) { playing = v; pauseBtn.textContent = v ? "Pause motion" : "Play motion"; pauseBtn.setAttribute("aria-pressed", String(!v)); if (v) start(); else { stop(); still(); } }
pauseBtn.addEventListener("click", () => setPlaying(!playing));
document.addEventListener("keydown", (e) => { if (e.code !== "Space" || e.target.closest("button, a, input, textarea, select")) return; e.preventDefault(); setPlaying(!playing); });
reduce.addEventListener("change", () => setPlaying(!reduce.matches));
const idle = info.textContent;
svg.querySelectorAll(".hot").forEach((el) => {
  const on = () => { info.textContent = el.dataset.info; el.classList.add("is-hot"); };
  const off = () => { info.textContent = idle; el.classList.remove("is-hot"); };
  el.addEventListener("pointerenter", on); el.addEventListener("pointerleave", off); el.addEventListener("focus", on); el.addEventListener("blur", off);
});
new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }).observe(svg);
if (reduce.matches) { pauseBtn.textContent = "Play motion"; pauseBtn.setAttribute("aria-pressed", "true"); }
publish(); still(); start();
`;

const extra = `.dr-ca{fill:var(--anatomy-paper);stroke:var(--anatomy-blue);stroke-width:1.3}
.dr-ag-hex{fill:var(--anatomy-green);stroke:var(--anatomy-green);stroke-width:1.2}
.dr-agdrug{opacity:0;transition:opacity .3s}
.dr-controls select{border:1px solid var(--anatomy-faint);background:var(--anatomy-card);color:var(--anatomy-text);font:inherit;padding:6px 8px}
.dr-out{fill:var(--anatomy-strong);font:600 12px var(--anatomy-mono);transition:opacity .3s}
.dr-rg{--c:var(--anatomy-green)}.dr-rr{--c:var(--anatomy-red)}`;
const style = readFileSync(join(HERE, "figure.css"), "utf8") + extra;
for (const light of [false, true]) {
  const html = pageHtml({ title: S.title, theme: light ? "light" : "dark", width: WIDTH + 40, body: `<style>${BIO_CSS}${style}</style>${framed}${controls}${sources}`, script });
  writeFileSync(join(ROOT, "prep/figures", S.id + (light ? "-light" : "") + ".html"), html);
  console.log("wrote prep/figures/" + S.id + (light ? "-light" : "") + ".html " + html.length);
}
if (process.argv.includes("--register") && S.registry) {
  const fp = join(ROOT, "prep/figures/figures.json"), J = JSON.parse(readFileSync(fp, "utf8"));
  const entry = { id: S.id, title: S.registry.title || S.title, blurb: S.registry.blurb, page: "prep/figures/" + S.id + ".html", drugs: S.registry.drugs, terms: S.registry.terms || [] };
  const k = J.figures.findIndex((f) => f.id === S.id);
  if (k >= 0) J.figures[k] = entry; else J.figures.push(entry);
  writeFileSync(fp, JSON.stringify(J, null, 1) + "\n");
  console.log("registered " + S.id);
}
