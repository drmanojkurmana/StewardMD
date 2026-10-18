/* Mitral regurgitation scene: a beating left heart, an incompetent mitral valve, systolic backflow into the atrium, forward flow to the aorta, the consequence chain, a holosystolic murmur strip and the gauges. */
const VX = 245, VY = 238, LAY = 168, LVY = 338;
const L = { heart: $("heart"), parts: $("parts"), chain: $("chain"), over: $("over"), panel: $("panel") };
const sm = { R: 0.6, F: 0.6, LApres: 0.5, Pulm: 0.4, Mur: 0.6, LAvol: 0.5, LVvol: 0.55, Dys: 0.25, BP: 0.7, vaso: 0, repair: 0, repl: 0 };
let beat = 0, gg = {};
/* ---- static heart parts ---- */
const veins = mk("g", {}, L.heart);
mk("path", { class: "mre-vein", d: "M28 136L152 150" }, veins);
mk("path", { class: "mre-vein", d: "M28 198L150 192" }, veins);
mk("path", { class: "mre-aorta", id: "mreAorta", d: "M298 306C352 286 388 232 388 152L388 118L450 118" }, L.heart);
const wall = mk("ellipse", { class: "mre-wall", cx: VX, cy: LVY }, L.heart);
const cav = mk("ellipse", { class: "mre-ch", cx: VX, cy: LVY }, L.heart);
const la = mk("ellipse", { class: "mre-la", cx: VX, cy: LAY }, L.heart);
const wave = mk("path", { class: "mre-wave" }, L.heart);
const papL = mk("ellipse", { class: "mre-pap", rx: 13, ry: 17 }, L.heart);
const papR = mk("ellipse", { class: "mre-pap", rx: 13, ry: 17 }, L.heart);
const chordL = mk("path", { class: "mre-chord" }, L.heart), chordR = mk("path", { class: "mre-chord" }, L.heart);
const leafL = mk("path", { class: "mre-leaf" }, L.heart), leafR = mk("path", { class: "mre-leaf" }, L.heart);
const annLine = mk("path", { class: "mre-chord" }, L.heart);
const ring = mk("ellipse", { class: "mre-ring", cx: VX, cy: VY, ry: 9, opacity: 0 }, L.heart);
const prost = mk("g", { opacity: 0 }, L.heart);
mk("ellipse", { class: "mre-prost", cx: VX, cy: VY, rx: 30, ry: 11 }, prost);
const discA = mk("path", { class: "mre-disc" }, prost), discB = mk("path", { class: "mre-disc" }, prost);
/* ---- flow tracks and particles ---- */
const aTrack = track([[272, 314], [332, 290], [376, 224], [388, 158], [388, 118], [442, 118]]);
const bTrack = track([[VX, 234], [238, 206], [252, 180], [242, 152]]);
const iTrack = track([[VX, 188], [VX, 238], [VX, 296], [VX, 332]]);
function pool(n, cls, r) { return Array.from({ length: n }, (_, i) => { const e = mk("circle", { class: cls, r, opacity: 0 }, L.parts); return { e, u: i / n, off: rnd(-5, 5) }; }); }
const jetsF = pool(14, "mre-jetF", 2.5), jetsB = pool(16, "mre-jetB", 2.4), jetsI = pool(10, "mre-jetI", 2.3);
/* ---- cause chips ---- */
const CAUSES = [
  [78, "Prolapse", "Leaflet prolapse: a floppy leaflet billows back into the atrium in systole, so its edge no longer meets the other leaflet and a gap opens."],
  [190, "Rheumatic", "Rheumatic damage: the leaflets thicken, scar and fuse at their edges over years. Stiff leaflets cannot meet cleanly, so the valve leaks (and often narrows too)."],
  [302, "Papillary", "Papillary muscle dysfunction: after ischaemic damage the papillary muscle and the wall beneath it move poorly or are pulled away as the ventricle dilates. Otherwise normal leaflets are tethered open: secondary regurgitation."],
  [414, "Dilated annulus", "Dilated annulus: as the ventricle and atrium enlarge, the ring the leaflets hang from stretches. Normal leaflets are too small to meet across the wider ring, so the leak grows."],
];
CAUSES.forEach(([x, t, tip]) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": tip }, L.chain);
  mk("rect", { class: "mre-node", x: x - 53, y: 75, width: 106, height: 26, rx: 12 }, g);
  const tx = mk("text", { class: "mre-chip-t", x, y: 92, "text-anchor": "middle" }, g); tx.textContent = t; });
