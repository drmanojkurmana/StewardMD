/* Ophthalmós Tools: clinical calculators for learning. ES5. Loaded after ophthalmos-screens.js and
   ophthalmos-tools-model.js (all arithmetic lives there, under test). Each tool is one screen: the result sits on
   top and updates as you type, the inputs follow, then the rule drawn out (grid, chart, meridians) and the source.
   Registers in OPHTHALMOS._tools; the hub lists them under "Tools". */
(function (G) {
  "use strict";
  var O = G.OPHTHALMOS, M = G.OPHTHALMOS_TOOLS;
  if (!O || !O._internal || !M) return;
  var I = O._internal, st = O._st, A = I.ACTIONS;
  var ico = I.ico, esc = I.esc, sg = M.signed, nm = M.num, NB = " ";
  var cur = null, mem = {}, sayT = 0;

  function $(id) { return G.document.getElementById(id); }
  function D(v) { return sg(v, 2) + NB + "D"; }
  function clone(o) { var r = {}, k; for (k in o) if (o.hasOwnProperty(k)) r[k] = o[k]; return r; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function kv(label, value, extra) {
    return '<div class="tl-kv"><span>' + label + "</span><b>" + value + "</b>" + (extra ? "<small>" + extra + "</small>" : "") + "</div>";
  }
  function big(label, value, unit, tone) {
    return '<p class="tl-big' + (tone ? " " + tone : "") + '"><span>' + label + "</span><b>" + value +
      (unit ? '<small>' + NB + unit + "</small>" : "") + "</b></p>";
  }
  function deco(n) { return '<span class="tl-ico" aria-hidden="true">' + ico(n) + "</span>"; }
  function months(fu) {
    if (!fu) return "";
    return fu[0] === fu[1] ? fu[0] + (fu[0] === 1 ? " month" : " months") : fu[0] + " to " + fu[1] + " months";
  }

  /* ================= the tools ================= */
  var Q = [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4"]];
  function rx(r) {
    var c = M.round(r.c, 2);
    return c ? sg(r.s) + " / " + sg(r.c) + " × " + r.ax : sg(r.s) + NB + "DS";
  }

  var REFR = {
    id: "refr", title: "Refraction", sub: "Transpose, vertex distance", icon: "sliders",
    src: "Thin-lens optics", cite: "Source: thin-lens effective power, as in Elkington, Frank, Greaney, Clinical Optics, 1999.",
    rule: "Transpose: add the cylinder to the sphere, flip the cylinder’s sign, turn the axis 90°. Vertex: each principal meridian F becomes F ÷ (1 − dF), d in metres moved toward the eye.",
    init: { s: -2, c: -1.5, ax: 180, vf: 12, vt: 0 },
    fields: [
      { k: "s", label: "Sphere", name: "the sphere", unit: "D", step: 0.25, dp: 2, min: -30, max: 30, signed: true, neg: true },
      { k: "c", label: "Cylinder", name: "the cylinder", unit: "D", step: 0.25, dp: 2, min: -15, max: 15, signed: true, neg: true },
      { k: "ax", label: "Axis", name: "the axis", unit: "°", step: 5, dp: 0, min: 1, max: 180, wrap: true },
      { t: "h", label: "Vertex distance" },
      { k: "vf", label: "Refracted at", name: "the refracting distance", unit: "mm", step: 1, dp: 0, min: 0, max: 30, hint: "Back vertex distance of the trial frame or phoropter" },
      { k: "vt", label: "Worn at", name: "the wearing distance", unit: "mm", step: 1, dp: 0, min: 0, max: 30, hint: "0 is the corneal plane: a contact lens" }
    ],
    calc: function (v) {
      var p = { s: v.s, c: v.c, ax: M.axis(v.ax) };
      return { rx: p, other: M.transpose(p), se: M.sphEq(p), vx: M.vertex(p, v.vf, v.vt) };
    },
    where: function (v) { return v.vt === 0 ? "At the cornea" : "At " + v.vt + NB + "mm"; },
    sum: function (v, r) {
      var form = !r.other.c ? "Other cylinder form" : r.other.c > 0 ? "Plus-cylinder form" : "Minus-cylinder form";
      var same = v.vf === v.vt;
      return kv(form, r.other.c ? rx(r.other) : "Sphere only") +
        kv("Spherical equivalent", D(r.se)) +
        kv(this.where(v), same ? "No change" : rx(r.vx), same ? "" : "To 0.25 D steps: " + rx(r.vx.q));
    },
    det: function (v, r) {
      if (!r) return "";
      return '<h3 class="oph-h3">Principal meridians</h3><table class="tl-tab"><thead><tr><th scope="col">Meridian</th>' +
        '<th scope="col">At ' + v.vf + NB + "mm</th><th scope=\"col\">" + (v.vt === 0 ? "At the cornea" : "At " + v.vt + NB + "mm") + "</th></tr></thead><tbody>" +
        r.vx.meridians.map(function (m) { return "<tr><th scope=\"row\">" + m.at + "°</th><td>" + D(m.from) + "</td><td>" + D(m.to) + "</td></tr>"; }).join("") +
        "</tbody></table>" + (Math.abs(r.rx.s) < 4 && Math.abs(r.rx.s + r.rx.c) < 4
          ? '<p class="oph-small">Below about 4 D the change is small; it grows quickly with power.</p>' : "");
    },
    say: function (v, r) { return "Spherical equivalent " + D(r.se) + ". " + this.where(v) + ", " + (v.vf === v.vt ? "no change" : rx(r.vx)) + "."; }
  };

  var VA_F = {
    m6: { label: "Snellen, metric", name: "the Snellen denominator", prefix: "6/", dp: 1, trim: true },
    f20: { label: "Snellen, imperial", name: "the Snellen denominator", prefix: "20/", dp: 1, trim: true },
    dec: { label: "Decimal acuity", name: "the decimal acuity", dp: 2 },
    logmar: { label: "logMAR", name: "the logMAR value", dp: 2, neg: true },
    letters: { label: "ETDRS letters", name: "the letter score", dp: 0, unit: "letters" }
  };
  function vaIn(kind, L, line) {
    if (kind === "m6") return line ? +line[1] : M.round(6 * Math.pow(10, L), 1);
    if (kind === "f20") return line ? +line[2] : M.round(20 * Math.pow(10, L), 1);
    if (kind === "dec") return line ? +line[3] : M.round(Math.pow(10, -L), 2);
    if (kind === "logmar") return M.round(L, 2);
    return Math.round(85 - 50 * L);
  }
  var VA = {
    id: "va", title: "Visual acuity", sub: "Snellen, logMAR and letters", icon: "eye",
    src: "Gregori, Feuer, Rosenfeld 2010",
    cite: "Sources: Gregori, Feuer, Rosenfeld 2010 (letters from Snellen); chart lines from Ferris, Kassoff, Bresnick, Bailey 1982 (ETDRS).",
    rule: "logMAR = log10(denominator ÷ numerator). ETDRS letters = 85 − 50 × logMAR, to the nearest letter.",
    init: { kind: "m6", val: 12 },
    fields: function (v) {
      var K = VA_F[v.kind], R = M.VA_KINDS[v.kind];
      return [
        { k: "kind", t: "seg", label: "Enter as", opts: [["m6", "6/"], ["f20", "20/"], ["dec", "Decimal"], ["logmar", "logMAR"], ["letters", "Letters"]], convert: true },
        { k: "val", label: K.label, name: K.name, prefix: K.prefix, unit: K.unit, dp: K.dp, trim: K.trim, neg: K.neg, min: R.min, max: R.max, noStep: true }
      ];
    },
    calc: function (v) { return M.va(v.kind, v.val); },
    sum: function (v, r) {
      var cell = function (k, label, value) {
        return '<div class="tl-va' + (v.kind === k ? " on" : "") + '"><b>' + value + "</b><span>" + label + "</span></div>";
      };
      return '<div class="tl-vas">' + cell("m6", "Metric", "6/" + r.m6) + cell("f20", "Imperial", "20/" + r.f20) +
        cell("dec", "Decimal", r.decTxt) + cell("logmar", "logMAR", nm(r.logmar, 2)) +
        cell("letters", "Letters", r.letters == null ? "off chart" : r.letters) + "</div>" +
        '<p class="tl-line">' + (r.onLine ? "On the 6/" + r.nearest[1] + " line of the ETDRS chart."
          : "Between chart lines; nearest is 6/" + r.nearest[1] + " (logMAR " + nm(r.nearest[0], 1) + ").") +
        (r.letters == null ? " The ETDRS chart runs from 0 to 100 letters." : "") + "</p>";
    },
    det: function (v, r) {
      var on = r && r.onLine ? r.nearest[0] : null;
      return '<h3 class="oph-h3" id="tlLinesH">ETDRS chart lines</h3><div class="tl-lines" role="group" aria-labelledby="tlLinesH">' +
        '<div class="tl-lrow tl-lhead" aria-hidden="true"><span>Metric</span><span>Imperial</span><span>Decimal</span><span>logMAR</span><span>Letters</span></div>' +
        M.LINES.map(function (x) {
          var L = x[0], dec = x[3], lt = Math.round(85 - 50 * L);
          return '<button type="button" class="tl-lrow" data-act="tline" data-l="' + L + '"' + (on === L ? ' aria-current="true"' : "") +
            ' aria-label="6/' + x[1] + ", 20/" + x[2] + ", decimal " + dec + ", logMAR " + nm(L, 1) + ", " + lt + ' letters">' +
            "<span>6/" + x[1] + "</span><span>20/" + x[2] + "</span><span>" + dec + "</span><span>" + nm(L, 1) + "</span><span>" + lt + "</span></button>";
        }).join("") + "</div>";
    },
    say: function (v, r) { return "6/" + r.m6 + ", 20/" + r.f20 + ", decimal " + r.decTxt + ", logMAR " + nm(r.logmar, 2) + (r.letters == null ? "" : ", " + r.letters + " letters") + "."; }
  };

  var IOL = {
    id: "iol", title: "IOL power", sub: "SRK/T for a target", icon: "calc",
    src: "Retzlaff, Sanders, Kraff 1990",
    cite: "Source: Retzlaff, Sanders, Kraff 1990, J Cataract Refract Surg 16:333, with the 1990 erratum (16:528) to the axial length correction.",
    rule: "SRK/T predicts where the lens will sit (ELP) from the corneal height and the A-constant, then solves thin-lens vergence for the target at a 12 mm vertex.",
    init: { al: 23.5, k1: 43.25, k2: 44, a: 118.7, tg: -0.5 },
    fields: [
      { k: "al", label: "Axial length", name: "the axial length", unit: "mm", step: 0.1, dp: 2, min: 15, max: 40 },
      { k: "k1", label: "K1", name: "K1", unit: "D", step: 0.25, dp: 2, min: 30, max: 60, hint: "Flat meridian" },
      { k: "k2", label: "K2", name: "K2", unit: "D", step: 0.25, dp: 2, min: 30, max: 60, hint: "Steep meridian" },
      { k: "a", label: "A-constant", name: "the A-constant", step: 0.1, dp: 1, min: 110, max: 125, hint: "The lens’s optimised SRK/T constant" },
      { k: "tg", label: "Target refraction", name: "the target", unit: "D", step: 0.25, dp: 2, min: -10, max: 10, signed: true, neg: true }
    ],
    calc: function (v) { return M.srkt({ al: v.al, k1: v.k1, k2: v.k2, a: v.a, target: v.tg }); },
    sum: function (v, r) {
      var warn = r.caution ? '<p class="tl-warn">' + deco("warn") + "<span>Axial length " + (r.caution === "short" ? "under 22" : "over 26") +
        NB + "mm: SRK/T is less reliable here and other formulas are preferred, such as Barrett Universal II or Kane.</span></p>" : "";
      return big("IOL for " + D(v.tg), nm(r.power, 2), "D") + kv("For emmetropia", nm(r.emmetropia, 2) + NB + "D") + warn;
    },
    det: function (v, r) {
      if (!r) return "";
      var e = r.eye;
      return '<h3 class="oph-h3">Nearest lenses in 0.5 D steps</h3><table class="tl-tab"><thead><tr><th scope="col">Lens</th><th scope="col">Predicted refraction</th><th scope="col"><span class="tl-sr">Note</span></th></tr></thead><tbody>' +
        r.lenses.map(function (l) {
          return "<tr" + (l.closest ? ' class="on"' : "") + "><th scope=\"row\">" + nm(l.power, 1) + NB + "D</th><td>" + D(l.refraction) + "</td><td>" + (l.closest ? "Closest to target" : "") + "</td></tr>";
        }).join("") + "</tbody></table>" +
        '<h3 class="oph-h3">Inside the formula</h3><div class="tl-kvs">' +
        kv("Average K", nm(e.K, 2) + NB + "D") + kv("Corneal radius", nm(e.r, 2) + NB + "mm") +
        kv("Axial length used", nm(e.lcor, 2) + NB + "mm", v.al > 24.2 ? "Corrected for a long eye (LCOR)" : "") +
        kv("Corneal height", nm(e.h, 2) + NB + "mm") + kv("Predicted lens position (ELP)", nm(e.elp, 2) + NB + "mm") +
        kv("Optical axial length", nm(e.lopt, 2) + NB + "mm", "Axial length plus retinal thickness") + "</div>";
    },
    say: function (v, r) { return "IOL for target " + nm(r.power, 2) + " dioptres; for emmetropia " + nm(r.emmetropia, 2) + "."; }
  };

  var ROP_ROWS = [[1, "plus", "Zone I, plus"], [1, "none", "Zone I, no plus"], [2, "plus", "Zone II, plus"], [2, "none", "Zone II, no plus"], [3, "none", "Zone III"]];
  var ROP_V = {
    1: { head: "Type 1", tone: "bad", act: "Treat." },
    2: { head: "Type 2", tone: "warn", act: "Watch closely; treat only if it progresses to type 1." },
    0: { head: "Neither type", tone: "", act: "Keep examining on the screening schedule." },
    rd: { head: "Stage 4 or 5", tone: "bad", act: "Retinal detachment is outside the ETROP types, which cover stages 1 to 3." },
    arop: { head: "A-ROP", tone: "bad", act: "Outside the ETROP types. Severe plus with rapid progression needs prompt review by the treating ROP specialist." }
  };
  var ROP = {
    id: "rop", title: "ROP treatment", sub: "ETROP type 1 or 2", icon: "baby",
    src: "ETROP 2003 · ICROP3 2021",
    cite: "Sources: Early Treatment for ROP Cooperative Group 2003, Arch Ophthalmol 121:1684; ICROP3, Chiang et al. 2021, Ophthalmology 128:e51.",
    rule: function (v, r) { return r && r.rule ? "ETROP: " + r.rule : "ETROP type 1: zone I any stage with plus; zone I stage 3; zone II stage 2 or 3 with plus. Type 2: zone I stage 1 or 2; zone II stage 3; both without plus."; },
    init: { zone: 2, stage: 2, plus: "none", arop: false },
    fields: [
      { k: "zone", t: "seg", label: "Zone", opts: [[1, "I"], [2, "II"], [3, "III"]] },
      { k: "stage", t: "seg", label: "Stage", opts: [[0, "None"], [1, "1"], [2, "2"], [3, "3"], [4, "4 or 5"]] },
      { k: "plus", t: "seg", label: "Posterior pole vessels", opts: [["none", "Normal"], ["pre", "Pre-plus"], ["plus", "Plus"]] },
      { t: "chks", items: [{ k: "arop", label: "Aggressive ROP (A-ROP)", hint: "Rapid neovascularisation and severe plus, without passing through the usual stages" }] }
    ],
    calc: function (v) { return M.etrop(v); },
    sum: function (v, r) {
      var x = ROP_V[r.type];
      return big(typeof r.type === "number" ? "ETROP" : "Outside ETROP", x.head, "", x.tone) + '<p class="tl-act">' + x.act + "</p>";
    },
    det: function (v, r) {
      var live = r && !v.arop && v.stage >= 1 && v.stage <= 3;
      var row = v.zone === 3 ? 4 : (v.zone - 1) * 2 + (v.plus === "plus" ? 0 : 1);
      var T = { 1: ["Type 1", "c1"], 2: ["Type 2", "c2"], 0: ["Neither", "c0"] };
      return '<h3 class="oph-h3">The ETROP grid</h3><table class="tl-tab tl-grid tl-rop"><thead><tr><td></td><th scope="col">Stage 1</th><th scope="col">Stage 2</th><th scope="col">Stage 3</th></tr></thead><tbody>' +
        ROP_ROWS.map(function (x, i) {
          return "<tr><th scope=\"row\"" + (live && i === row ? ' class="on"' : "") + ">" + x[2] + "</th>" + [1, 2, 3].map(function (s) {
            var t = T[M.etrop({ zone: x[0], stage: s, plus: x[1] }).type], here = live && i === row && s === v.stage;
            return '<td class="' + t[1] + (here ? " here" : "") + '"' + (here ? ' aria-current="true"' : "") + ">" + t[0] + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table>" +
        '<ul class="tl-notes">' +
        (v.plus === "pre" ? "<li>Pre-plus is not plus: it does not change the ETROP type.</li>" : "") +
        "<li>Plus disease: ETROP compared vessels with a standard photograph. ICROP3 judges plus from the vessels within zone I, not by counting quadrants, and treats normal, pre-plus and plus as a continuum.</li>" +
        "<li>ICROP3 replaced AP-ROP with A-ROP: it is not confined to zone I and is seen in larger preterm infants too.</li></ul>";
    },
    say: function (v, r) { var x = ROP_V[r.type]; return x.head + ". " + x.act + (r.rule ? " " + r.rule : ""); }
  };

  var DR = {
    id: "dr", title: "DR severity", sub: "ICDR level and review interval", icon: "droplet",
    src: "ICDR 2003 · AAO PPP 2024",
    cite: "Sources: Wilkinson et al. 2003, Ophthalmology 110:1677 (international scale); AAO Diabetic Retinopathy PPP, 2024 edition (Lim et al., Ophthalmology 2025;132:P75), Table 5 for follow-up.",
    rule: "4-2-1 rule: severe NPDR when any one is present: more than 20 intraretinal haemorrhages in each of 4 quadrants, definite venous beading in 2 or more, prominent IRMA in 1 or more.",
    init: { ma: false, hem: false, ex: false, hemQ: 0, vbQ: 0, irmaQ: 0, nvd: false, nve: false, nvMod: false, vh: false, dme: "none" },
    fields: [
      { t: "h", label: "Non-proliferative signs" },
      { t: "chks", items: [{ k: "ma", label: "Microaneurysms" }, { k: "hem", label: "Intraretinal haemorrhages" }, { k: "ex", label: "Hard exudates or cotton-wool spots" }] },
      { k: "hemQ", t: "seg", label: "Quadrants with more than 20 intraretinal haemorrhages", opts: Q },
      { k: "vbQ", t: "seg", label: "Quadrants with definite venous beading", opts: Q },
      { k: "irmaQ", t: "seg", label: "Quadrants with prominent IRMA", opts: Q },
      { t: "h", label: "Proliferative signs" },
      { t: "chks", items: [{ k: "nvd", label: "New vessels at the disc (NVD)", hint: "On or within 1 disc diameter of the disc" },
        { k: "nve", label: "New vessels elsewhere (NVE)" },
        { k: "nvMod", label: "At least moderate new vessels", hint: "NVD larger than 1/4 to 1/3 disc area, or NVE at least 1/2 disc area" },
        { k: "vh", label: "Vitreous or preretinal haemorrhage" }] },
      { k: "dme", t: "seg", label: "Diabetic macular oedema", stack: true, opts: [["none", "None"], ["nci", "Present, not involving the centre"], ["ci", "Centre-involved"]] }
    ],
    calc: function (v) { return M.icdr(v); },
    sum: function (v, r) {
      var sub = r.level === 4 ? (r.highRisk ? "High-risk PDR" : "Non-high-risk PDR") : r.verySevere ? "Very severe NPDR: two or more 4-2-1 features" : "";
      var dme = { none: "", nci: "Non-centre-involved DME", ci: "Centre-involved DME" }[r.dme];
      var fu = r.followUp
        ? kv("Follow-up", months(r.followUp), r.key === "moderate" && r.dme === "none" ? "Sooner if signs approach severe NPDR" : "")
        : '<p class="tl-warn">' + deco("warn") + "<span>Macular oedema with no retinopathy recorded. Check the findings; the PPP table has no row for this.</span></p>";
      return big("International scale", r.name, "", (r.level === 4 ? "bad " : "") + "txt") +
        (sub || dme ? '<p class="tl-act">' + [sub, dme].filter(Boolean).join(" · ") + "</p>" : "") + fu;
    },
    det: function (v, r) {
      if (!r) return "";
      var mark = function (on) { return '<i class="tl-mk' + (on ? " on" : "") + '" aria-hidden="true">' + (on ? ico("check") : "") + "</i>"; };
      var row = function (on, label, found) { return '<li class="' + (on ? "on" : "") + '">' + mark(on) + "<span>" + label + "</span><b>" + found + "</b>" + (on ? '<span class="tl-sr">, met</span>' : "") + "</li>"; };
      var h = '<h3 class="oph-h3">4-2-1 rule</h3><ul class="tl-rule421">' +
        row(r.rule421[0], "More than 20 haemorrhages, all 4 quadrants", v.hemQ + " of 4") +
        row(r.rule421[1], "Venous beading, 2 or more quadrants", v.vbQ + " of 2") +
        row(r.rule421[2], "IRMA, 1 or more quadrants", v.irmaQ + " of 1") + "</ul>" +
        '<p class="oph-small">Any one makes severe NPDR. Two or more is very severe NPDR, which the international scale groups with severe.</p>';
      if (r.level === 4) {
        h += '<h3 class="oph-h3">High-risk PDR: any 3 of 4 (DRS)</h3><ul class="tl-rule421">' +
          row(r.drs[0], "New vessels anywhere", "") + row(r.drs[1], "New vessels at or near the disc", "") +
          row(r.drs[2], "At least moderate new vessels", "") + row(r.drs[3], "Vitreous or preretinal haemorrhage", "") + "</ul>" +
          '<p class="oph-small">' + r.nDrs + " of 4 present.</p>";
      }
      return h;
    },
    sync: function (v) {
      var b = $("tlc-nvMod"); if (b) b.disabled = !(v.nvd || v.nve);
    },
    say: function (v, r) { return r.name + (r.highRisk ? ", high-risk" : "") + ". " + (r.followUp ? "Follow-up " + months(r.followUp) + "." : ""); }
  };

  var UM_SUB = { a: "without ciliary body involvement or extraocular extension", b: "with ciliary body involvement",
    c: "with extraocular extension of 5 mm or less, no ciliary body involvement", d: "with ciliary body involvement and extraocular extension of 5 mm or less" };
  var UM = {
    id: "um", title: "Uveal melanoma", sub: "AJCC 8th T category", icon: "ribbon",
    src: "AJCC 8th edition",
    cite: "Source: AJCC Cancer Staging Manual, 8th edition, uveal melanoma (Kivelä et al.); grid as reproduced by Baron, Di Nicola, Shields 2018. Choroid and ciliary body only: iris melanoma has its own T categories.",
    rule: "Find the size category in the grid from the largest basal diameter and the thickness, then add a to e: b ciliary body, c extraocular extension up to 5 mm, d both, e extension over 5 mm.",
    init: { lbd: 10, th: 3.5, cb: false, exe: "none" },
    fields: [
      { k: "lbd", label: "Largest basal diameter", name: "the basal diameter", unit: "mm", step: 0.5, dp: 1, min: 0.1, max: 30 },
      { k: "th", label: "Thickness", name: "the thickness", unit: "mm", step: 0.5, dp: 1, min: 0.1, max: 25 },
      { t: "chks", items: [{ k: "cb", label: "Ciliary body involvement" }] },
      { k: "exe", t: "seg", label: "Extraocular extension", opts: [["none", "None"], ["le5", "5 mm or less"], ["gt5", "Over 5 mm"]] }
    ],
    calc: function (v) { return M.ajcc(v); },
    sum: function (v, r) {
      return big("AJCC 8th", r.t, "") + '<p class="tl-act">' + (r.sub === "e"
        ? "Extraocular extension over 5 mm makes it T4e whatever the size (size category " + r.size + ")."
        : "Size category " + r.size + ", " + UM_SUB[r.sub] + ".") + "</p>";
    },
    det: function (v, r) {
      var TH = ["≤3", "≤6", "≤9", "≤12", "≤15", ">15"], LB = ["≤3", "≤6", "≤9", "≤12", "≤15", "≤18", ">18"], rows = "";
      for (var i = 5; i >= 0; i--) {
        rows += "<tr><th scope=\"row\"" + (r && r.row === i ? ' class="on"' : "") + ">" + TH[i] + "</th>" + M.AJCC_GRID[i].map(function (s, j) {
          var here = r && r.row === i && r.col === j;
          return '<td class="s' + s + (here ? " here" : "") + '"' + (here ? ' aria-current="true"' : "") + ">" + s + "</td>";
        }).join("") + "</tr>";
      }
      return '<h3 class="oph-h3" id="tlGridH">Size categories</h3><p class="oph-small tl-axes">Thickness down the side, largest basal diameter across the top, in millimetres.</p>' +
        '<div class="tl-gridwrap"><table class="tl-tab tl-grid tl-um" aria-labelledby="tlGridH">' +
        '<thead><tr><td class="tl-corner">mm</td>' + LB.map(function (x, j) {
          return "<th scope=\"col\"" + (r && r.col === j ? ' class="on"' : "") + ">" + x + "</th>";
        }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
        '<p class="oph-small">Each band starts 0.1 mm above the one before it: 3.1 to 6.0, 6.1 to 9.0 and so on.</p>';
    },
    say: function (v, r) { return r.t + ". Size category " + r.size + "."; }
  };

  var TOOLS = [REFR, VA, IOL, ROP, DR, UM];

  /* ================= form engine ================= */
  function fieldsOf(t, v) { return typeof t.fields === "function" ? t.fields(v) : t.fields; }
  function field(k) {
    var fs = fieldsOf(cur.t, cur.v);
    for (var i = 0; i < fs.length; i++) if (fs[i].k === k) return fs[i];
    return null;
  }
  function fmtVal(f, v) {
    var s = Math.abs(v).toFixed(f.dp);
    if (f.trim && s.indexOf(".") >= 0) s = s.replace(/\.?0+$/, "");
    if (+s === 0) return s;
    return (v < 0 ? M.MINUS : f.signed ? "+" : "") + s;
  }
  function check(f, raw) {
    if (!String(raw).replace(/\s/g, "")) return { err: "Enter " + f.name + "." };
    var v = M.parse(raw);
    if (isNaN(v)) return { err: "Enter a number." };
    v = M.round(v, f.dp);
    if (f.wrap && v === 0) v = 180;
    if (v < f.min || v > f.max) return { err: "Use " + fmtVal(f, f.min) + " to " + fmtVal(f, f.max) + (f.unit ? NB + f.unit : "") + "." };
    return { v: v };
  }

  function numHtml(f, v) {
    var id = "tl-" + f.k, e = id + "-e", h = f.hint ? id + "-h" : "";
    var stp = function (d) {
      var n = (d > 0 ? "+" : M.MINUS) + f.step;
      return '<button type="button" class="tl-st" data-act="tstep" data-k="' + f.k + '" data-d="' + d + '" aria-label="' +
        esc(f.label) + (d > 0 ? " up " : " down ") + f.step + (f.unit ? " " + f.unit : "") + '">' + n + "</button>";
    };
    return '<div class="tl-f" id="tlf-' + f.k + '"><label class="tl-l" for="' + id + '">' + esc(f.label) + "</label>" +
      (f.hint ? '<span class="tl-h" id="' + h + '">' + esc(f.hint) + "</span>" : "") +
      '<div class="tl-in">' + (f.noStep ? "" : stp(-1)) +
      '<div class="tl-box">' + (f.prefix ? '<span class="tl-pre" aria-hidden="true">' + f.prefix + "</span>" : "") +
      '<input id="' + id + '" name="' + f.k + '" data-k="' + f.k + '" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done"' +
      ' value="' + esc(v == null ? "" : fmtVal(f, v)) + '" aria-describedby="' + (h ? h + " " : "") + e + '">' +
      (f.unit ? '<span class="tl-u" aria-hidden="true">' + f.unit + "</span>" : "") + "</div>" +
      (f.noStep ? "" : stp(1)) +
      (f.neg ? '<button type="button" class="tl-st tl-sign" data-act="tsign" data-k="' + f.k + '" aria-label="Change the sign of ' + esc(f.label) + '">±</button>' : "") +
      '</div><p class="tl-e" id="' + e + '" aria-live="polite"></p></div>';
  }
  function segHtml(f, v) {
    var id = "tll-" + f.k;
    return '<div class="tl-f"><span class="tl-l" id="' + id + '">' + esc(f.label) + "</span>" +
      '<div class="' + (f.stack ? "tl-stack" : "oph-seg tl-seg") + '" role="group" aria-labelledby="' + id + '">' +
      f.opts.map(function (o) {
        return '<button type="button" data-act="tset" data-k="' + f.k + '" data-v="' + esc(String(o[0])) + '" aria-pressed="' + (v === o[0]) + '">' +
          (f.stack ? '<i class="tl-dot" aria-hidden="true"></i>' : "") + esc(o[1]) + "</button>";
      }).join("") + "</div></div>";
  }
  function chksHtml(f, v) {
    return '<div class="tl-chks">' + f.items.map(function (x) {
      return '<label class="tl-chk"><input type="checkbox" id="tlc-' + x.k + '" data-k="' + x.k + '"' + (v[x.k] ? " checked" : "") + ">" +
        "<span>" + esc(x.label) + (x.hint ? "<small>" + esc(x.hint) + "</small>" : "") + "</span></label>";
    }).join("") + "</div>";
  }
  function formHtml() {
    var v = cur.v;
    return fieldsOf(cur.t, v).map(function (f) {
      if (f.t === "h") return '<h2 class="oph-h2 tl-gh">' + esc(f.label) + "</h2>";
      if (f.t === "seg") return segHtml(f, v[f.k]);
      if (f.t === "chks") return chksHtml(f, v);
      return numHtml(f, v[f.k]);
    }).join("");
  }

  function showErr(k, msg) {
    var box = $("tlf-" + k), e = $("tl-" + k + "-e"), inp = $("tl-" + k);
    if (!box) return;
    e.textContent = msg || "";
    if (msg) { box.setAttribute("data-bad", ""); inp.setAttribute("aria-invalid", "true"); }
    else { box.removeAttribute("data-bad"); inp.removeAttribute("aria-invalid"); }
  }
  function setVal(f, v) {
    cur.v[f.k] = v; delete cur.bad[f.k]; cur.shown[f.k] = false;
    var inp = $("tl-" + f.k); if (inp) inp.value = fmtVal(f, v);
    showErr(f.k, "");
    update();
  }

  /* ================= screen ================= */
  function open(t) {
    cur = { t: t, v: clone(mem[t.id] || t.init), bad: {}, shown: {} };
    st.view = "tool-" + t.id;
    I.paint(I.top("Back to calculators", esc(t.title), esc(t.sub)) +
      '<div class="oph-scroll" id="tlScroll"><div class="tl-wrap">' +
      '<div class="tl-sumwrap"><section class="tl-sum" id="tlSum" aria-label="Result"></section></div>' +
      '<div class="tl-form" id="tlForm">' + formHtml() + "</div>" +
      '<div class="tl-det" id="tlDet"></div>' +
      '<footer class="tl-src"><p class="tl-rule" id="tlRule"></p><p>' + esc(t.cite) + "</p><p>For learning, not for clinical decisions.</p></footer>" +
      '</div></div><p class="tl-sr" id="tlSay" role="status" aria-live="polite" aria-atomic="true"></p>');
    st.onLeave = function () { if (cur) mem[cur.t.id] = cur.v; G.clearTimeout(sayT); cur = null; };
    var f = $("tlForm");
    f.addEventListener("input", onInput);
    f.addEventListener("change", onChange);
    f.addEventListener("focusout", onBlur);
    f.addEventListener("keydown", onKey);
    update();
  }

  function update() {
    var t = cur.t, first = null, k;
    for (k in cur.bad) if (cur.bad.hasOwnProperty(k) && !first) first = k;
    var r = first ? null : t.calc(cur.v);
    $("tlSum").innerHTML = r ? t.sum(cur.v, r)
      : '<p class="tl-wait">' + deco("info") + "<span>Check " + esc(((field(first) || {}).label || "the value").replace(/^[A-Z](?=[a-z])/, function (c) { return c.toLowerCase(); })) +
        ": " + esc(cur.bad[first].charAt(0).toLowerCase() + cur.bad[first].slice(1)) + "</span></p>";
    $("tlDet").innerHTML = t.det(cur.v, r);
    $("tlRule").textContent = typeof t.rule === "function" ? t.rule(cur.v, r) : t.rule;
    if (t.sync) t.sync(cur.v);
    var said = r ? t.say(cur.v, r) : "";
    G.clearTimeout(sayT);
    sayT = G.setTimeout(function () { var s = $("tlSay"); if (s && said) s.textContent = said; }, 700);
  }

  function onInput(e) {
    var inp = e.target, k = inp.getAttribute && inp.getAttribute("data-k");
    if (!k || inp.type !== "text") return;
    var f = field(k), c = check(f, inp.value);
    if (c.err) { cur.bad[k] = c.err; if (cur.shown[k]) showErr(k, c.err); }
    else { cur.v[k] = c.v; delete cur.bad[k]; showErr(k, ""); cur.shown[k] = false; }
    update();
  }
  function onBlur(e) {
    var inp = e.target, k = inp.getAttribute && inp.getAttribute("data-k");
    if (!k || inp.type !== "text" || !cur) return;
    var f = field(k);
    if (cur.bad[k]) { cur.shown[k] = true; showErr(k, cur.bad[k]); }
    else inp.value = fmtVal(f, cur.v[k]);
  }
  function onChange(e) {
    var inp = e.target, k = inp.getAttribute && inp.getAttribute("data-k");
    if (!k || inp.type !== "checkbox") return;
    cur.v[k] = inp.checked;
    update();
  }
  function onKey(e) {
    var inp = e.target, k = inp.getAttribute && inp.getAttribute("data-k");
    if (!k || inp.type !== "text") return;
    if (e.key === "Enter") { e.preventDefault(); inp.blur(); return; }
    var f = field(k);
    if (!f.noStep && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); step(f, e.key === "ArrowUp" ? 1 : -1); }
  }

  function step(f, d) {
    var base = cur.bad[f.k] ? cur.t.init[f.k] : cur.v[f.k], v = M.round(base + d * f.step, f.dp);
    if (f.wrap) { if (v > 180) v -= 180; if (v < 1) v += 180; }
    setVal(f, clamp(v, f.min, f.max));
  }

  A.tstep = function (b) { if (!cur) return; step(field(b.getAttribute("data-k")), +b.getAttribute("data-d")); I.haptic("tap"); };
  A.tsign = function (b) {
    if (!cur) return;
    var f = field(b.getAttribute("data-k"));
    if (cur.bad[f.k]) return;
    setVal(f, clamp(-cur.v[f.k], f.min, f.max));
  };
  A.tset = function (b) {
    if (!cur) return;
    var k = b.getAttribute("data-k"), raw = b.getAttribute("data-v"), f = field(k), val = null;
    f.opts.forEach(function (o) { if (String(o[0]) === raw) val = o[0]; });
    if (val === cur.v[k]) return;
    if (f.convert) {
      // Switching notation keeps the same acuity, re-expressed in the new one.
      if (!cur.bad.val) {
        var r = M.va(cur.v.kind, cur.v.val);
        cur.v.val = vaIn(val, r.logmar, r.onLine ? r.nearest : null);
      } else cur.v.val = cur.t.init.val;
      cur.v[k] = val; cur.bad = {}; cur.shown = {};
      $("tlForm").innerHTML = formHtml();
      var p = G.document.querySelector('#tlForm [data-k="' + k + '"][aria-pressed="true"]');
      try { if (p) p.focus({ preventScroll: true }); } catch (x) {}
    } else {
      cur.v[k] = val;
      Array.prototype.forEach.call(b.parentNode.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    }
    update();
  };
  A.tline = function (b) {
    if (!cur) return;
    var L = +b.getAttribute("data-l"), line = null;
    M.LINES.forEach(function (x) { if (x[0] === L) line = x; });
    setVal(field("val"), vaIn(cur.v.kind, L, line));
    I.haptic("tap");
  };

  TOOLS.forEach(function (t) {
    t.open = function () { open(t); };
    O._tools.push({ id: t.id, title: t.title, sub: t.sub, icon: t.icon, src: t.src, open: t.open });
  });
})(typeof window !== "undefined" ? window : this);
