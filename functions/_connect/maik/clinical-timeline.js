// functions/_connect/maik/clinical-timeline.js — Part 4: Clinical Timeline Engine (SCCM -> chronological patient history).
//
// Turns a normalized SCCM bundle (see ../canonical/model.js) into a chronologically-ordered clinical timeline
// MaiK can present when a doctor reviews a patient's history over time. DETERMINISTIC, PURE, NO SIDE EFFECTS,
// NO LLM, NO NETWORK. It only STRUCTURES what is already in the record: every event's date, title, detail, code
// and value is copied VERBATIM from a source resource field (or assembled purely from such verbatim values). It
// makes NO clinical decision, recommends nothing, and NEVER fabricates a date — a resource whose date field is
// absent/unparseable is carried in `undated[]` (never dropped, never dated with an invented value).
//
// Reads the same raw SCCM bundle the assembler (./clinical-context.js) reads and reuses its field-reading idioms
// (the codeable-concept + date-shape helpers). Missing/empty/partial/hostile bundles must NOT throw: they return
// { events: [], undated: [], counts: {} }, and work is bounded — each raw resource list is sliced (opts.maxEvents,
// default 500) BEFORE sorting, so a hostile bundle can never blow up the sort.

const HARD_CAP = 10000;          // absolute ceiling on maxEvents (bounds work even on a hostile opts value)
const DEFAULT_MAX_EVENTS = 500;  // per-list raw slice AND final events/undated cap

// ---- small pure helpers (mirror clinical-context.js) -------------------------------------------------------

const asArray = (x) => (Array.isArray(x) ? x : []);
const lc = (s) => String(s == null ? "" : s).trim().toLowerCase();

const ccText = (c) => (c && typeof c.text === "string" && c.text.trim() ? c.text : null);
const ccCode = (c) => (c && Array.isArray(c.coding) && c.coding[0] && c.coding[0].code) || null;
const ccSystem = (c) => (c && Array.isArray(c.coding) && c.coding[0] && c.coding[0].system) || null;

