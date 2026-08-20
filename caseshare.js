/* StewardMD — shareable case codes (Firestore-backed, free tier).
   window.CASESHARE.shareCurrent() : signed-in user → unique code (SMD-XXXXX) + link, case stored in
   Firestore sharedCases/{code} with 30-day expiry. window.CASESHARE.openPrompt() : retrieve by code.
   ?case=CODE links auto-open. Requires Firestore security rules (see deploy notes) — author cannot
   configure those from here. No PHI: shares the clinical findings + decision only. */
(function () {
  "use strict";
  var COLL = "sharedCases";
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;            // 30 days
  var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L ambiguity
  var root = null;

  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function toast(m){ try { injectCSS(); } catch(e){} var t=document.getElementById("cs-toast"); if(!t){t=document.createElement("div");t.id="cs-toast";t.className="cs-toast";document.body.appendChild(t);} t.textContent=m; t.classList.add("on"); clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove("on");},2600); }

  // SECURITY: shared-case html comes from Firestore (publicly readable, writable by
  // any signed-in user) — treat it as UNTRUSTED. Allowlist-sanitize before any
  // innerHTML: drop dangerous tags, all on* handlers, and javascript:/data: URLs.
  // Fails closed (returns "") so a parse error can never inject raw markup.
  var CS_BAD_TAGS = { SCRIPT:1,IFRAME:1,OBJECT:1,EMBED:1,LINK:1,META:1,BASE:1,FORM:1,SVG:1,MATH:1,FRAME:1,FRAMESET:1,APPLET:1,STYLE:1,AUDIO:1,VIDEO:1,SOURCE:1,TEMPLATE:1,PORTAL:1 };
  function sanitizeHTML(dirty){
    try {
      var tpl = document.createElement("template");
      tpl.innerHTML = String(dirty == null ? "" : dirty);
      var w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null, false);
      var rm = [], node;
      while ((node = w.nextNode())) {
        // SVG/MathML elements report a lowercase tagName (non-HTML namespace) — normalise.
        if (CS_BAD_TAGS[String(node.tagName).toUpperCase()]) { rm.push(node); continue; }
        for (var i = node.attributes.length - 1; i >= 0; i--) {
          var a = node.attributes[i], n = a.name.toLowerCase(), v = String(a.value || "");
          if (n.indexOf("on") === 0 || n === "srcset" || n === "formaction") node.removeAttribute(a.name);
          else if ((n === "href" || n === "src" || n === "xlink:href" || n === "action") && /^\s*(?:javascript|data|vbscript):/i.test(v)) node.removeAttribute(a.name);
          else if (n === "style" && /expression|javascript:|@import|url\s*\(/i.test(v)) node.removeAttribute(a.name);
        }
      }
      rm.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
      return tpl.innerHTML;
    } catch (e) { return ""; }
  }

  function genCode(){
    var s = "", n = ALPHABET.length, buf = null;
    try { var c = window.crypto || window.msCrypto; if (c && c.getRandomValues) { buf = new Uint32Array(7); c.getRandomValues(buf); } } catch (e) { buf = null; }
    for (var i=0;i<7;i++){ var r = buf ? buf[i] : Math.floor(Math.random()*n); s += ALPHABET.charAt(r % n); }
    return "SMD-"+s;
  }
  function normCode(c){ c=String(c||"").trim().toUpperCase().replace(/\s+/g,""); if(c && c.indexOf("SMD-")!==0 && /^[A-Z0-9]{5,8}$/.test(c)) c="SMD-"+c; return c; }

  // Ensure Firebase/Firestore is loaded (it is lazy-loaded), then run cb(db) or cb(null) on failure.
  // Load Firebase (lazy) AND wait for auth state to settle, then cb(db, user).
  // (Fixes the race where currentUser is briefly null right after lazy Firebase load.)
  // Resolve Firestore/Auth directly from firebase (recovers if SMD_DB/SMD_AUTH weren't cached by boot).
  function getDb(){ try { if (window.SMD_DB) return window.SMD_DB; if (window.firebase && firebase.firestore) return firebase.firestore(); } catch (e) { try { console.error("[CASESHARE] firestore() error:", e && e.message); } catch (x) {} } return null; }
  function getAuth(){ try { if (window.SMD_AUTH) return window.SMD_AUTH; if (window.firebase && firebase.auth) return firebase.auth(); } catch (e) {} return null; }
  function ensureReady(cb){
    function withAuth(){
      var auth = getAuth();
      if (!auth) return cb(getDb(), null);
      if (auth.currentUser) return cb(getDb(), auth.currentUser);
      var done = false, unsub;
      function fin(u){ if (done) return; done = true; try { unsub && unsub(); } catch (e) {} cb(getDb(), u || null); }
      try { unsub = auth.onAuthStateChanged(function (u) { fin(u); }); } catch (e) { return cb(getDb(), auth.currentUser || null); }
      setTimeout(function () { fin(auth.currentUser); }, 4000);
    }
    if (window.firebase) return withAuth();              // firebase already loaded → resolve directly
    if (window.SMD_loadFirebase) window.SMD_loadFirebase(withAuth);
    else withAuth();
  }

  // ---- capture the current on-screen clinical decision ----
  function currentSnapshot(){
    var out = document.getElementById("outputArea");
    if (!out || !out.children.length) return null;
    var clone = out.cloneNode(true);
    var rm = clone.querySelector("#smdCaseShare"); if (rm) rm.remove();   // strip our own share bar
    var title = "";
    var h = clone.querySelector("h2,.qa-header,.score-card-head,.quick-answer-card");
    if (h) title = (h.textContent||"").trim().slice(0,80);
    return { html: clone.innerHTML, text: (clone.innerText||clone.textContent||"").trim().slice(0,4000), title: title || "Clinical decision" };
  }

  // PHI guard: shared docs are PUBLIC by code, so block a share that contains a high-precision
  // patient identifier. Deliberately narrow (MRN/UHID/phone/Aadhaar/email/labelled name) to avoid
  // false-positives on clinical text (eponyms, drug names). Advisory-only; no medical-logic change.
  function phiScan(str){
    var s = String(str || "");
    var checks = [
      [/\b(?:mrn|uhid|uid|(?:ip|op|reg|regn|registration|hosp|hospital)\s*\.?\s*(?:no|number))[:#.\s-]*[a-z0-9]*\d/i, "hospital/MRN number"],
      [/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/, "phone number"],
      [/\b\d{4}\s?\d{4}\s?\d{4}\b/, "12-digit ID (Aadhaar)"],
      [/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i, "email address"],
      // Labelled patient name — the doc is PUBLIC by code, so block an explicit patient-name
      // label (e.g. "Patient: John Doe", "Pt - Jane R", "Patient's name: …"). Requires a PATIENT
      // context word so clinical text like "drug name:"/"study name:" is not falsely blocked.
      [/\b(?:patient(?:'?s)?(?:\s*name)?|\bpt)\s*[:#.\-]\s*[a-z][a-z.'-]+(?:\s+[a-z][a-z.'-]+)+/i, "labelled patient name"]
    ];
    for (var i = 0; i < checks.length; i++) if (checks[i][0].test(s)) return checks[i][1];
    return null;
  }
  // De-identify for a PUBLIC share: instead of blocking, STRIP any detected identifier
  // from the shared copy so the case can always be shared safely. High-precision IDs
  // (MRN/phone/Aadhaar/email) are removed whole; a labelled patient name keeps its label
  // but the name tokens are redacted. Clinical text is otherwise untouched.
  function phiRedact(str){
    var s = String(str || "");
    s = s.replace(/\b(?:mrn|uhid|uid|(?:ip|op|reg|regn|registration|hosp|hospital)\s*\.?\s*(?:no|number))[:#.\s-]*[a-z0-9]*\d[a-z0-9]*/ig, "[ID removed]");
    s = s.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, "[phone removed]");
    s = s.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[ID removed]");
    s = s.replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/ig, "[email removed]");
    s = s.replace(/\b(patient(?:'?s)?(?:\s*name)?|pt)(\s*[:#.\-]\s*)([a-z][a-z.'-]+(?:\s+[a-z][a-z.'-]+)+)/ig, "$1$2[name removed]");
    return s;
  }

  // ---- create a share ----
  // Native fallback: share the case as plain text via the iOS share sheet.
  function nativeShareText(snap){
    if (window.SMD_NATIVE && window.SMD_NATIVE.share) {
      window.SMD_NATIVE.share({ title: (snap && snap.title) || "StewardMD — Clinical decision", text: (snap && snap.text) || "", dialogTitle: "Share case" }).catch(function () { toast("Share unavailable"); });
    } else { toast("Share unavailable"); }
  }
  function shareCurrent(){
    try { console.log("[CASESHARE] shareCurrent: DB=", !!window.SMD_DB, "AUTH=", !!window.SMD_AUTH, "user=", !!(window.SMD_AUTH && window.SMD_AUTH.currentUser)); } catch (e) {}
    var snap = currentSnapshot();
    if (!snap) { toast("Generate a clinical decision first."); return; }
    var _phi = phiScan((snap.text || "") + " " + (snap.title || ""));
    if (_phi) {
      snap.text = phiRedact(snap.text || "");
      snap.title = phiRedact(snap.title || "");
      if (snap.html) snap.html = phiRedact(snap.html);
      toast("Removed patient identifiers (" + _phi + ") before sharing — links are PUBLIC.");
    }
    toast("Preparing share…");
    ensureReady(function(db, user){
      if (!db) { try { console.error("[CASESHARE] no DB. firebase=", !!window.firebase, "firebase.firestore=", !!(window.firebase && window.firebase.firestore), "SMD_DB=", !!window.SMD_DB); } catch (e) {} toast("Cloud unavailable — reload once & try again."); return; }
      if (!user) {
        // Native guest: try an anonymous Firebase identity so we can create a REAL cloud
        // share LINK (identical to signed-in sharing). If anonymous auth is not enabled
        // in the Firebase console (or is blocked), fall back to sharing the case TEXT via
        // the iOS share sheet. Web keeps the sign-in gate. PHI already scanned above.
        if (window.SMD_IS_NATIVE) {
          var auth = getAuth();
          if (auth && auth.signInAnonymously) {
            toast("Creating share link…");
            auth.signInAnonymously().then(function (cred) {
              var u = (cred && cred.user) || auth.currentUser;
              if (u) doShare(snap, db, u); else nativeShareText(snap);
            }).catch(function () { nativeShareText(snap); });
            return;
          }
          nativeShareText(snap); return;
        }
        toast("Please sign in with Google first (More ▸ Account & sign-in) to share."); return;
      }
      doShare(snap, db, user);
    });
  }
  // Monthly share cap (100/mo) — client-side counter per month; subscription tiers planned later.
  var MONTHLY_LIMIT = 100;
  function monthKey(){ var d = new Date(); return "smd_shares_" + d.getFullYear() + "_" + (d.getMonth() + 1); }
  function sharesThisMonth(){ try { return parseInt(localStorage.getItem(monthKey()) || "0", 10) || 0; } catch (e) { return 0; } }
  function bumpShares(){ try { localStorage.setItem(monthKey(), String(sharesThisMonth() + 1)); } catch (e) {} }
  // Also store the shared case in the sharer's My Cases (Firestore users/{uid}/cases).
  function saveToMyCases(db, user, code, snap, name){
    try {
      var c = { id: code, name: snap.title || "Shared case", syndrome: snap.title || "",
                notes: "Shared · code " + code, savedAt: Date.now(), savedAtStr: new Date().toLocaleString(),
                shared: true, sharedCode: code, sharedByName: name || "", sharedByEmail: (user && user.email) || "" };
      db.collection("users").doc(user.uid).collection("cases").doc(code).set(c);
    } catch (e) {}
  }
  // When a SIGNED-IN user OPENS a shared case, keep a copy in THEIR cloud account
  // (users/{uid}/cases/{code}) so it persists in My Cases, keyed by the unique code.
  // Stored html is sanitised; merge:true avoids clobbering an existing entry.
  function autosaveOpened(dbIgnored, code, rec){
    // Resolve auth THROUGH ensureReady so a just-loaded Firebase (currentUser
    // still settling) doesn't cause us to silently skip the My-Cases copy.
    ensureReady(function (db, u) {
      if (!u || !db) return;
      try {
        var c = { id: code, name: rec.title || "Shared case", syndrome: rec.title || "",
                  notes: "Opened shared case · " + code, savedAt: Date.now(), savedAtStr: new Date().toLocaleString(),
                  shared: true, openedShared: true, sharedCode: code, sharedByName: rec.ownerName || "",
                  text: rec.text || "", html: sanitizeHTML(rec.html || "") };
        db.collection("users").doc(u.uid).collection("cases").doc(code).set(c, { merge: true });
      } catch (e) {}
    });
  }
  function doShare(snap, db, user){
    if (sharesThisMonth() >= MONTHLY_LIMIT) { toast("Monthly share limit reached (" + MONTHLY_LIMIT + "/mo). Higher limits are coming with subscription plans."); return; }
    var code = genCode();
    var now = Date.now();
    var name = (user.displayName) || ((user.email || "").split("@")[0]) || "Clinician";
    // NOTE: this doc is PUBLICLY readable by code — do NOT store the owner's email
    // (PII leak). Keep display name only; email stays in the private My Cases copy.
    var rec = { v:1, code:code, title:snap.title, html:snap.html, text:snap.text,
                ownerUid:user.uid, ownerName:name, createdAt:now, expiresAt: now + TTL_MS };
    db.collection(COLL).doc(code).set(rec)
      .then(function(){ bumpShares(); saveToMyCases(db, user, code, snap, name); showResult(code); })
      .catch(function(e){ try { console.error("[CASESHARE] share failed:", e); } catch (x) {} toast("Share failed: " + ((e && e.code) || (e && e.message) || "error")); });
  }
  function friendly(e){ var m=(e&&e.message)||""; if(/permission|insufficient/i.test(m)) return "Firestore rules not set yet (see setup)."; return m.slice(0,80) || "error"; }

  // ---- retrieve a share ----
  function open(code){
    code = normCode(code);
    if (!/^SMD-[A-Z0-9]{5,8}$/.test(code)) { toast("Enter a valid code like SMD-7K2Q9."); return; }
    ensureReady(function(db){
      if (!db) { toast("Cloud unavailable — check your connection."); return; }
      db.collection(COLL).doc(code).get().then(function(d){
        if (!d || !d.exists) { toast("Case " + code + " not found."); return; }
        var rec = d.data();
        if (rec.expiresAt && rec.expiresAt < Date.now()) { toast("This shared case has expired (30-day limit)."); return; }
        showViewer(rec, code);
        autosaveOpened(db, code, rec);   // keep a copy in the opener's cloud account
      }).catch(function(e){
        // expiry is now enforced server-side: an expired/missing share fails the read
        var m = (e && (e.code || e.message)) || "";
        if (/permission|insufficient|denied/i.test(m)) { toast("Case " + code + " not found or expired."); return; }
        toast("Could not open — " + friendly(e));
      });
    });
  }

  // ---- UI ----
  function injectCSS(){
    if (document.getElementById("cs-css")) return;
    var st=document.createElement("style"); st.id="cs-css";
    st.textContent = [
      ".cs-ov{--bg:#F4F6F9;--panel:#fff;--ink:#0F172A;--mut:#64748B;--line:#E2E8F0;--tl:#0F766E;--f:'Inter',-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:945;background:rgba(15,23,42,.42);display:none;align-items:flex-end;justify-content:center;font-family:var(--f)}",
      ".cs-ov.on{display:flex}",
      "body.dark .cs-ov,body.v3-dark .cs-ov{--bg:#0B1220;--panel:#111B2E;--ink:#E7EDF5;--mut:#8597AD;--line:#1E2B43;--tl:#2DD4BF}",
      ".cs-card{background:var(--bg);color:var(--ink);width:100%;max-width:560px;max-height:92vh;border-radius:20px 20px 0 0;display:flex;flex-direction:column;overflow:hidden}",
      "@media(min-width:560px){.cs-ov{align-items:center}.cs-card{border-radius:20px;max-height:88vh}}",
      ".cs-head{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel)}",
      ".cs-head h3{font:800 16px var(--f);margin:0;flex:1}",
      ".cs-x{border:none;background:none;font:700 22px var(--f);color:var(--mut);cursor:pointer;line-height:1}",
      ".cs-body{padding:18px;overflow-y:auto}",
      ".cs-code{font:800 30px var(--f);letter-spacing:.06em;color:var(--tl);text-align:center;margin:6px 0 4px}",
      ".cs-sub{font:500 13px var(--f);color:var(--mut);text-align:center;margin-bottom:16px}",
      ".cs-row{display:flex;gap:8px;margin-bottom:10px}",
      ".cs-row input{flex:1;border:1px solid var(--line);border-radius:12px;padding:13px 14px;font:700 16px var(--f);background:var(--panel);color:var(--ink);text-transform:uppercase}",
      ".cs-btn{border:none;border-radius:12px;background:var(--tl);color:#fff;font:700 14px var(--f);padding:13px 16px;cursor:pointer}",
      ".cs-btn.sec{background:var(--panel);color:var(--tl);border:1px solid var(--line)}",
      ".cs-note{font:500 11.5px/1.55 var(--f);color:var(--mut);margin-top:8px}",
      ".cs-viewer{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;font:400 14px/1.55 var(--f)}",
      ".cs-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%) translateY(10px);background:#0F172A;color:#fff;font:600 13px var(--f);padding:11px 18px;border-radius:12px;z-index:970;opacity:0;transition:.2s;pointer-events:none;max-width:90vw;text-align:center}.cs-toast.on{opacity:1;transform:translateX(-50%)}"
    ].join("\n");
    document.head.appendChild(st);
  }
  function overlay(){ injectCSS(); if(!root){ root=document.createElement("div"); root.className="cs-ov"; root.id="csOverlay"; document.body.appendChild(root); root.addEventListener("click",function(e){ if(e.target===root) close(); }); } return root; }
  function close(){ if(root) root.classList.remove("on"); }
  function show(html){ var o=overlay(); o.innerHTML='<div class="cs-card">'+html+'</div>'; o.classList.add("on"); var x=o.querySelector("[data-cs-x]"); if(x)x.addEventListener("click",close); }

  function showResult(code){
    // On native the origin is https://localhost (no backend) → build a real web link.
    var link = (window.SMD_IS_NATIVE ? "https://stewardmd.in" : location.origin) + "/?case=" + code;
    show('<div class="cs-head"><h3>📤 Case shared</h3><button class="cs-x" data-cs-x aria-label="Close">×</button></div>'
       + '<div class="cs-body"><div class="cs-code">'+esc(code)+'</div>'
       + '<div class="cs-sub">Anyone with this code (or link) can open this case for 30 days. <b>Do not include patient identifiers (name, MRN, contact).</b></div>'
       + '<div class="cs-row"><button class="cs-btn" id="csCopyCode">Copy code</button><button class="cs-btn sec" id="csCopyLink">Copy link</button><button class="cs-btn sec" id="csShareLink">Share…</button></div>'
       + '<div class="cs-note">Saved to your account. This link is <b>public to anyone with the code</b> and shares the clinical decision only — never include patient names, MRN/UHID, phone, email or ID numbers. Decision support only.</div></div>');
    var o=overlay();
    o.querySelector("#csCopyCode").addEventListener("click", function(){ copy(code, "Code copied"); });
    o.querySelector("#csCopyLink").addEventListener("click", function(){ copy(link, "Link copied"); });
    o.querySelector("#csShareLink").addEventListener("click", function(){ if(window.SMD_IS_NATIVE && window.SMD_NATIVE){ window.SMD_NATIVE.share({title:"StewardMD case "+code, text:"Open StewardMD case "+code+"\n"+link, url:link}).catch(function(){ copy(link,"Link copied"); }); return; } try { if(navigator.share){ navigator.share({title:"StewardMD case "+code, text:"Open StewardMD case "+code, url:link}).catch(function(){}); } else copy(link,"Link copied"); } catch(e){ copy(link,"Link copied"); } });
  }
  function copy(t,msg){ try { if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t); toast(msg); return; } } catch(e){} toast(t); }

  function openPrompt(){
    show('<div class="cs-head"><h3>🔎 Open shared case</h3><button class="cs-x" data-cs-x aria-label="Close">×</button></div>'
       + '<div class="cs-body"><div class="cs-sub">Enter a case code to retrieve it.</div>'
       + '<div class="cs-row"><input id="csCodeIn" placeholder="SMD-7K2Q9" autocapitalize="characters" autocomplete="off"><button class="cs-btn" id="csGo">Open</button></div>'
       + '<div class="cs-note">Codes expire 30 days after sharing.</div></div>');
    var o=overlay(); var inp=o.querySelector("#csCodeIn");
    function go(){ open(inp.value); }
    o.querySelector("#csGo").addEventListener("click", go);
    inp.addEventListener("keydown", function(e){ if(e.key==="Enter") go(); });
    try { inp.focus(); } catch(e){}
  }

  function showViewer(rec, code){
    var when = "";
    try { when = rec.createdAt ? new Date(rec.createdAt).toLocaleString() : ""; } catch(e){}
    // Public shared docs deliberately DO NOT store the owner's email (PII); show
    // display name only. (Enforces the "no email in public shares" invariant here too.)
    var by = "";
    if (rec.ownerName) by = "Shared by " + esc(rec.ownerName);
    show('<div class="cs-head"><h3>'+esc(rec.title||"Shared case")+'</h3><button class="cs-x" data-cs-x aria-label="Close">×</button></div>'
       + '<div class="cs-body"><div class="cs-sub">'+esc(code)+(when?" · shared "+esc(when):"")+'</div>'
       + (by?'<div class="cs-by" style="text-align:center;font:600 12.5px var(--f);color:var(--ink);margin:-8px 0 14px">'+by+'</div>':'')
       + '<div class="cs-viewer">'+((rec.html && sanitizeHTML(rec.html)) || ("<pre style=\"white-space:pre-wrap\">"+esc(rec.text||"")+"</pre>"))+'</div>'
       + '<div class="cs-note">Read-only shared case. Decision support only — verify against clinical judgment &amp; local protocol.</div></div>');
  }

  // auto-open ?case=CODE links (after firebase has had a chance to load)
  function checkUrl(){
    try {
      var m = /[?&]case=([A-Za-z0-9-]+)/.exec(location.search);
      if (m && m[1]) { var code = normCode(m[1]); setTimeout(function(){ open(code); }, 1200); }
    } catch(e){}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkUrl); else checkUrl();

  window.CASESHARE = { shareCurrent: shareCurrent, open: open, openPrompt: openPrompt };
})();
