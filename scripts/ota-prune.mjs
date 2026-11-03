#!/usr/bin/env node
/* scripts/ota-prune.mjs — OTA retention: keep only the last N published builds in R2 (owner rule 2026-11-03: N = 10).
 *
 * Layout (scripts/ota-stage.mjs): ota/manifests/<commit>.json lists every file of a build by content hash; the bytes
 * live once in ota/files/<hash> (shared across builds) plus one zip per build (manifest.zipHash, also in ota/files/).
 * ota/known-hashes.json tells staging which hashes are already uploaded, so staging SKIPS them.
 *
 * Keep set = manifests of the N newest versions in ota/history.json ∪ the live channel ∪ the staged candidate.
 * Everything else under ota/manifests/ is deleted, then every ota/files/<hash> no kept manifest references.
 * Order matters: known-hashes.json is rewritten to the kept set FIRST, so a prune that stops half-way can only leave
 * extra files behind, never a hash that staging believes exists but was deleted. Run it in the ota-stage concurrency
 * group (see .github/workflows/ota-prune.yml) so it never overlaps a staging run.
 *
 * RUN   node scripts/ota-prune.mjs [--keep 10] [--apply]        dry run unless --apply
 * Needs CLOUDFLARE_API_TOKEN (R2 read/write) and CLOUDFLARE_ACCOUNT_ID.
 */
const BUCKET = "stewardmd-offline";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const KEEP = Number(arg("--keep", "10"));
const APPLY = process.argv.includes("--apply");
const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCT) { console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required"); process.exit(2); }
if (!(KEEP >= 1)) { console.error("--keep must be >= 1"); process.exit(2); }

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/r2/buckets/${BUCKET}/objects`;
const enc = (key) => key.split("/").map(encodeURIComponent).join("/");
async function cf(method, key, body, tries = 8) {
  for (let t = 1; ; t++) {
    const r = await fetch(`${BASE}/${enc(key)}`, { method, headers: { Authorization: `Bearer ${TOKEN}` }, body });
    if (r.ok || (method === "DELETE" && r.status === 404)) return r;
    if (t >= tries || (r.status < 500 && r.status !== 429)) throw new Error(`${method} ${key}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((s) => setTimeout(s, r.status === 429 ? 2000 * 2 ** (t - 1) : 500 * t));  // Cloudflare API rate limit: back off hard
  }
}
const getJSON = async (key, fb) => { try { return await (await cf("GET", key)).json(); } catch { return fb; } };
async function list(prefix) {
  const out = []; let cursor = "";
  for (;;) {
    const r = await fetch(`${BASE}?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const d = await r.json();
    if (!d.success) throw new Error(`list ${prefix}: ${JSON.stringify(d.errors)}`);
    out.push(...d.result);
    cursor = d.result_info && d.result_info.is_truncated ? d.result_info.cursor : "";
    if (!cursor) return out;
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }

const live = await getJSON("ota/channels/stable.json", null);
const history = await getJSON("ota/history.json", []);
const candidate = await getJSON("ota/candidate.json", null);
if (!live || !live.manifestKey) throw new Error("live channel ota/channels/stable.json is missing: refusing to prune");

const publishes = history.filter((h) => h && h.manifestKey && (h.action === "publish" || !h.action)).sort((a, b) => b.version - a.version);
const keepKeys = new Set(publishes.slice(0, KEEP).map((h) => h.manifestKey));
keepKeys.add(live.manifestKey);
if (candidate && candidate.manifestKey) keepKeys.add(candidate.manifestKey);

const referenced = new Set();
for (const k of keepKeys) {
  const m = await getJSON(k, null);
  if (!m || !Array.isArray(m.files)) {
    if (k === live.manifestKey) throw new Error(`live manifest ${k} unreadable: refusing to prune`);
    console.warn(`  kept manifest ${k} unreadable; not counted`); continue;
  }
  for (const f of m.files) referenced.add(f.hash);
  if (m.zipHash) referenced.add(m.zipHash);
}

const manifests = await list("ota/manifests/");
const files = await list("ota/files/");
const delManifests = manifests.filter((o) => !keepKeys.has(o.key));
const delFiles = files.filter((o) => !referenced.has(o.key.slice("ota/files/".length)));
const present = new Set(files.map((o) => o.key.slice("ota/files/".length)));
const missing = [...referenced].filter((h) => !present.has(h));
const gb = (xs) => (xs.reduce((s, o) => s + (o.size || 0), 0) / 1e9).toFixed(2);

console.log(`live v${live.version} ${live.manifestKey}`);
console.log(`keep ${keepKeys.size} manifests (last ${KEEP} published + live + candidate), ${referenced.size} referenced files`);
console.log(`manifests: ${manifests.length} total, delete ${delManifests.length}`);
console.log(`files: ${files.length} total (${gb(files)} GB), delete ${delFiles.length} (${gb(delFiles)} GB)`);
if (missing.length) console.warn(`WARNING: ${missing.length} files referenced by kept builds are already missing from R2 (not caused by this script)`);
if (!APPLY) { console.log("dry run: re-run with --apply to delete"); process.exit(0); }

// 1) known-hashes first: only hashes that exist AND are referenced by a kept build.
const known = [...referenced].filter((h) => present.has(h));
await cf("PUT", "ota/known-hashes.json", JSON.stringify(known));
console.log(`known-hashes.json rewritten: ${known.length} hashes`);
// 2) unreferenced files, 3) old manifests.
let n = 0;
await pool(delFiles, 6, async (o) => { await cf("DELETE", o.key); if (++n % 1000 === 0) console.log(`  deleted ${n}/${delFiles.length} files`); });
await pool(delManifests, 6, async (o) => { await cf("DELETE", o.key); });
// 4) verify the live build is complete.
const after = new Set((await list("ota/files/")).map((o) => o.key.slice("ota/files/".length)));
const lm = await getJSON(live.manifestKey, { files: [] });
const gone = lm.files.filter((f) => !after.has(f.hash)).length + (lm.zipHash && !after.has(lm.zipHash) ? 1 : 0);
console.log(`done: deleted ${delFiles.length} files and ${delManifests.length} manifests; live build missing files: ${gone}`);
if (gone) process.exit(1);
