/* Syphilis scene: chancre on skin, spread through a vessel, rash and gumma on skin, late brain and aorta harm, womb in pregnancy. */
const WW = SC.W;
const layers = { chan: $("chancreG"), lymph: $("lymphG"), rash: $("rashG"), gumma: $("gummaG"), dots: $("brainDots"), plac: $("placG"), rbc: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, tgt: null, hit: false }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.tgt = null; p.hit = false; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.tgt = null; p.e.setAttribute("opacity", "0"); }
/* germs: thin spiral organisms wandering three zones, ten per zone */
const ZBOX = [[60, 140, 250, 340], [370, 110, 680, 360], [700, 95, 935, 395]];
const spiro = [];
function initSpiro() { for (let i = 0; i < 30; i++) { const z = i % 3, b = ZBOX[z], e = mk("path", { class: "sc-p p-spiro", d: "M-11 0 Q-6 -7 0 0 Q6 7 11 0" }, layers.parts); spiro.push({ e, z, li: Math.floor(i / 3), x: rnd(b[0], b[2]), y: rnd(b[1], b[3]), a: rnd(0, 6.28), s: 1, dead: 0 }); } }
function nearSpiro(x, y) { let best = null, bd = 1e12; spiro.forEach((p) => { if (p.dead > 0 || p.s < 0.5) return; const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < bd) { bd = d; best = p; } }); return best; }
const imm = pool(14, () => mk("circle", { class: "sc-p p-imm", r: 2.3 }, layers.parts));
const caps = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const rbcs = [];
let skinO = null, vesselO = null, rashO = null, brainO = null, aortaO = null, uterusO = null;
let chanRim = null, chanUlc = null, macG = null, capEl = null, capDrug = -1, placDot = null;
let chanPos = [150, 196], rashPos = [600, 190], brainPos = [797, 150], placPos = [875, 294];
let rashDots = [], brainDots = [], wombMinis = [], gumBump = null, gumCore = null, trBlood = null;
const aortaX = 740, aortaY = 315;
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 150, 245, 150, {});
  vesselO = organ($("vesselSlot"), "vessel", 430, 235, 110, {});
  rashO = organ($("rashSlot"), "skin", 600, 245, 150, {});
  brainO = organ($("brainSlot"), "brain", 810, 160, 160, {});
  aortaO = organ($("aortaSlot"), "vessel", aortaX, aortaY, 64, {});
  uterusO = organ($("uterusSlot"), "uterus", 875, 320, 110, {});
  /* chancre ulcer sits on the entry skin surface */
  const SP = skinO.ports.surface || [150, 190];
  chanPos = [Math.round(SP[0]), Math.round(SP[1] + 6)];
  chanRim = mk("ellipse", { class: "sy-rim", cx: chanPos[0], cy: chanPos[1], rx: 42, ry: 15 }, layers.chan);
  chanUlc = mk("ellipse", { class: "sy-ulcer", cx: chanPos[0], cy: chanPos[1], rx: 30, ry: 9 }, layers.chan);
  macG = cell(layers.parts, { cls: "mac2", r: 20, nuc: 0.42, seed: 3, wob: 0.13 }); place(macG, 305, 175, 0, 1);
  /* nearby node swells beside the chancre */
  mk("ellipse", { class: "sy-node", cx: 150, cy: 372, rx: 36, ry: 22 }, layers.lymph);
  for (let i = 0; i < 5; i++) { const c = cell(layers.lymph, { cls: "lym2", r: 6, nuc: 0.5, seed: i + 4, wob: 0.1 }); place(c, 132 + (i % 3) * 18, 364 + Math.floor(i / 3) * 16, 0, 1); }
  /* rash dots and moist bumps on the second skin */
  const RP = rashO.ports.surface || [600, 190];
  rashPos = [Math.round(RP[0]), Math.round(RP[1])];
  for (let i = 0; i < 10; i++) { const bx = RP[0] - 55 + (i % 5) * 27, by = RP[1] - 4 + Math.floor(i / 5) * 22, br = 4 + (i % 3); const d = mk("circle", { class: "sy-rash", cx: f1(bx), cy: f1(by), r: br }, layers.rash); rashDots.push({ e: d, r: br }); }
  [[-40, 70], [0, 74], [40, 70]].forEach(([dx, dy]) => mk("ellipse", { class: "sy-rash", cx: rashO.x + dx, cy: rashO.y + dy, rx: 14, ry: 7 }, layers.rash));
  /* gumma lump low on the same skin */
  gumBump = mk("circle", { class: "sy-rash", cx: 532, cy: 298, r: 15 }, layers.gumma);
  gumCore = mk("circle", { class: "sy-ulcer", cx: 532, cy: 298, r: 6 }, layers.gumma);
  /* brain spots cluster in the brain body */
  const BP = brainO.ports.parenchyma;
  brainPos = [Math.round(BP[0]), Math.round(BP[1])];
  [[-24, -12], [-8, -18], [10, -10], [-14, 8], [6, 12], [24, 6]].forEach(([dx, dy]) => brainDots.push(mk("circle", { class: "sy-rash", cx: f1(BP[0] + dx), cy: f1(BP[1] + dy), r: 3.6 }, layers.dots)));
  /* placenta marker and crossing germs in the womb */
  const FP = uterusO.ports.fundus;
  placPos = [Math.round(FP[0]), Math.round(FP[1])];
  placDot = mk("circle", { class: "sy-plac", cx: placPos[0], cy: placPos[1], r: 7 }, layers.plac);
  for (let i = 0; i < 3; i++) { const e = mk("path", { class: "sc-p p-spiro", d: "M-8 0 Q-4 -5 0 0 Q4 5 8 0" }, layers.plac); wombMinis.push({ e, x: uterusO.x + rnd(-25, 25), y: uterusO.y + rnd(-15, 25), a: rnd(0, 6.28) }); }
  const VP = vesselO.ports;
  trBlood = track([VP.in, [(VP.in[0] + VP.out[0]) / 2, (VP.in[1] + VP.out[1]) / 2], VP.out]);
}
function initRbc() { for (let i = 0; i < 10; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, u: i / 10, v: rnd(0.8, 1.2) }); } }
function capText(d) {
  if (d === 1) return "Penicillin kills germs. Sores heal and blood clears.";
  if (d === 2) return "Blood tests only track disease. They do not kill germs.";
  if (d === 3) return "Penicillin reaches the brain. Germs die and the brain recovers.";
  return "No treatment. Germs spread in blood and late harm builds.";
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["org", "Organisms", "g-org", "Treponema pallidum germs. Many in early sores, few in late lumps. Penicillin clears them."], ["les", "Lesions", "g-les", "Chancre, rash, moist bumps and gumma. Sores heal as germs are cleared, but late harm may remain."], ["dis", "Spread", "g-dis", "Germs spread in blood in secondary disease. This also allows spread to the unborn child in pregnancy."], ["sero", "Serology", "g-sero", "VDRL is a blood test that tracks disease and should calm after care. Confirming tests often remain positive."], ["imm", "Immune", "g-imm", "Macrophages and the immune response partly control germs and add to sore formation."], ["late", "Late harm", "g-late", "Late harm: gumma, aorta swelling and brain disease. Clearing germs may not undo harm already done."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Chancre", chanPos[0], chanPos[1], 150, 100, "Chancre: a painless sore where germs entered. A nearby node swells. It heals, but germs can remain.");
  pill(ox, "Spirochete", 210, 250, 280, 100, "Treponema pallidum: a thin spiral germ. It enters through skin breaks and spreads in blood.");
  pill(ox, "Blood spread", 430, 150, 505, 100, "Blood spread: germs ride the blood to skin and organs. Red cells flow inside the vessel.");
  pill(ox, "Rash", rashPos[0], rashPos[1], 640, 100, "Rash and moist sores: the infectious rash of secondary disease, with flat moist bumps low on the skin.");
  pill(ox, "Brain", brainPos[0], brainPos[1], 830, 80, "Brain: germs can reach the nerves and brain. This needs care that reaches the brain.");
  pill(ox, "Gumma", 532, 298, 600, 400, "Gumma: a rubbery lump of late disease. It holds few germs but damages tissue.");
  pill(ox, "Aorta", aortaX, aortaY, 715, 400, "Aorta: the great vessel can swell and weaken years later. Harm may persist after cure.");
  pill(ox, "Pregnancy", placPos[0], placPos[1], 870, 400, "Pregnancy: germs can cross to the unborn child, mainly when disease is early. Care protects both.");
  capEl = mk("text", { class: "sy-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0);
}
const sm = { Org: 0.6, Les: 0.6, Dis: 0.3, Sero: 0.4, Imm: 0.5, Late: 0.1, Cong: 0.3, pen: 0, fol: 0, neuro: 0, Z1: 1, Z2: 0.3, Z3: 0.1 };
const acc = { imm: 0, cap: 0 };
function init() { initOrgans(); initSpiro(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  ["Org", "Les", "Dis", "Sero", "Imm", "Late", "Cong"].forEach((f) => { sm[f] = lerp(sm[f], m[f], k2); });
  sm.pen = lerp(sm.pen, m.pen, k); sm.fol = lerp(sm.fol, m.fol, k); sm.neuro = lerp(sm.neuro, m.neuro, k);
  sm.Z1 = lerp(sm.Z1, m.Z1, k2); sm.Z2 = lerp(sm.Z2, m.Z2, k2); sm.Z3 = lerp(sm.Z3, m.Z3, k2);
  const Z = [sm.Z1, sm.Z2, sm.Z3];
  /* germs wander; drug capsules latch on and shrink them */
  spiro.forEach((p) => {
    const b = ZBOX[p.z], show = p.li < Math.round(10 * clamp(sm.Org * (0.3 + 0.7 * Z[p.z])));
    if (p.dead > 0) { p.dead -= dt; if (sm.pen > 0.25 && p.dead < 0.6) p.dead = 0.6; }
    p.a += rnd(-1.2, 1.2) * dt; p.x += Math.cos(p.a) * 16 * dt; p.y += Math.sin(p.a) * 16 * dt;
    if (p.x < b[0] || p.x > b[2]) p.a = Math.PI - p.a; if (p.y < b[1] || p.y > b[3]) p.a = -p.a; p.x = clamp(p.x, b[0], b[2]); p.y = clamp(p.y, b[1], b[3]);
    p.s = lerp(p.s, (show && p.dead <= 0) ? 1 : 0.05, Math.min(1, dt * 3));
    place(p.e, p.x, p.y, p.a * 57.3, p.s); p.e.setAttribute("opacity", p.s > 0.2 ? "1" : "0");
  });
  /* chancre ulcer closes as sores heal */
  const lv = clamp(sm.Les * (0.25 + 0.75 * sm.Z1));
  layers.chan.setAttribute("opacity", (0.12 + 0.88 * lv).toFixed(2));
  chanRim.setAttribute("rx", f1(10 + 32 * lv)); chanUlc.setAttribute("rx", f1(5 + 25 * lv));
  /* rash and moist bumps fade and shrink */
  const rv = clamp(sm.Les * (0.2 + 0.8 * sm.Z2));
  layers.rash.setAttribute("opacity", (0.1 + 0.9 * rv).toFixed(2));
  rashDots.forEach((d) => d.e.setAttribute("r", f1(d.r * (0.3 + 0.7 * rv))));
  /* gumma lump grows with late disease and pales with care */
  const gv = sm.Late;
  layers.gumma.setAttribute("opacity", (0.12 + 0.88 * gv).toFixed(2));
  gumBump.setAttribute("r", f1(3 + 12 * gv)); gumCore.setAttribute("r", f1(1.5 + 4.5 * gv * (1 - 0.5 * sm.pen)));
  /* brain spots clear when care reaches the brain */
  const bv = sm.Late * (sm.neuro ? 0.15 : 1);
  layers.dots.setAttribute("opacity", clamp(bv).toFixed(2));
  brainDots.forEach((d) => d.setAttribute("r", f1(sm.neuro ? 1.6 : 3.6)));
  /* aorta widens with late disease */
  aortaO.g.setAttribute("transform", "translate(" + f1(aortaX) + " " + f1(aortaY) + ") scale(" + (1 + 0.4 * sm.Late).toFixed(3) + " 1)");
  /* womb: placenta marker and crossing germs */
  layers.plac.setAttribute("opacity", (0.2 + 0.8 * sm.Cong).toFixed(2));
  placDot.setAttribute("r", f1(3 + 4 * sm.Cong));
  wombMinis.forEach((w, i) => {
    w.a += rnd(-1, 1) * dt; w.x += Math.cos(w.a) * 12 * dt; w.y += Math.sin(w.a) * 12 * dt;
    w.x = clamp(w.x, uterusO.x - 28, uterusO.x + 28); w.y = clamp(w.y, uterusO.y - 18, uterusO.y + 28);
    w.e.setAttribute("transform", "translate(" + f1(w.x) + " " + f1(w.y) + ") rotate(" + f1(w.a * 57.3) + ")");
    w.e.setAttribute("opacity", i / 3 < sm.Cong ? "1" : "0");
  });
  if (macG) place(macG, 305 + Math.sin(tm / 1500) * 3, 175 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 6, 1);
  rbcs.forEach((r) => { r.u += dt * (0.1 + 0.25 * sm.Dis) * r.v; if (r.u > 1) r.u -= 1; const q = trBlood.at(r.u); place(r.g, q.x + Math.sin(tm / 500 + r.u * 40) * 6, q.y, Math.sin(tm / 500 + r.u * 40) * 8, 1); });
  acc.imm += dt * sm.Imm * 5; while (acc.imm >= 1) { acc.imm--; const p = free(imm); if (p) emit(p, 305 + rnd(-14, 14), 175 + rnd(-10, 10), rnd(-22, 22), rnd(-16, 24), 0); }
  imm.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.2) kill(p); });
  /* drug capsules home in on live germs, latch on, and shrink them */
  acc.cap += dt * sm.pen * 3.4; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, 55 + rnd(-8, 8), 408 + rnd(-6, 6), 0, 0, 0); }
  caps.forEach((p) => {
    if (!p.on) return; p.t += dt;
    if (p.st === 0) {
      if (!p.tgt || p.tgt.dead > 0 || p.tgt.s < 0.5) p.tgt = nearSpiro(p.x, p.y);
      if (p.tgt) { const dx = p.tgt.x - p.x, dy = p.tgt.y - p.y, d = Math.max(1, Math.hypot(dx, dy)); p.x += dx / d * 150 * dt; p.y += dy / d * 150 * dt;
        if (d < 12) { p.st = 1; p.t = 0; } }
      else { p.x += 60 * dt; p.y -= 10 * dt; }
      if (p.t > 6) kill(p);
    } else if (p.st === 1) {
      if (p.tgt) { p.x = p.tgt.x; p.y = p.tgt.y; if (!p.hit) { p.hit = true; p.tgt.dead = 3; } }
      if (p.t > 0.8) { p.st = 2; p.t = 0; }
    } else { p.y -= 12 * dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.6).toFixed(2)); if (p.t > 0.6) kill(p); }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")");
  });
  gg.org.set(sm.Org, wordOf(sm.Org, 0.2, 0.55, ["cleared", "present", "many"])); gg.les.set(sm.Les, wordOf(sm.Les, 0.25, 0.6, ["healed", "present", "many"]));
  gg.dis.set(sm.Dis, wordOf(sm.Dis, 0.25, 0.6, ["local", "spreading", "wide"])); gg.sero.set(sm.Sero, wordOf(sm.Sero, 0.3, 0.65, ["falling", "reactive", "strong"]));
  gg.imm.set(sm.Imm, wordOf(sm.Imm, 0.3, 0.6, ["low", "active", "strong"])); gg.late.set(sm.Late, wordOf(sm.Late, 0.25, 0.6, ["none", "early", "advanced"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
