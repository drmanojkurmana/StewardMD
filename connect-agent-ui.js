/* StewardMD — Connect Hospital test console.
   Additive UI for the merged Connect Agent/Camofox pipeline.
   This screen deliberately starts read-only: it can verify the local Camofox bridge,
   collect an EMR URL + explicit allowed origin, and hand the operator to the existing
   server-side discovery pipeline. It never asks for or stores EMR credentials.
*/
(function () {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>\"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]; }); }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

  function injectCSS() {
    if (document.getElementById("smd-connect-css")) return;
    var st = document.createElement("style"); st.id = "smd-connect-css";
    st.textContent = [
      ".smd-connect-ov{position:fixed;inset:0;z-index:100000;background:rgba(7,17,25,.48);display:flex;align-items:flex-end;justify-content:center;padding:0}",
      ".smd-connect-sheet{width:min(620px,100vw);max-height:92vh;overflow:auto;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:22px 22px 0 0;box-shadow:0 -18px 60px rgba(0,0,0,.22);padding:20px 18px calc(24px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui)}",
      ".smd-connect-head{display:flex;align-items:flex-start;gap:12px}.smd-connect-title{font-size:20px;font-weight:800;line-height:1.15}.smd-connect-sub{font-size:12px;color:var(--slate-soft,#5a7184);margin-top:4px;line-height:1.4}.smd-connect-x{margin-left:auto;border:0;background:none;color:var(--slate-soft,#5a7184);font-size:24px;cursor:pointer}",
      ".smd-connect-badge{display:inline-flex;align-items:center;gap:6px;margin:16px 0 12px;padding:7px 10px;border-radius:999px;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);font-size:12px;font-weight:800}",
      ".smd-connect-card{border:1px solid var(--line,#d7dee3);border-radius:14px;padding:14px;margin:10px 0;background:var(--paper,#f6f7f5)}",
      ".smd-connect-label{display:block;font-size:12px;font-weight:800;margin:0 0 6px}.smd-connect-input{width:100%;box-sizing:border-box;border:1px solid var(--line,#d7dee3);border-radius:10px;padding:11px 12px;background:var(--panel,#fff);color:var(--ink,#14202b);font:500 14px var(--sans,system-ui)}",
      ".smd-connect-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.smd-connect-btn{border:1px solid var(--line,#d7dee3);border-radius:10px;padding:10px 13px;background:var(--panel,#fff);color:var(--ink,#14202b);font:700 13px var(--sans,system-ui);cursor:pointer}.smd-connect-btn.primary{background:var(--teal,#0e6e63);border-color:var(--teal,#0e6e63);color:#fff}.smd-connect-btn:disabled{opacity:.5;cursor:not-allowed}",
      ".smd-connect-status{font-size:12px;line-height:1.45;color:var(--slate,#2d4356);margin-top:8px;white-space:pre-wrap}.smd-connect-status.ok{color:var(--green,#1c7a4a);font-weight:700}.smd-connect-status.bad{color:var(--red,#ab1c2c);font-weight:700}",
      ".smd-connect-steps{margin:8px 0 0;padding-left:20px;color:var(--slate,#2d4356);font-size:12px;line-height:1.65}.smd-connect-note{font-size:11px;line-height:1.45;color:var(--slate-soft,#5a7184);margin-top:10px}",
      "body.dark .smd-connect-ov{background:rgba(0,0,0,.65)}body.dark .smd-connect-sheet{background:var(--panel);color:var(--ink)}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  function close() {
    var el = document.getElementById("smd-connect-ov"); if (el) el.remove();
  }

  function open() {
    injectCSS(); close();
    var ov = document.createElement("div"); ov.id = "smd-connect-ov"; ov.className = "smd-connect-ov";
    ov.innerHTML = '<section class="smd-connect-sheet" role="dialog" aria-modal="true" aria-labelledby="smd-connect-title">' +
      '<div class="smd-connect-head"><div><div class="smd-connect-title" id="smd-connect-title">Connect Hospital</div><div class="smd-connect-sub">Connect Agent · Camofox discovery test console</div></div><button class="smd-connect-x" aria-label="Close">×</button></div>' +
      '<div class="smd-connect-badge">● READ-ONLY TEST MODE</div>' +
      '<div class="smd-connect-card"><label class="smd-connect-label" for="smd-connect-url">Hospital EMR URL</label><input id="smd-connect-url" class="smd-connect-input" type="url" inputmode="url" autocomplete="off" placeholder="https://hospital-emr.example"/><div class="smd-connect-note">Use a hospital-authorized test environment. Do not enter usernames, passwords, OTPs or patient data here.</div></div>' +
      '<div class="smd-connect-card"><div class="smd-connect-label">1 · Camofox bridge</div><div class="smd-connect-row"><button id="smd-connect-health" class="smd-connect-btn primary">Test Camofox</button><span id="smd-connect-health-status" class="smd-connect-status">Not checked</span></div></div>' +
      '<div class="smd-connect-card"><div class="smd-connect-label">2 · Discovery workflow</div><ol class="smd-connect-steps"><li>Start with a hospital-authorized test account and test patient only.</li><li>Clinician performs the EMR login/MFA in the browser session.</li><li>Run the existing server-side Connect Agent discovery with the URL above.</li><li>Review the sanitized adapter spec, approve it, then run Connect SDK conformance.</li></ol><div class="smd-connect-row" style="margin-top:10px"><button id="smd-connect-copy" class="smd-connect-btn">Copy test command</button><button id="smd-connect-close" class="smd-connect-btn">Close</button></div><div id="smd-connect-copy-status" class="smd-connect-status"></div></div>' +
      '<div class="smd-connect-note">Production is intentionally not enabled by this screen. A successful Camofox health check only proves the browser bridge is reachable; the adapter is not production-ready until discovery, human approval and conformance all pass.</div>' +
      '</section>';
    document.body.appendChild(ov);

    ov.querySelector(".smd-connect-x").onclick = close;
    ov.querySelector("#smd-connect-close").onclick = close;
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });

    ov.querySelector("#smd-connect-health").onclick = function () {
      var btn = this, status = ov.querySelector("#smd-connect-health-status");
      btn.disabled = true; status.className = "smd-connect-status"; status.textContent = "Checking http://127.0.0.1:9377/health …";
      var started = Date.now();
      fetch("http://127.0.0.1:9377/health", { method: "GET", cache: "no-store" }).then(function (r) {
        return r.text().then(function (txt) { return { ok: r.ok, status: r.status, text: txt }; });
      }).then(function (r) {
        btn.disabled = false;
        if (r.ok) { status.className = "smd-connect-status ok"; status.textContent = "Camofox reachable · HTTP " + r.status + " · " + (Date.now() - started) + " ms"; }
        else { status.className = "smd-connect-status bad"; status.textContent = "Camofox responded with HTTP " + r.status + "."; }
      }).catch(function (e) {
        btn.disabled = false; status.className = "smd-connect-status bad"; status.textContent = "Camofox not reachable from this app: " + (e && e.message ? e.message : "connection failed") + "\nStart the authorized Camofox service on the same device/host and try again.";
      });
    };

    ov.querySelector("#smd-connect-copy").onclick = function () {
      var url = (ov.querySelector("#smd-connect-url").value || "").trim();
      var out = ov.querySelector("#smd-connect-copy-status");
      if (!/^https:\/\//i.test(url)) { out.className = "smd-connect-status bad"; out.textContent = "Enter an HTTPS EMR URL first."; return; }
      var origin = ""; try { origin = new URL(url).origin; } catch (e) {}
      var cmd = "node connect-agent/camofox-run.mjs --url " + JSON.stringify(url) + " --origins " + JSON.stringify(origin) + " --out ./connect-agent-artifacts";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd).then(function () { out.className = "smd-connect-status ok"; out.textContent = "Test command copied. No credentials are included."; }, function () { out.className = "smd-connect-status"; out.textContent = cmd; });
      } else { out.className = "smd-connect-status"; out.textContent = cmd; }
    };
  }

  window.SMD_CONNECT_AGENT = { open: open, close: close };
})();
