#!/usr/bin/env node
/* StewardMD - guideline source watch (F2).
 *
 * Every protocol, specialty kit and consent template cites its sources by URL. This script fetches each
 * cited URL and compares it with the committed baseline kb/source-watch.json, so a clinician hears when a
 * cited guideline page moved, broke or changed, instead of finding out from a patient.
 *
 *   node scripts/check-guideline-updates.mjs             check against the baseline, write the report
 *   node scripts/check-guideline-updates.mjs --update    also rewrite the baseline (after the report is read)
 *   node scripts/check-guideline-updates.mjs --limit 20  only the first 20 URLs (quick look)
 *
 * Report: vault/handoff/source-watch-report.md (overwritten each run) and, in GitHub Actions, the job
 * summary. Exit code is 0 even when sources changed: a changed page is a prompt to re-read, not a failure.
 * The fingerprint of a web page is a hash of its visible text (scripts, styles and tags stripped), so
 * cosmetic markup churn does not show; dynamic pages can still show as changed, which the report says.
 * A PDF or other file is not downloaded: its length, Last-Modified and ETag headers are the fingerprint.
 * Only public guideline URLs are fetched; nothing about users or patients is sent.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = "kb/source-watch.json";
const REPORT = "vault/handoff/source-watch-report.md";
const DIRS = [["protocol", "kb/clinical-protocols"], ["kit", "kb/specialty-kits/src"], ["consent", "kb/documents/consent"]];
const MAX_BYTES = 4 * 1024 * 1024, TIMEOUT_MS = 25000, UA = "StewardMD-source-watch/1.0 (+https://stewardmd.in)";

/** url -> [{ kind, id, title }] for every cited source. */
export function collectSources(root = ROOT) {
  const map = new Map();
  DIRS.forEach(([kind, dir]) => {
    const d = join(root, dir);
    if (!existsSync(d)) return;
    readdirSync(d).filter((f) => f.endsWith(".json") && f !== "index.json" && !f.startsWith("data-")).sort().forEach((f) => {
      let j; try { j = JSON.parse(readFileSync(join(d, f), "utf8")); } catch (e) { return; }
      (Array.isArray(j.sources) ? j.sources : []).forEach((s) => {
        if (!s || typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) return;
        if (!map.has(s.url)) map.set(s.url, []);
        map.get(s.url).push({ kind, id: j.id || f.slice(0, -5), title: s.title || "" });
      });
    });
  });
  return map;
}

/** Visible-text fingerprint of an HTML page (or raw bytes for anything else). */
export function fingerprint(body, contentType) {
  if (/html|xml|text\//i.test(contentType || "")) {
    const text = String(body)
      .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const title = (String(body).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    return { hash: createHash("sha256").update(text).digest("hex").slice(0, 16), title: title ? title.replace(/\s+/g, " ").trim().slice(0, 200) : "" };
  }
  return { hash: createHash("sha256").update(body).digest("hex").slice(0, 16), title: "" };
}

async function check(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA, accept: "text/html,application/pdf;q=0.9,*/*;q=0.8" } });
    const ct = r.headers.get("content-type") || "", isText = /html|xml|text\//i.test(ct);
    if (!isText) {
      // PDFs and other files: fingerprint the server's own version markers rather than downloading
      // megabytes (a new edition changes its length, date or ETag).
      try { await r.body?.cancel(); } catch (e) {}
      const marker = [r.headers.get("content-length"), r.headers.get("last-modified"), r.headers.get("etag")].filter(Boolean).join("|");
      return { status: r.status, finalUrl: r.url !== url ? r.url : "", lastModified: r.headers.get("last-modified") || "", type: ct.split(";")[0], hash: r.ok && marker ? fingerprint(marker, ct).hash : "", title: "" };
    }
    let buf = Buffer.alloc(0);
    if (r.body) {
      const chunks = []; let n = 0;
      for await (const c of r.body) { chunks.push(c); n += c.length; if (n > MAX_BYTES) { ctl.abort(); break; } }
      buf = Buffer.concat(chunks);
    }
    const fp = fingerprint(buf.toString("utf8"), ct);
    return { status: r.status, finalUrl: r.url !== url ? r.url : "", lastModified: r.headers.get("last-modified") || "", type: ct.split(";")[0], hash: r.ok ? fp.hash : "", title: fp.title };
  } catch (e) {
    return { status: 0, error: e.name === "AbortError" ? "timed out" : String(e.message || e).slice(0, 160) };
  } finally { clearTimeout(t); }
}

