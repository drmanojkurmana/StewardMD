/* PrepNucleus Sound provider adapters (rs-sound): the documented provider-adapter
   interface that the Spotify mini-player module (job rs-spotify, file
   prep-sound-spotify.js) plugs into. window.PREP_SOUND_PROVIDERS. ES5.
   Loaded by prep-loader.js after prep-sound-core.js (optional: without it nothing
   changes). Pure registry + external-handoff adapters run under node for tests.

   Adapter contract (plan section 4.2; every method optional except id,
   capabilities, dispose — the orchestrator checks capabilities first and an
   unsupported call returns { ok:false, error:"unsupported:..." }, never silence):

     { id: SoundProviderId, capabilities: ProviderCapabilities,
       getStatus(): Promise<{ ok, state }>,
       play?(ctx): Promise<result>, pause?(): Promise<result>,
       stop?(): Promise<result>, next?(): Promise<result>, previous?(): Promise<result>,
       setVolume?(v): Promise<result>,
       openExternal?(target {url}): Promise<result>,   // target.url must come from
       disconnect?(): Promise<result>,                 // PREP_SOUND_CORE handoff builders
       dispose(): Promise<void> }

   Mount point for rs-spotify: call PREP_SOUND_PROVIDERS.registerAdapter(adapter)
   with id "spotify_remote". Until then getAdapter("spotify_remote") returns null
   and the chooser falls back to plain Spotify handoff (core kind "reserved"). */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  function CORE() { return (typeof window !== "undefined" && window.PREP_SOUND_CORE) || (typeof globalThis !== "undefined" && globalThis.PREP_SOUND_CORE) || null; }

  var CAP_KEYS = ["embeddedPlayback", "externalHandoff", "remoteControls", "queueControls", "volumeControl", "trackMetadata", "backgroundPlayback"];
  function checkShape(a) {
    var errs = [];
    if (!a || typeof a !== "object") return ["adapter-missing"];
    if (typeof a.id !== "string" || !a.id) errs.push("id-string");
    if (!a.capabilities || typeof a.capabilities !== "object") errs.push("capabilities-missing");
    else CAP_KEYS.forEach(function (k) { if (typeof a.capabilities[k] !== "boolean") errs.push("capability:" + k); });
    if (typeof a.getStatus !== "function") errs.push("getStatus-fn");
    if (typeof a.dispose !== "function") errs.push("dispose-fn");
    ["play", "pause", "stop", "next", "previous", "setVolume", "openExternal", "disconnect"].forEach(function (m) {
      if (a[m] != null && typeof a[m] !== "function") errs.push("method:" + m);
    });
    return errs;
  }

  var registry = {};
  function registerAdapter(a) {
    var errs = checkShape(a);
    if (errs.length) { var e = new Error("bad-adapter:" + errs[0]); e.details = errs; throw e; }
    registry[a.id] = a;
    return true;
  }
  function getAdapter(id) { return registry[id] || null; }
  function listAdapters() { return Object.keys(registry); }
  function unregisterAdapter(id) { if (registry[id]) { delete registry[id]; return true; } return false; }

  /* Generic external-handoff adapter: openExternal opens a core-verified URL through
     the injected opener (window.open in browser, stub in tests). Every transport op
     returns a typed unsupported result — the UI hides those controls instead. */
  function makeExternalAdapter(providerId, opener) {
    var C = CORE();
    var meta = C ? C.providerById(providerId) : null;
    var caps = meta ? meta.capabilities : { embeddedPlayback: false, externalHandoff: true, remoteControls: false, queueControls: false, volumeControl: false, trackMetadata: false, backgroundPlayback: false };
    function no(op) { return Promise.resolve({ ok: false, error: "unsupported:" + providerId + ":" + op }); }
    return {
      id: providerId, capabilities: caps,
      getStatus: function () { return Promise.resolve({ ok: true, state: "ready" }); },
      play: function () { return no("play"); },
      pause: function () { return no("pause"); },
      stop: function () { return no("stop"); },
      next: function () { return no("next"); },
      previous: function () { return no("previous"); },
      setVolume: function () { return no("setVolume"); },
      openExternal: function (target) {
        var url = target && target.url;
        if (typeof url !== "string" || !/^https:\/\//.test(url)) return Promise.resolve({ ok: false, error: "unavailable:bad-url" });
        try { (opener || function () {})(url); return Promise.resolve({ ok: true }); }
        catch (e) { return Promise.resolve({ ok: false, error: "unavailable:open-failed" }); }
      },
      disconnect: function () { return Promise.resolve({ ok: true }); },
      dispose: function () { return Promise.resolve(); }
    };
  }

  var PURE = { CAP_KEYS: CAP_KEYS, checkShape: checkShape, registerAdapter: registerAdapter, getAdapter: getAdapter, listAdapters: listAdapters, unregisterAdapter: unregisterAdapter, makeExternalAdapter: makeExternalAdapter };
  if (NODE) { module.exports = PURE; return; }
  G.PREP_SOUND_PROVIDERS = PURE;
})(typeof window !== "undefined" ? window : this);
