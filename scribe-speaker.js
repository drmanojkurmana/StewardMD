/* scribe-speaker.js — Doctor/Patient speaker labelling for MaiK Scribe.
 * ---------------------------------------------------------------------------
 * WHY THIS MATTERS: voice-emr-map.js's merge() gate treats speaker:"patient" as the ONLY reason a
 * value must stay subjective (cc/history) and never become a confirmed objective finding. A wrong
 * label here can push a patient's claim ("my BP was 150") straight into an objective vitals field.
 * So: when evidence is weak, this module returns speaker:"unknown" + low confidence rather than
 * guessing — a downstream consumer should treat "unknown" the same as "patient" (the safe default)
 * for any gate that only trusts "doctor".
 *
 * TWO SIGNAL PATHS
 * 1. Wording-only (always available): the same kind of cue-matching heuristic as voice-diarize.js
 *    (questions/directives -> doctor, first-person symptom/yes-no -> patient), scored so a turn with
 *    no matching cue comes back "unknown" instead of inheriting the previous speaker by guesswork.
 * 2. Acoustic-assisted (only when segments carry real per-segment features): a simple, explainable
 *    2-means split on energy + pitch groups turns into two voice clusters; wording cues on the turns
 *    inside each cluster then decide WHICH cluster is the doctor. Acoustic evidence alone can never
 *    assign "doctor" vs "patient" identity (energy/pitch don't encode role) — it only tells turns
 *    apart. If a whole session has zero wording cues to anchor the clusters, every turn stays
 *    "unknown" rather than assigning identity by coin flip.
 *
 * WHAT NATIVE CAPTURE WOULD NEED TO PROVIDE for the acoustic path to actually switch on:
 *   - per-segment startMs/endMs (from the capture layer's own VAD/pause-based segmentation — this
 *     module does not do audio segmentation, only text segmentation)
 *   - a mean energy (RMS/dB-ish, any consistent unit) over each segment
 *   - a pitch estimate (mean/median F0 in Hz, or a proxy) over each segment
 *   None of that exists in the current MaiK Scribe capture path (voice.js / voice-ambient.js only
 *   ship text), so today this module always takes the wording-only path in production.
 *   The other known option is whisper.cpp's tinydiarize (a speaker-turn-token decoder built into a
 *   fork of whisper.cpp), but it requires a "tdrz" model file that is not publicly published — not
 *   something this module can wire up or guess an API for.
 *
 * API
 *   label(segments, opts) -> { turns: [{ text, speaker:"doctor"|"patient"|"unknown", confidence, reasons:[...] }] }
 *     segments: a transcript string (split into turns here), OR an array of pre-segmented
 *       { text, startMs, endMs, energy?, pitch? } objects from a capture layer that already knows
 *       segment boundaries. Acoustic clustering only activates when >=2 array segments carry a
 *       numeric energy or pitch AND those values actually vary (not all identical).
 *     opts.cues: optional { question:[...], doctor:[...], patient:[...] } to extend/override the
 *       built-in English cue lists (injected dependency, same shape as the built-ins).
 *   relabel(turns, index, speaker) -> new turns array; turns[index] gets speaker, confidence:1,
 *     manual:true, reasons:["manual"]. Pure (does not mutate input). A manual turn is a one-tap UI
 *     correction contract: callers must never re-run label() output over a manual:true turn.
 *   summary(turns) -> { doctor, patient, unknown } counts.
 *
 * window.SMD_SCRIBESPEAKER + module.exports (Node-testable). ES5, no build step.
 */
