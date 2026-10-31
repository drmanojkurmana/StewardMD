/* PrepReels media: first-party descriptor + official YouTube nocookie embed adapter.
   window.PREP_MG_MEDIA. ES5. Plan: vault/plans/PrepNucleus-MediGram.md section 7.
   The adapter is behind smd_prep_medigram_youtube (default OFF, see prep-medigram-data.js).
   When disabled, unavailable or offline it returns a fallback descriptor and creates no iframe.
   No scraping, no download, no rehost, no control hiding. Pause and release on navigation/background. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
  function validVideoId(id) { return typeof id === "string" && VIDEO_ID_RE.test(id); }
  /* Official embedded player on the nocookie host. rel=0 keeps related videos on the same video where
     YouTube allows it; branding and controls are never hidden (modestbranding is not set to hide). */
  function embedUrl(videoId, opts) {
    if (!validVideoId(videoId)) return null;
    opts = opts || {};
    var q = "rel=0&playsinline=1";
    if (opts.start) q += "&start=" + Math.max(0, Math.floor(+opts.start || 0));
    return "https://www.youtube-nocookie.com/embed/" + videoId + "?" + q;
  }
  function sourceLabel(media) {
    if (!media) return "";
    if (media.provider === "youtube") return "YouTube";
    if (media.provider === "first_party") return "PrepReels";
    return "";
  }
  /* What the feed should draw for a candidate's media. Never throws on malformed third-party metadata. */
  function describe(candidate, env) {
    env = env || {};
    var media = candidate && candidate.media;
    if (!candidate || candidate.kind !== "video" || !media) return { kind: "none" };
    if (media.provider === "first_party") {
      if (!media.assetId || typeof media.assetId !== "string") return { kind: "unavailable", provider: "first_party", label: "PrepReels", reason: "missing-asset" };
      return { kind: "first_party", provider: "first_party", label: "PrepReels", assetId: media.assetId };
    }
    if (media.provider === "youtube") {
      if (!env.youtubeEnabled) return { kind: "disabled", provider: "youtube", label: "YouTube", reason: "policy-off" };
      if (!validVideoId(media.videoId)) return { kind: "unavailable", provider: "youtube", label: "YouTube", reason: "bad-id" };
      if (env.offline) return { kind: "unavailable", provider: "youtube", label: "YouTube", reason: "offline" };
      return { kind: "youtube", provider: "youtube", label: "YouTube", videoId: media.videoId, url: embedUrl(media.videoId, env) };
    }
    return { kind: "unavailable", provider: String(media.provider || ""), label: "", reason: "unknown-provider" };
  }

  var PURE = { validVideoId: validVideoId, embedUrl: embedUrl, sourceLabel: sourceLabel, describe: describe };
  if (NODE) { module.exports = PURE; return; }

  /* ================= browser ================= */
  /* One live player at a time. mount() creates the nocookie iframe; release() pauses via the official
     postMessage pause command where the player listens, then removes the node so nothing keeps playing. */
  var live = null; // { holder, iframe, videoId }
  function release() {
    if (!live) return;
    try { if (live.iframe && live.iframe.contentWindow) live.iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":[]}', "https://www.youtube-nocookie.com"); } catch (e) {}
    try { if (live.iframe && live.iframe.parentNode) live.iframe.parentNode.removeChild(live.iframe); } catch (e) {}
    live = null;
  }
  function mount(holder, candidate, env) {
    release();
    var d = describe(candidate, env || {});
    if (!holder) return d;
    if (d.kind !== "youtube") return d;
    var f = G.document.createElement("iframe");
    f.src = d.url;
    f.title = candidate.title ? String(candidate.title) : "YouTube video";
    f.setAttribute("loading", "lazy");
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.setAttribute("allow", "accelerometer; encrypted-media; picture-in-picture");
    f.setAttribute("allowfullscreen", "");
    f.className = "pn-mg-frame";
    holder.appendChild(f);
    live = { holder: holder, iframe: f, videoId: d.videoId };
    return d;
  }
  function onVisibility() { if (G.document && G.document.visibilityState === "hidden") release(); }
  try {
    if (G.document && G.document.addEventListener) G.document.addEventListener("visibilitychange", onVisibility);
    if (G.addEventListener) { G.addEventListener("pagehide", release); }
  } catch (e) {}
  G.PREP_MG_MEDIA = { describe: describe, embedUrl: embedUrl, validVideoId: validVideoId, sourceLabel: sourceLabel, mount: mount, release: release, _pure: PURE };
})(typeof window !== "undefined" ? window : this);
