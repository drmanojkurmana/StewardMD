/* StewardMD — Clinical Progress dashboard + engagement layer (client).
 * ---------------------------------------------------------------------------
 * Replaces the old Knowledge-Points sheet with a full, premium progress dashboard:
 *   • Dashboard   — level + KU + today's earning vs caps + daily quest + streak + discounts
 *   • Achievements— badge gallery (search / filter / sort, pin 3, hidden badges)
 *   • Stats       — lifetime statistics + 14-day KU chart + 30-day streak calendar
 *   • Timeline    — recent KU activity + unlocks
 * Plus an always-on, non-spammy notifier that celebrates level-ups, badge unlocks,
 * quest completions and discount unlocks by diffing the server summary.
 *
 * All data comes from the server-authoritative merged summary (SMD_KU.summary());
 * today's 5-minute streak progress is the live client value (SMD_STREAK.progress()).
 * Self-wires to the existing KU chip — no edits to home.js required. Professional,
 * minimal, Material-3-ish, dark-mode via the app's CSS vars. No childish animation.
 *
 *   window.SMD_ENGAGE.openDashboard(tab?)   → open (tab: dashboard|achievements|stats|timeline)
 */
(function () {
  "use strict";
  if (window.SMD_ENGAGE) return;

  var TEAL = "#0E6A5F", TEAL_D = "#0A4A42", TINT = "#EAF4F1", AMBER = "#F4A62A", MUT = "#5E7E78";
  var RARITY = { common: "#64748b", uncommon: "#2f9e6e", rare: "#2563eb", epic: "#7c3aed", legendary: "#d97706", mythic: "#db2777" };
  var CATS = [
    { k: "reading", label: "Reading" }, { k: "cases", label: "Cases" }, { k: "calculators", label: "Calculators" },
    { k: "maik", label: "MaiK" }, { k: "streak", label: "Streaks" }, { k: "consistency", label: "Consistency" },
    { k: "quests", label: "Quests" }, { k: "levels", label: "Levels" }, { k: "combo", label: "Combos" }, { k: "special", label: "Hidden" }
  ];
  var LBL = { read: "Reading", "case": "Cases", calc: "Calculators", maik: "MaiK", streak: "Streak", open: "Daily open", combo: "Combo", weekly: "Weekly bonus", monthly: "Monthly bonus", quest: "Quest" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function fmt(n) { try { return Number(n || 0).toLocaleString("en-US"); } catch (e) { return String(n || 0); } }
  function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0; }
  function signedIn() { try { return !!(window.SMD_KU && SMD_KU.signedIn && SMD_KU.signedIn()); } catch (e) { return false; } }
  function cache() { try { return (window.SMD_KU && SMD_KU._cache && SMD_KU._cache()) || null; } catch (e) { return null; } }

  function injectCSS() {
    if (document.getElementById("smdEngCss")) return;
    var s = document.createElement("style"); s.id = "smdEngCss";
    s.textContent = [
      ".smd-eng-ov{position:fixed;inset:0;z-index:99998;background:rgba(6,32,29,.5);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center}",
      ".smd-eng{background:var(--hbg,#f3f6f5);color:var(--hink,#0f172a);width:100%;max-width:480px;height:94vh;border-radius:22px 22px 0 0;overflow:hidden;display:flex;flex-direction:column;font-family:var(--hfont,system-ui)}",
      ".smd-eng-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;background:var(--hpanel,#fff);border-bottom:1px solid var(--hbd,#e6efec)}",
      ".smd-eng-hd h3{margin:0;font:600 16px var(--hfont,system-ui)}",
      ".smd-eng-x{border:0;background:transparent;font-size:24px;line-height:1;color:var(--hmut,#64748b);cursor:pointer}",
      ".smd-eng-tabs{display:flex;gap:4px;padding:8px 12px;background:var(--hpanel,#fff);border-bottom:1px solid var(--hbd,#e6efec);overflow-x:auto}",
      ".smd-eng-tab{flex:1;white-space:nowrap;border:0;background:transparent;color:var(--hmut,#64748b);font:600 13px var(--hfont,system-ui);padding:8px 10px;border-radius:10px;cursor:pointer}",
      ".smd-eng-tab.on{background:" + TINT + ";color:" + TEAL_D + "}",
      ".smd-eng-bd{flex:1;overflow:auto;padding:14px;-webkit-overflow-scrolling:touch}",
      ".smd-card{background:var(--hpanel,#fff);border:1px solid var(--hbd,#e6efec);border-radius:16px;padding:16px;margin-bottom:12px}",
      ".smd-card h4{margin:0 0 12px;font:600 13.5px var(--hfont,system-ui);color:var(--hink,#0f172a)}",
      ".smd-row{display:flex;align-items:center;justify-content:space-between;gap:10px}",
      ".smd-bar{height:8px;border-radius:999px;background:rgba(100,116,139,.16);overflow:hidden;margin-top:6px}",
      ".smd-bar>i{display:block;height:100%;border-radius:999px;background:" + TEAL + "}",
      ".smd-bar.amber>i{background:" + AMBER + "}",
      ".smd-muted{color:var(--hmut,#64748b)}",
      ".smd-hero{background:linear-gradient(135deg," + TEAL + " 0%," + TEAL_D + " 100%);color:#fff;border:0}",
      ".smd-hero .smd-muted{color:rgba(234,244,241,.8)}",
      ".smd-hero .smd-bar{background:rgba(255,255,255,.18)}.smd-hero .smd-bar>i{background:#fff}",
      ".smd-stat{background:var(--hpanel,#fff);border:1px solid var(--hbd,#e6efec);border-radius:14px;padding:12px}",
      ".smd-stat .n{font:600 22px var(--hfont,system-ui)}.smd-stat .l{font:500 11.5px var(--hfont,system-ui);color:var(--hmut,#64748b);margin-top:3px}",
      ".smd-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".smd-chip{border:1px solid var(--hbd,#e6efec);background:transparent;color:var(--hink,#0f172a);font:600 12px var(--hfont,system-ui);border-radius:999px;padding:6px 12px;cursor:pointer;white-space:nowrap}",
      ".smd-chip.on{background:" + TINT + ";border-color:" + TEAL + ";color:" + TEAL_D + "}",
      ".smd-badges{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".smd-badge{background:var(--hpanel,#fff);border:1px solid var(--hbd,#e6efec);border-radius:14px;padding:12px;position:relative}",
      ".smd-badge.locked{opacity:.62}",
      ".smd-medal{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:19px;margin-bottom:8px}",
      ".smd-badge .bn{font:600 12.5px var(--hfont,system-ui);line-height:1.25}",
      ".smd-badge .bd{font:500 11px var(--hfont,system-ui);color:var(--hmut,#64748b);margin-top:2px;min-height:26px}",
      ".smd-rar{display:inline-block;font:700 9.5px var(--hfont,system-ui);letter-spacing:.5px;text-transform:uppercase;padding:2px 7px;border-radius:999px}",
      ".smd-pin{position:absolute;top:10px;right:10px;border:0;background:transparent;cursor:pointer;font-size:15px;color:#cbd5e1}",
      ".smd-pin.on{color:" + AMBER + "}",
      ".smd-input{width:100%;box-sizing:border-box;border:1px solid var(--hbd,#e6efec);border-radius:10px;padding:9px 12px;font:500 13px var(--hfont,system-ui);background:var(--hpanel,#fff);color:var(--hink,#0f172a);margin-bottom:10px}",
      ".smd-cal{display:grid;grid-template-columns:repeat(10,1fr);gap:5px}",
      ".smd-cal i{aspect-ratio:1;border-radius:5px;background:rgba(100,116,139,.16)}",
      ".smd-cal i.on{background:" + TEAL + "}.smd-cal i.today{outline:2px solid " + AMBER + ";outline-offset:1px}",
      ".smd-btn{border:0;background:" + TEAL + ";color:#fff;font:600 14px var(--hfont,system-ui);border-radius:999px;padding:12px;cursor:pointer;width:100%}",
      ".smd-tl{border-left:2px solid var(--hbd,#e6efec);padding-left:14px;margin-left:6px}",
      ".smd-tl .d{font:600 12px var(--hfont,system-ui);margin:10px 0 4px}",
      ".smd-tl .e{font:500 12px var(--hfont,system-ui);color:var(--hmut,#64748b);margin:2px 0}",
      ".smd-bars{display:flex;align-items:flex-end;gap:4px;height:90px;margin-top:8px}",
      ".smd-bars .b{flex:1;background:" + TEAL + ";border-radius:4px 4px 0 0;min-height:2px;opacity:.85}"
    ].join("");
    document.head.appendChild(s);
  }

  // ── section renderers ──
  function medalFor(b) {
    var c = RARITY[b.rarity] || RARITY.common;
    var icon = b.unlocked ? "✓" : (b.hidden ? "?" : "◇");
    return '<div class="smd-medal" style="background:' + (b.unlocked ? c : "rgba(100,116,139,.35)") + '">' + icon + '</div>';
  }

  function renderDashboard(s, streakP) {
    var lvlToNext = s.levelToNext != null ? s.levelToNext : 0;
    var today = s.today || {};
    var q = s.quest || { goals: [], done: false };
    var tot = today.total || 0;
    var srcRow = function (key, label) {
      var t = today[key] || { ku: 0, cap: 0 };
      return '<div style="margin-bottom:10px"><div class="smd-row"><span style="font:500 12.5px var(--hfont,system-ui)">' + label + '</span><span class="smd-muted" style="font:600 12px var(--hfont,system-ui)">' + t.ku + ' / ' + t.cap + ' KU</span></div><div class="smd-bar"><i style="width:' + pct(t.ku, t.cap) + '%"></i></div></div>';
    };
    var questGoals = (q.goals || []).map(function (g) {
      return '<div style="margin-bottom:8px"><div class="smd-row"><span style="font:500 12px var(--hfont,system-ui)">' + esc(LBL[g.type] || g.type) + '</span><span class="smd-muted" style="font:600 12px">' + g.have + ' / ' + g.need + '</span></div><div class="smd-bar amber"><i style="width:' + pct(g.have, g.need) + '%"></i></div></div>';
    }).join("");
    var tier = s.nextTier;
    var discount = tier
      ? '<div class="smd-row"><span style="font:500 12.5px">' + fmt(tier.ku - (s.balance || 0)) + ' KU to ' + esc(tier.label) + '</span><span class="smd-muted" style="font:600 12px">' + (s.progressPct || 0) + '%</span></div><div class="smd-bar"><i style="width:' + (s.progressPct || 0) + '%"></i></div>'
      : '<div style="font:500 13px">All reward tiers unlocked 🎉</div>';
    var sp = streakP || { seconds: 0, target: 300, done: false };
    var mins = Math.floor(sp.seconds / 60), tmin = Math.round(sp.target / 60);
    var streakToday = sp.done
      ? '<div style="font:600 13px;color:' + TEAL + '">✓ Today\'s 5 minutes complete — streak secured</div>'
      : '<div class="smd-row"><span style="font:500 12.5px">Today: ' + mins + ' of ' + tmin + ' min active</span><span class="smd-muted" style="font:600 12px">' + pct(sp.seconds, sp.target) + '%</span></div><div class="smd-bar amber"><i style="width:' + pct(sp.seconds, sp.target) + '%"></i></div>';

    return (
      '<div class="smd-card smd-hero">' +
        '<div class="smd-row"><div><div style="font:700 11px;letter-spacing:1px;text-transform:uppercase;opacity:.85">Level ' + (s.level || 1) + '</div><div style="font:600 20px;margin-top:2px">' + esc(s.levelName || "Intern") + '</div></div>' +
        '<div style="text-align:right"><div style="font:600 30px;line-height:1">' + fmt(s.balance || 0) + '</div><div class="smd-muted" style="font:600 11px">Knowledge Units</div></div></div>' +
        '<div style="margin-top:14px"><div class="smd-row"><span class="smd-muted" style="font:600 11.5px">' + fmt(lvlToNext) + ' KU to level ' + ((s.level || 1) + 1) + '</span><span class="smd-muted" style="font:600 11.5px">+' + tot + ' KU today</span></div><div class="smd-bar"><i style="width:' + (s.levelPct || 0) + '%"></i></div></div>' +
        '<div class="smd-row" style="margin-top:14px"><div><div style="font:600 22px">🔥 ' + (s.streak || 0) + '</div><div class="smd-muted" style="font:600 11px">Current streak</div></div>' +
        '<div style="text-align:right"><div style="font:600 22px">🏆 ' + (s.longestStreak || 0) + '</div><div class="smd-muted" style="font:600 11px">Longest streak</div></div></div>' +
      '</div>' +
      '<div class="smd-card"><h4>Today\'s streak</h4>' + streakToday + '</div>' +
      '<div class="smd-card"><h4>Today\'s progress · +' + tot + ' KU</h4>' + srcRow("read", "Reading") + srcRow("case", "Cases") + srcRow("calc", "Calculators") + srcRow("maik", "MaiK") + '</div>' +
      '<div class="smd-card"><h4>Daily quest' + (q.completedToday ? ' · ✓ complete (+' + (q.reward || 20) + ' KU)' : '') + '</h4><div style="font:500 13px;margin-bottom:10px">' + esc(q.label || "") + '</div>' + questGoals + '</div>' +
      '<div class="smd-card"><h4>Reward progress</h4>' + discount + '</div>' +
      '<button class="smd-btn" data-eng="share">Share achievement</button>'
    );
  }

  function renderAchievements(s, state) {
    var badges = (s.badges || []).slice();
    var pinned = s.pinned || [];
    var q = (state.q || "").toLowerCase();
    var filtered = badges.filter(function (b) {
      if (state.cat && b.cat !== state.cat) return false;
      if (state.rar && b.rarity !== state.rar) return false;
      if (state.status === "unlocked" && !b.unlocked) return false;
      if (state.status === "locked" && b.unlocked) return false;
      if (q && !((b.name || "").toLowerCase().indexOf(q) >= 0 || (b.desc || "").toLowerCase().indexOf(q) >= 0)) return false;
      return true;
    });
    filtered.sort(function (a, b) {
      if (state.sort === "progress") return (b.pct || 0) - (a.pct || 0);
      if (state.sort === "recent") return (b.unlockedAt || 0) - (a.unlockedAt || 0);
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return (b.pct || 0) - (a.pct || 0);
    });
    var unlocked = badges.filter(function (b) { return b.unlocked; }).length;
    var chips = '<button class="smd-chip' + (!state.cat ? ' on' : '') + '" data-cat="">All</button>' +
      CATS.map(function (c) { return '<button class="smd-chip' + (state.cat === c.k ? ' on' : '') + '" data-cat="' + c.k + '">' + c.label + '</button>'; }).join("");
    var statusChips = ["all", "unlocked", "locked"].map(function (x) { return '<button class="smd-chip' + ((state.status || "all") === x ? ' on' : '') + '" data-status="' + x + '">' + x[0].toUpperCase() + x.slice(1) + '</button>'; }).join("");
    var sortChips = [["default", "Default"], ["progress", "Progress"], ["recent", "Recent"]].map(function (x) { return '<button class="smd-chip' + ((state.sort || "default") === x[0] ? ' on' : '') + '" data-sort="' + x[0] + '">' + x[1] + '</button>'; }).join("");
    var tiles = filtered.map(function (b) {
      var canPin = b.unlocked && !b.hidden || (b.unlocked);
      var isPin = pinned.indexOf(b.id) >= 0;
      var barPct = b.unlocked ? 100 : (b.pct || 0);
      return '<div class="smd-badge' + (b.unlocked ? '' : ' locked') + '">' +
        (b.unlocked ? '<button class="smd-pin' + (isPin ? ' on' : '') + '" data-pin="' + esc(b.id) + '" title="Pin to profile">' + (isPin ? '★' : '☆') + '</button>' : '') +
        medalFor(b) +
        '<div class="bn">' + esc(b.name) + '</div><div class="bd">' + esc(b.desc) + '</div>' +
        '<span class="smd-rar" style="background:' + (RARITY[b.rarity] || RARITY.common) + '22;color:' + (RARITY[b.rarity] || RARITY.common) + '">' + esc(b.rarity) + '</span>' +
        (b.unlocked ? '' : '<div class="smd-bar" style="margin-top:8px"><i style="width:' + barPct + '%"></i></div><div class="smd-muted" style="font:600 10.5px;margin-top:4px">' + fmt(b.value) + ' / ' + fmt(b.target) + '</div>') +
        '</div>';
    }).join("");
    return '<div class="smd-card"><div class="smd-row"><h4 style="margin:0">Achievements</h4><span class="smd-muted" style="font:600 12px">' + unlocked + ' / ' + badges.length + '</span></div>' +
      '<div style="margin-top:10px"><input class="smd-input" data-search placeholder="Search achievements" value="' + esc(state.q || "") + '"></div>' +
      '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px">' + chips + '</div>' +
      '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">' + statusChips + sortChips + '</div></div>' +
      '<div class="smd-badges">' + (tiles || '<div class="smd-muted" style="grid-column:1/-1;font:500 13px;text-align:center;padding:20px">No achievements match.</div>') + '</div>';
  }

  function renderStats(s) {
    var st = s.stats || {};
    var tiles = [
      ["Topics read", fmt(st.readActions)], ["Cases", fmt(st.caseActions)], ["Calculators used", fmt(st.calcActions)], ["MaiK chats", fmt(st.maikActions)],
      ["Current streak", fmt(s.streak)], ["Longest streak", fmt(s.longestStreak)], ["Active days", fmt(st.activeDays)], ["Lifetime KU", fmt(st.lifetimeKU)],
      ["This week KU", fmt(st.weekKU)], ["This month KU", fmt(st.monthKU)], ["Top specialty", esc(st.topSpec || "—")], ["Top calculator", esc(st.topCalc || "—")]
    ].map(function (t) { return '<div class="smd-stat"><div class="n">' + t[1] + '</div><div class="l">' + t[0] + '</div></div>'; }).join("");
    // 14-day KU chart from activity rollups
    var act = (s.activity || []).slice().reverse();          // oldest→newest
    var max = act.reduce(function (m, a) { return Math.max(m, a.ku || 0); }, 1);
    var bars = act.map(function (a) { return '<div class="b" style="height:' + Math.max(2, Math.round((a.ku || 0) / max * 90)) + 'px" title="' + a.day + ': ' + (a.ku || 0) + ' KU"></div>'; }).join("");
    // 30-day streak calendar from days[]
    var days = s.days || []; var set = {}; days.forEach(function (d) { set[d] = 1; });
    var today = (window.SMD_STREAK && SMD_STREAK.todayKey && SMD_STREAK.todayKey()) || "";
    var cal = "";
    for (var i = 29; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var k = "" + d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
      cal += '<i class="' + (set[k] ? "on" : "") + (k === today ? " today" : "") + '"></i>';
    }
    return '<div class="smd-card"><h4>Statistics</h4><div class="smd-grid2">' + tiles + '</div></div>' +
      (bars ? '<div class="smd-card"><h4>Knowledge Units · last ' + act.length + ' days</h4><div class="smd-bars">' + bars + '</div></div>' : '') +
      '<div class="smd-card"><h4>Streak · last 30 days</h4><div class="smd-cal">' + cal + '</div></div>';
  }

  function renderTimeline(s) {
    var act = (s.activity || []);   // already newest-first from server
    if (!act.length) return '<div class="smd-card smd-muted" style="font:500 13px;text-align:center">No activity yet. Start reading to earn Knowledge Units.</div>';
    function dlabel(k) { try { var y = +k.slice(0, 4), m = +k.slice(4, 6) - 1, d = +k.slice(6, 8); return new Date(y, m, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch (e) { return k; } }
    var body = act.map(function (a) {
      var entries = [];
      var bt = a.byType || {};
      Object.keys(bt).forEach(function (t) { if (bt[t] > 0 && LBL[t]) entries.push("+" + bt[t] + " KU · " + LBL[t]); });
      (a.notes || []).forEach(function (n) {
        if (n.kind === "streak") entries.push("🔥 " + n.n + "-day streak");
        else if (n.kind === "badge") entries.push("🏅 Badge unlocked");
        else if (n.kind === "quest") entries.push("✓ Daily quest · +" + (n.ku || 20) + " KU");
        else if (n.kind === "weekly") entries.push("⭐ Weekly bonus · +" + (n.ku || 50) + " KU");
        else if (n.kind === "monthly") entries.push("🌟 Monthly bonus · +" + (n.ku || 250) + " KU");
      });
      if (!entries.length) return "";
      return '<div class="d">' + dlabel(a.day) + '</div>' + entries.map(function (e) { return '<div class="e">' + esc(e) + '</div>'; }).join("");
    }).join("");
    return '<div class="smd-card"><h4>Activity</h4><div class="smd-tl">' + body + '</div></div>';
  }

  // ── overlay controller ──
  var achState = { cat: "", rar: "", status: "all", sort: "default", q: "" };
  function openDashboard(tab) {
    injectCSS();
    if (!signedIn()) { openSignin(); return; }
    var ov = document.createElement("div"); ov.className = "smd-eng-ov";
    ov.innerHTML =
      '<div class="smd-eng" role="dialog" aria-label="Clinical progress">' +
      '<div class="smd-eng-hd"><h3>Clinical Progress</h3><button class="smd-eng-x" aria-label="Close">×</button></div>' +
      '<div class="smd-eng-tabs">' +
      ['dashboard,Dashboard', 'achievements,Achievements', 'stats,Stats', 'timeline,Timeline'].map(function (t) { var p = t.split(","); return '<button class="smd-eng-tab" data-tab="' + p[0] + '">' + p[1] + '</button>'; }).join("") +
      '</div><div class="smd-eng-bd" data-body></div></div>';
    document.body.appendChild(ov);
    var bodyEl = ov.querySelector("[data-body]");
    var cur = tab || "dashboard";
    function paint() {
      var s = cache() || {};
      var sp = (window.SMD_STREAK && SMD_STREAK.progress) ? SMD_STREAK.progress() : null;
      ov.querySelectorAll(".smd-eng-tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === cur); });
      if (cur === "dashboard") bodyEl.innerHTML = renderDashboard(s, sp);
      else if (cur === "achievements") bodyEl.innerHTML = renderAchievements(s, achState);
      else if (cur === "stats") bodyEl.innerHTML = renderStats(s);
      else bodyEl.innerHTML = renderTimeline(s);
    }
    function close() { ov.remove(); cleanup(); }
    ov.querySelector(".smd-eng-x").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelectorAll(".smd-eng-tab").forEach(function (b) { b.addEventListener("click", function () { cur = b.getAttribute("data-tab"); bodyEl.scrollTop = 0; paint(); }); });
    // delegated interactions inside the body
    bodyEl.addEventListener("click", function (e) {
      var t = e.target;
      var share = t.closest && t.closest('[data-eng="share"]'); if (share) { try { if (window.SMD_SHARECARD) SMD_SHARECARD.open(); } catch (x) {} return; }
      var cat = t.closest && t.closest("[data-cat]"); if (cat) { achState.cat = cat.getAttribute("data-cat"); paint(); return; }
      var stc = t.closest && t.closest("[data-status]"); if (stc) { achState.status = stc.getAttribute("data-status"); paint(); return; }
      var srt = t.closest && t.closest("[data-sort]"); if (srt) { achState.sort = srt.getAttribute("data-sort"); paint(); return; }
      var pin = t.closest && t.closest("[data-pin]"); if (pin) { togglePin(pin.getAttribute("data-pin"), s2()); paint(); return; }
    });
    bodyEl.addEventListener("input", function (e) { var se = e.target.closest && e.target.closest("[data-search]"); if (se) { achState.q = se.value; var v = se.value; paint(); var ns = bodyEl.querySelector("[data-search]"); if (ns) { ns.focus(); ns.value = v; ns.setSelectionRange(v.length, v.length); } } });
    function s2() { return cache() || {}; }
    // live refresh
    function onSummary() { paint(); }
    function onProg() { if (cur === "dashboard") paint(); }
    var offList = [];
    try { if (window.SMD_KU && SMD_KU.onChange) { SMD_KU.onChange(onSummary); } } catch (e) {}
    try { window.addEventListener("smd-streak-progress", onProg); offList.push(function () { window.removeEventListener("smd-streak-progress", onProg); }); } catch (e) {}
    try { window.addEventListener("smd-streak-qualified", onSummary); offList.push(function () { window.removeEventListener("smd-streak-qualified", onSummary); }); } catch (e) {}
    function cleanup() { offList.forEach(function (f) { try { f(); } catch (e) {} }); }
    paint();
    // refresh from server
    try { if (window.SMD_KU && SMD_KU.summary) SMD_KU.summary().then(function () { paint(); }); } catch (e) {}
  }

  function togglePin(id, s) {
    var pinned = (s.pinned || []).slice();
    var i = pinned.indexOf(id);
    if (i >= 0) pinned.splice(i, 1); else { if (pinned.length >= 3) pinned.shift(); pinned.push(id); }
    // optimistic local update
    try { var c = cache(); if (c) c.pinned = pinned; } catch (e) {}
    idToken().then(function (tok) {
      if (!tok) return;
      fetch(kuBase() + "/pin", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ ids: pinned }) })
        .then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { try { var c = cache(); if (c && j && j.pinned) c.pinned = j.pinned; } catch (e) {} });
    }).catch(function () {});
  }
  function kuBase() { return window.AI_PROXY ? String(window.AI_PROXY).replace(/\/ai\b/, "/ku") : "/api/ku"; }
  function idToken() { try { var u = window.firebase && firebase.auth && firebase.auth().currentUser; if (u && u.getIdToken) return u.getIdToken().catch(function () { return null; }); } catch (e) {} return Promise.resolve(null); }

  function openSignin() {
    var ov = document.createElement("div"); ov.className = "smd-eng-ov";
    ov.innerHTML = '<div class="smd-eng" style="height:auto;padding:24px 20px 28px"><div class="smd-eng-hd" style="border:0;padding:0 0 12px"><h3>Clinical Progress</h3><button class="smd-eng-x">×</button></div><p class="smd-muted" style="font:500 13.5px var(--hfont,system-ui);line-height:1.5;margin:0 0 16px">Sign in to track your learning streak, earn Knowledge Units, unlock achievements and level up.</p><button class="smd-btn" data-si>Sign in</button></div>';
    document.body.appendChild(ov);
    ov.querySelector(".smd-eng-x").addEventListener("click", function () { ov.remove(); });
    ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
    ov.querySelector("[data-si]").addEventListener("click", function () { ov.remove(); try { if (window.SMD_openAccount) SMD_openAccount(); else if (window.openMore) openMore(); } catch (e) {} });
  }

  // ── self-wire the KU chip → open the dashboard (no home.js edit) ──
  document.addEventListener("click", function (e) {
    var chip = e.target && e.target.closest && e.target.closest('.v3-ku, [data-act="ku"], [data-mi="ku"]');
    if (!chip) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openDashboard();
  }, true);

  // ── always-on unlock notifier (diff the merged summary; never spam) ──
  (function notifier() {
    var snap = null, queue = [], showing = false;
    function toSnap(s) {
      var set = {}; (s.badges || []).forEach(function (b) { if (b.unlocked) set[b.id] = 1; });
      return { level: s.level || 0, discount: (s.tiers || []).filter(function (t) { return t.unlocked; }).length, badges: set, quest: !!(s.quest && s.quest.completedToday) };
    }
    function push(title, body, url) { queue.push({ title: title, body: body, url: url }); drain(); }
    function drain() {
      if (showing || !queue.length) return; showing = true;
      var n = queue.shift();
      try { if (window.SMD_localNotify) window.SMD_localNotify(n.title, n.body, n.url || "/"); else if (window.SMD_toast) window.SMD_toast(n.title + " — " + n.body); } catch (e) {}
      setTimeout(function () { showing = false; drain(); }, 1400);
    }
    function check(s) {
      if (!s || typeof s.level !== "number") return;
      var n = toSnap(s);
      if (!snap) { snap = n; return; }                          // baseline; don't fire on first load
      if (n.level > snap.level) push("Level up", "You reached level " + n.level + " · " + (s.levelName || ""));
      Object.keys(n.badges).forEach(function (id) { if (!snap.badges[id]) { var b = (s.badges || []).find(function (x) { return x.id === id; }); if (b && b.name && b.name !== "???") push("Achievement unlocked", b.name); } });
      if (n.discount > snap.discount) push("Reward unlocked", "You've earned a new subscription discount tier");
      if (n.quest && !snap.quest) push("Daily quest complete", "Nice work — quest reward added");
      snap = n;
    }
    try { if (window.SMD_KU && SMD_KU.onChange) SMD_KU.onChange(check); } catch (e) {}
    try { window.addEventListener("smd-streak-qualified", function (e) { if (e && e.detail) check(e.detail); }); } catch (e) {}
  })();

  window.SMD_ENGAGE = { openDashboard: openDashboard };
})();
