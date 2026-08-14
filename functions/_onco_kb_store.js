/* StewardMD - ONCQIS Phase J-a: Knowledge Center INGESTION store (I/O over KV).
 *
 * THE HARD SAFETY RULE (structural): this module can ONLY ever write PROPOSED ingestion artifacts -
 * Evidence-Source ("onco:kb:ev:*"), extraction ("onco:kb:ex:*") and Update-Impact-Report
 * ("onco:kb:ir:*") objects. It has NO code path that writes a Standard Protocol, a Treatment Plan or a
 * dose: it does not import the protocol/plan store (_onco_store.js / _fbfirestore protocol writers) at
 * all. Every key it puts is asserted (KEY_PREFIX) so a bug cannot escape the artifact namespace - a
 * unit test drives the whole upload -> analyze -> impact flow through a fake KV and proves every
 * written key matches /^onco:kb:(ev|ex|ir):/, never a protocol/plan/dose key.
 *
 * Reuses the same KV binding fallback as the AI Control Center + Medical Updates (MAIK_KV / GHIS_KV /
 * UPDATES_KV) - no new binding. Every fn takes a `store` (a KV namespace) so node --test injects a fake.
 */

export const KEY_PREFIX = "onco:kb:";
const K_EV = KEY_PREFIX + "ev:";     // evidence source (metadata + optional pdf)
const K_EX = KEY_PREFIX + "ex:";     // AI extraction
const K_IR = KEY_PREFIX + "ir:";     // Update Impact Report
const K_PV = KEY_PREFIX + "pv:";     // J-b Proposed Protocol Version (a DRAFT under review + its audit)
const TTL = 60 * 60 * 24 * 400;      // ~400d retention

// Resolve the KV binding (same precedence as _ai_usage callers / the Updates module).
export function kbStore(env) { return (env && (env.MAIK_KV || env.GHIS_KV || env.UPDATES_KV)) || null; }

function newId(prefix) {
  var rnd = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, "") : String(Math.random()).slice(2);
  return prefix + "_" + rnd.slice(0, 20);
}
// Every put routes through here so a key can NEVER leave the artifact namespace (fail-closed).
async function _put(store, key, val) {
  if (String(key).indexOf(KEY_PREFIX) !== 0) throw new Error("onco_kb_store: refusing to write outside " + KEY_PREFIX + " (" + key + ")");
  await store.put(key, JSON.stringify(val), { expirationTtl: TTL });
}
async function _list(store, prefix) {
  var out = [];
  var res = await store.list({ prefix: prefix });
  var keys = (res && res.keys) || [];
  for (var i = 0; i < keys.length; i++) {
    try { var v = await store.get(keys[i].name, "json"); if (v) out.push(v); } catch (e) {}
  }
  return out;
}

// ---- J4: evidence source (uploaded guideline) ----------------------------------------------------
// meta carries ONLY document metadata (title/org/version/dates/type/diseases/checksum) + optional
// pdfB64. It is a licensed source doc, not PHI. The original is stored verbatim and NEVER mutated.
export async function saveEvidence(store, meta) {
  if (!store) return null;
  var id = meta.id || newId("ev");
  var rec = {
    kind: "onco-evidence-source", id: id,
    title: String(meta.title || ""), org: String(meta.org || ""), version: String(meta.version || ""),
    publicationDate: String(meta.publicationDate || ""), updateDate: String(meta.updateDate || ""),
    uploadDate: meta.uploadDate || 0, uploader: String(meta.uploader || ""),
    sourceType: String(meta.sourceType || ""), status: String(meta.status || "uploaded"),
    checksum: String(meta.checksum || ""), diseases: Array.isArray(meta.diseases) ? meta.diseases.slice(0, 60) : [],
    provenance: String(meta.provenance || ""), licensed: !!meta.licensed,
    fileName: String(meta.fileName || ""), byteSize: meta.byteSize | 0,
    pdfB64: meta.pdfB64 ? String(meta.pdfB64) : "",   // the original, stored verbatim
    lastExtractionId: meta.lastExtractionId || null
  };
  await _put(store, K_EV + id, rec);
  return rec;
}
export async function getEvidence(store, id) { return store ? (await store.get(K_EV + String(id), "json")) : null; }
export async function listEvidence(store) {
  var arr = store ? await _list(store, K_EV) : [];
  // Never leak the raw PDF bytes into the list view.
  return arr.map(function (e) { var c = Object.assign({}, e); delete c.pdfB64; return c; })
            .sort(function (a, b) { return (b.uploadDate || 0) - (a.uploadDate || 0); });
}
// Link an extraction back onto its evidence source (metadata only) without touching the stored PDF.
export async function markEvidenceExtracted(store, evidenceId, extractionId) {
  if (!store) return null;
  var e = await getEvidence(store, evidenceId);
  if (!e) return null;
  e.lastExtractionId = String(extractionId);
  e.status = "analyzed";
  await _put(store, K_EV + e.id, e);
  return e;
}

// ---- J5: extraction ------------------------------------------------------------------------------
export async function saveExtraction(store, ex) {
  if (!store) return null;
  var id = ex.id || newId("ex");
  var rec = Object.assign({ kind: "onco-extraction", id: id }, ex, { id: id });
  await _put(store, K_EX + id, rec);
  return rec;
}
export async function getExtraction(store, id) { return store ? (await store.get(K_EX + String(id), "json")) : null; }
export async function listExtractions(store) {
  var arr = store ? await _list(store, K_EX) : [];
  return arr.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
}

// ---- J6: Update Impact Report --------------------------------------------------------------------
export async function saveImpactReport(store, report) {
  if (!store) return null;
  var id = report.id || newId("ir");
  var rec = Object.assign({ id: id }, report, { id: id });
  await _put(store, K_IR + id, rec);
  return rec;
}
export async function getImpactReport(store, id) { return store ? (await store.get(K_IR + String(id), "json")) : null; }
export async function listImpactReports(store) {
  var arr = store ? await _list(store, K_IR) : [];
  return arr.sort(function (a, b) { return (b.generatedAt || 0) - (a.generatedAt || 0); });
}

// ---- J-b: Proposed Protocol Version (a DRAFT + its immutable audit chain) --------------------------
// A proposal is NEVER an ACTIVE protocol: it is a DRAFT clone under review. Even an "ACTIVE"-status
// version produced by the activate() step is stored HERE as a proposal record (its publication to the
// live protocol library is a separate, governed step) - so this store still never writes an ACTIVE
// protocol into the protocol library, and every key stays inside the onco:kb: namespace.
export async function saveProposedVersion(store, pv) {
  if (!store) return null;
  var id = (pv && pv.pvId) || newId("pv");
  var rec = Object.assign({ kind: "onco-proposed-version", pvId: id }, pv, { pvId: id });
  await _put(store, K_PV + id, rec);
  return rec;
}
export async function getProposedVersion(store, id) { return store ? (await store.get(K_PV + String(id), "json")) : null; }
export async function listProposedVersions(store) {
  var arr = store ? await _list(store, K_PV) : [];
  return arr.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
}
