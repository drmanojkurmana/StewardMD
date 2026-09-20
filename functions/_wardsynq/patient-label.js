/* functions/_wardsynq/patient-label.js — who a hospital-wide list row is about, in words a nurse checks against a wristband.
 *
 * LT-22/LT-26/LT-28: the handover and critical-results boards printed "opd-pat-smd-demo-00056" where a name belongs.
 * Every row carries a patientId and most an encounterId; this reads each Patient and Encounter ONCE per list (not
 * per row) through the caller's own governed service, so a role that may not read one simply gets nulls, never an
 * error and never somebody else's name. The ward and bed are the encounter's CURRENT location.
 */

const str = (v) => (v == null ? "" : String(v).trim());

/** rows: [{patientId, encounterId?}] -> Map(patientId|encounterId -> {name, mrn, ward, bed}). Never throws. */
async function patientLabels(svc, rows) {
  const pids = [...new Set((rows || []).map((r) => str(r && r.patientId)).filter(Boolean))];
  const eids = [...new Set((rows || []).map((r) => str(r && r.encounterId)).filter(Boolean))];
  const safe = (type, id) => svc.get(type, id).catch(() => null);
  const [patients, encounters] = await Promise.all([Promise.all(pids.map((id) => safe("Patient", id))), Promise.all(eids.map((id) => safe("Encounter", id)))]);
  const p = new Map(pids.map((id, i) => [id, patients[i]])), e = new Map(eids.map((id, i) => [id, encounters[i]]));
  const out = new Map();
  for (const r of rows || []) {
    const pat = p.get(str(r && r.patientId)) || null, enc = e.get(str(r && r.encounterId)) || null;
    out.set(`${str(r && r.patientId)}|${str(r && r.encounterId)}`, {
      name: (pat && (pat.name || pat.display)) || null, mrn: (pat && pat.mrn) || null,
      ward: (enc && enc.location && enc.location.ward) || null, bed: (enc && enc.location && enc.location.bed) || null,
    });
  }
  return out;
}

const labelKey = (r) => `${str(r && r.patientId)}|${str(r && r.encounterId)}`;

/** PURE. The name a signed-in actor's sign-in gave (account name, else email), or null when all it has is its id:
 * stored beside the id on a record so a board shows a person, never a sign-in uid. The id remains the audit key. */
function actorName(actor) {
  const d = str(actor && actor.display);
  return d && d !== str(actor && actor.id) ? d : null;
}

export { patientLabels, labelKey, actorName };
