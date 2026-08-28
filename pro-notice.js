/* StewardMD — "why is this locked?" notice (window.SMD_PRO_NOTICE).
 * ---------------------------------------------------------------------------
 * A Pro feature that stops working without saying why is indistinguishable from a broken app. That
 * is not a hypothetical: functions/api/cases used to carry the comment "client handles 402 silently"
 * — a doctor's cases simply stopped appearing on their second device, with no message anywhere.
 *
 * This is the ONE place that turns "you cannot have this" into a sentence and a button. Every Pro
 * gate should route through it rather than inventing its own toast, because the right sentence is
 * not obvious and got harder on 2026-08-27:
 *
 *   not verified          -> the fix is a CERTIFICATE, not a payment. Sending this doctor to a
 *                            paywall is worse than silence: they pay for something verification
 *                            would have given them free.
 *   review pending        -> nothing to do but wait. Never show them a price.
 *   free week expired     -> now a real paywall is the honest answer.
 *   over quota but IS Pro -> not a Pro problem at all; a limit that resets.
 *
 * Reads the reason from the SERVER (the /api/billing/status payload cached by account.js, or the
 * 402 body of the call that just failed). Never guesses: an unknown reason gets a neutral message
 * and the paywall, which is the old behaviour.
 *
 * API
 *   reason()                  -> "pro" | "unverified" | "pending" | "expired" | "none" | "unknown"
 *   explain(feature, srv)     -> { title, body, cta, act }   (pure; testable)
 *   show(feature, srv)        -> render the dialog
 *   handle(payload, feature)  -> true if this WAS a Pro refusal and it has been explained
 *   gate(feature, fn)         -> run fn() when entitled, otherwise explain instead of no-op
 */
