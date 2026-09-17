/* wardsynq-alert-ui.js - the screen a WardSynQ critical-result push opens (window.SMD_WSQ_ALERT).
 *
 * S3 P1 (docs/emr-gap-analysis/S3_UNIFIED_WARD_APP_DESIGN.md 2.4, 3.5, 3.6). The server sends a THIN
 * push: a fixed title, a body naming ward and bed, and data {type:"wardsynq-alert", v:"2", nid, kind,
 * urgency}. No patient name, MRN, test or value ever crosses APNs or FCM (owner decision O3).
 *
 * WHAT COMES FROM THE PUSH. parsePush() keeps the nid and the kind and drops everything else, title
 * and body included. Every word this screen shows before the detail loads comes from the KINDS table
 * below, so nothing a push carries can reach the screen. Pinned by test/wsq-push-client.test.mjs.
 *
 * DETAIL AFTER UNLOCK, FOR THIS HOSPITAL ONLY. With app lock set and not yet passed, the screen sits
 * under the lock and fetches nothing. After it, GET /api/push/notice/<nid> is sent with the credential
 * of the hospital this phone is working in (hospital-auth.js) and that hospital's id (?orgId=). The server
 * answers 404 for a notice from any other hospital before reading it or logging a read, so the detail of
 * another hospital's alert never reaches this phone. If a server ever answers one anyway, the patient and
 * result are dropped unshown and the screen asks to switch (parity EMR-05). No hospital chosen: no request.
 *
 * THE ANSWERS.
 *   Acknowledge          POST /api/queue/ward/acknowledge {orgId, loopId, action}. Human, with the
 *                        sentence saying what was done. Success is a written record, nothing less.
 *   I cannot attend      POST /api/push/notice/<nid>/decline: the next level is alerted now.
 *   I informed the doctor  offered only after the acknowledgement is refused for this role: a
 *                        receipt (kind "informed") that leaves the result open.
 * A failed load or send says so and keeps the screen; nothing here reports success it did not get.
 *
 * NOT DISMISSABLE BY ACCIDENT. No timeout, no tap-outside, Escape swallowed, the back gesture and the
 * Android back button swallowed (swipe-back.js returns early while #wsq-alert exists). Close appears
 * only once the alert is answered, or when it cannot be opened here, and says the result is still
 * escalating.
 *
 * Inert unless smd_wsq_push is on (wardsynq-flags.js). STATUS: IMPLEMENTED. NOT clinically validated.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var PUSH_API = "/api/push", QUEUE_API = "/api/queue";

  var KINDS = {
    critical: { tag: "CRITICAL RESULT", title: "Urgent result" },
    deterioration: { tag: "PATIENT NEEDS REVIEW", title: "Patient needs review" },
    sepsis: { tag: "SEPSIS ALERT", title: "Sepsis alert" },
    bundle: { tag: "CARE BUNDLE DUE", title: "Care bundle due" },
    test: { tag: "TEST ALERT", title: "Test alert" }
  };
  var LEVEL_WORDS = { due: "First alert", overdue: "Overdue: not acknowledged in time", escalate: "Escalated to the hospital's named contacts" };
  var NO_WORKPLACE = "Choose the hospital you are working in on this phone, then try again. The alert opens only in the hospital it was sent from.";
  var STILL_OPEN = "The result stays open on the critical results board and keeps escalating until someone acknowledges it.";

  var st = null;   // the alert on screen; one at a time, deliberately

  function flagOn() { try { return !!(G.SMD_WARDSYNQ_FLAGS && G.SMD_WARDSYNQ_FLAGS.get("smd_wsq_push")); } catch (e) { return false; } }
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function api(p) { return (G.SMD_API_BASE || "") + p; }
  function HA() { return G.SMD_HOSPITAL_AUTH || null; }

  /** PURE. The push reduced to what this screen may use, or null when it is not a v2 WardSynQ alert. */
  function parsePush(d) {
    if (!d || d.type !== "wardsynq-alert" || String(d.v) !== "2") return null;
    var nid = String(d.nid || "");
    if (!/^[0-9a-f]{32}$/.test(nid)) return null;
    return { nid: nid, kind: Object.prototype.hasOwnProperty.call(KINDS, d.kind) ? d.kind : "critical" };
  }

  /** -> Promise<{status, body}>. status 0 is "never reached the server". Never rejects. */
  function send(method, path, orgId, body) {
    var ha = HA();
    if (!ha) return Promise.resolve({ status: 0, body: { error: "auth_module_missing" } });
    return ha.headersFor(orgId).then(function (h) {
      var o = { method: method, headers: h, credentials: "include" };
      if (body !== undefined) o.body = JSON.stringify(body);
      return fetch(api(path), o);
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j || {} }; }, function () { return { status: r.status, body: {} }; });
    }, function () { return { status: 0, body: { error: "network" } }; });
  }

  function receipt(nid, kind, orgId) { return send("POST", PUSH_API + "/wardsynq-receipt", orgId, { noticeId: nid, kind: kind }); }

  /** The handset has the push. Sent with this workplace's credential and, if that is refused, with the
   * account alone: the push does not say which hospital it is from. Best effort; the server's SMS
   * fallback is what covers a receipt that never arrives. */
  function delivered(data) {
    if (!flagOn()) return;
    var p = parsePush(data), ha = HA();
    if (!p || !ha) return;
    var org = ha.currentOrg();
    receipt(p.nid, "delivered", org).then(function (r) { if (r.status !== 200 && org) receipt(p.nid, "delivered", ""); });
  }

  // ---- pure render ------------------------------------------------------------------------------
  function when(iso) {
    if (!iso) return "not recorded";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function btn(act, cls, label, disabled) { return '<button type="button" class="' + cls + '" data-wsq-act="' + act + '"' + (disabled ? " disabled" : "") + ">" + esc(label) + "</button>"; }
  function line(cls, text) { return '<p class="' + cls + '">' + esc(text) + "</p>"; }

  /** PURE. The whole screen for a state. */
  function view(s) {
    var k = KINDS[s.kind] || KINDS.critical;
    var h = '<div class="wrap"><span class="tag">' + esc(k.tag) + '</span><h1 id="wsq-alert-h">' + esc(k.title) + "</h1>";
    if (s.phase === "locked") {
      h += line("who", "Unlock StewardMD to see this alert.") + btn("unlock", "take", "Unlock to view");
    } else if (s.phase === "loading") {
      h += line("who", "Loading the alert.");
    } else if (s.phase === "failed") {
      h += line("state err", s.err) + line("note", STILL_OPEN) + btn("retry", "take", "Try again") + btn("close", "cannot", "Close");
    } else if (s.phase === "switch") {
      var hosp = (s.other && s.other.hospital) || "another hospital";
      h += line("who", "This alert is from " + hosp + ", not the hospital this phone is working in.") +
        line("note", "Switch to " + hosp + " to open it. Nothing about the patient is shown until you do.") +
        btn("switch", "take", "Switch to " + hosp) + btn("close", "cannot", "Not now") + line("note", STILL_OPEN);
    } else if (s.phase === "detail") {
      var n = s.notice || {}, pt = n.patient || {}, loc = n.location || {}, res = n.result || {};
      var where = [loc.ward && "Ward " + loc.ward, loc.bed && "bed " + loc.bed].filter(Boolean).join(", ") || "Not recorded";
      var result = [res.display || res.code, res.value, res.unit].filter(function (x) { return x != null && x !== ""; }).join(" ") || "Not recorded";
      h += line("who", (pt.name || "Name not recorded") + (pt.mrn ? ", MRN " + pt.mrn : "")) +
        "<dl><dt>Where</dt><dd>" + esc(where) + "</dd>" +
        "<dt>Result</dt><dd>" + esc(result) + "</dd>" +
        "<dt>Reported</dt><dd>" + esc(when(n.reportedAt)) + "</dd>" +
        "<dt>Hospital</dt><dd>" + esc(n.hospital || "") + "</dd>" +
        "<dt>Alert</dt><dd>" + esc(LEVEL_WORDS[n.level] || n.level || "") + "</dd></dl>" +
        (n.state && n.state !== "open" ? line("note", "Already acknowledged by someone. You can still record what you did.") : "") +
        '<label for="wsq-action">What did you do about this result?</label>' +
        '<textarea id="wsq-action" rows="3" maxlength="500">' + esc(s.action || "") + "</textarea>" +
        '<p class="state' + (s.err ? " err" : "") + '" id="wsq-alert-state" role="status" aria-live="polite">' + esc(s.err || s.msg || "") + "</p>" +
        btn("ack", "take", "Acknowledge", s.busy) + btn("decline", "cannot", "I cannot attend", s.busy) +
        (s.canInform ? btn("inform", "cannot", "I have informed the doctor", s.busy) : "") +
        line("note", "Acknowledging records that you have taken this result and what you did. It is not a review.");
    } else if (s.phase === "done") {
      h += line("who", s.done) + btn("close", "take", "Close");
    }
    return h + "</div>";
  }

  // ---- failure words ------------------------------------------------------------------------------
  function loadFailure(r) {
    var b = r.body || {};
    if (r.status === 0) return "Could not reach the server. Check the connection and try again.";
    if (r.status === 401) return "No hospital sign-in on this phone could open this alert. Sign in to your hospital, then try again.";
    if (r.status === 404) return "This alert could not be opened with the sign-in in use here. If you work at more than one hospital, switch to the one it was sent from and try again.";
    return "The alert could not be loaded: " + (b.detail || b.message || b.error || "the server answered " + r.status) + ".";
  }
  function writeFailure(r, what) {
    var b = r.body || {};
    if (r.status === 0) return "Could not reach the server. " + what + " was not recorded. Try again.";
    if (r.status === 401) return "Your sign-in has ended. " + what + " was not recorded. Sign in again.";
    if (r.status === 403) return "Your role cannot acknowledge a result. Tell the doctor, then record that you did.";
    if (b.ok && b.skipped) return "The hospital record is not switched on, so " + what.toLowerCase() + " was not recorded.";
    return what + " was not recorded: " + (b.detail || b.message || b.error || "the server answered " + r.status) + ".";
  }

  // ---- controller --------------------------------------------------------------------------------
  function paint() {
    var el = document.getElementById("wsq-alert");
    if (!el || !st) return;
    el.className = st.phase === "locked" ? "locked" : "";
    el.innerHTML = view(st);
    var f = el.querySelector("button:not([disabled])");
    if (f && st.phase !== "detail") f.focus();
  }

  function load() {
    var s = st, ha = HA();
    if (!s) return;
    s.phase = "loading"; s.err = ""; paint();
    var org = ha ? ha.currentOrg() : "";
    // The server releases the detail only for the hospital named here, so with none chosen there is nothing to ask.
    if (!org) { s.phase = "failed"; s.err = NO_WORKPLACE; paint(); return; }
    ha.authReady(8000).then(function () {
      return send("GET", PUSH_API + "/notice/" + s.nid + "?orgId=" + encodeURIComponent(org), org);
    }).then(function (r) {
      if (st !== s) return;
      var n = r.body && r.body.notice;
      if (r.status === 200 && r.body.ok && n) {
        if (String(n.orgId) !== org) {
          // Another hospital's alert: keep only which hospital, never the patient or the result.
          s.other = { orgId: String(n.orgId || ""), hospital: String(n.hospital || "") };
          s.phase = "switch"; paint();
          return;
        }
        s.notice = n; s.phase = "detail"; paint();
        receipt(s.nid, "viewed", org);
        return;
      }
      s.phase = "failed"; s.err = loadFailure(r); paint();
    });
  }

  function gate() {
    var L = G.SMD_APPLOCK, locked = false;
    try { locked = !!(L && L.required && L.required()); } catch (e) { locked = false; }
    if (!locked) { load(); return; }
    st.phase = "locked"; paint();
    try { L.unlock(function () { if (st && st.phase === "locked") load(); }); } catch (e) { /* stays locked; "Unlock to view" retries */ }
  }

  function switchTo() {
    var o = st && st.other;
    if (!o || !o.orgId) return;
    try { G.localStorage.setItem("smd_opd_workplace", "wardsynq:" + o.orgId); } catch (e) {}
    try { if (G.WARD && G.WARD.close) G.WARD.close(); } catch (e) {}
    try { if (G.SMD_WSQ_PUSH && G.SMD_WSQ_PUSH.bind) G.SMD_WSQ_PUSH.bind(o.orgId, true); } catch (e) {}
    st.other = null;
    load();
  }

  function answer(path, body, onOk, what, inform) {
    var s = st;
    s.busy = true; s.err = ""; s.msg = "Recording."; paint();
    var p = inform ? receipt(s.nid, "informed", s.notice.orgId) : send("POST", path, s.notice.orgId, body);
    p.then(function (r) {
      if (st !== s) return;
      s.busy = false; s.msg = "";
      var done = onOk(r);
      if (done) { s.phase = "done"; s.done = done; }
      else { if (r.status === 403 && !inform) s.canInform = true; s.err = writeFailure(r, what); }
      paint();
    });
  }

  function acknowledge() {
    var s = st, box = document.getElementById("wsq-action");
    if (box) s.action = box.value;
    var action = String(s.action || "").trim();
    if (!action) { s.err = "Write what you did about this result. The acknowledgement records it."; paint(); return; }
    answer(QUEUE_API + "/ward/acknowledge", { orgId: s.notice.orgId, loopId: s.notice.loopId, action: action }, function (r) {
      var b = r.body || {};
      if (r.status === 200 && b.ok && b.written === 1) return "Acknowledged. What you did is recorded on the result, and the alerts for it stop.";
      if (b.error === "already_closed") return "This result had already been closed by someone else. Nothing was recorded from you.";
      return "";
    }, "Your acknowledgement");
  }
  function decline() {
    answer(PUSH_API + "/notice/" + st.nid + "/decline", {}, function (r) {
      var b = r.body || {};
      if (b.error === "loop_not_open") return "This result has already been acknowledged, so there is nothing to pass on.";
      if (r.status !== 200 || !b.ok) return "";
      if (b.duplicate) return "You had already said you cannot attend.";
      return b.escalatedTo ? "Passed on. The next people on the escalation ladder have been alerted." : ("Recorded that you cannot attend. " + (b.detail || "")).trim();
    }, "That you cannot attend");
  }
  function inform() {
    answer(null, null, function (r) {
      return r.status === 200 && r.body && r.body.ok ? "Recorded that you informed the doctor. The result stays open until a doctor acknowledges it." : "";
    }, "That you informed the doctor", true);
  }

  function onClick(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("[data-wsq-act]") : null;
    if (!b || !st || b.disabled) return;
    var a = b.getAttribute("data-wsq-act");
    if (a === "unlock") { try { G.SMD_APPLOCK.unlock(function () { if (st && st.phase === "locked") load(); }); } catch (e) {} return; }
    if (a === "retry") { load(); return; }
    if (a === "switch") { switchTo(); return; }
    if (a === "close") { close(); return; }
    if (st.phase !== "detail" || st.busy) return;
    if (a === "ack") acknowledge();
    else if (a === "decline") decline();
    else if (a === "inform") inform();
  }
  function onInput(ev) { if (st && ev.target && ev.target.id === "wsq-action") st.action = ev.target.value; }
  function trap(ev) {
    var el = document.getElementById("wsq-alert");
    if (!el) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); return; }
    if (ev.key !== "Tab") return;
    var f = el.querySelectorAll("button:not([disabled]), textarea");
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  function styles() {
    if (document.getElementById("wsq-alert-style")) return;
    var s = document.createElement("style");
    s.id = "wsq-alert-style";
    s.textContent = [
      "#wsq-alert{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:stretch;justify-content:center;overflow:auto;",
      "  background:#0b1220;color:#fff;font:400 16px/1.45 -apple-system,system-ui,sans-serif;",
      "  padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));}",
      /* Under app lock (2147483000) while it is up, so the lock is what the clinician sees first. */
      "#wsq-alert.locked{z-index:2147482500;}",
      "#wsq-alert .wrap{margin:auto;width:100%;max-width:520px;}",
      "#wsq-alert .tag{display:inline-block;background:#b3122b;color:#fff;font-weight:700;font-size:12.5px;letter-spacing:.06em;padding:5px 10px;border-radius:4px;}",
      "#wsq-alert h1{font-size:23px;line-height:1.25;margin:14px 0 6px;font-weight:650;}",
      "#wsq-alert .who{font-size:17px;font-weight:600;color:#ffd9df;margin:0 0 18px;}",
      "#wsq-alert dl{margin:0 0 16px;padding:14px 16px;border:1px solid #2c3a52;border-radius:10px;}",
      "#wsq-alert dt{font-size:12.5px;color:#9fb0c9;margin:0;}",
      "#wsq-alert dd{margin:2px 0 12px;font-size:16px;color:#fff;}",
      "#wsq-alert dd:last-of-type{margin-bottom:0;}",
      "#wsq-alert label{display:block;font-size:14px;color:#9fb0c9;margin:0 0 6px;}",
      "#wsq-alert textarea{box-sizing:border-box;width:100%;font:inherit;border-radius:10px;border:1px solid #5b6c88;background:#111a2b;color:#fff;padding:10px 12px;}",
      "#wsq-alert button{display:block;width:100%;min-height:52px;border-radius:10px;font-size:16.5px;font-weight:650;border:1px solid transparent;margin-top:10px;cursor:pointer;}",
      "#wsq-alert button[disabled]{opacity:.55;}",
      "#wsq-alert .take{background:#fff;color:#0b1220;}",
      "#wsq-alert .cannot{background:transparent;color:#fff;border-color:#5b6c88;font-weight:550;}",
      "#wsq-alert .note{font-size:13.5px;color:#9fb0c9;margin:16px 0 0;}",
      "#wsq-alert .state{font-size:14px;margin:12px 0 0;min-height:1.2em;color:#ffd9df;}",
      "#wsq-alert .state.err{color:#ffb4bf;font-weight:600;}"
    ].join("");
    document.head.appendChild(s);
  }

  function close() {
    var el = document.getElementById("wsq-alert");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.removeEventListener("keydown", trap, true);
    st = null;
  }

  /** Opens the screen for a v2 push. true when it took the push, false to let the caller show it plainly. */
  function handle(data) {
    if (!flagOn()) return false;
    var p = parsePush(data);
    if (!p) return false;
    if (st && st.nid === p.nid) return true;
    if (st) close();
    st = { nid: p.nid, kind: p.kind, phase: "locked", notice: null, other: null, err: "", msg: "", done: "", action: "", busy: false, canInform: false };
    styles();
    var el = document.createElement("div");
    el.id = "wsq-alert";
    el.setAttribute("role", "alertdialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "wsq-alert-h");
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    document.body.appendChild(el);
    document.addEventListener("keydown", trap, true);
    gate();
    return true;
  }

  G.SMD_WSQ_ALERT = { handle: handle, delivered: delivered, parsePush: parsePush, view: view, KINDS: KINDS, _state: function () { return st; }, _close: close };
})();
