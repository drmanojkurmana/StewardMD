// connect-agent/phone/guards.mjs - the safety checks an adapter's reads and proofs go through on the
// phone. Ported in spirit from goodnight000/api-anything (MIT): "a call that can't be repaired returns
// an error, never someone else's data", the two-run check that a parameter is really read by the
// server, and the save-time scan that keeps a live session value out of a stored request.
//
// Flag: smd_connect_guards, default ON (owner decision 2026-11-12: the checks fail closed, so a doctor
// sees "not read" rather than another patient's chart). `?connect_guards=0` or
// localStorage smd_connect_guards = "0" turns them off; the reads then behave as before.
//
// Pure apart from the flag lookup. Nothing here stores or sends a value.

let override = null;
/** Test seam: force the flag on or off (null restores the normal lookup). */
export function setGuards(on) { override = on == null ? null : !!on; }

export function guardsOn() {
  if (override !== null) return override;
  try {
    const q = typeof location !== 'undefined' && location && location.search ? String(location.search) : '';
    const m = q.match(/[?&](?:connect_guards|smd_connect_guards)=([^&]+)/i);
    if (m) return !/^(0|off|false|no)$/i.test(decodeURIComponent(m[1]));
  } catch { /* no location */ }
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem('smd_connect_guards') : null;
    if (v != null) return !/^(0|off|false|no)$/i.test(String(v));
  } catch { /* storage blocked */ }
  return true;
}

/* ---- patient identity ------------------------------------------------------------------------- */

/* The field names that hold WHO the row is about. Visit, episode and admission ids are left out on
 * purpose: a history or discharge list legitimately carries this patient's earlier visits. Matched on
 * the key folded to letters, by its end, so `patient.id`, `Patient ID`, `PatientMRN` and `UHID No.` all
 * count, and a row's own `id` or a lab's `Render_ID` never does. */
const ID_ENDINGS = ['patientid', 'patientno', 'patientmrn', 'mrn', 'mrno', 'uhid', 'uhidno', 'umrno', 'hospitalno', 'hospitalid', 'hospno', 'regno', 'registrationno', 'registrationid', 'crno'];
export function isIdentityKey(key) {
  const k = String(key || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!k || k.length > 40) return false;
  return ID_ENDINGS.some((e) => k === e || (k.endsWith(e) && e.length >= 5));
}

