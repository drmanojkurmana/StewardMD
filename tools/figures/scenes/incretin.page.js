/* Incretin scene runtime: pen injection, L and K cells, DPP-4 chomping,
 * dual receptor docking, insulin vesicle fusion, hypothalamic appetite calm,
 * delayed gastric emptying and systemic circulation. Plain globals, ES2015. */
const WW = SC.W;
const layers = {
  bg: $("bg-specks"),
  rbc: $("rbcs"),
  glu: $("glucose"),
  drug: $("drug-stream"),
  gut: $("gut-particles"),
  inc: $("incretin-particles"),
  islet: $("islet-granules"),
  stom: $("stomach-particles"),
  zoom: $("zoom-particles"),
  over: $("over"),
  panel: $("panel")
};

/* ---- particle pool utility ---- */
function pool(n, build) {
  return Array.from({ length: n }, () => {
    const e = build();
    e.setAttribute("opacity", "0");
    return { e, on: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, k: 0, branch: 0 };
  });
}
function emit(p, x, y, vx, vy, k, branch) {
  p.on = true;
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.t = 0;
  p.k = k || 0;
  p.branch = branch || 0;
  p.e.setAttribute("opacity", "1");
}
function kill(p) {
  p.on = false;
  p.e.setAttribute("opacity", "0");
}
const free = (pl) => pl.find((p) => !p.on);

/* ---- background subtle specks ---- */
const bgSpecks = [];
function initBgSpecks() {
  for (let i = 0; i < 24; i++) {
    const x = rnd(30, WW - 30), y = rnd(50, 430), r = rnd(1.1, 2.0);
    const e = mk("circle", { cx: f1(x), cy: f1(y), r: f1(r), fill: "var(--anatomy-strong)", opacity: f1(rnd(0.04, 0.10)) }, layers.bg);
    bgSpecks.push({ e, x, y, vx: rnd(-2.5, 2.5), vy: rnd(-1.8, 1.8) });
  }
}

/* ---- red blood cells in central vessel ---- */
const rbcs = [];
function initRbc() {
  for (let i = 0; i < 16; i++) {
    const g = mk("g", {}, layers.rbc);
    mk("ellipse", { rx: 7.5, ry: 4.5, fill: "var(--c-vessel)", stroke: "color-mix(in srgb, var(--c-vessel) 40%, #000)", "stroke-width": "0.7" }, g);
    mk("ellipse", { rx: 2.8, ry: 1.6, fill: "var(--c-lumen)" }, g);
    rbcs.push({ g, x: (i / 16) * WW, y: rnd(242, 258), v: rnd(42, 58), rot: rnd(-15, 15) });
  }
}

/* ---- glucose particles ---- */
const glucose = pool(24, () => mk("polygon", {
  points: "-3,0 -1.5,-2.6 1.5,-2.6 3,0 1.5,2.6 -1.5,2.6",
  fill: "#f59e0b",
  stroke: "#b45309",
  "stroke-width": "0.5"
}, layers.glu));

/* ---- drug stream particles (depot -> vessel -> organs) ---- */
const drugStream = pool(36, () => {
  const g = mk("g", {}, layers.drug);
  mk("circle", { class: "drug-p-glp1", cx: 0, cy: 0, r: 2.8, fill: "var(--c-glp1)", stroke: "color-mix(in srgb, var(--c-glp1) 50%, #000)", "stroke-width": "0.6" }, g);
  mk("circle", { class: "drug-p-gip", cx: 2.8, cy: 0, r: 2.8, fill: "var(--c-gip)", stroke: "color-mix(in srgb, var(--c-gip) 50%, #000)", "stroke-width": "0.6" }, g);
  return g;
});

/* ---- gut lumen chyme particles ---- */
const gutChyme = pool(16, () => mk("circle", { r: 2.4, fill: "var(--c-chyme)", stroke: "#c2410c", "stroke-width": "0.5" }, layers.gut));

