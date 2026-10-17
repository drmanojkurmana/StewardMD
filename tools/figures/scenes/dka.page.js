/* DKA scene: insulin-deficient muscle and liver, ketone production, blood, kidney loss, lungs and the treatment sources. */
const CY = SC.CY, WW = SC.W;
const layers = { lungs: $("lungs"), muscle: $("muscle"), cells: $("cells"), tr: $("tr"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel"), lumen: $("lumen") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, tx: 0, ty: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
const dot = (cls, r) => () => mk("circle", { class: "sc-p " + cls, r }, layers.parts);
const dia = (cls) => () => mk("path", { class: "sc-p " + cls, d: "M0 -3.4L3.2 0L0 3.4L-3.2 0Z" }, layers.parts);
const sm = { G: 0.8, Kt: 0.7, De: 0.7, Sh: 0.6, Kr: 0.6, Ks: 0.6, Kin: 0.3, ins: 0, fl: 0, kcl: 0, a: 0.75, og: 0.08 };
let hh = 34, breathPh = 0;

/* ---- cells ---- */
const beta = cell(layers.cells, { cls: "bcell", r: 34, nuc: 0.4, seed: 3, wob: 0.1, x: 100, y: 150 });
const alpha = cell(layers.cells, { cls: "acell", r: 24, nuc: 0.4, seed: 5, wob: 0.1, x: 200, y: 185 });
const vesicles = [[-12, -8], [8, -14], [14, 4], [-6, 10], [-16, 6], [2, 0]].map(([x, y]) => { const c = mk("circle", { class: "sc-p p-ins", r: 2.6, cx: 100 + x, cy: 150 + y }, layers.cells); c.setAttribute("opacity", "0.35"); return c; });
const fat = cell(layers.cells, { cls: "fat", r: 38, seed: 7, wob: 0.07, x: 345, y: 192 });
const vac = mk("circle", { class: "cl-vac cl-b", cx: 345, cy: 192, r: 24, style: "fill:#fff3c0;stroke:#d9b44a" }, layers.cells);
const liver = cell(layers.cells, { cls: "liver", r: 54, nuc: 0.28, seed: 9, wob: 0.1, x: 500, y: 150 });
/* ---- muscle ---- */
const mus = mk("rect", { class: "dka-musc", x: 650, y: 100, width: 260, height: 120, rx: 24 }, layers.muscle);
for (let i = 0; i < 12; i++) mk("path", { class: "dka-stri", d: "M" + (672 + i * 20) + " 112L" + (672 + i * 20) + " 208" }, layers.muscle);
const gates = [680, 735, 790, 845, 900].map((x) => ({ x, l: mk("rect", { class: "dka-gate", x: x - 8, y: 216, width: 7, height: 10, rx: 2 }, layers.muscle), r: mk("rect", { class: "dka-gate", x: x + 1, y: 216, width: 7, height: 10, rx: 2 }, layers.muscle), cross: mk("path", { class: "dka-stop", d: "M" + (x - 4) + " 230l8 8M" + (x + 4) + " 230l-8 8" }, layers.muscle) }));
const kin = Array.from({ length: 16 }, (_, i) => mk("circle", { class: "sc-p p-k", r: 3, cx: 672 + (i % 8) * 31 + (i > 7 ? 14 : 0), cy: 134 + Math.floor(i / 8) * 44 }, layers.muscle));
/* ---- lungs ---- */
const lobes = [58, 108].map((x, i) => { const g = mk("g", {}, layers.lungs); mk("path", { class: "dka-lung", d: "M0 -26C16 -26 24 -8 22 10C20 24 8 28 0 24C-8 28 -20 24 -22 10C-24 -8 -16 -26 0 -26Z" }, g); mk("path", { class: "dka-stri", d: "M0 -20L0 12M0 -4L-10 6M0 -4L10 6" }, g); return { g, x }; });
/* ---- treatment sources ---- */
const bag = mk("g", { id: "tr-fl" }, layers.tr); mk("path", { class: "dka-icon", d: "M60 380h40v34a20 12 0 0 1-40 0Z" }, bag); mk("path", { class: "dka-icon", d: "M76 380v-6h8v6" }, bag); mk("path", { class: "p-fl", d: "M80 394c4 5 5 8 5 10a5 5 0 0 1-10 0c0-2 1-5 5-10Z" }, bag);
const syr = mk("g", { id: "tr-ins" }, layers.tr); mk("rect", { class: "dka-ico2", x: 232, y: 386, width: 60, height: 16, rx: 3 }, syr); mk("path", { class: "dka-ico2", d: "M292 392h18v4h-18Z" }, syr); mk("path", { class: "dka-ico2", d: "M226 394h8M226 388v12" }, syr); mk("path", { class: "dka-ico2", d: "M250 386v16M262 386v16M274 386v16" }, syr);
const kb = mk("g", { id: "tr-kcl" }, layers.tr); mk("path", { class: "dka-ico3", d: "M400 380h40v34a20 12 0 0 1-40 0Z" }, kb); mk("path", { class: "dka-ico3", d: "M416 380v-6h8v6" }, kb); mk("circle", { class: "sc-p p-k", cx: 420, cy: 400, r: 5 }, kb);
/* ---- pools ---- */
const gl = Array.from({ length: 30 }, () => ({ e: dot("p-gluc", 3)(), x: rnd(160, 940), r: rnd(-0.8, 0.8) }));
const ke = Array.from({ length: 22 }, () => ({ e: dia("p-ket")(), x: rnd(160, 940), r: rnd(-0.8, 0.8) }));
const ks = Array.from({ length: 14 }, () => ({ e: dot("p-k", 3)(), x: rnd(160, 940), r: rnd(-0.8, 0.8) }));
const up = pool(14, dot("p-gluc", 3)), kout = pool(10, dot("p-k", 3)), kinflux = pool(10, dot("p-k", 3));
const ffa = pool(10, () => mk("path", { class: "sc-p p-ffa", d: "M-4 0C-2 -3 2 3 4 0", style: "fill:none;stroke:#e89a3c;stroke-width:2" }, layers.parts));
const kprod = pool(10, dia("p-ket")), gprod = pool(10, dot("p-gluc", 3)), gcg = pool(8, () => mk("path", { class: "sc-p p-gcg", d: "M0 -4L1.2 -1.2L4 0L1.2 1.2L0 4L-1.2 1.2L-4 0L-1.2 -1.2Z" }, layers.parts));
const insp = pool(14, () => mk("path", { class: "sc-p p-ins", d: "M0 -3.4L3 -1.7L3 1.7L0 3.4L-3 1.7L-3 -1.7Z" }, layers.parts));
const ivp = pool(16, () => mk("path", { class: "p-iv", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const kcp = pool(12, dot("p-k", 3.4));
const co2 = pool(10, () => mk("circle", { class: "sc-p p-co2", r: 2.8 }, layers.parts));
const TUBE = track(SC.tube);
const ng = Array.from({ length: 12 }, () => ({ e: dot("p-gluc", 3)(), u: Math.random() }));
const wat = pool(24, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const salt = pool(10, dot("p-salt", 2.6));
/* ---- marks (stops) ---- */
const stops = [[470, 210], [532, 214], [405, 175]].map(([x, y]) => { const g = mk("g", { opacity: "0" }, layers.marks); mk("circle", { class: "dka-stop", cx: x, cy: y, r: 7 }, g); mk("path", { class: "dka-stop", d: "M" + (x - 5) + " " + (y + 5) + "L" + (x + 5) + " " + (y - 5) }, g); return g; });
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [130, 300, 470, 640, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["gl", "Glucose", "g-gl", "Blood glucose. High because there is almost no insulin: muscle cannot take it up and the liver keeps making more."], ["kt", "Ketones, acid", "g-acid", "Ketone acids from fatty-acid breakdown. They lower blood pH (acidosis) and widen the anion gap."], ["de", "Dehydration", "g-dehy", "Water, sodium and potassium lost in urine because glucose drags water out (osmotic diuresis). Fluids correct it."], ["kr", "Potassium risk", "g-kr", "Total body potassium is low even if the blood level looks normal or high. Insulin pushes potassium into cells, so the level can fall dangerously fast without replacement."], ["sh", "Shock", "g-sh", "Low blood volume lowers blood pressure and organ perfusion."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Beta cell", 100, 150, 100, 100, "Pancreatic beta cell. In type 1 diabetes it has been destroyed, so almost no insulin is released (the vesicles stay full).");
  pill(ox, "Alpha cell", 200, 185, 206, 228, "Alpha cell. It releases glucagon, which tells the liver to make more glucose and ketones. Glucagon and other stress hormones are high in DKA.");
  pill(ox, "Fat cell", 345, 192, 345, 104, "Fat cell. Without insulin its fat store breaks down (lipolysis) and releases free fatty acids.");
  pill(ox, "Liver cell", 500, 150, 500, 80, "Liver cell. It turns fatty acids into ketone bodies and, with no insulin to stop it, keeps making glucose (gluconeogenesis, glycogen breakdown).");
  pill(ox, "Muscle cell", 780, 150, 780, 88, "Muscle cell. Glucose enters through GLUT4 gates that need insulin. With no insulin the gates stay shut, and potassium leaks out of the cell.");
  pill(ox, "GLUT4 gates", 790, 226, 830, 244, "GLUT4 transporters: opened by insulin. Closed here, so glucose piles up in the blood.");
  pill(ox, "Kidney tube", 700, 392, 692, 366, "Kidney tubule. Glucose above the tubule's capacity stays in the urine and drags water, sodium and potassium with it (osmotic diuresis).");
  pill(ox, "Lost in urine", 860, 398, 880, 438, "Water, sodium and potassium lost in urine: the main cause of dehydration in DKA.");
  pill(ox, "Fluids", 80, 406, 80, 436, "Intravenous fluids: refill the blood vessels and dilute the glucose.");
  pill(ox, "Insulin", 262, 402, 262, 436, "Insulin (given): switches off ketone and glucose production, opens the muscle gates and drives glucose and potassium into cells.");
  pill(ox, "Potassium", 420, 410, 420, 436, "Potassium replacement (with monitoring): prevents the dangerous fall in potassium when insulin pushes it back into cells.");
  [[lobes[0].x, 320, "Lungs: deep, fast breathing (Kussmaul) blows off carbon dioxide to offset the acid."]].forEach(([x, y, tip]) => { const hg = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, ox); mk("rect", { x: 28, y: 290, width: 106, height: 46, rx: 12, fill: "transparent" }, hg); });
  // a small legend in the gap above the blood
  const lg = mk("g", {}, ox); [["p-gluc", "glucose", 300], ["p-ket", "ketone acid", 392], ["p-k", "potassium", 510], ["p-ins", "insulin", 612]].forEach(([c, n, x]) => { mk("circle", { class: "sc-p " + c, cx: x, cy: 258, r: 3 }, lg); const tx = mk("text", { class: "sc-lab", x: x + 8, y: 261 }, lg); tx.textContent = n; });
}
function init() { initPanel(); }
function fly(p, dt, sx) { p.x += p.vx * dt; p.y += p.vy * dt; at(p); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.G = lerp(sm.G, m.G, k2); sm.Kt = lerp(sm.Kt, m.Kt, k2); sm.De = lerp(sm.De, m.De, k2); sm.Sh = lerp(sm.Sh, m.Sh, k2); sm.Kr = lerp(sm.Kr, m.Kr, k2); sm.Ks = lerp(sm.Ks, m.Ks, k2); sm.Kin = lerp(sm.Kin, m.Kin, k2);
  sm.ins = lerp(sm.ins, m.ins, k1); sm.fl = lerp(sm.fl, m.fl, k1); sm.kcl = lerp(sm.kcl, m.kcl, k1); sm.a = m.a; sm.og = lerp(sm.og, m.ins ? 0.95 : 0.08, k1);
  hh = 34 * (1 - 0.38 * sm.De) + 2 * Math.sin(tm / 900);
  layers.lumen.setAttribute("y", f1(CY - hh)); layers.lumen.setAttribute("height", f1(hh * 2));
  const flow = 48 * (1 - 0.5 * sm.Sh);
  /* blood: glucose, ketone acid, potassium */
  const wg = Math.round(sm.G * gl.length), wk = Math.round(sm.Kt * ke.length), wp = Math.round(sm.Ks * ks.length);
  [[gl, wg, 1], [ke, wk, 0.85], [ks, wp, 0.75]].forEach(([arr, want, sp]) => arr.forEach((p, i) => { const on = i < want; p.x += flow * sp * dt; if (p.x > 946) { p.x = 162; p.r = rnd(-0.8, 0.8); } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(CY + p.r * (hh - 6)) + ")"); p.e.setAttribute("opacity", on ? "1" : "0"); }));
  /* muscle gates and potassium */
  gates.forEach((g, i) => { const o = sm.og * 6; g.l.setAttribute("x", f1(g.x - 8 - o)); g.r.setAttribute("x", f1(g.x + 1 + o)); g.cross.setAttribute("opacity", (1 - sm.og).toFixed(2)); g.l.classList.toggle("open", sm.og > 0.5); g.r.classList.toggle("open", sm.og > 0.5); });
  const wkin = Math.round(sm.Kin * kin.length); kin.forEach((d, i) => d.setAttribute("opacity", i < wkin ? "1" : "0.12"));
  acc.up += dt * sm.og * (0.3 + sm.G) * 6; while (acc.up >= 1) { acc.up--; const p = free(up), g = pick(gates); if (p) emit(p, g.x, CY - hh - 2, 0, -50, 0); }
  up.forEach((p) => { if (!p.on) return; fly(p, dt); if (p.y < 190) kill(p); });
  acc.kout += dt * (1 - sm.Kin) * 3; while (acc.kout >= 1) { acc.kout--; const p = free(kout); if (p) emit(p, rnd(670, 890), 214, 0, 32, 0); }
  kout.forEach((p) => { if (!p.on) return; fly(p, dt); if (p.y > CY - hh - 2) kill(p); });
  acc.kin += dt * sm.ins * sm.og * 4; while (acc.kin >= 1) { acc.kin--; const p = free(kinflux), g = pick(gates); if (p) emit(p, g.x + 4, CY - hh - 2, 0, -46, 0); }
  kinflux.forEach((p) => { if (!p.on) return; fly(p, dt); if (p.y < 190) kill(p); });
  /* fat to liver to blood */
  const Lr = (0.25 + 0.75 * sm.a) * (1 - 0.85 * sm.ins);
  vac.setAttribute("r", f1(24 - 7 * Lr));
  acc.ffa += dt * Lr * 5; while (acc.ffa >= 1) { acc.ffa--; const p = free(ffa); if (p) emit(p, 372, 188 + rnd(-8, 8), 56, -6, 0); }
  ffa.forEach((p) => { if (!p.on) return; fly(p, dt); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 452) kill(p); });
  acc.kp += dt * Lr * 4 * sm.Kt; while (acc.kp >= 1) { acc.kp--; const p = free(kprod); if (p) emit(p, 480 + rnd(-10, 10), 196, 0, 42, 0); }
  kprod.forEach((p) => { if (!p.on) return; fly(p, dt); if (p.y > CY - hh) kill(p); });
  acc.gp += dt * Lr * 3.5 * (0.4 + sm.G); while (acc.gp >= 1) { acc.gp--; const p = free(gprod); if (p) emit(p, 535 + rnd(-8, 8), 196, 0, 42, 0); }
  gprod.forEach((p) => { if (!p.on) return; fly(p, dt); if (p.y > CY - hh) kill(p); });
  acc.gcg += dt * (0.3 + 0.7 * sm.a) * (1 - 0.4 * sm.ins) * 2.2; while (acc.gcg >= 1) { acc.gcg--; const p = free(gcg); if (p) emit(p, 222, 182 + rnd(-6, 6), 62, -4, 0); }
  gcg.forEach((p) => { if (!p.on) return; fly(p, dt); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); if (p.x > 460) kill(p); });
  stops[0].setAttribute("opacity", sm.ins.toFixed(2)); stops[1].setAttribute("opacity", sm.ins.toFixed(2)); stops[2].setAttribute("opacity", sm.ins.toFixed(2));
  /* treatment sources: icons light up, particles run into the blood */
  $("tr-fl").style.opacity = (0.3 + 0.7 * sm.fl).toFixed(2); $("tr-ins").style.opacity = (0.3 + 0.7 * sm.ins).toFixed(2); $("tr-kcl").style.opacity = (0.3 + 0.7 * sm.kcl).toFixed(2);
  acc.iv += dt * sm.fl * 5; while (acc.iv >= 1) { acc.iv--; const p = free(ivp); if (p) emit(p, 80, 372, 40, -50, 0); }
  ivp.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.y < CY + hh - 2) { p.k = 1; p.vx = flow * 1.3; p.vy = 0; p.y = CY + rnd(-hh + 8, hh - 8); } } else { p.x += p.vx * dt; } at(p); if (p.x > 944) kill(p); });
  acc.insv += dt * sm.ins * 2.6; while (acc.insv >= 1) { acc.insv--; const p = free(insp); if (p) { emit(p, 270, 384, 0, -50, 0); p.liver = Math.random() < 0.45; p.tx = p.liver ? 500 + rnd(-30, 30) : pick(gates).x; } }
  insp.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y < CY + 6) { p.k = 1; p.y = CY + rnd(-6, 6); } } else if (p.k === 1) { p.x += 90 * dt; if (p.x >= p.tx) { p.k = 2; p.x = p.tx; } } else { p.y -= 60 * dt; if (p.y < (p.liver ? 200 : 214)) kill(p); } at(p); });
  acc.kcl += dt * sm.kcl * 2.6; while (acc.kcl >= 1) { acc.kcl--; const p = free(kcp); if (p) emit(p, 420, 372, 0, -50, 0); }
  kcp.forEach((p) => { if (!p.on) return; if (p.k === 0) { p.y += p.vy * dt; if (p.y < CY + 6) { p.k = 1; p.y = CY + rnd(-8, 8); } } else { p.x += flow * 1.1 * dt; } at(p); if (p.x > 944) kill(p); });
  /* lungs: deeper and faster with acid */
  breathPh += dt * (1.2 + 4.2 * sm.Kt); const amp = 0.05 + 0.22 * sm.Kt;
  lobes.forEach((l) => l.g.setAttribute("transform", "translate(" + l.x + " 316) scale(" + (1 + amp * Math.sin(breathPh)).toFixed(3) + " " + (1 + amp * 1.2 * Math.sin(breathPh)).toFixed(3) + ")"));
  acc.co2 += dt * sm.Kt * 4; while (acc.co2 >= 1) { acc.co2--; const p = free(co2); if (p) emit(p, 70 + rnd(-30, 40), 302, 0, -26, 0); }
  co2.forEach((p) => { if (!p.on) return; fly(p, dt); p.e.setAttribute("opacity", clamp(1 - (302 - p.y) / 34).toFixed(2)); if (p.y < 268) kill(p); });
  /* kidney: glucose in the tube drags water, sodium and potassium out */
  const wn = Math.round(sm.G * ng.length); ng.forEach((p, i) => { p.u = (p.u + dt * 0.12) % 1; const a = TUBE.at(p.u); p.e.setAttribute("transform", "translate(" + f1(a.x) + " " + f1(a.y) + ")"); p.e.setAttribute("opacity", i < wn ? "1" : "0"); });
  acc.wat += dt * sm.G * 5; while (acc.wat >= 1) { acc.wat--; const p = free(wat), a = TUBE.at(rnd(0.15, 0.9)); if (p) emit(p, a.x, a.y + 8, rnd(-3, 3), 22, 0); }
  wat.forEach((p) => { if (!p.on) return; fly(p, dt); p.e.setAttribute("opacity", clamp(1 - (p.y - 400) / 36).toFixed(2)); if (p.t += dt, p.t > 1.6) kill(p); });
  acc.salt += dt * sm.G * 2; while (acc.salt >= 1) { acc.salt--; const p = free(salt), a = TUBE.at(rnd(0.2, 0.85)); if (p) emit(p, a.x, a.y + 8, rnd(-4, 4), 18, 0); }
  salt.forEach((p) => { if (!p.on) return; fly(p, dt); if (p.t += dt, p.t > 1.5) kill(p); });
  /* cell life */
  place(beta, 100 + Math.sin(tm / 1700) * 1.5, 150 + Math.cos(tm / 2100) * 1.5, 0, 1); place(alpha, 200 + Math.sin(tm / 1500) * 1.5, 185, 0, 1 + 0.05 * Math.sin(tm / 400));
  place(liver, 500, 150 + Math.sin(tm / 1900) * 2, 0, 1 + 0.02 * Math.sin(tm / 700));
  /* gauges */
  gg.gl.set(sm.G, wordOf(sm.G, 0.4, 0.7, ["controlled", "high", "very high"])); gg.kt.set(sm.Kt, wordOf(sm.Kt, 0.25, 0.55, ["low", "present", "high"])); gg.de.set(sm.De, wordOf(sm.De, 0.3, 0.6, ["corrected", "moderate", "severe"]));
  gg.kr.set(sm.Kr, wordOf(sm.Kr, 0.3, 0.7, ["safe", "watch", "danger"])); gg.sh.set(sm.Sh, wordOf(sm.Sh, 0.3, 0.6, ["none", "mild", "severe"]));
}
const acc = { up: 0, kout: 0, kin: 0, ffa: 0, kp: 0, gp: 0, gcg: 0, iv: 0, insv: 0, kcl: 0, co2: 0, wat: 0, salt: 0 };
run({ init, step });
