/* Lymphatic filariasis scene: mosquito, larvae, adult worms in lymphatics, blocked lymph flow, nocturnal microfilariae, eosinophils, limb swelling and hydrocele. */
const WW = SC.W;
const layers = { mosq: $("mosq"), worms: $("worms"), blockg: $("blockg"), node: $("node"), rbcs: $("rbcs"), micros: $("micros"), eoss: $("eoss"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), inflam: $("inflam"), calf: $("calf"), hydro: $("hydro"), leg: $("leg") };
let mosqG = null;
function initMosq() {
  mosqG = mk("g", {}, layers.mosq);
  mk("ellipse", { class: "fi-wing", cx: -4, cy: -13, rx: 16, ry: 6, transform: "rotate(-24 -4 -13)" }, mosqG);
  mk("ellipse", { class: "fi-wing", cx: 8, cy: -12, rx: 13, ry: 5, transform: "rotate(18 8 -12)" }, mosqG);
  mk("ellipse", { class: "fi-mos", cx: 0, cy: 0, rx: 15, ry: 7.5, transform: "rotate(-18)" }, mosqG);
  mk("circle", { class: "fi-mos", cx: 15, cy: -5, r: 5.2 }, mosqG);
  mk("path", { class: "fi-prob", d: "M18 -2L25 20" }, mosqG);
  mk("path", { class: "fi-legline", d: "M-8 5L-17 19M-2 6L-4 22M6 5L15 19" }, mosqG);
  place(mosqG, 100, 112, 0, 1);
}
/* red cells in blood */
const rbcs = [];
function initRbc() { for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbcs); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, 680), y: rnd(-16, 16), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
/* microfilariae: small wiggly worms flowing in blood */
const mics = [];
function initMic() { for (let i = 0; i < 12; i++) { const g = mk("g", {}, layers.micros); mk("path", { class: "p-mic", d: "M-9 0C-5 -4 0 4 5 0C7 -2 9 0 10 1" }, g); mics.push({ g, x: rnd(0, 680), y: rnd(-16, 16), v: rnd(0.7, 1.1), ph: i * 1.3 }); } }
/* eosinophils between blood and lymph */
const eoss = [[300, 250], [430, 252], [540, 248], [180, 252]].map(function (xy, i) { const g = cell(layers.eoss, { cls: "eos", r: 11, nuc: 0.5, seed: i + 11, wob: 0.14 }); return { g: g, x: xy[0], y: xy[1], ph: i * 1.7 }; });
/* particle pools */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const larv = pool(14, () => mk("circle", { class: "p-larv", r: 3 }, layers.parts));
const lym = pool(26, () => mk("circle", { class: "p-lymph", r: 3.2 }, layers.parts));
const meds = pool(10, () => { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* labels and gauges */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["worm", "Adult worms", "g-worm", "Adult filarial worms living in the lymphatics. Antifilarial treatment reduces them, but established damage can remain."], ["mic", "Microfilariae", "g-mic", "Offspring of adult worms in the blood, appearing mainly at night so a biting mosquito can take them up. They fall fast with antifilarial treatment and are often low when obstruction is advanced."], ["inf", "Inflammation", "g-bad", "Acute inflammatory attacks on lymph vessels and nodes. Hygiene and limb care reduce attacks."], ["blk", "Lymph block", "g-fl", "How obstructed lymph drainage is. It rises from asymptomatic infection to chronic disease and is not quickly reversed."], ["swl", "Swelling", "g-swel", "Lymphoedema, elephantiasis and hydrocele from poor lymph drainage. Hygiene and limb care help some swelling, surgery helps selected cases, and established swelling may persist."], ["eos", "Eosinophils", "g-eos", "Eosinophil signal. It rises with filarial infection and is marked in tropical pulmonary eosinophilia, where microfilariae are cleared in the lungs."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Mosquito", 112, 122, 110, 72, "Culex mosquito. Its bite places infective larvae in the skin. Other mosquito types can also carry lymphatic filariasis in some places.");
  pill(ox, "Larvae", 168, 146, 262, 72, "Infective larvae left in the skin by the bite. They travel to the lymphatics and mature into adult worms.");
  pill(ox, "Adult worms", 420, 168, 430, 72, "Adult worms living coiled in the lymph vessel. They release microfilariae and, with the host response, injure the vessel and its valves.");
  pill(ox, "Lymph node", 668, 150, 612, 72, "Lymph node on the lymphatic pathway. Adult worms can also live in nodes, and nodes swell in acute attacks.");
  pill(ox, "Swollen leg", 786, 220, 828, 72, "Leg with lymphoedema. In chronic disease the swelling becomes firm and the skin thickens, called elephantiasis. Hygiene and limb care help, and surgery helps selected cases.");
  pill(ox, "Blocked flow", 550, 178, 540, 238, "Tangle of worms and damaged vessel blocking lymph flow. Lymph collects upstream and drainage fails, driving swelling.");
  pill(ox, "Microfilariae", 210, 300, 180, 412, "Microfilariae in the blood. They appear mainly at night, matching mosquito biting, and are taken up by the next mosquito. In tropical pulmonary eosinophilia they are cleared in the lungs and absent from blood.");
  pill(ox, "Eosinophils", 360, 250, 360, 412, "Eosinophils, a white cell type raised in filarial infection. A marked rise with cough or wheeze suggests tropical pulmonary eosinophilia.");
  pill(ox, "Hydrocele", 886, 198, 830, 412, "Hydrocele: fluid collecting around the testis when lymph drainage from the scrotum is blocked. It is a common chronic sign and surgery can help selected cases.");
}
const sm = { Worm: 0.5, Micro: 0.6, Inflam: 0.1, Block: 0.2, Swell: 0.1, Eos: 0.3, dec: 0, hyg: 0, surg: 0 };
const acc = { larv: 0, lym: 0, med: 0 };
function init() { initMosq(); initRbc(); initMic(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  sm.Worm = lerp(sm.Worm, m.Worm, k2); sm.Micro = lerp(sm.Micro, m.Micro, k2); sm.Inflam = lerp(sm.Inflam, m.Inflam, k2); sm.Block = lerp(sm.Block, m.Block, k2); sm.Swell = lerp(sm.Swell, m.Swell, k2); sm.Eos = lerp(sm.Eos, m.Eos, k2); sm.dec = lerp(sm.dec, m.dec, k1); sm.hyg = lerp(sm.hyg, m.hyg, k1); sm.surg = lerp(sm.surg, m.surg, k1);
  layers.inflam.setAttribute("opacity", (sm.Inflam * 0.16).toFixed(2));
  if (mosqG) place(mosqG, 100 + Math.sin(tm / 700) * 3, 112 + Math.cos(tm / 900) * 2.5, Math.sin(tm / 1200) * 5, 1);
  layers.worms.style.opacity = (0.25 + 0.75 * sm.Worm).toFixed(2);
  layers.worms.setAttribute("transform", "translate(0 " + f1(Math.sin(tm / 800) * 1.5) + ")");
  layers.blockg.style.opacity = (0.2 + 0.8 * sm.Block).toFixed(2);
  const bScale = 0.6 + 0.6 * sm.Block;
  layers.blockg.setAttribute("transform", "translate(550 176) scale(" + bScale.toFixed(2) + ") translate(-550 -176)");
  /* limb and hydrocele size follows swelling; surgery and care shrink it in step() via smoothed swell */
  layers.calf.setAttribute("rx", f1(16 + 26 * sm.Swell)); layers.calf.setAttribute("ry", f1(28 + 26 * sm.Swell));
  layers.calf.style.opacity = (0.25 + 0.7 * sm.Swell).toFixed(2);
  layers.hydro.setAttribute("rx", f1(10 + 22 * sm.Swell)); layers.hydro.setAttribute("ry", f1(14 + 26 * sm.Swell));
  layers.hydro.style.opacity = (0.25 + 0.75 * sm.Swell).toFixed(2);
  layers.leg.style.opacity = (0.75 + 0.25 * sm.Swell).toFixed(2);
  /* larvae from bite to lymph vessel */
  acc.larv += dt * (0.4 + sm.Worm) * 2.2; while (acc.larv >= 1) { acc.larv--; const p = free(larv); if (p) emit(p, 128, 142, 0, 0, 0); }
  larv.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (235 - p.x) * dt * 0.9 + 14 * dt; p.y += (172 - p.y) * dt * 0.9; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 260)) + " " + f1(clamp(p.y, 130, 190)) + ")"); if (p.t > 3.2) kill(p); });
  /* lymph flow: droplets move right, stall before the block as block rises */
  acc.lym += dt * 5; while (acc.lym >= 1) { acc.lym--; const p = free(lym); if (p) emit(p, 200, rnd(166, 186), rnd(28, 40), 0, 0); }
  lym.forEach((p) => { if (!p.on) return; p.t += dt; const stallX = 640 - 110 * sm.Block; const sp = p.x < stallX - 30 ? p.vx : p.vx * (1 - sm.Block * 0.92); p.x += Math.max(4, sp) * dt; p.y += Math.sin(tm / 300 + p.x / 20) * 0.15; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 196, 652)) + " " + f1(clamp(p.y, 160, 192)) + ")"); if (p.x > 648 || p.t > 9) kill(p); });
  /* red cells flow in blood */
  rbcs.forEach((r) => { r.x += r.v * 62 * dt; if (r.x > 700) { r.x = 8; r.y = rnd(-16, 16); } place(r.g, clamp(r.x, 8, 692), 304 + clamp(r.y, -16, 16), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* microfilariae: surge at night (slow cycle), count follows Micro */
  const night = 0.5 + 0.5 * Math.sin(tm / 4200);
  const vis = sm.Micro * (0.3 + 0.7 * night);
  const wantM = Math.round(vis * mics.length);
  mics.forEach((mc, i) => { const on = i < wantM; mc.g.style.opacity = on ? 1 : 0; if (!on) return; mc.x += mc.v * 58 * dt; if (mc.x > 700) { mc.x = 8; mc.y = rnd(-16, 16); } place(mc.g, clamp(mc.x, 10, 690), 304 + clamp(mc.y, -16, 16), Math.sin(tm / 260 + mc.ph) * 14, 1); });
  /* eosinophils bob, more prominent as Eos rises */
  eoss.forEach((e, i) => { const on = i < Math.round(sm.Eos * eoss.length); e.g.style.opacity = on ? 1 : 0; if (on) place(e.g, e.x + Math.sin(tm / 1300 + e.ph) * 3, e.y + Math.cos(tm / 1500 + e.ph) * 2, Math.sin(tm / 2000 + e.ph) * 8, 0.7 + 0.5 * sm.Eos); });
  /* antifilarial capsules drift to the lymph vessel when that treatment is chosen */
  acc.med += dt * sm.dec * 2.6; while (acc.med >= 1) { acc.med--; const p = free(meds); if (p) emit(p, rnd(40, 110), 300, 0, 0, 0); }
  meds.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (330 - p.x) * dt * 0.5 + 15 * dt; p.y += (176 - p.y) * dt * 0.6; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 560)) + " " + f1(clamp(p.y, 160, 310)) + ") rotate(" + f1(p.t * 80) + ")"); p.e.setAttribute("opacity", clamp(1 - Math.max(0, p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* gauges */
  gg.worm.set(sm.Worm, wordOf(sm.Worm, 0.3, 0.65, ["few", "present", "many"])); gg.mic.set(sm.Micro, wordOf(sm.Micro, 0.25, 0.6, ["low", "present", "high"])); gg.inf.set(sm.Inflam, wordOf(sm.Inflam, 0.25, 0.6, ["quiet", "active", "severe"]));
  gg.blk.set(sm.Block, wordOf(sm.Block, 0.3, 0.65, ["open", "partial", "blocked"])); gg.swl.set(sm.Swell, wordOf(sm.Swell, 0.25, 0.6, ["none", "mild", "severe"])); gg.eos.set(sm.Eos, wordOf(sm.Eos, 0.35, 0.65, ["normal", "raised", "high"]));
}
run({ init, step });
