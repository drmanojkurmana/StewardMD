/* Ectopic pregnancy scene: damaged tube, tubal implantation, trophoblast invasion, leak or rupture, blood pooling in the abdomen, slowly rising hCG, and the treatments. */
const WW = SC.W;
const L = { drivers: $("drivers"), anatomy: $("anatomy"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const trophP = pool(24, () => mk("circle", { class: "sc-p p-troph", r: 2.3 }, L.parts));
const dropP = pool(30, () => mk("path", { class: "p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const hcgP = pool(18, () => mk("circle", { class: "sc-p p-hcg", r: 2.2 }, L.parts));
const capP = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
/* driver nodes */
const NODES = {
  dmg: { x: 145, y: 102, w: 190, t: "Tubal damage", s: "infection or surgery", v: "wall", tip: "Past infection or surgery scars the fallopian tube and slows the egg on its way to the uterus, so implantation in the tube becomes more likely." },
  imp: { x: 365, y: 102, w: 190, t: "Implantation in tube", s: "most often ampulla", v: "inv", tip: "The fertilised egg implants outside the uterine cavity, most often in the ampulla, the wider outer part of the fallopian tube." },
  inv: { x: 585, y: 102, w: 200, t: "Trophoblast invasion", s: "into thin tube wall", v: "inv", tip: "Trophoblast, the outer layer of the early pregnancy, invades the thin tube wall and its blood vessels as it would invade the uterus." },
  rup: { x: 815, y: 102, w: 190, t: "Leak or rupture", s: "bleeding into abdomen", v: "bleed", tip: "The tube cannot stretch like the uterus. It leaks or ruptures, and blood collects in the abdomen (haemoperitoneum), causing pain and shock." },
};
const nodeEls = {};
Object.keys(NODES).forEach((k) => { const n = NODES[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.drivers);
  mk("rect", { class: "ect-node", x: n.x - n.w / 2, y: n.y - 22, width: n.w, height: 44, rx: 12 }, g);
  const t = mk("text", { class: "ect-node-t", x: n.x, y: n.y - 2, "text-anchor": "middle" }, g); t.textContent = n.t;
  const s = mk("text", { class: "ect-node-s", x: n.x, y: n.y + 13, "text-anchor": "middle" }, g); s.textContent = n.s; nodeEls[k] = g; });
[[240, 270], [460, 480], [685, 720]].forEach(([x1, x2]) => { mk("path", { class: "ect-arrow", d: "M" + x1 + " 102L" + x2 + " 102" }, L.drivers);
  mk("path", { class: "ect-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + x2 + " 102) rotate(0)" }, L.drivers); });
/* anatomy: uterus (empty), tubes, ovaries, ectopic mass in the right ampulla, blood pool */
const ana = L.anatomy;
mk("path", { class: "ect-tube", d: "M238 248C180 238 120 244 78 262" }, ana);
mk("path", { class: "ect-tube-in", d: "M238 248C180 238 120 244 78 262" }, ana);
mk("path", { class: "ect-tube", d: "M306 238C420 224 700 224 822 236" }, ana);
mk("path", { class: "ect-tube-in", d: "M306 238C420 224 700 224 822 236" }, ana);
const utG = mk("g", { class: "hot", tabindex: "0", "data-info": "The uterus is empty: no pregnancy has implanted in its cavity. An empty uterus with a positive pregnancy test points to implantation elsewhere." }, ana);
mk("ellipse", { class: "ect-ut", cx: 268, cy: 282, rx: 66, ry: 78 }, utG);
mk("ellipse", { class: "ect-cav", cx: 268, cy: 272, rx: 26, ry: 44 }, utG);
mk("rect", { class: "ect-ut", x: 254, y: 352, width: 28, height: 34, rx: 8 }, utG);
mk("ellipse", { class: "ect-ovary", cx: 62, cy: 272, rx: 22, ry: 32 }, ana);
mk("ellipse", { class: "ect-ovary", cx: 852, cy: 246, rx: 24, ry: 34 }, ana);
mk("circle", { class: "ect-sac", cx: 852, cy: 238, r: 7 }, ana);
const poolEl = mk("ellipse", { class: "ect-pool", cx: 660, cy: 414, rx: 250, ry: 20, opacity: 0 }, ana);
const massG = mk("g", { class: "hot", tabindex: "0", "data-info": "The ectopic mass in the ampulla of the tube: the early pregnancy growing where the tube cannot stretch to hold it." }, ana);
const massEl = mk("ellipse", { class: "ect-mass", cx: 580, cy: 232, rx: 34, ry: 27 }, massG);
mk("ellipse", { class: "ect-sac", cx: 574, cy: 228, rx: 13, ry: 10 }, massG);
mk("circle", { class: "ect-mass", cx: 592, cy: 240, r: 5 }, massG);
const cracks = [[548, 214, 534, 202], [560, 252, 548, 266], [606, 218, 620, 206], [610, 248, 624, 260]].map(([x1, y1, x2, y2]) => mk("path", { class: "ect-crack", d: "M" + x1 + " " + y1 + "L" + x2 + " " + y2, opacity: 0 }, ana));
const poolRbcs = [];
for (let i = 0; i < 8; i++) { const g = mk("g", { class: "cl cl-rbc" }, ana); mk("ellipse", { class: "cl-b", rx: 7, ry: 4.2 }, g); poolRbcs.push({ g, x: rnd(470, 850), y: 414, v: rnd(0.7, 1.2) }); }
/* treatment marks */
function xmark(x, y) { const g = mk("g", { opacity: 0 }, L.marks); mk("circle", { class: "ect-x", cx: x, cy: y, r: 9 }, g); mk("path", { class: "ect-xx", d: "M" + (x - 4) + " " + (y - 4) + "l8 8M" + (x + 4) + " " + (y - 4) + "l-8 8" }, g); return g; }
const markMtx = xmark(580, 232), markSurg = xmark(648, 230);
/* pills: labels above the tube at y 168, below the anatomy at y 396; checked against driver nodes (bottom 124), the tube (about y 215 to 255), the uterus (to y 386 at x 202 to 334), the blood pool (y 394 to 434) and each other */
pill(L.over, "Empty uterus", 268, 272, 140, 396, "The uterine cavity is empty. With a positive pregnancy test this means the pregnancy has implanted outside the uterus.");
pill(L.over, "Fallopian tube", 430, 230, 430, 168, "The fallopian tube carries the egg to the uterus. Damage from infection or surgery slows that journey.");
pill(L.over, "Ectopic mass", 580, 258, 580, 396, "The pregnancy implanted in the ampulla of the tube. It grows and invades the tube wall instead of the uterine lining.");
pill(L.over, "Tube wall", 648, 224, 706, 168, "The thin tube wall is invaded by trophoblast and weakened. Unlike the uterus it cannot stretch, so it leaks or ruptures.");
pill(L.over, "Ovary", 852, 246, 852, 168, "The ovary released the egg. Fertilisation happens in the tube; the egg should then travel to the uterus.");
pill(L.over, "Blood in abdomen", 700, 410, 792, 340, "Blood leaking or bursting from the tube collects in the peritoneal cavity (haemoperitoneum) and irritates the abdomen, causing pain and shock.");
/* gauges */
const gg = {};
{ const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["inv", "Growth", "g-bad", "Growth and invasion of the ectopic mass in the tube wall."], ["wall", "Wall", "g-wall", "Damage to the thin tube wall as trophoblast invades it."], ["bleed", "Bleeding", "g-bad", "Bleeding from the tube into the abdomen. Rupture makes this heavy."], ["pain", "Pain", "g-pain", "Abdominal pain from the stretching tube and blood irritating the abdomen, with a missed period and vaginal bleeding."], ["hcg", "hCG", "g-hcg", "hCG from the pregnancy. In an ectopic pregnancy it rises slowly or plateaus instead of rising briskly; successful treatment makes it fall."], ["shock", "Shock", "g-bad", "Shock from blood loss into the abdomen: fast pulse, low blood pressure and collapse in rupture."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); }); }
const sm = { inv: 0.3, bleed: 0.05, wall: 0.2, pain: 0.2, shock: 0.05, hcg: 0.4, mtx: 0, surg: 0, exp: 0 };
const acc = { troph: 0, drop: 0, hcg: 0, cap: 0 };
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9), k2 = Math.min(1, dt * 0.5);
  ["inv", "bleed", "wall", "pain", "shock", "hcg", "mtx", "surg", "exp"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  const act = { dmg: sm.wall, imp: sm.inv, inv: sm.inv, rup: sm.bleed };
  Object.keys(NODES).forEach((id) => { nodeEls[id].style.filter = "drop-shadow(0 0 " + (act[id] * 7).toFixed(1) + "px var(--c-bad))"; });
  /* mass grows with invasion and shrinks as treatment works; tube wall cracks appear */
  const ms = 0.55 + 0.65 * sm.inv;
  massG.setAttribute("transform", "translate(" + f1(580 - 580 * ms) + " " + f1(232 - 232 * ms) + ") scale(" + ms.toFixed(3) + ")");
  massEl.style.filter = "drop-shadow(0 0 " + (sm.inv * 8).toFixed(1) + "px var(--c-bad))";
  cracks.forEach((c) => c.setAttribute("opacity", clamp(sm.wall * 1.2 - 0.25).toFixed(2)));
  /* trophoblast particles burrow from the mass into the wall */
  acc.troph += dt * sm.inv * 7; while (acc.troph >= 1) { acc.troph--; const p = free(trophP); if (p) { const an = rnd(0, 6.28); emit(p, 580 + Math.cos(an) * 16, 232 + Math.sin(an) * 12, Math.cos(an) * rnd(14, 26), Math.sin(an) * rnd(14, 26), 0); } }
  trophP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 520, 640); p.y = clamp(p.y, 196, 272); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.6) kill(p); });
  /* hCG particles drift slowly upward from the mass */
  acc.hcg += dt * sm.hcg * 6; while (acc.hcg >= 1) { acc.hcg--; const p = free(hcgP); if (p) emit(p, 580 + rnd(-18, 18), 214, rnd(-6, 6), -rnd(16, 26), 0); }
  hcgP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 500, 660); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 3).toFixed(2)); if (p.t > 3 || p.y < 136) kill(p); });
  /* blood drops leak or pour from the tube and pool in the abdomen */
  acc.drop += dt * sm.bleed * 11; while (acc.drop >= 1) { acc.drop--; const p = free(dropP); if (p) emit(p, 616 + rnd(-8, 10), 252, rnd(-4, 8), rnd(10, 22), 0); }
  dropP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 26 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 408) kill(p); });
  poolEl.setAttribute("opacity", (sm.bleed * 0.9).toFixed(2));
  poolEl.setAttribute("rx", f1(90 + 170 * sm.bleed));
  poolRbcs.forEach((r, i) => { r.x += r.v * 9 * sm.bleed * dt; if (r.x > 880) r.x = 450; place(r.g, r.x, 414 + Math.sin(tm / 700 + i) * 3, 0, sm.bleed > 0.06 ? 1 : 0.01); r.g.style.opacity = sm.bleed.toFixed(2); });
  /* methotrexate capsules travel to the mass */
  acc.cap += dt * sm.mtx * 2.6; while (acc.cap >= 1) { acc.cap--; const p = free(capP); if (p) emit(p, rnd(30, 90), 246, 0, 0, 0); }
  capP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (580 - p.x) * dt * 0.55 + 20 * dt; p.y += (232 - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  markMtx.setAttribute("opacity", (sm.mtx * (1 - sm.surg)).toFixed(2));
  markSurg.setAttribute("opacity", sm.surg.toFixed(2));
  /* gauges */
  gg.inv.set(sm.inv, wordOf(sm.inv, 0.28, 0.6, ["resolving", "growing", "invading"])); gg.wall.set(sm.wall, wordOf(sm.wall, 0.3, 0.6, ["intact", "invaded", "rupturing"]));
  gg.bleed.set(sm.bleed, wordOf(sm.bleed, 0.18, 0.55, ["none", "leaking", "heavy"])); gg.pain.set(sm.pain, wordOf(sm.pain, 0.3, 0.6, ["mild", "present", "severe"]));
  gg.hcg.set(sm.hcg, wordOf(sm.hcg, 0.25, 0.5, ["falling", "slow rise", "rising"])); gg.shock.set(sm.shock, wordOf(sm.shock, 0.22, 0.5, ["absent", "threatened", "present"]));
}
run({ init, step });
