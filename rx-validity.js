/* rx-validity.js — how long a prescription is valid, and which ones must be verifiable.
 * ============================================================================================
 * PURE. No DOM, no network, no storage. Every DECISION about validity lives here and is unit-tested
 * (test/rx-validity.test.mjs); the store only moves records and stamps server time. Same split, and
 * the same UMD shape, as pglog-model.js.
 *
 * THIS IS A SOFTWARE SAFETY POLICY, NOT A STATEMENT OF LAW.
 * There is no single legal expiry for all prescriptions. India's Drugs Rules 1945 require a
 * prescription for Schedule H/H1/X and impose dispensing/record duties, but do not say every
 * prescription expires after N days. US rules vary by schedule AND by state: Schedule II may not be
 * refilled federally, Schedule III/IV may be refilled up to five times within six months. So the
 * defaults below are conservative system behaviour, deliberately chosen to expire EARLY rather than
 * late, and a production deployment should encode its own jurisdiction's rules on top rather than
 * treat these as the law.
 *
 * THE RULE, in one line:
 *     validUntil = MIN(physician expiry, regulatory expiry, issued + system default)
 *
 * MIN is the whole point — it is fail-closed. A prescriber may always shorten validity and can
 * never lengthen it past what the drug's own class allows: asking for 90 days on a Schedule H1 drug
 * yields 30, always. Nothing here ever extends a date.
 */
