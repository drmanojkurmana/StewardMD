/* fundx-store.js — FundX AI · local persistence (FundxStore).
 *
 * Persists every retinal scan ON-DEVICE (no cloud sync in the MVP; a sync hook is
 * reserved). Separates the (small) metadata index from the (large) image bytes:
 *   - metadata index  → localStorage key "stewardmd.fundx.scans" (JSON array)
 *   - images (native) → Filesystem, directory DATA, "fundx/<id>-<kind>.jpg"
 *   - images (web)    → per-id localStorage blob key (dataURLs), best-effort
 *
 * Every saved ScanRecord carries the nine mandated fields (original image, processed
 * image, quality metrics, acquisition metadata, versioned Vision JSON, patient
 * context, timestamp, device/app version, provider/model version) plus audit info;
 * saveScan() validates that via SMD_FUNDX_VISION.validate.scanRecord before writing.
 *
 * Backends are injected (deps) so the module is headless-testable with fakes.
 * Exposed as window.SMD_FUNDX_STORE. Independent of the FundX UI.
 */
(function () {
  "use strict";

  var IDX_KEY = "stewardmd.fundx.scans";
  var IMG_KEY = function (id) { return "stewardmd.fundx.img." + id; };
  var LEARN_KEY = "stewardmd.fundx.learning";
  var OP_KEY = "stewardmd.fundx.operator";
  var IMG_DIR = "DATA";
  var IMG_SUBDIR = "fundx";

  // Default dependency wiring (real browser). Overridable via FundxStore.configure(deps).
  function defaultDeps() {
    var C = (typeof window !== "undefined" && window.Capacitor) || null;
    var P = (C && C.Plugins) || null;
    return {
      localStorage: (typeof localStorage !== "undefined") ? localStorage
        : (typeof window !== "undefined" && window.localStorage) ? window.localStorage : null,
      filesystem: P && P.Filesystem ? P.Filesystem : null,
      isNative: (typeof window !== "undefined" && window.SMD_IS_NATIVE) ||
        !!(C && (typeof C.isNativePlatform === "function" ? C.isNativePlatform() : (C.platform && C.platform !== "web")))
    };
  }
  var deps = defaultDeps();

  function lget(k) { try { return deps.localStorage ? deps.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lset(k, v) { try { if (deps.localStorage) deps.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lrem(k) { try { if (deps.localStorage) deps.localStorage.removeItem(k); } catch (e) {} }
  function jparse(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
  function dataUrlToBase64(u) { u = String(u || ""); var i = u.indexOf(","); return i >= 0 ? u.slice(i + 1) : u; }

  function readIndex() { return jparse(lget(IDX_KEY), []) || []; }
  function writeIndex(arr) { return lset(IDX_KEY, JSON.stringify(arr)); }

  // Write one image (native → Filesystem; web → collected into a blob object).
  function writeNativeImage(id, kind, dataUrl) {
    var path = IMG_SUBDIR + "/" + id + "-" + kind + ".jpg";
    return deps.filesystem.writeFile({ path: path, data: dataUrlToBase64(dataUrl), directory: IMG_DIR, recursive: true })
      .then(function () {
        return deps.filesystem.getUri({ path: path, directory: IMG_DIR })
          .then(function (r) { return { path: path, uri: (r && r.uri) || null }; })
          .catch(function () { return { path: path, uri: null }; });
      });
  }

  var FundxStore = {
    configure: function (d) { deps = Object.assign(defaultDeps(), d || {}); return FundxStore; },

    // record: full ScanRecord with images as dataURLs. Returns Promise<storedMeta>.
    saveScan: function (record) {
      record = record || {};
      var V = (typeof window !== "undefined" && window.SMD_FUNDX_VISION) ||
        (typeof SMD_FUNDX_VISION !== "undefined" ? SMD_FUNDX_VISION : null);
      if (V && V.validate) {
        var chk = V.validate.scanRecord(record);
        if (!chk.ok) return Promise.reject(new Error("Invalid ScanRecord: " + chk.errors.join(", ")));
      }
      var id = record.id;
      // meta = record minus the heavy image dataURLs; thumbnail stays inline (small, for lists).
      var meta = {}; for (var k in record) { if (record.hasOwnProperty(k) && k !== "originalImage" && k !== "processedImage") meta[k] = record[k]; }
      meta.images = {};
      var native = deps.isNative && deps.filesystem;
      var work;
      if (native) {
        work = writeNativeImage(id, "orig", record.originalImage)
          .then(function (o) { meta.images.original = o; })
          .then(function () { return record.processedImage ? writeNativeImage(id, "proc", record.processedImage).then(function (p) { meta.images.processed = p; }) : null; });
      } else {
        // web: keep dataURLs in a per-id blob key (best-effort; drop originals if over quota).
        var blob = { original: record.originalImage || null, processed: record.processedImage || null };
        var okBlob = lset(IMG_KEY(id), JSON.stringify(blob));
        if (!okBlob) { lset(IMG_KEY(id), JSON.stringify({ original: null, processed: null, dropped: true })); }
        meta.images = { web: true, stored: okBlob };
        work = Promise.resolve();
      }
      return work.then(function () {
        var idx = readIndex();
        var existing = idx.findIndex(function (m) { return m.id === id; });
        if (existing >= 0) idx[existing] = meta; else idx.unshift(meta);
        writeIndex(idx);
        return meta;
      });
    },

    listScans: function (patientRef) {
      var idx = readIndex();
      if (patientRef == null) return Promise.resolve(idx);
      return Promise.resolve(idx.filter(function (m) {
        return m.patientContext && (m.patientContext.ref === patientRef || m.patientContext.patientRef === patientRef);
      }));
    },

    getScan: function (id) {
      var idx = readIndex();
      return Promise.resolve(idx.filter(function (m) { return m.id === id; })[0] || null);
    },

    // Returns a displayable image source (native file URI or web dataURL) or null.
    imageUri: function (id, kind) {
      kind = kind === "processed" ? "processed" : "original";
      return FundxStore.getScan(id).then(function (m) {
        if (!m) return null;
        if (m.images && m.images.web) { var b = jparse(lget(IMG_KEY(id)), null); return b ? (kind === "processed" ? b.processed : b.original) : (m.thumbnail || null); }
        var ref = m.images && m.images[kind]; return ref ? (ref.uri || null) : null;
      });
    },

    deleteScan: function (id) {
      var idx = readIndex().filter(function (m) { return m.id !== id; });
      writeIndex(idx); lrem(IMG_KEY(id));
      if (deps.isNative && deps.filesystem) {
        ["orig", "proc"].forEach(function (kind) {
          try { deps.filesystem.deleteFile({ path: IMG_SUBDIR + "/" + id + "-" + kind + ".jpg", directory: IMG_DIR }).catch(function () {}); } catch (e) {}
        });
      }
      return Promise.resolve(true);
    },

    // Beginner training + operator statistics (small JSON blobs).
    learning: {
      get: function () { return jparse(lget(LEARN_KEY), { levels: {}, updatedAt: null }); },
      set: function (obj) { lset(LEARN_KEY, JSON.stringify(obj || {})); return obj; },
      completeLevel: function (level, now) {
        var l = FundxStore.learning.get(); l.levels = l.levels || {};
        l.levels[level] = { done: true, at: now != null ? now : (typeof Date !== "undefined" ? Date.now() : 0) };
        l.updatedAt = now != null ? now : (typeof Date !== "undefined" ? Date.now() : 0);
        FundxStore.learning.set(l); return l;
      }
    },
    operator: {
      get: function () { return jparse(lget(OP_KEY), { scans: 0, captures: 0, retries: 0, totalQuality: 0, updatedAt: null }); },
      record: function (stats, now) {
        var o = FundxStore.operator.get(); stats = stats || {};
        o.scans += 1;
        o.captures += num(stats.captures, 0);
        o.retries += num(stats.retries, 0);
        o.totalQuality += num(stats.quality, 0);
        o.avgQuality = o.scans ? Math.round(o.totalQuality / o.scans) : 0;
        o.updatedAt = now != null ? now : (typeof Date !== "undefined" ? Date.now() : 0);
        lset(OP_KEY, JSON.stringify(o)); return o;
      }
    }
  };
  function num(n, d) { n = +n; return n !== n ? (d || 0) : n; }

  if (typeof module !== "undefined" && module.exports) module.exports = FundxStore;
  if (typeof window !== "undefined") window.SMD_FUNDX_STORE = FundxStore;
})();
