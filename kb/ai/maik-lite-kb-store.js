/* kb/ai/maik-lite-kb-store.js — window.SMD_MAIK_KB_STORE
 *
 * Downloads and caches the book-chunk asset that kb/ai/maik-lite-rag.js searches, and builds
 * the in-memory BM25 index from it. A deliberately SMALL, single-purpose sibling to
 * maik-models.js's downloader rather than a reuse of it: this is a data asset, not a
 * selectable model, and does not belong in the MaiK model picker.
 *
 * SAME lesson as tonight's install-check bug (see vault/decisions/Decisions.md,
 * 2026-09-03): the "already downloaded" check must compare CONTENT (a stored sha256),
 * not just size, or a republished asset with the same byte count silently never
 * re-downloads. Applied here from the start rather than re-discovered later.
 *
 * Unlike the multi-GB model packs, this file is small enough (38 MB) that a real
 * SHA-256 verification via Web Crypto is cheap - no size+magic compromise needed.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SMD_MAIK_KB_STORE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DIR = "DATA";                 // Directory.Data -> Documents on iOS, matches maik-models.js
  var SUBDIR = "maik-kb";
  var NAME = "maik-lite-kb.jsonl";
  var URL = "https://models.stewardmd.in/maik/maik-lite-kb.jsonl";
  var BYTES = 37976783;             // exact, from the upload
  var SHA256 = "96b4504ac62dfa50d672913aa7d52fbdb5f949de0b52dc9aed2fd73e74be480b";
  var CHUNK_BYTES = 2 * 1024 * 1024;
  var CHUNK_TRIES = 5;
  var MARK = "smd_maik_kb_installed";
  var MARK_SHA = "smd_maik_kb_sha";

  function cap() { return (typeof window !== "undefined" && window.Capacitor) || null; }
  function isNative() { var c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); }
  function fs() { var c = cap(); return (c && c.Plugins && c.Plugins.Filesystem) || null; }
  function fetchImpl() {
    try { if (typeof window !== "undefined" && typeof window.CapacitorWebFetch === "function") return window.CapacitorWebFetch.bind(window); } catch (e) {}
    return (typeof fetch !== "undefined") ? fetch : null;
  }
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function relPath() { return SUBDIR + "/" + NAME; }

  function sizeOf() {
    var F = fs(); if (!F) return Promise.resolve(0);
    return F.stat({ path: relPath(), directory: DIR }).then(function (s) { return (s && s.size) || 0; }).catch(function () { return 0; });
  }

  /** Same-size-but-stale detection: a republished KB asset must be re-fetched even though the
   * byte count did not change (found live, 2026-09-03, on the model download path - fixed here
   * from day one instead of waiting to hit it again). */
  function stale() { return lget(MARK_SHA) !== SHA256; }
  function installedCached() { return lget(MARK) === "1" && !stale(); }

  function installed() {
    if (!isNative() || !fs()) return Promise.resolve(false);
    if (stale()) { lset(MARK, "0"); return Promise.resolve(false); }
    return sizeOf().then(function (n) {
      var ok = n === BYTES;
      lset(MARK, ok ? "1" : "0");
      return ok;
    });
  }

  var _state = { downloading: false, frac: 0, note: "", err: null };
  var _subs = [];
  function emit() { _subs.slice().forEach(function (fn) { try { fn(_state); } catch (e) {} }); }
  function subscribe(fn) { _subs.push(fn); return function () { _subs = _subs.filter(function (f) { return f !== fn; }); }; }
  function state() { return _state; }

  function sha256Hex(buf) {
    if (typeof crypto === "undefined" || !crypto.subtle) return Promise.resolve(null);   // web-view without SubtleCrypto: skip, size check still ran
    return crypto.subtle.digest("SHA-256", buf).then(function (h) {
      var b = new Uint8Array(h), s = "";
      for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
      return s;
    });
  }

  function ensure(onProgress) {
    var F = fs(), fx = fetchImpl();
    if (!isNative() || !F) return Promise.reject(new Error("on-device KB needs the native app"));
    if (!fx) return Promise.reject(new Error("no fetch available"));
    if (_state.downloading) return Promise.reject(new Error("already downloading"));

    return installed().then(function (ok) {
      if (ok) { _state = { downloading: false, frac: 1, note: "Ready", err: null }; emit(); return { installed: true }; }

      _state = { downloading: true, frac: 0, note: "Starting", err: null }; emit();
      var cancelled = false;

      return F.mkdir({ path: SUBDIR, directory: DIR, recursive: true }).catch(function () {}).then(function () {
        return sizeOf();
      }).then(function (have) {
        if (have >= BYTES) { return F.deleteFile({ path: relPath(), directory: DIR }).catch(function () {}).then(function () { return 0; }); }
        return have;
      }).then(function (have) {
        function report(bytes) {
          _state = { downloading: true, frac: Math.min(1, bytes / BYTES), note: "Downloading knowledge base", err: null };
          emit(); if (onProgress) onProgress(_state.frac, _state.note);
        }
        function chunk(offset, end, attempt) {
          return fx(URL, { headers: { Range: "bytes=" + offset + "-" + end } }).catch(function (e) {
            if (attempt >= CHUNK_TRIES || cancelled) throw e;
            var wait = 800 * Math.pow(2, attempt - 1);
            return new Promise(function (res) { setTimeout(res, wait); }).then(function () { return chunk(offset, end, attempt + 1); });
          });
        }
        function step(offset) {
          if (cancelled) throw new Error("cancelled");
          if (offset >= BYTES) return Promise.resolve();
          var end = Math.min(offset + CHUNK_BYTES, BYTES) - 1;
          return chunk(offset, end, 1).then(function (r) {
            if (!r || (r.status !== 206 && r.status !== 200)) throw new Error("download failed (" + (r && r.status) + ")");
            return r.arrayBuffer();
          }).then(function (ab) {
            var b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(ab)));
            return F.appendFile({ path: relPath(), directory: DIR, data: b64 }).then(function () {
              report(offset + ab.byteLength);
              return step(offset + ab.byteLength);
            });
          });
        }
        return step(have);
      }).then(function () {
        return F.readFile({ path: relPath(), directory: DIR });
      }).then(function (r) {
        // Real SHA-256 check - affordable at 38 MB, unlike the multi-GB model packs.
        var bin = atob(r.data), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return sha256Hex(bytes.buffer);
      }).then(function (hash) {
        if (hash && hash !== SHA256) {
          return F.deleteFile({ path: relPath(), directory: DIR }).catch(function () {}).then(function () {
            throw new Error("KB download corrupted (sha256 mismatch), please retry");
          });
        }
        lset(MARK, "1"); lset(MARK_SHA, SHA256);
        _state = { downloading: false, frac: 1, note: "Ready", err: null }; emit();
        return { installed: true };
      }).catch(function (e) {
        _state = { downloading: false, frac: _state.frac, note: String((e && e.message) || e), err: String((e && e.message) || e) };
        emit();
        throw e;
      });
    });
  }

  var _book = null;
  /** Load (downloading first if needed) and build the in-memory BM25 index. Cached for the
   * session - a 42k-row index build is ~1-3s, not worth repeating per question. */
  function loadBook(RAG, onProgress) {
    if (_book) return Promise.resolve(_book);
    var F = fs();
    return ensure(onProgress).then(function () {
      return F.readFile({ path: relPath(), directory: DIR });
    }).then(function (r) {
      var lines = r.data.split("\n");
      var rows = [];
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        try { rows.push(JSON.parse(lines[i])); } catch (e) {}
      }
      _book = new RAG.Book(rows);
      return _book;
    });
  }

  function bookIfLoaded() { return _book; }

  return { installedCached: installedCached, installed: installed, ensure: ensure, state: state,
           subscribe: subscribe, loadBook: loadBook, bookIfLoaded: bookIfLoaded,
           BYTES: BYTES, SHA256: SHA256 };
});
