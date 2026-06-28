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
  function toast(m){ try { if (window.SMD_toast) return SMD_toast(m); } catch(e){} var t=document.getElementById("cs-toast"); if(!t){t=document.createElement("div");t.id="cs-toast";t.className="cs-toast";document.body.appendChild(t);} t.textContent=m; t.classList.add("on"); clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove("on");},2400); }

  function genCode(){ var s=""; for (var i=0;i<5;i++){ s += ALPHABET.charAt(Math.floor(Math.random()*ALPHABET.length)); } return "SMD-"+s; }
  function normCode(c){ c=String(c||"").trim().toUpperCase().replace(/\s+/g,""); if(c && c.indexOf("SMD-")!==0 && /^[A-Z0-9]{5}$/.test(c)) c="SMD-"+c; return c; }

  // Ensure Firebase/Firestore is loaded (it is lazy-loaded), then run cb(db) or cb(null) on failure.
  // Load Firebase (lazy) AND wait for auth state to settle, then cb(db, user).
  // (Fixes the race where currentUser is briefly null right after lazy Firebase load.)
  function ensureReady(cb){
    function withAuth(){
      var auth = window.SMD_AUTH, db = window.SMD_DB || null;
      if (!auth) return cb(db, null);
      if (auth.currentUser) return cb(db, auth.currentUser);
      var done = false, unsub;
      function fin(u){ if (done) return; done = true; try { unsub && unsub(); } catch (e) {} cb(window.SMD_DB || null, u || null); }
      try { unsub = auth.onAuthStateChanged(function (u) { fin(u); }); } catch (e) { return cb(db, null); }
      setTimeout(function () { fin(auth.currentUser); }, 4000);
    }
    if (window.SMD_DB && window.SMD_AUTH) return withAuth();
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

  // ---- create a share ----
  function shareCurrent(){
    var snap = currentSnapshot();
    if (!snap) { toast("Generate a clinical decision first."); return; }
    toast("Preparing share…");
    ensureReady(function(db, user){
      if (!db) { toast("Cloud unavailable — check your connection & try again."); return; }
      if (!user) { toast("Please sign in with Google first (More ▸ Account & sign-in) to share."); return; }
      doShare(snap, db, user);
    });
  }
  function doShare(snap, db, user){
    var code = genCode();
    var now = Date.now();
    var rec = { v:1, code:code, title:snap.title, html:snap.html, text:snap.text,
                ownerUid:user.uid, ownerEmail:user.email||"", createdAt:now, expiresAt: now + TTL_MS };
    db.collection(COLL).doc(code).set(rec)
      .then(function(){ showResult(code); })
      .catch(function(e){ try { console.error("[CASESHARE] share failed:", e); } catch (x) {} toast("Share failed: " + ((e && e.code) || (e && e.message) || "error")); });
  }
  function friendly(e){ var m=(e&&e.message)||""; if(/permission|insufficient/i.test(m)) return "Firestore rules not set yet (see setup)."; return m.slice(0,80) || "error"; }

  // ---- retrieve a share ----
  function open(code){
    code = normCode(code);
    if (!/^SMD-[A-Z0-9]{5}$/.test(code)) { toast("Enter a valid code like SMD-7K2Q9."); return; }
    ensureReady(function(db){
      if (!db) { toast("Cloud unavailable — check your connection."); return; }
      db.collection(COLL).doc(code).get().then(function(d){
        if (!d || !d.exists) { toast("Case " + code + " not found."); return; }
        var rec = d.data();
        if (rec.expiresAt && rec.expiresAt < Date.now()) { toast("This shared case has expired (30-day limit)."); return; }
        showViewer(rec, code);
      }).catch(function(e){ toast("Could not open — " + friendly(e)); });
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
    var link = location.origin + "/?case=" + code;
    show('<div class="cs-head"><h3>📤 Case shared</h3><button class="cs-x" data-cs-x>×</button></div>'
       + '<div class="cs-body"><div class="cs-code">'+esc(code)+'</div>'
       + '<div class="cs-sub">Anyone with this code (or link) can open this case for 30 days.</div>'
       + '<div class="cs-row"><button class="cs-btn" id="csCopyCode">Copy code</button><button class="cs-btn sec" id="csCopyLink">Copy link</button><button class="cs-btn sec" id="csShareLink">Share…</button></div>'
       + '<div class="cs-note">Saved to your account. Shares the clinical findings &amp; decision only — do not enter patient identifiers. Decision support only.</div></div>');
    var o=overlay();
    o.querySelector("#csCopyCode").addEventListener("click", function(){ copy(code, "Code copied"); });
    o.querySelector("#csCopyLink").addEventListener("click", function(){ copy(link, "Link copied"); });
    o.querySelector("#csShareLink").addEventListener("click", function(){ try { if(navigator.share){ navigator.share({title:"StewardMD case "+code, text:"Open StewardMD case "+code, url:link}).catch(function(){}); } else copy(link,"Link copied"); } catch(e){ copy(link,"Link copied"); } });
  }
  function copy(t,msg){ try { if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(t); toast(msg); return; } } catch(e){} toast(t); }

  function openPrompt(){
    show('<div class="cs-head"><h3>🔎 Open shared case</h3><button class="cs-x" data-cs-x>×</button></div>'
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
    show('<div class="cs-head"><h3>'+esc(rec.title||"Shared case")+'</h3><button class="cs-x" data-cs-x>×</button></div>'
       + '<div class="cs-body"><div class="cs-sub">'+esc(code)+(when?" · shared "+esc(when):"")+'</div>'
       + '<div class="cs-viewer">'+(rec.html || ("<pre style=\"white-space:pre-wrap\">"+esc(rec.text||"")+"</pre>"))+'</div>'
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
