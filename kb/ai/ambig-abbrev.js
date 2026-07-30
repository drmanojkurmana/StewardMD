/* ambig-abbrev.js — data-only extension of MaiK's never-guess abbreviation table (window.MAIK_AMBIG).
 *
 * maik-brain.js merges these into its inline AMBIG map at load (existing curated entries win). Adding an
 * ambiguous abbreviation is a ONE-LINE data edit here, no logic change. Only list abbreviations a
 * clinician might type BARE whose expansion changes management — the brain's dominance guard (fires ONLY
 * when the abbrev is essentially the whole query) + STOP list keep false-asks near zero, and the scope
 * firewall already filters non-medical context ("MS Dhoni" never reaches here). Buildless ES5/IIFE. */
(function (root) {
  "use strict";
  var A = {
    le: ["Lupus Erythematosus (SLE)", "Lower Extremity"],
    pd: ["Parkinson's Disease", "Peritoneal Dialysis"],
    cf: ["Cystic Fibrosis", "Cardiac Failure"],
    rf: ["Renal Failure", "Rheumatic Fever", "Rheumatoid Factor"],
    hd: ["Haemodialysis", "Huntington's Disease"],
    cm: ["Cardiomyopathy", "Cardiomegaly"],
    pn: ["Pneumonia", "Peripheral Neuropathy"],
    ad: ["Alzheimer's Disease", "Atopic Dermatitis"],
    as_note: null   // (AS already covered by the brain's curated table)
  };
  delete A.as_note;
  try { if (typeof module !== "undefined" && module.exports) module.exports = A; } catch (e) {}
  try { root.MAIK_AMBIG = root.MAIK_AMBIG ? (function (m) { for (var k in A) if (!(k in m)) m[k] = A[k]; return m; })(root.MAIK_AMBIG) : A; } catch (e) { try { root.MAIK_AMBIG = A; } catch (e2) {} }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
