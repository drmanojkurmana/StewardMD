/* Ophthalmós neuro-ophthalmology simulator and pupil lab. ES5, buildless IIFE.
   Part 1 is a pure model (no DOM): six extraocular muscles per eye, their nerves and the supranuclear
   pathways as strength factors, a pupil and lid model, Hering's law, Hess chart and grading.
   Every condition is data (a lesion), so combinations need no new code.
   Node (tests): module.exports. Browser: window.OPHTHALMOS_NEURO, then part 2 registers the UI in
   OPHTHALMOS._sims. */
(function (G) {
  "use strict";

  /* ================= model ================= */
  // Conventions: x + = toward the patient's right, y + = up, t + = intorsion, all in degrees.
  // Innervation is normalised: a healthy eye rotates RH (horizontal) or RV (vertical) degrees per unit.
  var RH = 50, RV = 40, CONV = 8, TILT_V = 4, TORS = 9, ROLL = 3;
  var D2R = Math.PI / 180;
  var MUS = ["LR", "MR", "SR", "IR", "IO", "SO"];
  var EYES = ["R", "L"];
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function cosd(d) { return Math.cos(d * D2R); }
  function sind(d) { return Math.sin(d * D2R); }
  function other(e) { return e === "R" ? "L" : "R"; }
  function pd(deg) { return 100 * Math.tan(deg * D2R); }   // prism dioptres

  function pupilBase() { return { para: 1, sym: 1, light: 1, near: 1, sup: false, tonic: false, block: false, mio: 1, size: 0, irregular: false }; }
  function normal() {
    var P = { mus: {}, lev: {}, mul: {}, mlf: {}, gaze: {}, drift: {}, aff: {}, pupil: {}, v1: {},
      up: 1, down: 1, conv: 1, retract: 0, crn: false, fix: null };
    EYES.forEach(function (e) {
      P.mus[e] = { LR: 1, MR: 1, SR: 1, IR: 1, IO: 1, SO: 1 };
      P.lev[e] = 1; P.mul[e] = 1; P.mlf[e] = 1; P.gaze[e] = 1; P.aff[e] = 0; P.v1[e] = false;
      P.drift[e] = { ab: 0, y: 0, t: 0 };
      P.pupil[e] = pupilBase();
    });
    return P;
  }

  // Lesion data uses I (side of the lesion), C (the other side) and B (both) instead of R and L.
  var PER_EYE = { mus: 1, lev: 1, mul: 1, mlf: 1, gaze: 1, drift: 1, aff: 1, pupil: 1, v1: 1 };
  function build(lesion, side) {
    var P = normal(), I = side === "L" ? "L" : "R";
    Object.keys(lesion || {}).forEach(function (k) {
      var v = lesion[k];
      if (!PER_EYE[k]) { P[k] = v; return; }
      Object.keys(v).forEach(function (w) {
        var eyes = w === "B" ? EYES : [w === "I" ? I : other(I)];
        eyes.forEach(function (e) {
          if (typeof v[w] === "object") { for (var f in v[w]) P[k][e][f] = v[w][f]; }
          else P[k][e] = v[w];
        });
      });
    });
    // The patient fixes with the eye that moves better unless the data says otherwise.
    if (!P.fix) {
      var cap = {};
      EYES.forEach(function (e) {
        var s = P.mlf[e] + P.lev[e];
        MUS.forEach(function (m) { s += P.mus[e][m]; });
        cap[e] = s;
      });
      P.fix = cap.L > cap.R + 1e-6 ? "L" : "R";
    }
    return P;
  }

  // Vertical and torsional efficiency of the cyclovertical muscles at abduction a (degrees):
  // the vertical recti act in a plane 23 degrees temporal to the visual axis, the obliques 51 degrees nasal.
  function eff(a) {
    return { rect: Math.max(0, cosd(23 - a)), obl: Math.max(0, cosd(51 + a)),
      trect: Math.max(0, sind(23 - a)), tobl: Math.max(0, sind(51 + a)) };
  }

  // One eye's position for a conjugate command (H, V, normalised), vergence cv and counter-roll n
  // (+1 intort, -1 extort). Each muscle pulls with strength x innervation; agonist and antagonist
  // receive reciprocal innervation (Sherrington), so an unopposed muscle sets the resting deviation.
  function eyePos(P, e, H, V, cv, n) {
    var m = P.mus[e], sg = e === "R" ? 1 : -1;
    var ab = sg * H, gate = P.gaze[H >= 0 ? "R" : "L"] * (ab < 0 ? P.mlf[e] : 1);
    var u = ab * gate - cv * P.conv;   // convergence reaches the medial rectus outside the MLF
    var a = RH * (m.LR * Math.max(0, 1 + u) - m.MR * Math.max(0, 1 - u)) / 2 + P.drift[e].ab;
    a = clamp(a, -55, 55);
    var k = eff(a), w = V * (V >= 0 ? P.up : P.down);
    var up = m.SR * k.rect + m.IO * k.obl, dn = m.IR * k.rect + m.SO * k.obl, e0 = k.rect + k.obl;
    var y = RV * (up * Math.max(0, 1 + w) - dn * Math.max(0, 1 - w)) / (2 * e0);
    // Counter-roll is push-pull between the intorters (SR, SO) and extorters (IR, IO), whose
    // vertical actions cancel in health; a weak muscle unmasks its partner's pull (Bielschowsky).
    y += TILT_V * n * (m.SR - m.SO - m.IO + m.IR) + P.drift[e].y;
    y = clamp(y, -50, 45);
    var tt = k.trect + k.tobl || 1;
    var t = TORS * ((m.SR * k.trect + m.SO * k.tobl) - (m.IR * k.trect + m.IO * k.tobl)) / tt +
      ROLL * n * (n > 0 ? (m.SR + m.SO) / 2 : (m.IR + m.IO) / 2) + P.drift[e].t;
    return { x: sg * a, y: y, t: t, ab: a };
  }

  function bisect(f, want, lo, hi, incl) {
    for (var i = 0; i < 36; i++) { var mid = (lo + hi) / 2, y = f(mid); if (incl ? y <= want + 1e-9 : y < want - 1e-9) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  // Command that brings f (monotone, possibly flat where a pathway is cut) to want: of all commands
  // that do it, the one nearest zero. When out of reach, the least command that gets as close, so a
  // gated movement (an INO eye asked to adduct) does not send maximal effort to the fellow.
  function solve(f, want, span) {
    function least(a, b) { return clamp(0, bisect(f, a, -1.4, 1.4), bisect(f, b, -1.4, 1.4, true)); }
    var c = least(want, want), got = f(c), h = span ? clamp(want / span, -1.4, 1.4) : 0;
    if (Math.abs(got - want) < 0.3) return c;
    c = least(got - 0.05, got + 0.05);
    return Math.abs(c) >= Math.abs(h) ? c : h;   // Hering: at least the command a healthy eye would need
  }

  // Both eyes for an examination state ex = {h, v, cover, tilt (+1 right shoulder), near}.
  // Hering's law: the command that brings the fixing eye onto the target goes to both eyes.
  function aim(P, fix, h, v, n, cv, near) {
    var want = h - (fix === "R" ? 1 : -1) * (near ? CONV : 0);
    var H = solve(function (x) { return eyePos(P, fix, x, 0, cv, n[fix]).x; }, want, near ? 0 : RH);
    var V = solve(function (x) { return eyePos(P, fix, H, x, cv, n[fix]).y; }, v, RV);
    var q = eyePos(P, fix, H, V, cv, n[fix]);
    return { H: H, V: V, miss: Math.abs(q.x - want) + Math.abs(q.y - v) };
  }
  function eyes(P, ex) {
    ex = ex || {};
    var h = ex.h || 0, v = ex.v || 0, tilt = ex.tilt || 0;
    var fix = ex.cover ? other(ex.cover) : P.fix;
    var n = { R: tilt, L: -tilt }, cv = ex.near ? CONV / RH : 0;
    var c = aim(P, fix, h, v, n, cv, ex.near);
    if (!ex.cover && c.miss > 2) {   // uncovered, the patient fixes with whichever eye reaches the target
      var alt = aim(P, other(fix), h, v, n, cv, ex.near);
      if (alt.miss < c.miss - 2) { c = alt; fix = other(fix); }
    }
    var H = c.H, V = c.V;
    var r = eyePos(P, "R", H, V, cv, n.R), l = eyePos(P, "L", H, V, cv, n.L);
    var eso = l.x - r.x - (ex.near ? 2 * CONV : 0), rht = r.y - l.y;
    var nys = {};
    EYES.forEach(function (e) {   // abducting nystagmus of the fellow eye in an INO
      var toward = e === "R" ? h >= 10 : h <= -10, me = e === "R" ? r : l;
      nys[e] = toward && P.mlf[other(e)] < 1 && me.ab > 5;
    });
    return { R: r, L: l, fix: fix, H: H, V: V, eso: eso, rht: rht, pdH: pd(eso), pdV: pd(rht),
      nys: nys, crn: !!P.crn && v >= 10 };
  }

  // Nine gaze positions (examiner's view: the patient's right in the left column), preferred fixation.
  var NINE = [[30, 25], [0, 25], [-30, 25], [30, 0], [0, 0], [-30, 0], [30, -25], [0, -25], [-30, -25]];
  function nine(P) {
    return NINE.map(function (g) { var r = eyes(P, { h: g[0], v: g[1] }); return { h: g[0], v: g[1], pdH: r.pdH, pdV: r.pdV }; });
  }

  // Hess chart: where each eye points while the other eye fixes the 15 and 30 degree targets.
  var RING = [[-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0]];
  function hess(P) {
    var out = {};
    EYES.forEach(function (e) {
      function at(r) { return RING.map(function (g) { var q = eyes(P, { h: g[0] * r, v: g[1] * r, cover: e })[e]; return { h: g[0] * r, v: g[1] * r, x: q.x, y: q.y }; }); }
      var c = eyes(P, { cover: e })[e];
      out[e] = { inner: at(15), outer: at(30), centre: { x: c.x, y: c.y } };
    });
    return out;
  }

  /* ---------- pupils and lids ---------- */
  var DMIN = 1.8, DSPAN = 5.7;
  // px = {room: "light"|"dark", light: null|"R"|"L", near, drops: {apra, pilo01, pilo1}, filter: {R, L} (log units)}
  function pupils(P, px) {
    px = px || {};
    var drops = px.drops || {}, filt = px.filter || {}, S = 0, out = {};
    EYES.forEach(function (e) {   // afferent signal: luminance x optic nerve transmission, summed at the pretectum
      var lum = (px.room === "dark" ? 0.02 : 0.35) + (px.light === e ? 0.55 : 0);
      S += lum * Math.pow(10, -((P.aff[e] || 0) + (filt[e] || 0)));
    });
    var Dl = S / (S + 0.35), Dn = px.near ? 0.6 : 0;
    EYES.forEach(function (e) {
      var q = P.pupil[e];
      var drive = 1 - (1 - q.light * Dl) * (1 - q.near * Dn);
      var p = q.para * drive;   // sphincter activation
      if (drops.pilo01) p += q.sup ? 0.55 : 0.05;
      if (drops.pilo1) p += 0.85;
      if (q.block) p = 0;
      p = clamp(p, 0, 1);
      var sym = 0.72 + 0.28 * q.sym;
      if (drops.apra) sym += q.sym < 1 ? 0.4 * (1 - q.sym) : -0.03;   // alpha-1 supersensitivity reverses a Horner
      out[e] = Math.round(Math.min(8, DMIN + DSPAN * (1 - p) * sym * q.mio + q.size) * 100) / 100;
    });
    return out;
  }
  // Time constants (s): a Horner pupil redilates slowly (dilation lag); an Adie pupil is tonic.
  function tau(P, e, constricting) {
    var q = P.pupil[e];
    if (q.tonic) return constricting ? 2.5 : 5;
    return constricting ? 0.3 : q.sym < 1 ? 3 : 0.9;
  }
  function pupilStep(P, cur, target, dt) {
    var out = {};
    EYES.forEach(function (e) {
      var c = cur[e], t = target[e];
      out[e] = c + (t - c) * (1 - Math.exp(-dt / tau(P, e, t < c)));
    });
    return out;
  }
  // Margin reflex distances (mm): MRD1 upper lid to corneal reflex, MRD2 lower lid.
  function lids(P, drops) {
    var out = {};
    EYES.forEach(function (e) {
      var mul = P.mul[e] + (drops && drops.apra ? (1 - P.mul[e]) * 1.1 : 0);
      out[e] = { mrd1: 4 - 5.5 * (1 - P.lev[e]) - 2 * (1 - mul) + (P.retract || 0), mrd2: 5 - (1 - Math.min(1, mul)) };
    });
    return out;
  }

  /* ---------- conditions (data) ---------- */
  // Teaching text.
  var CONDITIONS = [
    { id: "normal", practice: true, group: "none", name: "Normal examination", bilateral: true, lesion: {},
      look: "Full ductions and versions, straight eyes in every gaze, level lids, equal pupils that constrict to light (direct and consensual) and to near.",
      site: "No lesion.", pearl: "Compare every patient with this: the healthy pattern is the reference for each test.", key: [] },
    // Foundation
    { id: "cn3", level: "f", group: "nerve", name: "{S} complete third nerve palsy",
      lesion: { mus: { I: { MR: 0, SR: 0, IR: 0, IO: 0 } }, lev: { I: 0 }, pupil: { I: { para: 0 } } },
      complaint: "Sudden drooping of one eyelid with a headache; double vision when the lid is lifted.",
      look: "Complete ptosis. Lift the lid: the eye rests down and out; adduction, elevation and depression are limited. On attempted downgaze the eye intorts, showing the fourth nerve is intact. The pupil is dilated and reacts neither to light nor to near.",
      site: "Third nerve between its midbrain nucleus and the orbit. With the pupil involved, compression of the nerve's outer pupillomotor fibres, classically a posterior communicating artery aneurysm, until proven otherwise.",
      pearl: "A painful third nerve palsy with a dilated pupil is an emergency: computed tomography (CT) angiography or magnetic resonance (MR) angiography the same day, to find a posterior communicating artery aneurysm. Pilocarpine 1% still constricts it, because the sphincter itself is healthy.",
      coach: "No parasympathetic drive reaches the {s} sphincter, so that pupil stays dilated to light and near; pilocarpine 1% acts on the sphincter directly.",
      key: ["lift", "gaze", "light"] },
    { id: "cn4", level: "f", group: "nerve", name: "{S} fourth nerve palsy", lesion: { mus: { I: { SO: 0 } } },
      complaint: "Vertical double vision, worse when reading or walking downstairs.",
      look: "Hypertropia of the affected eye, larger on gaze to the opposite side and down, and larger on head tilt toward the affected side (Bielschowsky). The higher eye is extorted.",
      site: "Fourth nerve, with the longest intracranial course: head injury, decompensated congenital palsy, or microvascular in older adults.",
      pearl: "Parks three-step: which eye is higher, worse in which horizontal gaze, worse on which head tilt. Patients tilt the head away from the affected side. An intorted higher eye suggests skew deviation instead.",
      key: ["gaze", "tilt", "cover"] },
    { id: "cn6", level: "f", group: "nerve", name: "{S} sixth nerve palsy", lesion: { mus: { I: { LR: 0 } } },
      complaint: "Horizontal double vision, worse in the distance and on looking to one side.",
      look: "Esotropia in primary position that grows on gaze toward the affected side, with limited abduction of that eye. The deviation is smallest looking away, and larger at distance than near.",
      site: "Sixth nerve: pons, a long subarachnoid course (a false localising sign of raised intracranial pressure), petrous apex, cavernous sinus.",
      pearl: "Bilateral sixth nerve palsies or papilloedema point to raised intracranial pressure: look at the discs.",
      key: ["gaze", "cover"] },
    { id: "horner", level: "f", group: "pupil", name: "{S} Horner syndrome", lesion: { mul: { I: 0 }, pupil: { I: { sym: 0 } } },
      complaint: "A relative noticed that one upper lid droops a little and that pupil looks small.",
      look: "Mild ptosis (about 2 mm) and a smaller pupil; the anisocoria is larger in the dark, the small pupil redilates slowly when the light goes off (dilation lag), and the lower lid sits slightly higher.",
      site: "Oculosympathetic pathway: hypothalamus, brainstem and cervical cord (first order), lung apex and neck (second order), carotid and cavernous sinus (third order).",
      pearl: "Apraclonidine 0.5% reverses the anisocoria: the Horner pupil dilates and the lid lifts through denervation supersensitivity. It can be negative in the first days, before supersensitivity develops; then use cocaine. Hydroxyamphetamine 1% fails to dilate a third-order (postganglionic) Horner pupil. A painful acute Horner needs urgent imaging for carotid dissection.",
      coach: "The {s} dilator has lost its sympathetic drive, so the difference grows in the dark and the {s} pupil redilates slowly.",
      key: ["dark", "apra"] },
    { id: "rapd", level: "f", group: "pupil", name: "{S} relative afferent pupillary defect", lesion: { aff: { I: 0.9 } }, grades: [0.3, 0.6, 0.9, 1.2],
      complaint: "Blurred vision in one eye over a few days; colours look washed out.",
      look: "The pupils are equal. Both constrict when the light is on the healthy eye and both dilate when it swings to the affected eye.",
      site: "Afferent pathway in front of the chiasm: usually the optic nerve (optic neuritis, ischaemic or compressive optic neuropathy), or extensive retinal disease.",
      pearl: "A relative afferent pupillary defect never causes anisocoria. Grade it by placing neutral density filters over the better eye until the swing is balanced: usually 0.3 to 1.2 log units, sometimes more.",
      coach: "Less light signal reaches the midbrain through the {s} optic nerve, so both pupils relax when the light moves to that eye.",
      key: ["swing", "filter"] },
    { id: "ino", level: "f", group: "supra", name: "{S} internuclear ophthalmoplegia", lesion: { mlf: { I: 0 } },
      complaint: "Double or blurred vision on looking to one side.",
      look: "On gaze away from the lesion, the eye on the lesion side adducts slowly or not at all while the other eye abducts with nystagmus. Convergence is usually preserved.",
      site: "Medial longitudinal fasciculus on the side of the adduction deficit, in the pons or midbrain: demyelination in the young, stroke in older patients.",
      pearl: "Internuclear ophthalmoplegia is named for the eye that fails to adduct. Adduction on convergence proves the medial rectus and its nerve work.",
      key: ["gaze", "near"] },
    // Resident
    { id: "cn3ps", level: "r", group: "nerve", name: "{S} pupil-sparing third nerve palsy",
      lesion: { mus: { I: { MR: 0.05, SR: 0.05, IR: 0.05, IO: 0.05 } }, lev: { I: 0.05 } },
      complaint: "Painful drooping lid and double vision in a patient with diabetes and hypertension.",
      look: "Complete ptosis and a down-and-out eye, but the pupil is equal to its fellow and reacts normally to light and near.",
      site: "Microvascular infarction of the third nerve core, sparing the peripheral pupillomotor fibres.",
      pearl: "Call it pupil sparing only when the palsy is otherwise complete and the pupil fully normal. Image it anyway (magnetic resonance imaging with magnetic resonance angiography, or computed tomography angiography): a posterior communicating artery aneurysm can spare the pupil at first, so recheck the pupil daily for a week. A microvascular palsy recovers within about 3 months; aberrant regeneration never follows it and means compression.",
      key: ["lift", "gaze", "light"] },
    { id: "cn3p", level: "r", group: "nerve", name: "{S} partial third nerve palsy, pupil involved",
      lesion: { mus: { I: { MR: 0.45, SR: 0.35, IR: 0.55, IO: 0.4 } }, lev: { I: 0.55 }, pupil: { I: { para: 0.55 } } },
      complaint: "Double vision and a slightly drooping lid, with a new headache.",
      look: "Partial ptosis, limited adduction, elevation and depression, and a mildly dilated pupil that reacts sluggishly; the anisocoria is larger in the light.",
      site: "A compressive third nerve lesion (aneurysm or tumour) until proven otherwise.",
      pearl: "Any pupil involvement, even a sluggish 1 to 2 mm anisocoria, makes this compressive until vascular imaging says otherwise.",
      coach: "A partial loss of parasympathetic drive leaves the {s} pupil larger in the light and sluggish.",
      key: ["gaze", "light", "dark"] },
    { id: "cav", level: "r", group: "nerve", name: "{S} cavernous sinus syndrome",
      lesion: { mus: { I: { MR: 0, SR: 0, IR: 0, IO: 0, SO: 0.1, LR: 0.1 } }, lev: { I: 0.1 }, mul: { I: 0 }, pupil: { I: { para: 0, sym: 0 } }, v1: { I: true } },
      complaint: "Double vision, a drooping eyelid and numbness of the forehead.",
      look: "A nearly frozen eye (third, fourth and sixth nerves), ptosis, and a mid-sized pupil that does not react, because both its parasympathetic and sympathetic supply are lost. Forehead and corneal sensation are reduced (V1).",
      site: "Cavernous sinus or superior orbital fissure: tumour, carotid aneurysm, carotid-cavernous fistula, thrombosis, Tolosa-Hunt syndrome.",
      pearl: "Several ocular motor nerves on one side plus V1 localise to the cavernous sinus. A mid-dilated fixed pupil means third nerve plus Horner.",
      coach: "Parasympathetic and sympathetic supply are both lost, so the {s} pupil sits mid-sized and does not react.",
      key: ["gaze", "lift", "light"] },
    { id: "oneHalf", level: "r", group: "supra", name: "{S} one-and-a-half syndrome", lesion: { gaze: { I: 0 }, mlf: { I: 0 }, drift: { C: { ab: 4 } } },
      complaint: "Sudden double vision and difficulty looking to one side.",
      look: "The eye on the lesion side makes no horizontal movement; the other eye can only abduct, with nystagmus. Vertical movements and convergence are spared; the other eye may drift out.",
      site: "Dorsal pontine tegmentum: the abducens nucleus or the paramedian pontine reticular formation (PPRF), together with the adjacent medial longitudinal fasciculus (MLF) on the same side.",
      pearl: "A horizontal gaze palsy (the one) plus an internuclear ophthalmoplegia (the half): the only horizontal movement left is abduction of the eye on the opposite side.",
      key: ["gaze", "near"] },
    { id: "dmb", level: "r", group: "supra", name: "Dorsal midbrain (Parinaud) syndrome", bilateral: true,
      lesion: { up: 0.1, retract: 2, crn: true, pupil: { B: { light: 0.12, mio: 0.8 } } },
      complaint: "Headaches, blurred vision and difficulty looking up.",
      look: "Upgaze palsy, eyelid retraction (Collier sign), mid-dilated pupils that react poorly to light but well to near (light-near dissociation), and convergence-retraction nystagmus on attempted upgaze.",
      site: "Dorsal midbrain and posterior commissure: pineal tumour, hydrocephalus, stroke.",
      pearl: "Light-near dissociation with an upgaze palsy is Parinaud syndrome until proven otherwise: image the pineal region.",
      coach: "Damage to the dorsal midbrain interrupts the pretectal light input; the near pathway runs more ventrally and survives.",
      key: ["gaze", "near", "light"] },
    { id: "skew", level: "r", group: "supra", name: "Skew deviation, {s} eye higher", sideq: "Higher eye", lesion: { drift: { I: { y: 3.5, t: 5 }, C: { y: -3.5, t: -5 } } },
      complaint: "Sudden vertical double vision with unsteadiness.",
      look: "A vertical deviation that is often similar in every gaze position, with the higher eye intorted and the lower eye extorted, unlike the extorted higher eye of a fourth nerve palsy. Head tilt changes little.",
      site: "Supranuclear otolith (utricular) pathway in the brainstem or cerebellum.",
      pearl: "The hypertropia of a skew deviation usually falls by half or more when the patient lies supine. Look for other brainstem signs.",
      key: ["gaze", "tilt"] },
    { id: "adie", level: "r", group: "pupil", name: "{S} Adie tonic pupil", lesion: { pupil: { I: { light: 0.12, near: 0.8, sup: true, tonic: true } } },
      complaint: "One pupil suddenly looks larger, and reading is blurred.",
      look: "A larger pupil in room light with a poor light reaction, a slow, sustained constriction to near and slow redilation afterwards. It constricts to dilute pilocarpine 0.1%.",
      site: "Ciliary ganglion or short ciliary nerves (postganglionic parasympathetic).",
      pearl: "Denervation supersensitivity: pilocarpine 0.1% constricts the Adie pupil and barely moves a normal one. With absent tendon reflexes it is Holmes-Adie syndrome.",
      coach: "The {s} sphincter has been reinnervated by accommodative fibres, so the light reaction is poor, the near reaction slow and tonic, and dilute pilocarpine constricts it.",
      key: ["light", "near", "pilo01"] },
    { id: "argyll", level: "r", group: "pupil", name: "Argyll Robertson pupils", bilateral: true, lesion: { pupil: { B: { light: 0, mio: 0.3, size: -1.0, irregular: true } } },
      complaint: "Referred after a routine check found small pupils.",
      look: "Small, irregular pupils in both eyes that do not react to light but constrict to near (light-near dissociation) and dilate poorly in the dark.",
      site: "Dorsal midbrain near the Edinger-Westphal nuclei, interrupting the pretectal light pathway.",
      pearl: "Classically neurosyphilis: request syphilis serology. Unlike Parinaud syndrome, the pupils are small.",
      coach: "The pretectal light pathway is interrupted while the more ventral near pathway is spared.",
      key: ["light", "near", "dark"] },
    { id: "ino2", level: "r", group: "supra", name: "Bilateral internuclear ophthalmoplegia", bilateral: true, lesion: { mlf: { B: 0 }, drift: { B: { ab: 5 } }, conv: 0.4 },
      complaint: "Double vision looking to either side; the eyes look turned out.",
      look: "Neither eye adducts on horizontal gaze, and the abducting eye has nystagmus in each direction. Both eyes drift out in primary position (wall-eyed bilateral internuclear ophthalmoplegia, WEBINO) and convergence is weak.",
      site: "Both medial longitudinal fasciculi near the midline: demyelination or stroke.",
      pearl: "Wall-eyed bilateral internuclear ophthalmoplegia (WEBINO) with weak convergence points to a more rostral, midbrain lesion.",
      key: ["gaze", "near", "cover"] },
    { id: "physAniso", level: "r", group: "pupil", name: "Physiological anisocoria, {s} pupil smaller", sideq: "Smaller pupil", lesion: { pupil: { I: { size: -0.6 } } },
      complaint: "Noticed in photographs that one pupil is slightly smaller.",
      look: "Anisocoria under 1 mm that is the same in light and dark, with brisk reactions, no ptosis and no dilation lag.",
      site: "No lesion: a normal variant found in about one person in five.",
      pearl: "Old photographs help. If the anisocoria grows in the dark and the small pupil redilates late, think Horner syndrome instead.",
      coach: "Nothing is damaged, so the difference stays the same in light and dark and both pupils react briskly.",
      key: ["dark", "light"] },
    { id: "pharm", level: "r", group: "pupil", name: "{S} pharmacological mydriasis", lesion: { pupil: { I: { block: true } } },
      complaint: "One pupil became very large today; no double vision and no drooping lid.",
      look: "A widely dilated pupil that reacts neither to light nor to near, with full eye movements and no ptosis. Pilocarpine 1% does not constrict it.",
      site: "Iris sphincter muscarinic receptors blocked by an atropine-like agent: plants, scopolamine patches, nebulisers.",
      pearl: "Pilocarpine 1% constricts a third nerve pupil but not a pharmacologically blocked one.",
      coach: "An atropine-like drug blocks the {s} sphincter receptors, so the pupil ignores light, near and pilocarpine.",
      key: ["light", "pilo1"] }
  ];
  var BY = {};
  CONDITIONS.forEach(function (c) { BY[c.id] = c; });
  // Close relatives earn partial credit (the classic confusions).
  var REL = [["cn3", "cn3ps"], ["cn3", "cn3p"], ["cn3ps", "cn3p"], ["cn3", "cav"], ["cn3", "pharm"], ["cn4", "skew"],
    ["cn6", "oneHalf"], ["ino", "ino2"], ["ino", "oneHalf"], ["dmb", "argyll"], ["argyll", "adie"], ["horner", "physAniso"], ["adie", "pharm"]];
  function related(a, b) {
    for (var i = 0; i < REL.length; i++) if ((REL[i][0] === a && REL[i][1] === b) || (REL[i][1] === a && REL[i][0] === b)) return true;
    return false;
  }
  var GROUPS = { nerve: "Cranial nerves", supra: "Supranuclear", pupil: "Pupils" };

  function label(id, side, grade) {
    var c = BY[id], w = side === "L" ? "left" : "right";
    var s = c.name.replace("{S}", w.charAt(0).toUpperCase() + w.slice(1)).replace("{s}", w);
    return grade ? s + ", " + grade.toFixed(1) + " log units" : s;
  }
  function sideText(s, c) { return s.replace(/\{s\}/g, c === "L" ? "left" : "right"); }

  function patient(id, side, grade) {
    var c = BY[id], P = build(c.lesion, side);
    if (c.grades && grade) P.aff[side === "L" ? "L" : "R"] = grade;
    return P;
  }
  // Case pools: Foundation is free; Resident adds its own conditions (Pro).
  function pool(level) {
    return CONDITIONS.filter(function (c) { return c.level === "f" || (level === "resident" && c.level === "r"); }).map(function (c) { return c.id; });
  }

  // Partial credit: exact call 1; right diagnosis wrong side 0.5; close relative 0.5 (0.25 wrong side);
  // same group 0.25 on the right side. truth/answer = {id, side} with side "R", "L" or "B".
  function grade(truth, ans) {
    var t = BY[truth.id], a = BY[ans.id], sideOk = truth.side === ans.side, right = [];
    if (!a) return { score: 0, ok: false, errType: "wrong", right: right };
    var sameGroup = a.group === t.group;
    if (sideOk) right.push("side");
    if (sameGroup) right.push("group");
    if (ans.id === truth.id) {
      right.push("diagnosis");
      return sideOk ? { score: 1, ok: true, errType: null, right: right } : { score: 0.5, ok: false, errType: "side", right: right };
    }
    if (related(ans.id, truth.id)) { right.push("related"); return { score: sideOk ? 0.5 : 0.25, ok: false, errType: "related", right: right }; }
    if (sameGroup) return { score: sideOk ? 0.25 : 0, ok: false, errType: "group", right: right };
    return { score: 0, ok: false, errType: "wrong", right: right };
  }

  /* ---------- derived findings (what the model shows; used for coaching and sign-off) ---------- */
  function devText(pdH, pdV, short) {
    var bits = [], h = Math.round(Math.abs(pdH)), v = Math.round(Math.abs(pdV));
    if (h >= 2) bits.push((pdH > 0 ? (short ? "ET " : "esotropia ") : (short ? "XT " : "exotropia ")) + h);
    if (v >= 2) bits.push((pdV > 0 ? (short ? "RHT " : "right hypertropia ") : (short ? "LHT " : "left hypertropia ")) + v);
    return bits.length ? bits.join(short ? " " : ", ") + (short ? "" : " prism dioptres") : short ? "0" : "straight";
  }
  var DIRS = [["abduction", 30, 0], ["adduction", -30, 0], ["elevation in abduction", 30, 25], ["elevation in adduction", -30, 25],
    ["depression in abduction", 30, -25], ["depression in adduction", -30, -25]];
  // Versions in the six cardinal positions: an eye that falls short of the target by 6 degrees more
  // than it already sits off in primary position is limited (so a comitant skew is not a limitation).
  function limits(P, e) {
    var sg = e === "R" ? 1 : -1, out = [], p0 = eyes(P, {})[e];
    DIRS.forEach(function (d) {
      var h = d[1] * sg, q = eyes(P, { h: h, v: d[2] })[e], s0, s1;
      if (d[2]) { s1 = d[2] > 0 ? d[2] - q.y : q.y - d[2]; s0 = d[2] > 0 ? -p0.y : p0.y; }
      else { s1 = h > 0 ? h - q.x : q.x - h; s0 = h > 0 ? -p0.x : p0.x; }
      if (s1 - Math.max(0, s0) > 6) out.push({ dir: d[0], short: s1 });
    });
    return out;
  }
  function amp(P, e, a, b) { return pupils(P, a)[e] - pupils(P, b)[e]; }

  function findings(P) {
    var f = [], w = { R: "right", L: "left" }, W = { R: "Right", L: "Left" };
    var p0 = eyes(P, {});
    f.push(Math.abs(p0.pdH) < 2 && Math.abs(p0.pdV) < 2 ? "Eyes straight in primary position" : "Primary position: " + devText(p0.pdH, p0.pdV));
    var ng = nine(P), worst = null;
    [4, 3, 5, 1, 7, 0, 2, 6, 8].forEach(function (i) {   // cardinal gazes win ties
      var g = ng[i], m = Math.abs(g.pdH) + Math.abs(g.pdV);
      if (!worst || m > worst.m + 1) worst = { g: g, m: m };
    });
    if (worst.m >= 4 && (worst.g.h || worst.g.v)) f.push("Largest deviation " + gazeName(worst.g.h, worst.g.v) + ": " + devText(worst.g.pdH, worst.g.pdV));
    EYES.forEach(function (e) {
      var d = limits(P, e);
      if (d.length) f.push(W[e] + " eye: limited " + d.map(function (x) { return x.dir; }).join(", "));
    });
    var nr = eyes(P, { near: true });
    // Convergence is judged by the movement, or by intact pathways: a sixth nerve eye adducts on convergence
    // even though, with no lateral rectus to relax, the model moves it only half as far.
    var cvOk = { R: nr.R.x < p0.R.x - CONV * 0.6 || (P.mus.R.MR >= 0.9 && P.conv >= 0.9), L: nr.L.x > p0.L.x + CONV * 0.6 || (P.mus.L.MR >= 0.9 && P.conv >= 0.9) };
    if ((P.mlf.R < 1 || P.mlf.L < 1) || !cvOk.R || !cvOk.L)
      f.push(cvOk.R && cvOk.L ? "Convergence preserved" : !cvOk.R && !cvOk.L ? "Convergence weak in both eyes" : "Convergence: the " + (cvOk.R ? "left" : "right") + " eye does not adduct");
    EYES.forEach(function (e) {
      var ab = eyes(P, { h: e === "R" ? 30 : -30 });
      if (ab.nys[e]) f.push("Abducting nystagmus of the " + w[e] + " eye on " + w[e] + " gaze");
    });
    if (P.crn) f.push("Convergence-retraction nystagmus on attempted upgaze");
    var vert = Math.abs(p0.pdV) >= 2 && Math.abs(p0.pdV) >= Math.abs(p0.pdH);
    if (vert) {
      var tr = eyes(P, { tilt: 1 }), tl = eyes(P, { tilt: -1 });
      if (Math.abs(tr.pdV - tl.pdV) >= 3)
        f.push("Head tilt: " + devText(0, tr.pdV) + " on right tilt, " + devText(0, tl.pdV) + " on left tilt");
      else if (Math.abs(p0.pdV) >= 2) f.push("Head tilt changes the vertical deviation little");
    }
    EYES.forEach(function (e) {
      var t = p0[e].t;
      if (vert && Math.abs(t) >= 3) f.push(W[e] + " eye " + (t > 0 ? "intorted" : "extorted") + " about " + Math.round(Math.abs(t)) + " degrees");
    });
    var ld = lids(P, {});
    EYES.forEach(function (e) {
      var m = ld[e].mrd1;
      if (m < 0.5) f.push(W[e] + " upper lid covers the pupil (complete ptosis)");
      else if (m < 3.5) f.push(W[e] + " ptosis about " + Math.round((4 - m) * 2) / 2 + " mm");
      if (ld[e].mrd2 < 4.5) f.push(W[e] + " lower lid slightly raised");
    });
    if (P.retract) f.push("Upper lid retraction (Collier sign)");
    EYES.forEach(function (e) { if (P.v1[e]) f.push("Reduced " + w[e] + " forehead and corneal sensation (V1)"); });
    var L = pupils(P, { room: "light" }), D = pupils(P, { room: "dark" });
    var aL = L.R - L.L, aD = D.R - D.L;
    f.push("Pupils in light " + mm(L.R) + " and " + mm(L.L) + ", in dark " + mm(D.R) + " and " + mm(D.L) + " (right, left)");
    if (Math.abs(aL) >= 0.4 || Math.abs(aD) >= 0.4)
      f.push("Anisocoria " + (Math.abs(Math.abs(aD) - Math.abs(aL)) < 0.25 ? "the same in light and dark" : Math.abs(aD) > Math.abs(aL) ? "greater in the dark" : "greater in the light"));
    EYES.forEach(function (e) {
      var lr = amp(P, e, { room: "dark" }, { room: "dark", light: e }), nr2 = amp(P, e, { room: "light" }, { room: "light", near: true });
      if (lr < 0.4 && nr2 < 0.4) f.push(W[e] + " pupil reacts neither to light nor to near");
      else if (lr < 0.6 && nr2 >= 0.6) f.push(W[e] + " pupil: light-near dissociation");
      else if (P.pupil[e].para < 1 && nr2 >= 0.4 && (lr < 1.2 || lr < 0.7 * amp(P, other(e), { room: "dark" }, { room: "dark", light: other(e) }))) f.push(W[e] + " pupil reacts sluggishly");
      if (P.pupil[e].tonic) f.push(W[e] + " pupil: slow, tonic near response and slow redilation");
      if (P.pupil[e].sym < 1 && P.pupil[e].para === 1 && !P.pupil[e].block) f.push(W[e] + " pupil redilates slowly in the dark (dilation lag)");
    });
    EYES.forEach(function (e) {
      if (P.aff[e] > 0) f.push(W[e] + " relative afferent pupillary defect (RAPD): both pupils dilate when the light swings to the " + w[e] + " eye (balanced by a " + P.aff[e].toFixed(1) + " log unit filter over the other eye)");
    });
    var drops = [["apra", "Apraclonidine 0.5%"], ["pilo01", "Pilocarpine 0.1%"], ["pilo1", "Pilocarpine 1%"]];
    drops.forEach(function (d) {   // report the eye whose response differs from its fellow's
      var dr = {}; dr[d[0]] = true;
      var after = pupils(P, { room: "light", drops: dr }), ch = {};
      EYES.forEach(function (e) { ch[e] = after[e] - L[e]; });
      EYES.forEach(function (e) {
        var o = other(e), odd = d[0] === "pilo1" ? P.pupil[e].block || P.pupil[e].para < 1 :
          P.pupil[e].para === 1 && Math.abs(ch[e] - ch[o]) >= 0.8 && Math.abs(ch[e]) > Math.abs(ch[o]);
        if (!odd) return;
        var rev = d[0] === "apra" && L[e] < L[o] && after[e] > after[o];
        f.push(d[1] + ": " + w[e] + " pupil " + (Math.abs(ch[e]) < 0.3 ? "does not change" : ch[e] > 0 ? "dilates to " + mm(after[e]) : "constricts to " + mm(after[e])) +
          (rev ? ", reversing the anisocoria" : ""));
      });
    });
    return f;
  }
  function mm(x) { return x.toFixed(1) + " mm"; }
  function gazeName(h, v) {
    if (!h && !v) return "in primary position";
    var s = [];
    if (v) s.push(v > 0 ? "up" : "down");
    if (h) s.push(h > 0 ? "right" : "left");
    return "looking " + s.join(" and ");
  }

  var API = {
    RH: RH, RV: RV, CONV: CONV, MUS: MUS, CONDITIONS: CONDITIONS, BY: BY, GROUPS: GROUPS, NINE: NINE,
    normal: normal, build: build, patient: patient, eyePos: eyePos, eyes: eyes, nine: nine, hess: hess,
    pupils: pupils, pupilStep: pupilStep, tau: tau, lids: lids, pd: pd, pool: pool, grade: grade, related: related,
    label: label, sideText: sideText, findings: findings, limits: limits, devText: devText, gazeName: gazeName, other: other
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  G.OPHTHALMOS_NEURO = API;

  /* ================= UI (browser) ================= */
  var O = G.OPHTHALMOS, N = API;
  if (!O || !O._internal || !G.document) return;
  var I = O._internal, st = O._st, CORE = G.OPHTHALMOS_CORE, DATA = G.OPHTHALMOS_DATA;
  var esc = I.esc;
  function ico(n) { var h = I.ico(n); return h ? '<span class="nr-i" aria-hidden="true">' + h + "</span>" : ""; }
  var W = { R: "right", L: "left" };
  function Cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function $(id) { return G.document.getElementById(id); }
  var MNAME = { LR: "lateral rectus", MR: "medial rectus", SR: "superior rectus", IR: "inferior rectus", IO: "inferior oblique", SO: "superior oblique" };
  var NERVE = { LR: "abducens (sixth) nerve", SO: "trochlear (fourth) nerve", MR: "oculomotor (third) nerve", SR: "oculomotor (third) nerve", IR: "oculomotor (third) nerve", IO: "oculomotor (third) nerve" };
  // Key examination steps, named once for the sign-off and the teaching.
  var KEYT = {
    gaze: ["Pursuit in all directions", "Take the target into each of the eight gaze positions and hold it there."],
    cover: ["Cover test", "Cover each eye in turn and watch the other eye for a refixation movement."],
    tilt: ["Head tilt", "Tilt the head to each shoulder and compare the vertical deviation."],
    near: ["Near target", "Bring the near target in: watch convergence and the pupils."],
    lift: ["Lift the lids", "Lift a drooping lid to see where the eye sits and what the pupil does."],
    light: ["Light reaction", "Shine the light into each eye and watch both pupils."],
    swing: ["Swinging light", "Swing the light from eye to eye, pausing on each."],
    dark: ["Dark room", "Compare the pupils in the dark as well as in the light."],
    filter: ["Neutral density filter", "Grade a relative afferent defect with filters over the better eye."],
    apra: ["Apraclonidine 0.5%", "Apraclonidine in both eyes tests for Horner syndrome."],
    pilo01: ["Pilocarpine 0.1%", "Dilute pilocarpine tests for a supersensitive, tonic pupil."],
    pilo1: ["Pilocarpine 1%", "Pilocarpine 1% separates a third nerve pupil from a blocked one."]
  };
  var SIDETIP = {
    ino: "An internuclear ophthalmoplegia takes the side of the eye that fails to adduct.",
    oneHalf: "The side is the eye that makes no horizontal movement.",
    skew: "Name a skew deviation by the higher eye.",
    rapd: "The defect is in the eye whose illumination makes both pupils dilate.",
    physAniso: "Name physiological anisocoria by the smaller pupil."
  };
  var DROPS = [["apra", "Apraclonidine 0.5%"], ["pilo01", "Pilocarpine 0.1%"], ["pilo1", "Pilocarpine 1%"]];
  var FILTERS = [0.3, 0.6, 0.9, 1.2];

  var U = {
    mode: "practice", tab: "motility", prac: { id: "cn6", side: "R", grade: 0.9 }, cse: null, last: null,
    P: null, ex: null, px: null, log: {}, dirs: {}, p0: null,
    tgt: null, ptgt: null, lid: null, cur: null, pup: null, tiltA: 0,
    cv: null, ctx: null, W: 0, H: 0, dpr: 1, raf: 0, t0: 0, dirty: true, drag: false, reduce: false, ro: null
  };
  function freshExam() {
    U.ex = { h: 0, v: 0, cover: null, tilt: 0, near: false, lift: false };
    U.px = { room: "light", light: null, drops: {}, filter: { R: 0, L: 0 } };
    U.log = {}; U.dirs = {};
  }
  function bare(c) { var s = c.name.replace("{S} ", "").replace(/, \{s\}.*$/, ""); return Cap(s); }
  function sideOf(c, side) { return c.bilateral ? "B" : side; }
  function condLabel(id, side, grade) { var c = N.BY[id]; return c.bilateral ? c.name : N.label(id, side, c.grades ? grade : null); }
  function resLocked() { return I.levelLocked("resident"); }
  function levelName(lv) { try { return st.cfg.levels[lv].label; } catch (e) { return lv === "resident" ? "Resident" : "MBBS"; } }

  /* ---------- patient and exam state ---------- */
  function setPatient(P, instant) {
    U.P = P; U.p0 = N.eyes(P, {});
    refresh();
    if (instant || !U.cur) snap();
  }
  function snap() {
    U.cur = { R: { x: U.tgt.R.x, y: U.tgt.R.y, t: U.tgt.R.t }, L: { x: U.tgt.L.x, y: U.tgt.L.y, t: U.tgt.L.t } };
    U.pup = { R: U.ptgt.R, L: U.ptgt.L }; U.tiltA = U.ex.tilt * 12; U.dirty = true;
  }
  function pxNow() { return { room: U.px.room, light: U.px.light, near: U.ex.near, drops: U.px.drops, filter: U.px.filter }; }
  function refresh() {
    U.tgt = N.eyes(U.P, U.ex);
    U.ptgt = N.pupils(U.P, pxNow());
    U.lid = N.lids(U.P, U.px.drops);
    U.dirty = true;
  }
  function practicePatient() { var p = U.prac, c = N.BY[p.id]; return N.patient(p.id, sideOf(c, p.side), c.grades ? p.grade : null); }

  /* ---------- screen ---------- */
  function subText() {
    if (U.mode === "case" && U.cse) return "Case " + U.cse.n + " · " + esc(levelName(U.cse.lv));
    if (U.mode === "case") return "Case";
    return "Practice · " + esc(condLabel(U.prac.id, U.prac.side, U.prac.grade));
  }
  function setSub() { var s = G.document.querySelector("#smdOphthalmos .oph-title span"); if (s) s.innerHTML = subText(); }

  function open() {
    I.leave();
    st.view = "neuro";
    try { U.reduce = !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { U.reduce = false; }
    freshExam();
    U.cur = null;
    if (U.mode === "case" && U.cse && !caseLocked()) setPatient(U.cse.P, true);
    else { if (U.mode === "case" && !U.cse && !caseLocked()) return startCase(true); setPatient(practicePatient(), true); }
    paintScreen();
  }

  function paintScreen() {
    I.paint(I.top("Back to clinics", "Neuro-ophthalmology", subText()) +
      '<div class="nr-screen">' +
      '<div class="nr-stage" id="nrStage" data-tab="' + U.tab + '"><canvas id="nrCv" aria-hidden="true"></canvas>' +
      '<p class="nr-nocv" id="nrNoCv" hidden>The live model cannot be drawn on this device. The line below describes what you would see.</p></div>' +
      '<p class="nr-live" id="nrLive" role="status" aria-live="polite" aria-atomic="true"></p>' +
      '<div class="nr-panel oph-scroll" id="nrPanel">' + panelHtml() + "</div></div>",
      ".nr-mode [aria-pressed=true]");
    var stage = $("nrStage"), cv = $("nrCv"), ctx = null;
    try { ctx = cv.getContext("2d"); } catch (e) { ctx = null; }
    U.cv = cv; U.ctx = ctx;
    if (!ctx) { cv.hidden = true; $("nrNoCv").hidden = false; }
    else {
      resize();
      if (G.ResizeObserver) { U.ro = new G.ResizeObserver(resize); U.ro.observe(stage); }
      else G.addEventListener("resize", resize);
      stage.addEventListener("pointerdown", onDown);
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerup", onUp);
      stage.addEventListener("pointercancel", onUp);
      U.t0 = 0; U.raf = G.requestAnimationFrame(loop);
    }
    $("nrPanel").addEventListener("change", onChange);
    st.onLeave = stop;
    say();
  }
  function stop() {
    if (U.raf) G.cancelAnimationFrame(U.raf);
    U.raf = 0;
    if (U.ro) { U.ro.disconnect(); U.ro = null; } else G.removeEventListener("resize", resize);
    U.ctx = null; U.cv = null; U.drag = false;
  }
  function resize() {
    var stage = $("nrStage");
    if (!stage || !U.cv) return;
    U.dpr = Math.min(3, G.devicePixelRatio || 1);
    U.W = stage.clientWidth; U.H = stage.clientHeight;
    U.cv.width = Math.round(U.W * U.dpr); U.cv.height = Math.round(U.H * U.dpr);
    U.dirty = true;
  }
  function renderPanel(focusSel) {
    var p = $("nrPanel"); if (!p) return;
    p.innerHTML = panelHtml();
    setSub();
    var f = focusSel && p.querySelector(focusSel);
    try { if (f) f.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------- panel ---------- */
  function segBtn(act, k, v, label, cur) {
    return '<button type="button" data-act="' + act + '"' + (k ? ' data-k="' + k + '"' : "") + ' data-v="' + esc(v) + '" aria-pressed="' + (String(cur) === String(v)) + '">' + label + "</button>";
  }
  function panelHtml() {
    var h = '<div class="oph-seg nr-mode nr-full" role="group" aria-label="Mode">' +
      segBtn("nrmode", "", "practice", "Practice", U.mode) + segBtn("nrmode", "", "case", "Case", U.mode) + "</div>";
    if (U.mode === "case" && caseLocked()) return h + lockedHtml();
    h += U.mode === "practice" ? practiceHead() : caseHead();
    h += '<section class="nr-exam" aria-label="Examination"><div class="oph-seg nr-tabs nr-full" role="group" aria-label="Examination">' +
      segBtn("nrtab", "", "motility", "Eye movements", U.tab) + segBtn("nrtab", "", "pupils", "Pupils", U.tab) + "</div>" +
      '<div id="nrTools">' + (U.tab === "motility" ? motilityHtml() : pupilHtml()) + "</div>" +
      '<p class="nr-hint">Keys: arrows move the target (Shift for bigger steps), 0 straight ahead, C cover, T tilt, N near, L lift lids, S swing the light, D room light.</p></section>';
    if (U.mode === "practice") h += (guided() ? '<ol class="oph-guide" id="nrGuide" aria-label="Next steps">' + guideHtml() + "</ol>" : "") +
      '<section id="nrFind" aria-label="What the model shows">' + practiceFindings() + "</section>";
    else h += '<section id="nrSign" aria-label="Your diagnosis">' + (U.cse.res ? signedHtml() : answerHtml()) + "</section>";
    return h;
  }

  function condOptions(ids, cur, withPro) {
    var html = "", groups = {};
    ids.forEach(function (id) { var g = N.BY[id].group; (groups[g] = groups[g] || []).push(id); });
    ["nerve", "supra", "pupil"].forEach(function (g) {
      if (!groups[g]) return;
      html += '<optgroup label="' + N.GROUPS[g] + '">' + groups[g].map(function (id) {
        var c = N.BY[id], pro = withPro && c.level === "r" && resLocked();
        return '<option value="' + id + '"' + (id === cur ? " selected" : "") + ">" + esc(bare(c)) + (pro ? " (Pro)" : "") + "</option>";
      }).join("") + "</optgroup>";
    });
    return html;
  }
  function practiceHead() {
    var p = U.prac, c = N.BY[p.id];
    var ids = N.CONDITIONS.filter(function (x) { return x.level; }).map(function (x) { return x.id; });
    var h = '<div class="nr-field"><label for="nrCond">Condition</label><select id="nrCond" name="condition">' +
      '<option value="normal"' + (p.id === "normal" ? " selected" : "") + ">Normal examination</option>" + condOptions(ids, p.id, true) + "</select></div>";
    if (!c.bilateral || c.grades) {
      h += '<div class="nr-row2">';
      if (!c.bilateral) h += '<div class="nr-row"><span class="nr-lab" id="nrSideL">' + (c.sideq || "Side") + '</span><div class="oph-seg nr-full" role="group" aria-labelledby="nrSideL">' +
        segBtn("nrside", "", "R", "Right", p.side) + segBtn("nrside", "", "L", "Left", p.side) + "</div></div>";
      if (c.grades) h += '<div class="nr-row"><span class="nr-lab" id="nrGradeL">Log units</span><div class="oph-seg nr-full" role="group" aria-labelledby="nrGradeL">' +
        c.grades.map(function (g) { return segBtn("nrgrade", "", g, g.toFixed(1), p.grade); }).join("") + "</div></div>";
      h += "</div>";
    }
    return h;
  }

  var PAD = [[30, 25, "Up and to the patient’s right"], [0, 25, "Up"], [-30, 25, "Up and to the patient’s left"],
    [30, 0, "To the patient’s right"], [0, 0, "Straight ahead"], [-30, 0, "To the patient’s left"],
    [30, -25, "Down and to the patient’s right"], [0, -25, "Down"], [-30, -25, "Down and to the patient’s left"]];
  function motilityHtml() {
    var ex = U.ex;
    var pad = PAD.map(function (g) {
      var on = ex.h === g[0] && ex.v === g[1];
      return '<button type="button" data-act="nrgaze" data-h="' + g[0] + '" data-g="' + g[1] + '" aria-label="' + g[2] + '" aria-pressed="' + on + '"><i aria-hidden="true"></i></button>';
    }).join("");
    return '<div class="nr-mot"><div class="nr-padw"><span class="nr-lab" id="nrPadL">Gaze</span><div class="nr-pad" role="group" aria-labelledby="nrPadL">' + pad + "</div></div>" +
      '<div class="nr-ctl">' +
      ctlRow("Cover", "cover", [["R", "Right"], ["", "Off"], ["L", "Left"]], ex.cover || "") +
      ctlRow("Head tilt", "tilt", [["1", "Right"], ["0", "Level"], ["-1", "Left"]], ex.tilt) +
      '<div class="nr-togs">' + tog("near", "Near target", ex.near) + tog("lift", "Lift lids", ex.lift) + "</div></div></div>";
  }
  function ctlRow(label, k, opts, cur) {
    var id = "nrL" + k;
    return '<div class="nr-row nr-stack"><span class="nr-lab" id="' + id + '">' + label + '</span><div class="oph-seg nr-full" role="group" aria-labelledby="' + id + '">' +
      opts.map(function (o) { return segBtn("nrset", k, o[0], o[1], cur); }).join("") + "</div></div>";
  }
  function tog(k, label, on) {
    return '<button type="button" class="nr-tog" data-act="nrset" data-k="' + k + '" data-v="toggle" aria-pressed="' + !!on + '"><span class="nr-tick" aria-hidden="true">' + ico("check") + "</span>" + label + "</button>";
  }
  function pupilHtml() {
    var px = U.px, fcur = px.filter.R ? "R" + px.filter.R : px.filter.L ? "L" + px.filter.L : "0";
    var fopts = '<option value="0">No filter</option>' + ["R", "L"].map(function (e) {
      return FILTERS.map(function (f) { var v = e + f; return '<option value="' + v + '"' + (v === fcur ? " selected" : "") + ">" + f.toFixed(1) + " log units over the " + W[e] + " eye</option>"; }).join("");
    }).join("");
    return ctlRowP("Room", "room", [["light", ico("sun") + "Lit"], ["dark", ico("moon") + "Dark"]], px.room) +
      ctlRowP("Penlight", "light", [["R", "Right eye"], ["", "Off"], ["L", "Left eye"]], px.light || "") +
      '<div class="nr-row"><span class="nr-lab">Near</span><div>' + tog("near", "Near target", U.ex.near) + "</div></div>" +
      '<div class="nr-row"><label class="nr-lab" for="nrFilt">Filter</label><select id="nrFilt" name="filter" class="nr-sel">' + fopts + "</select></div>" +
      '<div class="nr-row nr-droprow"><span class="nr-lab" id="nrDropL">Drops</span><div class="nr-drops" role="group" aria-labelledby="nrDropL">' +
      DROPS.map(function (d) { return '<button type="button" class="nr-tog" data-act="nrdrop" data-v="' + d[0] + '" aria-pressed="' + !!px.drops[d[0]] + '"><span class="nr-tick" aria-hidden="true">' + ico("check") + "</span>" + d[1] + "</button>"; }).join("") +
      '<button type="button" class="nr-tog nr-wash" data-act="nrwash">' + ico("refresh") + "Wash out</button></div></div>" +
      '<p class="oph-small nr-dropnote">Drops go into both eyes; the model reads the pupils 40 minutes later.</p>';
  }
  function ctlRowP(label, k, opts, cur) {
    var id = "nrL" + k;
    return '<div class="nr-row"><span class="nr-lab" id="' + id + '">' + label + '</span><div class="oph-seg nr-full" role="group" aria-labelledby="' + id + '">' +
      opts.map(function (o) { return segBtn("nrset", k, o[0], o[1], cur); }).join("") + "</div></div>";
  }
  // Keep the controls' pressed state in step with the exam without rebuilding them (focus stays put).
  function syncControls() {
    var p = $("nrPanel"); if (!p) return;
    Array.prototype.forEach.call(p.querySelectorAll("[data-act=nrset]"), function (b) {
      var k = b.getAttribute("data-k"), v = b.getAttribute("data-v"), cur;
      if (k === "room" || k === "light") cur = U.px[k] || "";
      else cur = U.ex[k] == null ? "" : U.ex[k];
      b.setAttribute("aria-pressed", String(v === "toggle" ? !!cur : String(cur) === v));
    });
    Array.prototype.forEach.call(p.querySelectorAll("[data-act=nrgaze]"), function (b) {
      b.setAttribute("aria-pressed", String(+b.getAttribute("data-h") === U.ex.h && +b.getAttribute("data-g") === U.ex.v));
    });
    Array.prototype.forEach.call(p.querySelectorAll("[data-act=nrdrop]"), function (b) { b.setAttribute("aria-pressed", String(!!U.px.drops[b.getAttribute("data-v")])); });
  }

  /* ---------- findings, Hess chart, teaching ---------- */
  function findingsList(P) { return '<ul class="oph-signs">' + N.findings(P).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>"; }
  function nineHtml(P) {
    var g = N.nine(P), rows = ["Up", "Level", "Down"];
    return '<table class="nr-nine"><caption>Deviation in the nine gaze positions, in prism dioptres, as you face the patient. Esotropia (ET), exotropia (XT), right and left hypertropia (RHT, LHT).</caption>' +
      '<thead><tr><td></td><th scope="col">Patient’s right</th><th scope="col">Centre</th><th scope="col">Patient’s left</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr><th scope="row">' + r + "</th>" + g.slice(i * 3, i * 3 + 3).map(function (c) {
          return "<td" + (c.h === 0 && c.v === 0 ? ' class="p"' : "") + ">" + N.devText(c.pdH, c.pdV, true) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }
  function hessSvg(d, e) {
    var S = 2, c = 80;
    function X(v) { return (c + clamp(v, -38, 38) * S).toFixed(1); }
    function Y(v) { return (c - clamp(v, -38, 38) * S).toFixed(1); }
    var grid = "";
    [-30, -15, 0, 15, 30].forEach(function (g) { grid += '<line x1="' + X(g) + '" y1="4" x2="' + X(g) + '" y2="156"/><line x1="4" y1="' + Y(g) + '" x2="156" y2="' + Y(g) + '"/>'; });
    function poly(pts) { return pts.map(function (p) { return X(p.x) + "," + Y(p.y); }).join(" "); }
    function ideal(r) { return '<rect x="' + X(-r) + '" y="' + Y(r) + '" width="' + 2 * r * S + '" height="' + 2 * r * S + '"/>'; }
    var worst = null;
    d.outer.forEach(function (p) { var m = Math.abs(p.x - p.h) + Math.abs(p.y - p.v); if (!worst || m > worst.m) worst = { p: p, m: m }; });
    var desc = worst.m < 4 ? "field full" : "largest error " + Math.round(worst.m) + " degrees at the target " + N.gazeName(worst.p.h, worst.p.v).replace("looking ", "");
    return '<figure class="nr-hessf"><svg viewBox="0 0 160 160" role="img" aria-label="Hess chart, ' + W[e] + " eye: " + desc + '">' +
      '<g class="g">' + grid + '</g><g class="i">' + ideal(15) + ideal(30) + "</g>" +
      '<g class="f"><polygon points="' + poly(d.outer) + '"/><polygon points="' + poly(d.inner) + '"/>' +
      d.outer.concat(d.inner).map(function (p) { return '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="2"/>'; }).join("") +
      '<circle cx="' + X(d.centre.x) + '" cy="' + Y(d.centre.y) + '" r="2.4"/></g></svg><figcaption>' + Cap(W[e]) + " eye</figcaption></figure>";
  }
  function hessHtml(P) {
    var H = N.hess(P);
    return '<h3 class="oph-h3">Hess chart</h3><p class="oph-small">As the patient sees it: each eye plotted while the other eye fixes; dashed squares are the normal 15 and 30 degree fields.</p>' +
      '<div class="nr-hess">' + hessSvg(H.L, "L") + hessSvg(H.R, "R") + "</div>";
  }
  function noteHtml(c, side) {
    return '<h3 class="oph-h3">What to look for</h3><p class="nr-p">' + esc(N.sideText(c.look, side)) + "</p>" +
      '<h3 class="oph-h3">Where the lesion is</h3><p class="nr-p">' + esc(c.site) + "</p>" +
      '<p class="oph-pearl">' + esc(c.pearl) + "</p>";
  }
  function practiceFindings() {
    var p = U.prac, c = N.BY[p.id];
    return '<h2 class="oph-h2">What the model shows</h2>' + findingsList(U.P) + nineHtml(U.P) + hessHtml(U.P) + noteHtml(c, p.side);
  }

  // MBBS guided practice: the key tests for the condition on show, numbered, ticked as they are done (U.log),
  // the first one not yet done marked as the next step.
  function guided() { return U.mode === "practice" && I.level() !== "resident"; }
  function guideHtml() {
    var c = N.BY[U.prac.id], keys = c.key && c.key.length ? c.key : ["gaze", "cover", "swing"], at = -1;
    return keys.map(function (x, i) {
      var done = !!U.log[x], now = !done && at < 0;
      if (now) at = i;
      return '<li data-s="' + (done ? "done" : now ? "now" : "todo") + '"' + (now ? ' aria-current="step"' : "") + "><b>" + KEYT[x][0] + ".</b> " + esc(KEYT[x][1]) + (done ? '<span class="oph-sr">, done</span>' : "") + "</li>";
    }).join("");
  }

  /* ---------- case mode ---------- */
  // Resident cases are Pro with one free trial (sim.neuro); the trial case stays open until "Next case".
  function caseLocked() { return I.level() === "resident" && resLocked() && !(U.cse && U.cse.trial); }
  function lockedHtml() {
    var tr = I.trial("sim.neuro") === "trial";
    return '<div class="nr-locked"><p>Resident cases add pupil-sparing and partial third nerve palsies, the cavernous sinus, one-and-a-half, dorsal midbrain, skew deviation, Adie and Argyll Robertson pupils and bilateral internuclear ophthalmoplegia. They are part of StewardMD Pro.</p>' +
      (tr ? '<button type="button" class="oph-btn pri oph-wide" data-act="nrtrial">Start a Resident case ' + I.lockBadge("sim.neuro") + "</button>"
        : '<button type="button" class="oph-btn pri oph-wide" data-act="nrpro">' + ico("lock") + " Unlock Resident cases</button>" + '<p class="oph-small">' + I.lockBadge("sim.neuro") + "</p>") +
      '<button type="button" class="oph-btn sec oph-wide" data-act="nrfound">' + esc(levelName("foundation")) + " cases instead</button></div>";
  }
  function startCase(first) {
    var lv = I.level(), ids = N.pool(lv).filter(function (id) { return id !== U.last; });
    var id = ids[Math.floor(Math.random() * ids.length)], c = N.BY[id];
    var side = c.bilateral ? "B" : Math.random() < 0.5 ? "R" : "L";
    var grade = c.grades ? c.grades[Math.floor(Math.random() * c.grades.length)] : null;
    var rec = (st.store.sims || {}).neuro;
    U.cse = { id: id, side: side, grade: grade, lv: lv, n: (rec ? rec.n : 0) + 1, P: N.patient(id, side, grade), ans: { id: "", side: "" }, res: null };
    U.last = id;
    freshExam();
    setPatient(U.cse.P, true);
    if (first) return paintScreen();
    renderPanel(".nr-mode [aria-pressed=true]");
    syncControls();
    say("New patient.");
  }
  function caseHead() {
    var k = U.cse, c = N.BY[k.id], signed = !!k.res;
    var imp = signed
      ? (k.res.ok ? ico("check") : ico("close")) + '<span><span class="oph-imp-k">Diagnosis</span>' + esc(condLabel(k.id, k.side, k.grade)) + "</span>"
      : '<span><span class="oph-imp-k">Diagnosis</span>after your sign-off</span>';
    return '<div class="oph-card nr-card"><div class="oph-card-l"><b>Case ' + k.n + " · " + esc(levelName(k.lv)) + "</b><span>“" + esc(c.complaint) + "”</span></div>" +
      '<div class="oph-card-imp' + (signed ? k.res.ok ? " ok" : " bad" : "") + '" id="nrImp">' + imp + "</div></div>";
  }
  function answerHtml() {
    var k = U.cse;
    return '<h2 class="oph-q" id="nrDxQ">Your diagnosis</h2>' +
      '<div class="nr-field"><label for="nrDx">Diagnosis</label><select id="nrDx" name="diagnosis"><option value="">Choose a diagnosis</option>' + condOptions(N.pool(k.lv), k.ans.id, false) + "</select></div>" +
      '<div class="nr-row"><span class="nr-lab" id="nrAnsL">' + esc((N.BY[k.ans.id] && N.BY[k.ans.id].sideq) || "Side") + '</span><div class="oph-seg nr-full" role="group" aria-labelledby="nrAnsL">' +
      segBtn("nrans", "", "R", "Right", k.ans.side) + segBtn("nrans", "", "L", "Left", k.ans.side) + segBtn("nrans", "", "B", "Both", k.ans.side) + "</div></div>" +
      '<p class="nr-err" id="nrErr" role="alert"></p>' +
      '<button type="button" class="oph-btn pri oph-wide" data-act="nrsign">Sign off</button>';
  }
  function signOff() {
    var k = U.cse, a = k.ans, err = $("nrErr");
    if (!a.id || !a.side) {   // name the gap and move focus to it
      if (err) err.textContent = !a.id ? "Choose a diagnosis first." : "Choose the side: right, left or both.";
      var f = !a.id ? $("nrDx") : G.document.querySelector("[data-act=nrans]");
      try { if (f) f.focus(); } catch (x) {}
      return;
    }
    var res = N.grade({ id: k.id, side: k.side }, a);
    k.res = res;
    CORE.recordSim(st.store, "neuro", res.ok, res.errType, I.today());
    I.save();
    I.haptic(res.ok ? "success" : "error");
    renderPanel();
    var s = $("nrSign"), p = $("nrPanel"), v = s && s.querySelector(".oph-reveal");
    if (v && !U.reduce) { v.classList.add("pre"); G.requestAnimationFrame(function () { G.requestAnimationFrame(function () { v.classList.remove("pre"); }); }); }
    try { p.scrollTo({ top: Math.max(0, s.offsetTop - p.offsetTop - 8), behavior: U.reduce ? "auto" : "smooth" }); } catch (e) { p.scrollTop = s.offsetTop; }
    var nx = $("nrNext"); try { if (nx) nx.focus({ preventScroll: true }); } catch (e) {}
    say(res.ok ? "Signed off: correct." : "Signed off.");
  }
  function signedHtml() {
    var k = U.cse, r = k.res, t = N.BY[k.id], a = N.BY[k.ans.id], tl = condLabel(k.id, k.side, k.grade);
    var al = a.bilateral ? a.name : N.label(a.id, k.ans.side === "B" ? "R" : k.ans.side);
    if (!a.bilateral && k.ans.side === "B") al = bare(a) + ", both sides";
    var cls = r.ok ? "ok" : r.score > 0 ? "part" : "bad", icon = r.ok ? ico("check") : r.score > 0 ? ico("check") : ico("close");
    var head = r.ok ? "Correct: " + esc(tl) : (r.score > 0 ? "Partly right (" + Math.round(r.score * 100) + "%). " : "Not this time. ") + "You said " + esc(al);
    function mark(ok, text) { return '<li class="' + (ok ? "y" : "n") + '">' + (ok ? ico("check") : ico("close")) + "<span>" + text + "</span></li>"; }
    var marks = mark(r.right.indexOf("diagnosis") >= 0, r.right.indexOf("diagnosis") >= 0 ? "Diagnosis" : r.right.indexOf("related") >= 0 ? "Diagnosis: a close relative of the answer" : "Diagnosis") +
      mark(r.right.indexOf("side") >= 0, "Side") + mark(r.right.indexOf("group") >= 0, "Category: " + N.GROUPS[t.group]);
    var tip = "";
    if (r.errType === "side" && t.bilateral) tip = '<p class="nr-p">This condition affects both eyes: choose Both.</p>';
    else if (r.errType === "side") tip = '<p class="nr-p">' + esc(SIDETIP[k.id] || "Name the side from the eye that behaves abnormally: the one that underacts, has the ptosis or the abnormal pupil.") + "</p>";
    else if (!r.ok) tip = '<h3 class="oph-h3">What your answer would show</h3><p class="nr-p"><b>' + esc(bare(a)) + ".</b> " + esc(N.sideText(a.look, k.ans.side === "L" ? "L" : "R")) + "</p>";
    var used = t.key.map(function (x) {
      var u = !!U.log[x];
      return '<li class="' + (u ? "y" : "n") + '">' + (u ? ico("check") : ico("close")) + "<span><b>" + KEYT[x][0] + ":</b> " + (u ? "done" : "not done. " + esc(KEYT[x][1])) + "</span></li>";
    }).join("");
    return '<div class="oph-reveal"><p class="oph-verdict nr-verdict ' + cls + '">' + icon + "<span>" + head + "</span></p>" +
      '<ul class="nr-marks">' + marks + "</ul>" + tip +
      '<button type="button" class="oph-btn pri oph-wide nr-next" data-act="nrnext" id="nrNext">Next case</button>' +
      '<h3 class="oph-h3">The patient</h3><p class="nr-p"><b>' + esc(tl) + "</b></p>" + findingsList(k.P) +
      '<h3 class="oph-h3">Key tests for this patient</h3><ul class="nr-marks">' + used + "</ul>" +
      nineHtml(k.P) + hessHtml(k.P) + noteHtml(t, k.side === "L" ? "L" : "R") + "</div>";
  }

  /* ---------- live description ---------- */
  // Gaze named from the patient's side, as clinicians do ("left gaze" = the patient looks to their left).
  function whereText(ex) {
    var b = [];
    if (Math.abs(ex.v) >= 3) b.push((ex.v > 0 ? "up " : "down ") + Math.round(Math.abs(ex.v)) + "°");
    if (Math.abs(ex.h) >= 3) b.push((ex.h > 0 ? "right " : "left ") + Math.round(Math.abs(ex.h)) + "°");
    return b.length ? "Gaze " + b.join(", ") : "Primary position";
  }
  // Eyes that fall short of the target by more than they already sit off in primary position.
  function lags(r) {
    var ex = U.ex, out = [];
    ["R", "L"].forEach(function (e) {
      if (ex.cover === e) return;
      var q = r[e], p0 = U.p0[e], s1, s0;
      if (Math.abs(ex.h) >= 10) {
        s1 = ex.h > 0 ? ex.h - q.x : q.x - ex.h; s0 = ex.h > 0 ? -p0.x : p0.x;
        if (s1 - Math.max(0, s0) > 6) out.push({ e: e, kind: (e === "R") === (ex.h > 0) ? "abduct" : "adduct", a: q.ab });
      }
      if (Math.abs(ex.v) >= 10) {
        s1 = ex.v > 0 ? ex.v - q.y : q.y - ex.v; s0 = ex.v > 0 ? -p0.y : p0.y;
        if (s1 - Math.max(0, s0) > 6) out.push({ e: e, kind: ex.v > 0 ? "elevate" : "depress", a: q.ab });
      }
    });
    return out;
  }
  function musc(e, M) { return U.P.mus[e][M] < 1 ? "weak " + W[e] + " " + MNAME[M] + " (" + NERVE[M] + ")" : ""; }
  function cause(l) {
    var P = U.P, m = P.mus[l.e], side = U.ex.h > 0 ? "R" : "L";
    if (l.kind === "abduct" || l.kind === "adduct") {
      if (P.gaze[side] < 1) return W[side] + " horizontal gaze centre (paramedian pontine reticular formation and abducens nucleus) damaged, so neither eye looks " + W[side];
      if (l.kind === "adduct" && P.mlf[l.e] < 1) return W[l.e] + " medial longitudinal fasciculus (MLF) lesion, so the adduction command is lost while convergence still works";
      return musc(l.e, l.kind === "abduct" ? "LR" : "MR");
    }
    if (l.kind === "elevate" && P.up < 1) return "dorsal midbrain upgaze centre damaged, so neither eye elevates";
    var pair = l.kind === "elevate" ? ["SR", "IO"] : ["IR", "SO"];
    var M = l.a > 5 ? pair[0] : l.a < -5 ? pair[1] : m[pair[0]] <= m[pair[1]] ? pair[0] : pair[1];
    return musc(l.e, M);
  }
  function tonicWhy(r) {
    var P = U.P, bits = [];
    if (Math.abs(r.pdH) >= 2) ["R", "L"].forEach(function (e) {
      var m = P.mus[e];
      if (P.drift[e].ab) bits.push("without tonic medial longitudinal fasciculus input the medial recti let the eyes drift out");
      else if (m.LR < m.MR) bits.push("the unopposed " + W[e] + " medial rectus pulls the eye in");
      else if (m.MR < m.LR) bits.push("the unopposed " + W[e] + " lateral rectus pulls the eye out");
    });
    if (Math.abs(r.pdV) >= 2) ["R", "L"].forEach(function (e) {
      if (P.drift[e].y > 0) bits.push("an otolith pathway imbalance, not a weak muscle, sets the " + W[e] + " eye higher");
      else if (P.mus[e].SO < 1) bits.push("weak " + W[e] + " superior oblique, so the elevators lift the eye");
    });
    return bits[0] || "";
  }
  function pupilChange(a, b) {
    function w(d) { return Math.abs(d) < 0.3 ? "" : d < 0 ? "constricts" : "dilates"; }
    var R = w(b.R - a.R), L = w(b.L - a.L);
    if (!R && !L) return "no change";
    if (R === L) return "both pupils " + (R === "constricts" ? "constrict" : "dilate");
    return R && L ? "right pupil " + R + ", left " + L : (R ? "right pupil " + R : "left pupil " + L) + ", the other does not";
  }
  // The live line: what the examiner sees (both modes) and, in practice, one reason from the model.
  function describe(evt) {
    var P = U.P, ex = U.ex, r = U.tgt, s = [], coach = [], practice = U.mode === "practice";
    if (evt) s.push(evt);
    if (U.tab === "motility") {
      if (!evt) s.push(whereText(ex) + (ex.near ? ", near" : "") + (ex.tilt ? ", head tilt " + (ex.tilt > 0 ? "right" : "left") : "") + (ex.cover ? ", " + W[ex.cover] + " eye covered" : "") + ".");
      var lg = lags(r);
      lg.forEach(function (l) { s.push(Cap(W[l.e]) + " eye does not " + l.kind + " fully."); });
      var H = Math.round(Math.abs(r.pdH)), V = Math.round(Math.abs(r.pdV)), dv = [];
      if (H >= 2) dv.push((r.pdH > 0 ? "esotropia " : "exotropia ") + H);
      if (V >= 2) dv.push((r.pdV > 0 ? "right" : "left") + " hypertropia " + V);
      s.push(dv.length ? Cap(dv.join(", ")) + " prism dioptres." : "Eyes aligned.");
      ["R", "L"].forEach(function (e) { if (r.nys[e] && ex.cover !== e) s.push(Cap(W[e]) + " eye: abducting nystagmus."); });
      if (r.crn) s.push("Attempted upgaze: convergence-retraction jerks.");
      if (practice) {
        if (ex.tilt) ["R", "L"].forEach(function (e) {
          if (P.mus[e].SO < 1) coach.push((ex.tilt > 0) === (e === "R")
            ? "tilting " + W[e] + " makes the " + W[e] + " eye intort with its superior rectus alone, which also lifts it"
            : "tilting away relaxes the " + W[e] + " superior rectus, so the eye drops");
          if (P.drift[e].y > 0) coach.push("skew is supranuclear, so head tilt changes it little");
        });
        if (ex.near && (P.mlf.R < 1 || P.mlf.L < 1)) coach.push("convergence reaches the medial recti without the medial longitudinal fasciculus");
        lg.forEach(function (l) { var c = cause(l); if (c) coach.push(c); });
        if (!lg.length) { var tw = tonicWhy(r); if (tw) coach.push(tw); }
      }
    } else {
      var t = U.ptgt;
      if (!evt) s.push((U.px.room === "dark" ? "Dark room" : "Lit room") + (U.px.light ? ", light on the " + W[U.px.light] + " eye" : "") + (ex.near ? ", near target" : "") + ".");
      s.push("Pupils " + t.R.toFixed(1) + " mm right, " + t.L.toFixed(1) + " mm left.");
      if (practice && N.BY[U.prac.id].coach) coach.push(N.sideText(N.BY[U.prac.id].coach, U.prac.side));
    }
    ["R", "L"].forEach(function (e) { if (U.lid[e].mrd1 < 0.5 && !ex.lift) s.push(Cap(W[e]) + " lid covers the pupil: lift the lids."); });
    var why = practice && coach.length ? coach[0].replace(/\.$/, "") : "";
    return { obs: s.join(" "), why: why ? "Why: " + why.charAt(0).toLowerCase() + why.slice(1) + "." : "" };
  }
  function say(evt) {
    var gd = $("nrGuide"); if (gd) gd.innerHTML = guideHtml();
    var l = $("nrLive"); if (!l) return;
    var d = describe(evt);
    l.innerHTML = esc(d.obs) + (d.why ? ' <span class="nr-why">' + esc(d.why) + "</span>" : "");
  }

  /* ---------- actions ---------- */
  function trackGaze() {
    var ex = U.ex, k = (Math.abs(ex.h) >= 15 ? (ex.h > 0 ? "r" : "l") : "") + (Math.abs(ex.v) >= 12 ? (ex.v > 0 ? "u" : "d") : "");
    if (k) U.dirs[k] = 1;
    if (Object.keys(U.dirs).length >= 4) U.log.gaze = true;
  }
  function setExam(k, v) {
    var ex = U.ex, px = U.px, before = { eyes: U.tgt, pup: U.ptgt }, evt = "";
    if (k === "cover") {
      ex.cover = v || null; if (v) U.log.cover = true;
      refresh();
      var moved = [];
      ["R", "L"].forEach(function (e) {
        if (ex.cover === e) return;
        var a = before.eyes[e], b = U.tgt[e], dx = b.x - a.x, dy = b.y - a.y, sg = e === "R" ? 1 : -1, d = [];
        if (Math.abs(dx) >= 1.5) d.push(dx * sg > 0 ? "out" : "in");
        if (Math.abs(dy) >= 1.5) d.push(dy > 0 ? "up" : "down");
        if (d.length) moved.push(W[e] + " eye moves " + d.join(" and ") + " to take up fixation");
      });
      evt = (v ? "Cover " + W[v] + ": " : "Uncovered: ") + (moved.length ? moved.join("; ") : "no refixation movement") + ".";
    } else if (k === "tilt") { ex.tilt = +v; if (ex.tilt) U.log.tilt = true; refresh(); }
    else if (k === "near") {
      ex.near = !ex.near; if (ex.near) U.log.near = true; refresh();
      var pc = pupilChange(before.pup, U.ptgt);
      evt = (ex.near ? "Near target: " : "Near target away: ") + pc + ".";
      var slow = slowEye(ex.near);
      if (slow && pc !== "no change") evt += " The " + W[slow] + " pupil moves slowly.";
    }
    else if (k === "lift") { ex.lift = !ex.lift; if (ex.lift) U.log.lift = true; refresh(); }
    else if (k === "room") {
      if (px.room === v) return; px.room = v; if (v === "dark") U.log.dark = true; refresh();
      evt = (v === "dark" ? "Lights off: " : "Lights on: ") + pupilChange(before.pup, U.ptgt) + ".";
      var lag = slowEye(v === "light");
      if (lag && v === "dark") evt += " The " + W[lag] + " pupil dilates more slowly.";
    } else if (k === "light") {
      var prev = px.light; px.light = v || null;
      if (v) U.log.light = true;
      if (v && prev && prev !== v) U.log.swing = true;
      refresh();
      evt = v ? (prev && prev !== v ? "Swung to the " : "Light on the ") + W[v] + " eye: " + pupilChange(before.pup, U.ptgt) + "." : "Penlight off.";
    }
    syncControls();
    say(evt);
  }
  // The eye whose pupil moves slowly in this direction (tonic or sympathetic loss), if only one does.
  function slowEye(constricting) {
    var t = { R: N.tau(U.P, "R", constricting), L: N.tau(U.P, "L", constricting) };
    return t.R > 2 && t.L < 1.5 ? "R" : t.L > 2 && t.R < 1.5 ? "L" : null;
  }
  function setGaze(h, v, announce) {
    U.ex.h = clamp(Math.round(h), -40, 40); U.ex.v = clamp(Math.round(v), -30, 30);
    refresh(); trackGaze();
    if (announce) { syncControls(); say(); }
  }

  var A = I.ACTIONS;
  A.nrmode = function (b) {
    var m = b.getAttribute("data-v");
    if (m === U.mode) return;
    U.mode = m; freshExam();
    if (m === "case" && !caseLocked()) { if (!U.cse) return startCase(); setPatient(U.cse.P, true); }
    else setPatient(practicePatient(), true);
    renderPanel(".nr-mode [aria-pressed=true]");
    say();
  };
  A.nrtab = function (b) {
    U.tab = b.getAttribute("data-v");
    if (U.tab === "pupils") { U.ex.cover = null; U.ex.h = 0; U.ex.v = 0; refresh(); }
    var t = $("nrTools"); if (t) t.innerHTML = U.tab === "motility" ? motilityHtml() : pupilHtml();
    var sg = $("nrStage"); if (sg) sg.setAttribute("data-tab", U.tab);
    Array.prototype.forEach.call(G.document.querySelectorAll("[data-act=nrtab]"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    say();
  };
  A.nrset = function (b) { setExam(b.getAttribute("data-k"), b.getAttribute("data-v")); };
  A.nrgaze = function (b) { setGaze(+b.getAttribute("data-h"), +b.getAttribute("data-g"), true); };
  A.nrdrop = function (b) {
    var d = b.getAttribute("data-v"), before = U.ptgt;
    if (U.px.drops[d]) return;
    U.px.drops[d] = true; U.log[d] = true; refresh(); syncControls();
    var name = DROPS.filter(function (x) { return x[0] === d; })[0][1];
    say(name + ", 40 minutes later: " + pupilChange(before, U.ptgt) + ".");
  };
  A.nrwash = function () { U.px.drops = {}; refresh(); syncControls(); say("Drops washed out."); };
  A.nrside = function (b) { U.prac.side = b.getAttribute("data-v"); practiceChanged(); };
  A.nrgrade = function (b) { U.prac.grade = +b.getAttribute("data-v"); practiceChanged(); };
  A.nrans = function (b) {
    U.cse.ans.side = b.getAttribute("data-v");
    Array.prototype.forEach.call(b.parentNode.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    var e = $("nrErr"); if (e) e.textContent = "";
  };
  A.nrsign = signOff;
  A.nrnext = function () {
    if (I.level() === "resident" && resLocked()) { U.cse = null; freshExam(); setPatient(practicePatient(), true); renderPanel(".nr-mode [aria-pressed=true]"); setSub(); return; } // trial case done
    startCase();
  };
  A.nrtrial = function () { I.gate("sim.neuro", function () { startCase(); U.cse.trial = true; renderPanel(".nr-mode [aria-pressed=true]"); syncControls(); }); };
  A.nrpro = function () { I.showPro(); };
  A.nrfound = function () {
    st.prefs.level = "foundation"; DATA.savePrefs(I.ls(), st.prefs);
    U.cse = null; startCase();
  };
  function practiceChanged() {
    U.px.drops = {}; U.px.filter = { R: 0, L: 0 };   // a filter left on from an RAPD would change the next patient
    setPatient(practicePatient(), false);
    renderPanel("#nrCond");
    say();
  }
  function onChange(e) {
    var t = e.target;
    if (t.id === "nrCond") {
      var id = t.value, c = N.BY[id];
      if (c.level === "r" && resLocked()) { t.value = U.prac.id; I.showPro(); return; }
      U.prac.id = id;
      if (c.grades && !U.prac.grade) U.prac.grade = 0.9;
      practiceChanged();
    } else if (t.id === "nrFilt") {
      var v = t.value; U.px.filter = { R: 0, L: 0 };
      if (v !== "0") { U.px.filter[v.charAt(0)] = +v.slice(1); U.log.filter = true; }
      var before = U.ptgt; refresh();
      say(v === "0" ? "Filter removed." : "Filter over the " + W[v.charAt(0)] + " eye" + (U.px.light ? ": " + pupilChange(before, U.ptgt) + "." : "."));
    } else if (t.id === "nrDx") {
      U.cse.ans.id = t.value;
      var er = $("nrErr"); if (er) er.textContent = "";
      var sl = $("nrAnsL"); if (sl) sl.textContent = (N.BY[t.value] && N.BY[t.value].sideq) || "Side";   // skew: higher eye; anisocoria: smaller pupil
    }
  }

  I.KEYS.neuro = function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA" || (U.mode === "case" && caseLocked())) return;
    var k = e.key, step = e.shiftKey ? 15 : 5, ex = U.ex;
    var arrows = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (arrows[k]) {   // examiner's left is the patient's right
      e.preventDefault();
      if (U.tab === "pupils") { if (k === "ArrowLeft" || k === "ArrowRight") setExam("light", k === "ArrowLeft" ? "R" : "L"); return; }
      return setGaze(ex.h + arrows[k][0], ex.v + arrows[k][1], true);
    }
    var c = k.toLowerCase();
    if (k === "0" || k === "Home") { e.preventDefault(); return setGaze(0, 0, true); }
    if (c === "c") return setExam("cover", ex.cover === null ? "R" : ex.cover === "R" ? "L" : "");
    if (c === "t") return setExam("tilt", ex.tilt === 0 ? 1 : ex.tilt === 1 ? -1 : 0);
    if (c === "n") return setExam("near");
    if (c === "l") return setExam("lift");
    if (c === "s") return setExam("light", U.px.light === "R" ? "L" : "R");
    if (c === "d") return setExam("room", U.px.room === "dark" ? "light" : "dark");
  };

  /* ---------- stage input ---------- */
  function stagePoint(e) { var r = $("nrStage").getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; }
  function onDown(e) {
    if (e.button > 0 || U.drag) return;   // one pointer at a time
    var p = stagePoint(e);
    if (U.tab === "pupils") return setExam("light", p.x < p.w / 2 ? "R" : "L");
    U.drag = true;
    try { $("nrStage").setPointerCapture(e.pointerId); } catch (x) {}
    moveTo(p);
  }
  function onMove(e) { if (U.drag) moveTo(stagePoint(e)); }
  function onUp() { if (!U.drag) return; U.drag = false; U.dirty = true; syncControls(); say(); }
  function moveTo(p) {
    var g = geo(p.w, p.h), mid = (g.top + g.bot) / 2;
    setGaze((g.cx - p.x) / Math.max(1, g.cx - g.l) * 40, (mid - p.y) / Math.max(1, (g.bot - g.top) / 2) * 30, false);
  }

  /* ---------- rendering ---------- */
  var FIB = (function () {
    var s = 7, a = [];
    function r() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (var i = 0; i < 72; i++) {
      var lt = r() > 0.45, al = (0.14 + r() * 0.34).toFixed(2);
      a.push({ a: i / 72 * 2 * Math.PI + r() * 0.05, w: 0.1 + r() * 0.18, l: 0.72 + r() * 0.24, c: lt ? "rgba(201,156,104," + al + ")" : "rgba(28,17,9," + al + ")" });
    }
    return a;
  })();
  var RE = 12, IRIS = 5.8, IPD = 31, FISS = 14;

  function loop(ms) {
    if (!U.ctx) return;
    var t = ms / 1000, dt = U.t0 ? Math.min(0.1, t - U.t0) : 0;
    U.t0 = t;
    if (step(dt) || U.dirty || oscillating()) { draw(t); U.dirty = false; }
    U.raf = G.requestAnimationFrame(loop);
  }
  function oscillating() { return !U.reduce && (U.tgt.nys.R || U.tgt.nys.L || U.tgt.crn); }
  function step(dt) {
    var moving = false;
    ["R", "L"].forEach(function (e) {
      var c = U.cur[e], g = U.tgt[e];
      // An INO eye makes slow adducting saccades; everything else follows the target briskly.
      var slow = U.P.mlf[e] < 1 && g.ab < c.ab - 1;
      var k = U.reduce ? 1 : 1 - Math.exp(-dt / (slow ? 0.35 : 0.07));
      if (Math.abs(g.x - c.x) + Math.abs(g.y - c.y) + Math.abs(g.t - c.t) > 0.02) moving = true;
      c.x += (g.x - c.x) * k; c.y += (g.y - c.y) * k; c.t += (g.t - c.t) * k;
      c.ab = e === "R" ? c.x : -c.x;
    });
    var np = N.pupilStep(U.P, U.pup, U.ptgt, dt);
    if (Math.abs(np.R - U.pup.R) + Math.abs(np.L - U.pup.L) > 0.001) moving = true;
    U.pup = np;
    var ta = U.ex.tilt * 12, kt = U.reduce ? 1 : 1 - Math.exp(-dt / 0.12);
    if (Math.abs(ta - U.tiltA) > 0.05) moving = true;
    U.tiltA += (ta - U.tiltA) * kt;
    return moving;
  }
  function saw(t, per) { return (t % per) / per; }

  // Stage layout: the face sits low; above it, a tangent screen carries the fixation target so the
  // target never covers the eyes it is testing.
  function geo(Wd, Hd) {
    var s = Math.min(Wd / 96, Hd / 44), ey = Math.max(Hd * 0.55, Hd - 25 * s);
    return { s: s, cx: Wd / 2, ey: ey, top: 14, bot: Math.max(60, ey - 13 * s), l: 20, r: Wd - 20 };
  }
  function gazeAt(g, h, v) { return { x: g.cx - h / 40 * (g.cx - g.l), y: (g.top + g.bot) / 2 - v / 30 * (g.bot - g.top) / 2 }; }
  function draw(t) {
    var ctx = U.ctx, Wd = U.W, Hd = U.H, d = U.dpr;
    if (!Wd || !Hd) return;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, Wd, Hd);
    var g = geo(Wd, Hd), s = g.s;
    if (U.tab === "motility") screenGrid(ctx, g);
    ctx.save();
    ctx.translate(g.cx, g.ey); ctx.rotate(-U.tiltA * Math.PI / 180); ctx.scale(s, s);
    face(ctx);
    ["R", "L"].forEach(function (e) { if (U.ex.cover !== e) eye(ctx, e, t); });
    room(ctx);
    if (U.ex.cover) occluder(ctx, U.ex.cover === "R" ? -IPD : IPD);
    ctx.font = "500 " + (12 / s).toFixed(2) + "px 'Inter Variable', Inter, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.fillStyle = "#a8a8b0";
    ctx.fillText("Right eye", -IPD, 15); ctx.fillText("Left eye", IPD, 15);
    if (U.reduce) ["R", "L"].forEach(function (e) {   // no oscillation under reduced motion: name it instead
      if (U.tgt.nys[e] && U.ex.cover !== e) { ctx.fillStyle = "#ffc05a"; ctx.fillText("Nystagmus", e === "R" ? -IPD : IPD, 19); }
    });
    ctx.restore();
    if (U.tab === "motility") target(ctx, g);
  }
  function screenGrid(ctx, g) {
    ctx.strokeStyle = "#1c1c1f"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(g.l, (g.top + g.bot) / 2); ctx.lineTo(g.r, (g.top + g.bot) / 2);
    ctx.moveTo(g.cx, g.top); ctx.lineTo(g.cx, g.bot); ctx.stroke();
    ctx.fillStyle = "rgba(168,168,176,0.45)";
    PAD.forEach(function (p) { var q = gazeAt(g, p[0], p[1]); ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, 2 * Math.PI); ctx.fill(); });
  }
  // Skin lit by the examination light in a dim room: soft pools only, no edges.
  function glow(ctx, x, y, rx, ry, stops) {
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    stops.forEach(function (q) { g.addColorStop(q[0], q[1]); });
    ctx.fillStyle = g; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }
  function face(ctx) {
    glow(ctx, 0, 2, 64, 30, [[0, "rgba(70,50,40,0.9)"], [0.7, "rgba(46,33,26,0.55)"], [1, "rgba(0,0,0,0)"]]);
    [-IPD, IPD].forEach(function (x) { glow(ctx, x, 0, 26, 21, [[0, "#76564a"], [0.55, "rgba(84,60,47,0.75)"], [1, "rgba(60,43,34,0)"]]); });
    glow(ctx, 0, 3, 5, 16, [[0, "rgba(160,120,98,0.28)"], [1, "rgba(160,120,98,0)"]]);   // nasal bridge
  }
  function lidPath(ctx, med, lat, apex) {
    var yc = (apex - 0.125 * (med.y + lat.y)) / 0.75, dx = lat.x - med.x;
    ctx.bezierCurveTo(med.x + dx * 0.25, yc, med.x + dx * 0.72, yc, lat.x, lat.y);
  }
  function eye(ctx, e, t) {
    var sgx = e === "R" ? -1 : 1, cx = sgx * IPD, nas = -sgx;   // nasal side points to the face midline
    var c = U.cur[e], x = c.x, y = c.y;
    if (!U.reduce && U.tgt.nys[e]) {   // abducting nystagmus: slow drift toward the midline, fast return
      var f = saw(t, 0.4), off = f < 0.8 ? -3 * f / 0.8 : -3 * (1 - (f - 0.8) / 0.2);
      x += (e === "R" ? 1 : -1) * off;
    }
    if (!U.reduce && U.tgt.crn) {   // convergence-retraction jerks on attempted upgaze
      var p = saw(t, 0.9), j = p < 0.08 ? p / 0.08 : p < 0.4 ? 1 - (p - 0.08) / 0.32 : 0;
      x += (e === "R" ? -5 : 5) * j;
    }
    var lid = U.lid[e], mrd1 = U.ex.lift ? Math.max(lid.mrd1, 3.5) : lid.mrd1;
    var follow = -RE * Math.sin(y * Math.PI / 180) * 0.75;
    var up = -mrd1 + follow, lo = lid.mrd2 + follow * 0.35;
    if (up > lo - 0.6) up = lo - 0.6;
    var med = { x: cx + nas * FISS, y: 0.5 }, lat = { x: cx - nas * FISS, y: -0.7 };
    ctx.save();
    ctx.beginPath(); ctx.moveTo(med.x, med.y); lidPath(ctx, med, lat, up); lidPath(ctx, lat, med, lo); ctx.closePath();
    ctx.save(); ctx.clip();
    var ix = cx - RE * Math.sin(x * Math.PI / 180), iy = -RE * Math.sin(y * Math.PI / 180);
    var sc = ctx.createRadialGradient(ix * 0.35 + cx * 0.65, iy * 0.3, 2, cx, 0, 17);
    sc.addColorStop(0, "#f2ede5"); sc.addColorStop(0.6, "#ddd3c6"); sc.addColorStop(1, "#9c8e80");
    ctx.fillStyle = sc; ctx.fillRect(cx - 16, -12, 32, 24);
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate((e === "R" ? 1 : -1) * c.t * Math.PI / 180);   // intorsion turns 12 o'clock toward the nose
    ctx.scale(Math.cos(x * Math.PI / 180), Math.cos(y * Math.PI / 180));
    iris(ctx, U.pup[e] / 2, U.P.pupil[e].irregular);
    ctx.restore();
    // Corneal reflex (Hirschberg): about 1 mm off the pupil centre per 7 degrees of deviation from the light.
    var lh = U.tab === "motility" ? U.ex.h : 0, lv = U.tab === "motility" ? U.ex.v : 0;
    var bright = U.tab === "motility" || U.px.light === e;
    if (bright || U.px.room === "light") {
      var rx = ix + 8 * Math.sin((x - lh) * Math.PI / 180), ry = iy + 8 * Math.sin((y - lv) * Math.PI / 180);
      ctx.fillStyle = bright ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)";
      ctx.beginPath(); ctx.arc(rx, ry, bright ? 0.45 : 0.3, 0, 2 * Math.PI); ctx.fill();
    }
    var sh = ctx.createLinearGradient(0, up - 0.5, 0, up + 2.2);   // the upper lid shades the globe
    sh.addColorStop(0, "rgba(0,0,0,0.45)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh; ctx.fillRect(cx - 16, up - 1, 32, 4);
    ctx.restore();
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(med.x, med.y); lidPath(ctx, med, lat, up);
    ctx.strokeStyle = "rgba(36,22,15,0.95)"; ctx.lineWidth = 0.55; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lat.x, lat.y); lidPath(ctx, lat, med, lo);
    ctx.strokeStyle = "rgba(70,46,34,0.8)"; ctx.lineWidth = 0.35; ctx.stroke();
    var cm = { x: med.x - nas * 1.5, y: -1.2 }, cl = { x: lat.x + nas, y: -2.2 };   // lid crease
    ctx.beginPath(); ctx.moveTo(cm.x, cm.y); lidPath(ctx, cm, cl, Math.min(-8.5, up - 3.5));
    ctx.strokeStyle = "rgba(28,18,12,0.5)"; ctx.lineWidth = 0.3; ctx.stroke();
    ctx.restore();
  }
  function iris(ctx, pr, irregular) {
    var g = ctx.createRadialGradient(0, 0, pr * 0.8, 0, 0, IRIS);
    g.addColorStop(0, "#3b2717"); g.addColorStop(0.5, "#6e4a2c"); g.addColorStop(0.88, "#4a311d"); g.addColorStop(1, "#1a110a");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, IRIS, 0, 2 * Math.PI); ctx.fill();
    for (var i = 0; i < FIB.length; i++) {
      var f = FIB[i], ca = Math.cos(f.a), sa = Math.sin(f.a), r1 = pr + 0.25, r2 = IRIS * f.l;
      ctx.strokeStyle = f.c; ctx.lineWidth = f.w;
      ctx.beginPath(); ctx.moveTo(ca * r1, sa * r1); ctx.lineTo(ca * r2, sa * r2); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(182,138,92,0.35)"; ctx.lineWidth = 0.25;   // collarette
    ctx.beginPath(); ctx.arc(0, 0, pr + (IRIS - pr) * 0.38, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = "rgba(24,14,8,0.75)";   // a small iris naevus at one o'clock shows torsion
    ctx.beginPath(); ctx.ellipse(IRIS * 0.62 * Math.cos(-1.05), IRIS * 0.62 * Math.sin(-1.05), 0.55, 0.4, 0.4, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "rgba(12,8,5,0.9)"; ctx.lineWidth = 0.45;   // limbus
    ctx.beginPath(); ctx.arc(0, 0, IRIS - 0.2, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = "#040303";
    ctx.beginPath();
    if (irregular) {
      for (var k = 0; k <= 28; k++) {
        var a = k / 28 * 2 * Math.PI, rr = pr * (1 + 0.08 * Math.sin(3 * a + 1) + 0.05 * Math.sin(5 * a));
        if (k) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(rr, 0);
      }
    } else ctx.arc(0, 0, pr, 0, 2 * Math.PI);
    ctx.fill();
  }
  function room(ctx) {
    var dark = U.px.room === "dark", lit = U.px.light;
    if (!dark && !lit) return;
    if (dark) {
      var g;
      if (lit) {
        var lx = lit === "R" ? -IPD : IPD;
        g = ctx.createRadialGradient(lx, 0, 5, lx, 0, 30);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.66)");
      }
      ctx.fillStyle = g || "rgba(0,0,0,0.66)";
      ctx.fillRect(-300, -300, 600, 600);
    }
    if (lit) {
      var x = lit === "R" ? -IPD : IPD, w = ctx.createRadialGradient(x, 0, 1, x, 0, 20);
      w.addColorStop(0, "rgba(255,238,205,0.16)"); w.addColorStop(1, "rgba(255,238,205,0)");
      ctx.fillStyle = w; ctx.fillRect(x - 20, -20, 40, 40);
    }
  }
  function occluder(ctx, x) {
    ctx.fillStyle = "#0d0d0f"; ctx.strokeStyle = "#2c2c30"; ctx.lineWidth = 0.3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 17, -13, 34, 26, 5); else ctx.rect(x - 17, -13, 34, 26);
    ctx.fill(); ctx.stroke();
    ctx.fillRect(x - 3, 12.8, 6, 40);
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.beginPath(); ctx.moveTo(x - 13, -12.4); ctx.lineTo(x + 13, -12.4); ctx.stroke();
  }
  function target(ctx, g) {
    var q = gazeAt(g, U.ex.h, U.ex.v), tx = q.x, ty = q.y, r = U.drag ? 13 : 10;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 6;
    ctx.strokeStyle = "#3b9dff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, r, 0, 2 * Math.PI); ctx.stroke();
    if (U.ex.near) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx, ty, r + 5, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(tx, ty, 3.5, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  API._ui = U;   // for the headless UI test
  O._sims.push({ id: "neuro", title: "Neuro-ophthalmology", sub: "Motility and pupil lab", icon: "brain", open: open,
    startCase: function () { U.mode = "case"; U.cse = null; open(); } // Today's plan: one graded patient
  });
})(typeof window !== "undefined" ? window : this);
