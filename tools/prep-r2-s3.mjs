import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function sha256Hex(data) { return hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data)); }
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
function amzNow() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function encodeSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
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

export function getR2Config() {
  const envFile = path.join(os.homedir(), ".stewardmd-secrets/r2-s3.env");
  if (!fs.existsSync(envFile)) return null;
  const env = {};
  for (const l of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z0-9_]+)=["']?(.*?)["']?\s*$/.exec(l);
    if (m) env[m[1]] = m[2];
  }
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: "https://5476a757e49205bd1cce40b144eb59a9.r2.cloudflarestorage.com",
    bucket: "stewardmd-offline",
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  };
}

export async function putR2Object(key, filePathOrBytes, contentType, cacheControl) {
  const cfg = getR2Config();
  if (!cfg) throw new Error("No R2 S3 credentials found");
  const bytes = typeof filePathOrBytes === "string" ? fs.readFileSync(filePathOrBytes) : filePathOrBytes;
  const base = new URL(cfg.endpoint);
  const path = "/" + [cfg.bucket, ...key.split("/")].map(encodeSegment).join("/");
  const payloadHash = await sha256Hex(bytes);
  const extra = { "content-type": contentType || "application/json" };
  if (cacheControl) extra["cache-control"] = cacheControl;
  const headers = await signV4({
    method: "PUT", host: base.host, path, headers: extra,
    payloadHash, amzDate: amzNow(), region: "auto", service: "s3",
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey
  });
  delete headers.host;
  const res = await fetch(base.origin + path, { method: "PUT", headers, body: bytes });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
