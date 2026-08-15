/* remote-config.js — polls /api/config on boot and applies server-driven fleet controls WITHOUT an
 * app-store release: force-upgrade floor (block stale/dangerous native builds), maintenance mode
 * (full-screen block), remote banners/announcements, and server feature flags (window.SMD_REMOTE_FLAGS).
 * Fail-open: any fetch/parse error leaves the app fully usable. */
(function () {
  "use strict";
  var C = window.Capacitor;

  function apiGet() {
    return fetch("/api/config", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function nativeBuild() {
    return new Promise(function (res) {
      try { var A = C && C.Plugins && C.Plugins.App; if (A && A.getInfo) { A.getInfo().then(function (i) { res(Number(i && i.build)); }, function () { res(null); }); return; } } catch (e) {}
      res(null);   // web (no native build) => never version-gated
    });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function overlay(html) {
    if (document.getElementById("smd-rc-overlay")) return;
    var d = document.createElement("div"); d.id = "smd-rc-overlay";
    d.setAttribute("style", "position:fixed;inset:0;z-index:2147483000;background:#0b1220;color:#e6edf6;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-family:system-ui,-apple-system,sans-serif");
    d.innerHTML = '<div style="max-width:440px">' + html + "</div>";
    document.body.appendChild(d);
  }
  function showUpgrade(cfg) {
    overlay('<h2 style="margin:0 0 10px;font-size:22px">Update required</h2><p style="opacity:.85;line-height:1.55;margin:0">' +
      esc(cfg.upgradeMessage || "A newer version of StewardMD is required to keep using the app.") + "</p>" +
      (cfg.upgradeUrl ? '<a href="' + esc(cfg.upgradeUrl) + '" style="display:inline-block;margin-top:18px;background:#2f9e8f;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:600">Update now</a>' : ""));
  }
  function showMaintenance(cfg) {
    overlay('<h2 style="margin:0 0 10px;font-size:22px">Under maintenance</h2><p style="opacity:.85;line-height:1.55;margin:0">' +
      esc((cfg.maintenance && cfg.maintenance.message) || "StewardMD is briefly down for maintenance. Please try again shortly.") + "</p>");
  }
  function dismissed() { try { return JSON.parse(localStorage.getItem("smd_rc_dismissed") || "[]") || []; } catch (e) { return []; } }
  function dismiss(id) { try { var a = dismissed(); if (a.indexOf(id) < 0) { a.push(id); localStorage.setItem("smd_rc_dismissed", JSON.stringify(a.slice(-50))); } } catch (e) {} }
  function renderBanners(banners) {
    var seen = dismissed();
    var show = (banners || []).filter(function (b) { return b && b.text && (!b.dismissible || seen.indexOf(b.id) < 0); });
    var host = document.getElementById("smd-rc-banners");
    if (!show.length) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement("div"); host.id = "smd-rc-banners"; host.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:2147482000"); document.body.appendChild(host); }
    var colors = { info: "#2563eb", success: "#16a34a", warning: "#d97706", critical: "#dc2626" };
    host.innerHTML = show.map(function (b) {
      var bg = colors[b.level] || colors.info;
      return '<div style="background:' + bg + ';color:#fff;padding:8px 12px;font:500 13px system-ui,sans-serif;display:flex;align-items:center;gap:8px">' +
        (b.url ? '<a href="' + esc(b.url) + '" style="color:#fff;flex:1;text-decoration:underline">' + esc(b.text) + "</a>" : '<span style="flex:1">' + esc(b.text) + "</span>") +
        (b.dismissible !== false ? '<button data-rc-x="' + esc(b.id) + '" aria-label="Dismiss" style="background:transparent;border:0;color:#fff;font-size:18px;line-height:1;cursor:pointer">&times;</button>' : "") + "</div>";
    }).join("");
    host.querySelectorAll("[data-rc-x]").forEach(function (x) { x.addEventListener("click", function () { dismiss(x.getAttribute("data-rc-x")); renderBanners(banners); }); });
  }
  function apply(cfg) {
    if (!cfg) return;
    try { window.SMD_REMOTE_FLAGS = cfg.flags || {}; } catch (e) {}
    if (cfg.maintenance && cfg.maintenance.on) { showMaintenance(cfg); return; }   // full block
    nativeBuild().then(function (b) {
      if (b != null && cfg.minBuild != null && b < Number(cfg.minBuild)) { showUpgrade(cfg); return; }   // force-upgrade
      renderBanners(cfg.banners || []);
    });
  }
  function boot() { apiGet().then(apply); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
