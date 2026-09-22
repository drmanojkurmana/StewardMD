/* smd-nfc.js — Unified NFC bridge for StewardMD (Native Capacitor App + Web NFC).
 *
 * Provides a unified API across:
 *   1. Native Capacitor Android (in.stewardmd.app.NfcPlugin)
 *   2. Web NFC in Chrome on Android (window.NDEFReader)
 *   3. Graceful degradation when NFC is unavailable (with clear error descriptions).
 *
 * Universal export: works directly via <script src="/smd-nfc.js"> (exposes window.SMD_NFC)
 * and via CommonJS / ES Module imports for test suites.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SMD_NFC = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function getCapacitorPlugin() {
    try {
      if (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NfcPlugin) {
        return window.Capacitor.Plugins.NfcPlugin;
      }
    } catch (e) {}
    return null;
  }

  function hasWebNfc() {
    try {
      return typeof window !== "undefined" && "NDEFReader" in window;
    } catch (e) {
      return false;
    }
  }

  function getNdefReaderClass() {
    try {
      if (typeof window !== "undefined" && window.NDEFReader) return window.NDEFReader;
      if (typeof globalThis !== "undefined" && globalThis.NDEFReader) return globalThis.NDEFReader;
    } catch (e) {}
    return null;
  }

  function nfcScanText(rec) {
    if (!rec) return "";
    try {
      var d = rec.data;
      if (typeof d === "string") return d.trim();
      var bytes = null;
      if (typeof DataView !== "undefined" && d instanceof DataView) {
        bytes = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      } else if (typeof ArrayBuffer !== "undefined" && d instanceof ArrayBuffer) {
        bytes = new Uint8Array(d);
      }
      if (!bytes || !bytes.length) return "";
      var off = 0;
      if (rec.recordType === "text" || rec.recordType === "urn:nfc:wkt:T") {
        off = 1 + (bytes[0] & 63);
      }
      var s = "";
      try {
        s = new TextDecoder().decode(bytes.subarray(off));
      } catch (e) {
        s = String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(off)));
      }
      var m = /[A-Za-z0-9][A-Za-z0-9\-_]{2,63}/.exec(s || "");
      return m ? m[0] : (s || "").trim();
    } catch (e) {
      return "";
    }
  }

  var activeListenerHandle = null;
  var webNfcAbortController = null;
  var isListening = false;

  var SMD_NFC = {
    /**
     * Synchronous capability check: returns true if either native Capacitor NfcPlugin
     * or standard Web NFC NDEFReader is present in this environment.
     */
    isSupportedSync: function () {
      return !!getCapacitorPlugin() || hasWebNfc();
    },

    /**
     * Asynchronous status check: queries native hardware/enabled state or web support.
     * @returns {Promise<{ supported: boolean, native: boolean, web: boolean, enabled?: boolean }>}
     */
    isSupported: async function () {
      var cap = getCapacitorPlugin();
      if (cap && cap.isAvailable) {
        try {
          var res = await cap.isAvailable();
          return {
            supported: !!(res && res.available),
            native: true,
            web: false,
            enabled: !!(res && res.enabled)
          };
        } catch (e) {
          return { supported: false, native: true, web: false, error: e.message };
        }
      }
      if (hasWebNfc()) {
        return { supported: true, native: false, web: true, enabled: true };
      }
      return { supported: false, native: false, web: false };
    },

    /**
     * Launches system NFC settings (Android Native only).
     */
    openSettings: async function () {
      var cap = getCapacitorPlugin();
      if (cap && cap.openSettings) {
        return cap.openSettings();
      }
      return Promise.reject(new Error("openSettings is only available in the native app."));
    },

    /**
     * Start background listening for NFC tag taps.
     * @param {Function} onTagDiscovered Callback receiving ({ uid, text, url, raw })
     * @returns {Promise<{ listening: boolean, mode: "native"|"web" }>}
     */
    startScan: async function (onTagDiscovered) {
      if (isListening) {
        return { listening: true, mode: getCapacitorPlugin() ? "native" : "web" };
      }

      var cap = getCapacitorPlugin();
      if (cap && cap.startScan) {
        try {
          if (cap.addListener) {
            if (activeListenerHandle && activeListenerHandle.remove) {
              activeListenerHandle.remove();
            }
            activeListenerHandle = await cap.addListener("tagDiscovered", function (data) {
              var text = (data && (data.text || data.uid)) || "";
              if (typeof onTagDiscovered === "function") {
                onTagDiscovered({
                  uid: data.uid || "",
                  formattedUid: data.formattedUid || "",
                  text: text,
                  url: data.url || "",
                  raw: data
                });
              }
            });
          }
          await cap.startScan();
          isListening = true;
          return { listening: true, mode: "native" };
        } catch (e) {
          throw new Error("Native NFC scan failed: " + (e.message || e));
        }
      }

      if (hasWebNfc()) {
        try {
          var NdefCls = getNdefReaderClass();
          var reader = new NdefCls();
          webNfcAbortController = (typeof AbortController !== "undefined") ? new AbortController() : null;
          var opts = webNfcAbortController ? { signal: webNfcAbortController.signal } : undefined;

          var scanPromise = opts ? reader.scan(opts) : reader.scan();
          if (scanPromise && scanPromise.then) {
            await scanPromise;
          }

          reader.onreading = function (ev) {
            try {
              var recs = (ev && ev.message && ev.message.records) || [];
              var extractedText = "";
              var extractedUrl = "";
              for (var i = 0; i < recs.length; i++) {
                var rec = recs[i];
                var txt = nfcScanText(rec);
                if (txt && !extractedText) extractedText = txt;
                if (rec && rec.recordType === "url" && typeof rec.data === "string") {
                  extractedUrl = rec.data;
                }
              }
              var serialNumber = (ev && ev.serialNumber) || "";
              if (typeof onTagDiscovered === "function") {
                onTagDiscovered({
                  uid: serialNumber,
                  formattedUid: serialNumber,
                  text: extractedText || serialNumber,
                  url: extractedUrl,
                  raw: ev
                });
              }
            } catch (err) {}
          };

          isListening = true;
          return { listening: true, mode: "web" };
        } catch (e) {
          throw new Error("Web NFC scan failed: " + (e.message || e));
        }
      }

      throw new Error("NFC is not supported on this device or browser.");
    },

    /**
     * Stops listening for NFC scans.
     */
    stopScan: async function () {
      var cap = getCapacitorPlugin();
      if (cap && cap.stopScan) {
        try { await cap.stopScan(); } catch (e) {}
      }
      if (activeListenerHandle && activeListenerHandle.remove) {
        try { activeListenerHandle.remove(); } catch (e) {}
        activeListenerHandle = null;
      }
      if (webNfcAbortController && webNfcAbortController.abort) {
        try { webNfcAbortController.abort(); } catch (e) {}
        webNfcAbortController = null;
      }
      isListening = false;
      return { listening: false };
    },

    /**
     * Arms the device to write text (UID/MRN) and optional URL on the next tapped NFC tag.
     * @param {string|{ text: string, url?: string, uid?: string }} payload
     * @returns {Promise<{ success: boolean, uid?: string, text?: string, url?: string }>}
     */
    writeTag: async function (payload) {
      var text = "";
      var url = "";

      if (typeof payload === "string") {
        text = payload.trim();
      } else if (payload && typeof payload === "object") {
        text = String(payload.text || payload.uid || "").trim();
        url = String(payload.url || "").trim();
      }

      if (!text && !url) {
        return Promise.reject(new Error("Nothing to write: text or URL is required."));
      }

      var cap = getCapacitorPlugin();
      if (cap && cap.writeTag) {
        return cap.writeTag({ text: text, url: url });
      }

      if (hasWebNfc()) {
        var NdefCls = getNdefReaderClass();
        var writer = new NdefCls();
        var records = [];
        if (text) {
          records.push({ recordType: "text", data: text });
        }
        if (url) {
          records.push({ recordType: "url", data: url });
        }
        await writer.write(records.length === 1 && text ? text : { records: records });
        return { success: true, text: text, url: url };
      }

      return Promise.reject(new Error("NFC writing is not available on this device or browser."));
    },

    /**
     * Utility parser for NDEF records.
     */
    parseRecordText: nfcScanText
  };

  return SMD_NFC;
});
