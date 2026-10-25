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
 */
(function (G) {
  "use strict";

  /* ================= QR encoder (byte mode, EC level L, versions 1 to 9) =====
   * Self-contained: no network, no dependency. Level L keeps the pairing payload
   * (about 155 bytes: kardia-sync:1:<sessionId>:<displayPub>:<shortCode>:<expiry>)
   * inside version 8. Versions stop at 9 (232 data codewords, two equal blocks),
   * so no four-block interleave is needed. */
  var QR_CAP = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230];
  var QR_EC_LEN = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30];
  var QR_NBLOCK = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2];
  var QR_NTOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292];
  var QR_REM = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0];
  var QR_ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46] };

  var GF_EXP = new Array(512), GF_LOG = new Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]; }
  /* Generator polynomial of degree ecLen, low coefficient first, gen[ecLen] = 1. */
  function rsGen(ecLen) {
    var g = [1], ng, i, j;
    for (i = 0; i < ecLen; i++) {
      ng = new Array(g.length + 1);
      for (j = 0; j < ng.length; j++) ng[j] = 0;
      for (j = 0; j < g.length; j++) { ng[j] ^= gmul(g[j], GF_EXP[i]); ng[j + 1] ^= g[j]; }
      g = ng;
    }
    return g;
  }
  /* Systematic Reed Solomon encoder, k steps: feedback from the last register,
   * multipliers low coefficient first, parity read out highest degree first.
   * Verified byte for byte against plain polynomial long division. */
  function rsEncode(data, ecLen) {
    var low = rsGen(ecLen);
    var res = new Array(ecLen), i, j, f, n;
    for (i = 0; i < ecLen; i++) res[i] = 0;
    for (i = 0; i < data.length; i++) {
      f = data[i] ^ res[ecLen - 1];
      n = new Array(ecLen);
      n[0] = gmul(low[0], f);
      for (j = 1; j < ecLen; j++) n[j] = res[j - 1] ^ gmul(low[j], f);
      res = n;
    }
    return res.reverse();
  }
  /* 5 data bits 01mmm (level L, mask m) with BCH, masked with 101010000010010. */
  function qrFormatBits(mask) {
    var data = (1 << 3) | (mask & 7), v = data << 10, g = 0x537, i;
    for (i = 14; i >= 10; i--) if (v & (1 << i)) v ^= g << (i - 10);
    return (((data << 10) | (v & 0x3FF)) ^ 0x5412) & 0x7FFF;
  }
  /* 6-bit version with BCH, 18 bits. Only versions 7 to 9 need it. */
  function qrVersionBits(version) {
    var v = version << 12, g = 0x1F25, i;
    for (i = 17; i >= 12; i--) if (v & (1 << i)) v ^= g << (i - 12);
    return ((version << 12) | (v & 0xFFF)) & 0x3FFFF;
  }
  function qrVersionFor(len) {
    var v;
    for (v = 1; v <= 9; v++) if (len <= QR_CAP[v]) return v;
    return 0;
  }
  function qrDataCodewords(text) {
    var bytes = [], i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) { bytes.push(192 | (c >> 6), 128 | (c & 63)); }
      else { bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    }
    return bytes;
  }
  function qrEncode(text) {
    var bytes = qrDataCodewords(String(text == null ? "" : text));
    var version = qrVersionFor(bytes.length);
    if (!version) return null;
    var dataCw = QR_NTOTAL[version] - QR_EC_LEN[version] * QR_NBLOCK[version];
    var bits = [0, 1, 0, 0], i, b;
    var n = bytes.length;
    for (i = 7; i >= 0; i--) bits.push((n >> i) & 1);
    for (i = 0; i < bytes.length; i++) for (b = 7; b >= 0; b--) bits.push((bytes[i] >> b) & 1);
    var cap = dataCw * 8, term = Math.min(4, cap - bits.length);
    for (i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var cw = [];
    for (i = 0; i < bits.length; i += 8) {
      var w = 0, k;
      for (k = 0; k < 8; k++) w = (w << 1) | bits[i + k];
      cw.push(w);
    }
    var padFrom = cw.length;
    for (i = padFrom; i < dataCw; i++) cw.push((i - padFrom) % 2 ? 0x11 : 0xEC);
    /* Split into blocks, one EC run per block, then interleave. */
    var nBlock = QR_NBLOCK[version], per = dataCw / nBlock, ecLen = QR_EC_LEN[version];
    var blocks = [], bi, ec;
    for (bi = 0; bi < nBlock; bi++) blocks.push(cw.slice(bi * per, (bi + 1) * per));
    var ecBlocks = blocks.map(function (blk) { return rsEncode(blk, ecLen); });
    var seq = [], j;
    for (j = 0; j < per; j++) for (bi = 0; bi < nBlock; bi++) seq.push(blocks[bi][j]);
    for (j = 0; j < ecLen; j++) for (bi = 0; bi < nBlock; bi++) seq.push(ecBlocks[bi][j]);
    var all = [];
    for (i = 0; i < seq.length; i++) for (b = 7; b >= 0; b--) all.push((seq[i] >> b) & 1);
    for (i = 0; i < QR_REM[version]; i++) all.push(0);
    var size = 21 + 4 * (version - 1);
    return qrMatrix(all, version, size);
  }
  function qrBlank(size) {
    var m = [], r, c;
    for (r = 0; r < size; r++) { m.push([]); for (c = 0; c < size; c++) m[r].push(-1); }
    return m;
  }
  function qrFinder(m, r, c) {
    var dr, dc, v;
    for (dr = -1; dr <= 7; dr++) for (dc = -1; dc <= 7; dc++) {
      v = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4))) ? 1 : 0;
      if (dr === -1 || dr === 7 || dc === -1 || dc === 7) v = 0;
      var rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < m.length && cc >= 0 && cc < m.length) m[rr][cc] = v;
    }
  }
  function qrMatrix(bits, version, size) {
    var m = qrBlank(size), r, c, i;
    qrFinder(m, 0, 0); qrFinder(m, 0, size - 7); qrFinder(m, size - 7, 0);
    for (i = 8; i < size - 8; i++) { m[6][i] = (i % 2 === 0) ? 1 : 0; m[i][6] = (i % 2 === 0) ? 1 : 0; }
    /* Alignment patterns overwrite the timing row and column where they meet;
     * only the three combos landing on the finders are skipped. */
    var ac = QR_ALIGN[version] || [], al = ac.length - 1;
    for (var ai = 0; ai < ac.length; ai++) for (var aj = 0; aj < ac.length; aj++) {
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === al) || (ai === al && aj === 0)) continue;
      var ar = ac[ai], cc2 = ac[aj];
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
        var edge = Math.max(Math.abs(dr), Math.abs(dc)) === 2, mid = dr === 0 && dc === 0;
        m[ar + dr][cc2 + dc] = (edge || mid) ? 1 : 0;
      }
    }
    m[4 * version + 9][8] = 1;
    /* Reserve format areas (two copies) and version areas. */
    function reserve(r2, c2) { if (m[r2][c2] === -1) m[r2][c2] = -2; }
    for (i = 0; i < 9; i++) { if (i !== 6) { reserve(8, i); reserve(i, 8); } }
    for (i = 0; i < 8; i++) { reserve(8, size - 1 - i); reserve(size - 1 - i, 8); }
    reserve(8, 8);
    if (version >= 7) for (i = 0; i < 6; i++) for (var j = 0; j < 3; j++) { reserve(i, size - 11 + j); reserve(size - 11 + j, i); }
    /* Data zigzag, two columns at a time, alternating upward and downward. */
    var bit = 0, upward = true, col, k, dc;
    for (col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (k = 0; k < size; k++) {
        r = upward ? size - 1 - k : k;
        for (dc = 0; dc < 2; dc++) {
          c = col - dc;
          if (m[r][c] === -1) {
            if (bit < bits.length) { m[r][c] = -3 - bit; bit++; }
            else m[r][c] = 0;
          }
        }
      }
      upward = !upward;
    }
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var cand = qrApplyMask(m, size, mask, bits);
      var score = qrPenalty(cand, size);
      if (!best || score < best.score) best = { mask: mask, m: cand, score: score };
    }
    var fb = qrFormatBits(best.mask);
    qrWriteFormat(best.m, size, fb);
    if (version >= 7) qrWriteVersion(best.m, size, qrVersionBits(version));
    return { version: version, size: size, mask: best.mask, modules: best.m };
  }
  function qrMaskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
      case 6: return (((r * c) % 2 + (r * c) % 3) % 2) === 0;
      default: return (((r + c) % 2 + (r * c) % 3) % 2) === 0;
    }
  }
  function qrApplyMask(m, size, mask, bits) {
    var out = [], r, c, v;
    for (r = 0; r < size; r++) { out.push([]); for (c = 0; c < size; c++) out[r].push(m[r][c]); }
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) {
      v = out[r][c];
      if (v <= -3) {
        var bit = bits[-(v + 3)] || 0;
        out[r][c] = qrMaskBit(mask, r, c) ? bit ^ 1 : bit;
      } else if (v === -2) out[r][c] = 0;
    }
    return out;
  }
  function qrPenalty(m, size) {
    var score = 0, r, c, run, last, k, dark = 0;
    for (r = 0; r < size; r++) {
      run = 1; last = m[r][0];
      for (c = 1; c < size; c++) {
        if (m[r][c] === last) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; last = m[r][c]; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (c = 0; c < size; c++) {
      run = 1; last = m[0][c];
      for (r = 1; r < size; r++) {
        if (m[r][c] === last) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; last = m[r][c]; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    function finderLike(a, b2, cc2, d, e, f, g) {
      return a === 1 && b2 === 0 && cc2 === 1 && d === 1 && e === 1 && f === 0 && g === 1;
    }
    for (r = 0; r < size; r++) for (c = 0; c + 10 < size; c++) {
      var p = [m[r][c], m[r][c + 1], m[r][c + 2], m[r][c + 3], m[r][c + 4], m[r][c + 5], m[r][c + 6]];
      if ((finderLike.apply(null, p) && m[r][c + 7] === 0 && m[r][c + 8] === 0 && m[r][c + 9] === 0 && m[r][c + 10] === 0) ||
        (m[r][c] === 0 && m[r][c + 1] === 0 && m[r][c + 2] === 0 && m[r][c + 3] === 0 && finderLike(m[r][c + 4], m[r][c + 5], m[r][c + 6], m[r][c + 7], m[r][c + 8], m[r][c + 9], m[r][c + 10]))) score += 40;
    }
    for (c = 0; c < size; c++) for (r = 0; r + 10 < size; r++) {
      var q = [m[r][c], m[r + 1][c], m[r + 2][c], m[r + 3][c], m[r + 4][c], m[r + 5][c], m[r + 6][c]];
      if ((finderLike.apply(null, q) && m[r + 7][c] === 0 && m[r + 8][c] === 0 && m[r + 9][c] === 0 && m[r + 10][c] === 0) ||
        (m[r][c] === 0 && m[r + 1][c] === 0 && m[r + 2][c] === 0 && m[r + 3][c] === 0 && finderLike(m[r + 4][c], m[r + 5][c], m[r + 6][c], m[r + 7][c], m[r + 8][c], m[r + 9][c], m[r + 10][c]))) score += 40;
    }
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      var s = m[r][c] + m[r][c + 1] + m[r + 1][c] + m[r + 1][c + 1];
      if (s === 0 || s === 4) score += 3;
    }
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c] === 1) dark++;
    var pct = (dark * 20) / (size * size), prev = Math.abs(pct - 50) / 5;
    score += Math.floor(prev) * 10;
    return score;
  }
  function qrWriteFormat(m, size, fb) {
    /* Bit i counts from the least significant bit. First copy runs LSB first
     * from (8,0) to (0,8); second copy puts bits 0 to 6 down column 8 and bits
     * 8 to 14 across row 8; the dark module at (size-8,8) stays dark. */
    function bit(i) { return (fb >> i) & 1; }
    var order1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    var i;
    for (i = 0; i < 15; i++) m[order1[i][0]][order1[i][1]] = bit(i);
    for (i = 0; i < 7; i++) m[size - 1 - i][8] = bit(i);
    for (i = 8; i < 15; i++) m[8][size - 15 + i] = bit(i);
    m[size - 8][8] = 1;
  }
  function qrWriteVersion(m, size, vb) {
    var i, a, b, bit;
    for (i = 0; i < 18; i++) {
      bit = (vb >> i) & 1;
      a = size - 11 + (i % 3); b = Math.floor(i / 3);
      m[a][b] = bit; m[b][a] = bit;
    }
  }
  function qrDraw(canvas, text, px) {
    var q = qrEncode(text);
    if (!q || !canvas || !canvas.getContext) return null;
    var ctx = canvas.getContext("2d"), quiet = 4, n = q.size + quiet * 2;
    var s = Math.max(1, Math.floor((px || 240) / n));
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
    return QR_PREFIX + p.sessionId + ":" + p.displayPub + ":" + p.shortCode + ":" + p.expiresAt;
  }
  function parsePayload(s) {
    s = String(s == null ? "" : s).trim();
    if (s.slice(0, QR_PREFIX.length) !== QR_PREFIX) return null;
    var rest = s.slice(QR_PREFIX.length).split(":");
    if (rest.length !== 4) return null;
    if (!/^[0-9a-fA-F]{32}$/.test(rest[0])) return null;
    if (!/^[A-Za-z0-9_-]{20,}$/.test(rest[1])) return null;
    if (!/^[A-Z2-9]{6}$/.test(rest[2])) return null;
    if (!/^\d{10,}$/.test(rest[3])) return null;
    return { sessionId: rest[0].toLowerCase(), displayPub: rest[1], shortCode: rest[2], expiresAt: +rest[3] };
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
  function suspendProbeRender() {
    if (probeRenderSuspended) return;
    probeRenderSuspended = true;
    var L = echoLab();
    try {
      if (L && L.suspendLive) L.suspendLive();
      else if (L && L.echolab && L.echolab.suspend) L.echolab.suspend();
    } catch (e) {}
  }
  function resumeProbeRender() {
    if (!probeRenderSuspended) return;
    probeRenderSuspended = false;
    var L = echoLab();
    try {
      if (L && L.resumeLive) L.resumeLive();
      else if (L && L.echolab && L.echolab.resume) L.echolab.resume();
    } catch (e) {}
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
  function clearRoot() {
    var r = root();
    if (r) r.innerHTML = "";
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
    S.screen = "display";
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
       * start returns a thenable pairing. Repaint once it is ready. */
      if (started && typeof started.then === "function" && !started.sessionId) {
        started.then(function () { if (S.screen === "display") openDisplay(); }, function () { if (S.screen === "display") setStateLine("failed"); });
      }
    } catch (e) { S.pairing = null; }
    if (S.unsub) { try { S.unsub(); } catch (e) {} S.unsub = null; }
    try { S.unsub = S.core.on(onCoreEvent); } catch (e) {}
    var p = currentPairing();
    var payload = p ? buildPayload(p) : "";
    showSheet("Pair a probe",
      '<p class="sp-small">Scan this with the probe phone.</p>' +
      '<div class="krd-sp-qrwrap"><canvas id="krdSpQr" width="280" height="280" role="img" aria-label="Pairing code for the probe phone"></canvas></div>' +
      '<p class="sp-small krd-sp-codelabel">or type this code</p>' +
      '<p class="krd-sp-code" aria-label="Probe code">' + esc(codeGroups(p && p.shortCode)) + "</p>" +
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
      '<button type="button" class="sp-btn pri sp-wide" data-act="sp-confirm">Numbers match, confirm</button></div>';
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
      '<p class="sp-small" id="krdSpCodeHint">Six letters and numbers, as shown on the display phone.</p>' +
      '<p class="sp-small krd-sp-errline" id="krdSpJoinErr" role="alert" hidden></p>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-join-code">Join</button></div>';
  }
  function focusCode() {
    var d = doc(), input = d && d.getElementById("krdSpCode");
    if (input) try { input.focus(); } catch (e) {}
  }
  function renderProbeIntro() {
    showSheet("Use this phone as a probe",
      '<p class="sp-small">Tilt this phone to move the virtual probe on the other phone. ' +
      "Motion stays on this phone and is only used while you train.</p>" +
      '<div class="krd-sp-col">' +
      '<button type="button" class="sp-btn pri sp-wide" data-act="sp-motion">Allow motion</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-touch">Use touch controls instead</button>' +
      "</div>" +
      joinBoxHtml() +
      '<div class="krd-sp-col"><button type="button" class="sp-btn sec sp-wide" data-act="sp-close">Not now</button></div>');
    bindRootClose(closeAll);
    if (!scannerAvailable()) focusCode();
  }
  function joinErr(msg) {
    var d = doc(), el = d && d.getElementById("krdSpJoinErr");
    if (el) { el.hidden = !msg; el.textContent = msg || ""; }
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
        if (S.probeStep === "joining") { S.probeStep = "intro"; renderProbeIntro(); joinErr(friendlyReason(e)); }
      });
    } catch (e) { S.probeStep = "intro"; renderProbeIntro(); joinErr(friendlyReason(e)); }
  }
  function friendlyReason(e) {
    var m = e && (e.reason || e.message);
    if (m === "expired") return "That code has expired. Ask for a fresh code and try again.";
    if (m === "busy") return "That phone is already training with someone else. Try again later.";
    return "The phones could not reach each other. Move closer and try again.";
  }
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
      '<p class="sp-small">Hold the phone like a probe on the chest, marker towards the ' +
      "patient's left shoulder, then tap Calibrate.</p>" +
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
      '<div class="krd-sp-glyphwrap" id="krdSpGlyph" aria-label="Probe orientation">' + glyphSvg(0, 0) + "</div>" +
      '<p class="sp-small krd-sp-posedesc" id="krdSpPoseDesc"></p>' +
      '<div id="krdSpConfirmP"></div>' +
      '<div class="krd-sp-col">' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-pause">Pause</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-recenter">Recenter</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-end">End session</button></div>' +
      '<p class="krd-sp-link"><button type="button" class="krd-sp-minilink" data-act="sp-details">Connection details</button></p>');
    bindRootClose(closeAll);
    if (!scannerAvailable()) focusCode();
    renderProbeConfirm();
    refreshGlyph();
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
      '<button type="button" class="sp-btn pri sp-wide" data-act="sp-confirm">Numbers match, confirm</button></div>';
  }
  function renderProbeTouch() {
    S.probeStep = "touch";
    S.touch = S.touch || { window: "parasternal", rotationDeg: 0, tiltDeg: 0 };
    showSheet("Touch controls",
      '<p class="sp-small">Drag the sliders to move the virtual probe on the display phone.</p>' +
      '<div class="krd-sp-col">' +
      '<label class="krd-sp-field" for="krdSpRot">Rotation <span id="krdSpRotVal">0 deg</span></label>' +
      '<input type="range" id="krdSpRot" min="-180" max="180" step="1" value="' + S.touch.rotationDeg + '" aria-label="Rotation">' +
      '<label class="krd-sp-field" for="krdSpTilt">Tilt <span id="krdSpTiltVal">0 deg</span></label>' +
      '<input type="range" id="krdSpTilt" min="-80" max="80" step="1" value="' + S.touch.tiltDeg + '" aria-label="Tilt">' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-recenter">Recenter</button>' +
      '<button type="button" class="sp-btn sec sp-wide" data-act="sp-end">End session</button></div>');
    bindRootClose(closeAll);
    var d = doc();
    function push() {
      try { if (S.core.probePatch) S.core.probePatch({ rotationDeg: S.touch.rotationDeg, tiltDeg: S.touch.tiltDeg }); } catch (e) {}
    }
    ["krdSpRot", "krdSpTilt"].forEach(function (id) {
      var el = d.getElementById(id);
      if (el) el.addEventListener("input", function () {
        var v = parseFloat(el.value) || 0;
        if (id === "krdSpRot") S.touch.rotationDeg = v; else S.touch.tiltDeg = v;
        var lbl = d.getElementById(id + "Val");
        if (lbl) lbl.textContent = Math.round(v) + " deg";
        push();
      });
    });
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
    if (evt.type === "pose") { S.probePose = evt.pose; refreshGlyph(); return; }
    var name = sessionState();
    S.lastState = name;
    refreshChrome();
    if (!S.screen && (name === "disconnected" || name === "failed" || name === "idle")) { closeAll(); return; }
    if (evt.type === "state" && S.screen === "display") {
      var session = currentPairing();
      try { if (S.core && S.core.session) session = S.core.session(); } catch (e) {}
      if (name === "confirming") renderConfirm(session);
      else if (name === "connected") { closeSheet(); ensureWake(); }
      else if (name === "failed") {
        setStateLine("failed", (evt.reason ? friendlyReason({ reason: evt.reason }) : null));
      } else setStateLine(name);
      renderConfirm(name === "confirming" ? session : null);
    }
    if (evt.type === "state" && S.screen === "probe") {
      if (name === "confirming") renderProbeActive();
      else if (name === "connected") {
        if (S.probeStep !== "active" && S.probeStep !== "touch") renderProbeActive();
        else renderProbeConfirm();
        ensureWake();
      }
      else if (name === "failed") { setProbeBusy("Something went wrong"); }
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
      try { chromeUnsub = S.core.on(function (evt) { if (evt && evt.type === "pose") return; refreshChrome(); }); } catch (e) {}
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
      var st = null;
      try { st = S.core.stats ? S.core.stats() : null; } catch (e) {}
      sub.textContent = "Over " + transportName(S.core.activeTransport && S.core.activeTransport()).toLowerCase() + ", " + fmtLatency(st && st.rttMs);
    }
    var p = currentPairing();
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
        if (ok) { renderProbeCalibrate(); }
        else renderProbeDenied();
      });
      return;
    }
    if (act === "sp-touch") { renderProbeTouch(); return; }
    if (act === "sp-scan") { scanCode(); return; }
    if (act === "sp-join-code") {
      var d = doc(), input = d && d.getElementById("krdSpCode");
      probeJoin(input ? input.value : "");
      return;
    }
    if (act === "sp-calibrate") {
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
        var d = doc(), input = d && d.getElementById("krdSpCode");
        if (input && !parsePayload(code)) input.value = code;
        probeJoin(code);
      }, function () { joinErr("The scan was cancelled. Type the code instead."); focusCode(); });
    } catch (e) { joinErr("Scanning is not available on this phone. Type the code instead."); focusCode(); }
  }
  function closeSheet() {
    clearRoot();
    S.screen = null; S.probeStep = "intro"; S.probePose = null;
  }
  function closeAll() {
    resumeProbeRender();
    closeSheet();
    clearTick();
    releaseWakeLock();
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
      qrEncode: qrEncode, qrDraw: qrDraw, qrFormatBits: qrFormatBits, qrVersionBits: qrVersionBits, rsEncode: rsEncode,
      buildPayload: buildPayload, parsePayload: parsePayload, isExpired: isExpired,
      stateLabel: stateLabel, transportName: transportName, signalBars: signalBars,
      fmtLatency: fmtLatency, fmtExpiry: fmtExpiry, codeGroups: codeGroups
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.KARDIA_SYNCPROBE = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
