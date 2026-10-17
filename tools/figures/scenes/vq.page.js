/* V/Q scene: shunt, normal and dead-space lung units, mixed arterial blood, kidney compensation and the treatment sources. */
const CY = SC.CY, WW = SC.W, CX = SC.CX;
const layers = { units: $("units"), cells: $("cells"), tr: $("tr"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const sm = { Sh: 0.4, Ds: 0.35, Hx: 0.5, O: 0.5, E: 0.7, C: 0.4, B: 0.5, P: 0.5, Ac: 0, ox: 0, bd: 0, vt: 0 };
let breathPh = 0;
const mix = (a, b, t) => "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")";
const DEOX = [92, 66, 150], OXY = [232, 62, 74];
const satColor = (s) => mix(DEOX, OXY, clamp(s));

/* ---- lung units: alveolus (drawn after tube shapes), plug, clot, fluid ---- */
const alv = CX.map((cx) => { const g = mk("g", {}, layers.units); mk("circle", { class: "vq-alv", r: 36, cx: 0, cy: 0 }, g); return g; });
const fluid = mk("circle", { class: "vq-fluid", r: 30, cx: CX[0], cy: 138 }, layers.units);
const plug = mk("ellipse", { class: "vq-plug", cx: CX[0], cy: 96, rx: 6, ry: 6 }, layers.units);
const clot = mk("ellipse", { class: "vq-clot", cx: CX[2] - 70, cy: 205, rx: 8, ry: 9 }, layers.units);
/* ---- red cells in each capillary ---- */
const rbcs = CX.map((cx, ui) => Array.from({ length: 9 }, (_, i) => ({ e: mk("ellipse", { class: "vq-rbc", rx: 4.6, ry: 3.6 }, layers.cells), u: i / 9, r: rnd(-0.5, 0.5), cx, ui })));
/* ---- treatment sources ---- */
const cyl = mk("g", { id: "tr-ox" }, layers.tr); mk("rect", { class: "vq-cyl", x: 602, y: 378, width: 26, height: 46, rx: 11 }, cyl); mk("rect", { class: "vq-cyl", x: 610, y: 370, width: 10, height: 9, rx: 2 }, cyl);
const inh = mk("g", { id: "tr-bd" }, layers.tr); mk("rect", { class: "vq-inh", x: 728, y: 372, width: 22, height: 38, rx: 5 }, inh); mk("rect", { class: "vq-inh", x: 728, y: 402, width: 38, height: 14, rx: 5 }, inh); mk("path", { class: "vq-inh", d: "M739 380h0" }, inh);
const bel = mk("g", { id: "tr-vt" }, layers.tr); const belBody = mk("rect", { class: "vq-bel", x: 852, y: 380, width: 40, height: 36, rx: 6 }, bel); mk("path", { class: "vq-bel", d: "M860 380v-8h24v8M852 392h40M852 404h40" }, bel);
/* ---- pools ---- */
const air = CX.map(() => pool(6, dot("p-o2", 3)));
const crossO = pool(8, dot("p-o2", 2.8));
const exh = pool(10, dot("p-co2", 2.8));
const aRbc = Array.from({ length: 28 }, () => ({ e: mk("ellipse", { class: "vq-rbc", rx: 4.6, ry: 3.6 }, layers.parts), x: rnd(20, 940), r: rnd(-0.8, 0.8) }));
const aCo2 = Array.from({ length: 18 }, () => ({ e: dot("p-co2", 3)(), x: rnd(20, 940), r: rnd(-0.8, 0.8) }));
const aH = Array.from({ length: 14 }, () => ({ e: dot("p-h", 3)(), x: rnd(20, 940), r: rnd(-0.8, 0.8) }));
const TUBE = track(SC.tube);
const kb = Array.from({ length: 10 }, () => ({ e: dot("p-hco3", 3)(), u: Math.random() }));
const kh = Array.from({ length: 8 }, () => ({ e: dot("p-h", 3)(), u: Math.random() }));
const keep = pool(10, dot("p-hco3", 3));
const spray = pool(14, dot("p-o2", 2.6));
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 300, 470, 640, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The blood gas";
  [["ox", "Blood oxygen", "g-ox", "Oxygen in arterial blood. Falls with shunt and dead space. Oxygen therapy helps a lot when the problem is under-ventilated units and little when it is true shunt."], ["co2", "Carbon dioxide", "g-co2", "Carbon dioxide in arterial blood. Low when faster breathing blows it off, high when dead space or tiring breathing stops it being cleared."], ["ph", "Acid or alkali", "g-ph", "Blood pH. Low carbon dioxide gives respiratory alkalosis, high carbon dioxide gives respiratory acidosis. The kidney partly corrects it over days."], ["hc", "Bicarbonate", "g-hc", "Bicarbonate held by the kidney. It rises over days to offset chronic acidosis and falls to offset chronic alkalosis (metabolic compensation)."], ["ve", "Ventilation", "g-ve", "How much the patient is breathing. Low oxygen drives it up; exhaustion lowers it; a ventilator sets it, and can overshoot."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  CX.forEach((cx, i) => {
    pill(ox, "Airway", cx + 11, 92, cx + 80, 88, "Airway: carries air to the alveolus.");
    pill(ox, "Alveolus", cx + 30, 128, cx + 100, 138, i === 0 ? "Alveolus with no air getting in (collapsed or filled), so it cannot add oxygen to the blood." : i === 1 ? "Alveolus: oxygen passes into the blood and carbon dioxide passes out." : "Alveolus that gets air but no blood, so no gas exchange happens here.");
    pill(ox, "Capillary", cx + 90, 205, cx + 100, 233, i === 2 ? "Capillary whose blood flow is blocked: the air that reaches this alveolus is wasted (dead space)." : "Capillary: the red cells pick up oxygen and drop off carbon dioxide here.");
  });
  pill(ox, "Mucus plug", CX[0], 96, CX[0] - 82, 96, "Mucus plug, collapse or fluid. Air cannot reach the alveolus, so blood passing it stays oxygen-poor (shunt). Oxygen does little because no air arrives.");
  pill(ox, "Clot", CX[2] - 70, 205, CX[2] - 92, 233, "A clot (for example pulmonary embolism) blocks blood flow, so the alveolus is ventilated but not perfused (dead space).");
  pill(ox, "Mixed blood", 700, CY, 890, CY + 22, "The blood from all units mixes in the left heart. Shunt blood lowers the oxygen; dead space and poor breathing raise carbon dioxide.");
  pill(ox, "Kidney tubule", 250, 408, 380, 372, "Kidney tubule. It holds back bicarbonate (a base) when carbon dioxide stays high for days, and lets it go when carbon dioxide is low.");
  pill(ox, "Acid in urine", 490, 402, 450, 432, "Acid (H+) passed in urine. The kidney clears more of it in chronic respiratory acidosis.");
  pill(ox, "Oxygen", 615, 400, 615, 432, "Oxygen (supplemental): lifts oxygen in blood from under-ventilated units. It barely helps true shunt, and in some patients it can reduce the drive to breathe.");
  pill(ox, "Bronchodilator", 745, 400, 745, 432, "Bronchodilator: opens narrowed airways so more air reaches the alveoli, shrinking the shunt-like part of the mismatch.");
  pill(ox, "Ventilation support", 872, 398, 872, 432, "Ventilation support (mask or ventilator): sets how much the patient breathes, clears carbon dioxide and can open collapsed units, but can overshoot into alkalosis.");
  const lg = mk("g", {}, ox); [["p-o2", "oxygen", 30], ["p-co2", "CO2", 130], ["p-h", "acid (H+)", 200], ["p-hco3", "bicarbonate", 310]].forEach(([c, n, x]) => { mk("circle", { class: "sc-p " + c, cx: x, cy: 258, r: 3 }, lg); const tx = mk("text", { class: "sc-lab", x: x + 8, y: 261 }, lg); tx.textContent = n; });
  mk("ellipse", { cx: 430, cy: 258, rx: 4.6, ry: 3.6, fill: satColor(1), class: "vq-rbc" }, lg); const t1 = mk("text", { class: "sc-lab", x: 440, y: 261 }, lg); t1.textContent = "oxygen-rich cell";
  mk("ellipse", { cx: 570, cy: 258, rx: 4.6, ry: 3.6, fill: satColor(0), class: "vq-rbc" }, lg); const t2 = mk("text", { class: "sc-lab", x: 580, y: 261 }, lg); t2.textContent = "oxygen-poor cell";
}
function init() { initPanel(); }
function fly(p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; at(p); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  ["Sh", "Ds", "Hx", "O", "E", "C", "B", "P", "Ac"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k2); });
  ["ox", "bd", "vt"].forEach((n) => { sm[n] = lerp(sm[n], m[n], k1); });
  const flow = 46;
  /* breathing: alveoli swell and shrink; shunt alveolus is small and still */
  breathPh += dt * (1.4 + 2.6 * sm.E); const amp = 0.04 + 0.1 * sm.E;
  alv.forEach((g, i) => { const base = i === 0 ? 1 - 0.38 * sm.Sh / 0.6 : 1, s = base * (1 + (i === 0 ? 0.3 : 1) * amp * Math.sin(breathPh)); g.setAttribute("transform", "translate(" + CX[i] + " 138) scale(" + s.toFixed(3) + ")"); });
  fluid.setAttribute("opacity", (0.55 * sm.Sh / 0.6).toFixed(2)); fluid.setAttribute("r", f1(30 * (1 - 0.38 * sm.Sh / 0.6)));
  plug.setAttribute("rx", f1(3 + 8 * sm.Sh / 0.6)); plug.setAttribute("ry", f1(4 + 6 * sm.Sh / 0.6));
  clot.setAttribute("rx", f1(4 + 14 * sm.Ds / 0.55)); clot.setAttribute("ry", f1(4 + 8 * sm.Ds / 0.55));
  /* capillary red cells */
  const sat = [clamp(0.1 + 0.8 * (1 - sm.Sh / 0.6) + 0.05 * sm.ox), clamp(0.95), clamp(0.93)];
  rbcs.forEach((arr, ui) => {
    const cx = CX[ui], want = ui === 2 ? Math.round(9 * (1 - 0.8 * sm.Ds / 0.55)) : 9, sp = ui === 2 ? 0.14 * (1 - 0.7 * sm.Ds / 0.55) : 0.14;
    arr.forEach((c, i) => { c.u += sp * dt; if (c.u > 1) { c.u -= 1; c.r = rnd(-0.5, 0.5); } const x = cx - 124 + 248 * c.u; if (ui === 2 && x < CX[2] - 70 + 6 + (4 + 14 * sm.Ds / 0.55)) { /* behind the clot */ c.u = Math.max(c.u, (CX[2] - 70 + 22 - (cx - 124)) / 248); }
      const xx = cx - 124 + 248 * c.u, s = lerp(0.1, sat[ui], clamp((xx - (cx - 45)) / 90));
      c.e.setAttribute("transform", "translate(" + f1(xx) + " " + f1(205 + c.r * 8) + ")"); c.e.style.fill = satColor(s); c.e.setAttribute("opacity", i < want ? "1" : "0"); });
  });
  /* air down the airways; blocked in the shunt unit; wasted in dead space */
  CX.forEach((cx, ui) => { const pl = air[ui]; const r = (0.8 + 2.2 * sm.E) * (1 + 0.8 * sm.ox) * (ui === 0 ? 1 - 0.8 * sm.Sh / 0.6 : 1);
    acc.air[ui] += dt * r; while (acc.air[ui] >= 1) { acc.air[ui]--; const p = free(pl); if (p) emit(p, cx + rnd(-4, 4), 76, 0, 44, 0); }
    pl.forEach((p) => { if (!p.on) return; fly(p, dt); if (ui === 0 && p.y > 108 - 14 * (sm.Sh / 0.6)) { kill(p); return; } if (p.y > 128) kill(p); }); });
  acc.cross += dt * (0.8 + 2 * sm.E) * (1 + 0.5 * sm.ox); while (acc.cross >= 1) { acc.cross--; const p = free(crossO); if (p) emit(p, CX[1] + rnd(-16, 16), 172, 0, 34, 0); }
  crossO.forEach((p) => { if (!p.on) return; fly(p, dt); if (p.y > 198) kill(p); });
  acc.exh += dt * (0.6 + 3 * sm.E); while (acc.exh >= 1) { acc.exh--; const p = free(exh); if (p) emit(p, CX[1] + rnd(-10, 10), 176, 0, -34, 0); }
  exh.forEach((p) => { if (!p.on) return; fly(p, dt); p.e.setAttribute("opacity", clamp((p.y - 70) / 30).toFixed(2)); if (p.y < 72) kill(p); });
  /* arterial blood: red cells (oxygen-rich or poor), carbon dioxide and acid */
  const hh = 34, wr = Math.round(sm.O * 6), wc = Math.round(sm.C * aCo2.length * 1.1), wh = Math.round(sm.Ac * aH.length);
  aRbc.forEach((p, i) => { p.x += flow * dt; if (p.x > 944) { p.x = 20; p.r = rnd(-0.8, 0.8); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * (hh - 8)) + ")"); p.e.style.fill = satColor(clamp(sm.O * 1.05 + (i % 5 === 0 ? 0.15 : -0.1))); });
  [[aCo2, wc, 0.9], [aH, wh, 0.8]].forEach(([arr, want, sp]) => arr.forEach((p, i) => { p.x += flow * sp * dt; if (p.x > 946) { p.x = 16; p.r = rnd(-0.8, 0.8); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * (hh - 6)) + ")"); p.e.setAttribute("opacity", i < want ? "1" : "0"); }));
  const tint = sm.P < 0.5 ? "#f2a03a" : "#5ea8f2", amt = Math.min(45, Math.abs(sm.P - 0.5) * 90);
  layers.lumen.style.fill = "color-mix(in srgb," + tint + " " + amt.toFixed(0) + "%,color-mix(in srgb,var(--c-rbc) 14%,var(--anatomy-paper)))";
  /* kidney: bicarbonate kept, acid lost */
  const nb = Math.round(sm.B * kb.length); kb.forEach((p, i) => { p.u = (p.u + dt * 0.1) % 1; const a = TUBE.at(p.u); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); p.e.setAttribute("opacity", i < nb ? "1" : "0"); });
  const nh = Math.round(clamp(sm.Ac * 1.3 + (sm.P > 0.55 ? 0 : 0.15)) * kh.length); kh.forEach((p, i) => { p.u = (p.u + dt * 0.1) % 1; const a = TUBE.at(0.3 + 0.7 * p.u); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y + 4) + ")"); p.e.setAttribute("opacity", i < nh ? "1" : "0"); });
  acc.keep += dt * sm.B * 3; while (acc.keep >= 1) { acc.keep--; const p = free(keep), a = TUBE.at(rnd(0.1, 0.5)); if (p) emit(p, a.x, a.y - 8, 0, -30, 0); }
  keep.forEach((p) => { if (!p.on) return; fly(p, dt); p.e.setAttribute("opacity", clamp((p.y - 370) / 12).toFixed(2)); if (p.y < 372) kill(p); });
  /* treatment sources */
  $("tr-ox").style.opacity = (0.3 + 0.7 * sm.ox).toFixed(2); $("tr-bd").style.opacity = (0.3 + 0.7 * sm.bd).toFixed(2); $("tr-vt").style.opacity = (0.3 + 0.7 * sm.vt).toFixed(2);
  belBody.setAttribute("height", f1(36 - sm.vt * 8 * (0.5 + 0.5 * Math.sin(breathPh * 1.3))));
  acc.spray += dt * (sm.ox * 4 + sm.bd * 4 + sm.vt * 4); while (acc.spray >= 1) { acc.spray--; const p = free(spray); if (!p) continue; const w = Math.random() * (sm.ox + sm.bd + sm.vt); if (w < sm.ox) emit(p, 632, 392, 26, rnd(-4, 2), 0); else if (w < sm.ox + sm.bd) emit(p, 770, 409, 22, -6, 0); else emit(p, 896, 396, 22, rnd(-4, 2), 0); }
  spray.forEach((p) => { if (!p.on) return; fly(p, dt); p.e.setAttribute("opacity", clamp(1 - p.t / 0.9).toFixed(2)); if (p.t += dt, p.t > 0.9) kill(p); });
  /* gauges */
  gg.ox.set(sm.O, wordOf(sm.O, 0.35, 0.7, ["very low", "low", "normal"])); gg.co2.set(sm.C, wordOf(sm.C, 0.3, 0.55, ["low", "normal", "high"])); gg.ph.set(sm.P, wordOf(sm.P, 0.4, 0.6, ["acidosis", "near normal", "alkalosis"]));
  gg.hc.set(sm.B, wordOf(sm.B, 0.4, 0.62, ["low", "normal", "raised"])); gg.ve.set(sm.E, wordOf(sm.E, 0.4, 0.65, ["low", "normal", "fast"]));
}
const acc = { air: [0, 0, 0], cross: 0, exh: 0, keep: 0, spray: 0 };
run({ init, step });
