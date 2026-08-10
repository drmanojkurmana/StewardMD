/* StewardMD — GHIS Initial-Assessment write-back config + helpers (pure, no CF deps).
 * ---------------------------------------------------------------------------
 * Imported by functions/api/ghis/[[path]].js. Node-testable in isolation.
 *
 * The write route is FAIL-CLOSED: until GHIS_SAVE_PATH + GHIS_FIELD_MAP are filled from one live
 * GHIS session, buildAssessmentBody() refuses (ghis_mapping_not_configured) and the app keeps the
 * local save + tells the doctor sign-off is pending. We NEVER post guessed field names.
 *
 * ONE-TIME DISCOVERY (owner, live GHIS session):
 *   GET /api/ghis/assessment-form?patientId=<MR>   → parseFormInputs() returns every input's
 *   {name,id,type,label,options}. For each StewardMD field id (see assessment-schema.js) paste the
 *   matching GHIS input `name` into GHIS_FIELD_MAP below; set GHIS_SAVE_PATH to the form's POST
 *   action (the Submit handler's URL). Radios/selects whose GHIS wire value differs from the label
 *   get a `map:{StewardMDValue: ghisWireValue}`. Then Save & sign off writes for real.
 */

// The form's POST action (e.g. '/Doctor/Home/SaveInitialAssessmentnew'). null ⇒ not configured.
export const GHIS_SAVE_PATH = null;

// StewardMD assessment field id → GHIS form input. Empty ⇒ not configured (fail-closed).
//   'fieldId': { name: '<ghis input name>', map?: { '<smd value>': '<ghis wire value>' } }
//   '__patientId': { name: '<hidden patient-id field name>' }   // set from the request's patientId
export const GHIS_FIELD_MAP = {
  // --- FILL FROM DISCOVERY, e.g.: ---
  // __patientId:  { name: 'PatientId' },
  // cc:           { name: 'txtChiefComplaints' },
  // temp:         { name: 'txtTemperature' },
  // bpSys:        { name: 'txtBpSystolic' },
  // bpDia:        { name: 'txtBpDiastolic' },
  // pulse:        { name: 'txtPulseRate' },
  // tenderness:   { name: 'rdoTenderness', map: { Yes: '1', No: '0' } },
  // pallor:       { name: 'chkPallor',     map: { 'true': 'on', 'false': '' } },
  // ...
};

// Build the x-www-form-urlencoded body GHIS expects, or refuse if unconfigured.
// fields = { schemaFieldId: value }.  Returns { ok, body } | { ok:false, error }.
export function buildAssessmentBody(fields, opts) {
  opts = opts || {};
  const map = opts.map || {};
  const savePath = opts.savePath;
  const mapped = Object.keys(map).filter((k) => k.indexOf('__') !== 0);   // real fields, not __patientId
  if (!savePath || mapped.length === 0) return { ok: false, error: 'ghis_mapping_not_configured' };

  const p = new URLSearchParams();
  if (opts.csrf) p.set('__RequestVerificationToken', opts.csrf);
  if (map.__patientId && map.__patientId.name && opts.patientId != null) p.set(map.__patientId.name, String(opts.patientId));

  for (const fid of Object.keys(fields || {})) {
    const e = map[fid];
    if (!e || !e.name) continue;                       // unmapped field → skip, never guess
    let wire = e.map ? e.map[String(fields[fid])] : fields[fid];
    if (wire == null || wire === '') continue;         // empty/unmapped value → skip
    p.set(e.name, String(wire));
  }
  return { ok: true, body: p.toString() };
}

// Discovery aid: pull the form's inputs/selects/textareas + their labels from the GHIS HTML.
// Regex-based (no DOM in the Worker runtime). Best-effort — the owner eyeballs the result.
export function parseFormInputs(html) {
  const s = String(html || '');
  // label text by `for` target
  const labels = {};
  let m, re = /<label[^>]*\bfor\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi;
  while ((m = re.exec(s))) labels[m[1]] = stripTags(m[2]);

  const out = [];
  // inputs
  re = /<input\b([^>]*)>/gi;
  while ((m = re.exec(s))) {
    const a = attrs(m[1]);
    if (!a.name && !a.id) continue;
    out.push({ tag: 'input', type: (a.type || 'text').toLowerCase(), name: a.name || '', id: a.id || '', value: a.value || '', label: labels[a.id] || '' });
  }
  // textareas
  re = /<textarea\b([^>]*)>/gi;
  while ((m = re.exec(s))) { const a = attrs(m[1]); if (!a.name && !a.id) continue; out.push({ tag: 'textarea', type: 'textarea', name: a.name || '', id: a.id || '', label: labels[a.id] || '' }); }
  // selects (+ options)
  re = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((m = re.exec(s))) {
    const a = attrs(m[1]); if (!a.name && !a.id) continue;
    const opts = []; let om, ore = /<option[^>]*\bvalue\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
    while ((om = ore.exec(m[2]))) opts.push({ value: om[1], label: stripTags(om[2]) });
    out.push({ tag: 'select', type: 'select', name: a.name || '', id: a.id || '', label: labels[a.id] || '', options: opts });
  }
  return out;
}

function attrs(str) {
  const o = {}; let m, re = /([a-zA-Z_:-]+)\s*=\s*["']([^"']*)["']/g;
  while ((m = re.exec(str))) o[m[1].toLowerCase()] = m[2];
  return o;
}
function stripTags(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim(); }
