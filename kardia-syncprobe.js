/* kardia-syncprobe.js - SyncProbe pairing and session screens for Kardia Echo Lab.
 *
 * ES5 IIFE. App runtime: window.KARDIA_SYNCPROBE. Node: module.exports for tests.
 * Builds against the shared SyncProbe contract (window.KARDIA_SYNC: core owns the
 * session state machine, transports and crypto; this file owns only the screens).
 * The real core in kardia-sync.js provides the facade below; the stub in
 * test/fixtures/kardia-sync-stub.mjs is kept only for unit tests.
 *
 * Core surface this UI expects (the facade in kardia-sync.js owns it):
 *   core.role                        "display" or "probe" once a session starts, else null
 *   core.state()                     { name, confirm?, reason?, hint? } (contract states)
 *   core.on(fn)                      subscribe; fn(evt); returns unsub
 *   core.startDisplay()              host a session; returns pairing material
 *   core.joinProbe(input)            input = scanned QR string or typed short code
 *   core.confirm()                   learner confirms the 4-digit number
 *   core.disconnect() / core.reconnect() / core.recenter() / core.setPaused(b)
 *   core.probePatch(patch)           probe role: touch-control fallback state
 *   core.stats()                     { rttMs, lossPct, sentPerSec, recvPerSec, lastRecvAt }
 *   core.transports()                [{ id, kind, available, reason, ... }]
 *   core.activeTransport()           transport id or null
 *   core.session()                   { shortCode, confirm, expiresAt, payload }
 *   core.lastError()                 string or null
 *
 * Design contract (Operate mode, Kardia tokens only, no new palette):
 * purpose: pair two phones so one becomes the probe, then show the link plainly.
 * First screenful: scanning first, typing second (one sentence each), the code,
 * the live state. The probe join screen is headed "Join the display" with one
 * large primary "Scan the QR code" button, a quiet "or type the 6 character
 * code" divider, then the code field with Join. The display pair sheet makes
 * the QR the hero ("Scan this with the probe phone"), with the code below
 * labelled "or type this code". Composition: role sheet, then one column;
 * primary action at thumb reach; diagnostics one small link away. States: idle, discovering, pairing,
 * confirming, connecting, connected, reconnecting, disconnected, failed (reason
 * plus recovery), lost link banner on both phones with the image frozen, empty
 * transports, long codes wrap, denied motion with a touch fallback. Motion: the
 * sheet rises 200ms on --kd-ease, banners fade, glyph tilts with transform only;
 * all motion off under reduced motion. Every control is a real button, 44px or
 * taller, visible focus, safe area padding. British spelling, no em or en dashes.
 * Failure states: every host or join failure maps through mapReason to one
 * specific message and one next action (signed out, Bluetooth off or denied
 * or unavailable, no internet and no Bluetooth, relay unreachable, expired,
 * busy, not found, rate limited, version mismatch). The raw reason is logged
 * to the console; the user never sees a generic message or an empty QR area.
 * Loading shows "Preparing the code" in the QR area; offline and empty
 * nearby lists name the next step. Long messages wrap in the error panel.
 */
