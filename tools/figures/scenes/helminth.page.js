/* Helminth scene: egg and larva routes, lung migration, skin entry, gut adult worms, cysts, autoinfection and gauges. */
const GY = SC.GY, WW = SC.W;
const L = { soil: $("soilEggs"), pork: $("pork"), cystPork: $("cystPork"), cystBrain: $("cystBrain"), cystMuscle: $("cystMuscle"), worms: $("worms"), rbcs: $("gutrbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), routes: $("routes") };
/* ---- routes ---- */
const TR_ASC = track([[95, 135], [230, 170], [350, 300], [390, 360], [440, 260], [470, 165], [470, 250], [430, 340], [320, 372]]);
const TR_HOOK = track([[170, 218], [290, 224], [385, 216], [438, 168], [470, 150], [470, 250], [430, 340], [540, 365]]);
const TR_PORK = track([[215, 135], [300, 210], [380, 320], [450, 370]]);
const TR_EGG = track([[70, 212], [160, 175], [300, 150], [520, 125], [650, 122], [725, 128]]);
const TR_STR = track([[698, 222], [712, 208], [740, 205], [768, 208], [782, 222], [768, 236], [740, 239], [712, 236], [698, 222]]);
mk("path", { class: "hel-route", d: "M95 135L230 170L350 300L390 360L440 260L470 165L470 250L430 340L320 372" }, L.routes);
mk("path", { class: "hel-route", d: "M215 135L300 210L380 320L450 370M70 212L160 175L300 150L520 125L650 122L725 128" }, L.routes);
/* ---- static soil eggs and larvae ---- */
const soilItems = [];
function initSoil() {
  for (let i = 0; i < 6; i++) { const g = mk("g", {}, L.soil); mk("ellipse", { class: "p-egg", rx: 6, ry: 4 }, g); mk("circle", { class: "p-eggdot", r: 1.6 }, g); place(g, 52 + i * 38, 210 + (i % 2) * 18, i * 24, 1); soilItems.push(g); }
  for (let i = 0; i < 4; i++) { const p = mk("path", { class: "p-larv", d: "M-8 0Q-4 -6 0 0T8 0" }, L.soil); p.setAttribute("transform", "translate(" + (70 + i * 52) + " " + (232 - (i % 2) * 8) + ")"); soilItems.push(p); }
}
/* ---- gut worms ---- */
let ascG, hookG, tapeG;
function initWorms() {
  ascG = mk("g", {}, L.worms);
  mk("path", { class: "hel-wormA", d: "M170 380C250 352 330 404 420 374C470 358 510 382 560 372" }, ascG);
  mk("path", { class: "hel-wormA2", d: "M210 392C290 372 360 398 450 386" }, ascG);
  hookG = mk("g", {}, L.worms);
  [505, 560, 615].forEach((x) => { mk("path", { class: "hel-wormH", d: "M" + x + " 352C" + (x + 10) + " 366 " + (x - 8) + " 374 " + (x + 3) + " 390" }, hookG); mk("circle", { class: "p-drop", r: 3, cx: x + 3, cy: 392 }, hookG); });
  tapeG = mk("g", {}, L.worms);
  mk("circle", { class: "hel-head", cx: 152, cy: 377, r: 10 }, tapeG);
  for (let i = 0; i < 26; i++) mk("rect", { class: "hel-seg", x: 168 + i * 27, y: 368, width: 22, height: 17, rx: 4 }, tapeG);
}
/* ---- red cells flowing in the gut lumen ---- */
const grbc = [];
function initRbc() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); grbc.push({ g, x: (i / 12) * WW, y: rnd(-16, 16), v: rnd(0.85, 1.15) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0, tr: null }; }); }
const eggs = pool(14, () => { const g = mk("g", {}, L.parts); mk("ellipse", { class: "p-egg", rx: 5.5, ry: 3.6 }, g); mk("circle", { class: "p-eggdot", r: 1.4 }, g); return g; });
const larv = pool(14, () => mk("path", { class: "p-larv", d: "M-8 0Q-4 -6 0 0T8 0" }, L.parts));
const strLarv = pool(3, () => mk("path", { class: "p-larv", d: "M-8 0Q-4 -6 0 0T8 0" }, L.parts));
const drops = pool(12, () => mk("path", { class: "p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const caps = pool(8, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-cap", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-cap2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const freeP = (pl) => pl.find((p) => !p.on);
function emitTr(p, tr, k) { p.on = true; p.u = 0; p.tr = tr; p.k = k || 0; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- sanitation marks and boot ---- */
function mark(x, y) { const g = mk("g", { opacity: "0" }, L.over); mk("circle", { class: "hel-mark", r: 8, cx: x, cy: y }, g); mk("path", { class: "hel-markx", d: "M" + (x - 3.5) + " " + (y - 3.5) + "l7 7M" + (x + 3.5) + " " + (y - 3.5) + "l-7 7" }, g); return g; }
let sanMarks = [], bootG = null;
/* ---- labels and gauges ---- */
const gg = {};
let pgR, pgH, pgT, pgS;
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 270, 450, 630, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient and spread";
  [["B", "Worms", "g-bac", "Adult worms living in the gut. The right gut drug clears most of them; prevention alone does not remove adults already present."], ["Sp", "Spread", "g-cyt", "Eggs or larvae reaching soil, food, skin or another person. Sanitation and footwear block this even while adult worms remain for a time."], ["Mig", "Migration", "g-fl", "Larvae travelling through tissues: to the lungs in roundworm and hookworm, and to brain or muscle when Taenia eggs are swallowed."], ["An", "Anaemia", "g-bad", "Blood loss from hookworm adults feeding at the gut wall. It eases only when the worms are cleared."], ["Cy", "Cysts", "g-clot", "Taenia cysts already formed in brain or muscle. Clearing the gut tapeworm does not by itself remove cysts already in tissues."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  pgR = mk("g", {}, o); pgH = mk("g", {}, o); pgT = mk("g", {}, o); pgS = mk("g", {}, o);
  pill(pgR, "Egg swallowed", 95, 135, 115, 96, "Ascaris eggs from soil or food are swallowed. This is the faecal to oral route: eggs passed in stool reach the mouth of another person, or the same person.");
  pill(pgR, "Lung migration", 470, 140, 405, 82, "Ascaris larvae hatch in the gut, pass to the lungs, are coughed up and swallowed again, then mature in the gut.");
  pill(pgR, "Adult roundworm", 300, 372, 280, 322, "Adult Ascaris worms live free in the small bowel. Females release eggs that leave in the stool.");
  pill(pgH, "Larvae in soil", 170, 218, 180, 176, "Hookworm eggs hatch in warm moist soil and develop into infective larvae.");
  pill(pgH, "Skin entry", 385, 217, 350, 182, "Hookworm larvae penetrate intact skin, usually of bare feet. Footwear blocks this skin route.");
  pill(pgH, "Blood loss", 563, 368, 560, 322, "Adult hookworms attach to the gut wall and feed on blood. Ongoing loss causes iron deficiency and anaemia.");
  pill(pgH, "Anaemia", 700, 377, 690, 322, "Fewer red cells are available when blood is lost day after day. Clearing the worms stops the loss.");
  pill(pgT, "Cyst in pork", 215, 135, 220, 96, "Eating undercooked pork that contains Taenia solium cysts gives an adult tapeworm in the gut, not cysts in the tissues.");
  pill(pgT, "Eggs eaten", 70, 212, 80, 176, "Swallowing Taenia eggs shed in human stool is different: larvae leave the gut and form cysts in tissues. This is cysticercosis.");
  pill(pgT, "Adult tapeworm", 430, 376, 430, 322, "The adult Taenia is a long flat segmented worm in the gut. Its eggs leave in the stool and can be swallowed by people or pigs.");
  pill(pgT, "Cysts in tissue", 735, 128, 795, 84, "Cysts in brain and muscle follow swallowed eggs, not eating cysts in pork. Brain cysts can cause seizures.");
  pill(pgS, "Eggs in stool", 880, 377, 845, 322, "Eggs leave in stool. Safe disposal of stool and hand washing break the faecal to oral route for roundworm and Taenia eggs, and keep hookworm eggs out of soil.");
  pill(pgS, "Strongyloides", 740, 222, 785, 172, "Strongyloides autoinfection: larvae become infective inside the gut and re-enter through the gut wall or skin near the anus, so the cycle continues without soil.");
  sanMarks = [mark(95, 135), mark(385, 217), mark(70, 212)];
  bootG = mk("g", { opacity: "0" }, o);
  mk("path", { class: "hel-boot", d: "M348 196h74v14h-58l-16 -6Z" }, bootG);
}
const sm = { B: 0.7, Sp: 0.6, Mig: 0.6, An: 0.2, Cy: 0, mr: 1, mh: 0, mt: 0, prev: 0, drugPulse: 0 };
const acc = { move: 0, cap: 0, drop: 0 };
function init() { initSoil(); initWorms(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k1 = Math.min(1, dt * 1.2);
  ["B", "Sp", "Mig", "An", "Cy"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  sm.mr = lerp(sm.mr, level === 0 ? 1 : 0, k1); sm.mh = lerp(sm.mh, level === 1 ? 1 : 0, k1); sm.mt = lerp(sm.mt, level === 2 ? 1 : 0, k1);
  sm.prev = lerp(sm.prev, drug === 3 ? 1 : 0, k1); sm.drugPulse = lerp(sm.drugPulse, drug === 1 || drug === 2 ? 1 : 0, k1);
  /* mode visibility */
  ascG.style.opacity = (sm.mr * clamp(0.2 + sm.B)).toFixed(2); hookG.style.opacity = (sm.mh * clamp(0.2 + sm.B)).toFixed(2); tapeG.style.opacity = (sm.mt * clamp(0.2 + sm.B)).toFixed(2);
  L.pork.style.opacity = (0.25 + 0.75 * sm.mt).toFixed(2);
  const cystO = (sm.mt * clamp(0.3 + sm.Cy)).toFixed(2); L.cystPork.style.opacity = cystO; L.cystBrain.style.opacity = cystO; L.cystMuscle.style.opacity = cystO;
  pgR.style.opacity = sm.mr.toFixed(2); pgH.style.opacity = sm.mh.toFixed(2); pgT.style.opacity = sm.mt.toFixed(2); pgS.style.opacity = "1";
  sanMarks.forEach((g) => g.setAttribute("opacity", sm.prev.toFixed(2))); bootG.setAttribute("opacity", sm.prev.toFixed(2));
  /* gut red cells: fewer visible when hookworm anaemia is marked */
  const visR = Math.round(grbc.length * (1 - 0.55 * sm.An * sm.mh));
  grbc.forEach((r, i) => { r.x += r.v * 52 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-16, 16); } place(r.g, r.x, GY + r.y, Math.sin(tm / 600 + r.x) * 8, 1); r.g.style.opacity = i < visR ? 0.9 : 0.12; });
  /* moving eggs and larvae along the route for the worm shown */
  acc.move += dt * (0.25 + 2.2 * sm.Mig); while (acc.move >= 1) { acc.move--; let p = null, tr = null;
    if (level === 0) { p = freeP(eggs); tr = TR_ASC; } else if (level === 1) { p = freeP(larv); tr = TR_HOOK; } else if (Math.random() < 0.5) { p = freeP(eggs); tr = TR_EGG; } else { p = freeP(larv); tr = TR_PORK; }
    if (p && tr) emitTr(p, tr, level); }
  [eggs, larv].forEach((pl) => pl.forEach((p) => { if (!p.on) return; p.u += dt * 0.14; const q = p.tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")"); if (p.u >= 1) killP(p); }));
  /* Strongyloides autoinfection loop runs on its own */
  strLarv.forEach((p, i) => { const u = (tm / 11000 + i / 3) % 1, q = TR_STR.at(u); p.e.setAttribute("opacity", "0.95"); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")"); });
  /* hookworm blood drops */
  acc.drop += dt * sm.mh * sm.B * 5; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) { p.on = true; p.x = pick([508, 563, 618]); p.y = 392; p.vy = rnd(16, 26); p.t = 0; p.e.setAttribute("opacity", "1"); } }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 402) killP(p); });
  /* drug capsules travel the gut when a gut drug is chosen */
  acc.cap += dt * sm.drugPulse * 2.2; while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) { p.on = true; p.x = 36; p.y = GY + rnd(-18, 18); p.t = 0; p.e.setAttribute("opacity", "1"); } }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 9) / 2).toFixed(2)); if (p.x > WW - 50 || p.t > 11) killP(p); });
  /* gauges */
  gg.B.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["cleared", "few", "many"])); gg.Sp.set(sm.Sp, wordOf(sm.Sp, 0.2, 0.5, ["blocked", "low", "high"])); gg.Mig.set(sm.Mig, wordOf(sm.Mig, 0.25, 0.55, ["none", "some", "active"]));
  gg.An.set(sm.An, wordOf(sm.An, 0.3, 0.6, ["none", "mild", "marked"])); gg.Cy.set(sm.Cy, wordOf(sm.Cy, 0.05, 0.75, ["none", "present", "extensive"]));
}
run({ init, step });
