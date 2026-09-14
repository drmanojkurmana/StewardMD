/* functions/_wardsynq/object-store.js — where document bytes live, behind one small interface.
 *
 * THE INTERFACE IS THREE CALLS: put(key, bytes, contentType), get(key) -> { bytes, contentType } | null,
 * delete(key). Nothing in the documents module knows which provider is behind it.
 *
 * THE PRODUCTION ADAPTER SPEAKS THE S3 API over plain fetch, signed with AWS Signature Version 4.
 * Cloudflare R2, AWS S3, MinIO and every other S3-compatible store accept it, so moving providers is a
 * change of four settings, not of code - and nothing here is a Cloudflare binding.
 *
 * NO STORE CONFIGURED MEANS NO STORE. storeFromEnv returns null rather than a silent in-memory stand-in,
 * so an upload on a hospital with no storage is refused and says why, instead of appearing to work and
 * losing the file at the next restart.
 *
 * Settings (all four required): DOC_S3_ENDPOINT (https://<account>.r2.cloudflarestorage.com or
 * https://s3.<region>.amazonaws.com), DOC_S3_BUCKET, DOC_S3_ACCESS_KEY_ID, DOC_S3_SECRET_ACCESS_KEY;
 * optional DOC_S3_REGION (default "auto", which R2 expects; AWS needs the real region).
 */

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(data) { return hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data)); }
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** RFC 3986 encoding S3 expects for each path segment. */
function encodeSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * PURE apart from WebCrypto. Signs one request. `headers` are the extra headers to sign (lower-case
 * names); host, x-amz-content-sha256 and x-amz-date are always signed.
 * Returns the headers to send, Authorization included.
 */
async function signV4({ method, host, path, headers, payloadHash, amzDate, region, service, accessKeyId, secretAccessKey }) {
  const date = amzDate.slice(0, 8);
  const all = { ...(headers || {}), host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower = {}; for (const [k, v] of Object.entries(all)) lower[k.toLowerCase()] = String(v).trim();
  const canonicalHeaders = names.map((n) => n + ":" + lower[n] + "\n").join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  let key = await hmac("AWS4" + secretAccessKey, date);
  key = await hmac(key, region); key = await hmac(key, service); key = await hmac(key, "aws4_request");
  const signature = hex(await hmac(key, stringToSign));
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

function amzNow() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }

class ObjectStoreError extends Error {
  constructor(op, status, detail) { super(`object store ${op} failed (${status})`); this.op = op; this.status = status; this.detail = detail; }
}

/** S3-compatible adapter. Path-style addressing (endpoint/bucket/key), which every provider accepts. */
function s3Store(cfg, fetchImpl) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const base = new URL(cfg.endpoint);
  const region = cfg.region || "auto";
  const pathFor = (key) => "/" + [cfg.bucket, ...String(key).split("/")].map(encodeSegment).join("/");
  async function send(method, key, body, contentType) {
    const path = pathFor(key);
    const payloadHash = body ? await sha256Hex(body) : EMPTY_SHA256;
    const extra = body && contentType ? { "content-type": contentType } : {};
    const headers = await signV4({ method, host: base.host, path, headers: extra, payloadHash, amzDate: amzNow(), region, service: "s3", accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey });
    delete headers.host;   // fetch sets it; it was only needed for the signature
    return f(base.origin + path, { method, headers, body: body || undefined });
  }
  return {
    kind: "s3",
    async put(key, bytes, contentType) {
      const r = await send("PUT", key, bytes, contentType || "application/octet-stream");
      if (!r.ok) throw new ObjectStoreError("put", r.status, (await r.text()).slice(0, 300));
    },
    async get(key) {
      const r = await send("GET", key);
      if (r.status === 404) return null;
      if (!r.ok) throw new ObjectStoreError("get", r.status, (await r.text()).slice(0, 300));
      return { bytes: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get("content-type") || "application/octet-stream" };
    },
    async delete(key) {
      const r = await send("DELETE", key);
      if (!r.ok && r.status !== 404) throw new ObjectStoreError("delete", r.status, (await r.text()).slice(0, 300));
    },
  };
}

/** In-memory adapter: tests and local development only. Never returned by storeFromEnv. */
function memoryStore() {
  const m = new Map();
  return {
    kind: "memory", _objects: m,
    async put(key, bytes, contentType) { m.set(key, { bytes: new Uint8Array(bytes), contentType }); },
    async get(key) { const o = m.get(key); return o ? { bytes: new Uint8Array(o.bytes), contentType: o.contentType } : null; },
    async delete(key) { m.delete(key); },
  };
}

function storeFromEnv(env) {
  const e = env || {};
  if (!e.DOC_S3_ENDPOINT || !e.DOC_S3_BUCKET || !e.DOC_S3_ACCESS_KEY_ID || !e.DOC_S3_SECRET_ACCESS_KEY) return null;
  return s3Store({ endpoint: e.DOC_S3_ENDPOINT, bucket: e.DOC_S3_BUCKET, accessKeyId: e.DOC_S3_ACCESS_KEY_ID, secretAccessKey: e.DOC_S3_SECRET_ACCESS_KEY, region: e.DOC_S3_REGION });
}

export { signV4, s3Store, memoryStore, storeFromEnv, ObjectStoreError, sha256Hex, EMPTY_SHA256 };
