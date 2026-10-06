/* Narkē explorer model: the oxygen-haemoglobin dissociation curve. Pure logic, no DOM. ES5 UMD.
   Node: module.exports. Browser: window.NARKE_MODELS["odc"].
   Saturation comes from the Severinghaus (1979) equation for standard human blood:
     S = 1 / (23400 / (P^3 + 150 P) + 1), P in mmHg, which gives P50 26.8 mmHg.
   Temperature, pH and PaCO2 move the curve with the standard "virtual PO2" correction (Kelman 1966), used with it:
     Pv = P x 10^(0.024 (37 - T) + 0.40 (pH - 7.40) + 0.06 log10(40 / PaCO2)).
   2,3-DPG and fetal haemoglobin change the standard P50; the curve keeps its shape and is scaled along the PO2 axis
   (Pv = P x 26.8 / P50). Fetal blood P50 is 19 mmHg (Miller). The 2,3-DPG step is an illustrative teaching shift
   of 3 mmHg, labelled as such: the direction is certain, the size is not a measured value for any one patient. */
(function (root, factory) {
  var m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  if (root) { root.NARKE_MODELS = root.NARKE_MODELS || {}; root.NARKE_MODELS[m.id] = m; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var P50_STD = 26.8;   // standard adult P50, mmHg (Severinghaus 1979)
  var P50_FETAL = 19;   // fetal blood P50, mmHg (Miller's Anesthesia)
  var DPG_STEP = 3;     // illustrative shift for low or high 2,3-DPG, mmHg (teaching value, see notes)
  var LIMITS = { po2: [0, 600], ph: [6.8, 7.8], temp: [25, 43], pco2: [10, 120] };
  var DEFAULTS = { ph: 7.4, temp: 37, pco2: 40, dpg: "normal", hbf: false };

  function r1(x) { return Math.round(x * 10) / 10; }
  function bad(en, hi) { return { ok: false, error: { en: en, hi: hi } }; }
  function num(x) { return typeof x === "number" && x === x; }

  // Severinghaus 1979: fraction saturated (0..1) at a standard-curve PO2 in mmHg.
  function severinghaus(p) {
    if (!(p > 0)) return 0;
    return 1 / (23400 / (p * p * p + 150 * p) + 1);
  }
  // The standard-curve PO2 that gives saturation s (0 < s < 1): bisection on the monotonic curve.
  function inverse(s) {
    var lo = 0, hi = 2000, mid, i;
    for (i = 0; i < 60; i++) { mid = (lo + hi) / 2; if (severinghaus(mid) < s) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  function conditions(c) {
    c = c || {};
    var o = {
      ph: c.ph == null ? DEFAULTS.ph : c.ph, temp: c.temp == null ? DEFAULTS.temp : c.temp, pco2: c.pco2 == null ? DEFAULTS.pco2 : c.pco2,
      dpg: c.dpg == null ? DEFAULTS.dpg : c.dpg, hbf: !!c.hbf
    };
    if (!num(o.ph) || o.ph < LIMITS.ph[0] || o.ph > LIMITS.ph[1]) return bad("pH is a number from 6.8 to 7.8.", "pH 6.8 से 7.8 के बीच की संख्या है।");
    if (!num(o.temp) || o.temp < LIMITS.temp[0] || o.temp > LIMITS.temp[1]) return bad("Temperature is 25 to 43 degrees C.", "तापमान 25 से 43 डिग्री C के बीच होता है।");
    if (!num(o.pco2) || o.pco2 < LIMITS.pco2[0] || o.pco2 > LIMITS.pco2[1]) return bad("PaCO2 is 10 to 120 mmHg.", "PaCO2 10 से 120 mmHg के बीच होता है।");
    if (o.dpg !== "low" && o.dpg !== "normal" && o.dpg !== "high") return bad("2,3-DPG is low, normal or high.", "2,3-DPG कम, सामान्य या अधिक होता है।");
    o.ok = true;
    return o;
  }

  // Factor that turns a real PO2 into the standard-curve PO2 under these conditions.
  function factor(o) {
    var base = (o.hbf ? P50_FETAL : P50_STD) + (o.dpg === "low" ? -DPG_STEP : o.dpg === "high" ? DPG_STEP : 0);
    var sev = Math.pow(10, 0.024 * (37 - o.temp) + 0.40 * (o.ph - 7.40) + 0.06 * (Math.log(40 / o.pco2) / Math.LN10));
    return sev * P50_STD / base;
  }

  var SHIFT = {
    left: { en: "Left shift: haemoglobin holds oxygen more tightly. Saturation is higher at the same PO2, but less oxygen is released to the tissues.", hi: "Left shift: haemoglobin oxygen को ज़्यादा कसकर पकड़ता है। उसी PO2 पर saturation ज़्यादा होता है, पर tissues को कम oxygen मिलती है।" },
    right: { en: "Right shift: haemoglobin lets go of oxygen more easily. The tissues get more oxygen, but saturation is lower at the same PO2.", hi: "Right shift: haemoglobin oxygen को आसानी से छोड़ता है। Tissues को ज़्यादा oxygen मिलती है, पर उसी PO2 पर saturation कम होता है।" },
    none: { en: "Standard curve: P50 is about 27 mmHg.", hi: "Standard curve: P50 लगभग 27 mmHg है।" }
  };

  /* at(po2, cond): saturation (%) for a PaO2 in mmHg under conditions {ph, temp, pco2, dpg: low|normal|high, hbf}. */
  function at(po2, cond) {
    var o = conditions(cond);
    if (!o.ok) return o;
    if (!num(po2) || po2 < LIMITS.po2[0] || po2 > LIMITS.po2[1]) return bad("PaO2 is 0 to 600 mmHg.", "PaO2 0 से 600 mmHg के बीच होता है।");
    var f = factor(o), p50 = r1(P50_STD / f), sat = severinghaus(po2 * f) * 100;
    var shift = p50 < P50_STD - 0.5 ? "left" : p50 > P50_STD + 0.5 ? "right" : "none";
    return { ok: true, po2: po2, so2: r1(sat), so2Exact: sat, p50: p50, shift: shift, shiftText: SHIFT[shift], conditions: o };
  }

  /* p50(cond): the PO2 at 50% saturation, mmHg. */
  function p50(cond) { var o = conditions(cond); if (!o.ok) return o; return { ok: true, p50: r1(P50_STD / factor(o)) }; }

  /* po2For(sat%, cond): the PaO2 that gives that saturation. */
  function po2For(sat, cond) {
    var o = conditions(cond);
    if (!o.ok) return o;
    if (!num(sat) || sat <= 0 || sat >= 100) return bad("Saturation is above 0 and below 100%.", "Saturation 0 से ज़्यादा और 100% से कम होता है।");
    return { ok: true, po2: r1(inverse(sat / 100) / factor(o)) };
  }

  /* curve(cond, maxPo2, step): points {po2, so2} from 0 to maxPo2 (default 0 to 120, step 1). */
  function curve(cond, maxPo2, step) {
    var o = conditions(cond);
    if (!o.ok) return o;
    var mx = maxPo2 || 120, st = step || 1, f = factor(o), out = [], p;
    for (p = 0; p <= mx + 1e-9; p += st) out.push({ po2: p, so2: severinghaus(p * f) * 100 });
    return { ok: true, points: out, p50: r1(P50_STD / f) };
  }

  return {
    id: "odc", kind: "explorer", group: "physiology", level: "mbbs",
    title: { en: "Oxygen dissociation curve", hi: "ऑक्सीजन डिसोसिएशन कर्व" },
    subtitle: { en: "Move PaO2 and the things that shift the curve, and read the saturation", hi: "PaO2 और curve को खिसकाने वाली चीज़ें बदलें और saturation पढ़ें" },
    sources: [
      { label: "Severinghaus JW. Simple, accurate equations for human blood O2 dissociation computations. J Appl Physiol 1979;46(3):599-602 (equation 1, the standard curve)", url: "https://pubmed.ncbi.nlm.nih.gov/35496/" },
      { label: "Kelman GR. Digital computer subroutine for the conversion of oxygen tension into saturation. J Appl Physiol 1966;21(4):1375-1376 (virtual PO2 correction for temperature, pH and PCO2)" },
      { label: "Collins JA et al. Relating oxygen partial pressure, saturation and content: the haemoglobin-oxygen dissociation curve. Breathe 2015;11(3):194-201 (P50 about 27 mmHg; shifts with pH, CO2, temperature and 2,3-DPG)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4666443/" },
      { label: "Miller's Anesthesia, 9th edition, chapter on respiratory physiology (fetal haemoglobin P50 about 19 mmHg; left shift of fetal blood)" },
      { label: "West JB, Luks AM. West's Respiratory Physiology: The Essentials, 11th edition, chapter 6 (shape of the curve; Bohr effect)" }
    ],
    review: "ai_drafted",
    notes: {
      model: { en: "The curve is the Severinghaus equation for standard adult blood. It fits measured human data within about 0.5% saturation.", hi: "यह curve सामान्य वयस्क रक्त के लिए Severinghaus equation है। यह मापे गए मानव data से लगभग 0.5% saturation तक मेल खाता है।" },
      dpg: { en: "The 2,3-DPG step moves P50 by 3 mmHg for teaching. The direction is right; the size in a real patient varies.", hi: "2,3-DPG का कदम शिक्षण के लिए P50 को 3 mmHg खिसकाता है। दिशा सही है; असली मरीज़ में मात्रा बदलती है।" },
      spo2: { en: "SpO2 is the pulse oximeter's estimate of this arterial saturation. It is less accurate at low saturations.", hi: "SpO2 इसी arterial saturation का pulse oximeter द्वारा अनुमान है। कम saturation पर यह कम सटीक होता है।" }
    },
    factors: {
      ph: { name: { en: "pH", hi: "pH" }, line: { en: "Acidosis shifts the curve right (Bohr effect).", hi: "Acidosis curve को दाईं ओर खिसकाता है (Bohr effect)।" } },
      temp: { name: { en: "Temperature", hi: "तापमान" }, line: { en: "Fever shifts it right; hypothermia shifts it left.", hi: "बुखार इसे दाईं ओर, hypothermia बाईं ओर खिसकाता है।" } },
      pco2: { name: { en: "PaCO2", hi: "PaCO2" }, line: { en: "A high PaCO2 shifts it right.", hi: "ऊँचा PaCO2 इसे दाईं ओर खिसकाता है।" } },
      dpg: { name: { en: "2,3-DPG", hi: "2,3-DPG" }, line: { en: "High in anaemia and at altitude (right); low in stored blood (left).", hi: "Anaemia और ऊँचाई पर ज़्यादा (दाईं ओर); stored blood में कम (बाईं ओर)।" } },
      hbf: { name: { en: "Fetal haemoglobin", hi: "Fetal haemoglobin (HbF)" }, line: { en: "HbF binds 2,3-DPG poorly, so the fetal curve sits to the left.", hi: "HbF 2,3-DPG से कम जुड़ता है, इसलिए fetal curve बाईं ओर रहता है।" } }
    },
    landmarks: [
      { po2: 27, label: { en: "P50: half saturated", hi: "P50: आधा saturated" } },
      { po2: 40, label: { en: "Mixed venous: about 75%", hi: "Mixed venous: लगभग 75%" } },
      { po2: 60, label: { en: "PaO2 60: about 90%, the edge of the steep part", hi: "PaO2 60: लगभग 90%, ढलान का किनारा" } },
      { po2: 100, label: { en: "Arterial on air: about 97%", hi: "हवा पर arterial: लगभग 97%" } }
    ],
    constants: { p50Standard: P50_STD, p50Fetal: P50_FETAL, dpgStep: DPG_STEP, limits: LIMITS, defaults: DEFAULTS },
    severinghaus: severinghaus, at: at, p50: p50, po2For: po2For, curve: curve
  };
});
