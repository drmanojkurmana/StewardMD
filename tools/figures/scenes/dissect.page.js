/* Aortic dissection scene: tear, true and false channels, blocked branches, heart fluid and valve leak, treatment actions. */
const L = { heart: $("heart"), aorta: $("aorta"), branches: $("branches"), organs: $("organs"), parts: $("parts"), over: $("over"), panel: $("panel") };
const pathFrom = (pts) => pts.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("");
let TRK = null;
const sampled = (u0, u1, n, off) => { const pts = []; for (let i = 0; i <= n; i++) { const q = TRK.at(clamp(u0 + (u1 - u0) * i / n, 0, 1)); const nx = Math.sin(q.a * Math.PI / 180), ny = -Math.cos(q.a * Math.PI / 180); pts.push([q.x + nx * off, q.y + ny * off]); } return pts; };
const sm = { FalseL: 0.6, Impulse: 0.8, Branch: 0.2, Tamp: 0.2, AR: 0.2, Pain: 0.5, repair: 0, ctrl: 0, surg: 0, endo: 0 };
const HX = 170, HY = 386, HW = 132, KX = 690, KY = 228, GX = 690, GY = 314;
let wallEl, trueEl, strainEl, falseEl, flapEl, tearEl, graftEl, membEl, stentEl, fluidEl, painEl;
let arrowHeads = [];
let heartO = null, kidneyO = null, gutO = null;
let branchLines = [], clots = [], recs = [];
let tearA = [230, 246], tearB = [480, 200], blockDot = [560, 320];
let tearPill, falsePill, treatPill, pillKey = "";
let capEl = null, capDrug = -1;
const rbcs = [], gg = {};
let curTearU = 0.17, curEndU = 0.4;
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, ox: 0, oy: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const falseDots = pool(14, () => mk("circle", { class: "sc-p p-false", r: 2.6 }, L.parts));
const arDots = pool(12, () => mk("circle", { class: "sc-p p-ar", r: 2.4 }, L.parts));
const blockers = pool(8, () => mk("circle", { class: "sc-p p-block", r: 3 }, L.parts));
const acc = { ar: 0, fl: 0 };
function setPill(g, text, x, y, tx, ty) {
  const ch = g.childNodes, t = ch[3];
  if (t.textContent !== text) t.textContent = text;
  const lw = text.length * 6.2 + 14;
  ch[0].setAttribute("d", "M" + f1(x) + " " + f1(y) + "L" + f1(tx) + " " + f1(ty + 8));
  ch[1].setAttribute("cx", f1(x)); ch[1].setAttribute("cy", f1(y));
  ch[2].setAttribute("x", f1(tx - lw / 2)); ch[2].setAttribute("y", f1(ty - 8));
  ch[2].setAttribute("width", f1(lw));
  t.setAttribute("x", f1(tx)); t.setAttribute("y", f1(ty + 4));
}
function capText(d) {
  if (d === 1) return "Impulse control slows the pulse on the wall. The split grows more slowly.";
  if (d === 2) return "A stent graft covers the tear. Blood leaves the false channel.";
  if (d === 3) return "Surgery replaces the torn part. The false channel shrinks away.";
  return "No treatment. The tear splits the wall and blood fills a false channel.";
}
function treatPillFor(d) {
  if (d === 1) return ["Slower pulse", 205, 262, 110, 196, "Impulse control. Blocker particles sit on wall sensors and the pounding on the wall eases."];
  if (d === 2) return ["Stent covers tear", 484, 300, 770, 108, "Stent graft. A covered stent seals the tear so blood leaves the false channel."];
  return ["New aorta", 300, 120, 110, 110, "Surgery. The torn part is replaced with a tube graft and the false channel shrinks."];
}

