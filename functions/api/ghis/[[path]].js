/* StewardMD — GHIS API (Cloudflare Pages Function)
 * ---------------------------------------------------------------------------
 * DEPLOY PATH in the repo:   functions/api/ghis/[[path]].js
 * It then answers:           https://stewardmd.in/api/ghis/<endpoint>
 *
 * What it does: logs into GITAM HIS on the server using a dedicated account,
 * caches the session, and serves labs + radiology to the app. No localhost
 * proxy, no cookie pasting — works on web and phone.
 *
 * REQUIRED Cloudflare settings (Pages → Settings):
 *   Environment variables / Secrets:
 *     GHIS_USER   = the dedicated GHIS service-account id   (encrypted secret)
 *     GHIS_PASS   = its password                            (encrypted secret)
 *   (Optional) KV namespace binding:
 *     GHIS_KV     = a KV namespace, so the session is shared across requests.
 *                   Without it the function still works (re-logs in per cold start).
 *
 * SECURITY: lock this path to your authorised users — see authorise() below.
 * Recommended: put Cloudflare Access in front of /api/ghis/* (zero code).
 * ---------------------------------------------------------------------------
 */

const GHIS = 'https://ghis.gitam.edu';
const SSO  = 'https://gimsrlogin.gitam.edu';
const SESSION_TTL_MS = 15 * 60 * 1000;       // refresh session well within GHIS's ~20-min idle window

// warm-isolate cache (fast path); KV is the durable store when bound
let mem = { cookie: '', csrf: '', ts: 0 };

// ── tiny cookie jar ──────────────────────────────────────────────────────────
function jarSet(jar, host, res) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const c of all) {
    const pair = c.split(';')[0]; const i = pair.indexOf('=');
    if (i < 0) continue;
    (jar[host] = jar[host] || {})[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
const jarHeader = (jar, host) => Object.entries(jar[host] || {}).map(([k, v]) => `${k}=${v}`).join('; ');

async function raw(jar, method, url, body, extra = {}) {
  const u = new URL(url);
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9',
    'Cookie': jarHeader(jar, u.hostname), ...extra,
  };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
  const res = await fetch(url, { method, body: body || undefined, headers, redirect: 'manual' });
  jarSet(jar, u.hostname, res);
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), body: text, url };
}
async function follow(jar, r, max = 10) {
  let n = 0;
  while (r.status >= 300 && r.status < 400 && r.location && n < max) {
    r = await raw(jar, 'GET', new URL(r.location, r.url).href);
    n++;
  }
  return r;
}
const parseGhis = (b) => { if (!b) return []; try { let v = JSON.parse(b); return typeof v === 'string' ? JSON.parse(v) : v; } catch { return []; } };

// ── auto login ───────────────────────────────────────────────────────────────
async function login(env) {
  const jar = {};
  const lp = await raw(jar, 'GET', SSO + '/');
  const token = (lp.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || '';
  const form = `USER_ID=${encodeURIComponent(env.GHIS_USER)}&PASSWORD=${encodeURIComponent(env.GHIS_PASS)}&__RequestVerificationToken=${encodeURIComponent(token)}&X-Requested-With=XMLHttpRequest`;
  const li = await raw(jar, 'POST', SSO + '/Index', form, { 'X-Requested-With': 'XMLHttpRequest', 'Referer': SSO + '/' });
  let ok = false; try { ok = (JSON.parse(li.body).param1 == 200); } catch {}
  if (!ok) throw new Error('GHIS login failed (check GHIS_USER / GHIS_PASS)');
  await raw(jar, 'GET', SSO + '/apps');
  await follow(jar, await raw(jar, 'GET', GHIS + '/Home'));
  const cookie = jarHeader(jar, 'ghis.gitam.edu');
  if (!/AspNetCore\.Session/.test(cookie)) throw new Error('GHIS session not established');
  // scrape a CSRF token for the AJAX data endpoints
  const wl = await raw({ 'ghis.gitam.edu': Object.fromEntries(cookie.split('; ').map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; })) },
    'GET', GHIS + '/Doctor/Home/Nurseipwlnew/?id=');
  const csrf = (wl.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || '';
  return { cookie, csrf, ts: Date.now() };
}