/* ---- consequence chain ---- */
const NODES = {
  a: { x: 625, y: 108, t: "Regurgitant orifice", tip: "The gap between the leaflets in systole. Its size, set by the cause and by how dilated the annulus is, sets the severity of the leak.", k: "R" },
  b: { x: 835, y: 108, t: "Systolic backflow", tip: "In systole the ventricle is at far higher pressure than the atrium, so a rapid jet is driven backward through the orifice into the atrium for the whole of systole.", k: "R" },
  c: { x: 835, y: 183, t: "LA pressure rises", tip: "The atrium receives the leak on top of normal pulmonary venous inflow. Atrial pressure rises, with a prominent systolic v wave when the jet arrives.", k: "LApres" },
  d: { x: 625, y: 183, t: "LA and LV dilate", tip: "Volume overload: the extra blood returns to the ventricle in diastole, so both chambers dilate to hold it. The ventricle ejects a large total volume, but part of it is the same blood going round again.", k: "LVvol" },
  e: { x: 625, y: 258, t: "Lungs congest", tip: "High atrial pressure is passed back through the pulmonary veins. Venous congestion raises pressure in the lung capillaries and fluid leaks out: pulmonary edema and breathlessness, worst in severe disease.", k: "Pulm" },
  f: { x: 835, y: 258, t: "Forward output falls", tip: "Only the share ejected into the aorta counts. As the leak grows, forward cardiac output and arterial pressure are reduced, giving fatigue and, in severe disease, a low output state. Late, the dilated ventricle develops dysfunction of its own.", k: "fwd" },
};
const nodeEls = {};
Object.keys(NODES).forEach((key) => { const n = NODES[key], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.chain);
  mk("rect", { class: "mre-node", x: n.x - 86, y: n.y - 18, width: 172, height: 36, rx: 12 }, g);
  const t = mk("text", { class: "mre-node-t", x: n.x, y: n.y + 4, "text-anchor": "middle" }, g); t.textContent = n.t; nodeEls[key] = g; });
