/* Pre-eclampsia scene: shallow implantation, ischaemic placenta, anti-angiogenic factors, injured endothelium, tight vessel, leaking kidney filter, liver and brain involvement, seizure bolt. */
const CY = SC.CY, WW = SC.W;
const L = { drivers: $("drivers"), placenta: $("placenta"), vessel: $("vessel"), organs: $("organs"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const angP = pool(30, () => mk("circle", { class: "sc-p p-ang", r: 2.5 }, L.parts));
/* driver nodes */
const NODES = {
  impl: { x: 145, y: 102, w: 190, t: "Poor placentation", s: "shallow implantation", v: "isch", tip: "In pre-eclampsia the placenta implants shallowly and the uterine spiral arteries are not remodelled into wide vessels, so placental blood flow stays restricted." },
  isch: { x: 365, y: 102, w: 190, t: "Placental ischaemia", s: "placenta short of blood", v: "isch", tip: "The poorly perfused placenta is relatively ischaemic and stressed. It is the source of the maternal syndrome." },
  ang: { x: 585, y: 102, w: 200, t: "Anti-angiogenic factors", s: "factors into maternal blood", v: "ang", tip: "The stressed placenta releases excess anti-angiogenic factors such as soluble fms-like tyrosine kinase 1 and soluble endoglin, with less placental growth factor available." },
  endo: { x: 815, y: 102, w: 190, t: "Endothelial dysfunction", s: "vessel lining injured", v: "endo", tip: "Circulating factors injure endothelium, the lining of every maternal vessel. Injured endothelium relaxes vessels less, tightens them, and lets protein and fluid leak." },
};
const nodeEls = {};
Object.keys(NODES).forEach((k) => { const n = NODES[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.drivers);
  mk("rect", { class: "pre-node", x: n.x - n.w / 2, y: n.y - 22, width: n.w, height: 44, rx: 12 }, g);
  const t = mk("text", { class: "pre-node-t", x: n.x, y: n.y - 2, "text-anchor": "middle" }, g); t.textContent = n.t;
  const s = mk("text", { class: "pre-node-s", x: n.x, y: n.y + 13, "text-anchor": "middle" }, g); s.textContent = n.s; nodeEls[k] = g; });
[[240, 270], [460, 480], [685, 720]].forEach(([x1, x2]) => { mk("path", { class: "pre-arrow", d: "M" + x1 + " 102L" + x2 + " 102" }, L.drivers);
  mk("path", { class: "pre-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + x2 + " 102) rotate(0)" }, L.drivers); });
/* placenta and uterus */
const placG = mk("g", { class: "hot", tabindex: "0", "data-info": "Placenta inside the uterus. Shallow implantation and narrow spiral arteries leave it short of blood, so it releases anti-angiogenic factors." }, L.placenta);
mk("ellipse", { class: "pre-ut", cx: 140, cy: 212, rx: 68, ry: 56 }, placG);
const placDisc = mk("ellipse", { class: "pre-plac", cx: 140, cy: 192, rx: 44, ry: 30 }, placG);
mk("ellipse", { class: "pre-plac", cx: 122, cy: 184, rx: 12, ry: 8, opacity: 0.55 }, placG);
mk("ellipse", { class: "pre-plac", cx: 158, cy: 200, rx: 10, ry: 7, opacity: 0.55 }, placG);
[100, 140, 180].forEach((x) => mk("path", { class: "pre-spiral", d: "M" + x + " 246q-6 8 0 14q6 6 0 12" }, placG));
/* maternal vessel */
const vWallT = mk("rect", { class: "pre-wall", x: 260, y: CY - 48, width: 670, height: 18, rx: 8 }, L.vessel);
const vWallB = mk("rect", { class: "pre-wall", x: 260, y: CY + 30, width: 670, height: 18, rx: 8 }, L.vessel);
const vLum = mk("rect", { class: "pre-lum", x: 260, y: CY - 30, width: 670, height: 60 }, L.vessel);
const endoTop = [], endoBot = [];
for (let i = 0; i < 14; i++) { const x = 282 + i * 48; endoTop.push({ g: cell(L.vessel, { cls: "endo", r: 8, seed: i + 2, wob: 0.1, n: 8 }), x }); endoBot.push({ g: cell(L.vessel, { cls: "endo", r: 8, seed: i + 30, wob: 0.1, n: 8 }), x }); }
const rbcs = [];
for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(260, 930), y: rnd(-0.8, 0.8), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
/* organs and signs */
function organ(x, name, tip, build) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.organs); mk("rect", { class: "pre-org", x: x - 90, y: 338, width: 180, height: 76, rx: 12 }, g); const inner = mk("g", {}, g); const holder = {}; build(holder, inner, x, 366); const t = mk("text", { class: "pre-org-t", x: x, y: 406, "text-anchor": "middle" }, g); t.textContent = name; return holder; }
const orgKid = organ(320, "Kidney", "The injured kidney filter leaks protein into the urine (proteinuria) and kidney function can fall. Protein leak is a defining sign alongside hypertension.", (h, g, x, y) => {
  mk("path", { class: "pre-kid", d: "M" + (x - 22) + " " + (y - 24) + "C" + (x + 6) + " " + (y - 30) + " " + (x + 28) + " " + (y - 12) + " " + (x + 24) + " " + (y + 6) + "C" + (x + 20) + " " + (y + 24) + " " + (x - 4) + " " + (y + 30) + " " + (x - 18) + " " + (y + 22) + "C" + (x - 30) + " " + (y + 14) + " " + (x - 30) + " " + (y - 16) + " " + (x - 22) + " " + (y - 24) + "Z" }, g);
  h.dots = [0, 1, 2, 3, 4].map((i) => mk("circle", { class: "pre-prot", cx: x + 16 + (i % 3) * 5, cy: y + 2 + i * 5, r: 2.2, opacity: 0 }, g)); h.d = mk("circle", { class: "pre-dmg", cx: x - 8, cy: y + 2, r: 9, opacity: 0 }, g); });
const orgLiv = organ(545, "Liver", "Endothelial injury in the liver causes pain under the ribs, abnormal liver tests and, in severe disease, bleeding problems as clotting is disturbed.", (h, g, x, y) => {
  mk("path", { class: "pre-liv", d: "M" + (x - 34) + " " + (y - 14) + "C" + (x - 20) + " " + (y - 26) + " " + (x + 18) + " " + (y - 26) + " " + (x + 34) + " " + (y - 8) + "C" + (x + 30) + " " + (y + 12) + " " + (x + 4) + " " + (y + 20) + " " + (x - 22) + " " + (y + 18) + "C" + (x - 34) + " " + (y + 8) + " " + (x - 36) + " " + (y - 2) + " " + (x - 34) + " " + (y - 14) + "Z" }, g);
  h.d = mk("g", { opacity: 0 }, g); [[-14, -4], [8, 4], [20, -10]].forEach(([u, v]) => mk("circle", { class: "pre-dmg", cx: x + u, cy: y + v, r: 4 }, h.d)); });
const orgBrain = organ(770, "Brain", "Endothelial injury in the brain causes headache and visual disturbance. Seizures define eclampsia and are the most feared brain complication.", (h, g, x, y) => {
  mk("ellipse", { class: "pre-brain", cx: x, cy: y, rx: 34, ry: 25 }, g);
  mk("path", { class: "pre-arrow", d: "M" + (x - 18) + " " + (y - 7) + "q9 -8 18 0q9 8 18 0M" + (x - 18) + " " + (y + 8) + "q9 -8 18 0q9 8 18 0" }, g);
  h.bolt = mk("path", { class: "pre-bolt", d: "M" + (x + 6) + " " + (y - 16) + "L" + (x - 4) + " " + (y + 2) + "L" + (x + 2) + " " + (y + 2) + "L" + (x - 5) + " " + (y + 17) + "L" + (x + 10) + " " + (y - 2) + "L" + (x + 3) + " " + (y - 2) + "Z", opacity: 0 }, g);
  h.d = mk("circle", { class: "pre-dmg", cx: x - 14, cy: y - 6, r: 8, opacity: 0 }, g); });
const signsG = mk("g", { class: "hot", tabindex: "0", "data-info": "The defining signs are hypertension (raised blood pressure) after mid pregnancy together with proteinuria, or with liver, kidney, blood or brain involvement in severe disease." }, L.organs);
mk("rect", { class: "pre-org", x: 40, y: 338, width: 170, height: 76, rx: 12 }, signsG);
const signArrow = mk("path", { class: "pre-bolt", d: "M105 388L118 362L126 374L136 356L148 388Z", opacity: 0.4 }, signsG);
const signDots = [0, 1, 2].map((i) => mk("circle", { class: "pre-prot", cx: 82 + i * 14, cy: 392, r: 2.4, opacity: 0 }, signsG));
{ const t = mk("text", { class: "pre-org-t", x: 125, y: 404, "text-anchor": "middle" }, signsG); t.textContent = "Signs"; }
/* treatment marks */
function xmark(x, y) { const g = mk("g", { opacity: 0 }, L.marks); mk("circle", { class: "pre-x", cx: x, cy: y, r: 9 }, g); mk("path", { class: "pre-xx", d: "M" + (x - 4) + " " + (y - 4) + "l8 8M" + (x + 4) + " " + (y - 4) + "l-8 8" }, g); return g; }
const markAh = xmark(884, CY - 39), markMg = xmark(800, 352), markDel = xmark(140, 212);
/* pills: short text, pill row below vessel (y 308) and above vessel (y 165), checked against nodes (bottom 124), vessel (182 to 278), organs (top 338) and each other */
pill(L.over, "Placenta", 96, 188, 140, 308, "Placenta inside the uterus. Shallow implantation leaves it short of blood and it becomes the source of anti-angiogenic factors.");
pill(L.over, "Vessel wall", 560, CY - 38, 560, 165, "Endothelium lining the maternal vessel. Injured endothelium tightens the vessel, so resistance and blood pressure rise.");
pill(L.over, "Blood flow", 750, CY, 750, 165, "Maternal blood flow through a tightened vessel. Sustained high pressure injures organs downstream.");
pill(L.over, "Protein leak", 336, 366, 320, 308, "Protein leaking through the injured kidney filter into urine. Together with hypertension this defines the syndrome.");
pill(L.over, "Liver injury", 545, 360, 545, 308, "Liver involvement from endothelial injury: pain, abnormal tests and disturbed clotting in severe disease.");
pill(L.over, "Seizure bolt", 776, 358, 770, 308, "A seizure in the brain defines eclampsia. Magnesium sulphate is used to prevent and treat these seizures.");
/* gauges */
const gg = {};
{ const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The mother";
  [["ang", "Factors", "g-cyt", "Anti-angiogenic factors released by the ischaemic placenta into maternal blood."], ["endo", "Endothelium", "g-endo", "How widely the vessel lining is injured by circulating factors."], ["bp", "Pressure", "g-bad", "Blood pressure: tightened vessels raise resistance and pressure."], ["prot", "Protein", "g-fl", "Protein leaking through the kidney filter into urine (proteinuria)."], ["org", "Organs", "g-org", "Involvement of liver, kidney and brain as endothelial injury spreads."], ["seiz", "Seizures", "g-seiz", "Seizure risk in the brain. Seizures present means eclampsia."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); }); }
const sm = { isch: 0.5, ang: 0.4, endo: 0.4, bp: 0.5, prot: 0.4, org: 0.3, seiz: 0.1, ah: 0, mg: 0, del: 0 };
const acc = { ang: 0 };
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  ["isch", "ang", "endo", "bp", "prot", "org", "seiz", "ah", "mg", "del"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "org" || q === "prot" ? k2 : k1); });
  /* nodes glow with their driver */
  const act = { impl: sm.isch, isch: sm.isch, ang: sm.ang, endo: sm.endo };
  Object.keys(NODES).forEach((id) => { nodeEls[id].style.filter = "drop-shadow(0 0 " + (act[id] * 7).toFixed(1) + "px var(--c-cyt))"; });
  placG.setAttribute("opacity", (1 - 0.82 * sm.del).toFixed(2));
  placDisc.style.filter = "drop-shadow(0 0 " + (sm.isch * 8).toFixed(1) + "px var(--c-bad))";
  /* vessel geometry: injured endothelium tightens it, antihypertensive and delivery reopen it */
  const hh = Math.max(11, 29 - 8 * sm.endo + 5 * sm.ah + 4 * sm.del), thick = 14 + 6 * sm.endo;
  vLum.setAttribute("y", f1(CY - hh)); vLum.setAttribute("height", f1(hh * 2));
  vWallT.setAttribute("y", f1(CY - hh - thick)); vWallT.setAttribute("height", f1(thick));
  vWallB.setAttribute("y", f1(CY + hh)); vWallB.setAttribute("height", f1(thick));
  endoTop.forEach((e) => { place(e.g, e.x, CY - hh, 0, 1); e.g.style.setProperty("--act", sm.endo.toFixed(2)); });
  endoBot.forEach((e) => { place(e.g, e.x, CY + hh, 0, 1); e.g.style.setProperty("--act", sm.endo.toFixed(2)); });
  const flow = 30 + 62 * sm.bp;
  rbcs.forEach((r) => { r.x += r.v * flow * dt; if (r.x > 938) { r.x = 252; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * Math.max(4, hh - 9), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* anti-angiogenic factors: placenta to vessel, then along it */
  acc.ang += dt * sm.ang * 9; while (acc.ang >= 1) { acc.ang--; const p = free(angP); if (p) emit(p, 208, 214 + rnd(-14, 14), rnd(38, 55), rnd(-4, 10), 0); }
  angP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt + (CY - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 935 || p.t > 9) kill(p); });
  /* organs, signs, marks */
  orgKid.d.setAttribute("opacity", (sm.org * 0.65).toFixed(2)); orgKid.dots.forEach((d, i) => d.setAttribute("opacity", clamp(sm.prot * 1.2 - i * 0.12).toFixed(2)));
  orgLiv.d.setAttribute("opacity", (sm.org * 0.8).toFixed(2));
  orgBrain.d.setAttribute("opacity", (sm.org * 0.7).toFixed(2));
  orgBrain.bolt.setAttribute("opacity", sm.seiz.toFixed(2));
  orgBrain.bolt.setAttribute("transform", "translate(" + f1(Math.sin(tm / 55) * 2.2 * sm.seiz) + " 0)");
  signArrow.setAttribute("opacity", (0.2 + 0.8 * sm.bp).toFixed(2));
  signDots.forEach((d, i) => d.setAttribute("opacity", clamp(sm.prot * 1.2 - i * 0.2).toFixed(2)));
  markAh.setAttribute("opacity", sm.ah.toFixed(2)); markMg.setAttribute("opacity", sm.mg.toFixed(2)); markDel.setAttribute("opacity", sm.del.toFixed(2));
  /* gauges */
  gg.ang.set(sm.ang, wordOf(sm.ang, 0.3, 0.6, ["low", "raised", "high"])); gg.endo.set(sm.endo, wordOf(sm.endo, 0.3, 0.6, ["healthy", "injured", "widespread"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.35, 0.65, ["controlled", "raised", "high"])); gg.prot.set(sm.prot, wordOf(sm.prot, 0.3, 0.6, ["none", "present", "heavy"]));
  gg.org.set(sm.org, wordOf(sm.org, 0.3, 0.6, ["quiet", "stressed", "involved"])); gg.seiz.set(sm.seiz, wordOf(sm.seiz, 0.2, 0.5, ["unlikely", "possible", "likely"]));
}
run({ init, step });
