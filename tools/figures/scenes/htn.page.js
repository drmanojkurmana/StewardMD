/* Hypertension scene: the pump, the resistance arteriole, the three drivers, drug block marks and the four end organs. */
const CY = SC.CY, WW = SC.W;
const L = { drivers: $("drivers"), vessel: $("vessel"), heart: $("heart"), organs: $("organs"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
const HC = [135, 252];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const symP = pool(16, () => mk("circle", { class: "sc-p p-symp", r: 2.4 }, L.parts));
const angP = pool(16, () => mk("circle", { class: "sc-p p-ang", r: 2.4 }, L.parts));
const naP = pool(18, () => mk("path", { class: "p-nad", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
/* drivers */
const NODES = {
  sym: { x: 360, y: 102, w: 190, t: "Sympathetic drive", s: "faster, stronger, tighter", tip: "Sympathetic nerves speed and strengthen the heartbeat and tighten small arteries. Stress, pain and other signals raise this drive." },
  raas: { x: 590, y: 102, w: 190, t: "Renin-angiotensin", s: "angiotensin II, aldosterone", tip: "The kidney releases renin, leading to angiotensin II, which tightens vessels, and aldosterone, which makes the kidney hold sodium." },
  vol: { x: 820, y: 102, w: 190, t: "Sodium and water load", s: "kidney holds salt and water", tip: "Salt and water held by the kidney expand blood volume. A fuller circulation raises cardiac output and pressure." },
};
const nodeEls = {};
Object.keys(NODES).forEach((k) => { const n = NODES[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.drivers);
  mk("rect", { class: "htn-node", x: n.x - n.w / 2, y: n.y - 22, width: n.w, height: 44, rx: 12 }, g);
  const t = mk("text", { class: "htn-node-t", x: n.x, y: n.y - 2, "text-anchor": "middle" }, g); t.textContent = n.t;
  const s = mk("text", { class: "htn-node-s", x: n.x, y: n.y + 13, "text-anchor": "middle" }, g); s.textContent = n.s; nodeEls[k] = g; });
const eq = mk("text", { class: "htn-eq", x: 946, y: 68, "text-anchor": "end" }, L.drivers); eq.textContent = "pressure = output x resistance";
const ARROWS = {
  symHeart: { pts: [[300, 124], [225, 175], [168, 214]], k: "sym" },
  symVessel: { pts: [[395, 124], [432, 168], [458, 202]], k: "sym" },
  raasVessel: { pts: [[590, 124], [590, 198]], k: "raas" },
  raasVol: { pts: [[685, 102], [722, 102]], k: "raas" },
  volVessel: { pts: [[820, 124], [806, 172], [764, 222]], k: "vol" },
};
const arrows = {};
Object.keys(ARROWS).forEach((id) => { const a = ARROWS[id], d = a.pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(a.pts), e = mk("path", { class: "htn-arrow", d }, L.drivers);
  const p1 = a.pts[a.pts.length - 2], p2 = a.pts[a.pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958, hd = mk("path", { class: "htn-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, L.drivers);
  const nd = Math.max(3, Math.round(tr.len / 55)), dots = Array.from({ length: nd }, (_, i) => { const c = mk("circle", { class: "htn-dot " + (a.k === "vol" ? "v" : a.k === "sym" ? "s" : ""), r: 2.4 }, L.parts); return { c, u: i / nd }; });
  arrows[id] = { e, hd, tr, dots, k: a.k }; });
/* heart */
const hg = mk("g", {}, L.heart);
const hWall = mk("ellipse", { class: "htn-heartw", cx: HC[0], cy: HC[1] }, hg);
const hCh = mk("ellipse", { class: "htn-heartc", cx: HC[0], cy: HC[1] }, hg);
mk("ellipse", { class: "htn-heartw", cx: HC[0] - 38, cy: HC[1] - 52, rx: 20, ry: 16 }, hg);
mk("ellipse", { class: "htn-heartw", cx: HC[0] + 30, cy: HC[1] - 58, rx: 22, ry: 17 }, hg);
const aorta = mk("path", { class: "htn-aorta", d: "M" + (HC[0] + 34) + " " + (HC[1] - 38) + "C" + (HC[0] + 62) + " " + (HC[1] - 66) + " 205 " + (CY - 34) + " 248 " + CY, "stroke-width": 9 }, hg);
const aTrack = track([[HC[0] + 34, HC[1] - 38], [HC[0] + 62, HC[1] - 62], [205, CY - 30], [248, CY]]);
const ejs = Array.from({ length: 6 }, () => mk("circle", { class: "sc-p", r: 2.6, style: "--cc:var(--c-rbc)", opacity: 0 }, L.parts));
/* vessel */
const vWallT = mk("rect", { class: "htn-wall", x: 250, y: CY - 52, width: 670, height: 20, rx: 8 }, L.vessel);
const vWallB = mk("rect", { class: "htn-wall", x: 250, y: CY + 32, width: 670, height: 20, rx: 8 }, L.vessel);
const vLum = mk("rect", { class: "htn-lum", x: 250, y: CY - 30, width: 670, height: 60 }, L.vessel);
const vEndT = mk("path", { class: "htn-endo", d: "M250 " + (CY - 30) + "H920" }, L.vessel);
const vEndB = mk("path", { class: "htn-endo", d: "M250 " + (CY + 30) + "H920" }, L.vessel);
const smTop = [], smBot = [];
for (let i = 0; i < 14; i++) { const x = 272 + i * 48; smTop.push({ g: cell(L.vessel, { cls: "sm", r: 9, seed: i + 2, wob: 0.12, n: 8 }), x }); smBot.push({ g: cell(L.vessel, { cls: "sm", r: 9, seed: i + 30, wob: 0.12, n: 8 }), x }); }
const rbcs = [];
for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.vessel); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(250, 920), y: rnd(-0.8, 0.8), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
/* end organs */
function organ(x, name, tip, build) { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.organs); mk("rect", { class: "htn-org", x: x - 62, y: 356, width: 124, height: 76, rx: 12 }, g); const inner = mk("g", {}, g); const holder = {}; build(holder, inner, x, 388); const t = mk("text", { class: "htn-org-t", x: x, y: 424, "text-anchor": "middle" }, g); t.textContent = name; return holder; }
const orgHeart = organ(150, "Heart", "Sustained pressure thickens the left ventricle wall. Over time the stiff, thick ventricle fills poorly and can fail.", (h, g, x, y) => { h.w = mk("ellipse", { class: "htn-heartw", cx: x, cy: y, rx: 30, ry: 26 }, g); h.c = mk("ellipse", { class: "htn-heartc", cx: x, cy: y, rx: 17, ry: 14 }, g); h.d = mk("ellipse", { class: "htn-dmg", cx: x, cy: y, rx: 30, ry: 26, opacity: 0 }, g); });
const orgBrain = organ(380, "Brain", "Sustained pressure injures brain vessels. That raises the risk of stroke and of cognitive decline.", (h, g, x, y) => { mk("ellipse", { class: "htn-brain", cx: x, cy: y, rx: 32, ry: 25 }, g); mk("path", { class: "htn-arrow", d: "M" + (x - 18) + " " + (y - 8) + "q9 -8 18 0q9 8 18 0M" + (x - 18) + " " + (y + 8) + "q9 -8 18 0q9 8 18 0" }, g); h.d = mk("circle", { class: "htn-dmg", cx: x + 12, cy: y - 6, r: 9, opacity: 0 }, g); });
const orgKid = organ(610, "Kidney", "Sustained pressure damages glomeruli and kidney vessels, causing chronic kidney disease. A damaged kidney then holds more sodium, raising pressure further.", (h, g, x, y) => { h.s = mk("g", {}, g); mk("path", { class: "htn-kid", d: "M" + (x - 20) + " " + (y - 26) + "C" + (x + 8) + " " + (y - 32) + " " + (x + 28) + " " + (y - 12) + " " + (x + 24) + " " + (y + 8) + "C" + (x + 20) + " " + (y + 27) + " " + (x - 4) + " " + (y + 34) + " " + (x - 18) + " " + (y + 26) + "C" + (x - 30) + " " + (y + 18) + " " + (x - 28) + " " + (y - 18) + " " + (x - 20) + " " + (y - 26) + "Z" }, h.s); mk("ellipse", { class: "htn-lum", cx: x + 12, cy: y, rx: 6, ry: 11 }, h.s); h.d = mk("circle", { class: "htn-dmg", cx: x - 6, cy: y + 4, r: 10, opacity: 0 }, g); });
const orgEye = organ(840, "Eye", "Sustained pressure narrows and injures retinal vessels. Vision can be affected when the retina is damaged.", (h, g, x, y) => { mk("circle", { class: "htn-eye", cx: x, cy: y, r: 27 }, g); mk("path", { class: "htn-ret", d: "M" + x + " " + y + "L" + (x - 16) + " " + (y - 12) + "M" + x + " " + y + "L" + (x + 4) + " " + (y - 19) + "M" + x + " " + y + "L" + (x + 18) + " " + (y - 6) + "M" + x + " " + y + "L" + (x - 14) + " " + (y + 14) + "M" + x + " " + y + "L" + (x + 15) + " " + (y + 13) }, g); mk("circle", { class: "htn-heartc", cx: x, cy: y, r: 5 }, g); h.d = mk("g", { opacity: 0 }, g); [[-14, -10], [13, 8], [6, -15]].forEach(([u, v]) => mk("circle", { class: "htn-dmg", cx: x + u, cy: y + v, r: 3.2 }, h.d)); });
/* drug block marks */
const MARKS = { bb: [272, 158, "Beta-blocker", 272, 180], ace: [590, 160, "ACE inhibitor or ARB", 590, 142], diu: [820, 160, "Diuretic", 820, 142], ccb: [740, 204, "Calcium channel blocker", 740, 184] };
const marks = {};
Object.keys(MARKS).forEach((id) => { const m = MARKS[id], g = mk("g", { opacity: 0 }, L.marks);
  mk("circle", { class: "htn-x", cx: m[0], cy: m[1], r: 8.5 }, g); mk("path", { class: "htn-xx", d: "M" + (m[0] - 4) + " " + (m[1] - 4) + "l8 8M" + (m[0] + 4) + " " + (m[1] - 4) + "l-8 8" }, g);
  const t = mk("text", { class: "htn-mk", x: m[0], y: m[3], "text-anchor": "middle" }, g); t.textContent = m[2]; marks[id] = g; });
/* pills and gauges */
pill(L.over, "Heart pump", 110, 240, 110, 168, "The heart is the pump. Rate and strength of beating, with blood volume, set cardiac output.");
pill(L.over, "Cardiac output", 208, 224, 262, 132, "Cardiac output: how much blood the heart ejects each minute. More volume and stronger beating raise it, and pressure rises with it.");
pill(L.over, "Arteriole wall", 480, CY - 34, 480, 326, "Smooth muscle in the arteriole wall. When it contracts the lumen narrows, resistance rises and pressure rises.");
pill(L.over, "Narrowed lumen", 620, CY, 620, 326, "The open channel inside the arteriole. Resistance rises steeply as this channel narrows.");
pill(L.over, "Wall remodelling", 806, CY + 38, 806, 326, "Over months to years of raised pressure the wall thickens and stiffens. That keeps resistance high even between surges of tightening.");
const gg = {};
{ const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["bp", "Pressure", "g-bad", "Arterial pressure, set by cardiac output times vessel resistance. Sustained raised pressure drives organ damage."], ["co", "Output", "g-good", "Cardiac output: volume pumped by the heart each minute."], ["tpr", "Resistance", "g-cyt", "Resistance in small arteries and arterioles. Tightening and wall thickening raise it."], ["vol", "Volume", "g-vol", "Blood volume, raised when the kidney holds sodium and water."], ["rem", "Wall change", "g-rem", "Chronic thickening and stiffening of the vessel wall. It builds slowly and reverses slowly."], ["dmg", "Organ damage", "g-dmg", "Injury building in heart, brain, kidney and eye from sustained pressure."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); }); }
const sm = { sym: 0.5, raas: 0.5, vol: 0.5, co: 0.6, vcEff: 0.4, rem: 0.3, tpr: 0.5, bp: 0.6, dmg: 0.2, diu: 0, ace: 0, ccb: 0, bb: 0 };
const acc = { sym: 0, ang: 0, na: 0 };
let beat = 0;
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  ["sym", "raas", "vol", "co", "vcEff", "tpr", "bp"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.rem = lerp(sm.rem, m.rem, k2); sm.dmg = lerp(sm.dmg, m.dmg, k2);
  ["diu", "ace", "ccb", "bb"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* heart beat */
  beat += dt * (0.75 + 0.85 * sm.co); const ph = beat % 1, c = ph < 0.45 ? Math.sin(Math.PI * ph / 0.45) : 0, ef = 0.08 + 0.22 * sm.co;
  const crx = 40 * (1 - ef * c), cry = 50 * (1 - ef * c);
  hCh.setAttribute("rx", f1(crx)); hCh.setAttribute("ry", f1(cry)); hWall.setAttribute("rx", f1(crx + 15 + 9 * sm.dmg)); hWall.setAttribute("ry", f1(cry + 17 + 8 * sm.dmg));
  aorta.setAttribute("opacity", (0.25 + 0.55 * sm.co).toFixed(2));
  ejs.forEach((p, i) => { const u = (beat * 0.9 + i / ejs.length) % 1, q = aTrack.at(u); p.setAttribute("cx", f1(q.x)); p.setAttribute("cy", f1(q.y)); p.setAttribute("opacity", (sm.co * 0.9).toFixed(2)); });
  /* vessel geometry */
  const pulse = 1.4 * Math.sin(tm / 300) * sm.bp, hh = Math.max(10, 30 - 9 * sm.vcEff - 7 * sm.rem + pulse), thick = 13 + 15 * sm.rem + 5 * sm.vcEff;
  vLum.setAttribute("y", f1(CY - hh)); vLum.setAttribute("height", f1(hh * 2));
  vWallT.setAttribute("y", f1(CY - hh - thick)); vWallT.setAttribute("height", f1(thick)); vWallB.setAttribute("y", f1(CY + hh)); vWallB.setAttribute("height", f1(thick));
  vEndT.setAttribute("d", "M250 " + f1(CY - hh) + "H920"); vEndB.setAttribute("d", "M250 " + f1(CY + hh) + "H920");
  smTop.forEach((s) => place(s.g, s.x, CY - hh - thick / 2, 0, 1 - 0.12 * sm.vcEff)); smBot.forEach((s) => place(s.g, s.x, CY + hh + thick / 2, 0, 1 - 0.12 * sm.vcEff));
  const flow = 34 + 78 * sm.co;
  rbcs.forEach((r) => { r.x += r.v * flow * dt; if (r.x > 928) { r.x = 244; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * Math.max(4, hh - 9), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* driver arrows and nodes */
  const act = { sym: sm.sym, raas: sm.raas, vol: sm.vol };
  Object.keys(arrows).forEach((id) => { const a = arrows[id], v = act[a.k], sp = 0.08 + 0.38 * v; a.e.style.opacity = (0.3 + 0.7 * clamp(v)).toFixed(2); a.hd.style.opacity = a.e.style.opacity;
    a.dots.forEach((d) => { d.u = (d.u + dt * sp) % 1; const q = a.tr.at(d.u); d.c.setAttribute("cx", f1(q.x)); d.c.setAttribute("cy", f1(q.y)); d.c.style.opacity = clamp(v * 1.3).toFixed(2); }); });
  Object.keys(NODES).forEach((id) => { nodeEls[id].style.filter = "drop-shadow(0 0 " + (act[id] * 7).toFixed(1) + "px var(--c-cyt))"; });
  /* particles from drivers */
  acc.sym += dt * sm.sym * 5; while (acc.sym >= 1) { acc.sym--; const p = free(symP); if (p) emit(p, 360 + rnd(-70, 70), 126, rnd(-6, 6), rnd(24, 38), 0); }
  symP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.2 || p.y > CY - 60) kill(p); });
  acc.ang += dt * sm.raas * 5; while (acc.ang >= 1) { acc.ang--; const p = free(angP); if (p) emit(p, 590 + rnd(-50, 50), 126, rnd(-5, 5), rnd(24, 36), 0); }
  angP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.4 || p.y > CY - 48) kill(p); });
  acc.na += dt * sm.vol * 5; while (acc.na >= 1) { acc.na--; const p = free(naP); if (p) emit(p, 820 + rnd(-55, 55), 126, rnd(-5, 5), rnd(22, 34), 0); }
  naP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.6 || p.y > CY + hh - 4) kill(p); });
  /* marks and organs */
  Object.keys(marks).forEach((id) => marks[id].setAttribute("opacity", sm[id].toFixed(2)));
  if (orgHeart.c) { orgHeart.c.setAttribute("rx", f1(17 - 7 * sm.dmg)); orgHeart.c.setAttribute("ry", f1(14 - 5 * sm.dmg)); orgHeart.d.setAttribute("opacity", (sm.dmg * 0.3).toFixed(2)); }
  orgBrain.d.setAttribute("opacity", (sm.dmg * 0.75).toFixed(2)); orgKid.d.setAttribute("opacity", (sm.dmg * 0.7).toFixed(2)); orgEye.d.setAttribute("opacity", clamp(sm.dmg * 1.1).toFixed(2));
  orgKid.s.setAttribute("transform", "translate(610 388) scale(" + (1 - 0.12 * sm.dmg).toFixed(3) + ") translate(-610 -388)");
  /* gauges */
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.35, 0.65, ["controlled", "raised", "high"])); gg.co.set(sm.co, wordOf(sm.co, 0.45, 0.75, ["normal", "raised", "high"]));
  gg.tpr.set(sm.tpr, wordOf(sm.tpr, 0.35, 0.68, ["normal", "raised", "high"])); gg.vol.set(sm.vol, wordOf(sm.vol, 0.3, 0.6, ["low", "normal", "expanded"]));
  gg.rem.set(sm.rem, wordOf(sm.rem, 0.3, 0.6, ["little", "thickening", "marked"])); gg.dmg.set(sm.dmg, wordOf(sm.dmg, 0.25, 0.55, ["none", "early", "marked"]));
}
run({ init, step });
