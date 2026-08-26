/* surgx-model.js — SURGX (SURGˣ · Surgical Intelligence) · THE ARCHITECTURE.
 * ===========================================================================
 * PURE. Schemas, validators, the three gates, and the compilers. No DOM, no fetch, no wall-clock
 * dependence in any output. Everything here is unit-testable in node.
 *
 * THE ONE ARCHITECTURAL IDEA (inherited from clinix-model.js, deliberately)
 * ------------------------------------------------------------------------
 * A **Step** is the atom. A Procedure is an ORDERED selection of steps plus emphasis; a Case
 * decision point references steps; a Protocol band item may reference a step. Steps are authored
 * once, in shared packs, and referenced. That indirection is what makes procedure #200 cheap
 * rather than a 200th authoring job. `test/surgx-content.test.mjs` asserts the reuse ratio, so a
 * procedure that authors more steps than it reuses fails the build rather than quietly costing
 * more later.
 *
 * PROTOCOLS HAVE TWO SOURCES, ONE SHAPE
 * -------------------------------------
 * StewardMD already ships a surgical decision engine: `ws-surgery.js` registers 12 syndromes into
 * `window.SMD_WS_ENGINES.surgery`, each with focused findings, danger signs and a deterministic
 * `assess(selectionSet)` returning an emergency flag, a management-ladder index, source control,
 * referral, clinical notes and empiric antibiotic regimens with an ICMR/Sanford reference.
 *
 * SURGX does NOT re-author any of that. `compileEngineProtocol()` PROJECTS the engine's own output
 * onto the seven-band spine, so the clinical logic has exactly one home and parity is structural
 * rather than tested-for. Authored protocols (`compileProtocol()`) cover only what the engine does
 * not: ATLS primary survey, shock, GI bleeding, chest trauma, head injury, burns, sepsis, post-op
 * deterioration.
 *
 * The projection is deliberately NON-INTERPRETIVE. It never splits clinical prose with a regex and
 * never re-words a recommendation. `result.sc` is source control, so it becomes DEFINITIVE.
 * `result.ref` is referral, so it becomes ESCALATION. `result.mgmt[]` is an unstructured note list,
 * so it is carried WHOLE into a single notes block, not scattered across bands by keyword. A band
 * the engine cannot fill (INVESTIGATE) is filled by an authored, separately-reviewed OVERLAY, or
 * shows an honest empty state. Reinterpreting a safety-critical line by regex is exactly the class
 * of change this module exists to prevent.
 *
 * THE THREE GATES (all fail CLOSED, all applied at the loader seam in surgx-content.js)
 * ------------------------------------------------------------------------------------
 *   1. REVIEW   — content whose review.status is not approved/published does not render.
 *                 A missing or garbled status reads as "draft". Absence is a refusal.
 *   2. LICENCE  — media renders only when its licence is positively cleared. Absence of a licence
 *                 record is a refusal, not a default-allow.
 *   3. EVIDENCE — an action-bearing protocol band item (DO NOW / RESUSCITATE / DEFINITIVE) must
 *                 resolve a source. validateProtocol() fails otherwise, so unsourced content
 *                 cannot reach the content directory in the first place.
 *
 * NOTES: THE ANTI-FABRICATION MECHANISM
 * -------------------------------------
 * A prompt is a request, not a mechanism. `numericGuard()` is the mechanism: any number appearing
 * in an AI-filled note field must also appear in the source transcript, or the field is VOIDED and
 * marked missing. It is the numeric analogue of clinix-tutor.js's dose-pattern refusal. Combined
 * with `aiFillable:false` on the fields an AI must never touch (swab/instrument/needle counts), a
 * fabricated operative fact has no path to a finalised note.
 *
 * window.SMD_SURGX_MODEL + module.exports.
 */
