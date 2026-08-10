/* StewardMD — Initial Assessment form (mirrors GHIS) + live voice autofill + local save.
 * ===========================================================================
 * Renders the assessment-schema fields as real editable "EMR boxes", lets the ambient voice
 * controller (SMD_AMBIENT) fill them in near-real-time, protects doctor edits, and saves.
 *   SMD_ASSESSFORM.mount(hostEl, { patient, onSignOff }) → controller
 *     controller.applyUpdates(res)  ← from SMD_AMBIENT.onUpdate ({updates,dropped})
 *     controller.getState()         → { fid:{value,source,manual} }  (for conflict checks)
 *     controller.collect()          → { fid: value }                 (for save / GHIS write)
 *
 * Save         → localStorage draft (on-device only).
 * Save & sign off → local save + opts.onSignOff(payload) (GHIS write — Task 4).
 * Voice writes are tagged (Voice / AI / Patient) with a source chip; a doctor edit locks the
 * field (chip "You") so voice can't overwrite it — a conflicting voice value shows a review chip.
 * ======================================================================== */
(function () {
  "use strict";
  var S = window.SMD_ASSESS;
  function ico(n) { return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var SRC_LABEL = { voice: "Voice", patient_reported: "Patient (unconfirmed)", ai: "AI", you: "You" };

  function fieldHTML(f) {
    var id = "af_" + f.id, req = f.required ? ' <span class="af-req">*</span>' : "";
    var body;
    if (f.type === "textarea") body = '<textarea id="' + id + '" data-fid="' + f.id + '" rows="2"></textarea>';
    else if (f.type === "num") body = '<input id="' + id + '" data-fid="' + f.id + '" type="number" inputmode="decimal"' + (f.min != null ? ' min="' + f.min + '"' : "") + (f.max != null ? ' max="' + f.max + '"' : "") + '>';
    else if (f.type === "select") body = '<select id="' + id + '" data-fid="' + f.id + '">' + (f.opts || []).map(function (o) { return '<option value="' + esc(o) + '">' + esc(o || "—") + '</option>'; }).join("") + '</select>';
    else if (f.type === "radio") body = '<span class="af-seg" data-fid="' + f.id + '" id="' + id + '">' + (f.opts || []).map(function (o) { return '<button type="button" class="af-seg-b" data-val="' + esc(o) + '">' + esc(o) + '</button>'; }).join("") + '</span>';
    else if (f.type === "check") body = '<input id="' + id + '" data-fid="' + f.id + '" type="checkbox">';
    else body = '<input id="' + id + '" data-fid="' + f.id + '" type="text">';
    return '<div class="af-f af-t-' + f.type + '" data-field="' + f.id + '">' +
      '<label class="af-lbl" for="' + id + '">' + esc(f.label) + req + '</label>' +
      body + '<span class="af-chip" data-chip="' + f.id + '"></span></div>';
  }

  function renderHTML() {
    return (S.sections || []).map(function (sec) {
      return '<section class="af-sec"><h3 class="af-sec-h">' + esc(sec.title) + '</h3><div class="af-grid">' +
        sec.fields.map(fieldHTML).join("") + '</div></section>';
    }).join("");
  }

  function mount(host, opts) {
    opts = opts || {};
    injectCSS();
    var pid = (opts.patient && (opts.patient.mrn || opts.patient.id)) || "draft";
    var state = {};   // fid -> {value, source, manual}

    host.innerHTML =
      '<div class="af-wrap">' +
        '<div class="af-bar">' +
          '<button class="af-mic" id="afMic">' + ico("mic") + ' Start Voice Consultation</button>' +
          '<span class="af-status" id="afStatus"></span>' +
        '</div>' +
        '<div class="af-body">' + renderHTML() + '</div>' +
        '<div class="af-actions">' +
          '<button class="af-save" id="afSave">' + ico("check") + ' Save</button>' +
          '<button class="af-signoff" id="afSignoff">Save &amp; sign off to GHIS</button>' +
        '</div>' +
        '<div class="af-note">On-device speech; raw audio is discarded after text extraction. Voice fills fields for your review - nothing is signed off until you tap Save &amp; sign off.</div>' +
      '</div>';

    var body = host.querySelector(".af-body");
    var statusEl = host.querySelector("#afStatus");

    function elOf(fid) { return body.querySelector('[data-fid="' + fid + '"]'); }
    function chipOf(fid) { return body.querySelector('[data-chip="' + fid + '"]'); }
    function setChip(fid, src, conflict) {
      var c = chipOf(fid); if (!c) return;
      if (conflict) { c.className = "af-chip af-chip-warn"; c.textContent = "Voice: " + conflict.incoming + " (kept " + conflict.existing + ")"; return; }
      c.className = "af-chip af-chip-" + (src === "you" ? "you" : src === "patient_reported" ? "pt" : "ai");
      c.textContent = SRC_LABEL[src] || src;
    }

    // write a value into a field element without tripping the manual-edit guard
    function put(fid, value) {
      var el = elOf(fid); if (!el) return false;
      if (el.classList && el.classList.contains("af-seg")) {
        [].forEach.call(el.querySelectorAll(".af-seg-b"), function (b) { b.classList.toggle("on", b.getAttribute("data-val") === String(value)); });
      } else if (el.type === "checkbox") { el.checked = !!value; }
      else { el.value = value == null ? "" : value; }
      el.classList.add("af-filled");
      return true;
    }

    function applyUpdates(res) {
      if (!res) return;
      (res.updates || []).forEach(function (u) {
        if (u.applied) {
          if (put(u.field, u.value)) { state[u.field] = { value: u.value, source: u.source, manual: false }; setChip(u.field, u.source); }
        } else if (u.conflict) { setChip(u.field, u.source, u.conflict); }   // never silently overwrite
      });
    }

    function getState() { return state; }
    function collect() {
      var out = {};
      (S.sections || []).forEach(function (sec) { sec.fields.forEach(function (f) {
        var el = elOf(f.id); if (!el) return;
        if (el.classList && el.classList.contains("af-seg")) { var on = el.querySelector(".af-seg-b.on"); if (on) out[f.id] = on.getAttribute("data-val"); }
        else if (el.type === "checkbox") { if (el.checked) out[f.id] = true; }
        else if (el.value !== "") out[f.id] = el.value;
      }); });
      return out;
    }

    // ── manual-edit guard: a doctor touching a field locks it (voice can't overwrite) ──
    function lock(fid, val) { state[fid] = { value: val, source: "you", manual: true }; setChip(fid, "you"); }
    body.addEventListener("input", function (e) { var fid = e.target.getAttribute && e.target.getAttribute("data-fid"); if (fid) lock(fid, e.target.type === "checkbox" ? e.target.checked : e.target.value); });
    body.addEventListener("change", function (e) { var fid = e.target.getAttribute && e.target.getAttribute("data-fid"); if (fid) lock(fid, e.target.type === "checkbox" ? e.target.checked : e.target.value); });
    // segmented (radio) taps
    body.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".af-seg-b"); if (!b) return;
      var seg = b.parentNode, fid = seg.getAttribute("data-fid");
      [].forEach.call(seg.querySelectorAll(".af-seg-b"), function (x) { x.classList.toggle("on", x === b); });
      lock(fid, b.getAttribute("data-val"));
    });

    // ── ambient voice ──
    var amb = null;
    function setStatus(t) { if (statusEl) statusEl.textContent = t || ""; }
    host.querySelector("#afMic").addEventListener("click", function () {
      var mic = host.querySelector("#afMic");
      if (amb) { amb.stop(); amb = null; mic.classList.remove("live"); mic.innerHTML = ico("mic") + " Start Voice Consultation"; setStatus("Stopped."); return; }
      if (!window.SMD_AMBIENT) { setStatus("Voice module unavailable."); return; }
      mic.classList.add("live"); mic.innerHTML = ico("stop") + " Stop";
      amb = window.SMD_AMBIENT.start({
        speaker: "doctor",
        getState: getState,
        llmExtract: opts.llmExtract || defaultLLM,
        onUpdate: applyUpdates,
        onTranscript: function () {},
        onState: function (s) { setStatus(s === "listening" ? "Listening…" : s === "preparing" ? "Preparing model…" : s === "downloading" ? "Downloading model…" : ""); },
        onError: function (err) { setStatus(err === "clinical-unavailable" ? "On-device voice not available on this build." : "Voice error: " + err); mic.classList.remove("live"); mic.innerHTML = ico("mic") + " Start Voice Consultation"; amb = null; }
      });
    });

    host.querySelector("#afSave").addEventListener("click", function () { saveLocal(); toast("Saved on this device."); });
    host.querySelector("#afSignoff").addEventListener("click", function () {
      var payload = collect(); saveLocal(payload);
      if (opts.onSignOff) { Promise.resolve(opts.onSignOff(payload)).then(function (r) { toast(r && r.ok ? "Signed off to GHIS." : "Saved locally; GHIS sign-off pending."); }).catch(function () { toast("Saved locally; GHIS sign-off failed."); }); }
      else toast("Saved locally. GHIS sign-off not configured yet.");
    });

    function saveLocal(payload) { try { localStorage.setItem("smd_assessment_" + pid, JSON.stringify(payload || collect())); } catch (e) {} }
    // prefill from an existing GHIS assessment (Task 3 prefill / Task 4 read) or a local draft
    if (opts.prefill) applyUpdates({ updates: Object.keys(opts.prefill).map(function (k) { return { field: k, value: opts.prefill[k], source: "ai", applied: true }; }) });
    else try { var draft = JSON.parse(localStorage.getItem("smd_assessment_" + pid) || "null"); if (draft) Object.keys(draft).forEach(function (k) { put(k, draft[k]); }); } catch (e) {}

    function toast(m) { try { (window.toast || function () {})(m); } catch (e) {} if (statusEl) setStatus(m); }
    // ponytail: naive server call; swap to the real GHIS-assessment kind once /api/ai/extract supports it.
    function defaultLLM(transcript) {
      if (!(window.SMD_AI && window.SMD_AI.extract)) return null;
      return window.SMD_AI.extract(transcript, "assessment", null).then(function (r) { return r && !r.error ? { fields: r.fields || {}, confidence: 0.7 } : null; });
    }

    return { applyUpdates: applyUpdates, getState: getState, collect: collect, put: put, stop: function () { if (amb) { amb.stop(); amb = null; } } };
  }

  function injectCSS() {
    if (document.getElementById("af-css")) return;
    var s = document.createElement("style"); s.id = "af-css";
    s.textContent = [
      ".af-wrap{font-family:var(--sans,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif);color:var(--ink,#0f172a);padding:8px 0 40px}",
      ".af-bar{position:sticky;top:0;z-index:5;background:var(--bg,#f8fafc);display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line,#e2e8f0)}",
      ".af-mic{border:none;border-radius:12px;background:var(--teal,#0f766e);color:#fff;font:800 14px var(--sans);padding:11px 16px;cursor:pointer}",
      ".af-mic.live{background:#b91c1c;animation:afpulse 1.3s infinite}",
      "@keyframes afpulse{0%,100%{box-shadow:0 0 0 0 rgba(185,28,28,.5)}50%{box-shadow:0 0 0 8px rgba(185,28,28,0)}}",
      ".af-status{font:600 12px var(--sans);color:var(--slate-soft,#64748b)}",
      ".af-sec{padding:12px}",
      ".af-sec-h{font:800 13px var(--sans);color:var(--teal,#0f766e);text-transform:uppercase;letter-spacing:.04em;margin:6px 0 8px}",
      ".af-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}",
      ".af-f{display:flex;flex-direction:column;gap:4px}",
      ".af-t-textarea,.af-t-text{grid-column:1/-1}",
      ".af-lbl{font:600 12px var(--sans);color:var(--slate,#334155)}",
      ".af-req{color:#b91c1c}",
      ".af-f input,.af-f select,.af-f textarea{border:1.5px solid var(--line,#e2e8f0);border-radius:9px;padding:8px 10px;font:500 13px var(--sans);background:var(--panel,#fff);color:var(--ink,#0f172a);box-sizing:border-box}",
      ".af-f input[type=checkbox]{width:20px;height:20px}",
      ".af-filled{border-color:var(--teal,#0f766e)!important;background:var(--teal-soft,#e3f1ee)}",
      ".af-seg{display:inline-flex;gap:0;border:1.5px solid var(--line,#e2e8f0);border-radius:9px;overflow:hidden;width:fit-content}",
      ".af-seg-b{border:none;background:var(--panel,#fff);color:var(--ink,#0f172a);font:700 12px var(--sans);padding:8px 14px;cursor:pointer;border-right:1px solid var(--line,#e2e8f0)}",
      ".af-seg-b:last-child{border-right:none}",
      ".af-seg-b.on{background:var(--teal,#0f766e);color:#fff}",
      ".af-chip{font:700 10px var(--sans);min-height:12px}",
      ".af-chip-ai{color:var(--teal,#0f766e)}",
      ".af-chip-pt{color:#b45309}",
      ".af-chip-you{color:var(--slate-soft,#64748b)}",
      ".af-chip-warn{color:#b91c1c}",
      ".af-actions{display:flex;gap:10px;padding:12px}",
      ".af-save,.af-signoff{flex:1;border-radius:12px;font:800 14px var(--sans);padding:13px;cursor:pointer}",
      ".af-save{border:1.5px solid var(--teal,#0f766e);background:var(--teal-soft,#e3f1ee);color:var(--teal,#0f766e)}",
      ".af-signoff{border:none;background:var(--teal,#0f766e);color:#fff}",
      ".af-note{font:500 11px/1.5 var(--sans);color:var(--slate-soft,#64748b);padding:0 12px}",
      "body.dark .af-bar{background:#0d1b26}body.dark .af-f input,body.dark .af-f select,body.dark .af-f textarea{--panel:#132030;--ink:#e8edf2}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  window.SMD_ASSESSFORM = { mount: mount, renderHTML: renderHTML };
})();
