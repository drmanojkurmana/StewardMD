/* StewardMD - ResearchMD de-identification (window.RMDPhi).
 * ES5 IIFE. Dual export. Item 0 stubs return safe empties.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  function prepareCaseText() {
    return { text: "", removed: [], blocked: false, findings: [] };
  }

  function scan() {
    return [];
  }

  function numbersNotIn() {
    return [];
  }

  var API = {
    prepareCaseText: prepareCaseText,
    scan: scan,
    numbersNotIn: numbersNotIn
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (G) {
    G.RMDPhi = API;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