function init() {
  const PTS = [[200, 360], [230, 350], [230, 190]];
  for (let i = 1; i < 12; i++) { const ang = Math.PI - (i / 12) * Math.PI; PTS.push([355 + 125 * Math.cos(ang), 190 - 125 * Math.sin(ang)]); }
  PTS.push([480, 190], [480, 425]);
  TRK = track(PTS);
  const ta = TRK.at(0.17); tearA = [ta.x, ta.y];
  const tb = TRK.at(0.74); tearB = [tb.x, tb.y];
  /* aorta: wall, strain glow, true channel, graft, stent membrane, false channel, flap, tear, stent */
  const wallD = pathFrom(PTS);
  wallEl = mk("path", { class: "ds-wall", d: wallD }, L.aorta);
  strainEl = mk("path", { class: "ds-strain", d: wallD, "stroke-width": 74 }, L.aorta);
  trueEl = mk("path", { class: "ds-true", d: wallD }, L.aorta);
  graftEl = mk("path", { class: "ds-graft", d: pathFrom(sampled(0.02, 0.32, 16, 0)), opacity: "0" }, L.aorta);
  membEl = mk("path", { class: "ds-graft", d: pathFrom(sampled(0.70, 0.97, 16, 0)), opacity: "0" }, L.aorta);
  falseEl = mk("path", { class: "ds-false", d: "" }, L.aorta);
  flapEl = mk("path", { class: "ds-flap", d: "" }, L.aorta);
  let stentD = "";
  for (let i = 0; i <= 20; i++) { const y = 214 + i * 8.5; const x = 480 + (i % 2 ? 15 : -15); stentD += (i ? "L" : "M") + x + " " + f1(y); }
  stentEl = mk("path", { class: "ds-stent", d: stentD, opacity: "0" }, L.aorta);
  tearEl = mk("g", {}, L.aorta);
  mk("path", { class: "ds-tear", d: "M-9 -7L-2 0L-9 7M9 -7L2 0L9 7" }, tearEl);
  /* wall sensors where impulse control blockers park */
  recs = [[202, 228], [202, 255], [202, 282], [202, 309], [202, 336]];
  recs.forEach(([x, y]) => mk("circle", { class: "ds-rec", cx: x, cy: y, r: 3 }, L.aorta));
  /* pounding pulse arrows pressing on the ascending wall from the left */
  const arrowsEl = mk("g", {}, L.aorta);
  [[176, 150], [176, 215], [176, 280]].forEach(([x, y]) => { arrowHeads.push(mk("path", { class: "ds-arrow", d: "M" + x + " " + y + "l16 -6l0 12Z" }, arrowsEl)); });
  /* arch branches with filled end nodes */
  [[293, 82, 293, 58], [355, 66, 355, 48], [417, 82, 417, 58]].forEach(([x1, y1, x2, y2]) => {
    branchLines.push(mk("path", { class: "ds-branch", d: "M" + x1 + " " + y1 + "L" + x2 + " " + y2 }, L.branches));
    mk("circle", { class: "ds-branch-end", cx: x2, cy: y2, r: 7 }, L.branches);
  });
  clots.push(mk("circle", { class: "ds-occ", cx: 355, cy: 62, r: 5, opacity: "0" }, L.branches));
  /* organs: heart with its fluid sac, kidney and gut fed by descending branches */
  fluidEl = mk("ellipse", { class: "ds-fluid", cx: 190, cy: 368, rx: 96, ry: 66, opacity: "0" }, L.heart);
  mk("ellipse", { class: "ds-peri", cx: 190, cy: 368, rx: 100, ry: 70 }, L.heart);
  heartO = organ(L.heart, "heart", HX, HY, HW, {});
  kidneyO = organ(L.organs, "kidney", KX, KY, 92, {});
  gutO = organ(L.organs, "intestine", GX, GY, 118, {});
  const kp = kidneyO.ports.in;
  branchLines.push(mk("path", { class: "ds-branch", d: "M513 " + f1(kp[1]) + "L" + f1(kp[0]) + " " + f1(kp[1]) }, L.branches));
  clots.push(mk("circle", { class: "ds-occ", cx: f1(513 + (kp[0] - 513) * 0.25), cy: f1(kp[1]), r: 6, opacity: "0" }, L.branches));
  const ge = [GX - 59 + 4, GY + 6];
  branchLines.push(mk("path", { class: "ds-branch", d: "M513 " + f1(ge[1]) + "L" + f1(ge[0]) + " " + f1(ge[1]) }, L.branches));
  const gc = [513 + (ge[0] - 513) * 0.25, ge[1]];
  clots.push(mk("circle", { class: "ds-occ", cx: f1(gc[0]), cy: f1(gc[1]), r: 6, opacity: "0" }, L.branches));
  blockDot = [gc[0] + 16, gc[1]];
  painEl = mk("path", { class: "ds-pain", d: "M132 306l10 12l-12 4l14 10", opacity: "0" }, L.heart);
  /* red cells in the true channel */
  for (let i = 0; i < 20; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.parts); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, u: Math.random(), lat: rnd(-13, 13), v: rnd(0.85, 1.15), rot: rnd(-18, 18) }); }
  blockers.forEach((p) => { p.ox = rnd(-42, -26); p.oy = rnd(-16, 16); });
  /* eight pills and a stage caption */
  const o = L.over;
  pill(o, "Heart", 118, 388, 62, 392, "Heart. Each beat sends a pulse of pressure into the aorta.");
  tearPill = pill(o, "Tear", tearA[0], tearA[1], 110, 252, "Tear. A split in the inner lining lets blood push into the wall.");
  falsePill = pill(o, "False channel", 500, 290, 700, 168, "False channel. Blood inside the split wall can grow and squeeze the true channel.");
  pill(o, "Blocked branch", blockDot[0], blockDot[1], 605, 370, "Blocked branch. The split covers a branch opening so the organ beyond gets less blood.");
  pill(o, "Kidney", KX, KY - 20, 800, 198, "Kidney. It needs steady blood flow and suffers when its branch is blocked.");
  pill(o, "Gut", GX, GY + 16, 800, 336, "Gut. It needs steady blood flow and suffers when its branch is blocked.");
  pill(o, "Tamponade", 250, 402, 340, 398, "Tamponade. Leaked blood fills the sac around the heart and squeezes it.");
  treatPill = pill(o, "Slower pulse", 205, 262, 110, 196, "Impulse control.");
  treatPill.style.opacity = 0;
  capEl = mk("text", { class: "ds-cap", x: 30, y: 430 }, o); capEl.textContent = capText(0);
  /* gauges */
  const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["fl", "False lumen", "g-bad", "How large and active the false channel inside the wall is."], ["imp", "Impulse", "g-imp", "Pressure impulse and shear on the wall. Rate and pressure control bring this down."], ["br", "Branch block", "g-clot", "How much branch vessels are covered or blocked by the flap and false channel."], ["ta", "Tamponade", "g-tamp", "Blood in the sac around the heart squeezing it. Mainly a type A complication."], ["ar", "Valve leak", "g-fl", "Aortic regurgitation from a distorted root and valve. Mainly a type A complication."], ["pn", "Pain", "g-pain", "Abrupt tearing chest or back pain, a classic presenting symptom."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
}

