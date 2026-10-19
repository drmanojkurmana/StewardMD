/* Onc-pembro scene: tumour PD-L1 switches the T cell off through PD-1 (left); pembrolizumab
 * caps PD-1 so the T cell wakes and kills the tumour, while woken T cells attack normal organs (right). */
const TCX = 150, TCY = 250, TR = 95;
const XC = 360, YC = 250, XR = 60;
const NUBDY = [-32, -10, 10, 32];
const NUBLX = [89.4, 94.5, 94.5, 89.4];
const NUBHX = [105.4, 110.5, 110.5, 105.4];
const REC = [[309.2, 218], [300.8, 240], [300.8, 262], [309.2, 284]];
const RECLX = [-50.7, -59.2, -59.2, -50.7];
const SLOTS = [[299, 218], [290, 240], [290, 262], [299, 284]];
const L = { tum: $("tum"), tcell: $("tcell"), links: $("links"), mab: $("mab"), sig: $("sig"), frag: $("frag"), zzz: $("zzz"), gutSlot: $("gutSlot"), gutFx: $("gutFx"), lungSlot: $("lungSlot"), lungFx: $("lungFx"), livSlot: $("livSlot"), livFx: $("livFx"), skinSlot: $("skinSlot"), skinFx: $("skinFx"), glaSlot: $("glaSlot"), glaFx: $("glaFx"), hrtSlot: $("hrtSlot"), hrtFx: $("hrtFx"), atk: $("atk"), ster: $("ster"), over: $("over"), panel: $("panel") };
const ORG = [
  { x: 592, y: 190, rx: 66, ry: 43 },
  { x: 716, y: 190, rx: 52, ry: 44 },
  { x: 844, y: 190, rx: 60, ry: 40 },
  { x: 592, y: 330, rx: 56, ry: 39 },
  { x: 719, y: 330, rx: 56, ry: 34 },
  { x: 844, y: 334, rx: 46, ry: 48 },
];
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, st: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.st = 1; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.st = 0; p.e.setAttribute("opacity", "0"); }
let tumG = null, tcellG = null, flash = null, flashT = 0, lungO = null, hrtO = null, capEl = null, capKey = "";
let recHeads = [], linkEls = [], tints = [], atkP = [], gg = {};
let mabP, offP, graP, debP, sterP;
function capText(d, l) {
  if (d === 0) return "No treatment. Tumour PD-L1 presses PD-1 and switches the T cell off, so the tumour grows.";
  if (d === 2 && l === 0) return "Early course with steroids. Tumour kill proceeds while steroids calm the attack on normal organs.";
  if (d === 2 && l === 1) return "Middle course with steroids. The tumour shrinks and organ inflammation stays low; glands may still suffer.";
  if (d === 2 && l === 2) return "Late course with steroids. Tumour control holds with immune events damped; watch glands and heart.";
  if (d === 2) return "Long course with steroids. Tumour control holds and most immune events stay calm; glands may still fail.";
  if (l === 0) return "Early course. Pembrolizumab caps PD-1, the T cell wakes and tumour kill begins; mild skin rash may appear.";
  if (l === 1) return "Middle course. Tumour kill builds as woken T cells attack; gut, lung and gland inflammation can start.";
  if (l === 2) return "Late course. Most tumour cells are dying but the immune attack on normal organs builds with each course.";
  return "Long course. The tumour is controlled yet colitis, pneumonitis and other immune events may turn severe.";
}
function init() {
  /* ---- tumour cell with PD-L1 nubs on the rim facing the T cell ---- */
  tumG = cell(L.tum, { cls: "graft", r: TR, nuc: 0.55, seed: 5, wob: 0.07, n: 10 });
  NUBDY.forEach((dy, i) => {
    mk("path", { class: "dx-nub-l", d: "M" + f1(NUBLX[i]) + " " + dy + "L" + f1(NUBLX[i] + 16) + " " + dy }, tumG);
    mk("circle", { class: "dx-nub", cx: f1(NUBLX[i] + 16), cy: dy, r: 4.5 }, tumG);
  });
  /* ---- T cell with PD-1 receptors on the rim facing the tumour ---- */
  tcellG = cell(L.tcell, { cls: "lymph", r: XR, nuc: 0.5, seed: 9, wob: 0.09, n: 9 });
  NUBDY.forEach((dy, i) => {
    mk("path", { class: "dx-rec-l", d: "M" + f1(RECLX[i]) + " " + dy + "L" + f1(RECLX[i] - 8) + " " + dy }, tcellG);
    recHeads.push(mk("circle", { class: "dx-rec", cx: f1(RECLX[i] - 8), cy: dy, r: 3 }, tcellG));
  });
  linkEls = REC.map(([x, y]) => mk("path", { class: "dx-link", d: "M0 0L0 0", opacity: "0" }, L.links));
  flash = mk("path", { class: "dx-flash", d: "M-8 -10L2 0L-4 2L6 12", opacity: "0" }, L.sig);
  /* ---- sleep letters over the exhausted T cell ---- */
  mk("text", { class: "dx-zzz", x: 394, y: 184 }, L.zzz).textContent = "z";
  mk("text", { class: "dx-zzz", x: 408, y: 168 }, L.zzz).textContent = "Z";
  /* ---- particle pools ---- */
  mabP = pool(8, () => { const g = mk("g", {}, L.mab); mk("path", { class: "dx-mab", d: "M0 0L-6 -10M0 0L6 -10M0 0L0 11" }, g); mk("circle", { class: "dx-mab-c", r: 2 }, g); return g; });
  offP = pool(12, () => mk("circle", { class: "sc-p dx-off", r: 2.6 }, L.sig));
  graP = pool(16, () => mk("circle", { class: "sc-p dx-gra", r: 2.4 }, L.sig));
  debP = pool(16, () => mk("circle", { class: "sc-p dx-deb", r: 2.5 }, L.frag));
  sterP = pool(12, () => { const g = mk("g", {}, L.ster); mk("rect", { class: "dx-ster", x: -4.5, y: -2.4, width: 9, height: 4.8, rx: 2.4 }, g); mk("rect", { class: "dx-ster2", x: 0, y: -2.4, width: 4.5, height: 4.8, rx: 2.4 }, g); return g; });
  /* ---- toxicity organs with redness tints ---- */
  organ(L.gutSlot, "bowel", ORG[0].x, ORG[0].y, 132, { h: 86 });
  lungO = organ(L.lungSlot, "lung", ORG[1].x, ORG[1].y, 104, { h: 88 });
  organ(L.livSlot, "liver", ORG[2].x, ORG[2].y, 120, { h: 80 });
  organ(L.skinSlot, "skin", ORG[3].x, ORG[3].y, 112, { h: 78 });
  organ(L.glaSlot, "thyroid", 690, 330, 60, { h: 64 });
  organ(L.glaSlot, "pituitary", 748, 332, 44, { h: 48 });
  hrtO = organ(L.hrtSlot, "heart", ORG[5].x, ORG[5].y, 92, { h: 96 });
  [L.gutFx, L.lungFx, L.livFx, L.skinFx, L.glaFx, L.hrtFx].forEach((fx, k) => {
    tints.push(mk("ellipse", { class: "dx-tint", cx: ORG[k].x, cy: ORG[k].y, rx: ORG[k].rx, ry: ORG[k].ry, opacity: "0" }, fx));
  });
  /* ---- woken T cells swarming each organ ---- */
  ORG.forEach((o, k) => { for (let j = 0; j < 5; j++) atkP.push({ e: mk("circle", { class: "sc-p dx-atk", r: 3, opacity: "0" }, L.atk), k, ph: (j / 5) * 6.28 + k * 1.1, sp: (0.5 + Math.random() * 0.5) * (k % 2 ? 1 : -1) }); });
  /* ---- node captions, labels, caption, gauges ---- */
  const t1 = mk("text", { class: "dx-node", x: 150, y: 368 }, L.over); t1.textContent = "tumour";
  const t2 = mk("text", { class: "dx-node", x: 360, y: 326 }, L.over); t2.textContent = "T cell";
  const o = L.over;
  pill(o, "Pembrolizumab", 291, 240, 150, 100, "Pembrolizumab, an antibody against PD-1. It caps the PD-1 off switch on T cells so tumour PD-L1 cannot press it.");
  pill(o, "PD-1 switch", 305, 262, 355, 100, "PD-1 on the T cell. Tumour PD-L1 presses it and exhausts the T cell; capped by the drug, the switch stays on and the T cell kills.");
  pill(o, "Gut", 592, 236, 592, 268, "Immune colitis. Woken T cells attack the bowel wall because it looks like a target once tolerance is lost, giving diarrhoea.");
  pill(o, "Lung", 716, 236, 716, 268, "Immune pneumonitis. Woken T cells inflame the air sac walls, giving cough and breathlessness.");
  pill(o, "Liver", 844, 232, 844, 268, "Immune hepatitis. Woken T cells attack liver cells, spilling liver enzymes into the blood.");
  pill(o, "Skin", 592, 372, 592, 408, "Immune dermatitis. Woken T cells attack the skin, giving rash and itch; it often appears first.");
  pill(o, "Glands", 719, 368, 720, 408, "Thyroiditis and hypophysitis. Woken T cells destroy the thyroid and pituitary, which then need lifelong hormone replacement.");
  pill(o, "Heart", 844, 384, 844, 408, "Immune myocarditis. Woken T cells attack heart muscle; it is rare but can fail fast.");
  capEl = mk("text", { class: "dx-cap", x: 30, y: 449 }, o); capEl.textContent = capText(0, level);
  const P = L.panel;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "Benefit and harm";
  [["kill", "Tumour kill", "g-good", "Tumour cells killed. Woken T cells release granules that punch holes in tumour cells and kill them."],
    ["gut", "Gut", "g-bad", "Immune colitis. Woken T cells attack the bowel wall once tolerance is lost, giving diarrhoea. Steroids calm it."],
    ["lung", "Lungs", "g-fl", "Immune pneumonitis. Woken T cells inflame the air sac walls, giving cough and breathlessness."],
    ["liv", "Liver", "g-bac", "Immune hepatitis. Woken T cells attack liver cells, spilling liver enzymes into the blood."],
    ["skin", "Skin", "g-eos", "Immune dermatitis. Woken T cells attack the skin, giving rash and itch; it often appears first."],
    ["gla", "Glands", "g-neu", "Thyroiditis and hypophysitis. Woken T cells destroy the thyroid and pituitary, which then need lifelong hormone replacement."],
    ["hrt", "Heart", "g-clot", "Immune myocarditis. Woken T cells attack heart muscle; it is rare but can fail fast."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 112 + i * 124, 486, 60, 18, cls, name, tip); });
}
const sm = { K: 0.5, Gut: 0.2, Lun: 0.2, Liv: 0.2, Ski: 0.2, Gla: 0.2, Hrt: 0.1, on: 0, ster: 0 };
const acc = { off: 0, gra: 0, deb: 0, ster: 0 };
function step(dt, m) {
  const k = Math.min(1, dt * 0.9);
  sm.K = lerp(sm.K, m.K, k); sm.Gut = lerp(sm.Gut, m.Gut, k); sm.Lun = lerp(sm.Lun, m.Lun, k); sm.Liv = lerp(sm.Liv, m.Liv, k);
  sm.Ski = lerp(sm.Ski, m.Ski, k); sm.Gla = lerp(sm.Gla, m.Gla, k); sm.Hrt = lerp(sm.Hrt, m.Hrt, k); sm.on = lerp(sm.on, m.on, k); sm.ster = lerp(sm.ster, m.ster, k);
  /* tumour grows when untreated, shrinks with kill */
  const cs = (1 - 0.28 * sm.K * sm.on + (1 - sm.on) * 0.05) * (1 + 0.012 * Math.sin(tm / 700));
  place(tumG, TCX, TCY, 0, cs);
  /* T cell wakes with treatment */
  place(tcellG, XC, YC, 0, 1 + 0.02 * Math.sin(tm / 600));
  tcellG.style.opacity = (0.55 + 0.45 * sm.on).toFixed(2);
  L.zzz.style.opacity = ((1 - sm.on) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tm / 500)))).toFixed(2);
  /* PD-L1 to PD-1 links only conduct while the switch is unblocked */
  const hx = NUBHX.map((lx) => TCX + lx * cs), hy = NUBDY.map((dy) => TCY + dy * cs);
  linkEls.forEach((el, i) => { el.setAttribute("d", "M" + f1(hx[i]) + " " + f1(hy[i]) + "L" + f1(REC[i][0]) + " " + REC[i][1]); el.setAttribute("opacity", ((1 - sm.on) * 0.85).toFixed(2)); });
  recHeads.forEach((h) => h.setAttribute("class", sm.on < 0.5 ? "dx-rec eng" : "dx-rec"));
  /* antibodies fly in and cap the PD-1 receptors; they leave when treatment stops */
  const want = m.on ? 4 : 0;
  let n = 0;
  mabP.forEach((p) => { if (p.on && (p.st === 1 || p.st === 2)) n++; });
  acc.mab = (acc.mab || 0) + dt * m.on * 2.2;
  while (acc.mab >= 1) { acc.mab--; if (n < want) { const p = free(mabP); if (p) { const used = {}; mabP.forEach((q) => { if (q.on && (q.st === 1 || q.st === 2)) used[q.k] = 1; }); let si = 0; while (used[si] && si < 4) si++; emit(p, rnd(240, 440), 58, 0, 0, si % 4); n++; } } }
  if (n > want) { const p = mabP.find((q) => q.on && q.st === 2) || mabP.find((q) => q.on && q.st === 1); if (p) p.st = 3; }
  mabP.forEach((p, i) => {
    if (!p.on) return;
    if (p.st === 1) { const s = SLOTS[p.k], dx = s[0] - p.x, dy = s[1] - p.y, d = Math.hypot(dx, dy) || 1, v = 130 * dt;
      if (d < v + 2) { p.x = s[0]; p.y = s[1]; p.st = 2; } else { p.x += dx / d * v; p.y += dy / d * v; }
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8 + i * 53) + ")"); }
    else if (p.st === 2) p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y + Math.sin(tm / 500 + i) * 1.5) + ") rotate(90)");
    else { p.y -= 60 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 8) + ")"); p.e.setAttribute("opacity", clamp((p.y - 50) / 40).toFixed(2)); if (p.y < 52) kill(p); }
  });
  /* off signals travel from PD-L1 into the T cell while untreated */
  acc.off += dt * (1 - sm.on) * 9;
  while (acc.off >= 1) { acc.off--; const p = free(offP); if (p) { const i = Math.floor(Math.random() * 4); emit(p, hx[i], hy[i], 0, 0, i); } }
  offP.forEach((p) => { if (!p.on) return; p.t += dt; const tx = 335, ty = 218 + p.k * 22, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1, v = 95 * dt;
    if (d < v + 3 || p.t > 2) kill(p); else { p.x += dx / d * v; p.y += dy / d * v; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); } });
  /* woken T cell fires granules at the tumour */
  acc.gra += dt * sm.on * (0.3 + 0.7 * sm.K) * 10;
  while (acc.gra >= 1) { acc.gra--; const p = free(graP); if (p) emit(p, 308, 250 + rnd(-24, 24), -110, rnd(-8, 8), 0); }
  const surf = TCX + TR * cs - 4;
  graP.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < surf) {
      kill(p); flashT = 1; flash.setAttribute("transform", "translate(" + f1(surf + 4) + " " + f1(clamp(p.y, 170, 330)) + ")");
      for (let j = 0; j < 2; j++) { const q = free(debP); if (q) { const a = rnd(0, 6.28); emit(q, surf + 4, clamp(p.y, 170, 330), Math.cos(a) * 26, Math.sin(a) * 26, 0); } }
    } else p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });
  flashT = Math.max(0, flashT - dt * 3); flash.setAttribute("opacity", (flashT * 0.9).toFixed(2));
  /* debris from the dying tumour, kept inside the left panel */
  acc.deb += dt * sm.on * sm.K * 5;
  while (acc.deb >= 1) { acc.deb--; const p = free(debP); if (p) { const a = rnd(0, 6.28); emit(p, TCX + Math.cos(a) * TR * cs, TCY + Math.sin(a) * TR * cs, Math.cos(a) * 24, Math.sin(a) * 24, 0); } }
  debP.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); p.e.setAttribute("opacity", clamp(1 - p.t / 2.2).toFixed(2)); if (p.t > 2.2 || p.x < 18 || p.x > 466 || p.y < 48 || p.y > 436) kill(p); });
  /* organs redden and draw swarms of woken T cells */
  const tox = [sm.Gut, sm.Lun, sm.Liv, sm.Ski, sm.Gla, sm.Hrt];
  tints.forEach((el, i) => el.setAttribute("opacity", (tox[i] * 0.5).toFixed(2)));
  atkP.forEach((a) => { const o = ORG[a.k], an = a.ph + tm / 1000 * a.sp;
    a.e.setAttribute("transform", "translate(" + f1(o.x + Math.cos(an) * (o.rx + 6)) + " " + f1(o.y + Math.sin(an) * (o.ry + 6)) + ")");
    a.e.setAttribute("opacity", tox[a.k].toFixed(2)); });
  place(lungO.g, ORG[1].x, ORG[1].y, 0, 1 + 0.015 * Math.sin(tm / 1500));
  place(hrtO.g, ORG[5].x, ORG[5].y, 0, 1 + 0.02 * Math.sin(tm / 430) * (1 - 0.5 * sm.Hrt));
  /* steroids drift over the organs and calm the attack */
  acc.ster += dt * sm.ster * 7;
  while (acc.ster >= 1) { acc.ster--; const p = free(sterP); if (p) emit(p, rnd(500, 930), 56, rnd(-6, 6), rnd(35, 55), 0); }
  sterP.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.y += p.vy * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.y * 2) + ")"); p.e.setAttribute("opacity", (p.y > 380 ? clamp(1 - (p.y - 380) / 52) : 1).toFixed(2)); if (p.y > 432) kill(p); });
  /* caption and gauges */
  const key = drug * 10 + level;
  if (key !== capKey) { capKey = key; capEl.textContent = capText(drug, level); }
  gg.kill.set(sm.K, wordOf(sm.K, 0.3, 0.7, ["low", "some", "high"])); gg.gut.set(sm.Gut, wordOf(sm.Gut, 0.28, 0.6, ["calm", "inflamed", "severe"]));
  gg.lung.set(sm.Lun, wordOf(sm.Lun, 0.28, 0.6, ["clear", "inflamed", "severe"])); gg.liv.set(sm.Liv, wordOf(sm.Liv, 0.28, 0.6, ["ok", "inflamed", "severe"]));
  gg.skin.set(sm.Ski, wordOf(sm.Ski, 0.3, 0.6, ["clear", "rash", "severe"])); gg.gla.set(sm.Gla, wordOf(sm.Gla, 0.28, 0.6, ["ok", "inflamed", "failing"]));
  gg.hrt.set(sm.Hrt, wordOf(sm.Hrt, 0.28, 0.6, ["ok", "strained", "failing"]));
}
run({ init, step });
