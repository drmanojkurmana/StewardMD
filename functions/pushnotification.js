/* StewardMD — admin Push Console (Cloudflare Pages Function).
 * ---------------------------------------------------------------------------
 * Serves a small web UI at  https://stewardmd.in/pushnotification  so an admin can
 * compose + send a push broadcast (and run Lab Watch) without curl. It calls the
 * EXISTING endpoints — POST /api/push/send, GET /api/push/status, POST /api/watch/run —
 * which are gated by UPDATES_ADMIN_TOKEN. The admin pastes that token into the page; it
 * is kept ONLY in the browser (sessionStorage) and sent as the X-Admin-Token header.
 *
 * Security model: the ADMIN TOKEN is the real gate (nothing here embeds it). The path is
 * just obscurity. This Function only RENDERS the page — it never sees or checks the token,
 * so a page load is harmless; sending requires the token the server validates. Page is
 * noindex + no-store. Web-only (not bundled into the native app — build-www.sh skips functions/).
 */
const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>StewardMD · Push Console</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
    background:#0b1220;color:#e7edf5;padding:24px 14px}
  @media (prefers-color-scheme:light){body{background:#f1f5f9;color:#0f172a}}
  .card{width:100%;max-width:520px;background:#111b2e;border:1px solid #1e2b43;border-radius:16px;
    padding:20px 18px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
  @media (prefers-color-scheme:light){.card{background:#fff;border-color:#e2e8f0;box-shadow:0 6px 20px rgba(15,23,42,.08)}}
  h1{font-size:18px;margin:0 0 2px} .sub{margin:0 0 16px;font-size:12.5px;color:#8597ad}
  @media (prefers-color-scheme:light){.sub{color:#64748b}}
  label{display:block;font-weight:600;font-size:12.5px;margin:12px 0 5px}
  input,textarea{width:100%;font:inherit;padding:10px 11px;border-radius:10px;border:1.5px solid #26364f;
    background:#0f1a2b;color:inherit}
  @media (prefers-color-scheme:light){input,textarea{background:#f8fafc;border-color:#cbd5e1}}
  textarea{resize:vertical}
  fieldset{border:1px solid #1e2b43;border-radius:12px;margin:16px 0 0;padding:4px 12px 14px}
  @media (prefers-color-scheme:light){fieldset{border-color:#e2e8f0}}
  legend{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8597ad;padding:0 6px}
  .chk{display:flex;align-items:center;gap:8px;font-weight:500;margin-top:8px}
  .chk input{width:auto}
  .btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  button{font:inherit;font-weight:700;padding:11px 14px;border-radius:10px;border:1px solid #2b3d59;
    background:#16233a;color:#e7edf5;cursor:pointer}
  @media (prefers-color-scheme:light){button{background:#f1f5f9;border-color:#cbd5e1;color:#0f172a}}
  button:disabled{opacity:.5;cursor:default}
  button.primary{background:#0f766e;border-color:#0f766e;color:#fff;flex:1}
  .out{white-space:pre-wrap;word-break:break-word;background:#0b1220;border:1px solid #1e2b43;border-radius:10px;
    padding:12px;margin-top:16px;min-height:20px;font:12.5px/1.5 ui-monospace,"SF Mono",Menlo,monospace}
  @media (prefers-color-scheme:light){.out{background:#f8fafc;border-color:#e2e8f0}}
  .foot{font-size:11px;color:#8597ad;margin:14px 0 0;line-height:1.5}
  @media (prefers-color-scheme:light){.foot{color:#64748b}}
</style>
</head><body>
<main class="card">
  <h1>🔔 StewardMD Push Console</h1>
  <p class="sub">Broadcast a notification to every registered device. Admin only.</p>

  <label for="tok">Admin token</label>
  <input id="tok" type="password" placeholder="UPDATES_ADMIN_TOKEN" autocomplete="off" spellcheck="false">
  <label class="chk"><input id="remember" type="checkbox"> Remember for this browser session</label>

  <fieldset>
    <legend>Compose</legend>
    <label for="title">Title</label>
    <input id="title" value="StewardMD" maxlength="80">
    <label for="bodytxt">Message</label>
    <textarea id="bodytxt" rows="3" maxlength="300" placeholder="New medical update"></textarea>
    <label for="url">Open URL (optional)</label>
    <input id="url" value="/" placeholder="/">
  </fieldset>

  <div class="btns">
    <button id="send" class="primary">Send to all devices</button>
    <button id="status">Check status</button>
    <button id="watch">Run Lab Watch</button>
  </div>

  <pre id="out" class="out" aria-live="polite"></pre>
  <p class="foot">The token stays in this browser only (session storage) and is sent over HTTPS to stewardmd.in as the admin header. This page stores nothing and is not indexed.</p>
</main>
<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var K = "smd_push_console_token";
  try { var s = sessionStorage.getItem(K); if (s) { $("tok").value = s; $("remember").checked = true; } } catch(e){}
  function out(o){ $("out").textContent = (typeof o === "string") ? o : JSON.stringify(o, null, 2); }
  function tok(){ var t = $("tok").value.trim(); try { if ($("remember").checked && t) sessionStorage.setItem(K, t); else sessionStorage.removeItem(K); } catch(e){} return t; }
  function busy(b){ ["send","status","watch"].forEach(function(id){ $(id).disabled = b; }); }

  $("status").addEventListener("click", function(){
    busy(true); out("Checking…");
    fetch("/api/push/status").then(function(r){ return r.json(); })
      .then(function(j){ out(j); })
      .catch(function(e){ out("Error: " + e); })
      .then(function(){ busy(false); });
  });

  $("send").addEventListener("click", function(){
    var t = tok(); if (!t) { out("Enter the admin token first."); return; }
    var title = $("title").value.trim() || "StewardMD";
    var body = $("bodytxt").value.trim() || "New medical update";
    var url = $("url").value.trim() || "/";
    if (!window.confirm("Send this notification to ALL registered devices?")) return;
    busy(true); out("Sending…");
    fetch("/api/push/send", { method:"POST", headers:{ "Content-Type":"application/json", "X-Admin-Token": t },
      body: JSON.stringify({ title:title, body:body, url:url }) })
      .then(function(r){ return r.json().then(function(j){ return { code:r.status, j:j }; }); })
      .then(function(res){
        if (res.code === 401) { out("Unauthorised — wrong admin token."); return; }
        if (res.code === 503) { out("Server has no admin token configured (UPDATES_ADMIN_TOKEN)."); return; }
        var n = res.j.native || {}, w = res.j.web || {};
        out("✅ Sent.\\nNative (iOS/Android): " + (n.sent||0) + " / " + (n.total||0) +
            "\\nWeb: " + (w.sent||0) + " / " + (w.total||0) + "\\n\\n" + JSON.stringify(res.j, null, 2));
      })
      .catch(function(e){ out("Error: " + e); })
      .then(function(){ busy(false); });
  });

  $("watch").addEventListener("click", function(){
    var t = tok(); if (!t) { out("Enter the admin token first."); return; }
    if (!window.confirm("Run the Lab Watch poll now (checks GHIS + pushes new labs)?")) return;
    busy(true); out("Running Lab Watch…");
    fetch("/api/watch/run", { method:"POST", headers:{ "X-Admin-Token": t } })
      .then(function(r){ return r.json().then(function(j){ return { code:r.status, j:j }; }); })
      .then(function(res){ if (res.code === 401) { out("Unauthorised — wrong admin token."); return; } out(res.j); })
      .catch(function(e){ out("Error: " + e); })
      .then(function(){ busy(false); });
  });
})();
</script>
</body></html>`;

export async function onRequestGet() {
  return new Response(HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow"
    }
  });
}

// Exposed for the headless test (test/run-push-console.mjs) — never used at runtime.
export const _html = HTML;