const ARROWS = { ab: [[711, 108], [745, 108]], bc: [[835, 128], [835, 163]], cd: [[749, 183], [715, 183]], de: [[625, 203], [625, 238]], cf: [[835, 203], [835, 238]] };
const arrows = {};
Object.keys(ARROWS).forEach((id) => { const pts = ARROWS[id], d = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(""), tr = track(pts);
  mk("path", { class: "mre-arrow", d }, L.chain);
  const p1 = pts[pts.length - 2], p2 = pts[pts.length - 1], ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 57.2958;
  mk("path", { class: "mre-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + p2[0] + " " + p2[1] + ") rotate(" + f1(ang) + ")" }, L.chain);
  const dots = Array.from({ length: 3 }, (_, i) => ({ e: mk("circle", { class: "mre-jetB", r: 2.3, opacity: 0 }, L.parts), u: i / 3 }));
  arrows[id] = { tr, dots, k: id === "cf" || id === "de" ? "x" : "R" }; });
arrows.ab.k = "R"; arrows.bc.k = "LApres"; arrows.cd.k = "LVvol"; arrows.de.k = "Pulm"; arrows.cf.k = "fwd";
/* ---- murmur strip ---- */
const strip = mk("g", { class: "hot", tabindex: "0", "data-info": "The murmur of mitral regurgitation is holosystolic: it begins with the first heart sound (S1) and fills all of systole to the second sound (S2), because ventricular pressure stays above atrial pressure throughout. A third sound (S3) can follow in diastole as the extra volume rushes back into the ventricle." }, L.chain);
mk("rect", { class: "mre-strip", x: 540, y: 342, width: 392, height: 58, rx: 10 }, strip);
const band = mk("rect", { class: "mre-band", x: 578, y: 368, width: 222, height: 8, rx: 4 }, strip);
const s3 = mk("rect", { class: "mre-s3", x: 832, y: 364, width: 14, height: 12, rx: 4, opacity: 0 }, strip);
const cursor = mk("path", { class: "mre-cursor", d: "M578 350V392" }, strip);
[["S1", 578], ["S2", 800], ["S3", 839]].forEach(([s, x]) => { const t = mk("text", { class: "mre-cap", x, y: 392, "text-anchor": "middle" }, strip); t.textContent = s; });
const stripT = mk("text", { class: "mre-cap", x: 908, y: 358, "text-anchor": "end" }, strip); stripT.textContent = "diastole";
/* ---- labels, treatment pills and gauges ---- */
pill(L.over, "Pulmonary veins", 92, 150, 80, 122, "Pulmonary veins drain into the left atrium. When atrial pressure rises, pressure is passed back through them to the lungs.");
pill(L.over, "Left atrium", 168, 172, 72, 218, "Left atrium: it receives pulmonary venous blood and, in systole, the regurgitant jet. It dilates and its pressure rises, with a prominent v wave.");
pill(L.over, "Mitral valve", VX, VY, 84, 270, "Mitral valve: two leaflets that should meet and seal in systole. Here they leave a regurgitant orifice, so blood leaks back into the atrium.");
pill(L.over, "Left ventricle", 205, 362, 88, 398, "Left ventricle: it dilates under the extra volume returning from the atrium. Its total ejection looks large, but the forward share falls, and late the muscle develops dysfunction.");
pill(L.over, "Aorta", 392, 130, 455, 175, "Aorta: the forward route. A vasodilator lowers the resistance here, so more of each beat goes forward and less leaks back.");
pill(L.over, "Papillary muscle", 296, 330, 436, 322, "Papillary muscles hold the leaflets through the chordae. Ischaemic dysfunction or displacement as the ventricle dilates tethers the leaflets open.");
const pv = pill(L.over, "Vasodilator", 392, 120, 420, 398, "A vasodilator widens the arterial tree so forward flow is easier and the leak falls; a diuretic removes lung fluid. The valve itself is unchanged.");
pv.setAttribute("id", "mre-vp"); pv.style.opacity = "0";
const pr = pill(L.over, "Valve repair", VX, VY, 420, 398, "Repair reshapes the leaflets and adds an annuloplasty ring that restores the ring size, so the patient's own leaflets meet again.");
pr.setAttribute("id", "mre-rp"); pr.style.opacity = "0";
const px = pill(L.over, "Valve replacement", VX, VY, 420, 398, "Replacement removes the leaking valve and seats a prosthesis. The leak is abolished, at the cost of a prosthetic valve.");
px.setAttribute("id", "mre-rx"); px.style.opacity = "0";
{ const P = L.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["back", "Backflow", "g-bad", "How much blood leaks back into the atrium each systole. It grows with the size of the regurgitant orifice."], ["fwd", "Forward flow", "g-good", "The share of each beat that reaches the aorta and the body. It falls as the leak grows."], ["lap", "LA pressure", "g-cyt", "Pressure in the left atrium, with a prominent systolic v wave from the arriving jet."], ["lvv", "LV volume", "g-eos", "How dilated the ventricle is under the returning extra volume."], ["lung", "Lungs", "g-fl", "Pulmonary venous congestion: pressure passed back to the lungs, with edema in severe disease."], ["mur", "Murmur", "g-clot", "The holosystolic murmur at the apex, filling systole from the first to the second heart sound."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 130 + i * 140, y0, 52, 18, cls, name, tip); }); }

