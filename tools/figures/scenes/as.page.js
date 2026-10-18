/* Aortic stenosis scene: a real heart with a cutaway ventricle, a calcified valve that opens a slit, a jet into the aorta, body flow on effort, and the gauges. */
const HX = 240, HY = 252, HW = 215;
const CX = 230, CY = 322, VX = 248, VY = 212;
const ART_Y = 190, ART_X0 = 648, ART_X1 = 800, MUS = [868, 190];
const LUNG = [690, 322], HEAD = [848, 322];
const L = { slot: $("heartSlot"), heart: $("heart"), valve: $("valve"), aorta: $("aorta"), body: $("bodyEl"), parts: $("parts"), over: $("over"), panel: $("panel") };
const sm = { sten: 0.6, grad: 0.5, hyp: 0.6, reserve: 0.5, bp: 0.75, sx: 0.45, hf: 0.3, repl: 0, vaso: 0 };
let heartO = null, AP = [236, 104], cavEl = null, ringEl = null, leafL = null, leafR = null, prosEl = null, aortaEl = null;
let artTop = null, artBot = null, elbowEl = null, outEl = null, muscleEl = null, paleEl = null;
let lungL = null, lungR = null, congL = null, congR = null, headEl = null, dimEl = null;
let trJet = null, trFlow = null, capEl = null, capKey = "", replPill = null, vasoPill = null;
let beat = 0;
const parr = [], calcs = [], recs = [], jets = [], flows = [];
const gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0, u: 0, ri: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const drugs = pool(8, () => mk("circle", { class: "sc-p as-drug", r: 3 }, L.parts));
const recPos = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
const used = [null, null, null, null, null, null];
function capText(d, l) {
  if (d === 1) return "New valve. Blood flows freely again and the strain on the heart eases.";
  if (d === 2) return "Vasodilator. Vessels widen but output cannot rise, so pressure falls.";
  if (l === 2) return "No treatment. Output cannot rise on effort, so symptoms build.";
  if (l === 1) return "No treatment. The tight valve builds pressure and the wall thickens.";
  return "No treatment. The valve is only mildly tight and the heart still copes.";
}
function hot(parent, tip) { return mk("g", { class: "hot", tabindex: "0", "data-info": tip }, parent); }
function initOrgans() {
  heartO = organ(L.slot, "heart", HX, HY, HW, {});
  AP = [heartO.ports.aorta[0], heartO.ports.aorta[1]];
  trJet = track([[CX, CY - 66], [240, 232], [VX, VY], [245, 170], [AP[0] + 4, AP[1] + 30], AP, [300, 86], [440, 84]]);
  trFlow = track([[440, 84], [560, 90], [630, 120], [646, 160], [ART_X0, ART_Y], [720, ART_Y], [ART_X1, ART_Y], [MUS[0] - 6, MUS[1]]]);
}
function init() {
  initOrgans();
  const g = L.heart;
  cavEl = mk("ellipse", { class: "as-cav", cx: CX, cy: CY, rx: 50, ry: 68 }, g);
  ringEl = mk("ellipse", { class: "as-ring", cx: CX, cy: CY, rx: 64, ry: 82 }, g);
  [206, 230, 254].forEach((x) => parr.push(mk("path", { class: "as-pres" }, g)));
  leafL = mk("path", { class: "as-leaf" }, L.valve);
  leafR = mk("path", { class: "as-leaf" }, L.valve);
  prosEl = mk("ellipse", { class: "as-pros", cx: VX, cy: VY, rx: 21, ry: 8, opacity: "0" }, L.valve);
  for (let i = 0; i < 6; i++) calcs.push({ e: mk("circle", { class: "as-calc", r: 2.6 + (i % 3) }, L.valve), side: i < 3 ? -1 : 1, u: 0.3 + 0.24 * (i % 3), off: (i % 2 ? 3.4 : -3) });
  aortaEl = mk("path", { class: "as-aorta", d: "M247 198L244 150C243 125 " + f1(AP[0] - 2) + " " + f1(AP[1] + 14) + " " + f1(AP[0]) + " " + f1(AP[1]) + "C" + f1(AP[0] + 40) + " " + f1(AP[1] - 18) + " 360 84 440 84C520 86 600 95 630 120C644 140 647 160 648 190" }, L.aorta);
  const b = L.body;
  elbowEl = mk("path", { class: "as-art", d: "M648 190L" + ART_X1 + " " + ART_Y }, b);
  outEl = mk("path", { class: "as-art", d: "M" + ART_X1 + " " + ART_Y + "L" + (MUS[0] - 34) + " " + MUS[1] }, b);
  artTop = mk("path", { class: "as-art", d: "" }, b);
  artBot = mk("path", { class: "as-art", d: "" }, b);
  for (let i = 0; i < 6; i++) recs.push(mk("circle", { class: "as-rec", r: 3, opacity: "0.3" }, b));
  const mg = hot(b, "Muscle on effort: working muscle needs much more blood. The fixed valve caps output, so supply cannot rise and chest pain follows.");
  muscleEl = mk("ellipse", { class: "as-muscle", cx: MUS[0], cy: MUS[1], rx: 34, ry: 26 }, mg);
  paleEl = mk("ellipse", { class: "as-pale", cx: MUS[0], cy: MUS[1], rx: 30, ry: 22, opacity: "0.4" }, mg);
  const lg = hot(b, "Lungs: the stiff ventricle raises the pressure behind it, so fluid congests the lungs and breathing labours, worst on effort or lying flat.");
  mk("path", { class: "as-lung", d: "M682 306q-13 4-14 19q0 13 11 14q5-15 3-33zM698 306q13 4 14 19q0 13-11 14q-5-15-3-33z" }, lg);
  mk("path", { class: "as-lung", d: "M690 300v14" }, lg);
  lungL = mk("ellipse", { class: "as-lung", cx: 677, cy: 322, rx: 11, ry: 15 }, lg);
  lungR = mk("ellipse", { class: "as-lung", cx: 703, cy: 322, rx: 11, ry: 15 }, lg);
  congL = mk("ellipse", { class: "as-cong", cx: 677, cy: 328, rx: 8, ry: 9, opacity: "0" }, lg);
  congR = mk("ellipse", { class: "as-cong", cx: 703, cy: 328, rx: 8, ry: 9, opacity: "0" }, lg);
  const hg = hot(b, "Brain: on effort the muscle vessels widen but output cannot rise to match, so pressure dips and the brain briefly starves. The person faints.");
  headEl = mk("circle", { class: "as-head", cx: HEAD[0], cy: HEAD[1], r: 20 }, hg);
  mk("circle", { class: "as-eye", cx: HEAD[0] - 7, cy: HEAD[1] - 3, r: 1.8 }, hg);
  mk("circle", { class: "as-eye", cx: HEAD[0] + 7, cy: HEAD[1] - 3, r: 1.8 }, hg);
  mk("path", { class: "as-eye", d: "M" + (HEAD[0] - 6) + " " + (HEAD[1] + 8) + "Q" + HEAD[0] + " " + (HEAD[1] + 4) + " " + (HEAD[0] + 6) + " " + (HEAD[1] + 8) }, hg);
  dimEl = mk("circle", { class: "as-dim", cx: HEAD[0], cy: HEAD[1], r: 20, opacity: "0" }, hg);
  for (let i = 0; i < 12; i++) jets.push({ e: mk("circle", { class: "as-jet", r: 2.4, opacity: "0" }, L.parts), u: i / 12, off: rnd(-4, 4) });
  for (let i = 0; i < 14; i++) flows.push({ e: mk("circle", { class: "as-jet", r: 2.6, opacity: "0" }, L.parts), u: i / 14 });
  initLabels(); initPanel();
}
function initLabels() {
  const o = L.over;
  pill(o, "Heart", 140, 300, 72, 250, "Heart: the real organ. The cutaway overlay shows the left ventricle and its thickened wall.");
  pill(o, "Narrow valve", 266, 205, 368, 148, "Aortic valve: thin flaps that should open wide. Calcium crusts them shut so only a slit stays open.");
  pill(o, "Thick wall", 158, 335, 80, 352, "Thick wall: the ventricle muscle bulks up to push through the slit. Thick muscle is stiff and thirsty.");
  pill(o, "Fast jet", 240, 150, 140, 120, "Fast jet: blood squeezes through the slit at high speed. A faster jet means higher pressure behind it.");
  pill(o, "Body flow", 440, 84, 440, 58, "Blood for the body: output through the aorta. The fixed slit caps it, so it cannot rise on effort.");
  pill(o, "Effort symptoms", 770, 320, 770, 376, "Effort symptoms: chest pain when the thick heart outruns its supply, fainting when pressure dips, breathlessness when the stiff heart backs up into the lungs.");
  replPill = pill(o, "New valve", 230, 218, 140, 208, "New valve: a prosthesis holds the opening wide. Blood pours through and the gradient melts away.");
  replPill.style.opacity = "0";
  vasoPill = pill(o, "Wide vessels", 715, 190, 715, 148, "Vasodilator: relaxes vessel walls so they widen. With a fixed valve, output cannot fill them, so pressure falls.");
  vasoPill.style.opacity = "0";
  capEl = mk("text", { class: "as-cap", x: 30, y: 432 }, o); capEl.textContent = capText(0, 1);
}
function initPanel() {
  const P = L.panel, y0 = 478, h = 52, xs = [130, 270, 410, 550, 690, 830];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["grad", "Gradient", "g-bad", "The pressure difference the ventricle must create across the narrowed valve. It rises steeply as the opening shrinks."], ["hyp", "Hypertrophy", "g-neu", "How much the ventricle wall has thickened around its cavity."], ["res", "Reserve", "g-good", "Output reserve: how much extra blood the heart can deliver on effort. The fixed valve caps it."], ["bp", "Pressure", "g-good", "Systemic blood pressure. Held for years, it falls late, or at once if a vasodilator widens vessels the fixed output cannot fill."], ["sx", "Symptoms", "g-bad", "Angina, syncope and breathlessness together. They mark the turn from compensated to dangerous disease."], ["hf", "Failure", "g-bad", "Late heart failure: congestion and low output as the pressure-loaded ventricle gives up."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i], y0 + 2, h, 18, cls, name, tip); });
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  sm.sten = lerp(sm.sten, m.sten, k1); sm.grad = lerp(sm.grad, m.grad, k1); sm.reserve = lerp(sm.reserve, m.reserve, k1); sm.bp = lerp(sm.bp, m.bp, k1); sm.sx = lerp(sm.sx, m.sx, k1); sm.repl = lerp(sm.repl, m.repl, k1); sm.vaso = lerp(sm.vaso, m.vaso, k1);
  sm.hyp = lerp(sm.hyp, m.hyp, k2); sm.hf = lerp(sm.hf, m.hf, k2);
  /* heartbeat: the cavity shrinks as it ejects; the wall is thicker and the cavity smaller with hypertrophy */
  beat += dt * (0.9 + 0.35 * sm.grad); const ph = beat % 1, c = Math.pow(Math.max(0, Math.sin(ph * 6.2832 * 0.5 + 0.2)), 1.2) * (ph < 0.5 ? 1 : 0);
  const ef = 0.1 + 0.26 * sm.reserve, rx = (56 - 10 * sm.hyp) * (1 - ef * c), ry = (74 - 10 * sm.hyp) * (1 - ef * c), tw = 12 + 20 * sm.hyp;
  cavEl.setAttribute("rx", f1(rx)); cavEl.setAttribute("ry", f1(ry));
  ringEl.setAttribute("rx", f1(rx + tw / 2 + 2)); ringEl.setAttribute("ry", f1(ry + tw / 2 + 2));
  ringEl.setAttribute("stroke-width", f1(tw));
  place(heartO.g, HX, HY - 1.5 * c * sm.reserve, 0, 1 + 0.012 * c * sm.reserve);
  aortaEl.setAttribute("opacity", (0.3 + 0.35 * sm.bp).toFixed(2));
  /* valve: the gap between the leaflet tips follows the stenosis; calcium fades with a prosthesis */
  const gap = 5 + 24 * (1 - sm.sten), tipY = 218 - 7 * c - 2, lx = VX - gap / 2, rxp = VX + gap / 2;
  leafL.setAttribute("d", "M230 218L" + f1(lx) + " " + f1(tipY)); leafR.setAttribute("d", "M266 218L" + f1(rxp) + " " + f1(tipY));
  calcs.forEach((cn) => { const hx = cn.side < 0 ? 230 : 266, tx = cn.side < 0 ? lx : rxp, x = lerp(hx, tx, cn.u), y = lerp(218, tipY, cn.u) + cn.off;
    cn.e.setAttribute("cx", f1(x)); cn.e.setAttribute("cy", f1(y)); cn.e.setAttribute("opacity", clamp(sm.sten * (1 - sm.repl) * 1.4).toFixed(2)); });
  prosEl.setAttribute("opacity", sm.repl.toFixed(2));
  /* pressure arrows lengthen with the gradient */
  parr.forEach((p, i) => { const x = [206, 230, 254][i], len = (26 + 52 * sm.grad) * (0.85 + 0.15 * Math.sin(tm / 300 + i));
    p.setAttribute("d", "M" + x + " 366L" + x + " " + f1(366 - len) + "M" + (x - 4) + " " + f1(374 - len) + "L" + x + " " + f1(366 - len) + "L" + (x + 4) + " " + f1(374 - len)); p.setAttribute("opacity", (0.15 + 0.8 * sm.grad).toFixed(2)); });
  /* jet: faster and thinner when tight, weaker in volume when reserve is gone */
  jets.forEach((p) => { p.u = (p.u + dt * (0.3 + 0.75 * sm.grad)) % 1; const q = trJet.at(p.u), lat = p.off * (1 - 0.65 * sm.sten);
    p.e.setAttribute("cx", f1(q.x + lat)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", clamp(0.15 + 0.8 * sm.reserve).toFixed(2)); });
  /* body flow: strong only when reserve survives the fixed valve */
  flows.forEach((p) => { p.u = (p.u + dt * (0.1 + 0.45 * sm.reserve)) % 1; const q = trFlow.at(p.u);
    p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", clamp(0.1 + 0.85 * sm.reserve).toFixed(2)); });
  /* arteriole: the vasodilator widens it, but the fixed valve cannot fill it */
  const agap = 10 + 16 * sm.vaso;
  artTop.setAttribute("d", "M" + ART_X0 + " " + f1(ART_Y - agap / 2) + "L" + ART_X1 + " " + f1(ART_Y - agap / 2));
  artBot.setAttribute("d", "M" + ART_X0 + " " + f1(ART_Y + agap / 2) + "L" + ART_X1 + " " + f1(ART_Y + agap / 2));
  const xs = [680, 720, 760];
  for (let i = 0; i < 6; i++) { const x = xs[i % 3], y = ART_Y + (i < 3 ? -agap / 2 : agap / 2);
    recPos[i][0] = x; recPos[i][1] = y;
    recs[i].setAttribute("cx", f1(x)); recs[i].setAttribute("cy", f1(y));
    recs[i].setAttribute("opacity", (0.3 + 0.7 * sm.vaso).toFixed(2)); }
  /* vasodilator dots fly in and sit on the wall receptors */
  if (sm.vaso > 0.5 && Math.random() < dt * 6) { const p = free(drugs); if (p) { const i = drugs.indexOf(p) % 6; emit(p, 715 + rnd(-40, 40), 120, 0, 0, 0); p.ri = i; } }
  drugs.forEach((p) => { if (!p.on) return;
    const r = recPos[p.ri];
    if (used[p.ri] !== p && used[p.ri]) { kill(p); return; }
    if (sm.vaso < 0.4) { p.t += dt; p.e.setAttribute("opacity", clamp(1 - p.t / 0.8).toFixed(2)); if (p.t > 0.8) { used[p.ri] = null; kill(p); } return; }
    if (p.st === 0) { p.x += (r[0] - p.x) * Math.min(1, dt * 3); p.y += (r[1] - p.y) * Math.min(1, dt * 3);
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
      if (Math.hypot(r[0] - p.x, r[1] - p.y) < 3) { p.st = 1; p.t = 0; used[p.ri] = p; } }
    else { p.x = r[0]; p.y = r[1]; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); } });
  /* the body on effort: muscle pales, lungs congest, the head dims as pressure falls */
  paleEl.setAttribute("opacity", clamp(1 - sm.reserve).toFixed(2));
  congL.setAttribute("opacity", (sm.hf * 0.9).toFixed(2)); congR.setAttribute("opacity", (sm.hf * 0.9).toFixed(2));
  dimEl.setAttribute("opacity", clamp((0.62 - sm.bp) * 2.2).toFixed(2));
  replPill.style.opacity = sm.repl.toFixed(2);
  vasoPill.style.opacity = sm.vaso.toFixed(2);
  /* gauges */
  gg.grad.set(sm.grad, wordOf(sm.grad, 0.28, 0.58, ["small", "moderate", "large"])); gg.hyp.set(sm.hyp, wordOf(sm.hyp, 0.3, 0.6, ["thin", "thick", "very thick"]));
  gg.res.set(sm.reserve, wordOf(sm.reserve, 0.38, 0.66, ["low", "reduced", "good"])); gg.bp.set(sm.bp, wordOf(sm.bp, 0.35, 0.6, ["low", "borderline", "held"]));
  gg.sx.set(sm.sx, wordOf(sm.sx, 0.3, 0.6, ["few", "some", "marked"])); gg.hf.set(sm.hf, wordOf(sm.hf, 0.25, 0.55, ["none yet", "rising", "present"]));
  const key = drug * 10 + level; if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