/** Pure comparison of one URL's result with its baseline entry. */
export function classify(prev, cur) {
  if (cur.status === 401 || cur.status === 403 || cur.status === 429) return "blocked";   // publisher refuses bots; not a dead link
  if (!cur.status || cur.status >= 400) return prev && (!prev.status || prev.status >= 400) && [401, 403, 429].indexOf(prev.status) < 0 ? "still-broken" : "broken";
  if (!prev) return "new";
  if (prev.status >= 400 || !prev.status) return "recovered";   // includes a previously blocked page that now answers
  if ((cur.finalUrl || "") !== (prev.finalUrl || "")) return "moved";
  if (cur.hash && prev.hash && cur.hash !== prev.hash) return "changed";
  return "same";
}

export function reportMarkdown(rows, when, total) {
  const by = (k) => rows.filter((r) => r.cls === k);
  const who = (r) => r.cited.map((c) => `${c.kind} \`${c.id}\``).join(", ");
  const L = ["---", "tags: [handoff, clinical-content, sources]", "---", `# Guideline source watch, ${when.slice(0, 10)}`, "",
    `Checked ${rows.length} of ${total} cited URLs against \`${BASELINE}\`. A changed page is a prompt to re-read the source and`,
    "check the protocol or kit that cites it; dynamic pages (news, cookie banners) can show as changed without a real update.", ""];
  const sec = (k, head, line) => { const x = by(k); if (!x.length) return; L.push(`## ${head} (${x.length})`, ""); x.forEach((r) => L.push("- " + line(r))); L.push(""); };
  sec("broken", "Broken now", (r) => `${r.url} (${r.error || "HTTP " + r.status}); cited by ${who(r)}`);
  sec("moved", "Moved", (r) => `${r.url} now redirects to ${r.finalUrl}; cited by ${who(r)}`);
  sec("changed", "Content changed", (r) => `${r.url}${r.title ? ` ("${r.title}")` : ""}; cited by ${who(r)}`);
  sec("recovered", "Working again", (r) => `${r.url}; cited by ${who(r)}`);
  sec("new", "New (no baseline yet)", (r) => `${r.url}; cited by ${who(r)}`);
  sec("still-broken", "Still broken", (r) => `${r.url} (${r.error || "HTTP " + r.status}); cited by ${who(r)}`);
  sec("blocked", "Blocked to automated checks (403)", (r) => `${r.url}; cited by ${who(r)}`);
  L.push(`Unchanged: ${by("same").length}.`, "");
  return L.join("\n");
}

async function main() {
  const args = process.argv.slice(2), update = args.includes("--update");
  const li = args.indexOf("--limit"), limit = li >= 0 ? parseInt(args[li + 1], 10) : 0;
  const sources = collectSources(), urls = [...sources.keys()].sort(), todo = limit > 0 ? urls.slice(0, limit) : urls;
  const bf = join(ROOT, BASELINE), base = existsSync(bf) ? JSON.parse(readFileSync(bf, "utf8")) : { schema: 1, urls: {} };
  const rows = [], conc = 6; let next = 0;
  async function worker() {
    while (next < todo.length) {
      const url = todo[next++], cur = await check(url);
      rows.push({ url, ...cur, cls: classify(base.urls[url], cur), cited: sources.get(url) });
      if (rows.length % 25 === 0) console.log(`  ${rows.length}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  rows.sort((a, b) => a.url.localeCompare(b.url));
  const when = new Date().toISOString(), md = reportMarkdown(rows, when, urls.length);
  const rf = join(ROOT, REPORT); mkdirSync(dirname(rf), { recursive: true }); writeFileSync(rf, md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.replace(/^---[\s\S]*?---\n/, ""));
  const counts = {}; rows.forEach((r) => { counts[r.cls] = (counts[r.cls] || 0) + 1; });
  console.log(`Checked ${rows.length}/${urls.length}: ` + Object.keys(counts).sort().map((k) => `${k} ${counts[k]}`).join(", ") + `. Report: ${REPORT}`);
  if (update) {
    const out = { schema: 1, checkedAt: when, urls: {} };
    urls.forEach((u) => { const r = rows.find((x) => x.url === u); const keep = r ? { status: r.status, finalUrl: r.finalUrl || "", hash: r.hash || "", lastModified: r.lastModified || "" } : base.urls[u]; if (keep) out.urls[u] = keep; });
    writeFileSync(bf, JSON.stringify(out, null, 1) + "\n");
    console.log("Baseline updated: " + BASELINE);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
