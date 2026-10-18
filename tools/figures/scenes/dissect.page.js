/* Aortic dissection scene: tear, true and false lumens, propagation, branches, heart complications and gauges. */
const PTS = [[200, 360], [230, 350], [230, 190]];
for (let i = 1; i < 12; i++) { const ang = Math.PI - (i / 12) * Math.PI; PTS.push([355 + 125 * Math.cos(ang), 190 - 125 * Math.sin(ang)]); }
PTS.push([480, 190], [480, 425]);
const TRK = track(PTS);
const L = { aorta: $("aorta"), branches: $("branches"), organs: $("organs"), heart: $("heart"), parts: $("parts"), over: $("over"), panel: $("panel") };
const pathFrom = (pts) => pts.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("");
const sampled = (u0, u1, n, off) => { const pts = []; for (let i = 0; i <= n; i++) { const q = TRK.at(clamp(u0 + (u1 - u0) * i / n, 0, 1)); const nx = Math.sin(q.a * Math.PI / 180), ny = -Math.cos(q.a * Math.PI / 180); pts.push([q.x + nx * off, q.y + ny * off]); } return pts; };
const sm = { FalseL: 0.6, Impulse: 0.8, Branch: 0.2, Tamp: 0.2, AR: 0.2, Pain: 0.5, repair: 0, ctrl: 0, surg: 0, endo: 0 };
let wallEl, trueEl, falseEl, flapEl, tearEl, graftEl, stentEl, fluidEl, cavEl, myoEl, arrowsEl, weakEl, painEl;
let branchLines = [], organOcc = [], tearAPill, tearBPill, treatPills = {};
const rbcs = [], gg = {};
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const falseDots = pool(14, () => mk("circle", { class: "sc-p p-false", r: 2.6 }, L.parts));
const arDots = pool(12, () => mk("circle", { class: "sc-p p-ar", r: 2.4 }, L.parts));
const acc = { ar: 0, fl: 0 };

