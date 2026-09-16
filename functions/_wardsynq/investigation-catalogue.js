/* functions/_wardsynq/investigation-catalogue.js - what a ward can order as a lab or imaging test (LT-15).
 *
 * Ordering was a free-text box: the request carried whatever was typed as its code ("CBC", "CXR", "blood test"), with
 * no list to pick from, and an imaging order typed as "CXR" under the default Laboratory category sat on the laboratory
 * board awaiting a result that the laboratory will never produce.
 *
 * THE CATALOGUE is three lists, in this order: the hospital's own Price list items of kind investigation or radiology
 * (named and coded as the hospital bills them, so an order and its charge share a name), the investigations in the
 * hospital's own order sets, and a short built-in list of common tests with codes. Where the hospital lists a test
 * under the same code, its entry wins. Anything not on it may be ordered from the chart only as "other" with a reason:
 * the chart sends `other: true` and ward-order.js refuses it without a reason. An order that arrives through the API
 * with a code the catalogue does not know (an integration, an older client) is still accepted, marked uncatalogued.
 *
 * THE CATEGORY OF A CATALOGUED TEST IS THE CATALOGUE'S. A test the catalogue knows as imaging goes to radiology whatever
 * category the order was sent with. Nothing is inferred from words in a free-text name: "Urine culture after x-ray
 * contrast" ordered as a laboratory test stays a laboratory test.
 *
 * EXISTING ORDERS ARE CORRECTED ON READ, NOT REWRITTEN. An order already filed as laboratory whose code or name is a
 * catalogued imaging test (the demo's "CXR") is read as imaging by effectiveCategory() wherever the laboratory and
 * radiology boards and specimen collection decide where it belongs. The stored record is not changed: records are
 * append-only, and the correction is a reading rule that can be removed if the data is ever amended.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const key = (v) => str(v).toUpperCase();

/* The built-in list. Codes are WardSynQ's own short codes, not LOINC: a code the product would have to guess from a
 * name is exactly what lab-result.js refuses to do, so these name tests, they do not claim a coding system. */
const BUILT_IN = Object.freeze([
  ["CBC", "Complete blood count", "laboratory"],
  ["RFT", "Renal function tests", "laboratory"],
  ["LFT", "Liver function tests", "laboratory"],
  ["ELEC", "Serum electrolytes", "laboratory"],
  ["RBS", "Blood sugar (random)", "laboratory"],
  ["FBS", "Blood sugar (fasting)", "laboratory"],
  ["HBA1C", "HbA1c", "laboratory"],
  ["LIPID", "Lipid profile", "laboratory"],
  ["TSH", "Thyroid stimulating hormone (TSH)", "laboratory"],
  ["URINE-R", "Urine routine examination", "laboratory"],
  ["BCS", "Blood culture and sensitivity", "laboratory"],
  ["COAG", "Coagulation profile (PT/INR, aPTT)", "laboratory"],
  ["TROP", "Troponin", "laboratory"],
  ["ABG", "Arterial blood gas", "laboratory"],
  ["CRP", "C-reactive protein", "laboratory"],
  ["CXR", "X-ray chest", "imaging"],
  ["USG-ABD", "Ultrasound abdomen", "imaging"],
  ["CT-HEAD", "CT head", "imaging"],
  ["MRI-BRAIN", "MRI brain", "imaging"],
  ["ECG", "Electrocardiogram (ECG)", "imaging"],
  ["ECHO", "Echocardiogram", "imaging"],
].map(([code, name, category]) => Object.freeze({ code, name, category, source: "built-in" })));

const IMAGING_WORDS = /x-?ray|radiograph|\bct\b|computed tomography|\bmri\b|magnetic resonance|ultrasound|\busg\b|sonograph|doppler|mammogra|fluoroscop|echocardio|\becho\b/i;

/**
 * PURE. The catalogue. `priceList` is the Price list rows (q_tariff: {name, code, kind, active}); `orderSets` is the
 * hospital's wardsynq.orderSets. A Price list row of kind "radiology" is imaging; of kind "investigation" (the screen's
 * "Lab or radiology test") it is imaging when its name or code says so, else laboratory, and the hospital can see and
 * correct that name. Deduplicated by code, first list wins.
 */
function catalogue(priceList, orderSets) {
  const out = [], seen = new Set();
  const add = (e) => { const k = key(e.code); if (!k || seen.has(k)) return; seen.add(k); out.push(e); };
  for (const r of priceList || []) {
    if (!r || r.active === false) continue;
    const kind = str(r.kind).toLowerCase();
    if (kind !== "investigation" && kind !== "radiology") continue;
    const name = str(r.name), code = str(r.code) || name;
    if (!name) continue;
    add({ code, name, category: kind === "radiology" || IMAGING_WORDS.test(name + " " + code) ? "imaging" : "laboratory", source: "price-list" });
  }
  for (const set of Array.isArray(orderSets) ? orderSets : []) {
    for (const it of (set && Array.isArray(set.items) ? set.items : [])) {
      if (!it || str(it.kind).toLowerCase() !== "investigation") continue;
      const code = str(it.code) || str(it.display), name = str(it.display) || code;
      if (code) add({ code, name, category: IMAGING_WORDS.test(name + " " + code) ? "imaging" : "laboratory", source: "order-set" });
    }
  }
  for (const e of BUILT_IN) add({ ...e });
  return out;
}

/** PURE. The catalogue entry a code or name names exactly (case-insensitive), or null. Never a partial match. */
function findEntry(entries, code, name) {
  const c = key(code), n = key(name);
  return (entries || []).find((e) => (c && (key(e.code) === c || key(e.name) === c)) || (n && key(e.name) === n)) || null;
}

/**
 * PURE. Where an EXISTING order belongs. Imaging, procedure and referral as recorded stand. An order recorded as
 * laboratory, other or nothing whose code or name is exactly a built-in imaging test is imaging.
 */
function effectiveCategory(order) {
  const cat = str(order && order.category).toLowerCase();
  if (cat === "imaging" || cat === "procedure" || cat === "referral") return cat;
  const hit = findEntry(BUILT_IN, order && order.code, order && order.display);
  if (hit && hit.category === "imaging") return "imaging";
  return cat || "laboratory";
}

export { BUILT_IN, IMAGING_WORDS, catalogue, findEntry, effectiveCategory };
