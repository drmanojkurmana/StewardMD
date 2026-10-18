/* Burns scene: burned skin releases mediators, a real vessel leaks into the third space,
 * circulating volume falls, and smoke swells the airway of a real lung. Each treatment
 * visibly acts on the drawing: a cover slides over the burn, fluids stream into the
 * vessel, and a tube holds the airway open. */
const CY = SC.CY, WW = SC.W;
const layers = { skin: $("skinSlot"), burn: $("burnFx"), vessel: $("vesselSlot"), lung: $("lungSlot"), air: $("airG"), rbc: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema") };
let skinO = null, vesselO = null, lungO = null;
let skinSurf = [150, 189], skinDerm = [144, 236], wallPt = [516, 300], tracheaPt = [800, 86], lungPt = [800, 210];
let burnTint = null, dressRect = null, burnGlow = null, airLumen = null, ettRect = null, lungGlow = null;
let capEl = null, capDrug = -1, capLevel = -1;
function capText(d, l) {
  const sev = ["Small burn. ", "Major burn. ", "Major burn plus smoke breathed in. "][l];
  if (d === 1) return sev + "Cooling and cover calm the burn. Fewer alarm signals leave the skin.";
  if (d === 2) return sev + "Fluids refill the vessels. Blood flow steadies but swelling stays.";
  if (d === 3) return sev + "Combined care calms the burn, refills vessels and holds the airway open.";
  return sev + "No treatment. Fluid leaks from vessels and swelling grows.";
}
/* ---- recognisable organs; vessels and particles anchor to their ports ---- */
function initOrgans() {
  skinO = organ(layers.skin, "skin", 150, 230, 200, { h: 110 });
  vesselO = organ(layers.vessel, "vessel", 480, 300, 90, { h: 190 });
  lungO = organ(layers.lung, "lung", 800, 210, 190, {});
  const SP = skinO.ports, VP = vesselO.ports, LP = lungO.ports;
  skinSurf = SP.surface || SP.epidermis || [skinO.x, skinO.y - 40];
  skinDerm = SP.dermis || [skinO.x, skinO.y + 6];
  wallPt = VP.wall || [vesselO.x + 36, vesselO.y];
  tracheaPt = LP.trachea || [lungO.x, lungO.y - 120];
  lungPt = LP.carina || [lungO.x, lungO.y + 20];
  const bx = skinO.x - 100, by = skinO.y - 55;
  burnGlow = mk("ellipse", { class: "bn-glow", cx: f1(skinO.x), cy: f1(skinO.y), rx: 110, ry: 70, opacity: "0" }, layers.burn);
  burnTint = mk("rect", { class: "bn-burntint", x: f1(bx + 25), y: f1(by + 8), width: 150, height: 60, rx: 8, opacity: "0.5" }, layers.burn);
  dressRect = mk("rect", { class: "bn-dress", x: f1(bx - 8), y: f1(by - 12), width: 216, height: 134, rx: 14, opacity: "0" }, layers.burn);
}
function initAirway() {
  const g = layers.air;
  lungGlow = mk("ellipse", { class: "bn-lglow", cx: 812, cy: 155, rx: 56, ry: 86, opacity: "0" }, g);
  mk("rect", { class: "bn-airwall", x: 768, y: 78, width: 88, height: 154, rx: 18 }, g);
  airLumen = mk("rect", { class: "bn-airlumen", x: 784, y: 78, width: 56, height: 154, rx: 12 }, g);
  ettRect = mk("rect", { class: "bn-ett", x: 799, y: 66, width: 26, height: 178, rx: 8, opacity: "0" }, g);
  [96, 128, 160, 192].forEach((y) => { mk("path", { class: "fibrin", d: "M772 " + y + "h14M838 " + y + "h14" }, g); });
}
/* ---- particle pools ---- */
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const med = pool(42, () => mk("circle", { class: "sc-p p-cyt", r: 2.5 }, layers.parts));
const leak = pool(36, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const smoke = pool(22, () => mk("circle", { class: "bn-smoke", r: 3 }, layers.parts));
const bolus = pool(20, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const germ = pool(18, () => mk("circle", { class: "sc-p p-lps", r: 2.2 }, layers.parts));
const cool = pool(16, () => mk("path", { class: "sc-p p-cool", d: "M0 -4L1 -1L4 0L1 1L0 4L-1 1L-4 0L-1 -1Z" }, layers.parts));
const rbcs = [];
function initRbc() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["med", "Mediators", "g-med", "Alarm signals released from burned skin. They travel in blood and make vessel walls leaky."], ["leak", "Capillary leak", "g-leak", "How much plasma escapes through vessel walls loosened by alarm signals."], ["oed", "Third space oedema", "g-oed", "Leaked fluid trapped in tissue outside vessels. It swells tissue but cannot carry blood."], ["vol", "Circulating volume", "g-vol", "Blood still inside vessels. When it falls, pressure falls. Fluids refill it."], ["air", "Airway", "g-air", "How open the windpipe is. Smoke swelling narrows it; a tube holds it open."], ["inf", "Infection risk", "g-inf", "Later risk from open burn wounds. Cooling and a cover lower it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Burned skin", skinSurf[0], skinSurf[1], 128, 96, "Burned skin. Deeper and wider burns release more alarm signals. Cooling and a cover limit further injury.");
  pill(ox, "Mediators", 330, 268, 330, 120, "Alarm signals from the burn travel in blood and make vessel walls leaky far from the burn.");
  pill(ox, "Leaky vessel", wallPt[0], wallPt[1], 480, 110, "Vessel wall loosened by alarm signals. Plasma escapes through gaps into the tissue.");
  pill(ox, "Swollen tissue", 620, 290, 650, 110, "Third space: leaked plasma trapped in tissue. It causes swelling but cannot carry blood.");
  pill(ox, "Airway", 812, 150, 800, 92, "Windpipe narrowed by smoke injury swelling. Combined care holds it open with a tube.");
  pill(ox, "Lung", lungPt[0], lungPt[1], 895, 92, "Lung behind the airway. Smoke breathed in injures the lining and adds swelling.");
  pill(ox, "Blood flow", 200, CY, 190, 318, "Blood still in vessels. Leak drains it and pressure falls; fluids refill it.");
  capEl = mk("text", { class: "bn-cap", x: 30, y: 428 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { Med: 0.4, Leak: 0.3, Oed: 0.2, Vol: 0.7, BP: 0.7, AirOed: 0, Air: 1, Inf: 0.3, depth: 0.6, cool: 0, fluid: 0, airwayTx: 0, inh: 0, a: 0.5 };
const acc = { med: 0, leak: 0, smoke: 0, bolus: 0, germ: 0, cool: 0 };
function init() { initOrgans(); initAirway(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.Med = lerp(sm.Med, m.Med, k2); sm.Leak = lerp(sm.Leak, m.Leak, k2); sm.Oed = lerp(sm.Oed, m.Oed, k2); sm.Vol = lerp(sm.Vol, m.Vol, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.AirOed = lerp(sm.AirOed, m.AirOed, k2); sm.Air = lerp(sm.Air, m.Air, k1); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.depth = lerp(sm.depth, m.depth, k2); sm.cool = lerp(sm.cool, m.cool, k1); sm.fluid = lerp(sm.fluid, m.fluid, k1); sm.airwayTx = lerp(sm.airwayTx, m.airwayTx, k1); sm.inh = lerp(sm.inh, m.inh, k2); sm.a = lerp(sm.a, m.a, k2);
  /* burn redness grows with extent and depth, calms a little with cooling; the cover slides over it */
  const bw = 50 + 120 * sm.a, bh = 22 + 70 * (sm.depth - 0.25) / 0.65;
  const bx = skinO.x - bw / 2, by = skinO.y - bh / 2;
  burnTint.setAttribute("x", f1(bx)); burnTint.setAttribute("width", f1(bw));
  burnTint.setAttribute("y", f1(by)); burnTint.setAttribute("height", f1(bh));
  burnTint.setAttribute("opacity", ((0.35 + 0.3 * sm.a) * (1 - 0.25 * sm.cool)).toFixed(2));
  burnGlow.setAttribute("opacity", (sm.Med * 0.5).toFixed(2));
  dressRect.setAttribute("opacity", (sm.cool * 0.95).toFixed(2));
  /* airway narrows with swelling, opens with the tube; the lung glow fades as the tube takes over */
  const hw = Math.max(7, 28 - 20 * sm.AirOed + 14 * sm.airwayTx * sm.AirOed);
  airLumen.setAttribute("x", f1(812 - hw)); airLumen.setAttribute("width", f1(hw * 2));
  ettRect.setAttribute("opacity", (sm.airwayTx * (0.25 + 0.75 * sm.inh)).toFixed(2));
  lungGlow.setAttribute("opacity", (sm.AirOed * (1 - 0.7 * sm.airwayTx) * 0.6).toFixed(2));
  /* third space wash grows and darkens with oedema */
  const oh = 40 + 60 * sm.Oed;
  layers.oed.setAttribute("y", f1(290 - oh / 2)); layers.oed.setAttribute("height", f1(oh));
  layers.oed.setAttribute("opacity", (sm.Oed * 0.55).toFixed(2));
  /* alarm signals drift from the burn dermis toward the vessel; cooling halves their number */
  acc.med += dt * sm.Med * 11 * (1 - 0.5 * sm.cool);
  while (acc.med >= 1) { acc.med--; const p = free(med); if (p) emit(p, skinDerm[0] + rnd(-30, 30), skinDerm[1] + rnd(-25, 25), rnd(60, 110), rnd(10, 30), 0); }
  med.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, 938)) + " " + f1(clamp(p.y, 52, 330)) + ")"); if (p.x > wallPt[0] - 20 || p.y > CY - 44 || p.t > 5) kill(p); });
  /* plasma escapes outward from the vessel wall into the tissue */
  acc.leak += dt * sm.Leak * 10; while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, wallPt[0] + rnd(-70, 10), CY - 42, rnd(-6, 6), -rnd(16, 26), 0); }
  leak.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, 938)) + " " + f1(clamp(p.y, 252, 430)) + ")"); if (p.y < 258 || p.t > 4) kill(p); });
  /* smoke drifts down the windpipe; the tube clears it */
  acc.smoke += dt * sm.inh * (1 - 0.6 * sm.airwayTx) * 7;
  while (acc.smoke >= 1) { acc.smoke--; const p = free(smoke); if (p) emit(p, tracheaPt[0] + rnd(-10, 10), tracheaPt[1], rnd(-3, 3), rnd(18, 30), 0); }
  smoke.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 780, 844)) + " " + f1(clamp(p.y, 56, 226)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.t > 4 || p.y > 226) kill(p); });
  /* fluid bolus streams in from the left when fluids run */
  acc.bolus += dt * sm.fluid * 7; while (acc.bolus >= 1) { acc.bolus--; const p = free(bolus); if (p) emit(p, 8, CY + rnd(-24, 24), 95, 0, 0); }
  bolus.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW + 6) kill(p); });
  /* germs settle on the burn; cooling shrinks them as the cover bars the way */
  acc.germ += dt * sm.Inf * 4; while (acc.germ >= 1) { acc.germ--; const p = free(germ); if (p) emit(p, skinSurf[0] + rnd(-60, 60), skinSurf[1] - 20 + rnd(-8, 8), rnd(-6, 6), rnd(4, 10), 0); }
  germ.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 290)) + " " + f1(clamp(p.y, 56, 220)) + ") scale(" + (1 - 0.4 * sm.cool).toFixed(2) + ")"); if (p.t > 3.5) kill(p); });
  /* cooling sparkles fall over the covered burn */
  acc.cool += dt * sm.cool * 8; while (acc.cool >= 1) { acc.cool--; const p = free(cool); if (p) emit(p, skinO.x + rnd(-90, 90), skinDerm[1] - 70, rnd(-4, 4), rnd(24, 40), 0); }
  cool.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 290)) + " " + f1(clamp(p.y, 56, 320)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) kill(p); });
  const flow = clamp(0.25 + 0.85 * sm.BP);
  rbcs.forEach((r) => { r.x += r.v * 72 * flow * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * 26, r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  gg.med.set(sm.Med, wordOf(sm.Med, 0.3, 0.62, ["low", "raised", "high"])); gg.leak.set(sm.Leak, wordOf(sm.Leak, 0.3, 0.62, ["tight", "leaky", "very leaky"])); gg.oed.set(sm.Oed, wordOf(sm.Oed, 0.3, 0.62, ["little", "moderate", "marked"]));
  gg.vol.set(sm.Vol, wordOf(sm.Vol, 0.45, 0.72, ["low", "reduced", "maintained"])); gg.air.set(sm.Air, wordOf(sm.Air, 0.45, 0.75, ["obstructed", "narrowed", "open"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["low", "raised", "high"]));
  if (drug !== capDrug || level !== capLevel) { capDrug = drug; capLevel = level; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
