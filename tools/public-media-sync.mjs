/* tools/public-media-sync.mjs: copy public lesson + KB figures from the private bucket (stewardmd-offline) to the
 * public bucket stewardmd-public-media, served at media.stewardmd.in (prep-bank-client.js publicMediaUrl). Only
 * prep-bank/v1/lessons/media/ and prep-bank/v1/kb/media/ are copied: never MCQs, PYQ, radiology or MaiK images.
 * Keys drop "prep-bank/": prep-bank/v1/lessons/media/x.webp -> v1/lessons/media/x.webp. Copies only missing keys
 * (files are immutable), so a re-run after new lessons costs a few list calls plus the new images.
 * Auth: CLOUDFLARE_API_TOKEN (R2 edit) or the local wrangler login. Run: node tools/public-media-sync.mjs */
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
const wcfg = os.homedir() + "/Library/Preferences/.wrangler/config/default.toml";
const readTok = () => process.env.CLOUDFLARE_API_TOKEN || (fs.existsSync(wcfg) && (/oauth_token = "([^"]+)"/.exec(fs.readFileSync(wcfg, "utf8")) || [])[1]);
if (!readTok()) { console.error("no Cloudflare token (CLOUDFLARE_API_TOKEN or wrangler login)"); process.exit(2); }
// A wrangler login token lasts about an hour: on a 401/403 refresh it (wrangler whoami) and read it again.
let lastRefresh = 0;
function refreshTok() {
  if (process.env.CLOUDFLARE_API_TOKEN || Date.now() - lastRefresh < 30000) return;
  lastRefresh = Date.now();
  try { execSync("npx wrangler whoami", { stdio: "ignore" }); } catch (e) {}
  H.Authorization = `Bearer ${readTok()}`;
}
const A = process.env.CLOUDFLARE_ACCOUNT_ID || "5476a757e49205bd1cce40b144eb59a9";
const API = `https://api.cloudflare.com/client/v4/accounts/${A}/r2/buckets`;
const H = { Authorization: `Bearer ${readTok()}` };
const SRC = "stewardmd-offline", DST = "stewardmd-public-media";
const PREFIXES = ["prep-bank/v1/lessons/media/", "prep-bank/v1/kb/media/"];

async function list(bucket, prefix) {
  const out = []; let cursor = "";
  for (;;) {
    let r = null;
    for (let t = 0; t < 6; t++) {
      const res = await fetch(`${API}/${bucket}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? "&cursor=" + cursor : ""}`, { headers: H });
      if (res.status === 401 || res.status === 403) refreshTok();
      r = res.ok ? await res.json() : null;
      if (r && r.success) break;
      if (t === 5) throw new Error(`list ${bucket}/${prefix} failed: HTTP ${res.status}`);
      await new Promise((s) => setTimeout(s, res.status === 429 ? 60000 : 2000));
    }
    const res = r.result || []; out.push(...res);
    cursor = r.result_info && r.result_info.cursor;
    if (!cursor || !res.length) return out;
  }
}
const enc = (k) => k.split("/").map(encodeURIComponent).join("/");
async function copy(o) {
  const dstKey = o.key.slice("prep-bank/".length);
  for (let t = 0; t < 6; t++) {
    try {
      const g = await fetch(`${API}/${SRC}/objects/${enc(o.key)}`, { headers: H });
      if (g.status === 401 || g.status === 403) refreshTok();
      if (!g.ok) throw new Error("get " + g.status);
      const ct = g.headers.get("content-type") || (o.key.endsWith(".svg") ? "image/svg+xml" : "image/webp");
      const body = Buffer.from(await g.arrayBuffer());
      const p = await fetch(`${API}/${DST}/objects/${enc(dstKey)}`, { method: "PUT", headers: { ...H, "Content-Type": ct, "Cache-Control": "public, max-age=31536000, immutable" }, body });
      if (p.status === 401 || p.status === 403) refreshTok();
      if (!p.ok) throw new Error("put " + p.status + " " + (await p.text()).slice(0, 200));
      return true;
    } catch (e) {
      if (t === 5) { console.error("FAIL", o.key, e.message); return false; }
      // The Cloudflare API allows about 1,200 calls per 5 minutes: a 429 waits a full minute.
      await new Promise((s) => setTimeout(s, / 429/.test(e.message) ? 60000 : 1000 * (t + 1)));
    }
  }
}
const have = new Set((await Promise.all(PREFIXES.map((p) => list(DST, p.slice("prep-bank/".length))))).flat().map((o) => o.key));
const todo = (await Promise.all(PREFIXES.map((p) => list(SRC, p)))).flat().filter((o) => !have.has(o.key.slice("prep-bank/".length)));
console.log("to copy:", todo.length, "already there:", have.size);
let i = 0, ok = 0, fail = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (i < todo.length) { const o = todo[i++]; (await copy(o)) ? ok++ : fail++; if ((ok + fail) % 1000 === 0) console.log(ok + fail, "/", todo.length); } }));
console.log("done ok", ok, "fail", fail);
if (fail) process.exit(1);
