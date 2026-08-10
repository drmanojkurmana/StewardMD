/* StewardMD — Search the Medical Register (window.SMD_NMC).
 * ===========================================================================
 * A fast doctor lookup against the Indian Medical Register (NMC), opened from More →
 * "Search Medical Register". Type a name OR a registration number; results stream in.
 * Public register data only (name, reg no, council, year, qualification) — the same
 * search anyone can run at nmc.org.in. Backend: GET /api/nmc-search (auto-detects name vs reg).
 * ======================================================================== */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ico(n) { return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }
  function apiBase() { try { var h = (location && location.hostname) || ""; return /(^|\.)stewardmd\.in$/i.test(h) ? "" : "https://stewardmd.in"; } catch (e) { return "https://stewardmd.in"; } }
  function fbToken() { try { var u = (window.SMD_AUTH && SMD_AUTH.currentUser) || (window.firebase && firebase.auth && firebase.auth().currentUser); return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }

  var root = null, timer = null, seq = 0;
  function close() { if (timer) { clearTimeout(timer); timer = null; } if (root) { root.classList.remove("on"); var r = root; setTimeout(function () { if (r && !r.classList.contains("on")) r.remove(); }, 200); root = null; } }

  function open() {
    injectCSS();
    if (root) root.remove();
    root = document.createElement("div");
    root.className = "smdnmc"; root.id = "smdNmc";
    root.innerHTML =
      '<div class="smdnmc-scrim" data-nmc="close"></div>' +
      '<div class="smdnmc-sheet" role="dialog" aria-modal="true" aria-label="Search Medical Register">' +
        '<div class="smdnmc-hd"><span class="smdnmc-ttl">' + ico("search") + ' Search Medical Register</span>' +
          '<button class="smdnmc-x" data-nmc="close" aria-label="Close">' + ico("close") + '</button></div>' +
        '<div class="smdnmc-sub">Indian Medical Register (NMC). Search by doctor name or registration number.</div>' +
        '<input id="smdnmcQ" class="smdnmc-inp" type="search" autocomplete="off" autocapitalize="words" spellcheck="false" ' +
          'placeholder="e.g. Rakesh Sharma  ·  or  45678" aria-label="Doctor name or NMC registration number">' +
        '<div class="smdnmc-status" id="smdnmcStatus" aria-live="polite"></div>' +
        '<div class="smdnmc-results" id="smdnmcResults"></div>' +
        '<div class="smdnmc-foot">Public register data (name, registration, council, qualification). Verify identity independently before relying on it.</div>' +
      '</div>';
    document.body.appendChild(root);
    requestAnimationFrame(function () { root.classList.add("on"); });

    root.addEventListener("click", function (e) { var b = e.target.closest("[data-nmc]"); if (b && b.getAttribute("data-nmc") === "close") close(); });
    document.addEventListener("keydown", onKey);

    var q = root.querySelector("#smdnmcQ");
    q.addEventListener("input", function () { schedule(q.value); });
    setTimeout(function () { try { q.focus(); } catch (e) {} }, 60);
    setStatus("Type at least 2 characters to search.");
  }
  function onKey(e) { if (e.key === "Escape" && root) { close(); document.removeEventListener("keydown", onKey); } }

  function schedule(v) {
    if (timer) clearTimeout(timer);
    var query = String(v || "").trim();
    if (query.length < 2) { setStatus("Type at least 2 characters to search."); results(null); return; }
    setStatus("Searching…");
    timer = setTimeout(function () { run(query); }, 350);   // debounce so we don't hit NMC per keystroke
  }

  function run(query) {
    var mine = ++seq;
    fbToken().then(function (tok) {
      var h = {}; if (tok) h.Authorization = "Bearer " + tok;
      return fetch(apiBase() + "/api/nmc-search?q=" + encodeURIComponent(query), { headers: h, credentials: "include" });
    }).then(function (r) {
      return r.json().then(function (d) { return { status: r.status, d: d || {} }; });
    }).then(function (res) {
      if (mine !== seq || !root) return;                     // a newer query superseded this one
      if (res.status === 401) { setStatus("Sign in to search the register."); results(null); return; }
      if (res.status === 503 || (res.d && res.d.error === "register_unavailable")) { setStatus("The register is temporarily unavailable. Try again in a moment."); results(null); return; }
      if (res.d && res.d.error) { setStatus("Couldn't search right now. Try again."); results(null); return; }
      var list = (res.d && res.d.results) || [];
      if (!list.length) { setStatus("No matching doctors in the register."); results([]); return; }
      setStatus(list.length + (list.length === 25 ? "+ " : " ") + "match" + (list.length === 1 ? "" : "es") + (res.d.source === "register" ? " · offline mirror" : " · live NMC"));
      results(list);
    }).catch(function () { if (mine === seq && root) { setStatus("Couldn't search right now. Check your connection."); results(null); } });
  }

  function setStatus(t) { var e = root && root.querySelector("#smdnmcStatus"); if (e) e.textContent = t || ""; }
  function results(list) {
    var box = root && root.querySelector("#smdnmcResults"); if (!box) return;
    if (!list) { box.innerHTML = ""; return; }
    box.innerHTML = list.map(function (d) {
      var meta = [d.council, d.year && ("Reg. " + d.year), d.degree].filter(Boolean).map(esc).join(" · ");
      return '<div class="smdnmc-card">' +
        '<div class="smdnmc-name">' + esc(d.name || "—") + '</div>' +
        (d.regNo ? '<div class="smdnmc-reg">' + ico("badge") + ' Reg. No ' + esc(d.regNo) + '</div>' : "") +
        (meta ? '<div class="smdnmc-meta">' + meta + '</div>' : "") +
        (d.university ? '<div class="smdnmc-uni">' + esc(d.university) + '</div>' : "") +
        '</div>';
    }).join("");
  }

  function injectCSS() {
    if (document.getElementById("smdnmc-css")) return;
    var s = document.createElement("style"); s.id = "smdnmc-css";
    s.textContent = [
      ".smdnmc{position:fixed;inset:0;z-index:17000;font-family:var(--sans,-apple-system,'Segoe UI',Roboto,system-ui,sans-serif);opacity:0;transition:opacity .2s;pointer-events:none}",
      ".smdnmc.on{opacity:1;pointer-events:auto}",
      ".smdnmc-scrim{position:absolute;inset:0;background:rgba(8,15,26,.55)}",
      ".smdnmc-sheet{position:absolute;left:0;right:0;bottom:0;max-height:90vh;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--ink,#0f172a);border-radius:20px 20px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.3);transform:translateY(14px);transition:transform .22s}",
      ".smdnmc.on .smdnmc-sheet{transform:none}",
      ".smdnmc-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}",
      ".smdnmc-ttl{font:800 17px var(--sans);display:flex;align-items:center;gap:7px}",
      ".smdnmc-x{border:none;background:none;color:var(--slate-soft,#64748b);cursor:pointer;padding:4px 8px}",
      ".smdnmc-sub{font:500 12.5px/1.5 var(--sans);color:var(--slate-soft,#64748b);margin-bottom:10px}",
      ".smdnmc-inp{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e2e8f0);border-radius:12px;padding:12px 14px;font:600 15px var(--sans);background:var(--panel,#fff);color:var(--ink,#0f172a)}",
      ".smdnmc-inp:focus{outline:none;border-color:var(--teal,#0f766e)}",
      ".smdnmc-status{font:600 12px var(--sans);color:var(--slate-soft,#64748b);margin:8px 2px}",
      ".smdnmc-results{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:8px}",
      ".smdnmc-card{border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:11px 13px;background:var(--bg,#f8fafc)}",
      ".smdnmc-name{font:800 14.5px var(--sans);color:var(--ink,#0f172a)}",
      ".smdnmc-reg{font:700 12.5px var(--sans);color:var(--teal,#0f766e);display:flex;align-items:center;gap:5px;margin-top:3px}",
      ".smdnmc-meta{font:600 12px var(--sans);color:var(--slate,#334155);margin-top:3px}",
      ".smdnmc-uni{font:500 11.5px var(--sans);color:var(--slate-soft,#64748b);margin-top:2px}",
      ".smdnmc-foot{font:500 10.5px/1.5 var(--sans);color:var(--slate-soft,#94a3b8);margin-top:10px}",
      "body.dark .smdnmc-sheet{--panel:#132030;--ink:#e8edf2}body.dark .smdnmc-card{--bg:#0d1b26}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  window.SMD_NMC = { open: open, close: close };
})();
