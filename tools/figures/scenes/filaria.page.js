/* Lymphatic filariasis scene: mosquito bite, larvae, adult worms in the lymph vessel and node, blocked flow, nocturnal microfilariae, eosinophils, leg swelling and hydrocele. */
const WW = SC.W;
const layers = { mosq: $("mosq"), worms: $("worms"), blockg: $("blockg"), scar: $("scar"), drainPath: $("drainPath"), tube: $("lymphTube"), rbcs: $("rbcs"), micros: $("micros"), eoss: $("eoss"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), inflam: $("inflam"), swell: $("swell"), hydro: $("hydro") };
let mosqG = null, skinO = null, gangO = null, musO = null, capEl = null, capDrug = -1;
const WCX = 390, WCY = 174, KX = 563, KY = 177;
let biteP = [118, 158], tubeStart = [200, 186], knotP = [563, 177], bellyP = [830, 262];
function initMosq() {
  mosqG = mk("g", {}, layers.mosq);
  mk("ellipse", { class: "fi-wing", cx: -4, cy: -13, rx: 16, ry: 6, transform: "rotate(-24 -4 -13)" }, mosqG);
  mk("ellipse", { class: "fi-wing", cx: 8, cy: -12, rx: 13, ry: 5, transform: "rotate(18 8 -12)" }, mosqG);
  mk("ellipse", { class: "fi-mos", cx: 0, cy: 0, rx: 15, ry: 7.5, transform: "rotate(-18)" }, mosqG);
  mk("circle", { class: "fi-mos", cx: 15, cy: -5, r: 5.2 }, mosqG);
  mk("path", { class: "fi-prob", d: "M18 -2L20 33" }, mosqG);
  mk("path", { class: "fi-legline", d: "M-8 5L-17 19M-2 6L-4 22M6 5L15 19" }, mosqG);
  place(mosqG, 100, 112, 0, 1);
}
/* real anatomy: skin at the bite, ganglion as the lymph node, muscle as the leg; the tube joins their ports */
function initOrgans() {
  skinO = organ($("skinSlot"), "skin", 115, 208, 130, {});
  gangO = organ($("nodeSlot"), "ganglion", 648, 176, 120, {});
  musO = organ($("legSlot"), "muscle", 830, 262, 180, { h: 95 });
  const gin = gangO.ports.in || [586, 176];
  layers.tube.setAttribute("d", "M180 192 C320 184 440 170 " + f1(gin[0]) + " " + f1(gin[1]));
  const gout = gangO.ports.out || [710, 176];
  bellyP = musO.ports.belly || bellyP;
  layers.drainPath.setAttribute("d", "M" + f1(gout[0]) + " " + f1(gout[1] + 14) + " C740 214 736 234 " + f1(bellyP[0] - 60) + " " + f1(bellyP[1] - 10));
  const surf = skinO.ports.surface || [115, 157];
  biteP = [Math.round(surf[0]), Math.round(surf[1])];
  tubeStart = [205, 186];
  knotP = [KX, KY];
}
/* red cells in blood */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, 680), y: rnd(-16, 16), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* microfilariae: small wiggly worms flowing in blood */
const mics = [];
function initMic() { for (let i = 0; i < 14; i++) { const g = mk("g", {}, layers.micros); mk("path", { class: "p-mic", d: "M-9 0C-5 -4 0 4 5 0C7 -2 9 0 10 1" }, g); mics.push({ g, x: rnd(0, 680), y: rnd(-16, 16), v: rnd(0.7, 1.1), ph: i * 1.3 }); } }
/* eosinophils between blood and lymph */
const eoss = [[150, 250], [280, 252], [410, 250], [530, 252], [620, 250], [350, 262]].map(function (xy, i) { const g = cell(layers.eoss, { cls: "eos", r: 12, nuc: 0.5, seed: i + 11, wob: 0.14 }); return { g: g, x: xy[0], y: xy[1], ph: i * 1.7 }; });
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const larv = pool(14, () => mk("circle", { class: "p-larv", r: 3 }, layers.parts));
const lym = pool(34, () => mk("circle", { class: "p-lymph", r: 3.4 }, layers.parts));
const meds = pool(12, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "fi-drug", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "fi-drug2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const bound = pool(12, () => mk("circle", { class: "p-bound", r: 3 }, layers.parts));
const drainP = pool(8, () => mk("circle", { class: "p-drain", r: 3 }, layers.parts));
const careP = pool(8, () => mk("path", { class: "p-care", d: "M0 -5L1.5 -1.5L5 0L1.5 1.5L0 5L-1.5 1.5L-5 0L-1.5 -1.5Z" }, layers.parts));
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
function capText(d) {
  if (d === 3) return "Drug kills worms and clears blood microfilariae. Old blockage and swelling ease slowly.";
  if (d === 2) return "Surgery drains the fluid sac. Worms remain, so vessel blockage stays.";
  if (d === 1) return "Limb care calms attacks and eases swelling. Worms remain, so blockage stays.";
  return "No treatment. Worms block the lymph vessel and the leg swells.";
}
/* labels and gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["worm", "Adult worms", "g-worm", "Adult worms in the lymphatics. Drug kills many, but damage already done stays."], ["mic", "Microfilariae", "g-mic", "Young worms in the blood, high early and at night. Drug clears them fast, even while swelling stays."], ["inf", "Inflammation", "g-bad", "Painful attacks on vessels and nodes. Limb care calms them."], ["blk", "Lymph block", "g-fl", "How blocked lymph drainage is. Dead worms ease it a little, but scarring keeps it high."], ["swl", "Swelling", "g-swel", "Leg swelling and hydrocele from trapped lymph. Surgery drains fluid, but old thickening stays."], ["eos", "Eosinophils", "g-eos", "Eosinophils, a white cell raised in worm infection. Falls as worms die."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Bite", 118, 150, 100, 72, "Mosquito bite. The bite leaves infective larvae in the skin and they travel to the lymph vessel.");
  pill(ox, "Larvae", 190, 168, 225, 72, "Infective larvae from the bite. They travel to the lymphatics and grow into adult worms.");
  pill(ox, "Adult worms", 375, 176, 375, 72, "Adult worms coiled in the lymph vessel. They release microfilariae and block lymph flow. Drug kills them and the knot shrinks.");
  pill(ox, "Lymph node", 648, 136, 540, 72, "Lymph node on the drainage path. Worms can live here too and it swells during attacks.");
  pill(ox, "Swollen leg", 795, 222, 760, 72, "Leg swollen by trapped lymph. Long standing blockage thickens the skin. Limb care and surgery help, but old swelling eases slowly.");
  pill(ox, "Hydrocele", 884, 150, 885, 72, "Fluid around the testis when drainage blocks. Surgery can drain selected cases.");
  pill(ox, "Microfilariae", 210, 300, 200, 406, "Young worms in the blood, mainly at night for the next mosquito bite. Drug clears them fast.");
  pill(ox, "Blocked flow", 562, 190, 560, 406, "Worm knot blocking lymph flow. Lymph stalls upstream and the leg swells. Dead worms shrink the knot but scarring remains.");
  capEl = mk("text", { class: "fi-cap", x: 30, y: 436 }, ox); capEl.textContent = capText(0);
}
const sm = { Worm: 0.5, Micro: 0.6, Inflam: 0.1, Block: 0.2, Swell: 0.1, Eos: 0.3, dec: 0, hyg: 0, surg: 0 };
const acc = { larv: 0, lym: 0, med: 0, bound: 0, drain: 0, care: 0 };
function init() { initMosq(); initOrgans(); initRbc(); initMic(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Worm = lerp(sm.Worm, m.Worm, k2); sm.Micro = lerp(sm.Micro, m.Micro, k2); sm.Inflam = lerp(sm.Inflam, m.Inflam, k2); sm.Block = lerp(sm.Block, m.Block, k2); sm.Swell = lerp(sm.Swell, m.Swell, k2); sm.Eos = lerp(sm.Eos, m.Eos, k2); sm.dec = lerp(sm.dec, m.dec, k1); sm.hyg = lerp(sm.hyg, m.hyg, k1); sm.surg = lerp(sm.surg, m.surg, k1);
  layers.inflam.setAttribute("opacity", (sm.Inflam * 0.16).toFixed(2));
  if (mosqG) place(mosqG, 100 + Math.sin(tm / 700) * 3, 112 + Math.cos(tm / 900) * 2.5, Math.sin(tm / 1200) * 5, 1);
  /* adult worms: alive they fill the vessel and wriggle; drug shrinks, stills, greys and sinks them */
  const ws = 1 - 0.5 * sm.dec, wig = Math.sin(tm / 800) * 2.5 * (1 - sm.dec), sink = 14 * sm.dec;
  layers.worms.setAttribute("transform", "translate(" + f1(WCX + wig) + " " + f1(WCY + sink) + ") scale(" + ws.toFixed(3) + ") translate(" + -WCX + " " + -WCY + ")");
  layers.worms.setAttribute("opacity", ((0.25 + 0.75 * sm.Worm) * (1 - 0.5 * sm.dec)).toFixed(2));
  layers.worms.classList.toggle("fi-dead", sm.dec > 0.5);
  /* worm knot: bulky while worms live, smaller scarred knot once drug kills them */
  const ks = (0.55 + 0.65 * sm.Block) * (1 - 0.3 * sm.dec);
  layers.blockg.setAttribute("transform", "translate(" + f1(KX) + " " + f1(KY) + ") scale(" + ks.toFixed(3) + ") translate(" + -KX + " " + -KY + ")");
  layers.blockg.setAttribute("opacity", (0.25 + 0.75 * sm.Block).toFixed(2));
  layers.scar.setAttribute("opacity", (sm.Block * 0.55).toFixed(2));
  layers.drainPath.setAttribute("opacity", (sm.Block * 0.7).toFixed(2));
  /* leg and hydrocele size follows swelling; surgery and care shrink it via smoothed swell */
  layers.swell.setAttribute("rx", f1(30 + 34 * sm.Swell)); layers.swell.setAttribute("ry", f1(26 + 22 * sm.Swell));
  layers.swell.setAttribute("opacity", (0.3 + 0.6 * sm.Swell).toFixed(2));
  layers.hydro.setAttribute("rx", f1(12 + 22 * sm.Swell)); layers.hydro.setAttribute("ry", f1(16 + 26 * sm.Swell));
  layers.hydro.setAttribute("opacity", (0.3 + 0.7 * sm.Swell).toFixed(2));
  /* larvae leave the bite through the skin and crawl to the lymph vessel */
  acc.larv += dt * 2.4; while (acc.larv >= 1) { acc.larv--; const p = free(larv); if (p) emit(p, biteP[0] + rnd(-6, 6), biteP[1] + rnd(0, 8), 0, 0, 0); }
  larv.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (tubeStart[0] - p.x) * dt * 0.9 + 14 * dt; p.y += (tubeStart[1] - p.y) * dt * 0.9; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 260)) + " " + f1(clamp(p.y, 130, 200)) + ")"); if (p.t > 3.2) kill(p); });
  /* lymph flow: droplets move right and stall before the knot; dead worms let them run further and faster */
  const bEff = sm.Block * (1 - 0.3 * sm.dec);
  acc.lym += dt * 5; while (acc.lym >= 1) { acc.lym--; const p = free(lym); if (p) emit(p, 200, rnd(164, 188), rnd(28, 40), 0, 0); }
  lym.forEach((p) => { if (!p.on) return; p.t += dt; const stallX = 640 - 110 * bEff; const sp = p.x < stallX - 30 ? p.vx * (0.5 + 0.9 * (1 - bEff)) : 4; p.x += Math.max(3, sp) * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 0.15; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 196, 652)) + " " + f1(clamp(p.y, 158, 194)) + ")"); if (p.x > 648 || p.t > 9) kill(p); });
  /* red cells flow in blood */
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > 700) { r.x = 8; r.y = rnd(-16, 16); } place(r.g, clamp(r.x, 8, 692), 304 + clamp(r.y, -16, 16), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* microfilariae: surge at night (slow cycle), count follows Micro so drug visibly clears the blood */
  const night = 0.5 + 0.5 * Math.sin(tm / 4200);
  const vis = sm.Micro * (0.3 + 0.7 * night);
  const wantM = Math.round(vis * mics.length);
  mics.forEach((mc, i) => { const on = i < wantM; mc.g.style.opacity = on ? 1 : 0; if (!on) return; mc.x += mc.v * 58 * dt; if (mc.x > 700) { mc.x = 8; mc.y = rnd(-16, 16); } place(mc.g, clamp(mc.x, 10, 690), 304 + clamp(mc.y, -16, 16), Math.sin(tm / 260 + mc.ph) * 14, 1); });
  /* eosinophils bob, more prominent as Eos rises, falling as drug kills worms */
  eoss.forEach((e, i) => { const on = i < Math.round(sm.Eos * eoss.length); e.g.style.opacity = on ? 1 : 0; if (on) place(e.g, e.x + Math.sin(tm / 1300 + e.ph) * 3, e.y + Math.cos(tm / 1500 + e.ph) * 2, Math.sin(tm / 2000 + e.ph) * 8, 0.7 + 0.5 * sm.Eos); });
  /* drug capsules stream to the lymph vessel, then stick on the worms as bound drug */
  acc.med += dt * sm.dec * 3; while (acc.med >= 1) { acc.med--; const p = free(meds); if (p) emit(p, rnd(40, 110), 300, 0, 0, 0); }
  meds.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (330 - p.x) * dt * 0.5 + 15 * dt; p.y += (176 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 560)) + " " + f1(clamp(p.y, 160, 310)) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* bound drug dots settle on the worms while treatment is on and leave when it stops */
  if (sm.dec > 0.5) { acc.bound += dt * sm.dec * 4; while (acc.bound >= 1) { acc.bound--; const p = free(bound); if (p) emit(p, rnd(250, 540), rnd(160, 190), rnd(-6, 6), rnd(-4, 4), 0); } }
  else if (sm.dec < 0.35) bound.forEach((p) => { if (p.on) kill(p); });
  bound.forEach((p) => { if (!p.on) return; p.t += dt; const damp = Math.max(0, 1 - p.t * 1.5); p.x = clamp(p.x + p.vx * dt * damp, 240, 550); p.y = clamp(p.y + p.vy * dt * damp + Math.sin(tm / 500 + p.x) * 0.1, 150, 200); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); });
  /* surgery drains fluid from the sac */
  acc.drain += dt * sm.surg * 4; while (acc.drain >= 1) { acc.drain--; const p = free(drainP); if (p) emit(p, 884 + rnd(-10, 10), 195, rnd(8, 18), rnd(28, 44), 0); }
  drainP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.y > 340) kill(p); });
  /* limb care sparkles over the leg */
  acc.care += dt * sm.hyg * 4; while (acc.care >= 1) { acc.care--; const p = free(careP); if (p) emit(p, rnd(750, 910), rnd(225, 300), 0, 0, 0); }
  careP.forEach((p) => { if (!p.on) return; p.t += dt; p.y -= 14 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.6).toFixed(2) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 1.6).toFixed(2)); if (p.t > 1.6) kill(p); });
  /* gauges */
  gg.worm.set(sm.Worm, wordOf(sm.Worm, 0.3, 0.65, ["few", "present", "many"])); gg.mic.set(sm.Micro, wordOf(sm.Micro, 0.25, 0.6, ["low", "present", "high"])); gg.inf.set(sm.Inflam, wordOf(sm.Inflam, 0.25, 0.6, ["quiet", "active", "severe"]));
  gg.blk.set(sm.Block, wordOf(sm.Block, 0.3, 0.65, ["open", "partial", "blocked"])); gg.swl.set(sm.Swell, wordOf(sm.Swell, 0.25, 0.6, ["none", "mild", "severe"])); gg.eos.set(sm.Eos, wordOf(sm.Eos, 0.35, 0.65, ["normal", "raised", "high"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
