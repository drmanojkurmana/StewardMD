/* StewardMD — Offline drug database (NATIVE + PRO only).
 * ===========================================================================
 * Downloads the ~21 MB gzipped SQLite (→~126 MB), verifies it, opens it read-only,
 * and routes drug searches to it when the device is offline (or the API is
 * unreachable). Hidden entirely on the web build; shows "Upgrade to Pro" for
 * signed-in non-paid users. The photo/token never leaves normal channels — the
 * Firebase ID token is sent only in the Authorization header and never logged.
 *
 * Backend (already live): GET /offline-db/version → {version,row_count,bytes_gzipped,
 * sha256,object}; GET /offline-db → application/gzip. Both need Authorization: Bearer
 * <Firebase ID token>; 401 = login, 403 = upgrade_required.
 *
 * Storage: app-private (Filesystem Directory.Data). Open via the SQLite plugin's
 * Non-Conformant connection (opens a DB from a full path, read-only).
 * ======================================================================== */
(function () {
  "use strict";
  var C = window.Capacitor;
  var isNative = !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());
  if (!isNative) { window.SMD_OFFLINEDB = { isNative: false, installed: function () { return false; } }; return; }

  var API = "https://api.stewardmd.in";
  var DB_FILE = "stewardmd-drugs.sqlite";
  var DIR = "DATA";                                   // Capacitor Directory.Data — app-private, not user-visible
  var PK = { installed: "smd_offlinedb_installed", version: "smd_offlinedb_version", rows: "smd_offlinedb_rows", path: "smd_offlinedb_path" };

  function P() { return (C.Plugins) || {}; }
  function SQLITE() { return P().CapacitorSQLite; }
  function FS() { return P().Filesystem; }
  function HTTP() { return P().CapacitorHttp; }
  function PREF() { return P().Preferences; }
  function fb() { return window.firebase; }

  /* -------- auth / entitlement -------- */
  function currentUser() { try { return fb() && fb().auth().currentUser; } catch (e) { return null; } }
  function idToken() { var u = currentUser(); return u ? u.getIdToken() : Promise.resolve(null); }
  // TESTING grant, self-contained so Pro works even if account.js/SMD_PRO hasn't loaded.
  // ⚠️ set BETA_PRO_ALL = false before launch (and rely on SMD_PRO / the real claim).
  var BETA_PRO_ALL = true;
  var TEST_PRO_EMAILS = ["drmanojkurmana@gmail.com", "northstar201b@gmail.com", "mkkmanojkumar0@gmail.com"];
  function isPro() {
    if (BETA_PRO_ALL) return Promise.resolve(true);                       // testing: everyone Pro
    if (window.SMD_PRO && window.SMD_PRO.isPro) return window.SMD_PRO.isPro();
    var u = currentUser(); if (!u) return Promise.resolve(false);
    if (TEST_PRO_EMAILS.indexOf(String(u.email || "").toLowerCase()) > -1) return Promise.resolve(true);
    return u.getIdTokenResult().then(function (r) { return !!(r && r.claims && r.claims.pro === true); }).catch(function () { return false; });
  }

  /* -------- Preferences state -------- */
  function pget(k) { return PREF().get({ key: k }).then(function (r) { return r && r.value; }).catch(function () { return null; }); }
  function pset(k, v) { return PREF().set({ key: k, value: String(v) }).catch(function () {}); }
  function prem(k) { return PREF().remove({ key: k }).catch(function () {}); }
  var _installed = false, _rows = 0, _version = null, _dbPath = null;
  function loadState() {
    return Promise.all([pget(PK.installed), pget(PK.version), pget(PK.rows), pget(PK.path)]).then(function (a) {
      _installed = a[0] === "1"; _version = a[1] || null; _rows = parseInt(a[2] || "0", 10) || 0; _dbPath = a[3] || null;
      return _installed;
    });
  }

  /* -------- binary helpers -------- */
  function u8ToB64(u8) {
    var CH = 0x8000, s = "";
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    return btoa(s);
  }
  function b64ToU8(b64) { var bin = atob(b64), n = bin.length, u8 = new Uint8Array(n); for (var i = 0; i < n; i++) u8[i] = bin.charCodeAt(i); return u8; }
  function concatU8(chunks, total) { var out = new Uint8Array(total), o = 0; for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; } return out; }
  function sha256hex(u8) {
    return crypto.subtle.digest("SHA-256", u8).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }

  /* -------- version check -------- */
  // resolves {ok, data} | {error:"login"|"upgrade"|"offline"|"server"}
  function fetchVersion() {
    return idToken().then(function (tok) {
      if (!tok) return { error: "login" };
      return HTTP().request({ url: API + "/offline-db/version", method: "GET", headers: { Authorization: "Bearer " + tok }, responseType: "json", connectTimeout: 15000, readTimeout: 15000 })
        .then(function (res) {
          if (res.status === 401) return { error: "login" };
          if (res.status === 403) return { error: "upgrade" };
          if (res.status !== 200) return { error: "server" };
          var d = res.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) {} }
          return { ok: true, data: d };
        }).catch(function () { return { error: "offline" }; });
    });
  }

  /* -------- download (auth) → gz bytes -------- */
  function download(onProgress) {
    return idToken().then(function (tok) {
      if (!tok) return Promise.reject(new Error("login"));
      // Prefer a streaming fetch (real byte progress); fall back to CapacitorHttp (indeterminate).
      return fetch(API + "/offline-db", { headers: { Authorization: "Bearer " + tok } }).then(function (res) {
        if (res.status === 401) throw new Error("login");
        if (res.status === 403) throw new Error("upgrade");
        if (!res.ok) throw new Error("download failed (" + res.status + ")");
        var total = parseInt(res.headers.get("Content-Length") || "0", 10) || 0;
        if (res.body && res.body.getReader) {
          var reader = res.body.getReader(), chunks = [], got = 0;
          return (function pump() {
            return reader.read().then(function (r) {
              if (r.done) return concatU8(chunks, got);
              chunks.push(r.value); got += r.value.length;
              if (onProgress && total) onProgress(got / total);
              return pump();
            });
          })();
        }
        return res.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
      }).catch(function (e) {
        if (e && (e.message === "login" || e.message === "upgrade")) throw e;
        // native fetch may be blocked/streamless → CapacitorHttp fallback (no progress)
        return HTTP().request({ url: API + "/offline-db", method: "GET", headers: { Authorization: "Bearer " + tok }, responseType: "arraybuffer" })
          .then(function (res) {
            if (res.status === 401) throw new Error("login");
            if (res.status === 403) throw new Error("upgrade");
            if (res.status !== 200) throw new Error("download failed (" + res.status + ")");
            return typeof res.data === "string" ? b64ToU8(res.data) : new Uint8Array(res.data);
          });
      });
    });
  }

  /* -------- decompress gz → stream-write to app-private file -------- */
  function decompressToFile(gz, onProgress) {
    try { FS().deleteFile({ path: DB_FILE, directory: DIR }); } catch (e) {}
    var wrote = false, written = 0, FLUSH = 4 * 1024 * 1024;
    function writeChunk(u8) {
      var b64 = u8ToB64(u8);
      var p = wrote ? FS().appendFile({ path: DB_FILE, directory: DIR, data: b64 })
                    : FS().writeFile({ path: DB_FILE, directory: DIR, data: b64, recursive: true });
      wrote = true; written += u8.length; if (onProgress) onProgress(written);
      return p;
    }
    if (typeof DecompressionStream !== "undefined") {
      var stream = new Response(new Blob([gz])).body.pipeThrough(new DecompressionStream("gzip"));
      var reader = stream.getReader(), buf = [], bufLen = 0;
      var step = function () {
        return reader.read().then(function (r) {
          if (r.done) { return bufLen ? writeChunk(concatU8(buf, bufLen)) : Promise.resolve(); }
          buf.push(r.value); bufLen += r.value.length;
          if (bufLen >= FLUSH) { var out = concatU8(buf, bufLen); buf = []; bufLen = 0; return writeChunk(out).then(step); }
          return step();
        });
      };
      return step();
    }
    // fallback: fflate (holds the full ~126 MB briefly)
    var full = window.fflate.gunzipSync(gz), i = 0;
    var stepF = function () {
      if (i >= full.length) return Promise.resolve();
      var slice = full.subarray(i, Math.min(i + FLUSH, full.length)); i += FLUSH;
      return writeChunk(slice).then(stepF);
    };
    return stepF();
  }

  /* -------- SQLite (Non-Conformant, read-only, opened from full path) -------- */
  function fileUri() { return FS().getUri({ path: DB_FILE, directory: DIR }).then(function (r) { return (r && r.uri) || null; }); }
  function pathOf(uri) { return uri ? uri.replace(/^file:\/\//, "") : uri; }
  var _open = false;
  function openDb() {
    if (_open && _dbPath) return Promise.resolve(_dbPath);
    return fileUri().then(function (uri) {
      _dbPath = pathOf(uri);
      return SQLITE().createNCConnection({ databasePath: _dbPath, version: 1 }).then(function () { _open = true; return _dbPath; });
    });
  }
  function query(sql, vals) {
    return openDb().then(function (dbPath) {
      return SQLITE().query({ database: dbPath, statement: sql, values: vals || [], readonly: true }).then(function (r) { return (r && r.values) || []; });
    });
  }
  function closeDb() { if (!_dbPath) return Promise.resolve(); return SQLITE().closeNCConnection({ databasePath: _dbPath }).then(function () { _open = false; }).catch(function () {}); }

  /* -------- FTS query builder -------- */
  function ftsMatch(q) {
    var toks = String(q || "").toLowerCase().replace(/["*]/g, " ").split(/\s+/).filter(function (t) { return t.length; });
    if (!toks.length) return null;
    return toks.map(function (t) { return t + "*"; }).join(" ");   // prefix-match each token
  }

  /* -------- offline search fns — shapes MATCH the online MEDAPI -------- */
  // searchBrands → {results:[{brand,composition,manufacturer,form,mrp,discontinued}]}
  function searchBrands(q, limit) {
    var m = ftsMatch(q); if (!m) return Promise.resolve({ results: [] });
    return query(
      "SELECT d.brand,d.composition,d.manufacturer,d.form,d.mrp,d.discontinued FROM drugs_fts f JOIN drugs d ON d.id=f.rowid WHERE drugs_fts MATCH ? ORDER BY (d.discontinued IS NOT 0), rank LIMIT ?",
      ["brand:" + m, limit || 12]
    ).then(function (rows) { return { results: rows.map(mapBrand) }; }).catch(function () { return { results: [] }; });
  }
  // searchCompositions → {results:[{composition,class,brands:<count>}]}
  function searchCompositions(q, limit) {
    var m = ftsMatch(q); if (!m) return Promise.resolve({ results: [] });
    return query(
      "SELECT d.composition AS composition, MAX(d.class) AS class, COUNT(*) AS brands FROM drugs_fts f JOIN drugs d ON d.id=f.rowid WHERE drugs_fts MATCH ? AND d.composition IS NOT NULL AND d.composition<>'' GROUP BY d.composition ORDER BY brands DESC LIMIT ?",
      [m, limit || 30]
    ).then(function (rows) { return { results: rows.map(function (r) { return { composition: r.composition, "class": r["class"], brands: r.brands }; }) }; }).catch(function () { return { results: [] }; });
  }
  // composition → {composition,class,total,brands:[...]}
  function composition(name, sort, tier, limit, offset, bq) {
    var order = sort === "price-asc" ? "d.mrp ASC" : sort === "price-desc" ? "d.mrp DESC" : sort === "name" ? "d.brand COLLATE NOCASE ASC" : "(d.discontinued IS NOT 0), d.mrp ASC";
    var where = "d.composition = ?", vals = [name];
    if (tier === "active") where += " AND (d.discontinued IS 0 OR d.discontinued IS NULL)";
    else if (tier === "discontinued") where += " AND d.discontinued IS NOT 0";
    if (bq) { where += " AND d.brand LIKE ?"; vals.push("%" + bq + "%"); }
    return query("SELECT COUNT(*) AS n, MAX(d.class) AS class FROM drugs d WHERE " + where, vals).then(function (agg) {
      var total = (agg[0] && agg[0].n) || 0, klass = agg[0] && agg[0]["class"];
      return query("SELECT d.brand,d.manufacturer,d.form,d.pack,d.mrp,d.discontinued FROM drugs d WHERE " + where + " ORDER BY " + order + " LIMIT ? OFFSET ?", vals.concat([limit || 60, offset || 0]))
        .then(function (rows) { return { composition: name, "class": klass, total: total, brands: rows.map(mapBrand) }; });
    }).catch(function () { return null; });
  }
  function drug(id) {
    return query("SELECT * FROM drugs WHERE id = ? LIMIT 1", [id]).then(function (rows) { return rows[0] || null; }).catch(function () { return null; });
  }
  function mapBrand(r) {
    return { brand: r.brand, composition: r.composition, manufacturer: r.manufacturer, form: r.form, pack: r.pack, mrp: (r.mrp === "" || r.mrp == null) ? null : r.mrp, discontinued: !!(r.discontinued && r.discontinued !== "0" && r.discontinued !== 0) };
  }
  function countRows() { return query("SELECT count(*) AS n FROM drugs").then(function (r) { return (r[0] && r[0].n) || 0; }).catch(function () { return 0; }); }

  /* -------- offline routing: prefer online, fall back to local when offline/API-down -------- */
  function online() { return typeof navigator === "undefined" || navigator.onLine !== false; }
  function installRouting() {
    var M = window.MEDAPI; if (!M || M._smdOfflineWrapped) return;
    function wrap(name, offlineFn, emptyShape) {
      var orig = M[name];
      M[name] = function () {
        var args = arguments;
        if (_installed && !online()) return offlineFn.apply(null, args);      // offline → local
        return orig.apply(M, args).then(function (res) {
          var empty = !res || (res.results && !res.results.length) || (res.brands && !res.brands.length) || res === emptyShape;
          if (_installed && (res == null)) return offlineFn.apply(null, args); // API returned null (unreachable) → local
          return res;
        }).catch(function () { return _installed ? offlineFn.apply(null, args) : emptyShape; });
      };
    }
    wrap("searchBrands", searchBrands, { results: [] });
    wrap("searchCompositions", searchCompositions, { results: [] });
    wrap("composition", function (name, sort, tier, limit, offset, q) { return composition(name, sort, tier, limit, offset, q); }, null);
    wrap("drug", function (id) { return drug(id); }, null);
    M._smdOfflineWrapped = true;
  }

  /* ============================ Manager UI ============================ */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmtMB(b) { return (b / 1048576).toFixed(0) + " MB"; }
  function fmtN(n) { return (n || 0).toLocaleString(); }
  function toast(m) { try { (window.toast || function () {})(m); } catch (e) {} }
  function injectCSS() {
    if (document.getElementById("smd-offdb-css")) return;
    var s = document.createElement("style"); s.id = "smd-offdb-css";
    s.textContent = [
      ".odb-ov{position:fixed;inset:0;z-index:880;background:var(--paper,#f7f7f5);display:none;flex-direction:column}",
      ".odb-ov.on{display:flex}",
      ".odb-bar{display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0)}",
      ".odb-x{background:transparent;border:1px solid var(--line,#e5e5e0);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans,system-ui);color:var(--teal,#0F766E);cursor:pointer}",
      ".odb-h{flex:1;text-align:center;font:800 16px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".odb-body{flex:1;overflow-y:auto;padding:18px;max-width:640px;margin:0 auto;width:100%;box-sizing:border-box}",
      ".odb-card{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:14px;padding:18px;margin-bottom:14px}",
      ".odb-t{font:800 17px var(--sans,system-ui);color:var(--ink,#1a1a1a);margin-bottom:6px}",
      ".odb-p{font:500 13.5px var(--sans,system-ui);color:var(--slate,#555);line-height:1.55;margin-bottom:12px}",
      ".odb-btn{display:block;width:100%;padding:14px;border:0;border-radius:12px;background:var(--teal,#0F766E);color:#fff;font:700 15px var(--sans,system-ui);cursor:pointer}",
      ".odb-btn[disabled]{opacity:.5}",
      ".odb-btn.sec{background:transparent;border:1px solid var(--line,#e5e5e0);color:var(--ink,#1a1a1a);margin-top:10px}",
      ".odb-btn.danger{background:transparent;border:1px solid #c0392b;color:#c0392b;margin-top:10px}",
      ".odb-bar-track{height:8px;border-radius:999px;background:var(--line,#e6efee);overflow:hidden;margin:10px 0}",
      ".odb-bar-fill{height:100%;background:var(--teal,#0F766E);width:0;transition:width .2s}",
      ".odb-stat{font:600 12.5px var(--sans,system-ui);color:var(--slate-soft,#888);text-align:center;margin-top:6px}",
      ".odb-badge{display:inline-block;font:700 11px var(--sans,system-ui);padding:3px 9px;border-radius:999px;background:var(--teal-soft,#e0f2f1);color:var(--teal,#0F766E);margin-bottom:10px}"
    ].join("");
    document.head.appendChild(s);
  }
  var _root, _busy = false;
  function build() {
    if (_root) return _root;
    injectCSS();
    _root = document.createElement("div"); _root.className = "odb-ov"; _root.id = "smdOfflineOv";
    _root.innerHTML = '<div class="odb-bar"><button class="odb-x" id="odbClose">‹ Back</button><div class="odb-h">💊 Offline Database</div><div style="width:64px"></div></div><div class="odb-body" id="odbBody"></div>';
    document.body.appendChild(_root);
    _root.querySelector("#odbClose").addEventListener("click", close);
    return _root;
  }
  function open() { build(); _root.classList.add("on"); render(); }
  function close() { if (_root && !_busy) _root.classList.remove("on"); }
  function setBody(html) { var b = _root && _root.querySelector("#odbBody"); if (b) b.innerHTML = html; }

  function render() {
    setBody('<div class="odb-card"><div class="odb-t">Checking…</div></div>');
    isPro().then(function (pro) {
      if (!pro) return renderUpgrade();
      return fetchVersion().then(function (v) {
        if (v.error === "login") return renderMsg("Sign in required", "Please sign in with your StewardMD account to use the offline database.");
        if (v.error === "upgrade") return renderUpgrade();
        if (v.error === "offline") return renderOfflineNow();
        if (v.error) return renderMsg("Unavailable", "Couldn't reach the database service. Please try again.");
        renderStatus(v.data);
      });
    }).catch(function () { renderMsg("Unavailable", "Something went wrong. Please try again."); });
  }
  function renderUpgrade() {
    setBody('<div class="odb-card"><span class="odb-badge">PRO</span><div class="odb-t">Offline drug database</div>' +
      '<div class="odb-p">Download all Indian brands to search instantly, even without internet — ideal for wards with poor signal. This is a StewardMD Pro feature.</div>' +
      '<button class="odb-btn" id="odbUpgrade">Upgrade to Pro</button></div>');
    var b = _root.querySelector("#odbUpgrade"); if (b) b.addEventListener("click", function () { toast("Contact StewardMD to upgrade to Pro."); });
  }
  function renderMsg(t, p) { setBody('<div class="odb-card"><div class="odb-t">' + esc(t) + '</div><div class="odb-p">' + esc(p) + '</div><button class="odb-btn sec" id="odbRetry">Retry</button></div>'); var r = _root.querySelector("#odbRetry"); if (r) r.addEventListener("click", render); }
  function renderOfflineNow() {
    var extra = _installed ? '<div class="odb-p">Your offline copy (' + fmtN(_rows) + ' drugs) is active — drug search works now.</div>' : '';
    setBody('<div class="odb-card"><div class="odb-t">You\'re offline</div><div class="odb-p">Connect to the internet to download or update the offline database.</div>' + extra + '<button class="odb-btn sec" id="odbRetry">Retry</button></div>');
    var r = _root.querySelector("#odbRetry"); if (r) r.addEventListener("click", render);
  }
  function renderStatus(v) {
    var upToDate = _installed && _version === v.version;
    var updateAvail = _installed && _version !== v.version;
    var html = '<div class="odb-card">';
    if (_installed) {
      html += '<span class="odb-badge">INSTALLED</span><div class="odb-t">Offline database ready</div>' +
        '<div class="odb-p">' + fmtN(_rows) + ' drugs on this device' + (upToDate ? ' · up to date' : '') + '. Drug search works offline.</div>';
      if (updateAvail) html += '<button class="odb-btn" id="odbGet">Update available — download ' + fmtMB(v.bytes_gzipped) + '</button>';
      html += '<button class="odb-btn danger" id="odbDel">Delete offline database</button>';
    } else {
      html += '<div class="odb-t">Enable offline database</div>' +
        '<div class="odb-p">Download all ' + fmtN(v.row_count) + ' drugs (' + fmtMB(v.bytes_gzipped) + ' download, ~126 MB on device) so drug search works without internet.</div>' +
        '<button class="odb-btn" id="odbGet">Download ' + fmtMB(v.bytes_gzipped) + '</button>';
    }
    html += '</div>';
    setBody(html);
    var g = _root.querySelector("#odbGet"); if (g) g.addEventListener("click", function () { doDownload(v); });
    var d = _root.querySelector("#odbDel"); if (d) d.addEventListener("click", doDelete);
  }
  function renderProgress(label, frac) {
    setBody('<div class="odb-card"><div class="odb-t">' + esc(label) + '</div>' +
      '<div class="odb-bar-track"><div class="odb-bar-fill" id="odbFill"></div></div>' +
      '<div class="odb-stat" id="odbStat"></div></div>');
    updateProgress(frac);
  }
  function updateProgress(frac, statText) {
    var f = _root && _root.querySelector("#odbFill"); if (f) f.style.width = Math.max(3, Math.round((frac || 0) * 100)) + "%";
    var s = _root && _root.querySelector("#odbStat"); if (s && statText != null) s.textContent = statText;
  }

  function doDownload(v) {
    if (_busy) return; _busy = true;
    renderProgress("Downloading…", 0.02);
    var gz = null;
    download(function (frac) { updateProgress(0.02 + frac * 0.48, "Downloading " + Math.round(frac * 100) + "%"); })
      .then(function (bytes) {
        gz = bytes;
        updateProgress(0.5, "Verifying…");
        return sha256hex(gz);
      })
      .then(function (hex) {
        if (v.sha256 && hex.toLowerCase() !== String(v.sha256).toLowerCase()) throw new Error("The download was incomplete. Please try again.");
        renderProgress("Installing…", 0.55);
        return decompressToFile(gz, function (written) { updateProgress(0.55 + Math.min(0.4, written / (140 * 1048576) * 0.4), "Installing " + fmtMB(written)); });
      })
      .then(function () { gz = null; return closeDb().then(openDb); })
      .then(function () { return countRows(); })
      .then(function (n) {
        if (!n || (v.row_count && n < v.row_count * 0.9)) throw new Error("The database didn't install correctly. Please retry.");
        return Promise.all([pset(PK.installed, "1"), pset(PK.version, v.version), pset(PK.rows, n), pset(PK.path, _dbPath || "")]);
      })
      .then(function () { _installed = true; _version = v.version; _rows = _rows; return countRows(); })
      .then(function (n) { _rows = n; _busy = false; installRouting(); toast("Offline database ready — " + fmtN(n) + " drugs."); render(); })
      .catch(function (e) {
        _busy = false;
        var msg = (e && e.message === "login") ? "Please sign in again to download." :
                  (e && e.message === "upgrade") ? "This requires StewardMD Pro." :
                  (e && e.message) ? e.message : "Download failed. Please try again.";
        setBody('<div class="odb-card"><div class="odb-t">Couldn\'t finish</div><div class="odb-p">' + esc(msg) + '</div><button class="odb-btn" id="odbRetry">Try again</button></div>');
        var r = _root.querySelector("#odbRetry"); if (r) r.addEventListener("click", render);
      });
  }
  function doDelete() {
    if (_busy) return; _busy = true;
    closeDb().then(function () { return FS().deleteFile({ path: DB_FILE, directory: DIR }).catch(function () {}); })
      .then(function () { return Promise.all([prem(PK.installed), prem(PK.version), prem(PK.rows), prem(PK.path)]); })
      .then(function () { _installed = false; _version = null; _rows = 0; _busy = false; toast("Offline database removed."); render(); })
      .catch(function () { _busy = false; render(); });
  }

  /* -------- Settings entry injection (into #sbsub_set) -------- */
  function injectSettingsRow() {
    var set = document.getElementById("sbsub_set"); if (!set) return;
    if (set.querySelector("[data-smd-offdb]")) return;
    var row = document.createElement("button");
    row.setAttribute("data-smd-offdb", "1");
    row.type = "button";
    row.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:0;border-top:1px solid var(--line,#e5e5e0);padding:13px 4px;font:600 14px var(--sans,system-ui);color:var(--ink,#1a1a1a);cursor:pointer";
    row.innerHTML = '<span style="font-size:18px">💊</span><span style="flex:1">Offline drug database' + (_installed ? ' <span style="color:var(--teal,#0F766E);font-weight:700">· on</span>' : '') + '</span><span style="opacity:.5">›</span>';
    row.addEventListener("click", open);
    set.appendChild(row);
  }
  function watchSettings() {
    injectSettingsRow();
    try { new MutationObserver(injectSettingsRow).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }

  /* -------- public API -------- */
  window.SMD_OFFLINEDB = {
    isNative: true,
    installed: function () { return _installed; },
    info: function () { return { installed: _installed, version: _version, rowCount: _rows }; },
    open: open, fetchVersion: fetchVersion, isPro: isPro,
    search: { brands: searchBrands, compositions: searchCompositions, composition: composition, drug: drug }
  };

  /* -------- boot -------- */
  function boot() {
    loadState().then(function () {
      if (_installed) { installRouting(); }        // route offline searches once available
      watchSettings();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