(function () {
  "use strict";

  /* ── vocabulary ──────────────────────────────────────────────────────────── */

  // The seven-band protocol spine. FIXED ORDER, defined here and not in content, so that every
  // protocol reads identically at 3am. A protocol missing a band shows an honest empty state; it
  // never reorders the page.
  var BANDS = [
    { id: "red_flags",   title: "Red flags",              blurb: "Recognise these and the rest changes" },
    { id: "do_now",      title: "Do now",                 blurb: "Before anything else" },
    { id: "assess",      title: "Assess",                 blurb: "Focused, in this order" },
    { id: "investigate", title: "Investigate",            blurb: "What actually changes management" },
    { id: "resuscitate", title: "Resuscitate / stabilise", blurb: "Buy time for the definitive step" },
    { id: "definitive",  title: "Definitive management",  blurb: "Source control is the treatment" },
    { id: "escalate",    title: "Escalation / transfer",  blurb: "Who to call, and when" }
  ];
  var BAND_IDS = BANDS.map(function (b) { return b.id; });
  // Bands whose items make a clinician DO something to a patient. Every item in these must resolve
  // a source; the evidence gate is enforced against exactly this set.
  var ACTION_BANDS = { do_now: 1, resuscitate: 1, definitive: 1 };

  // Procedure chapters. FIXED ORDER, same reasoning as the bands.
  var CHAPTERS = [
    { id: "indications",       title: "Indications" },
    { id: "contraindications", title: "Contraindications" },
    { id: "preparation",       title: "Preparation" },
    { id: "positioning",       title: "Positioning" },
    { id: "equipment",         title: "Equipment" },
    { id: "anatomy",           title: "Anatomy" },
    { id: "steps",             title: "Steps" },
    { id: "criticalSafety",    title: "Critical safety points" },
    { id: "structuresAtRisk",  title: "Structures at risk" },
    { id: "commonErrors",      title: "Common errors" },
    { id: "complications",     title: "Complications" },
    { id: "postop",            title: "Post-operative care" }
  ];
  var CHAPTER_IDS = CHAPTERS.map(function (c) { return c.id; });

  var STEP_KINDS = ["prep", "access", "dissection", "resection", "reconstruction", "closure", "checkpoint", "bailout"];

  var REVIEW_STATUSES = ["draft", "ai_drafted", "in_review", "approved", "published", "deprecated"];
  var STUDENT_VISIBLE = { approved: 1, published: 1 };

  var MEDIA_KINDS = ["image", "diagram", "video", "embed", "animation"];

  var NOTE_TYPES = ["preop", "operative", "postop", "progress", "discharge"];

  // Field provenance. This is the vocabulary the UI colours by and the finaliser gates on.
  //   clinician  — the clinician typed or explicitly confirmed it.  The only value that can finalise.
  //   voice      — transcribed from the clinician's own dictation, not yet confirmed.
  //   ai         — AI-derived STRUCTURE or placement, not yet confirmed.
  //   missing    — required and absent. Shown, never hidden: a UI that degrades by omission lies.
  var PROVENANCE = ["clinician", "voice", "ai", "missing"];
  /* What counts as "the surgeon has put their name to this".
   *
   * `clinician` - they typed it, or tapped Confirm on it.
   * `auto`      - a DERIVED fact that is already the direct consequence of an explicit clinician
   *               action, and carries no clinical judgement: the patient reference (they picked
   *               that patient by name from the ward list) and the date (the clock). Asking them
   *               to confirm the identity they just selected is a tap that adds no safety - and
   *               note that patientRef is documentation text, NOT what routes the EMR write; that
   *               is note.patient.patientId from the link itself (surgx-destinations.js).
   *
   * `ai` and `voice` are deliberately NOT here and must never be added. A dictated field that
   * reads correctly is still not a field the surgeon has signed, which is the whole reason this
   * gate exists. Anything carrying clinical judgement stays blocking. */
  var CONFIRMED = { clinician: 1, auto: 1 };

  var CASE_LEVELS = ["student", "intern", "resident", "surgeon"];
  var CASE_PHASES = [
    { id: "triage",      title: "Triage" },
    { id: "assess",      title: "Assessment" },
    { id: "investigate", title: "Investigations" },
    { id: "decide",      title: "Decision" },
    { id: "operate",     title: "Operative plan" },
    { id: "postop",      title: "Post-operative" }
  ];

  /* ── tiny type helpers (no dependencies, ES5) ────────────────────────────── */

  function isObj(v) { return !!v && typeof v === "object" && !(v instanceof Array); }
  function isArr(v) { return v instanceof Array; }
  function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
  function str(v) { return typeof v === "string" ? v : ""; }
  function arr(v) { return isArr(v) ? v : []; }
  function has(list, v) { return list.indexOf(v) >= 0; }

  /* ── Gate 1: review ──────────────────────────────────────────────────────── */

  // Fails CLOSED: anything that is not a recognised status reads as "draft".
  function reviewStatus(obj) {
    var s = obj && obj.review && obj.review.status;
    if (typeof s !== "string") s = (obj && typeof obj.review === "string") ? obj.review : "";
    s = String(s || "").trim().toLowerCase();
    return has(REVIEW_STATUSES, s) ? s : "draft";
  }
  function isRenderable(obj, opts) {
    if (!obj) return false;
    if (opts && opts.allowDraft) return reviewStatus(obj) !== "deprecated";
    return !!STUDENT_VISIBLE[reviewStatus(obj)];
  }

  /* ── Gate 2: licence ─────────────────────────────────────────────────────── */

  // Media renders only when its licence is POSITIVELY cleared. Absence of a licence record is a
  // refusal. (assets/kardiox-learn/ holds 872 images with no manifest and no licence record; that
  // is the failure mode this exists to prevent, and it is why absence is never a default-allow.)
  function isMediaCleared(m) {
    return !!(m && m.cleared === true && isStr(m.licence) && isStr(m.attribution));
  }
  // A self-authored inline diagram proves its own provenance through its own required fields.
  function isOwnerProduced(m) {
    return !!(m && /steward\s*md/i.test(str(m.attribution)));
  }
  function isCommonsVerified(m) {
    return !!(m && isStr(m.sourceUrl) && /^https:\/\//i.test(str(m.sourceUrl)) && isStr(m.licence) &&
      /(cc[\s-]?by|cc0|public domain|open access)/i.test(str(m.licence)));
  }
  function isEmbeddable(m) {
    return !!(m && m.kind === "embed" && m.embeddable === true && isStr(m.videoId));
  }
  function mediaRenderable(m, opts) {
    if (!m) return false;
    if (opts && opts.allowUncleared) return true;
    if (!isMediaCleared(m)) return false;
    // An inline diagram or a permitted embed carries its own proof. Anything else is a hosted
    // external FILE, and three typed fields are not diligence: it must also pass provenance.
    if (m.inline === true) return true;
    if (m.kind === "embed") return isEmbeddable(m);
    return isCommonsVerified(m) || isOwnerProduced(m);
  }

  /* ── Gate 3: evidence ────────────────────────────────────────────────────── */

  // A source record is only a source if it can be found again. org + title + year at minimum;
  // "TBD" and friends are rejected explicitly, because a placeholder in a provenance field is
  // worse than an empty one - it reads as provenance.
  var PLACEHOLDER = /^(tbd|todo|n\/?a|pending|xxx|\?+|-+)$/i;
  function isSource(s) {
    if (!isObj(s)) return false;
    if (!isStr(s.org) || PLACEHOLDER.test(s.org.trim())) return false;
    if (!isStr(s.title) || PLACEHOLDER.test(s.title.trim())) return false;
    var y = s.year;
    if (typeof y === "string") y = parseInt(y, 10);
    return typeof y === "number" && isFinite(y) && y > 1900 && y < 2100;
  }
  function sourceLabel(s) {
    if (!isObj(s)) return "";
    var bits = [str(s.org), str(s.title)].filter(Boolean);
    var tail = [str(s.edition), s.year != null ? String(s.year) : "", str(s.version) ? "v" + str(s.version) : ""].filter(Boolean);
    return bits.join(" · ") + (tail.length ? " (" + tail.join(", ") + ")" : "");
  }
  // Resolve an item's evidenceRef against the protocol's own source list. Returns the source
  // object or null; null in an ACTION band is a validation failure, not a rendering decision.
  function resolveEvidence(protocol, ref) {
    if (!protocol) return null;
    var list = arr(protocol.sources);
    if (!isStr(ref)) return list.length === 1 ? list[0] : null;   // single-source protocol: implicit
    for (var i = 0; i < list.length; i++) if (str(list[i].id) === ref) return list[i];
    return null;
  }
  // Review currency. Pure: "today" is injected, never read from the clock, so output is stable.
  function reviewAge(protocol, todayISO) {
    var due = str(protocol && protocol.nextReviewDue);
    if (!due || !isStr(todayISO)) return { known: false, overdue: false, due: due };
    return { known: true, overdue: due < todayISO, due: due };
  }

  /* ── validators ──────────────────────────────────────────────────────────── */

  function validateMedia(m) {
    var e = [];
    if (!isObj(m)) return { ok: false, errors: ["media: not an object"] };
    if (!isStr(m.id)) e.push("media.id required");
    if (!has(MEDIA_KINDS, str(m.kind))) e.push("media.kind must be one of " + MEDIA_KINDS.join("/"));
    // The caption is the fallback the licence gate renders, so it is required even for an
    // uncleared asset - especially for one.
    if (!isStr(m.caption)) e.push("media.caption required (" + str(m.id) + ")");
    if (m.cleared === true) {
      if (!isStr(m.licence)) e.push("media.licence required for a cleared asset (" + str(m.id) + ")");
      if (!isStr(m.attribution)) e.push("media.attribution required for a cleared asset (" + str(m.id) + ")");
      if (m.inline === true) {
        if (!isStr(m.diagramId)) e.push("media.diagramId required for an inline diagram (" + str(m.id) + ")");
        if (!isOwnerProduced(m)) e.push("only self-authored media may be cleared as inline (" + str(m.id) + ")");
      } else if (m.kind === "embed") {
        if (!isEmbeddable(m)) e.push("media.embeddable + videoId required for a cleared embed (" + str(m.id) + ")");
      } else if (!isCommonsVerified(m) && !isOwnerProduced(m)) {
        e.push("a cleared external file needs a verifiable open licence + https sourceUrl (" + str(m.id) + ")");
      }
    } else if (!isStr(m.note)) {
      // An uncleared entry is a WORK ORDER. It must say what is needed and where to look, or it is
      // just a gap someone will forget.
      e.push("media.note required for an uncleared asset - say what is needed (" + str(m.id) + ")");
    }
    return { ok: !e.length, errors: e };
  }

  function validateStep(s) {
    var e = [];
    if (!isObj(s)) return { ok: false, errors: ["step: not an object"] };
    if (!isStr(s.id)) e.push("step.id required");
    if (!has(STEP_KINDS, str(s.kind))) e.push("step.kind must be one of " + STEP_KINDS.join("/") + " (" + str(s.id) + ")");
    if (!isStr(s.title)) e.push("step.title required (" + str(s.id) + ")");
    // The teaching contract, copied from clinix-model.js's skill.why. A step that cannot say WHY
    // it is done is a checklist line, not teaching, and a checklist is not what this is for.
    if (!isStr(s.why)) e.push("step.why required (" + str(s.id) + ")");
    if (!arr(s.how).length) e.push("step.how must have at least one line (" + str(s.id) + ")");
    return { ok: !e.length, errors: e };
  }

  function validateStepPack(p) {
    var e = [];
    if (!isObj(p) || !isObj(p.steps)) return { ok: false, errors: ["step pack: expected { steps: {} }"] };
    for (var id in p.steps) {
      if (!Object.prototype.hasOwnProperty.call(p.steps, id)) continue;
      if (p.steps[id] && p.steps[id].id !== id) e.push("step key/id mismatch: " + id);
      var r = validateStep(p.steps[id]);
      if (!r.ok) e = e.concat(r.errors);
    }
    return { ok: !e.length, errors: e };
  }

  function validateProtocol(p) {
    var e = [];
    if (!isObj(p)) return { ok: false, errors: ["protocol: not an object"] };
    if (!isStr(p.id)) e.push("protocol.id required");
    if (!isStr(p.title)) e.push("protocol.title required (" + str(p.id) + ")");
    if (!isStr(p.category)) e.push("protocol.category required (" + str(p.id) + ")");
    if (!has(REVIEW_STATUSES, reviewStatus(p))) e.push("protocol.review.status invalid (" + str(p.id) + ")");

    var sources = arr(p.sources);
    if (!sources.length) e.push("protocol.sources must have at least one source (" + str(p.id) + ")");
    sources.forEach(function (s, i) {
      if (!isSource(s)) e.push("protocol.sources[" + i + "] needs org + title + year, no placeholders (" + str(p.id) + ")");
    });

    var bands = isObj(p.bands) ? p.bands : {};
    for (var k in bands) {
      if (!Object.prototype.hasOwnProperty.call(bands, k)) continue;
      if (!has(BAND_IDS, k)) { e.push("unknown band '" + k + "' (" + str(p.id) + ")"); continue; }
      arr(bands[k]).forEach(function (it, i) {
        var where = str(p.id) + "." + k + "[" + i + "]";
        if (!isObj(it) || !isStr(it.text)) { e.push(where + ": item.text required"); return; }
        // ── the EVIDENCE GATE ──
        if (ACTION_BANDS[k] && !resolveEvidence(p, it.evidenceRef)) {
          e.push(where + ": an action item must resolve an evidenceRef against protocol.sources");
        }
      });
    }
    return { ok: !e.length, errors: e };
  }

  function validateProcedure(pr, steps) {
    var e = [];
    if (!isObj(pr)) return { ok: false, errors: ["procedure: not an object"] };
    if (!isStr(pr.id)) e.push("procedure.id required");
    if (!isStr(pr.title)) e.push("procedure.title required (" + str(pr.id) + ")");
    if (!arr(pr.sources).length) e.push("procedure.sources required (" + str(pr.id) + ")");
    arr(pr.sources).forEach(function (s, i) {
      if (!isSource(s)) e.push("procedure.sources[" + i + "] needs org + title + year (" + str(pr.id) + ")");
    });
    // Educational framing is structural, not a copy decision: a procedure page must always be able
    // to say it is reference material rather than patient-specific advice.
    if (pr.educationalOnly !== true) e.push("procedure.educationalOnly must be true (" + str(pr.id) + ")");

    var ch = isObj(pr.chapters) ? pr.chapters : {};
    for (var k in ch) {
      if (!Object.prototype.hasOwnProperty.call(ch, k)) continue;
      if (!has(CHAPTER_IDS, k)) e.push("unknown chapter '" + k + "' (" + str(pr.id) + ")");
    }
    // Referential integrity. Without this a procedure renders an empty Steps chapter on a device
    // and nobody finds out until someone opens it - the exact bug the CliniX validator caught.
    if (steps) {
      arr(pr.steps).forEach(function (ref, i) {
        var id = isObj(ref) ? str(ref.ref) : str(ref);
        if (!id) { e.push(str(pr.id) + ".steps[" + i + "]: ref required"); return; }
        if (!steps[id]) e.push(str(pr.id) + ".steps[" + i + "]: unresolved step '" + id + "'");
      });
    }
    return { ok: !e.length, errors: e };
  }

  function validateCase(c) {
    var e = [];
    if (!isObj(c)) return { ok: false, errors: ["case: not an object"] };
    if (!isStr(c.id)) e.push("case.id required");
    if (!isStr(c.title)) e.push("case.title required (" + str(c.id) + ")");
    if (!isStr(c.stem)) e.push("case.stem required (" + str(c.id) + ")");
    // A simulated encounter must be labelled as one, structurally.
    if (c.simulation !== true) e.push("case.simulation must be true (" + str(c.id) + ")");
    arr(c.levels).forEach(function (l) { if (!has(CASE_LEVELS, l)) e.push("case.levels: unknown level '" + l + "' (" + str(c.id) + ")"); });
    if (!arr(c.levels).length) e.push("case.levels required (" + str(c.id) + ")");

    var dps = arr(c.decisionPoints);
    if (!dps.length) e.push("case.decisionPoints must have at least one (" + str(c.id) + ")");
    dps.forEach(function (d, i) {
      var where = str(c.id) + ".decisionPoints[" + i + "]";
      if (!isObj(d)) { e.push(where + ": not an object"); return; }
      if (!isStr(d.prompt)) e.push(where + ": prompt required");
      if (d.phase && !CASE_PHASES.some(function (p) { return p.id === d.phase; })) e.push(where + ": unknown phase '" + d.phase + "'");
      var opts = arr(d.options);
      if (opts.length < 2) e.push(where + ": at least two options");
      if (!opts.some(function (o) { return o && o.correct === true; })) e.push(where + ": at least one option must be correct");
      // The mentor falls back to this when AI is off, so it is not optional. A case that cannot
      // explain itself without a model is a case that breaks the moment the model does.
      if (!isStr(d.why)) e.push(where + ": why required - the case must teach with AI off");
    });
    return { ok: !e.length, errors: e };
  }

  /* ── protocol compilers: two sources, one shape ──────────────────────────── */

  function bandMeta(id) {
    for (var i = 0; i < BANDS.length; i++) if (BANDS[i].id === id) return BANDS[i];
    return { id: id, title: id, blurb: "" };
  }
  function emptyBands() {
    return BANDS.map(function (b) { return { band: b.id, title: b.title, blurb: b.blurb, items: [] }; });
  }
  function bandOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].band === id) return list[i];
    return null;
  }
  function item(text, extra) {
    var o = { text: str(text) };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] != null) o[k] = extra[k];
    return o;
  }

  /* Authored protocol -> the seven-band spine. Every band is present; absent ones are empty and
   * the renderer shows an honest empty state rather than silently reordering the page. */
  function compileProtocol(p, opts) {
    if (!p) return null;
    opts = opts || {};
    if (!isRenderable(p, opts)) return null;                    // review gate
    var out = emptyBands();
    var src = isObj(p.bands) ? p.bands : {};
    BAND_IDS.forEach(function (id) {
      var target = bandOf(out, id);
      arr(src[id]).forEach(function (it) {
        if (!isObj(it) || !isStr(it.text)) return;
        target.items.push(item(it.text, {
          timeCritical: it.timeCritical === true ? true : null,
          stepRef: it.stepRef || null,
          calcs: isArr(it.calcs) && it.calcs.length ? it.calcs : null,
          evidence: resolveEvidence(p, it.evidenceRef),
          kbRef: it.kbRef || null
        }));
      });
    });
    return {
      id: p.id, title: p.title, subtitle: str(p.subtitle), category: p.category,
      kind: "authored",
      bands: out,
      notes: arr(p.notes).map(String),
      calcs: arr(p.calcs).map(String),
      sources: arr(p.sources),
      review: reviewStatus(p),
      updated: str(p.updated),
      nextReviewDue: str(p.nextReviewDue),
      disclaimer: str(p.disclaimer) || DEFAULT_PROTOCOL_DISCLAIMER,
      interactive: false
    };
  }

  var DEFAULT_PROTOCOL_DISCLAIMER =
    "Decision support, not a diagnosis or a drug order. Verify against local protocol, imaging and " +
    "the individual patient.";

  /* ws-surgery.js syndrome -> the SAME seven-band shape.
   *
   * `syndrome` is an entry of window.SMD_WS_ENGINES.surgery.syndromes.
   * `selected`  is a Set (or any object with .has) of the finding/danger ids the clinician ticked.
   * `overlay`   is the authored, separately-reviewed provenance + investigations block for this
   *             syndrome (surgx/protocols/engine-overlay.json). Optional.
   *
   * The mapping is one-to-one with the engine's own semantics and never re-words or re-splits a
   * clinical string. See the file header for why.
   */
  function compileEngineProtocol(syndrome, selected, overlay, opts) {
    if (!syndrome) return null;
    opts = opts || {};
    var sel = selected || { has: function () { return false; } };
    var res = {};
    try { res = syndrome.assess(sel) || {}; } catch (e) { res = {}; }

    var out = emptyBands();
    var ov = isObj(overlay) ? overlay : {};
    var ovSources = arr(ov.sources);
    var implicitSrc = ovSources.length === 1 ? ovSources[0] : null;
    function ovEvidence(ref) {
      if (!isStr(ref)) return implicitSrc;
      for (var i = 0; i < ovSources.length; i++) if (str(ovSources[i].id) === ref) return ovSources[i];
      return implicitSrc;
    }

    // RED FLAGS <- the engine's own danger signs. Selected ones are marked active so the band
    // reads as a live checklist rather than a static list.
    arr(syndrome.danger).forEach(function (d) {
      bandOf(out, "red_flags").items.push(item(d.label, {
        id: d.id, selectable: true, active: !!(sel.has && sel.has(d.id))
      }));
    });

    // DO NOW <- ONLY the engine's emergency assertion. Nothing is inferred into this band.
    if (res.emergency) {
      bandOf(out, "do_now").items.push(item(str(res.catg) + " - time-critical, escalate now.", {
        timeCritical: true, evidence: implicitSrc
      }));
    }
    arr(ov.do_now).forEach(function (it) {
      if (!isObj(it) || !isStr(it.text)) return;
      bandOf(out, "do_now").items.push(item(it.text, { timeCritical: it.timeCritical === true ? true : null, evidence: ovEvidence(it.evidenceRef) }));
    });

    // ASSESS <- the engine's focused findings, as a live selection surface. This is what makes the
    // protocol interactive: ticking a finding re-runs assess() and the lower bands change.
    arr(syndrome.q).forEach(function (q) {
      bandOf(out, "assess").items.push(item(q.label, {
        id: q.id, selectable: true, active: !!(sel.has && sel.has(q.id))
      }));
    });

    // INVESTIGATE <- authored overlay only. The engine models no investigation set, and inventing
    // one here would be exactly the fabrication this module refuses.
    arr(ov.investigate).forEach(function (it) {
      if (!isObj(it) || !isStr(it.text)) return;
      bandOf(out, "investigate").items.push(item(it.text, { calcs: isArr(it.calcs) && it.calcs.length ? it.calcs : null, evidence: ovEvidence(it.evidenceRef) }));
    });

    // RESUSCITATE / STABILISE <- the empiric antibiotic regimens the engine already carries, with
    // its own reference string preserved verbatim, plus any authored overlay lines.
    if (res.abx && isArr(res.abx.firstLine) && res.abx.firstLine.length) {
      bandOf(out, "resuscitate").items.push(item("Empiric antimicrobials - verify against local antibiogram", {
        abx: res.abx,
        evidence: isStr(res.abx.ref) ? { org: res.abx.ref, title: "Empiric therapy reference", year: null, inline: true } : implicitSrc
      }));
    }
    arr(ov.resuscitate).forEach(function (it) {
      if (!isObj(it) || !isStr(it.text)) return;
      bandOf(out, "resuscitate").items.push(item(it.text, { timeCritical: it.timeCritical === true ? true : null, evidence: ovEvidence(it.evidenceRef) }));
    });

    // DEFINITIVE <- result.sc IS source control. One-to-one, whole, unmodified.
    if (isStr(res.sc)) bandOf(out, "definitive").items.push(item(res.sc, { evidence: implicitSrc }));

    // ESCALATION <- result.ref IS the referral/escalation line. Plus the shared-condition overlay,
    // which the engine models explicitly and which must never be lost in translation.
    if (isStr(res.ref)) bandOf(out, "escalate").items.push(item(res.ref, {}));
    if (res.shared || syndrome.shared) {
      var sh = syndrome.shared || {};
      bandOf(out, "escalate").items.push(item(
        "Shared condition. " + (sh.primary || "Internal Medicine") + " remains PRIMARY" +
        (sh.role ? "; this pathway is the " + String(sh.role).toLowerCase() : "") +
        ". It does not overwrite the Internal Medicine assessment.",
        { shared: true }
      ));
    }

    return {
      id: syndrome.id, title: syndrome.name, subtitle: str(ov.subtitle),
      category: str(ov.category) || "surgical_emergency",
      kind: "engine",
      bands: out,
      // result.mgmt[] is an unstructured clinical note list. It is carried WHOLE rather than
      // scattered across bands by keyword matching - see the file header.
      notes: arr(res.mgmt).map(String),
      headline: str(res.catg),
      emergency: !!res.emergency,
      ladder: typeof res.ladder === "number" ? res.ladder : null,
      calcs: arr(ov.calcs).map(String),
      sources: ovSources,
      kbRef: str(ov.kbRef),
      review: ov.review ? reviewStatus(ov) : "published",
      updated: str(ov.updated),
      nextReviewDue: str(ov.nextReviewDue),
      disclaimer: str(ov.disclaimer) || DEFAULT_PROTOCOL_DISCLAIMER,
      interactive: true,
      hasSelection: !!(arr(syndrome.q).length || arr(syndrome.danger).length)
    };
  }

  // The engine's management ladder, mirrored from workspaces.js ABX_LADDER so the SURGX renderer
  // can show the same six rungs without importing the workspace UI.
  var LADDER = [
    "Antibiotics not indicated", "Topical / local therapy", "Oral antibiotic",
    "IV antibiotic / admission", "Urgent drainage / source control", "Emergency referral"
  ];

  /* ── procedure compiler ──────────────────────────────────────────────────── */

  /* A procedure is an ORDERED selection of shared steps plus emphasis, projected into the fixed
   * chapter order. `steps` is the merged step map from the procedure's packs. */
  function compileProcedure(pr, steps, opts) {
    if (!pr) return null;
    opts = opts || {};
    if (!isRenderable(pr, opts)) return null;                   // review gate
    steps = steps || {};

    var chapters = CHAPTERS.map(function (c) {
      return { id: c.id, title: c.title, lines: [], steps: [], media: arr((pr.media || {})[c.id]) };
    });
    function chap(id) { for (var i = 0; i < chapters.length; i++) if (chapters[i].id === id) return chapters[i]; return null; }

    var src = isObj(pr.chapters) ? pr.chapters : {};
    CHAPTER_IDS.forEach(function (id) {
      var t = chap(id);
      arr(src[id]).forEach(function (line) {
        if (isStr(line)) t.lines.push({ text: line });
        else if (isObj(line) && isStr(line.text)) t.lines.push({ text: line.text, media: line.media || null, calcs: isArr(line.calcs) ? line.calcs : null });
      });
    });

    // The Steps chapter is compiled from referenced step objects, in the authored order. A step
    // that fails the review gate is DROPPED and counted, so the UI can say "3 steps awaiting
    // clinical sign-off" rather than rendering a shorter, silently wrong operation.
    var pending = 0;
    var refs = arr(pr.steps);
    refs.forEach(function (ref, i) {
      var id = isObj(ref) ? str(ref.ref) : str(ref);
      var s = steps[id];
      if (!s) return;
      if (!isRenderable(s, opts)) { pending++; return; }
      var emph = isObj(ref) ? ref.emphasis : null;
      chap("steps").steps.push({
        n: i + 1,
        id: s.id, kind: s.kind, title: s.title, why: s.why,
        how: arr(s.how).map(String),
        pitfalls: arr(s.pitfalls).map(String),
        structuresAtRisk: arr(s.structuresAtRisk).map(String),
        critical: s.critical === true,
        media: arr(s.media),
        emphasis: isStr(emph) ? emph : (isObj(emph) && isStr(emph.note) ? emph.note : "")
      });
    });

    // Structures at risk and critical safety points roll UP from the steps as well as being
    // authorable at the procedure level. Authoring them twice is how they drift.
    chap("steps").steps.forEach(function (s) {
      s.structuresAtRisk.forEach(function (x) {
        if (!chap("structuresAtRisk").lines.some(function (l) { return l.text === x; })) {
          chap("structuresAtRisk").lines.push({ text: x, fromStep: s.title });
        }
      });
      if (s.critical) {
        var t = s.title + ": " + s.why;
        if (!chap("criticalSafety").lines.some(function (l) { return l.text === t; })) {
          chap("criticalSafety").lines.push({ text: t, fromStep: s.title });
        }
      }
    });

    return {
      id: pr.id, title: pr.title, subtitle: str(pr.subtitle), system: str(pr.system),
      aliases: arr(pr.aliases).map(String),
      estMinutes: pr.estMinutes || null,
      chapters: chapters,
      calcs: arr(pr.calcs).map(String),
      sources: arr(pr.sources),
      kbRef: str(pr.kbRef),
      review: reviewStatus(pr),
      pendingSteps: pending,
      educationalOnly: true,
      disclaimer: str(pr.disclaimer) ||
        "Educational reference. Not patient-specific advice and not a substitute for training, " +
        "supervision or local operative policy."
    };
  }

  /* Step reuse across a set of procedures. The architecture's own claim, made measurable:
   * a procedure that authors more steps than it reuses is the validator telling you the step
   * belonged in a shared pack. */
  function reuseReport(procedures, sharedStepIds) {
    var shared = {};
    arr(sharedStepIds).forEach(function (id) { shared[id] = 1; });
    return arr(procedures).map(function (pr) {
      var total = 0, reused = 0;
      arr(pr.steps).forEach(function (ref) {
        var id = isObj(ref) ? str(ref.ref) : str(ref);
        if (!id) return;
        total++;
        if (shared[id]) reused++;
      });
      return { id: pr.id, total: total, reused: reused, authored: total - reused, ratio: total ? reused / total : 0 };
    });
  }

  /* ── case compiler ───────────────────────────────────────────────────────── */

  function compileCase(c, level, opts) {
    if (!c) return null;
    opts = opts || {};
    if (!isRenderable(c, opts)) return null;                    // review gate
    var lv = has(CASE_LEVELS, level) ? level : "resident";
    var dps = arr(c.decisionPoints).filter(function (d) {
      // A decision point may be restricted to certain levels; absent means every level.
      var only = arr(d.levels);
      return !only.length || has(only, lv);
    }).map(function (d, i) {
      return {
        n: i + 1,
        id: str(d.id) || ("dp" + (i + 1)),
        phase: str(d.phase) || "decide",
        prompt: d.prompt,
        options: arr(d.options).map(function (o, j) {
          return { id: str(o.id) || ("o" + j), text: str(o.text), correct: o.correct === true, feedback: str(o.feedback) };
        }),
        why: d.why,
        missedRedFlags: arr(d.missedRedFlags).map(String),
        alternatives: arr(d.alternatives).map(String),
        // Scaffolding is a LEVEL decision, not a content decision: the same case teaches a student
        // and challenges a surgeon by revealing more or less before they commit.
        hint: (lv === "student" || lv === "intern") ? str(d.hint) : "",
        stepRef: str(d.stepRef)
      };
    });
    return {
      id: c.id, title: c.title, level: lv, levels: arr(c.levels),
      simulation: true,
      stem: c.stem,
      vitals: isObj(c.vitals) ? c.vitals : null,
      phases: CASE_PHASES.filter(function (p) { return dps.some(function (d) { return d.phase === p.id; }); }),
      decisionPoints: dps,
      protocolRef: str(c.protocolRef),
      procedureRef: str(c.procedureRef),
      sources: arr(c.sources),
      review: reviewStatus(c),
      disclaimer: "Simulated encounter for training. Not a real patient and not clinical advice."
    };
  }

  /* Case scoring. NOT a single percentage, deliberately (the CliniX rule, which was paid for):
   * a trainee who reaches the right answer having missed every red flag got the answer right and
   * the encounter wrong, and a blended mark hides exactly that. */
  function scoreCase(compiled, answers) {
    var dps = arr(compiled && compiled.decisionPoints);
    var correct = 0, attempted = 0, safetyMisses = 0, redFlagsMissed = [];
    dps.forEach(function (d) {
      var picked = answers && answers[d.id];
      if (picked == null) return;
      attempted++;
      var opt = null;
      for (var i = 0; i < d.options.length; i++) if (d.options[i].id === picked) opt = d.options[i];
      if (opt && opt.correct) correct++;
      else {
        if (d.missedRedFlags.length) { safetyMisses++; d.missedRedFlags.forEach(function (r) { if (redFlagsMissed.indexOf(r) < 0) redFlagsMissed.push(r); }); }
      }
    });
    var complete = attempted === dps.length && dps.length > 0;
    var verdict = !complete ? "incomplete"
      : safetyMisses > 0 ? "unsafe-reasoning"
      : correct === dps.length ? "good"
      : "sound-with-gaps";
    return {
      total: dps.length, attempted: attempted, correct: correct,
      safetyMisses: safetyMisses, redFlagsMissed: redFlagsMissed,
      complete: complete, verdict: verdict
    };
  }

  /* ── notes ───────────────────────────────────────────────────────────────── */

  /* Field completeness + missing detection. Pure, so the finalise gate is testable without a DOM.
   *
   * `schema`  = [{ title, fields:[{k,label,type,required,aiFillable,phi}] }]
   * `values`  = { k: string }
   * `prov`    = { k: "clinician"|"voice"|"ai"|"missing" }
   *
   * REQUIRED + EMPTY  -> missing (blocks finalise)
   * REQUIRED + FILLED but not clinician-confirmed -> unconfirmed (blocks finalise)
   * The distinction matters: a dictated field that reads correctly is still not a field the
   * surgeon has put their name to, and an operative note is signed.
   */
  function noteCompleteness(schema, values, prov) {
    values = values || {}; prov = prov || {};
    var missing = [], unconfirmed = [], filled = 0, required = 0, total = 0;
    arr(schema).forEach(function (sec) {
      arr(sec.fields).forEach(function (f) {
        total++;
        var v = str(values[f.k]).trim();
        var p = prov[f.k];
        if (v) filled++;
        if (f.required) {
          required++;
          if (!v) missing.push({ k: f.k, label: f.label, section: sec.title });
          else if (!CONFIRMED[p]) unconfirmed.push({ k: f.k, label: f.label, section: sec.title, source: p || "ai" });
        }
      });
    });
    return {
      total: total, filled: filled, required: required,
      missing: missing, unconfirmed: unconfirmed,
      pct: total ? Math.round((filled / total) * 100) : 0,
      canFinalize: missing.length === 0 && unconfirmed.length === 0
    };
  }

  /* THE ANTI-FABRICATION MECHANISM.
   *
   * Every number appearing in an AI-derived field value must also appear in the source transcript.
   * A model asked to "structure this dictation" that emits "EBL 200 mL" when nobody said a number
   * has fabricated an operative fact, and an operative note is a legal record.
   *
   * Returns { ok, fabricated:[numbers] }. The caller VOIDS the field and marks it missing on
   * failure - it never renders a value that failed this check, and it never silently corrects one.
   *
   * Numbers are compared as normalised digit strings, so "1500" matches "1,500" and "1.5" does not
   * match "15". Ordinals and units are irrelevant: the digits are the claim.
   */
  function numbersIn(text) {
    var out = [], m, re = /\d+(?:[.,]\d+)*/g;
    while ((m = re.exec(String(text || ""))) !== null) {
      out.push(m[0].replace(/,/g, ""));
    }
    return out;
  }
  function numericGuard(value, transcript) {
    var inValue = numbersIn(value);
    if (!inValue.length) return { ok: true, fabricated: [] };
    var pool = numbersIn(transcript);
    var bad = [];
    inValue.forEach(function (n) {
      if (pool.indexOf(n) < 0 && bad.indexOf(n) < 0) bad.push(n);
    });
    return { ok: !bad.length, fabricated: bad };
  }

  /* Apply an AI extraction to a note, obeying every rule at once. This is the ONLY sanctioned path
   * from a model's output into a note, and it is pure so it can be exhaustively tested.
   *
   * Rules, in order:
   *   1. A key not in the schema is dropped.
   *   2. A field with aiFillable:false is dropped, whatever the model said. (Swab, instrument and
   *      needle counts live here: an AI must never populate a count, at all, ever.)
   *   3. A field the clinician has already confirmed is never overwritten.
   *   4. A value failing numericGuard is dropped and the field is reported as fabricated.
   *   5. Everything that survives is written with provenance "ai" (or "voice"), never "clinician".
   */
  function applyExtraction(schema, values, prov, extracted, transcript, source) {
    var byKey = {};
    arr(schema).forEach(function (sec) { arr(sec.fields).forEach(function (f) { byKey[f.k] = f; }); });
    var nextV = {}, nextP = {};
    for (var k in values) if (Object.prototype.hasOwnProperty.call(values, k)) nextV[k] = values[k];
    for (var k2 in prov) if (Object.prototype.hasOwnProperty.call(prov, k2)) nextP[k2] = prov[k2];

    var applied = [], rejected = [], fabricated = [];
    var src = source === "voice" ? "voice" : "ai";

    for (var key in (extracted || {})) {
      if (!Object.prototype.hasOwnProperty.call(extracted, key)) continue;
      var f = byKey[key];
      if (!f) { rejected.push({ k: key, reason: "not-in-schema" }); continue; }
      if (f.aiFillable === false) { rejected.push({ k: key, label: f.label, reason: "never-ai-fillable" }); continue; }
      if (CONFIRMED[nextP[key]]) { rejected.push({ k: key, label: f.label, reason: "clinician-confirmed" }); continue; }
      var val = str(extracted[key]).replace(/\s+/g, " ").trim();
      if (!val) { rejected.push({ k: key, label: f.label, reason: "empty" }); continue; }
      var g = numericGuard(val, transcript);
      if (!g.ok) {
        fabricated.push({ k: key, label: f.label, numbers: g.fabricated });
        rejected.push({ k: key, label: f.label, reason: "numeric-not-in-transcript" });
        continue;
      }
      nextV[key] = val;
      nextP[key] = src;
      applied.push({ k: key, label: f.label });
    }
    return { values: nextV, provenance: nextP, applied: applied, rejected: rejected, fabricated: fabricated };
  }

  /* Render a note to plain text, deterministically. No LLM, no randomness, no clock. This is the
   * base layer: an LLM may later polish the narrative, but SURGX must always be able to produce a
   * valid, complete note entirely on its own (the thorex-report.js discipline).
   *
   * A note that is not finalised is stamped DRAFT and every missing required field is printed as
   * an explicit "[NOT RECORDED]" line. Omitting it would be the UI lying about the data. */
  function renderNoteText(schema, values, prov, meta) {
    meta = meta || {};
    var lines = [];
    var title = str(meta.title) || "Surgical note";
    lines.push(title.toUpperCase());
    if (meta.finalized) lines.push("Finalised by: " + (str(meta.finalizedBy) || "clinician") + (meta.finalizedAt ? " · " + meta.finalizedAt : ""));
    else lines.push("*** DRAFT - NOT VERIFIED BY A CLINICIAN ***");
    lines.push("");
    arr(schema).forEach(function (sec) {
      var body = [];
      arr(sec.fields).forEach(function (f) {
        var v = str(values && values[f.k]).trim();
        if (!v && !f.required) return;
        if (!v) { body.push(f.label + ": [NOT RECORDED]"); return; }
        var tag = "";
        if (!meta.finalized && !CONFIRMED[prov && prov[f.k]]) tag = "  [unverified: " + (prov && prov[f.k] || "ai") + "]";
        body.push(f.label + ": " + v + tag);
      });
      if (!body.length) return;
      lines.push(sec.title.toUpperCase());
      lines.push(body.join("\n"));
      lines.push("");
    });
    lines.push("Generated with StewardMD SURGX. Clinician-authored content; AI assists with structure only.");
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ── export ──────────────────────────────────────────────────────────────── */

  var API = {
    BANDS: BANDS, BAND_IDS: BAND_IDS, ACTION_BANDS: ACTION_BANDS,
    CHAPTERS: CHAPTERS, CHAPTER_IDS: CHAPTER_IDS, STEP_KINDS: STEP_KINDS,
    REVIEW_STATUSES: REVIEW_STATUSES, MEDIA_KINDS: MEDIA_KINDS,
    NOTE_TYPES: NOTE_TYPES, PROVENANCE: PROVENANCE,
    CASE_LEVELS: CASE_LEVELS, CASE_PHASES: CASE_PHASES, LADDER: LADDER,
    DEFAULT_PROTOCOL_DISCLAIMER: DEFAULT_PROTOCOL_DISCLAIMER,

    // gates
    reviewStatus: reviewStatus, isRenderable: isRenderable,
    isMediaCleared: isMediaCleared, mediaRenderable: mediaRenderable,
    isEmbeddable: isEmbeddable, isCommonsVerified: isCommonsVerified, isOwnerProduced: isOwnerProduced,
    isSource: isSource, sourceLabel: sourceLabel, resolveEvidence: resolveEvidence, reviewAge: reviewAge,

    // validators
    validateMedia: validateMedia, validateStep: validateStep, validateStepPack: validateStepPack,
    validateProtocol: validateProtocol, validateProcedure: validateProcedure, validateCase: validateCase,

    // compilers
    bandMeta: bandMeta,
    compileProtocol: compileProtocol, compileEngineProtocol: compileEngineProtocol,
    compileProcedure: compileProcedure, reuseReport: reuseReport,
    compileCase: compileCase, scoreCase: scoreCase,

    // notes
    noteCompleteness: noteCompleteness, numericGuard: numericGuard, numbersIn: numbersIn,
    applyExtraction: applyExtraction, renderNoteText: renderNoteText
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SURGX_MODEL = API;
})();
