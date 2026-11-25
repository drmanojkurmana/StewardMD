/* StewardMD - ResearchMD randomisation list engine (window.SMD_RESEARCH_RANDOMISE).
 * ES5 only, pure. Dual export: browser global and CommonJS.
 * Stub until plan v2 item 5 lands.
 */
(function (G) {
  "use strict";

  function blockList() { return { ok: false, warnings: ["Not built yet"] }; }

  var R = { blockList: blockList };

  if (typeof module !== "undefined" && module.exports) { module.exports = R; }
  if (G) { G.SMD_RESEARCH_RANDOMISE = R; }

})(typeof window !== "undefined" ? window : undefined);
