/* StewardMD — GHIS API (Cloudflare Pages Function) — per-doctor login
 * ---------------------------------------------------------------------------
 * DEPLOY PATH:   functions/api/ghis/[[path]].js   ->  https://stewardmd.in/api/ghis/*
 *
 * Each doctor logs in with their OWN GHIS id + password (proper audit trail).
 * The login password is NEVER stored: it opens a GHIS session for that request only.
 * The token maps to a short-lived session (cookie jar) in KV; when GHIS times out the
 * doctor logs in again. EXCEPTION: doctors who explicitly enabled Lab Watch 24/7 have
 * their creds stored ENCRYPTED (with consent) so the background poll works — for them,
 * /api/ghis/refresh silently re-mints a session from those same creds (no re-prompt).
 *
 * REQUIRED Cloudflare Pages settings:
 *   KV namespace binding:  GHIS_KV        (stores short-lived sessions only)
 *   (GHIS_ENC_KEY is no longer used for credential storage; GHIS_USER/GHIS_PASS
 *    are not needed. Purge any legacy "cred:" keys from GHIS_KV after deploy.)
 *
 * Endpoints:
 *   POST /api/ghis/login    {userId,password,remember}     -> {token, userId}
 *   POST /api/ghis/logout   (Authorization: Bearer <token>)-> {ok:true}
 *   GET  /api/ghis/status | patients | lab | lab-detail | radiology | radiology-report | medications
 *        (all require  Authorization: Bearer <token>)
 * ---------------------------------------------------------------------------
 */

import { identify } from '../../_fbauth.js';
import { getCred } from '../../_watch.js';
import { requirePro } from '../../_entitlement.js';

const GHIS = 'https://ghis.gitam.edu';
const SSO  = 'https://gimsrlogin.gitam.edu';
const SESSION_TTL_MS = 15 * 60 * 1000;     // refresh within GHIS's ~20-min idle window
const SESS_KV_TTL = 1800;                  // 30 min in KV

// EMR write-back master gate (P2/P3/P4). Writes into a LIVE hospital EMR, so every POST route is INERT
// (returns 501, nothing reaches GHIS) unless the owner sets QUEUE_EMR_WRITE=1 server-side AFTER verifying
// the reverse-engineered payloads against a real captured request. This is one of TWO independent gates
// (the other is the client flag smd_opd_emr_write) plus an explicit user confirm() — all three required.
function emrWriteEnabled(env) { return env && env.QUEUE_EMR_WRITE === '1'; }

// ── crypto (encrypt stored credentials) ──────────────────────────────────────
const b64ToBytes = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const bytesToB64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
async function aesKey(env) { return crypto.subtle.importKey('raw', b64ToBytes(env.GHIS_ENC_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function encryptJson(env, obj) {
  const key = await aesKey(env); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return bytesToB64(iv) + '.' + bytesToB64(new Uint8Array(ct));
}
async function decryptJson(env, s) {
  const [ivB, ctB] = s.split('.'); const key = await aesKey(env);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(ivB) }, key, b64ToBytes(ctB));
  return JSON.parse(new TextDecoder().decode(pt));
}
const randToken = () => { const u = crypto.getRandomValues(new Uint8Array(24)); return Array.from(u, b => b.toString(16).padStart(2, '0')).join(''); };

// ── cookie jar + fetch helpers ───────────────────────────────────────────────
function jarSet(jar, host, res) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const c of all) { const p = c.split(';')[0]; const i = p.indexOf('='); if (i < 0) continue; (jar[host] = jar[host] || {})[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
}
const jarHeader = (jar, host) => Object.entries(jar[host] || {}).map(([k, v]) => `${k}=${v}`).join('; ');
async function raw(jar, method, url, body, extra = {}) {
  const u = new URL(url);
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': jarHeader(jar, u.hostname), ...extra };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
  const res = await fetch(url, { method, body: body || undefined, headers, redirect: 'manual' });
  jarSet(jar, u.hostname, res);
  return { status: res.status, location: res.headers.get('location'), body: await res.text(), url };
}
async function follow(jar, r, max = 10) { let n = 0; while (r.status >= 300 && r.status < 400 && r.location && n < max) { r = await raw(jar, 'GET', new URL(r.location, r.url).href); n++; } return r; }
const parseGhis = (b) => { if (!b) return []; try { let v = JSON.parse(b); return typeof v === 'string' ? JSON.parse(v) : v; } catch { return []; } };
function htmlToText(s){ if(!s) return ''; return String(s).replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6])\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&ndash;/gi,'–').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\n{3,}/g,'\n\n').replace(/[ \t]{2,}/g,' ').trim(); }

