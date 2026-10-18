/* PID scene: ascending organisms, inflammation, abscess, adhesions, perihepatitis and gauges. */
const layers = { links: $("links"), nodes: $("nodes"), parts: $("parts"), over: $("over"), panel: $("panel"), abscess: $("abscessG"), adhes: $("adhesions"), liver: $("liverStrings"), infC: $("infC"), infU: $("infU"), infT: $("infT"), infO: $("infO"), drainL: $("drainLine"), drainB: $("drainBag"), partnerG: $("partnerG") };
/* abscess blob over the right tube and ovary, and small ova in both ovaries */
mk("ellipse", { class: "pid-abs", cx: 0, cy: 0, rx: 42, ry: 32 }, layers.abscess);
mk("ellipse", { class: "pid-absIn", cx: -8, cy: -6, rx: 24, ry: 17 }, layers.abscess);
mk("ellipse", { class: "pid-absIn", cx: 16, cy: 10, rx: 15, ry: 11 }, layers.abscess);
const ovumL = cell(layers.nodes, { cls: "ovum", r: 13, nuc: 0.4, seed: 4, wob: 0.1, x: 165, y: 190 });
const ovumR = cell(layers.nodes, { cls: "ovum", r: 13, nuc: 0.4, seed: 9, wob: 0.1, x: 695, y: 190 });
/* ascent tracks: vagina, cervix, womb, then out along each tube */
const trkL = track([[430, 420], [430, 348], [430, 268], [430, 200], [352, 182], [252, 182], [196, 188]]);
const trkR = track([[430, 420], [430, 348], [430, 268], [430, 200], [508, 182], [608, 182], [664, 188]]);
const trks = [trkL, trkR];
/* neutrophils that crawl toward the tubes */
const neus = Array.from({ length: 5 }, function (_, i) { return { g: cell(layers.parts, { cls: "neut", r: 10, nuc: 0.55, nucCls: "multi", seed: i + 30, wob: 0.14 }), x: 430, y: 410, tx: 300 + i * 60, ty: 190, ph: i * 1.7 }; });
/* ---- particle pools (items expose their element as p.e) ---- */
function pool(n, build) { return Array.from({ length: n }, function () { const e = build(); e.setAttribute("opacity", "0"); return { e: e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const orgP = pool(34, function () { return mk("circle", { class: "sc-p p-org", r: 3.2 }, layers.parts); });
const org2P = pool(18, function () { return mk("path", { class: "sc-p p-org2", d: "M0 -3.2L3 0L0 3.2L-3 0Z" }, layers.parts); });
const abxP = pool(12, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "p-pill2", x: 0, y: -2.4, width: 5, height: 4.8, rx: 2 }, g); return g; });
const drP = pool(12, function () { return mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts); });
const ptP = pool(8, function () { const g = mk("g", {}, layers.parts); mk("rect", { class: "p-pill", x: -5, y: -2.4, width: 10, height: 4.8, rx: 2.4 }, g); return g; });
const freeP = function (pl) { return pl.find(function (p) { return !p.on; }); };
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
/* ---- labels and gauges ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 52, xs = [100, 240, 380, 520, 660, 800];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: SC.W - 48, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P); t.textContent = "The person";
  [["inf", "Infection", "g-bac", "Chlamydia and gonorrhoea at the cervix ascending to the tubes and ovaries. Antibiotics bring this down."], ["infl", "Inflammation", "g-inf2", "Inflamed cervix, womb lining, tubes and ovaries. This is what causes pain and fever and drives scarring."], ["abs", "Abscess", "g-abs2", "Tubo-ovarian abscess: a walled off collection beside the tube and ovary. Drainage helps when it is present."], ["dam", "Tubal damage", "g-dam", "Scarring and adhesions narrow or block the tube. Damage already done does not fully reverse."], ["ect", "Ectopic risk", "g-ect", "A damaged tube raises the chance that a later pregnancy implants in the tube instead of the womb."], ["peri", "Liver capsule", "g-peri", "Fitz-Hugh-Curtis perihepatitis: infection reaching the liver capsule, with string like adhesions and right upper abdominal pain."]]
    .forEach(function (row, i) { gg[row[0]] = gauge(P, xs[i] + 30, y0 + 2, h, 18, row[2], row[1], row[3]); });
  const ox = layers.over;
  pill(ox, "Ovary", 165, 152, 165, 100, "Ovary: reached when infection spreads from the tube. With the tube it can form a tubo-ovarian abscess.");
  pill(ox, "Fallopian tube", 300, 168, 300, 100, "Fallopian tube: salpingitis is inflammation of the tube. Scarring here causes infertility and ectopic pregnancy risk.");
  pill(ox, "Uterus", 430, 148, 430, 100, "Uterus: organisms pass through the endometrium (womb lining) on the way from cervix to tubes.");
  pill(ox, "Abscess", 695, 150, 695, 112, "Tubo-ovarian abscess: a collection of pus involving tube and ovary. It may need drainage as well as antibiotics.");
  pill(ox, "Liver capsule", 850, 144, 850, 162, "Liver capsule: Fitz-Hugh-Curtis perihepatitis. Infection spreads to the capsule, leaving violin string adhesions to the diaphragm.");
  pill(ox, "Cervix", 462, 336, 565, 330, "Cervix: chlamydia and gonorrhoea infect the cervix first (cervicitis), often silently, then ascend.");
  pill(ox, "Partner", 98, 332, 110, 300, "Partner: treating partners and testing for reinfection helps prevent the infection coming back.");
  pill(ox, "Vagina", 414, 398, 300, 415, "Vagina and lower genital tract: the route by which sexually transmitted organisms reach the cervix.");
  pill(ox, "Adhesions", 622, 272, 580, 400, "Adhesions: scar bands between tube, ovary and pelvic wall after inflammation. They distort anatomy and impair fertility.");
}
const sm = { B: 0.4, I: 0.4, Abs: 0.1, D: 0.3, Ect: 0.3, Peri: 0.1, abx: 0, drain: 0, partner: 0, reach: 0.78 };
const acc = { org: 0, org2: 0, abx: 0, dr: 0, pt: 0 };
function init() { initPanel(); }
function step(dt, m) {
  const k = Math.min(1, dt * 0.7);
  sm.B = lerp(sm.B, m.B, k); sm.I = lerp(sm.I, m.I, k); sm.Abs = lerp(sm.Abs, m.Abs, k); sm.D = lerp(sm.D, m.D, k); sm.Ect = lerp(sm.Ect, m.Ect, k); sm.Peri = lerp(sm.Peri, m.Peri, k);
  sm.abx = lerp(sm.abx, m.abx, k); sm.drain = lerp(sm.drain, m.drain, k); sm.partner = lerp(sm.partner, m.partner, k); sm.reach = lerp(sm.reach, m.reach, k);
  /* inflammation overlays, abscess, adhesions, perihepatitis */
  layers.infC.setAttribute("opacity", (sm.I * 0.5).toFixed(2));
  layers.infU.setAttribute("opacity", (sm.I * (sm.reach > 0.35 ? 0.3 : 0.08)).toFixed(2));
  layers.infT.setAttribute("opacity", (sm.I * (sm.reach > 0.35 ? 0.5 : 0)).toFixed(2));
  layers.infO.setAttribute("opacity", (sm.I * (sm.reach > 0.8 ? 0.4 : 0)).toFixed(2));
  place(layers.abscess, 695, 190, 0, Math.max(0.12, 0.2 + 0.95 * sm.Abs));
  layers.abscess.setAttribute("opacity", sm.Abs > 0.03 ? "1" : "0");
  layers.adhes.setAttribute("opacity", (sm.D * 0.95).toFixed(2));
  layers.liver.setAttribute("opacity", (sm.Peri).toFixed(2));
  layers.drainL.setAttribute("opacity", sm.drain.toFixed(2)); layers.drainB.setAttribute("opacity", sm.drain.toFixed(2));
  layers.partnerG.setAttribute("opacity", (0.45 + 0.55 * sm.partner).toFixed(2));
  place(ovumL, 165, 190, 0, 1 - 0.35 * sm.D); place(ovumR, 695, 190, 0, 1 - 0.35 * sm.D);
  /* ascending organisms along the tracks */
  acc.org += dt * sm.B * 9; while (acc.org >= 1) { acc.org--; const p = freeP(orgP); if (p) emit(p, 430, 420, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  acc.org2 += dt * sm.B * 5; while (acc.org2 >= 1) { acc.org2--; const p = freeP(org2P); if (p) emit(p, 430, 420, 0, 0, Math.random() < 0.5 ? 0 : 1); }
  [orgP, org2P].forEach(function (pl) { pl.forEach(function (p) { if (!p.on) return; p.u += dt * 0.14 * (0.4 + sm.B); if (p.u >= sm.reach) { kill(p); return; } const pt = trks[p.k].at(p.u); p.x = pt.x + Math.sin(tm / 300 + p.k * 4 + p.u * 20) * 3; p.y = pt.y; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 6) + ")"); }); });
  /* neutrophils crawl from the lower pelvis toward the tubes */
  neus.forEach(function (n, i) { const act = sm.I > 0.18 && i < Math.round(sm.I * neus.length); n.x = lerp(n.x, act ? n.tx : 430 + (i - 2) * 22, Math.min(1, dt * 0.35)); n.y = lerp(n.y, act ? n.ty + Math.sin(tm / 500 + n.ph) * 6 : 408, Math.min(1, dt * 0.35)); n.g.style.opacity = act || sm.I > 0.1 ? 1 : 0.25; place(n.g, n.x, n.y, Math.sin(tm / 400 + n.ph) * 10, 1); });
  /* antibiotics drift in from the left toward the womb and tubes */
  acc.abx += dt * sm.abx * 3; while (acc.abx >= 1) { acc.abx--; const p = freeP(abxP); if (p) emit(p, 40, rnd(230, 330), 0, 0, 0); }
  abxP.forEach(function (p) { if (!p.on) return; p.t += dt; const dx = 430 - p.x, dy = 240 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 78 * dt; p.y += (dy / d) * 78 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 90) + ")"); if (d < 18 || p.t > 6) kill(p); });
  /* drainage drops leave the abscess for the bag */
  acc.dr += dt * sm.drain * sm.Abs * 7 + dt * sm.drain * 1.2; while (acc.dr >= 1) { acc.dr--; const p = freeP(drP); if (p) emit(p, 716, 214, 0, 0, 0); }
  drP.forEach(function (p) { if (!p.on) return; p.t += dt; p.x = lerp(p.x, 862, Math.min(1, dt * 1.1)); p.y = lerp(p.y, 306, Math.min(1, dt * 1.1)); p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.t > 3.2) kill(p); });
  /* partner treatment pills reach the partner figure */
  acc.pt += dt * sm.partner * 2.4; while (acc.pt >= 1) { acc.pt--; const p = freeP(ptP); if (p) emit(p, 430, 410, 0, 0, 0); }
  ptP.forEach(function (p) { if (!p.on) return; p.t += dt; const dx = 108 - p.x, dy = 372 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 82 * dt; p.y += (dy / d) * 82 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 80) + ")"); if (d < 16 || p.t > 6) kill(p); });
  gg.inf.set(sm.B, wordOf(sm.B, 0.2, 0.5, ["controlled", "present", "spreading"])); gg.infl.set(sm.I, wordOf(sm.I, 0.3, 0.6, ["mild", "moderate", "marked"])); gg.abs.set(sm.Abs, wordOf(sm.Abs, 0.18, 0.45, ["none", "forming", "large"]));
  gg.dam.set(sm.D, wordOf(sm.D, 0.28, 0.55, ["little", "some", "marked"])); gg.ect.set(sm.Ect, wordOf(sm.Ect, 0.28, 0.55, ["low", "raised", "high"])); gg.peri.set(sm.Peri, wordOf(sm.Peri, 0.25, 0.5, ["none", "mild", "marked"]));
}
run({ init: init, step: step });