(function () {
  "use strict";

  var ID = "smdProNotice";

  // Human names for the features that can refuse. A key with no entry falls back to "This feature".
  var LABELS = {
    "cloud-sync": "Cross-device case sync",
    "ward-sync": "Ward Sync",
    "lab-watch": "Lab Watch",
    "queue-branding": "Clinic branding",
    "maik": "MaiK clinical AI",
    "labwatch": "Lab Watch",
    "wardsync": "Ward Sync",
    "menu": "This feature",
    "thorex": "ThoreX chest X-ray AI",
    "sknx": "SknX dermatology AI",
    "kardiox": "KardiQ X ECG AI",
    "fundx": "FundX retinal AI"
  };
  function label(f) { return LABELS[f] || "This feature"; }

  function proState() {
    try { return (window.SMD_PRO && window.SMD_PRO.proState && window.SMD_PRO.proState()) || null; } catch (e) { return null; }
  }
  function isPro() {
    try { return !!(window.SMD_PRO && window.SMD_PRO.isProSync && window.SMD_PRO.isProSync()); } catch (e) { return false; }
  }

  /* Normalise the server's vocabulary into the four cases the UI actually branches on.
   * Server sends: reason "unverified" | "verified-week-expired" | "none", plus verified/pendingReview. */
  function normalise(srv) {
    var s = srv || {};
    if (s.pendingReview) return "pending";
    var r = s.reason;
    if (r === "unverified") return "unverified";
    if (r === "verified-week-expired") return "expired";
    if (r === "none") return "none";
    // No reason field at all (an older server, or a payload we did not recognise).
    if (typeof s.verified === "boolean") return s.verified ? "expired" : "unverified";
    return "unknown";
  }

  /** Current entitlement reason for THIS user, from the cached /billing/status payload. */
  function reason() {
    if (isPro()) return "pro";
    var st = proState();
    if (!st) return "unknown";
    return normalise(st);
  }

  /* Pure: what to say and which button to offer. Kept separate from rendering so the wording is
   * unit-testable — the whole point of this module is the wording being right. */
  function explain(feature, srv) {
    var name = label(feature);
    var r = srv ? normalise(srv) : reason();
    var serverMsg = (srv && typeof srv.message === "string" && srv.message) || "";

    if (r === "pending") {
      return {
        kind: r,
        title: name + " is waiting on your verification",
        body: "You have sent us your proof of registration and our team is reviewing it. You keep full access while we do. We will email you as soon as it is approved.",
        cta: "Got it", act: "dismiss"
      };
    }
    if (r === "unverified") {
      return {
        kind: r,
        title: name + " needs a verified registration",
        body: serverMsg || "StewardMD is for registered doctors, so this one is locked until your medical registration is verified. It takes about a minute, and verified doctors get Pro free for 7 days. This is not a payment.",
        cta: "Verify my registration", act: "verify"
      };
    }
    if (r === "expired") {
      return {
        kind: r,
        title: name + " needs Pro",
        body: serverMsg || "Your free Pro week has ended. Your account and your saved work are untouched. Subscribe to switch this back on.",
        cta: "See Pro plans", act: "paywall"
      };
    }
    if (r === "none") {
      return {
        kind: r,
        title: name + " is a Pro feature",
        body: serverMsg || "This one is part of StewardMD Pro. Everything you have saved stays where it is.",
        cta: "See Pro plans", act: "paywall"
      };
    }
    // Unknown: say the honest thing rather than inventing a cause, and still offer a way forward.
    return {
      kind: "unknown",
      title: name + " is not available on this account",
      body: serverMsg || "We could not confirm what this account is entitled to. Check your connection and try again. If it keeps happening, open Account and Verification.",
      cta: "Open account", act: "account"
    };
  }

  // ---- actions -------------------------------------------------------------
  function toast(m) { try { (window.toast || window.SMD_toast || function () {})(m); } catch (e) {} }

  function run(act, feature) {
    if (act === "verify" || act === "account") {
      try { if (window.SMD_VERIFY && window.SMD_VERIFY.openPanel) { window.SMD_VERIFY.openPanel(); return; } } catch (e) {}
      toast("Open Settings, then Account and Verification.");
      return;
    }
    if (act === "paywall") {
      try { if (window.SMD_PRO && window.SMD_PRO.openPaywall) { window.SMD_PRO.openPaywall(feature || "locked"); return; } } catch (e) {}
      toast("Pro plans are loading.");
    }
  }

  // ---- the dialog ----------------------------------------------------------
  function styleOnce() {
    if (document.getElementById(ID + "Css")) return;
    var st = document.createElement("style");
    st.id = ID + "Css";
    st.textContent =
      "#" + ID + "{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;" +
      "justify-content:center;padding:20px;background:rgba(12,20,28,.45);" +
      "font:400 14px/1.5 var(--sans,system-ui,-apple-system,'Segoe UI',sans-serif)}" +
      "#" + ID + " .pn-card{width:100%;max-width:360px;box-sizing:border-box;background:var(--card,#fff);" +
      "color:var(--ink,#14202b);border-radius:18px;padding:22px 20px 16px;box-shadow:0 18px 48px rgba(0,0,0,.3)}" +
      "#" + ID + " h3{margin:0 0 8px;font:700 16px/1.3 inherit}" +
      "#" + ID + " p{margin:0 0 18px;color:var(--slate-soft,#5a7184);font-size:13.5px}" +
      "#" + ID + " .pn-row{display:flex;flex-direction:column;gap:8px}" +
      "#" + ID + " button{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;" +
      "font:700 14px/1 inherit;cursor:pointer;border:1px solid transparent}" +
      "#" + ID + " .pn-go{background:var(--teal,#0e6e63);color:#fff}" +
      "#" + ID + " .pn-no{background:transparent;color:var(--slate-soft,#5a7184);border-color:var(--line,#e2e8f0)}";
    (document.head || document.documentElement).appendChild(st);
  }

  function close() {
    var el = document.getElementById(ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show(feature, srv) {
    var e = explain(feature, srv);
    close();
    styleOnce();
    var wrap = document.createElement("div");
    wrap.id = ID;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", e.title);
    var card = document.createElement("div");
    card.className = "pn-card";
    var h = document.createElement("h3"); h.textContent = e.title;
    var p = document.createElement("p"); p.textContent = e.body;
    var row = document.createElement("div"); row.className = "pn-row";
    var go = document.createElement("button"); go.className = "pn-go"; go.textContent = e.cta;
    go.addEventListener("click", function () { close(); run(e.act, feature); });
    row.appendChild(go);
    if (e.act !== "dismiss") {
      var no = document.createElement("button"); no.className = "pn-no"; no.textContent = "Not now";
      no.addEventListener("click", close);
      row.appendChild(no);
    }
    card.appendChild(h); card.appendChild(p); card.appendChild(row);
    wrap.appendChild(card);
    wrap.addEventListener("click", function (ev) { if (ev.target === wrap) close(); });
    (document.body || document.documentElement).appendChild(wrap);
    try { go.focus(); } catch (x) {}
    return e;
  }

  /* Turn a failed call into an explanation. Accepts the parsed 402 body, or anything carrying
   * needsPro / error:"needs-pro" / "pro_required". Returns true when it WAS a Pro refusal, so a
   * caller can do:  if (SMD_PRO_NOTICE.handle(d, "cloud-sync")) return; */
  function handle(payload, feature) {
    var d = payload || {};
    var isRefusal = !!(d.needsPro || d.error === "needs-pro" || d.error === "pro_required" ||
                       (d.error === "quota" && d.needsPro));
    if (!isRefusal) return false;
    show(feature || d.feature, d);
    return true;
  }

  /** Run fn only when entitled; otherwise explain. Stops a gate from being a silent no-op. */
  function gate(feature, fn) {
    if (isPro()) { try { return fn(); } catch (e) { return undefined; } }
    show(feature);
    return undefined;
  }

  window.SMD_PRO_NOTICE = {
    reason: reason, explain: explain, show: show, close: close,
    handle: handle, gate: gate, label: label, LABELS: LABELS, _normalise: normalise
  };
})();
