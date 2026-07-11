// GHIS Local Proxy Server for StewardMD
// Usage:
//   1. node ghis-proxy.js
//   2. Log in to GHIS in Chrome
//   3. Open DevTools → Network tab → click any request → Headers → copy the "Cookie:" value
//   4. POST that to http://localhost:3456/set-cookies  (the StewardMD GHIS panel does this for you)

const http = require('http');
const https = require('https');
const querystring = require('querystring');

const PORT = 3456;
const GHIS_BASE = 'ghis.gitam.edu';

let sessionCookies = '';
let csrfToken = '';

// ── GHIS request helper ──────────────────────────────────────────────────────

function ghisRequest(method, path, formData, opts = {}) {
  const isAjax = opts.ajax !== false;          // default: send XHR header
  const maxRedirects = opts.maxRedirects != null ? opts.maxRedirects : 0;
  return new Promise((resolve, reject) => {
    const body = formData ? querystring.stringify({ ...formData, '__RequestVerificationToken': csrfToken }) : null;

    const headers = {
      'Accept': opts.accept || (isAjax
        ? 'application/json, text/javascript, */*; q=0.01'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Referer': `https://${GHIS_BASE}/Doctor/home`,
      'Cookie': sessionCookies,
    };
    if (isAjax && !opts.noXhr) headers['X-Requested-With'] = 'XMLHttpRequest';

    const options = { hostname: GHIS_BASE, port: 443, path, method, headers };

    if (body) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      if (res.headers['set-cookie']) {
        const newCookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
        if (newCookies) sessionCookies = newCookies;
      }
      // Follow redirects (302/301) when asked - preserves cookies
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && maxRedirects > 0) {
        const loc = res.headers.location;
        res.resume(); // drain
        console.log(`   ↪ ${res.statusCode} redirect → ${loc}`);
        let nextPath = loc;
        try { nextPath = new URL(loc, `https://${GHIS_BASE}`).pathname + (new URL(loc, `https://${GHIS_BASE}`).search || ''); } catch {}
        return resolve(ghisRequest('GET', nextPath, null, { ...opts, maxRedirects: maxRedirects - 1 }));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Extract CSRF token from a GHIS page
async function refreshCSRF() {
  try {
    const res = await ghisRequest('GET', '/Doctor/Home/Nurseipwlnew/?id=');
    const match = res.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    if (match) { csrfToken = match[1]; console.log('✅ CSRF token refreshed'); }
  } catch (e) { console.warn('CSRF refresh failed:', e.message); }
}

// ── API calls ────────────────────────────────────────────────────────────────

async function getIPWorklist({ patientId = '', floorId = '', nursingStationId = '', empId = '', deptId = '' } = {}) {
  const params = new URLSearchParams({
    NursingStationId: nursingStationId,
    PatientId: patientId,
    FloorId: floorId,
    Emp_ID: empId,
    Dept_ID: deptId,
    Type: 'IPWorkList',
    '__RequestVerificationToken': csrfToken,
  });
  const res = await ghisRequest('GET', `/Doctor/Home/GetIPWL?${params.toString()}`);
  return res;
}

// The lab module (OTLabPrintsSecretary) uses its own antiforgery token; scrape & cache it.
let labToken = '';
async function refreshLabToken(patientId) {
  const page = await ghisRequest('GET', `/Doctor/Home/OTLabPrintsSecretary/?id=${patientId || ''}`, null, { ajax: true, noXhr: true, accept: '*/*', maxRedirects: 0 });
  if (page.status === 302) return { expired: true };
  const m = page.body && page.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  if (m) { labToken = m[1]; }
  return { expired: false, ok: !!m };
}

// Double-decode helper: GHIS returns a JSON string that itself contains a JSON array.
function parseGhis(body) {
  if (!body) return [];
  try { let v = JSON.parse(body); return typeof v === 'string' ? JSON.parse(v) : v; }
  catch { return []; }
}

// Lab orders for one patient → list (no values yet, fast)
async function getLabOrders(patientId) {
  const t = await refreshLabToken(patientId);
  if (t.expired) return { expired: true };
  const res = await ghisRequest('POST', '/Lab/Home/GetSearchPatientId',
    { __RequestVerificationToken: labToken, patient_id: patientId, DeptID: '', FDate: '', EDate: '' });
  if (res.status === 302) return { expired: true };
  const orders = parseGhis(res.body);
  const clean = orders.map(o => ({
    serviceName: o.parameter_long_desc,
    orderDate: o.OrderDate,
    department: o.Department_desc,
    status: o.pstatus,
    renderId: o.ServiceRenderId,
    episodeId: o.episode_id,
    orderId: o.order_id,
    valueType: o.ValueType,        // 'N' numeric, 'M' microbiology, etc.
  }));
  console.log(`Lab orders for ${patientId}: ${clean.length}`);
  return { orders: clean };
}

// Actual result values for one order
async function getLabDetail(renderId, episodeId, patientId) {
  if (!labToken) await refreshLabToken(patientId);
  let res = await ghisRequest('POST', '/Lab/Home/GetPrintLabResultDetailsAuth',
    { __RequestVerificationToken: labToken, Render_ID: renderId, Episode_Id: episodeId, Result_Type: 'a' });
  if (res.status === 302) {
    const t = await refreshLabToken(patientId);            // token may have rotated
    if (t.expired) return { expired: true };
    res = await ghisRequest('POST', '/Lab/Home/GetPrintLabResultDetailsAuth',
      { __RequestVerificationToken: labToken, Render_ID: renderId, Episode_Id: episodeId, Result_Type: 'a' });
    if (res.status === 302) return { expired: true };
  }
  const rows = parseGhis(res.body);
  const header = rows[0] || {};
  const tests = rows.map(r => ({
    test: r.TestName,
    result: r.Result,
    units: r.Units,
    low: r.LowValue,
    high: r.HighValue,
    range: (r.LowValue || r.HighValue) ? `${r.LowValue || ''} - ${r.HighValue || ''}` : '',
    critical: r.CriticalValue,
    method: r.methodologyName,
    valueType: r.ValueType,
    antibiogram: r.AntiOrgansData || r.DynamicLoadOrganstList || '',  // culture sensitivity
  }));
  console.log(`Lab detail render=${renderId}: ${tests.length} rows (${header.GroupTestName || header.Department || ''})`);
  return {
    group: header.GroupTestName || header.parameter_long_desc || '',
    department: header.Department || '',
    sampleType: header.SampleType,
    collected: header.date_of_collection,
    reported: header.ReportTime,
    tests,
  };
}

// ── Radiology ────────────────────────────────────────────────────────────────
// The radiology list is server-rendered at /Radio/Home?recordNo=<patientId>.
// Each row: Service ID (=resultid) | Visit ID | Date | Description | print link.
async function getRadiologyOrders(patientId) {
  const res = await ghisRequest('GET', `/Radio/Home?recordNo=${patientId}`, null, { ajax: true, noXhr: true, accept: '*/*', maxRedirects: 0 });
  if (res.status === 302) return { expired: true };
  const html = res.body || '';
  const orders = [];
  const trBlocks = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  trBlocks.forEach(tr => {
    if (!/Radiology(Manual|Automated)?print|Radiologyprint/i.test(tr)) return;   // only data rows with a report link
    const tds = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
    const fn = (tr.match(/(RadiologyManualprint|RadiologyAutomatedprint|Radiologyprint)\(\s*['"]?(\d+)/i) || []);
    const printType = /manual/i.test(fn[1] || '') ? 'manual' : 'automated';
    const resultid = fn[2] || (tds[0] || '');
    if (!resultid) return;
    orders.push({
      resultid: resultid,
      visitId: tds[1] || '',
      date: tds[2] || '',
      description: tds[3] || tds[0] || 'Radiology',
      printType,
    });
  });
  console.log(`Radiology orders for ${patientId}: ${orders.length}`);
  return { orders };
}

// HTML report body → readable plain text (preserve line breaks)
function htmlToText(s) {
  if (!s) return '';
  return String(s)
    .replace(/<\s*(br|\/p|\/div|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&ndash;/gi, '-')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

async function getRadiologyReport(resultid, type) {
  // Manual reports: /Radiology/Home/GetRadiologyResultPrint ; Automated: /Radio/Home/GetRadiologyAutomatedResultPrint
  const path = type === 'automated'
    ? `/Radio/Home/GetRadiologyAutomatedResultPrint?resultid=${resultid}`
    : `/Radiology/Home/GetRadiologyResultPrint?resultid=${resultid}`;
  let res = await ghisRequest('GET', path, null, { ajax: true, accept: '*/*', maxRedirects: 0 });
  if (res.status === 302) return { expired: true };
  let data;
  try { data = JSON.parse(res.body); } catch { return { error: 'parse', raw: (res.body || '').substring(0, 200) }; }
  const r = Array.isArray(data) ? (data[0] || {}) : data;
  return {
    testName: r.testdesc || r.test_desc || '',
    report: htmlToText(r.result || r.final_rad_result || ''),
    orderDate: r.order_date || r.reg_date || '',
    reported: r.result_enteredtime || r.entered_time || '',
    doctor: r.doctor_name || r.consultingdoc || '',
    enteredBy: r.generated_by_name || r.generated_name || '',
  };
}

async function getPatientVisits(visitId) {
  const res = await ghisRequest('GET', `/Doctor/PatientprofileVisits/?Visitid=${visitId}`);
  return res;
}

async function getDropdowns(type, id = '') {
  const res = await ghisRequest('POST', '/Doctor/Home/Getdropdowns', { type, id });
  return res;
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, data, status = 200, extra = {}) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', ...extra });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

function parseBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => b += d);
    req.on('end', () => {
      try { resolve(JSON.parse(b)); } catch { resolve(querystring.parse(b)); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`→ ${req.method} ${req.url}`);  // log every incoming request

  try {
    // POST /set-cookies  { cookies: "ASP.NET_SessionId=...; .ASPXAUTH=..." }
    if (path === '/set-cookies' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.cookies) return send(res, { error: 'Provide cookies field' }, 400);
      sessionCookies = body.cookies;
      await refreshCSRF();
      return send(res, { success: true, hasCSRF: !!csrfToken });
    }

    // GET /status
    if (path === '/status') {
      return send(res, { connected: !!sessionCookies, hasCSRF: !!csrfToken });
    }

    // GET /patients?patientId=&floorId=&deptId=&empId=
    if (path === '/patients') {
      if (!sessionCookies) return send(res, { error: 'Not connected - set cookies first' }, 401);
      const r = await getIPWorklist({
        patientId: url.searchParams.get('patientId') || '',
        floorId: url.searchParams.get('floorId') || '',
        nursingStationId: url.searchParams.get('nursingStationId') || '',
        empId: url.searchParams.get('empId') || '',
        deptId: url.searchParams.get('deptId') || '',
      });
      return send(res, r.body);
    }

    // GET /lab?patientId=XXX  → list of lab orders (fast, no values)
    if (path === '/lab') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const patientId = url.searchParams.get('patientId') || '';
      const r = await getLabOrders(patientId);
      if (r.expired) return send(res, { error: 'session_expired' }, 401);
      return send(res, { orders: r.orders });
    }

    // GET /lab-detail?renderId=XXX&episodeId=XXX&patientId=XXX  → values for one order
    if (path === '/lab-detail') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const renderId = url.searchParams.get('renderId') || '';
      const episodeId = url.searchParams.get('episodeId') || '';
      const patientId = url.searchParams.get('patientId') || '';
      const r = await getLabDetail(renderId, episodeId, patientId);
      if (r.expired) return send(res, { error: 'session_expired' }, 401);
      return send(res, r);
    }

    // GET /radiology?patientId=XXX  → list of radiology studies (fast)
    if (path === '/radiology') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const patientId = url.searchParams.get('patientId') || '';
      const r = await getRadiologyOrders(patientId);
      if (r.expired) return send(res, { error: 'session_expired' }, 401);
      return send(res, { orders: r.orders });
    }

    // GET /radiology-report?resultid=XXX&type=manual|automated  → report text for one study
    if (path === '/radiology-report') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const resultid = url.searchParams.get('resultid') || '';
      const type = url.searchParams.get('type') || 'manual';
      const r = await getRadiologyReport(resultid, type);
      if (r.expired) return send(res, { error: 'session_expired' }, 401);
      return send(res, r);
    }

    // GET /debug-profile?patientId=XXX  ← returns first 5000 chars of raw HTML
    if (path === '/debug-profile') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const patientId = url.searchParams.get('patientId') || '';
      const r = await ghisRequest('GET', `/Doctor/Home/GetInitialAssessmentnew/?id=${patientId}`, null, { ajax: true, noXhr: true, accept: '*/*', maxRedirects: 0 });
      const snippet = (r.body || '').substring(0, 6000);
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' });
      res.end(`STATUS: ${r.status}\nLOCATION: ${r.headers && r.headers.location || '-'}\nLENGTH: ${(r.body||'').length}\n\n${snippet}`);
      return;
    }

    // GET /raw?path=/Doctor/...   ← generic GHIS passthrough for debugging
    if (path === '/raw') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const ghisPath = url.searchParams.get('path') || '/Doctor/home';
      const r = await ghisRequest('GET', ghisPath, null, { ajax: true, noXhr: true, accept: '*/*', maxRedirects: 0 });
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' });
      res.end(`STATUS: ${r.status}\nLOCATION: ${r.headers && r.headers.location || '-'}\nLENGTH: ${(r.body||'').length}\n\n${r.body || ''}`);
      return;
    }

    // GET /visits?visitId=XXX
    if (path === '/visits') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const visitId = url.searchParams.get('visitId') || '';
      const r = await getPatientVisits(visitId);
      return send(res, r.body);
    }

    // GET /dropdowns?type=Floor
    if (path === '/dropdowns') {
      if (!sessionCookies) return send(res, { error: 'Not connected' }, 401);
      const r = await getDropdowns(url.searchParams.get('type') || 'Floor', url.searchParams.get('id') || '');
      return send(res, r.body);
    }

    send(res, { error: 'Unknown endpoint' }, 404);
  } catch (err) {
    console.error(err);
    send(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n🏥  GHIS Proxy  →  http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /set-cookies   { cookies: "..." }   ← paste from Chrome DevTools`);
  console.log(`  GET  /status        check connection`);
  console.log(`  GET  /patients      IP worklist`);
  console.log(`  GET  /lab?episodeId=XXX`);
  console.log(`  GET  /visits?visitId=XXX`);
  console.log(`  GET  /dropdowns?type=Floor\n`);
  console.log(`How to get cookies:`);
  console.log(`  1. Log in to GHIS in Chrome`);
  console.log(`  2. DevTools → Network tab → any request → Headers tab`);
  console.log(`  3. Copy the "Cookie:" request header value`);
  console.log(`  4. Paste into the GHIS panel in StewardMD\n`);
});
