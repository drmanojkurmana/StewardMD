/* GI bleeding scene: upper and lower sources, blood in the gut, circulation, signs, treatments and gauges. */
const layers = { heart: $("heartg"), rbc: $("rbcs"), signs: $("signs"), treat: $("treat"), parts: $("parts"), over: $("over"), panel: $("panel") };
function pool(n, build) { return Array.from({ length: n }, () => { const e = build(); e.setAttribute("opacity", "0"); return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0 }; }); }
const free = (pl) => pl.find((p) => !p.on);
function emit(p, x, y, vx, vy, k) { p.on = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.t = 0; p.k = k || 0; p.e.setAttribute("opacity", "1"); }
function kill(p) { p.on = false; p.e.setAttribute("opacity", "0"); }
const upDrops = pool(22, () => mk("circle", { class: "sc-p p-bld", r: 3 }, layers.parts));
const loDrops = pool(20, () => mk("circle", { class: "sc-p p-bld", r: 3 }, layers.parts));
const fluids = pool(14, () => mk("path", { class: "p-fl", d: "M0 -3.4C2.2 -.6 2.8 .8 2.8 1.8A2.8 2.8 0 0 1 -2.8 1.8C-2.8 .8 -2.2 -.6 0 -3.4Z" }, layers.parts));
const rbcs = [];
let heartG = null;
const gg = {};
const sm = { bleed: 0.5, vol: 0.6, bp: 0.6, perf: 0.6, hr: 0.4, shock: 0.3, upper: 0.5, lower: 0.5, resus: 0, ctrl: 0, endo: 0, surg: 0 };
const acc = { up: 0, lo: 0, fl: 0 };
function init() {
  heartG = cell(layers.heart, { cls: "heart", r: 46, nuc: 0, seed: 3, wob: 0.1 });
  place(heartG, 480, 150, 0, 1);
  for (let i = 0; i < 16; i++) { const g = mk("g", { class: "cl cl-rbc" }, layers.rbc); mk("ellipse", { class: "cl-b", rx: 8, ry: 4.8 }, g); mk("ellipse", { class: "cl-s", rx: 3, ry: 1.5 }, g); rbcs.push({ g, x: rnd(355, 605), y: rnd(-0.8, 0.8), v: rnd(0.85, 1.15), rot: rnd(-15, 15) }); }
  /* signs: bowl of vomited blood, black stool, bright red stool */
  const sg = layers.signs;
  mk("path", { class: "gb-bowl", d: "M678 122h56l-7 20h-42Z" }, sg); mk("ellipse", { class: "gb-vomit", cx: 706, cy: 123, rx: 24, ry: 5 }, sg);
  const mel = mk("g", { id: "sign-mel" }, sg); mk("ellipse", { class: "gb-stoolb", cx: 700, cy: 222, rx: 20, ry: 10 }, mel); mk("ellipse", { class: "gb-stoolb", cx: 714, cy: 216, rx: 13, ry: 7 }, mel);
  const hae = mk("g", { id: "sign-hae" }, sg); mk("ellipse", { class: "gb-stoolr", cx: 700, cy: 318, rx: 20, ry: 10 }, hae); mk("ellipse", { class: "gb-stoolr", cx: 714, cy: 312, rx: 13, ry: 7 }, hae);
  const hem = mk("g", { id: "sign-hem" }, sg); mk("ellipse", { class: "gb-vomit", cx: 706, cy: 123, rx: 24, ry: 5 }, hem);
  /* treatment icons along the bottom of the circulation box */
  const tg = layers.treat;
  const iv = mk("g", { id: "tr-iv", opacity: "0.35" }, tg); mk("rect", { class: "gb-ivbag", x: 366, y: 398, width: 22, height: 30, rx: 6 }, iv); mk("path", { class: "gb-scope", d: "M377 428v8" }, iv);
  const sc = mk("g", { id: "tr-scope", opacity: "0.35" }, tg); mk("path", { class: "gb-scope", d: "M452 436c18-22 34-22 52-8" }, sc); mk("circle", { class: "gb-clipc", cx: 452, cy: 436, r: 5 }, sc);
  const ca = mk("g", { id: "tr-cath", opacity: "0.35" }, tg); mk("path", { class: "gb-cath", d: "M552 436c14-18 30-24 46-20" }, ca); mk("circle", { class: "gb-clipc", cx: 598, cy: 416, r: 5 }, ca);
  /* gauges */
  const P = layers.panel, y0 = 486;
  mk("rect", { class: "dr-panel", x: 24, y: 454, width: 912, height: 142, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: 476 }, P); t.textContent = "The patient";
  [["bl", "Bleeding", "g-bleed", "How fast blood is still leaving the circulation from the gut source."], ["vo", "Volume", "g-vol", "Circulating blood volume. It falls as blood is lost and rises with resuscitation fluids and blood."], ["bp", "Pressure", "g-press", "Blood pressure. It is held up at first by a faster pulse and tight vessels, then falls as loss continues."], ["pu", "Pulse", "g-pulse", "Pulse rate. It speeds up to compensate for lost volume, an early sign before pressure falls."], ["pe", "Perfusion", "g-perf", "Flow reaching the tissues. Poor perfusion gives pale, cold skin and, later, confusion and low urine output."], ["sh", "Shock", "g-shock", "Shock: perfusion too low for the tissues. It follows when compensation fails or the bleed is massive."]]
    .forEach(([id, name, cls, tip], i) => { gg[id] = gauge(P, 120 + i * 140, y0, 60, 18, cls, name, tip); });
  /* labels */
  const o = layers.over;
  pill(o, "Varices", 76, 102, 170, 66, "Swollen veins in the lower oesophagus, usually from portal hypertension in liver disease. Thin walled and under pressure, they can burst and bleed heavily into the stomach.");
  pill(o, "M-W tear", 97, 156, 155, 128, "Mallory-Weiss tear: a split in the lining at the stomach inlet, torn by forceful vomiting or retching. It usually bleeds as vomited blood.");
  pill(o, "Ulcer", 212, 196, 258, 96, "A peptic ulcer in the stomach or duodenum eroding into a vessel. Aspirin and other NSAIDs, and Helicobacter infection, are common causes, especially in elderly patients.");
  pill(o, "Diverticula", 40, 352, 115, 422, "Diverticula: small pouches pushed out of the colon wall. A vessel in a pouch can burst without warning and bleed bright red, often painlessly.");
  pill(o, "Angiodysplasia", 162, 300, 245, 290, "Angiodysplasia: a fragile tangle of small vessels in the colon wall, commoner with age. It oozes or bleeds bright red and can recur.");
  pill(o, "Colitis", 266, 368, 210, 422, "Colitis: an inflamed colon, from infection, inflammatory bowel disease or poor blood flow. The inflamed lining bleeds, often with pain and diarrhoea.");
  pill(o, "Heart", 505, 118, 560, 95, "The heart speeds up and squeezes harder to keep blood moving as volume falls. That compensation hides the loss for a while, then fails.");
  pill(o, "Compensation", 470, 185, 400, 232, "Compensation: a fast pulse and tightened vessels hold the blood pressure up despite lost volume. Pressure alone can look reassuring while perfusion is already poor.");
  pill(o, "Blood flow", 540, 300, 545, 262, "Red cells moving through a large vessel. Flow slows as volume and pressure fall, and speeds again when volume is restored and the source is controlled.");
  pill(o, "Haematemesis", 706, 123, 815, 108, "Haematemesis: vomited blood, fresh red or like coffee grounds. It points to a source in the upper gut, above the stomach outlet.");
  pill(o, "Melaena", 706, 220, 795, 205, "Melaena: black, tarry, offensive stool. Blood digested on its way through the gut, usually from an upper source, sometimes from the right colon.");
  pill(o, "Haematochezia", 706, 316, 825, 302, "Haematochezia: bright red blood per rectum. It usually means a lower gut source, although a very brisk upper bleed can present this way too.");
  pill(o, "Pale, cold", 716, 392, 830, 398, "Pale, cold and sweaty skin from vessels tightening and poor perfusion. With a fast pulse and low pressure this is shock until proved otherwise.");
  pill(o, "Shock", 480, 324, 480, 368, "Shock: the circulation can no longer meet tissue needs. It is the danger this figure tracks, from compensated fast pulse to falling pressure and poor perfusion.");
  const tp1 = pill(o, "Resuscitation", 377, 410, 480, 395, "Resuscitation: large bore access, fluids and blood, and close monitoring. It restores volume and pressure but does not stop the source, so bleeding can continue behind it."); tp1.setAttribute("id", "tp-resus"); tp1.style.opacity = 0;
  const tp2 = pill(o, "Endoscopy", 478, 425, 480, 395, "Endoscopic therapy: at endoscopy the source is banded, clipped, heated or injected. It controls most ulcer, tear and variceal bleeding and selected lower sources."); tp2.setAttribute("id", "tp-endo"); tp2.style.opacity = 0;
  const tp3 = pill(o, "Surgery / embolisation", 575, 425, 480, 395, "Surgery or embolisation: an operation, or a catheter blocking the bleeding vessel, when endoscopy fails, bleeding is massive, or it returns. It is definitive but carries the most risk."); tp3.setAttribute("id", "tp-surg"); tp3.style.opacity = 0;
}
function step(dt, m) {
  const k1 = Math.min(1, dt * 1.1), k2 = Math.min(1, dt * 0.55);
  ["bleed", "vol", "bp", "perf", "hr", "shock", "upper", "lower", "resus", "ctrl", "endo", "surg"].forEach((q) => { sm[q] = lerp(sm[q], m[q], q === "vol" || q === "bp" ? k1 : k2); });
  /* heart and varices */
  const beat = 1 + 0.07 * sm.hr * Math.sin(tm / (240 - 90 * sm.hr));
  place(heartG, 480, 150, 0, beat);
  [0, 1, 2].forEach((i) => { const el = $("varix" + i); if (el) el.setAttribute("r", f1(3.5 + 5 * sm.upper)); });
  $("ulcer").setAttribute("opacity", (0.45 + 0.55 * sm.upper).toFixed(2));
  $("clips").setAttribute("opacity", sm.ctrl.toFixed(2));
  /* upper blood: from the lesions into the stomach, then onward */
  acc.up += dt * sm.upper * 9; while (acc.up >= 1) { acc.up--; const p = free(upDrops); if (p) { const src = pick([[76, 112], [98, 160], [212, 192]]); emit(p, src[0], src[1], rnd(6, 18), rnd(8, 20), 0); } }
  upDrops.forEach((p) => { if (!p.on) return; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += 10 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 296 || p.y > 226 || p.t > 3) kill(p); });
  /* lower blood: along the colon toward the rectum */
  acc.lo += dt * sm.lower * 8; while (acc.lo >= 1) { acc.lo--; const p = free(loDrops); if (p) { const src = pick([[46, 350], [162, 306], [264, 360]]); emit(p, src[0], src[1], 0, 0, 0); } }
  loDrops.forEach((p) => { if (!p.on) return; p.t += dt; const dx = 266 - p.x, dy = 420 - p.y, d = Math.hypot(dx, dy) || 1; p.x += (dx / d) * 34 * dt; p.y += (dy / d) * 34 * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (d < 8 || p.t > 5) kill(p); });
  /* circulation: vessel height by volume, red cells by perfusion */
  const ves = $("vessel"); const vh = 12 + 26 * sm.vol; ves.setAttribute("y", f1(306 - vh / 2)); ves.setAttribute("height", f1(vh));
  const vf = 62 * clamp(0.2 + 0.85 * sm.perf);
  rbcs.forEach((r) => { r.x += r.v * vf * dt; if (r.x > 608) { r.x = 354; r.y = rnd(-0.8, 0.8); } place(r.g, r.x, 306 + r.y * Math.max(4, vh / 2 - 7), r.rot + Math.sin(tm / 500 + r.x) * 8, 1); });
  /* resuscitation fluid entering the vessel */
  acc.fl += dt * sm.resus * 7; while (acc.fl >= 1) { acc.fl--; const p = free(fluids); if (p) emit(p, 356, 306 + rnd(-8, 8), 78, 0, 0); }
  fluids.forEach((p) => { if (!p.on) return; p.x += p.vx * dt; p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")"); if (p.x > 606) kill(p); });
  /* signs and pallor */
  $("sign-hem").setAttribute("opacity", clamp(sm.upper * 1.2).toFixed(2));
  $("sign-mel").setAttribute("opacity", clamp(0.25 + sm.upper).toFixed(2));
  $("sign-hae").setAttribute("opacity", clamp(sm.lower * 1.2).toFixed(2));
  $("pale").setAttribute("opacity", clamp(sm.shock * 0.85).toFixed(2));
  /* treatment icons and pills */
  $("tr-iv").setAttribute("opacity", (0.3 + 0.7 * sm.resus).toFixed(2));
  $("tr-scope").setAttribute("opacity", (0.3 + 0.7 * sm.endo).toFixed(2));
  $("tr-cath").setAttribute("opacity", (0.3 + 0.7 * sm.surg).toFixed(2));
  $("tp-resus").style.opacity = sm.resus.toFixed(2); $("tp-endo").style.opacity = sm.endo.toFixed(2); $("tp-surg").style.opacity = sm.surg.toFixed(2);
  /* gauges */
  gg.bl.set(sm.bleed, wordOf(sm.bleed, 0.18, 0.5, ["slow", "steady", "brisk"]));
  gg.vo.set(sm.vol, wordOf(sm.vol, 0.4, 0.7, ["low", "reduced", "full"]));
  gg.bp.set(sm.bp, wordOf(sm.bp, 0.45, 0.68, ["low", "borderline", "maintained"]));
  gg.pu.set(sm.hr, wordOf(sm.hr, 0.35, 0.6, ["normal", "fast", "very fast"]));
  gg.pe.set(sm.perf, wordOf(sm.perf, 0.4, 0.65, ["poor", "reduced", "good"]));
  gg.sh.set(sm.shock, wordOf(sm.shock, 0.35, 0.7, ["none", "compensated", "overt"]));
}
run({ init, step });
