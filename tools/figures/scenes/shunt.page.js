/* Shunt scene: body to heart to lungs loop, holes and duct, repair patch and prostaglandin duct action, gauges. */
const LY = { flow: $("flow"), marks: $("marks"), over: $("over"), panel: $("panel") };
function mixc(s) { const a = [91, 141, 217], b = [229, 72, 77], t = clamp(s); return "rgb(" + Math.round(lerp(a[0], b[0], t)) + "," + Math.round(lerp(a[1], b[1], t)) + "," + Math.round(lerp(a[2], b[2], t)) + ")"; }
function capText(d, l) {
  if (d === 1) return ["Defect closed. The patch stops the crossing. Lung flow is normal.", "Defect closed. The patch stops the crossing. Lung flow is normal.", "Defect closed. The duct is shut. Lung flow is normal.", "Defect closed. The shut hole strains the heart. Body flow falls.", "Defect closed and outlet opened. Red blood reaches the body."][l];
  if (d === 2) return ["Prostaglandin holds the duct open. Extra blood reaches the lungs.", "Prostaglandin holds the duct open. Extra blood reaches the lungs.", "Prostaglandin holds the duct open. Lung flow stays high.", "Prostaglandin holds the duct open. Flow stays flipped and blue.", "Prostaglandin holds the duct open. More blood reaches the lungs."][l];
  return ["No treatment. Blood crosses the upper hole to the lungs.", "No treatment. Blood crosses the lower hole to the lungs.", "No treatment. Blood leaks through the open duct to the lungs.", "No treatment. High lung pressure flips flow. The body runs blue.", "No treatment. The narrow outlet pushes blue blood to the body."][l];
}
/* ---- organs, vessels and routes ---- */
let lunL = null, lunR = null, heaO = null;
let ductTr = null, asdTr = null, vsdTr = null;
let ductMid = [520, 102], ductN = [1, 0], asdMid = [480, 260], vsdMid = [480, 320], stenPos = [555, 250];
let bodyL = [380, 413], bodyR = [580, 413], aoDot = [700, 250];
function line(pts) { return "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L"); }
function initOrgans() {
  lunL = organ($("lungSlot"), "lung", 340, 130, 80, { cls: "hot" });
  lunL.g.setAttribute("tabindex", "0");
  lunL.g.setAttribute("data-info", "Lung: blood picks up oxygen here. Flooded by left to right leaks, starved when flow flips or the outlet narrows.");
  lunR = organ($("lungSlot"), "lung", 620, 130, 80, { cls: "hot" });
  lunR.g.setAttribute("tabindex", "0");
  lunR.g.setAttribute("data-info", "Lung: blood picks up oxygen here. Flooded by left to right leaks, starved when flow flips or the outlet narrows.");
  heaO = organ($("heartSlot"), "heart", 480, 285, 200, { cls: "hot" });
  heaO.g.setAttribute("tabindex", "0");
  heaO.g.setAttribute("data-info", "Heart: the left side sends red blood out, the right side sends blue blood to the lungs. Holes let blood cross.");
  const hIn = heaO.ports.in, hAo = heaO.ports.aorta, hIVC = heaO.ports.ivc, hPu = heaO.ports.pulm;
  const hilL = lunL.ports.in, hilR = lunR.ports.in;
  asdMid = [heaO.x, heaO.y - 25]; vsdMid = [heaO.x, heaO.y + 35];
  const asdL = [asdMid[0] - 35, asdMid[1]], asdR = [asdMid[0] + 35, asdMid[1]];
  const vsdL = [vsdMid[0] - 35, vsdMid[1]], vsdR = [vsdMid[0] + 35, vsdMid[1]];
  const D0 = [520, 140], D1 = [520, 64];
  bodyL = [380, 413]; bodyR = [580, 413]; aoDot = [700, 250];
  const P = {
    paL: [hPu, D0, hilL],
    paR: [hPu, [560, 190], hilR],
    pvL: [hilL, [400, 190], hIn],
    pvR: [hilR, [560, 190], hIn],
    ao: [hAo, [500, 140], D1, [600, 62], [700, 62], [700, 250], [700, 380], [630, 405], bodyR],
    vein: [bodyL, [300, 395], [300, 300], hIVC],
    duct: [D0, D1],
    asd: [asdL, asdR],
    vsd: [vsdL, vsdR],
  };
  const ids = { paL: "vPA", paR: "vPAb", pvL: "vPV", pvR: "vPVb", ao: "vAo", vein: "vVein", duct: "vDuct", asd: "vASD", vsd: "vVSD" };
  const TR = {};
  Object.keys(ids).forEach((k) => { $(ids[k]).setAttribute("d", line(P[k])); TR[k] = track(P[k]); });
  ductTr = TR.duct; asdTr = TR.asd; vsdTr = TR.vsd;
  const dm = ductTr.at(0.5);
  ductMid = [dm.x, dm.y];
  const ar = dm.a * Math.PI / 180;
  ductN = [-Math.sin(ar), Math.cos(ar)];
  const sq = TR.paR.at(0.22);
  stenPos = [sq.x, sq.y];
  return TR;
}
/* ---- bloodstream particles ---- */
let RTS = [], dots = [];
function initDots(TR) {
  const defs = [["vein", 5], ["paL", 5], ["paR", 4], ["pvL", 4], ["pvR", 4], ["ao", 8]];
  defs.forEach(([k, n]) => {
    const r = { k, tr: TR[k] };
    RTS.push(r);
    for (let i = 0; i < n; i++) { const e = mk("circle", { class: "p-blood", r: 3.1 }, LY.flow); dots.push({ e, r, u: (i + 0.5) / n, sp: rnd(0.85, 1.15) }); }
  });
}
const shDots = [];
function initShunt() {
  for (let i = 0; i < 12; i++) { const e = mk("circle", { class: "p-blood", r: 2.9, opacity: "0" }, LY.flow); shDots.push({ e, u: i / 12, kind: i < 4 ? "asd" : i < 8 ? "vsd" : "duct" }); }
}
/* ---- treatment art: patch over the hole, prostaglandin on the duct, stenosis, halos ---- */
let asdPatch = null, vsdPatch = null, ductPatch = null, pgeGlow = null, clampEl = null, stenG = null, strainEl = null, haloL = null, haloR = null;
let closeDots = [], pgeDots = [];
function initMarks() {
  asdPatch = mk("g", { opacity: "0" }, LY.marks);
  mk("ellipse", { class: "sh-glow-patch", cx: f1(asdMid[0]), cy: f1(asdMid[1]), rx: 60, ry: 38, opacity: "0.45" }, asdPatch);
  mk("path", { class: "sh-patch", d: "M" + f1(asdMid[0] - 35) + " " + f1(asdMid[1]) + "L" + f1(asdMid[0] + 35) + " " + f1(asdMid[1]) }, asdPatch);
  vsdPatch = mk("g", { opacity: "0" }, LY.marks);
  mk("ellipse", { class: "sh-glow-patch", cx: f1(vsdMid[0]), cy: f1(vsdMid[1]), rx: 60, ry: 38, opacity: "0.45" }, vsdPatch);
  mk("path", { class: "sh-patch", d: "M" + f1(vsdMid[0] - 35) + " " + f1(vsdMid[1]) + "L" + f1(vsdMid[0] + 35) + " " + f1(vsdMid[1]) }, vsdPatch);
  ductPatch = mk("g", { opacity: "0" }, LY.marks);
  mk("ellipse", { class: "sh-glow-patch", cx: f1(ductMid[0]), cy: f1(ductMid[1]), rx: 85, ry: 65, opacity: "0.4" }, ductPatch);
  const c0 = [ductMid[0] - ductN[0] * 12, ductMid[1] - ductN[1] * 12], c1 = [ductMid[0] + ductN[0] * 12, ductMid[1] + ductN[1] * 12];
  clampEl = mk("path", { class: "sh-clamp", d: "M" + f1(c0[0]) + " " + f1(c0[1]) + "L" + f1(c1[0]) + " " + f1(c1[1]) }, ductPatch);
  pgeGlow = mk("ellipse", { class: "sh-glow-pge", cx: f1(ductMid[0]), cy: f1(ductMid[1]), rx: 85, ry: 65, opacity: "0" }, LY.marks);
  strainEl = mk("ellipse", { class: "sh-strain", cx: f1(heaO.x), cy: f1(heaO.y), rx: 88, ry: 72, opacity: "0" }, LY.marks);
  haloL = mk("ellipse", { class: "sh-lunghalo", cx: f1(lunL.x), cy: f1(lunL.y), rx: 70, ry: 68, opacity: "0" }, LY.marks);
  haloR = mk("ellipse", { class: "sh-lunghalo", cx: f1(lunR.x), cy: f1(lunR.y), rx: 70, ry: 68, opacity: "0" }, LY.marks);
  stenG = mk("g", { opacity: "0" }, LY.marks);
  mk("path", { class: "sh-sten", d: "M" + f1(stenPos[0] - 9) + " " + f1(stenPos[1] - 8) + "L" + f1(stenPos[0] + 11) + " " + f1(stenPos[1]) + "L" + f1(stenPos[0] - 9) + " " + f1(stenPos[1] + 8) + "Z" }, stenG);
  mk("path", { class: "sh-sten", d: "M" + f1(stenPos[0] + 9) + " " + f1(stenPos[1] - 8) + "L" + f1(stenPos[0] - 11) + " " + f1(stenPos[1]) + "L" + f1(stenPos[0] + 9) + " " + f1(stenPos[1] + 8) + "Z" }, stenG);
  const spots = [[asdMid, "asd"], [vsdMid, "vsd"]];
  spots.forEach(([mid, kind]) => {
    for (let i = 0; i < 6; i++) {
      const q = (kind === "asd" ? asdTr : vsdTr).at(0.15 + 0.14 * i);
      const a = mk("circle", { class: "sc-p p-close", r: 5, opacity: "0" }, LY.marks);
      place(a, q.x, q.y - 9, 0, 1); closeDots.push({ e: a, kind });
    }
  });
  for (let i = 0; i < 6; i++) {
    const u = 0.2 + 0.12 * i, q = ductTr.at(u);
    const ix = q.x + ductN[0] * 10, iy = q.y + ductN[1] * 10, px = q.x - ductN[0] * 10, py = q.y - ductN[1] * 10;
    const a = mk("circle", { class: "sc-p p-close", r: 5, opacity: "0" }, LY.marks);
    place(a, ix, iy, 0, 1); closeDots.push({ e: a, kind: "duct" });
    const b = mk("circle", { class: "sc-p p-pge", r: 5, opacity: "0" }, LY.marks);
    place(b, px, py, 0, 1); pgeDots.push(b);
  }
}
/* ---- labels and gauges ---- */
const gg = {};
const pillRefs = {};
let capEl = null, capKey = "";
function initPanel() {
  const P = LY.panel, y0 = 478, h = 52, xs = [120, 320, 520, 720];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The child";
  [["qp", "Lung flow", "g-pulm", "How much blood flows through the lungs. Left to right leaks flood the lungs. A narrow outlet or flipped flow leaves the lungs short."], ["pap", "Lung pressure", "g-press", "Pressure in the lung artery. It rises with large left to right leaks and is very high when flow flips."], ["sat", "Saturation", "g-good", "Oxygen in blood reaching the body. It falls when blue blood crosses to the body and the skin looks blue."], ["qs", "Body flow", "g-fl", "How much blood reaches the body. Closing a relief hole when pressure is very high can lower it."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
  const ox = LY.over;
  const hilL = lunL.ports.in;
  pillRefs.lungs = pill(ox, "Lungs", hilL[0], hilL[1], 150, 140, "Lungs: blood picks up oxygen here. Extra left to right leaks flood them. Too little flow leaves blood blue.");
  pillRefs.aorta = pill(ox, "Aorta", aoDot[0], aoDot[1], 800, 140, "Aorta: carries red blood from the left heart to the body. Its colour sets the saturation gauge.");
  pillRefs.duct = pill(ox, "Ductus", ductMid[0], ductMid[1], 750, 90, "Ductus: a channel between the aorta and the lung artery. Open after birth it leaks blood to the lungs. Prostaglandin holds it open.");
  pillRefs.asd = pill(ox, "ASD", asdMid[0], asdMid[1], 185, 235, "Upper hole between the upper chambers. Blood usually crosses left to right into the lungs.");
  pillRefs.vsd = pill(ox, "VSD", vsdMid[0], vsdMid[1], 185, 315, "Lower hole between the pumping chambers. In flipped flow and tetralogy blood crosses right to left.");
  pillRefs.narrow = pill(ox, "Narrow outlet", stenPos[0], stenPos[1], 790, 215, "Narrowed lung outlet in tetralogy. Resistance here pushes blue blood across the lower hole.");
  pillRefs.body = pill(ox, "Body", bodyR[0], bodyR[1], 770, 405, "Body: uses oxygen and sends blue blood back. Blue colour here means blue blood is crossing to the body.");
  capEl = mk("text", { class: "sh-cap", x: 30, y: 430 }, ox); capEl.textContent = capText(0, 1);
}
const sm = { Qp: 0.8, Qs: 0.8, PAP: 0.5, satArt: 0.9, satR: 0.3, satPA: 0.4, satL: 0.9, cyan: 0.1, shunt: 0.6, mag: 0.6, closed: 0, ductOpen: 0, obstruct: 0, rvLoad: 0.5, pge: 0 };
function init() {
  const TR = initOrgans();
  initDots(TR);
  initShunt();
  initMarks();
  initPanel();
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.55);
  ["Qp", "Qs", "PAP", "satArt", "satR", "satPA", "satL", "cyan", "mag", "rvLoad"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  sm.shunt = lerp(sm.shunt, m.shunt, k2); sm.closed = lerp(sm.closed, m.closed, k1); sm.ductOpen = lerp(sm.ductOpen, m.ductOpen, k1); sm.obstruct = lerp(sm.obstruct, m.obstruct, k1);
  sm.pge = lerp(sm.pge, drug === 2 ? 1 : 0, k1);
  /* vessels follow physiology and meet the real organ ports */
  const vP = $("vPA"), vPb = $("vPAb"), vPv = $("vPV"), vPv2 = $("vPVb"), vAo = $("vAo"), vVn = $("vVein"), vDu = $("vDuct"), vA = $("vASD"), vV = $("vVSD");
  if (vP) { vP.style.stroke = mixc(sm.satPA); vP.setAttribute("stroke-width", f1(5 + 6 * sm.Qp)); }
  if (vPb) { vPb.style.stroke = mixc(sm.satPA); vPb.setAttribute("stroke-width", f1(5 + 6 * sm.Qp)); }
  if (vPv) { vPv.style.stroke = mixc(sm.satL); vPv.setAttribute("opacity", (0.25 + 0.75 * sm.Qp).toFixed(2)); }
  if (vPv2) { vPv2.style.stroke = mixc(sm.satL); vPv2.setAttribute("opacity", (0.25 + 0.75 * sm.Qp).toFixed(2)); }
  if (vAo) { vAo.style.stroke = mixc(sm.satArt); vAo.setAttribute("stroke-width", f1(6 + 5 * sm.Qs)); }
  if (vVn) { vVn.style.stroke = mixc(0.08); vVn.setAttribute("opacity", (0.3 + 0.7 * sm.Qs).toFixed(2)); }
  if (vDu) { vDu.style.opacity = (0.1 + 0.9 * sm.ductOpen).toFixed(2); vDu.setAttribute("stroke-width", f1(2 + 7 * sm.ductOpen)); }
  const showA = m.defect === "ASD", showV = m.defect === "VSD" && m.level !== 2;
  if (vA) { vA.style.opacity = showA ? (sm.closed < 0.5 ? (0.3 + 0.7 * sm.mag).toFixed(2) : "0.12") : "0.1"; vA.style.stroke = sm.shunt < 0 ? mixc(0.08) : mixc(0.92); }
  if (vV) { vV.style.opacity = showV ? (sm.closed < 0.5 ? (0.3 + 0.7 * sm.mag).toFixed(2) : "0.12") : "0.1"; vV.style.stroke = sm.shunt < 0 ? mixc(0.08) : mixc(0.92); }
  $("bodyRect").style.fill = mixc(clamp(0.15 + 0.75 * sm.satArt));
  stenG.setAttribute("opacity", sm.obstruct.toFixed(2));
  /* repair patch sits on the active hole, prostaglandin dots sit on the duct wall */
  const patchA = showA && sm.closed > 0.04 ? sm.closed : 0, patchV = showV && sm.closed > 0.04 ? sm.closed : 0, patchD = m.level === 2 && sm.closed > 0.04 ? sm.closed : 0;
  asdPatch.setAttribute("opacity", patchA.toFixed(2));
  vsdPatch.setAttribute("opacity", patchV.toFixed(2));
  ductPatch.setAttribute("opacity", patchD.toFixed(2));
  const pulse = 0.5 + 0.5 * Math.sin(tm / 480);
  pgeGlow.setAttribute("opacity", (sm.pge * (0.3 + 0.08 * pulse)).toFixed(2));
  strainEl.setAttribute("opacity", (clamp(sm.rvLoad - 0.55, 0, 1) * 0.5).toFixed(2));
  const lh = (0.05 + 0.55 * sm.Qp).toFixed(2);
  haloL.setAttribute("opacity", lh); haloR.setAttribute("opacity", lh);
  closeDots.forEach((p) => {
    const on = p.kind === "asd" ? patchA : p.kind === "vsd" ? patchV : patchD;
    p.e.setAttribute("opacity", on.toFixed(2));
  });
  pgeDots.forEach((e) => { e.setAttribute("opacity", sm.pge.toFixed(2)); });
  pillRefs.asd.style.opacity = m.level === 0 ? "1" : "0.18";
  pillRefs.vsd.style.opacity = m.level !== 0 && m.level !== 2 ? "1" : "0.18";
  pillRefs.duct.style.opacity = m.level === 2 || sm.ductOpen > 0.3 ? "1" : "0.35";
  pillRefs.narrow.style.opacity = m.level === 4 ? "1" : "0.18";
  /* main loop blood */
  const colFor = (k) => k === "vein" ? mixc(0.08) : k === "paL" || k === "paR" ? mixc(sm.satPA) : k === "pvL" || k === "pvR" ? mixc(sm.satL) : mixc(sm.satArt);
  dots.forEach((p) => {
    const k = p.r.k, fl = k === "vein" || k === "ao" ? sm.Qs : sm.Qp;
    p.u = (p.u + dt * (0.05 + 0.16 * fl) * p.sp) % 1;
    const q = p.r.tr.at(p.u);
    p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y));
    p.e.style.fill = colFor(k);
    const vis = k === "paL" || k === "paR" || k === "pvL" || k === "pvR" ? 0.15 + 0.85 * sm.Qp : 0.9;
    p.e.setAttribute("opacity", clamp(vis * 1.3).toFixed(2));
  });
  /* shunt dots: direction follows the shunt sign, duct extras feed the lungs in tetralogy */
  const activeKind = m.level === 2 ? "duct" : showA ? "asd" : "vsd";
  let ductExtra = sm.pge > 0.3 && m.level === 4 ? 0.7 * sm.pge : 0;
  shDots.forEach((p) => {
    const tr = p.kind === "asd" ? asdTr : p.kind === "vsd" ? vsdTr : ductTr;
    let act = 0, fwd = true;
    if (p.kind === activeKind) { act = sm.closed < 0.5 ? sm.mag : 0; fwd = p.kind === "duct" ? false : sm.shunt >= 0; }
    if (p.kind === "duct" && ductExtra > 0) { act = Math.max(act, ductExtra); fwd = false; }
    p.u = (p.u + dt * (0.12 + 0.5 * act) * (fwd ? 1 : -1) + 1) % 1;
    const q = tr.at(p.u);
    p.e.setAttribute("cx", f1(q.x)); p.e.setAttribute("cy", f1(q.y));
    p.e.style.fill = p.kind === "duct" ? mixc(0.92) : sm.shunt < 0 ? mixc(0.08) : mixc(0.92);
    p.e.setAttribute("opacity", clamp(act * 1.4).toFixed(2));
  });
  /* gauges */
  gg.qp.set(sm.Qp, wordOf(sm.Qp, 0.42, 0.68, ["low", "normal", "high"]));
  gg.pap.set(sm.PAP, wordOf(sm.PAP, 0.35, 0.7, ["normal", "raised", "very high"]));
  gg.sat.set(sm.satArt, wordOf(sm.satArt, 0.6, 0.85, ["low", "reduced", "normal"]));
  gg.qs.set(sm.Qs, wordOf(sm.Qs, 0.45, 0.7, ["low", "reduced", "adequate"]));
  const key = drug + ":" + level;
  if (key !== capKey) { capKey = key; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
