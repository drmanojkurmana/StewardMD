/* surgx-patient.js — who a surgical note is about.
 *
 * Two ways to put a patient on a note, because StewardMD has two kinds of surgeon:
 *   HOSPITAL  — pick from a connected EMR. GHIS (GIMSR) is listed as a hospital like any other,
 *               alongside every tenant the doctor onboarded through Connect. This is the only
 *               route that yields the ids an EMR write-back needs.
 *   MANUAL    — type a reference. For a surgeon working on their own, with no hospital EMR at all.
 *               The note is just as valid; it simply has nowhere to be written back to.
 *
 * WHY THE SOURCE IS RECORDED, NOT JUST THE NAME: only a GHIS-sourced patient carries the
 * patientId + episodeId that identify a live visit, and only GHIS has a verified write path today
 * (Connect is a pull-only integration - it can read a chart but has no note write-back). Storing
 * the source lets the save picker say precisely why the hospital record is or is not writable,
 * instead of failing at the end of the journey.
 *
 * PHI: this module resolves and formats patient identity. It performs no persistence of its own -
 * the linked patient rides on the note object, which surgx-store.js encrypts at rest - and it
 * never logs a name or an identifier.
 *
 * Dual export: module.exports for node tests, window.SMD_SURGX_PATIENT for the browser. The pure
 * helpers (labelling, normalisation, writability) are exported and unit-tested; the live roster and
 * search round-trips are verified on a device.
 */
(function () {
  "use strict";
  var G = (typeof globalThis !== "undefined") ? globalThis
    : (typeof window !== "undefined") ? window : this;

  var GHIS_SOURCE = "ghis";

  /* ---- pure helpers (node-tested) ---------------------------------------- */

  /* FHIR HumanName -> a display string. Mirrors connect-patient.js's own reading of the shape so
   * the same patient reads identically in both places. */
  function patientLabel(p) {
    if (!p) return "Unknown";
    var n = p.name;
    if (typeof n === "string" && n.trim()) return n.trim();
    if (n && typeof n === "object") {
      if (n.text) return String(n.text);
      var given = (n.given || []).join(" ").trim(), family = String(n.family || "").trim();
      var joined = (given + " " + family).trim();
      if (joined) return joined;
    }
    return String(p.id || "Unknown");
  }

  function patientMrn(p) {
    if (!p) return "";
    if (p.mrn) return String(p.mrn);
    var ids = p.identifiers || [];
    return (ids[0] && ids[0].value) ? String(ids[0].value) : "";
  }

  /* The linked-patient record carried on a note. Deliberately small and flat: an id, a visit, a
   * display name and where it came from. No clinical payload rides along. */
  function linkFromGhis(sel) {
    if (!sel || !sel.patientId) return null;
    return {
      source: GHIS_SOURCE,
      tenantId: "",
      patientId: String(sel.patientId),
      episodeId: String(sel.episodeId || ""),
      name: String(sel.name || "")
    };
  }
  function linkFromConnect(tenantId, p) {
    if (!tenantId || !p) return null;
    return {
      source: "connect",
      tenantId: String(tenantId),
      patientId: String(p.id || patientMrn(p) || ""),
      episodeId: "",
      name: patientLabel(p)
    };
  }
  function linkManual(ref) {
    var r = String(ref == null ? "" : ref).trim();
    if (!r) return null;
    return { source: "manual", tenantId: "", patientId: "", episodeId: "", name: r };
  }

  /* Can this linked patient be written back to a hospital record, and if not, why not?
   * One place decides, so the picker, the save button and the error text cannot disagree. */
  function writability(link) {
    if (!link) return { canWrite: false, reason: "No patient linked to this note." };
    if (link.source === "manual") {
      return { canWrite: false, reason: "Manually entered patient - there is no hospital record to write to." };
    }
    if (link.source === "connect") {
      // Connect reads a chart; it has no note write-back endpoint (pull-only by design).
      return { canWrite: false, reason: "Connect hospitals are read-only - this note cannot be written back to them." };
    }
    if (link.source === GHIS_SOURCE) {
      if (!link.patientId) return { canWrite: false, reason: "This GHIS patient has no id." };
      if (!link.episodeId) return { canWrite: false, reason: "Open the patient from the ward list first (no visit selected)." };
      return { canWrite: true, reason: "" };
    }
    return { canWrite: false, reason: "Unknown patient source." };
  }

  function describe(link) {
    if (!link) return "No patient linked";
    var where = link.source === GHIS_SOURCE ? "GIMSR · GHIS"
      : link.source === "connect" ? "Connect hospital"
      : "Entered manually";
    return (link.name || link.patientId || "Patient") + " · " + where;
  }

  /* ---- live lookups ------------------------------------------------------ */

  function ghisSession() {
    try { return !!(G.GHIS && G.GHIS.getToken && G.GHIS.getToken()); } catch (e) { return false; }
  }
  function ghisCurrent() {
    try { return (G.GHIS && G.GHIS.getSelectedPatient && G.GHIS.getSelectedPatient()) || null; } catch (e) { return null; }
  }
  function connect() { try { return G.SMD_CONNECT || null; } catch (e) { return null; } }

  /* The hospital list: GHIS listed alongside every Connect-onboarded tenant, the same way
   * connect-patient.js's admit chooser presents them - one list, no special cases for the doctor.
   * Always resolves; a failed tenant fetch degrades to whatever is available rather than erroring. */
  function sources() {
    var out = [];
    if (ghisSession()) out.push({ id: "__ghis__", name: "GIMSR · GHIS", kind: GHIS_SOURCE });
    var c = connect();
    if (!c || !c.tenants) return Promise.resolve(out);
    return Promise.resolve(c.tenants()).then(function (ts) {
      (ts || []).forEach(function (t) {
        out.push({ id: t.tenantId, name: t.name || t.tenantId, kind: "connect" });
      });
      return out;
    }).catch(function () { return out; });
  }

  function searchConnect(tenantId, query) {
    var c = connect();
    if (!c || !c.searchPatients) return Promise.resolve({ ok: false, patients: [], error: "connect_unavailable" });
    if (!tenantId || !query) return Promise.resolve({ ok: true, patients: [] });
    return Promise.resolve(c.searchPatients({ tenantId: tenantId, query: query }))
      .then(function (r) { return r && r.ok ? { ok: true, patients: r.patients || [] } : { ok: false, patients: [], error: (r && r.error) || "search_failed" }; })
      .catch(function (e) { return { ok: false, patients: [], error: String((e && e.message) || e) }; });
  }

  var API = {
    sources: sources,
    searchConnect: searchConnect,
    ghisCurrent: ghisCurrent,
    ghisSession: ghisSession,
    // pure
    patientLabel: patientLabel,
    patientMrn: patientMrn,
    linkFromGhis: linkFromGhis,
    linkFromConnect: linkFromConnect,
    linkManual: linkManual,
    writability: writability,
    describe: describe,
    GHIS_SOURCE: GHIS_SOURCE
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_SURGX_PATIENT = API;
})();
