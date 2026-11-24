/* StewardMD - ResearchMD randomisation (window.SMD_RESEARCH_RANDOMISE).
 * ES5 IIFE. Dual export. Item 0 stub: blockList is not built yet.
 * No Math.random. No em or en dashes.
 */
(function (G) {
  "use strict";

  function blockList() {
    return { ok: false, warnings: ["Not built yet"] };
  }

  var API = { blockList: blockList };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (G) {
    G.SMD_RESEARCH_RANDOMISE = API;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
