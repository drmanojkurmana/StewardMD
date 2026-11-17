/* tools/atlas-media-sync.mjs: copy RadioAnatome atlas files from the repo (atlas/**) to the public
 * bucket stewardmd-public-media, served at media.stewardmd.in (window.SMD_ATLAS_MEDIA in atlas.js /
 * atlas3d.js). Keys keep the repo path: atlas/<module>/001.webp -> atlas/<module>/001.webp.
 * atlas/ is excluded from the Pages deploy (scripts/pages-build.sh) so these ~5,200 files no longer
 * count toward Cloudflare Pages' 20,000-file cap; test/pages-output.test.mjs guards the margin.
 * Copies only missing keys (files are immutable; manifest/index JSON is regenerated in place by
 * atlas-pipeline, so re-uploading changed JSON needs the key deleted first), so a re-run costs a
 * few list calls plus the new files. .bin.gz geometry is uploaded WITHOUT Content-Encoding: atlas3d
 * inflates the bytes itself, exactly as Pages served them.
 * Auth: CLOUDFLARE_API_TOKEN (R2 edit) or the local wrangler login. Run: node tools/atlas-media-sync.mjs */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS_DIR = path.join(ROOT, "atlas");
const wcfg = (process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME + "/.wrangler/config/default.toml") || (os.homedir() + "/Library/Preferences/.wrangler/config/default.toml");
const readTok = () => process.env.CLOUDFLARE_API_TOKEN || (fs.existsSync(wcfg) && (/oauth_token = "([^"]+)"/.exec(fs.readFileSync(wcfg, "utf8")) || [])[1]);
if (!readTok()) { console.error("no Cloudflare token (CLOUDFLARE_API_TOKEN or wrangler login)"); process.exit(2); }
// A wrangler login token lasts about an hour: on a 401/403 refresh it (wrangler whoami, which renews
// the same config file) and read it again, like tools/public-media-sync.mjs. When the token lives
// outside the default config dir, set XDG_CONFIG_HOME to its parent dir.
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
const DST = "stewardmd-public-media";
const PREFIX = "atlas/";

const CT = { ".webp": "image/webp", ".json": "application/json", ".bin.gz": "application/gzip" };
const contentType = (key) => key.endsWith(".bin.gz") ? CT[".bin.gz"] : CT[path.extname(key)] || "application/octet-stream";

function* walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) yield* walk(path.join(dir, e.name), r);
    else if (e.isFile()) yield { key: PREFIX + r, file: path.join(dir, e.name) };
  }
}

async function list(bucket, prefix) {
  const out = []; let cursor = "";
  for (;;) {
    let r = null;
    for (let t = 0; t < 12; t++) {
      const res = await fetch(`${API}/${bucket}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? "&cursor=" + cursor : ""}`, { headers: H });
      if (res.status === 401 || res.status === 403) refreshTok();
      r = res.ok ? await res.json() : null;
      if (r && r.success) break;
      if (t === 11) throw new Error(`list ${bucket}/${prefix} failed: HTTP ${res.status}`);
      await new Promise((s) => setTimeout(s, res.status === 429 ? 60000 : 2000));
    }
    const res = r.result || []; out.push(...res);
    cursor = r.result_info && r.result_info.cursor;
    if (!cursor || !res.length) return out;
  }
}
const enc = (k) => k.split("/").map(encodeURIComponent).join("/");
async function copy(o) {
  for (let t = 0; t < 8; t++) {
    try {
      const body = fs.readFileSync(o.file);
      const p = await fetch(`${API}/${DST}/objects/${enc(o.key)}`, { method: "PUT", headers: { ...H, "Content-Type": contentType(o.key), "Cache-Control": "public, max-age=31536000, immutable" }, body });
      if (p.status === 401 || p.status === 403) refreshTok();
      if (!p.ok) throw new Error("put " + p.status + " " + (await p.text()).slice(0, 200));
      return true;
    } catch (e) {
      if (t === 7) { console.error("FAIL", o.key, e.message); return false; }
      // The Cloudflare API allows about 1,200 calls per 5 minutes: a 429 waits a full minute.
      await new Promise((s) => setTimeout(s, / 429/.test(e.message) ? 60000 : 1000 * (t + 1)));
    }
  }
}
const have = new Set((await list(DST, PREFIX)).map((o) => o.key));
const todo = [...walk(ATLAS_DIR, "")].filter((o) => !have.has(o.key));
console.log("to copy:", todo.length, "already there:", have.size);
let i = 0, ok = 0, fail = 0;
await Promise.all(Array.from({ length: 2 }, async () => { while (i < todo.length) { const o = todo[i++]; (await copy(o)) ? ok++ : fail++; if ((ok + fail) % 500 === 0) console.log(ok + fail, "/", todo.length); } }));
console.log("done ok", ok, "fail", fail);
if (fail) process.exit(1);
