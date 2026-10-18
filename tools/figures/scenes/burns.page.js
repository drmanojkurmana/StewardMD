/* Burns scene: burn depth and area, mediators, capillary leak to the third space, hypovolaemia, airway swelling and treatment effects. */
const CY = SC.CY, WW = SC.W;
const layers = { skin: $("skinG"), bodyG: $("bodyG"), air: $("airG"), rbc: $("rbcs"), parts: $("parts"), over: $("over"), panel: $("panel"), lumen: $("lumen"), oed: $("oedema") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const med = pool(42, () => mk("circle", { class: "sc-p p-cyt", r: 2.5 }, layers.parts));
const leak = pool(36, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const smoke = pool(22, () => mk("circle", { class: "bn-smoke", r: 3 }, layers.parts));
const bolus = pool(20, () => mk("path", { class: "p-fl p-bolus", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const germ = pool(18, () => mk("circle", { class: "sc-p p-lps", r: 2.2 }, layers.parts));
let burnRect = null, dressRect = null, airLumen = null, ettRect = null;
const bodyParts = [];
function initSkin() {
  const g = layers.skin;
  mk("rect", { class: "bn-epi", x: 40, y: 100, width: 240, height: 18, rx: 3 }, g);
  mk("rect", { class: "bn-derm", x: 40, y: 118, width: 240, height: 52, rx: 3 }, g);
  mk("rect", { class: "bn-sub", x: 40, y: 170, width: 240, height: 44, rx: 3 }, g);
  [70, 120, 170, 220, 260].forEach((x) => mk("circle", { class: "bn-fat", cx: x, cy: 192, r: 9 }, g));
  burnRect = mk("rect", { class: "bn-burn", x: 92, y: 100, width: 150, height: 18, rx: 3 }, g);
  dressRect = mk("rect", { class: "bn-dress", x: 82, y: 90, width: 170, height: 30, rx: 8 }, g);
  const t1 = mk("text", { class: "sc-lab", x: 46, y: 113 }, g); t1.textContent = "epidermis";
  const t2 = mk("text", { class: "sc-lab", x: 46, y: 146 }, g); t2.textContent = "dermis";
  const t3 = mk("text", { class: "sc-lab", x: 46, y: 196 }, g); t3.textContent = "fat";
}
function initBody() {
  const g = layers.bodyG, cx = 470;
  const partsDef = [["head", cx, 92, 0, -1], ["trunk", cx, 140, 0, 0], ["armL", cx - 38, 138, 0, 0], ["armR", cx + 38, 138, 0, 0], ["legL", cx - 16, 202, 0, 0], ["legR", cx + 16, 202, 0, 0]];
  mk("circle", { class: "bn-body", cx: cx, cy: 92, r: 16 }, g);
  mk("rect", { class: "bn-body", x: cx - 25, y: 108, width: 50, height: 62, rx: 8 }, g);
  mk("rect", { class: "bn-body", x: cx - 46, y: 110, width: 16, height: 56, rx: 7 }, g);
  mk("rect", { class: "bn-body", x: cx + 30, y: 110, width: 16, height: 56, rx: 7 }, g);
  mk("rect", { class: "bn-body", x: cx - 24, y: 172, width: 20, height: 58, rx: 7 }, g);
  mk("rect", { class: "bn-body", x: cx + 4, y: 172, width: 20, height: 58, rx: 7 }, g);
  const ov = [[cx, 92, "c"], [cx, 140, "r"], [cx - 38, 138, "r"], [cx + 38, 138, "r"], [cx - 16, 202, "r"], [cx + 16, 202, "r"]];
  ov.forEach(([x, y, s], i) => { const e = s === "c" ? mk("circle", { class: "bn-burned", cx: x, cy: y, r: 16 }, g) : mk("rect", { class: "bn-burned", x: x - (i === 1 ? 25 : i < 4 ? 8 : 10), y: y - (i === 1 ? 32 : 28), width: i === 1 ? 50 : i < 4 ? 16 : 20, height: i === 1 ? 62 : 56, rx: 7 }, g); bodyParts.push(e); });
}
function initAirway() {
  const g = layers.air;
  mk("rect", { class: "bn-airwall", x: 768, y: 78, width: 88, height: 154, rx: 18 }, g);
  airLumen = mk("rect", { class: "bn-airlumen", x: 784, y: 78, width: 56, height: 154, rx: 12 }, g);
  ettRect = mk("rect", { class: "bn-ett", x: 799, y: 66, width: 26, height: 178, rx: 8 }, g);
  [96, 128, 160, 192].forEach((y) => { mk("path", { class: "fibrin", d: "M772 " + y + "h14M838 " + y + "h14" }, g); });
}
const rbcs = [];
function initRbc() { for (let i = 0; i < 18; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 9, ry: 5.4 }, g); mk("ellipse", { class: "cl-s", rx: 3.4, ry: 1.7 }, g); rbcs.push({ g, x: rnd(0, WW), y: rnd(-0.8, 0.8), v: rnd(0.8, 1.2), rot: rnd(-20, 20) }); } }
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["med", "Mediators", "g-med", "Inflammatory mediators released from burned tissue. They act on capillaries throughout the body."], ["leak", "Capillary leak", "g-leak", "How much plasma escapes through capillary walls made leaky by mediators."], ["oed", "Third space oedema", "g-oed", "Leaked fluid collecting in tissues outside vessels and cells: the third space. It swells tissues but does not circulate."], ["vol", "Circulating volume", "g-vol", "Fluid still inside vessels. When it falls, blood pressure falls: hypovolaemia."], ["air", "Airway", "g-air", "How open the airway is. Inhalation injury swells its lining; airway protection keeps it open."], ["inf", "Infection risk", "g-inf", "Later risk from open burn wounds losing the skin barrier. Cooling and a dressing lower contamination."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Skin burn", 160, 104, 120, 84, "Burned skin. Depth ranges from superficial (epidermis only) to partial and full thickness (through dermis). Cooling and a dressing limit further injury.");
  pill(ox, "Burn depth", 244, 150, 180, 238, "Depth: superficial burns affect epidermis, partial thickness burns enter dermis, full thickness burns destroy the whole skin. Deeper burns leak more and scar more.");
  pill(ox, "Body area", 470, 78, 470, 58, "Total burned area estimated by the rule of nines, which divides the body surface into areas. Larger area means more leak and more fluid shift.");
  pill(ox, "Mediators", 180, 210, 330, 238, "Inflammatory mediators from the burn enter the circulation and make capillaries leaky, even away from the burn.");
  pill(ox, "Capillary leak", 600, 334, 560, 282, "Capillary wall made leaky by mediators. Plasma escapes into the tissue, so the vessel empties while the tissue swells.");
  pill(ox, "Third space", 760, 292, 700, 238, "Third space: leaked plasma collecting as oedema in tissues. This fluid is lost from the circulation until it is reabsorbed later.");
  pill(ox, "Airway", 812, 82, 812, 58, "Upper airway. Hot gases and smoke from inhalation injury injure its lining.");
  pill(ox, "Airway swelling", 852, 150, 812, 262, "Swollen airway lining from inhalation injury. The passage narrows and can obstruct; protecting the airway keeps it open.");
  pill(ox, "Circulation", 120, 372, 130, 318, "Blood vessel and circulating volume. Leak empties it (hypovolaemia); formula fluid resuscitation refills it without stopping the leak at once.");
}
const sm = { Med: 0.4, Leak: 0.3, Oed: 0.2, Vol: 0.7, BP: 0.7, AirOed: 0, Air: 1, Inf: 0.3, depth: 0.6, cool: 0, fluid: 0, airwayTx: 0, inh: 0, a: 0.5 };
const acc = { med: 0, leak: 0, smoke: 0, bolus: 0, germ: 0 };
function init() { initSkin(); initBody(); initAirway(); initRbc(); initPanel(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  sm.Med = lerp(sm.Med, m.Med, k2); sm.Leak = lerp(sm.Leak, m.Leak, k2); sm.Oed = lerp(sm.Oed, m.Oed, k2); sm.Vol = lerp(sm.Vol, m.Vol, k1); sm.BP = lerp(sm.BP, m.BP, k1); sm.AirOed = lerp(sm.AirOed, m.AirOed, k2); sm.Air = lerp(sm.Air, m.Air, k1); sm.Inf = lerp(sm.Inf, m.Inf, k2); sm.depth = lerp(sm.depth, m.depth, k2); sm.cool = lerp(sm.cool, m.cool, k1); sm.fluid = lerp(sm.fluid, m.fluid, k1); sm.airwayTx = lerp(sm.airwayTx, m.airwayTx, k1); sm.inh = lerp(sm.inh, m.inh, k2); sm.a = lerp(sm.a, m.a, k2);
  burnRect.setAttribute("height", f1(18 + (sm.depth - 0.25) / 0.65 * 96)); burnRect.setAttribute("opacity", (0.35 + 0.3 * sm.a).toFixed(2));
  dressRect.setAttribute("opacity", (sm.cool * 0.95).toFixed(2));
  const burned = sm.a < 0.45 ? [0, 0, 0, 0.7, 0, 0] : sm.inh > 0.5 ? [0, 0.75, 0.7, 0.7, 0.6, 0] : [0, 0.8, 0.7, 0.6, 0.5, 0];
  bodyParts.forEach((e, i) => e.setAttribute("opacity", (burned[i] * (0.4 + 0.6 * sm.a + 0.3)).toFixed(2)));
  const hw = Math.max(7, 28 - 20 * sm.AirOed + 14 * sm.airwayTx * sm.AirOed);
  airLumen.setAttribute("x", f1(812 - hw)); airLumen.setAttribute("width", f1(hw * 2));
  ettRect.setAttribute("opacity", (sm.airwayTx * (0.25 + 0.75 * sm.inh)).toFixed(2));
  layers.oed.setAttribute("opacity", (sm.Oed * 0.5).toFixed(2));
  acc.med += dt * sm.Med * 11; while (acc.med >= 1) { acc.med--; const p = free(med); if (p) emit(p, rnd(70, 260), rnd(112, 190), rnd(18, 34), rnd(24, 40), 0); }
  med.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, 938)) + " " + f1(clamp(p.y, 52, 330)) + ")"); if (p.y > CY - 44 || p.t > 5) kill(p); });
  acc.leak += dt * sm.Leak * 10; while (acc.leak >= 1) { acc.leak--; const p = free(leak); if (p) emit(p, rnd(360, 920), CY - 34, rnd(-4, 4), -rnd(16, 26), 0); }
  leak.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 22, 938)) + " " + f1(clamp(p.y, 252, 430)) + ")"); if (p.y < 258 || p.t > 4) kill(p); });
  acc.smoke += dt * sm.inh * 7; while (acc.smoke >= 1) { acc.smoke--; const p = free(smoke); if (p) emit(p, 812 + rnd(-10, 10), 62, rnd(-3, 3), rnd(18, 30), 0); }
  smoke.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 780, 844)) + " " + f1(clamp(p.y, 56, 226)) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 4).toFixed(2)); if (p.t > 4 || p.y > 226) kill(p); });
  acc.bolus += dt * sm.fluid * 7; while (acc.bolus >= 1) { acc.bolus--; const p = free(bolus); if (p) emit(p, 8, CY + rnd(-24, 24), 95, 0, 0); }
  bolus.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > WW + 6) kill(p); });
  acc.germ += dt * sm.Inf * 4; while (acc.germ >= 1) { acc.germ--; const p = free(germ); if (p) emit(p, rnd(60, 260), 96, rnd(-6, 6), rnd(4, 10), 0); }
  germ.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(clamp(p.x, 30, 290)) + " " + f1(clamp(p.y, 56, 220)) + ")"); if (p.t > 3.5) kill(p); });
  const flow = clamp(0.25 + 0.85 * sm.BP);
  rbcs.forEach((r) => { r.x += r.v * 72 * flow * dt; if (r.x > WW + 12) { r.x = -12; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, CY + r.y * 26, r.rot + Math.sin(tm / 500 + r.x) * 10, 1); });
  gg.med.set(sm.Med, wordOf(sm.Med, 0.3, 0.62, ["low", "raised", "high"])); gg.leak.set(sm.Leak, wordOf(sm.Leak, 0.3, 0.62, ["tight", "leaky", "very leaky"])); gg.oed.set(sm.Oed, wordOf(sm.Oed, 0.3, 0.62, ["little", "moderate", "marked"]));
  gg.vol.set(sm.Vol, wordOf(sm.Vol, 0.45, 0.72, ["low", "reduced", "maintained"])); gg.air.set(sm.Air, wordOf(sm.Air, 0.45, 0.75, ["obstructed", "narrowed", "open"])); gg.inf.set(sm.Inf, wordOf(sm.Inf, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init, step });
