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

  /* ---- UHID extraction + empty-tag routing (walk-in write / follow-up tap) ----
   * A StewardMD file tag carries the patient UHID as plain text, as NDEF text/url
   * records, or as a stewardmd.in/opd deep link (?uid= / ?patientId= / ?scan= /
   * ?mrn=). parseTagUhid() accepts any of those shapes: a raw string, a tag
   * object ({ text, url, uid }) as startScan() delivers it, a Web NFC reading
   * event ({ message: { records } }), or a bare NDEF record list. Returns "" when
   * no UHID is present. NOTE: a bare chip serial is NOT a UHID - both bridges echo
   * the serial into `text` when no NDEF payload was read, and isEmptyTag() exists
   * to tell that echo apart from a real payload. */

  function uhidFromUrlParams(s) {
    var m = /[?&](uid|patientid|scan|mrn)=([^&#]*)/i.exec(s || "");
    if (!m) return "";
    try {
      return decodeURIComponent(m[2]).trim();
    } catch (e) {
      return String(m[2] || "").trim();
    }
  }

  function uhidFromString(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return "";
    var q = uhidFromUrlParams(s);
    if (q) return q;
    if (s.indexOf("://") !== -1) return ""; // a URL with no patient param: never answer "https"
    var m = /[A-Za-z0-9][A-Za-z0-9\-_]{2,63}/.exec(s);
    return m ? m[0] : "";
  }

  function uhidFromRecords(recs) {
    if (!recs || !recs.length) return "";
    for (var i = 0; i < recs.length; i++) {
      var u = uhidFromString(nfcScanText(recs[i]));
      if (!u && recs[i] && typeof recs[i].data === "string") u = uhidFromUrlParams(recs[i].data);
      if (u) return u;
    }
    return "";
  }

  function parseTagUhid(data) {
    if (data == null) return "";
    if (typeof data === "string") return uhidFromString(data);
    if (typeof Array === "function" && Array.isArray && Array.isArray(data)) return uhidFromRecords(data);
    if (typeof data !== "object") return "";
    var recs = (data.message && data.message.records) || data.records || null;
    var u = uhidFromRecords(recs);
    if (u) return u;
    u = uhidFromString(data.url || "");
    if (u) return u;
    u = uhidFromString(data.text || "");
    if (u) return u;
    var raw = data.raw;
    if (typeof raw === "string") return uhidFromString(raw);
    if (raw && typeof raw === "object" && raw !== data) return parseTagUhid(raw);
    return "";
  }

  /* True when the tag carries no NDEF payload: no URL, no text, no readable
   * records, or text that is just the chip-serial echo both bridges produce.
   * Native sends uid (plain hex) AND formattedUid (colon-separated) and echoes
   * uid, so the echo is matched against EVERY serial variant, punctuation- and
   * case-insensitive - comparing against one spelling misroutes blank tags. */
  function normSerial(s) {
    return String(s || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }

  function isEmptyTag(tag) {
    if (!tag) return true;
    if (typeof tag === "string") return !uhidFromString(tag);
    if (typeof tag !== "object") return true;
    var raw = (tag.raw && typeof tag.raw === "object") ? tag.raw : {};
    if (String(tag.url || raw.url || "").trim()) return false;
    var recs = (tag.message && tag.message.records) || tag.records ||
      (raw.message && raw.message.records) || raw.records || null;
    if (recs && recs.length) {
      for (var i = 0; i < recs.length; i++) {
        if (nfcScanText(recs[i])) return false;
      }
    }
    var text = String(tag.text || raw.text || "").trim();
    if (!text) return true;
    var t = normSerial(text);
    var serials = [tag.formattedUid, tag.uid, raw.uid, raw.formattedUid, raw.serialNumber, tag.serialNumber];
    for (var i = 0; i < serials.length; i++) {
      var c = normSerial(serials[i]);
      if (c && t === c) return true;
    }
    return false;
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function resolveOpt(v) {
    if (typeof v === "function") {
      try { return v(); } catch (e) { return null; }
    }
    return v;
  }

  /* Empty-tag assignment sheet. opts: { currentPatient ({name,uhid}|fn)|null,
   * patients ([{name,uhid}]|fn), onWrite(uhid, ok), writeUrl(uhid)->url }.
   * Returns the overlay element, or null without a DOM. Safe to call twice: any
   * previous prompt is replaced. Writing always needs a physical tap (the OS arms
   * the radio), so a mis-tap on a quick-pick writes nothing by itself. */
  function showEmptyTagPrompt(tag, opts) {
    if (typeof document === "undefined" || !document.createElement) return null;
    opts = opts || {};
    try {
      var prev = document.getElementById("smdNfcEmpty");
      if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    } catch (e) {}
    var serial = (tag && (tag.formattedUid || tag.uid)) || "";
    var cur = resolveOpt(opts.currentPatient) || null;
    var list = resolveOpt(opts.patients) || [];
    if (!list || typeof list.length !== "number") list = [];
    var writeUrl = typeof opts.writeUrl === "function" ? opts.writeUrl : function (u) {
      return "https://stewardmd.in/opd?uid=" + encodeURIComponent(u);
    };

    var ov = document.createElement("div");
    ov.id = "smdNfcEmpty";
    ov.setAttribute("style", "position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(15,23,42,.55);padding:0 0 env(safe-area-inset-bottom,0px);");
    var card = "background:#fff;color:#0f172a;border-radius:18px 18px 0 0;width:100%;max-width:520px;max-height:86vh;overflow:auto;padding:20px 18px;font:400 15px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;box-shadow:0 -8px 32px rgba(15,23,42,.25);";
    var h = '<div role="dialog" aria-modal="true" aria-label="Empty NFC tag" style="' + card + '">' +
      '<div style="font:800 17px/1.3 inherit;margin:0 0 2px;">NFC Tag Detected (Empty / Blank)</div>' +
      '<div style="font:600 12.5px inherit;color:#64748b;margin:0 0 10px;">Tag Serial: ' + escHtml(serial || "-") + "</div>" +
      "<p style=\"margin:0 0 14px;\">This physical file tag is empty. Would you like to write a patient UHID to it?</p>";
    if (cur && cur.uhid) {
      h += '<button type="button" data-nfc-pick="' + escHtml(cur.uhid) + '" style="display:block;width:100%;text-align:left;border:1.5px solid #0f766e;background:#e3f1ee;color:#0f766e;border-radius:12px;padding:13px 14px;font:700 15px inherit;cursor:pointer;margin:0 0 8px;">Write Current Patient (' +
        escHtml(cur.name || "Patient") + " &middot; " + escHtml(cur.uhid) + ")</button>";
    }
    var picks = [];
    for (var i = 0; i < list.length && picks.length < 8; i++) {
      var p = list[i] || {};
      var pu = p.uhid || p.mrn || p.id || "";
      if (!pu) continue;
      picks.push('<button type="button" data-nfc-pick="' + escHtml(pu) + '" style="display:block;width:100%;text-align:left;border:1px solid #e2e8f0;background:#f8fafc;color:#0f172a;border-radius:12px;padding:11px 14px;font:600 14px inherit;cursor:pointer;margin:0 0 6px;">' +
        escHtml(p.name || "Patient") + " &middot; " + escHtml(pu) + "</button>");
    }
    if (picks.length) {
      h += '<div style="font:700 12px inherit;color:#64748b;margin:10px 0 6px;">TODAY\'S PATIENTS</div>' + picks.join("");
    }
    h += '<div style="font:700 12px inherit;color:#64748b;margin:10px 0 6px;">ENTER UHID / MRN</div>' +
      '<input id="smdNfcUhid" type="text" placeholder="e.g. SMD-AB12CD-0007" autocomplete="off" autocapitalize="characters" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:12px;padding:13px 14px;font:600 16px ui-monospace,monospace;letter-spacing:.02em;margin:0 0 10px;">' +
      '<button type="button" id="smdNfcWrite" style="display:block;width:100%;border:none;background:#0f766e;color:#fff;border-radius:12px;padding:14px;font:800 15px inherit;cursor:pointer;min-height:48px;">Write to Tag</button>' +
      '<div id="smdNfcStatus" role="status" aria-live="polite" style="min-height:22px;font:600 13.5px inherit;color:#0f766e;text-align:center;margin:8px 0 2px;"></div>' +
      '<button type="button" id="smdNfcCancel" style="display:block;width:100%;border:none;background:none;color:#64748b;border-radius:12px;padding:12px;font:700 14px inherit;cursor:pointer;">Cancel</button>' +
      "</div>";
    ov.innerHTML = h;

    var input = null, writeBtn = null, status = null, cancelBtn = null;
    try {
      input = ov.querySelector("#smdNfcUhid");
      writeBtn = ov.querySelector("#smdNfcWrite");
      status = ov.querySelector("#smdNfcStatus");
      cancelBtn = ov.querySelector("#smdNfcCancel");
    } catch (e) {}
    function say(m, bad) {
      if (status) { status.textContent = m; status.style.color = bad ? "#b91c1c" : "#0f766e"; }
    }
    function close() { try { if (ov.parentNode) ov.parentNode.removeChild(ov); } catch (e) {} }
    function doWrite(uhid) {
      uhid = String(uhid == null ? "" : uhid).trim();
      if (!uhid) { say("Enter a UHID first.", true); return; }
      if (writeBtn) { writeBtn.disabled = true; writeBtn.textContent = "Hold tag against phone..."; }
      say("Hold the tag against the phone...");
      SMD_NFC.writeTag({ text: uhid, url: writeUrl(uhid) }).then(function () {
        say("\u2713 NFC Tag Written!");
        if (writeBtn) { writeBtn.disabled = false; writeBtn.textContent = "Write to Tag"; }
        if (cancelBtn) cancelBtn.textContent = "Done";
        if (typeof opts.onWrite === "function") { try { opts.onWrite(uhid, true); } catch (e) {} }
      }, function (e) {
        say("Could not write the tag" + (e && e.message ? ": " + e.message : "") + ". Try again.", true);
        if (writeBtn) { writeBtn.disabled = false; writeBtn.textContent = "Write to Tag"; }
        if (typeof opts.onWrite === "function") { try { opts.onWrite(uhid, false); } catch (e) {} }
      });
    }
    if (cancelBtn) cancelBtn.onclick = close;
    ov.onclick = function (ev) { if (ev && ev.target === ov) close(); };
    if (writeBtn) writeBtn.onclick = function () { doWrite(input ? input.value : ""); };
    try {
      var nodes = ov.querySelectorAll("[data-nfc-pick]");
      for (var k = 0; k < nodes.length; k++) {
        (function (b) {
          b.onclick = function () {
            var u = b.getAttribute("data-nfc-pick") || "";
            if (input) input.value = u;
            doWrite(u);
          };
        })(nodes[k]);
      }
    } catch (e) {}
    try {
      (document.body || document.documentElement).appendChild(ov);
    } catch (e) { return null; }
    return ov;
  }

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
    parseRecordText: nfcScanText,

    /**
     * Extracts the Steward UHID from a tag payload: plain text, NDEF records,
     * a stewardmd.in/opd deep link (?uid=/?patientId=/?scan=/?mrn=), a tag
     * object as startScan() delivers it, or a Web NFC reading event.
     * Returns "" when no UHID is present.
     */
    parseTagUhid: parseTagUhid,

    /**
     * True when the tag carries no NDEF payload (blank tag, or text that is
     * just the chip-serial echo both bridges produce when nothing was read).
     */
    isEmptyTag: isEmptyTag,

    /**
     * Empty-tag assignment sheet: offers writing the current patient, a
     * quick-pick from today's patients, or a typed UHID/MRN to the blank tag.
     * @param {Object} tag the scanned tag ({ uid, formattedUid })
     * @param {Object} [opts] { currentPatient, patients, onWrite, writeUrl }
     * @returns the overlay element, or null without a DOM.
     */
    showEmptyTagPrompt: showEmptyTagPrompt,

    /**
     * App-level listener: starts startScan and routes every tap. Tags carrying
     * a UHID go to options.onUhid(uhid, tag); blank tags open the assignment
     * sheet (or options.onEmpty(tag) when given).
     * @param {Object} [options] { onUhid, onEmpty, currentPatient, patients, onWrite }
     */
    initAppListener: function (options) {
      options = options || {};
      var onUhid = options.onUhid;
      var onEmpty = options.onEmpty;
      return SMD_NFC.startScan(function (tag) {
        var uhid = "";
        try { uhid = parseTagUhid(tag); } catch (e) { uhid = ""; }
        var empty = !uhid;
        try { if (!empty && isEmptyTag(tag)) empty = true; } catch (e) {}
        if (empty) {
          if (typeof onEmpty === "function") { try { onEmpty(tag); } catch (e) {} return; }
          try { showEmptyTagPrompt(tag, options); } catch (e) {}
          return;
        }
        if (typeof onUhid === "function") { try { onUhid(uhid, tag); } catch (e) {} }
      });
    }
  };

  return SMD_NFC;
});
