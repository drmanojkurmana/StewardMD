/* Syphilis scene: spirochetes, chancre, dissemination, late organ damage and gauges. */
const WW = SC.W;
const layers = { zones: $("zones"), skin: $("skinG"), chan: $("chancreG"), lymph: $("lymphG"), cond: $("condylG"), muc: $("mucousG"), rbc: $("rbcs"), gum: $("gummaG"), brain: $("brainG"), cong: $("congG"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* spirochetes: thin corkscrew organisms, twelve per zone */
const ZBOX = [[55, 95, 300, 240], [365, 150, 605, 330], [650, 95, 925, 330]];
const spiro = [];
function initSpiro() { for (let i = 0; i < 36; i++) { const z = i % 3, b = ZBOX[z], e = mk("path", { class: "sc-p p-spiro", d: "M-11 0 Q-6 -7 0 0 Q6 7 11 0" }, layers.parts); spiro.push({ e, z, li: Math.floor(i / 3), x: rnd(b[0], b[2]), y: rnd(b[1], b[3]), a: rnd(0, 6.28) }); } }
const imm = pool(22, () => mk("circle", { class: "sc-p p-imm", r: 2.3 }, layers.parts));
const sero = pool(10, () => mk("circle", { class: "sc-p p-imm", r: 2.6 }, layers.parts));
const caps = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const rbcs = [];
function initRbc() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(360, 610), y: rnd(296, 332), v: rnd(0.8, 1.2) }); } }
let macG = null, brainDots = null;
function initNodes() {
  macG = cell(layers.zones, { cls: "mac2", r: 23, nuc: 0.42, seed: 3, wob: 0.13 }); place(macG, 265, 165, 0, 1);
  const m2 = cell(layers.zones, { cls: "mac2", r: 17, nuc: 0.4, seed: 7, wob: 0.13 }); place(m2, 82, 190, 0, 1);
  /* chancre: raised rim with a shallow painless ulcer on the mucosal surface */
  mk("ellipse", { class: "sy-rim", cx: 170, cy: 272, rx: 46, ry: 17 }, layers.chan);
  mk("ellipse", { class: "sy-ulcer", cx: 170, cy: 272, rx: 34, ry: 11 }, layers.chan);
  /* lymph node with lymphocytes */
  mk("ellipse", { class: "sy-node", cx: 150, cy: 365, rx: 42, ry: 28 }, layers.lymph);
  for (let i = 0; i < 7; i++) { const c = cell(layers.lymph, { cls: "lym2", r: 6, nuc: 0.5, seed: i + 4, wob: 0.1 }); place(c, 128 + (i % 4) * 15, 354 + Math.floor(i / 4) * 18, 0, 1); }
  /* rash spots on the skin strip */
  for (let i = 0; i < 11; i++) mk("circle", { class: "sy-rash", cx: 372 + i * 22 + (i % 2) * 6, cy: 104 + (i % 3) * 13, r: 5 + (i % 3) }, layers.skin);
  /* condylomata lata: broad flat moist lesions */
  [388, 428, 468, 502].forEach((x, i) => mk("ellipse", { class: "sy-rash", cx: x, cy: 203, rx: 17, ry: 9 + (i % 2) * 2 }, layers.cond));
  /* mucous patches: pale shallow patches */
  [532, 562, 592].forEach((x) => mk("ellipse", { class: "sy-patch", cx: x, cy: 203, rx: 13, ry: 7.5 }, layers.muc));
  /* gumma: a rubbery nodule with a soft centre */
  const gg = cell(layers.gum, { cls: "gum2", r: 26, nuc: 0, seed: 5, wob: 0.12 }); place(gg, 695, 135, 0, 1);
  mk("circle", { class: "sy-ulcer", cx: 695, cy: 135, r: 9 }, layers.gum);
  /* brain with inflammatory dots for neurosyphilis */
  const br = cell(layers.brain, { cls: "neur2", r: 32, nuc: 0.3, seed: 9, wob: 0.16, n: 11 }); place(br, 885, 135, 0, 1);
  brainDots = mk("g", {}, layers.brain);
  for (let i = 0; i < 6; i++) mk("circle", { class: "sy-rash", cx: 868 + (i % 3) * 16, cy: 122 + Math.floor(i / 3) * 22, r: 3.4 }, brainDots);
  /* placenta for congenital spread */
  mk("circle", { class: "sy-plac", cx: 880, cy: 325, r: 28 }, layers.cong);
  mk("circle", { class: "sy-patch", cx: 880, cy: 325, r: 11 }, layers.cong);
  mk("path", { class: "sy-rim", d: "M880 353 Q884 368 892 374" }, layers.cong);
  /* serology sample tube beside the vessel */
  mk("rect", { class: "sy-patch", x: 633, y: 356, width: 14, height: 38, rx: 4 }, layers.zones);
  mk("rect", { class: "p-fl", x: 635, y: 376, width: 10, height: 15, rx: 3 }, layers.zones);
}
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["org", "Organisms", "g-org", "Treponema pallidum spirochetes. Many in early lesions, few in late gumma lesions. Penicillin clears them."], ["les", "Lesions", "g-les", "Chancre, rash, condylomata lata, mucous patches and gumma. Lesions heal as organisms are cleared, but late damage may remain."], ["dis", "Spread", "g-dis", "Blood-borne spread in secondary disease. It also allows spread across the placenta in pregnancy."], ["sero", "Serology", "g-sero", "VDRL is a nontreponemal test that tracks activity and should fall after treatment. Treponemal tests usually stay reactive."], ["imm", "Immune", "g-imm", "Macrophages and the immune response partly control organisms and contribute to lesion formation."], ["late", "Late damage", "g-late", "Tertiary damage: gumma, cardiovascular aortitis and neurosyphilis. Clearing organisms may not reverse damage already done."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Spirochete", 95, 135, 118, 98, "Treponema pallidum: a thin spiral organism, usually sexually transmitted. It enters through mucosa or broken skin.");
  pill(ox, "Macrophage", 265, 148, 260, 128, "Macrophages and the immune response try to control organisms, but early control is incomplete.");
  pill(ox, "Chancre", 170, 262, 105, 238, "Primary chancre: a usually painless, nontender ulcer at the entry site. It is infectious and heals even without treatment.");
  pill(ox, "Lymph node", 188, 352, 270, 348, "Enlarged lymph nodes near the chancre, and more widely in secondary disease.");
  pill(ox, "Rash", 430, 116, 435, 168, "Secondary rash from blood-borne spread. Lesions are infectious and may involve skin widely.");
  pill(ox, "Condylomata lata", 425, 212, 420, 248, "Condylomata lata: broad, flat, moist wart-like lesions of secondary syphilis in warm moist areas.");
  pill(ox, "Mucous patches", 565, 212, 552, 248, "Mucous patches: shallow pale lesions on mucous membranes in secondary syphilis.");
  pill(ox, "Blood spread", 485, 316, 485, 372, "Organisms spread in blood in secondary disease, seeding skin, mucosa, eye and other sites.");
  pill(ox, "Serology tests", 640, 378, 575, 412, "Serologic testing: VDRL tracks activity and follow-up response, while treponemal tests confirm exposure and usually remain reactive.");
  pill(ox, "Latency", 650, 252, 650, 210, "Latency: after secondary lesions settle, infection may stay quiet with no lesions before late disease appears in some untreated persons.");
  pill(ox, "Gumma", 695, 112, 695, 82, "Gumma: a tertiary granulomatous lesion that can affect skin, bone and other tissues, with few organisms.");
  pill(ox, "Aortitis", 800, 246, 795, 278, "Cardiovascular syphilis: inflammation of the aorta (aortitis) can weaken and widen its wall in tertiary disease.");
  pill(ox, "Neurosyphilis", 885, 106, 878, 82, "Neurosyphilis: nervous system involvement, which can occur across stages and needs a regimen that reaches the brain.");
  pill(ox, "Congenital", 880, 352, 878, 392, "Congenital syphilis: infection can cross the placenta in pregnancy, especially when maternal disease is early and untreated.");
  const pen = pill(ox, "Penicillin", 82, 390, 82, 415, "Penicillin clears spirochetes and heals early lesions. Follow-up serology should then fall."); pen.setAttribute("id", "pen-pill");
}
const sm = { Org: 0.6, Les: 0.6, Dis: 0.3, Sero: 0.4, Imm: 0.5, Late: 0.1, Cong: 0.3, pen: 0, fol: 0, neuro: 0, Z1: 1, Z2: 0.3, Z3: 0.1 };
const acc = { imm: 0, cap: 0, sero: 0 };
function init() { initSpiro(); initRbc(); initNodes(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  ["Org", "Les", "Dis", "Sero", "Imm", "Late", "Cong"].forEach((f) => { sm[f] = lerp(sm[f], m[f], k2); });
  sm.pen = lerp(sm.pen, m.pen, k); sm.fol = lerp(sm.fol, m.fol, k); sm.neuro = lerp(sm.neuro, m.neuro, k);
  sm.Z1 = lerp(sm.Z1, m.Z1, k2); sm.Z2 = lerp(sm.Z2, m.Z2, k2); sm.Z3 = lerp(sm.Z3, m.Z3, k2);
  const Z = [sm.Z1, sm.Z2, sm.Z3];
  spiro.forEach((p, i) => { const b = ZBOX[p.z], act = clamp(sm.Org * (0.3 + 0.7 * Z[p.z])); const on = p.li < Math.round(12 * act);
    p.a += rnd(-1.2, 1.2) * dt; p.x += Math.cos(p.a) * 16 * dt; p.y += Math.sin(p.a) * 16 * dt;
    if (p.x < b[0] || p.x > b[2]) p.a = Math.PI - p.a; if (p.y < b[1] || p.y > b[3]) p.a = -p.a; p.x = clamp(p.x, b[0], b[2]); p.y = clamp(p.y, b[1], b[3]);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.a * 57.3) + ")"); p.e.setAttribute("opacity", on ? "1" : "0"); });
  layers.chan.setAttribute("opacity", clamp(0.18 + 0.82 * sm.Les * sm.Z1).toFixed(2));
  layers.skin.setAttribute("opacity", clamp(0.1 + 0.9 * sm.Les * sm.Z2).toFixed(2));
  layers.cond.setAttribute("opacity", clamp(0.08 + 0.92 * sm.Les * sm.Z2).toFixed(2));
  layers.muc.setAttribute("opacity", clamp(0.08 + 0.92 * sm.Les * sm.Z2).toFixed(2));
  place(layers.lymph, 0, 0, 0, 1); layers.lymph.setAttribute("transform", "translate(" + f1(150 * (1 - (0.7 + 0.45 * sm.Imm * sm.Z2))) + " " + f1(365 * (1 - (0.7 + 0.45 * sm.Imm * sm.Z2))) + ") scale(" + (0.7 + 0.45 * sm.Imm * sm.Z2).toFixed(3) + ")");
  layers.gum.setAttribute("opacity", clamp(0.15 + 0.85 * sm.Late).toFixed(2));
  $("aortaPath").setAttribute("transform", "translate(" + f1(800 * (1 - (1 + 0.32 * sm.Late))) + " 0) scale(" + (1 + 0.32 * sm.Late).toFixed(3) + " 1)");
  if (brainDots) brainDots.setAttribute("opacity", clamp(sm.Late * (sm.neuro ? 0.45 : 1)).toFixed(2));
  layers.cong.setAttribute("opacity", clamp(0.22 + 0.78 * sm.Cong).toFixed(2));
  if (macG) place(macG, 265 + Math.sin(tm / 1500) * 3, 165 + Math.cos(tm / 1700) * 2, Math.sin(tm / 2400) * 6, 1 + 0.05 * sm.Imm * Math.sin(tm / 300));
  rbcs.forEach((r) => { r.x += r.v * 55 * (0.4 + 0.6 * sm.Dis + 0.3) * dt; if (r.x > 612) r.x = 358; place(r.g, r.x, r.y, Math.sin(tm / 500 + r.x) * 8, 1); });
  acc.imm += dt * sm.Imm * 7; while (acc.imm >= 1) { acc.imm--; const p = free(imm); if (p) emit(p, 265 + rnd(-14, 14), 165 + rnd(-10, 10), rnd(-22, 22), rnd(-16, 24), 0); }
  imm.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.2) kill(p); });
  acc.cap += dt * sm.pen * 3.2; while (acc.cap >= 1) { acc.cap--; const p = free(caps); if (p) emit(p, rnd(45, 90), 405, 0, 0, sm.neuro ? 1 : 0); }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k ? 850 : 190, ty = p.k ? 150 : 155; p.x += (tx - p.x) * dt * 0.55 + 12 * dt; p.y += (ty - p.y) * dt * 0.65; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.6) / 1.2).toFixed(2)); if (p.t > 4.8) kill(p); });
  acc.sero += dt * (sm.fol + sm.pen * 0.5) * 4; while (acc.sero >= 1) { acc.sero--; const p = free(sero); if (p) emit(p, 600, 318, 0, 0, 0); }
  sero.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (640 - p.x) * dt * 1.4; p.y += (382 - p.y) * dt * 1.4; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 2.4) kill(p); });
  const pp = $("pen-pill"); if (pp) pp.style.opacity = sm.pen.toFixed(2);
  gg.org.set(sm.Org, wordOf(sm.Org, 0.2, 0.55, ["cleared", "present", "many"])); gg.les.set(sm.Les, wordOf(sm.Les, 0.25, 0.6, ["healed", "present", "many"]));
  gg.dis.set(sm.Dis, wordOf(sm.Dis, 0.25, 0.6, ["local", "spreading", "wide"])); gg.sero.set(sm.Sero, wordOf(sm.Sero, 0.3, 0.65, ["falling", "reactive", "strong"]));
  gg.imm.set(sm.Imm, wordOf(sm.Imm, 0.3, 0.6, ["low", "active", "strong"])); gg.late.set(sm.Late, wordOf(sm.Late, 0.25, 0.6, ["none", "early", "advanced"]));
}
run({ init, step });
