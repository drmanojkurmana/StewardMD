/* Hepatorenal syndrome scene: cirrhotic liver, portal pressure, widened gut vessels, underfilled arteries, hormonal and nerve drive, a squeezed but normal kidney, ascites and urine salt. */
const layers = { fluid: $("fluid"), organs: $("organs"), flow: $("flow"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const at = (p) => p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");

/* ---- organs ---- */
const liver = cell(layers.organs, { cls: "liver", r: 54, nuc: 0, seed: 4, wob: 0.12, x: 130, y: 155 });
const nodG = mk("g", {}, layers.organs);
[[108, 132, 13], [142, 122, 11], [158, 152, 12], [122, 168, 14], [96, 158, 9], [146, 178, 9]].forEach(([x, y, r]) => mk("circle", { class: "hr-nod", cx: x, cy: y, r }, nodG));
const gut = cell(layers.organs, { cls: "gut", r: 46, nuc: 0.3, seed: 7, wob: 0.16, x: 470, y: 155 });
const gutV = mk("g", {}, layers.organs);
[[-26, -14, 0, 8], [-8, -22, 12, 4], [14, -16, 26, 6], [-18, 12, 2, 20], [10, 14, 28, 18]].forEach(([a, b, c, d]) => mk("path", { class: "hr-gutv", d: "M" + (470 + a) + " " + (155 + b) + "Q" + (470 + c) + " " + (155 + (b + d) / 2) + " " + (470 + c) + " " + (155 + d) }, gutV));
const artBg = mk("rect", { class: "hr-art", x: 578, y: 132, width: 146, height: 46, rx: 23 }, layers.organs);
const artFill = mk("rect", { x: 582, y: 138, width: 138, height: 34, rx: 17, fill: "var(--c-rbc)", opacity: "0.4" }, layers.organs);
const raas = cell(layers.organs, { cls: "raas", r: 36, nuc: 0.4, seed: 9, wob: 0.12, x: 830, y: 155 });
const kidney = cell(layers.organs, { cls: "kidney", r: 52, nuc: 0, seed: 5, wob: 0.1, x: 725, y: 335 });
const glom = mk("circle", { class: "hr-glom", cx: 712, cy: 322, r: 13 }, layers.organs);
mk("path", { class: "hr-tub", d: "M724 330C736 340 730 354 742 362C752 368 748 378 756 384" }, layers.organs);
const kidShade = mk("circle", { class: "hr-shade", cx: 725, cy: 335, r: 50, opacity: "0" }, layers.organs);
const blad = cell(layers.organs, { cls: "blad", r: 24, nuc: 0, seed: 3, wob: 0.1, x: 855, y: 378 });
mk("path", { class: "hr-tub", d: "M756 384C786 392 812 388 832 382" }, layers.organs);
const ascPool = mk("path", { class: "hr-pool", opacity: "0.32" }, layers.fluid);
const ascSurf = mk("path", { class: "hr-surf", opacity: "0.85" }, layers.fluid);

/* ---- flowing red cells in the portal and arterial stretch ---- */
const rbcs = [];
for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.flow); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(190, 720), y: rnd(-13, 13), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }

/* ---- particle pools (element is p.e) ---- */
const nos = pool(16, () => mk("circle", { class: "p-no", r: 3 }, layers.parts));
const sig = pool(20, () => mk("path", { class: "sc-p p-raas", d: "M0 -3.6L3.2 0L0 3.6L-3.2 0Z" }, layers.parts));
const urine = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const salt = pool(10, () => mk("circle", { class: "sc-p p-salt", r: 2 }, layers.parts));
const leak = pool(12, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const albP = pool(10, () => mk("circle", { class: "sc-p p-alb", r: 2.6 }, layers.parts));

const gg = {};
let tAlb, tHalt, tTxp;
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["portal", "Portal", "g-portal", "Pressure in the portal vein system. It rises as the scarred liver resists flow and widened gut arteries pour more blood in."], ["fill", "Filling", "g-good", "Effective arterial filling. Gut vessels widen and blood pools there, so the arterial side feels empty despite extra total fluid."], ["raas", "RAAS drive", "g-raas", "Renin angiotensin and sympathetic nerve activity. The body switches these on to defend pressure when filling falls."], ["sqz", "Renal squeeze", "g-bad", "How tightly the kidney arteries are squeezed by that hormonal and nerve drive."], ["kid", "Kidney", "g-good", "Kidney filtration. It falls from poor blood flow, not from damaged tissue: the kidney here is structurally normal."], ["salt", "Urine salt", "g-fl", "Salt appearing in the urine. The squeezed kidney holds on to salt, so urine salt is very low in hepatorenal syndrome."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Cirrhotic liver", 130, 106, 130, 84, "Cirrhotic liver. Scarring and nodules resist blood flow through the liver, so portal pressure rises.");
  pill(ox, "Portal pressure", 290, 138, 290, 84, "Portal pressure. Pressure builds in the portal vein as the liver resists flow and gut inflow stays high.");
  pill(ox, "Gut vessels widen", 470, 106, 470, 84, "Splanchnic arteries in the gut widen, driven in part by nitric oxide. Blood pools there instead of filling the arterial circulation.");
  pill(ox, "Arterial filling", 650, 126, 650, 84, "Effective arterial filling. The arterial side is underfilled even though total body fluid is up, because so much blood sits in the widened gut vessels.");
  pill(ox, "RAAS and nerves", 830, 112, 830, 84, "Renin angiotensin system and sympathetic nerves. Underfilling switches them on to defend blood pressure, at the cost of squeezing the kidney.");
  pill(ox, "Nitric oxide", 470, 204, 470, 228, "Nitric oxide. A vessel widening signal made in excess in cirrhosis. It helps open the gut arteries and start the underfilling.");
  pill(ox, "Kidney squeeze", 690, 300, 560, 262, "Renal vasoconstriction. Hormonal and nerve signals squeeze the kidney arteries hard, so filtration falls.");
  pill(ox, "Kidney", 778, 330, 860, 300, "The kidney. Structurally normal tissue that fails only because its blood supply is squeezed: a functional kidney failure.");
  pill(ox, "Ascites", 200, 386, 200, 415, "Ascites. Fluid in the abdomen from high portal pressure plus kidney retention of salt and water.");
  pill(ox, "Urine salt", 846, 360, 850, 415, "Urine salt. Very little salt reaches the urine because the kidney is holding on to salt tightly.");
  tAlb = pill(ox, "Albumin plus tightener", 650, 184, 620, 228, "Albumin expands the effective arterial volume and a vasoconstrictor tightens the widened gut arteries. Together they ease the squeeze on the kidney.");
  tAlb.setAttribute("id", "t-alb"); tAlb.style.opacity = 0;
  tHalt = pill(ox, "Stop harmful drugs", 690, 304, 340, 228, "Stopping diuretics and other kidney toxins removes triggers that reduce filling or injure the kidney and can tip the balance into failure.");
  tHalt.setAttribute("id", "t-halt"); tHalt.style.opacity = 0;
  tTxp = pill(ox, "New liver", 130, 204, 130, 228, "Liver transplant. A working liver removes the cirrhosis and portal hypertension that drive the whole chain, so the kidney can recover.");
  tTxp.setAttribute("id", "t-txp"); tTxp.style.opacity = 0;
}
const sm = { P: 0.6, D: 0.5, U: 0.4, R: 0.5, Rc: 0.4, K: 0.6, Asc: 0.5, UNa: 0.4, alb: 0, halt: 0, txp: 0, a: 0.7 };
const acc = { no: 0, sig: 0, ur: 0, salt: 0, leak: 0, alb: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["P", "D", "U", "R", "Rc", "Asc", "UNa", "alb", "halt", "txp"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.K = lerp(sm.K, m.K, k2); sm.a = m.a;
  /* vessels and organs */
  $("v-portal").setAttribute("stroke-width", f1(9 + 13 * sm.P));
  $("v-renal").setAttribute("stroke-width", f1(13 - 9 * sm.Rc));
  nodG.setAttribute("opacity", (0.25 + 0.75 * sm.a).toFixed(2));
  place(gut, 470, 155, Math.sin(tm / 2400) * 4, 1 + 0.28 * sm.D);
  gutV.setAttribute("opacity", (0.35 + 0.65 * sm.D).toFixed(2));
  gutV.setAttribute("transform", "translate(" + f1(470 * (1 - (1 + 0.28 * sm.D))) + " " + f1(155 * (1 - (1 + 0.28 * sm.D))) + ") scale(" + (1 + 0.28 * sm.D).toFixed(3) + ")");
  artFill.setAttribute("opacity", (0.18 + 0.6 * (1 - sm.U)).toFixed(2));
  artFill.setAttribute("width", f1(50 + 88 * (1 - sm.U)));
  place(raas, 830, 155, Math.sin(tm / 2000) * 5, 1 + 0.07 * sm.R * Math.sin(tm / 280));
  place(kidney, 725, 335, 0, 1);
  kidShade.setAttribute("opacity", ((1 - sm.K) * 0.42).toFixed(2));
  glom.setAttribute("r", f1(8 + 6 * sm.K));
  /* ascites pool, kept inside the stage */
  const topY = 436 - (8 + 74 * sm.Asc);
  let d = "M36 " + f1(topY), s = "M36 " + f1(topY);
  for (let x = 46; x <= 436; x += 10) { const y = topY + 1.6 * Math.sin(x / 24 + tm / 700); d += "L" + x + " " + f1(y); s += "L" + x + " " + f1(y); }
  ascPool.setAttribute("d", d + "L436 436L36 436Z"); ascSurf.setAttribute("d", s);
  /* red cells: portal vein into the arterial stretch */
  const spd = 46 * clamp(0.3 + 0.7 * (1 - sm.U));
  rbcs.forEach((r) => { r.x += r.v * spd * dt; if (r.x > 722) { r.x = 190; r.y = rnd(-13, 13); } place(r.g, r.x, 155 + r.y, r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* nitric oxide drifting out of the gut vessels */
  acc.no += dt * sm.D * 7; while (acc.no >= 1) { acc.no--; const p = free(nos); if (p) emit(p, 470 + rnd(-30, 30), 155 + rnd(-26, 26), rnd(-16, 16), rnd(-16, 16), 0); }
  nos.forEach((p) => { if (!p.on) return; p.t += dt; p.x = clamp(p.x + p.vx * dt, 398, 542); p.y = clamp(p.y + p.vy * dt, 88, 224); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.7).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.5).toFixed(2)); if (p.t > 1.5) kill(p); });
  /* hormonal and nerve signals travelling to the kidney */
  acc.sig += dt * sm.R * 9; while (acc.sig >= 1) { acc.sig--; const p = free(sig); if (p) emit(p, 806, 186, 0, 0, rnd(-8, 8)); }
  sig.forEach((p) => { if (!p.on) return; p.t += dt * 0.55; const u = clamp(p.t); p.x = lerp(806, 700, u); p.y = lerp(186, 302, u) + Math.sin(u * 3.1) * 8 + p.k * (1 - u); at(p); p.e.setAttribute("opacity", u >= 1 ? "0" : "1"); if (u >= 1) kill(p); });
  /* urine drops and the salt inside them, kept inside the stage */
  acc.ur += dt * sm.K * 5; while (acc.ur >= 1) { acc.ur--; const p = free(urine); if (p) emit(p, 754, 382, rnd(18, 26), rnd(-2, 4), 0); }
  urine.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt + 6 * dt; at(p); if (p.x > 838 || p.y > 398) kill(p); });
  acc.salt += dt * sm.K * sm.UNa * 6; while (acc.salt >= 1) { acc.salt--; const p = free(salt); if (p) emit(p, 758, 384, rnd(18, 26), rnd(-2, 4), 0); }
  salt.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt + 6 * dt; at(p); if (p.x > 840 || p.y > 400) kill(p); });
  /* ascites leak drops falling into the pool */
  acc.leak += dt * sm.Asc * 5; while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, rnd(80, 400), 252, rnd(-3, 3), rnd(24, 38), 0); }
  leak.forEach((p) => { if (!p.on) return; p.x = clamp(p.x + p.vx * dt, 40, 432); p.y += p.vy * dt; at(p); if (p.y > topY - 2) kill(p); });
  /* albumin and vasoconstrictor support flowing in the artery */
  acc.alb += dt * sm.alb * 7; while (acc.alb >= 1) { acc.alb--; const p = free(albP); if (p) emit(p, 586, 155 + rnd(-12, 12), rnd(52, 68), 0, 0); }
  albP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; at(p); if (p.x > 720) kill(p); });
  tAlb.style.opacity = sm.alb.toFixed(2); tHalt.style.opacity = sm.halt.toFixed(2); tTxp.style.opacity = sm.txp.toFixed(2);
  /* gauges */
  gg.portal.set(sm.P, wordOf(sm.P, 0.35, 0.7, ["mild", "raised", "very high"]));
  gg.fill.set(1 - sm.U, wordOf(1 - sm.U, 0.35, 0.65, ["low", "reduced", "maintained"]));
  gg.raas.set(sm.R, wordOf(sm.R, 0.3, 0.6, ["quiet", "active", "very active"]));
  gg.sqz.set(sm.Rc, wordOf(sm.Rc, 0.3, 0.6, ["relaxed", "tight", "very tight"]));
  gg.kid.set(sm.K, wordOf(sm.K, 0.35, 0.7, ["failing", "struggling", "working"]));
  gg.salt.set(sm.UNa, wordOf(sm.UNa, 0.3, 0.6, ["very low", "low", "present"]));
}
run({ init, step });
