/* Herpes scene: epithelium, retrograde and anterograde axonal transport, latency in the neuron nucleus, reactivation to skin vesicles. */
const LY = { skin: $("skin"), axon: $("axon"), gang: $("gang"), derm: $("derm"), trig: $("trig"), parts: $("parts"), over: $("over"), panel: $("panel") };
const axonTrack = track([[268, 240], [662, 240]]);
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: Math.random() }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }

/* skin epithelium */
mk("rect", { class: "hv-skin", x: 40, y: 110, width: 220, height: 220, rx: 14 }, LY.skin);
const epiCells = [];
[150, 200, 250, 300].forEach((y) => [75, 125, 175, 225].forEach((x, i) => { if (x === 225 && y === 150) return; const g = cell(LY.skin, { cls: "epi", r: 19, nuc: 0.35, seed: x + y, wob: 0.08 }); place(g, x, y, 0, 1); epiCells.push(g); }));
const vesicles = [80, 125, 170, 215].map((x, i) => { const g = mk("g", {}, LY.skin); mk("circle", { class: "hv-ves", r: 11 - (i % 2) * 2 }, g); mk("circle", { class: "hv-ves", cx: 7, cy: 4, r: 6 }, g); place(g, x, 108, 0, 0.1); return g; });

/* axon and ganglion */
mk("rect", { class: "hv-axon", x: 260, y: 224, width: 402, height: 32, rx: 16 }, LY.axon);
mk("path", { class: "hv-chain", d: "M268 240L662 240" }, LY.axon);
mk("ellipse", { class: "hv-gang", cx: 790, cy: 240, rx: 120, ry: 105 }, LY.gang);
[[700, 175], [880, 175], [700, 305], [880, 305], [790, 150]].forEach(([x, y], i) => { const g = cell(LY.gang, { cls: "sat", r: 15, nuc: 0.3, seed: i + 7, wob: 0.12 }); place(g, x, y, 0, 1); });
const neuron = mk("g", {}, LY.gang); cell(neuron, { cls: "neuron", r: 55, seed: 3, wob: 0.07 }); place(neuron, 790, 240, 0, 1);
mk("circle", { class: "hv-nuc", cx: 790, cy: 240, r: 26 }, LY.gang);
const latDots = [[-10, -6], [8, -10], [0, 4], [-6, 12], [12, 8], [2, -2]].map(([dx, dy]) => mk("circle", { class: "hv-lat", cx: 790 + dx, cy: 240 + dy, r: 3.2 }, LY.gang));

/* dermatome strip (zoster concept) */
mk("rect", { class: "hv-derm", x: 40, y: 365, width: 340, height: 48, rx: 12 }, LY.derm);
const dermOn = mk("rect", { class: "hv-derm hv-derm-on", x: 40, y: 365, width: 340, height: 48, rx: 12, opacity: 0 }, LY.derm);
const dermT = mk("text", { class: "sc-lab", x: 52, y: 384 }, LY.derm); dermT.textContent = "ONE DERMATOME";
const dermDots = [90, 135, 180, 225, 270, 315].map((x) => mk("circle", { class: "hv-ves", cx: x, cy: 398, r: 5 }, LY.derm));

/* triggers */
const trigG = mk("g", { opacity: 0 }, LY.trig);
[[360, 76, 104, "stress"], [478, 76, 148, "low immunity"]].forEach(([x, y, w, txt]) => { mk("rect", { class: "hv-trig", x, y, width: w, height: 28, rx: 8 }, trigG); const t = mk("text", { class: "hv-trig-t", x: x + w / 2, y: y + 18, "text-anchor": "middle" }, trigG); t.textContent = txt; });