async function ensureSession(env, force = false) {
  const fresh = (s) => s && s.cookie && (Date.now() - s.ts) < SESSION_TTL_MS;
  if (!force && fresh(mem)) return mem;
  if (!force && env.GHIS_KV) {
    const cached = await env.GHIS_KV.get('session', 'json');
    if (fresh(cached)) { mem = cached; return mem; }
  }
  mem = await login(env);
  if (env.GHIS_KV) await env.GHIS_KV.put('session', JSON.stringify(mem), { expirationTtl: 1200 });
  return mem;
}

// a GHIS request using the cached session; one auto-relogin on 302 (expired)
async function ghis(env, method, path, body, extra = {}) {
  let s = await ensureSession(env);
  const doFetch = (sess) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept': '*/*', 'Referer': GHIS + '/Doctor/Home', 'Cookie': sess.cookie, ...extra,
    };
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    return fetch(GHIS + path, { method, body: body || undefined, headers, redirect: 'manual' });
  };
  let res = await doFetch(s);
  if (res.status === 302) { s = await ensureSession(env, true); res = await doFetch(s); }
  return { status: res.status, body: await res.text(), csrf: s.csrf };
}

// ── data endpoints (ported from ghis-proxy.js) ───────────────────────────────
async function getPatients(env) {
  const s = await ensureSession(env);
  const p = new URLSearchParams({ NursingStationId:'', PatientId:'', FloorId:'', Emp_ID:'', Dept_ID:'', Type:'IPWorkList', __RequestVerificationToken: s.csrf });
  const r = await ghis(env, 'GET', '/Doctor/Home/GetIPWL?' + p.toString(), null, { 'X-Requested-With': 'XMLHttpRequest' });
  return parseGhis(r.body);
}
async function getLabOrders(env, patientId) {
  const s = await ensureSession(env);
  const r = await ghis(env, 'POST', '/Lab/Home/GetSearchPatientId',
    `__RequestVerificationToken=${encodeURIComponent(s.csrf)}&patient_id=${encodeURIComponent(patientId)}&DeptID=&FDate=&EDate=`,
    { 'X-Requested-With': 'XMLHttpRequest' });
  return parseGhis(r.body).map(o => ({ serviceName:o.parameter_long_desc, orderDate:o.OrderDate, department:o.Department_desc, status:o.pstatus, renderId:o.ServiceRenderId, episodeId:o.episode_id, orderId:o.order_id, valueType:o.ValueType }));
}
async function getLabDetail(env, renderId, episodeId) {
  const s = await ensureSession(env);
  const r = await ghis(env, 'POST', '/Lab/Home/GetPrintLabResultDetailsAuth',
    `__RequestVerificationToken=${encodeURIComponent(s.csrf)}&Render_ID=${encodeURIComponent(renderId)}&Episode_Id=${encodeURIComponent(episodeId)}&Result_Type=a`,
    { 'X-Requested-With': 'XMLHttpRequest' });
  const rows = parseGhis(r.body); const h = rows[0] || {};
  return {
    group: h.GroupTestName || h.parameter_long_desc || '', department: h.Department || '',
    sampleType: h.SampleType, collected: h.date_of_collection, reported: h.ReportTime,
    tests: rows.map(x => ({ test:x.TestName, result:x.Result, units:x.Units, low:x.LowValue, high:x.HighValue,
      range:(x.LowValue||x.HighValue)?`${x.LowValue||''} - ${x.HighValue||''}`:'', critical:x.CriticalValue,
      method:x.methodologyName, valueType:x.ValueType, antibiogram:x.AntiOrgansData||x.DynamicLoadOrganstList||'' })),
  };
}
function htmlToText(s){ if(!s) return ''; return String(s).replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6])\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&ndash;/gi,'–').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\n{3,}/g,'\n\n').replace(/[ \t]{2,}/g,' ').trim(); }
async function getRadiologyOrders(env, patientId) {
  const r = await ghis(env, 'GET', `/Radio/Home?recordNo=${encodeURIComponent(patientId)}`, null, { 'X-Requested-With': 'XMLHttpRequest' });
  const orders = []; const trs = (r.body.match(/<tr[\s\S]*?<\/tr>/gi) || []);
  for (const tr of trs) {
    if (!/Radiology(Manual|Automated)?print|Radiologyprint/i.test(tr)) continue;
    const tds = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(td => td.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
    const fn = tr.match(/(RadiologyManualprint|RadiologyAutomatedprint|Radiologyprint)\(\s*['"]?(\d+)/i) || [];
    const resultid = fn[2] || tds[0]; if (!resultid) continue;
    orders.push({ resultid, visitId:tds[1]||'', date:tds[2]||'', description:tds[3]||tds[0]||'Radiology', printType: /manual/i.test(fn[1]||'')?'manual':'automated' });
  }
  return orders;
}
async function getRadiologyReport(env, resultid, type) {
  const path = type === 'automated' ? `/Radio/Home/GetRadiologyAutomatedResultPrint?resultid=${encodeURIComponent(resultid)}`
                                    : `/Radiology/Home/GetRadiologyResultPrint?resultid=${encodeURIComponent(resultid)}`;
  const r = await ghis(env, 'GET', path, null, { 'X-Requested-With': 'XMLHttpRequest' });
  let data; try { data = JSON.parse(r.body); } catch { return { error:'parse' }; }
  const x = Array.isArray(data) ? (data[0]||{}) : data;
  return { testName:x.testdesc||x.test_desc||'', report:htmlToText(x.result||x.final_rad_result||''),
    orderDate:x.order_date||x.reg_date||'', reported:x.result_enteredtime||x.entered_time||'',
    doctor:x.doctor_name||x.consultingdoc||'', enteredBy:x.generated_by_name||x.generated_name||'' };
}

// ── access gate — REPLACE with your real auth (or use Cloudflare Access) ─────
function authorise(request, env) {
  // Cloudflare Access injects this header once a user passes SSO:
  if (request.headers.get('Cf-Access-Authenticated-User-Email')) return true;
  // Fallback shared token (set GHIS_APP_TOKEN as a secret, send it from the app):
  if (env.GHIS_APP_TOKEN && request.headers.get('X-App-Token') === env.GHIS_APP_TOKEN) return true;
  // Default: allow only same-origin requests (basic hardening). Tighten as needed.
  const o = request.headers.get('Origin') || '';
  return o.endsWith('stewardmd.in') || o === '';
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// ── Pages Function entry ─────────────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env, params } = context;
  if (!authorise(request, env)) return json({ error: 'unauthorised' }, 403);

  const seg = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const url = new URL(request.url);
  const q = url.searchParams;
  try {
    if (seg === 'patients')        return json(await getPatients(env));   // plain array, matches local proxy
    if (seg === 'lab')             return json({ orders: await getLabOrders(env, q.get('patientId') || '') });
    if (seg === 'lab-detail')      return json(await getLabDetail(env, q.get('renderId') || '', q.get('episodeId') || ''));
    if (seg === 'radiology')       return json({ orders: await getRadiologyOrders(env, q.get('patientId') || '') });
    if (seg === 'radiology-report')return json(await getRadiologyReport(env, q.get('resultid') || '', q.get('type') || 'manual'));
    if (seg === 'status')          { await ensureSession(env); return json({ connected: true }); }
    return json({ error: 'unknown endpoint', seg }, 404);
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