/* ---- native incretins and DPP-4 fragments ---- */
const nativeGlp = pool(12, () => mk("circle", { r: 2.2, fill: "var(--c-glp1)", stroke: "#0f766e", "stroke-width": "0.6" }, layers.inc));
const nativeGip = pool(12, () => mk("circle", { r: 2.2, fill: "var(--c-gip)", stroke: "#b45309", "stroke-width": "0.6" }, layers.inc));
const dpp4Frags = pool(16, () => mk("line", { x1: -1.8, y1: 0, x2: 1.8, y2: 0, stroke: "#f43f5e", "stroke-width": "1.2", "stroke-linecap": "round" }, layers.inc));

/* ---- islet granules: insulin and glucagon ---- */
const insulinGranules = pool(24, () => mk("circle", { r: 2.3, fill: "var(--c-ins)", stroke: "#1d4ed8", "stroke-width": "0.6" }, layers.islet));
const glucagonGranules = pool(16, () => mk("circle", { r: 2.3, fill: "var(--c-gcg)", stroke: "#c2410c", "stroke-width": "0.6" }, layers.islet));

/* ---- stomach chyme & pylorus transit ---- */
const stomachChyme = pool(22, () => mk("circle", { r: 2.6, fill: "var(--c-chyme)", stroke: "#ea580c", "stroke-width": "0.6" }, layers.stom));

/* ---- receptor zoom inset particles ---- */
const campSparks = pool(14, () => mk("path", { d: "M0 -2.5 L0.8 -0.8 L2.5 0 L0.8 0.8 L0 2.5 L-0.8 0.8 L-2.5 0 L-0.8 -0.8 Z", fill: "var(--c-camp)" }, layers.zoom));
const zoomVesicles = pool(10, () => {
  const g = mk("g", {}, layers.zoom);
  mk("circle", { r: 4.5, fill: "var(--c-beta)", stroke: "var(--anatomy-paper)", "stroke-width": "0.8" }, g);
  mk("circle", { r: 2, fill: "var(--c-ins)" }, g);
  return g;
});

/* ---- tracks for anatomical transit ---- */
const trDepot = track([[152, 174], [168, 182], [182, 204], [192, 234]]);
const trStomachEmpty = track([[735, 355], [765, 362], [800, 366], [835, 370], [865, 372], [885, 385], [910, 405]]);

