/* StewardMD - ResearchMD backup (window.RMDBackup).
 * ES5 IIFE. Dual export. Item 0 stubs.
 * exportFile, readFile and restore are not built yet.
 * isDue stays false so the home banner does not fire early.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  function notBuilt() {
    return Promise.resolve({ ok: false, warnings: ["Not built yet"] });
  }

  function exportFile() { return notBuilt(); }
  function readFile() { return notBuilt(); }
  function restore() { return notBuilt(); }
  function isDue() { return Promise.resolve(false); }

  var API = {
    exportFile: exportFile,
    readFile: readFile,
    restore: restore,
    isDue: isDue
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (G) {
    G.RMDBackup = API;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