function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["Impulse", "repair", "ctrl", "surg", "endo"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["FalseL", "Branch", "Tamp", "AR", "Pain"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  const tearU = m.typeA ? 0.17 : 0.74;
  const extent = m.typeA ? 0.22 + 0.55 * sm.FalseL : 0.07 + 0.17 * sm.FalseL;
  const endU = Math.min(1, tearU + extent);
  const cover = clamp(Math.max(sm.surg * (m.typeA ? 1 : 0.35), sm.endo * (m.typeA ? 0.25 : 1)), 0, 1);
  const drawEnd = lerp(endU, tearU + 0.015, cover);
  curTearU = tearU; curEndU = drawEnd;
  /* false channel and flap shrink toward the tear as repair covers it */
  const fw = 6 + 20 * sm.FalseL;
  falseEl.setAttribute("d", pathFrom(sampled(tearU, drawEnd, 24, 17)));
  falseEl.setAttribute("stroke-width", f1(fw));
  falseEl.setAttribute("opacity", (clamp(0.35 + 0.65 * sm.FalseL) * (1 - 0.7 * cover)).toFixed(2));
  flapEl.setAttribute("d", pathFrom(sampled(tearU, drawEnd, 24, 5)));
  flapEl.setAttribute("opacity", (0.9 * (1 - 0.5 * cover)).toFixed(2));
  const tp = TRK.at(tearU);
  const tnx = Math.sin(tp.a * Math.PI / 180), tny = -Math.cos(tp.a * Math.PI / 180);
  tearEl.setAttribute("transform", "translate(" + f1(tp.x + tnx * 17) + " " + f1(tp.y + tny * 17) + ")");
  tearEl.setAttribute("opacity", ((0.55 + 0.45 * Math.sin(tm / 280)) * (1 - cover)).toFixed(2));
  graftEl.setAttribute("opacity", (sm.surg * (m.typeA ? 1 : 0.45)).toFixed(2));
  membEl.setAttribute("opacity", (sm.endo * (m.typeA ? 0.3 : 0.9)).toFixed(2));
  stentEl.setAttribute("opacity", (sm.endo * (m.typeA ? 0.3 : 1)).toFixed(2));
  trueEl.setAttribute("stroke-width", f1(48 + 12 * sm.endo * (m.typeA ? 0.3 : 1)));
  /* pounding on the wall: glow plus arrows that fall from three to one with control */
  strainEl.setAttribute("opacity", (0.3 * sm.Impulse).toFixed(2));
  arrowHeads.forEach((a, i) => a.setAttribute("opacity", ((i + 0.5) / 3 < sm.Impulse ? 0.95 : 0.08).toFixed(2)));
  /* impulse control blockers fly in and sit on their wall sensors */
  blockers.forEach((p, i) => {
    const R = recs[i % recs.length];
    const want = sm.ctrl > 0.25 ? 1 : 0;
    p.k += (want - p.k) * Math.min(1, dt * 2.2);
    if (p.k < 0.02) { if (p.on) kill(p); return; }
    p.on = true;
    const e = p.k * p.k * (3 - 2 * p.k);
    const jig = p.k > 0.9 ? Math.sin(tm / 300 + i * 2) * 1.2 : 0;
    place(p.e, R[0] + p.ox * (1 - e) + jig, R[1] + p.oy * (1 - e), 0, 1);
    p.e.setAttribute("opacity", p.k.toFixed(2));
  });
  /* red cells along the true channel; the repaired span flows free */
  const flow = clamp(0.3 + 0.7 * (1 - 0.45 * sm.Branch)) * (0.65 + 0.35 * sm.Impulse);
  rbcs.forEach((r) => {
    r.u += dt * 0.055 * r.v * flow;
    if (r.u > 1) { r.u = 0; r.lat = rnd(-13, 13); }
    const q = TRK.at(r.u);
    const nx = Math.sin(q.a * Math.PI / 180), ny = -Math.cos(q.a * Math.PI / 180);
    const squeeze = (r.u > tearU && r.u < drawEnd) ? -8 * sm.FalseL : 0;
    place(r.g, clamp(q.x + nx * (r.lat + squeeze), 30, 930), clamp(q.y + ny * (r.lat + squeeze), 52, 432), q.a + 90 + r.rot, 1);
  });
  /* slow swirling dots inside the false channel */
  acc.fl += dt * sm.FalseL * 5;
  while (acc.fl >= 1) { acc.fl--; const p = free(falseDots); if (p) emit(p, 0, 0, 0, 0, tearU + Math.random() * Math.max(0.01, drawEnd - tearU)); }
  falseDots.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.k += dt * 0.012;
    if (p.k > drawEnd || p.t > 7) { kill(p); return; }
    const q = TRK.at(clamp(p.k, 0, 1));
    const nx = Math.sin(q.a * Math.PI / 180), ny = -Math.cos(q.a * Math.PI / 180);
    const off = 17 + Math.sin(tm / 500 + p.t * 3) * 4;
    p.e.setAttribute("transform", "translate(" + f1(clamp(q.x + nx * off, 30, 930)) + " " + f1(clamp(q.y + ny * off, 52, 432)) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 7).toFixed(2));
  });
  /* branches fade, clots appear, starved organs dull */
  branchLines.forEach((b) => b.setAttribute("opacity", clamp(1 - 0.55 * sm.Branch).toFixed(2)));
  clots.forEach((c) => c.setAttribute("opacity", clamp(sm.Branch * 1.05).toFixed(2)));
  kidneyO.g.style.opacity = (1 - 0.45 * sm.Branch).toFixed(2);
  gutO.g.style.opacity = (1 - 0.45 * sm.Branch).toFixed(2);
  /* heart: beat slows with control, whole organ squeezed by tamponade fluid */
  const period = 1.05 + 0.45 * sm.ctrl, ph = ((tm / 1000) / period) % 1, beat = ph < 0.4 ? Math.sin(Math.PI * ph / 0.4) : 0;
  const squeeze = 1 - 0.18 * sm.Tamp;
  place(heartO.g, HX, HY, 0, (1 + 0.045 * beat) * squeeze);
  fluidEl.setAttribute("opacity", clamp(sm.Tamp * 0.5).toFixed(2));
  fluidEl.setAttribute("rx", f1(82 + 16 * sm.Tamp));
  fluidEl.setAttribute("ry", f1(54 + 14 * sm.Tamp));
  painEl.setAttribute("opacity", clamp((sm.Pain - 0.25) * 1.2).toFixed(2));
  /* valve leak: backflow dots falling into the heart */
  acc.ar += dt * sm.AR * 6;
  while (acc.ar >= 1) { acc.ar--; const p = free(arDots); if (p) emit(p, 210 + rnd(-5, 5), 348, rnd(-14, -4), rnd(14, 24), 0); }
  arDots.forEach((p) => {
    if (!p.on) return;
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, 120, 235); p.y = clamp(p.y, 320, 430);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - p.t / 1.8).toFixed(2));
    if (p.t > 1.8) kill(p);
  });
  /* moving pills follow the tear and the false channel; treatment pill follows the drug */
  const key = (m.typeA ? "A" : "B") + drug;
  if (key !== pillKey) {
    pillKey = key;
    if (m.typeA) setPill(tearPill, "Tear", tearA[0], tearA[1], 110, 252);
    else setPill(tearPill, "Tear", tearB[0], tearB[1], 640, 130);
    if (drug > 0) { const tp2 = treatPillFor(drug); treatPill.dataset.info = tp2[5]; setPill(treatPill, tp2[0], tp2[1], tp2[2], tp2[3], tp2[4]); treatPill.style.opacity = 1; }
    else treatPill.style.opacity = 0;
  }
  const mid = TRK.at(clamp((tearU + drawEnd) / 2, 0, 1));
  const mnx = Math.sin(mid.a * Math.PI / 180), mny = -Math.cos(mid.a * Math.PI / 180);
  setPill(falsePill, "False channel", mid.x + mnx * 17, mid.y + mny * 17, 700, 168);
  /* gauges and stage caption */
  gg.fl.set(sm.FalseL, wordOf(sm.FalseL, 0.3, 0.62, ["small", "expanding", "large"]));
  gg.imp.set(sm.Impulse, wordOf(sm.Impulse, 0.35, 0.65, ["controlled", "raised", "high"]));
  gg.br.set(sm.Branch, wordOf(sm.Branch, 0.25, 0.55, ["open", "threatened", "blocked"]));
  gg.ta.set(sm.Tamp, wordOf(sm.Tamp, 0.2, 0.5, ["none", "filling", "severe"]));
  gg.ar.set(sm.AR, wordOf(sm.AR, 0.2, 0.5, ["none", "leaking", "severe"]));
  gg.pn.set(sm.Pain, wordOf(sm.Pain, 0.35, 0.65, ["mild", "tearing", "severe"]));
  if (drug !== capDrug) { capDrug = drug; const t = capText(drug); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