/* ---- gauges and labels ---- */
const gg = {};
function initPanel() {
  const P = layers.panel, y0 = 478, h = 68, xs = [90, 245, 400, 555, 710, 865];
  mk("rect", { class: "dr-panel", x: 24, y: y0 - 28, width: WW - 48, height: 138, rx: 14 }, P);
  const t = mk("text", { class: "dr-pt", x: 40, y: y0 - 8 }, P);
  t.textContent = "The patient";
  [
    ["sugar", "Blood sugar", "g-sugar", "Blood glucose level. Incretins promote glucose-dependent insulin secretion, controlling glucose without intrinsic hypoglycaemia."],
    ["insulin", "Insulin (matched)", "g-ins", "Insulin secretion from pancreatic beta cells, amplified by GLP-1 and GIP strictly when blood sugar is elevated."],
    ["glucagon", "Glucagon", "g-gcg", "Glucagon secretion from pancreatic alpha cells. Inappropriately elevated in type 2 diabetes, suppressed by GLP-1."],
    ["emptying", "Gastric emptying", "g-emp", "Rate of food transit from stomach to duodenum. Slowed by incretins, which flattens post-meal glucose spikes."],
    ["appetite", "Appetite", "g-app", "Central hunger and food craving signals in the hypothalamus, reduced by GLP-1 and GIP agonism to promote satiety."],
    ["weight", "Weight trend", "g-wt", "Long term weight trajectory driven by sustained satiety, reduced calorie intake and enhanced metabolic control."]
  ].forEach(([id, name, cls, tip], i) => {
    gg[id] = gauge(P, xs[i], y0 + 4, h - 22, 16, cls, name, tip);
  });

  const ox = layers.over;
  pill(ox, "Weekly pen", 124, 118, 95, 68, "Pre-filled weekly pen delivering a long-acting incretin receptor agonist subcutaneously.");
  pill(ox, "Subcutaneous depot", 152, 174, 175, 215, "Subcutaneous depot from which the fatty-acid acylated drug slowly enters capillaries over days.");
  pill(ox, "Gut L and K cells", 104, 332, 95, 415, "Intestinal endocrine cells: L cells secrete GLP-1 and K cells secrete GIP in response to nutrients.");
  pill(ox, "DPP-4 enzyme", 225, 310, 230, 415, "Dipeptidyl peptidase-4 cleaves native GLP-1 and GIP within 2 to 3 minutes, limiting their natural duration.");
  pill(ox, "Albumin bound", 180, 298, 235, 275, "Semaglutide and tirzepatide carry a fatty acid diacid tail that binds albumin, shielding them from DPP-4.");
  pill(ox, "Pancreatic islet", 405, 125, 385, 68, "Beta cells produce insulin and alpha cells produce glucagon; incretins enhance glucose-dependent insulin release.");
  pill(ox, "GLP-1 & GIP receptors", 585, 125, 585, 68, "Semaglutide binds GLP-1 receptors; tirzepatide is a dual agonist binding both GLP-1 and GIP receptors.");
  pill(ox, "Hypothalamus", 800, 135, 805, 68, "Hypothalamic appetite centers receive incretin signals that increase satiety and reduce hunger drive.");
  pill(ox, "Central vessel", 480, 250, 480, 280, "Glossy systemic bloodstream carrying circulating incretins, red blood cells and glucose to target organs.");
  pill(ox, "Stomach & pylorus", 825, 365, 810, 415, "Gastric emptying through the pyloric sphincter slows under GLP-1 agonism, smoothing postprandial glucose.");
}

/* ---- ad mode setup ---- */
const isAd = new URLSearchParams(location.search).get("ad") === "1";
let adTimer = 0;
let adIdx = 0;
let lastCardD = -1;
const adSteps = [
  { level: 2, drug: 0, caption: "No medicine" },
  { level: 2, drug: 1, caption: "Semaglutide: GLP-1 receptor agonist" },
  { level: 2, drug: 2, caption: "Tirzepatide: dual GIP and GLP-1 receptor agonist" }
];

/* ---- state smoothing & accumulators ---- */
const sm = { sugar: 0.5, insulin: 0.5, glucagon: 0.5, emptying: 0.5, appetite: 0.5, weight: 0.5, drug: 0 };
const acc = { depot: 0, glu: 0, gut: 0, inc: 0, ins: 0, gcg: 0, stom: 0, spark: 0, ves: 0 };
let penTimer = 0;

function init() {
  initBgSpecks();
  initRbc();
  initPanel();

  if (isAd) {
    document.body.classList.add("is-ad");
    levelBox.value = "2";
    levelBox.dispatchEvent(new Event("input"));
    drugBox.value = "0";
    drugBox.dispatchEvent(new Event("change"));
    const b = $("ad-banner"), bt = $("ad-text");
    if (b) b.setAttribute("opacity", "1");
    if (bt) {
      bt.textContent = adSteps[0].caption;
      bt.setAttribute("opacity", "1");
    }
  }
}

