/* StewardMD - owner Mail (window.SMD_MAIL): the hello@maiknowledge.com mailbox inside the app.
 *
 * Owner-only. Reads, files and sends mail through /api/mail/* (functions/api/mail/[[path]].js), which
 * proxies the Mailflare deployment with a server-held API key. Changes made here (read, star, archive,
 * trash, spam, send) are made in Mailflare itself, so the web dashboard and this screen always agree.
 * While open, the current folder refreshes every 20 s (and on returning to the app).
 *
 * Layout: one list pane and one detail pane. From 900 px wide (iPad) both show side by side, like Mail
 * on iPad; narrower (iPhone) the detail pane replaces the list. Message actions sit in a toolbar outside
 * the scrolling message, at the bottom on a phone and under the header on a tablet.
 *
 * Message HTML is drawn in a sandboxed iframe with no script permission and a CSP that blocks every
 * request except images. WebKit (iOS) never runs event listeners on a document whose sandbox forbids
 * scripts, not even listeners this page adds, so nothing inside the frame may be relied on: the frame
 * takes no touches (pointer-events:none), this page sizes it to its content with a ResizeObserver, and a
 * tap on it is mapped to the link under the finger with elementFromPoint. The whole message therefore
 * scrolls as one page and links still open outside the app.
 *
 * Compose: rich text (contenteditable + execCommand), plain-text alternative, attachments (Mailflare
 * limits: 10 files, 10 MB each, 20 MB in all), forward with the original's files (copied server side),
 * send later, Bcc, an owner-editable signature and drafts. Signature, drafts and the times of scheduled
 * mail live in this device's localStorage only (Mailflare v1 has no draft or schedule-time API).
 *
 * Flag: smd_mail (default ON for owners; ?mail=0 or localStorage smd_mail="0" hides it). Server kill
 * switch: MAIL_ON=0. Buildless ES5.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var BASE = "/api/mail";
  // Mirrors MAIL_ACCOUNTS in functions/api/mail/[[path]].js (owner decision 2026-10-03: these three
  // only, never stewardmd.in@gmail.com). This only hides the entry point; the server is the gate.
  var OWNERS = ["drmanojkurmana@gmail.com", "mkkmanojkumar0@gmail.com", "kdiwakar45@gmail.com"];
  var FOLDERS = [["inbox", "Inbox"], ["drafts", "Drafts"], ["scheduled", "Scheduled"], ["sent", "Sent"], ["archive", "Archive"], ["spam", "Spam"], ["trash", "Trash"]];
  var POLL_MS = 20000;
  var LIMIT = { files: 10, file: 10 * 1024 * 1024, total: 20 * 1024 * 1024 };
  var LS_DRAFTS = "smd_mail_drafts", LS_SIG = "smd_mail_sig", LS_SCHED = "smd_mail_sched";
  var ERR = {
    "forbidden": "Owner sign-in required.",
    "not-configured": "Mail is not connected yet.",
    "mailbox-not-found": "The mailbox was not found on the mail server.",
    "mail-key-rejected": "The mail server rejected the API key. Check its read and send scopes in Mailflare.",
    "mail-permission": "The mail server would not make this change. The Mailflare API key needs send access and full access to this mailbox.",
    "mail-server-unreachable": "The mail server could not be reached. Check your connection and try again.",
    "mail-server-error": "The mail server had a problem. Try again in a moment.",
    "offline": "No connection. Check your network and try again.",
    "not-found": "This message is no longer in the mailbox. Refresh the list.",
    "to-required": "Add at least one recipient.",
    "subject-required": "Add a subject.",
    "body-required": "Write a message or attach a file.",
    "body-too-large": "This message is too long to send.",
    "attachment-too-large": "This attachment is too large to open in the app.",
    "too-many-attachments": "A message can carry up to 10 attachments.",
    "attachment-file-too-large": "Each attachment must be 10 MB or smaller.",
    "attachments-too-large": "Attachments can add up to 20 MB at most.",
    "bad-attachment": "An attachment could not be read. Remove it and attach it again.",
    "attachment-unavailable": "A file from the original message could not be fetched. Remove it and try again.",
    "bad-schedule": "Pick a valid date and time.",
    "schedule-in-past": "Pick a time at least a minute from now.",
    "schedule-too-far": "Mail can be scheduled up to a year ahead.",
    "network_lost": "The app lost its network connection. Close and reopen StewardMD, then try again."
  };

  var st = { open: false, folder: "inbox", list: [], total: 0, unread: 0, loading: false, view: null, timer: null, address: "", configured: null, seq: 0, q: "", searching: false, sel: null, busy: {} };

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
      return G.fetch(BASE + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" })
        .catch(function (e) { if (e && e.code) throw e; var x = new Error("offline"); x.code = "offline"; throw x; });
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = null; }
        if (!r.ok || !j) { var c = (j && typeof j.error === "string" && j.error) || ("http-" + r.status); var e = new Error(c); e.code = c; throw e; }
        return j;
      });
    });
  }
  // Known codes read as written above. Mailflare's own refusals arrive as plain sentences ("A message
  // can include at most 10 attachments"); those are shown as they are. Anything else gets a retry line.
  function errText(e) {
    var c = String((e && (e.code || e.message)) || "");
    if (ERR[c]) return ERR[c];
    if (/\s/.test(c) && c.length < 240 && !/^http-/.test(c)) return c;
    return "Something went wrong. Try again.";
  }
  function toast(m) { try { if (G.toast) G.toast(m); } catch (e) {} }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

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
  function initials(s) {
    var w = String(s || "?").replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
    return ((w[0] || "?").charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toUpperCase();
  }
  function when(iso, full) {
    var d = new Date(iso); if (isNaN(d)) return "";
    var now = new Date();
    if (full) return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  // "Saturday 4 October at 8:00 AM, India Standard Time" in the device's own time zone.
  function tzName(d) {
    try {
      var p = new Intl.DateTimeFormat(undefined, { timeZoneName: "long" }).formatToParts(d).filter(function (x) { return x.type === "timeZoneName"; })[0];
      return p ? p.value : "";
    } catch (e) { return ""; }
  }
  function sendTime(d, withZone) {
    d = new Date(d); if (isNaN(d)) return "";
    var s = d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    var z = withZone ? tzName(d) : "";
    return z ? s + ", " + z : s;
  }
  function size(n) { n = Number(n) || 0; return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  var ICON = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    reply: '<path d="M9 17l-5-5 5-5"/><path d="M4 12h11a5 5 0 015 5v2"/>',
    replyall: '<path d="M7 17l-5-5 5-5"/><path d="M12 17l-5-5 5-5"/><path d="M7 12h8a5 5 0 015 5v2"/>',
    forward: '<path d="M15 17l5-5-5-5"/><path d="M20 12H9a5 5 0 00-5 5v2"/>',
    archive: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    unread: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
    star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    spam: '<circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6z"/>',
    clip: '<path d="M21.4 11.1l-9.2 9.2a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8l8.5-8.5"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
    ul: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    ol: '<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6 19H4c0-1.2 2-1.8 2-3 0-.7-.6-1-1.2-1-.5 0-.8.2-.8.5"/>',
    quote: '<path d="M7 7H4v6h4v-1c0 2.5-1 4-3 5"/><path d="M17 7h-3v6h4v-1c0 2.5-1 4-3 5"/>',
    link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
    unlink: '<path d="M18.8 13.3l1.7-1.8a5 5 0 00-7-7l-1.8 1.7"/><path d="M5.2 10.7l-1.7 1.8a5 5 0 007 7l1.8-1.7"/><path d="M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
    eraser: '<path d="M7 21l-4.3-4.3a1 1 0 010-1.4l10-10a1 1 0 011.4 0l5.6 5.6a1 1 0 010 1.4L11 21"/><path d="M22 21H7"/><path d="M5 11l9 9"/>',
    textcolor: '<path d="M6 16l6-12 6 12"/><path d="M8.5 11h7"/>'
  };
  function svg(n, filled, px) { px = px || 20; return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="' + (filled ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICON[n] || "") + "</svg>"; }

  var CSS = [
    "#smdMail{--mbg:#F8FAFC;--mpanel:#fff;--mbd:#E2E8F0;--mink:#0F172A;--mmut:#64748B;--mp:#0F766E;--mps:#CCFBF1;--msel:#E6F4F1;--mpress:#EEF2F6;--mstar:#B45309;--mdanger:#B42318;--mshade:rgba(15,23,42,.42);--mfont:'Inter',-apple-system,'SF Pro Text','Segoe UI',Roboto,system-ui,sans-serif;--mease:cubic-bezier(.23,1,.32,1);--mdrawer:cubic-bezier(.32,.72,0,1);color-scheme:light;position:fixed;inset:0;z-index:100000;background:var(--mbg);color:var(--mink);font-family:var(--mfont);display:flex;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}",
    "body.dark #smdMail{--mbg:#0B1220;--mpanel:#111B2E;--mbd:#1E2B43;--mink:#E7EDF5;--mmut:#8FA1B7;--mps:#0c2e2a;--mp:#2DD4BF;--msel:#123236;--mpress:#18253B;--mstar:#FBBF24;--mdanger:#F97066;--mshade:rgba(0,0,0,.6);color-scheme:dark}",
    "#smdMail *{box-sizing:border-box}",
    "#smdMail ::selection{background:var(--mps)}",
    "#smdMail .mm-pane{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--mbg)}",
    "#smdMail .mm-lp{flex:1 1 auto;padding-left:env(safe-area-inset-left,0px)}",
    "#smdMail .mm-rp{display:none;flex:1 1 auto;padding-right:env(safe-area-inset-right,0px)}",
    "#smdMail.mm-det .mm-lp{display:none}#smdMail.mm-det .mm-rp{display:flex}",
    "@media (min-width:900px){#smdMail .mm-lp,#smdMail.mm-det .mm-lp{display:flex;flex:0 0 clamp(320px,34vw,400px);border-right:1px solid var(--mbd)}#smdMail .mm-rp{display:flex}#smdMail .mm-narrow{display:none!important}}",
    "#smdMail .mm-bar{display:flex;align-items:center;gap:4px;min-height:56px;padding:calc(env(safe-area-inset-top,0px) + 6px) 8px 6px;background:var(--mpanel);border-bottom:1px solid var(--mbd);flex:0 0 auto}",
    "#smdMail .mm-t{flex:1;min-width:0;padding:0 4px}#smdMail .mm-t b{display:block;font:700 17px/1.25 var(--mfont);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.01em}#smdMail .mm-t span{display:block;font:500 12.5px/1.3 var(--mfont);color:var(--mmut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#smdMail button{touch-action:manipulation;-webkit-user-select:none;user-select:none;font-family:var(--mfont)}",
    "#smdMail .mm-ib{position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--mink);border-radius:12px;cursor:pointer;flex:0 0 auto;transition:background-color 120ms ease,transform 120ms var(--mease),opacity 120ms ease}",
    "#smdMail .mm-ib:active{background:var(--mpress);transform:scale(.94)}#smdMail .mm-ib.on{color:var(--mstar)}#smdMail .mm-ib[aria-busy=true]{opacity:.45;pointer-events:none}#smdMail .mm-ib.danger{color:var(--mdanger)}",
    "#smdMail .mm-ib.spin svg{animation:mmSpin .8s linear infinite}@keyframes mmSpin{to{transform:rotate(360deg)}}",
    "@media (hover:hover) and (pointer:fine){#smdMail .mm-ib:hover{background:var(--mpress)}#smdMail .mm-row:hover{background:var(--mpress)}#smdMail .mm-tab:hover{border-color:var(--mmut)}}",
    "#smdMail :focus-visible{outline:2px solid var(--mp);outline-offset:2px}",
    "#smdMail .mm-tabs{display:flex;gap:6px;padding:8px 10px;overflow-x:auto;background:var(--mpanel);border-bottom:1px solid var(--mbd);scrollbar-width:none;flex:0 0 auto;overscroll-behavior-x:contain}#smdMail .mm-tabs::-webkit-scrollbar{display:none}",
    "#smdMail .mm-tab{flex:0 0 auto;min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid var(--mbd);background:var(--mbg);color:var(--mink);font:600 13px var(--mfont);cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease}#smdMail .mm-tab.on{background:var(--mp);border-color:var(--mp);color:#fff}body.dark #smdMail .mm-tab.on{color:#04211e}",
    "#smdMail .mm-search{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--mpanel);border-bottom:1px solid var(--mbd);flex:0 0 auto}",
    "#smdMail .mm-sbox{flex:1;display:flex;align-items:center;gap:6px;min-height:40px;padding:0 10px;border-radius:10px;background:var(--mbg);border:1px solid var(--mbd);color:var(--mmut)}#smdMail .mm-sbox input{flex:1;min-width:0;border:0;background:transparent;color:var(--mink);font:400 16px var(--mfont);padding:8px 0;outline:none}",
    "#smdMail .mm-link{border:0;background:transparent;color:var(--mp);font:600 15px var(--mfont);min-height:44px;padding:0 6px;cursor:pointer}",
    "#smdMail .mm-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}",
    "#smdMail .mm-list{padding-bottom:env(safe-area-inset-bottom,0px)}#smdMail .mm-msg{background:var(--mpanel)}",
    "#smdMail .mm-row{display:flex;gap:10px;width:100%;text-align:left;padding:12px 14px 12px 10px;border:none;border-bottom:1px solid var(--mbd);background:var(--mpanel);color:var(--mink);cursor:pointer;-webkit-user-select:none;user-select:none;transition:background-color 120ms ease}",
    "#smdMail .mm-row:active{background:var(--mpress)}#smdMail .mm-row.sel{background:var(--msel)}",
    "#smdMail .mm-dot{width:9px;height:9px;border-radius:50%;margin-top:6px;flex:0 0 auto;background:transparent}#smdMail .mm-row.unread .mm-dot{background:var(--mp)}",
    "#smdMail .mm-main{flex:1;min-width:0}#smdMail .mm-l1{display:flex;gap:8px;align-items:baseline}#smdMail .mm-from{flex:1;min-width:0;font:600 15px/1.3 var(--mfont);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#smdMail .mm-row.unread .mm-from{font-weight:800}",
    "#smdMail .mm-time{font:500 12.5px var(--mfont);color:var(--mmut);flex:0 0 auto;font-variant-numeric:tabular-nums}#smdMail .mm-sub{display:block;font:600 14px/1.35 var(--mfont);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#smdMail .mm-row:not(.unread) .mm-sub{font-weight:500}",
    "#smdMail .mm-snip{font:400 13.5px/1.4 var(--mfont);color:var(--mmut);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}#smdMail .mm-st{color:var(--mstar);flex:0 0 auto}",
    "#smdMail .mm-tag{display:inline-flex;align-items:center;gap:4px;font:700 12px var(--mfont);color:var(--mdanger);margin-right:6px}#smdMail .mm-tag.sch{color:var(--mp)}",
    "#smdMail .mm-empty{padding:48px 24px;text-align:center;color:var(--mmut);font:500 14px/1.5 var(--mfont)}#smdMail .mm-empty b{display:block;color:var(--mink);font-size:16px;margin-bottom:6px}#smdMail .mm-empty svg{display:block;margin:0 auto 12px;color:var(--mmut)}",
    "#smdMail .mm-more{display:block;margin:14px auto 24px;min-height:44px;padding:8px 22px;border-radius:12px;border:1px solid var(--mbd);background:var(--mpanel);color:var(--mink);font:600 14px var(--mfont);cursor:pointer}",
    "#smdMail .mm-h{padding:18px 18px 14px;background:var(--mpanel);border-bottom:1px solid var(--mbd)}#smdMail .mm-hs{font:700 20px/1.3 var(--mfont);letter-spacing:-.015em;margin-bottom:14px;overflow-wrap:anywhere;text-wrap:balance}",
    "#smdMail .mm-who{display:flex;gap:12px;align-items:flex-start}#smdMail .mm-av{width:40px;height:40px;border-radius:50%;background:var(--mps);color:var(--mp);display:flex;align-items:center;justify-content:center;font:700 14px var(--mfont);flex:0 0 auto}",
    "#smdMail .mm-meta{font:500 13.5px/1.5 var(--mfont);color:var(--mmut);overflow-wrap:anywhere}#smdMail .mm-meta b{color:var(--mink);font-weight:700}#smdMail .mm-date{font:500 13px var(--mfont);color:var(--mmut);font-variant-numeric:tabular-nums}",
    "#smdMail .mm-acts{display:flex;align-items:center;justify-content:space-around;gap:2px;padding:4px 6px calc(4px + env(safe-area-inset-bottom,0px));background:var(--mpanel);border-top:1px solid var(--mbd);order:3;flex:0 0 auto}",
    "#smdMail .mm-rp .mm-bar{order:0}#smdMail .mm-rp .mm-body{order:2}",
    "#smdMail .mm-sp{display:none}",
    "@media (min-width:900px){#smdMail .mm-acts{order:1;justify-content:flex-start;padding:4px 10px;border-top:0;border-bottom:1px solid var(--mbd)}#smdMail .mm-acts .mm-sp{display:block;flex:1}}",
    "#smdMail .mm-note{margin:12px 16px;padding:12px 14px;border-radius:12px;background:var(--mps);color:var(--mink);font:500 14px/1.5 var(--mfont)}",
    "#smdMail .mm-fhost{position:relative;background:#fff;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;cursor:default}#smdMail .mm-frame{display:block;width:100%;max-width:none;border:0;background:#fff;height:120px;pointer-events:none}",
    "#smdMail .mm-text{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px 18px 32px;font:400 16px/1.6 var(--mfont);max-width:72ch;-webkit-user-select:text;user-select:text}",
    "#smdMail .mm-att{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;border-bottom:1px solid var(--mbd);background:var(--mpanel)}",
    "#smdMail .mm-chip{display:flex;align-items:center;gap:6px;min-height:44px;max-width:100%;padding:6px 12px;border-radius:10px;border:1px solid var(--mbd);background:var(--mbg);color:var(--mink);font:600 13.5px var(--mfont);cursor:pointer}#smdMail .mm-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}#smdMail .mm-chip small{color:var(--mmut);font-weight:500;flex:0 0 auto}",
    "#smdMail .mm-chip.rm{cursor:default;padding-right:0}#smdMail .mm-chip .mm-x{width:40px;height:40px;border:0;background:transparent;color:var(--mmut);display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;flex:0 0 auto}",
    "#smdMail .mm-err{margin:12px 16px;padding:10px 12px;border-radius:10px;background:#FEF2F2;color:#991B1B;font:500 14px/1.45 var(--mfont)}body.dark #smdMail .mm-err{background:#3b1414;color:#fecaca}",
    "#smdMail .mm-send{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 16px;border-radius:12px;border:none;background:var(--mp);color:#fff;font:700 15px var(--mfont);cursor:pointer;flex:0 0 auto;transition:transform 120ms var(--mease),opacity 120ms ease}body.dark #smdMail .mm-send{color:#04211e}#smdMail .mm-send:active{transform:scale(.97)}#smdMail .mm-send:disabled{opacity:.55}",
    "#smdMail .mm-fields{background:var(--mpanel)}#smdMail .mm-f{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 16px;border-bottom:1px solid var(--mbd)}",
    "#smdMail .mm-f label{flex:0 0 auto;min-width:58px;font:500 15px var(--mfont);color:var(--mmut)}#smdMail .mm-f input{flex:1;min-width:0;border:0;background:transparent;color:var(--mink);font:400 16px var(--mfont);padding:12px 0;outline:none}",
    "#smdMail .mm-f.bad{box-shadow:inset 3px 0 0 var(--mdanger)}#smdMail .mm-ferr{padding:6px 16px 8px;font:600 13px var(--mfont);color:var(--mdanger);background:var(--mpanel);border-bottom:1px solid var(--mbd)}",
    "#smdMail .mm-ccb{flex:1;text-align:left;border:0;background:transparent;color:var(--mmut);font:500 15px var(--mfont);min-height:48px;padding:0;cursor:pointer}",
    "#smdMail .mm-fmt{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:2px;padding:4px 8px;background:var(--mpanel);border-bottom:1px solid var(--mbd);overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain}#smdMail .mm-fmt::-webkit-scrollbar{display:none}",
    "#smdMail .mm-fb{min-width:40px;height:40px;padding:0 8px;display:flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:transparent;color:var(--mink);font:600 16px var(--mfont);cursor:pointer;flex:0 0 auto;transition:background-color 100ms ease}#smdMail .mm-fb:active{background:var(--mpress)}#smdMail .mm-fb[aria-pressed=true]{background:var(--msel);color:var(--mp)}",
    "#smdMail .mm-fsep{width:1px;height:22px;background:var(--mbd);margin:0 4px;flex:0 0 auto}",
    "#smdMail .mm-fsel{height:36px;border:1px solid var(--mbd);border-radius:9px;background:var(--mbg);color:var(--mink);font:500 15px var(--mfont);padding:0 8px;flex:0 0 auto}",
    "#smdMail .mm-fcol{position:relative;overflow:hidden}#smdMail .mm-fcol input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0}#smdMail .mm-fcol i{position:absolute;left:11px;right:11px;bottom:7px;height:3px;border-radius:2px;background:var(--mcol,#D92D20)}",
    "#smdMail .mm-catts{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px 0}#smdMail .mm-catts:empty{display:none}",
    "#smdMail .mm-editor{min-height:220px;padding:14px 16px 24px;font:400 16px/1.6 var(--mfont);color:var(--mink);outline:none;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}#smdMail .mm-editor:empty:before{content:attr(data-ph);color:var(--mmut)}",
    "#smdMail .mm-editor blockquote{margin:0 0 0 2px;padding-left:12px;border-left:2px solid var(--mbd);color:var(--mmut)}#smdMail .mm-editor a{color:var(--mp)}#smdMail .mm-editor ul,#smdMail .mm-editor ol{padding-left:24px}",
    "#smdMail .mm-quote{margin:0 16px 24px;border-top:1px solid var(--mbd);padding-top:10px}#smdMail .mm-quote>div{font:600 13px/1.5 var(--mfont);color:var(--mmut);margin-bottom:8px}#smdMail .mm-quote .mm-fhost{border:1px solid var(--mbd);border-radius:10px}",
    "#smdMail .mm-schip{display:flex;align-items:center;gap:8px;margin:10px 16px 0;padding:8px 8px 8px 12px;border-radius:10px;background:var(--mps);color:var(--mink);font:600 13.5px/1.4 var(--mfont)}#smdMail .mm-schip span{flex:1}",
    "#smdMail .mm-set{padding:16px;display:flex;flex-direction:column;gap:10px;max-width:640px}#smdMail .mm-set label{font:700 13px var(--mfont);color:var(--mmut)}#smdMail .mm-set textarea{width:100%;min-height:140px;padding:12px;border-radius:12px;border:1px solid var(--mbd);background:var(--mpanel);color:var(--mink);font:400 16px/1.5 var(--mfont);resize:vertical}#smdMail .mm-set p{margin:0;color:var(--mmut);font:500 13.5px/1.5 var(--mfont)}#smdMail .mm-set .mm-send{align-self:flex-start}",
    "#smdMail .mm-scrim{position:absolute;inset:0;z-index:5;background:var(--mshade);display:flex;align-items:flex-end;justify-content:center;transition:opacity 200ms ease}",
    "#smdMail .mm-sheet{width:100%;max-width:520px;max-height:90%;overflow-y:auto;background:var(--mpanel);border-radius:18px 18px 0 0;padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -8px 32px rgba(0,0,0,.18);transition:transform 260ms var(--mdrawer),opacity 200ms ease}",
    "#smdMail .mm-scrim.pre{opacity:0}#smdMail .mm-scrim.pre .mm-sheet{transform:translateY(100%)}",
    "@media (min-width:900px){#smdMail .mm-scrim{align-items:center}#smdMail .mm-sheet{border-radius:18px;max-width:440px;padding-bottom:16px}#smdMail .mm-scrim.pre .mm-sheet{transform:scale(.96)}#smdMail .mm-grab{display:none}}",
    "@media (prefers-reduced-motion:reduce){#smdMail .mm-scrim.pre .mm-sheet{transform:none}#smdMail .mm-ib,#smdMail .mm-send{transition:none}}",
    "#smdMail .mm-grab{width:36px;height:5px;border-radius:3px;background:var(--mbd);margin:2px auto 10px}#smdMail .mm-sheet h2{font:700 18px var(--mfont);margin:4px 0 12px}",
    "#smdMail .mm-opt{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;min-height:52px;padding:10px 14px;margin-bottom:8px;border-radius:12px;border:1px solid var(--mbd);background:var(--mbg);color:var(--mink);font:600 15px var(--mfont);cursor:pointer;text-align:left}#smdMail .mm-opt small{color:var(--mmut);font-weight:500;font-variant-numeric:tabular-nums}#smdMail .mm-opt.on{border-color:var(--mp);background:var(--msel)}",
    "#smdMail .mm-sheet input[type=datetime-local]{width:100%;min-height:48px;padding:10px 12px;border-radius:12px;border:1px solid var(--mbd);background:var(--mbg);color:var(--mink);font:400 16px var(--mfont);margin-bottom:10px}",
    "#smdMail .mm-sum{font:500 14px/1.5 var(--mfont);color:var(--mmut);margin:4px 0 14px}#smdMail .mm-sum b{color:var(--mink)}#smdMail .mm-row2{display:flex;gap:10px;justify-content:flex-end}",
    "#smdMail .mm-ghost{min-height:44px;padding:8px 16px;border-radius:12px;border:1px solid var(--mbd);background:transparent;color:var(--mink);font:600 15px var(--mfont);cursor:pointer}",
    "#smdMail code{font-size:12px;background:var(--mbg);padding:1px 4px;border-radius:4px}"
  ].join("\n");

  var ov = null, lp = null, rp = null, prevOverflow = "", prevFocus = null;

  function ensureCss() {
    if (D.getElementById("smdMailCss")) return;
    var s = D.createElement("style"); s.id = "smdMailCss"; s.textContent = CSS; D.head.appendChild(s);
  }
  function wide() { try { return G.matchMedia("(min-width:900px)").matches; } catch (e) { return false; } }

  function open() {
    if (!isOwner()) { toast("Owner access only"); return; }
    if (ov) return;
    ensureCss();
    prevFocus = D.activeElement; prevOverflow = D.body.style.overflow;
    ov = D.createElement("div"); ov.id = "smdMail";
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Mail");
    ov.innerHTML = '<section class="mm-pane mm-lp" aria-label="Mailbox"></section><section class="mm-pane mm-rp" aria-label="Message"></section>';
    lp = ov.firstChild; rp = ov.lastChild;
    D.body.appendChild(ov);
    D.body.style.overflow = "hidden";
    ov.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); back(); } });
    st.open = true; st.view = null; st.sel = null;
    renderListPane();
    showEmptyDetail();
    refresh(false);
    D.addEventListener("visibilitychange", onVisible);
    schedule();
    var c = lp.querySelector(".mm-bar [data-act]"); if (c) c.focus();
  }
  function close() {
    if (st.view && st.view.kind === "compose") saveDraft(true);
    st.open = false; st.view = null;
    if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    D.removeEventListener("visibilitychange", onVisible);
    D.removeEventListener("selectionchange", onSelChange);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    ov = lp = rp = null;
    D.body.style.overflow = prevOverflow;
    try { if (prevFocus && prevFocus.isConnected) prevFocus.focus(); } catch (e) {}
    notifyBadge();
  }
  function back() {
    var sh = ov && ov.querySelector(".mm-scrim"); if (sh) return closeSheet();
    if (!st.view) return close();
    if (st.view.kind === "compose") return closeCompose();
    closeDetail();
  }

  function schedule() {
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(function () {
      st.timer = null;
      if (!st.open) return;
      if (D.visibilityState !== "hidden" && (!st.view || wide())) refresh(true);
      schedule();
    }, POLL_MS);
  }
  function onVisible() { if (st.open && D.visibilityState === "visible" && (!st.view || wide())) refresh(true); }

  function bar(left, title, sub, right) {
    return '<div class="mm-bar">' + left + '<div class="mm-t"><b>' + esc(title) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div>" + right + "</div>";
  }
  function ib(act, icon, label, opts) {
    opts = opts || {};
    return '<button type="button" class="mm-ib' + (opts.on ? " on" : "") + (opts.cls ? " " + opts.cls : "") + '" data-act="' + act + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"' +
      (opts.pressed != null ? ' aria-pressed="' + !!opts.pressed + '"' : "") + ">" + svg(icon, opts.filled) + "</button>";
  }
  function folderName(f) { return (FOLDERS.filter(function (x) { return x[0] === f; })[0] || [0, "Inbox"])[1]; }

  /* ---------- list pane ---------- */
  function renderListPane() {
    if (!lp) return;
    lp.innerHTML = bar(ib("close", "close", "Close mail"), folderName(st.folder), st.address,
        ib("search", "search", "Search mail", { pressed: st.searching }) + ib("refresh", "refresh", "Refresh") + ib("settings", "sliders", "Signature") + ib("compose", "edit", "New message")) +
      (st.searching ? '<div class="mm-search" role="search"><label class="mm-sbox">' + svg("search", false, 18) +
        '<input id="mmQ" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Search ' + esc(folderName(st.folder)) + '\u2026" aria-label="Search ' + esc(folderName(st.folder)) + '" value="' + esc(st.q) + '"></label>' +
        '<button type="button" class="mm-link" data-act="search-cancel">Cancel</button></div>' : "") +
      '<div class="mm-tabs" role="tablist" aria-label="Folders">' + FOLDERS.map(function (f) {
        return '<button type="button" class="mm-tab' + (f[0] === st.folder ? " on" : "") + '" role="tab" aria-selected="' + (f[0] === st.folder) + '" data-folder="' + f[0] + '">' + f[1] + (f[0] === "inbox" && st.unread ? " (" + st.unread + ")" : "") + "</button>";
      }).join("") + "</div>" +
      '<div class="mm-body mm-list" aria-label="' + esc(folderName(st.folder)) + '"></div>';
    lp.querySelectorAll("[data-folder]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-folder"); if (f === st.folder) return;
        st.folder = f; st.list = []; st.total = 0; st.q = ""; st.seq++; st.loading = false;
        if (st.view && st.view.kind === "message") closeDetail(true);
        renderListPane(); refresh(false);
        var t = lp.querySelector('[data-folder="' + f + '"]'); if (t) { t.focus(); if (t.scrollIntoView) t.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      });
    });
    lp.querySelectorAll(".mm-bar [data-act],.mm-search [data-act]").forEach(function (b) {
      b.addEventListener("click", function () { listAction(b.getAttribute("data-act")); });
    });
    var q = lp.querySelector("#mmQ");
    if (q) q.addEventListener("input", function () { st.q = q.value; renderRows(); });
    renderRows();
  }
  function listAction(a) {
    if (a === "close") return close();
    if (a === "refresh") return refresh(false);
    if (a === "compose") return showCompose({ kind: "new" });
    if (a === "settings") return showSettings();
    if (a === "search") {
      st.searching = !st.searching; if (!st.searching) st.q = "";
      renderListPane();
      var q = lp.querySelector("#mmQ"); if (q) q.focus();
      return;
    }
    if (a === "search-cancel") { st.searching = false; st.q = ""; renderListPane(); }
  }
  function setRefreshing(on) { var r = lp && lp.querySelector('.mm-bar [data-act="refresh"]'); if (r) { r.classList.toggle("spin", !!on); r.setAttribute("aria-busy", on ? "true" : "false"); } }

  function refresh(quiet) {
    if (st.folder === "drafts") { st.list = drafts(); st.total = st.list.length; renderRows(); return; }
    if (st.loading) return;
    st.loading = true; if (!quiet) setRefreshing(true);
    var folder = st.folder, seq = ++st.seq;
    // A quiet poll re-reads the first page only and keeps any older pages already loaded below it.
    var pre = st.configured !== true ? api("GET", "/status") : Promise.resolve(null);
    pre.then(function (s) {
      if (s) { st.configured = !!s.configured; st.address = s.address || st.address; }
      if (st.configured === false) throw Object.assign(new Error("not-configured"), { code: "not-configured" });
      return api("GET", "/list?folder=" + folder + "&offset=0");
    }).then(function (j) {
      st.loading = false; setRefreshing(false);
      if (seq !== st.seq || folder !== st.folder) return;
      var fresh = j.messages || [];
      var seen = {}; fresh.forEach(function (m) { seen[m.id] = 1; });
      var older = st.list.slice(fresh.length).filter(function (m) { return !seen[m.id]; });
      st.list = fresh.concat(quiet ? older : []);
      st.total = j.total || 0;
      if (folder === "inbox") st.unread = j.unread || 0;
      updateTabs(); renderRows();
      notifyBadge();
    }).catch(function (e) {
      st.loading = false; setRefreshing(false);
      if (seq !== st.seq) return;
      if (!quiet) { if (st.list.length && e.code !== "not-configured") toast(errText(e)); else renderError(e); }
    });
  }
  function loadMore(btn) {
    if (st.loading) return;
    st.loading = true; if (btn) { btn.disabled = true; btn.textContent = "Loading\u2026"; }
    var folder = st.folder;
    api("GET", "/list?folder=" + folder + "&offset=" + st.list.length).then(function (j) {
      st.loading = false;
      if (folder !== st.folder) return;
      var have = {}; st.list.forEach(function (m) { have[m.id] = 1; });
      st.list = st.list.concat((j.messages || []).filter(function (m) { return !have[m.id]; }));
      st.total = j.total || st.total;
      renderRows();
    }).catch(function (e) { st.loading = false; if (btn) { btn.disabled = false; btn.textContent = "Try again"; } toast(errText(e)); });
  }
  function updateTabs() {
    var t = lp && lp.querySelector('[data-folder="inbox"]'); if (t) t.textContent = "Inbox" + (st.unread ? " (" + st.unread + ")" : "");
    var s = lp && lp.querySelector(".mm-bar .mm-t span"); if (s) s.textContent = st.address;
  }
  function renderError(e) {
    var body = lp && lp.querySelector(".mm-list"); if (!body) return;
    if ((e && e.code) === "not-configured") {
      body.innerHTML = '<div class="mm-empty"><b>Mail is not connected yet</b>Create an API key in Mailflare (Settings, API keys) and add these Cloudflare Pages secrets to the stewardmd project: <code>MAILFLARE_URL</code> and <code>MAILFLARE_API_KEY</code>. The mailbox shown is <code>' + esc(st.address || "hello@maiknowledge.com") + "</code>.</div>";
      return;
    }
    body.innerHTML = '<div class="mm-err" role="alert">' + esc(errText(e)) + '</div><button type="button" class="mm-more" data-retry="1">Try again</button>';
    var r = body.querySelector("[data-retry]"); if (r) r.addEventListener("click", function () { st.configured = null; refresh(false); });
  }
  function matches(m, q) {
    if (!q) return true;
    return [m.from, m.to, m.cc, m.subject, m.snippet].join(" ").toLowerCase().indexOf(q) >= 0;
  }
  function renderRows() {
    var body = lp && lp.querySelector(".mm-list"); if (!body) return;
    var q = st.q.trim().toLowerCase();
    var rows = st.list.filter(function (m) { return matches(m, q); });
    var more = st.folder !== "drafts" && st.list.length < st.total;
    if (!rows.length) {
      if (q) body.innerHTML = '<div class="mm-empty">' + svg("search", false, 28) + "<b>No results</b>Nothing loaded in " + esc(folderName(st.folder)) + " matches “" + esc(st.q.trim()) + "”.</div>" +
        (more ? '<button type="button" class="mm-more" data-more="1">Search older mail</button>' : "");
      else if (st.loading || (st.configured === null && st.folder !== "drafts")) body.innerHTML = '<div class="mm-empty" role="status">Loading mail\u2026</div>';
      else body.innerHTML = '<div class="mm-empty">' + svg(st.folder === "drafts" ? "edit" : st.folder === "scheduled" ? "clock" : "mail", false, 28) + "<b>" + ({ drafts: "No drafts", scheduled: "Nothing scheduled" }[st.folder] || "Nothing here") + "</b>" +
        ({ drafts: "Messages you start and close are kept here on this device.", scheduled: "Use Send later in a new message to schedule it." }[st.folder] || "No messages in this folder.") + "</div>";
    } else {
      var sent = st.folder === "sent" || st.folder === "scheduled" || st.folder === "drafts";
      var sched = lsGet(LS_SCHED, {});
      body.innerHTML = rows.map(function (m) {
        var tag = st.folder === "drafts" ? '<span class="mm-tag">Draft</span>' :
          st.folder === "scheduled" ? '<span class="mm-tag sch">' + svg("clock", false, 13) + (sched[m.id] ? "Sends " + esc(sendTime(sched[m.id])) : "Scheduled") + "</span>" : "";
        var t = st.folder === "drafts" ? m.savedAt : m.createdAt;
        return '<button type="button" class="mm-row' + (!m.read && !sent ? " unread" : "") + (st.sel === m.id ? " sel" : "") + '" data-id="' + esc(m.id) + '"' + (st.sel === m.id ? ' aria-current="true"' : "") + ">" +
          '<span class="mm-dot" aria-hidden="true"></span><span class="mm-main"><span class="mm-l1"><span class="mm-from">' + esc(sent ? "To: " + (who(m.to) === "(unknown)" ? "(no recipient)" : who(m.to)) : who(m.from)) + "</span>" +
          (m.starred ? '<span class="mm-st" aria-label="Starred">' + svg("star", true, 14) + "</span>" : "") +
          '<span class="mm-time">' + esc(when(t)) + "</span></span>" +
          '<span class="mm-sub">' + tag + esc(m.subject || "(no subject)") + "</span>" +
          '<span class="mm-snip">' + esc(m.snippet || "") + "</span></span></button>";
      }).join("") + (more ? '<button type="button" class="mm-more" data-more="1">' + (q ? "Search older mail" : "Load more") + "</button>" : "");
      body.querySelectorAll(".mm-row").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-id");
          var m = st.list.filter(function (x) { return x.id === id; })[0];
          if (!m) return;
          if (st.folder === "drafts") showCompose(m); else showMessage(m);
        });
      });
    }
    var mb = body.querySelector("[data-more]"); if (mb) mb.addEventListener("click", function () { loadMore(mb); });
  }
  function markSel() {
    if (!lp) return;
    lp.querySelectorAll(".mm-row").forEach(function (r) {
      var on = r.getAttribute("data-id") === st.sel;
      r.classList.toggle("sel", on);
      if (on) r.setAttribute("aria-current", "true"); else r.removeAttribute("aria-current");
    });
  }
  function rowById(id) { return st.list.filter(function (x) { return x.id === id; })[0]; }

  /* ---------- detail pane ---------- */
  function showEmptyDetail() {
    if (!rp) return;
    rp.innerHTML = '<div class="mm-body"><div class="mm-empty" style="padding-top:22vh">' + svg("mail", false, 36) + "<b>No message selected</b>Choose a message from the list, or start a new one.</div></div>";
  }
  function closeDetail(keepFocus) {
    st.view = null; st.sel = null;
    if (!ov) return;
    ov.classList.remove("mm-det");
    D.removeEventListener("selectionchange", onSelChange);
    showEmptyDetail(); markSel();
    if (!keepFocus) { var b = lp && (lp.querySelector(".mm-row") || lp.querySelector(".mm-bar [data-act]")); try { if (b) b.focus(); } catch (e) {} }
  }
  function enterDetail() {
    ov.classList.add("mm-det");
    var l = lp.querySelector(".mm-list"), keep = l ? l.scrollTop : 0;
    return function () { if (l) l.scrollTop = keep; };
  }

  /* ---------- message ---------- */
  function showMessage(row) {
    if (!ov) return;
    if (st.view && st.view.kind === "compose") saveDraft(true);
    st.view = { kind: "message", row: row, full: null };
    st.sel = row.id; markSel();
    enterDetail();
    rp.innerHTML = bar('<button type="button" class="mm-ib mm-narrow" data-act="back" aria-label="Back to ' + esc(folderName(st.folder)) + '" title="Back">' + svg("back") + "</button>", folderName(st.folder), "", "") +
      '<div class="mm-acts" role="toolbar" aria-label="Message actions"></div><div class="mm-body mm-msg"><div class="mm-empty" role="status">Opening message\u2026</div></div>';
    rp.querySelector('[data-act="back"]').addEventListener("click", function () { closeDetail(); });
    var bk = rp.querySelector('[data-act="back"]'); if (!wide()) try { bk.focus(); } catch (e) {}
    api("GET", "/message/" + encodeURIComponent(row.id)).then(function (j) {
      if (!st.view || st.view.row !== row) return;
      st.view.full = j;
      renderMessage(j);
      if (!j.message.read && j.message.direction === "inbound") {
        // Marked read on the server first; the row and the unread count follow only when it took.
        setFlags(row.id, { read: true }).then(function () {
          if (st.folder === "inbox" && st.unread > 0) st.unread--;
          j.message.read = true; updateTabs(); renderRows(); notifyBadge();
        }, function () {});
      }
    }).catch(function (e) {
      if (!st.view || st.view.row !== row) return;
      var b = rp.querySelector(".mm-msg"); if (b) b.innerHTML = '<div class="mm-err" role="alert">' + esc(errText(e)) + '</div><button type="button" class="mm-more" data-retry="1">Try again</button>';
      var r = rp.querySelector("[data-retry]"); if (r) r.addEventListener("click", function () { showMessage(row); });
    });
  }
  function actsFor(m) {
    var f = st.folder;
    if (f === "scheduled") return [["forward", "forward", "Forward"]];
    var a = [["reply", "reply", "Reply"]];
    if (splitList(m.to).length + splitList(m.cc).length > 1) a.push(["replyall", "replyall", "Reply all"]);
    a.push(["forward", "forward", "Forward"]);
    a.push(["sp"]);
    a.push(["star", "star", m.starred ? "Remove star" : "Star", { on: m.starred, filled: m.starred, pressed: !!m.starred }]);
    if (m.direction === "inbound") a.push(["unread", "unread", "Mark as unread"]);
    if (f !== "inbox" && m.direction === "inbound") a.push(["inbox", "inbox", "Move to inbox"]);
    if (f !== "archive" && f !== "sent") a.push(["archive", "archive", "Archive"]);
    if (f !== "spam" && m.direction === "inbound") a.push(["spam", "spam", "Report spam"]);
    if (f !== "trash") a.push(["trash", "trash", "Move to trash", { cls: "danger" }]);
    return a;
  }
  function renderActs(m) {
    var host = rp && rp.querySelector(".mm-acts"); if (!host) return;
    host.innerHTML = actsFor(m).map(function (x) { return x[0] === "sp" ? '<span class="mm-sp" aria-hidden="true"></span>' : ib(x[0], x[1], x[2], x[3]); }).join("");
    if (st.busy[m.id]) host.querySelectorAll("[data-act]").forEach(function (b) { b.setAttribute("aria-busy", "true"); });
    host.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () { messageAction(b.getAttribute("data-act"), m, b); });
    });
  }
  function renderMessage(j) {
    var m = j.message, body = rp && rp.querySelector(".mm-msg"); if (!body) return;
    renderActs(m);
    var fromP = parseAddr(m.from), name = m.fromName || fromP.name || fromP.email;
    var files = (j.attachments || []).filter(function (a) { return a.disposition !== "inline"; });
    var sched = st.folder === "scheduled" ? lsGet(LS_SCHED, {})[m.id] : null;
    body.innerHTML = '<div class="mm-h"><h1 class="mm-hs">' + esc(m.subject || "(no subject)") + "</h1>" +
      '<div class="mm-who"><span class="mm-av" aria-hidden="true">' + esc(initials(name)) + '</span><div style="flex:1;min-width:0">' +
      '<div class="mm-meta"><b>' + esc(name) + "</b> " + (fromP.name || m.fromName ? "&lt;" + esc(fromP.email) + "&gt;" : "") + "</div>" +
      '<div class="mm-meta">To: ' + esc(splitList(m.to).join(", ")) + "</div>" +
      (m.cc ? '<div class="mm-meta">Cc: ' + esc(splitList(m.cc).join(", ")) + "</div>" : "") +
      (m.bcc ? '<div class="mm-meta">Bcc: ' + esc(splitList(m.bcc).join(", ")) + "</div>" : "") +
      '<div class="mm-date">' + esc(when(m.createdAt, true)) + "</div></div></div></div>" +
      (st.folder === "scheduled" ? '<div class="mm-note" role="note"><b>Scheduled' + (sched ? " for " + esc(sendTime(sched, true)) : "") + ".</b> Mailflare cannot cancel or change a scheduled message yet, so it will go out as written.</div>" : "") +
      (files.length ? '<div class="mm-att">' + files.map(function (a) {
        return '<button type="button" class="mm-chip" data-att="' + esc(a.id) + '" aria-label="Open attachment ' + esc(a.filename) + ", " + size(a.size) + '">' + svg("clip", false, 16) + "<span>" + esc(a.filename) + "</span><small>" + size(a.size) + "</small></button>";
      }).join("") + "</div>" : "") +
      '<div class="mm-content"></div>';
    var content = body.querySelector(".mm-content");
    if (m.htmlBody) drawHtml(content, m.htmlBody); else content.innerHTML = '<div class="mm-text">' + esc(m.textBody || m.snippet || "") + "</div>";
    body.querySelectorAll("[data-att]").forEach(function (b) {
      b.addEventListener("click", function () { openAttachment(m.id, b.getAttribute("data-att"), b); });
    });
  }

  /* Draw mail HTML in a sandbox and size the frame to it. See the header comment for why nothing is
   * registered inside the frame. Wide mail is scaled to fit the width (like Mail on iOS) instead of
   * scrolling sideways, so the page never scrolls horizontally. */
  function drawHtml(host, html) {
    var wrap = D.createElement("div"); wrap.className = "mm-fhost";
    var fr = D.createElement("iframe");
    fr.className = "mm-frame"; fr.title = "Message body";
    fr.setAttribute("sandbox", "allow-same-origin");
    fr.setAttribute("referrerpolicy", "no-referrer");
    fr.setAttribute("scrolling", "no");
    fr.setAttribute("tabindex", "-1");
    var head = '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data: cid:; style-src \'unsafe-inline\'; font-src https: data:">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">' +
      "<style>html,body{margin:0!important;padding:0!important;background:#fff;color:#111;overflow:hidden!important;height:auto!important;min-height:0!important;max-height:none!important}" +
      "#mmw{box-sizing:border-box;padding:16px 18px 28px;font:16px/1.55 -apple-system,system-ui,sans-serif;overflow-wrap:anywhere;display:flow-root}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}" +
      "blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ccc;color:#555}a{color:#0F766E}</style>";
    fr.srcdoc = "<!doctype html><html><head>" + head + '</head><body><div id="mmw">' + html + "</div></body></html>";
    var doc = null, inner = null, scale = 1, natW = 0, grows = 0, widens = 0, lastH = 0, ro = null;
    function fit() {
      if (!fr.isConnected) { if (ro) ro.disconnect(); return; }
      try {
        var W = wrap.clientWidth; if (!W) return;
        var sw = Math.max(inner.scrollWidth, doc.documentElement.scrollWidth);
        if (sw > natW + 1 && sw > W + 1 && ++widens < 12) natW = sw;
        // Fit to the width like Mail does, but never below 60 % (text stays readable); past that the
        // body scrolls sideways inside its own box, never the page.
        var s = natW > W + 1 ? Math.max(W / natW, 0.6) : 1;
        if (s !== scale) {
          scale = s;
          if (s < 1) { inner.style.width = natW + "px"; inner.style.transformOrigin = "0 0"; inner.style.transform = "scale(" + s + ")"; fr.style.width = Math.ceil(natW * s) + "px"; }
          else { inner.style.width = ""; inner.style.transform = ""; fr.style.width = ""; }
        }
        var h = Math.ceil(Math.max(inner.offsetHeight, inner.scrollHeight) * scale);
        // ponytail: mail sized in vh grows with the frame it sits in; stop growing after 40 rounds and
        // cap at 60000 px rather than chase it. A real fix would need scripts inside the frame.
        if (h > lastH && ++grows > 40) return;
        h = Math.min(Math.max(h, 60), 60000);
        if (Math.abs(h - lastH) > 1) { lastH = h; fr.style.height = h + "px"; }
      } catch (e) {}
    }
    fr.addEventListener("load", function () {
      try {
        doc = fr.contentDocument; inner = doc.getElementById("mmw");
        if (!inner) return;
        [].forEach.call(doc.images || [], function (im) { try { im.loading = "eager"; } catch (e) {} });
        fit();
        if (G.ResizeObserver) { ro = new G.ResizeObserver(function () { G.requestAnimationFrame(fit); }); ro.observe(inner); ro.observe(wrap); }
        else { setTimeout(fit, 300); setTimeout(fit, 1500); G.addEventListener("resize", fit); }
      } catch (e) {}
    });
    // The frame takes no touches; a tap on it lands here and is mapped to the link under the finger.
    wrap.addEventListener("click", function (e) {
      if (!doc) return;
      try {
        var r = fr.getBoundingClientRect();
        var el = doc.elementFromPoint(e.clientX - r.left, e.clientY - r.top);
        var a = el && el.closest ? el.closest("a[href]") : null;
        if (a) { e.preventDefault(); openLink(a.getAttribute("href")); }
      } catch (x) {}
    });
    wrap.appendChild(fr);
    host.appendChild(wrap);
    return fr;
  }
  function openLink(href) {
    href = String(href || "").trim();
    if (/^mailto:/i.test(href)) {
      var addr = decodeURIComponent(href.slice(7).split("?")[0]);
      return showCompose({ kind: "new", to: addr });
    }
    if (!/^https?:\/\//i.test(href)) return;
    try { G.open(href, "_blank", "noopener"); } catch (e) {}
  }

  function setFlags(id, patch) {
    return api("POST", "/message/" + encodeURIComponent(id), patch).then(function (j) {
      st.list.forEach(function (m) { if (m.id === id) { for (var k in patch) m[k] = patch[k]; } });
      return j;
    });
  }
  function setBusy(id, on) {
    if (on) st.busy[id] = 1; else delete st.busy[id];
    var host = rp && rp.querySelector(".mm-acts");
    if (host && st.view && st.view.row && st.view.row.id === id) host.querySelectorAll("[data-act]").forEach(function (b) { b.setAttribute("aria-busy", on ? "true" : "false"); });
  }
  /* Every action shows its result at once and rolls back with a plain message if the server says no.
   * The value sent is the one shown, never a toggle of whatever the server returns, and one change
   * per message is in flight at a time, so a quick double tap cannot leave the star showing the
   * opposite of what Mailflare stored. */
  function messageAction(a, m) {
    if (a === "reply" || a === "replyall" || a === "forward") return showCompose(composeFrom(m, a));
    if (st.busy[m.id]) return;
    var row = rowById(m.id);
    if (a === "star") {
      var next = !m.starred;
      m.starred = next; if (row) row.starred = next;
      renderActs(m); renderRows(); setBusy(m.id, true);
      return setFlags(m.id, { starred: next }).then(function () {
        setBusy(m.id, false); toast(next ? "Starred" : "Star removed");
      }, function (e) {
        setBusy(m.id, false);
        m.starred = !next; if (row) row.starred = !next;
        if (st.view && st.view.full && st.view.full.message === m) renderActs(m);
        renderRows(); toast(errText(e));
      });
    }
    if (a === "unread") {
      var inInbox = st.folder === "inbox";
      m.read = false; if (row) row.read = false; if (inInbox) st.unread++;
      st.busy[m.id] = 1;
      closeDetail(); updateTabs(); renderRows(); notifyBadge(); toast("Marked as unread");
      return setFlags(m.id, { read: false }).then(function () { delete st.busy[m.id]; }, function (e) {
        delete st.busy[m.id];
        if (row) row.read = true; if (inInbox && st.unread > 0) st.unread--;
        updateTabs(); renderRows(); notifyBadge(); toast(errText(e));
      });
    }
    var to = { archive: "archived", trash: "trash", spam: "spam", inbox: "received" }[a];
    if (!to) return;
    var idx = st.list.indexOf(row), wasUnread = !m.read && st.folder === "inbox";
    if (idx >= 0) st.list.splice(idx, 1);
    st.total = Math.max(0, st.total - 1);
    if (wasUnread && st.unread > 0) st.unread--;
    st.busy[m.id] = 1;
    closeDetail(); updateTabs(); renderRows(); notifyBadge();
    toast({ archived: "Archived", trash: "Moved to trash", spam: "Reported as spam", received: "Moved to inbox" }[to]);
    return setFlags(m.id, { status: to }).then(function () { delete st.busy[m.id]; }, function (e) {
      delete st.busy[m.id];
      if (row && st.list.indexOf(row) < 0) st.list.splice(Math.min(Math.max(idx, 0), st.list.length), 0, row);
      st.total++; if (wasUnread) st.unread++;
      updateTabs(); renderRows(); notifyBadge(); toast(errText(e));
    });
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

  /* ---------- html helpers (compose) ---------- */
  // Parsed with DOMParser: an inert document, nothing in it runs or loads.
  function parseHtml(html) { return new G.DOMParser().parseFromString("<!doctype html><body>" + String(html || ""), "text/html"); }
  var DROP = "script,iframe,frame,frameset,object,embed,form,input,button,select,textarea,base,meta,link,noscript,template";
  function cleanHtml(html) {
    var doc = parseHtml(html);
    [].forEach.call(doc.querySelectorAll(DROP), function (n) { n.parentNode.removeChild(n); });
    [].forEach.call(doc.querySelectorAll("*"), function (n) {
      [].slice.call(n.attributes).forEach(function (at) {
        var k = at.name.toLowerCase();
        if (k.indexOf("on") === 0 || ((k === "href" || k === "src" || k === "action" || k === "xlink:href") && /^\s*(javascript|vbscript|data:text)/i.test(at.value))) n.removeAttribute(at.name);
      });
    });
    var styles = [].map.call(doc.head.querySelectorAll("style"), function (s) { return s.outerHTML; }).join("");
    return styles + doc.body.innerHTML;
  }
  // Plain-text alternative: block breaks, list markers, "> " for quotes, "text (url)" for links.
  var BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|TR|TABLE|PRE|SECTION|ARTICLE|HEADER|FOOTER)$/;
  function plainText(node) {
    var out = "";
    function nl() { if (out && !/\n$/.test(out)) out += "\n"; }
    function walk(n, ctx) {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " "); return; }
      if (n.nodeType !== 1) return;
      var t = n.tagName;
      if (t === "STYLE" || t === "SCRIPT" || t === "HEAD") return;
      if (t === "BR") { out += "\n"; return; }
      if (BLOCK.test(t)) nl();
      if (t === "LI") out += ctx.ol ? (++ctx.n) + ". " : "- ";
      var c = t === "OL" ? { ol: true, n: 0 } : t === "UL" ? { ol: false, n: 0 } : ctx;
      if (t === "BLOCKQUOTE") {
        var start = out.length;
        [].forEach.call(n.childNodes, function (k) { walk(k, c); });
        var q = out.slice(start).replace(/^\n+|\n+$/g, "");
        out = out.slice(0, start) + q.split("\n").map(function (l) { return "> " + l; }).join("\n");
        nl(); return;
      }
      [].forEach.call(n.childNodes, function (k) { walk(k, c); });
      if (t === "A") { var h = n.getAttribute("href") || ""; if (h && !/^mailto:/i.test(h) && n.textContent.trim() !== h) out += " (" + h + ")"; }
      if (BLOCK.test(t)) nl();
    }
    walk(node, { ol: false, n: 0 });
    return out.split("\n").map(function (l) { return l.replace(/[ \t]+$/, "").replace(/^ +/, ""); }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function htmlText(html) { return plainText(parseHtml(html).body); }

  /* ---------- compose ---------- */
  function own(addr) { return parseAddr(addr).email.toLowerCase() === String(st.address || "").toLowerCase(); }
  function dedupe(list, seen) { return list.filter(function (a) { var k = parseAddr(a).email.toLowerCase(); if (!k || seen[k]) return false; seen[k] = 1; return true; }); }
  function quoteOf(m, kind) {
    var name = m.fromName || parseAddr(m.from).name || parseAddr(m.from).email;
    var bodyHtml = m.htmlBody ? cleanHtml(m.htmlBody) : esc(m.textBody || m.snippet || "").replace(/\r?\n/g, "<br>");
    var text = m.textBody || (m.htmlBody ? htmlText(m.htmlBody) : "") || m.snippet || "";
    if (kind === "forward") {
      var lines = [["From", m.from], ["Date", when(m.createdAt, true)], ["Subject", m.subject || "(no subject)"], ["To", splitList(m.to).join(", ")]];
      if (m.cc) lines.push(["Cc", splitList(m.cc).join(", ")]);
      return {
        label: "Forwarded message, included below",
        html: "<div>Begin forwarded message:</div><br>" + lines.map(function (l) { return "<div><b>" + l[0] + ":</b> " + esc(l[1]) + "</div>"; }).join("") + "<br>" + bodyHtml,
        text: "Begin forwarded message:\n\n" + lines.map(function (l) { return l[0] + ": " + l[1]; }).join("\n") + "\n\n" + text
      };
    }
    var head = "On " + when(m.createdAt, true) + ", " + name + " wrote:";
    return {
      label: "Quoted message, included below",
      html: "<div>" + esc(head) + '</div><blockquote type="cite" style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">' + bodyHtml + "</blockquote>",
      text: head + "\n" + String(text).split(/\r?\n/).map(function (l) { return "> " + l; }).join("\n")
    };
  }
  function composeFrom(m, kind) {
    var subj = m.subject || "";
    if (kind === "forward") {
      if (!/^fwd?:/i.test(subj)) subj = "Fwd: " + subj;
      var files = ((st.view && st.view.full && st.view.full.attachments) || []).filter(function (a) { return a.disposition !== "inline"; })
        .map(function (a) { return { id: a.id, filename: a.filename, size: a.size, type: a.type }; });
      return { kind: "forward", to: "", cc: "", subject: subj, forwardId: m.id, fwdAtts: files, quote: quoteOf(m, "forward"), back: st.view && st.view.row };
    }
    return replyDraft(m, kind === "replyall");
  }
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
    to = dedupe(to, seen); cc = dedupe(cc, seen);
    return { kind: all ? "replyall" : "reply", to: to.join(", "), cc: cc.join(", "), subject: subj, replyToId: m.id, quote: quoteOf(m, "reply"), back: st.view && st.view.row };
  }
  function sigHtml() {
    var s = String(lsGet(LS_SIG, "") || "").trim();
    return s ? '<div><br></div><div class="mm-sig">' + esc(s).replace(/\n/g, "<br>") + "</div>" : "";
  }

  var FMT = [["bold", "<b>B</b>", "Bold"], ["italic", "<i style=\"font-family:Georgia,serif\">I</i>", "Italic"], ["underline", "<u>U</u>", "Underline"], ["strikeThrough", "<s>S</s>", "Strikethrough"]];
  var SIZES = [["2", "Small"], ["3", "Normal"], ["5", "Large"], ["7", "Huge"]];
  var savedRange = null;
  function editorEl() { return rp && rp.querySelector("#mmText"); }
  function onSelChange() {
    var ed = editorEl(); if (!ed) return;
    var s = G.getSelection && G.getSelection();
    if (s && s.rangeCount && ed.contains(s.getRangeAt(0).commonAncestorContainer)) { savedRange = s.getRangeAt(0).cloneRange(); syncFmt(); }
  }
  function restoreSel() {
    var ed = editorEl(); if (!ed) return;
    try { ed.focus({ preventScroll: true }); } catch (e) { ed.focus(); }
    if (savedRange && ed.contains(savedRange.commonAncestorContainer)) { var s = G.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  }
  function syncFmt() {
    var bar0 = rp && rp.querySelector(".mm-fmt"); if (!bar0) return;
    bar0.querySelectorAll("[data-fmt]").forEach(function (b) {
      var c = b.getAttribute("data-fmt"), on = false;
      try {
        if (/^(bold|italic|underline|strikeThrough|insertUnorderedList|insertOrderedList)$/.test(c)) on = D.queryCommandState(c);
        else if (c === "quote") on = /blockquote/i.test(D.queryCommandValue("formatBlock"));
      } catch (e) {}
      if (b.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function fmt(cmd, val) {
    restoreSel();
    try { D.execCommand("styleWithCSS", false, false); } catch (e) {}
    if (cmd === "quote") {
      var inQ = false; try { inQ = /blockquote/i.test(D.queryCommandValue("formatBlock")); } catch (e) {}
      D.execCommand("formatBlock", false, inQ ? "div" : "blockquote");
    } else if (cmd === "link") {
      var s = G.getSelection(), txt = s ? String(s) : "";
      var url = G.prompt("Link address", /^https?:\/\//i.test(txt) ? txt : "https://");
      if (url == null) return;
      url = String(url).trim();
      if (!url || url === "https://") return;
      if (!/^(https?:|mailto:)/i.test(url)) url = (/@/.test(url) && !/\//.test(url) ? "mailto:" : "https://") + url;
      restoreSel();
      if (!txt) D.execCommand("insertHTML", false, '<a href="' + esc(url) + '">' + esc(url.replace(/^mailto:/i, "")) + "</a>&nbsp;");
      else D.execCommand("createLink", false, url);
    } else {
      D.execCommand(cmd, false, val == null ? null : val);
    }
    markDirty(); syncFmt();
  }

  function showCompose(d) {
    if (!ov) return;
    if (st.view && st.view.kind === "compose") saveDraft(true);
    var draftId = d.id || ("d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var v = st.view = { kind: "compose", d: d, draftId: draftId, files: [], fwd: (d.fwdAtts || []).slice(), at: null, dirty: false, back: d.back || null, sending: false };
    st.sel = d.id ? d.id : null; markSel();
    enterDetail();
    var title = { reply: "Reply", replyall: "Reply all", forward: "Forward" }[d.kind] || "New message";
    rp.innerHTML = bar('<button type="button" class="mm-ib" data-act="close" aria-label="Close and keep as draft" title="Close">' + svg("close") + "</button>", title, "From " + (st.address || "hello@maiknowledge.com"),
        ib("delete", "trash", "Delete draft", { cls: "danger" }) + ib("later", "clock", "Send later") +
        '<button type="button" class="mm-send" data-send="1">' + svg("send", false, 18) + "<span>Send</span></button>") +
      '<div class="mm-body mm-cbody">' +
      '<div class="mm-cerr" aria-live="assertive"></div>' +
      '<div class="mm-fields">' +
      '<div class="mm-f" data-f="to"><label for="mmTo">To:</label><input id="mmTo" type="email" multiple autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next" value="' + esc(d.to || "") + '"></div>' +
      '<div class="mm-ccwrap"></div>' +
      '<div class="mm-f" data-f="subject"><label for="mmSubj">Subject:</label><input id="mmSubj" type="text" autocapitalize="sentences" enterkeyhint="next" value="' + esc(d.subject || "") + '"></div>' +
      "</div>" +
      '<div class="mm-fmt" role="toolbar" aria-label="Formatting">' +
      FMT.map(function (f) { return '<button type="button" class="mm-fb" data-fmt="' + f[0] + '" aria-label="' + f[2] + '" title="' + f[2] + '" aria-pressed="false">' + f[1] + "</button>"; }).join("") +
      '<span class="mm-fsep" aria-hidden="true"></span>' +
      '<select class="mm-fsel" data-size="1" aria-label="Text size">' + SIZES.map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === "3" ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select>" +
      '<label class="mm-fb mm-fcol" title="Text colour">' + svg("textcolor", false, 18) + '<i aria-hidden="true"></i><input type="color" data-color="1" value="#d92d20" aria-label="Text colour"></label>' +
      '<span class="mm-fsep" aria-hidden="true"></span>' +
      '<button type="button" class="mm-fb" data-fmt="insertUnorderedList" aria-label="Bulleted list" title="Bulleted list" aria-pressed="false">' + svg("ul", false, 18) + "</button>" +
      '<button type="button" class="mm-fb" data-fmt="insertOrderedList" aria-label="Numbered list" title="Numbered list" aria-pressed="false">' + svg("ol", false, 18) + "</button>" +
      '<button type="button" class="mm-fb" data-fmt="quote" aria-label="Quote" title="Quote" aria-pressed="false">' + svg("quote", false, 18) + "</button>" +
      '<span class="mm-fsep" aria-hidden="true"></span>' +
      '<button type="button" class="mm-fb" data-fmt="link" aria-label="Add link" title="Add link">' + svg("link", false, 18) + "</button>" +
      '<button type="button" class="mm-fb" data-fmt="unlink" aria-label="Remove link" title="Remove link">' + svg("unlink", false, 18) + "</button>" +
      '<button type="button" class="mm-fb" data-fmt="removeFormat" aria-label="Clear formatting" title="Clear formatting">' + svg("eraser", false, 18) + "</button>" +
      '<span class="mm-fsep" aria-hidden="true"></span>' +
      '<button type="button" class="mm-fb" data-attach="1" aria-label="Attach files or photos" title="Attach">' + svg("clip", false, 18) + "</button>" +
      "</div>" +
      '<div class="mm-schipw"></div>' +
      '<div class="mm-catts" aria-label="Attachments"></div>' +
      '<div id="mmText" class="mm-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message" data-ph="Message" spellcheck="true" autocapitalize="sentences"></div>' +
      (d.quote ? '<div class="mm-quote"><div>' + esc(d.quote.label) + '</div><div class="mm-qbody"></div></div>' : "") +
      '<input type="file" id="mmFile" multiple hidden>' +
      "</div>";
    var body = rp.querySelector(".mm-cbody"), ed = editorEl();
    ed.innerHTML = d.html != null ? d.html : "<div><br></div>" + sigHtml();
    if (d.quote) drawHtml(rp.querySelector(".mm-qbody"), d.quote.html);
    renderCc(d.cc || d.bcc);
    if (d.cc) rp.querySelector("#mmCc").value = d.cc;
    if (d.bcc) rp.querySelector("#mmBcc").value = d.bcc;
    renderFiles();

    rp.querySelector('[data-act="close"]').addEventListener("click", closeCompose);
    rp.querySelector('[data-act="delete"]').addEventListener("click", deleteDraft);
    rp.querySelector('[data-act="later"]').addEventListener("click", openSchedule);
    rp.querySelector("[data-send]").addEventListener("click", function () { doSend(null); });
    body.addEventListener("input", function (e) { if (e.target && e.target.type !== "file") markDirty(); clearFieldError(e.target); });
    // Toolbar taps must not take focus (or the selection) away from the message.
    rp.querySelectorAll(".mm-fmt .mm-fb").forEach(function (b) { b.addEventListener("mousedown", function (e) { if (!b.classList.contains("mm-fcol")) e.preventDefault(); }); });
    rp.querySelectorAll("[data-fmt]").forEach(function (b) { b.addEventListener("click", function () { fmt(b.getAttribute("data-fmt")); }); });
    var sz = rp.querySelector("[data-size]");
    sz.addEventListener("change", function () { fmt("fontSize", sz.value); });
    var col = rp.querySelector("[data-color]");
    col.addEventListener("input", function () { rp.querySelector(".mm-fcol").style.setProperty("--mcol", col.value); });
    col.addEventListener("change", function () { rp.querySelector(".mm-fcol").style.setProperty("--mcol", col.value); fmt("foreColor", col.value); });
    var file = rp.querySelector("#mmFile");
    rp.querySelector("[data-attach]").addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () { addFiles(file.files); file.value = ""; });
    ed.addEventListener("keyup", syncFmt); ed.addEventListener("mouseup", syncFmt);
    D.addEventListener("selectionchange", onSelChange);
    savedRange = null;
    var first = d.to ? ed : rp.querySelector("#mmTo");
    try { first.focus(); } catch (e) {}
  }
  function renderCc(open0) {
    var w = rp && rp.querySelector(".mm-ccwrap"); if (!w) return;
    if (!open0) {
      w.innerHTML = '<div class="mm-f"><button type="button" class="mm-ccb" aria-expanded="false">Cc, Bcc</button></div>';
      w.querySelector(".mm-ccb").addEventListener("click", function () { renderCc(true); var c = rp.querySelector("#mmCc"); if (c) c.focus(); });
      return;
    }
    w.innerHTML = '<div class="mm-f"><label for="mmCc">Cc:</label><input id="mmCc" type="email" multiple autocapitalize="off" autocorrect="off" spellcheck="false"></div>' +
      '<div class="mm-f"><label for="mmBcc">Bcc:</label><input id="mmBcc" type="email" multiple autocapitalize="off" autocorrect="off" spellcheck="false"></div>';
  }
  function val(sel) { var e = rp && rp.querySelector(sel); return e ? e.value : ""; }
  function markDirty() {
    var v = st.view; if (!v || v.kind !== "compose") return;
    v.dirty = true;
    if (v.saveT) clearTimeout(v.saveT);
    v.saveT = setTimeout(function () { if (st.view === v) saveDraft(true); }, 1200);
  }

  function totalBytes(v) { return v.files.reduce(function (t, f) { return t + f.size; }, 0) + v.fwd.reduce(function (t, f) { return t + (Number(f.size) || 0); }, 0); }
  function addFiles(list) {
    var v = st.view; if (!v || v.kind !== "compose") return;
    var refused = [];
    [].forEach.call(list || [], function (f) {
      if (v.files.length + v.fwd.length >= LIMIT.files) return refused.push(ERR["too-many-attachments"]);
      if (f.size > LIMIT.file) return refused.push(f.name + " is larger than 10 MB.");
      if (totalBytes(v) + f.size > LIMIT.total) return refused.push(f.name + " would take the attachments past 20 MB.");
      v.files.push({ name: f.name || "attachment", size: f.size, type: f.type || "application/octet-stream", file: f });
    });
    if (refused.length) { toast(refused[0]); showComposeError(refused.filter(function (x, i) { return refused.indexOf(x) === i; }).join(" ")); }
    markDirty(); renderFiles();
  }
  function renderFiles() {
    var v = st.view, host = rp && rp.querySelector(".mm-catts"); if (!host || !v) return;
    var chip = function (kind, i, name, n) {
      return '<span class="mm-chip rm">' + svg("clip", false, 16) + "<span>" + esc(name) + "</span><small>" + size(n) + '</small><button type="button" class="mm-x" data-rm="' + kind + ":" + i + '" aria-label="Remove ' + esc(name) + '">' + svg("close", false, 16) + "</button></span>";
    };
    host.innerHTML = v.fwd.map(function (f, i) { return chip("fwd", i, f.filename, f.size); }).join("") + v.files.map(function (f, i) { return chip("own", i, f.name, f.size); }).join("");
    host.querySelectorAll("[data-rm]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-rm").split(":");
        (p[0] === "fwd" ? v.fwd : v.files).splice(Number(p[1]), 1);
        markDirty(); renderFiles(); showComposeError("");
      });
    });
  }
  function readB64(f) {
    return new Promise(function (res, rej) {
      var r = new G.FileReader();
      r.onload = function () { var s = String(r.result || ""); res(s.slice(s.indexOf(",") + 1)); };
      r.onerror = function () { var e = new Error("bad-attachment"); e.code = "bad-attachment"; rej(e); };
      r.readAsDataURL(f);
    });
  }
  function showComposeError(msg) {
    var h = rp && rp.querySelector(".mm-cerr"); if (!h) return;
    h.innerHTML = msg ? '<div class="mm-err" role="alert">' + esc(msg) + "</div>" : "";
  }
  function fieldError(name, msg) {
    var row = rp && rp.querySelector('[data-f="' + name + '"]'); if (!row) return;
    row.classList.add("bad");
    var n = row.nextElementSibling;
    if (!n || !n.classList.contains("mm-ferr")) { n = D.createElement("div"); n.className = "mm-ferr"; n.setAttribute("role", "alert"); row.parentNode.insertBefore(n, row.nextSibling); }
    n.textContent = msg;
    var inp = row.querySelector("input"); if (inp) { inp.setAttribute("aria-invalid", "true"); try { inp.focus(); } catch (e) {} }
  }
  function clearFieldError(t) {
    var row = t && t.closest ? t.closest(".mm-f") : null; if (!row || !row.classList.contains("bad")) return;
    row.classList.remove("bad");
    var n = row.nextElementSibling; if (n && n.classList.contains("mm-ferr")) n.remove();
    var inp = row.querySelector("input"); if (inp) inp.removeAttribute("aria-invalid");
  }

  function doSend(at) {
    var v = st.view; if (!v || v.kind !== "compose" || v.sending) return;
    var ed = editorEl(), d = v.d;
    var to = val("#mmTo").trim(), subject = val("#mmSubj").trim();
    var newText = plainText(ed), hasBody = newText.replace(/\s/g, "").length > 0;
    showComposeError("");
    if (!to) return fieldError("to", ERR["to-required"]);
    if (!subject) return fieldError("subject", ERR["subject-required"]);
    if (!hasBody && !v.files.length && !v.fwd.length && !d.quote) return showComposeError(ERR["body-required"]);
    var html = cleanHtml(ed.innerHTML) + (d.quote ? "<br>" + d.quote.html : "");
    var text = newText + (d.quote ? "\n\n" + d.quote.text : "");
    var btn = rp.querySelector("[data-send]");
    v.sending = true; btn.disabled = true; btn.querySelector("span").textContent = at ? "Scheduling\u2026" : "Sending\u2026";
    Promise.all(v.files.map(function (f) { return readB64(f.file).then(function (b) { return { filename: f.name, type: f.type, contentBase64: b }; }); })).then(function (atts) {
      var p = { to: to, cc: val("#mmCc"), bcc: val("#mmBcc"), subject: subject, text: text, html: html };
      if (atts.length) p.attachments = atts;
      if (d.replyToId) p.replyToId = d.replyToId;
      if (d.forwardId && v.fwd.length) { p.forwardId = d.forwardId; p.forwardAttachmentIds = v.fwd.map(function (f) { return f.id; }); }
      if (at) p.scheduledAt = at;
      return api("POST", "/send", p);
    }).then(function (r) {
      removeDraft(v.draftId);
      if (r && r.scheduled && r.id) { var m = lsGet(LS_SCHED, {}); m[r.id] = at; lsSet(LS_SCHED, m); }
      toast(r && r.scheduled ? "Scheduled for " + sendTime(at) : "Sent");
      if (st.view !== v) return;
      v.dirty = false; if (v.saveT) clearTimeout(v.saveT);
      closeDetail();
      if (st.folder === "sent" || st.folder === "scheduled" || st.folder === "drafts") refresh(false);
    }).catch(function (e) {
      if (st.view === v) { v.sending = false; btn.disabled = false; btn.querySelector("span").textContent = "Send"; showComposeError(errText(e)); }
      toast(errText(e));
    });
  }

  /* ---------- drafts (this device only) ---------- */
  function drafts() { var a = lsGet(LS_DRAFTS, []); return Array.isArray(a) ? a : []; }
  function removeDraft(id) {
    lsSet(LS_DRAFTS, drafts().filter(function (x) { return x.id !== id; }));
    if (st.folder === "drafts") { st.list = drafts(); st.total = st.list.length; renderRows(); }
  }
  function saveDraft(quiet) {
    var v = st.view; if (!v || v.kind !== "compose" || !v.dirty) return false;
    if (v.saveT) { clearTimeout(v.saveT); v.saveT = null; }
    var ed = editorEl(); if (!ed) return false;
    var d = v.d, html = ed.innerHTML, txt = plainText(ed);
    var to = val("#mmTo"), cc = val("#mmCc") || (rp.querySelector("#mmCc") ? "" : d.cc || ""), bcc = val("#mmBcc") || (rp.querySelector("#mmBcc") ? "" : d.bcc || ""), subject = val("#mmSubj");
    var sigTxt = plainText(parseHtml(sigHtml()).body);
    if (!to.trim() && !subject.trim() && txt.trim() === sigTxt.trim() && !v.files.length) return false;
    var quote = d.quote || null;
    if (quote && quote.html.length > 200000) quote = { label: quote.label, text: quote.text, html: esc(quote.text).replace(/\n/g, "<br>") };
    var rec = { id: v.draftId, kind: d.kind, to: to, cc: cc, bcc: bcc, subject: subject, html: html, snippet: txt.slice(0, 140), replyToId: d.replyToId || null, forwardId: d.forwardId || null, fwdAtts: v.fwd, quote: quote, savedAt: new Date().toISOString() };
    var list = drafts().filter(function (x) { return x.id !== v.draftId; });
    list.unshift(rec);
    var ok = lsSet(LS_DRAFTS, list.slice(0, 50));
    if (!ok && quote) { rec.quote = { label: quote.label, text: quote.text, html: esc(quote.text).replace(/\n/g, "<br>") }; ok = lsSet(LS_DRAFTS, [rec].concat(list.slice(1, 50))); }
    v.dirty = false;
    if (!quiet) toast(ok ? (v.files.length ? "Saved to Drafts. Attached files are not kept in drafts." : "Saved to Drafts") : "This draft could not be saved on the device.");
    if (st.folder === "drafts") { st.list = drafts(); st.total = st.list.length; renderRows(); }
    return ok;
  }
  function closeCompose() {
    var v = st.view;
    if (v && v.kind === "compose") {
      var ok0 = saveDraft(true), kept = ok0 || drafts().some(function (x) { return x.id === v.draftId; });
      if (kept) toast(v.files.length ? "Saved to Drafts. Attached files are not kept in drafts." : "Saved to Drafts");
    }
    var to = v && v.back;
    if (to && rowById(to.id)) return showMessage(to);
    closeDetail();
  }
  function deleteDraft() {
    var v = st.view; if (!v || v.kind !== "compose") return;
    var had = drafts().some(function (x) { return x.id === v.draftId; });
    if ((had || plainText(editorEl()).length > 0 || val("#mmTo") || val("#mmSubj")) && G.confirm && !G.confirm(had ? "Delete this draft?" : "Discard this message?")) return;
    v.dirty = false; if (v.saveT) clearTimeout(v.saveT);
    removeDraft(v.draftId);
    toast(had ? "Draft deleted" : "Message discarded");
    closeDetail();
  }

  /* ---------- send later ---------- */
  function atHour(d, h) { var r = new Date(d); r.setHours(h, 0, 0, 0); return r; }
  // The same three choices Mailflare's own composer offers (schedule-send-utils.ts), plus any time.
  function scheduleOptions(now) {
    var later = new Date(now.getTime() + 3 * 3600 * 1000); later.setMinutes(later.getMinutes() < 30 ? 30 : 60, 0, 0);
    var tom = new Date(now); tom.setDate(tom.getDate() + 1);
    var mon = new Date(now); mon.setDate(mon.getDate() + (((8 - mon.getDay()) % 7) || 7));
    return [["Later today", later], ["Tomorrow morning", atHour(tom, 8)], ["Monday morning", atHour(mon, 8)]];
  }
  function localInput(d) { var o = d.getTimezoneOffset() * 60000; return new Date(d.getTime() - o).toISOString().slice(0, 16); }
  function openSchedule() {
    var v = st.view; if (!v || v.kind !== "compose" || ov.querySelector(".mm-scrim")) return;
    var now = new Date(), opts = scheduleOptions(now), pick = v.at ? new Date(v.at) : opts[1][1];
    var sc = D.createElement("div"); sc.className = "mm-scrim pre";
    sc.innerHTML = '<div class="mm-sheet" role="dialog" aria-modal="true" aria-labelledby="mmSchT"><div class="mm-grab" aria-hidden="true"></div><h2 id="mmSchT">Send later</h2>' +
      opts.map(function (o, i) { return '<button type="button" class="mm-opt" data-opt="' + i + '"><span>' + o[0] + "</span><small>" + esc(sendTime(o[1])) + "</small></button>"; }).join("") +
      '<label for="mmAt" class="mm-sum" style="display:block;margin:6px 0">Or pick a date and time</label>' +
      '<input id="mmAt" type="datetime-local" min="' + localInput(new Date(now.getTime() + 2 * 60000)) + '" value="' + localInput(pick) + '">' +
      '<div class="mm-sum" aria-live="polite"></div>' +
      '<div class="mm-row2"><button type="button" class="mm-ghost" data-sc="cancel">Cancel</button><button type="button" class="mm-send" data-sc="go">' + svg("clock", false, 18) + "<span>Schedule</span></button></div></div>";
    ov.appendChild(sc);
    var inp = sc.querySelector("#mmAt"), sum = sc.querySelector(".mm-sum[aria-live]"), go = sc.querySelector('[data-sc="go"]');
    function show(d) {
      var ok = d && !isNaN(d) && d.getTime() > Date.now() + 60000;
      sum.innerHTML = ok ? "Sends <b>" + esc(d.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })) + "</b>" + (tzName(d) ? ", " + esc(tzName(d)) : "") : '<span style="color:var(--mdanger)">' + ERR["schedule-in-past"] + "</span>";
      go.disabled = !ok; pick = d;
      sc.querySelectorAll("[data-opt]").forEach(function (b) { b.classList.toggle("on", !!d && opts[+b.getAttribute("data-opt")][1].getTime() === d.getTime()); });
    }
    sc.querySelectorAll("[data-opt]").forEach(function (b) { b.addEventListener("click", function () { var d = opts[+b.getAttribute("data-opt")][1]; inp.value = localInput(d); show(d); }); });
    inp.addEventListener("input", function () { show(inp.value ? new Date(inp.value) : null); });
    sc.querySelector('[data-sc="cancel"]').addEventListener("click", closeSheet);
    sc.addEventListener("click", function (e) { if (e.target === sc) closeSheet(); });
    go.addEventListener("click", function () { if (!pick) return; v.at = pick.toISOString(); closeSheet(); doSend(v.at); });
    show(pick);
    requestAnimationFrame(function () { requestAnimationFrame(function () { sc.classList.remove("pre"); }); });
    try { sc.querySelector(".mm-opt").focus(); } catch (e) {}
  }
  function closeSheet() {
    var sc = ov && ov.querySelector(".mm-scrim"); if (!sc) return;
    sc.classList.add("pre");
    setTimeout(function () { if (sc.parentNode) sc.parentNode.removeChild(sc); }, 180);
    var b = rp && rp.querySelector('[data-act="later"]'); try { if (b) b.focus(); } catch (e) {}
  }

  /* ---------- signature ---------- */
  function showSettings() {
    if (!ov) return;
    if (st.view && st.view.kind === "compose") saveDraft(true);
    st.view = { kind: "settings" }; st.sel = null; markSel();
    enterDetail();
    rp.innerHTML = bar('<button type="button" class="mm-ib mm-narrow" data-act="back" aria-label="Back to ' + esc(folderName(st.folder)) + '" title="Back">' + svg("back") + "</button>", "Signature", "Kept on this device", "") +
      '<div class="mm-body"><div class="mm-set"><label for="mmSig">Signature for new messages, replies and forwards</label>' +
      '<textarea id="mmSig" autocapitalize="sentences" placeholder="Dr Manoj Kurmana&#10;MaiKnowledge"></textarea>' +
      "<p>Drafts and send-later times are also kept on this device only.</p>" +
      '<button type="button" class="mm-send" data-save="1"><span>Save signature</span></button></div></div>';
    var ta = rp.querySelector("#mmSig"); ta.value = lsGet(LS_SIG, "") || "";
    rp.querySelector('[data-act="back"]').addEventListener("click", function () { closeDetail(); });
    rp.querySelector("[data-save]").addEventListener("click", function () {
      var ok0 = lsSet(LS_SIG, ta.value.replace(/\s+$/, ""));
      toast(ok0 ? "Signature saved" : "The signature could not be saved on this device.");
      if (ok0) closeDetail();
    });
    try { ta.focus(); } catch (e) {}
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
    _st: st, _parseAddr: parseAddr, _splitList: splitList, _replyDraft: replyDraft, _plainText: plainText, _cleanHtml: cleanHtml, _version: 2
  };
  G.SMD_openMail = open;
})(typeof window !== "undefined" ? window : this);
