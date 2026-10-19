/* GI bleeding scene: stomach and colon sources bleed into the gut while the heart and vessel show shock. Each treatment acts on the drawing. */
const layers = { stom: $("stomSlot"), col: $("colSlot"), heart: $("heartSlot"), rbc: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const upDrops = pool(22, () => mk("circle", { class: "sc-p p-bld", r: 3 }, layers.parts));
const loDrops = pool(20, () => mk("circle", { class: "sc-p p-bld", r: 3 }, layers.parts));
const fluids = pool(14, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const rbcs = [];
let stomO = null, colO = null, heartO = null, capEl = null, capDrug = -1;
let ulcer = [158, 118], inlet = [143, 73], poolU = [155, 209], src = [115, 332], rect = [150, 430], apex = [506, 236];
const gg = {};
const sm = { bleed: 0.5, vol: 0.6, bp: 0.6, perf: 0.6, hr: 0.4, shock: 0.3, upper: 0.5, lower: 0.5, resus: 0, endo: 0, surg: 0 };
const acc = { up: 0, lo: 0, fl: 0 };
function initOrgans() {
  stomO = organ(layers.stom, "stomach", 155, 148, 150, {});
  colO = organ(layers.col, "colon", 150, 343, 130, {});
  heartO = organ(layers.heart, "heart", 480, 150, 130, {});
  const SP = stomO.ports, CP = colO.ports, HP = heartO.ports;
  if (SP.antrum) ulcer = [SP.antrum[0], SP.antrum[1]];
  if (SP.in) inlet = [SP.in[0], SP.in[1]];
  poolU = [stomO.x, Math.round(stomO.y + stomO.h / 2 - 14)];
  if (CP.descending) src = [CP.descending[0], CP.descending[1]];
  if (CP.rectum) rect = [CP.rectum[0], CP.rectum[1]];
  if (HP.apex) apex = [HP.apex[0], HP.apex[1]];
  $("ulcer").setAttribute("cx", f1(ulcer[0])); $("ulcer").setAttribute("cy", f1(ulcer[1]));
  $("varix0").setAttribute("cx", f1(inlet[0] - 6)); $("varix0").setAttribute("cy", f1(inlet[1] + 14));
  $("varix1").setAttribute("cx", f1(inlet[0] + 6)); $("varix1").setAttribute("cy", f1(inlet[1] + 22));
  $("poolU").setAttribute("cx", f1(poolU[0])); $("poolU").setAttribute("cy", f1(poolU[1]));
  $("cbleed").setAttribute("cx", f1(src[0])); $("cbleed").setAttribute("cy", f1(src[1]));
  $("poolL").setAttribute("cx", f1(rect[0])); $("poolL").setAttribute("cy", f1(rect[1] - 8));
  $("clips").setAttribute("transform", "translate(" + f1(ulcer[0]) + " " + f1(ulcer[1]) + ")");
  $("tr-scope").setAttribute("d", "M" + f1(ulcer[0]) + " 52C" + f1(ulcer[0]) + " 80 " + f1(ulcer[0]) + " 96 " + f1(ulcer[0]) + " " + f1(ulcer[1] - 2));
  $("coilU").setAttribute("transform", "translate(" + f1(inlet[0]) + " " + f1(inlet[1] + 8) + ")");
  $("coilL").setAttribute("transform", "translate(" + f1(src[0] - 16) + " " + f1(src[1] - 8) + ")");
  $("tr-cath").setAttribute("d", "M330 400C280 380 200 360 " + f1(src[0] - 16) + " " + f1(src[1] - 8));
  $("heartOut").setAttribute("d", "M" + f1(apex[0]) + " " + f1(apex[1]) + "L" + f1(apex[0]) + " 292");
}
function capText(d) {
  if (d === 1) return "Resuscitation refills the circulation but the leak goes on.";
  if (d === 2) return "Clips close the stomach bleed. The colon bleed goes on.";
  if (d === 3) return "The source is blocked. Bleeding slows and flow recovers.";
  return "No treatment. Blood keeps leaking from the gut and pressure falls.";
}
function initPanel() {
  const P = layers.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["bl", "Bleeding", "g-bleed", "How fast blood is still leaving the circulation from the gut source."], ["vo", "Volume", "g-vol", "Circulating blood volume. It falls as blood is lost and rises with resuscitation fluids and blood."], ["bp", "Pressure", "g-press", "Blood pressure. It is held up at first by a faster pulse and tight vessels, then falls as loss continues."], ["pu", "Pulse", "g-pulse", "Pulse rate. It speeds up to compensate for lost volume, an early sign before pressure falls."], ["pe", "Perfusion", "g-perf", "Flow reaching the tissues. Poor perfusion gives pale, cold skin and, later, confusion and low urine output."], ["sh", "Shock", "g-shock", "Shock: perfusion too low for the tissues. It follows when compensation fails or the bleed is massive."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
  const o = layers.over;
  pill(o, "Stomach", 80, 120, 64, 94, "Stomach and gullet. An ulcer or burst varices bleed into the gut from here.");
  pill(o, "Ulcer", ulcer[0], ulcer[1], 252, 92, "Bleeding sore in the stomach lining. Its blood pools in the stomach and leaves as vomit or black stool.");
  pill(o, "Colon", 208, 300, 258, 272, "Large bowel. Fragile pouches and vessels in its wall can bleed bright red.");
  pill(o, "Colon bleed", src[0], src[1], 80, 410, "Bleed in the colon wall. It flows down and leaves as bright red stool.");
  pill(o, "Heart", 545, 110, 580, 66, "The heart beats faster to make up for lost blood. This hides the loss at first, then fails.");
  pill(o, "Blood flow", 480, 306, 480, 262, "Red cells in a large vessel. Flow falls as blood is lost and returns when volume is restored.");
  pill(o, "Lost blood", 678, 123, 760, 84, "Lost blood leaves as vomit or stool. Black means digested blood from high up. Bright red means lower down.");
  pill(o, "Shock", 716, 392, 836, 416, "Shock. Pale cold skin with a fast pulse and low pressure. The body is running short of blood.");
  capEl = mk("text", { class: "gb-cap", x: 340, y: 430 }, o); capEl.textContent = capText(0);
}
function init() {
  initOrgans();
  place(heartO.g, 480, 150, 0, 1);
  for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(355, 605), y: rnd(-0.8, 0.8), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  initPanel();
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["bleed", "vol", "bp", "perf", "hr", "shock", "upper", "lower", "resus", "endo", "surg"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "vol" || q === "bp" ? k1 : k2); });
  const beat = 1 + 0.07 * sm.hr * Math.sin(tm / (240 - 90 * sm.hr));
  place(heartO.g, 480, 150, 0, beat);
  $("varix0").setAttribute("r", f1(3 + 4 * sm.upper));
  $("varix1").setAttribute("r", f1(3 + 4 * sm.upper));
  $("ulcer").setAttribute("opacity", (0.45 + 0.55 * sm.upper).toFixed(2));
  $("poolU").setAttribute("opacity", clamp(sm.upper * 1.1).toFixed(2));
  $("poolL").setAttribute("opacity", clamp(sm.lower * 1.1).toFixed(2));
  $("cbleed").setAttribute("opacity", (0.45 + 0.55 * sm.lower).toFixed(2));
  $("clips").setAttribute("opacity", sm.endo.toFixed(2));
  $("tr-scope").setAttribute("opacity", (0.25 + 0.75 * sm.endo).toFixed(2));
  $("coilU").setAttribute("opacity", sm.surg.toFixed(2));
  $("coilL").setAttribute("opacity", sm.surg.toFixed(2));
  $("tr-cath").setAttribute("opacity", (0.25 + 0.75 * sm.surg).toFixed(2));
  $("tr-iv").setAttribute("opacity", (0.3 + 0.7 * sm.resus).toFixed(2));
  $("veil").setAttribute("opacity", (0.5 * sm.shock).toFixed(2));
  acc.up += dt * sm.upper * 9; while (acc.up >= 1) { acc.up--; const p = free(upDrops); if (p) { const v = Math.random() < 0.3; emit(p, v ? inlet[0] : ulcer[0], v ? inlet[1] + 18 : ulcer[1], rnd(-4, 10), rnd(26, 48), 0); } }
  upDrops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > poolU[1] || p.t > 3) kill(p); });
  acc.lo += dt * sm.lower * 8; while (acc.lo >= 1) { acc.lo--; const p = free(loDrops); if (p) emit(p, src[0], src[1], 0, 0, 0); }
  loDrops.forEach((p) => { if (!p.on) return; p.t += dt; const dx = rect[0] - p.x, dy = rect[1] - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 34 * dt; p.y += (dy / d) * 34 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8 || p.t > 5) kill(p); });
  const ves = $("vessel"); const vh = 12 + 26 * sm.vol; ves.setAttribute("y", f1(306 - vh / 2)); ves.setAttribute("height", f1(vh));
  const vf = 62 * clamp(0.2 + 0.85 * sm.perf);
  rbcs.forEach((r) => { r.x += r.v * vf * dt; if (r.x > 608) { r.x = 354; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, 306 + r.y * Math.max(4, vh / 2 - 7), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.fl += dt * sm.resus * 7; while (acc.fl >= 1) { acc.fl--; const p = free(fluids); if (p) emit(p, 357, 306 + rnd(-8, 8), 78, 0, 0); }
  fluids.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 606) kill(p); });
  $("sign-vom").setAttribute("opacity", clamp(sm.upper * 1.2).toFixed(2));
  $("sign-mel").setAttribute("opacity", clamp(0.25 + sm.upper).toFixed(2));
  $("sign-hae").setAttribute("opacity", clamp(sm.lower * 1.2).toFixed(2));
  $("pale").setAttribute("opacity", clamp(sm.shock * 0.85).toFixed(2));
  gg.bl.set(sm.bleed, wordOf(sm.bleed, 0.18, 0.5, ["slow", "steady", "brisk"]));
  gg.vo.set(sm.vol, wordOf(sm.vol, 0.4, 0.7, ["low", "reduced", "full"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.45, 0.68, ["low", "borderline", "maintained"]));
  gg.pu.set(sm.hr, wordOf(sm.hr, 0.35, 0.6, ["normal", "fast", "very fast"]));
  gg.pe.set(sm.perf, wordOf(sm.perf, 0.4, 0.65, ["poor", "reduced", "good"]));
  gg.sh.set(sm.shock, wordOf(sm.shock, 0.35, 0.7, ["none", "compensated", "overt"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
