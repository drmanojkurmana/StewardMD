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
  var ROWS = 42176;                 // exact line count of the upload; loadBook() requires it
  // Identifies WHICH published asset was verified (the staleness marker), not a live digest -
  // see the comment in ensure() for why the on-device hash was removed.
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
            // String.fromCharCode.apply(null, largeArray) blows the JS call-stack limit well
            // before 2 MiB of arguments (verified live: "Maximum call stack size exceeded" at
            // this exact chunk size) - sub-chunk in 0x8000-byte pieces, same fix already proven
            // in maik-models.js's abToB64().
            var bytes = new Uint8Array(ab), bin = "", CH = 0x8000;
            for (var bi = 0; bi < bytes.length; bi += CH) bin += String.fromCharCode.apply(null, bytes.subarray(bi, bi + CH));
            var b64 = btoa(bin);
            return F.appendFile({ path: relPath(), directory: DIR, data: b64 }).then(function () {
              report(offset + ab.byteLength);
              return step(offset + ab.byteLength);
            });
          });
        }
        return step(have);
      }).then(function () {
        return sizeOf();
      }).then(function (n) {
        /* NO whole-file hash on device. The first version read the finished 38 MB file back as
         * ONE base64 string across the plugin bridge (~50 MB), then looped 38 million charCodeAt()
         * calls on the main thread to feed SubtleCrypto - minutes of a pegged UI thread and a memory
         * spike, which on the owner's iPhone was a jetsam kill (found live, 2026-09-03, on the
         * fresh-install path every earlier test had skipped). Same reasoning as maik-models.js: exact
         * byte count here, and loadBook() then proves the content by parsing every line and
         * requiring the exact row count - a truncated or corrupt file cannot pass that. */
        if (n !== BYTES) {
          return F.deleteFile({ path: relPath(), directory: DIR }).catch(function () {}).then(function () {
            throw new Error("KB download incomplete (" + n + " of " + BYTES + " bytes), please retry");
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
  /** Load (downloading first if needed) and build the BM25 index ONCE per app session.
   *
   * History, all live on the owner's iPhone, 2026-09-03: the first version cached the Book
   * (42,176 per-chunk Maps) and got jetsam-killed after a few questions; the second rebuilt it
   * per question and STILL died - the jetsam report showed the WebView content process at
   * 2.16 GB, "per-process-limit", the Maps of the previous build not yet collected under the
   * new one. The fix is in maik-lite-rag.js (a compact inverted index); with that, building once
   * and keeping it is the smaller footprint, not the larger one, because nothing is churned.
   */
  function loadBook(RAG, onProgress) {
    var F = fs();
    if (_book) return Promise.resolve(_book);
    return ensure(onProgress).then(function () {
      // encoding REQUIRED: readFile defaults to base64 (as used deliberately in ensure()'s sha
      // check above), so without this every line failed JSON.parse silently and the book built
      // with zero rows - found live, 2026-09-03, the same night as the base64-chunking crash.
      return F.readFile({ path: relPath(), directory: DIR, encoding: "utf8" });
    }).then(function (r) {
      var lines = r.data.split("\n"), rows = [];
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        try { rows.push(JSON.parse(lines[i])); } catch (e) {}
      }
      // The content check that replaced the on-device hash: every line parsed AND the exact row
      // count. Anything short means a truncated or corrupt file - wipe it and the markers so the
      // next ask re-downloads instead of searching a partial book forever.
      if (rows.length !== ROWS) {
        lset(MARK, "0"); lset(MARK_SHA, "");
        return F.deleteFile({ path: relPath(), directory: DIR }).catch(function () {}).then(function () {
          throw new Error("KB file corrupt (" + rows.length + " of " + ROWS + " rows), will re-download");
        });
      }
      _book = new RAG.Book(rows);
      return _book;
    });
  }

  return { installedCached: installedCached, installed: installed, ensure: ensure, state: state,
           subscribe: subscribe, loadBook: loadBook, BYTES: BYTES, SHA256: SHA256 };
});
