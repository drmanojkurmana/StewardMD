/* connect-agent-boot.js - Connect Agent in-app launcher boot module.
 * ES5 IIFE. Flag-gated behind smd_connect_agent (default OFF).
 * When the flag is off, this module does nothing observable and does not load connect-agent-ui.js.
 */
(function () {
  "use strict";

  function flagOn() {
    try {
      var q = (location && location.search) || "";
      var m = q.match(/[?&](?:connect_agent|connectagent|smd_connect_agent)=([^&]+)/i);
      if (m && m[1] != null) {
        var v = decodeURIComponent(m[1]).toLowerCase();
        if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
        if (v === "0" || v === "false" || v === "off" || v === "no") return false;
      }
      var ls = localStorage;
      if (!ls) return false;
      var val = ls.getItem("smd_connect_agent");
      if (val === null) val = ls.getItem("CONNECT_AGENT_FLAG");
      return val === "1" || val === "true" || val === "on";
    } catch (e) {
      return false;
    }
  }

  if (!flagOn()) return;

  function loadConnectAgent() {
    if (window.SMD_CONNECT_AGENT) return Promise.resolve(window.SMD_CONNECT_AGENT);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/connect-agent-onboarding.js?v=caonb1";
      s.async = true;
      s.onload = function () {
        if (window.SMD_CONNECT_AGENT) resolve(window.SMD_CONNECT_AGENT);
        else reject(new Error("Connect Agent UI did not initialize"));
      };
      s.onerror = function () {
        reject(new Error("Connect Agent UI failed to load"));
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function installConnectButton() {
    try {
      if (document.getElementById("smd-connect-agent-launch")) return;
      var b = document.createElement("button");
      b.id = "smd-connect-agent-launch";
      b.type = "button";
      b.setAttribute("aria-label", "Connect Hospital - test mode");
      b.title = "Connect Hospital - read-only test mode";
      b.textContent = "Connect Hospital";
      b.style.cssText = [
        "position:fixed",
        "right:max(14px,env(safe-area-inset-right))",
        "bottom:max(14px,env(safe-area-inset-bottom))",
        "z-index:49",
        "border:1px solid var(--teal,#0e6e63)",
        "border-radius:999px",
        "padding:10px 14px",
        "background:var(--teal,#0e6e63)",
        "color:#fff",
        "font:800 12px var(--sans,system-ui)",
        "box-shadow:0 8px 24px rgba(0,0,0,.16)",
        "cursor:pointer"
      ].join(";");
      b.addEventListener("click", function () {
        b.disabled = true;
        loadConnectAgent().then(function (ui) {
          if (ui && ui.open) ui.open();
        }).catch(function (e) {
          try {
            if (window.toast) window.toast("Connect Agent UI unavailable: " + (e.message || "load failed"));
          } catch (x) {}
        }).finally(function () {
          b.disabled = false;
        });
      });
      document.body.appendChild(b);
    } catch (e) {}
  }

  try {
    if (document.readyState === "complete") {
      setTimeout(installConnectButton, 1200);
    } else {
      window.addEventListener("load", function () {
        setTimeout(installConnectButton, 1200);
      });
    }
  } catch (e) {}
})();
