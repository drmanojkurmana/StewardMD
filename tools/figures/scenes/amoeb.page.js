/* Intestinal protozoa scene: amoebic colitis, amoebic liver abscess and giardiasis on one stage. */
const LY = { stage: $("stage"), over: $("over"), panel: $("panel") };
const WW = SC.W;
function mkPool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, u: 0 }; }); }
const freeP = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.u = 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const dotP = (parent, cls, r) => mk("circle", { class: "sc-p " + cls, r: r || 2.4 }, parent);
const types = [], marks = [], labels = [];
function addLabel(ty, text, x, y, tx, ty2, tip) { const g = pill(LY.over, text, x, y, tx, ty2, tip); labels.push({ g, ty }); return g; }
function addMark(ty, drugs, x, y, text, tx, tyy, tip, good) {
  const g = mk("g", {}, LY.over);
  if (good) { mk("path", { class: "mk-g", d: "M" + f1(x - 6) + " " + f1(y) + "l4 5l8 -10" }, g); } else { mk("circle", { class: "mk-c", cx: f1(x), cy: f1(y), r: 8 }, g); mk("path", { class: "mk-x", d: "M" + f1(x - 4) + " " + f1(y - 4) + "l8 8M" + f1(x + 4) + " " + f1(y - 4) + "l-8 8" }, g); }
  pill(g, text, x, y, tx, tyy, tip); marks.push({ g, ty, drugs }); return g;
}
function cystAt(parent, s) { const g = mk("g", {}, parent); mk("ellipse", { class: "am-cyst", rx: 10 * s, ry: 7 * s }, g); mk("circle", { class: "am-cystn", cx: -3 * s, cy: -1, r: 1.7 * s }, g); mk("circle", { class: "am-cystn", cx: 3 * s, cy: 1.5 * s, r: 1.7 * s }, g); return g; }
function beaker(parent, stoolCls) {
  mk("path", { class: "am-beaker", d: "M788 326h94l-10 74h-74z" }, parent);
  const st = mk("rect", { class: stoolCls, x: 796, y: 390, width: 78, height: 8, rx: 3 }, parent);
  return st;
}

