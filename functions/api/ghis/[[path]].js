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
async function loginGhis(userId, password) {
  const jar = {};
  const lp = await raw(jar, 'GET', SSO + '/');
  const token = (lp.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || '';
  const form = `USER_ID=${encodeURIComponent(userId)}&PASSWORD=${encodeURIComponent(password)}&__RequestVerificationToken=${encodeURIComponent(token)}&X-Requested-With=XMLHttpRequest`;
  const li = await raw(jar, 'POST', SSO + '/Index', form, { 'X-Requested-With': 'XMLHttpRequest', 'Referer': SSO + '/' });
  let ok = false; try { ok = (JSON.parse(li.body).param1 == 200); } catch {}
  if (!ok) { const e = new Error('bad_credentials'); e.code = 'bad_credentials'; throw e; }
  await raw(jar, 'GET', SSO + '/apps');
  await follow(jar, await raw(jar, 'GET', GHIS + '/Home'));
  const cookie = jarHeader(jar, 'ghis.gitam.edu');
  if (!/AspNetCore\.Session/.test(cookie)) throw new Error('session_not_established');
  const wl = await raw({ 'ghis.gitam.edu': Object.fromEntries(cookie.split('; ').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; })) }, 'GET', GHIS + '/Doctor/Home/Nurseipwlnew/?id=');
  const csrf = (wl.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || '';
  return { cookie, csrf };
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
  return { status: res.status, body: await res.text(), csrf: s.csrf };
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
function ghisToday() { const d = new Date(); const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return ('0' + d.getDate()).slice(-2) + '-' + M[d.getMonth()] + '-' + d.getFullYear(); }
// DashboardUnit returns text/html (a DataTable fragment), NOT JSON. Parse it by HEADER LABEL so the mapping
// survives column reordering: <th> texts -> field, then each <tbody> <tr>'s <td>s map to those fields.
function parseOpdHtml(html) {
  html = String(html || ''); if (html.indexOf('<') < 0) return [];
  const strip = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const fieldFor = (label) => { const t = strip(label).toLowerCase().replace(/[^a-z]/g, '');
    if (/patientid|^mrno|mrnumber|uhid/.test(t)) return 'patientId';
    if (/visitid|opno|visitno|episode/.test(t)) return 'visitId';
    if (/patientname|name/.test(t)) return 'patientName';
    if (/department|dept/.test(t)) return 'department';
    if (/^age/.test(t)) return 'age';
    if (/gender|sex/.test(t)) return 'gender';
    if (/doctor|consultant|physician/.test(t)) return 'doctor';
    if (/mobile|contact|phone/.test(t)) return 'mobile';
    return ''; };
  const head = (html.match(/<th[\s\S]*?<\/th>/gi) || []).map(fieldFor);
  const body = (html.match(/<tbody[\s\S]*?<\/tbody>/i) || [html])[0];
  const rows = [];
  (body.match(/<tr[\s\S]*?<\/tr>/gi) || []).forEach((tr) => {
    const tds = tr.match(/<td[\s\S]*?<\/td>/gi); if (!tds || tds.length < 3) return;
    const o = {}; tds.forEach((td, i) => { const f = head[i]; if (f) o[f] = strip(td); });
    if (o.patientName || o.patientId) rows.push(o);
  });
  return rows;
}
async function getOpdPatients(env, token, sdate) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const p = new URLSearchParams({ type: 'docopdlist', sdate: sdate || ghisToday(), checkbox: '0' });
  const r = await ghisReq(env, token, 'GET', '/Doctor/Home/DashboardUnit?' + p.toString(), null, { 'X-Requested-With': 'XMLHttpRequest' });
  if (r.unauth) return r;
  const j = parseGhis(r.body);                               // fallback: some GHIS actions return JSON
  if (Array.isArray(j) && j.length) return j;
  if (j && Array.isArray(j.data) && j.data.length) return j.data;
  return parseOpdHtml(r.body);                               // DashboardUnit = text/html table
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
  const body = r.body || '';
  const rows = [];
  for (const tr of (body.match(/<tr[\s\S]*?<\/tr>/gi) || [])) {
    const tds = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(td => htmlToText(td));
    if (tds.length < 7) continue;                                 // header (<th>) / non-data rows
    const drugText = (tds[1] || '').trim();
    if (!drugText || /^drug\s*name$/i.test(drugText)) continue;   // skip a stray header-in-<td>
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
async function getOpdProfile(env, token, patientId, recordNo) {
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
      return json({ token: t, userId: String(body.userId) });
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
    if (seg === 'opd-patients')    { const r = await getOpdPatients(env, token, q.get('sdate') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json({ rows: r }); }
    if (seg === 'demographics')    { const r = await getDemographics(env, token, q.get('patientId') || '', q.get('recordNo') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'lab')             { const r = await getLabOrders(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'lab-detail')      { const r = await getLabDetail(env, token, q.get('renderId') || '', q.get('episodeId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'radiology')       { const r = await getRadiologyOrders(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'radiology-report'){ const r = await getRadiologyReport(env, token, q.get('resultid') || '', q.get('type') || 'manual'); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'medications')     { const r = await getMedications(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'profile')         { const r = await getOpdProfile(env, token, q.get('patientId') || '', q.get('recordNo') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    return json({ error: 'unknown endpoint', seg }, 404);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
