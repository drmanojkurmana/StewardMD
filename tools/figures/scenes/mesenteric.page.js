/* Mesenteric scene: SMA flow, clot, bowel wall layers, perforation, lactate and gauges. */
const WW = SC.W;
const layers = { flow: $("flow"), clot: $("clot"), stent: $("stent"), parts: $("parts"), perf: $("perf"), over: $("over"), panel: $("panel"), muc: $("mucosa"), mucD: $("mucDark"), wallD: $("wallDark"), resect: $("resectMark") };
const artery = track([[78, 142], [220, 152], [360, 168], [500, 215], [626, 252]]);
/* clot on the artery and a smaller clot on the vein */
const clotG = mk("g", {}, layers.clot);
mk("circle", { class: "mes-clot", r: 13, cx: 0, cy: 0 }, clotG);
mk("circle", { class: "mes-clot", r: 9, cx: 11, cy: 3 }, clotG);
mk("circle", { class: "mes-clot", r: 8, cx: -10, cy: 4 }, clotG);
const veinClot = mk("g", {}, layers.clot);
mk("circle", { class: "mes-veinclot", r: 8, cx: 0, cy: 0 }, veinClot);
mk("circle", { class: "mes-veinclot", r: 6, cx: 8, cy: 2 }, veinClot);
place(clotG, 360, 168, 0, 0.2); place(veinClot, 392, 218, 0, 0.2);
/* stent mesh shown with revascularisation */
const stentG = mk("g", { opacity: "0" }, layers.stent);
mk("path", { class: "mes-stent", d: "M332 154L388 182M332 182L388 154M346 158L346 186M360 162L360 190M374 158L374 186" }, stentG);
/* resection mark over the right hand segment */
const resectG = mk("g", { opacity: "0" }, layers.resect);
mk("rect", { class: "mes-resect", x: 748, y: 268, width: 140, height: 134, rx: 56 }, resectG);
mk("path", { class: "mes-resect", d: "M760 282L876 388M876 282L760 388" }, resectG);
/* perforation jag at the bowel base */
const perfG = mk("g", { opacity: "0" }, layers.perf);
mk("path", { class: "mes-perf", d: "M684 404L694 414L704 402L714 414L724 404L718 420L692 420Z" }, perfG);
/* red cells flowing along the artery */
const rbcs = [];
function initFlow() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, u: i / 18, v: rnd(0.8, 1.2), rot: rnd(-16, 16) }); } }
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const lac = pool(26, () => mk("circle", { class: "sc-p p-lac", r: 2.6 }, layers.parts));
const spill = pool(24, () => mk("circle", { class: "sc-p p-spill", r: 2.8 }, layers.parts));
const caps = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["flow", "Flow", "g-good", "Blood flow in the superior mesenteric artery to the bowel."], ["muc", "Mucosa", "g-bad", "Injury to the mucosa, the inner lining. It is the most sensitive layer and is hurt first."], ["wall", "Full wall", "g-bad", "Injury through the full bowel wall (transmural). Beyond this the bowel infarcts."], ["la", "Lactate", "g-bad", "Lactate rises when bowel tissue is starved of oxygen."], ["leak", "Leak", "g-clot", "Perforation: a hole in infarcted bowel spilling bowel contents."], ["sep", "Sepsis", "g-cyt", "Sepsis following perforation and spill of bowel contents."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Aorta", 78, 120, 78, 84, "Aorta: the main artery. The superior mesenteric artery branches from it to supply most of the bowel.");
  pill(ox, "SMA", 240, 154, 240, 112, "Superior mesenteric artery (SMA): supplies most of the small bowel and part of the large bowel.");
  pill(ox, "Embolus or clot", 360, 168, 360, 120, "Block of the artery: an embolus carried from elsewhere, thrombosis on a narrowed artery, low flow without a block, or a clot in the mesenteric vein.");
  pill(ox, "Vein", 260, 208, 180, 230, "Mesenteric vein: drains the bowel. A clot here (venous thrombosis) also starves the bowel.");
  pill(ox, "Mucosa", 800, 312, 820, 235, "Mucosa: the inner lining of the bowel. Most sensitive to ischaemia, so it is injured first.");
  pill(ox, "Bowel wall", 500, 398, 500, 428, "Bowel wall layers from inside out: mucosa, submucosa, muscle and serosa. Injury spreads outward with time.");
  pill(ox, "Perforation", 704, 410, 700, 428, "Perforation: infarcted bowel may burst, spilling contents and causing sepsis.");
  pill(ox, "Severe pain", 410, 340, 130, 380, "Severe pain out of proportion to signs: early on the pain is severe while examination finds little. A classic warning feature.");
  const ac = pill(ox, "Anticoagulation", 340, 175, 190, 290, "Anticoagulation: stops clot spreading while circulation is supported with resuscitation."); ac.setAttribute("id", "ac-pill");
  const rv = pill(ox, "Revascularisation", 360, 168, 190, 330, "Revascularisation: restoring flow to the artery, by a procedure or surgery, to save salvageable bowel."); rv.setAttribute("id", "rv-pill");
  const rs = pill(ox, "Bowel resection", 820, 340, 820, 428, "Bowel resection: removing infarcted bowel that cannot recover."); rs.setAttribute("id", "rs-pill");
}
const sm = { F: 0.8, M: 0.2, Wd: 0, Pf: 0, Sep: 0, La: 0.1, occ: 0.2, anticoag: 0, revasc: 0, resect: 0 };
const acc = { lac: 0, spill: 0, cap: 0 };
function init() { initFlow(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.F = lerp(sm.F, m.F, k1); sm.M = lerp(sm.M, m.M, k2); sm.Wd = lerp(sm.Wd, m.Wd, k2); sm.Pf = lerp(sm.Pf, m.Pf, k2); sm.Sep = lerp(sm.Sep, m.Sep, k2); sm.La = lerp(sm.La, m.La, k2); sm.occ = lerp(sm.occ, m.occ, k1); sm.anticoag = lerp(sm.anticoag, m.anticoag, k1); sm.revasc = lerp(sm.revasc, m.revasc, k1); sm.resect = lerp(sm.resect, m.resect, k1);
  place(clotG, 360, 168, 0, Math.max(0.08, sm.occ * (1 - sm.revasc * 0.7)));
  clotG.style.opacity = sm.occ > 0.04 ? 1 : 0;
  place(veinClot, 392, 218, 0, Math.max(0.06, sm.occ * 0.7));
  veinClot.style.opacity = sm.occ > 0.1 ? 1 : 0;
  stentG.setAttribute("opacity", sm.revasc.toFixed(2));
  resectG.setAttribute("opacity", sm.resect.toFixed(2));
  perfG.setAttribute("opacity", sm.Pf.toFixed(2));
  layers.mucD.setAttribute("opacity", (sm.M * 0.75).toFixed(2));
  layers.wallD.setAttribute("opacity", (sm.Wd * 0.65).toFixed(2));
  layers.muc.style.opacity = (1 - sm.resect * 0.25).toFixed(2);
  const flow = clamp(0.15 + 0.9 * sm.F);
  rbcs.forEach((r) => { r.u += r.v * 0.11 * flow * dt; if (r.u > 1) r.u -= 1; const pt = artery.at(r.u); const blocked = r.u > 0.42 && r.u < 0.58 ? (1 - sm.occ * 0.75) : 1; place(r.g, pt.x, pt.y, pt.a + r.rot, blocked); r.g.style.opacity = blocked > 0.3 ? 1 : 0.25; });
  acc.lac += dt * sm.La * 7; while (acc.lac >= 1) { acc.lac--; const p = free(lac); if (p) emit(p, rnd(480, 820), 258, rnd(-5, 5), -rnd(16, 26), 0); }
  lac.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.y < 70) kill(p); });
  acc.spill += dt * sm.Pf * 9; while (acc.spill >= 1) { acc.spill--; const p = free(spill); if (p) emit(p, rnd(690, 720), 416, rnd(-8, 8), rnd(14, 24), 0); }
  spill.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 438) kill(p); });
  acc.cap += dt * sm.anticoag * 3; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, 90, 142, 0, 0, 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.k += dt * 0.14; const pt = artery.at(clamp(p.k)); p.e.setAttribute("transform", "translate(" + f1(pt.x) + " " + f1(pt.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 5) / 1.5).toFixed(2)); if (p.k > 0.95 || p.t > 6.5) kill(p); });
  $("ac-pill").style.opacity = sm.anticoag.toFixed(2); $("rv-pill").style.opacity = sm.revasc.toFixed(2); $("rs-pill").style.opacity = sm.resect.toFixed(2);
  gg.flow.set(sm.F, wordOf(sm.F, 0.35, 0.7, ["poor", "reduced", "good"])); gg.muc.set(sm.M, wordOf(sm.M, 0.25, 0.6, ["intact", "injured", "severe"])); gg.wall.set(sm.Wd, wordOf(sm.Wd, 0.22, 0.6, ["intact", "injured", "infarcted"]));
  gg.la.set(sm.La, wordOf(sm.La, 0.25, 0.55, ["normal", "raised", "high"])); gg.leak.set(sm.Pf, wordOf(sm.Pf, 0.2, 0.55, ["none", "risk", "leaking"])); gg.sep.set(sm.Sep, wordOf(sm.Sep, 0.25, 0.55, ["none", "risk", "sepsis"]));
}
run({ init, step });
