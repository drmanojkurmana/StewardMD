// connect-agent/brain-proxy/server.mjs - the Connect Agent brain's door to Vertex AI, on Cloud Run.
//
// WHY THIS EXISTS: the project's API keys may only call the Gemini API (org policy
// iam.managed.disableServiceAccountApiKeyCreation) and service-account keys cannot be created (org policy
// iam.disableServiceAccountKeyCreation), so a Cloudflare Worker has no way to authenticate to Vertex AI.
// Cloud Run does: its service account's ADC token comes from the metadata server. No key exists anywhere.
//
// Contract: POST /generate  header x-brain-secret: <BRAIN_PROXY_SECRET>
//   body { model, system, prompt }  ->  { text, model }   (model = Vertex modelVersion, as served)
// Only a gemini model id, only generateContent, bodies capped. The payload is what brain.js already
// passed through its PHI gate (screen structure only); nothing is logged.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

// Cloud Run does not set GOOGLE_CLOUD_PROJECT; the metadata server knows the project.
let PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT || '';
async function projectId() {
  if (PROJECT) return PROJECT;
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/project/project-id', { headers: { 'Metadata-Flavor': 'Google' } });
  PROJECT = (await r.text()).trim();
  return PROJECT;
}
const LOCATION = process.env.VERTEX_LOCATION || 'global';
const SECRET = process.env.BRAIN_PROXY_SECRET || '';
const MAX_BODY = 64 * 1024;
let cached = { token: '', until: 0 };

async function adcToken() {
  if (cached.token && Date.now() < cached.until) return cached.token;
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('metadata token ' + r.status);
  const j = await r.json();
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) - 60) * 1000 };
  return cached.token;
}

function secretOk(given) {
  const a = Buffer.from(String(given || '')), b = Buffer.from(SECRET);
  return SECRET.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

function send(res, status, obj) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/generate') return send(res, 404, { error: 'not_found' });
  if (!secretOk(req.headers['x-brain-secret'])) return send(res, 401, { error: 'unauthorized' });
  let body = '';
  let size = 0;
  req.on('data', (d) => { size += d.length; if (size > MAX_BODY) req.destroy(); else body += d; });
  req.on('end', async () => {
    let p;
    try { p = JSON.parse(body); } catch { return send(res, 400, { error: 'bad_json' }); }
    if (!/^gemini-[\w.-]{1,60}$/.test(String(p.model || '')) || typeof p.prompt !== 'string') return send(res, 400, { error: 'bad_request' });
    try {
      const url = `https://aiplatform.googleapis.com/v1/projects/${await projectId()}/locations/${LOCATION}/publishers/google/models/${p.model}:generateContent`;
      const vr = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (await adcToken()), 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(p.system ? { systemInstruction: { parts: [{ text: String(p.system) }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: p.prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        signal: AbortSignal.timeout(40000),
      });
      const j = await vr.json().catch(() => ({}));
      if (!vr.ok) return send(res, 502, { error: 'vertex_' + vr.status, detail: String((j.error && j.error.message) || '').slice(0, 200) });
      const text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('');
      return send(res, 200, { text, model: j.modelVersion || p.model });
    } catch (e) {
      return send(res, 502, { error: 'vertex_unreachable', detail: String(e && e.message || e).slice(0, 200) });
    }
  });
}).listen(Number(process.env.PORT) || 8080);
