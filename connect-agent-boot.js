/* connect-agent-boot.js - Connect Agent in-app launcher boot module.
 * ES5 IIFE. Flag smd_connect_agent, default ON since 2026-09-12 (owner decision: the doctor-facing
 * entry point must be visible; the server still gates every broker call behind CONNECT_AGENT_FLAG).
 * `?connect_agent=0` or localStorage smd_connect_agent = "0" hides it. When off, this module does
 * nothing observable and does not load the onboarding UI.
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
      if (!ls) return true;
      var val = ls.getItem("smd_connect_agent");
      if (val === null) val = ls.getItem("CONNECT_AGENT_FLAG");
      if (val === null) return true; // default ON
      return !(val === "0" || val === "false" || val === "off");
    } catch (e) {
      return true;
    }
  }

  if (!flagOn()) return;

  function loadConnectAgent() {
    if (window.SMD_CONNECT_AGENT) return Promise.resolve(window.SMD_CONNECT_AGENT);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/connect-agent-onboarding.js?v=caonb14";
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

  /* The doctor-facing entry point is the "Agent Connect" row in the More sheet and the tile in the
   * tools sheet (both in home.js), which open the onboarding UI through this object. There is no
   * floating launcher pill: it was a leftover from the test-console era, it duplicated the real
   * control, and it read as debug UI to a doctor. Any other surface can open the flow the same way
   * home.js does, via window.SMD_CONNECT_AGENT_BOOT.open(). */
  function openAgent() {
    return loadConnectAgent().then(function (ui) {
      if (ui && ui.open) ui.open();
      return ui;
    });
  }
  window.SMD_CONNECT_AGENT_BOOT = { enabled: true, open: openAgent };
})();