(function (G) {
  "use strict";

  /* ================= QR encoder (vendored qrcode-generator, level M) =====
   * The hand-written encoder that used to live here produced codes no
   * decoder could read. Encoding now delegates to the vendored, proven
   * qrcode-generator by Kazuhiko Arase (MIT, kardia-qr.js), at error
   * correction level M. qrEncode keeps the old return shape so callers
   * and tests render modules the same way. */
  var QRGen = null;
  try { QRGen = G.KARDIA_QR || null; } catch (e) {}
  if (!QRGen && typeof module !== "undefined" && module.exports && typeof require === "function") {
    try { QRGen = require("./kardia-qr.js"); } catch (e) {}
  }
  function qrEncode(text) {
    if (!QRGen) return null;
    try {
      var qr = QRGen(0, "M");
      qr.addData(String(text == null ? "" : text), "Byte");
      qr.make();
      var size = qr.getModuleCount();
      var modules = [];
      for (var r = 0; r < size; r++) { var row = []; for (var c = 0; c < size; c++) row.push(qr.isDark(r, c) ? 1 : 0); modules.push(row); }
      return { version: (size - 17) / 4, size: size, modules: modules };
    } catch (e) { return null; }
  }
  function qrDraw(canvas, text, px) {
    var q = qrEncode(text);
    if (!q || !canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext("2d"), quiet = 4, n = q.size + quiet * 2;
    var target = Math.max(240, px || 240);
    var s = Math.max(1, Math.ceil(target / n));
    canvas.width = n * s; canvas.height = n * s;
    canvas.style.width = canvas.width + "px"; canvas.style.height = canvas.height + "px";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    var r, c;
    for (r = 0; r < q.size; r++) for (c = 0; c < q.size; c++) {
      if (q.modules[r][c] === 1) ctx.fillRect((c + quiet) * s, (r + quiet) * s, s, s);
    }
    return q;
  }

  /* ================= pairing payload ================= */
  var QR_PREFIX = "kardia-sync:1:";
  function buildPayload(p) {
    var base = QR_PREFIX + p.sessionId + ":" + p.displayPub + ":" + p.shortCode + ":" + p.expiresAt;
    var roomId = (p.relay && p.relay.roomId) || p.roomId || "";
    var roomToken = (p.relay && p.relay.roomToken) || p.roomToken || "";
    if (roomId && roomToken) base += ":" + roomId + ":" + roomToken;
    return base;
  }
  function normalizeCodeInput(value) {
    return String(value == null ? "" : value).toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  }
  function formatCodeInput(value) { return codeGroups(normalizeCodeInput(value)); }
  function parsePayload(s) {
    s = String(s == null ? "" : s).trim();
    if (s.slice(0, QR_PREFIX.length) !== QR_PREFIX) return null;
    var rest = s.slice(QR_PREFIX.length).split(":");
    if (rest.length !== 4 && rest.length !== 6) return null;
    if (!/^[0-9a-fA-F]{32}$/.test(rest[0])) return null;
    if (!/^[A-Za-z0-9_-]{20,}$/.test(rest[1])) return null;
    if (!/^[A-Z2-9]{6}$/.test(rest[2])) return null;
    if (!/^\d{10,}$/.test(rest[3])) return null;
    var out = { sessionId: rest[0].toLowerCase(), displayPub: rest[1], shortCode: rest[2], expiresAt: +rest[3] };
    if (rest.length === 6) {
      if (!/^[0-9a-fA-F]{32}$/.test(rest[4]) || !/^[A-Za-z0-9_-]{32,64}$/.test(rest[5])) return null;
      out.roomId = rest[4].toLowerCase(); out.roomToken = rest[5];
    }
    return out;
  }
  function isExpired(expiresAt, now) {
    return (+expiresAt || 0) <= (now == null ? Date.now() : now);
  }

  /* ================= state labels and transport words ================= */
  var STATE_LABELS = {
    idle: { line: "Not connected", sub: "Pair a probe to begin." },
    discovering: { line: "Looking for the other phone", sub: "Keep both phones close together." },
    pairing: { line: "Pairing", sub: "Setting up a private link." },
    confirming: { line: "Check the number matches on both phones", sub: "Confirm on both phones before training starts." },
    connecting: { line: "Connecting", sub: "Joining the session." },
    connected: { line: "Connected", sub: "The probe phone now drives the scan." },
    reconnecting: { line: "Connection lost. Trying again", sub: "The image stays frozen where it was." },
    disconnected: { line: "Disconnected", sub: "The session has ended." },
    failed: { line: "Something went wrong", sub: "Try again." }
  };
  function stateLabel(name) {
    return STATE_LABELS[name] || STATE_LABELS.idle;
  }
  function transportName(id) {
    if (id === "ble") return "Nearby, Bluetooth";
    if (id === "relay") return "Over the internet";
    if (id === "loopback") return "On this phone";
    return "Unknown link";
  }
  function signalBars(stats) {
    var rtt = stats && stats.rttMs != null ? +stats.rttMs : Infinity;
    var loss = stats && stats.lossPct != null ? +stats.lossPct : 100;
    if (!isFinite(rtt)) return 0;
    if (loss > 20 || rtt > 800) return 1;
    if (loss > 10 || rtt > 400) return 2;
    if (loss > 2 || rtt > 150) return 3;
    return 4;
  }
  function fmtLatency(ms) {
    if (ms == null || !isFinite(+ms)) return "no signal";
    return Math.max(0, Math.round(+ms)) + " ms";
  }
  function fmtExpiry(expiresAt, now) {
    var left = Math.max(0, Math.round(((+expiresAt || 0) - (now == null ? Date.now() : now)) / 1000));
    var m = Math.floor(left / 60), s = left % 60;
    return m + " min " + (s < 10 ? "0" + s : s) + " sec";
  }
  function codeGroups(code) {
    return String(code == null ? "" : code).replace(/(.{3})/g, "$1 ").trim();
  }

  /* ================= session screens ================= */
  function syncCore() { try { return G.KARDIA_SYNC || null; } catch (e) { return null; } }
  function echoLab() {
    try { return (G.KARDIA && G.KARDIA._kardia && G.KARDIA._kardia.echoLab) || null; } catch (e) { return null; }
  }
  /* Probe mode must not render ultrasound: entering it stops Echo
   * Lab's render loop and releases its WebGL context; leaving probe
   * mode (close, end, or switching to the display role) resumes it. */
  var probeRenderSuspended = false;
  function scanLab() {
    try { return (G.KARDIA_SCANLAB && G.KARDIA_SCANLAB.getLast && G.KARDIA_SCANLAB.getLast()) || null; } catch (e) { return null; }
  }
  function suspendProbeRender() {
    if (probeRenderSuspended) return;
    probeRenderSuspended = true;
    var L = echoLab();
    try {
      if (L && L.suspendLive) L.suspendLive();
      else if (L && L.echolab && L.echolab.suspend) L.echolab.suspend();
    } catch (e) {}
    /* Scan Lab renders its own WebGL scene and monitor on this page;
     * suspend it too (suspendLive already does, this covers a Scan Lab
     * mounted without the host facade), or its frame loop keeps the
     * probe phone's main thread busy and motion latency climbs. */
    try { var SL = scanLab(); if (SL && SL.suspend) SL.suspend(); } catch (e) {}
  }
  function resumeProbeRender() {
    if (!probeRenderSuspended) return;
    probeRenderSuspended = false;
    var L = echoLab();
    try {
      if (L && L.resumeLive) L.resumeLive();
      else if (L && L.echolab && L.echolab.resume) L.echolab.resume();
    } catch (e) {}
    try { var SL = scanLab(); if (SL && SL.resume) SL.resume(); } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var S = {
    core: null, unsub: null, pairing: null, screen: null, probeStep: "intro",
    touch: null, wakeLock: null, tick: null, lastState: "idle", probePose: null,
    returnFocus: null, detailsFrom: null
  };
  function doc() { return (G && G.document) || (typeof document !== "undefined" ? document : null); }
  function root() {
    var d = doc();
    if (!d) return null;
    var el = d.getElementById("krdSpRoot");
    if (el) return el;
    el = d.createElement("div");
    el.id = "krdSpRoot";
    el.className = "krd-root krd-sp";
    d.body.appendChild(el);
    return el;
  }
  /* The layer is fixed over the whole screen and carries the Kardia theme
   * (.krd-root, solid background), so it must be hidden whenever no sheet
   * is showing, or it covers Kardia with a blank screen. */
  function clearRoot() {
    var r = root();
    if (r) { r.innerHTML = ""; r.hidden = true; r.onclick = null; r.onkeydown = null; }
  }
  function spHaptic(kind) {
    try { if (G.KARDIA_PREMIUM && G.KARDIA_PREMIUM.haptic) G.KARDIA_PREMIUM.haptic(kind); } catch (e) {}
  }
  function sheetHtml(title, bodyHtml) {
    return '<div class="krd-sp-scrim" data-sp="close"></div>' +
      '<div class="krd-sp-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="krd-sp-grip" aria-hidden="true"></div>' +
      '<h2 class="sp-h2">' + esc(title) + "</h2>" + bodyHtml + "</div>";
  }
  function showSheet(title, bodyHtml) {
    var r = root();
    if (!r) return;
    var d = doc();
    if (!S.returnFocus && d && d.activeElement && d.activeElement !== d.body) S.returnFocus = d.activeElement;
    r.hidden = false;
    r.innerHTML = sheetHtml(title, bodyHtml);
    var first = r.querySelector(".krd-sp-sheet .sp-btn");
    if (first) try { first.focus(); } catch (e) {}
  }
  function bindRootClose(onClose) {
    var r = root();
    if (!r) return;
    r.onclick = function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-sp") === "close") { onClose(); return; }
      var b = t && t.closest ? t.closest("[data-act]") : null;
      if (b) handleAct(b.getAttribute("data-act"), b);
    };
    r.onkeydown = function (e) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && e.target && e.target.id === "krdSpCode") { handleAct("sp-join-code", null); return; }
      /* Keep tab focus inside the sheet while it is open. */
      if (e.key === "Tab") {
        var f = r.querySelectorAll(".krd-sp-sheet button, .krd-sp-sheet input");
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && e.target === first) { e.preventDefault(); try { last.focus(); } catch (x) {} }
        else if (!e.shiftKey && e.target === last) { e.preventDefault(); try { first.focus(); } catch (x) {} }
      }
    };
  }
  function setStateLine(name, extra) {
    var d = doc();
    var L = stateLabel(name), line = d && d.getElementById("krdSpState"), sub = d && d.getElementById("krdSpStateSub");
    if (line) line.textContent = L.line;
    if (sub) sub.textContent = (extra != null ? extra : L.sub);
  }
  function ensureTick() {
    if (S.tick || !G.setInterval) return;
    S.tick = G.setInterval(function () { refreshChrome(); }, 1000);
  }
  function clearTick() {
    if (S.tick && G.clearInterval) try { G.clearInterval(S.tick); } catch (e) {}
    S.tick = null;
  }
  function ensureWake() {
    try {
      if (!G.navigator || !G.navigator.wakeLock || !G.navigator.wakeLock.request) return;
      if (S.wakeLock) return;
      G.navigator.wakeLock.request("screen").then(function (lock) {
        S.wakeLock = lock;
        try { lock.addEventListener("release", function () { S.wakeLock = null; }); } catch (e) {}
      }, function () { S.wakeLock = null; });
    } catch (e) {}
  }
  function releaseWake() {
    try { if (S.wakeLock && S.wakeLock.release) S.wakeLock.release(); } catch (e) {}
    S.wakeLock = null;
  }
  function currentPairing() {
    if (S.pairing) return S.pairing;
    try { if (S.core && S.core.session) S.pairing = S.core.session() || null; } catch (e) {}
    return S.pairing;
  }

  /* ---------- entry: role chooser ---------- */
  function openRole() {
    try { if (G.KARDIA_PREMIUM && G.KARDIA_PREMIUM.dismiss) G.KARDIA_PREMIUM.dismiss(true); } catch (e) {}
    S.screen = "role";
    showSheet("SyncProbe",
      '<p class="sp-small">Train with two phones. One phone shows the scan, the other becomes the probe.</p>' +
      '<div class="krd-sp-col">' +
      '<button type="button" class="sp-btn pri sp-wide" data-act="sp-display">Pair a probe</button>' +
      '<p class="sp-small krd-sp-hint">This phone shows the scan. The learner scans your code.</p>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-probe">Use this phone as a probe</button>' +
      '<p class="sp-small krd-sp-hint">Motion on this phone drives the scan on the other phone.</p>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Not now</button>' +
      "</div>");
    bindRootClose(closeAll);
  }

  /* ---------- Display: Pair a probe ---------- */
  function openDisplay() {
    resumeProbeRender();
    S.screen = "display"; S.displayError = null;
    S.core = syncCore();
    if (!S.core) {
      showSheet("Pair a probe",
        '<div class="sp-err krd-err" role="alert"><p>Sync is not ready yet. Check the connection and try again.</p></div>' +
        '<button type="button" class="sp-btn pri sp-wide" data-act="sp-close">Close</button>');
      bindRootClose(closeAll);
      return;
    }
    var reuse = null, reuseState = "idle";
    try { reuse = S.core.session ? S.core.session() : null; } catch (e) {}
    try { reuseState = S.core.state ? S.core.state().name : "idle"; } catch (e) {}
    if (reuse && reuseState !== "idle" && reuseState !== "disconnected" && reuseState !== "failed") S.pairing = reuse;
    else try {
      var started = S.core.startDisplay();
      S.pairing = started;
      /* The real core makes its pairing keys with WebCrypto, so the first
       * start returns a thenable pairing. Repaint once it is ready; on
       * failure show the specific message and action, not a blank QR. */
      if (started && typeof started.then === "function") {
        started.then(function () { if (S.screen === "display" && !S.displayError) openDisplay(); }, function (e) { if (S.screen === "display") showDisplayError(e); });
      }
    } catch (e) { S.pairing = null; showDisplayError(e); return; }
    if (S.unsub) { try { S.unsub(); } catch (e) {} S.unsub = null; }
    try { S.unsub = S.core.on(onCoreEvent); } catch (e) {}
    var p = currentPairing();
    var payload = p ? buildPayload(p) : "";
    showSheet("Pair a probe",
      '<p class="sp-small">Scan this with the probe phone.</p>' +
      '<div class="krd-sp-qrwrap"><canvas id="krdSpQr" width="280" height="280" role="img" aria-label="Pairing code for the probe phone"></canvas>' +
      (payload ? "" : '<p class="sp-small" id="krdSpQrWait" role="status">Preparing the code</p>') + "</div>" +
      '<p class="sp-small krd-sp-codelabel">or type this code</p>' +
      '<p class="krd-sp-code" aria-label="Probe code">' + esc(codeGroups(p && p.shortCode)) + "</p>" +
      (p && p.codeHashHex ? '<p class="sp-small krd-sp-codelabel">Nearby name KS-' + esc(String(p.codeHashHex).slice(0, 4).toUpperCase()) + "</p>" : "") +
      '<p class="sp-small" id="krdSpExpiry" role="status"></p>' +
      '<p class="krd-sp-state" id="krdSpState" role="status">Starting</p>' +
      '<p class="sp-small" id="krdSpStateSub"></p>' +
      '<div id="krdSpConfirm"></div>' +
      '<div class="krd-sp-col"><button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Cancel</button></div>' +
      '<p class="krd-sp-link"><button type="button" class="krd-sp-minilink" data-act="sp-details">Connection details</button></p>');
    bindRootClose(closeAll);
    var cv = doc().getElementById("krdSpQr");
    if (payload) qrDraw(cv, payload, 280);
    ensureTick();
    var curName = "idle", curSess = null;
    try { curName = S.core.state ? S.core.state().name : "idle"; } catch (e) {}
    try { curSess = S.core.session ? S.core.session() : null; } catch (e) {}
    setStateLine(curName);
    renderConfirm(curName === "confirming" ? curSess : null);
    refreshChrome();
  }
  function renderConfirm(session) {
    var d = doc(), box = d && d.getElementById("krdSpConfirm");
    if (!box) return;
    if (!session || !session.confirm) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="krd-sp-confirm" role="group" aria-label="Confirm the number">' +
      '<p class="sp-small">Both phones show a number. Check they match, then confirm on both phones.</p>' +
      '<p class="krd-sp-confirmno">' + esc(codeGroups(session.confirm)) + "</p>" +
      '<button type="button" class="sp-btn pri sp-wide" data-act="sp-confirm">They match</button></div>';
  }

  /* ---------- Probe: Use this phone as a probe ---------- */
  function openProbe() {
    suspendProbeRender();
    S.screen = "probe"; S.probeStep = "intro";
    S.core = syncCore();
    if (!S.core) {
      showSheet("Probe",
        '<div class="sp-err krd-err" role="alert"><p>Sync is not ready yet. Check the connection and try again.</p></div>' +
        '<button type="button" class="sp-btn pri sp-wide" data-act="sp-close">Close</button>');
      bindRootClose(closeAll);
      return;
    }
    if (S.unsub) { try { S.unsub(); } catch (e) {} S.unsub = null; }
    try { S.unsub = S.core.on(onCoreEvent); } catch (e) {}
    var stName = "idle", sess = null;
    try { stName = S.core.state ? S.core.state().name : "idle"; } catch (e) {}
    try { sess = S.core.session ? S.core.session() : null; } catch (e) {}
    if (sess && stName !== "idle" && stName !== "disconnected" && stName !== "failed") renderProbeActive();
    else renderProbeIntro();
    ensureTick();
  }
  function scannerAvailable() {
    try {
      var C = G.Capacitor;
      return !!(C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.CapacitorBarcodeScanner);
    } catch (e) { return false; }
  }
  function scanIconSvg() {
    return '<svg class="krd-sp-scanicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<rect x="4" y="10.5" width="16" height="3" rx="1.5" fill="currentColor"/></svg>';
  }
  function nearbyHtml() {
    return '<div class="krd-sp-nearby"><h3 class="sp-h3">Nearby displays</h3>' +
      '<div id="krdSpNearby" role="status"><p class="sp-small">Looking for nearby displays.</p></div>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-nearby-refresh">Search again</button></div>';
  }
  function joinBoxHtml() {
    var canScan = scannerAvailable();
    return '<div class="krd-sp-join"><h3 class="sp-h3">Join the display</h3>' +
      (canScan
        ? '<button type="button" class="sp-btn pri sp-wide" data-act="sp-scan">' + scanIconSvg() + 'Scan the QR code</button>' +
          '<p class="sp-small">The camera is only used to read the pairing code.</p>'
        : '<p class="sp-small">Scanning is not available on this phone.</p>') +
      '<p class="sp-small krd-sp-or">or type the 6 character code</p>' +
      '<label class="krd-sp-field" for="krdSpCode">Probe code</label>' +
      '<input id="krdSpCode" class="krd-sp-input" inputmode="text" autocomplete="off" autocapitalize="characters" ' +
      'autocorrect="off" maxlength="7" placeholder="ABC 123" aria-describedby="krdSpCodeHint">' +
      '<p class="sp-small" id="krdSpCodeHint">Six letters and numbers, as shown on the display phone. Joining starts on the last character.</p>' +
      '<p class="sp-small krd-sp-errline" id="krdSpJoinErr" role="alert" hidden></p>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-join-code">Join</button></div>';
  }
  function bindCodeInput() {
    var d = doc(), input = d && d.getElementById("krdSpCode");
    if (!input || input.__krdSpBound) return;
    input.__krdSpBound = true;
    input.addEventListener("input", function () {
      var raw = input.value;
      if (parsePayload(raw)) { probeJoin(raw); return; }
      var cleaned = normalizeCodeInput(raw);
      var grouped = formatCodeInput(cleaned);
      if (input.value !== grouped) input.value = grouped;
      if (cleaned.length === 6) probeJoin(cleaned);
    });
  }
  function startNearbySearch() {
    var d = doc(), box = d && d.getElementById("krdSpNearby");
    if (!box) return;
    box.innerHTML = '<p class="sp-small">Looking for nearby displays.</p>';
    if (!S.core || !S.core.discoverNearby) { box.innerHTML = '<p class="sp-small">No nearby displays found. Scan the QR code below.</p>'; return; }
    try {
      S.core.discoverNearby(5000).then(function (list) {
        var b = doc() && doc().getElementById("krdSpNearby");
        if (!b) return;
        if (!list || !list.length) { b.innerHTML = '<p class="sp-small">No nearby displays found. Keep the display phone close and showing its code, or scan below.</p>'; return; }
        b.innerHTML = list.map(function (item) {
          return '<button type="button" class="sp-btn sec sp-wide krd-sp-nearbyitem" data-act="sp-nearby-join" data-hash="' + esc(item.codeHashHex) + '" data-name="' + esc(item.name || "Nearby display") + '">' +
            esc(item.name || "Nearby display") + (item.shortLabel ? " · Code " + esc(item.shortLabel) : "") + " · Connect</button>";
        }).join("");
      }, function (e) {
        var b = doc() && doc().getElementById("krdSpNearby");
        if (b) b.innerHTML = '<p class="sp-small">' + esc(mapReason(e).message) + "</p>";
      });
    } catch (e) { box.innerHTML = '<p class="sp-small">No nearby displays found. Scan the QR code below.</p>'; }
  }
  function focusCode() {
    var d = doc(), input = d && d.getElementById("krdSpCode");
    if (input) try { input.focus(); } catch (e) {}
  }
  function renderProbeIntro() {
    S.motionChosen = false;
    S.motionSlide = null;
    showSheet("Use this phone as a probe",
      '<p class="sp-small">Connect to the display phone. Nearby displays connect with one tap, with no typing.</p>' +
      nearbyHtml() +
      joinBoxHtml() +
      '<div class="krd-sp-col"><button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Not now</button></div>');
    bindRootClose(closeAll);
    bindCodeInput();
    startNearbySearch();
  }
  function joinErr(msg, info) {
    var d = doc(), el = d && d.getElementById("krdSpJoinErr");
    if (!el) return;
    if (!msg && !info) { el.hidden = true; el.innerHTML = ""; return; }
    var detail = info || (msg ? mapReason({ message: msg }) : null);
    el.hidden = false;
    el.innerHTML = esc(detail ? detail.message : msg) +
      (detail && detail.action ? ' <button type="button" class="krd-sp-minilink" data-act="sp-err-' + esc(detail.action) + '">' + esc(detail.actionLabel) + "</button>" : "");
  }
  function probeJoin(input) {
    joinErr("");
    var code = String(input == null ? "" : input).toUpperCase().replace(/[^A-Z2-9]/g, "");
    if (code.length !== 6 && !parsePayload(input)) {
      joinErr("That code does not look right. Check the display phone and try again.");
      focusCode();
      return;
    }
    S.probeStep = "joining";
    setProbeBusy("Joining");
    try {
      var r = S.core.joinProbe(parsePayload(input) ? String(input).trim() : code);
      if (r && r.then) r.then(function () {}, function (e) {
        if (S.probeStep === "joining") { S.probeStep = "intro"; renderProbeIntro(); joinErr(null, mapReason(e)); }
      });
    } catch (e) { S.probeStep = "intro"; renderProbeIntro(); joinErr(null, mapReason(e)); }
  }
  function mapReason(e) {
    var reason = (e && e.reason) || "";
    var msg = String((e && (e.message || e.reason)) || e || "");
    /* Raw reason always reaches the console for the lead; the user only
       ever sees the specific message below, never the raw text. */
    try { console.warn("[SyncProbe] pairing failed:", reason || msg || "unknown", e || ""); } catch (x) {}
    if (!reason) {
      if (/sign-in required|sign in required|401|unauthori[sz]ed/i.test(msg)) reason = "sign-in-required";
      else if (/expired/i.test(msg)) reason = "expired";
      else if (/controller-busy|busy|already training/i.test(msg)) reason = "busy";
      else if (/not-found|no display found/i.test(msg)) reason = "not-found";
      else if (/rate-limit|too many code|429/i.test(msg)) reason = "rate-limited";
      else if (/bluetooth/i.test(msg) && /off|powered/i.test(msg)) reason = "bluetooth-off";
      else if (/bluetooth/i.test(msg) && /permission|denied/i.test(msg)) reason = "bluetooth-permission";
      else if (/relay|pairing service|websocket|failed to fetch|session creation failed|code lookup failed/i.test(msg)) reason = "relay-unreachable";
      else if (/bluetooth/i.test(msg)) reason = "bluetooth-unavailable";
      else if (/offline|internet|network/i.test(msg)) reason = "offline";
      else if (/version/i.test(msg)) reason = "version-mismatch";
      else if (/no-transport|no link/i.test(msg)) reason = "no-transport";
      else reason = "unknown";
    }
    switch (reason) {
      case "expired": return { reason: reason, message: "That code has expired. The display phone is showing a fresh code.", action: "scan", actionLabel: "Scan the fresh code" };
      case "busy": case "controller-busy": return { reason: "busy", message: "That display is already training with another probe. Wait until that session ends.", action: "retry", actionLabel: "Try again" };
      case "sign-in-required": return { reason: reason, message: "Pairing was refused. Pairing does not need sign-in. Check the connection on both phones, then try again.", action: "retry", actionLabel: "Try again" };
      case "not-found": return { reason: reason, message: "No display found nearby. Keep both phones close, with the display phone showing its code.", action: "scan", actionLabel: "Scan the QR code instead" };
      case "rate-limited": return { reason: reason, message: "Too many code tries. Wait a minute, then try the fresh code.", action: "retry", actionLabel: "Try again" };
      case "bluetooth-off": return { reason: reason, message: "Bluetooth is off. Turn Bluetooth on, then search again.", action: "settings", actionLabel: "Open Settings" };
      case "bluetooth-permission": return { reason: reason, message: "Bluetooth permission is off for this app. Allow Bluetooth in Settings, then search again.", action: "settings", actionLabel: "Open Settings" };
      case "bluetooth-unavailable": return { reason: reason, message: "Bluetooth is not available on this phone. Scan the QR code to join over the internet.", action: "scan", actionLabel: "Scan the QR code" };
      case "relay-unreachable": return { reason: reason, message: "We could not reach the pairing service. Check the connection and try again.", action: "retry", actionLabel: "Try again" };
      case "offline": case "no-transport": return { reason: "offline", message: "No internet and no Bluetooth link. Turn on Bluetooth or connect to the internet, then try again.", action: "retry", actionLabel: "Try again" };
      case "version-mismatch": case "bad-version": return { reason: "version-mismatch", message: "The two phones are on different app versions. Update both phones, then pair again.", action: "retry", actionLabel: "Try again" };
      case "bad-code": return { reason: reason, message: "That code does not look right. Check the display phone and try again.", action: "retry", actionLabel: "Check the code" };
      default:
        return { reason: "unknown", message: "The phones could not reach each other. Move closer and try again.", action: "retry", actionLabel: "Try again" };
    }
  }
  /* Open the app sign-in the way other StewardMD screens do: the email
     sign-in sheet, falling back to the account screen. */
  function openSignIn() {
    try { if (G.SMD_EMAIL_AUTH && G.SMD_EMAIL_AUTH.openEmail) { G.SMD_EMAIL_AUTH.openEmail("signin"); return true; } } catch (e) {}
    try { if (typeof G.SMD_openProfile === "function") { G.SMD_openProfile(); return true; } } catch (e) {}
    return false;
  }
  /* Display host failure: replace the empty QR area with the specific
     message and its one next action. Never a generic try again. */
  function showDisplayError(err) {
    var info = mapReason(err || {});
    S.screen = "display"; S.displayError = info;
    showSheet("Pair a probe",
      '<div class="krd-sp-error" role="alert"><p>' + esc(info.message) + "</p></div>" +
      '<div class="krd-sp-col">' +
      (info.action ? '<button type="button" class="sp-btn pri sp-wide" data-act="sp-err-' + esc(info.action) + '">' + esc(info.actionLabel) + "</button>" : "") +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Cancel</button></div>' +
      '<p class="krd-sp-link"><button type="button" class="krd-sp-minilink" data-act="sp-details">Connection details</button></p>');
    bindRootClose(closeAll);
  }
  function friendlyReason(e) { return mapReason(e).message; }
  function setProbeBusy(line) {
    var d = doc();
    var st = d && d.getElementById("krdSpState"), sub = d && d.getElementById("krdSpStateSub");
    if (!st) {
      showSheet("Use this phone as a probe",
        '<p class="krd-sp-state" id="krdSpState" role="status">' + esc(line) + '</p><p class="sp-small" id="krdSpStateSub"></p>' +
        '<div class="krd-sp-col"><button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Cancel</button></div>');
      bindRootClose(closeAll);
      return;
    }
    st.textContent = line;
  }
  function renderProbeDenied() {
    S.probeStep = "denied";
    showSheet("Use this phone as a probe",
      '<div class="krd-sp-note" role="status"><p><b>Motion is off.</b> ' +
      "The probe cannot follow this phone without motion access. You can still train with touch controls.</p></div>" +
      '<div class="krd-sp-col">' +
      '<button type="button" class="sp-btn pri sp-wide" data-act="sp-touch">Use touch controls</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-motion">Try motion again</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Not now</button></div>');
    bindRootClose(closeAll);
  }
  function renderProbeCalibrate() {
    S.probeStep = "calibrate";
    showSheet("Use this phone as a probe",
      '<p class="sp-small">Hold the phone like a probe, marker towards the patient\'s head, tap Calibrate.</p>' +
      '<p class="sp-small">Keep holding it that way. Turning, fanning and rocking the phone then moves the probe.</p>' +
      '<div class="krd-sp-glyphwrap" aria-hidden="true">' + glyphSvg(0, 0) + "</div>" +
      '<div class="krd-sp-col"><button type="button" class="sp-btn pri sp-wide" data-act="sp-calibrate">Calibrate</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Not now</button></div>');
    bindRootClose(closeAll);
  }
  function renderProbeActive() {
    S.probeStep = "active";
    var st = null, stName = "idle";
    try { st = S.core.stats ? S.core.stats() : null; } catch (e) {}
    try { stName = S.core.state ? S.core.state().name : "idle"; } catch (e) {}
    var sub = stateLabel(stName).sub;
    if (stName === "connected") {
      try { sub = "Over " + transportName(S.core.activeTransport()).toLowerCase() + ", " + fmtLatency(st && st.rttMs); } catch (e) {}
    }
    var joined = stName !== "idle" && stName !== "disconnected" && stName !== "failed";
    showSheet("Probe session",
      '<div id="krdSpLostSlot"></div>' +
      '<div class="krd-sp-statusrow"><span class="krd-sp-dot" aria-hidden="true"></span>' +
      '<p class="sp-small" id="krdSpState" role="status">' + esc(stateLabel(stName).line) + "</p></div>" +
      '<p class="sp-small" id="krdSpStateSub">' + esc(sub) + "</p>" +
      (joined ? "" : joinBoxHtml()) +
      (joined && !S.motionChosen ? '<div class="krd-sp-note" role="group" aria-label="Probe controls"><p><b>Move the probe.</b> Allow motion to tilt this phone, or use touch controls.</p><div class="krd-sp-col"><button type="button" class="sp-btn pri sp-wide" data-act="sp-motion">Allow motion</button><button type="button" class="sp-btn sec sp-wide" data-act="sp-touch">Use touch controls instead</button></div></div>' : "") +
      (joined && S.controlMode === "motion" ? motionSlidePadHtml() :
        '<div class="krd-sp-glyphwrap" id="krdSpGlyph" aria-label="Probe orientation">' + glyphSvg(0, 0) + "</div>") +
      '<p class="sp-small krd-sp-posedesc" id="krdSpPoseDesc"></p>' +
      '<div id="krdSpConfirmP"></div>' +
      '<div class="krd-sp-col">' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-pause">Pause</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-recenter">Recenter</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-end">Disconnect</button></div>' +
      '<p class="krd-sp-link"><button type="button" class="krd-sp-minilink" data-act="sp-details">Connection details</button></p>');
    bindRootClose(closeAll);
    bindCodeInput();
    if (joined && S.controlMode === "motion") bindMotionSlidePad();
    if (!joined && !scannerAvailable()) focusCode();
    renderProbeConfirm();
    refreshGlyph();
  }
  /* Motion mode: tilting and turning the phone sets the angles; this pad
   * moves the probe to another spot on the chest (up, down, across). */
  function motionSlidePadHtml() {
    var m = S.motionSlide || { x: 0, y: 0 }, p = S.probePose || {};
    return '<p class="sp-small"><b>Drag the probe</b> to move it on the chest. Tilt and turn the phone for the angle.</p>' +
      '<div class="krd-sp-pad krd-sp-pad-big" id="krdSpPad" role="application" aria-label="Probe pad. Drag the probe to move it on the chest." tabindex="0">' +
      '<span class="krd-sp-pad-label krd-sp-pad-hint">Chest</span>' +
      '<span class="krd-sp-pad-probe" id="krdSpPadDot" aria-hidden="true" style="transform:translate(' + Math.round(m.x / 60 * 120) + "px, " + Math.round(m.y / 60 * 90) + 'px)">' +
      '<span id="krdSpGlyph">' + glyphSvg(p.tiltDeg || 0, p.rotationDeg || 0) + "</span></span></div>";
  }
  function bindMotionSlidePad() {
    var d = doc(), pad = d && d.getElementById("krdSpPad");
    if (!pad) return;
    var padPointer = null;
    function padMove(e) {
      if (!pad.getBoundingClientRect) return;
      var r = pad.getBoundingClientRect();
      var nx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / (r.width || 1) - 0.5) * 2));
      var ny = Math.max(-1, Math.min(1, ((e.clientY - r.top) / (r.height || 1) - 0.5) * 2));
      S.motionSlide = { x: Math.round(nx * 600) / 10, y: Math.round(ny * 600) / 10 };
      var dot = d.getElementById("krdSpPadDot");
      /* Keep the whole probe drawing inside the pad. */
      var hx = Math.max(0, (r.width || 0) / 2 - 52), hy = Math.max(0, (r.height || 0) / 2 - 76);
      if (dot) dot.style.transform = "translate(" + Math.round(nx * hx) + "px, " + Math.round(ny * hy) + "px)";
      try { if (S.core.probeSlide) S.core.probeSlide(S.motionSlide.x, S.motionSlide.y); } catch (x) {}
    }
    pad.addEventListener("pointerdown", function (e) { padPointer = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch (x) {} padMove(e); });
    pad.addEventListener("pointermove", function (e) { if (padPointer != null && e.pointerId === padPointer) padMove(e); });
    function padEnd(e) { if (e.pointerId === padPointer) { padPointer = null; spHaptic("selection"); } }
    pad.addEventListener("pointerup", padEnd);
    pad.addEventListener("pointercancel", padEnd);
  }
  function renderProbeConfirm() {
    var session = null;
    try { session = S.core.session ? S.core.session() : null; } catch (e) {}
    var d = doc(), box = d && d.getElementById("krdSpConfirmP");
    if (!box) return;
    if (!session || !session.confirm || session.confirmed) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="krd-sp-confirm" role="group" aria-label="Confirm the number">' +
      '<p class="sp-small">The display phone shows a number. Check it matches this one, then confirm.</p>' +
      '<p class="krd-sp-confirmno">' + esc(codeGroups(session.confirm)) + "</p>" +
      '<button type="button" class="sp-btn pri sp-wide" data-act="sp-confirm">They match</button></div>';
  }
  function renderProbeTouch() {
    S.probeStep = "touch";
    S.touch = S.touch || { window: "parasternal", rotationDeg: 0, tiltDeg: 0, rockDeg: 0, depthCm: 18, slideX: 0, slideY: 0 };
    if (S.touch.rockDeg == null) S.touch.rockDeg = 0;
    if (S.touch.depthCm == null) S.touch.depthCm = 18;
    if (S.touch.slideX == null) S.touch.slideX = 0;
    if (S.touch.slideY == null) S.touch.slideY = 0;
    showSheet("Touch controls",
      '<p class="sp-small">Slide on the pad to move the probe. Use one thumb; every control is at thumb reach.</p>' +
      '<div class="krd-sp-pad" id="krdSpPad" role="application" aria-label="Slide pad. Drag to slide the probe." tabindex="0">' +
      '<span class="krd-sp-pad-dot" id="krdSpPadDot" aria-hidden="true"></span>' +
      '<span class="krd-sp-pad-label">Slide</span></div>' +
      '<p class="sp-small" id="krdSpSlideVal" role="status">Slide 0, 0</p>' +
      '<div class="krd-sp-col">' +
      '<label class="krd-sp-field" for="krdSpRot">Rotation <span id="krdSpRotVal">' + Math.round(S.touch.rotationDeg) + ' deg</span></label>' +
      '<input type="range" id="krdSpRot" min="-180" max="180" step="1" value="' + S.touch.rotationDeg + '" aria-label="Rotation">' +
      '<label class="krd-sp-field" for="krdSpTilt">Fan <span id="krdSpTiltVal">' + Math.round(S.touch.tiltDeg) + ' deg</span></label>' +
      '<input type="range" id="krdSpTilt" min="-30" max="30" step="1" value="' + S.touch.tiltDeg + '" aria-label="Fan">' +
      '<label class="krd-sp-field" for="krdSpRock">Rock <span id="krdSpRockVal">' + Math.round(S.touch.rockDeg) + ' deg</span></label>' +
      '<input type="range" id="krdSpRock" min="-30" max="30" step="1" value="' + S.touch.rockDeg + '" aria-label="Rock">' +
      '<div class="krd-sp-row krd-sp-depthrow"><span class="krd-sp-field krd-sp-depthlabel" id="krdSpDepthLabel">Depth <span id="krdSpDepthVal">' + (Math.round(S.touch.depthCm * 10) / 10) + ' cm</span></span>' +
      '<button type="button" class="sp-btn sec krd-sp-step" data-spdepth="-1" aria-label="Depth down">Depth down</button>' +
      '<button type="button" class="sp-btn sec krd-sp-step" data-spdepth="1" aria-label="Depth up">Depth up</button></div>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-recenter">Recenter</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-end">End session</button></div>');
    bindRootClose(closeAll);
    var d = doc();
    var wasCentred = centredTouch();
    function centredTouch() {
      return Math.abs(S.touch.rotationDeg) < 2 && Math.abs(S.touch.tiltDeg) < 2 && Math.abs(S.touch.rockDeg) < 2;
    }
    function push() {
      try { if (S.core.probePatch) S.core.probePatch({ rotationDeg: S.touch.rotationDeg, tiltDeg: S.touch.tiltDeg, rockDeg: S.touch.rockDeg, depthCm: S.touch.depthCm, slideX: S.touch.slideX, slideY: S.touch.slideY }); } catch (e) {}
      /* Haptic tick on reaching the centred target pose. */
      var nowCentred = centredTouch();
      if (nowCentred && !wasCentred) spHaptic("selection");
      wasCentred = nowCentred;
    }
    function bindRange(id, key) {
      var el = d.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        var v = parseFloat(el.value) || 0;
        S.touch[key] = v;
        var lbl = d.getElementById(id + "Val");
        if (lbl) lbl.textContent = Math.round(v) + " deg";
        push();
      });
    }
    bindRange("krdSpRot", "rotationDeg");
    bindRange("krdSpTilt", "tiltDeg");
    bindRange("krdSpRock", "rockDeg");
    var pad = d.getElementById("krdSpPad");
    if (pad) {
      var padPointer = null;
      function padMove(e) {
        if (!pad.getBoundingClientRect) return;
        var r = pad.getBoundingClientRect();
        var nx = ((e.clientX - r.left) / (r.width || 1) - 0.5) * 2;
        var ny = ((e.clientY - r.top) / (r.height || 1) - 0.5) * 2;
        /* Slide range matches the probe slide clamp in millimetres. */
        S.touch.slideX = Math.round(Math.max(-60, Math.min(60, nx * 60)) * 10) / 10;
        S.touch.slideY = Math.round(Math.max(-60, Math.min(60, ny * 60)) * 10) / 10;
        var dot = d.getElementById("krdSpPadDot");
        if (dot) dot.style.transform = "translate(" + Math.round(nx * 52) + "px, " + Math.round(ny * 52) + "px)";
        var sv = d.getElementById("krdSpSlideVal");
        if (sv) sv.textContent = "Slide " + Math.round(S.touch.slideX) + ", " + Math.round(S.touch.slideY);
        push();
      }
      pad.addEventListener("pointerdown", function (e) { padPointer = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch (x) {} padMove(e); });
      pad.addEventListener("pointermove", function (e) { if (padPointer != null && e.pointerId !== padPointer) return; if (padPointer != null) padMove(e); });
      function padEnd(e) { if (e.pointerId === padPointer) { padPointer = null; spHaptic("selection"); } }
      pad.addEventListener("pointerup", padEnd);
      pad.addEventListener("pointercancel", padEnd);
    }
    var stepBtns = root() ? root().querySelectorAll("[data-spdepth]") : [];
    for (var si = 0; si < stepBtns.length; si++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var dir = parseFloat(btn.getAttribute("data-spdepth")) || 0;
          S.touch.depthCm = Math.round(Math.max(8, Math.min(30, S.touch.depthCm + dir)) * 10) / 10;
          var lbl = d.getElementById("krdSpDepthVal");
          if (lbl) lbl.textContent = (Math.round(S.touch.depthCm * 10) / 10) + " cm";
          spHaptic("selection");
          push();
        });
      })(stepBtns[si]);
    }
  }
  function glyphSvg(tilt, rot) {
    return '<svg class="krd-sp-glyph" viewBox="0 0 64 96" role="img" aria-label="Probe">' +
      '<g class="krd-sp-glyph-tilt" style="transform: rotate(' + Math.round(tilt || 0) + 'deg)">' +
      '<rect x="24" y="6" width="16" height="44" rx="7" class="krd-sp-glyph-body"/>' +
      '<path d="M24 50 L40 50 L32 78 Z" class="krd-sp-glyph-head"/>' +
      '<circle cx="32" cy="14" r="3" class="krd-sp-glyph-marker"/></g></svg>';
  }
  function refreshGlyph() {
    var d = doc(), g = d && d.getElementById("krdSpGlyph");
    if (!g || !S.probePose) return;
    g.innerHTML = glyphSvg(S.probePose.tiltDeg, S.probePose.rotationDeg);
    var desc = d.getElementById("krdSpPoseDesc");
    if (desc) desc.textContent = "Tilt " + Math.round(S.probePose.tiltDeg || 0) + " deg, rotation " +
      Math.round(S.probePose.rotationDeg || 0) + " deg.";
  }

  /* ---------- Echo Lab chrome: pill and lost-link banner ---------- */
  function sessionState() {
    try { if (S.core && S.core.state) return S.core.state().name || "idle"; } catch (e) {}
    return S.lastState;
  }
  function pillTargets() {
    var d = doc();
    if (!d) return [];
    var found = d.querySelectorAll("#krdSyncPill");
    var out = [];
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    return out;
  }
  function barsSvg(n) {
    var out = '<span class="krd-sp-bars" aria-hidden="true">';
    for (var i = 1; i <= 4; i++) out += '<span class="krd-sp-bar' + (i <= n ? " on" : "") + '"></span>';
    return out + "</span>";
  }
  var lastPillKey = "\0";
  function refreshPill() {
    var targets = pillTargets();
    if (!targets.length) return;
    var name = sessionState();
    if (name !== "connected" && name !== "reconnecting") {
      if (lastPillKey !== "") {
        lastPillKey = "";
        for (var z = 0; z < targets.length; z++) targets[z].innerHTML = "";
      }
      return;
    }
    var st = null, tid = null;
    try { st = S.core.stats ? S.core.stats() : null; } catch (e) {}
    try { tid = S.core.activeTransport ? S.core.activeTransport() : null; } catch (e) {}
    var bars = signalBars(st), lat = fmtLatency(st && st.rttMs);
    /* The button rebuilds only when the link, state or bars change; the latency
     * number updates in place every second so focus is never stolen. */
    var key = name + "|" + tid + "|" + bars;
    if (key !== lastPillKey) {
      lastPillKey = key;
      var html = '<button type="button" class="krd-sp-pill' + (name === "reconnecting" ? " lost" : "") + '" data-spill="1" ' +
        'aria-label="Probe link: ' + esc(transportName(tid)) + ", " + esc(lat) + '">' +
        esc(transportName(tid)) + ' · <span data-lat>' + esc(lat) + "</span>" + barsSvg(bars) + "</button>";
      for (var i = 0; i < targets.length; i++) targets[i].innerHTML = html;
      return;
    }
    for (var j = 0; j < targets.length; j++) {
      var s = targets[j].querySelector("[data-lat]");
      if (s && s.textContent !== lat) {
        s.textContent = lat;
        var b = targets[j].querySelector("[data-spill]");
        if (b) b.setAttribute("aria-label", "Probe link: " + transportName(tid) + ", " + lat);
      }
    }
  }
  function wirePill() {
    var d = doc();
    if (!d || d.__krdSpPill) return;
    d.__krdSpPill = true;
    d.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-spill]") : null;
      if (b) openDetails();
    });
  }
  function lostBanner(show) {
    var d = doc();
    if (!d) return;
    var old = d.getElementById("krdSpLost");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var slot = d.getElementById("krdSpLostSlot");
    if (show && slot) {
      slot.innerHTML = '<div class="krd-sp-lost" role="alert"><p><b>Connection lost.</b> ' +
        "The image stays frozen where it was.</p>" +
        '<div class="krd-sp-row"><button type="button" class="sp-btn pri" data-act="sp-reconnect">Reconnect</button>' +
        '<button type="button" class="sp-btn sec" data-act="sp-recenter">Recenter</button></div></div>';
    }
    if (show) {
      var lab2 = d.getElementById("krdLab");
      if (lab2 && !d.getElementById("krdSpLost")) {
        var banner = d.createElement("div");
        banner.id = "krdSpLost";
        banner.className = "krd-sp-lost";
        banner.setAttribute("role", "alert");
        banner.innerHTML = "<p><b>Connection lost.</b> The probe image is frozen where it was.</p>" +
          '<div class="krd-sp-row"><button type="button" class="sp-btn pri" data-act="sp-reconnect">Reconnect</button>' +
          '<button type="button" class="sp-btn sec" data-act="sp-recenter">Recenter</button></div>';
        lab2.insertBefore(banner, lab2.firstChild);
        wireLabActs(banner);
      }
    }
  }
  function wireLabActs(scope) {
    if (!scope || scope.__krdSpWired) return;
    scope.__krdSpWired = true;
    scope.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (b) handleAct(b.getAttribute("data-act"), b);
    });
  }
  function probeNow() {
    try {
      var L = echoLab();
      if (L && L.getProbeState) return L.getProbeState();
    } catch (e) {}
    return null;
  }

  /* ---------- Probe Lab driving (display side) ----------
   * When this phone is the display and the Echo Lab is showing the Probe
   * Lab frame, a paired probe phone drives that lab directly: rotation,
   * fan, rock and depth set its own range inputs (input and change events,
   * exactly as a user moving them), and slide moves its scene grip with a
   * short synthetic pointer drag on #scene. Same origin, so the frame
   * document is reachable; every step is guarded so a missing or loading
   * frame is a plain no-op and the Scan Lab path is untouched. */
  var probeLabSlide = { x: null, y: null };
  function probeLabFrameDoc() {
    var d = doc();
    if (!d || !d.getElementById) return null;
    var frame = d.getElementById("krdProbeFrame");
    if (!frame) return null;
    try {
      return (frame.contentDocument || (frame.contentWindow && frame.contentWindow.document)) || null;
    } catch (e) { return null; }
  }
  function setProbeLabRange(fdoc, id, value) {
    if (!fdoc || !fdoc.getElementById || value == null || !isFinite(+value)) return false;
    var el = fdoc.getElementById(id);
    if (!el) return false;
    var min = parseFloat(el.min), max = parseFloat(el.max), v = +value;
    if (isFinite(min)) v = Math.max(min, v);
    if (isFinite(max)) v = Math.min(max, v);
    var next = String(v);
    if (el.value === next) return true;
    el.value = next;
    var win = fdoc.defaultView || G;
    var Evt = (win && win.Event) || (typeof Event !== "undefined" ? Event : null);
    if (Evt) {
      try { el.dispatchEvent(new Evt("input", { bubbles: true })); } catch (e) {}
      try { el.dispatchEvent(new Evt("change", { bubbles: true })); } catch (e) {}
    }
    return true;
  }
  function driveProbeLabGrip(fdoc, pose) {
    if (!fdoc || !fdoc.getElementById) return false;
    var sx = pose.slideX != null ? +pose.slideX : null;
    var sy = pose.slideY != null ? +pose.slideY : null;
    if (sx == null || sy == null || !isFinite(sx) || !isFinite(sy)) return false;
    if (probeLabSlide.x == null) { probeLabSlide.x = sx; probeLabSlide.y = sy; return true; }
    var dx = sx - probeLabSlide.x, dy = sy - probeLabSlide.y;
    probeLabSlide.x = sx; probeLabSlide.y = sy;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return true;
    var scene = fdoc.getElementById("scene");
    if (!scene || !scene.dispatchEvent || !scene.getBoundingClientRect) return false;
    var rect = scene.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var scale = 2; /* px per mm of slide */
    var win = fdoc.defaultView || G;
    var PE = (win && win.PointerEvent) || (typeof PointerEvent !== "undefined" ? PointerEvent : null);
    var ME = (win && win.MouseEvent) || (typeof MouseEvent !== "undefined" ? MouseEvent : null);
    function fire(type, x, y) {
      var evt = null;
      try {
        if (PE) evt = new PE(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 });
        else if (ME) evt = new ME(type.replace("pointer", "mouse"), { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 });
        else {
          var Evt2 = (win && win.Event) || (typeof Event !== "undefined" ? Event : null);
          if (Evt2) { evt = new Evt2(type, { bubbles: true, cancelable: true }); evt.clientX = x; evt.clientY = y; evt.pointerId = 7; }
        }
      } catch (e) { evt = null; }
      if (evt) try { scene.dispatchEvent(evt); } catch (e2) {}
    }
    fire("pointerdown", cx, cy);
    fire("pointermove", cx + dx * scale, cy + dy * scale);
    fire("pointerup", cx + dx * scale, cy + dy * scale);
    return true;
  }
  /* The Probe Lab ignores its rotation, fan, rock and depth controls outside
   * Practice mode (guided views play fixed presets), so a paired probe moved
   * nothing on the display. Enter Practice before driving it. */
  function ensureProbeLabPractice(fdoc) {
    var leave = fdoc.getElementById("leave-practice");
    if (leave && !leave.hidden) return true;
    var btn = fdoc.getElementById("practice");
    if (!btn || btn.disabled) return false;
    try { btn.click(); } catch (e) { return false; }
    return true;
  }
  function driveProbeLab(pose) {
    if (!pose) return false;
    var fdoc = probeLabFrameDoc();
    if (!fdoc) return false;
    ensureProbeLabPractice(fdoc);
    var any = false;
    if (setProbeLabRange(fdoc, "rotation", pose.rotationDeg)) any = true;
    if (setProbeLabRange(fdoc, "fan", pose.tiltDeg)) any = true;
    if (setProbeLabRange(fdoc, "rock", pose.rockDeg)) any = true;
    if (pose.depthCm != null && setProbeLabRange(fdoc, "depth", pose.depthCm)) any = true;
    if (driveProbeLabGrip(fdoc, pose)) any = true;
    return any;
  }

  /* ---------- diagnostics ---------- */
  function openDetails() {
    S.detailsFrom = S.screen;
    var st = null, tid = null, list = [], session = currentPairing(), err = null;
    try { st = S.core && S.core.stats ? S.core.stats() : null; } catch (e) {}
    try { tid = S.core && S.core.activeTransport ? S.core.activeTransport() : null; } catch (e) {}
    try { list = S.core && S.core.transports ? S.core.transports() : []; } catch (e) {}
    try { err = S.core && S.core.lastError ? S.core.lastError() : null; } catch (e) {}
    var pos = probeNow();
    var rows = list.map(function (t) {
      var ok = !!t.available;
      return '<li><span>' + esc(transportName(t.id)) + (t.id === tid ? " (in use)" : "") + "</span>" +
        '<span class="krd-sp-' + (ok ? "ok" : "mut") + '">' + esc(ok ? "Ready" : (t.reason || "Not available")) + "</span></li>";
    }).join("");
    showSheet("Connection",
      '<ul class="krd-sp-diag">' +
      "<li><span>Link</span><span>" + esc(transportName(tid)) + "</span></li>" +
      "<li><span>Delay</span><span>" + esc(fmtLatency(st && st.rttMs)) + "</span></li>" +
      "<li><span>Lost data</span><span>" + esc(st && st.lossPct != null ? Math.round(st.lossPct) + " percent" : "unknown") + "</span></li>" +
      "<li><span>Image rate</span><span>" + esc(st && st.recvPerSec != null ? Math.round(st.recvPerSec) + " per second" : "unknown") + "</span></li>" +
      (session && session.expiresAt ? "<li><span>Code expires in</span><span>" + esc(fmtExpiry(session.expiresAt)) + "</span></li>" : "") +
      (pos ? "<li><span>Probe now</span><span>" + esc(String(pos.window) + ", slide " + Math.round(pos.position.x) + ", " + Math.round(pos.position.y)) + "</span></li>" : "") +
      "<li><span>Last error</span><span>" + esc(err || "None") + "</span></li></ul>" +
      (rows ? '<h3 class="sp-h3">Links on this phone</h3><ul class="krd-sp-diag">' + rows + "</ul>" : "") +
      '<div class="krd-sp-row"><button type="button" class="sp-btn sec" data-act="sp-recenter">Recenter</button>' +
      '<button type="button" class="sp-btn sec" data-act="sp-end">Disconnect</button></div>' +
      '<div class="krd-sp-col"><button type="button" class="sp-btn sec sp-wide" data-act="sp-back">Back</button></div>');
    bindRootClose(function () { handleAct("sp-back", null); });
  }

  /* ---------- core events and actions ---------- */
  function onCoreEvent(evt) {
    evt = evt || {};
    if (evt.type === "pose") {
      S.probePose = evt.pose;
      refreshGlyph();
      /* Display side: a paired probe also drives the Probe Lab frame when
       * it is on screen. The Scan Lab pose path runs in the core either
       * way, so this only adds the frame drive. */
      try { if (coreRole() === "display") driveProbeLab(evt.pose); } catch (e) {}
      return;
    }
    var name = sessionState();
    S.lastState = name;
    refreshChrome();
    if (!S.screen && (name === "disconnected" || name === "failed" || name === "idle")) { closeAll(); return; }
    if (evt.type === "pairing" && S.screen === "display") { openDisplay(); return; }
    if (evt.type === "state" && S.screen === "display") {
      var session = currentPairing();
      try { if (S.core && S.core.session) session = S.core.session(); } catch (e) {}
      if (name === "confirming") renderConfirm(session);
      else if (name === "connected") { spHaptic("success"); closeSheet(); ensureWake(); }
      else if (name === "failed") {
        showDisplayError({ reason: evt.reason || (S.core && S.core.lastError ? S.core.lastError() : "") });
        return;
      } else setStateLine(name);
      renderConfirm(name === "confirming" ? session : null);
    }
    if (evt.type === "state" && S.screen === "probe") {
      if (name === "confirming") renderProbeActive();
      else if (name === "connected") {
        spHaptic("success");
        if (S.probeStep !== "active" && S.probeStep !== "touch") renderProbeActive();
        else renderProbeConfirm();
        ensureWake();
      }
      else if (name === "failed") { S.probeStep = "intro"; renderProbeIntro(); joinErr(null, mapReason({ reason: evt.reason || "" })); }
      else if (name === "connecting" || name === "discovering" || name === "pairing") setProbeBusy(stateLabel(name).line);
    }
    if (evt.type === "stats") refreshPill();
  }
  function coreRole() {
    try {
      if (!S.core) return null;
      var r = S.core.role;
      return typeof r === "function" ? r.call(S.core) : (r || null);
    } catch (e) { return null; }
  }
  /* Display side: while a remote probe is paired, the Echo Lab touch
   * controls are disabled in place (never removed) and a plain paired
   * note shows. With no probe paired they work exactly as before. */
  function refreshProbePaired() {
    var d = doc();
    if (!d) return;
    var lab = d.getElementById("krdLab");
    if (!lab) return;
    if (!S.core) S.core = syncCore();
    var active = sessionState() === "connected" && coreRole() === "display";
    var note = d.getElementById("krdSpPaired");
    if (active) {
      lab.classList.add("krd-sp-paired");
      if (!note) {
        note = d.createElement("p");
        note.id = "krdSpPaired"; note.className = "krd-sp-paired-note"; note.setAttribute("role", "status");
        note.textContent = "Probe paired. The probe phone is driving the scan, so the touch controls on this phone are paused.";
        lab.insertBefore(note, lab.firstChild);
      }
      var ctrls = lab.querySelectorAll("input[type='range'], button");
      for (var i = 0; i < ctrls.length; i++) {
        var el = ctrls[i];
        if (el.getAttribute("data-act") === "kecho-syncprobe") continue;
        if (el.getAttribute("data-spill")) continue;
        if (el.closest && el.closest("#krdSpLost")) continue;
        if (!el.disabled) { el.setAttribute("data-sp-disabled", "1"); el.disabled = true; }
      }
      ["krdChest", "krdTiltStrip", "krdRockStrip"].forEach(function (id) {
        var s = d.getElementById(id);
        if (s) { s.setAttribute("aria-disabled", "true"); s.setAttribute("data-sp-disabled", "1"); }
      });
    } else {
      lab.classList.remove("krd-sp-paired");
      if (note && note.parentNode) note.parentNode.removeChild(note);
      var marked = lab.querySelectorAll("[data-sp-disabled]");
      for (var j = 0; j < marked.length; j++) { marked[j].removeAttribute("data-sp-disabled"); if ("disabled" in marked[j]) marked[j].disabled = false; marked[j].removeAttribute("aria-disabled"); }
    }
  }
  var chromeUnsub = null, chromeTick = null;
  function ensureChromeSubscription() {
    if (!S.core) S.core = syncCore();
    if (S.core && !chromeUnsub && S.core.on) {
      try { chromeUnsub = S.core.on(function (evt) {
        if (evt && evt.type === "pose") {
          S.probePose = evt.pose;
          try { if (coreRole() === "display") driveProbeLab(evt.pose); } catch (e) {}
          return;
        }
        refreshChrome();
      }); } catch (e) {}
    }
    if (!chromeTick && G.setInterval) {
      chromeTick = G.setInterval(function () { refreshChrome(); }, 1000);
    }
  }
  function refreshChrome() {
    ensureChromeSubscription();
    wirePill();
    refreshPill();
    refreshProbePaired();
    var name = sessionState();
    var lost = name === "reconnecting";
    lostBanner(lost);
    var d = doc(), slot = d && d.getElementById("krdSpLostSlot");
    if (slot && S.screen === "probe") {
      var want = lost ? "1" : "";
      if (slot.getAttribute("data-lost") !== want) {
        slot.setAttribute("data-lost", want);
        slot.innerHTML = lost
          ? '<div class="krd-sp-lost" role="alert"><p><b>Connection lost.</b> The image stays frozen where it was.</p>' +
            '<div class="krd-sp-row"><button type="button" class="sp-btn pri" data-act="sp-reconnect">Reconnect</button>' +
            '<button type="button" class="sp-btn sec" data-act="sp-recenter">Recenter</button></div></div>'
          : "";
      }
    }
    var sub = d && d.getElementById("krdSpStateSub");
    if (sub && (S.screen === "probe") && S.probeStep === "active" && name === "connected") {
      /* The state line was drawn while confirming; keep it in step too. */
      var line = d.getElementById("krdSpState");
      if (line && line.textContent !== stateLabel("connected").line) line.textContent = stateLabel("connected").line;
      var st = null;
      try { st = S.core.stats ? S.core.stats() : null; } catch (e) {}
      sub.textContent = "Over " + transportName(S.core.activeTransport && S.core.activeTransport()).toLowerCase() + ", " + fmtLatency(st && st.rttMs);
    }
    var p = currentPairing();
    if (S.screen === "display" && p && p.expiresAt && isExpired(p.expiresAt) && !S.refreshingPairing) {
      S.refreshingPairing = true;
      try {
        var fresh = S.core && S.core.refreshDisplay ? S.core.refreshDisplay() : null;
        Promise.resolve(fresh).then(function () { S.refreshingPairing = false; if (S.screen === "display") openDisplay(); }, function () { S.refreshingPairing = false; });
      } catch (e) { S.refreshingPairing = false; }
    }
    var exp = d && d.getElementById("krdSpExpiry");
    if (exp && p && p.expiresAt) exp.textContent = "Code expires in " + fmtExpiry(p.expiresAt);
  }
  function handleAct(act, btn) {
    /* Cancelling the pair sheet ends the session this phone started; closing
     * any other sheet only puts the UI away. */
    if (act === "sp-close") {
      if (S.screen === "display") { try { if (S.core.disconnect) S.core.disconnect(); } catch (e) {} }
      closeAll(); return;
    }
    if (act === "sp-display") { openDisplay(); return; }
    if (act === "sp-probe") { openProbe(); return; }
    if (act === "sp-motion") {
      requestMotion().then(function (ok) {
        if (ok) { S.motionChosen = true; S.controlMode = "motion"; renderProbeCalibrate(); }
        else renderProbeDenied();
      });
      return;
    }
    if (act === "sp-touch") { S.motionChosen = true; S.controlMode = "touch"; renderProbeTouch(); return; }
    if (act === "sp-scan") { scanCode(); return; }
    if (act === "sp-nearby-refresh") { startNearbySearch(); return; }
    if (act === "sp-nearby-join") {
      var hash = btn && btn.getAttribute ? btn.getAttribute("data-hash") : "";
      S.probeStep = "joining"; setProbeBusy("Connecting");
      try {
        var nj = S.core.joinNearby ? S.core.joinNearby({ codeHashHex: hash, name: btn && btn.getAttribute ? btn.getAttribute("data-name") : "" }) : Promise.reject(new Error("bluetooth-unavailable"));
        Promise.resolve(nj).then(function () {}, function (e) { S.probeStep = "intro"; renderProbeIntro(); joinErr(null, mapReason(e)); });
      } catch (e) { S.probeStep = "intro"; renderProbeIntro(); joinErr(null, mapReason(e)); }
      return;
    }
    if (act === "sp-err-scan") { scanCode(); return; }
    if (act === "sp-err-sign-in") {
      if (!openSignIn()) {
        if (S.screen === "display") showDisplayError({ reason: "sign-in-required" });
        else joinErr("Open Account and sign in, then try again.");
      }
      return;
    }
    if (act === "sp-err-settings") { joinErr("Open Settings, allow Bluetooth for this app, then search again."); return; }
    if (act === "sp-err-retry") { if (S.screen === "display" || S.displayError) openDisplay(); else startNearbySearch(); return; }
    if (act === "sp-join-code") {
      var d = doc(), input = d && d.getElementById("krdSpCode");
      probeJoin(input ? input.value : "");
      return;
    }
    if (act === "sp-calibrate") {
      spHaptic("selection");
      try { if (S.core.calibrate) S.core.calibrate(); } catch (e) {}
      S.probeStep = "active";
      renderProbeActive();
      return;
    }
    if (act === "sp-confirm") { try { if (S.core.confirm) S.core.confirm(); } catch (e) {} return; }
    if (act === "sp-pause") {
      var paused = btn && btn.getAttribute("data-p") === "1";
      try { if (S.core.setPaused) S.core.setPaused(!paused); } catch (e) {}
      if (btn) { btn.textContent = paused ? "Pause" : "Resume"; btn.setAttribute("data-p", paused ? "0" : "1"); }
      return;
    }
    if (act === "sp-recenter") { try { if (S.core.recenter) S.core.recenter(); } catch (e) {} return; }
    if (act === "sp-reconnect") { try { if (S.core.reconnect) S.core.reconnect(); } catch (e) {} return; }
    if (act === "sp-end") {
      try { if (S.core.disconnect) S.core.disconnect(); } catch (e) {}
      closeAll();
      return;
    }
    if (act === "sp-details") { openDetails(); return; }
    if (act === "sp-back") {
      var from = S.detailsFrom; S.detailsFrom = null;
      if (S.screen === "display" || from === "display") openDisplay();
      else if (S.screen === "probe" || from === "probe") { if (S.probeStep === "active" || S.probeStep === "touch") renderProbeActive(); else renderProbeIntro(); }
      else if (from === "role" || S.screen === "role") openRole();
      else closeSheet();
      return;
    }
  }
  function requestMotion() {
    /* Test hook (headless runner only): window.__krdSpMotionForced = "granted"
     * or "denied" skips the device check so both branches are exercisable. */
    try {
      if (G.__krdSpMotionForced === "granted") return Promise.resolve(true);
      if (G.__krdSpMotionForced === "denied") return Promise.resolve(false);
    } catch (e) {}
    try {
      var DOE = G.DeviceOrientationEvent, DME = G.DeviceMotionEvent;
      var ask = (DOE && typeof DOE.requestPermission === "function") ? DOE.requestPermission
        : (DME && typeof DME.requestPermission === "function") ? DME.requestPermission : null;
      if (!ask) {
        var supported = (typeof G.addEventListener === "function") &&
          (typeof DOE !== "undefined" || typeof DME !== "undefined" || "DeviceOrientationEvent" in G);
        return Promise.resolve(!!supported);
      }
      return ask.call(DOE && typeof DOE.requestPermission === "function" ? DOE : DME).then(
        function (r) { return r === "granted"; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function scanCode() {
    try {
      var P = G.Capacitor && G.Capacitor.Plugins && G.Capacitor.Plugins.CapacitorBarcodeScanner;
      if (!P || !P.scanBarcode) { joinErr("Scanning is not available on this phone. Type the code instead."); focusCode(); return; }
      P.scanBarcode({
        hint: 0, scanInstructions: "Point the camera at the pairing code on the display phone",
        scanButton: false, scanText: " ", cameraDirection: 1, scanOrientation: 3,
        cancelButtonAccessibilityLabel: "Cancel scanning",
        torchButtonOnAccessibilityLabel: "Turn the torch off",
        torchButtonOffAccessibilityLabel: "Turn the torch on"
      }).then(function (r) {
        var text = (r && r.ScanResult) || "";
        if (!text) return;
        var code = String(text).trim();
        if (!parsePayload(code) && normalizeCodeInput(code).length !== 6) { joinErr("That is not a SyncProbe code. Point the camera at the code on the display phone."); return; }
        var d = doc(), input = d && d.getElementById("krdSpCode");
        if (input && !parsePayload(code)) input.value = code;
        probeJoin(code);
      }, function () { joinErr("The scan was cancelled. Type the code instead."); focusCode(); });
    } catch (e) { joinErr("Scanning is not available on this phone. Type the code instead."); focusCode(); }
  }
  function closeSheet() {
    clearRoot();
    S.screen = null; S.probeStep = "intro"; S.probePose = null; S.displayError = null;
  }
  function closeAll() {
    resumeProbeRender();
    closeSheet();
    clearTick();
    releaseWake();
    lostBanner(false);
    if (S.unsub) { try { S.unsub(); } catch (e) {} S.unsub = null; }
    S.core = null; S.pairing = null; S.lastState = "idle";
    if (S.returnFocus) {
      try { S.returnFocus.focus(); } catch (e) {}
      S.returnFocus = null;
    }
    refreshPill();
  }

  var API = {
    open: openRole, openRole: openRole, openDisplay: openDisplay, openProbe: openProbe,
    isProbeRenderSuspended: function () { return probeRenderSuspended; },
    close: closeAll, dismiss: closeSheet, details: openDetails,
    _pure: {
      qrEncode: qrEncode, qrDraw: qrDraw,
      buildPayload: buildPayload, parsePayload: parsePayload, isExpired: isExpired,
      stateLabel: stateLabel, transportName: transportName, signalBars: signalBars, mapReason: mapReason, friendlyReason: friendlyReason, openSignIn: openSignIn, normalizeCodeInput: normalizeCodeInput, formatCodeInput: formatCodeInput,
      fmtLatency: fmtLatency, fmtExpiry: fmtExpiry, codeGroups: codeGroups,
      driveProbeLab: driveProbeLab, setProbeLabRange: setProbeLabRange, driveProbeLabGrip: driveProbeLabGrip
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_SYNCPROBE = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
