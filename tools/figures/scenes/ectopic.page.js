/* Ectopic pregnancy scene: egg trapped in the tube, tubal mass, leak or rupture, blood pooling, and the treatments. Read left to right: ovary, tube with mass, uterus. */
const WW = SC.W;
const L = { anatomy: $("anatomy"), cells: $("cells"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, u: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const trophP = pool(24, () => mk("circle", { class: "sc-p p-troph", r: 2.3 }, L.parts));
const dropP = pool(30, () => mk("path", { class: "p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const hcgP = pool(18, () => mk("circle", { class: "sc-p p-hcg", r: 2.2 }, L.parts));
const mtxP = pool(14, () => mk("circle", { class: "sc-p p-mtx", r: 3 }, L.parts));
const eggP = pool(10, () => mk("circle", { class: "sc-p p-egg", r: 2.6 }, L.parts));
/* organs and the tube between them: the tube path is rebuilt from the organ ports so it always meets real anatomy */
let ovO = null, uterO = null, tubeTr = null, MX = 306, MY = 249, uStop = 0.27;
let massG = null, massEl = null, poolEl = null, ringEl = null, capEl = null, capKey = "";
const blockers = [], sutures = [], cracks = [], poolRbcs = [];
const POOLX = 500, POOLY = 402;
function cubicPt(p0, c1, c2, p3, t) {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]];
}
function initOrgans() {
  ovO = organ($("ovSlot"), "ovary", 110, 252, 110, {});
  uterO = organ($("uterSlot"), "uterus", 772, 262, 150, {});
  const O = ovO.ports.out, U = uterO.ports.in;
  const c1 = [O[0] + 150, O[1] - 2], c2 = [U[0] - 230, U[1] + 14];
  const d = "M" + f1(O[0]) + " " + f1(O[1]) + " C" + f1(c1[0]) + " " + f1(c1[1]) + " " + f1(c2[0]) + " " + f1(c2[1]) + " " + f1(U[0]) + " " + f1(U[1]);
  $("tube").setAttribute("d", d);
  $("tubeIn").setAttribute("d", d);
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(cubicPt(O, c1, c2, U, i / 8));
  tubeTr = track(pts);
  const q = tubeTr.at(0.30);
  MX = q.x; MY = q.y; uStop = 0.27;
}
function capText(d, l) {
  if (d === 3) return l === 2 ? "Surgery removes the burst mass and stops the bleeding." : "Surgery removes the mass before the tube can burst.";
  if (d === 2) return l === 2 ? "Methotrexate tries to stop growth, but a burst tube still bleeds." : "Methotrexate stops the mass growing, so the tube is spared.";
  if (d === 1) return l === 0 ? "Watch and wait. A small mass can fade on its own." : "Watch and wait is unsafe now. The mass is too advanced to just watch.";
  if (l === 1) return "No treatment. The tube is leaking blood into the abdomen.";
  if (l === 2) return "No treatment. The tube has burst and blood is pooling.";
  return "No treatment. The mass keeps growing into the thin tube wall.";
}
function initAnatomy() {
  const ana = L.anatomy;
  poolEl = mk("ellipse", { class: "ect-pool", cx: POOLX, cy: POOLY, rx: 90, ry: 15, opacity: 0 }, ana);
  for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-rbc" }, L.cells); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); poolRbcs.push({ g, x: rnd(360, 640), y: POOLY, v: rnd(0.7, 1.2) }); }
  massG = mk("g", { class: "hot", tabindex: "0", "data-info": "The pregnancy implanted in the tube instead of the uterus. It grows and invades the tube wall where the tube cannot stretch." }, ana);
  massEl = mk("ellipse", { class: "ect-mass", cx: 0, cy: 0, rx: 34, ry: 27 }, massG);
  mk("ellipse", { class: "ect-sac", cx: -6, cy: -4, rx: 13, ry: 10 }, massG);
  [[-32, -18, -46, -30], [-26, 20, -38, 34], [32, -20, 46, -32], [30, 18, 44, 30]].forEach(([dx1, dy1, dx2, dy2]) => {
    cracks.push(mk("path", { class: "ect-crack", d: "M" + f1(MX + dx1) + " " + f1(MY + dy1) + "L" + f1(MX + dx2) + " " + f1(MY + dy2), opacity: 0 }, ana));
  });
  for (let i = 0; i < 8; i++) blockers.push(mk("circle", { class: "sc-p p-mtx", r: 3.2, opacity: 0 }, ana));
  [MX - 16, MX, MX + 16].forEach((x) => {
    sutures.push(mk("path", { class: "ect-suture", d: "M" + f1(x) + " " + f1(MY - 13) + "L" + f1(x) + " " + f1(MY + 13), opacity: 0 }, ana));
  });
  ringEl = mk("circle", { class: "ect-ring", cx: MX, cy: MY, r: 44, opacity: 0 }, ana);
}
/* six short pills: three above the tube, three below; checked against the ovary (x 53 to 167), the tube (about y 229 to 260), the uterus (x 705 to 852, y 223 to 310), the pool (y 387 to 417) and each other */
function initPanel() {
  const ox = L.over, tubeA = tubeTr.at(0.55);
  pill(ox, "Ovary", ovO.ports.in[0], ovO.ports.in[1], 110, 150, "The ovary releases the egg. The nearby tube should pick it up and carry it to the uterus.");
  pill(ox, "Tube", tubeA.x, tubeA.y, 500, 150, "The tube should carry the egg to the uterus. Scar tissue from infection or surgery can trap the egg here.");
  pill(ox, "Tube wall", MX + 36, MY - 4, 720, 150, "The thin tube wall is invaded by the growing mass. It tears and bleeds instead of stretching like the uterus.");
  pill(ox, "Ectopic mass", MX, MY + 27, Math.round(MX), 396, "The pregnancy implanted in the tube instead of the uterus. It grows where the tube cannot stretch to hold it.");
  pill(ox, "Blood in abdomen", POOLX + 60, POOLY - 2, 640, 340, "Blood from the torn tube pools in the abdomen. Heavy bleeding causes pain and shock.");
  pill(ox, "Empty uterus", uterO.x, uterO.y + 8, 772, 396, "The uterus is empty. A positive pregnancy test with an empty uterus points to a pregnancy outside the uterus.");
  capEl = mk("text", { class: "ect-cap", x: 30, y: 434 }, ox);
  capEl.textContent = capText(0, 0);
}
const gg = {};
function initGauges() {
  const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["inv", "Growth", "g-bad", "Growth and invasion of the ectopic mass in the tube wall."], ["wall", "Wall", "g-wall", "Damage to the thin tube wall as the mass invades it."], ["bleed", "Bleeding", "g-bad", "Bleeding from the tube into the abdomen. Rupture makes this heavy."], ["pain", "Pain", "g-pain", "Abdominal pain from the stretching tube and blood irritating the abdomen, with a missed period and vaginal bleeding."], ["hcg", "hCG", "g-hcg", "hCG from the pregnancy. In an ectopic pregnancy it rises slowly or plateaus instead of rising briskly; successful treatment makes it fall."], ["shock", "Shock", "g-bad", "Shock from blood loss into the abdomen: fast pulse, low blood pressure and collapse in rupture."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); });
}
const sm = { inv: 0.3, bleed: 0.05, wall: 0.2, pain: 0.2, shock: 0.05, hcg: 0.4, mtx: 0, surg: 0, exp: 0 };
const acc = { troph: 0, drop: 0, hcg: 0, cap: 0, egg: 0 };
function init() { initOrgans(); initAnatomy(); initPanel(); initGauges(); }
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["inv", "bleed", "wall", "pain", "shock", "hcg", "mtx", "surg", "exp"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  /* the mass grows with invasion and is lifted out by surgery; sutures mark the healed tube */
  const ms = 0.55 + 0.65 * sm.inv, sc = ms * (1 - 0.92 * sm.surg);
  massG.setAttribute("transform", "translate(" + f1(MX - MX * sc) + " " + f1(MY - MY * sc) + ") scale(" + sc.toFixed(3) + ")");
  massG.setAttribute("opacity", (1 - 0.85 * sm.surg).toFixed(2));
  massEl.style.filter = "drop-shadow(0 0 " + (sm.inv * 8).toFixed(1) + "px var(--c-bad))";
  cracks.forEach((c) => c.setAttribute("opacity", (clamp(sm.wall * 1.2 - 0.25) * (1 - sm.surg)).toFixed(2)));
  sutures.forEach((s) => s.setAttribute("opacity", sm.surg.toFixed(2)));
  ringEl.setAttribute("r", f1(30 + 14 * ms));
  ringEl.setAttribute("opacity", (sm.exp * (1 - sm.surg)).toFixed(2));
  /* methotrexate blockers sit on the mass while invasion particles fade downstream */
  blockers.forEach((b, i) => {
    const an = (i / blockers.length) * 6.2832;
    b.setAttribute("cx", f1(MX + Math.cos(an) * 24 * ms));
    b.setAttribute("cy", f1(MY + Math.sin(an) * 19 * ms));
    b.setAttribute("opacity", (sm.mtx * (1 - sm.surg)).toFixed(2));
  });
  /* eggs leave the ovary, travel the tube and pile up where the mass blocks the way */
  acc.egg += dt * 1.4 * (1 - sm.surg); while (acc.egg >= 1) { acc.egg--; const p = free(eggP); if (p) { emit(p, 0, 0, 0, 0); p.u = 0.01; } }
  eggP.forEach((p) => {
    if (!p.on) return; p.t += dt; p.u = Math.min(uStop, p.u + dt * 0.05);
    const q = tubeTr.at(p.u);
    p.e.setAttribute("transform", "translate(" + f1(q.x) + " " + f1(q.y) + ")");
    p.e.setAttribute("opacity", clamp(1 - (p.t - 6) / 2).toFixed(2));
    if (p.t > 8) kill(p);
  });
  /* trophoblast particles burrow from the mass into the wall */
  acc.troph += dt * sm.inv * 7 * (1 - 0.55 * sm.mtx); while (acc.troph >= 1) { acc.troph--; const p = free(trophP); if (p) { const an = rnd(0, 6.28); emit(p, MX + Math.cos(an) * 16, MY + Math.sin(an) * 12, Math.cos(an) * rnd(14, 26), Math.sin(an) * rnd(14, 26)); } }
  trophP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, MX - 60, MX + 60); p.y = clamp(p.y, MY - 36, MY + 36); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) kill(p); });
  /* hCG particles drift slowly upward from the mass */
  acc.hcg += dt * sm.hcg * 6; while (acc.hcg >= 1) { acc.hcg--; const p = free(hcgP); if (p) emit(p, MX + rnd(-18, 18), MY - 18, rnd(-6, 6), -rnd(16, 26)); }
  hcgP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, MX - 80, MX + 80); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3 || p.y < 136) kill(p); });
  /* blood drops leak or pour from the tube and pool in the abdomen */
  acc.drop += dt * sm.bleed * 11; while (acc.drop >= 1) { acc.drop--; const p = free(dropP); if (p) emit(p, MX + 8 + rnd(-10, 10), MY + 14, rnd(-4, 8), rnd(10, 22)); }
  dropP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > POOLY - 6) kill(p); });
  poolEl.setAttribute("opacity", (sm.bleed * 0.9).toFixed(2));
  poolEl.setAttribute("rx", f1(90 + 170 * sm.bleed));
  poolEl.setAttribute("ry", f1(15 + 13 * sm.bleed));
  poolRbcs.forEach((r, i) => { r.x += r.v * 9 * sm.bleed * dt; if (r.x > 680) r.x = 320; place(r.g, r.x, POOLY + Math.sin(tm / 700 + i) * 3, 0, sm.bleed > 0.06 ? 1 : 0.01); r.g.style.opacity = sm.bleed.toFixed(2); });
  /* methotrexate travels to the mass and docks */
  acc.cap += dt * sm.mtx * 2.6; while (acc.cap >= 1) { acc.cap--; const p = free(mtxP); if (p) emit(p, rnd(30, 90), 246, 0, 0); }
  mtxP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (MX - p.x) * dt * 0.55 + 20 * dt; p.y += (MY - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* gauges and the in stage caption */
  gg.inv.set(sm.inv, wordOf(sm.inv, 0.28, 0.6, ["resolving", "growing", "invading"])); gg.wall.set(sm.wall, wordOf(sm.wall, 0.3, 0.6, ["intact", "invaded", "rupturing"]));
  gg.bleed.set(sm.bleed, wordOf(sm.bleed, 0.18, 0.55, ["none", "leaking", "heavy"])); gg.pain.set(sm.pain, wordOf(sm.pain, 0.3, 0.6, ["mild", "present", "severe"]));
  gg.hcg.set(sm.hcg, wordOf(sm.hcg, 0.25, 0.5, ["falling", "slow rise", "rising"])); gg.shock.set(sm.shock, wordOf(sm.shock, 0.22, 0.5, ["absent", "threatened", "present"]));
  const ck = drug + ":" + level;
  if (ck !== capKey) { capKey = ck; const t = capText(drug, level); if (capEl.textContent !== t) capEl.textContent = t; }
}
run({ init, step });