/* ================= AMOEBIC COLITIS ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  mk("rect", { class: "am-lumen", x: 34, y: 146, width: 892, height: 78, rx: 10 }, g);
  mk("rect", { class: "am-tis2", x: 34, y: 238, width: 892, height: 184, rx: 10 }, g);
  mk("rect", { class: "am-epi", x: 34, y: 224, width: 892, height: 14, rx: 6 }, g);
  mk("path", { class: "am-ulcer", d: "M462 224h36l18 40c36 16 44 58 22 90c-20 30-96 30-116 0c-22-32-14-74 22-90z" }, g);
  mk("rect", { class: "am-vessel", x: 34, y: 388, width: 892, height: 24, rx: 12 }, g);
  const stoolRect = beaker(g, "am-stool");
  const cysts = Array.from({ length: 6 }, (_, i) => ({ e: cystAt(g, 1), x: 70 + i * 130, y: 178 + (i % 2) * 22, ph: i * 1.3 }));
  const trophs = Array.from({ length: 5 }, (_, i) => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 13, nuc: 0.38, seed: 11 + i, wob: 0.22 }); return { e, x: 150 + i * 150, y: 200, ph: i * 1.7 }; });
  const macs = [[380, 320], [590, 330], [680, 300]].map(([x, y], i) => { const e = mk("g", {}, g); cell(e, { cls: "mac", r: 16, nuc: 0.4, seed: 21 + i, wob: 0.13 }); place(e, x, y); return { e, x, y, ph: i * 2 }; });
  const blood = mkPool(18, () => dotP(g, "p-blood", 2.6));
  const stoolP = mkPool(20, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, g));
  let accB = 0, accS = 0;
  types.push({ g, upd(dt, m) {
    cysts.forEach((c, i) => { c.x += dt * 14 * (0.4 + m.Par); if (c.x > 905) c.x = 55; place(c.e, c.x, c.y + Math.sin(tm / 700 + c.ph) * 3, Math.sin(tm / 900 + c.ph) * 14, 0.6 + 0.4 * m.Par); c.e.style.opacity = (0.35 + 0.65 * m.Par).toFixed(2); });
    trophs.forEach((tr, i) => { const dive = 0.5 + 0.5 * Math.sin(tm / 2400 + tr.ph); const tx = tr.x + Math.sin(tm / 1100 + tr.ph) * 18, ty = 202 + dive * (i === 2 ? 62 : 18); place(tr.e, tx, ty, Math.sin(tm / 500 + tr.ph) * 18, 0.55 + 0.45 * m.Par); tr.e.style.opacity = (0.25 + 0.75 * m.Par).toFixed(2); });
    macs.forEach((mc) => place(mc.e, mc.x + Math.sin(tm / 1200 + mc.ph) * 4, mc.y + Math.cos(tm / 1400 + mc.ph) * 3, 0, 0.6 + 0.4 * m.Inj));
    accB += dt * m.Inj * 7; while (accB >= 1) { accB--; const p = freeP(blood); if (p) emit(p, 480 + rnd(-18, 18), 250 + rnd(0, 60), rnd(-8, 8), rnd(-16, -8), 0); }
    blood.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y < 232) kill(p); });
    accS += dt * m.Gut * 9; while (accS >= 1) { accS--; const p = freeP(stoolP); if (p) emit(p, rnd(70, 300), rnd(162, 206), rnd(50, 72), 0, 0); }
    stoolP.forEach((p) => { if (!p.on) return; if (p.x < 832) { p.x += p.vx * dt; p.y = clamp(p.y, 156, 214); } else { p.x = 833; p.y += 78 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.style.fill = "var(--c-bad)"; if (p.y > 386) kill(p); });
    const sh = 5 + m.Gut * 18; stoolRect.setAttribute("y", f1(394 - sh)); stoolRect.setAttribute("height", f1(sh));
  } });
  addLabel(0, "Cysts swallowed", 90, 182, 115, 148, "Mature cysts of Entamoeba histolytica are swallowed in food or water contaminated with feces. They survive the stomach and excyst in the small bowel.");
  addLabel(0, "Trophozoite", 300, 202, 305, 148, "The active feeding form. In the colon it attaches to the lining, digests cells and can invade. In the lumen alone it may cause no symptoms.");
  addLabel(0, "Flask ulcer", 480, 300, 485, 148, "Flask shaped ulcer: a narrow opening at the surface with a wide undermined base in the layer below, made as trophozoites spread sideways under the lining.");
  addLabel(0, "Colon wall", 660, 231, 665, 148, "Colon wall: invasion and inflammation here give pain and frequent small bloody stools. Deep invasion can rarely perforate the wall.");
  addLabel(0, "Bloody stool", 833, 340, 835, 410, "Bloody, mucoid stool of amoebic dysentery: blood and mucus from the ulcerated colon, passed often in small amounts.");
  addMark(0, [1, 3], 480, 332, "Tissue form killed", 220, 408, "Metronidazole kills trophozoites invading the colon wall. It is the tissue agent in amoebiasis.", true);
  addMark(0, [2, 3], 180, 182, "Lumen cleared", 505, 408, "A luminal agent clears trophozoites and cysts left in the bowel lumen after tissue treatment, reducing relapse and spread to others.");
})();

/* ================= LIVER ABSCESS ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  mk("rect", { class: "am-gutbox", x: 34, y: 290, width: 130, height: 120, rx: 12 }, g);
  mk("path", { class: "am-portal", d: "M164 350C250 350 300 342 372 322C430 306 480 292 514 286" }, g);
  mk("path", { class: "am-liver", d: "M214 152h688q24 0 24 26v182q0 62-66 62H266q-66 0-66-62V212q0-60 14-60z" }, g);
  const abscess = mk("circle", { class: "am-abscess", cx: 580, cy: 285, r: 68 }, g);
  const gutCells = [[78, 338], [120, 368]].map(([x, y], i) => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 11, nuc: 0.38, seed: 31 + i, wob: 0.2 }); place(e, x, y); return { e, x, y }; });
  const debris = Array.from({ length: 12 }, (_, i) => { const e = mk("circle", { class: "am-debris", r: 3 + (i % 3) }, g); return { e, a: i * 0.9, r: 14 + (i % 4) * 11, ph: i }; });
  const rim = Array.from({ length: 4 }, (_, i) => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 10, nuc: 0.38, seed: 41 + i, wob: 0.2 }); return { e, a: i * 1.57 + 0.4 }; });
  const portalTrack = track([[164, 350], [280, 348], [380, 330], [470, 302], [514, 286]]);
  const travellers = mkPool(6, () => { const e = mk("g", {}, g); cell(e, { cls: "amb", r: 8, nuc: 0.38, seed: 51, wob: 0.2 }); return e; });
  const stoolRect = mk("rect", { class: "am-stool", x: 796, y: 386, width: 10, height: 4, rx: 2, opacity: 0 }, g);
  let accT = 0;
  types.push({ g, upd(dt, m) {
    const pulse = 1 + 0.05 * m.Inj * Math.sin(tm / 420); abscess.setAttribute("r", f1(68 * pulse)); abscess.style.opacity = (0.45 + 0.55 * m.Par).toFixed(2);
    debris.forEach((d) => { const a = d.a + tm / 9000; d.e.setAttribute("cx", f1(580 + Math.cos(a) * d.r)); d.e.setAttribute("cy", f1(285 + Math.sin(a) * d.r * 0.8)); d.e.style.opacity = (0.35 + 0.65 * m.Par).toFixed(2); });
    rim.forEach((r2) => { place(r2.e, 580 + Math.cos(r2.a) * 68, 285 + Math.sin(r2.a) * 68, 0, 0.5 + 0.5 * m.Par); r2.e.style.opacity = (0.3 + 0.7 * m.Par).toFixed(2); });
    gutCells.forEach((c, i) => place(c.e, c.x + Math.sin(tm / 900 + i) * 3, c.y + Math.cos(tm / 1100 + i) * 3, 0, 0.5 + 0.5 * m.Par));
    accT += dt * m.Par * 1.6; while (accT >= 1) { accT--; const p = freeP(travellers); if (p) emit(p, 0, 0, 0, 0, 0); }
    travellers.forEach((p) => { if (!p.on) return; p.u += dt * 0.16; const q = portalTrack.at(clamp(p.u)); place(p.e, q.x, q.y, 0, 1); if (p.u >= 1) kill(p); });
  } });
  addLabel(1, "From colon", 95, 330, 110, 148, "The source is the colon: trophozoites that invaded the bowel wall can enter small portal veins even when bowel symptoms are mild or absent.");
  addLabel(1, "Portal blood", 290, 348, 330, 148, "Portal blood carries trophozoites from the colon to the liver, where they lodge and destroy liver tissue.");
  addLabel(1, "Liver abscess", 580, 217, 580, 148, "A usually single cavity in the liver, most often on the right. Fever and tender liver pain are typical, with few bowel symptoms.");
  addLabel(1, "Anchovy paste", 580, 285, 790, 148, "Anchovy paste: the odourless reddish brown necrotic centre of the abscess. It has few cells and trophozoites sit at the living rim, not in the centre.");
  addLabel(1, "Tender liver", 880, 320, 850, 408, "An enlarged, tender liver with fever. A large or left sided abscess, or one that may burst, needs urgent specialist care.");
  addMark(1, [1, 3], 648, 285, "Tissue agent works", 220, 408, "Metronidazole reaches the liver and kills trophozoites at the abscess rim. Most amoebic liver abscesses settle on drug treatment alone.", true);
  addMark(1, [2, 3], 95, 372, "Bowel cleared after", 480, 408, "After tissue treatment, a luminal agent clears parasites left in the bowel so infection does not return or spread.");
  addMark(1, [3], 580, 353, "Drainage rarely", 725, 408, "Drainage is rarely needed: it is kept for selected large, left sided, complicated or poorly responding abscesses, alongside drug treatment.");
})();

/* ================= GIARDIASIS ================= */
(function () {
  const g = mk("g", {}, LY.stage);
  mk("rect", { class: "am-lumen", x: 34, y: 146, width: 892, height: 70, rx: 10 }, g);
  mk("rect", { class: "am-tis2", x: 34, y: 316, width: 892, height: 106, rx: 10 }, g);
  const villusXs = [92, 162, 232, 302, 372, 442, 512, 582, 652, 722, 792, 862];
  const villi = villusXs.map((x, i) => { const blunt = i >= 4 && i <= 8, len = blunt ? 46 : 88; const e = mk("rect", { class: "am-villus", x: x - 17, y: 216, width: 34, height: len, rx: 15 }, g); return { e, x, len, blunt }; });
  const attached = villi.slice(3, 10).map((v, i) => { const e = mk("g", {}, g); cell(e, { cls: "gia", r: 11, nuc: 0.35, seed: 61 + i, wob: 0.12 }); mk("ellipse", { class: "am-disc", cx: 0, cy: 10, rx: 8, ry: 3.4 }, e); place(e, v.x, 216 + v.len + 8); return { e, x: v.x, y: 216 + v.len + 8, ph: i * 1.4 }; });
  const freeGia = Array.from({ length: 4 }, (_, i) => { const e = mk("g", {}, g); cell(e, { cls: "gia", r: 10, nuc: 0.35, seed: 71 + i, wob: 0.12 }); return { e, x: 120 + i * 200, y: 180, ph: i * 1.6 }; });
  const cysts2 = Array.from({ length: 5 }, (_, i) => ({ e: cystAt(g, 0.95), x: 80 + i * 170, y: 172 + (i % 2) * 18, ph: i }));
  const stoolRect = beaker(g, "am-stoolg");
  const fat = mkPool(20, () => mk("circle", { class: "sc-p p-fatp", r: 3.4 }, g));
  let accF = 0;
  types.push({ g, upd(dt, m) {
    villi.forEach((v, i) => { const target = v.blunt ? 46 + 34 * (1 - m.Inj * 2.2) : 88; const cur = parseFloat(v.e.getAttribute("height")); v.e.setAttribute("height", f1(lerp(cur, clamp(target, 42, 92), Math.min(1, dt * 1.2)))); });
    attached.forEach((a) => { const v = villi[3 + attached.indexOf(a)]; place(a.e, a.x + Math.sin(tm / 800 + a.ph) * 2, 216 + parseFloat(v.e.getAttribute("height")) + 8, Math.sin(tm / 600 + a.ph) * 10, 0.45 + 0.55 * m.Par); a.e.style.opacity = (0.3 + 0.7 * m.Par).toFixed(2); });
    freeGia.forEach((fg) => { fg.x += dt * 22 * (0.4 + m.Par); if (fg.x > 905) fg.x = 55; place(fg.e, fg.x, 182 + Math.sin(tm / 500 + fg.ph) * 10, Math.sin(tm / 280 + fg.ph) * 34, 0.5 + 0.5 * m.Par); fg.e.style.opacity = (0.3 + 0.7 * m.Par).toFixed(2); });
    cysts2.forEach((c) => { c.x += dt * 12 * (0.4 + m.Par); if (c.x > 905) c.x = 55; place(c.e, c.x, c.y + Math.sin(tm / 700 + c.ph) * 2, 0, 0.9); c.e.style.opacity = (0.3 + 0.7 * m.Par).toFixed(2); });
    accF += dt * m.Gut * 9; while (accF >= 1) { accF--; const p = freeP(fat); if (p) emit(p, rnd(70, 320), rnd(158, 200), rnd(48, 68), 0, 0); }
    fat.forEach((p) => { if (!p.on) return; if (p.x < 832) { p.x += p.vx * dt; p.y = clamp(p.y + Math.sin(tm / 400 + p.x) * 0.25, 154, 208); } else { p.x = 833; p.y += 76 * dt; } p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.y > 386) kill(p); });
    const sh = 5 + m.Gut * 18; stoolRect.setAttribute("y", f1(394 - sh)); stoolRect.setAttribute("height", f1(sh));
  } });
  addLabel(2, "Cysts swallowed", 85, 174, 118, 148, "Giardia cysts are swallowed in contaminated water or food or by fecal oral spread. They excyst in the small bowel and each cyst releases trophozoites.");
  addLabel(2, "Giardia", 300, 182, 302, 148, "Giardia trophozoite: a pear shaped parasite with flagella. It swims with a falling leaf motion and then attaches to the bowel lining.");
  addLabel(2, "Sucking disc", 445, 272, 488, 148, "The ventral sucking disc sticks the trophozoite to the duodenal lining. Giardia coats the surface but does not invade the epithelium.");
  addLabel(2, "Villi blunted", 610, 250, 664, 148, "Heavy coating disturbs the surface and blunts the villi, the small fingers that absorb food. Fat absorption suffers most.");
  addLabel(2, "Fat not absorbed", 770, 180, 838, 148, "Unabsorbed fat passes on through the bowel. That is why the stool becomes bulky, pale, greasy and offensive, and weight and vitamins can suffer.");
  addLabel(2, "Greasy stool", 833, 340, 835, 410, "Greasy stool of giardiasis (steatorrhoea): bulky, pale and difficult to flush, from fat malabsorption rather than invasion or blood.");
  addMark(2, [1, 3], 430, 280, "Giardia killed", 220, 408, "Metronidazole kills Giardia trophozoites on the duodenal surface and is a standard treatment choice shown here as a teaching toggle.", true);
  addMark(2, [2, 3], 180, 182, "Lumen cleared", 505, 408, "Clearing the lumen helps remove remaining parasites and cysts. Stool tests can still be uneven because shedding comes and goes.");
})();