// ── GHIS login (one doctor's credentials) ────────────────────────────────────
// Best-effort scrape of the logged-in doctor's display name from GHIS home HTML (falls back to '' -> the
// client shows "Dr <userId>"). GHIS shows an all-caps name in the top bar (e.g. "CHANDU GOPALA KRISHNA").
function parseDoctorName(html) {
  html = String(html || '');
  var m = html.match(/(?:Welcome[,\s]+|Dr\.?\s+)([A-Z][A-Z][A-Z .]{4,44}[A-Z])/) ||
          html.match(/(?:data-user-name|data-username|title)="([A-Z][A-Z][A-Z .]{5,44})"/) ||
          html.match(/>\s*([A-Z]{2,}(?:\s+[A-Z]{2,}){1,3})\s*<\/(?:span|b|strong|div|a)>/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}
async function loginGhis(userId, password) {
  const jar = {};
  const lp = await raw(jar, 'GET', SSO + '/');
  const token = (lp.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || '';
  const form = `USER_ID=${encodeURIComponent(userId)}&PASSWORD=${encodeURIComponent(password)}&__RequestVerificationToken=${encodeURIComponent(token)}&X-Requested-With=XMLHttpRequest`;
  const li = await raw(jar, 'POST', SSO + '/Index', form, { 'X-Requested-With': 'XMLHttpRequest', 'Referer': SSO + '/' });
  let ok = false; try { ok = (JSON.parse(li.body).param1 == 200); } catch {}
  if (!ok) { const e = new Error('bad_credentials'); e.code = 'bad_credentials'; throw e; }
  // SSO -> GHIS launch handoff (THE fix for empty worklists). The SSO /apps launcher links each module to
  // /route?id=<encrypted>. The "Doctor" module's route 302s SSO /route -> GHIS /Login/?id=<token> -> /Doctor/Home,
  // and ONLY that establishes a DATA-capable ghis.gitam.edu session. Hitting /Doctor/Home directly (as before)
  // yields a session that loads page shells but returns EMPTY worklists (IPD "No data", OPD 0 rows). Parse the
  // Doctor route from /apps; fall back to the known module id if the label markup ever changes.
  const apps = await raw(jar, 'GET', SSO + '/apps');
  const rm = (apps.body || '').match(/href="(route\?id=[^"]+)"[\s\S]{0,400}?<h4>\s*Doctor\s*<\/h4>/i) || (apps.body || '').match(/href="(route\?id=[^"]+)"/i);
  const routePath = ((rm && rm[1]) || 'route?id=k/9J1c3NUFVni8P5uxUR6Q==').replace(/&amp;/g, '&');
  const homeResp = await follow(jar, await raw(jar, 'GET', SSO + '/' + routePath));   // -> GHIS/Login -> /Doctor/Home
  const cookie = jarHeader(jar, 'ghis.gitam.edu');
  if (!/AspNetCore\.Session/.test(cookie)) throw new Error('session_not_established');
  const wl = await raw({ 'ghis.gitam.edu': Object.fromEntries(cookie.split('; ').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; })) }, 'GET', GHIS + '/Doctor/Home/Nurseipwlnew/?id=');
  const csrf = (wl.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || '';
  const doctorName = parseDoctorName((homeResp && homeResp.body) || '') || parseDoctorName(wl.body || '');
  return { cookie, csrf, doctorName };
}

// ── per-token session (token-only; passwords are NEVER stored) ───────────────
// The token maps to a short-lived GHIS session (cookie jar) in KV. When the GHIS
// session expires, the doctor simply logs in again — we do not persist credentials
// and cannot silently re-login. This removes stored-password risk entirely.
async function getSession(env, token) {
  if (!token || !env.GHIS_KV) return null;
  const sess = await env.GHIS_KV.get('sess:' + token, 'json');
  return sess ? { token, ...sess } : null;   // GHIS validates freshness; a stale cookie → unauth → re-login
}
async function ghisReq(env, token, method, path, body, extra = {}) {
  let s = await getSession(env, token);
  if (!s) return { unauth: true };
  const doFetch = (sess) => {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept': '*/*', 'Referer': GHIS + '/Doctor/Home', 'Cookie': sess.cookie, ...extra };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    return fetch(GHIS + path, { method, body: body || undefined, headers, redirect: 'manual' });
  };
  let res = await doFetch(s);
  // A 302 = GHIS session expired. Stored-credential auto-refresh was intentionally removed (no stored
  // passwords), so surface unauth and let the client re-login — never call the removed refreshFromCreds()
  // (that dangling reference threw a ReferenceError on every session expiry).
  if (res.status === 302) return { unauth: true };
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  return { status: res.status, body: await res.text(), csrf: s.csrf, setCookie: setCookie };
}
// Overlay any Set-Cookie values onto a cookie string (last-write-wins), so a POST can carry the
// fresh .AspNetCore.Antiforgery cookie GHIS handed back on the preceding form GET.
function mergeCookies(base, setCookieArr) {
  const jar = {};
  String(base || '').split(/;\s*/).forEach(p => { const i = p.indexOf('='); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1); });
  (setCookieArr || []).forEach(c => { const p = String(c).split(';')[0]; const i = p.indexOf('='); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return Object.keys(jar).map(k => k + '=' + jar[k]).join('; ');
}

// ── data endpoints ───────────────────────────────────────────────────────────
async function getPatients(env, token) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const p = new URLSearchParams({ NursingStationId:'', PatientId:'', FloorId:'', Emp_ID:'', Dept_ID:'', Type:'IPWorkList', __RequestVerificationToken: s.csrf });
  const r = await ghisReq(env, token, 'GET', '/Doctor/Home/GetIPWL?' + p.toString(), null, { 'X-Requested-With': 'XMLHttpRequest' });
  return r.unauth ? r : parseGhis(r.body);
}
// OPD (out-patient) worklist — the Smart OPD Queue's live source. GITAM endpoint captured 2026-08-07:
//   GET /Doctor/Home/DashboardUnit?type=docopdlist&sdate=<DD-MON-YYYY>&checkbox=0
// (No CSRF in the query, unlike GetIPWL.) Normalise the DataTables-ish body to a plain rows array.
// GHIS's OPD day is IST (Asia/Kolkata, UTC+5:30). Cloudflare runs in UTC, so shift +5:30 before reading the
// date, else near/after local midnight we query the wrong day and the Out-patients list comes back empty.
function ghisDay(offMs) { const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; const d = new Date(Date.now() + 19800000 + (offMs || 0)); return ('0' + d.getUTCDate()).slice(-2) + '-' + M[d.getUTCMonth()] + '-' + d.getUTCFullYear(); }
function ghisToday() { return ghisDay(0); }
function ghisYesterday() { return ghisDay(-86400000); }
// DashboardUnit returns text/html (a DataTable fragment), NOT JSON. Parse it by HEADER LABEL so the mapping
// survives column reordering: <th> texts -> field, then each <tbody> <tr>'s <td>s map to those fields.
// The docopdlist worklist mixes visit types (OPD / EMERGENCY / IP). The browser's "Out patients" tab
// keeps only Visit type == OPD; match it exactly so the app never imports Emergency/IP patients into the
// OPD queue. Column 9 of the worklist ("Visit type") holds the value; OPD rows read "OPD".
export const isOpdVisit = (r) => { const vt = String((r && r.visitType) || '').trim().toUpperCase(); return vt === 'OPD' || vt === 'OP' || vt.indexOf('OUT') === 0; };
export function parseOpdHtml(html) {
  html = String(html || ''); if (html.indexOf('<') < 0) return [];
  const strip = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const fieldFor = (label) => { const t = strip(label).toLowerCase().replace(/[^a-z]/g, '');
    if (/doctor|consultant|physician|practitioner/.test(t)) return 'doctor';   // BEFORE 'name' so "Doctor name" != patient
    if (/patientid|^mrno|mrnumber|uhid|^mrn/.test(t)) return 'patientId';
    if (/visitid|opno|visitno|episode/.test(t)) return 'visitId';
    if (/patientname|patientfullname|^name$|^pname/.test(t)) return 'patientName';
    if (/department|dept/.test(t)) return 'department';
    if (/^age/.test(t)) return 'age';
    if (/gender|^sex/.test(t)) return 'gender';
    if (/visittype|optype/.test(t)) return 'visitType';
    if (/queuestatus/.test(t)) return 'queueStatus';
    if (/mobile|contact|phone/.test(t)) return 'mobile';
    return ''; };
  const head = (html.match(/<th[\s\S]*?<\/th>/gi) || []).map(fieldFor);
  const rows = [];
  // Parse EVERY <tr> with data cells (works with or without <tbody>). First column mapping to a field wins,
  // so a later "Doctor name" can't overwrite the patient name. Keep only real OPD rows (a patient id present).
  (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach((tr) => {
    const tds = tr.match(/<td[\s\S]*?<\/td>/gi); if (!tds || tds.length < 4) return;
    const o = {}; tds.forEach((td, i) => { const f = head[i]; if (f && !o[f]) o[f] = strip(td); });
    if (o.patientId && /[A-Za-z0-9]/.test(o.patientId) && (o.patientName || o.visitId)) rows.push(o);
  });
  return rows;
}
export async function getOpdPatients(env, token, sdate, debug, cb) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  // Prime the OPD dashboard context. Login fetches the IPD nurse worklist (Nurseipwlnew) for its CSRF token,
  // which leaves the GHIS session in in-patient context -> the OPD list (docopdlist) then returns an empty
  // shell. Hitting /Doctor/Home (the Out-patients dashboard the browser fires docopdlist from) resets it.
  let home = null; try { home = await ghisReq(env, token, 'GET', '/Doctor/Home', null, {}); } catch (e) {}
  const pull = async (day, cbVal) => {
    const p = new URLSearchParams({ type: 'docopdlist', sdate: day, checkbox: String(cbVal) });
    const r = await ghisReq(env, token, 'GET', '/Doctor/Home/DashboardUnit?' + p.toString(), null, { 'X-Requested-With': 'XMLHttpRequest' });
    if (r.unauth) return { unauth: true };
    const j = parseGhis(r.body);                             // fallback: some GHIS actions return JSON
    const parsed = parseOpdHtml(r.body).filter(isOpdVisit);  // OPD visit-type only == browser "Out patients" tab
    const rows = (Array.isArray(j) && j.length) ? j : (j && Array.isArray(j.data) && j.data.length) ? j.data : parsed;
    return { r: r, rows: rows, day: day, cb: cbVal };
  };
  // Match the browser's "Out patients" tab exactly: TODAY only, checkbox=0 (the doctor's own patients).
  // No yesterday fallback (it would import stale rows) and no widen-to-All-patients (it would break the
  // per-doctor scoping the owner requires). An explicit ?cb/?sdate pins the query (diagnostics).
  const days = sdate ? [sdate] : [ghisToday()];
  const cbs = (cb == null || cb === '') ? ['0'] : [String(cb)];
  let res = null;
  for (let di = 0; di < days.length && (!res || !res.rows || !res.rows.length); di++) {
    for (let ci = 0; ci < cbs.length; ci++) {
      const rr = await pull(days[di], cbs[ci]);
      if (rr.unauth) return rr;
      if (!res) res = rr;
      if (rr.rows && rr.rows.length) { res = rr; break; }
    }
  }
  // ?raw=1 diagnostic: surface the actual DashboardUnit response + row counts so the parser/account can be verified.
  if (debug) {
    const rb = String(res.r.body || '');
    return { _debug: true, sdate: res.day, cb: (cb == null || cb === '') ? '0' : String(cb), homeLen: (home && home.body || '').length,
      rawLen: rb.length, tdCount: (rb.match(/<td\b/gi) || []).length, parsed: res.rows.length, raw: rb.slice(0, 2500) };
  }
  return res.rows;                                            // DashboardUnit = text/html table (parseOpdHtml)
}
// ── patient demographics → primary contact number (for FollowCare enrollment) ───────────
// GHIS exposes the patient's phone on the Initial-Assessment form (GetInitialAssessmentnew?id=<MR>), NOT on
// the doctor worklist. We fetch that ONE form for a given MR and extract ONLY the primary contact number —
// nothing else is returned (minimise PHI). Used lazily when a doctor enrolls a discharged patient.
async function getDemographics(env, token, patientId, recordNo) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  if (!recordNo) return { phone: '' };   // recordNo = "<MR>-<IPMR episode>"; needed to load the patient page
  // Rebuild a cookie JAR from the stored session so cookies set during the flow propagate across calls.
  const jar = { 'ghis.gitam.edu': {} };
  String(s.cookie || '').split('; ').forEach(function (p) { const i = p.indexOf('='); if (i > 0) jar['ghis.gitam.edu'][p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  const extra = { 'X-Requested-With': 'XMLHttpRequest', 'Referer': GHIS + '/Doctor/home' };
  // POST Searchnew returns the patient's full details page (the "More.." demographics) — it CONTAINS the
  // primary contact number directly, so we extract from THIS response (GetInitialAssessmentnew 302s to SSO
  // for a server session and is not needed).
  const sr = await raw(jar, 'POST', GHIS + '/Doctor/Home/Searchnew',
    '__RequestVerificationToken=' + encodeURIComponent(s.csrf || '') + '&recordNo=' + encodeURIComponent(recordNo), extra);
  if (sr.status >= 300 && sr.status < 400) return { unauth: true };
  // `region` = a short PATIENT-address snippet (state/district/city). We anchor on the patient's address
  // labels so we don't accidentally pick up the HOSPITAL's city elsewhere on the page — the client runs the
  // deterministic language detector over it. Best-effort: "" if the labels aren't found (falls back to en).
  return { phone: extractPrimaryContact(sr.body || ''), region: extractRegion(sr.body || '') };
}
// Find the primary-contact mobile: locate a contact label, then the nearest 10-digit Indian mobile (6-9 start)
// within a window. Prefers "Primary contact number"; falls back to secondary/mobile/contact labels. Returns "".
function extractPrimaryContact(body) {
  const labels = ['Primary contact number', 'primaryContactNumber', 'PrimaryContactNumber', 'Primary Contact', 'Secondary contact number', 'Mobile No', 'MobileNo', 'mobileNo', 'Mobile', 'Contact number', 'contactNumber'];
  for (let i = 0; i < labels.length; i++) {
    const idx = body.indexOf(labels[i]); if (idx < 0) continue;
    const m = body.slice(idx, idx + 1500).match(/[^0-9]([6-9]\d{9})(?!\d)/);
    if (m) return m[1];
  }
  return '';
}
// Best-effort patient-address snippet for language detection. Anchors on address/state/district/city labels
// (case-insensitive), captures a short window after each, strips HTML tags/entities, and concatenates. Never
// throws; returns "" when nothing address-like is found. NO phone/name/PHI beyond locality text is returned.
function extractRegion(body) {
  const labels = ['Permanent Address', 'Present Address', 'PermanentAddress', 'PresentAddress', 'Address', 'State', 'District', 'City', 'Town', 'Mandal', 'Taluk', 'Village', 'Locality', 'Area'];
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    let from = 0, idx;
    const needle = labels[i].toLowerCase(), low = body.toLowerCase();
    while ((idx = low.indexOf(needle, from)) !== -1 && out.length < 12) {
      const win = body.slice(idx + labels[i].length, idx + labels[i].length + 140)
        .replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/[^A-Za-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (win) out.push(win);
      from = idx + labels[i].length;
    }
  }
  return out.join(' ').slice(0, 400);
}
async function getLabOrders(env, token, patientId) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const r = await ghisReq(env, token, 'POST', '/Lab/Home/GetSearchPatientId', `__RequestVerificationToken=${encodeURIComponent(s.csrf)}&patient_id=${encodeURIComponent(patientId)}&DeptID=&FDate=&EDate=`, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  return { orders: parseGhis(r.body).map(o => ({ serviceName:o.parameter_long_desc, orderDate:o.OrderDate, department:o.Department_desc, status:o.pstatus, renderId:o.ServiceRenderId, episodeId:o.episode_id, orderId:o.order_id, valueType:o.ValueType })) };
}
// ── medication list (authorized session) ────────────────────────────────────
// Verified against a live GHIS session (2026-07): the Doctor-module "Medications"
// view (left-menu loadView('4')) fires GET /Doctor/Home/GetMedicines/?id={MR}
// where {MR} is the patient MR number (the same id the Lab endpoints use — NOT the
// IPMR episode id). No form body / CSRF token is needed for this read call. It
// returns an HTML table, 12 <td> per data row, in this column order:
//   0 Prod.Code | 1 Drug Name | 2 Route | 3 Dosage | 4 Qty | 5 Freq |
//   6 Duration  | 7 Total qty | 8 Admin Instr | 9 Remarks | 10 Date & Time | 11 gen by
async function getMedications(env, token, patientId) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const r = await ghisReq(env, token, 'GET',
    '/Doctor/Home/GetMedicines/?id=' + encodeURIComponent(patientId || ''),
    null, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  // Strip <script>/<style> so the page's own row-building JS template
  // (literal `" + item.description + "`) is never scraped as a med row.
  const body = (r.body || '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const rows = [];
  for (const tr of (body.match(/<tr[\s\S]*?<\/tr>/gi) || [])) {
    // Entry-form rows carry form controls, not data — their <select> option
    // lists otherwise flatten into blobs like "ORALTOPICALOTIC…". Skip them.
    if (/<(select|option|input|textarea|button)\b/i.test(tr)) continue;
    const tds = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(td => htmlToText(td));
    if (tds.length < 7) continue;                                 // header (<th>) / non-data rows
    const drugText = (tds[1] || '').trim();
    if (!drugText || /^drug\s*name$/i.test(drugText)) continue;   // skip a stray header-in-<td>
    if (/\bitem\.\w+|["']\s*\+\s*"/.test(drugText)) continue;     // leftover JS-template junk
    // PHI-strip: keep ONLY medication fields — never the "gen by" staff name (tds[11]),
    // patient identity, or billing/balance figures elsewhere on the page.
    rows.push({
      productCode: (tds[0] || '').trim(),
      drugText:    drugText,
      route:       (tds[2] || '').trim(),
      dosage:      (tds[3] || '').trim(),
      frequency:   (tds[5] || '').trim(),
      duration:    (tds[6] || '').trim(),
      dept:        '',
      dateTime:    (tds[10] || '').trim(),
    });
  }
  return { rows };
}
async function getLabDetail(env, token, renderId, episodeId) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const r = await ghisReq(env, token, 'POST', '/Lab/Home/GetPrintLabResultDetailsAuth', `__RequestVerificationToken=${encodeURIComponent(s.csrf)}&Render_ID=${encodeURIComponent(renderId)}&Episode_Id=${encodeURIComponent(episodeId)}&Result_Type=a`, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  const rows = parseGhis(r.body); const h = rows[0] || {};
  return { group: h.GroupTestName || h.parameter_long_desc || '', department: h.Department || '', sampleType: h.SampleType, collected: h.date_of_collection, reported: h.ReportTime,
    tests: rows.map(x => ({ test:x.TestName, result:x.Result, units:x.Units, low:x.LowValue, high:x.HighValue, range:(x.LowValue||x.HighValue)?`${x.LowValue||''} - ${x.HighValue||''}`:'', critical:x.CriticalValue, method:x.methodologyName, valueType:x.ValueType, antibiogram:x.AntiOrgansData||x.DynamicLoadOrganstList||'' })) };
}
async function getRadiologyOrders(env, token, patientId) {
  const r = await ghisReq(env, token, 'GET', `/Radio/Home?recordNo=${encodeURIComponent(patientId)}`, null, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  const orders = []; for (const tr of (r.body.match(/<tr[\s\S]*?<\/tr>/gi) || [])) {
    if (!/Radiology(Manual|Automated)?print|Radiologyprint/i.test(tr)) continue;
    const tds = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(td => td.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
    const fn = tr.match(/(RadiologyManualprint|RadiologyAutomatedprint|Radiologyprint)\(\s*['"]?(\d+)/i) || [];
    const resultid = fn[2] || tds[0]; if (!resultid) continue;
    orders.push({ resultid, visitId:tds[1]||'', date:tds[2]||'', description:tds[3]||tds[0]||'Radiology', printType: /manual/i.test(fn[1]||'')?'manual':'automated' });
  }
  return { orders };
}
async function getRadiologyReport(env, token, resultid, type) {
  const path = type === 'automated' ? `/Radio/Home/GetRadiologyAutomatedResultPrint?resultid=${encodeURIComponent(resultid)}` : `/Radiology/Home/GetRadiologyResultPrint?resultid=${encodeURIComponent(resultid)}`;
  const r = await ghisReq(env, token, 'GET', path, null, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  let data; try { data = JSON.parse(r.body); } catch { return { error: 'parse' }; }
  const x = Array.isArray(data) ? (data[0]||{}) : data;
  return { testName:x.testdesc||x.test_desc||'', report:htmlToText(x.result||x.final_rad_result||''), orderDate:x.order_date||x.reg_date||'', reported:x.result_enteredtime||x.entered_time||'', doctor:x.doctor_name||x.consultingdoc||'', enteredBy:x.generated_by_name||x.generated_name||'' };
}

// OPD patient-profile bundle (READ ONLY, flag smd_opd_emr on the client). Merges the existing read calls
// in parallel; each is caught so one failing scrape doesn't kill the bundle. Returns {unauth:true} up front
// when the session is gone (mirrors every data fn) so the route can 401. No new scraping.
export async function getOpdProfile(env, token, patientId, recordNo) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const safe = (p) => Promise.resolve(p).then(r => (r && r.unauth) ? null : r).catch(() => null);
  const [labs, radiology, meds, demo] = await Promise.all([
    safe(getLabOrders(env, token, patientId)),
    safe(getRadiologyOrders(env, token, patientId)),
    safe(getMedications(env, token, patientId)),
    recordNo ? safe(getDemographics(env, token, patientId, recordNo)) : Promise.resolve(null)
  ]);
  return {
    labs: (labs && labs.orders) || [],
    radiology: (radiology && radiology.orders) || [],
    medications: (meds && meds.rows) || [],
    phone: (demo && demo.phone) || ''
  };
}

// ── OPD write-back: search (safe GETs), assessment read, and INERT write plumbing (P2/P3/P4) ─────────
// PURE, exported for unit tests. GHIS autocomplete (FilterServices / FilterDrugs) returns an array of items
// whose id/label key names vary; map each tolerantly to {id,name} and drop rows missing either. No I/O.
export function parseSearchRows(data) {
  let arr = data;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { arr = []; } }
  if (arr && !Array.isArray(arr) && Array.isArray(arr.data)) arr = arr.data;
  if (!Array.isArray(arr)) return [];
  // Real GHIS shape (verified 2026-08-07, FilterServices + FilterDrugs are identical): id=material_service_sp_id
  // (e.g. LAB1118 / P0110), name=material_desc, generic/composition=basic_material_desc. Guessed keys kept as fallback.
  const idKeys = ['material_service_sp_id', 'Id', 'id', 'value', 'Value', 'ServiceId', 'Code'];
  const nameKeys = ['material_desc', 'Text', 'text', 'label', 'Label', 'name', 'Name', 'DisplayText'];
  const subKeys = ['basic_material_desc', 'generic', 'composition'];
  const pick = (o, keys) => { for (let i = 0; i < keys.length; i++) { const v = o[keys[i]]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i]; if (!o || typeof o !== 'object') continue;
    const id = pick(o, idKeys), name = pick(o, nameKeys), sub = pick(o, subKeys);
    if (id && name) out.push(sub ? { id: id, name: name, sub: sub } : { id: id, name: name });
  }
  return out;
}
async function getInvSearch(env, token, q) {
  const r = await ghisReq(env, token, 'GET', '/Doctor/Home/FilterServices?searchText=' + encodeURIComponent(q || ''), null, { 'X-Requested-With': 'XMLHttpRequest' });
  return r.unauth ? r : { rows: parseSearchRows(parseGhis(r.body)) };
}
async function getDrugSearch(env, token, q) {
  const r = await ghisReq(env, token, 'GET', '/Doctor/Home/FilterDrugs?searchText=' + encodeURIComponent(q || '') + '&chemoflag=0', null, { 'X-Requested-With': 'XMLHttpRequest' });
  return r.unauth ? r : { rows: parseSearchRows(parseGhis(r.body)) };
}
// Human-readable label from a form field name (txtChiefComplaint / chief_complaint -> "Chief Complaint").
function labelize(name) {
  const s = String(name || '').replace(/^(txt|ddl|chk|rdo|hdn|sel|input)/i, '').replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : String(name || '');
}
// Tolerant extraction of editable form fields (text inputs + textareas) so the assessment can round-trip.
// Skips hidden/submit/checkbox/etc + the antiforgery token; caps at 60 fields.
function parseAssessmentFields(html) {
  html = String(html || '');
  const out = [], seen = {};
  const add = (name, value, kind) => { if (!name || seen[name] || /verificationtoken/i.test(name)) return; seen[name] = 1; out.push({ name: name, label: labelize(name), value: value || '', kind: kind }); };
  let m;
  const inputRe = /<input\b[^>]*>/gi;
  while ((m = inputRe.exec(html)) && out.length < 60) {
    const tag = m[0], type = ((tag.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'file', 'checkbox', 'radio', 'password'].indexOf(type) >= 0) continue;
    add((tag.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1], (tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i) || [])[1] || '', 'input');
  }
  const taRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
  while ((m = taRe.exec(html)) && out.length < 60) add((m[1].match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1], htmlToText(m[2]), 'textarea');
  return out;
}
// GET the Initial Assessment form (same page getDemographics reads for phone). May 302 to SSO -> unauth.
async function getAssessmentForm(env, token, patientId, episodeId) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const epi = String(episodeId || '');
  // Activate the patient's visit first (same Searchnew as save) so the form loads the EXISTING assessment
  // instead of a blank one — the doctor edits rather than retypes.
  if (patientId && epi) { try { await ghisReq(env, token, 'POST', '/Doctor/Home/Searchnew', '__RequestVerificationToken=' + encodeURIComponent(s.csrf || '') + '&recordNo=' + encodeURIComponent(patientId + '-' + epi), { 'X-Requested-With': 'XMLHttpRequest', 'Referer': GHIS + '/Doctor/home' }); } catch (e) {} }
  const r = await ghisReq(env, token, 'GET', '/Doctor/Home/GetInitialAssessmentnew/?id=' + encodeURIComponent(patientId || ''), null, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  const html = r.body || '';
  // Full field map keyed by BARE name (strip assessment./val.) so the client prefills by schema field name.
  const all = extractAssessmentForm(html), fields = [];
  Object.keys(all).forEach(function (k) { if (/verificationtoken/i.test(k)) return; fields.push({ name: k.replace(/^(assessment|val)\./, ''), value: all[k] }); });
  return { fields: fields, raw: htmlToText(html).slice(0, 8000) };
}
// WRITE helper: after a service is picked, GHIS needs its pack-rate id + price, which FilterServices does NOT
// return. The `addservices?Id=<id>` GET carries them. Its response shape is UNVERIFIED (not captured) — parsed
// tolerantly; the client can also pass packRateId/price through to skip this lookup.
async function getServiceDetail(env, token, id) {
  const r = await ghisReq(env, token, 'GET', '/Doctor/Home/addservices?Id=' + encodeURIComponent(id || ''), null, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  let d = parseGhis(r.body); if (Array.isArray(d)) d = d[0] || {}; d = d || {};
  const pk = (ks) => { for (let i = 0; i < ks.length; i++) { const v = d[ks[i]]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };
  return {
    packRateId: pk(['servicePackRateId', 'serv_pack_rate_id', 'ServicePackRateId']),
    price: pk(['price', 'service_price', 'Price']),
    deptId: pk(['dept_id', 'mat_dept_id']), groupId: pk(['material_group_sp_id', 'mat_grp_sp_id']),
    desc: pk(['material_desc', 'Service_desc']), serviceType: pk(['Service_type']) || 'In house'
  };
}
// WRITE: order an investigation. Field names VERIFIED from a live CreateServices capture (2026-08-07). serviceId,
// deptId, groupId, desc come from the search row; pack-rate id + price (absent from search) are fetched via
// getServiceDetail (addservices) unless the body supplies them. `antibiotics` is GHIS's (odd) name for the
// typed indication field. Never fabricates values we don't have.
export async function orderInvestigation(env, token, body) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  body = body || {};
  const id = String(body.serviceId || '');
  if (!id) return { ok: false, status: 400, error: 'missing serviceId' };
  let det = {};
  try { const d = await getServiceDetail(env, token, id); if (d && !d.unauth) det = d; } catch (e) {}
  const p = new URLSearchParams();
  p.set('__RequestVerificationToken', s.csrf || '');
  p.set('mat_dept_id', String(body.deptId || det.deptId || ''));
  p.set('mat_grp_sp_id', String(body.groupId || det.groupId || ''));
  p.set('mat_serv_sp_id', id);
  p.set('Service_id', id);
  p.set('serv_pack_rate_id', String(body.packRateId || det.packRateId || ''));
  p.set('serv_alias', String(body.alias || ''));
  p.set('serv_code', String(body.code || ''));
  p.set('Service_desc', String(body.desc || det.desc || ''));
  p.set('Remarks', String(body.remarks || ''));
  p.set('service_price', String(body.price || det.price || ''));
  p.set('Service_type', String(body.serviceType || det.serviceType || 'In house'));
  p.set('antibiotics', String(body.indication || body.antibiotics || ''));  // captured: carries the typed indication
  p.set('collection', String(body.collection || ''));
  p.set('specimen', String(body.specimen || ''));
  p.set('X-Requested-With', 'XMLHttpRequest');
  const r = await ghisReq(env, token, 'POST', '/Doctor/Home/CreateServices', p.toString(), { 'X-Requested-With': 'XMLHttpRequest' });
  return r.unauth ? r : { ok: r.status >= 200 && r.status < 300, status: r.status };
}
// WRITE: prescribe a medication (Medication_form, ~14 fields). Only `frequency` + CSRF are captured names;
// the rest are UNVERIFIED guesses built tolerantly from the body. Fix against a real capture before enabling.
async function prescribe(env, token, body) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  body = body || {};
  const p = new URLSearchParams();
  p.set('__RequestVerificationToken', s.csrf || '');
  if (body.drugId != null) p.set('drugId', String(body.drugId));         // UNVERIFIED: drug id field name
  p.set('route', String(body.route || ''));                              // UNVERIFIED: route field name
  p.set('form', String(body.form || ''));                                // UNVERIFIED: form field name
  p.set('qty', String(body.qty || ''));                                  // UNVERIFIED: quantity field name
  p.set('frequency', String(body.frequency || ''));                      // captured field name
  p.set('duration', String(body.duration || ''));                        // UNVERIFIED: duration field name
  p.set('remarks', String(body.remarks || ''));                          // UNVERIFIED: remarks field name
  const r = await ghisReq(env, token, 'POST', '/Doctor/Home/CreateDrugs', p.toString(), { 'X-Requested-With': 'XMLHttpRequest' });
  return r.unauth ? r : { ok: r.status >= 200 && r.status < 300, status: r.status };
}
// WRITE: save the Initial Assessment. Endpoint + `assessment.` field convention VERIFIED from a live capture
// (2026-08-07, POST /Doctor/Home/CreateinitialAssessmentnew — note the lowercase 'i'). GHIS posts the WHOLE
// form at once, so the client reads the form (getAssessmentForm), overlays the doctor's edits, and sends the
// full name->value map in body.fields; we normalise to the assessment. namespace + attach ids + CSRF. New = docId 0.
// Extract EVERY posted field from the live GHIS form HTML (hidden incl. the pre-allocated
// Initial_Assessment_doc_id + __RequestVerificationToken, text/number inputs, the CHECKED radio of each
// group, textareas, and the SELECTED option of each select). This is the whole model GHIS binds — a
// partial post (or doc_id 0) is silently not persisted.
function extractAssessmentForm(html) {
  html = String(html || '');
  const out = {}; let m;
  const inputRe = /<input\b[^>]*>/gi;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    const name = (tag.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1]; if (!name) continue;
    const type = ((tag.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || 'text').toLowerCase();
    if (['submit', 'button', 'image', 'reset', 'file'].indexOf(type) >= 0) continue;
    const val = (tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (type === 'radio' || type === 'checkbox') { if (/\bchecked\b/i.test(tag)) out[name] = val; continue; }
    // ASP.NET renders each checkbox as <input checkbox value=true> + a trailing <input hidden value=false>
    // of the SAME name. Never let that hidden 'false' clobber a checked box we already recorded as 'true'.
    if (type === 'hidden' && out[name] !== undefined) continue;
    out[name] = val;
  }
  let ta; const taRe = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
  while ((ta = taRe.exec(html))) { const n = (ta[1].match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1]; if (n) out[n] = htmlToText(ta[2]); }
  let se; const selRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((se = selRe.exec(html))) {
    const n = (se[1].match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1]; if (!n) continue;
    let om, sel = ''; const optRe = /<option\b([^>]*)>[\s\S]*?<\/option>/gi;
    while ((om = optRe.exec(se[2]))) { if (/\bselected\b/i.test(om[1])) { sel = (om[1].match(/\bvalue\s*=\s*["']([^"']*)["']/i) || [])[1] || ''; break; } }
    out[n] = sel;
  }
  return out;
}
export async function saveAssessment(env, token, body) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  body = body || {};
  const mr = String(body.patientId || ''), epi = String(body.episodeId || '');
  // ACTIVATE THE VISIT first: POST Searchnew with recordNo=<MR>-<episode>, the same call getDemographics
  // uses to load a patient's visit. Without it the assessment form GET returns a BLANK form (doc_id 0, no
  // episode), so GHIS "Successfully submitted" an orphan record under no visit instead of UPDATING the real
  // one on the doctor's screen. (Session context is server-side, keyed by the shared session cookie.)
  if (mr && epi) {
    try { await ghisReq(env, token, 'POST', '/Doctor/Home/Searchnew', '__RequestVerificationToken=' + encodeURIComponent(s.csrf || '') + '&recordNo=' + encodeURIComponent(mr + '-' + epi), { 'X-Requested-With': 'XMLHttpRequest', 'Referer': GHIS + '/Doctor/home' }); } catch (e) {}
  }
  // Reserialize the CURRENT form so GHIS gets the complete model + its own pre-allocated doc_id/token,
  // then overlay the doctor's edits — exactly what GHIS's own "Save" posts. Without this, a partial body
  // with doc_id 0 returns 200 but is never persisted ("No records found").
  const gr = await ghisReq(env, token, 'GET', '/Doctor/Home/GetInitialAssessmentnew/?id=' + encodeURIComponent(mr), null, { 'X-Requested-With': 'XMLHttpRequest' });
  if (gr.unauth) return gr;
  const all = extractAssessmentForm(gr.body || '');
  const fields = body.fields || {};
  Object.keys(fields).forEach(function (k) {
    const name = /^(assessment|val)\./.test(k) ? k : ('assessment.' + k);
    all[name] = fields[k] == null ? '' : String(fields[k]);   // overlay the form's exact state, blanks included
                                                              // (a blank field is an intentional clear — supported by design)
  });
  // The GET form is authoritative for the ids + antiforgery token — the doctor only edits clinical
  // fields. Use client-supplied ids ONLY as a fallback when the form omitted them: overriding the
  // form's real episode/doc id with a stale client value makes GHIS reject the post ("Unable to process").
  if (!all['assessment.Initial_Assessment_doc_id'] && body.docId != null && String(body.docId) !== '') all['assessment.Initial_Assessment_doc_id'] = String(body.docId);
  if (!all['assessment.patient_id'] && body.patientId) all['assessment.patient_id'] = String(body.patientId);
  if (!all['assessment.episode_id'] && body.episodeId) all['assessment.episode_id'] = String(body.episodeId);
  if (!all['__RequestVerificationToken'] && s.csrf) all['__RequestVerificationToken'] = s.csrf;   // form token preferred; session as fallback
  const p = new URLSearchParams();
  Object.keys(all).forEach(function (name) { if (all[name] !== undefined) p.set(name, all[name]); });
  // The form's __RequestVerificationToken is paired with the .AspNetCore.Antiforgery cookie GHIS set on
  // THIS GET. Our login-time session cookie lacks it, so send the merged cookie on the POST — else GHIS
  // fails antiforgery and silently discards the save (200 "Unable to process").
  const postCookie = mergeCookies(s.cookie, gr.setCookie);
  const r = await ghisReq(env, token, 'POST', '/Doctor/Home/CreateinitialAssessmentnew', p.toString(), { 'X-Requested-With': 'XMLHttpRequest', 'Cookie': postCookie });
  // GHIS returns a PLAIN STRING at HTTP 200: "Successfully submitted" / "Successfully updated" on
  // success, else "Unable to process your request !". Key on the success string (the old error-keyword
  // check let "Unable to process" pass as success, so the app falsely reported "saved").
  const rb = String(r.body || '');
  const ok = /successfully\s+(submitted|updated)/i.test(rb);
  return r.unauth ? r : { ok: ok, status: r.status, resp: rb.slice(0, 200) };
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
// The GHIS session token grants live patient PHI — accept it ONLY from headers, never the ?token= query
// string (which would leak it into edge/proxy access logs, browser history, and Referer). The client always
// sends it as `Authorization: Bearer`, so dropping the query fallback changes no legitimate behaviour.
const bearer = (req /*, url */) => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('X-Ghis-Token') || '';

// ── entry ────────────────────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const url = new URL(request.url);
  const q = url.searchParams;
  const token = bearer(request, url);
  try {
    if (!env.GHIS_KV) return json({ error: 'server_misconfigured', detail: 'GHIS_KV binding missing' }, 500);

    // ---- login ----
    if (seg === 'login' && request.method === 'POST') {
      // Ward Sync is a Pro feature (the launch promo keeps this open for everyone until 15 Sep 2026).
      if (!(await requirePro(env, request)).ok) return json({ error: 'needs-pro', needsPro: true }, 402);
      const body = await request.json().catch(() => ({}));
      if (!body.userId || !body.password) return json({ error: 'missing_credentials' }, 400);
      let sess;
      try { sess = await loginGhis(String(body.userId), String(body.password)); }
      catch (e) { return json({ error: e.code === 'bad_credentials' ? 'bad_credentials' : 'login_failed' }, 401); }
      const t = randToken();
      await env.GHIS_KV.put('sess:' + t, JSON.stringify({ ...sess, userId: String(body.userId), ts: Date.now() }), { expirationTtl: SESS_KV_TTL });
      // NOTE: we intentionally do NOT persist credentials (no "remember" store) — the
      // password never leaves this request. Sessions are token-only; on GHIS timeout the
      // doctor logs in again. `body.remember` is accepted but ignored for compatibility.
      return json({ token: t, userId: String(body.userId), doctorName: (sess && sess.doctorName) || '' });
    }

    // ---- STAFF login (OPD staff platform) : GHIS employee-id + password, NO StewardMD Pro required ----
    // Staff (nurse/reception/supervisor) operate the OPD queue from opd.stewardmd.in without a StewardMD
    // account. GHIS is the identity provider (their real hospital credentials); the queue router derives
    // their ROLE from the owner-managed q_staff mapping (least-privilege viewer if unmapped). Gated by
    // env QUEUE_STAFF_ENABLED so it is inert until the owner turns the platform on.
    if (seg === 'staff-login' && request.method === 'POST') {
      if (env.QUEUE_STAFF_ENABLED !== '1') return json({ error: 'staff_disabled' }, 404);
      const body = await request.json().catch(() => ({}));
      if (!body.userId || !body.password) return json({ error: 'missing_credentials' }, 400);
      let sess;
      try { sess = await loginGhis(String(body.userId), String(body.password)); }
      catch (e) { return json({ error: e.code === 'bad_credentials' ? 'bad_credentials' : 'login_failed' }, 401); }
      const t = randToken();
      await env.GHIS_KV.put('sess:' + t, JSON.stringify({ ...sess, userId: String(body.userId), staff: true, ts: Date.now() }), { expirationTtl: SESS_KV_TTL });
      return json({ token: t, userId: String(body.userId), doctorName: (sess && sess.doctorName) || '' });
    }

    // ---- silent session refresh (Lab Watch 24/7 users only) ----
    // When the client's short-lived GHIS session times out, re-mint one WITHOUT re-prompting — but
    // ONLY from the encrypted creds the doctor already CONSENTED to store for 24/7 background alerts
    // (getCred, keyed by verified Firebase identity). No stored creds → 404 → the client shows login.
    if (seg === 'refresh' && request.method === 'POST') {
      const who = await identify(request, env);
      if (!who) return json({ error: 'auth_required' }, 401);
      let cred = null;
      try { cred = await getCred(env, who); } catch (e) { cred = null; }
      if (!cred || !cred.userId || !cred.password) return json({ error: 'no_stored_creds' }, 404);
      let sess;
      try { sess = await loginGhis(String(cred.userId), String(cred.password)); }
      catch (e) { return json({ error: e.code === 'bad_credentials' ? 'bad_credentials' : 'login_failed' }, 401); }
      const t = randToken();
      await env.GHIS_KV.put('sess:' + t, JSON.stringify({ ...sess, userId: String(cred.userId), ts: Date.now() }), { expirationTtl: SESS_KV_TTL });
      return json({ token: t, userId: String(cred.userId), refreshed: true });
    }

    // ---- logout ----
    if (seg === 'logout' && request.method === 'POST') {
      if (token) { await env.GHIS_KV.delete('sess:' + token); await env.GHIS_KV.delete('cred:' + token); }
      return json({ ok: true });
    }

    // ---- everything else needs a valid token ----
    const unauth = (r) => r && r.unauth;
    if (seg === 'status')          { const s = await getSession(env, token); return json({ connected: !!s, userId: s ? s.userId : null }); }
    if (seg === 'patients')        { const r = await getPatients(env, token);        return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'opd-patients')    { const dbg = q.get('raw') === '1'; const r = await getOpdPatients(env, token, q.get('sdate') || '', dbg, q.get('cb') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : (dbg ? json(r) : json({ rows: r })); }
    if (seg === 'demographics')    { const r = await getDemographics(env, token, q.get('patientId') || '', q.get('recordNo') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'lab')             { const r = await getLabOrders(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'lab-detail')      { const r = await getLabDetail(env, token, q.get('renderId') || '', q.get('episodeId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'radiology')       { const r = await getRadiologyOrders(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'radiology-report'){ const r = await getRadiologyReport(env, token, q.get('resultid') || '', q.get('type') || 'manual'); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'medications')     { const r = await getMedications(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'profile')         { const r = await getOpdProfile(env, token, q.get('patientId') || '', q.get('recordNo') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }

    // ---- OPD write-back: safe search/read GETs (NOT gated) ----
    if (seg === 'inv-search')      { const r = await getInvSearch(env, token, q.get('q') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'drug-search')     { const r = await getDrugSearch(env, token, q.get('q') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'assessment')      { const r = await getAssessmentForm(env, token, q.get('patientId') || '', q.get('episodeId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }

    // ---- OPD write-back: WRITES (P2/P3/P4). Gate FIRST: inert (501, nothing hits GHIS) until QUEUE_EMR_WRITE=1 ----
    const writeGate = () => json({ error: 'emr_write_disabled', detail: 'Set QUEUE_EMR_WRITE=1 server-side only after the payload is verified against a real captured request' }, 501);
    if (seg === 'inv-order' && request.method === 'POST') {
      if (!emrWriteEnabled(env)) return writeGate();
      const r = await orderInvestigation(env, token, await request.json().catch(() => ({}))); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r);
    }
    if (seg === 'prescribe' && request.method === 'POST') {
      // SAFETY HARD-BLOCK: the CreateDrugs payload is NOT captured/verified, so prescribing stays inert even when
      // QUEUE_EMR_WRITE=1 (a wrong field could mis-prescribe a drug). Owner sets QUEUE_EMR_PRESCRIBE_OK=1 ONLY after
      // the real CreateDrugs request is captured and prescribe()'s field names are verified.
      if (env.QUEUE_EMR_PRESCRIBE_OK !== '1') return json({ error: 'prescribe_not_verified', detail: 'Prescribing is not enabled yet (CreateDrugs payload not verified). Assessment + investigation orders are live.' }, 501);
      if (!emrWriteEnabled(env)) return writeGate();
      const r = await prescribe(env, token, await request.json().catch(() => ({}))); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r);
    }
    if (seg === 'assessment-save' && request.method === 'POST') {
      if (!emrWriteEnabled(env)) return writeGate();
      const r = await saveAssessment(env, token, await request.json().catch(() => ({}))); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r);
    }
    return json({ error: 'unknown endpoint', seg }, 404);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