// Comparable epoch-ms from the SCCM date shapes (ISO string, partial YYYY / YYYY-MM, Period {start,end},
// {dateTime}, {value}). Date.parse normalizes date-only + partial strings in UTC, so the sort never depends on
// the host timezone or the wall clock. Returns null when there is no parseable date.
function dateKey(x) {
  if (!x) return null;
  if (typeof x === "string") { const t = Date.parse(x); return Number.isNaN(t) ? null : t; }
  if (typeof x === "object") {
    const s = x.start || x.end || x.dateTime || (typeof x.value === "string" ? x.value : null);
    if (typeof s === "string") { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  }
  return null;
}
// The date string EXACTLY as it appears in the record (never reformatted -> no fabrication).
function dateStr(x) {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object") return x.start || x.end || x.dateTime || (typeof x.value === "string" ? x.value : null) || null;
  return null;
}

function labValue(v) {
  if (v == null) return { value: null, unit: null };
  if (typeof v.value === "number") return { value: v.value, unit: v.unit != null ? v.unit : null };
  if (typeof v.text === "string") return { value: v.text, unit: null };
  return { value: null, unit: null };
}

// Faithful normalization of an interpretation label into a short flag. null flag = normal/absent (not abnormal).
function flagFromInterpretation(interp) {
  const raw = ccText(interp) || ccCode(interp);
  if (!raw) return { known: false, flag: null };
  const t = lc(raw);
  if (t === "n" || t === "normal") return { known: true, flag: null };
  if (t.includes("high") || t === "h") return { known: true, flag: "H" };
  if (t.includes("low") || t === "l") return { known: true, flag: "L" };
  if (String(raw).trim().length <= 3) return { known: true, flag: String(raw).trim().toUpperCase() };
  return { known: true, flag: "A" };
}

// Is an Observation abnormal? (1) an explicit non-normal interpretation flag, and/or (2) a numeric value outside
// its reference range. Flag prefers the explicit interpretation, else the derived range direction. Copies from
// the record only — it makes no judgement about significance.
function labAbnormality(o) {
  let abnormal = false, flag = null;
  const fi = flagFromInterpretation(o.interpretation);
  if (fi.known && fi.flag) { abnormal = true; flag = fi.flag; }
  const v = o.value && typeof o.value.value === "number" ? o.value.value : null;
  const rr = o.referenceRange;
  if (v != null && rr) {
    const lo = rr.low && typeof rr.low.value === "number" ? rr.low.value : null;
    const hi = rr.high && typeof rr.high.value === "number" ? rr.high.value : null;
    if (lo != null && v < lo) { abnormal = true; if (!flag) flag = "L"; }
    else if (hi != null && v > hi) { abnormal = true; if (!flag) flag = "H"; }
  }
  return { abnormal, flag };
}

// Attach an optional field only when the source carries a value (never emit a fabricated placeholder).
function put(obj, key, val) { if (val != null && val !== "") obj[key] = val; return obj; }

// ---- the timeline engine -----------------------------------------------------------------------------------

export function buildClinicalTimeline(sccmBundle, opts = {}) {
  const o = opts || {};
  const maxEvents = Number.isInteger(o.maxEvents) && o.maxEvents >= 0 ? Math.min(o.maxEvents, HARD_CAP) : DEFAULT_MAX_EVENTS;
  const cap = (x) => asArray(x).slice(0, maxEvents); // slice raw lists BEFORE sorting -> bounds hostile input

  const events = [];  // { ev, k } — k = epoch-ms sort key (stripped before return)
  const undated = [];  // ev (no `date` field)

  // place(): the single dated-vs-undated decision. A parseable date -> a dated event carrying the VERBATIM date
  // string; otherwise -> undated[] with NO date field (never an invented value). title falls back to the
  // resourceType only as a structural label (never a clinical claim) when the record carries no text/code.
  function place(resourceType, id, kind, rawDate, sourceField, title, extra) {
    const ev = { kind, title: title || resourceType, resourceType, evidence: { resourceType, id: id != null ? id : null, sourceField } };
    if (extra) for (const key of Object.keys(extra)) put(ev, key, extra[key]);
    const k = dateKey(rawDate);
    if (k != null) { ev.date = dateStr(rawDate); events.push({ ev, k }); }
    else { undated.push(ev); }
  }

  try {
    const b = sccmBundle && typeof sccmBundle === "object" && !Array.isArray(sccmBundle) ? sccmBundle : {};

    // Encounters -> encounter (period.start / date); title = reason, else class/status.
    for (const e of cap(b.encounters)) {
      if (!e || typeof e !== "object") continue;
      const raw = e.period != null ? e.period : (e.date != null ? e.date : null);
      const sourceField = e.period != null ? "period" : "date";
      const type = e.class || e.status || null;
      const reason = typeof e.reason === "string" ? e.reason : ccText(e.reason);
      place("Encounter", e.id, "encounter", raw, sourceField, reason || type, null);
    }

    // Conditions -> condition-onset (onset); title = condition text/code.
    for (const c of cap(b.conditions)) {
      if (!c || typeof c !== "object") continue;
      place("Condition", c.id, "condition-onset", c.onset, "onset",
        ccText(c.code) || ccCode(c.code),
        { code: ccCode(c.code), system: ccSystem(c.code) });
    }

    // Observations -> lab-result | observation (effectiveDateTime); title = code text + value+unit; mark abnormal.
    for (const ob of cap(b.observations)) {
      if (!ob || typeof ob !== "object") continue;
      const kind = lc(ob.category) === "laboratory" ? "lab-result" : "observation";
      const codeText = ccText(ob.code) || ccCode(ob.code);
      const lv = labValue(ob.value);
      let title = codeText || "Observation";
      if (lv.value != null) title += " " + lv.value + (lv.unit ? " " + lv.unit : "");
      const extra = { code: ccCode(ob.code), system: ccSystem(ob.code), value: lv.value, unit: lv.unit };
      const ab = labAbnormality(ob);
      if (ab.abnormal) { extra.abnormal = true; extra.flag = ab.flag; }
      place("Observation", ob.id, kind, ob.effectiveDateTime, "effectiveDateTime", title, extra);
    }

    // Procedures -> procedure (performedDateTime / date). SCCM v1 has no Procedure resource; defensive passthrough.
    for (const p of cap(b.procedures)) {
      if (!p || typeof p !== "object") continue;
      const raw = p.performedDateTime != null ? p.performedDateTime : (p.date != null ? p.date : null);
      const sourceField = p.performedDateTime != null ? "performedDateTime" : "date";
      place("Procedure", p.id, "procedure", raw, sourceField,
        ccText(p.code) || ccCode(p.code),
        { code: ccCode(p.code), system: ccSystem(p.code) });
    }

    // DiagnosticReports -> diagnostic-report (effectiveDateTime / issued); title = code/type, detail = conclusion.
    for (const d of cap(b.diagnosticReports)) {
      if (!d || typeof d !== "object") continue;
      const raw = d.effectiveDateTime != null ? d.effectiveDateTime : (d.issued != null ? d.issued : null);
      const sourceField = d.effectiveDateTime != null ? "effectiveDateTime" : "issued";
      place("DiagnosticReport", d.id, "diagnostic-report", raw, sourceField,
        ccText(d.code) || ccCode(d.code),
        { code: ccCode(d.code), system: ccSystem(d.code), detail: d.conclusion });
    }

    // MedicationStatements -> medication (effectivePeriod.start); title = drug + dose. NO date -> undated (never invent one).
    for (const m of cap(b.medications)) {
      if (!m || typeof m !== "object") continue;
      const drug = ccText(m.medication) || ccCode(m.medication);
      const dose = m.dosage && m.dosage.text;
      let title = drug || "Medication";
      if (dose) title += " " + dose;
      place("MedicationStatement", m.id, "medication", m.effectivePeriod, "effectivePeriod.start", title,
        { code: ccCode(m.medication) });
    }

    // Sort events by date DESCENDING (most recent first). STABLE tie-break: date desc -> kind asc -> title asc.
    // No wall clock, no randomness; equal triples fall back to deterministic insertion order (stable sort).
    events.sort((a, z) => {
      if (z.k !== a.k) return z.k - a.k;
      if (a.ev.kind !== z.ev.kind) return a.ev.kind < z.ev.kind ? -1 : 1;
      if (a.ev.title !== z.ev.title) return a.ev.title < z.ev.title ? -1 : 1;
      return 0;
    });

    const evOut = events.slice(0, maxEvents).map((x) => x.ev);
    const unOut = undated.slice(0, maxEvents);

    // counts: per-kind tally over DATED events, plus undated + total. Empty bundle -> {} (no keys).
    const counts = {};
    for (const e of evOut) counts[e.kind] = (counts[e.kind] || 0) + 1;
    if (unOut.length) counts.undated = unOut.length;
    const total = evOut.length + unOut.length;
    if (total) counts.total = total;

    return { events: evOut, undated: unOut, counts };
  } catch {
    // Belt-and-suspenders: a malformed/hostile bundle must never throw. Return the safe empty shape.
    return { events: [], undated: [], counts: {} };
  }
}