/* ---- gauges and switching ---- */
const gg = {};
function initPanel() {
  const P = LY.panel, y0 = 478, h = 70, xs = [150, 360, 570, 780];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 30, width: WW - 48, height: 142, rx: 14 }, P);
  mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P).textContent = "The patient";
  [["par", "Parasites", "g-par", "How many active parasites are present: trophozoites in the bowel or liver in amoebiasis, and Giardia coating the duodenum in giardiasis."], ["inj", "Tissue injury", "g-inj", "Damage to tissue: deep invasion and ulceration in amoebic colitis and liver abscess, but only surface disturbance with little injury in giardiasis."], ["gut", "Gut upset", "g-gut", "Bowel upset: bloody dysentery in colitis, often little bowel upset in liver abscess, and greasy malabsorptive stool in giardiasis."], ["sev", "Severity", "g-sev", "Overall severity, combining parasite load, tissue injury and gut upset."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, xs[i] + 30, y0 + 2, h - 18, 18, cls, name, tip); });
}
const sm = { Par: 0.8, Inj: 0.7, Gut: 0.8, Sev: 0.7 };
let curType = -1;
function init() { types.forEach((t) => { t.g.style.opacity = 0; }); initPanel(); }
function step(dt, m) {
  if (m.type !== curType) { curType = m.type; document.querySelectorAll(".sc-card").forEach((c, i) => c.classList.toggle("on", i === m.type)); }
  const k = Math.min(1, dt * 1.4);
  sm.Par = lerp(sm.Par, m.Par, k); sm.Inj = lerp(sm.Inj, m.Inj, k); sm.Gut = lerp(sm.Gut, m.Gut, k); sm.Sev = lerp(sm.Sev, m.Sev, k);
  const smM = { Par: sm.Par, Inj: sm.Inj, Gut: sm.Gut, Sev: sm.Sev, type: m.type, drug: m.drug };
  types.forEach((t, i) => { const want = i === m.type ? 1 : 0, cur = parseFloat(t.g.style.opacity || 0), nx = cur + (want - cur) * Math.min(1, dt * 5); t.g.style.opacity = nx.toFixed(3); t.g.style.display = nx < 0.01 && !want ? "none" : ""; });
  types[m.type].upd(dt, smM);
  labels.forEach((l) => { l.g.style.display = l.ty === m.type ? "" : "none"; });
  marks.forEach((mk2) => { mk2.g.style.display = mk2.ty === m.type && mk2.drugs.indexOf(m.drug) > -1 ? "" : "none"; });
  gg.par.set(sm.Par, wordOf(sm.Par, 0.3, 0.6, ["low", "moderate", "high"])); gg.inj.set(sm.Inj, wordOf(sm.Inj, 0.3, 0.6, ["little", "some", "marked"]));
  gg.gut.set(sm.Gut, wordOf(sm.Gut, 0.3, 0.6, ["mild", "moderate", "severe"])); gg.sev.set(sm.Sev, wordOf(sm.Sev, 0.3, 0.6, ["mild", "moderate", "severe"]));
}
run({ init, step });