function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.45);
  ["R", "F", "LApres", "Mur", "BP"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  ["Pulm", "LAvol", "LVvol", "Dys"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k2); });
  sm.vaso = lerp(sm.vaso, m.vaso, k1); sm.repair = lerp(sm.repair, m.eff > 0.1 && m.eff <= 0.25 ? 1 : 0, k1); sm.repl = lerp(sm.repl, m.eff <= 0.1 ? 1 : 0, k1);
  /* heartbeat: systole first, then filling */
  beat += dt * (0.8 + 0.4 * (1 - sm.F)); const ph = beat % 1;
  const sys = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0;
  const dia = ph > 0.44 && ph < 0.88 ? Math.sin(Math.PI * (ph - 0.44) / 0.44) : 0;
  /* chambers: atrium and ventricle dilate with volume overload; ventricle squeezes in systole */
  const ef = 0.05 + 0.15 * (1 - 0.4 * sm.Dys);
  const laRx = 86 + 36 * sm.LAvol, laRy = (44 + 14 * sm.LAvol) * (1 + 0.05 * sys * sm.LApres);
  la.setAttribute("rx", f1(laRx)); la.setAttribute("ry", f1(laRy));
  const lvRx0 = 92 + 28 * sm.LVvol, lvRy0 = 66 + 14 * sm.LVvol;
  const lvRx = lvRx0 * (1 - ef * sys), lvRy = lvRy0 * (1 - ef * 0.8 * sys);
  cav.setAttribute("rx", f1(lvRx)); cav.setAttribute("ry", f1(lvRy));
  wall.setAttribute("rx", f1(lvRx + 11)); wall.setAttribute("ry", f1(lvRy + 11));
  veins.style.opacity = (0.4 + 0.6 * sm.Pulm).toFixed(2);
  $("mreAorta").style.opacity = (0.25 + 0.45 * sm.BP).toFixed(2);
  /* atrial pressure wave: a prominent v wave lands in systole */
  let wd = ""; for (let x = 182; x <= 308; x += 14) { const u = (x - VX) / 30, bump = 20 * sm.LApres * sys * Math.exp(-u * u), y = 140 - bump - 2 * Math.sin(tm / 500 + x); wd += (x === 182 ? "M" : "L") + x + " " + f1(y); }
  wave.setAttribute("d", wd); wave.setAttribute("opacity", (0.25 + 0.75 * sm.LApres).toFixed(2));
  /* valve: leaflets meet in diastole, leave a gap in systole; annulus widens with dilatation */
  const ann = 58 + 18 * sm.LVvol * (1 - 0.35 * sm.repair) * (1 - 0.2 * sm.repl);
  const meet = lerp(17, 1.5 + 13 * sm.R, sys), tipY = lerp(VY + 30, VY - 2, sys);
  const tLx = VX - meet, tRx = VX + meet, prol = 7 * sys * (1 - sm.repair) * (1 - sm.repl);
  leafL.setAttribute("d", "M" + f1(VX - ann) + " " + VY + "Q" + f1(VX - ann * 0.55) + " " + f1(VY + 16) + " " + f1(tLx) + " " + f1(tipY - prol));
  leafR.setAttribute("d", "M" + f1(VX + ann) + " " + VY + "Q" + f1(VX + ann * 0.55) + " " + f1(VY + 16) + " " + f1(tRx) + " " + f1(tipY));
  leafL.style.opacity = (1 - sm.repl).toFixed(2); leafR.style.opacity = (1 - sm.repl).toFixed(2);
  annLine.setAttribute("d", "M" + f1(VX - ann) + " " + VY + "H" + f1(VX + ann)); annLine.setAttribute("opacity", (0.35 + 0.4 * sm.LVvol).toFixed(2));
  const ppx = 46 + 16 * sm.LVvol, ppy = VY + 92 + 6 * sm.LVvol;
  papL.setAttribute("cx", f1(VX - ppx)); papL.setAttribute("cy", f1(ppy)); papR.setAttribute("cx", f1(VX + ppx)); papR.setAttribute("cy", f1(ppy));
  chordL.setAttribute("d", "M" + f1(tLx) + " " + f1(tipY) + "L" + f1(VX - ppx) + " " + f1(ppy - 10)); chordR.setAttribute("d", "M" + f1(tRx) + " " + f1(tipY) + "L" + f1(VX + ppx) + " " + f1(ppy - 10));
  chordL.style.opacity = (1 - sm.repl).toFixed(2); chordR.style.opacity = (1 - sm.repl).toFixed(2);
  ring.setAttribute("rx", f1(ann)); ring.setAttribute("opacity", sm.repair.toFixed(2));
  prost.setAttribute("opacity", sm.repl.toFixed(2));
  const tilt = 5 + 9 * sys;
  discA.setAttribute("d", "M" + (VX - 24) + " " + VY + "L" + (VX - 1) + " " + f1(VY - tilt * 0.4)); discB.setAttribute("d", "M" + (VX + 24) + " " + VY + "L" + (VX + 1) + " " + f1(VY - tilt * 0.4));
  /* jets: forward to the aorta, backward into the atrium, and the diastolic return */
  jetsF.forEach((p) => { p.u = (p.u + dt * (0.35 + 0.4 * sm.F)) % 1; const q = aTrack.at(p.u); p.e.setAttribute("cx", f1(q.x + p.off * (1 - p.u * 0.5))); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", (sys * clamp(0.1 + 0.9 * sm.F) * Math.sin(Math.PI * p.u)).toFixed(2)); });
  jetsB.forEach((p) => { p.u = (p.u + dt * (0.4 + 0.55 * sm.R)) % 1; const q = bTrack.at(p.u); p.e.setAttribute("cx", f1(q.x + p.off * (0.4 + p.u * 1.6))); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", (sys * clamp(sm.R * 1.25) * Math.sin(Math.PI * p.u)).toFixed(2)); });
  jetsI.forEach((p) => { p.u = (p.u + dt * 0.4) % 1; const q = iTrack.at(p.u); p.e.setAttribute("cx", f1(q.x + p.off)); p.e.setAttribute("cy", f1(q.y)); p.e.setAttribute("opacity", (dia * clamp(0.25 + 0.55 * sm.LVvol) * Math.sin(Math.PI * p.u)).toFixed(2)); });
  /* chain glow and flowing dots */
  const act = { R: sm.R, LApres: sm.LApres, LVvol: sm.LVvol, Pulm: sm.Pulm, fwd: 1 - sm.F };
  Object.keys(NODES).forEach((key) => { nodeEls[key].style.filter = "drop-shadow(0 0 " + (act[NODES[key].k] * 7).toFixed(1) + "px var(--c-cyt))"; });
  Object.keys(arrows).forEach((id) => { const ar = arrows[id], v = act[ar.k]; ar.dots.forEach((d) => { d.u = (d.u + dt * (0.08 + 0.4 * v)) % 1; const q = ar.tr.at(d.u); d.e.setAttribute("cx", f1(q.x)); d.e.setAttribute("cy", f1(q.y)); d.e.setAttribute("opacity", clamp(v * 1.3).toFixed(2)); }); });
  /* murmur strip: the band fills systole; the cursor rides the cycle */
  const bh = 4 + 15 * sm.Mur; band.setAttribute("y", f1(376 - bh)); band.setAttribute("height", f1(bh)); band.setAttribute("opacity", (0.15 + 0.85 * sm.Mur).toFixed(2));
  s3.setAttribute("opacity", (clamp((sm.LVvol - 0.45) * 2) * dia).toFixed(2));
  const curX = ph < 0.38 ? 578 + (ph / 0.38) * 222 : 800 + ((ph - 0.38) / 0.62) * 108;
  cursor.setAttribute("d", "M" + f1(curX) + " 350V392");
  /* treatment pills */
  $("mre-vp").style.opacity = sm.vaso.toFixed(2); $("mre-rp").style.opacity = sm.repair.toFixed(2); $("mre-rx").style.opacity = sm.repl.toFixed(2);
  /* gauges */
  gg.back.set(sm.R, wordOf(sm.R, 0.4, 0.7, ["mild", "moderate", "severe"])); gg.fwd.set(sm.F, wordOf(sm.F, 0.45, 0.72, ["reduced", "borderline", "maintained"]));
  gg.lap.set(sm.LApres, wordOf(sm.LApres, 0.35, 0.62, ["normal", "raised", "high"])); gg.lvv.set(sm.LVvol, wordOf(sm.LVvol, 0.42, 0.65, ["normal", "dilated", "very dilated"]));
  gg.lung.set(sm.Pulm, wordOf(sm.Pulm, 0.32, 0.62, ["clear", "congested", "oedematous"])); gg.mur.set(sm.Mur, wordOf(sm.Mur, 0.35, 0.65, ["soft", "clear", "loud"]));
}
run({ init, step });
