/* StewardMD — Settings ▸ Apple Watch.
 * ---------------------------------------------------------------------------
 * A self-contained settings page for the paired Apple Watch. Auto-detects
 * pairing via the WatchBridge native plugin (WCSession) and exposes connection,
 * sync, notification, widget/complication/Smart Stack/Siri, battery, offline,
 * version, capabilities, troubleshooting, diagnostics and (hidden) developer
 * information. Additive and defensive: on the web build (no plugin) it shows an
 * "available in the iOS app" state and never affects existing settings.
 *
 * Opened from the sidebar's Settings section (sidebar-redesign.js →
 * ACT.applewatch → SMD_APPLE_WATCH.open()).
 */
(function () {
  "use strict";

  var LS = {
    autosync: "smd_watch_autosync",
    lastSync: "smd_watch_last_sync",
    lowpower: "smd_watch_lowpower",
    nCritical: "smd_watch_notif_critical",
    nWarning: "smd_watch_notif_warning",
    nInfo: "smd_watch_notif_info"
  };

  function C() { return window.Capacitor; }
  function isNative() {
    var c = C();
    return !!(c && (typeof c.isNativePlatform === "function" ? c.isNativePlatform() : (c.platform && c.platform !== "web")));
  }
  function plugin() { var c = C(); return (c && c.Plugins && c.Plugins.WatchBridge) || null; }
  function get(k, def) { try { var v = localStorage.getItem(k); return v === null ? def : v === "1"; } catch (e) { return def; } }
  function set(k, on) { try { localStorage.setItem(k, on ? "1" : "0"); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function relTime(ms) {
    if (!ms) return "Never";
    var d = Date.now() - ms;
    if (d < 60000) return "Just now";
    if (d < 3600000) return Math.floor(d / 60000) + " min ago";
    if (d < 86400000) return Math.floor(d / 3600000) + " h ago";
    return Math.floor(d / 86400000) + " d ago";
  }

  async function status() {
    var p = plugin();
    if (!p || !p.getStatus) return { supported: false };
    try { return await p.getStatus(); } catch (e) { return { supported: false }; }
  }

  function injectCSS() {
    if (document.getElementById("smdaw-css")) return;
    var st = document.createElement("style"); st.id = "smdaw-css";
    st.textContent = [
      ".smdaw-ov{position:fixed;inset:0;z-index:100000;background:var(--paper,#f6f7f5);color:var(--ink,#14202b);display:flex;flex-direction:column;font-family:var(--sans,system-ui,-apple-system,sans-serif);overflow:hidden}",
      ".smdaw-hd{display:flex;align-items:center;gap:10px;padding:16px 16px 12px;border-bottom:1px solid var(--line,#d7dee3);background:var(--panel,#fff)}",
      ".smdaw-hd h2{margin:0;font-size:18px;font-weight:700;flex:1}",
      ".smdaw-x{border:none;background:var(--paper,#eef2f0);width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer;color:var(--ink,#14202b)}",
      ".smdaw-bd{flex:1;overflow-y:auto;padding:12px 14px 40px;-webkit-overflow-scrolling:touch}",
      ".smdaw-sec{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--slate-soft,#5a7184);padding:16px 4px 6px}",
      ".smdaw-card{background:var(--panel,#fff);border:1px solid var(--line,#d7dee3);border-radius:12px;padding:12px 14px;margin-bottom:2px}",
      ".smdaw-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line,#eef1f3)}",
      ".smdaw-row:last-child{border-bottom:none}",
      ".smdaw-rl{flex:1;min-width:0}",
      ".smdaw-t{font-size:14px;font-weight:600}",
      ".smdaw-s{font-size:12px;color:var(--slate-soft,#5a7184);margin-top:1px}",
      ".smdaw-v{font-size:13px;font-weight:600;color:var(--slate-soft,#5a7184);font-variant-numeric:tabular-nums}",
      ".smdaw-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}",
      ".smdaw-ok{background:#1a8f5f}.smdaw-warn{background:#c9922a}.smdaw-off{background:#9aa5ad}",
      ".smdaw-sw{position:relative;flex:0 0 auto;width:40px;height:24px;border:none;border-radius:999px;background:var(--line,#d7dee3);cursor:pointer;transition:background .15s}",
      ".smdaw-sw.on{background:var(--teal,#0e6e63)}",
      ".smdaw-sw>span{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}",
      ".smdaw-sw.on>span{left:19px}",
      ".smdaw-btn{display:block;width:100%;margin-top:8px;padding:11px;border:1px solid var(--teal,#0e6e63);border-radius:10px;background:var(--teal,#0e6e63);color:#fff;font-size:14px;font-weight:600;cursor:pointer}",
      ".smdaw-btn.ghost{background:none;color:var(--teal,#0e6e63)}",
      ".smdaw-btn.danger{border-color:#b23b3b;background:none;color:#b23b3b}",
      ".smdaw-note{font-size:12px;line-height:1.5;color:var(--slate-soft,#5a7184);padding:6px 4px}",
      ".smdaw-pre{font:11px/1.5 ui-monospace,Menlo,monospace;background:#0d1117;color:#c9d1d9;border-radius:8px;padding:10px;overflow:auto;white-space:pre-wrap;word-break:break-word}",
      ".smdaw-cap{display:inline-block;font-size:12px;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border-radius:6px;padding:4px 8px;margin:3px 4px 0 0}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  function swRow(title, sub, key, def, onChange) {
    var on = get(key, def);
    var wrap = document.createElement("div"); wrap.className = "smdaw-row";
    wrap.innerHTML = '<div class="smdaw-rl"><div class="smdaw-t">' + esc(title) + '</div>' +
      (sub ? '<div class="smdaw-s">' + esc(sub) + '</div>' : '') + '</div>' +
      '<button class="smdaw-sw' + (on ? " on" : "") + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(title) + '"><span></span></button>';
    var sw = wrap.querySelector(".smdaw-sw");
    sw.addEventListener("click", function () {
      var nv = !sw.classList.contains("on");
      sw.classList.toggle("on", nv); sw.setAttribute("aria-checked", nv);
      set(key, nv);
      if (onChange) try { onChange(nv); } catch (e) {}
    });
    return wrap;
  }

  function infoRow(title, valueEl) {
    var r = document.createElement("div"); r.className = "smdaw-row";
    var l = document.createElement("div"); l.className = "smdaw-rl";
    l.innerHTML = '<div class="smdaw-t">' + esc(title) + '</div>';
    r.appendChild(l);
    r.appendChild(valueEl);
    return r;
  }
  function valueText(text, dotClass) {
    var v = document.createElement("div");
    v.style.display = "flex"; v.style.alignItems = "center"; v.style.gap = "7px";
    if (dotClass) { var d = document.createElement("span"); d.className = "smdaw-dot " + dotClass; v.appendChild(d); }
    var t = document.createElement("span"); t.className = "smdaw-v"; t.textContent = text; v.appendChild(t);
    return v;
  }

  function sectionTitle(t) { var d = document.createElement("div"); d.className = "smdaw-sec"; d.textContent = t; return d; }
  function card() { var d = document.createElement("div"); d.className = "smdaw-card"; return d; }

  var devTaps = 0;

  function render(bd, st) {
    bd.innerHTML = "";
    var native = isNative();

    if (!native) {
      var w = card();
      w.innerHTML = '<div class="smdaw-t">Apple Watch</div>' +
        '<div class="smdaw-s" style="margin-top:6px;line-height:1.5">The StewardMD Apple Watch app and its settings are available in the StewardMD app for iPhone. Install StewardMD from the App Store and open it on an iPhone paired with your Apple Watch.</div>';
      bd.appendChild(sectionTitle("Apple Watch"));
      bd.appendChild(w);
      return;
    }

    var supported = !!st.supported;
    var paired = supported && !!st.paired;
    var installed = supported && !!st.watchAppInstalled;

    // ── Connection ──────────────────────────────────────────────
    bd.appendChild(sectionTitle("Connection"));
    var conn = card();
    var connText = !supported ? "Not supported"
      : paired ? (installed ? "Connected" : "Paired — app not installed")
      : "No watch paired";
    var connDot = !supported || !paired ? "smdaw-off" : (installed ? "smdaw-ok" : "smdaw-warn");
    conn.appendChild(infoRow("StewardMD Watch", valueText(connText, connDot)));
    conn.appendChild(infoRow("Paired", valueText(paired ? "Yes" : "No", paired ? "smdaw-ok" : "smdaw-off")));
    conn.appendChild(infoRow("Watch app installed", valueText(installed ? "Yes" : "No", installed ? "smdaw-ok" : "smdaw-off")));
    conn.appendChild(infoRow("Reachable now", valueText(st.reachable ? "Yes" : "No", st.reachable ? "smdaw-ok" : "smdaw-off")));
    bd.appendChild(conn);
    if (!installed && paired) {
      bd.appendChild(Object.assign(document.createElement("div"), { className: "smdaw-note", textContent: "Open the Watch app on your iPhone ▸ StewardMD ▸ Install to add it to your watch." }));
    }

    // ── Sync ────────────────────────────────────────────────────
    bd.appendChild(sectionTitle("Sync"));
    var sync = card();
    var lastMs = 0; try { lastMs = parseInt(localStorage.getItem(LS.lastSync) || "0", 10) || 0; } catch (e) {}
    var lastRow = infoRow("Last sync", valueText(relTime(lastMs)));
    sync.appendChild(lastRow);
    sync.appendChild(swRow("Automatic sync", "Keep the watch updated in the background", LS.autosync, true));
    var syncBtn = document.createElement("button"); syncBtn.className = "smdaw-btn"; syncBtn.textContent = "Sync now";
    syncBtn.addEventListener("click", async function () {
      syncBtn.disabled = true; syncBtn.textContent = "Syncing…";
      var ok = false;
      try { if (window.SMD_APPLE_WATCH_SYNC) ok = await window.SMD_APPLE_WATCH_SYNC(); } catch (e) {}
      syncBtn.textContent = ok ? "Synced ✓" : "Sync failed";
      try { var m = parseInt(localStorage.getItem(LS.lastSync) || "0", 10) || 0; lastRow.querySelector(".smdaw-v").textContent = relTime(m); } catch (e) {}
      setTimeout(function () { syncBtn.disabled = false; syncBtn.textContent = "Sync now"; }, 1500);
    });
    sync.appendChild(swRow("Battery optimization", "Sync less often to save power", LS.lowpower, false));
    sync.appendChild(syncBtn);
    bd.appendChild(sync);

    // ── Offline ─────────────────────────────────────────────────
    bd.appendChild(sectionTitle("Offline"));
    var off = card();
    off.appendChild(infoRow("Timers & calculators", valueText("Always available")));
    off.appendChild(infoRow("Patient data", valueText("Cached · read-only")));
    off.innerHTML += '<div class="smdaw-note">Code Blue, sepsis and calculators work with no signal. Acknowledgements you make offline queue on the watch and sync when reconnected.</div>';
    bd.appendChild(off);

    // ── Notifications ───────────────────────────────────────────
    bd.appendChild(sectionTitle("Notifications"));
    var notif = card();
    notif.appendChild(swRow("Critical labs", "Double haptic · may bypass Silent per hospital policy", LS.nCritical, true));
    notif.appendChild(swRow("Warnings", "Abnormal labs, sepsis nudges, overdue tasks", LS.nWarning, true));
    notif.appendChild(swRow("Informational", "Assignments, guideline updates", LS.nInfo, false));
    notif.innerHTML += '<div class="smdaw-note">Alerts mirror from your iPhone to the watch automatically. Critical Time-Sensitive delivery is governance-gated — confirm with your hospital.</div>';
    bd.appendChild(notif);

    // ── Widgets, complications & Smart Stack ────────────────────
    bd.appendChild(sectionTitle("Widgets & complications"));
    var wid = card();
    wid.innerHTML =
      '<div class="smdaw-row"><div class="smdaw-rl"><div class="smdaw-t">Complications</div><div class="smdaw-s">Add StewardMD to your watch face: long-press the face ▸ Edit ▸ tap a complication ▸ StewardMD.</div></div></div>' +
      '<div class="smdaw-row"><div class="smdaw-rl"><div class="smdaw-t">Smart Stack</div><div class="smdaw-s">Turn the Crown up from the face; StewardMD widgets rise by relevance (criticals, rounds, shift).</div></div></div>' +
      '<div class="smdaw-row"><div class="smdaw-rl"><div class="smdaw-t">Complication enabled</div></div></div>';
    wid.querySelector(".smdaw-row:last-child").appendChild(valueText(st.complicationEnabled ? "Yes" : "No", st.complicationEnabled ? "smdaw-ok" : "smdaw-off"));
    bd.appendChild(wid);

    // ── Siri ────────────────────────────────────────────────────
    bd.appendChild(sectionTitle("Siri shortcuts"));
    var siri = card();
    siri.innerHTML = '<div class="smdaw-note">Say “Hey Siri, start code blue”, “start sepsis timer”, “critical labs”, “drug dose”, or “interpret an ABG”. Assign the Action button (Apple Watch Ultra) to Code Blue in Watch ▸ Action Button ▸ Shortcut ▸ StewardMD.</div>';
    bd.appendChild(siri);

    // ── About this watch ────────────────────────────────────────
    bd.appendChild(sectionTitle("About"));
    var about = card();
    var verRow = infoRow("Installed watch version", valueText(installed ? "2.0" : "—"));
    verRow.style.cursor = "pointer";
    verRow.addEventListener("click", function () {
      devTaps++;
      if (devTaps >= 7) { devTaps = 0; renderDeveloper(bd, st); }
    });
    about.appendChild(verRow);
    var caps = document.createElement("div"); caps.className = "smdaw-row"; caps.style.display = "block";
    caps.innerHTML = '<div class="smdaw-t" style="margin-bottom:6px">Supported capabilities</div>' +
      ["Complications", "Smart Stack", "Siri & Shortcuts", "Always-On", "Ultra Action button", "Offline tools"]
        .map(function (c) { return '<span class="smdaw-cap">' + c + "</span>"; }).join("");
    about.appendChild(caps);
    bd.appendChild(about);

    // ── Troubleshooting ─────────────────────────────────────────
    bd.appendChild(sectionTitle("Troubleshooting"));
    var tr = card();
    tr.innerHTML = '<div class="smdaw-note">Not seeing data on your watch? 1) Ensure both devices are unlocked and nearby. 2) Tap “Sync now” above. 3) Reopen the StewardMD watch app. 4) If still stuck, reset the watch data below and sign in again on iPhone.</div>';
    var resetBtn = document.createElement("button"); resetBtn.className = "smdaw-btn danger"; resetBtn.textContent = "Reset watch data";
    resetBtn.addEventListener("click", async function () {
      try { var p = plugin(); if (p && p.clear) await p.clear(); } catch (e) {}
      try { localStorage.removeItem(LS.lastSync); } catch (e) {}
      resetBtn.textContent = "Cleared — re-syncing…";
      try { if (window.SMD_APPLE_WATCH_SYNC) await window.SMD_APPLE_WATCH_SYNC(); } catch (e) {}
      setTimeout(function () { resetBtn.textContent = "Reset watch data"; render(bd, st); }, 1200);
    });
    tr.appendChild(resetBtn);
    bd.appendChild(tr);

    // ── Diagnostics ─────────────────────────────────────────────
    bd.appendChild(sectionTitle("Diagnostics"));
    var diag = card();
    var pre = document.createElement("pre"); pre.className = "smdaw-pre";
    pre.textContent = JSON.stringify({
      supported: st.supported, paired: st.paired, watchAppInstalled: st.watchAppInstalled,
      complicationEnabled: st.complicationEnabled, reachable: st.reachable,
      activationState: st.activationState, lastSync: lastMs || null
    }, null, 2);
    diag.appendChild(pre);
    bd.appendChild(diag);
  }

  function renderDeveloper(bd, st) {
    var sec = sectionTitle("Developer"); bd.appendChild(sec);
    var dev = card();
    var pre = document.createElement("pre"); pre.className = "smdaw-pre";
    var dump = { platform: (C() && C().getPlatform && C().getPlatform()) || "web", status: st };
    try {
      dump.localStorage = {};
      Object.keys(LS).forEach(function (k) { dump.localStorage[LS[k]] = localStorage.getItem(LS[k]); });
    } catch (e) {}
    pre.textContent = JSON.stringify(dump, null, 2);
    dev.appendChild(pre);
    bd.appendChild(dev);
    try { if (window.toast) window.toast("Developer info revealed"); } catch (e) {}
    bd.scrollTop = bd.scrollHeight;
  }

  function open() {
    injectCSS();
    var existing = document.getElementById("smdaw-ov"); if (existing) existing.remove();
    var ov = document.createElement("div"); ov.className = "smdaw-ov"; ov.id = "smdaw-ov";
    ov.innerHTML = '<div class="smdaw-hd"><h2>Apple Watch</h2><button class="smdaw-x" aria-label="Close">×</button></div><div class="smdaw-bd"></div>';
    document.body.appendChild(ov);
    var bd = ov.querySelector(".smdaw-bd");
    ov.querySelector(".smdaw-x").addEventListener("click", function () { ov.remove(); });
    bd.innerHTML = '<div class="smdaw-note" style="padding:20px 4px">Loading…</div>';
    status().then(function (st) { render(bd, st); });
  }

  window.SMD_APPLE_WATCH = { open: open };
})();
