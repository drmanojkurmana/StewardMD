/* steward-identity-resolver.js — Canonical Universal Patient Identity Resolver (StewardID 2.0 / Ni-Key).
 *
 * One resolver for every physical/logical patient carrier: NFC taps, QR scans, linear barcodes,
 * printed wristbands, and manual StewardID/MRN/phone entry. Normalises any carrier payload to a
 * canonical identifier, enforces carrier revocation, resolves the patient record plus active
 * clinical context (encounter / admission / queue ticket), caches for offline resilience, and
 * emits an audit event on every successful resolution.
 *
 * Universal export: works directly via <script src="/steward-identity-resolver.js">
 * (exposes window.StewardIdentityResolver) and via CommonJS / ES Module imports for test suites.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    var mod = factory();
    module.exports = mod;
    try { root.StewardIdentityResolver = mod; } catch (e) {}
  } else {
    root.StewardIdentityResolver = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CARRIER_TYPES = ["nfc", "qr", "barcode", "wristband", "manual"];
  var CARRIER_STATUS = { ACTIVE: "active", REVOKED: "revoked" };
  var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U
  var CACHE_PREFIX = "steward.identity.cache.";
  var EVENT_RESOLVED = "patient.identity.resolved";

  /* ---- errors ---- */

  function CarrierRevokedError(reason, carrier) {
    var e = new Error("Carrier revoked" + (reason ? ": " + reason : ""));
    e.name = "CarrierRevokedError";
    e.code = "CARRIER_REVOKED";
    e.reason = reason || "";
    e.carrier = carrier || null;
    return e;
  }
  CarrierRevokedError.prototype = Object.create(Error.prototype);
  CarrierRevokedError.prototype.constructor = CarrierRevokedError;

  /* ---- normalisation ---- */

  function deepLinkParam(s) {
    var m = /[?&](uid|patientid|scan|mrn|stewardid)=([^&#]*)/i.exec(s || "");
    if (!m) return "";
    try {
      return decodeURIComponent(m[2]).trim();
    } catch (e) {
      return String(m[2] || "").trim();
    }
  }

  function stripPrefixes(s) {
    var prev;
    do {
      prev = s;
      s = s.replace(/^(SMD|UHID|PATIENT):\s*/i, "").trim();
    } while (s !== prev);
    return s;
  }

  function finishNorm(s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return "";
    s = stripPrefixes(s);
    return s.toUpperCase();
  }

  /* Accepts a raw string (plain id, deep link, NFC payload) or a tag/scan object
   * ({ text, url, uid, value, code }). Returns the canonical upper-cased identifier,
   * or "" when nothing identifiable is present. */
  function normalizeCarrierValue(raw) {
    if (raw == null) return "";
    if (typeof raw === "object") {
      var cands = [raw.url, raw.text, raw.value, raw.code, raw.uid];
      for (var i = 0; i < cands.length; i++) {
        if (cands[i] == null || cands[i] === "") continue;
        var hit = deepLinkParam(String(cands[i]));
        if (hit) return finishNorm(hit);
      }
      var order = [raw.text, raw.value, raw.code, raw.uid, raw.url];
      for (var j = 0; j < order.length; j++) {
        if (order[j] == null || String(order[j]).trim() === "") continue;
        var s = String(order[j]).trim();
        if (s.indexOf("://") !== -1) continue; // a URL with no patient param is not an id
        return finishNorm(s);
      }
      return "";
    }
    var str = String(raw).trim();
    if (!str) return "";
    var q = deepLinkParam(str);
    if (q) return finishNorm(q);
    if (str.indexOf("://") !== -1) return "";
    return finishNorm(str);
  }

  /* SMP-XXXX-XXXXC is the StewardID, minted and reserved by the SERVER (functions/_steward_id.js), with
   * a Luhn mod-32 check character. The legacy SMD- form is still RECOGNISED so a card printed before
   * the move keeps scanning, but no new ID is ever issued in it: SMD- is the clinic-code namespace. */
  function isStewardId(v) {
    var s = String(v || "");
    return /^SMP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}$/.test(s) || /^SMD-[0-9A-Z][0-9A-Z-]*$/.test(s);
  }

  function normType(t) {
    t = String(t == null ? "" : t).trim().toLowerCase();
    return CARRIER_TYPES.indexOf(t) !== -1 ? t : "";
  }

  /* ---- mint ---- */

  var minted = {};
  function randInt(n) {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        var b = new Uint32Array(1);
        crypto.getRandomValues(b);
        return b[0] % n;
      }
    } catch (e) {}
    return Math.floor(Math.random() * n);
  }

  /* NOT HOW A PATIENT GETS A STEWARDID. Registration IDs are minted and reserved by the server
   * (functions/_steward_id.js), because an ID minted here was unique only within this tab and was never
   * stored. This produces the same SMP-XXXX-XXXXC shape, check character included, for tests and
   * previews only; nothing that registers a patient calls it. */
  function luhn32(body) {
    var factor = 2, sum = 0;
    for (var i = body.length - 1; i >= 0; i--) {
      var addend = factor * CROCKFORD.indexOf(body.charAt(i));
      factor = factor === 2 ? 1 : 2;
      sum += Math.floor(addend / 32) + (addend % 32);
    }
    return CROCKFORD.charAt((32 - (sum % 32)) % 32);
  }
  function mintStewardId() {
    for (var tries = 0; tries < 64; tries++) {
      var b = "";
      for (var i = 0; i < 8; i++) b += CROCKFORD.charAt(randInt(CROCKFORD.length));
      var s = "SMP-" + b.slice(0, 4) + "-" + b.slice(4) + luhn32(b);
      if (!minted[s]) { minted[s] = true; return s; }
    }
    throw new Error("could not mint a preview StewardID");
  }

  /* ---- carrier registry + revocation ---- */

  var carriers = [];

  function findCarrier(type, normalized, anyType) {
    for (var i = carriers.length - 1; i >= 0; i--) {
      var c = carriers[i];
      if (c.value !== normalized) continue;
      if (!anyType && c.type !== type) continue;
      if (anyType && type && c.type === type) return c; // exact match wins on the way back
    }
    if (anyType) {
      for (var j = carriers.length - 1; j >= 0; j--) {
        if (carriers[j].value === normalized) return carriers[j];
      }
      return null;
    }
    for (var k = carriers.length - 1; k >= 0; k--) {
      if (carriers[k].type === type && carriers[k].value === normalized) return carriers[k];
    }
    return null;
  }

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (e) {
      return String(Date.now());
    }
  }

  function registerCarrier(input) {
    input = input || {};
    var type = normType(input.type);
    if (!type) {
      var te = new Error("carrier type must be one of " + CARRIER_TYPES.join(", "));
      te.code = "BAD_CARRIER_TYPE";
      throw te;
    }
    var normalized = normalizeCarrierValue(
      input.value != null ? input.value : { text: input.text, url: input.url, uid: input.uid, code: input.code }
    );
    if (!normalized) {
      var ve = new Error("carrier needs a value that normalises to an identifier");
      ve.code = "NO_CARRIER_VALUE";
      throw ve;
    }
    var stewardId = input.stewardId != null ? String(input.stewardId).trim().toUpperCase() : "";
    var patientId = input.patientId != null ? String(input.patientId).trim() : "";
    if (!patientId && !stewardId) {
      var pe = new Error("carrier needs the patient it identifies (patientId and/or stewardId)");
      pe.code = "NO_PATIENT";
      throw pe;
    }
    if (!stewardId) stewardId = patientId.toUpperCase();
    if (!patientId) patientId = stewardId;

    var existing = findCarrier(type, normalized, false);
    var at = input.issuedAt || nowIso();
    if (existing) {
      // Re-issue: same physical carrier naming (possibly) a patient again. Never duplicates.
      existing.patientId = patientId;
      existing.stewardId = stewardId;
      existing.status = CARRIER_STATUS.ACTIVE;
      existing.issuedBy = input.issuedBy != null ? input.issuedBy : existing.issuedBy;
      existing.issuedAt = at;
      existing.revokedReason = null;
      existing.revokedBy = null;
      existing.revokedAt = null;
      return existing;
    }
    var rec = {
      patientId: patientId,
      stewardId: stewardId,
      type: type,
      value: normalized,
      status: CARRIER_STATUS.ACTIVE,
      issuedBy: input.issuedBy != null ? input.issuedBy : null,
      issuedAt: at,
      revokedReason: null,
      revokedBy: null,
      revokedAt: null,
    };
    carriers.push(rec);
    return rec;
  }

  function revokeCarrier(input) {
    input = input || {};
    var type = normType(input.type);
    var rawVal = input.value != null ? input.value : { text: input.text, url: input.url, uid: input.uid, code: input.code };
    var normalized = normalizeCarrierValue(rawVal);
    if (!normalized) return null;
    var at = input.revokedAt || nowIso();
    var reason = input.reason != null ? String(input.reason) : (input.revokedReason != null ? String(input.revokedReason) : "");
    var by = input.revokedBy != null ? input.revokedBy : (input.by != null ? input.by : null);
    var hit = null;
    for (var i = 0; i < carriers.length; i++) {
      var c = carriers[i];
      if (c.value !== normalized) continue;
      if (type && c.type !== type) continue;
      c.status = CARRIER_STATUS.REVOKED;
      c.revokedReason = reason;
      c.revokedBy = by;
      c.revokedAt = at;
      hit = c;
    }
    return hit;
  }

  function isCarrierRevoked(input) {
    input = input || {};
    var type = normType(input.type);
    var rawVal = input.value != null ? input.value : { text: input.text, url: input.url, uid: input.uid, code: input.code };
    var normalized = normalizeCarrierValue(rawVal);
    if (!normalized) return false;
    for (var i = 0; i < carriers.length; i++) {
      var c = carriers[i];
      if (c.value !== normalized) continue;
      if (type && c.type !== type) continue;
      if (c.status === CARRIER_STATUS.REVOKED) return true;
    }
    return false;
  }

  function getCarrier(input) {
    input = input || {};
    var type = normType(input.type);
    var rawVal = input.value != null ? input.value : input;
    var normalized = normalizeCarrierValue(rawVal);
    if (!normalized) return null;
    return findCarrier(type, normalized, !type);
  }

  function getActiveCarriersForPatient(patientId) {
    var pid = String(patientId == null ? "" : patientId).trim();
    if (!pid) return [];
    var pidUp = pid.toUpperCase();
    return carriers.filter(function (c) {
      if (c.status !== CARRIER_STATUS.ACTIVE) return false;
      return c.patientId === pid || c.stewardId === pidUp ||
        String(c.patientId).toUpperCase() === pidUp || c.stewardId === pid;
    });
  }

  /* ---- offline cache (memory + localStorage) ---- */

  var memCache = {};

  function lsGet(key) {
    try {
      if (typeof localStorage === "undefined" || !localStorage.getItem) return null;
      var s = localStorage.getItem(CACHE_PREFIX + key);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, val) {
    try {
      if (typeof localStorage === "undefined" || !localStorage.setItem) return;
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(val));
    } catch (e) {}
  }

  /* NO PATIENT DATA ON THE DISK. This cache used to write the whole record - name, phone, encounter,
   * admission, queue ticket - to localStorage in plain text, keyed by the card, never cleared on sign-out:
   * on a shared reception PC that is a DPDP breach waiting for the next person to open DevTools. The full
   * record now lives in memory only (gone with the tab); the disk keeps a HINT - which StewardID is which
   * patient id - that expires after 12 hours. The server (GET /patient/resolve) is the source of truth. */
  var HINT_TTL_MS = 12 * 3600 * 1000;
  function cacheGet(key) {
    if (!key) return null;
    if (memCache[key]) return memCache[key];
    var hint = lsGet(key);
    if (!hint) return null;
    if (!hint.exp || hint.exp < Date.now() || hint.patient) { lsDel(key); return null; }   // expired, or a pre-fix full record
    return hint;
  }

  function cacheSet(key, val) {
    if (!key || !val) return;
    memCache[key] = val;
    lsSet(key, { stewardId: val.stewardId || null, patientId: val.patientId || null, exp: Date.now() + HINT_TTL_MS });
  }
  function lsDel(key) {
    try { if (typeof localStorage !== "undefined" && localStorage.removeItem) localStorage.removeItem(CACHE_PREFIX + key); } catch (e) {}
  }

  function cacheClear() {
    memCache = {};
    try {
      if (typeof localStorage !== "undefined" && localStorage.removeItem) {
        var rm = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(CACHE_PREFIX) === 0) rm.push(k);
        }
        for (var j = 0; j < rm.length; j++) localStorage.removeItem(rm[j]);
      }
    } catch (e) {}
  }

  /* ---- events ---- */

  var listeners = {};

  function on(eventName, listener) {
    var n = String(eventName || "");
    if (!n || typeof listener !== "function") return;
    if (!listeners[n]) listeners[n] = [];
    listeners[n].push(listener);
  }

  function off(eventName, listener) {
    var n = String(eventName || "");
    if (!n || !listeners[n]) return;
    if (!listener) {
      delete listeners[n];
      return;
    }
    listeners[n] = listeners[n].filter(function (fn) { return fn !== listener; });
  }

  function emit(eventName, data) {
    var n = String(eventName || "");
    var fns = (listeners[n] || []).slice();
    for (var i = 0; i < fns.length; i++) {
      try {
        fns[i](data);
      } catch (e) {}
    }
    return fns.length;
  }

  /* ---- patient store lookup ---- */

  function storeGet(store, keys) {
    if (store == null) return undefined;
    if (typeof store === "function") {
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] == null || keys[i] === "") continue;
        var hit = store(keys[i]);
        if (hit != null) return hit;
      }
      return undefined;
    }
    if (typeof store.get === "function") {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j] == null || keys[j] === "") continue;
        try {
          var v = store.get(keys[j]);
          if (v != null) return v;
        } catch (e) {}
      }
      return undefined;
    }
    if (typeof store === "object") {
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] == null || keys[k] === "") continue;
        if (Object.prototype.hasOwnProperty.call(store, keys[k]) && store[keys[k]] != null) {
          return store[keys[k]];
        }
      }
    }
    return undefined;
  }

  function isThenable(v) {
    return v != null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
  }

  function firstNonNull() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] != null) return arguments[i];
    }
    return null;
  }

  /* ---- resolve ---- */

  function parseInput(carrierInput) {
    var explicitType = "";
    var rawForNorm = carrierInput;
    var rawValue = "";
    if (carrierInput != null && typeof carrierInput === "object") {
      explicitType = normType(carrierInput.type);
      rawValue = carrierInput.value != null ? String(carrierInput.value)
        : carrierInput.text != null ? String(carrierInput.text)
        : carrierInput.url != null ? String(carrierInput.url)
        : carrierInput.uid != null ? String(carrierInput.uid)
        : carrierInput.code != null ? String(carrierInput.code) : "";
    } else {
      rawValue = carrierInput == null ? "" : String(carrierInput);
    }
    return { explicitType: explicitType, rawForNorm: rawForNorm, rawValue: rawValue };
  }

  function resolvePatientIdentity(carrierInput, options) {
    options = options || {};
    var parsed = parseInput(carrierInput);
    var normalized = normalizeCarrierValue(parsed.rawForNorm);
    var carrierType = parsed.explicitType || "manual";

    function failCarrier() {
      return { type: carrierType, value: parsed.rawValue, normalized: normalized };
    }

    if (!normalized) {
      return { ok: false, error: "NO_CARRIER_VALUE", reason: "no identifiable carrier value", carrier: failCarrier() };
    }

    // Revocation: an explicitly-typed carrier checks that specific carrier; a bare value
    // (type unknown) fails closed against ANY revoked carrier with the same value.
    var revoked = null;
    for (var i = 0; i < carriers.length; i++) {
      var c = carriers[i];
      if (c.status !== CARRIER_STATUS.REVOKED || c.value !== normalized) continue;
      if (parsed.explicitType && c.type !== parsed.explicitType) continue;
      revoked = c;
      break;
    }
    if (revoked) {
      var failed = { ok: false, error: "CARRIER_REVOKED", reason: revoked.revokedReason || "", carrier: failCarrier() };
      if (options.throwOnRevoked || options.throwErrors || options.throw) {
        throw CarrierRevokedError(revoked.revokedReason || "", failed.carrier);
      }
      return failed;
    }

    var reg = findCarrier(carrierType, normalized, false) || findCarrier(carrierType, normalized, true);

    var stewardId = reg ? reg.stewardId : (isStewardId(normalized) ? normalized : null);
    var patientId = reg ? reg.patientId : normalized;

    var storeKeys = [];
    if (stewardId) storeKeys.push(stewardId);
    if (patientId && patientId !== stewardId) storeKeys.push(patientId);
    if (normalized !== stewardId && normalized !== patientId) storeKeys.push(normalized);

    function cachedPatient() {
      for (var i = 0; i < storeKeys.length; i++) {
        var hit = cacheGet(storeKeys[i]);
        if (hit && hit.patient) return hit;
      }
      return null;
    }

    function finish(patient, fromCache, cacheEntry) {
      if (patient == null && cacheEntry && cacheEntry.patient) {
        patient = cacheEntry.patient;
        fromCache = true;
      }
      patient = patient || null;
      if (patient && !stewardId) {
        var ps = patient.stewardId != null ? patient.stewardId : (patient.stewardID != null ? patient.stewardID : null);
        if (ps) stewardId = String(ps).trim().toUpperCase();
      }
      var encounter = firstNonNull(
        options.activeEncounter,
        patient && (patient.activeEncounter != null ? patient.activeEncounter : patient.encounter)
      );
      var admission = firstNonNull(
        options.activeAdmission,
        patient && (patient.activeAdmission != null ? patient.activeAdmission : (patient.admission != null ? patient.admission : patient.ipdAdmission))
      );
      var ticket = firstNonNull(
        options.currentQueueTicket,
        patient && (patient.currentQueueTicket != null ? patient.currentQueueTicket : (patient.queueTicket != null ? patient.queueTicket : patient.ticket))
      );
      var verified = !!(reg || (patient && !fromCache) || (fromCache && cacheEntry && cacheEntry.identityStatus === "verified"));
      var result = {
        ok: true,
        stewardId: stewardId,
        patientId: patientId,
        patient: patient,
        carrier: { type: carrierType, value: parsed.rawValue, normalized: normalized },
        activeEncounter: encounter,
        activeAdmission: admission,
        currentQueueTicket: ticket,
        identityStatus: verified ? "verified" : "provisional",
        context: options.context && typeof options.context === "object" ? options.context : {},
      };
      if (patient) {
        var entry = {
          stewardId: stewardId, patientId: patientId, patient: patient,
          activeEncounter: encounter, activeAdmission: admission, currentQueueTicket: ticket,
          identityStatus: result.identityStatus, carrierType: carrierType, at: nowIso(),
        };
        for (var i = 0; i < storeKeys.length; i++) cacheSet(storeKeys[i], entry);
      }
      emit(EVENT_RESOLVED, {
        event: EVENT_RESOLVED,
        stewardId: stewardId,
        patientId: patientId,
        carrierType: carrierType,
        carrierValue: normalized,
        carrierRaw: parsed.rawValue,
        actorId: options.actorId != null ? options.actorId : (options.actor != null ? options.actor : null),
        timestamp: nowIso(),
        context: result.context,
        identityStatus: result.identityStatus,
      });
      return result;
    }

    if (options.patient && typeof options.patient === "object") {
      return finish(options.patient, false, null);
    }

    var stores = [options.patientStore, options.store, options.lookup, options.getPatient, options.findPatient];
    if (options.offline === true) {
      var off = cachedPatient();
      return finish(off ? off.patient : null, true, off);
    }

    var lookedUp;
    var threw = false;
    for (var s = 0; s < stores.length; s++) {
      if (stores[s] == null) continue;
      try {
        var v = storeGet(stores[s], storeKeys);
        if (isThenable(v)) {
          lookedUp = v;
          break;
        }
        if (v != null) {
          lookedUp = v;
          break;
        }
      } catch (e) {
        threw = true;
      }
    }

    if (isThenable(lookedUp)) {
      return lookedUp.then(function (p) {
        if (p != null) return finish(p, false, null);
        var c = cachedPatient();
        return finish(c ? c.patient : null, true, c);
      }, function () {
        var c2 = cachedPatient();
        return finish(c2 ? c2.patient : null, true, c2);
      });
    }
    if (lookedUp != null) return finish(lookedUp, false, null);
    var c3 = threw ? cachedPatient() : cachedPatient();
    return finish(c3 ? c3.patient : null, !!c3, c3);
  }

  /* True when two carrier payloads (any types: NFC, QR, barcode, wristband, manual)
   * name the same canonical stewardId / patientId. */
  function areCarriersEquivalent(carrierA, carrierB) {
    var na = normalizeCarrierValue(carrierA);
    var nb = normalizeCarrierValue(carrierB);
    if (!na || !nb) return false;
    if (na === nb) return true;
    function idFor(n) {
      var reg = findCarrier("", n, true);
      if (reg) return (reg.stewardId || reg.patientId || "").toUpperCase();
      return n;
    }
    return idFor(na) === idFor(nb);
  }

  function reset() {
    carriers = [];
    cacheClear();
  }

  function clearCache() {
    cacheClear();
  }

  return {
    CARRIER_TYPES: CARRIER_TYPES,
    CARRIER_STATUS: CARRIER_STATUS,
    EVENT_RESOLVED: EVENT_RESOLVED,
    CarrierRevokedError: CarrierRevokedError,
    normalizeCarrierValue: normalizeCarrierValue,
    mintStewardId: mintStewardId,
    registerCarrier: registerCarrier,
    revokeCarrier: revokeCarrier,
    isCarrierRevoked: isCarrierRevoked,
    getCarrier: getCarrier,
    getActiveCarriersForPatient: getActiveCarriersForPatient,
    resolvePatientIdentity: resolvePatientIdentity,
    areCarriersEquivalent: areCarriersEquivalent,
    on: on,
    off: off,
    emit: emit,
    reset: reset,
    clearCache: clearCache,
  };
});
