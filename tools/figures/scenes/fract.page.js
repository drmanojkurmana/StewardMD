/* Fracture healing scene: clot, soft and hard callus, vessels, bone cells, support and the gauges. */
const layers = { haem: $("haem"), callus: $("callus"), vessels: $("vessels"), cells: $("cells"), treat: $("treat"), over: $("over"), panel: $("panel"), fragR: $("fragR") };
let haemEl, softEl, hardEl, bridgeEl, castG, plateG;
const vess = [];
const blasts = [];
const clasts = [];
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 70, xs = [110, 270, 430, 590, 750];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The fracture";
  [["bridge", "Bridging", "g-bridge", "How far new tissue spans the gap between the bone ends."], ["hard", "Hardness", "g-hard", "How far soft callus has been replaced by mineralised bone."], ["align", "Alignment", "g-align", "How well the bone ends line up. Poor alignment that persists is malunion."], ["union", "Healing", "g-union", "Overall progress toward a united, strong bone."], ["delay", "Slow risk", "g-delay", "Risk of slow healing. Movement at the gap, poor blood supply, infection, smoking, diabetes and poor nutrition all raise it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
  const ox = layers.over;
  pill(ox, "Soft callus", 415, 182, 250, 92, "Soft callus: fibrous tissue and cartilage made by cells from the bone surface. It bridges the gap but is still weak and flexible.");
  pill(ox, "Haematoma", 480, 250, 480, 92, "Haematoma: blood clot filling the fracture gap. It brings inflammatory cells that clear debris and signal repair to start.");
  pill(ox, "Hard callus", 545, 182, 710, 92, "Hard callus: soft callus replaced by woven bone laid down by osteoblasts. The bone becomes stiff and strong again.");
  pill(ox, "Remodelling", 505, 210, 850, 92, "Remodelling: osteoclasts remove woven bone and osteoblasts lay down lamellar bone. The original shape and inner canal return.");
  pill(ox, "Osteoblasts", 430, 322, 200, 412, "Osteoblasts: bone-forming cells. They lay down new bone matrix that then hardens with mineral.");
  pill(ox, "Vessels", 458, 282, 350, 412, "New blood vessels grow into the callus. Without a blood supply the new tissue cannot survive and healing stalls.");
  pill(ox, "Alignment", 520, 322, 540, 412, "Alignment: the bone ends must be held in line. Healing in a poor position is called malunion.");
  pill(ox, "Slow healing", 480, 250, 730, 412, "Slow healing: delayed union or failure to unite (nonunion). Causes include movement at the gap, poor blood supply, infection, smoking, diabetes and poor nutrition. Other problems: malunion, bone infection and stiff joints.");
}
function init() {
  haemEl = mk("ellipse", { class: "fr-haem", cx: 480, cy: 250, rx: 34, ry: 58 }, layers.haem);
  softEl = mk("ellipse", { class: "fr-soft", cx: 480, cy: 250, rx: 80, ry: 84 }, layers.callus);
  hardEl = mk("ellipse", { class: "fr-hard", cx: 480, cy: 250, rx: 94, ry: 78 }, layers.callus);
  bridgeEl = mk("rect", { class: "fr-bridge", x: 450, y: 170, width: 60, height: 160, rx: 6 }, layers.callus);
  [[452, 214, 480, 236], [452, 286, 480, 264], [508, 214, 480, 236], [508, 286, 480, 264]].forEach(([x1, y1, x2, y2]) => {
    const p = mk("path", { class: "fr-vess", d: "M" + x1 + " " + y1 + "L" + x1 + " " + y1 }, layers.vessels);
    vess.push({ p, x1, y1, x2, y2 });
  });
  for (let i = 0; i < 10; i++) blasts.push({ g: cell(layers.cells, { cls: "ost", r: 7, nuc: 0.4, seed: i + 3, wob: 0.12 }), ph: (i / 10) * 6.283 });
  for (let i = 0; i < 4; i++) clasts.push({ g: cell(layers.cells, { cls: "ocl", r: 10, nuc: 0.5, seed: i + 30, wob: 0.14 }), x: 448 + i * 22, y: 218 + (i % 2) * 56 });
  castG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "fr-cast", x: 352, y: 136, width: 256, height: 228, rx: 26 }, castG);
  plateG = mk("g", { opacity: "0" }, layers.treat);
  mk("rect", { class: "fr-plate", x: 372, y: 148, width: 216, height: 14, rx: 6 }, plateG);
  [392, 432, 528, 568].forEach((x) => { mk("circle", { class: "fr-screw", cx: x, cy: 155, r: 5 }, plateG); mk("path", { class: "fr-shaft", d: "M" + x + " 155L" + x + " 178" }, plateG); });
  const cp = pill(layers.over, "Cast or splint", 480, 150, 480, 382, "A cast or splint holds the fracture still and in line from outside while it heals."); cp.setAttribute("id", "cast-pill");
  const pp = pill(layers.over, "Plate and screws", 480, 150, 480, 382, "Internal fixation: a metal plate and screws fixed to the bone hold the ends still and in line."); pp.setAttribute("id", "plate-pill");
  initPanel();
}
const sm = { a: 0.42, soft: 0.5, bridge: 0.2, mineral: 0.2, hard: 0.1, remodel: 0, stab: 0.1, align: 0.4, union: 0.1, delay: 0.5, imm: 0, fix: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 1.4), k2 = Math.min(1, dt * 0.7);
  sm.a = lerp(sm.a, m.a, k2); sm.soft = lerp(sm.soft, m.soft, k2); sm.bridge = lerp(sm.bridge, m.bridge, k2); sm.mineral = lerp(sm.mineral, m.mineral, k2);
  sm.hard = lerp(sm.hard, m.hard, k2); sm.remodel = lerp(sm.remodel, m.remodel, k2); sm.stab = lerp(sm.stab, m.stab, k); sm.align = lerp(sm.align, m.align, k2);
  sm.union = lerp(sm.union, m.union, k2); sm.delay = lerp(sm.delay, m.delay, k2);
  sm.imm = lerp(sm.imm, drug === 1 ? 1 : 0, k); sm.fix = lerp(sm.fix, drug === 2 ? 1 : 0, k);
  const wob = (1 - sm.union) * (1 - sm.stab) * Math.sin(tm / 260) * 5;
  layers.fragR.setAttribute("transform", "translate(" + f1(wob) + " " + f1((1 - sm.align) * 7 + wob * 0.4) + ")");
  const haemS = clamp(1 - sm.a * 1.15);
  haemEl.setAttribute("opacity", haemS.toFixed(2)); haemEl.setAttribute("transform", "translate(480 250) scale(" + (0.4 + 0.6 * haemS).toFixed(2) + ") translate(-480 -250)");
  const shrink = 1 - sm.remodel * 0.45;
  softEl.setAttribute("opacity", (sm.soft * 0.75 * (1 - sm.hard * 0.7)).toFixed(2));
  softEl.setAttribute("transform", "translate(480 250) scale(" + (shrink * (0.5 + 0.5 * sm.soft)).toFixed(2) + ") translate(-480 -250)");
  hardEl.setAttribute("opacity", (sm.hard * 0.9).toFixed(2));
  hardEl.setAttribute("transform", "translate(480 250) scale(" + (shrink * (0.5 + 0.5 * sm.hard)).toFixed(2) + ") translate(-480 -250)");
  bridgeEl.setAttribute("opacity", (sm.remodel * 0.95).toFixed(2));
  vess.forEach((v) => { const u = clamp(sm.bridge * 1.1); v.p.setAttribute("d", "M" + v.x1 + " " + v.y1 + "L" + f1(lerp(v.x1, v.x2, u)) + " " + f1(lerp(v.y1, v.y2, u))); v.p.setAttribute("opacity", (0.25 + 0.75 * u).toFixed(2)); });
  blasts.forEach((b, i) => { const on = sm.mineral > 0.08 && sm.remodel < 0.85; const rx = 62 * shrink, ry = 66 * shrink, ang = b.ph + tm / 2400;
    place(b.g, 480 + Math.cos(ang) * rx, 250 + Math.sin(ang) * ry, 0, on ? 1 : 0.1); b.g.style.opacity = on ? 1 : 0; });
  clasts.forEach((c, i) => { place(c.g, c.x + Math.sin(tm / 500 + i) * 3, c.y, 0, 0.2 + 0.8 * sm.remodel); c.g.style.opacity = sm.remodel > 0.08 ? 1 : 0; });
  castG.setAttribute("opacity", (sm.imm * 0.28).toFixed(2)); plateG.setAttribute("opacity", sm.fix.toFixed(2));
  $("cast-pill").style.opacity = sm.imm.toFixed(2); $("plate-pill").style.opacity = sm.fix.toFixed(2);
  gg.bridge.set(sm.bridge, wordOf(sm.bridge, 0.25, 0.65, ["absent", "partial", "complete"]));
  gg.hard.set(sm.mineral, wordOf(sm.mineral, 0.25, 0.6, ["soft", "forming", "hard"]));
  gg.align.set(sm.align, wordOf(sm.align, 0.35, 0.65, ["poor", "fair", "good"]));
  gg.union.set(sm.union, wordOf(sm.union, 0.3, 0.7, ["not united", "uniting", "united"]));
  gg.delay.set(sm.delay, wordOf(sm.delay, 0.3, 0.6, ["low", "raised", "high"]));
}
run({ init, step });
