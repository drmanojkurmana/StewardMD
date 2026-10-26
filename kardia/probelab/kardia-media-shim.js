/* kardia-media-shim.js - loaded first by kardia/probelab/index.html.
 * Inside the iOS app, fetch() of a bundled .mp4 with EchoSuite's "?__v="
 * cache-bust query comes back with status 0, so the Probe Lab's first
 * clinical cine never becomes ready. This shim answers those requests
 * from the same file without the query (and falls back to XHR), returning
 * a normal 200 Response with the bytes. Every other request is untouched. */
(function () {
  "use strict";
  var origFetch = window.fetch;
  if (!origFetch) return;
  function localMp4(u) {
    try { var a = new URL(u, document.baseURI); return a.origin === location.origin && /\.mp4$/i.test(a.pathname) ? a : null; } catch (e) { return null; }
  }
  function xhrBlob(url) {
    return new Promise(function (res, rej) {
      var x = new XMLHttpRequest();
      x.open("GET", url, true); x.responseType = "blob";
      x.onload = function () { (x.status === 200 || (x.status === 0 && x.response && x.response.size)) ? res(x.response) : rej(new Error("clip xhr " + x.status)); };
      x.onerror = function () { rej(new Error("clip xhr error")); };
      x.send();
    });
  }
  function asResponse(blob) {
    var b = blob.type ? blob : new Blob([blob], { type: "video/mp4" });
    return new Response(b, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Length": String(b.size) } });
  }
  window.fetch = function (input, init) {
    var raw = typeof input === "string" ? input : (input && input.url) || "";
    var a = localMp4(raw);
    if (!a) return origFetch.apply(this, arguments);
    var plain = a.origin + a.pathname;
    return origFetch.call(window, plain).then(function (r) {
      if (r.ok) return r.blob().then(asResponse);
      throw new Error("clip fetch " + r.status);
    }).catch(function () { return xhrBlob(plain).then(asResponse); });
  };
})();