(function (root) {
  "use strict";

  // ---- confidence thresholds -------------------------------------------------------------
  // Below CONF_FLOOR a label is forced to "unknown" — a mislabel here can leak into an EMR
  // objective field via voice-emr-map.js, so weak evidence must never produce "doctor"/"patient".
  var CONF_FLOOR = 0.55;
  var CONF_STRONG = 0.85;   // question mark / directive+cue together, or a clear first-person symptom cue
  var CONF_WEAK = 0.65;     // a single matching cue
  var CONF_UNKNOWN = 0.3;   // no cue matched at all

  var DEFAULT_CUES = {
    question: ["what", "when", "where", "why", "how", "which", "do you", "did you", "are you",
      "have you", "is there", "any ", "since when", "tell me", "describe", "can you", "could you"],
    doctor: ["let's", "lets ", "i'll ", "we'll ", "i will", "we will", "start ", "order ", "prescribe",
      "advise", "on examination", "i think", "looks like", "my impression", "the plan", "continue ",
      "stop the", "increase the", "reduce the", "follow up", "get a ", "send for"],
    patient: ["i have", "i feel", "i am ", "i'm ", "i've", "my pain", "it hurts", "it started",
      "i can't", "i cannot", "since ", "for the last", "yes ", "no "]
  };

  function has(low, cues) {
    for (var i = 0; i < cues.length; i++) if (low.indexOf(cues[i]) >= 0) return true;
    return false;
  }

  // Split a raw transcript string into turns on sentence enders / newlines (English-focused; a
  // wiring layer can pre-split multilingual text via voice-diarize.js's splitTurns and pass an
  // array here instead).
  function splitTurns(text) {
    var t = String(text == null ? "" : text).replace(/\r/g, "\n");
    var parts = t.split(/([.?!\n]+)/), turns = [], cur = "";
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (/^[.?!\n]+$/.test(p)) { cur += p.replace(/\n+/g, ""); if (cur.trim()) turns.push(cur.trim()); cur = ""; }
      else cur += p;
    }
    if (cur.trim()) turns.push(cur.trim());
    return turns;
  }

  // Wording-only vote for one turn: { speaker, confidence, reason } or null if no cue matched.
  function wordVote(text, cues) {
    var low = text.toLowerCase();
    var isQ = /\?\s*$/.test(text) || has(low, cues.question);
    var isDr = has(low, cues.doctor);
    var isPt = has(low, cues.patient);
    if ((isQ || isDr) && !isPt) return { speaker: "doctor", confidence: isQ && isDr ? CONF_STRONG : (isQ ? CONF_WEAK : CONF_STRONG), reason: isQ ? "question_wording" : "doctor_directive_wording" };
    if (isPt && !isQ && !isDr) return { speaker: "patient", confidence: CONF_STRONG, reason: "patient_first_person_wording" };
    if (isQ || isDr || isPt) return null; // conflicting cues both ways = not trustworthy on wording alone
    return null;
  }

  function wordingOnlyTurns(rawTurns, cues) {
    return rawTurns.map(function (text) {
      var vote = wordVote(text, cues);
      if (!vote) return { text: text, speaker: "unknown", confidence: CONF_UNKNOWN, reasons: ["no_wording_cue"] };
      return { text: text, speaker: vote.speaker, confidence: vote.confidence, reasons: [vote.reason] };
    });
  }

  // ---- acoustic path: simple explainable 2-means over available numeric features --------------
  function numOr(v) { return typeof v === "number" && isFinite(v) ? v : null; }

  function hasUsableAcoustics(segs) {
    var withEnergy = 0, withPitch = 0, energyVals = [], pitchVals = [];
    segs.forEach(function (s) {
      var e = numOr(s.energy), p = numOr(s.pitch);
      if (e !== null) { withEnergy++; energyVals.push(e); }
      if (p !== null) { withPitch++; pitchVals.push(p); }
    });
    function spreads(vals) { if (vals.length < 2) return false; var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals); return (max - min) > 1e-6; }
    return (withEnergy >= 2 && spreads(energyVals)) || (withPitch >= 2 && spreads(pitchVals));
  }

  function zscore(vals) {
    var n = vals.length, mean = 0, i;
    for (i = 0; i < n; i++) mean += vals[i]; mean /= n;
    var variance = 0;
    for (i = 0; i < n; i++) variance += (vals[i] - mean) * (vals[i] - mean);
    variance /= n;
    var sd = Math.sqrt(variance) || 1;
    return vals.map(function (v) { return (v - mean) / sd; });
  }

  // 2-means on 1 or 2 dimensional points. Deterministic init (min/max extremes), fixed iterations —
  // small inputs (a consult's worth of turns), no need for anything fancier.
  function kmeans2(points) {
    var n = points.length;
    var dim = points[0].length;
    // init centroids at the two most-separated points (farthest pair from point 0, then farthest from that)
    function dist(a, b) { var s = 0; for (var d = 0; d < dim; d++) s += (a[d] - b[d]) * (a[d] - b[d]); return s; }
    var c0 = points[0], c1 = points[0], best = -1;
    for (var i = 1; i < n; i++) { var dd = dist(points[0], points[i]); if (dd > best) { best = dd; c1 = points[i]; } }
    var centroids = [c0.slice(), c1.slice()];
    var assign = new Array(n);
    for (var iter = 0; iter < 10; iter++) {
      for (i = 0; i < n; i++) assign[i] = dist(points[i], centroids[0]) <= dist(points[i], centroids[1]) ? 0 : 1;
      var sums = [new Array(dim).fill(0), new Array(dim).fill(0)], counts = [0, 0];
      for (i = 0; i < n; i++) {
        var c = assign[i]; counts[c]++;
        for (var d = 0; d < dim; d++) sums[c][d] += points[i][d];
      }
      for (c = 0; c < 2; c++) if (counts[c] > 0) for (d = 0; d < dim; d++) centroids[c][d] = sums[c][d] / counts[c];
    }
    return { assign: assign, centroids: centroids, dist: dist };
  }

  function acousticTurns(segs, cues) {
    var haveEnergy = segs.every(function (s) { return numOr(s.energy) !== null; });
    var havePitch = segs.every(function (s) { return numOr(s.pitch) !== null; });
    var energyZ = haveEnergy ? zscore(segs.map(function (s) { return s.energy; })) : null;
    var pitchZ = havePitch ? zscore(segs.map(function (s) { return s.pitch; })) : null;
    var points = segs.map(function (s, i) {
      var p = [];
      if (energyZ) p.push(energyZ[i]);
      if (pitchZ) p.push(pitchZ[i]);
      return p;
    });
    var km = kmeans2(points);

    // Use wording cues to decide which cluster is "doctor". Majority of confident wording votes
    // inside each cluster wins that cluster's identity; if neither cluster has a clear majority
    // (including zero votes anywhere), we cannot assign identity from acoustics alone.
    var clusterVotes = [{ doctor: 0, patient: 0 }, { doctor: 0, patient: 0 }];
    var wordVotes = segs.map(function (s) { return wordVote(s.text, cues); });
    wordVotes.forEach(function (v, i) {
      if (!v) return;
      clusterVotes[km.assign[i]][v.speaker]++;
    });
    var identity = [null, null]; // identity[clusterIndex] = "doctor" | "patient" | null
    var c0 = clusterVotes[0], c1 = clusterVotes[1];
    if ((c0.doctor > c0.patient) && (c1.patient > c1.doctor) && (c0.doctor + c1.patient) > 0) {
      identity = ["doctor", "patient"];
    } else if ((c1.doctor > c1.patient) && (c0.patient > c0.doctor) && (c1.doctor + c0.patient) > 0) {
      identity = ["patient", "doctor"];
    }

    return segs.map(function (s, i) {
      var cluster = km.assign[i];
      var id = identity[cluster];
      var vote = wordVotes[i];
      if (!id) {
        // no reliable cluster identity: fall back to this turn's own wording vote (still gated by
        // the same floor), otherwise unknown.
        if (vote) return { text: s.text, speaker: vote.speaker, confidence: Math.min(vote.confidence, CONF_WEAK), reasons: ["acoustic_cluster_unidentified", vote.reason] };
        return { text: s.text, speaker: "unknown", confidence: CONF_UNKNOWN, reasons: ["acoustic_cluster_unidentified", "no_wording_cue"] };
      }
      var dOwn = km.dist(points[i], km.centroids[cluster]);
      var dOther = km.dist(points[i], km.centroids[cluster === 0 ? 1 : 0]);
      var sep = (dOther - dOwn) / (dOther + dOwn + 1e-9); // -1..1, higher = more clearly in its cluster
      var conf = Math.max(0.3, Math.min(0.95, 0.55 + sep * 0.4));
      var reasons = ["acoustic_cluster:" + (cluster === 0 ? "A" : "B")];
      if (vote && vote.speaker === id) { conf = Math.min(0.97, conf + 0.1); reasons.push(vote.reason + "_agrees"); }
      else if (vote && vote.speaker !== id) { conf = Math.max(0.2, conf - 0.25); reasons.push(vote.reason + "_conflicts"); }
      var speaker = conf < CONF_FLOOR ? "unknown" : id;
      if (speaker === "unknown") conf = Math.min(conf, CONF_UNKNOWN + 0.1);
      return { text: s.text, speaker: speaker, confidence: conf, reasons: reasons };
    });
  }

  function label(segments, opts) {
    opts = opts || {};
    var cues = {
      question: (opts.cues && opts.cues.question) || DEFAULT_CUES.question,
      doctor: (opts.cues && opts.cues.doctor) || DEFAULT_CUES.doctor,
      patient: (opts.cues && opts.cues.patient) || DEFAULT_CUES.patient
    };

    var turns;
    if (Array.isArray(segments)) {
      var segs = segments.filter(function (s) { return s && typeof s.text === "string" && s.text.trim(); });
      turns = hasUsableAcoustics(segs) ? acousticTurns(segs, cues) : wordingOnlyTurns(segs.map(function (s) { return s.text; }), cues);
    } else {
      turns = wordingOnlyTurns(splitTurns(segments), cues);
    }
    // enforce the floor uniformly (belt + suspenders for any path that didn't already apply it)
    turns = turns.map(function (t) {
      if (t.speaker !== "unknown" && t.confidence < CONF_FLOOR) return { text: t.text, speaker: "unknown", confidence: t.confidence, reasons: t.reasons.concat("below_confidence_floor") };
      return t;
    });
    return { turns: turns };
  }

  function relabel(turns, index, speaker) {
    return (turns || []).map(function (t, i) {
      if (i !== index) return t;
      return { text: t.text, speaker: speaker, confidence: 1, manual: true, reasons: ["manual"] };
    });
  }

  function summary(turns) {
    var out = { doctor: 0, patient: 0, unknown: 0 };
    (turns || []).forEach(function (t) { if (out.hasOwnProperty(t.speaker)) out[t.speaker]++; });
    return out;
  }

  var API = { label: label, relabel: relabel, summary: summary, splitTurns: splitTurns, _version: "1.0" };
  if (root) root.SMD_SCRIBESPEAKER = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