/* particles */
const axonVirus = mkPool(24, () => mk("circle", { class: "sc-p p-virus", r: 4 }, LY.parts));
axonVirus.forEach((p) => { p.u = Math.random(); p.on = true; });
const skinVirus = mkPool(20, () => mk("circle", { class: "sc-p p-virus2", r: 3 }, LY.parts));
const acic = mkPool(12, () => { const g = mk("g", {}, LY.parts); mk("rect", { class: "sc-p p-acic", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); return g; });
let acAcc = 0;

const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478;
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The infection";
  [["rep", "Replication", "g-bad", "How actively the virus is copying itself in the epithelium. Aciclovir lowers this."], ["ves", "Vesicles", "g-fl", "Grouped fluid filled blisters on the skin where virus reaches the surface."], ["lat", "Latent genome", "g-cyt", "Viral DNA resting in the neuron nucleus. It persists even when replication is treated."], ["spr", "Axonal spread", "g-good", "Movement along the axon: backward to the ganglion in primary infection, forward to the skin on reactivation."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 170 + i * 200, y0 + 2, 52, 18, cls, name, tip); });
  pill(LY.over, "Epithelium", 95, 255, 110, 88, "Skin or mucosal epithelium: the first site of replication in primary infection and again on reactivation.");
  pill(LY.over, "Vesicles", 170, 108, 250, 88, "Grouped vesicles: blisters where virus replicating in the epithelium reaches the surface and can spread to others.");
  pill(LY.over, "Triggers", 490, 92, 490, 132, "Reactivation triggers: stress, fever, ultraviolet light and immunosuppression can wake the latent virus.");
  pill(LY.over, "Axon", 460, 240, 460, 184, "The sensory axon. Capsids travel backward (retrograde) to the ganglion in primary infection and forward (anterograde) to the skin on reactivation.");
  pill(LY.over, "Neuron", 790, 295, 790, 88, "Sensory neuron cell body in the ganglion. Its nucleus shelters the latent viral genome for life.");
  pill(LY.over, "Nucleus", 778, 228, 885, 250, "Neuron nucleus: the viral genome rests here as latent DNA, making very little viral protein.");
  pill(LY.over, "Latent DNA", 802, 252, 690, 385, "Latent viral DNA in the nucleus. Treatment can stop replication but does not clear this reservoir.");
  pill(LY.over, "Dermatome", 200, 392, 200, 428, "One dermatome: the band of skin supplied by this ganglion. Shingles (zoster) gives vesicles in a single dermatome like this.");
}
const sm = { Rep: 0.8, Ves: 0.6, Lat: 0.3, Spr: 0.7, ac: 0, react: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 2.2);
  sm.Rep = lerp(sm.Rep, m.Rep, k); sm.Ves = lerp(sm.Ves, m.Ves, k); sm.Lat = lerp(sm.Lat, m.Lat, k); sm.Spr = lerp(sm.Spr, m.Spr, k); sm.ac = lerp(sm.ac, m.ac, k);
  const reactT = m.level === 2 ? 1 : 0; sm.react = lerp(sm.react, reactT, k);
  trigG.setAttribute("opacity", sm.react.toFixed(2));
  vesicles.forEach((g, i) => { const s = clamp(sm.Ves * 1.1 - i * 0.06); place(g, [80, 125, 170, 215][i], 108, 0, Math.max(0.08, s)); g.setAttribute("opacity", s > 0.06 ? "1" : "0"); });
  latDots.forEach((d, i) => { d.setAttribute("opacity", clamp(sm.Lat * 1.2).toFixed(2)); d.setAttribute("r", (2 + 2 * sm.Lat).toFixed(1)); });
  dermOn.setAttribute("opacity", (sm.react * 0.9).toFixed(2));
  dermDots.forEach((d) => d.setAttribute("opacity", (sm.react * clamp(sm.Ves + 0.25)).toFixed(2)));
  /* axonal transport: direction depends on stage */
  const dir = m.level === 0 ? 1 : m.level === 2 ? -1 : 0;
  axonVirus.forEach((p, i) => {
    if (!dir || sm.Spr < 0.08) { p.e.setAttribute("opacity", "0"); return; }
    p.u += dir * dt * 0.14 * (0.5 + sm.Spr); if (p.u > 1) p.u -= 1; if (p.u < 0) p.u += 1;
    const pos = axonTrack.at(p.u); place(p.e, pos.x, pos.y + Math.sin(tm / 300 + i) * 5, 0, 1); p.e.setAttribute("opacity", clamp(sm.Spr * 1.4).toFixed(2));
  });
  /* skin replication dots */
  const want = Math.round(sm.Rep * skinVirus.length);
  skinVirus.forEach((p, i) => {
    if (i >= want) { if (p.on) kill(p); return; }
    if (!p.on) emit(p, rnd(55, 245), rnd(125, 315), rnd(-8, 8), rnd(-8, 8), 0);
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.x < 52 || p.x > 248) p.vx *= -1; if (p.y < 122 || p.y > 318) p.vy *= -1; p.x = clamp(p.x, 52, 248); p.y = clamp(p.y, 122, 318);
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  /* aciclovir particles drift to the skin and ganglion */
  acAcc += dt * sm.ac * 3; while (acAcc >= 1) { acAcc--; const p = freeP(acic); if (p) emit(p, rnd(280, 340), 240, 0, 0, Math.random() < 0.6 ? 0 : 1); }
  acic.forEach((p) => { if (!p.on) return; p.t += dt; const tx = p.k ? 760 : 150, ty = p.k ? 240 : 190; p.x += (tx - p.x) * dt * 0.8; p.y += (ty - p.y) * dt * 0.8 + Math.sin(tm / 400 + p.x) * 0.2; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 60) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 3.5) / 1.2).toFixed(2)); if (p.t > 4.7) kill(p); });
  gg.rep.set(sm.Rep, wordOf(sm.Rep, 0.2, 0.55, ["quiet", "active", "high"])); gg.ves.set(sm.Ves, wordOf(sm.Ves, 0.15, 0.5, ["none", "few", "many"]));
  gg.lat.set(sm.Lat, wordOf(sm.Lat, 0.4, 0.75, ["seeding", "present", "established"])); gg.spr.set(sm.Spr, wordOf(sm.Spr, 0.2, 0.55, ["still", "moving", "spreading"]));
}
run({ init, step });
