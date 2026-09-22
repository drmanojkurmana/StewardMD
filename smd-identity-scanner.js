/* smd-identity-scanner.js — Reusable Universal Patient Identity scanner (Ni-Key / Scanner).
 *
 * One mountable component for every station (doctor, nurse, billing, pharmacy, ward,
 * frontdesk): Tap Ni-Key (NFC), Scan QR/Barcode (camera or wedge listener), and manual
 * StewardID/MRN/phone fallback, all resolving through StewardIdentityResolver and ending
 * in a station-specific action sheet. Degrades gracefully without a DOM (Node/headless):
 * create() still returns a usable instance whose resolve* methods work headlessly.
 *
 * Universal export: works directly via <script src="/smd-identity-scanner.js">
 * (exposes window.PatientIdentityScanner) and via CommonJS / ES Module imports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    var mod = factory();
    module.exports = mod;
    try { root.PatientIdentityScanner = mod; } catch (e) {}
  } else {
    root.PatientIdentityScanner = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STATIONS = ["doctor", "nurse", "billing", "pharmacy", "ward", "frontdesk"];

  /* Station-specific action buttons rendered on the resolved-patient action sheet. */
  var STATION_ACTIONS = {
    doctor: [
      { id: "view-profile", label: "View Profile" },
      { id: "start-consultation", label: "Start Consultation" },
      { id: "start-followup", label: "Start Follow-up" },
    ],
    nurse: [
      { id: "record-vitals", label: "Record Vitals" },
      { id: "triage", label: "Triage" },
    ],
    billing: [
      { id: "review-bill", label: "Review & Bill" },
    ],
    pharmacy: [
      { id: "dispense-order", label: "Dispense Order" },
    ],
    ward: [
      { id: "bedside-verify", label: "Bedside 5-Rights Verify" },
    ],
    frontdesk: [
      { id: "add-to-queue", label: "Add to Queue" },
      { id: "check-in", label: "Check-in" },
    ],
  };

  function getResolver() {
    try {
      if (typeof module === "object" && module.exports && typeof require === "function") {
        try {
          var r = require("./steward-identity-resolver.js");
          if (r && r.resolvePatientIdentity) return r;
        } catch (e) {}
      }
    } catch (e) {}
    try {
      if (typeof globalThis !== "undefined" && globalThis.StewardIdentityResolver &&
        globalThis.StewardIdentityResolver.resolvePatientIdentity) {
        return globalThis.StewardIdentityResolver;
      }
    } catch (e) {}
    return null;
  }

  function getNfc() {
    try {
      if (typeof globalThis !== "undefined") {
        var n = globalThis.SMD_NFC || globalThis.NiKey || globalThis.NI_KEY;
        if (n) return n;
      }
    } catch (e) {}
    return null;
  }

  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function hasDom() {
    return typeof document !== "undefined" && !!document.createElement;
  }

  function resolveContainer(container) {
    if (!hasDom()) return null;
    if (!container) return null;
    try {
      if (typeof container === "string") return document.querySelector(container);
      if (container.nodeType === 1) return container;
    } catch (e) {}
    return null;
  }

  function normStation(station) {
    var s = String(station == null ? "" : station).trim().toLowerCase();
    return STATIONS.indexOf(s) !== -1 ? s : "doctor";
  }

  function PatientIdentityScanner(options) {
    if (!(this instanceof PatientIdentityScanner)) {
      return new PatientIdentityScanner(options);
    }
    options = options || {};
    this.station = normStation(options.station);
    this.showActionSheet = options.showActionSheet !== false;
    this.onResolved = typeof options.onResolved === "function" ? options.onResolved : null;
    this.onError = typeof options.onError === "function" ? options.onError : null;
    this.onCancel = typeof options.onCancel === "function" ? options.onCancel : null;
    this.onAction = typeof options.onAction === "function" ? options.onAction : null;
    this.resolverOptions = options.resolverOptions && typeof options.resolverOptions === "object" ? options.resolverOptions : {};
    this.container = resolveContainer(options.container);
    this.rootEl = null;
    this.statusEl = null;
    this.sheetEl = null;
    this.tapBtn = null;
    this.scanBtn = null;
    this.manualInput = null;
    this.findBtn = null;
    this._listening = false;
    this._lastResolved = null;
    if (this.container) this.mount(this.container);
  }

  PatientIdentityScanner.STATIONS = STATIONS.slice();
  PatientIdentityScanner.STATION_ACTIONS = STATION_ACTIONS;

  PatientIdentityScanner.create = function (options) {
    return new PatientIdentityScanner(options);
  };

  PatientIdentityScanner.prototype.isMounted = function () {
    return !!(this.rootEl && this.rootEl.parentNode);
  };

  PatientIdentityScanner.prototype.mount = function (container) {
    var el = resolveContainer(container) || this.container;
    if (!el || !hasDom()) return null;
    this.container = el;
    this.unmount(true);
    var root = document.createElement("div");
    root.className = "smd-identity-scanner";
    root.setAttribute("data-station", this.station);
    root.innerHTML =
      '<div class="smdis-head">' +
        '<div class="smdis-title">Universal Patient Identity &middot; Ni-Key / Scanner</div>' +
        '<div class="smdis-station">' + escHtml(this.station) + ' station</div>' +
        '<button type="button" class="smdis-close" aria-label="Close scanner">Close</button>' +
      "</div>" +
      '<div class="smdis-scanbar">' +
        '<button type="button" class="smdis-tap">Tap Ni-Key</button>' +
        '<button type="button" class="smdis-scan">Scan QR / Barcode</button>' +
      "</div>" +
      '<div class="smdis-manual">' +
        '<input type="text" class="smdis-input" placeholder="Enter StewardID, MRN, or Phone" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
        '<button type="button" class="smdis-find">Find Patient</button>' +
      "</div>" +
      '<div class="smdis-status" role="status" aria-live="polite"></div>' +
      '<div class="smdis-sheet" hidden></div>';
    var self = this;
    try {
      this.tapBtn = root.querySelector(".smdis-tap");
      this.scanBtn = root.querySelector(".smdis-scan");
      this.manualInput = root.querySelector(".smdis-input");
      this.findBtn = root.querySelector(".smdis-find");
      this.statusEl = root.querySelector(".smdis-status");
      this.sheetEl = root.querySelector(".smdis-sheet");
      var closeBtn = root.querySelector(".smdis-close");
      if (this.tapBtn) this.tapBtn.onclick = function () { self.startTapScan(); };
      if (this.scanBtn) this.scanBtn.onclick = function () { self.startBarcodeScan(); };
      if (this.findBtn) this.findBtn.onclick = function () { self.resolveManual(self.manualInput ? self.manualInput.value : ""); };
      if (this.manualInput) {
        this.manualInput.onkeydown = function (ev) {
          if (ev && ev.key === "Enter") self.resolveManual(self.manualInput.value);
        };
      }
      if (closeBtn) closeBtn.onclick = function () { self.cancel(); };
    } catch (e) {}
    try {
      el.appendChild(root);
    } catch (e) {
      return null;
    }
    this.rootEl = root;
    this.setStatus("Ready. Tap Ni-Key, scan a code, or enter an ID.");
    return root;
  };

  PatientIdentityScanner.prototype.unmount = function (silent) {
    try {
      this.stopListening();
    } catch (e) {}
    if (this.rootEl && this.rootEl.parentNode) {
      try {
        this.rootEl.parentNode.removeChild(this.rootEl);
      } catch (e) {}
    }
    this.rootEl = null;
    this.statusEl = null;
    this.sheetEl = null;
    if (!silent) this.container = null;
  };

  PatientIdentityScanner.prototype.destroy = function () {
    this.unmount(false);
  };

  PatientIdentityScanner.prototype.setStatus = function (message, isError) {
    if (this.statusEl) {
      try {
        this.statusEl.textContent = String(message == null ? "" : message);
        this.statusEl.setAttribute("data-error", isError ? "true" : "false");
      } catch (e) {}
    }
    return this;
  };

  PatientIdentityScanner.prototype.cancel = function () {
    try {
      this.stopListening();
    } catch (e) {}
    if (typeof this.onCancel === "function") {
      try {
        this.onCancel();
      } catch (e) {}
    }
    return this;
  };

  /* Arms the NFC reader (Ni-Key.startScan) and resolves the first tap. */
  PatientIdentityScanner.prototype.startTapScan = function () {
    var self = this;
    var nfc = getNfc();
    this.setStatus("Hold the Ni-Key tag against the phone...");
    if (this.tapBtn) {
      try {
        this.tapBtn.setAttribute("data-scanning", "true");
      } catch (e) {}
    }
    var nfcReady = !!nfc && typeof nfc.startScan === "function";
    if (nfcReady && typeof nfc.isSupportedSync === "function") {
      try {
        nfcReady = !!nfc.isSupportedSync();
      } catch (e) {
        nfcReady = true;
      }
    }
    if (!nfcReady) {
      this.setStatus("NFC is not available here. Scan a code or enter the ID manually.", true);
      if (this.tapBtn) {
        try {
          this.tapBtn.setAttribute("data-scanning", "false");
        } catch (e) {}
      }
      return null;
    }
    this._listening = true;
    var done = false;
    function onTag(tag) {
      if (done) return;
      done = true;
      self._listening = false;
      if (self.tapBtn) {
        try {
          self.tapBtn.setAttribute("data-scanning", "false");
        } catch (e) {}
      }
      try {
        if (nfc.stopScan) nfc.stopScan();
      } catch (e) {}
      self.handleTag(tag);
    }
    var out;
    try {
      out = nfc.startScan(onTag);
    } catch (err) {
      this._listening = false;
      this.fail(err);
      return null;
    }
    if (out && typeof out.then === "function") {
      out.then(null, function (err) {
        self._listening = false;
        if (self.tapBtn) {
          try {
            self.tapBtn.setAttribute("data-scanning", "false");
          } catch (e) {}
        }
        self.fail(err);
      });
    }
    return out;
  };

  /* Camera / wedge-listener path: resolves a scanned QR/barcode payload string. */
  PatientIdentityScanner.prototype.startBarcodeScan = function () {
    this.setStatus("Point the camera at the QR / barcode, or scan with the wedge reader...");
    var self = this;
    var handled = false;
    function armWedge() {
      if (!hasDom() || typeof document.addEventListener !== "function") return false;
      var buf = "";
      var last = 0;
      function onKey(e) {
        if (!e || e.key == null) return;
        var now = Date.now();
        if (now - last > 45) buf = "";
        last = now;
        if (e.key === "Enter") {
          var v = buf;
          buf = "";
          if (v && v.length >= 3) {
            handled = true;
            try {
              document.removeEventListener("keydown", onKey);
            } catch (err) {}
            self._listening = false;
            self.handleScan(v, "qr");
          }
          return;
        }
        if (e.key.length === 1) buf += e.key;
      }
      try {
        document.addEventListener("keydown", onKey);
      } catch (e) {
        return false;
      }
      self._listening = true;
      self._wedgeOff = function () {
        try {
          document.removeEventListener("keydown", onKey);
        } catch (e) {}
      };
      return true;
    }
    try {
      var cap = null;
      try {
        cap = (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins) || null;
      } catch (e) {}
      var scanner = cap && (cap.BarcodeScanner || cap.CapacitorBarcodeScanner);
      if (scanner && typeof scanner.scanBarcode === "function") {
        this._listening = true;
        var p = scanner.scanBarcode({ hint: 17, camera: "back" });
        if (p && typeof p.then === "function") {
          p.then(function (res) {
            self._listening = false;
            var v = res && (res.ScanResult || res.scanResult || res.content || res.text || "");
            if (v) self.handleScan(String(v), "qr");
            else self.setStatus("No code detected. Try again or enter the ID manually.", true);
          }, function (err) {
            self._listening = false;
            if (!armWedge()) self.fail(err);
            else self.setStatus("Camera unavailable. Wedge reader armed: scan now, or enter the ID manually.");
          });
          return p;
        }
      }
    } catch (e) {}
    if (!armWedge()) {
      this.setStatus("Scanner armed. Enter the scanned value below, or type the ID manually.");
    }
    return null;
  };

  PatientIdentityScanner.prototype.stopListening = function () {
    this._listening = false;
    if (this._wedgeOff) {
      try {
        this._wedgeOff();
      } catch (e) {}
      this._wedgeOff = null;
    }
    if (this.tapBtn) {
      try {
        this.tapBtn.setAttribute("data-scanning", "false");
      } catch (e) {}
    }
    try {
      var nfc = getNfc();
      if (nfc && typeof nfc.stopScan === "function") nfc.stopScan();
    } catch (e) {}
    return this;
  };

  PatientIdentityScanner.prototype.isListening = function () {
    return !!this._listening;
  };

  /* Resolves an NFC tag object ({ text, url, uid }) as startScan delivers it. */
  PatientIdentityScanner.prototype.handleTag = function (tag) {
    var payload = { type: "nfc" };
    if (tag != null && typeof tag === "object") {
      if (tag.text != null) payload.text = tag.text;
      if (tag.url != null) payload.url = tag.url;
      if (tag.uid != null) payload.uid = tag.uid;
      if (tag.value != null) payload.value = tag.value;
      if (tag.code != null) payload.code = tag.code;
    } else if (tag != null) {
      payload.value = String(tag);
    }
    return this.resolveCarrier(payload);
  };

  /* Resolves a QR/barcode scan payload string. typeHint: "qr" | "barcode" | "wristband". */
  PatientIdentityScanner.prototype.handleScan = function (payload, typeHint) {
    var t = String(typeHint || "qr").toLowerCase();
    if (t !== "qr" && t !== "barcode" && t !== "wristband" && t !== "nfc") t = "qr";
    return this.resolveCarrier({ type: t, value: payload });
  };

  /* Resolves manual StewardID / MRN / phone entry. */
  PatientIdentityScanner.prototype.resolveManual = function (value) {
    return this.resolveCarrier({ type: "manual", value: value });
  };

  PatientIdentityScanner.prototype.resolveCarrier = function (carrierInput) {
    var self = this;
    var R = getResolver();
    this.setStatus("Resolving patient identity...");
    function deliver(res) {
      if (res && res.ok) {
        self._lastResolved = res;
        var nm = (res.patient && (res.patient.name || res.patient.displayName)) || res.patientId || "Patient";
        self.setStatus("Identity resolved: " + nm + " (" + (res.stewardId || res.patientId || "") + ")");
        if (self.showActionSheet) {
          try {
            self.renderActionSheet(res);
          } catch (e) {}
        }
        if (typeof self.onResolved === "function") {
          try {
            self.onResolved(res);
          } catch (e) {}
        }
      } else {
        self.fail((res && (res.reason || res.error)) || "Could not resolve this identity.", res);
      }
      return res;
    }
    if (!R) {
      // Headless / standalone: echo an unresolved-but-usable result so stations wired
      // without the resolver bundle still get the scanned value back.
      var raw = carrierInput != null && typeof carrierInput === "object"
        ? (carrierInput.value != null ? carrierInput.value : (carrierInput.text != null ? carrierInput.text : ""))
        : carrierInput;
      var fallback = {
        ok: false,
        error: "RESOLVER_UNAVAILABLE",
        reason: "StewardIdentityResolver is not loaded",
        carrier: { type: (carrierInput && carrierInput.type) || "manual", value: String(raw == null ? "" : raw), normalized: String(raw == null ? "" : raw).trim().toUpperCase() },
      };
      return deliver(fallback);
    }
    var out;
    try {
      out = R.resolvePatientIdentity(carrierInput, this.resolverOptions);
    } catch (err) {
      this.fail(err);
      return null;
    }
    if (out && typeof out.then === "function") {
      return out.then(deliver, function (err) {
        self.fail(err);
        return null;
      });
    }
    return deliver(out);
  };

  PatientIdentityScanner.prototype.lastResolved = function () {
    return this._lastResolved;
  };

  PatientIdentityScanner.prototype.fail = function (err, info) {
    var msg = (err && err.message) || (typeof err === "string" ? err : null) ||
      (info && (info.reason || info.error)) || "Could not resolve this identity.";
    this.setStatus(msg, true);
    if (typeof this.onError === "function") {
      try {
        this.onError(err instanceof Error ? err : new Error(msg), info || null);
      } catch (e) {}
    }
    return this;
  };

  /* Renders the resolved-patient action sheet with station-specific actions. */
  PatientIdentityScanner.prototype.renderActionSheet = function (resolved) {
    if (!hasDom() || !this.sheetEl) return null;
    resolved = resolved || this._lastResolved;
    if (!resolved || !resolved.ok) return null;
    var p = resolved.patient || {};
    var name = p.name || p.displayName || "Patient";
    var stewardId = resolved.stewardId || p.stewardId || "";
    var mrn = p.mrn || p.MRN || p.uhid || "";
    var age = p.age != null ? p.age : (p.ageYears != null ? p.ageYears : "");
    var gender = p.gender || p.sex || "";
    var ageGender = [age === "" ? "" : String(age), gender].filter(Boolean).join(" / ");
    var ticket = resolved.currentQueueTicket;
    var ticketLine = "";
    if (ticket) {
      var tok = (typeof ticket === "object" && (ticket.token || ticket.ticketNo || ticket.number)) || ticket;
      ticketLine = "Queue token: " + escHtml(typeof tok === "object" ? JSON.stringify(tok) : String(tok));
    }
    var adm = resolved.activeAdmission;
    var bedLine = "";
    if (adm && typeof adm === "object") {
      var bed = adm.bed || adm.bedNo || adm.bedNumber || "";
      var ward = adm.ward || adm.wardName || "";
      var where = [ward, bed].filter(Boolean).join(" / ");
      if (where) bedLine = "Ward bed: " + escHtml(where);
    }
    var actions = STATION_ACTIONS[this.station] || STATION_ACTIONS.doctor;
    var self = this;
    var h = '<div class="smdis-card" role="dialog" aria-label="Resolved patient">' +
      '<div class="smdis-name">' + escHtml(name) + "</div>" +
      '<div class="smdis-ids">' +
      (stewardId ? '<span class="smdis-smd">' + escHtml(stewardId) + "</span>" : "") +
      (mrn ? '<span class="smdis-mrn">MRN ' + escHtml(mrn) + "</span>" : "") +
      (ageGender ? '<span class="smdis-demo">' + escHtml(ageGender) + "</span>" : "") +
      "</div>" +
      (ticketLine ? '<div class="smdis-ticket">' + ticketLine + "</div>" : "") +
      (bedLine ? '<div class="smdis-bed">' + bedLine + "</div>" : "") +
      '<div class="smdis-actions">';
    for (var i = 0; i < actions.length; i++) {
      h += '<button type="button" class="smdis-action" data-action="' + escHtml(actions[i].id) + '">' +
        escHtml(actions[i].label) + "</button>";
    }
    h += "</div>" +
      '<button type="button" class="smdis-dismiss">Dismiss</button>' +
      "</div>";
    try {
      this.sheetEl.innerHTML = h;
      this.sheetEl.hidden = false;
      var nodes = this.sheetEl.querySelectorAll("[data-action]");
      for (var k = 0; k < nodes.length; k++) {
        (function (b) {
          b.onclick = function () {
            var id = b.getAttribute("data-action") || "";
            if (typeof self.onAction === "function") {
              try {
                self.onAction(id, resolved);
              } catch (e) {}
            }
          };
        })(nodes[k]);
      }
      var dismiss = this.sheetEl.querySelector(".smdis-dismiss");
      if (dismiss) {
        dismiss.onclick = function () {
          try {
            self.sheetEl.hidden = true;
          } catch (e) {}
        };
      }
    } catch (e) {
      return null;
    }
    return this.sheetEl;
  };

  PatientIdentityScanner.prototype.hideActionSheet = function () {
    if (this.sheetEl) {
      try {
        this.sheetEl.hidden = true;
      } catch (e) {}
    }
    return this;
  };

  return PatientIdentityScanner;
});
