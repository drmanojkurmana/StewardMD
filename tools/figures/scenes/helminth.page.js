/* Helminth scene: egg and larva routes into real organ anatomy, lung migration, skin entry, gut adult worms, cysts and gauges. */
const GY = SC.GY, WW = SC.W;
const L = { soil: $("soilEggs"), pork: $("pork"), cystPork: $("cystPork"), cystBrain: $("cystBrain"), cystMuscle: $("cystMuscle"), wash: $("drugwash"), bloodv: $("bloodv"), worms: $("worms"), out: $("outG"), rbcs: $("gutrbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), routes: $("routes") };
let bowelO = null, colonO = null, lungO = null, skinO = null, brainO = null, musO = null, capEl = null, capDrug = -1;
let TR_EAT = null, TR_LOOP = null, TR_CRAWL = null, TR_BLOOD = null, TR_PORK = null, TR_EGG = null;
let HOOK = [445, 375], COILS = [333, 358];
/* real anatomy: bowel coils as the worm home, colon as the way out, skin at entry, lung on the travel path, brain and muscle holding cysts */
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 360, 205, 110, {});
  lungO = organ($("lungSlot"), "lung", 500, 162, 120, {});
  brainO = organ($("brainSlot"), "brain", 720, 132, 140, {});
  musO = organ($("musSlot"), "muscle", 872, 118, 130, {});
  bowelO = organ($("bowelSlot"), "bowel", 330, 355, 170, {});
  colonO = organ($("colonSlot"), "colon", 840, 355, 110, {});
  const SS = skinO.ports.surface, SD = skinO.ports.dermis, HL = lungO.ports.hilumL, CAR = lungO.ports.carina, TRH = lungO.ports.trachea;
  const BI = bowelO.ports.in, BC = bowelO.ports.coils, BRN = brainO.ports.carotid;
  COILS = [BC[0], BC[1]];
  L.bloodv.setAttribute("d", "M" + f1(SD[0]) + " " + f1(SD[1]) + " C400 205 450 190 " + f1(HL[0]) + " " + f1(HL[1]));
  const P_EAT = [[95, 135], [292, 170], [288, 260], BI];
  const P_CRAWL = [[170, 218], [280, 210], [320, 190], SS];
  const P_PORK = [[215, 135], [292, 170], [288, 260], [310, 320], BC];
  const P_LOOP = [BC, [420, 240], HL, CAR, TRH, [TRH[0] + 25, TRH[1] + 40], [500, 220], [420, 300], BC];
  const P_BLOOD = [SS, [400, 195], HL, CAR, [520, 120], [510, 230], [480, 320], HOOK];
  const P_EGG = [[70, 212], [230, 130], [430, 112], [580, 118], BRN];
  TR_EAT = track(P_EAT); TR_CRAWL = track(P_CRAWL); TR_PORK = track(P_PORK);
  TR_LOOP = track(P_LOOP); TR_BLOOD = track(P_BLOOD); TR_EGG = track(P_EGG);
  [P_EAT, P_CRAWL, P_PORK].forEach((pts) => {
    mk("path", { class: "hel-route", d: "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L") }, L.routes);
  });
}
function capText(d) {
  if (d === 3) return "Albendazole starves gut worms. They shrink, die and leave in stool.";
  if (d === 2) return "Praziquantel wounds the tapeworm. It lets go and leaves in stool.";
  if (d === 1) return "Clean food, shoes and toilets block spread. Gut worms stay for now.";
  return "No treatment. Worms live in the gut and eggs keep spreading.";
}
/* ---- static soil eggs and larvae ---- */
const soilItems = [];
function initSoil() {
  for (let i = 0; i < 6; i++) { const g = mk("g", {}, L.soil); mk("ellipse", { class: "p-egg", rx: 6, ry: 4 }, g); mk("circle", { class: "p-eggdot", r: 1.6 }, g); place(g, 52 + i * 38, 210 + (i % 2) * 18, i * 24, 1); soilItems.push(g); }
  for (let i = 0; i < 4; i++) { const p = mk("path", { class: "p-larv", d: "M-8 0Q-4 -6 0 0T8 0" }, L.soil); p.setAttribute("transform", "translate(" + (70 + i * 52) + " " + (232 - (i % 2) * 8) + ")"); soilItems.push(p); }
}
/* ---- gut worms and the expelled mass ---- */
let ascG = null, hookG = null, tapeG = null;
function initWorms() {
  ascG = mk("g", {}, L.worms);
  mk("path", { class: "hel-wormA", d: "M150 372C230 350 300 396 390 372C440 360 480 378 540 370" }, ascG);
  mk("path", { class: "hel-wormA2", d: "M185 388C260 372 340 394 430 384" }, ascG);
  mk("path", { class: "hel-wormA3", d: "M230 360C300 344 360 372 470 356" }, ascG);
  hookG = mk("g", {}, L.worms);
  [415, 438, 461, 484].forEach((x) => { mk("path", { class: "hel-wormH", d: "M" + x + " 352C" + (x + 10) + " 366 " + (x - 8) + " 374 " + (x + 3) + " 390" }, hookG); mk("circle", { class: "p-drop", r: 3, cx: x + 3, cy: 392 }, hookG); });
  tapeG = mk("g", {}, L.worms);
  mk("circle", { class: "hel-head", cx: 310, cy: 377, r: 10 }, tapeG);
  for (let i = 0; i < 22; i++) mk("rect", { class: "hel-seg", x: 326 + i * 27, y: 368, width: 22, height: 17, rx: 4 }, tapeG);
  const o = mk("g", {}, L.out);
  mk("path", { class: "hel-out", d: "M-110 0C-70 -12 -40 10 0 0C30 -6 60 4 100 0" }, o);
  mk("path", { class: "hel-out", d: "M-100 24C-60 14 -30 32 10 22C40 16 70 24 105 20" }, o);
  mk("path", { class: "hel-out", d: "M-105 -24C-65 -32 -35 -14 5 -22C35 -28 65 -20 100 -24" }, o);
  [[-80, 6], [-30, -8], [30, 10], [80, -6]].forEach((xy) => mk("circle", { class: "hel-outbit", r: 3.4, cx: xy[0], cy: xy[1] }, o));
  L.out.setAttribute("opacity", "0");
}
/* ---- red cells flowing in the gut ---- */
const grbc = [];
function initRbc() { for (let i = 0; i < 12; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.rbcs); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); grbc.push({ g, x: (i / 12) * WW, y: rnd(-16, 16), v: rnd(0.85, 1.15) }); } }
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, tr: null }; }); }
const eggs = pool(18, () => { const g = mk("g", {}, L.parts); mk("ellipse", { class: "p-egg", rx: 5.5, ry: 3.6 }, g); mk("circle", { class: "p-eggdot", r: 1.4 }, g); return g; });
const larv = pool(16, () => mk("path", { class: "p-larv", d: "M-8 0Q-4 -6 0 0T8 0" }, L.parts));
const drops = pool(12, () => mk("path", { class: "p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const caps = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-cap", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-cap2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2.4 }, g); return g; });
const bound = pool(14, () => mk("circle", { class: "p-bound", r: 3 }, L.parts));
const debris = pool(12, () => mk("circle", { class: "hel-outbit", r: 3 }, L.parts));
const freeP = (pl) => pl.find((p) => !p.on);
function emitTr(p, tr, k) { p.on = true; p.u = 0; p.tr = tr; p.k = k || 0; p.st = 0; p.t = 0; p.e.setAttribute("opacity", "1"); }
function killP(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- sanitation marks and boot ---- */
function mark(x, y) { const g = mk("g", { opacity: "0" }, L.over); mk("circle", { class: "hel-mark", r: 8, cx: x, cy: y }, g); mk("path", { class: "hel-markx", d: "M" + (x - 3.5) + " " + (y - 3.5) + "l7 7M" + (x + 3.5) + " " + (y - 3.5) + "l-7 7" }, g); return g; }
let sanMarks = [], bootG = null;
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = L.panel, y0 = 478, h = 70, xs = [90, 270, 450, 630, 810];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient and spread";
  [["B", "Worms", "g-bac", "Adult worms living in the gut. The right gut drug clears them; prevention alone leaves adults in place."], ["Sp", "Spread", "g-cyt", "Eggs or larvae reaching soil, food, skin or another person. Sanitation blocks this even while adults remain."], ["Mig", "Migration", "g-fl", "Young worms travelling through the lungs, or Taenia eggs reaching brain and muscle."], ["An", "Anaemia", "g-bad", "Blood loss while hookworms feed at the gut wall. It eases only when the worms go."], ["Cy", "Cysts", "g-clot", "Taenia cysts already formed in brain or muscle. Clearing the gut worm does not remove them."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const o = L.over;
  pill(o, "Food and soil", 95, 128, 105, 96, "Worm eggs in dirty food, hands and soil. Swallowed eggs hatch in the gut.");
  pill(o, "Cysts in pork", 215, 128, 222, 96, "Undercooked pork with cysts gives an adult tapeworm in the gut, not cysts in the body.");
  pill(o, "Skin entry", 360, 164, 350, 96, "Hookworm larvae pass through bare skin, often of the feet. Footwear blocks this route.");
  pill(o, "Lungs", 555, 150, 600, 96, "Young worms travel in blood to the lungs, are coughed up and swallowed, then grow in the gut.");
  pill(o, "Tissue cysts", 862, 122, 855, 200, "Swallowed Taenia eggs can form cysts in brain and muscle. Clearing the gut worm does not remove cysts already formed.");
  pill(o, "Adult worms", 300, 372, 150, 322, "Adult worms live in the gut. The right drug clears them and they leave in stool.");
  pill(o, "Blood loss", 445, 375, 560, 322, "Hookworms bite the gut wall and feed on blood. Day after day loss causes anaemia.");
  pill(o, "Way out", 840, 425, 740, 322, "Eggs leave in stool. Clean stool disposal and hand washing break the cycle.");
  sanMarks = [mark(140, 150), mark(315, 185), mark(60, 218)];
  bootG = mk("g", { opacity: "0" }, o);
  mk("path", { class: "hel-boot", d: "M322 158h76v14h-60l-16 -6Z" }, bootG);
  capEl = mk("text", { class: "hel-cap", x: 30, y: 428 }, o); capEl.textContent = capText(0);
}
const sm = { B: 0.7, Sp: 0.6, Mig: 0.6, An: 0.2, Cy: 0, mr: 1, mh: 0, mt: 0, san: 0, gut: 0 };
const acc = { move: 0, cap: 0, drop: 0, bound: 0, debris: 0 };
function init() { initOrgans(); initSoil(); initWorms(); initRbc(); initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7), k1 = Math.min(1, dt * 1.2);
  ["B", "Sp", "Mig", "An", "Cy"].forEach((key) => { sm[key] = lerp(sm[key], m[key], k); });
  sm.mr = lerp(sm.mr, level === 0 ? 1 : 0, k1); sm.mh = lerp(sm.mh, level === 1 ? 1 : 0, k1); sm.mt = lerp(sm.mt, level === 2 ? 1 : 0, k1);
  sm.san = lerp(sm.san, drug === 1 ? 1 : 0, k1); sm.gut = lerp(sm.gut, drug === 2 || drug === 3 ? 1 : 0, k1);
  /* worms: alive they fill the gut and wriggle; gut drug shrinks, stills, greys and sinks them */
  const ws = 1 - 0.38 * sm.gut, sink = 16 * sm.gut, wig = Math.sin(tm / 800) * 4 * (1 - sm.gut);
  L.worms.classList.toggle("hel-dead", sm.gut > 0.5);
  ascG.setAttribute("transform", "translate(" + f1(345 + wig) + " " + f1(372 + sink) + ") scale(" + ws.toFixed(3) + ") translate(-345 -372)");
  ascG.setAttribute("opacity", (sm.mr * (0.12 + 0.88 * sm.B)).toFixed(2));
  hookG.setAttribute("transform", "translate(" + f1(457 + wig) + " " + f1(372 + sink) + ") scale(" + ws.toFixed(3) + ") translate(-457 -372)");
  hookG.setAttribute("opacity", (sm.mh * (0.12 + 0.88 * sm.B)).toFixed(2));
  tapeG.setAttribute("transform", "translate(" + f1(610 + wig * 0.5) + " " + f1(377 + sink) + ") scale(" + ws.toFixed(3) + ") translate(-610 -377)");
  tapeG.setAttribute("opacity", (sm.mt * (0.12 + 0.88 * sm.B)).toFixed(2));
  /* expelled dead worms drift out through the colon while the gut drug is on */
  const ou = (tm / 14000) % 1;
  place(L.out, 350 + ou * 660, 385 + Math.sin(ou * 6.28) * 8, ou * 30, 1);
  L.out.setAttribute("opacity", (sm.gut * (ou < 0.85 ? 1 : 1 - (ou - 0.85) / 0.15)).toFixed(2));
  L.wash.setAttribute("opacity", (sm.gut * 0.18).toFixed(2));
  /* level focus and cysts */
  L.pork.style.opacity = (0.25 + 0.75 * sm.mt).toFixed(2);
  const cystO = (sm.mt * clamp(0.3 + sm.Cy)).toFixed(2); L.cystPork.style.opacity = cystO; L.cystBrain.style.opacity = cystO; L.cystMuscle.style.opacity = cystO;
  sanMarks.forEach((g) => g.setAttribute("opacity", sm.san.toFixed(2))); bootG.setAttribute("opacity", sm.san.toFixed(2));
  soilItems.forEach((g) => { g.style.opacity = (1 - 0.7 * sm.san).toFixed(2); });
  /* gut red cells: fewer visible when hookworm anaemia is marked */
  const visR = Math.round(grbc.length * (1 - 0.6 * sm.An * sm.mh));
  grbc.forEach((r, i) => { r.x += r.v * 52 * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-16, 16); } place(r.g, r.x, GY + r.y, Math.sin(tm / 600 + r.x) * 8, 1); r.g.style.opacity = i < visR ? 0.9 : 0.12; });
  /* moving eggs and larvae along the tracks for the worm shown */
  acc.move += dt * (0.3 + 2.4 * sm.Mig); while (acc.move >= 1) { acc.move--; let p = null;
    if (level === 0) { p = freeP(eggs); if (p) emitTr(p, TR_EAT, 0); }
    else if (level === 1) { p = freeP(larv); if (p) emitTr(p, TR_CRAWL, 1); }
    else if (Math.random() < 0.5) { p = freeP(eggs); if (p) emitTr(p, TR_EGG, 2); }
    else { p = freeP(larv); if (p) emitTr(p, TR_PORK, 2); } }
  eggs.forEach((p) => { if (!p.on) return; p.u += dt * 0.14; const q = p.tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")");
    if (p.u >= 1) { if (p.k === 0 && Math.random() < 0.5) { const q2 = freeP(larv); if (q2) emitTr(q2, TR_LOOP, 0); } killP(p); } });
  larv.forEach((p) => { if (!p.on) return; p.u += dt * 0.12; const q = p.tr.at(p.u); p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ") rotate(" + f1(q.a) + ")");
    if (p.u >= 1) { if (p.k === 1 && p.st === 0) { p.tr = TR_BLOOD; p.u = 0; p.st = 1; } else killP(p); } });
  /* hookworm blood drops */
  acc.drop += dt * sm.mh * sm.B * 5; while (acc.drop >= 1) { acc.drop--; const p = freeP(drops); if (p) { p.on = true; p.x = pick([418, 441, 464, 487]); p.y = 392 + sink; p.vy = rnd(16, 26); p.t = 0; p.e.setAttribute("opacity", "1"); } }
  drops.forEach((p) => { if (!p.on) return; p.t += dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 404) killP(p); });
  /* drug capsules travel the gut when a gut drug is chosen */
  acc.cap += dt * sm.gut * 2.4; while (acc.cap >= 1) { acc.cap--; const p = freeP(caps); if (p) { p.on = true; p.x = 36; p.y = GY + rnd(-18, 18); p.t = 0; p.e.setAttribute("opacity", "1"); } }
  caps.forEach((p) => { if (!p.on) return; p.t += dt; p.x += 62 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 70) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 9) / 2).toFixed(2)); if (p.x > WW - 50 || p.t > 11) killP(p); });
  /* bound drug settles on the worms while treatment is on and leaves when it stops */
  if (sm.gut > 0.5) { acc.bound += dt * sm.gut * 5; while (acc.bound >= 1) { acc.bound--; const p = freeP(bound); if (p) { p.on = true; p.x = level === 2 ? rnd(330, 880) : rnd(240, 480); p.y = rnd(350, 395); p.vx = rnd(-6, 6); p.vy = rnd(-4, 4); p.t = 0; p.e.setAttribute("opacity", "1"); } } }
  else if (sm.gut < 0.35) bound.forEach((p) => { if (p.on) killP(p); });
  bound.forEach((p) => { if (!p.on) return; p.t += dt; const damp = Math.max(0, 1 - p.t * 1.5); p.x = clamp(p.x + p.vx * dt * damp, 150, 920); p.y = clamp(p.y + p.vy * dt * damp + Math.sin(tm / 500 + p.x) * 0.1, 340, 400); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* dead worm bits drift out to the right while the gut drug is on */
  acc.debris += dt * sm.gut * 3; while (acc.debris >= 1) { acc.debris--; const p = freeP(debris); if (p) { p.on = true; p.x = rnd(280, 480); p.y = rnd(355, 395); p.vx = rnd(40, 70); p.vy = rnd(-6, 6); p.t = 0; p.e.setAttribute("opacity", "1"); } }
  debris.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.x > WW - 40 || p.t > 5) killP(p); });
  /* gauges */
  gg.B.set(sm.B, wordOf(sm.B, 0.2, 0.55, ["cleared", "few", "many"])); gg.Sp.set(sm.Sp, wordOf(sm.Sp, 0.2, 0.5, ["blocked", "low", "high"])); gg.Mig.set(sm.Mig, wordOf(sm.Mig, 0.25, 0.55, ["none", "some", "active"]));
  gg.An.set(sm.An, wordOf(sm.An, 0.3, 0.6, ["none", "mild", "marked"])); gg.Cy.set(sm.Cy, wordOf(sm.Cy, 0.05, 0.75, ["none", "present", "extensive"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
