/* Endometriosis scene: retrograde flow, implants, cyclical bleeding, inflammation, adhesions, chocolate cyst, pain, subfertility and treatments. */
const WW = SC.W;
const L = { drivers: $("drivers"), anatomy: $("anatomy"), parts: $("parts"), marks: $("marks"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const cellP = pool(22, () => mk("circle", { class: "sc-p p-cell", r: 2.4 }, L.parts));
const medP = pool(26, () => mk("circle", { class: "sc-p p-med", r: 2.1 }, L.parts));
const dropP = pool(26, () => mk("path", { class: "p-drop", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, L.parts));
const capP = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
const hormP = pool(10, () => { const g = mk("g", {}, L.parts); mk("rect", { class: "p-pill", x: -4, y: -2, width: 8, height: 4, rx: 2 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2, width: 4, height: 4, rx: 2 }, g); return g; });
/* driver nodes: y 80 to 124, checked clear of the zone title (y 68) and the pills below (y 160) */
const NODES = {
  retro: { x: 140, y: 102, w: 175, t: "Retrograde flow", s: "back through the tubes", v: "impl", tip: "Retrograde menstruation: menstrual tissue passes back through the fallopian tubes into the pelvis. It is one route in, not the whole explanation." },
  imp: { x: 368, y: 102, w: 185, t: "Implantation", s: "outside the uterus", v: "impl", tip: "Endometrial-like tissue implants on the peritoneum, ovaries and tissues behind the uterus and grows there." },
  bleed: { x: 593, y: 102, w: 180, t: "Cyclical bleeding", s: "with each cycle", v: "infl", tip: "The implants respond to the hormonal cycle and bleed where they sit. Blood cannot escape, so it irritates the tissues around it." },
  scar: { x: 818, y: 102, w: 190, t: "Scarring", s: "adhesions form", v: "adh", tip: "Repeated bleeding and inflammation cause scarring. Adhesions stick organs together and can distort the tubes and ovaries, reducing fertility." },
};
const nodeEls = {};
Object.keys(NODES).forEach((k) => { const n = NODES[k], g = mk("g", { class: "hot", tabindex: "0", "data-info": n.tip }, L.drivers);
  mk("rect", { class: "end-node", x: n.x - n.w / 2, y: n.y - 22, width: n.w, height: 44, rx: 12 }, g);
  const t = mk("text", { class: "end-node-t", x: n.x, y: n.y - 2, "text-anchor": "middle" }, g); t.textContent = n.t;
  const s = mk("text", { class: "end-node-s", x: n.x, y: n.y + 13, "text-anchor": "middle" }, g); s.textContent = n.s; nodeEls[k] = g; });
[[232, 270], [465, 498], [688, 718]].forEach(([x1, x2]) => { mk("path", { class: "end-arrow", d: "M" + x1 + " 102L" + x2 + " 102" }, L.drivers);
  mk("path", { class: "end-head", d: "M0 0L-8 -4.5L-8 4.5Z", transform: "translate(" + x2 + " 102) rotate(0)" }, L.drivers); });
/* anatomy: peritoneum outline, uterus centre, tubes to ovaries at each side */
const ana = L.anatomy;
mk("rect", { class: "end-peri", x: 52, y: 150, width: 856, height: 282, rx: 26 }, ana);
mk("path", { class: "end-tube", d: "M412 238C345 214 262 208 198 226" }, ana);
mk("path", { class: "end-tube-in", d: "M412 238C345 214 262 208 198 226" }, ana);
mk("path", { class: "end-tube", d: "M548 238C615 214 698 208 762 226" }, ana);
mk("path", { class: "end-tube-in", d: "M548 238C615 214 698 208 762 226" }, ana);
const utG = mk("g", { class: "hot", tabindex: "0", "data-info": "The uterus. Its lining, the endometrium, is the tissue that implants copy when they grow outside it." }, ana);
mk("ellipse", { class: "end-ut", cx: 480, cy: 296, rx: 72, ry: 86 }, utG);
const liningEl = mk("ellipse", { class: "end-lining", cx: 480, cy: 286, rx: 30, ry: 48 }, utG);
mk("ellipse", { class: "end-cav", cx: 480, cy: 286, rx: 16, ry: 32 }, utG);
mk("rect", { class: "end-ut", x: 467, y: 374, width: 26, height: 34, rx: 8 }, utG);
const ovLG = mk("g", { class: "hot", tabindex: "0", "data-info": "The left ovary. Implants on its surface and adhesions around it can reduce fertility." }, ana);
mk("ellipse", { class: "end-ovary", cx: 175, cy: 242, rx: 27, ry: 37 }, ovLG);
[[164, 226], [186, 252], [170, 262]].forEach(([x, y]) => mk("circle", { class: "end-foll", cx: x, cy: y, r: 6 }, ovLG));
const ovRG = mk("g", { class: "hot", tabindex: "0", "data-info": "The right ovary, here holding an endometrioma: a cyst of old blood from repeated bleeding of implants inside the ovary." }, ana);
mk("ellipse", { class: "end-ovary", cx: 785, cy: 242, rx: 27, ry: 37 }, ovRG);
mk("circle", { class: "end-foll", cx: 772, cy: 218, r: 5 }, ovRG);
const cystG = mk("g", {}, ovRG);
const cystEl = mk("circle", { class: "end-cyst", cx: 785, cy: 246, r: 19 }, cystG);
mk("circle", { class: "end-cyst-in", cx: 785, cy: 246, r: 11 }, cystG);
/* implants: clusters of small spots on the peritoneum, clear of uterus (x 408 to 552), tubes and pills */
const IMP = [[235, 318], [298, 356], [340, 388], [622, 332], [682, 362], [736, 306], [592, 392], [418, 182]];
const impEls = IMP.map(([x, y], i) => { const g = mk("g", { class: "hot", tabindex: "0", "data-info": "An implant of endometrial-like tissue outside the uterus. It cycles, bleeds in place and inflames the tissue around it." }, ana);
  [[0, 0, 7], [-9, 5, 4.5], [8, 6, 5]].forEach(([dx, dy, r]) => mk("circle", { class: "end-implant", cx: dx, cy: dy, r: r }, g)); return { g, x, y, i }; });
/* adhesions: pale bands sticking ovary to uterus and uterus to peritoneum */
const adhEls = [
  mk("path", { class: "end-adh", d: "M200 262C270 292 350 292 412 282" }, ana),
  mk("path", { class: "end-adh", d: "M760 262C700 292 620 292 550 282" }, ana),
  mk("path", { class: "end-adh", d: "M480 382C460 402 420 410 378 404" }, ana),
  mk("path", { class: "end-adh", d: "M636 348C622 372 606 386 566 384" }, ana),
];
function xmark(x, y) { const g = mk("g", { opacity: 0 }, L.marks); mk("circle", { class: "end-x", cx: x, cy: y, r: 9 }, g); mk("path", { class: "end-xx", d: "M" + (x - 4) + " " + (y - 4) + "l8 8M" + (x + 4) + " " + (y - 4) + "l-8 8" }, g); return g; }
const markCyst = xmark(785, 246), markImp = xmark(622, 332);
/* pills: top row y 168 (rect 160 to 177) above tubes (top about 200); bottom row y 410 (rect 402 to 419) below uterus (bottom 408 at cervix x 467 to 493 only) and above stage bottom 440.
   Top x spans: Ovary 152-198, Tube 569-671, Cyst 737-833. Bottom: Adhesions 205-275, Uterus 316-364, Implants 608-672. No two overlap; none covers a shape centre. */
pill(L.over, "Ovary", 175, 242, 175, 168, "The ovary. Implants on or in it, and adhesions around it, can reduce fertility. An implant cyst inside it is an endometrioma.");
pill(L.over, "Fallopian tube", 628, 216, 620, 168, "The fallopian tube. Menstrual tissue can pass back through it into the pelvis, and adhesions can later distort it.");
pill(L.over, "Endometrioma", 785, 246, 785, 168, "An endometrioma, often called a chocolate cyst: a cyst in the ovary filled with old blood from implants bleeding there again and again.");
pill(L.over, "Adhesions", 300, 288, 240, 410, "Adhesions: bands of scar tissue from repeated inflammation. They stick organs together and can distort the tubes and ovaries.");
pill(L.over, "Uterus", 448, 330, 340, 410, "The uterus. Its lining is shed each cycle; in endometriosis, similar tissue also grows outside it and bleeds there.");
pill(L.over, "Implants", 622, 332, 640, 410, "Implants of endometrial-like tissue on the peritoneum. They bleed with each cycle, causing pain including dysmenorrhoea and dyspareunia.");
/* gauges */
const gg = {};
{ const P = L.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The patient";
  [["impl", "Implants", "g-bad", "How much endometrial-like tissue is growing outside the uterus."], ["infl", "Inflammation", "g-infl", "Inflammation around implants as they bleed with each cycle."], ["adh", "Adhesions", "g-adh", "Scar bands sticking organs together after repeated bleeding and inflammation."], ["cyst", "Cyst", "g-cyst", "An endometrioma in the ovary, a cyst of old blood from repeated bleeding."], ["pain", "Pain", "g-pain", "Pain: dysmenorrhoea, dyspareunia and chronic pelvic pain. Analgesia lowers this without changing the implants."], ["fert", "Subfertility", "g-fert", "Reduced fertility from adhesions distorting the tubes and ovaries, cysts and inflammation. Higher means more reduced."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h, 18, cls, name, tip); }); }
const sm = { impl: 0.4, infl: 0.3, adh: 0.2, cyst: 0.2, pain: 0.3, fert: 0.2, analg: 0, horm: 0, surg: 0 };
const acc = { cell: 0, med: 0, drop: 0, cap: 0, horm: 0 };
function init() {}
function step(dt, m) {
  const k1 = Math.min(1, dt * 0.9);
  ["impl", "infl", "adh", "cyst", "pain", "fert", "analg", "horm", "surg"].forEach((q) => { sm[q] = lerp(sm[q], m[q], k1); });
  const act = { retro: sm.impl, imp: sm.impl, bleed: sm.infl, scar: sm.adh };
  Object.keys(NODES).forEach((id) => { nodeEls[id].style.filter = "drop-shadow(0 0 " + (act[NODES[id].v] * 7).toFixed(1) + "px var(--c-bad))"; });
  /* uterus lining pulses with the cycle unless suppressed */
  const cyc = 1 + 0.08 * Math.sin(tm / 700) * (1 - sm.horm);
  liningEl.setAttribute("transform", "translate(" + f1(480 - 480 * cyc) + " " + f1(286 - 286 * cyc) + ") scale(" + cyc.toFixed(3) + ")");
  /* implants grow, pulse and fade with burden */
  impEls.forEach((e, i) => { const s = clamp((sm.impl - 0.06 * i) * 1.5) * (1 + 0.07 * Math.sin(tm / 600 + i * 1.7) * (1 - sm.horm)); place(e.g, e.x, e.y, 0, 0.15 + 0.85 * s); e.g.style.opacity = s > 0.04 ? 1 : 0; });
  adhEls.forEach((e) => e.setAttribute("opacity", (sm.adh * 0.85).toFixed(2)));
  const cs = clamp(sm.cyst * 1.6);
  cystG.setAttribute("transform", "translate(" + f1(785 - 785 * cs) + " " + f1(246 - 246 * cs) + ") scale(" + cs.toFixed(3) + ")");
  cystG.style.opacity = cs > 0.04 ? 1 : 0;
  /* endometrial cells drift back out of the tube ends toward implant sites */
  acc.cell += dt * sm.impl * 5; while (acc.cell >= 1) { acc.cell--; const p = free(cellP); if (p) { const left = Math.random() < 0.5; emit(p, left ? 198 : 762, 226, left ? -rnd(8, 18) : rnd(8, 18), rnd(14, 24), left ? 0 : 1); } }
  cellP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 60, 900); p.y = clamp(p.y, 150, 425); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  /* inflammatory mediators rise from implants */
  acc.med += dt * sm.infl * 9; while (acc.med >= 1) { acc.med--; const p = free(medP); if (p) { const s = pick(IMP); emit(p, s[0] + rnd(-8, 8), s[1] - 4, rnd(-5, 5), -rnd(14, 24), 0); } }
  medP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.x = clamp(p.x, 60, 900); p.y = clamp(p.y, 150, 425); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.4).toFixed(2)); if (p.t > 2.4) kill(p); });
  /* cyclical bleeding: drops fall a short way from implants */
  acc.drop += dt * sm.infl * 8; while (acc.drop >= 1) { acc.drop--; const p = free(dropP); if (p) { const s = pick(IMP); emit(p, s[0] + rnd(-7, 7), s[1] + 7, rnd(-3, 3), rnd(12, 20), 0); } }
  dropP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.y = clamp(p.y, 150, 425); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 1.8) kill(p); });
  /* analgesia capsules travel toward the uterus */
  acc.cap += dt * sm.analg * 2.6; while (acc.cap >= 1) { acc.cap--; const p = free(capP); if (p) emit(p, rnd(30, 90), 300, 0, 0, 0); }
  capP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (480 - p.x) * dt * 0.55 + 20 * dt; p.y += (296 - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  /* hormonal capsules travel toward the ovaries and uterus */
  acc.horm += dt * sm.horm * 2.6; while (acc.horm >= 1) { acc.horm--; const p = free(hormP); if (p) emit(p, rnd(860, 920), 300, 0, 0, 0); }
  hormP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += (620 - p.x) * dt * 0.55 - 20 * dt; p.y += (280 - p.y) * dt * 0.7; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(-p.t * 90) + ")"); p.e.setAttribute("opacity", clamp(1 - (p.t - 4) / 1.5).toFixed(2)); if (p.t > 5.5) kill(p); });
  markCyst.setAttribute("opacity", (sm.surg * clamp(sm.cyst + 0.4)).toFixed(2));
  markImp.setAttribute("opacity", sm.surg.toFixed(2));
  gg.impl.set(sm.impl, wordOf(sm.impl, 0.3, 0.62, ["few", "scattered", "extensive"])); gg.infl.set(sm.infl, wordOf(sm.infl, 0.3, 0.6, ["quiet", "active", "severe"]));
  gg.adh.set(sm.adh, wordOf(sm.adh, 0.3, 0.6, ["none", "some", "dense"])); gg.cyst.set(sm.cyst, wordOf(sm.cyst, 0.22, 0.5, ["absent", "present", "large"]));
  gg.pain.set(sm.pain, wordOf(sm.pain, 0.28, 0.58, ["mild", "present", "severe"])); gg.fert.set(sm.fert, wordOf(sm.fert, 0.3, 0.6, ["preserved", "reduced", "markedly reduced"]));
}
run({ init, step });
