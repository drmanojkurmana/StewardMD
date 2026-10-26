/* kardia-media-shim.js - loaded first by kardia/probelab/index.html.
 * Inside the iOS app the WebView cannot stream video from the app's own
 * scheme (no byte-range support), so EchoSuite's clinical cines never
 * become ready. This shim swaps every same-origin .mp4 source for a blob
 * URL of the fetched bytes before the video loads, the same way
 * kardia-clips.js plays Kardia's own clips. Remote URLs are left alone. */
(function () {
  "use strict";
  var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (!proto || !window.fetch || !window.URL || !URL.createObjectURL) return;
  var desc = Object.getOwnPropertyDescriptor(proto, "src");
  if (!desc || !desc.set) return;
  var cache = {};
  function isLocalMp4(u) {
    try { var a = new URL(u, document.baseURI); return a.origin === location.origin && /\.mp4$/i.test(a.pathname); } catch (e) { return false; }
  }
  function blobUrl(u) {
    if (!cache[u]) cache[u] = fetch(u).then(function (r) { if (!r.ok) throw new Error("clip " + r.status); return r.blob(); })
      .then(function (b) { return URL.createObjectURL(b.type ? b : new Blob([b], { type: "video/mp4" })); });
    return cache[u];
  }
  function assign(el, u) {
    if (typeof u !== "string" || !isLocalMp4(u)) { desc.set.call(el, u); return; }
    el.__kardiaWant = u;
    blobUrl(u).then(function (b) { if (el.__kardiaWant === u) { desc.set.call(el, b); try { el.load(); } catch (e) {} } },
      function () { if (el.__kardiaWant === u) desc.set.call(el, u); });
  }
  Object.defineProperty(proto, "src", { configurable: true, enumerable: desc.enumerable, get: desc.get, set: function (u) { assign(this, u); } });
  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof window.HTMLMediaElement && String(name).toLowerCase() === "src") { assign(this, value); return; }
    return setAttr.call(this, name, value);
  };
})();
