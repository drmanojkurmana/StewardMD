/* StewardMD — Canonical Hospital Registry (window.SMD_HOSPITALS)  (UMD: browser + node-testable)
 *
 * StewardMD is multi-hospital: every hospital is a pluggable entry, and GIMSR/GHIS is one
 * approved adapter among them (with its legacy proxy fallback), not a special case in the code.
 *   StewardMD
 *    |-- Hospital A -> approved adapter
 *    |-- Hospital B -> approved adapter
 *    |-- GIMSR/GHIS -> approved adapter (with legacy fallback)
 *    `-- unlimited future hospitals
 *
 * DOMAIN (no DOM, no fetch, no framework): pure entries + a localStorage-backed store.
 * The phone runtime (connect-agent/phone/*) and the Ward Sync picker (ghis-ward.js) are the
 * adapters that read this registry; nothing here imports them.
 *
 * Use in the browser (classic script, BEFORE connect-agent-boot.js / home.js):
 *   <script src="/hospital-registry.js?v=hr1" defer></script>
 *   SMD_HOSPITALS.list()            // active hospitals: built-ins + custom + WardSynq-linked
 *   SMD_HOSPITALS.setActive('kims') // remember the doctor's hospital context
 * Use in node: const REG = require('./hospital-registry.js') (or default-import it).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // node / tests
  if (root) root.SMD_HOSPITALS = api;                                          // browser
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var LS_REGISTRY = 'smd_hospital_registry';       // saved custom hospitals: { id: entry }
  var LS_WARDSYNQ = 'smd_wardsynq_hospitals';      // linked WardSynq hospitals: [{ code, name }]
  var LS_ACTIVE = 'smd_active_hospital_id';        // currently selected hospital context

  var ADAPTER_TYPES = ['connect_agent', 'connect_protocol', 'wardsynq_native', 'legacy_proxy', 'demo'];
  var STATUSES = ['ACTIVE', 'AWAITING_APPROVAL', 'DRAFT', 'DISABLED'];

  function fullCapabilities() { return { worklist: true, medications: true, labs: true, radiology: true }; }

  function builtins() {
    return [
      {
        hospitalId: 'gimsr',
        name: 'GITAM Institute of Medical Sciences & Research',
        shortName: 'GIMSR',
        emrName: 'GHIS',
        emrUrl: 'https://gimsrlogin.gitam.edu',
        adapterType: 'legacy_proxy',
        adapterId: '',
        activeVersionId: '',
        status: 'ACTIVE',
        capabilities: fullCapabilities(),
        isBuiltin: true
      },
      {
        hospitalId: 'stewardmd',
        name: 'StewardMD Hospital',
        shortName: 'Demo',
        emrName: 'Demo Sandbox',
        emrUrl: '',
        adapterType: 'demo',
        adapterId: '',
        activeVersionId: '',
        status: 'ACTIVE',
        capabilities: fullCapabilities(),
        isBuiltin: true
      }
    ];
  }

  /* ---- storage (localStorage when present, memory otherwise; never throws) ---- */
  function ls() {
    try { if (typeof window !== 'undefined' && window.localStorage) return window.localStorage; } catch (e) {}
    try { if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage; } catch (e) {}
    return null;
  }
  function readLS(key) {
    var store = ls();
    if (!store) return null;
    try {
      var raw = store.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  }
  function writeLS(key, value) {
    var store = ls();
    if (!store) return;
    try {
      if (value == null) store.removeItem(key);
      else store.setItem(key, JSON.stringify(value));
    } catch (e) { /* private mode etc: memory still holds it */ }
  }

  var _custom = {};    // hospitalId -> entry (registered this session + loaded from LS)
  var _activeId = null;

  (function init() {
    var saved = readLS(LS_REGISTRY);
    if (saved && typeof saved === 'object') {
      for (const id of Object.keys(saved)) {
        try { _custom[id] = normalize(saved[id]); } catch (e) { /* skip one bad row */ }
      }
    }
    var active = readLS(LS_ACTIVE);
    if (typeof active === 'string' && active) _activeId = active;
    else {
      try {
        var store = ls();
        var raw = store && store.getItem(LS_ACTIVE);
        if (typeof raw === 'string' && raw) _activeId = raw;
      } catch (e) {}
    }
  })();

  function persistCustom() { writeLS(LS_REGISTRY, _custom); }

  /* ---- entries ---- */
  function normalize(entry) {
    if (!entry || typeof entry !== 'object') throw new Error('hospital entry must be an object');
    var id = String(entry.hospitalId || '').trim();
    if (!id) throw new Error('hospital entry needs a hospitalId');
    var out = {
      hospitalId: id,
      name: entry.name != null ? String(entry.name) : id,
      shortName: entry.shortName != null ? String(entry.shortName) : id,
      emrName: entry.emrName != null ? String(entry.emrName) : '',
      emrUrl: entry.emrUrl != null ? String(entry.emrUrl) : '',
      adapterType: ADAPTER_TYPES.indexOf(entry.adapterType) >= 0 ? entry.adapterType : 'connect_agent',
      adapterId: entry.adapterId != null ? String(entry.adapterId) : '',
      activeVersionId: entry.activeVersionId != null ? String(entry.activeVersionId) : '',
      status: STATUSES.indexOf(entry.status) >= 0 ? entry.status : 'ACTIVE',
      capabilities: entry.capabilities && typeof entry.capabilities === 'object'
        ? Object.assign({}, entry.capabilities) : {},
      isBuiltin: entry.isBuiltin === true
    };
    return out;
  }

  // WardSynq-linked hospitals (localStorage smd_wardsynq_hospitals: [{ code, name }]) as registry entries.
  function wardsynqEntries() {
    var list = readLS(LS_WARDSYNQ);
    if (!Array.isArray(list)) return [];
    var out = [];
    for (const h of list) {
      if (!h || typeof h !== 'object') continue;
      var code = String(h.code || h.hospitalId || '').trim();
      if (!code) continue;
      out.push({
        hospitalId: code,
        name: h.name != null ? String(h.name) : code,
        shortName: String(h.shortName || code).toUpperCase(),
        emrName: 'WardSynq',
        emrUrl: h.emrUrl != null ? String(h.emrUrl) : '',
        adapterType: 'wardsynq_native',
        adapterId: code,
        activeVersionId: code,
        status: 'ACTIVE',
        capabilities: fullCapabilities(),
        isBuiltin: false
      });
    }
    return out;
  }

  function mergedAll() {
    var byId = {};
    for (const b of builtins()) byId[b.hospitalId] = b;
    for (const id of Object.keys(_custom)) byId[id] = _custom[id];
    for (const w of wardsynqEntries()) if (!byId[w.hospitalId]) byId[w.hospitalId] = w;
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function list(options) {
    var opts = options || {};
    var all = mergedAll();
    if (opts.all === true || opts.includeInactive === true) return all.slice();
    if (typeof opts.status === 'string') return all.filter(function (h) { return h.status === opts.status; });
    return all.filter(function (h) { return h.status === 'ACTIVE'; });
  }

  function get(hospitalId) {
    var id = String(hospitalId || '');
    var all = mergedAll();
    for (const h of all) if (h.hospitalId === id) return h;
    return null;
  }

  function register(entry) {
    var norm = normalize(entry);
    var prev = _custom[norm.hospitalId];
    // Re-registering keeps explicitly set capabilities; otherwise the newcomer's stand.
    if (prev && (!entry.capabilities || typeof entry.capabilities !== 'object')) norm.capabilities = prev.capabilities;
    _custom[norm.hospitalId] = norm;
    persistCustom();
    return norm;
  }

  function setActive(hospitalId) {
    _activeId = hospitalId == null ? null : String(hospitalId);
    var store = ls();
    if (store) {
      try {
        if (_activeId) store.setItem(LS_ACTIVE, _activeId);
        else store.removeItem(LS_ACTIVE);
      } catch (e) {}
    } else writeLS(LS_ACTIVE, _activeId);
    return _activeId;
  }

  function getActive() {
    if (!_activeId) {
      var saved = readLS(LS_ACTIVE);
      if (typeof saved === 'string' && saved) _activeId = saved;
      else {
        try {
          var store = ls();
          var raw = store && store.getItem(LS_ACTIVE);
          if (typeof raw === 'string' && raw) _activeId = raw;
        } catch (e) {}
      }
    }
    if (!_activeId) return null;
    return get(_activeId);
  }

  // User-isolated browser storage scope: Doctor A and Doctor B never share cookies/sessions.
  function getStoreId(hospitalId, doctorUid) {
    return String(hospitalId || 'unknown') + '_' + String(doctorUid || 'default');
  }

  function shortFromName(name, fallback) {
    var s = String(name || '').replace(/\b(hospitals?|medical\s+(college|centre|center|sciences)|institute|of|and|&|multi.?speciality|multispecialty|trust)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return String(fallback || '');
    return s.split(' ')[0];
  }

  // tenants: rows from /api/connect/agent/tenants, each optionally carrying its connections
  // ([{ deploymentId, origins, activeVersionId }]) or deployments; or pass the map as 2nd arg.
  // Only APPROVED ones (activeVersionId present) are registered; drafts stay out.
  function syncFromAgentTenants(tenants, connectionsByTenant) {
    var registered = [];
    var byTenant = connectionsByTenant && typeof connectionsByTenant === 'object' ? connectionsByTenant : {};
    for (const t of Array.isArray(tenants) ? tenants : []) {
      if (!t || typeof t !== 'object') continue;
      var tid = String(t.tenantId || t.hospitalId || '').trim();
      if (!tid) continue;
      var conns = Array.isArray(t.connections) ? t.connections
        : Array.isArray(t.deployments) ? t.deployments
        : Array.isArray(byTenant[tid]) ? byTenant[tid] : [];
      for (const cn of conns) {
        if (!cn || typeof cn !== 'object') continue;
        var version = cn.activeVersionId != null ? String(cn.activeVersionId) : '';
        if (!version) continue;   // draft / awaiting approval: not listed until approved
        var origins = Array.isArray(cn.origins) ? cn.origins : [];
        var prev = get(tid);
        registered.push(register({
          hospitalId: tid,
          name: t.name || (prev && prev.name) || tid,
          shortName: t.shortName || (prev && prev.shortName) || shortFromName(t.name, tid),
          emrName: t.emrName || (prev && prev.emrName) || '',
          emrUrl: origins[0] != null ? String(origins[0]) : ((prev && prev.emrUrl) || ''),
          adapterType: 'connect_agent',
          adapterId: cn.deploymentId != null ? String(cn.deploymentId) : ((prev && prev.adapterId) || ''),
          activeVersionId: version,
          status: 'ACTIVE',
          capabilities: (prev && prev.capabilities) || { worklist: true },
          isBuiltin: false
        }));
      }
    }
    return registered;
  }

  return {
    list: list,
    get: get,
    register: register,
    setActive: setActive,
    getActive: getActive,
    getStoreId: getStoreId,
    syncFromAgentTenants: syncFromAgentTenants,
    ADAPTER_TYPES: ADAPTER_TYPES.slice(),
    STATUSES: STATUSES.slice(),
    KEYS: { registry: LS_REGISTRY, wardsynq: LS_WARDSYNQ, active: LS_ACTIVE }
  };
});