function step(dt, m) {
  /* Smooth model values */
  const k1 = Math.min(1, dt * 2.2);
  sm.sugar = lerp(sm.sugar, m.sugar, k1);
  sm.insulin = lerp(sm.insulin, m.insulin, k1);
  sm.glucagon = lerp(sm.glucagon, m.glucagon, k1);
  sm.emptying = lerp(sm.emptying, m.emptying, k1);
  sm.appetite = lerp(sm.appetite, m.appetite, k1);
  sm.weight = lerp(sm.weight, m.weight, k1);
  sm.drug = lerp(sm.drug, m.d, Math.min(1, dt * 3.0));

  /* 0. Background subtle specks */
  bgSpecks.forEach((s) => {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.x < 20) s.x = WW - 25;
    else if (s.x > WW - 20) s.x = 25;
    if (s.y < 46) s.y = 435;
    else if (s.y > 438) s.y = 48;
    s.e.setAttribute("cx", f1(s.x));
    s.e.setAttribute("cy", f1(s.y));
  });

  /* 1. Pen plunger and subcutaneous depot */
  penTimer += dt;
  if (penTimer > 4.5) penTimer = 0;
  const pProg = penTimer < 0.6 ? Math.sin((penTimer / 0.6) * Math.PI) : 0;
  const plEl = $("pen-plunger");
  if (plEl) plEl.setAttribute("transform", "translate(0, " + f1(pProg * 7) + ")");

  const depotEl = $("sc-depot");
  if (depotEl) {
    const dActive = m.d > 0;
    const baseOp = dActive ? 0.65 + 0.35 * pProg : 0.12;
    depotEl.setAttribute("opacity", baseOp.toFixed(2));
    depotEl.setAttribute("rx", f1(18 + (dActive ? pProg * 4 : 0)));
  }

  /* 2. Drug particles emitted from depot */
  acc.depot += dt * (m.d > 0 ? 3.6 : 0);
  while (acc.depot >= 1) {
    acc.depot--;
    const p = free(drugStream);
    if (p) {
      emit(p, 152, 174, 0, 0, m.d, Math.floor(Math.random() * 3));
      const g1 = p.e.querySelector(".drug-p-glp1");
      const g2 = p.e.querySelector(".drug-p-gip");
      if (m.d === 1) {
        if (g1) g1.setAttribute("opacity", "1");
        if (g2) g2.setAttribute("opacity", "0");
      } else {
        if (g1) g1.setAttribute("opacity", "1");
        if (g2) g2.setAttribute("opacity", "1");
      }
    }
  }

  drugStream.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    /* Phase 1: depot capillary transit (0 to 1.2s) */
    if (p.t <= 1.2) {
      const u = p.t / 1.2;
      const pt = trDepot.at(u);
      p.x = pt.x;
      p.y = pt.y;
    } else {
      /* Phase 2: central vessel flow and organ branching */
      const vt = p.t - 1.2;
      p.x = 192 + vt * 85;

      /* Organ branching */
      if (p.branch === 0 && p.x > 405) {
        /* Branch upward to pancreatic islet */
        p.x = 405 + Math.sin(vt * 6) * 3;
        p.y = 240 - (p.x - 405) * 1.4 - (vt - (405 - 192) / 85) * 70;
        if (p.y < 135) kill(p);
      } else if (p.branch === 1 && p.x > 740) {
        /* Branch downward to stomach */
        p.x = 740 + Math.sin(vt * 5) * 3;
        p.y = 260 + (vt - (740 - 192) / 85) * 65;
        if (p.y > 360) kill(p);
      } else if (p.branch === 2 && p.x > 800) {
        /* Branch upward to hypothalamus */
        p.x = 800 + Math.sin(vt * 5) * 3;
        p.y = 240 - (vt - (800 - 192) / 85) * 75;
        if (p.y < 140) kill(p);
      } else {
        p.y = 250 + Math.sin(tm / 300 + p.x) * 4;
        if (p.x > WW - 18) kill(p);
      }
    }
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
  });

  /* 3. RBCs and Glucose in central vessel */
  rbcs.forEach((r) => {
    r.x += r.v * dt;
    if (r.x > WW + 14) r.x = 10;
    place(r.g, r.x, r.y + Math.sin(tm / 400 + r.x) * 2, r.rot, 1);
  });

  acc.glu += dt * (sm.sugar * 18);
  while (acc.glu >= 1) {
    acc.glu--;
    const p = free(glucose);
    if (p) emit(p, rnd(16, 40), rnd(240, 260), rnd(55, 75), 0, 0);
  }
  glucose.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt;
    p.y += Math.sin(tm / 250 + p.x) * 0.4;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(tm / 4) + ")");
    if (p.x > WW - 16) kill(p);
  });

  /* 4. Gut lumen chyme */
  acc.gut += dt * 3.2;
  while (acc.gut >= 1) {
    acc.gut--;
    const p = free(gutChyme);
    if (p) emit(p, 26, rnd(355, 395), rnd(28, 44), 0, 0);
  }
  gutChyme.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt;
    p.y += Math.sin(tm / 350 + p.x) * 0.3;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.x > 255) kill(p);
  });

  /* 5. Native incretins emitted from L and K cells */
  acc.inc += dt * 3.8;
  while (acc.inc >= 1) {
    acc.inc--;
    const isGlp = Math.random() < 0.55;
    const pl = isGlp ? nativeGlp : nativeGip;
    const p = free(pl);
    if (p) {
      const srcX = isGlp ? (Math.random() < 0.5 ? 85 : 205) : 145;
      emit(p, srcX + rnd(-4, 4), 326, rnd(-4, 4), -rnd(16, 28), isGlp ? 1 : 2);
    }
  }

  /* DPP-4 enzymes chomping */
  const jawAngle = Math.abs(Math.sin(tm / 200)) * 26;
  ["dpp4-1", "dpp4-2"].forEach((id) => {
    const top = $(id + "-top"), bot = $(id + "-bot");
    if (top) top.setAttribute("transform", "rotate(" + f1(-jawAngle) + ")");
    if (bot) bot.setAttribute("transform", "rotate(" + f1(jawAngle) + ")");
  });

  const dppLocs = [{ x: 115, y: 305 }, { x: 225, y: 310 }];
  [nativeGlp, nativeGip].forEach((pl) => {
    pl.forEach((p) => {
      if (!p.on) return;
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");

      /* Check DPP-4 proximity: snip within moments! */
      for (const dpp of dppLocs) {
        if (Math.hypot(p.x - dpp.x, p.y - dpp.y) < 18) {
          kill(p);
          /* Emit fading fragments */
          for (let f = 0; f < 2; f++) {
            const fr = free(dpp4Frags);
            if (fr) emit(fr, p.x, p.y, (f === 0 ? -1 : 1) * rnd(14, 24), rnd(-12, 12), 0);
          }
          break;
        }
      }
      if (p.y < 275 || p.t > 2.8) kill(p);
    });
  });

  dpp4Frags.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const op = Math.max(0, 1 - p.t / 0.7);
    p.e.setAttribute("opacity", op.toFixed(2));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") rotate(" + f1(p.t * 180) + ")");
    if (p.t > 0.7) kill(p);
  });

  /* Albumin complex bobbing */
  const albComp = $("alb-complex");
  if (albComp) {
    albComp.setAttribute("transform", "translate(180, " + f1(298 + Math.sin(tm / 700) * 1.6) + ")");
  }
  const albHead = $("alb-drug-head");
  if (albHead) {
    albHead.setAttribute("opacity", m.d > 0 ? "1" : "0.15");
    albHead.setAttribute("fill", m.d === 2 ? "var(--c-gip)" : "var(--c-glp1)");
  }

  /* 6. Pancreatic Islet: Insulin and Glucagon granules */
  acc.ins += dt * (sm.insulin * sm.sugar * 16);
  while (acc.ins >= 1) {
    acc.ins--;
    const p = free(insulinGranules);
    if (p) {
      const bx = 405 + rnd(-22, 22), by = 130 + rnd(-16, 20);
      emit(p, bx, by, rnd(-3, 3), rnd(28, 48), 0);
    }
  }
  insulinGranules.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y > 248) kill(p);
  });

  acc.gcg += dt * (sm.glucagon * 14);
  while (acc.gcg >= 1) {
    acc.gcg--;
    const p = free(glucagonGranules);
    if (p) {
      const ax = 405 + (Math.random() < 0.5 ? -38 : 36) + rnd(-6, 6);
      const ay = 130 + rnd(-30, 15);
      emit(p, ax, ay, rnd(-4, 4), rnd(24, 40), 0);
    }
  }
  glucagonGranules.forEach((p) => {
    if (!p.on) return;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y > 248) kill(p);
  });

  /* 7. Receptor Zoom Inset: docking, cAMP sparks, vesicle fusion */
  const semaKey = $("sema-key"), tirzKey = $("tirz-key");
  const pGlp = $("glp1-pocket"), pGip = $("gip-pocket");
  if (m.d === 1) {
    if (semaKey) semaKey.setAttribute("opacity", "1");
    if (tirzKey) tirzKey.setAttribute("opacity", "0");
    if (pGlp) pGlp.style.stroke = "var(--anatomy-lit)";
    if (pGip) pGip.style.stroke = "var(--c-gip)";
  } else if (m.d === 2) {
    if (semaKey) semaKey.setAttribute("opacity", "0");
    if (tirzKey) tirzKey.setAttribute("opacity", "1");
    if (pGlp) pGlp.style.stroke = "var(--anatomy-lit)";
    if (pGip) pGip.style.stroke = "var(--anatomy-lit)";
  } else {
    if (semaKey) semaKey.setAttribute("opacity", "0");
    if (tirzKey) tirzKey.setAttribute("opacity", "0");
    if (pGlp) pGlp.style.stroke = "var(--c-glp1)";
    if (pGip) pGip.style.stroke = "var(--c-gip)";
  }

  /* cAMP sparks */
  acc.spark += dt * (m.d === 2 ? 14 : m.d === 1 ? 8 : 1.2);
  while (acc.spark >= 1) {
    acc.spark--;
    const p = free(campSparks);
    if (p) {
      const srcX = m.d === 2 ? (Math.random() < 0.5 ? 558 : 612) : 558;
      emit(p, srcX + rnd(-6, 6), 146, rnd(-16, 16), rnd(14, 30), 0);
    }
  }
  campSparks.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const op = Math.max(0, 1 - p.t / 0.85);
    p.e.setAttribute("opacity", op.toFixed(2));
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ") scale(" + (1 + p.t * 0.8).toFixed(2) + ")");
    if (p.t > 0.85) kill(p);
  });

  /* Insulin vesicle fusion */
  acc.ves += dt * (sm.insulin * 4.5);
  while (acc.ves >= 1) {
    acc.ves--;
    const p = free(zoomVesicles);
    if (p) emit(p, rnd(550, 620), 170, 0, -rnd(16, 26), 0);
  }
  zoomVesicles.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    p.y += p.vy * dt;
    p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    if (p.y <= 140) kill(p);
  });

  /* 8. Brain / Hypothalamus Appetite Ripple Rings */
  const rings = [
    { el: $("app-ring-1"), ph: 0 },
    { el: $("app-ring-2"), ph: 0.33 },
    { el: $("app-ring-3"), ph: 0.67 }
  ];
  const hunger = sm.appetite;
  const ringSpeed = lerp(12, 38, hunger);
  const maxR = lerp(26, 52, hunger);
  const ringCol = hunger > 0.45 ? "var(--c-bad)" : "var(--c-good)";
  rings.forEach((r) => {
    if (!r.el) return;
    const progress = ((tm / 1000 * ringSpeed / maxR + r.ph) % 1);
    const radius = 8 + progress * (maxR - 8);
    const op = (1 - progress) * lerp(0.35, 0.85, hunger);
    r.el.setAttribute("r", f1(radius));
    r.el.setAttribute("stroke", ringCol);
    r.el.setAttribute("stroke-width", f1(lerp(1.1, 2.0, hunger)));
    r.el.setAttribute("opacity", op.toFixed(2));
  });

  /* 9. Stomach chyme and pylorus transit */
  acc.stom += dt * (sm.emptying * 5.5);
  while (acc.stom >= 1) {
    acc.stom--;
    const p = free(stomachChyme);
    if (p) emit(p, 735, 355, 0, 0, 0);
  }
  stomachChyme.forEach((p) => {
    if (!p.on) return;
    p.t += dt;
    const duration = lerp(4.5, 1.8, sm.emptying);
    const u = p.t / duration;
    if (u >= 1) {
      kill(p);
    } else {
      const pt = trStomachEmpty.at(u);
      p.x = pt.x + Math.sin(tm / 300 + p.t * 5) * 2;
      p.y = pt.y + Math.cos(tm / 300 + p.t * 5) * 2;
      p.e.setAttribute("transform", "translate(" + f1(p.x) + " " + f1(p.y) + ")");
    }
  });

  /* Pyloric sphincter muscle constriction */
  const pGap = lerp(1.5, 6.5, sm.emptying);
  const pTop = $("pylorus-top"), pBot = $("pylorus-bot");
  if (pTop) pTop.setAttribute("d", "M132 " + f1(63 - pGap) + " Q137 63 142 " + f1(63 - pGap));
  if (pBot) pBot.setAttribute("d", "M132 " + f1(63 + pGap) + " Q137 63 142 " + f1(63 + pGap));

  /* 10. Gauges readout */
  gg.sugar.set(sm.sugar, sm.sugar < 0.26 ? (m.l === 0 ? "normal" : "controlled") : sm.sugar < 0.5 ? "controlled" : "high");
  gg.insulin.set(sm.insulin, sm.insulin < 0.45 ? "inadequate" : "matched");
  gg.glucagon.set(sm.glucagon, sm.glucagon < 0.3 ? "low" : sm.glucagon < 0.6 ? "raised" : "high");
  gg.emptying.set(sm.emptying, sm.emptying < 0.22 ? "slow" : sm.emptying < 0.35 ? "delayed" : "normal");
  gg.appetite.set(sm.appetite, sm.appetite < 0.20 ? "suppressed" : sm.appetite < 0.40 ? "reduced" : sm.appetite < 0.60 ? "normal" : "high");
  gg.weight.set(sm.weight, sm.weight < 0.20 ? "falling fast" : sm.weight < 0.40 ? "falling" : sm.weight < 0.70 ? "stable" : "rising");

  /* Key cards: the active treatment card is bright, the other dimmed */
  if (m.d !== lastCardD) {
    lastCardD = m.d;
    const cS = $("key-card-sema"), cT = $("key-card-tirz");
    if (cS) cS.classList.toggle("is-active", m.d === 1);
    if (cT) cT.classList.toggle("is-active", m.d === 2);
  }

  /* 11. Ad mode automatic loop (7s cycle, only advances during live playback) */
  if (isAd && tm > 0) {
    adTimer += dt;
    const banner = $("ad-banner"), bannerTxt = $("ad-text");
    if (banner) banner.setAttribute("opacity", "1");
    if (adTimer >= 7) {
      adTimer = 0;
      adIdx = (adIdx + 1) % adSteps.length;
      const st = adSteps[adIdx];
      if (levelBox.value !== String(st.level)) {
        levelBox.value = String(st.level);
        levelBox.dispatchEvent(new Event("input"));
      }
      if (drugBox.value !== String(st.drug)) {
        drugBox.value = String(st.drug);
        drugBox.dispatchEvent(new Event("change"));
      }
    }
    if (bannerTxt) {
      const curCaption = adSteps[adIdx].caption;
      if (bannerTxt.textContent !== curCaption && adTimer < 3.5) {
        bannerTxt.textContent = curCaption;
      }
      let op = 1;
      if (adTimer < 0.5) op = 0.2 + 0.8 * (adTimer / 0.5);
      else if (adTimer > 6.5) op = 0.2 + 0.8 * ((7 - adTimer) / 0.5);
      bannerTxt.setAttribute("opacity", op.toFixed(2));
    }
  }
}

run({ init, step });
