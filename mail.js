/* StewardMD - owner Mail (window.SMD_MAIL): the hello@maiknowledge.com mailbox inside the app.
 *
 * Owner-only. Reads, files and sends mail through /api/mail/* (functions/api/mail/[[path]].js), which
 * proxies the Mailflare deployment with a server-held API key; nothing about the mailbox is stored on
 * the device beyond what is on screen. Changes made here (read, star, archive, trash, spam, send) are
 * made in Mailflare itself, so the web dashboard and this screen always agree. While open, the current
 * folder refreshes every 20 s (and on returning to the app), so new mail shows up without a pull.
 *
 * Message HTML is drawn in a sandboxed iframe with no script permission and a CSP that blocks every
 * request except images; links open outside the app.
 *
 * Flag: smd_mail (default ON for owners; ?mail=0 or localStorage smd_mail="0" hides it). Server kill
 * switch: MAIL_ON=0. Buildless ES5.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var BASE = "/api/mail";
  // Mirrors OWNER_EMAILS_DEFAULT in functions/_adminauth.js. This only hides the entry point; the
  // server's ownerOK is the real gate.
  var OWNERS = ["drmanojkurmana@gmail.com", "mkkmanojkumar0@gmail.com", "kdiwakar45@gmail.com"];
  var FOLDERS = [["inbox", "Inbox"], ["sent", "Sent"], ["archive", "Archive"], ["spam", "Spam"], ["trash", "Trash"]];
  var POLL_MS = 20000;
  var ERR = {
    "forbidden": "Owner sign-in required.",
    "not-configured": "Mail is not connected yet.",
    "mailbox-not-found": "The mailbox was not found on the mail server.",
    "mail-key-rejected": "The mail server rejected the API key.",
    "mail-server-unreachable": "The mail server could not be reached. Check your connection and try again.",
    "to-required": "Add at least one recipient.",
    "subject-required": "Add a subject.",
    "body-required": "Write a message first.",
    "attachment-too-large": "This attachment is too large to open in the app."
  };

  var st = { open: false, folder: "inbox", list: [], total: 0, unread: 0, offset: 0, loading: false, view: null, timer: null, address: "", configured: null, seq: 0 };

  function flagOn() {
    try {
      var q = (location.search.match(/[?&]mail=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return localStorage.getItem("smd_mail") !== "0";
    } catch (e) { return true; }
  }
  function userEmail() {
    try { var u = G.SMD_AUTH && G.SMD_AUTH.currentUser; return String((u && u.email) || "").toLowerCase(); } catch (e) { return ""; }
  }
  function isOwner() { return OWNERS.indexOf(userEmail()) >= 0; }
  function enabled() { return flagOn() && isOwner(); }

  function token() {
    try {
      var u = G.SMD_AUTH && G.SMD_AUTH.currentUser;
      return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null);
    } catch (e) { return Promise.resolve(null); }
  }
  function api(method, path, body) {
    return token().then(function (t) {
      var h = { "Content-Type": "application/json" };
      if (t) h.Authorization = "Bearer " + t;
      return G.fetch(BASE + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = null; }
        if (!r.ok || !j) { var e = new Error((j && j.error) || ("http-" + r.status)); e.code = (j && j.error) || ("http-" + r.status); throw e; }
        return j;
      });
    });
  }
  function errText(e) { var c = e && (e.code || e.message); return ERR[c] || "Something went wrong. Try again."; }
  function toast(m) { try { if (G.toast) G.toast(m); } catch (e) {} }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // "Ravi Kumar <ravi@x.com>" -> { name: "Ravi Kumar", email: "ravi@x.com" }
  function parseAddr(s) {
    s = String(s || "").trim();
    var m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) return { name: m[1].trim(), email: m[2].trim() };
    return { name: "", email: s };
  }
  function splitList(s) {
    var out = [], cur = "", q = false, a = false;
    String(s || "").split("").forEach(function (c) {
      if (c === '"') q = !q;
      if (c === "<") a = true;
      if (c === ">") a = false;
      if (c === "," && !q && !a) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c;
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function who(s) { var p = parseAddr(splitList(s)[0] || ""); return p.name || p.email || "(unknown)"; }
  function when(iso, full) {
    var d = new Date(iso); if (isNaN(d)) return "";
    var now = new Date();
    if (full) return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function size(n) { n = Number(n) || 0; return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  var ICON = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    reply: '<path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 015 5v2"/>',
    replyall: '<path d="M7 17l-5-5 5-5"/><path d="M12 17l-5-5 5-5"/><path d="M7 12h8a5 5 0 015 5v2"/>',
    archive: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    unread: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
    star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    spam: '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z"/>',
    clip: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'
  };
  function svg(n, filled) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="' + (filled ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[n] || "") + "</svg>"; }

  var CSS = [
    "#smdMail{--mbg:#F8FAFC;--mpanel:#fff;--mbd:#E2E8F0;--mink:#0F172A;--mmut:#64748B;--mp:#0F766E;--mps:#CCFBF1;--mfont:'Inter',-apple-system,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:100000;background:var(--mbg);color:var(--mink);font-family:var(--mfont);display:flex;flex-direction:column}",
    "body.dark #smdMail{--mbg:#0B1220;--mpanel:#111B2E;--mbd:#1E2B43;--mink:#E7EDF5;--mmut:#8597AD;--mps:#0c2e2a;--mp:#2DD4BF}",
    "#smdMail *{box-sizing:border-box}",
    "#smdMail .mm-bar{display:flex;align-items:center;gap:6px;padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px;background:var(--mpanel);border-bottom:1px solid var(--mbd)}",
    "#smdMail .mm-t{flex:1;min-width:0}#smdMail .mm-t b{display:block;font:800 16px var(--mfont)}#smdMail .mm-t span{display:block;font:500 12px var(--mfont);color:var(--mmut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#smdMail .mm-ib{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--mink);border-radius:12px;cursor:pointer;flex:0 0 auto}#smdMail .mm-ib:active{background:var(--mbg)}#smdMail .mm-ib.on{color:#D97706}",
    "#smdMail .mm-tabs{display:flex;gap:6px;padding:8px 10px;overflow-x:auto;background:var(--mpanel);border-bottom:1px solid var(--mbd);scrollbar-width:none}",
    "#smdMail .mm-tab{flex:0 0 auto;min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid var(--mbd);background:var(--mbg);color:var(--mink);font:600 13px var(--mfont);cursor:pointer}#smdMail .mm-tab.on{background:var(--mp);border-color:var(--mp);color:#fff}",
    "#smdMail .mm-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}",
    "#smdMail .mm-row{display:flex;gap:10px;width:100%;text-align:left;padding:12px 14px;border:none;border-bottom:1px solid var(--mbd);background:var(--mpanel);color:var(--mink);cursor:pointer;font-family:var(--mfont)}",
    "#smdMail .mm-dot{width:9px;height:9px;border-radius:50%;margin-top:6px;flex:0 0 auto;background:transparent}#smdMail .mm-row.unread .mm-dot{background:var(--mp)}",
    "#smdMail .mm-main{flex:1;min-width:0}#smdMail .mm-l1{display:flex;gap:8px;align-items:baseline}#smdMail .mm-from{flex:1;min-width:0;font:600 14.5px var(--mfont);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#smdMail .mm-row.unread .mm-from{font-weight:800}",
    "#smdMail .mm-time{font:500 12px var(--mfont);color:var(--mmut);flex:0 0 auto}#smdMail .mm-sub{font:600 13.5px var(--mfont);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#smdMail .mm-row:not(.unread) .mm-sub{font-weight:500}",
    "#smdMail .mm-snip{font:400 13px/1.35 var(--mfont);color:var(--mmut);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}#smdMail .mm-st{color:#D97706;flex:0 0 auto}",
    "#smdMail .mm-empty{padding:48px 24px;text-align:center;color:var(--mmut);font:500 14px/1.5 var(--mfont)}#smdMail .mm-empty b{display:block;color:var(--mink);font-size:16px;margin-bottom:6px}",
    "#smdMail .mm-more{display:block;margin:14px auto 24px;min-height:44px;padding:8px 22px;border-radius:12px;border:1px solid var(--mbd);background:var(--mpanel);color:var(--mink);font:600 14px var(--mfont);cursor:pointer}",
    "#smdMail .mm-h{padding:14px 16px;background:var(--mpanel);border-bottom:1px solid var(--mbd)}#smdMail .mm-hs{font:800 18px/1.3 var(--mfont);margin-bottom:10px;word-break:break-word}",
    "#smdMail .mm-meta{font:500 13px/1.5 var(--mfont);color:var(--mmut);word-break:break-word}#smdMail .mm-meta b{color:var(--mink);font-weight:700}",
    "#smdMail .mm-acts{display:flex;gap:2px;flex-wrap:wrap;margin-top:8px}",
    "#smdMail .mm-frame{display:block;width:100%;border:0;background:#fff;min-height:120px}#smdMail .mm-text{white-space:pre-wrap;word-break:break-word;padding:16px;font:400 15px/1.55 var(--mfont)}",
    "#smdMail .mm-att{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;border-bottom:1px solid var(--mbd);background:var(--mpanel)}",
    "#smdMail .mm-chip{display:flex;align-items:center;gap:6px;min-height:40px;max-width:100%;padding:6px 12px;border-radius:10px;border:1px solid var(--mbd);background:var(--mbg);color:var(--mink);font:600 13px var(--mfont);cursor:pointer}#smdMail .mm-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#smdMail .mm-chip small{color:var(--mmut);font-weight:500}",
    "#smdMail .mm-form{padding:12px 16px;display:flex;flex-direction:column;gap:10px}#smdMail .mm-form label{font:700 12px var(--mfont);color:var(--mmut);text-transform:uppercase;letter-spacing:.04em}",
    "#smdMail .mm-form input,#smdMail .mm-form textarea{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--mbd);background:var(--mpanel);color:var(--mink);font:400 16px var(--mfont)}#smdMail .mm-form textarea{min-height:240px;resize:vertical;line-height:1.5}",
    "#smdMail .mm-send{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 18px;border-radius:12px;border:none;background:var(--mp);color:#fff;font:700 15px var(--mfont);cursor:pointer}#smdMail .mm-send:disabled{opacity:.6}",
    "#smdMail .mm-err{margin:12px 16px;padding:10px 12px;border-radius:10px;background:#FEF2F2;color:#991B1B;font:500 13px/1.45 var(--mfont)}body.dark #smdMail .mm-err{background:#3b1414;color:#fecaca}",
    "#smdMail code{font-size:12px;background:var(--mbg);padding:1px 4px;border-radius:4px}"
  ].join("\n");

  var ov = null, prevOverflow = "", prevFocus = null;
  function $(sel) { return ov ? ov.querySelector(sel) : null; }

  function ensureCss() {
    if (D.getElementById("smdMailCss")) return;
    var s = D.createElement("style"); s.id = "smdMailCss"; s.textContent = CSS; D.head.appendChild(s);
  }

  function open() {
    if (!isOwner()) { toast("Owner access only"); return; }
    if (ov) return;
    ensureCss();
    prevFocus = D.activeElement; prevOverflow = D.body.style.overflow;
    ov = D.createElement("div"); ov.id = "smdMail";
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Mail");
    D.body.appendChild(ov);
    D.body.style.overflow = "hidden";
    ov.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); back(); } });
    st.open = true; st.view = null;
    showList(true);
    D.addEventListener("visibilitychange", onVisible);
    schedule();
  }
  function close() {
    st.open = false; st.view = null;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    D.removeEventListener("visibilitychange", onVisible);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    ov = null;
    D.body.style.overflow = prevOverflow;
    try { if (prevFocus && prevFocus.isConnected) prevFocus.focus(); } catch (e) {}
    notifyBadge();
  }
  function back() {
    if (!st.view) return close();
    if (st.view.kind === "compose" && st.view.from) return showMessage(st.view.from);
    st.view = null; showList(false);
  }

  function schedule() {
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(function () {
      st.timer = null;
      if (!st.open) return;
      if (D.visibilityState !== "hidden" && !st.view) refresh(true);
      schedule();
    }, POLL_MS);
  }
  function onVisible() { if (st.open && D.visibilityState === "visible" && !st.view) refresh(true); }

  function shell(title, sub, left, right, tabs) {
    return '<div class="mm-bar">' + left + '<div class="mm-t"><b>' + esc(title) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>" + right + "</div>" +
      (tabs ? '<div class="mm-tabs" role="tablist">' + FOLDERS.map(function (f) {
        return '<button class="mm-tab' + (f[0] === st.folder ? " on" : "") + '" role="tab" aria-selected="' + (f[0] === st.folder) + '" data-folder="' + f[0] + '">' + f[1] + (f[0] === "inbox" && st.unread ? " (" + st.unread + ")" : "") + "</button>";
      }).join("") + "</div>" : "") +
      '<div class="mm-body"></div>';
  }
  function ib(act, icon, label, on, filled) { return '<button class="mm-ib' + (on ? " on" : "") + '" data-act="' + act + '" aria-label="' + label + '" title="' + label + '">' + svg(icon, filled) + "</button>"; }

  /* ---------- list ---------- */
  function showList(reload) {
    if (!ov) return;
    var title = (FOLDERS.filter(function (f) { return f[0] === st.folder; })[0] || [0, "Inbox"])[1];
    ov.innerHTML = shell(title, st.address, ib("close", "close", "Close mail"), ib("refresh", "refresh", "Refresh") + ib("compose", "edit", "New message"), true);
    ov.querySelectorAll("[data-folder]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-folder"); if (f === st.folder) return;
        st.folder = f; st.list = []; st.total = 0; st.offset = 0; showList(true);
      });
    });
    wireBar();
    if (reload || !st.list.length) { renderRows(); refresh(false); } else renderRows();
    var c = $(".mm-bar [data-act]"); if (c) c.focus();
  }
  function wireBar() {
    ov.querySelectorAll(".mm-bar [data-act]").forEach(function (b) {
      b.addEventListener("click", function () { barAction(b.getAttribute("data-act")); });
    });
  }
  function barAction(a) {
    if (a === "close") return close();
    if (a === "back") return back();
    if (a === "refresh") return refresh(false);
    if (a === "compose") return showCompose({});
  }

  function refresh(quiet) {
    if (st.loading) return;
    st.loading = true;
    var folder = st.folder, seq = ++st.seq;
    // A quiet poll re-reads the first page only and keeps any older pages already loaded below it.
    var needStatus = st.configured !== true;
    var pre = needStatus ? api("GET", "/status") : Promise.resolve(null);
    pre.then(function (s) {
      if (s) { st.configured = !!s.configured; st.address = s.address || st.address; }
      if (st.configured === false) throw Object.assign(new Error("not-configured"), { code: "not-configured" });
      return api("GET", "/list?folder=" + folder + "&offset=0");
    }).then(function (j) {
      st.loading = false;
      if (seq !== st.seq || folder !== st.folder) return;
      var fresh = j.messages || [];
      var seen = {}; fresh.forEach(function (m) { seen[m.id] = 1; });
      var older = st.list.slice(fresh.length).filter(function (m) { return !seen[m.id]; });
      st.list = fresh.concat(quiet ? older : []);
      st.offset = quiet ? Math.max(st.offset, fresh.length) : fresh.length;
      st.total = j.total || 0;
      if (folder === "inbox") st.unread = j.unread || 0;
      if (!st.view) { updateTabs(); renderRows(); }
      notifyBadge();
    }).catch(function (e) {
      st.loading = false;
      if (seq !== st.seq) return;
      if (!quiet && !st.view) renderError(e);
    });
  }
  function loadMore() {
    if (st.loading) return;
    st.loading = true;
    var folder = st.folder;
    api("GET", "/list?folder=" + folder + "&offset=" + st.list.length).then(function (j) {
      st.loading = false;
      if (folder !== st.folder) return;
      var have = {}; st.list.forEach(function (m) { have[m.id] = 1; });
      st.list = st.list.concat((j.messages || []).filter(function (m) { return !have[m.id]; }));
      st.total = j.total || st.total;
      renderRows();
    }).catch(function (e) { st.loading = false; toast(errText(e)); });
  }
  function updateTabs() {
    var t = $('[data-folder="inbox"]'); if (t) t.textContent = "Inbox" + (st.unread ? " (" + st.unread + ")" : "");
    var s = $(".mm-t span"); if (s) s.textContent = st.address;
  }
  function renderError(e) {
    var body = $(".mm-body"); if (!body) return;
    if ((e && e.code) === "not-configured") {
      body.innerHTML = '<div class="mm-empty"><b>Mail is not connected yet</b>Create an API key in Mailflare (Settings, API keys) and add these Cloudflare Pages secrets to the stewardmd project: <code>MAILFLARE_URL</code> and <code>MAILFLARE_API_KEY</code>. The mailbox shown is <code>' + esc(st.address || "hello@maiknowledge.com") + "</code>.</div>";
      return;
    }
    body.innerHTML = '<div class="mm-err" role="alert">' + esc(errText(e)) + '</div><button class="mm-more" data-retry="1">Try again</button>';
    var r = body.querySelector("[data-retry]"); if (r) r.addEventListener("click", function () { st.configured = null; refresh(false); });
  }
  function renderRows() {
    var body = $(".mm-body"); if (!body) return;
    if (!st.list.length) {
      body.innerHTML = st.loading || st.configured === null ? '<div class="mm-empty">Loading mail</div>' : '<div class="mm-empty"><b>Nothing here</b>No messages in this folder.</div>';
      return;
    }
    var sent = st.folder === "sent";
    body.innerHTML = st.list.map(function (m) {
      return '<button class="mm-row' + (!m.read && !sent ? " unread" : "") + '" data-id="' + esc(m.id) + '">' +
        '<span class="mm-dot" aria-hidden="true"></span><span class="mm-main"><span class="mm-l1"><span class="mm-from">' + esc(sent ? "To: " + who(m.to) : who(m.from)) + "</span>" +
        (m.starred ? '<span class="mm-st" aria-label="Starred">' + svg("star", true).replace('width="20" height="20"', 'width="14" height="14"') + "</span>" : "") +
        '<span class="mm-time">' + esc(when(m.createdAt)) + "</span></span>" +
        '<span class="mm-sub" style="display:block">' + esc(m.subject || "(no subject)") + "</span>" +
        '<span class="mm-snip">' + esc(m.snippet || "") + "</span></span></button>";
    }).join("") + (st.list.length < st.total ? '<button class="mm-more" data-more="1">Load more</button>' : "");
    body.querySelectorAll(".mm-row").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id");
        var m = st.list.filter(function (x) { return x.id === id; })[0];
        if (m) showMessage(m);
      });
    });
    var more = body.querySelector("[data-more]"); if (more) more.addEventListener("click", loadMore);
  }

  /* ---------- message ---------- */
  function showMessage(row) {
    if (!ov) return;
    st.view = { kind: "message", row: row, full: null };
    ov.innerHTML = shell(row.subject || "(no subject)", who(row.from), ib("back", "back", "Back to list"), "", false);
    wireBar();
    var body = $(".mm-body");
    body.innerHTML = '<div class="mm-empty">Opening message</div>';
    api("GET", "/message/" + encodeURIComponent(row.id)).then(function (j) {
      if (!st.view || st.view.row !== row) return;
      st.view.full = j;
      renderMessage(j);
      if (!j.message.read && j.message.direction === "inbound") setFlags(row.id, { read: true }, true);
    }).catch(function (e) {
      if (!st.view || st.view.row !== row) return;
      body.innerHTML = '<div class="mm-err" role="alert">' + esc(errText(e)) + "</div>";
    });
  }
  function renderMessage(j) {
    var m = j.message, body = $(".mm-body"); if (!body) return;
    var f = st.folder;
    var acts = ib("reply", "reply", "Reply") +
      (splitList(m.to).length + splitList(m.cc).length > 1 ? ib("replyall", "replyall", "Reply all") : "") +
      ib("star", "star", m.starred ? "Remove star" : "Star", m.starred, m.starred) +
      (m.direction === "inbound" ? ib("unread", "unread", "Mark as unread") : "") +
      (f !== "inbox" && m.direction === "inbound" ? ib("inbox", "inbox", "Move to inbox") : "") +
      (f !== "archive" && f !== "sent" ? ib("archive", "archive", "Archive") : "") +
      (f !== "spam" && m.direction === "inbound" ? ib("spam", "spam", "Report spam") : "") +
      (f !== "trash" ? ib("trash", "trash", "Move to trash") : "");
    var fromP = parseAddr(m.from);
    body.innerHTML = '<div class="mm-h"><div class="mm-hs">' + esc(m.subject || "(no subject)") + "</div>" +
      '<div class="mm-meta"><b>' + esc(m.fromName || fromP.name || fromP.email) + "</b> " + (fromP.name || m.fromName ? "&lt;" + esc(fromP.email) + "&gt;" : "") + "</div>" +
      '<div class="mm-meta">To: ' + esc(splitList(m.to).join(", ")) + "</div>" +
      (m.cc ? '<div class="mm-meta">Cc: ' + esc(splitList(m.cc).join(", ")) + "</div>" : "") +
      '<div class="mm-meta">' + esc(when(m.createdAt, true)) + "</div>" +
      '<div class="mm-acts">' + acts + "</div></div>" +
      ((j.attachments || []).filter(function (a) { return a.disposition !== "inline"; }).length ? '<div class="mm-att">' + j.attachments.filter(function (a) { return a.disposition !== "inline"; }).map(function (a) {
        return '<button class="mm-chip" data-att="' + esc(a.id) + '">' + svg("clip").replace('width="20" height="20"', 'width="16" height="16"') + "<span>" + esc(a.filename) + "</span><small>" + size(a.size) + "</small></button>";
      }).join("") + "</div>" : "") +
      '<div class="mm-content"></div>';
    var content = body.querySelector(".mm-content");
    if (m.htmlBody) drawHtml(content, m.htmlBody); else content.innerHTML = '<div class="mm-text">' + esc(m.textBody || m.snippet || "") + "</div>";
    body.querySelectorAll(".mm-acts [data-act]").forEach(function (b) {
      b.addEventListener("click", function () { messageAction(b.getAttribute("data-act"), m); });
    });
    body.querySelectorAll("[data-att]").forEach(function (b) {
      b.addEventListener("click", function () { openAttachment(m.id, b.getAttribute("data-att"), b); });
    });
  }
  // Sandboxed: no allow-scripts, so nothing in the mail runs. allow-same-origin lets this page size the
  // frame and catch link taps; the CSP stops every load except images and inline styles.
  function drawHtml(host, html) {
    var fr = D.createElement("iframe");
    fr.className = "mm-frame"; fr.title = "Message";
    fr.setAttribute("sandbox", "allow-same-origin");
    fr.setAttribute("referrerpolicy", "no-referrer");
    var head = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data: cid:; style-src \'unsafe-inline\'; font-src https: data:">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">' +
      "<style>html,body{margin:0;padding:0;background:#fff;color:#111}body{padding:14px 16px;font:15px/1.5 -apple-system,system-ui,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ccc;color:#555}</style>";
    fr.srcdoc = "<!doctype html><html><head>" + head + "</head><body>" + html + "</body></html>";
    fr.addEventListener("load", function () {
      try {
        var doc = fr.contentDocument;
        var fit = function () { try { fr.style.height = Math.max(120, doc.documentElement.scrollHeight) + "px"; } catch (e) {} };
        fit(); setTimeout(fit, 300); setTimeout(fit, 1500);
        [].forEach.call(doc.images || [], function (im) { im.addEventListener("load", fit); });
        doc.addEventListener("click", function (e) {
          var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
          if (!a) return;
          e.preventDefault();
          openLink(a.getAttribute("href"));
        });
      } catch (e) {}
    });
    host.appendChild(fr);
  }
  function openLink(href) {
    href = String(href || "").trim();
    if (/^mailto:/i.test(href)) {
      var addr = decodeURIComponent(href.slice(7).split("?")[0]);
      return showCompose({ to: addr });
    }
    if (!/^https?:\/\//i.test(href)) return;
    try { G.open(href, "_blank", "noopener"); } catch (e) {}
  }

  function setFlags(id, patch, quiet) {
    return api("POST", "/message/" + encodeURIComponent(id), patch).then(function (j) {
      st.list.forEach(function (m) { if (m.id === id) { for (var k in patch) m[k] = patch[k]; } });
      if (patch.read === true && st.folder === "inbox" && st.unread > 0) st.unread--;
      if (patch.read === false && st.folder === "inbox") st.unread++;
      notifyBadge();
      return j;
    }).catch(function (e) { if (!quiet) toast(errText(e)); throw e; });
  }
  function messageAction(a, m) {
    if (a === "reply" || a === "replyall") return showCompose(replyDraft(m, a === "replyall"));
    if (a === "star") {
      return setFlags(m.id, { starred: !m.starred }).then(function () { m.starred = !m.starred; renderMessage(st.view.full); });
    }
    if (a === "unread") {
      return setFlags(m.id, { read: false }).then(function () { toast("Marked as unread"); st.view = null; showList(false); });
    }
    var to = { archive: "archived", trash: "trash", spam: "spam", inbox: "received" }[a];
    if (!to) return;
    setFlags(m.id, { status: to }).then(function () {
      if (!m.read && st.folder === "inbox" && to !== "received" && st.unread > 0) st.unread--;
      st.list = st.list.filter(function (x) { return x.id !== m.id; });
      st.total = Math.max(0, st.total - 1);
      toast({ archived: "Archived", trash: "Moved to trash", spam: "Reported as spam", received: "Moved to inbox" }[to]);
      st.view = null; showList(false);
    }, function () {});
  }

  function openAttachment(msgId, attId, btn) {
    if (btn) btn.disabled = true;
    api("GET", "/message/" + encodeURIComponent(msgId) + "/attachment/" + encodeURIComponent(attId)).then(function (j) {
      if (btn) btn.disabled = false;
      var P = G.Capacitor && G.Capacitor.Plugins;
      var name = String(j.filename || "attachment").replace(/[\/\\:*?"<>|]+/g, "_").slice(0, 120) || "attachment";
      if (G.SMD_IS_NATIVE && P && P.Filesystem && P.Filesystem.writeFile && P.Share && P.Share.share) {
        return P.Filesystem.writeFile({ path: name, data: j.base64, directory: "CACHE" }).then(function (r) {
          return P.Share.share({ title: name, files: [r.uri], dialogTitle: "Open or save attachment" });
        });
      }
      var bin = atob(j.base64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: j.type || "application/octet-stream" }));
      var a = D.createElement("a"); a.href = url; a.download = name; D.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }).catch(function (e) { if (btn) btn.disabled = false; if (e && /cancel/i.test(String(e.message))) return; toast(errText(e)); });
  }

  /* ---------- compose ---------- */
  function own(addr) { return parseAddr(addr).email.toLowerCase() === String(st.address || "").toLowerCase(); }
  function replyDraft(m, all) {
    var subj = m.subject || "";
    if (!/^re:/i.test(subj)) subj = "Re: " + subj;
    var to = m.direction === "outbound" ? splitList(m.to) : [m.from];
    var cc = [];
    if (all) {
      to = to.concat(splitList(m.to)).filter(function (a) { return !own(a); });
      cc = splitList(m.cc).filter(function (a) { return !own(a); });
    }
    var seen = {};
    to = to.filter(function (a) { var k = parseAddr(a).email.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
    cc = cc.filter(function (a) { var k = parseAddr(a).email.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
    var quoted = String(m.textBody || m.snippet || "").split(/\r?\n/).map(function (l) { return "> " + l; }).join("\n");
    var text = "\n\nOn " + when(m.createdAt, true) + ", " + (m.fromName || parseAddr(m.from).name || parseAddr(m.from).email) + " wrote:\n" + quoted;
    return { to: to.join(", "), cc: cc.join(", "), subject: subj, text: text, replyToId: m.id, from: st.view && st.view.row };
  }
  function showCompose(d) {
    if (!ov) return;
    st.view = { kind: "compose", from: d.from || null };
    var title = d.replyToId ? "Reply" : "New message";
    ov.innerHTML = shell(title, "From " + (st.address || "hello@maiknowledge.com"), ib("back", "close", "Discard"), '<button class="mm-send" data-send="1">' + svg("send").replace('width="20" height="20"', 'width="18" height="18"') + "Send</button>", false);
    wireBar();
    var body = $(".mm-body");
    body.innerHTML = '<div class="mm-form">' +
      '<label for="mmTo">To</label><input id="mmTo" type="email" multiple autocomplete="email" autocapitalize="off" value="' + esc(d.to || "") + '">' +
      '<label for="mmCc">Cc</label><input id="mmCc" type="email" multiple autocapitalize="off" value="' + esc(d.cc || "") + '">' +
      '<label for="mmSubj">Subject</label><input id="mmSubj" type="text" value="' + esc(d.subject || "") + '">' +
      '<label for="mmText">Message</label><textarea id="mmText"></textarea></div>';
    var ta = body.querySelector("#mmText"); ta.value = d.text || "";
    var sendBtn = $("[data-send]");
    sendBtn.addEventListener("click", function () {
      var payload = { to: body.querySelector("#mmTo").value, cc: body.querySelector("#mmCc").value, subject: body.querySelector("#mmSubj").value, text: ta.value };
      if (d.replyToId) payload.replyToId = d.replyToId;
      sendBtn.disabled = true;
      api("POST", "/send", payload).then(function () {
        toast("Sent");
        st.view = null; showList(st.folder === "sent");
      }).catch(function (e) { sendBtn.disabled = false; toast(errText(e)); });
    });
    var first = d.to ? ta : body.querySelector("#mmTo");
    try { first.focus(); if (first === ta) ta.setSelectionRange(0, 0); } catch (e) {}
  }

  /* ---------- unread badge for entry points ---------- */
  var badgeListeners = [];
  function notifyBadge() { badgeListeners.forEach(function (fn) { try { fn(st.unread); } catch (e) {} }); }
  function onUnread(fn) { badgeListeners.push(fn); }
  // Fetch the unread count for an entry point that is about to show (More sheet, sidebar).
  function checkUnread() {
    if (!enabled()) return Promise.resolve(0);
    return api("GET", "/status").then(function (s) {
      st.configured = !!s.configured; st.address = s.address || st.address;
      st.unread = Number(s.unread) || 0; notifyBadge(); return st.unread;
    }).catch(function () { return st.unread; });
  }

  G.SMD_MAIL = {
    open: open, close: close, enabled: enabled, isOwner: isOwner, onUnread: onUnread, checkUnread: checkUnread,
    _st: st, _parseAddr: parseAddr, _splitList: splitList, _replyDraft: replyDraft, _version: 1
  };
  G.SMD_openMail = open;
})(typeof window !== "undefined" ? window : this);
