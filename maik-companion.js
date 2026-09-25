/* maik-companion.js - MaiK's companion, version 2 (owner, 2026-09-25: "redesign him to be more
 * professional and more lively and understanding ... I will select one from 3").
 *
 * Three styles on one engine. localStorage smd_maik_doc_style picks one; "classic" keeps the Fable
 * pixel doctor that lives in home.js.
 *   attending  Dr. MaiK in a white coat, tie and glasses. Calm and precise; he saves stunts for good news.
 *   oncall     Dr. MaiK in scrubs and a cap. Energetic: quick on his feet, coffee close on night shifts.
 *   bot        MaiK Bot, a hovering robot doctor whose screen face shows how he feels.
 *
 * Architecture
 *   Brain     classify(question) + the event handlers: what is happening in MaiK -> how he reacts.
 *             On-device keyword intent (urgent, cardiac, respiratory, drug, lab, score, children, thanks,
 *             greeting, grief, frustration). No network, no delay, nothing stored.
 *   Director  one activity at a time (enter, idle, walk, run, listen, think, read, sit, sleep) plus a
 *             short gesture on top (wave, hop, heart, thumbs, nod, shrug, bow...), with cooldowns and
 *             caps. Calm while the doctor reads; alive on events.
 *   Rig       springs drive hand and foot targets; two-bone IK places elbows and knees; a handful of
 *             SVG paths and transforms are written only when they change.
 * Energy: the rAF loop runs only while something on him moves. Idle, asleep, swiped away or with the
 * app hidden it parks (no frames at all). Reduced motion: he stays put; expressions change without
 * travel, jumps or floating particles. Decorative only: aria-hidden, never intercepts the thread.
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || window.MaiKCompanion) return;

  var STYLES = ["attending", "oncall", "bot"];
  var LABEL = { attending: "Dr. MaiK, Attending", oncall: "Dr. MaiK, On-Call", bot: "MaiK Bot" };
  var BLURB = {
    attending: "White coat and glasses. Calm and precise; saves the stunts for good news.",
    oncall: "Scrubs and cap. Energetic and quick on his feet, coffee close on night shifts.",
    bot: "A hovering robot doctor. His screen face shows exactly how he feels."
  };

  /* ================================= Brain ================================= */
  var KINDS = [
    ["urgent", /\b(arrest|code blue|anaphyla|shock|status epilep|seizur|stroke|stemi|unrespons|apnoea|apnea|collaps|emergen|resus|haemorrhag|hemorrhag|massive bleed|overdose|poison)/],
    ["sad", /\b(died|death|passed away|demise|bad news|grief|bereave\w*|palliative|end of life|comfort care|dnr)\b/],
    ["cardiac", /\b(heart|cardiac|chest pain|palpitat|ecg|ekg|murmur|arrhythm|atrial|tachycard|bradycard|angina|troponin)/],
    ["resp", /\b(lung|breath|dyspn|asthma|copd|pneumon|wheez|oxygen|spo2|crackle|ventilat)/],
    ["rx", /\b(dose|doses|dosing|dosage|mg|mcg|drugs?|tablets?|antibiotics?|infusion|prescri\w*|regimen|medications?)\b/],
    ["lab", /\b(lab|labs|report|cbc|haemoglobin|hemoglobin|creatinine|urea|sodium|potassium|lft|kft|rft|culture|abg|x-?ray|ct scan|mri|ultrasound|usg)\b/],
    ["calc", /\b(score|calculat\w*|bmi|egfr|gcs|curb|wells|chads\w*|meld|apgar)\b/],
    ["peds", /\b(child|children|infants?|neonat\w*|newborns?|baby|babies|paediatr\w*|pediatr\w*|toddlers?)\b/]
  ];
  var KIND_SET = { urgent: 1, sad: 1, cardiac: 1, resp: 1, rx: 1, lab: 1, calc: 1, peds: 1, thanks: 1, greet: 1, frustrated: 1, think: 1 };
  function classify(q) {
    var s = String(q == null ? "" : q).toLowerCase().replace(/\s+/g, " ").trim();
    if (!s) return "think";
    if (s.length <= 60) {
      if (/^(thank|thanks|thx|ty\b|great|awesome|perfect|excellent|brilliant|nice one|good job|well done)/.test(s)) return "thanks";
      if (/^(hi+|hello|hey|namaste|good (morning|afternoon|evening|night))\b/.test(s)) return "greet";
    }
    if (s.length <= 90 && /\b(wrong|incorrect|not helpful|useless|bad answer|makes no sense|not correct|not right)\b/.test(s)) return "frustrated";
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(s)) return KINDS[i][0];
    return "think";
  }
  var PEARLS = [
    "Auscultate twice, order once.",
    "The best test is the one that changes management.",
    "Treat the patient, not the number.",
    "A good history beats a hundred tests.",
    "Common things are common.",
    "If in doubt, examine again.",
    "Trends tell you more than single values.",
    "Kindness is a clinical skill.",
    "Ask one more question than you think you need.",
    "The chart is not the patient.",
    "Write notes a tired colleague can read at 3 am.",
    "Good handovers are good medicine.",
    "Stay hydrated. You, not just the patient.",
    "Coffee is not a fluid bolus, Doctor.",
    "Rest is part of good care too.",
    "Listen to the patient. They are telling you the diagnosis.",
    "Hoofbeats? Think horses. Then look for zebras.",
    "A normal result is still a result.",
    "Check the dose, then check it again.",
    "Your calm is contagious. Use it."
  ];
  function isNight(d) { var h = d.getHours(); return h >= 22 || h < 6; }
  function greeting(d) {
    var h = d.getHours();
    if (h >= 5 && h < 12) return "Good morning, Doctor.";
    if (h >= 12 && h < 17) return "Good afternoon, Doctor.";
    if (h >= 17 && h < 22) return "Good evening, Doctor.";
    return "Night shift? I am right here with you.";
  }
  function introLine(style) {
    return (style === "bot" ? "Hi, I am MaiK Bot" : "Hi, I am Dr. MaiK") + ", your medical AI assistant. Tap me any time.";
  }
  // The greeting bubble: the time of day a third of the time, otherwise a clinical pearl.
  function pickLine(d, r) { return r < 0.34 ? greeting(d) : PEARLS[Math.floor(r * 7919) % PEARLS.length]; }

  /* Personality: speeds (px/s), jump height, how often he fidgets when idle, and what he does then. */
  var PERSONA = {
    attending: { walk: 30, run: 96, hopH: 9, joy: 0.22, ambMin: 9000, ambMax: 17000,
      amb: ["glance", "adjust", "watch", "glance", "stroll", "nod"], ambNight: ["yawn", "adjust", "glance", "stroll"] },
    oncall: { walk: 42, run: 128, hopH: 14, joy: 0.5, ambMin: 6000, ambMax: 12000,
      amb: ["hop", "stretch", "glance", "stroll", "watch", "stroll"], ambNight: ["sip", "yawn", "stretch", "stroll"] },
    bot: { walk: 36, run: 118, hopH: 12, joy: 0.4, ambMin: 7000, ambMax: 14000,
      amb: ["hop", "glance", "stroll", "scan", "hop"], ambNight: ["glance", "stroll", "scan"] }
  };
  var GDUR = { wave: 1150, hop: 900, heart: 1400, thumbs: 1300, nod: 700, shrug: 1500, palm: 1200, bow: 1300,
    yawn: 1500, stretch: 1500, glance: 1700, adjust: 1000, watch: 1300, sip: 1700, wake: 650, scan: 1500, comfort: 1800 };
  // Owner, 2026-09-25: "make him only jump rather than circle". Joy is a jump; there are no flips or spins.
  var TRAVEL = { hop: 1, stretch: 1 };   // gestures that move him through space (not under reduced motion)

  /* ================================= Utils ================================= */
  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function tr(el, v) { if (el && el._t !== v) { el._t = v; el.setAttribute("transform", v); } }
  function setD(el, v) { if (el && el._d !== v) { el._d = v; el.setAttribute("d", v); } }
  function setA(el, k, v) { if (el) { var key = "_a" + k; if (el[key] !== v) { el[key] = v; el.setAttribute(k, v); } } }

  // A damped spring: slight overshoot (zeta ~0.8) reads as alive without wobbling.
  function Spring(v, k, d) { this.x = v; this.v = 0; this.t = v; this.k = k || 170; this.d = d || 21; }
  Spring.prototype.step = function (dt) {
    if (this.x === this.t && this.v === 0) return;
    this.v += ((this.t - this.x) * this.k - this.v * this.d) * dt; this.x += this.v * dt;
    if (Math.abs(this.t - this.x) < 0.005 && Math.abs(this.v) < 0.03) { this.x = this.t; this.v = 0; }
  };
  Spring.prototype.snap = function () { this.x = this.t; this.v = 0; };
  Spring.prototype.still = function () { return this.x === this.t && this.v === 0; };

  // Two-bone IK: shoulder/hip S, target T -> elbow/knee E and the reachable end H.
  // Elbows hang low; knees point forward and up.
  function ik(sx, sy, tx, ty, l1, l2, knee) {
    var dx = tx - sx, dy = ty - sy, d = Math.sqrt(dx * dx + dy * dy);
    var mx = l1 + l2 - 0.02, mn = Math.abs(l1 - l2) + 0.02;
    if (d < 1e-4) { dx = 0; dy = mn; d = mn; }
    if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; } else if (d < mn) { dx *= mn / d; dy *= mn / d; d = mn; }
    var a = Math.atan2(dy, dx), c = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), b = Math.acos(clamp(c, -1, 1));
    var e1x = sx + l1 * Math.cos(a + b), e1y = sy + l1 * Math.sin(a + b), e2x = sx + l1 * Math.cos(a - b), e2y = sy + l1 * Math.sin(a - b);
    var first = knee ? (e1x - 0.6 * e1y > e2x - 0.6 * e2y) : (e1y > e2y);
    return { ex: first ? e1x : e2x, ey: first ? e1y : e2y, hx: sx + dx, hy: sy + dy };
  }

  /* ================================= Skins ================================= */
  // Character space: feet on y=0, facing right; the SVG flips for left. viewBox -23 -52 46 54.
  var SKIN = {
    attending: { top: "coat", skin: "#EDB891", skinSh: "#D99A72", hair: "#1E2A33", hairHi: "#3A4C57",
      body: "#F7FAFB", bodySh: "#DCE6EA", line: "#B5C6CC", shirt: "#D9EDF8", tie: "#0E6E63",
      pants: "#2B3A45", shoe: "#101920", steth: "#0F766E", bell: "#C9D6DA", glasses: true },
    oncall: { top: "scrubs", skin: "#EDB891", skinSh: "#D99A72", hair: "#1E2A33", hairHi: "#3A4C57",
      body: "#13877B", bodySh: "#0D6B61", line: "#0A5A52", cap: "#22A897", capLn: "#15806F", capDot: "#B4F1E8",
      mask: "#D3EAF3", pants: "#0E6E65", shoe: "#F4F7F8", sole: "#2DD4BF", steth: "#23313A", bell: "#DCE4E8" }
  };
  var HUM = { hipB: [-2.4, -16], hipF: [2.6, -16], shB: [-6.2, -30], shF: [6, -30], L1: 6.9, L2: 6.4, T1: 8.3, T2: 7.6,
    restHB: [-9.1, -17.7], restHF: [7.6, -17.8], restFB: [-3.3, -1.5], restFF: [3.4, -1.5] };
  var BOTG = { shB: [-8.4, -23], shF: [8.4, -23], L1: 4.3, L2: 4.1, restHB: [-10.4, -15.8], restHF: [10.4, -15.8] };

  var MOUTH = {
    smile: '<path d="M-.4,-36.2 Q1.5,-34.5 3.4,-36.3" fill="none" stroke="#7A3B32" stroke-width=".75" stroke-linecap="round"/>',
    grin: '<path d="M-.7,-36.5 Q1.5,-36.9 3.7,-36.5 Q3.2,-33.7 1.5,-33.6 Q-.2,-33.7 -.7,-36.5 Z" fill="#6E3029"/><path d="M.3,-34.5 Q1.5,-35.3 2.7,-34.5 Q2,-33.8 1.5,-33.8 Q.9,-33.8 .3,-34.5 Z" fill="#E07A6A"/>',
    flat: '<path d="M.1,-35.6 L2.9,-35.6" fill="none" stroke="#7A3B32" stroke-width=".75" stroke-linecap="round"/>',
    o: '<ellipse cx="1.5" cy="-35.3" rx=".95" ry="1.15" fill="#6E3029"/>',
    frown: '<path d="M-.1,-34.9 Q1.5,-36.1 3.1,-34.9" fill="none" stroke="#7A3B32" stroke-width=".75" stroke-linecap="round"/>',
    sleep: '<path d="M.5,-35.5 Q1.5,-35.1 2.5,-35.5" fill="none" stroke="#7A3B32" stroke-width=".7" stroke-linecap="round"/>'
  };
  function propSVG(name, k) {
    switch (name) {
      case "clipboard": return '<g transform="translate(0 -3.4)"><rect x="-2.9" y="-3.9" width="5.8" height="7.4" rx=".7" fill="#8A6A4E"/><rect x="-2.35" y="-3.2" width="4.7" height="6.2" rx=".3" fill="#FFFFFF"/><rect x="-1" y="-4.4" width="2" height="1.1" rx=".4" fill="#A7B6BC"/><path d="M-1.6,-1.5 h3.2 M-1.6,-.1 h3.2 M-1.6,1.3 h2.2" stroke="#A9B8BE" stroke-width=".45"/></g>';
      case "pen": return '<g transform="rotate(-28)"><rect x="-.38" y="-4.8" width=".76" height="4.4" rx=".35" fill="#0E6E63"/><path d="M-.38,-.45 L0,.55 L.38,-.45 Z" fill="#1B2329"/></g>';
      case "book": return '<g transform="translate(-2.9 -1.8)"><path d="M-4.3,-2.4 Q-2,-3.2 0,-2 Q2,-3.2 4.3,-2.4 L4.3,2 Q2,1.3 0,2.4 Q-2,1.3 -4.3,2 Z" fill="#0E6E63"/><path d="M-3.7,-1.9 Q-1.9,-2.5 -.15,-1.5 L-.15,1.8 Q-1.9,.9 -3.7,1.4 Z M.15,-1.5 Q1.9,-2.5 3.7,-1.9 L3.7,1.4 Q1.9,.9 .15,1.8 Z" fill="#FDFEFE"/></g>';
      case "coffee": return '<g transform="translate(0 -2.2)"><path d="M-1.9,-3.3 L1.9,-3.3 L1.45,2 L-1.45,2 Z" fill="#F6F1E9"/><rect x="-1.85" y="-1.4" width="3.7" height="1.7" fill="#8B5E3C"/><rect x="-2.15" y="-4.1" width="4.3" height="1" rx=".45" fill="#D8CFC2"/></g>';
      case "rxpad": return '<g transform="translate(0 -3.2)"><rect x="-2.4" y="-3.1" width="4.8" height="5.9" rx=".5" fill="#fff" stroke="#B5C6CC" stroke-width=".4"/><text x="-1.7" y="-.1" font-size="2.9" font-weight="800" font-family="Inter,system-ui,sans-serif" fill="#0E6E63">Rx</text><path d="M-1.6,1.2 h3" stroke="#B5C6CC" stroke-width=".4"/></g>';
      case "bell": return '<path d="M0,0 C-2.4,-2.6 -5.8,-4.4 -9.6,-4.6" fill="none" stroke="' + ((k && k.steth) || "#0F766E") + '" stroke-width="1" stroke-linecap="round"/><circle r="1.75" fill="#C9D6DA" stroke="' + ((k && k.steth) || "#0F766E") + '" stroke-width=".55"/><circle r=".65" fill="#F4F8FA"/>';
      case "thumb": return '<rect x="-.75" y="-4.9" width="1.6" height="3.9" rx=".8" fill="' + ((k && k.skin) || "#EDB891") + '" stroke="' + ((k && k.skinSh) || "#D99A72") + '" stroke-width=".35"/>';
      case "palm": return '<ellipse cx=".2" cy="-.9" rx="1.9" ry="2.5" fill="' + ((k && k.skin) || "#EDB891") + '"/><path d="M-1,-3 v-1.2 M.2,-3.3 v-1.3 M1.4,-3 v-1.1" stroke="' + ((k && k.skin) || "#EDB891") + '" stroke-width=".9" stroke-linecap="round"/>';
      case "tablet": return '<g transform="translate(-4.2 -2)"><rect x="-3.2" y="-2.3" width="6.4" height="4.4" rx=".8" fill="#0C1B22" stroke="#B7C7CD" stroke-width=".45"/><path d="M-2.2,-.8 h3 M-2.2,.5 h4.2" stroke="#5EEAD4" stroke-width=".5" stroke-linecap="round"/></g>';
    }
    return "";
  }

  function pathD(pts) { var s = ""; for (var i = 0; i < pts.length; i += 2) s += (i ? "L" : "M") + r2(pts[i]) + " " + r2(pts[i + 1]); return s; }
  function armPts(sh, h, g) { var k = ik(sh[0], sh[1], h[0], h[1], g.L1, g.L2, false); return [sh[0], sh[1], k.ex, k.ey, k.hx, k.hy]; }
  function legPts(hp, f) { var k = ik(hp[0], hp[1], f[0], f[1], HUM.T1, HUM.T2, true); return [hp[0], hp[1], k.ex, k.ey, k.hx, k.hy]; }

  function humanSVG(k) {
    var coat = k.top === "coat";
    var aB = armPts(HUM.shB, HUM.restHB, HUM), aF = armPts(HUM.shF, HUM.restHF, HUM);
    var lB = legPts(HUM.hipB, HUM.restFB), lF = legPts(HUM.hipF, HUM.restFF);
    function leg(cls, p) {
      return '<g class="mkc-' + cls + '"><path class="mkc-' + cls + 'p" d="' + pathD(p) + '" fill="none" stroke="' + k.pants + '" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<g class="mkc-' + cls + 's" transform="translate(' + r2(p[4]) + ' ' + r2(p[5]) + ')"><rect x="-1.9" y="-1.1" width="6.4" height="2.6" rx="1.3" fill="' + k.shoe + '"/>' +
        (k.sole ? '<rect x="-1.9" y=".8" width="6.4" height=".7" rx=".35" fill="' + k.sole + '"/>' : "") + "</g></g>";
    }
    function arm(cls, p, back) {
      var col = back ? k.bodySh : k.body, s = '<g class="mkc-' + cls + '">';
      if (coat) {
        s += '<path class="mkc-' + cls + 'o" d="' + pathD(p) + '" fill="none" stroke="' + k.line + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
        s += '<path class="mkc-' + cls + 'm" d="' + pathD(p) + '" fill="none" stroke="' + col + '" stroke-width="3.9" stroke-linecap="round" stroke-linejoin="round"/>';
      } else {
        var mx = p[0] + (p[2] - p[0]) * 0.9, my = p[1] + (p[3] - p[1]) * 0.9;
        s += '<path class="mkc-' + cls + 'f" d="' + pathD([mx, my, p[2], p[3], p[4], p[5]]) + '" fill="none" stroke="' + k.skin + '" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>';
        s += '<path class="mkc-' + cls + 'm" d="' + pathD([p[0], p[1], mx, my]) + '" fill="none" stroke="' + col + '" stroke-width="4.3" stroke-linecap="round"/>';
      }
      s += '<circle class="mkc-' + cls + 'h" cx="' + r2(p[4]) + '" cy="' + r2(p[5]) + '" r="1.85" fill="' + k.skin + '"/></g>';
      return s;
    }
    var s = '<svg class="mkc-svg" width="46" height="54" viewBox="-23 -52 46 54" aria-hidden="true" focusable="false"><g class="mkc-root">';
    s += leg("legB", lB) + arm("armB", aB, true) + leg("legF", lF);
    // torso + head (the torso group drops when he sits)
    s += '<g class="mkc-torso">';
    if (coat) {
      s += '<path d="M-7.9,-29.6 Q-7.9,-31.8 -5.7,-31.9 L5.9,-31.9 Q8.1,-31.8 8.1,-29.6 L9.3,-9.5 Q9.4,-8.2 8.1,-8.2 L-8.1,-8.2 Q-9.4,-8.2 -9.2,-9.5 Z" fill="' + k.body + '" stroke="' + k.line + '" stroke-width=".55"/>';
      s += '<path d="M-7.9,-29.6 L-9.2,-9.5 Q-9.3,-8.3 -8.1,-8.3 L-5.9,-8.3 L-5.6,-29.8 Z" fill="' + k.bodySh + '"/>';
      s += '<path d="M-3.4,-31.9 L4.6,-31.9 L0.9,-24.4 Z" fill="' + k.shirt + '"/>';
      s += '<path d="M0.2,-31.7 L1.7,-31.7 L1.35,-30.3 L2.2,-25.3 L0.95,-23.9 L-0.3,-25.3 L0.55,-30.3 Z" fill="' + k.tie + '"/>';
      s += '<path d="M-3.4,-31.9 L0.9,-24.2 L-1.3,-22.4 M4.6,-31.9 L0.9,-24.2 L3.1,-22.4" fill="none" stroke="' + k.line + '" stroke-width=".6" stroke-linejoin="round"/>';
      s += '<path d="M0.9,-24 L0.9,-8.5" stroke="' + k.line + '" stroke-width=".5"/><circle cx="1.9" cy="-18.6" r=".42" fill="' + k.line + '"/><circle cx="1.9" cy="-14" r=".42" fill="' + k.line + '"/>';
      s += '<rect x="-6.4" y="-24.2" width="4" height=".55" rx=".25" fill="' + k.line + '"/><rect x="-5.5" y="-26.4" width=".85" height="2.5" rx=".4" fill="#0E6E63"/>';
      s += '<rect x="3.3" y="-22.8" width="3.7" height="4.6" rx=".7" fill="#fff" stroke="' + k.line + '" stroke-width=".4"/><rect x="3.3" y="-22.8" width="3.7" height="1.35" rx=".6" fill="#2DD4BF"/><rect x="3.9" y="-20.6" width="2.5" height=".45" rx=".2" fill="#9FB1B8"/><rect x="3.9" y="-19.7" width="1.7" height=".45" rx=".2" fill="#C3CFD4"/>';
    } else {
      s += '<path d="M-7.6,-29.8 Q-7.6,-31.8 -5.6,-31.9 L5.8,-31.9 Q7.8,-31.8 7.8,-29.8 L8.5,-12.6 Q8.5,-11.4 7.3,-11.4 L-7.3,-11.4 Q-8.5,-11.4 -8.4,-12.6 Z" fill="' + k.body + '"/>';
      s += '<path d="M-7.6,-29.8 L-8.4,-12.6 Q-8.5,-11.5 -7.3,-11.5 L-5.4,-11.5 L-5.2,-30 Z" fill="' + k.bodySh + '"/>';
      s += '<path d="M-2.8,-31.9 L4.2,-31.9 L0.8,-26.2 Z" fill="' + k.bodySh + '"/><path d="M-2.8,-31.9 L0.8,-26.2 L4.2,-31.9" fill="none" stroke="' + k.line + '" stroke-width=".55" stroke-linejoin="round"/>';
      s += '<path d="M2.6,-25.2 h4 v2.8 q0,1 -1,1 h-2 q-1,0 -1,-1 z" fill="none" stroke="' + k.line + '" stroke-width=".5"/><rect x="3.4" y="-26.8" width=".8" height="2.2" rx=".35" fill="#F5C84C"/><rect x="4.6" y="-26.5" width=".8" height="1.9" rx=".35" fill="#E8EEF1"/>';
      s += '<rect x="-6.1" y="-24.6" width="3.3" height="4.2" rx=".6" fill="#fff"/><rect x="-6.1" y="-24.6" width="3.3" height="1.2" rx=".55" fill="#F5C84C"/><rect x="-5.6" y="-22.7" width="2.2" height=".42" rx=".2" fill="#9FB1B8"/>';
      s += '<path d="M-8.3,-13.6 L8.4,-13.6" stroke="' + k.line + '" stroke-width=".5" opacity=".6"/>';
    }
    // stethoscope around the neck, chest piece resting on the chest
    s += '<path d="M-4.4,-31.4 C-5.5,-27 -4.1,-23.4 -1.2,-22.2 M5,-31.4 C6.1,-27.2 4.5,-23.4 1.7,-22.3 M-1.2,-22.2 Q0.2,-22.9 1.7,-22.3" fill="none" stroke="' + k.steth + '" stroke-width="1.05" stroke-linecap="round"/>';
    s += '<g class="mkc-bell"><path d="M0.2,-22.5 C0.3,-20.4 -.1,-19.2 -1.1,-18" fill="none" stroke="' + k.steth + '" stroke-width="1.05" stroke-linecap="round"/><circle cx="-1.5" cy="-17.1" r="1.55" fill="' + k.bell + '" stroke="' + k.steth + '" stroke-width=".55"/><circle cx="-1.5" cy="-17.1" r=".6" fill="#F4F8FA"/></g>';
    // head
    s += '<g class="mkc-head"><rect x="-1.4" y="-34.2" width="3.8" height="3.2" rx="1" fill="' + k.skinSh + '"/>';
    s += '<ellipse cx="-6.8" cy="-40" rx="1.55" ry="2.15" fill="' + k.skin + '"/><ellipse cx="-6.8" cy="-40" rx=".7" ry="1.1" fill="' + k.skinSh + '"/>';
    s += '<ellipse cx="0.8" cy="-40.4" rx="7.7" ry="8.1" fill="' + k.skin + '"/><path d="M-6,-37.2 Q-5.2,-33.8 -1.6,-32.7 Q-4.6,-34.2 -6,-37.2 Z" fill="' + k.skinSh + '" opacity=".5"/>';
    if (k.cap) {
      s += '<path d="M-7.9,-40.6 C-8.2,-39 -7.6,-37.6 -6.9,-36.9 L-6.3,-40 Z" fill="' + k.hair + '"/>';
      s += '<path d="M-7.9,-40.6 C-8.4,-47.6 -3.8,-51 1.2,-50.8 C6.6,-50.6 9.8,-47.4 9,-41.6 C6.6,-43.8 3.4,-44.6 .6,-44.4 C-2.6,-44.2 -5.4,-43 -7.9,-40.6 Z" fill="' + k.cap + '"/>';
      s += '<path d="M-7.9,-40.6 C-5.4,-43 -2.6,-44.2 .6,-44.4 C3.4,-44.6 6.6,-43.8 9,-41.6" fill="none" stroke="' + k.capLn + '" stroke-width=".8"/>';
      s += '<g fill="' + k.capDot + '" opacity=".9"><circle cx="-4.2" cy="-47" r=".55"/><circle cx="-.6" cy="-49" r=".55"/><circle cx="3.2" cy="-48.6" r=".55"/><circle cx="6.4" cy="-46.2" r=".55"/><circle cx="-5.6" cy="-43.8" r=".5"/><circle cx="1.4" cy="-46.2" r=".5"/><circle cx="4.8" cy="-44.2" r=".45"/><circle cx="-2.2" cy="-45.4" r=".5"/></g>';
      s += '<path d="M-7.6,-42.8 q-2.2,.6 -2.7,2.5 M-7.6,-42.3 q-1.5,1.5 -1.1,3.3" stroke="' + k.cap + '" stroke-width=".75" fill="none" stroke-linecap="round"/>';
    } else {
      s += '<path d="M-7.3,-40.2 C-8.3,-46.8 -4.2,-50.3 1,-50.1 C6.3,-49.9 9.3,-46.9 8.6,-42.2 C7.6,-44.8 5.1,-46.2 2.4,-45.9 C.3,-44.5 -2.4,-44.3 -4.8,-44.8 C-5.6,-43.3 -6.4,-41.9 -7.3,-40.2 Z" fill="' + k.hair + '"/>';
      s += '<path d="M-7.3,-40.2 C-7.8,-38.2 -7.2,-36.5 -6.5,-35.8 L-5.9,-39.2 Z" fill="' + k.hair + '"/>';
      s += '<path d="M-3.1,-48.4 C-.1,-49.5 3.5,-49.1 5.7,-47.5" fill="none" stroke="' + k.hairHi + '" stroke-width=".85" stroke-linecap="round"/>';
    }
    s += '<g class="mkc-blush" opacity="0"><ellipse cx="-3.2" cy="-36.9" rx="1.3" ry=".75" fill="#F28B82"/><ellipse cx="5.3" cy="-37.1" rx="1.2" ry=".72" fill="#F28B82"/></g>';
    s += '<g class="mkc-eyes"><g class="mkc-eyeB"><ellipse cx="-1.9" cy="-40.2" rx="1.02" ry="1.38" fill="#1B2329"/><circle cx="-1.55" cy="-40.7" r=".36" fill="#fff"/></g>' +
      '<g class="mkc-eyeF"><ellipse cx="3.7" cy="-40.2" rx="1.02" ry="1.38" fill="#1B2329"/><circle cx="4.05" cy="-40.7" r=".36" fill="#fff"/></g></g>';
    s += '<g stroke="' + k.hair + '" stroke-width=".78" stroke-linecap="round" fill="none"><path class="mkc-browB" d="M-3.2,-43.5 Q-1.9,-44.3 -0.6,-43.7"/><path class="mkc-browF" d="M2.4,-43.8 Q3.7,-44.5 5,-43.6"/></g>';
    s += '<path d="M4.6,-39.6 Q5.6,-38.1 4.4,-37.4" fill="none" stroke="' + k.skinSh + '" stroke-width=".6" stroke-linecap="round"/>';
    s += '<g class="mkc-mouth">' + MOUTH.smile + "</g>";
    if (k.glasses) s += '<g fill="rgba(255,255,255,.18)" stroke="#2B3A45" stroke-width=".55"><rect x="-3.7" y="-41.9" width="3.7" height="3.2" rx="1.15"/><rect x="1.8" y="-41.9" width="3.9" height="3.2" rx="1.15"/><path d="M0,-40.5 L1.8,-40.5 M-3.7,-40.6 L-6.3,-41.3" fill="none"/></g>';
    if (k.mask) s += '<path d="M-2.8,-33.3 Q1,-31.6 4.9,-33.4 L4.4,-31.2 Q1,-29.8 -2.3,-31.1 Z" fill="' + k.mask + '"/><path d="M-2.8,-33.3 L-6.4,-38.6" stroke="#BFD6E0" stroke-width=".4" fill="none"/>';
    s += "</g></g>";   // head, torso
    s += '<g class="mkc-propB"></g>' + arm("armF", aF, false) + '<g class="mkc-propF"></g>';
    s += "</g></svg>";
    return s;
  }

  var BOTFACE = {
    normal: '<rect x="-4.6" y="-39.4" width="2.5" height="3.8" rx="1.2" fill="#5EEAD4"/><rect x="2.1" y="-39.4" width="2.5" height="3.8" rx="1.2" fill="#5EEAD4"/><path d="M-1.6,-33.9 Q0,-32.9 1.6,-33.9" stroke="#5EEAD4" stroke-width=".7" fill="none" stroke-linecap="round"/>',
    blink: '<path d="M-4.6,-37.5 h2.5 M2.1,-37.5 h2.5" stroke="#5EEAD4" stroke-width="1" stroke-linecap="round"/><path d="M-1.6,-33.9 Q0,-32.9 1.6,-33.9" stroke="#5EEAD4" stroke-width=".7" fill="none" stroke-linecap="round"/>',
    happy: '<path d="M-4.9,-36.8 Q-3.35,-39.6 -1.8,-36.8 M1.8,-36.8 Q3.35,-39.6 4.9,-36.8" stroke="#5EEAD4" stroke-width="1.1" fill="none" stroke-linecap="round"/><path d="M-2,-34.4 Q0,-32.4 2,-34.4" stroke="#5EEAD4" stroke-width=".85" fill="none" stroke-linecap="round"/>',
    love: '<path d="M-3.35,-35.3 C-5.4,-36.7 -5.2,-38.9 -4.2,-38.9 C-3.7,-38.9 -3.35,-38.5 -3.35,-38.2 C-3.35,-38.5 -3,-38.9 -2.5,-38.9 C-1.5,-38.9 -1.3,-36.7 -3.35,-35.3 Z M3.35,-35.3 C1.3,-36.7 1.5,-38.9 2.5,-38.9 C3,-38.9 3.35,-38.5 3.35,-38.2 C3.35,-38.5 3.7,-38.9 4.2,-38.9 C5.2,-38.9 5.4,-36.7 3.35,-35.3 Z" fill="#FF7A8A"/><path d="M-1.6,-33.6 Q0,-32.5 1.6,-33.6" stroke="#5EEAD4" stroke-width=".7" fill="none" stroke-linecap="round"/>',
    think: '<rect x="-4.2" y="-40.4" width="2.2" height="3.2" rx="1.1" fill="#5EEAD4"/><rect x="2.2" y="-40.4" width="2.2" height="3.2" rx="1.1" fill="#5EEAD4"/><g class="mkc-tdots" fill="#5EEAD4"><circle cx="-1.8" cy="-33.8" r=".55"/><circle cx="0" cy="-33.8" r=".55"/><circle cx="1.8" cy="-33.8" r=".55"/></g>',
    listen: '<rect x="-4.6" y="-39.6" width="2.5" height="3.6" rx="1.2" fill="#5EEAD4"/><rect x="2.1" y="-39.6" width="2.5" height="3.6" rx="1.2" fill="#5EEAD4"/><g class="mkc-eq" fill="#5EEAD4"><rect x="-2.3" y="-35.1" width=".7" height="2" rx=".3"/><rect x="-1" y="-35.1" width=".7" height="2" rx=".3"/><rect x=".3" y="-35.1" width=".7" height="2" rx=".3"/><rect x="1.6" y="-35.1" width=".7" height="2" rx=".3"/></g>',
    scan: '<rect x="-4.6" y="-39.2" width="2.5" height="3.4" rx="1.2" fill="#5EEAD4"/><rect x="2.1" y="-39.2" width="2.5" height="3.4" rx="1.2" fill="#5EEAD4"/><rect class="mkc-scanl" x="-6.8" y="-34.6" width="3" height=".7" rx=".35" fill="#5EEAD4" opacity=".85"/>',
    ecg: '<polyline class="mkc-ecgl" points="-7,-37 -3.6,-37 -2.4,-37 -1.2,-40.6 .4,-33.6 1.6,-37 7,-37" fill="none" stroke="#5EEAD4" stroke-width=".95" stroke-linejoin="round" stroke-linecap="round"/>',
    rx: '<text x="-3.4" y="-34.9" font-size="5.2" font-weight="800" font-family="Inter,system-ui,sans-serif" fill="#5EEAD4">Rx</text>',
    concern: '<path d="M-4.7,-38.5 L-2.2,-39.5 M4.7,-38.5 L2.2,-39.5" stroke="#5EEAD4" stroke-width=".8" stroke-linecap="round"/><rect x="-4.1" y="-37.9" width="1.8" height="2.4" rx=".9" fill="#5EEAD4"/><rect x="2.3" y="-37.9" width="1.8" height="2.4" rx=".9" fill="#5EEAD4"/><path d="M-1.7,-33.4 Q0,-34.6 1.7,-33.4" stroke="#5EEAD4" stroke-width=".7" fill="none" stroke-linecap="round"/>',
    urgent: '<path d="M-4.8,-40 L-2.1,-39.1 M4.8,-40 L2.1,-39.1" stroke="#FCA5A5" stroke-width=".85" stroke-linecap="round"/><rect x="-4.5" y="-38.3" width="2.4" height="1.9" rx=".9" fill="#5EEAD4"/><rect x="2.1" y="-38.3" width="2.4" height="1.9" rx=".9" fill="#5EEAD4"/><path d="M-1.5,-33.8 h3" stroke="#5EEAD4" stroke-width=".75" stroke-linecap="round"/>',
    wow: '<circle cx="-3.3" cy="-37.6" r="1.7" fill="#5EEAD4"/><circle cx="3.3" cy="-37.6" r="1.7" fill="#5EEAD4"/><ellipse cx="0" cy="-33.6" rx=".8" ry=".95" fill="#5EEAD4"/>',
    sleep: '<path d="M-4.6,-37.3 Q-3.35,-36.3 -2.1,-37.3 M2.1,-37.3 Q3.35,-36.3 4.6,-37.3" stroke="#2A9D8F" stroke-width=".9" fill="none" stroke-linecap="round"/>'
  };
  function botSVG() {
    var aB = armPts(BOTG.shB, BOTG.restHB, BOTG), aF = armPts(BOTG.shF, BOTG.restHF, BOTG);
    function arm(cls, p) {
      return '<g class="mkc-' + cls + '"><path class="mkc-' + cls + 'o" d="' + pathD(p) + '" fill="none" stroke="#B7C7CD" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path class="mkc-' + cls + 'm" d="' + pathD(p) + '" fill="none" stroke="#E4ECEF" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<circle class="mkc-' + cls + 'h" cx="' + r2(p[4]) + '" cy="' + r2(p[5]) + '" r="1.9" fill="#2DD4BF"/></g>';
    }
    var s = '<svg class="mkc-svg" width="46" height="54" viewBox="-23 -52 46 54" aria-hidden="true" focusable="false"><defs>' +
      '<radialGradient id="mkcBotShell" cx="36%" cy="28%" r="80%"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".62" stop-color="#EAF1F4"/><stop offset="1" stop-color="#C6D5DB"/></radialGradient>' +
      '<radialGradient id="mkcBotGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#2DD4BF" stop-opacity=".7"/><stop offset="1" stop-color="#2DD4BF" stop-opacity="0"/></radialGradient></defs>';
    s += '<g class="mkc-glow"><ellipse cx="0" cy="-1.4" rx="7.5" ry="2.6" fill="url(#mkcBotGlow)"/></g><g class="mkc-root">';
    s += arm("armB", aB);
    s += '<g class="mkc-torso"><path d="M-8,-26 Q-8.7,-12.6 -4.4,-7.4 Q0,-4.4 4.4,-7.4 Q8.7,-12.6 8,-26 Q0,-29.2 -8,-26 Z" fill="url(#mkcBotShell)" stroke="#B7C7CD" stroke-width=".55"/>';
    s += '<path d="M-7.9,-17.3 Q0,-14.9 7.9,-17.3" stroke="#2DD4BF" stroke-width="1.1" fill="none"/><path d="M-5.2,-9.2 Q0,-7.4 5.2,-9.2" stroke="#D5E1E6" stroke-width=".7" fill="none"/>';
    s += '<g class="mkc-core"><path d="M0,-19.8 C-2,-21.2 -1.7,-23.4 -.65,-23.4 C-.2,-23.4 0,-23.1 0,-22.9 C0,-23.1 .2,-23.4 .65,-23.4 C1.7,-23.4 2,-21.2 0,-19.8 Z" fill="#E05252"/></g>';
    s += '<path d="M-5.6,-26.9 C-6.2,-22.6 -4,-20.4 -2.4,-20.1 M5.6,-26.9 C6.2,-22.6 4,-20.4 2.4,-20.1" stroke="#0F766E" stroke-width="1" fill="none" stroke-linecap="round"/>';
    s += '<g class="mkc-bell"><path d="M2.4,-20.1 C3.2,-17.6 3,-15.8 2.1,-14.6" stroke="#0F766E" stroke-width="1" fill="none" stroke-linecap="round"/><circle cx="1.8" cy="-13.6" r="1.45" fill="#C9D6DA" stroke="#0F766E" stroke-width=".5"/></g>';
    s += '<g class="mkc-head"><rect x="-1.6" y="-29.6" width="3.2" height="2.6" rx="1" fill="#B7C7CD"/>';
    s += '<line x1="0" y1="-45.6" x2="0" y2="-48.9" stroke="#B7C7CD" stroke-width=".9"/><circle class="mkc-ant" cx="0" cy="-49.6" r="1.35" fill="#2DD4BF"/>';
    s += '<rect x="-10.2" y="-45.8" width="20.4" height="17" rx="7" fill="url(#mkcBotShell)" stroke="#B7C7CD" stroke-width=".55"/>';
    s += '<circle cx="-10.3" cy="-37.3" r="1.9" fill="#2DD4BF"/><circle cx="10.3" cy="-37.3" r="1.9" fill="#2DD4BF"/>';
    s += '<rect x="-7.9" y="-43.4" width="15.8" height="12.2" rx="5" fill="#0C1B22"/><rect x="-7" y="-42.7" width="5.6" height="2" rx="1" fill="#FFFFFF" opacity=".09"/>';
    s += '<g class="mkc-face">' + BOTFACE.normal + "</g></g></g>";   // head, torso
    s += '<g class="mkc-propB"></g>' + arm("armF", aF) + '<g class="mkc-propF"></g></g></svg>';
    return s;
  }
  function thumb(style) { return style === "bot" ? botSVG() : humanSVG(SKIN[style] || SKIN.attending); }

  var FX = {
    heart: '<svg width="10" height="9" viewBox="0 0 10 9"><path d="M5 8.6C1.4 6 0 4.2 0 2.6 0 1.1 1.2 0 2.6 0c1 0 1.9.6 2.4 1.4C5.5.6 6.4 0 7.4 0 8.8 0 10 1.1 10 2.6c0 1.6-1.4 3.4-5 6Z" fill="#E05252"/></svg>',
    sparkle: '<svg width="11" height="11" viewBox="0 0 10 10"><path d="M5 0l1.1 3.9L10 5 6.1 6.1 5 10 3.9 6.1 0 5l3.9-1.1Z" fill="#F5C84C"/></svg>',
    check: '<svg width="15" height="15" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.4" fill="#0E6E63"/><path d="M4 7.2l2.1 2 4.1-4.3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg width="15" height="15" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.4" fill="#D97706"/><path d="M7 3.6v4.3" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="7" cy="10.3" r=".95" fill="#fff"/></svg>',
    offline: '<svg width="17" height="15" viewBox="0 0 24 21"><path d="M2 7.5a15 15 0 0 1 20 0M5.5 11a10 10 0 0 1 13 0M9 14.5a5 5 0 0 1 6 0" fill="none" stroke="#64748B" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.6" fill="#64748B"/><path d="M3 2l18 18" stroke="#D97706" stroke-width="2.4" stroke-linecap="round"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 12 12"><rect x=".5" y=".5" width="11" height="11" rx="3" fill="#fff" stroke="#E05252"/><path d="M4.8 2.6h2.4v2.2h2.2v2.4H7.2v2.2H4.8V7.2H2.6V4.8h2.2Z" fill="#E05252"/></svg>',
    ecg: '<span class="mkc-chip mkc-chip-ecg"><svg width="40" height="12" viewBox="0 0 40 12"><polyline class="mkc-ecgp" points="0,6 9,6 11,6 14,1 17,11 20,6 29,6 40,6" fill="none" stroke="#0E9F8E" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg></span>',
    zz: '<span class="mkc-chip">Z z</span>',
    dots: '<span class="mkc-chip"><span class="mkc-dots"><i></i><i></i><i></i></span></span>',
    q: '<span class="mkc-chip">?</span>',
    rx: '<span class="mkc-chip">Rx</span>',
    calc: '<span class="mkc-chip">Score</span>',
    noted: '<span class="mkc-chip">Noted</span>'
  };
  var RISE = { heart: 1, sparkle: 1, zz: 1 };

  var CSS =
    ".mkc{position:absolute;left:0;right:0;top:-36px;height:36px;pointer-events:none;z-index:1;overflow:visible}" +
    ".mkc-a{position:absolute;left:0;bottom:1px;width:46px;height:54px;pointer-events:auto;cursor:pointer;will-change:transform;transform-origin:23px 100%;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;filter:drop-shadow(0 1px 1.2px rgba(8,19,26,.26))}" +
    ".mkc-a::after{content:'';position:absolute;inset:-8px}" +
    ".mkc-svg{display:block;overflow:visible}" +
    ".mkc-sh{position:absolute;left:0;bottom:-1px;width:30px;height:6px;border-radius:50%;background:radial-gradient(50% 50% at 50% 50%,rgba(8,19,26,.3),transparent 72%);pointer-events:none;will-change:transform,opacity}" +
    ".mkc.busy .mkc-a{filter:drop-shadow(0 1px 1.2px rgba(8,19,26,.26)) drop-shadow(0 0 5px rgba(45,212,191,.42))}" +
    ".mkc.mkc-hidden .mkc-a,.mkc.mkc-hidden .mkc-sh{opacity:0;pointer-events:none;transition:opacity .16s ease}" +
    ".mkc-fx{position:absolute;pointer-events:none;transform:translate(-50%,-100%)}" +
    ".mkc-rise{animation:mkcRise 1.3s cubic-bezier(.2,.7,.3,1) forwards}" +
    ".mkc-pop{animation:mkcPop .22s cubic-bezier(.3,1.4,.5,1) both}" +
    ".mkc-chip{display:inline-flex;align-items:center;font:700 9px/1 Inter,system-ui,sans-serif;color:var(--mk-teal,#0f766e);background:var(--mk-bg,#fff);border:1px solid var(--mk-bd,#d5dde6);border-radius:7px;padding:4px 6px;white-space:nowrap;box-shadow:0 2px 6px rgba(8,19,26,.12)}" +
    ".mkc-chip-ecg{padding:2px 5px}" +
    ".mkc-dots i{display:inline-block;width:3px;height:3px;margin:0 1px;border-radius:50%;background:currentColor;animation:mkcDot 1s infinite ease-in-out}" +
    ".mkc-dots i:nth-child(2){animation-delay:.15s}.mkc-dots i:nth-child(3){animation-delay:.3s}" +
    ".mkc-ecgp{stroke-dasharray:62;stroke-dashoffset:62;animation:mkcDraw 1.1s linear forwards}" +
    ".mkc-say{position:absolute;pointer-events:none;font:600 10.5px/1.35 Inter,system-ui,sans-serif;color:var(--mk-ink,#0f172a);background:var(--mk-bg,#fff);border:1px solid var(--mk-bd,#d5dde6);border-radius:11px;padding:7px 10px;max-width:178px;width:max-content;box-shadow:0 3px 10px rgba(8,19,26,.10);animation:mkcPop .22s cubic-bezier(.3,1.4,.5,1) both;z-index:2}" +
    ".mkc-say::after{content:'';position:absolute;left:var(--mkcTail,50%);bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;border-top-color:var(--mk-bg,#fff)}" +
    ".mkc-tab{display:none;position:absolute;left:0;bottom:6px;z-index:4;width:22px;height:34px;border:1px solid var(--mk-bd,#d5dde6);border-left:0;border-radius:0 10px 10px 0;background:var(--panel,#fff);color:var(--mk-teal,#0e6e63);font:700 15px/1 Inter,system-ui,sans-serif;cursor:pointer;padding:0}" +
    ".mkc-tab.on{display:block}" +
    ".mkc-eq rect{animation:mkcEq .9s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}" +
    ".mkc-eq rect:nth-child(2){animation-delay:.15s}.mkc-eq rect:nth-child(3){animation-delay:.3s}.mkc-eq rect:nth-child(4){animation-delay:.45s}" +
    ".mkc-tdots circle{animation:mkcFade 1.1s infinite}.mkc-tdots circle:nth-child(2){animation-delay:.18s}.mkc-tdots circle:nth-child(3){animation-delay:.36s}" +
    ".mkc-scanl{animation:mkcScan 1.3s ease-in-out infinite alternate;transform-box:fill-box}" +
    ".mkc-ecgl{stroke-dasharray:30;stroke-dashoffset:30;animation:mkcDrawLoop 1.3s linear infinite}" +
    ".mkc.busy .mkc-ant{animation:mkcFade 1s ease-in-out infinite}" +
    "@keyframes mkcRise{0%{transform:translateY(2px) scale(.5);opacity:0}15%{opacity:1;transform:translateY(-3px) scale(1)}100%{transform:translateY(-24px) scale(.85);opacity:0}}" +
    "@keyframes mkcPop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}" +
    "@keyframes mkcDot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-2px);opacity:1}}" +
    "@keyframes mkcDraw{to{stroke-dashoffset:0}}" +
    "@keyframes mkcDrawLoop{to{stroke-dashoffset:-30}}" +
    "@keyframes mkcEq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}" +
    "@keyframes mkcFade{0%,100%{opacity:.3}45%{opacity:1}}" +
    "@keyframes mkcScan{from{transform:translateX(0)}to{transform:translateX(10.6px)}}" +
    "@media (prefers-reduced-motion:reduce){.mkc-rise,.mkc-pop,.mkc-say,.mkc-dots i,.mkc-eq rect,.mkc-tdots circle,.mkc-scanl,.mkc-ecgl,.mkc.busy .mkc-ant{animation:none}.mkc-ecgp{animation:none;stroke-dashoffset:0}}";
  function injectCSS() {
    if (document.getElementById("mkc-css")) return;
    var st = document.createElement("style"); st.id = "mkc-css"; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ================================= Mount ================================= */
  function mount(host, opts) {
    opts = opts || {};
    injectCSS();
    var style = STYLES.indexOf(opts.style) >= 0 ? opts.style : "attending";
    var isBot = style === "bot", K = SKIN[style] || null, P = PERSONA[style], G2 = isBot ? BOTG : HUM;
    var reduce = !!opts.reduceMotion, sleepMs = opts.sleepMs > 0 ? opts.sleepMs : 45000;
    var CW = 46, CH = 54, SVG_TOP = 36 - 1 - CH;

    var box = document.createElement("div");
    box.className = "mkc mkc-" + style;
    box.setAttribute("aria-hidden", "true");
    box.innerHTML = '<div class="mkc-sh"></div><div class="mkc-a">' + (isBot ? botSVG() : humanSVG(K)) + "</div>";
    host.appendChild(box);
    var actor = box.querySelector(".mkc-a"), shadow = box.querySelector(".mkc-sh");
    function q(c) { return box.querySelector(".mkc-" + c); }
    var part = { root: q("root"), torso: q("torso"), head: q("head"), propB: q("propB"), propF: q("propF"), bell: q("bell"),
      eyeB: q("eyeB"), eyeF: q("eyeF"), eyes: q("eyes"), browB: q("browB"), browF: q("browF"), mouth: q("mouth"), blush: q("blush"),
      face: q("face"), glow: q("glow"), ant: q("ant"), core: q("core") };
    var arm = {
      B: { o: q("armBo"), m: q("armBm"), f: q("armBf"), h: q("armBh") },
      F: { o: q("armFo"), m: q("armFm"), f: q("armFf"), h: q("armFh") }
    };
    var leg = { B: { p: q("legBp"), s: q("legBs") }, F: { p: q("legFp"), s: q("legFs") } };

    var W = host.clientWidth || 320;
    function homeX() { return Math.max(6, Math.round((W - CW) * 0.8)); }
    var home = homeX();
    var atHome = reduce || opts.enter === false;   // enter:false starts him in place (previews, remounts)
    var x = atHome ? home : W + 6, dir = -1, phase = 0;
    function S(v, k, d) { return new Spring(v, k, d); }
    var SP = {
      y: S(0, 260, 26), sq: S(1, 300, 22), lean: S(0, 170, 20), spin: S(0, 120, 18), headT: S(0, 170, 20), headY: S(0, 260, 24),
      lookX: S(0.3, 200, 24), lookY: S(0, 200, 24), brow: S(0, 200, 24), sit: S(0, 90, 17), blush: S(0, 60, 14), hover: S(isBot ? 3.2 : 0, 70, 12),
      hBx: S(G2.restHB[0], 210, 24), hBy: S(G2.restHB[1], 210, 24), hFx: S(G2.restHF[0], 210, 24), hFy: S(G2.restHF[1], 210, 24),
      fBx: S(HUM.restFB[0], 260, 26), fBy: S(HUM.restFB[1], 260, 26), fFx: S(HUM.restFF[0], 260, 26), fFy: S(HUM.restFF[1], 260, 26)
    };
    var A = atHome ? { name: "idle", t0: nowMs(), data: {} } : { name: "enter", t0: nowMs(), data: { to: home, cb: greetNow } };
    var G = null;
    var mouth = "smile", face = "normal", propB = "", propF = "", eyesShut = false, eyesWide = false;
    var busyOn = false, landed = false, hidden = false, destroyed = false, dbl = false;
    var raf = 0, last = nowMs(), blinkT0 = -1e9, lastInput = nowMs(), lastEvent = nowMs(), quietUntil = 0;
    var lastKind = "think", lastSay = -1e9, lastErr = -1e9, lastStop = -1e9, lastDone = -1e9, lastNod = 0, lastTap = 0, typingUntil = 0;
    var mood = { v: 0.25, t: nowMs() };
    var timers = [], ambT = 0, listenT = 0, zzT = 0, readT = 0;
    var sayEl = null, lastX = -1, lastDir = 0;

    function valence() { return 0.2 + (mood.v - 0.2) * Math.exp(-(nowMs() - mood.t) / 25000); }
    function feel(dv) { mood.v = clamp(valence() + dv, -1, 1); mood.t = nowMs(); }
    function later(fn, ms) {
      var id = setTimeout(function () { var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); if (!destroyed) fn(); }, ms);
      timers.push(id); return id;
    }
    function cancel(id) { if (!id) return; clearTimeout(id); var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); }

    /* ---------------- loop ---------------- */
    function kick() {
      if (raf || destroyed || hidden) return;
      try { if (document.hidden) return; } catch (e) {}
      last = nowMs(); raf = requestAnimationFrame(frame);
    }
    function frame() {
      raf = 0;
      if (destroyed) return;
      if (!box.isConnected) { destroy(); return; }
      if (document.hidden || hidden) return;
      var t = nowMs(), dt = Math.min(1 / 30, Math.max(0, (t - last) / 1000)); last = t;
      program(t, dt);
      for (var k in SP) { if (reduce) SP[k].snap(); else SP[k].step(dt); }
      render(t);
      if (needFrames(t)) raf = requestAnimationFrame(frame);
    }
    function needFrames(t) {
      if (G) return true;
      if (!reduce && (A.name === "enter" || A.name === "walk" || A.name === "run" || (A.name === "think" && !isBot))) return true;
      if (t - blinkT0 < 420) return true;
      if (isBot && !landed && !reduce) return true;
      for (var k in SP) if (!SP[k].still()) return true;
      return false;
    }

    /* ---------------- director ---------------- */
    function setAct(name, data) { A = { name: name, t0: nowMs(), data: data || {} }; phase = 0; kick(); }
    function gesture(name) {
      if (!name) return;
      if (reduce && TRAVEL[name]) name = "nod";
      G = { name: name, t0: nowMs(), dur: GDUR[name] || 1000 };
      if (name === "heart") hearts(3);
      else if (name === "thumbs") fx("sparkle", 12, -2, 1300);
      kick();
    }
    function walkTo(to, run, then, cb) {
      to = clamp(to, 4, Math.max(4, W - CW - 4));
      if (reduce) { if (cb) cb(); return; }
      setAct(run ? "run" : "walk", { to: to, then: then, cb: cb });
    }
    function variantFor(k) {
      return (k === "cardiac" || k === "resp") ? "steth" : k === "rx" ? "rx" : k === "lab" ? "lab" : k === "urgent" ? "urgent" : (k === "think" || k === "calc") ? "chin" : "write";
    }
    function arrive(t) {
      var cb = A.data.cb, nx = A.data.then || (busyOn ? "think" : "idle");
      A = { name: nx, t0: t, data: nx === "think" ? { v: variantFor(lastKind) } : {} };
      if (cb) { try { cb(); } catch (e) {} }
    }

    function program(t, dt) {
      var T = {
        y: 0, sq: 1, lean: 0, spin: 0, headT: 0, headY: 0, lookX: 0.3, lookY: 0, brow: valence() > 0.45 ? 0.3 : 0, sit: 0,
        blush: valence() > 0.62 ? 0.3 : 0, hover: isBot ? (landed ? 0 : 3.2) : 0,
        hBx: G2.restHB[0], hBy: G2.restHB[1], hFx: G2.restHF[0], hFy: G2.restHF[1],
        fBx: HUM.restFB[0], fBy: HUM.restFB[1], fFx: HUM.restFF[0], fFy: HUM.restFF[1]
      };
      var night = isNight(new Date());
      var m = valence() < -0.2 ? "flat" : "smile", fc = valence() < -0.2 ? "concern" : "normal";
      var pb = "", pf = "", snapWalk = false;
      eyesShut = false; eyesWide = false;
      if (!isBot && style === "oncall" && night && A.name === "idle") { pf = "coffee"; T.hFx = 8.6; T.hFy = -23.6; }

      /* ---- activity ---- */
      var an = A.name, age = t - A.t0;
      if (an === "enter" || an === "walk" || an === "run") {
        var run = an === "run", spd = (run ? P.run : P.walk) * (busyOn ? 1.15 : 1);
        var to = clamp(A.data.to, 4, Math.max(4, W - CW - 4)), d = to - x, st = spd * dt;
        if (Math.abs(d) <= st || reduce) { x = to; arrive(t); an = A.name; }
        else {
          dir = d > 0 ? 1 : -1; x += st * dir; phase += dt * (run ? 12.5 : 8.2);
          var sw = Math.sin(phase), cw = Math.cos(phase);
          if (isBot) { T.lean = run ? 12 : 7; T.hover = run ? 5.2 : 4.4; T.hBx = -6.8; T.hBy = -17.6; T.hFx = 7.4; T.hFy = -17.6; }
          else {
            var stride = run ? 5.6 : 4.1, lift = run ? 3.6 : 2.4;
            T.fFx = HUM.hipF[0] + stride * sw; T.fFy = -1.5 - lift * Math.max(0, cw);
            T.fBx = HUM.hipB[0] - stride * sw; T.fBy = -1.5 - lift * Math.max(0, -cw);
            var swing = run ? 4.6 : 3.2;
            T.hFx = G2.restHF[0] - swing * sw; T.hFy = (run ? -21.6 : -18.2) - 0.8 * Math.max(0, -sw);
            T.hBx = G2.restHB[0] + swing * sw; T.hBy = (run ? -21.6 : -18.2) - 0.8 * Math.max(0, sw);
            T.y = -(run ? 1.5 : 0.9) * Math.cos(2 * phase) - (run ? 1.1 : 0.4);
            T.lean = run ? 7 : 2.5;
            snapWalk = true;
          }
          T.lookX = 0.9;
        }
      }
      if (an === "idle") {
        if (isBot && !landed && !busyOn && !G && t - lastEvent > 3500) landed = true;
      } else if (an === "listen") {
        T.lookY = 0.95; T.lookX = 0.2; T.headT = 6; T.brow = 0.35; m = "smile"; fc = "listen";
        if (isBot) { T.hFx = 7.6; T.hFy = -27.2; }
        else { T.hFx = 3.9; T.hFy = -32.4; if (style === "oncall") { T.lean = 4; T.headT = 8; } }
      } else if (an === "think") {
        var v = A.data.v || "write";
        if (isBot) {
          fc = v === "steth" ? "ecg" : (v === "rx" && age < 2200) ? "rx" : v === "urgent" ? "urgent" : v === "lab" ? "scan" : "think";
          T.hBx = -3.6; T.hBy = -18.4; T.hFx = 4.8; T.hFy = -18.2; pf = "tablet"; T.headT = 5; T.lookY = 0.7; T.lookX = -0.6;
          if (v === "steth") { pf = "bell"; T.hFx = 11.4; T.hFy = -19.8; T.hBx = -8.8; T.hBy = -16.4; }
        } else if (v === "steth" && age < 3600) {
          pf = "bell"; T.hFx = 11.2; T.hFy = -23.8; T.headT = -7; eyesShut = true; T.brow = 0.3; m = "flat";
        } else if (v === "rx" && age < 1800) {
          pf = "rxpad"; T.hFx = 9.6; T.hFy = -25.4; T.lookY = 0.7; T.lookX = 0.8; m = "flat";
        } else if (v === "lab") {
          pb = "clipboard"; T.hBx = 3.6; T.hBy = -25.2; T.lookY = 0.8; T.lookX = 0.5 + Math.sin(t / 420) * 0.5; T.headT = 5; T.brow = 0.15; m = "flat";
        } else if (v === "chin" && age < 2400) {
          T.hFx = 3.9; T.hFy = -32.4; T.lookY = -0.8; T.lookX = -0.3; T.brow = 0.45; m = "flat";
        } else {
          var fast = v === "urgent" ? 1.8 : 1;
          pb = "clipboard"; pf = "pen";
          T.hBx = 3.2; T.hBy = -23.8; T.hFx = 5.1 + Math.sin(t / 60 * fast) * 0.9; T.hFy = -26 + Math.cos(t / 95 * fast) * 0.7;
          T.lookY = 0.85; T.lookX = 0.55; T.headT = 6; T.brow = -0.15; m = "flat";
        }
        if (v === "urgent") { T.brow = -0.55; m = "flat"; }
      } else if (an === "read") {
        T.lookY = -0.8; T.lookX = -0.4; T.headT = -4; T.brow = 0.3; m = "smile"; fc = "scan";
        if (!isBot) { T.hFx = 0.2; T.hFy = -25; }
      } else if (an === "sit" || an === "sleep") {
        T.sit = 1; T.fBx = 5.6; T.fBy = -1.5; T.fFx = 8.8; T.fFy = -1.5; T.hover = 0;
        if (isBot) landed = true;
        if (an === "sit") { pf = isBot ? "tablet" : "book"; T.hBx = 1; T.hBy = -21.4; T.hFx = 6.8; T.hFy = -21.4; T.lookY = 0.9; T.lookX = 0.4; T.headT = 7; m = "smile"; }
        else {
          pf = isBot ? "" : "book"; T.hBx = 3.6; T.hBy = -19.6; T.hFx = 7; T.hFy = -19.4; T.headT = isBot ? 6 : 11; T.headY = 1.2;
          eyesShut = true; m = "sleep"; fc = "sleep";
        }
        if (isBot) { T.hBx = -6.4; T.hBy = -14.6; T.hFx = 6.4; T.hFy = -14.6; }
      }

      /* ---- gesture overlay ---- */
      if (G) {
        var p = (t - G.t0) / G.dur;
        if (p >= 1) G = null;
        else {
          var s1 = Math.sin(p * Math.PI);
          switch (G.name) {
            case "wave":
              if (isBot) { T.hFx = 12.6 + Math.sin(p * Math.PI * 6) * 1.6; T.hFy = -30.4; fc = "happy"; }
              else { T.hFx = 11.2 + Math.sin(p * Math.PI * 6) * 2.2; T.hFy = -41.4; m = "grin"; T.brow = 0.6; }
              T.headT = -3; break;
            case "hop":
              var H = P.hopH;
              if (p < 0.16) { T.sq = 1 - 0.14 * (p / 0.16); }
              else if (p < 0.66) {
                var qq = (p - 0.16) / 0.5; T.y = -H * 4 * qq * (1 - qq); T.sq = 1.06 - 0.06 * qq;
                if (isBot) { T.hBx = -12.8; T.hBy = -29.5; T.hFx = 12.8; T.hFy = -29.5; T.hover = 6; }
                else { T.hBx = -12; T.hBy = -44; T.hFx = 12.4; T.hFy = -44; T.fBx = -4.2; T.fBy = -4.4; T.fFx = 4.2; T.fFy = -5.2; }
                m = "grin"; fc = "happy"; T.brow = 0.6;
              } else if (p < 0.8) { T.sq = 0.88; }
              SP.y.t = T.y; SP.y.snap(); SP.sq.t = T.sq; SP.sq.snap();
              break;
            case "heart": case "comfort":
              if (isBot) { T.hFx = 1.2; T.hFy = -20.4; fc = G.name === "heart" ? "love" : "normal"; }
              else { T.hFx = 0; T.hFy = -25.6; }
              T.blush = G.name === "heart" ? 0.85 : 0.2; T.headT = -6; m = "smile"; T.brow = G.name === "comfort" ? 0.5 : 0.3;
              if (G.name === "comfort") T.headY = 0.6 * s1;
              break;
            case "thumbs":
              if (isBot) { T.hFx = 12.8; T.hFy = -24.4; fc = "happy"; }
              else { T.hFx = 12.2; T.hFy = -31.4; pf = "thumb"; m = "grin"; }
              T.brow = 0.5; T.headT = -3; break;
            case "nod":
              T.headY = 1.3 * Math.abs(Math.sin(p * Math.PI * 2)); T.headT = (T.headT || 0) + 2 * s1; break;
            case "shrug":
              if (isBot) { T.hBx = -13.2; T.hBy = -22.8; T.hFx = 13.2; T.hFy = -22.8; fc = "concern"; }
              else { T.hBx = -12.2; T.hBy = -27.4; T.hFx = 12.2; T.hFy = -27.4; m = "frown"; }
              T.brow = 0.5; T.headT = -6; T.headY = -0.6 * s1; break;
            case "palm":
              if (isBot) { T.hFx = 12.6; T.hFy = -22.8; fc = "normal"; }
              else { T.hFx = 12.1; T.hFy = -28.6; pf = "palm"; m = "flat"; }
              T.brow = 0.15; T.headY = p > 0.55 ? 1.1 * Math.sin((p - 0.55) / 0.45 * Math.PI) : 0; break;
            case "bow":
              T.lean = 13 * s1; T.hFx = isBot ? 1.2 : 0; T.hFy = isBot ? -20.4 : -25.6; T.blush = 0.6; m = "smile"; fc = "love"; break;
            case "yawn":
              if (isBot) { fc = "wow"; } else { T.hFx = 3.6; T.hFy = -35.4; m = "o"; eyesShut = p > 0.25 && p < 0.75; }
              T.headT = -8 * s1; break;
            case "stretch":
              T.hBx = isBot ? -9 : -3.6; T.hBy = isBot ? -33 : -47.6; T.hFx = isBot ? 9 : 5.6; T.hFy = isBot ? -33 : -47.6;
              T.sq = 1 + 0.04 * s1; m = "o"; fc = "happy"; break;
            case "glance":
              T.lookX = p < 0.45 ? -1 : p < 0.9 ? 1 : 0.3; T.headT = p < 0.45 ? -5 : p < 0.9 ? 5 : 0; break;
            case "adjust":
              if (!isBot) { T.hFx = 3.9; T.hFy = -41.3; T.headT = -3; } break;
            case "watch":
              if (isBot) { T.hBx = -2; T.hBy = -21; } else { T.hBx = 2.2; T.hBy = -26.4; }
              T.lookY = 0.9; T.lookX = -0.3; T.headT = 6; break;
            case "sip":
              pf = isBot ? "" : "coffee"; T.hFx = p > 0.2 && p < 0.8 ? 4.4 : 8.6; T.hFy = p > 0.2 && p < 0.8 ? -34.6 : -23.6;
              eyesShut = p > 0.35 && p < 0.7; break;
            case "wake":
              T.brow = 1; eyesWide = true; T.sq = 1 - 0.06 * s1; fc = "wow"; m = "o"; break;
            case "scan":
              fc = "scan"; T.lookX = Math.sin(p * Math.PI * 3); break;
          }
        }
      }
      if (!isBot && (G && G.name === "heart")) m = "smile";
      for (var n in T) if (SP[n]) SP[n].t = T[n];
      if (snapWalk) { SP.fBx.snap(); SP.fBy.snap(); SP.fFx.snap(); SP.fFy.snap(); SP.hBx.snap(); SP.hBy.snap(); SP.hFx.snap(); SP.hFy.snap(); SP.y.snap(); }
      mouth = m; face = fc; propB = pb; propF = pf;
      if (an === "listen" && t > typingUntil + 1200 && !G) setAct("idle");
    }

    /* ---------------- render ---------------- */
    function blinkAmt(t) {
      var e = t - blinkT0;
      if (e < 0 || e > 400) return 0;
      if (e < 150) return Math.sin(e / 150 * Math.PI);
      if (dbl && e > 230 && e < 380) return Math.sin((e - 230) / 150 * Math.PI);
      return 0;
    }
    function drawArm(a, sh, tx, ty, drop, propEl, propName, coat) {
      var k = ik(sh[0], sh[1] + drop, tx, ty + drop, G2.L1, G2.L2, false);
      var d = pathD([sh[0], sh[1] + drop, k.ex, k.ey, k.hx, k.hy]);
      if (coat || isBot) { setD(a.o, d); setD(a.m, d); }
      else {
        var mx = sh[0] + (k.ex - sh[0]) * 0.9, my = sh[1] + drop + (k.ey - sh[1] - drop) * 0.9;
        setD(a.m, pathD([sh[0], sh[1] + drop, mx, my])); setD(a.f, pathD([mx, my, k.ex, k.ey, k.hx, k.hy]));
      }
      setA(a.h, "cx", String(r2(k.hx))); setA(a.h, "cy", String(r2(k.hy)));
      if (propEl) {
        if (propEl._p !== propName) { propEl._p = propName; propEl.innerHTML = propSVG(propName, K); }
        tr(propEl, "translate(" + r2(k.hx) + " " + r2(k.hy) + ")");
      }
    }
    function drawLeg(l, hp, tx, ty, drop) {
      var k = ik(hp[0], hp[1] + drop, tx, ty, HUM.T1, HUM.T2, true);
      setD(l.p, pathD([hp[0], hp[1] + drop, k.ex, k.ey, k.hx, k.hy]));
      tr(l.s, "translate(" + r2(k.hx) + " " + r2(k.hy) + ")");
    }
    function render(t) {
      if (x !== lastX || dir !== lastDir) {
        lastX = x; lastDir = dir;
        actor.style.transform = "translate3d(" + r2(x) + "px,0,0) scaleX(" + dir + ")";
        placeSay();
      }
      var air = clamp(-SP.y.x / 14, 0, 1) + (isBot ? clamp(SP.hover.x / 12, 0, 0.5) : 0);
      var shv = "translate3d(" + r2(x + CW / 2 - 15) + "px,0,0) scaleX(" + r2(1 - air * 0.45) + ")";
      if (shadow._v !== shv) { shadow._v = shv; shadow.style.transform = shv; shadow.style.opacity = String(r2(0.9 - air * 0.5)); }
      var drop = SP.sit.x * 9;
      if (isBot) {
        var bob = (landed || reduce) ? 0 : Math.sin(t / 480) * 0.9;
        tr(part.root, "translate(0 " + r2(SP.y.x - SP.hover.x - bob + 4.6) + ") rotate(" + r2(SP.lean.x) + " 0 -8) rotate(" + r2(SP.spin.x) + " 0 -26) scale(" + r2(2 - SP.sq.x) + " " + r2(SP.sq.x) + ")");
        tr(part.glow, "translate(0 0) scale(" + r2(clamp(SP.hover.x / 3.2, 0, 1.6)) + " 1)");
        setA(part.glow, "opacity", String(r2(clamp(SP.hover.x / 3.2, 0, 1))));
        tr(part.head, "translate(0 " + r2(SP.headY.x) + ") rotate(" + r2(SP.headT.x) + " 0 -29)");
        drawArm(arm.B, BOTG.shB, SP.hBx.x, SP.hBy.x, 0, part.propB, propB, false);
        drawArm(arm.F, BOTG.shF, SP.hFx.x, SP.hFy.x, 0, part.propF, propF, false);
        var fname = face;
        if (!eyesShut && fname === "normal" && blinkAmt(t) > 0.5) fname = "blink";
        if (part.face._f !== fname) { part.face._f = fname; part.face.innerHTML = BOTFACE[fname] || BOTFACE.normal; }
        tr(part.face, "translate(" + r2(SP.lookX.x * 0.9) + " " + r2(SP.lookY.x * 0.6) + ")");
        var antC = face === "urgent" ? "#F87171" : face === "sleep" ? "#2A9D8F" : "#2DD4BF";
        setA(part.ant, "fill", antC);
      } else {
        tr(part.root, "translate(0 " + r2(SP.y.x) + ") rotate(" + r2(SP.lean.x) + ") rotate(" + r2(SP.spin.x) + " 0 -24) scale(" + r2(2 - SP.sq.x) + " " + r2(SP.sq.x) + ")");
        tr(part.torso, drop ? "translate(0 " + r2(drop) + ")" : "translate(0 0)");
        drawLeg(leg.B, HUM.hipB, SP.fBx.x, SP.fBy.x, drop);
        drawLeg(leg.F, HUM.hipF, SP.fFx.x, SP.fFy.x, drop);
        var coat = K.top === "coat";
        drawArm(arm.B, HUM.shB, SP.hBx.x, SP.hBy.x, drop, part.propB, propB, coat);
        drawArm(arm.F, HUM.shF, SP.hFx.x, SP.hFy.x, drop, part.propF, propF, coat);
        if (part.bell) part.bell.style.display = propF === "bell" ? "none" : "";
        tr(part.head, "translate(0 " + r2(SP.headY.x) + ") rotate(" + r2(SP.headT.x) + " 0.8 -33)");
        var ey = eyesShut ? 0.12 : Math.max(0.12, 1 - blinkAmt(t) * 0.88) * (eyesWide ? 1.18 : 1);
        tr(part.eyes, "translate(" + r2(SP.lookX.x * 0.9) + " " + r2(SP.lookY.x * 0.75) + ")");
        tr(part.eyeB, "translate(-1.9 -40.2) scale(1 " + r2(ey) + ") translate(1.9 40.2)");
        tr(part.eyeF, "translate(3.7 -40.2) scale(1 " + r2(ey) + ") translate(-3.7 40.2)");
        var b = SP.brow.x, up = b > 0 ? b : 0, kn = b < 0 ? -b : 0;
        tr(part.browB, "translate(0 " + r2(-up * 0.9) + ") rotate(" + r2(kn * 14) + " -0.6 -43.7)");
        tr(part.browF, "translate(0 " + r2(-up * 0.9) + ") rotate(" + r2(-kn * 14) + " 2.4 -43.8)");
        if (part.mouth._m !== mouth) { part.mouth._m = mouth; part.mouth.innerHTML = MOUTH[mouth] || MOUTH.smile; }
        setA(part.blush, "opacity", String(r2(SP.blush.x)));
      }
      if (sayEl && sayEl._followY !== r2(SP.y.x)) placeSay();
    }

    /* ---------------- fx and speech ---------------- */
    function fx(kind, dx, dy, life) {
      if (hidden || destroyed) return;
      try { if (document.hidden) return; } catch (e) {}
      var html = FX[kind]; if (!html) return;
      var el = document.createElement("div"); el.className = "mkc-fx";
      el.innerHTML = '<div class="' + (RISE[kind] ? "mkc-rise" : "mkc-pop") + '">' + html + "</div>";
      el.style.left = r2(x + CW / 2 + (dx || 0) * dir) + "px";
      el.style.top = r2(SVG_TOP + 3 + (dy || 0) + SP.y.x) + "px";
      box.appendChild(el);
      later(function () { if (el.parentNode) el.parentNode.removeChild(el); }, life || 1500);
    }
    function hearts(n) {
      for (var i = 0; i < n; i++) (function (i) {
        later(function () { fx("heart", -8 + i * 8 + rnd(-2, 2), rnd(-2, 2), 1400); }, i * 120);
      })(i);
    }
    function say(text, life) {
      if (hidden || destroyed) return;
      clearSay();
      var el = document.createElement("div"); el.className = "mkc-say"; el.textContent = text;
      box.appendChild(el); sayEl = el; lastSay = nowMs();
      placeSay();
      later(function () { if (sayEl === el) clearSay(); }, life || 4200);
    }
    function clearSay() { if (sayEl && sayEl.parentNode) sayEl.parentNode.removeChild(sayEl); sayEl = null; }
    function placeSay() {
      if (!sayEl) return;
      if (!sayEl._w) { sayEl._w = sayEl.offsetWidth || 150; sayEl._h = sayEl.offsetHeight || 32; }
      var cx = x + CW / 2, left = clamp(cx - sayEl._w / 2, 4, Math.max(4, W - sayEl._w - 4));
      sayEl._followY = r2(SP.y.x);
      sayEl.style.left = r2(left) + "px";
      sayEl.style.top = r2(SVG_TOP - sayEl._h - 2 + SP.y.x) + "px";
      sayEl.style.setProperty("--mkcTail", r2(clamp(cx - left, 10, sayEl._w - 10)) + "px");
    }

    /* ---------------- idle life: blinks, fidgets, sleep ---------------- */
    function scheduleBlink() {
      later(function () {
        if (!document.hidden && !hidden && !reduce && A.name !== "sleep") { blinkT0 = nowMs(); dbl = Math.random() < 0.18; kick(); }
        scheduleBlink();
      }, rnd(2600, 5600));
    }
    function scheduleAmbient() {
      cancel(ambT);
      ambT = later(function () { ambient(); scheduleAmbient(); }, rnd(P.ambMin, P.ambMax));
    }
    function ambient() {
      var t = nowMs();
      if (document.hidden || hidden || busyOn) return;
      if (A.name === "idle" && !G && t - lastInput > sleepMs) { goSit(); return; }
      if (reduce || A.name !== "idle" || G || t < quietUntil) return;
      var g = pick(isNight(new Date()) ? P.ambNight : P.amb);
      if (g === "stroll") { walkTo(clamp(home + rnd(-70, 24), 6, W - CW - 6), false); return; }
      if (isBot) landed = false;
      lastEvent = t;
      gesture(g);
    }
    function goSit() {
      setAct("sit");
      cancel(zzT);
      zzT = later(function () { if (A.name === "sit") { setAct("sleep"); zz(); } }, reduce ? 800 : 6000);
    }
    function zz() {
      cancel(zzT);
      zzT = later(function () {
        if (A.name !== "sleep") return;
        if (busyOn) { touch(false); return; }
        if (!document.hidden && !hidden && !reduce) fx("zz", 10, -4, 1700);
        zz();
      }, 2600);
    }

    /* ---------------- events (the brain's reactions) ---------------- */
    function touch(isInput) {
      var t = nowMs(); lastEvent = t; if (isInput) lastInput = t;
      landed = false;
      if (A.name === "sit" || A.name === "sleep") {
        cancel(zzT);
        A = busyOn ? { name: "think", t0: t, data: { v: variantFor(lastKind) } } : { name: "idle", t0: t, data: {} };
        gesture("wake");
      }
      kick();
    }
    function onTyping() {
      touch(true);
      if (busyOn) return;
      var t = nowMs(); typingUntil = t + 1400;
      if (A.name === "idle") setAct("listen");
      if (A.name === "listen" && t - lastNod > 1800) { lastNod = t; later(function () { if (A.name === "listen" && !G) gesture("nod"); }, 450); }
      cancel(listenT); listenT = later(function () { kick(); }, 2700);
    }
    function onSend(kind) {
      touch(true); lastKind = kind; clearSay();
      var c = Math.round(W / 2 - CW / 2);
      switch (kind) {
        case "urgent": feel(0); fx("plus", 0, -4, 1400); if (!reduce && Math.abs(x - c) > 40) walkTo(c, true, busyOn ? "think" : "idle"); break;
        case "thanks": feel(0.5); gesture("bow"); hearts(3); if (nowMs() - lastSay > 8000) say("Anytime, Doctor.", 1800); break;
        case "greet": feel(0.3); gesture("wave"); say(greeting(new Date()), 2600); break;
        case "sad": feel(-0.1); gesture("comfort"); break;
        case "frustrated": feel(-0.2); gesture("palm"); say("Let me look at that again.", 2400); break;
        case "cardiac": fx("ecg", 18, -2, 1500); break;
        case "resp": fx("ecg", 18, -2, 1500); break;
        case "rx": fx("rx", 14, 0, 1400); break;
        case "lab": fx("check", 12, -2, 1200); break;
        case "calc": fx("calc", 14, 0, 1400); break;
        case "peds": hearts(1); break;
        default: fx("q", 12, 0, 1200);
      }
      if (busyOn && A.name !== "run" && A.name !== "walk") setAct("think", { v: variantFor(kind) });
    }
    function onBusy(on) {
      var was = busyOn; busyOn = !!on;
      box.classList.toggle("busy", busyOn);
      touch(false);
      if (busyOn && !was) { if (A.name !== "run" && A.name !== "walk" && A.name !== "enter") setAct("think", { v: variantFor(lastKind) }); }
      else if (!busyOn && was) {
        if (A.name === "think" || A.name === "read") setAct("idle");
        // The end of the busy state is the reliable "answer landed" signal. An error or Stop reported in
        // the same tick (they arrive around busy-off) wins: onDone checks them.
        later(function () { onDone(null); }, 60);
      }
    }
    function onStream() {
      touch(false);
      if (busyOn && A.name === "think") setAct("read");
      cancel(readT);
      readT = later(function readNod() { if (A.name === "read") { if (!G) gesture("nod"); readT = later(readNod, 2400); } }, 1600);
    }
    function onDone(meta) {
      var t = nowMs();
      if (t - lastDone < 1500) return;   // busy-off and an explicit "done" cue describe the same moment
      touch(false);
      if (t - lastErr < 2500 || t - lastStop < 2500) return;   // an error or Stop already had its reaction
      lastDone = t;
      if (A.name === "think" || A.name === "read") setAct("idle");
      feel(0.15);
      gesture(meta && meta.ok === false ? "nod" : "thumbs");
      if (meta && meta.grounded) fx("check", -12, -2, 1400);
      if (!reduce && Math.random() < P.joy) later(function () { if (!G && A.name === "idle" && !busyOn) gesture("hop"); }, 1500);
      if (!reduce && Math.abs(x - home) > 50) later(function () { if (A.name === "idle" && !G && !busyOn) walkTo(home, false); }, 2800);
    }
    function onError(kind) {
      lastErr = nowMs(); touch(false); feel(-0.25);
      if (A.name === "think" || A.name === "read") setAct("idle");
      gesture("shrug");
      fx(kind === "offline" ? "offline" : "warn", 0, -4, 1800);
    }
    function onStop() {
      lastStop = nowMs(); touch(true);
      if (A.name === "think" || A.name === "read" || A.name === "run" || A.name === "walk") setAct("idle");
      gesture("palm");
    }
    function onRate(yes) {
      touch(true);
      if (yes) { feel(0.45); gesture("heart"); if (!reduce && Math.random() < P.joy + 0.2) later(function () { if (!G && A.name === "idle") gesture("hop"); }, 1500); }
      else { feel(-0.05); gesture("nod"); fx("noted", 0, -2, 1500); }
    }
    function onTapSelf() {
      var t = nowMs(), was = A.name;
      touch(true);
      if (was === "sit" || was === "sleep") { later(function () { gesture("wave"); }, 650); return; }
      if (t - lastTap < 330 && !reduce) {   // a double tap is a trick
        lastTap = 0; gesture("hop"); hearts(2); return;
      }
      lastTap = t;
      var r = Math.random();
      if (r < 0.26 && t - lastSay > 20000) { gesture("wave"); say(pickLine(new Date(), Math.random()), 3800); }
      else if (r < 0.5) gesture("wave");
      else if (r < 0.72 && !reduce) gesture("hop");
      else gesture("heart");
    }
    function greetNow() {
      if (!opts.greet || destroyed) return;
      var first = !lsGet("smd_maik_doc_hi");
      if (first) lsSet("smd_maik_doc_hi", "1");
      gesture("wave");
      say(first ? introLine(style) : pickLine(new Date(), Math.random()), first ? 5200 : 4200);
    }

    /* ---------------- input: tap, double tap, long-press, swipe away ---------------- */
    var tab = host.querySelector(".mkc-tab");
    if (!tab) {
      tab = document.createElement("button"); tab.type = "button"; tab.className = "mkc-tab";
      tab.setAttribute("aria-label", "Show the MaiK buddy"); tab.innerHTML = "&#8250;";
      host.appendChild(tab);
    }
    function applyHidden(h, persist) {
      hidden = !!h;
      box.classList.toggle("mkc-hidden", hidden); tab.classList.toggle("on", hidden);
      if (persist) lsSet("smd_maik_doc_off", hidden ? "1" : "0");
      if (hidden) { clearSay(); if (raf) { cancelAnimationFrame(raf); raf = 0; } }
      else { touch(true); if (persist) gesture("wave"); }
    }
    function onTab() { applyHidden(false, true); }
    tab.addEventListener("click", onTab);
    var pd = null, lpT = 0;
    function onDown(e) {
      e.stopPropagation();
      pd = { x: e.clientX, y: e.clientY, moved: false, long: false };
      clearTimeout(lpT);
      lpT = setTimeout(function () {
        if (!pd || pd.moved) return;
        pd.long = true;
        try { if (navigator.vibrate) navigator.vibrate(10); } catch (x) {}
        if (opts.onLongPress) { try { opts.onLongPress(); } catch (x) {} }
      }, 560);
    }
    function onMove(e) {
      if (!pd) return;
      var dx = e.clientX - pd.x;
      if (Math.abs(dx) > 8 || Math.abs(e.clientY - pd.y) > 8) { pd.moved = true; clearTimeout(lpT); }
      if (dx < 0 && pd.moved) box.style.transform = "translateX(" + r2(dx) + "px)";
    }
    function onUp(e) {
      if (!pd) return;
      clearTimeout(lpT);
      var was = pd, dx = e.clientX - was.x; pd = null; box.style.transform = "";
      if (was.long) return;
      if (dx < -56) { applyHidden(true, true); return; }
      if (!was.moved) onTapSelf();
    }
    function onCancel() { pd = null; clearTimeout(lpT); box.style.transform = ""; }
    actor.addEventListener("pointerdown", onDown);
    actor.addEventListener("pointermove", onMove);
    actor.addEventListener("pointerup", onUp);
    actor.addEventListener("pointercancel", onCancel);
    // A tap anywhere else on the sheet sends him over to it (observer only: nothing is prevented).
    function onSheet(e) {
      if (hidden || reduce || destroyed) return;
      if (actor.contains(e.target)) return;
      var r = host.getBoundingClientRect(), px = e.clientX - r.left - CW / 2;
      if (px < -20 || px > W + 20) return;
      touch(true);
      if (A.name === "think" || A.name === "read") return;   // he is busy working; the tap still wakes him
      var to = clamp(px, 4, W - CW - 4);
      if (Math.abs(to - x) < 10) { gesture("wave"); return; }
      walkTo(to, Math.abs(to - x) > 110);
    }
    if (opts.sheet) opts.sheet.addEventListener("pointerdown", onSheet);
    // Reading the thread: he stays calm and does not fidget for a while.
    function onScroll() { quietUntil = nowMs() + 15000; }
    if (opts.scroller) opts.scroller.addEventListener("scroll", onScroll, { passive: true });
    function onResize() {
      var w = host.clientWidth || W; if (w === W) return;
      W = w; home = homeX(); x = clamp(x, 4, Math.max(4, W - CW - 4)); lastX = -1; kick();
    }
    window.addEventListener("resize", onResize);
    function onVis() { if (!document.hidden) { lastX = -1; kick(); } }
    document.addEventListener("visibilitychange", onVis);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = []; clearTimeout(lpT);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      if (opts.sheet) opts.sheet.removeEventListener("pointerdown", onSheet);
      if (opts.scroller) opts.scroller.removeEventListener("scroll", onScroll);
      tab.removeEventListener("click", onTab);
      clearSay();
      if (box.parentNode) box.parentNode.removeChild(box);
      if (tab.parentNode) tab.parentNode.removeChild(tab);
    }

    applyHidden(lsGet("smd_maik_doc_off") === "1", false);
    render(nowMs());
    scheduleBlink(); scheduleAmbient();
    if (atHome) later(greetNow, reduce ? 250 : 400);
    kick();

    return {
      el: box, style: style,
      cue: function (kind, data) {
        try {
          switch (kind) {
            case "typing": onTyping(); break;
            case "send": onSend(classify(data)); break;
            case "stream": onStream(); break;
            case "done": onDone(data); break;
            case "error": onError("fail"); break;
            case "offline": onError("offline"); break;
            case "stop": onStop(); break;
            case "rate-yes": onRate(true); break;
            case "rate-no": onRate(false); break;
            case "tap": onTapSelf(); break;
            case "sleep": goSit(); break;
            case "wake": touch(true); break;
            default: if (KIND_SET[kind]) onSend(kind);
          }
        } catch (e) {}
      },
      busy: function (on) { try { onBusy(on); } catch (e) {} },
      setHidden: function (h) { applyHidden(h, true); },
      // Demo/preview hooks: play one gesture, or walk to a spot (x in px along the strip).
      play: function (g) { try { if (GDUR[g]) { touch(true); gesture(g); } } catch (e) {} },
      walk: function (px, run) { try { touch(true); walkTo(px, !!run); } catch (e) {} },
      state: function () {
        return { style: style, act: A.name, gesture: G ? G.name : null, x: Math.round(x), dir: dir, parked: !raf, hidden: hidden,
          landed: landed, busy: busyOn, mouth: mouth, face: face, propB: propB, propF: propF, mood: Math.round(valence() * 100) / 100, reduce: reduce };
      },
      destroy: destroy
    };
  }

  window.MaiKCompanion = {
    version: "2.0.0", STYLES: STYLES, LABEL: LABEL, BLURB: BLURB, PEARLS: PEARLS,
    classify: classify, greeting: greeting, pickLine: pickLine, isNight: isNight, introLine: introLine,
    mount: mount, thumb: thumb, ik: ik
  };
})();
