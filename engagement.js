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

  // Chrome line-icons from the shared catalog (guarded; returns "" if unavailable).
  function egIco(n) { return (window.ICONS && ICONS.get) ? ICONS.get(n) : ""; }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function fmt(n) { try { return Number(n || 0).toLocaleString("en-US"); } catch (e) { return String(n || 0); } }
  function pct(a, b) { return b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0; }
  function signedIn() { try { return !!(window.SMD_KU && SMD_KU.signedIn && SMD_KU.signedIn()); } catch (e) { return false; } }
  function cache() { try { return (window.SMD_KU && SMD_KU._cache && SMD_KU._cache()) || null; } catch (e) { return null; } }

  function injectCSS() {
    if (document.getElementById("smdEngCss")) return;
    var s = document.createElement("style"); s.id = "smdEngCss";
    var F = "var(--rds-font,var(--hfont,system-ui))";
    s.textContent = [
      /* Tokens: one place for light and dark (the sheet used to stay white in dark mode). */
      ".smd-eng{--e-bg:#f2f6f5;--e-card:#fff;--e-ink:#10241f;--e-mut:#5d7570;--e-line:rgba(11,79,67,.11);--e-teal:" + TEAL + ";--e-teal-d:" + TEAL_D + ";--e-tint:" + TINT + ";--e-amber:" + AMBER + ";--e-track:rgba(16,36,31,.08)}",
      "body.dark .smd-eng{--e-bg:#081311;--e-card:#0f1e1b;--e-ink:#e8f3ef;--e-mut:#93aea6;--e-line:rgba(255,255,255,.08);--e-teal:#3fc4a0;--e-teal-d:#8fe3c8;--e-tint:rgba(63,196,160,.14);--e-track:rgba(255,255,255,.08)}",
      ".smd-eng-ov{position:fixed;inset:0;z-index:99998;background:rgba(4,22,19,.48);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center}",
      ".smd-eng{background:var(--e-bg);color:var(--e-ink);width:100%;max-width:520px;height:94vh;max-height:calc(100vh - env(safe-area-inset-top,0px) - 8px);border-radius:24px 24px 0 0;overflow:hidden;display:flex;flex-direction:column;font:400 14px/1.35 " + F + ";-webkit-font-smoothing:antialiased;box-shadow:0 -12px 40px rgba(0,0,0,.18)}",
      ".smd-eng *{box-sizing:border-box}",
      ".smd-eng .smd-ico{width:1em;height:1em;vertical-align:-.14em;flex:none}",
      ".smd-eng-grab{width:38px;height:5px;border-radius:3px;background:var(--e-line);margin:8px auto 0;flex:none}",
      ".smd-eng-hd{display:flex;align-items:center;justify-content:space-between;padding:8px 16px 4px}",
      ".smd-eng-hd h3{margin:0;font:700 20px/1.2 " + F + ";letter-spacing:-.01em;color:var(--e-ink)}",
      ".smd-eng-x{width:32px;height:32px;border:0;border-radius:50%;background:var(--e-track);color:var(--e-mut);font:500 20px/1 " + F + ";cursor:pointer;display:flex;align-items:center;justify-content:center}",
      ".smd-eng-tabs{display:flex;gap:2px;margin:8px 16px 4px;padding:3px;border-radius:12px;background:var(--e-track)}",
      ".smd-eng-tab{flex:1;white-space:nowrap;border:0;background:transparent;color:var(--e-mut);font:600 13px " + F + ";padding:7px 4px;border-radius:9px;cursor:pointer}",
      ".smd-eng-tab.on{background:var(--e-card);color:var(--e-ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}",
      ".smd-eng-bd{flex:1;overflow:auto;padding:12px 16px calc(20px + env(safe-area-inset-bottom,0px));-webkit-overflow-scrolling:touch}",
      ".smd-card{background:var(--e-card);border-radius:18px;padding:16px;margin-bottom:12px;box-shadow:0 0 0 1px var(--e-line)}",
      ".smd-card h4{margin:0 0 12px;font:700 15px " + F + ";color:var(--e-ink);display:flex;align-items:center;justify-content:space-between;gap:8px}",
      ".smd-row{display:flex;align-items:center;justify-content:space-between;gap:10px}",
      ".smd-muted{color:var(--e-mut)}",
      ".smd-sm{font:500 12.5px " + F + "}.smd-xs{font:600 11.5px " + F + "}.smd-num{font-variant-numeric:tabular-nums}",
      ".smd-pill{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 9px;font:700 12px " + F + ";background:var(--e-tint);color:var(--e-teal-d)}",
      ".smd-pill.amber{background:rgba(244,166,42,.16);color:#a3620a}body.dark .smd-pill.amber{color:#f6c06a}",
      ".smd-bar{height:6px;border-radius:999px;background:var(--e-track);overflow:hidden;margin-top:6px}",
      ".smd-bar>i{display:block;height:100%;border-radius:999px;background:var(--e-teal)}",
      ".smd-bar.amber>i{background:var(--e-amber)}",
      /* Hero */
      ".smd-hero{background:radial-gradient(120% 140% at 100% 0%,rgba(143,227,200,.22) 0,transparent 55%),linear-gradient(150deg," + TEAL + " 0%," + TEAL_D + " 100%);color:#fff;box-shadow:0 10px 26px -12px rgba(6,60,50,.55)}",
      ".smd-hero .smd-muted{color:rgba(232,246,241,.78)}",
      ".smd-lv{display:flex;align-items:center;gap:14px}",
      ".smd-ring{position:relative;width:64px;height:64px;flex:none}.smd-ring svg{width:64px;height:64px;transform:rotate(-90deg)}",
      ".smd-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 22px " + F + "}",
      ".smd-lv-eb{font:700 11px " + F + ";letter-spacing:.08em;text-transform:uppercase;opacity:.8}",
      ".smd-lv-nm{font:700 21px/1.15 " + F + ";letter-spacing:-.01em;margin-top:2px}",
      ".smd-lv-to{font:500 12.5px " + F + ";margin-top:4px}",
      ".smd-hstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.16)}",
      ".smd-hstats>div+div{border-left:1px solid rgba(255,255,255,.16);padding-left:12px}",
      ".smd-hstats .n{font:700 20px/1.1 " + F + ";font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:5px}",
      ".smd-hstats .n .smd-ico{color:#8fe3c8;width:17px;height:17px}",
      ".smd-hstats .l{font:500 11.5px " + F + ";margin-top:3px}",
      /* Today */
      ".smd-src{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px 16px;margin-top:14px}",
      ".smd-src .t{display:flex;justify-content:space-between;font:500 12.5px " + F + "}",
      ".smd-goal{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--e-line)}",
      ".smd-goal:first-of-type{border-top:0}",
      ".smd-tick{width:22px;height:22px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;border:2px solid var(--e-line);color:#fff;font-size:13px}",
      ".smd-tick.on{background:var(--e-teal);border-color:var(--e-teal)}",
      ".smd-btn{border:0;background:var(--e-teal);color:#fff;font:700 15px " + F + ";border-radius:14px;padding:14px;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center;gap:8px}",
      "body.dark .smd-btn{color:#04201a}",
      /* Achievements */
      ".smd-input{width:100%;border:0;border-radius:12px;padding:10px 12px 10px 36px;font:500 14px " + F + ";background:var(--e-track) no-repeat 12px 50%/16px;color:var(--e-ink);margin:12px 0 10px;outline:none}",
      ".smd-srch{position:relative}.smd-srch .smd-ico{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--e-mut);width:16px;height:16px}",
      ".smd-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:0 16px 2px}.smd-chips::-webkit-scrollbar{display:none}",
      ".smd-chip{border:0;background:var(--e-track);color:var(--e-ink);font:600 12.5px " + F + ";border-radius:999px;padding:7px 12px;cursor:pointer;white-space:nowrap;flex:none}",
      ".smd-chip.on{background:var(--e-teal);color:#fff}body.dark .smd-chip.on{color:#04201a}",
      ".smd-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--e-track);margin-top:10px}",
      ".smd-seg button{flex:1;border:0;background:transparent;color:var(--e-mut);font:600 12.5px " + F + ";padding:6px;border-radius:8px;cursor:pointer}",
      ".smd-seg button.on{background:var(--e-card);color:var(--e-ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}",
      ".smd-badges{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}",
      ".smd-badge{background:var(--e-card);border-radius:16px;padding:14px;position:relative;box-shadow:0 0 0 1px var(--e-line);display:flex;flex-direction:column}",
      ".smd-medal{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;margin-bottom:10px}",
      ".smd-medal .smd-ico{width:22px;height:22px}",
      ".smd-badge.locked .smd-medal{background:var(--e-track)!important;color:var(--e-mut)}",
      ".smd-badge.locked .bn{color:var(--e-mut)}",
      ".smd-badge .bn{font:700 13.5px/1.25 " + F + "}",
      ".smd-badge .bd{font:500 12px/1.35 " + F + ";color:var(--e-mut);margin-top:3px;flex:1}",
      ".smd-rar{align-self:flex-start;font:700 10px " + F + ";letter-spacing:.06em;text-transform:uppercase;margin-top:8px}",
      ".smd-pin{position:absolute;top:8px;right:8px;width:30px;height:30px;border:0;background:transparent;cursor:pointer;color:var(--e-line);display:flex;align-items:center;justify-content:center}",
      ".smd-pin .smd-ico{width:17px;height:17px}.smd-pin.on{color:var(--e-amber)}",
      /* Stats */
      ".smd-kpis{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:12px}",
      ".smd-kpi{background:var(--e-card);border-radius:16px;padding:14px;box-shadow:0 0 0 1px var(--e-line)}",
      ".smd-kpi .n{font:700 26px/1.1 " + F + ";font-variant-numeric:tabular-nums;letter-spacing:-.02em}",
      ".smd-kpi .l{font:500 12px " + F + ";color:var(--e-mut);margin-top:4px;display:flex;align-items:center;gap:5px}",
      ".smd-li{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid var(--e-line);font:500 14px " + F + "}",
      ".smd-li:first-of-type{border-top:0;padding-top:2px}",
      ".smd-li .ic{width:32px;height:32px;border-radius:10px;background:var(--e-tint);color:var(--e-teal-d);display:flex;align-items:center;justify-content:center;flex:none}",
      ".smd-li .ic .smd-ico{width:17px;height:17px}",
      ".smd-li .v{margin-left:auto;font:700 15px " + F + ";font-variant-numeric:tabular-nums}",
      ".smd-bars{display:flex;align-items:flex-end;gap:5px;height:96px;margin-top:6px}",
      ".smd-bars .b{flex:1;background:var(--e-teal);opacity:.38;border-radius:5px 5px 2px 2px;min-height:3px}",
      ".smd-bars .b.now{opacity:1}",
      ".smd-bars-x{display:flex;gap:5px;margin-top:6px}.smd-bars-x span{flex:1;text-align:center;font:600 10.5px " + F + ";color:var(--e-mut)}",
      ".smd-cal{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:6px}",
      ".smd-cal i{aspect-ratio:1;border-radius:6px;background:var(--e-track)}",
      ".smd-cal i.on{background:var(--e-teal)}.smd-cal i.today{box-shadow:0 0 0 2px var(--e-card),0 0 0 4px var(--e-amber)}",
      ".smd-legend{display:flex;gap:14px;margin-top:12px;font:500 11.5px " + F + ";color:var(--e-mut)}.smd-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}",
      /* Timeline */
      ".smd-day{padding:12px 0;border-top:1px solid var(--e-line)}.smd-day:first-of-type{border-top:0;padding-top:0}",
      ".smd-day .h{display:flex;justify-content:space-between;align-items:baseline;font:700 14px " + F + "}",
      ".smd-day .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}",
      ".smd-day .tag{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 10px;background:var(--e-track);font:600 12px " + F + ";color:var(--e-ink)}",
      ".smd-day .tag.hi{background:rgba(244,166,42,.16);color:#a3620a}body.dark .smd-day .tag.hi{color:#f6c06a}",
      ".smd-empty{text-align:center;padding:28px 12px;font:500 14px " + F + ";color:var(--e-mut)}",
      /* Tappable "Today" sources: each one takes you to where that KU is earned. */
      ".smd-src button{all:unset;display:block;cursor:pointer;border-radius:10px;padding:6px;margin:-6px;-webkit-tap-highlight-color:transparent}",
      ".smd-src button:active{background:var(--e-track)}.smd-src button:focus-visible{outline:2px solid var(--e-teal);outline-offset:1px}",
      ".smd-src .t .smd-ico{width:13px;height:13px;color:var(--e-mut);margin-left:2px}",
      ".smd-src .full .t span:first-child{color:var(--e-mut)}",
      ".smd-hint{font:500 12.5px " + F + ";color:var(--e-mut);margin-top:12px}",
      ".smd-welcome{font:500 13px/1.45 " + F + ";margin-top:12px;color:rgba(232,246,241,.86)}",
      ".smd-sortrow{display:flex;align-items:center;justify-content:space-between;margin-top:10px;font:500 12.5px " + F + ";color:var(--e-mut)}",
      ".smd-sort{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:var(--e-teal-d);font:700 12.5px " + F + ";padding:4px 18px 4px 4px;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-size:5px 5px;background-position:right 6px top 55%,right 2px top 55%;background-repeat:no-repeat}",
      ".smd-ring circle.fg{transition:stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)}",
      ".smd-bar>i{transition:width .6s cubic-bezier(.2,.8,.2,1)}",
      ".smd-sk{border-radius:18px;margin-bottom:12px;background:linear-gradient(90deg,var(--e-track) 0,rgba(255,255,255,.35) 50%,var(--e-track) 100%) 0 0/200% 100%;animation:smdSk 1.2s linear infinite}",
      "@keyframes smdSk{to{background-position:-200% 0}}",
      ".smd-eng.drag{transition:none}",
      "@media (prefers-reduced-motion:reduce){.smd-ring circle.fg,.smd-bar>i{transition:none}.smd-sk{animation:none}}"
    ].join("");
    document.head.appendChild(s);
  }

  // ── section renderers ──
  var CAT_ICON = { reading: "book", cases: "stcase", calculators: "calc", maik: "ai", streak: "bolt", consistency: "clock", quests: "target", levels: "trend", combo: "spark", special: "star" };
  function medalFor(b) {
    var c = RARITY[b.rarity] || RARITY.common;
    var icon = (b.hidden && !b.unlocked) ? "lock" : (CAT_ICON[b.cat] || "award");
    return '<div class="smd-medal" style="background:' + c + '">' + egIco(icon) + '</div>';
  }
  function ring(p) {
    var C = 169.6, off = C - C * Math.max(0, Math.min(100, p || 0)) / 100;
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="6"/><circle cx="32" cy="32" r="27" fill="none" stroke="#8fe3c8" stroke-width="6" stroke-linecap="round" class="fg" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '" data-off="' + off.toFixed(1) + '"/></svg>';
  }

  function renderDashboard(s, streakP) {
    var lvl = s.level || 1, lvlToNext = s.levelToNext != null ? s.levelToNext : 0;
    var today = s.today || {};
    var q = s.quest || { goals: [] };
    var tot = today.total || 0;
    var GO = { read: "search", "case": "startcase", calc: "calculators", maik: "askai" };
    var src = function (key, label) {
      var t = today[key] || { ku: 0, cap: 0 }, full = t.cap > 0 && t.ku >= t.cap;
      return '<button type="button" data-go="' + GO[key] + '" class="' + (full ? 'full' : '') + '" aria-label="' + label + ': ' + t.ku + ' of ' + t.cap + ' KU today' + (full ? ', daily limit reached' : ', open') + '"><div class="t"><span>' + label + (full ? ' ' + egIco("check") : '') + '</span><span class="smd-muted smd-num">' + t.ku + '/' + t.cap + (full ? '' : egIco("chev")) + '</span></div><div class="smd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + t.cap + '" aria-valuenow="' + t.ku + '"><i style="width:' + pct(t.ku, t.cap) + '%"></i></div></button>';
    };
    var sp = streakP || { seconds: 0, target: 300, done: false };
    var mins = Math.floor(sp.seconds / 60), tmin = Math.round(sp.target / 60);
    var streakLine = sp.done
      ? '<div class="smd-row smd-sm" style="color:var(--e-teal);font-weight:600">' + egIco("check") + '<span style="flex:1">Streak secured for today</span></div>'
      : '<div class="smd-row smd-sm"><span>' + egIco("bolt") + ' ' + mins + ' of ' + tmin + ' min active to keep your streak</span><span class="smd-muted smd-num">' + pct(sp.seconds, sp.target) + '%</span></div><div class="smd-bar amber"><i style="width:' + pct(sp.seconds, sp.target) + '%"></i></div>';
    var goals = (q.goals || []).map(function (g) {
      var done = g.have >= g.need;
      return '<div class="smd-goal"><span class="smd-tick' + (done ? ' on' : '') + '">' + (done ? egIco("check") : '') + '</span><span style="flex:1;font:500 14px var(--rds-font,system-ui)">' + esc(LBL[g.type] || g.type) + '</span><span class="smd-muted smd-num smd-sm">' + Math.min(g.have, g.need) + ' / ' + g.need + '</span></div>';
    }).join("");
    var tier = s.nextTier;
    var reward = tier
      ? '<div class="smd-row smd-sm"><span><b>' + fmt(tier.ku - (s.balance || 0)) + ' KU</b> to ' + esc(tier.label) + '</span><span class="smd-muted smd-num">' + (s.progressPct || 0) + '%</span></div><div class="smd-bar"><i style="width:' + (s.progressPct || 0) + '%"></i></div>'
      : '<div class="smd-sm">' + egIco("spark") + ' Every reward tier unlocked</div>';

    return (
      '<div class="smd-card smd-hero">' +
        '<div class="smd-lv"><div class="smd-ring">' + ring(s.levelPct) + '<b>' + lvl + '</b></div>' +
        '<div style="min-width:0"><div class="smd-lv-eb">Your level</div><div class="smd-lv-nm">' + esc(s.levelName || "Intern") + '</div><div class="smd-lv-to smd-muted">' + fmt(lvlToNext) + ' KU to level ' + (lvl + 1) + '</div></div></div>' +
        '<div class="smd-hstats">' +
          '<div><div class="n" data-count="' + (s.balance || 0) + '">' + fmt(s.balance || 0) + '</div><div class="l smd-muted">Knowledge Units</div></div>' +
          '<div><div class="n">' + egIco("bolt") + (s.streak || 0) + '</div><div class="l smd-muted">Day streak</div></div>' +
          '<div><div class="n">' + egIco("award") + (s.longestStreak || 0) + '</div><div class="l smd-muted">Best streak</div></div>' +
        '</div>' +
        (!(s.balance > 0) ? '<div class="smd-welcome">Earn Knowledge Units as you read topics, run cases, use calculators and ask MaiK. Five active minutes a day builds your streak.</div>' : '') +
      '</div>' +
      '<div class="smd-card"><h4>Today <span class="smd-pill">+' + tot + ' KU</span></h4>' + streakLine +
        '<div class="smd-src">' + src("read", "Reading") + src("case", "Cases") + src("calc", "Calculators") + src("maik", "MaiK") + '</div>' +
        '<div class="smd-hint">Tap a row to earn more. Each source has a daily limit.</div></div>' +
      (q.label || goals ? '<div class="smd-card"><h4>Daily quest ' + (q.completedToday ? '<span class="smd-pill">' + egIco("check") + ' Done</span>' : '<span class="smd-pill amber">+' + (q.reward || 20) + ' KU</span>') + '</h4>' +
        (q.label ? '<div class="smd-sm smd-muted" style="margin:-6px 0 6px">' + esc(q.label) + '</div>' : '') + goals + '</div>' : '') +
      '<div class="smd-card"><h4>Next reward</h4>' + reward + '</div>' +
      (s.balance > 0 ? '<button class="smd-btn" data-eng="share">' + egIco("share") + ' Share my progress</button>' : '')
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
      if (state.sort === "progress") { if (a.unlocked !== b.unlocked) return a.unlocked ? 1 : -1; return (b.pct || 0) - (a.pct || 0); }
      if (state.sort === "recent") { if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1; return (b.unlockedAt || 0) - (a.unlockedAt || 0); }
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      if (a.unlocked) return (b.unlockedAt || 0) - (a.unlockedAt || 0);
      return (b.pct || 0) - (a.pct || 0);
    });
    var unlocked = badges.filter(function (b) { return b.unlocked; }).length;
    var present = {}; badges.forEach(function (b) { present[b.cat] = 1; });
    var chips = '<button class="smd-chip' + (!state.cat ? ' on' : '') + '" data-cat="">All</button>' +
      CATS.filter(function (c) { return present[c.k]; }).map(function (c) { return '<button class="smd-chip' + (state.cat === c.k ? ' on' : '') + '" data-cat="' + c.k + '">' + c.label + '</button>'; }).join("");
    var seg = [["all", "All"], ["unlocked", "Unlocked"], ["locked", "In progress"]].map(function (x) { return '<button class="' + ((state.status || "all") === x[0] ? 'on' : '') + '" data-status="' + x[0] + '">' + x[1] + '</button>'; }).join("");
    var tiles = filtered.map(function (b) {
      var isPin = pinned.indexOf(b.id) >= 0;
      var rc = RARITY[b.rarity] || RARITY.common;
      return '<div class="smd-badge' + (b.unlocked ? '' : ' locked') + '">' +
        (b.unlocked ? '<button class="smd-pin' + (isPin ? ' on' : '') + '" data-pin="' + esc(b.id) + '" aria-label="' + (isPin ? 'Unpin' : 'Pin to profile') + '" aria-pressed="' + isPin + '">' + egIco("star") + '</button>' : '') +
        medalFor(b) +
        '<div class="bn">' + esc(b.hidden && !b.unlocked ? "Hidden" : b.name) + '</div><div class="bd">' + esc(b.hidden && !b.unlocked ? "Keep exploring to reveal it" : b.desc) + '</div>' +
        (b.unlocked ? '' : '<div class="smd-bar"><i style="width:' + (b.pct || 0) + '%"></i></div><div class="smd-muted smd-xs smd-num" style="margin-top:4px">' + fmt(b.value) + ' / ' + fmt(b.target) + '</div>') +
        '<span class="smd-rar" style="color:' + rc + '">' + esc(b.rarity) + '</span>' +
        '</div>';
    }).join("");
    return '<div class="smd-card"><h4>Achievements <span class="smd-muted smd-sm smd-num">' + unlocked + ' of ' + badges.length + '</span></h4>' +
      '<div class="smd-bar" style="margin-top:-4px"><i style="width:' + pct(unlocked, badges.length) + '%"></i></div>' +
      '<div class="smd-srch">' + egIco("search") + '<input class="smd-input" data-search type="search" placeholder="Search achievements" aria-label="Search achievements" value="' + esc(state.q || "") + '"></div>' +
      '<div class="smd-chips">' + chips + '</div>' +
      '<div class="smd-seg" role="group" aria-label="Show">' + seg + '</div>' +
      '<div class="smd-sortrow"><span class="smd-num">' + filtered.length + (filtered.length === 1 ? ' achievement' : ' achievements') + '</span><label>Sort <select class="smd-sort" data-sortsel aria-label="Sort achievements">' +
        [["default", "Suggested"], ["progress", "Closest to unlock"], ["recent", "Recently unlocked"]].map(function (x) { return '<option value="' + x[0] + '"' + ((state.sort || "default") === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join("") +
      '</select></label></div></div>' +
      '<div class="smd-badges">' + (tiles || '<div class="smd-empty" style="grid-column:1/-1">No achievements match.</div>') + '</div>';
  }

  function renderStats(s) {
    var st = s.stats || {};
    var kpi = function (n, l, ic) { return '<div class="smd-kpi"><div class="n">' + n + '</div><div class="l">' + (ic ? egIco(ic) : '') + l + '</div></div>'; };
    var li = function (ic, l, v) { return '<div class="smd-li"><span class="ic">' + egIco(ic) + '</span><span>' + l + '</span><span class="v">' + v + '</span></div>'; };
    var act = (s.activity || []).slice().reverse();          // oldest→newest
    var max = act.reduce(function (m, a) { return Math.max(m, a.ku || 0); }, 1);
    var sum = act.reduce(function (m, a) { return m + (a.ku || 0); }, 0);
    var wd = function (k) { try { return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)).toLocaleDateString("en-US", { weekday: "narrow" }); } catch (e) { return ""; } };
    var bars = act.map(function (a, i) { return '<div class="b' + (i === act.length - 1 ? ' now' : '') + '" style="height:' + Math.max(3, Math.round((a.ku || 0) / max * 96)) + 'px" title="' + a.day + ': ' + (a.ku || 0) + ' KU"></div>'; }).join("");
    var xs = act.map(function (a) { return '<span>' + wd(a.day) + '</span>'; }).join("");
    var days = s.days || []; var set = {}; days.forEach(function (d) { set[d] = 1; });
    var today = (window.SMD_STREAK && SMD_STREAK.todayKey && SMD_STREAK.todayKey()) || "";
    var cal = "", on = 0;
    for (var i = 29; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var k = "" + d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
      if (set[k]) on++;
      cal += '<i class="' + (set[k] ? "on" : "") + (k === today ? " today" : "") + '"></i>';
    }
    return '<div class="smd-kpis">' + kpi(fmt(st.lifetimeKU), "Lifetime KU") + kpi(fmt(st.activeDays), "Active days") + kpi(fmt(st.weekKU), "KU this week") + kpi(fmt(st.monthKU), "KU this month") + '</div>' +
      (bars ? '<div class="smd-card"><h4>Last ' + act.length + ' days <span class="smd-muted smd-sm smd-num">' + fmt(sum) + ' KU</span></h4><div class="smd-bars">' + bars + '</div><div class="smd-bars-x">' + xs + '</div></div>' : '') +
      '<div class="smd-card"><h4>What you have done</h4>' +
        li("book", "Topics read", fmt(st.readActions)) + li("stcase", "Cases", fmt(st.caseActions)) + li("calc", "Calculators used", fmt(st.calcActions)) + li("ai", "MaiK chats", fmt(st.maikActions)) +
        li("steth", "Top specialty", esc(st.topSpec || "None yet")) + li("target", "Top calculator", esc(st.topCalc || "None yet")) + '</div>' +
      '<div class="smd-card"><h4>Last 30 days <span class="smd-muted smd-sm smd-num">' + on + ' active</span></h4><div class="smd-cal">' + cal + '</div>' +
        '<div class="smd-legend"><span><i style="background:var(--e-teal)"></i>Active</span><span><i style="background:var(--e-track)"></i>Missed</span><span><i style="box-shadow:inset 0 0 0 2px var(--e-amber)"></i>Today</span></div></div>';
  }

  function renderTimeline(s) {
    var act = (s.activity || []);   // already newest-first from server
    if (!act.length) return '<div class="smd-card smd-empty">No activity yet. Read a topic or run a calculator to earn your first Knowledge Units.</div>';
    function dlabel(k) { try { var y = +k.slice(0, 4), m = +k.slice(4, 6) - 1, d = +k.slice(6, 8); var dt = new Date(y, m, d), n = new Date(); n.setHours(0, 0, 0, 0); var diff = Math.round((n - dt) / 864e5); return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch (e) { return k; } }
    var TICON = { read: "book", "case": "stcase", calc: "calc", maik: "ai", streak: "bolt", open: "home", combo: "spark", weekly: "star", monthly: "star", quest: "target" };
    var body = act.map(function (a) {
      var tags = [];
      var bt = a.byType || {};
      Object.keys(bt).forEach(function (t) { if (bt[t] > 0 && LBL[t]) tags.push('<span class="tag">' + egIco(TICON[t] || "plus") + LBL[t] + ' +' + bt[t] + '</span>'); });
      (a.notes || []).forEach(function (n) {
        if (n.kind === "streak") tags.push('<span class="tag hi">' + egIco("bolt") + n.n + '-day streak</span>');
        else if (n.kind === "badge") tags.push('<span class="tag hi">' + egIco("award") + 'Achievement unlocked</span>');
        else if (n.kind === "quest") tags.push('<span class="tag hi">' + egIco("target") + 'Daily quest +' + (n.ku || 20) + '</span>');
        else if (n.kind === "weekly") tags.push('<span class="tag hi">' + egIco("star") + 'Weekly bonus +' + (n.ku || 50) + '</span>');
        else if (n.kind === "monthly") tags.push('<span class="tag hi">' + egIco("star") + 'Monthly bonus +' + (n.ku || 250) + '</span>');
      });
      if (!tags.length) return "";
      return '<div class="smd-day"><div class="h"><span>' + dlabel(a.day) + '</span><span class="smd-num" style="color:var(--e-teal-d)">+' + fmt(a.ku || 0) + ' KU</span></div><div class="tags">' + tags.join("") + '</div></div>';
    }).join("");
    return '<div class="smd-card">' + (body || '<div class="smd-empty">No activity yet.</div>') + '</div>';
  }

  // ── overlay controller ──
  var achState = { cat: "", rar: "", status: "all", sort: "default", q: "" };
  function openDashboard(tab) {
    injectCSS();
    if (!signedIn()) { openSignin(); return; }
    var ov = document.createElement("div"); ov.className = "smd-eng-ov";
    ov.innerHTML =
      '<div class="smd-eng" role="dialog" aria-modal="true" aria-label="Clinical progress"><div class="smd-eng-grab" aria-hidden="true"></div>' +
      '<div class="smd-eng-hd"><h3>Clinical Progress</h3><button class="smd-eng-x" aria-label="Close">' + (egIco("x") || "×") + '</button></div>' +
      '<div class="smd-eng-tabs" role="tablist" aria-label="Clinical progress sections">' +
      ['dashboard,Dashboard', 'achievements,Achievements', 'stats,Stats', 'timeline,Timeline'].map(function (t) { var p = t.split(","); return '<button class="smd-eng-tab" role="tab" data-tab="' + p[0] + '">' + p[1] + '</button>'; }).join("") +
      '</div><div class="smd-eng-bd" data-body></div></div>';
    document.body.appendChild(ov);
    var bodyEl = ov.querySelector("[data-body]");
    var cur = tab || "dashboard";
    function paint() {
      var s = cache() || {};
      var sp = (window.SMD_STREAK && SMD_STREAK.progress) ? SMD_STREAK.progress() : null;
      ov.querySelectorAll(".smd-eng-tab").forEach(function (b) { var on = b.getAttribute("data-tab") === cur; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
      // First open before the server has answered: a skeleton, not a page of zeros that then jumps.
      if (!cache() && !loaded) { bodyEl.innerHTML = '<div class="smd-sk" style="height:178px"></div><div class="smd-sk" style="height:150px"></div><div class="smd-sk" style="height:130px"></div>'; return; }
      if (cur === "dashboard") bodyEl.innerHTML = renderDashboard(s, sp);
      else if (cur === "achievements") bodyEl.innerHTML = renderAchievements(s, achState);
      else if (cur === "stats") bodyEl.innerHTML = renderStats(s);
      else bodyEl.innerHTML = renderTimeline(s);
      afterPaint();
    }
    var loaded = false, animated = false;
    var RM = false; try { RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
    // The level ring fills and the KU total counts up once per opening; later repaints (the streak
    // timer repaints the dashboard) land on the final values without replaying the motion.
    function afterPaint() {
      var fg = bodyEl.querySelector(".smd-ring circle.fg"), n = bodyEl.querySelector("[data-count]");
      if (!fg) return;
      var first = !animated && loaded; if (first) animated = true;
      if (!first || RM) { fg.style.transition = "none"; fg.setAttribute("stroke-dashoffset", fg.getAttribute("data-off")); return; }
      requestAnimationFrame(function () { requestAnimationFrame(function () { fg.setAttribute("stroke-dashoffset", fg.getAttribute("data-off")); }); });
      var to = +n.getAttribute("data-count") || 0; if (to < 10) return;
      var t0 = 0, dur = 800;
      requestAnimationFrame(function step(ts) { if (!t0) t0 = ts; var k = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - k, 3); if (!n.isConnected) return; n.textContent = fmt(Math.round(to * e)); if (k < 1) requestAnimationFrame(step); });
    }
    var closing = false;
    function close() { if (closing) return; closing = true; ov.remove(); cleanup(); }
    ov.querySelector(".smd-eng-x").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelectorAll(".smd-eng-tab").forEach(function (b) { b.addEventListener("click", function () { cur = b.getAttribute("data-tab"); bodyEl.scrollTop = 0; paint(); }); });
    // delegated interactions inside the body
    bodyEl.addEventListener("click", function (e) {
      var t = e.target;
      var go = t.closest && t.closest("[data-go]");
      if (go) { var a = go.getAttribute("data-go"); close(); setTimeout(function () { try { if (window.SMD_moreAct) SMD_moreAct(a); } catch (x) {} }, 160); return; }
      var share = t.closest && t.closest('[data-eng="share"]'); if (share) { try { if (window.SMD_SHARECARD) SMD_SHARECARD.open(); } catch (x) {} return; }
      var cat = t.closest && t.closest("[data-cat]"); if (cat) { achState.cat = cat.getAttribute("data-cat"); paint(); return; }
      var stc = t.closest && t.closest("[data-status]"); if (stc) { achState.status = stc.getAttribute("data-status"); paint(); return; }
      var srt = t.closest && t.closest("[data-sort]"); if (srt) { achState.sort = srt.getAttribute("data-sort"); paint(); return; }
      var pin = t.closest && t.closest("[data-pin]"); if (pin) { togglePin(pin.getAttribute("data-pin"), s2()); paint(); return; }
    });
    bodyEl.addEventListener("input", function (e) { var se = e.target.closest && e.target.closest("[data-search]"); if (se) { achState.q = se.value; var v = se.value; paint(); var ns = bodyEl.querySelector("[data-search]"); if (ns) { ns.focus(); ns.value = v; ns.setSelectionRange(v.length, v.length); } } });
    bodyEl.addEventListener("change", function (e) { var sel = e.target.closest && e.target.closest("[data-sortsel]"); if (sel) { achState.sort = sel.value; paint(); var ns = bodyEl.querySelector("[data-sortsel]"); if (ns) ns.focus(); } });
    // Drag the handle or the title bar down to close, like every other sheet in the app.
    (function () {
      var sheet = ov.querySelector(".smd-eng"), y0 = 0, dy = 0, on = false;
      function start(e) { if (!e.touches || e.touches.length !== 1) return; if (!e.target.closest(".smd-eng-grab, .smd-eng-hd") || e.target.closest(".smd-eng-x")) return; on = true; y0 = e.touches[0].clientY; dy = 0; sheet.classList.add("drag"); }
      function move(e) { if (!on) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = dy ? "translateY(" + dy + "px)" : ""; }
      function end() { if (!on) return; on = false; sheet.classList.remove("drag"); if (dy > 110) { close(); return; } sheet.style.transition = "transform .2s ease"; sheet.style.transform = ""; setTimeout(function () { sheet.style.transition = ""; }, 220); }
      sheet.addEventListener("touchstart", start, { passive: true }); sheet.addEventListener("touchmove", move, { passive: true });
      sheet.addEventListener("touchend", end); sheet.addEventListener("touchcancel", end);
    })();
    function s2() { return cache() || {}; }
    // live refresh
    function onSummary() { if (ov.isConnected) paint(); }
    function onProg() { if (cur === "dashboard" && ov.isConnected) paint(); }
    var offList = [];
    try { if (window.SMD_KU && SMD_KU.onChange) { SMD_KU.onChange(onSummary); } } catch (e) {}
    try { window.addEventListener("smd-streak-progress", onProg); offList.push(function () { window.removeEventListener("smd-streak-progress", onProg); }); } catch (e) {}
    try { window.addEventListener("smd-streak-qualified", onSummary); offList.push(function () { window.removeEventListener("smd-streak-qualified", onSummary); }); } catch (e) {}
    function cleanup() { offList.forEach(function (f) { try { f(); } catch (e) {} }); }
    paint();
    // refresh from server
    function settle() { loaded = true; if (ov.isConnected) paint(); }
    try { if (window.SMD_KU && SMD_KU.summary) SMD_KU.summary().then(settle, settle); else settle(); } catch (e) { settle(); }
    // Offline or a slow server: never leave the skeleton up for long.
    setTimeout(function () { if (!loaded) settle(); }, 2500);
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
    function push(title, body, url, key) { queue.push({ title: title, body: body, url: url, key: key }); drain(); }
    function drain() {
      if (showing || !queue.length) return; showing = true;
      var n = queue.shift();
      // In the foreground the one authored celebration carries the moment (own queue, own once-per-key
      // guard, kill switch "smd_celebrate"). Hidden app or module absent: the old toast / local notice.
      if (window.SMD_CELEBRATE && !document.hidden) {
        try { window.SMD_CELEBRATE.show({ title: n.title, detail: n.body, key: n.key }); } catch (e) {}
        showing = false; drain(); return;
      }
      try { if (window.SMD_localNotify) window.SMD_localNotify(n.title, n.body, n.url || "/"); else if (window.SMD_toast) window.SMD_toast(n.title + ": " + n.body); } catch (e) {}
      setTimeout(function () { showing = false; drain(); }, 1400);
    }
    function check(s) {
      if (!s || typeof s.level !== "number") return;
      var n = toSnap(s);
      if (!snap) { snap = n; return; }                          // baseline; don't fire on first load
      if (n.level > snap.level) push("Level up", "You reached level " + n.level + " · " + (s.levelName || ""), null, "lvl:" + n.level);
      Object.keys(n.badges).forEach(function (id) { if (!snap.badges[id]) { var b = (s.badges || []).find(function (x) { return x.id === id; }); if (b && b.name && b.name !== "???") push("Achievement unlocked", b.name, null, "badge:" + id); } });
      if (n.discount > snap.discount) push("Reward unlocked", "You've earned a new subscription discount tier", null, "tier:" + n.discount);
      if (n.quest && !snap.quest) push("Daily quest complete", "Quest reward added", null, "quest:" + new Date().toISOString().slice(0, 10));
      snap = n;
    }
    try { if (window.SMD_KU && SMD_KU.onChange) SMD_KU.onChange(check); } catch (e) {}
    try { window.addEventListener("smd-streak-qualified", function (e) { if (e && e.detail) check(e.detail); }); } catch (e) {}
  })();

  window.SMD_ENGAGE = { openDashboard: openDashboard };
})();