/** An identifier folded for comparison: letters and digits only, upper case. */
export function normId(v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/* An id only counts when it looks like one: a digit in it and three or more characters. "NA", "-" and
 * a name typed into the wrong column prove nothing either way. */
function idLike(n) { return n.length >= 3 && /\d/.test(n); }

/** The same patient: equal, or one is the other with a prefix the hospital adds ("MR123" / "123"). */
export function sameId(a, b) {
  const x = normId(a), y = normId(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && /\d/.test(s) && l.endsWith(s) && /^[A-Z]{1,4}$/.test(l.slice(0, l.length - s.length));
}

/** The ids the patient is known by (the list's patient id, plus any identity column of its own row). */
export function patientIdsOf(patient) {
  const out = [];
  const add = (v) => { const n = normId(v); if (idLike(n) && !out.includes(n)) out.push(n); };
  if (!patient || typeof patient !== 'object') return out;
  add(patient.patientId);
  const row = patient._row;
  if (row && typeof row === 'object') for (const k of Object.keys(row)) if (isIdentityKey(k)) add(row[k]);
  return out;
}

/**
 * foreignRows(rows, patient) -> how many rows say, in an identity field, that they belong to someone
 * else. A row that names no patient is not counted: it cannot be checked here (the two-patient proof
 * checked its request at learn time instead).
 */
export function foreignRows(rows, patient) {
  const mine = patientIdsOf(patient);
  if (!mine.length || !Array.isArray(rows)) return 0;
  let n = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    for (const k of Object.keys(r)) {
      if (!isIdentityKey(k)) continue;
      const v = normId(r[k]);
      if (!idLike(v)) continue;
      if (!mine.some((m) => sameId(m, v))) { n += 1; break; }
    }
  }
  return n;
}

/**
 * guardSections(sections, patient) -> sections, with every section whose rows name another patient
 * replaced by { resource, unreadable: 'other-patient' }. One foreign row condemns the whole section:
 * a hospital that answered with a mix is not answering about this patient.
 */
export function guardSections(sections, patient) {
  if (!Array.isArray(sections)) return sections;
  return sections.map((s) => {
    if (!s || !Array.isArray(s.rows) || !s.rows.length) return s;
    return foreignRows(s.rows, patient) ? { resource: s.resource, unreadable: 'other-patient' } : s;
  });
}

/* ---- live values in a stored request ---------------------------------------------------------- */

/* What a page realm holds that a request must never carry as a constant: cookie values, storage
 * values (and the strings inside a JSON entry, as auth libraries keep tokens), hidden token inputs and
 * token meta tags. Runs in the hospital page; only the values come back, to the app realm, and they are
 * compared there and dropped. */
export const LIVE_VALUES_SRC = "(function(){var out=[];function add(v){v=String(v==null?'':v);if(v.length>=6&&v.length<=4096&&out.indexOf(v)<0)out.push(v);}function walk(x,d){if(d>3||x==null)return;if(typeof x==='string'){add(x);return;}if(typeof x==='object'){for(var k in x){if(Object.prototype.hasOwnProperty.call(x,k))walk(x[k],d+1);}}}try{(document.cookie||'').split(';').forEach(function(c){var i=c.indexOf('=');if(i>0){var v=c.slice(i+1).trim();add(v);try{add(decodeURIComponent(v));}catch(e){}}});}catch(e){}[typeof localStorage!=='undefined'?localStorage:null,typeof sessionStorage!=='undefined'?sessionStorage:null].forEach(function(s){try{if(!s)return;for(var i=0;i<s.length&&i<200;i++){var v=s.getItem(s.key(i));add(v);try{walk(JSON.parse(v),0);}catch(e){}}}catch(e){}});try{var ins=document.querySelectorAll('input[type=\"hidden\"],meta[name]');for(var j=0;j<ins.length&&j<200;j++){var n=(ins[j].getAttribute('name')||'');if(/token|verification|csrf|xsrf|antiforgery|nonce|session|auth|key/i.test(n))add(ins[j].value||ins[j].getAttribute('content'));}}catch(e){}return JSON.stringify(out.slice(0,400));})()";

/* Random-looking: 16+ characters of one unbroken run that mixes letters with at least two digits and
 * carries 3.5+ bits a character. A mode value ("IPWorkList", "InPatientWorkList", "Arrived and
 * Occupied") has no digits or has spaces; a session key has both letters and scattered digits. A
 * 24+ character run of very high entropy counts whatever its digits. */
function entropy(s) {
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let h = 0;
  for (const ch of Object.keys(freq)) { const p = freq[ch] / s.length; h -= p * Math.log2(p); }
  return h;
}
export function randomLooking(v) {
  const s = String(v == null ? '' : v);
  if (s.length < 16 || /\s/.test(s)) return false;
  const digits = (s.match(/\d/g) || []).length, letters = (s.match(/[A-Za-z]/g) || []).length;
  const h = entropy(s);
  if (s.length >= 24 && h >= 4.2) return true;
  return digits >= 2 && letters >= 4 && h >= 3.5;
}

/** A constant that is, or holds, a live session value (8+ characters in common), or looks like a key. */
export function secretConstant(value, live = []) {
  const v = String(value == null ? '' : value);
  if (!v) return false;
  if (randomLooking(v)) return true;
  for (const l of Array.isArray(live) ? live : []) {
    const s = String(l == null ? '' : l);
    if (s.length < 6) continue;
    if (v === s) return true;
    if (s.length >= 8 && v.includes(s)) return true;
    if (v.length >= 8 && s.includes(v) && s.length <= 4 * v.length) return true;
  }
  return false;
}

/**
 * scrubConstants(params, live) -> params with every `{constant}` that is a live session value or
 * looks like a key turned into `{token: true}` when the field is named like one, else `{unmapped: true}`
 * (the runtime then sends it empty, or the patient's id for a patient key). Returns how many changed.
 */
export function scrubConstants(params, live = []) {
  const out = {};
  let changed = 0;
  for (const k of Object.keys(params || {})) {
    const s = params[k];
    if (s && s.constant != null && secretConstant(s.constant, live)) {
      out[k] = /token|verification|csrf|xsrf|antiforgery|nonce/i.test(k) ? { token: true } : { unmapped: true };
      changed += 1;
    } else out[k] = s;
  }
  return { params: out, changed };
}
