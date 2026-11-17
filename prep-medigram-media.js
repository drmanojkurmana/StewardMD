/* PrepReels media: the cleared CliniX teaching videos, played inline by YouTube's own player. window.PREP_MG_MEDIA. ES5.
   The app runs on capacitor://localhost, an origin YouTube's player rejects ("Error 153: Video player configuration
   error"). So, exactly like CliniX (clinix-screens.js YT_SHIM), the card iframes our https shim _site/yt.html, which
   embeds the official player and only plays its allow-list; autoplay=1 makes the shim start it at once. The video
   list is clinix/media/manifest.json (embeddable, cleared, oEmbed-verified). No scraping, no download, no rehost. One live player; released on scroll-away/background. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);
  var SHIM = "https://stewardmd.in/_site/yt";

  function validVideoId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id); }
  function shimUrl(videoId) { return validVideoId(videoId) ? SHIM + "?v=" + videoId + "&autoplay=1" : null; }
  // Cards from the CliniX media manifest: only cleared, embeddable videos with a valid id, one per id.
  function videosFrom(manifest) {
    var m = (manifest && manifest.media) || {}, seen = {}, out = [];
    Object.keys(m).forEach(function (k) {
      var x = m[k];
      if (!x || x.kind !== "embed" || x.embeddable !== true || x.cleared !== true || !validVideoId(x.videoId) || seen[x.videoId]) return;
      seen[x.videoId] = 1;
      out.push({ kind: "video", videoId: x.videoId, title: String(x.title || x.caption || "Teaching video"), caption: String(x.caption || ""), by: String(x.attribution || "") });
    });
    return out;
  }

  var PURE = { validVideoId: validVideoId, shimUrl: shimUrl, videosFrom: videosFrom, SHIM: SHIM };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  /* One live player, inside the app (never a hand-off to the YouTube app or site). It autoplays when its card arrives
     and is removed when the card leaves, so nothing plays off screen. */
  var live = null;   // { holder, iframe }
  function release() {
    if (!live) return;
    try { if (live.iframe.parentNode) live.iframe.parentNode.removeChild(live.iframe); } catch (e) {}
    try { live.holder.classList.remove("on"); } catch (e) {}
    live = null;
  }
  function mount(holder, videoId, title) {
    if (live && live.holder === holder) return;
    release();
    var url = shimUrl(videoId);
    if (!holder || !url) return;
    var f = G.document.createElement("iframe");
    f.src = url;
    f.title = title || "Teaching video";
    f.setAttribute("allow", "autoplay; accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen");
    f.setAttribute("allowfullscreen", "");
    holder.appendChild(f);
    holder.classList.add("on");
    live = { holder: holder, iframe: f };
  }
  try {
    G.document.addEventListener("visibilitychange", function () { if (G.document.visibilityState === "hidden") release(); });
    G.addEventListener("pagehide", release);
  } catch (e) {}
  G.PREP_MG_MEDIA = { validVideoId: validVideoId, shimUrl: shimUrl, videosFrom: videosFrom, mount: mount, release: release, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