(function () {
  "use strict";

  var DAY = 86400000;

  /* ---- system defaults, in days (the conservative table) ---- */
  var DEFAULTS = {
    acute: 30,
    chronic: 90,
    chronic_long: 180,
    controlled: 30,
    high_risk: 30,          // the 30-90 band, resolved to the shorter end deliberately
    prn: 90,
    antibiotic: 30          // expires 30 days after issue even if never dispensed
  };

  /* ---- regulatory caps by drug schedule ---- */
  // days: the maximum validity this schedule permits. refills: the maximum refills permitted.
  var SCHEDULE = {
    // India — Drugs Rules 1945. Strict 30-day default; X additionally carries controlled dispensing.
    "H":    { days: 30,  refills: 0, region: "IN", label: "India Schedule H" },
    "H1":   { days: 30,  refills: 0, region: "IN", label: "India Schedule H1 (enhanced audit)" },
    "X":    { days: 30,  refills: 0, region: "IN", label: "India Schedule X (controlled dispensing)" },
    // USA — DEA schedules.
    "CII":  { days: 30,  refills: 0, region: "US", label: "US Schedule II (no refills - new prescription required)" },
    "CIII": { days: 180, refills: 5, region: "US", label: "US Schedule III (max 5 refills in 6 months)" },
    "CIV":  { days: 180, refills: 5, region: "US", label: "US Schedule IV (max 5 refills in 6 months)" },
    "CV":   { days: 180, refills: 5, region: "US", label: "US Schedule V (state rules apply)" }
  };

  // US non-controlled default. India has no equivalent blanket period, so it falls through to the
  // CATEGORY default rather than inventing one.
  var US_NON_CONTROLLED_DAYS = 180;

  /* ---- classification -------------------------------------------------------------------
   * A drug is described by whatever the caller knows: an explicit schedule, the Drug Index's
   * habit_forming flag, or a class string. Nothing is guessed loosely from the NAME - a substring
   * match on a brand name is exactly how the wrong drug gets flagged - except through the explicit
   * word-boundary lists below, which exist because the commonest habit-forming molecules must never
   * depend on the server having returned a flag. */
  var HABIT_RE = /\b(alprazolam|lorazepam|clonazepam|diazepam|nitrazepam|midazolam|zolpidem|zopiclone|eszopiclone|phenobarb\w*|barbital|tramadol|codeine|morphine|fentanyl|buprenorphine|methadone|oxycodone|hydrocodone|pethidine|meperidine|pentazocine|ketamine|methylphenidate|amphetamine|dextroamphetamine|modafinil|armodafinil|gabapentin|pregabalin)\b/i;
  var ANTIBIOTIC_RE = /\b(penicillin|amoxicillin|ampicillin|cloxacillin|piperacillin|tazobactam|clavulanate|cephalexin|cefazolin|cefuroxime|cefixime|cefpodoxime|cefotaxime|ceftriaxone|ceftazidime|cefepime|cefoperazone|sulbactam|meropenem|imipenem|ertapenem|doripenem|aztreonam|vancomycin|teicoplanin|daptomycin|linezolid|clindamycin|azithromycin|clarithromycin|erythromycin|doxycycline|minocycline|tetracycline|tigecycline|gentamicin|amikacin|tobramycin|ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|norfloxacin|metronidazole|tinidazole|nitrofurantoin|fosfomycin|colistin|polymyxin|rifampicin|isoniazid|pyrazinamide|ethambutol|trimethoprim|sulfamethoxazole|cotrimoxazole|chloramphenicol|mupirocin|fidaxomicin)\b/i;
  var ANTIBIOTIC_CLASS_RE = /antibiot|antibacterial|antimicrobial|penicillin|cephalosporin|carbapenem|glycopeptide|macrolide|quinolone|fluoroquinolone|aminoglycoside|tetracycline|oxazolidinone|nitroimidazole|sulfonamide/i;

  function str(v) { return String(v == null ? "" : v); }

  // drug: { name|generic, schedule, habitForming|habit_forming, cls|class, antibiotic }
  function classify(drug) {
    if (!drug) return { schedule: null, habitForming: false, antibiotic: false, name: "" };
    var name = str(drug.generic || drug.name || drug);
    var cls = str(drug.cls || drug["class"] || "");
    var sched = str(drug.schedule || "").toUpperCase().replace(/^SCHEDULE\s*/, "").replace(/[\s-]/g, "");
    if (sched === "2") sched = "CII"; if (sched === "3") sched = "CIII";
    if (sched === "4") sched = "CIV"; if (sched === "5") sched = "CV";
    if (!SCHEDULE[sched]) sched = null;

    // The Drug Index returns habit_forming as free text ("Yes", a note) - presence means yes, but an
    // explicit negative must not read as positive.
    var hfRaw = drug.habitForming != null ? drug.habitForming : drug.habit_forming;
    var hf = (hfRaw === true) ||
      (typeof hfRaw === "string" && hfRaw.trim() !== "" && !/^(no|none|nil|false|n\/a)$/i.test(hfRaw.trim()));
    if (!hf) hf = HABIT_RE.test(name);

    var abx = drug.antibiotic === true || ANTIBIOTIC_CLASS_RE.test(cls) || ANTIBIOTIC_RE.test(name);
    return { schedule: sched, habitForming: !!hf, antibiotic: !!abx, name: name };
  }

  /* Which prescriptions get an ID + QR at all. Scoped, as asked, to the two classes where a forged
   * or reused prescription does the most harm: habit-forming drugs and antibiotics. An explicitly
   * scheduled drug counts too - a Schedule X drug is the whole reason this exists. */
  function requiresVerification(drugs) {
    var list = [].concat(drugs || []);
    for (var i = 0; i < list.length; i++) {
      var c = classify(list[i]);
      if (c.habitForming || c.antibiotic || c.schedule) return true;
    }
    return false;
  }

  // Why this prescription is verifiable — shown to the prescriber, so the rule is never a mystery.
  function verificationReasons(drugs) {
    var out = [], seen = {};
    [].concat(drugs || []).forEach(function (d) {
      var c = classify(d);
      var add = function (r) { if (!seen[r]) { seen[r] = 1; out.push(r); } };
      if (c.schedule) add(SCHEDULE[c.schedule].label);
      if (c.habitForming) add("habit-forming drug");
      if (c.antibiotic) add("antibiotic (antimicrobial stewardship)");
    });
    return out;
  }

  /* ---- validity ------------------------------------------------------------------------- */
  // The strictest schedule present decides the cap: one Schedule H1 drug on a sheet governs it all.
  function strictestSchedule(drugs) {
    var best = null;
    [].concat(drugs || []).forEach(function (d) {
      var s = classify(d).schedule; if (!s) return;
      if (!best || SCHEDULE[s].days < SCHEDULE[best].days) best = s;
      else if (SCHEDULE[s].days === SCHEDULE[best].days && SCHEDULE[s].refills < SCHEDULE[best].refills) best = s;
    });
    return best;
  }

  function categoryDays(category, drugs) {
    if (category && DEFAULTS[category] != null) return DEFAULTS[category];
    // No category given: an antibiotic on the sheet is itself a 30-day rule.
    var list = [].concat(drugs || []);
    for (var i = 0; i < list.length; i++) if (classify(list[i]).antibiotic) return DEFAULTS.antibiotic;
    return DEFAULTS.acute;
  }

  /* v = { issuedAt, country, category, drugs[], physicianExpiry }
   * returns { validUntil, days, basis[], refillsAllowed, schedule, cappedFromPhysician } */
  function validity(v) {
    v = v || {};
    var issued = +v.issuedAt || Date.now();
    var country = str(v.country || "IN").toUpperCase();
    var drugs = [].concat(v.drugs || []);
    var basis = [], candidates = [];

    var catDays = categoryDays(v.category, drugs);
    candidates.push(issued + catDays * DAY);
    basis.push("system default " + catDays + " days" + (v.category ? " (" + v.category + ")" : ""));

    var sched = strictestSchedule(drugs);
    var refills = 999;
    if (sched) {
      candidates.push(issued + SCHEDULE[sched].days * DAY);
      basis.push(SCHEDULE[sched].label + " - max " + SCHEDULE[sched].days + " days");
      refills = SCHEDULE[sched].refills;
    } else if (country === "US") {
      candidates.push(issued + US_NON_CONTROLLED_DAYS * DAY);
      basis.push("US non-controlled - max " + US_NON_CONTROLLED_DAYS + " days");
    }

    var physician = (v.physicianExpiry != null && v.physicianExpiry !== "") ? +v.physicianExpiry : null;
    var capped = false;
    if (physician && isFinite(physician)) {
      candidates.push(physician);
      basis.push("prescriber's own expiry");
    }

    var validUntil = Math.min.apply(null, candidates);
    // "Never extend automatically": if the prescriber asked for longer than the rules allow, the
    // rules win, and the record says so rather than the cap being invisible.
    if (physician && isFinite(physician) && physician > validUntil) capped = true;

    return {
      validUntil: validUntil,
      days: Math.max(0, Math.round((validUntil - issued) / DAY)),
      basis: basis,
      refillsAllowed: refills === 999 ? null : refills,
      schedule: sched,
      cappedFromPhysician: capped
    };
  }

  /* ---- lifecycle ------------------------------------------------------------------------
   * ACTIVE -> EXPIRED -> ARCHIVED. Expiry is DERIVED from validUntil, never stored as a fact that
   * can go stale; a record is only written when it is archived or revoked. Nothing is hard deleted
   * merely because it expired: retention obligations outlive validity (India's Drugs Rules require
   * certain dispensing records, and Schedule X prescription copies, to be kept two years). */
  var RETENTION_DAYS = 730;

  function retentionUntil(rec) {
    rec = rec || {};
    return (+rec.issuedAt || 0) + RETENTION_DAYS * DAY;
  }
  function statusAt(rec, now) {
    rec = rec || {}; now = +now || Date.now();
    if (rec.revokedAt) return "REVOKED";
    if (rec.archivedAt) return "ARCHIVED";
    if (rec.validUntil && now > +rec.validUntil) {
      return (now > retentionUntil(rec)) ? "ARCHIVED" : "EXPIRED";
    }
    return "ACTIVE";
  }
  // Never "can I delete this?" — only "may the heavy rendered document go?". The structured record
  // stays for the retention window regardless.
  function mayDropRendered(rec, now) {
    now = +now || Date.now();
    return !!(rec && rec.validUntil && now > +rec.validUntil);
  }

  /* ---- the id -------------------------------------------------------------------------
   * Opaque and random, never a counter: a sequential id tells a holder how many prescriptions were
   * written and lets anyone walk the neighbours. 80 bits, with the ambiguous glyphs (I, L, O, U)
   * removed so it can be read off paper and typed back correctly. */
  var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function newCode(randomBytes) {
    var n = 16, out = "";
    var bytes = randomBytes ? randomBytes(n) : null;
    for (var i = 0; i < n; i++) {
      var b = bytes ? bytes[i] : Math.floor(Math.random() * 256);
      out += ALPHABET.charAt(b % ALPHABET.length);
    }
    return out.replace(/(.{4})(?=.)/g, "$1-");   // XXXX-XXXX-XXXX-XXXX
  }
  // Typed off paper: fold the glyphs a reader confuses back onto the alphabet, and drop separators.
  function normalizeCode(s) {
    return str(s).toUpperCase().replace(/[^0-9A-Z]/g, "")
      .replace(/I/g, "1").replace(/L/g, "1").replace(/O/g, "0").replace(/U/g, "V");
  }

  var API = {
    DAY: DAY, DEFAULTS: DEFAULTS, SCHEDULE: SCHEDULE, RETENTION_DAYS: RETENTION_DAYS,
    classify: classify, requiresVerification: requiresVerification, verificationReasons: verificationReasons,
    strictestSchedule: strictestSchedule, categoryDays: categoryDays, validity: validity,
    statusAt: statusAt, retentionUntil: retentionUntil, mayDropRendered: mayDropRendered,
    newCode: newCode, normalizeCode: normalizeCode
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_RX_VALIDITY = API;
})();
