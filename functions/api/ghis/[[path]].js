/* StewardMD — GHIS API (Cloudflare Pages Function) — per-doctor login
 * ---------------------------------------------------------------------------
 * DEPLOY PATH:   functions/api/ghis/[[path]].js   ->  https://stewardmd.in/api/ghis/*
 *
 * Each doctor logs in with their OWN GHIS id + password (proper audit trail).
 * Passwords are NEVER stored: the password is used only to open a GHIS session
 * for this request. The token maps to a short-lived session (cookie jar) in KV;
 * when GHIS times out the doctor logs in again. No silent re-login, no stored creds.
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
  if (res.status === 302) { const r = await refreshFromCreds(env, token); if (!r) return { unauth: true }; s = r; res = await doFetch(s); }
  return { status: res.status, body: await res.text(), csrf: s.csrf };
}

// ── data endpoints ───────────────────────────────────────────────────────────
async function getPatients(env, token) {
  const s = await getSession(env, token); if (!s) return { unauth: true };
  const p = new URLSearchParams({ NursingStationId:'', PatientId:'', FloorId:'', Emp_ID:'', Dept_ID:'', Type:'IPWorkList', __RequestVerificationToken: s.csrf });
  const r = await ghisReq(env, token, 'GET', '/Doctor/Home/GetIPWL?' + p.toString(), null, { 'X-Requested-With': 'XMLHttpRequest' });
  return r.unauth ? r : parseGhis(r.body);
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

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const bearer = (req, url) => (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('X-Ghis-Token') || url.searchParams.get('token') || '';

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

    // ---- logout ----
    if (seg === 'logout' && request.method === 'POST') {
      if (token) { await env.GHIS_KV.delete('sess:' + token); await env.GHIS_KV.delete('cred:' + token); }
      return json({ ok: true });
    }

    // ---- everything else needs a valid token ----
    const unauth = (r) => r && r.unauth;
    if (seg === 'status')          { const s = await getSession(env, token); return json({ connected: !!s, userId: s ? s.userId : null }); }
    if (seg === 'patients')        { const r = await getPatients(env, token);        return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'lab')             { const r = await getLabOrders(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'lab-detail')      { const r = await getLabDetail(env, token, q.get('renderId') || '', q.get('episodeId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'radiology')       { const r = await getRadiologyOrders(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'radiology-report'){ const r = await getRadiologyReport(env, token, q.get('resultid') || '', q.get('type') || 'manual'); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    if (seg === 'medications')     { const r = await getMedications(env, token, q.get('patientId') || ''); return unauth(r) ? json({ error: 'login_required' }, 401) : json(r); }
    return json({ error: 'unknown endpoint', seg }, 404);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