function init() {
  /* aorta: wall, true lumen, false lumen, flap, tear, graft and stent */
  wallEl = mk("path", { class: "ds-wall", d: pathFrom(PTS) }, L.aorta);
  trueEl = mk("path", { class: "ds-true", d: pathFrom(PTS) }, L.aorta);
  graftEl = mk("path", { class: "ds-graft", d: pathFrom(sampled(0.03, 0.3, 16, 0)), opacity: "0" }, L.aorta);
  falseEl = mk("path", { class: "ds-false", d: "" }, L.aorta);
  flapEl = mk("path", { class: "ds-flap", d: "" }, L.aorta);
  let stentD = "";
  for (let i = 0; i <= 20; i++) { const y = 214 + i * 8.5; const x = 480 + (i % 2 ? 15 : -15); stentD += (i ? "L" : "M") + x + " " + f1(y); }
  stentEl = mk("path", { class: "ds-stent", d: stentD, opacity: "0" }, L.aorta);
  tearEl = mk("g", {}, L.aorta);
  mk("path", { class: "ds-tear", d: "M-9 -7L-2 0L-9 7M9 -7L2 0L9 7" }, tearEl);
  weakEl = mk("path", { class: "ds-weak", d: "M447 330L447 402" }, L.aorta);
  /* pressure arrows pressing on the ascending wall from the left */
  arrowsEl = mk("g", {}, L.aorta);
  [[176, 150], [176, 215], [176, 280]].forEach(([x, y]) => { mk("path", { class: "ds-arrow", d: "M" + x + " " + y + "l16 -6l0 12Z" }, arrowsEl); });
  /* arch branches with end nodes */
  [[293, 82, 293, 58], [355, 66, 355, 48], [417, 82, 417, 58]].forEach(([x1, y1, x2, y2]) => {
    branchLines.push(mk("path", { class: "ds-branch", d: "M" + x1 + " " + y1 + "L" + x2 + " " + y2 }, L.branches));
    mk("circle", { class: "ds-branch-end", cx: x2, cy: y2, r: 7 }, L.branches);
  });
  /* descending branches to organ nodes */
  [[225], [275], [345]].forEach(([y]) => {
    branchLines.push(mk("path", { class: "ds-branch", d: "M512 " + y + "L612 " + y }, L.branches));
    mk("circle", { class: "ds-organ", cx: 625, cy: y, r: 13 }, L.organs);
    organOcc.push(mk("circle", { class: "ds-occ", cx: 625, cy: y, r: 13, opacity: "0" }, L.organs));
  });
  /* red cells in the true lumen */
  for (let i = 0; i < 20; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.parts); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, u: Math.random(), lat: rnd(-13, 13), v: rnd(0.85, 1.15), rot: rnd(-18, 18) }); }
  /* heart: pericardial fluid, sac, muscle ring and valve */
  fluidEl = mk("ellipse", { class: "ds-fluid", cx: 190, cy: 368, rx: 96, ry: 66, opacity: "0" }, L.heart);
  mk("ellipse", { class: "ds-peri", cx: 190, cy: 368, rx: 100, ry: 70 }, L.heart);
  cavEl = mk("circle", { class: "ds-cav", cx: 190, cy: 368, r: 34 }, L.heart);
  myoEl = mk("circle", { class: "ds-myo", cx: 190, cy: 368, r: 48 }, L.heart);
  mk("path", { class: "ds-valve", d: "M216 334L232 348L248 334" }, L.heart);
  painEl = mk("path", { class: "ds-pain", d: "M132 306l10 12l-12 4l14 10", opacity: "0" }, L.heart);
  /* labels: left column, right column, centre treatment pills */
  const o = L.over;
  pill(o, "High pressure", 198, 130, 105, 84, "Hypertension: high pressure and a fast pressure rise increase the impulse and shear stress on the aortic wall.");
  pill(o, "Ascending aorta", 198, 210, 105, 134, "The ascending aorta rises from the aortic root. If the dissection involves it, the pattern is Stanford type A.");
  tearAPill = pill(o, "Intimal tear", 254, 232, 105, 184, "Intimal tear: a break in the inner lining. Blood enters the wall through it and splits the media.");
  pill(o, "Aortic root", 210, 312, 105, 234, "The aortic root holds the aortic valve. Type A dissection here can distort the valve and leak blood around the heart.");
  pill(o, "Valve leak", 234, 342, 105, 284, "Aortic regurgitation: the distorted valve cannot close, so blood leaks back into the left ventricle.");
  pill(o, "Descending aorta", 512, 150, 770, 84, "The descending aorta runs down through the chest. A dissection confined here is Stanford type B.");
  tearBPill = pill(o, "Intimal tear", 505, 212, 760, 140, "Intimal tear: a break in the inner lining of the descending aorta. Blood enters the wall and creates the false lumen.");
  pill(o, "False lumen", 498, 272, 670, 200, "False lumen: the new channel inside the split wall. It can expand, compress the true lumen and propagate along the aorta.");
  pill(o, "Branch blocked", 612, 275, 765, 260, "Branch vessel occlusion: the flap or false lumen covers a branch opening, so the organ beyond it loses blood flow.");
  pill(o, "True lumen", 462, 342, 680, 325, "True lumen: the original channel inside the intimal flap. It carries blood to the branches when it stays open.");
  pill(o, "Weak media", 447, 368, 700, 390, "Connective tissue disease can weaken the media, the middle wall layer, so it splits more easily.");
  pill(o, "Tamponade", 182, 402, 330, 418, "Tamponade: leaked blood fills the sac around the heart and squeezes it, so it cannot fill or pump properly.");
  treatPills.ctrl = pill(o, "Impulse control", 300, 250, 355, 225, "Blood pressure and heart rate control lowers the impulse driving the tear onward and reduces wall shear.");
  treatPills.surg = pill(o, "Surgery", 262, 190, 355, 225, "Surgery replaces the torn ascending aorta and root and closes the entry tear. It is the main repair for type A dissection.");
  treatPills.endo = pill(o, "Stent graft", 480, 270, 355, 225, "Endovascular repair: a stent graft covers the descending entry tear, seals the false lumen and reopens the true lumen.");
  treatPills.ctrl.style.opacity = 0; treatPills.surg.style.opacity = 0; treatPills.endo.style.opacity = 0;
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["fl", "False lumen", "g-bad", "How large and active the false lumen inside the wall is."], ["imp", "Impulse", "g-imp", "Pressure impulse and shear on the wall. Rate and pressure control bring this down."], ["br", "Branch block", "g-clot", "How much branch vessels are covered or blocked by the flap and false lumen."], ["ta", "Tamponade", "g-tamp", "Blood in the sac around the heart squeezing it. Mainly a type A complication."], ["ar", "Valve leak", "g-fl", "Aortic regurgitation from a distorted root and valve. Mainly a type A complication."], ["pn", "Pain", "g-pain", "Abrupt tearing chest or back pain, a classic presenting symptom."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Impulse", "repair", "ctrl", "surg", "endo"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["FalseL", "Branch", "Tamp", "AR", "Pain"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  const tearU = m.typeA ? 0.17 : 0.74;
  const extent = m.typeA ? 0.22 + 0.55 * sm.FalseL : 0.07 + 0.17 * sm.FalseL;
  const endU = Math.min(1, tearU + extent);
  /* false lumen and flap on the inner side of flow */
  const fw = 6 + 20 * sm.FalseL;
  falseEl.setAttribute("d", pathFrom(sampled(tearU, endU, 24, 17)));
  falseEl.setAttribute("stroke-width", f1(fw));
  falseEl.setAttribute("opacity", clamp(0.35 + 0.65 * sm.FalseL).toFixed(2));
  flapEl.setAttribute("d", pathFrom(sampled(tearU, endU, 24, 5)));
  const tp = TRK.at(tearU);
  const tnx = Math.sin(tp.a * Math.PI / 180), tny = -Math.cos(tp.a * Math.PI / 180);
  tearEl.setAttribute("transform", "translate(" + f1(tp.x + tnx * 17) + " " + f1(tp.y + tny * 17) + ")");
  tearEl.setAttribute("opacity", (0.55 + 0.45 * Math.sin(tm / 280)).toFixed(2));
  graftEl.setAttribute("opacity", (sm.surg * (m.typeA ? 1 : 0.45)).toFixed(2));
  stentEl.setAttribute("opacity", (sm.endo * (m.typeA ? 0.35 : 1)).toFixed(2));
  arrowsEl.setAttribute("opacity", clamp(sm.Impulse).toFixed(2));
  weakEl.setAttribute("opacity", (0.35 + 0.45 * sm.FalseL).toFixed(2));
  /* red cells along the true lumen; branch blockage slows distal flow */
  const flow = clamp(0.3 + 0.7 * (1 - 0.45 * sm.Branch)) * (0.65 + 0.35 * sm.Impulse);
  rbcs.forEach((r) => {
    r.u += dt * 0.055 * r.v * flow;
    if (r.u > 1) { r.u = 0; r.lat = rnd(-13, 13); }
    const q = TRK.at(r.u);
    const nx = Math.sin(q.a * Math.PI / 180), ny = -Math.cos(q.a * Math.PI / 180);
    const squeeze = (r.u > tearU && r.u < endU) ? -8 * sm.FalseL : 0;
    place(r.g, clamp(q.x + nx * (r.lat + squeeze), 30, 930), clamp(q.y + ny * (r.lat + squeeze), 52, 432), q.a + 90 + r.rot, 1);
  });
  /* slow swirling dots inside the false lumen */
  acc.fl += dt * sm.FalseL * 5;
  while (acc.fl >= 1) { acc.fl--; const p = free(falseDots); if (p) emit(p, 0, 0, 0, 0, tearU + Math.random() * Math.max(0.01, endU - tearU)); }
  falseDots.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.k += dt * 0.012;
    if (p.k > endU || p.t > 7) { kill(p); return; }
    const q = TRK.at(clamp(p.k, 0, 1));
    const nx = Math.sin(q.a * Math.PI / 180), ny = -Math.cos(q.a * Math.PI / 180);
    const off = 17 + Math.sin(tm / 500 + p.t * 3) * 4;
    p.e.setAttribute("transform", "translate(" + f1(clamp(q.x + nx * off, 30, 930)) + " " + f1(clamp(q.y + ny * off, 52, 432)) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 7).toFixed(2));
  });
  /* branches and organ nodes */
  branchLines.forEach((b) => b.setAttribute("opacity", clamp(1 - 0.55 * sm.Branch).toFixed(2)));
  organOcc.forEach((c) => c.setAttribute("opacity", clamp(sm.Branch * 1.05).toFixed(2)));
  /* heart: beat slows with impulse control, squeezed by tamponade */
  const period = 1.05 + 0.45 * sm.ctrl, ph = ((tm / 1000) / period) % 1, beat = ph < 0.4 ? Math.sin(Math.PI * ph / 0.4) : 0;
  const squeeze = 1 - 0.22 * sm.Tamp;
  const cavR = Math.max(14, 34 * squeeze * (1 - 0.16 * beat));
  cavEl.setAttribute("r", f1(cavR));
  myoEl.setAttribute("r", f1((cavR + 62 * squeeze) / 2));
  myoEl.setAttribute("stroke-width", f1(Math.max(6, 62 * squeeze - cavR)));
  fluidEl.setAttribute("opacity", clamp(sm.Tamp * 0.5).toFixed(2));
  fluidEl.setAttribute("rx", f1(82 + 16 * sm.Tamp));
  fluidEl.setAttribute("ry", f1(54 + 14 * sm.Tamp));
  painEl.setAttribute("opacity", clamp((sm.Pain - 0.25) * 1.2).toFixed(2));
  /* valve leak: backflow dots into the ventricle */
  acc.ar += dt * sm.AR * 6;
  while (acc.ar >= 1) { acc.ar--; const p = free(arDots); if (p) emit(p, 232 + rnd(-5, 5), 346, rnd(-16, -6), rnd(16, 26), 0); }
  arDots.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, 150, 245); p.y = clamp(p.y, 52, 420);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2));
    if (p.t > 1.8) kill(p);
  });
  /* tear and treatment pills */
  tearAPill.style.opacity = m.typeA ? 1 : 0;
  tearBPill.style.opacity = m.typeA ? 0 : 1;
  treatPills.ctrl.style.opacity = sm.ctrl.toFixed(2);
  treatPills.surg.style.opacity = sm.surg.toFixed(2);
  treatPills.endo.style.opacity = sm.endo.toFixed(2);
  /* gauges */
  gg.fl.set(sm.FalseL, wordOf(sm.FalseL, 0.3, 0.62, ["small", "expanding", "large"]));
  gg.imp.set(sm.Impulse, wordOf(sm.Impulse, 0.35, 0.65, ["controlled", "raised", "high"]));
  gg.br.set(sm.Branch, wordOf(sm.Branch, 0.25, 0.55, ["open", "threatened", "blocked"]));
  gg.ta.set(sm.Tamp, wordOf(sm.Tamp, 0.2, 0.5, ["none", "filling", "severe"]));
  gg.ar.set(sm.AR, wordOf(sm.AR, 0.2, 0.5, ["none", "leaking", "severe"]));
  gg.pn.set(sm.Pain, wordOf(sm.Pain, 0.35, 0.65, ["mild", "tearing", "severe"]));
}
run({ init, step });
