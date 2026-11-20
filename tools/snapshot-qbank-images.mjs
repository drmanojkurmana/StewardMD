/* snapshot-qbank-images.mjs - every Qbank question image, for the Image Library (owner 2026-11-20: "all images in
 * qbank should also go to Image Bank").
 * Two sources, unioned by image key:
 *   - images built into the bank files (a local bank mirror, default ~/prep-data/qaudit/cache, item.img[])
 *   - images attached later through the live fix route (KV prep:fixmod:<module>.q[id].img[], index prep:fixix)
 * Caption is the question's own key point (kp), else the first sentence of its explanation: our written text about the
 * finding, never invented. Credits come from prep-bank/image-credits.json (built-in images by file id i-<hash>, fix
 * images by question id q-<id12>); a credited Commons image carries author, licence and its Commons page.
 * Writes kb/imglib/qbank-images.json, which tools/build-image-library.mjs reads.
 * Run (cwd = repo): node tools/snapshot-qbank-images.mjs [--cache <dir>] [--no-kv]
 * A failed KV read stops the run, so a partial snapshot never replaces a good one. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NS = "48a600aeff5b4500a2ae73e632eafe3f";

export function firstSentence(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,400}?[.!?])(\s|$)/);
  return m ? m[1] : t.slice(0, 400);
}
/* Title: the topic the question names, else the keyed option unless the stem asks for the exception. */
export function titleOf(it) {
  const topic = it.meta && it.meta.topic;
  if (topic) return String(topic).trim();
  const neg = /\b(except|not|false|incorrect|least)\b/i.test(String(it.q || ""));
  const opt = Array.isArray(it.o) ? it.o[it.a] : "";
  return !neg && opt ? String(opt).trim() : "";
}
export function captionFor(it) {
  return firstSentence(it.kp || (it.x && (it.x.pearl || it.x.key)) || it.exp || "");
}
export function entryFor(it, key, subject, module, credit) {
  const cap = captionFor(it);
  if (!key || cap.length < 20) return null;
  const e = { key, q: it.id, subject, module, title: titleOf(it), caption: cap, place: it.imgPlace === "stem" ? "stem" : "exp" };
  if (credit && /commons\.wikimedia\.org/.test(credit.sourceUrl || "")) {
    e.author = String(credit.author || "").slice(0, 100); e.licence = credit.licence || ""; e.page = credit.sourceUrl;
  }
  return e;
}

/* A bank image key as a path under prep-bank/. Bank files carry full paths (v16/ss-radiology/img/...); overlay sets
 * carry bare file names served from img/<set without its release digits>/ (prep-pyq.js imgBase). */
export function bankKey(key, rel) {
  const k = String(key || "");
  if (/^v\d{1,3}\//.test(k) || /^img\//.test(k)) return k;
  if (rel[0] === "overlay" && /^[a-z0-9-]{2,40}$/.test(rel[1] || "") && /^[\w.-]+\.(webp|png|jpe?g)$/i.test(k)) return "img/" + rel[1].replace(/\d+$/, "") + "/" + k;
  return "";
}

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".json") ? [path.join(d, e.name)] : []);
}
function kvGet(k) {
  for (let t = 1; t <= 5; t++) {
    try {
      const out = execFileSync("npx", ["wrangler", "kv", "key", "get", k, "--namespace-id", NS, "--remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: ROOT });
      const line = out.split("\n").filter((l) => l.trim().startsWith("{")).pop();
      return line ? JSON.parse(line) : null;
    } catch (e) {
      if (/404: Not Found/.test(String(e.stderr || ""))) return null;
      if (t === 5) throw new Error("KV read failed: " + k);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000 * t);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const ci = process.argv.indexOf("--cache");
  const CACHE = ci >= 0 ? path.resolve(process.argv[ci + 1]) : path.join(process.env.HOME, "prep-data/qaudit/cache");
  const credits = await (await fetch("https://stewardmd.in/api/prep/bank/image-credits.json")).json();
  if (!Array.isArray(credits) || credits.length < 10) throw new Error("credits did not load");
  const credById = new Map(credits.map((c) => [c.id, c]));
  const byId = new Map(), out = new Map();
  for (const f of walk(CACHE)) {
    let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    const items = Array.isArray(j) ? j : j.items || j.questions || [];
    const rel = path.relative(CACHE, f).split(path.sep), module = path.basename(f, ".json");
    const subject = (rel[0] === "overlay" ? rel[2] : rel[1]) || "general";
    for (const it of items) {
      if (!it || !it.id) continue;
      byId.set(it.id, { it, subject, module });
      for (const raw of (Array.isArray(it.img) ? it.img : [])) {
        const key = bankKey(raw, rel);
        if (!key) continue;
        const fid = path.basename(key, ".webp");
        const e = entryFor(it, key, subject, module, credById.get(fid));
        if (e && !out.has(key)) out.set(key, e);
      }
    }
  }
  let fixes = 0;
  if (!process.argv.includes("--no-kv")) {
    const ix = kvGet("prep:fixix") || {};
    for (const mod of Object.keys(ix)) {
      const rec = kvGet("prep:fixmod:" + mod);
      /* Questions published straight to the module (rec.a, functions/api/ai/_prep-qgen.js op publish) carry their own image. */
      for (const n of (rec && Array.isArray(rec.a) ? rec.a : [])) {
        if (!n || !n.id || !n.sub || !Array.isArray(n.img)) continue;
        for (const key of n.img) {
          const e = entryFor(n, key, n.sub, mod, credById.get("q-" + n.id.slice(0, 12)));
          if (e) { out.set(key, e); fixes++; }
        }
      }
      for (const [qid, fx] of Object.entries((rec && rec.q) || {})) {
        if (!fx || !Array.isArray(fx.img) || !fx.img.length) continue;
        const src = byId.get(qid);
        if (!src) continue;
        /* A rewritten question (fix q/o/a/kp) is captioned from its new text, as the app shows it (prep.js applyFix). */
        const it = Object.assign({}, src.it, { imgPlace: fx.imgPlace });
        for (const k of ["q", "o", "a", "exp", "kp"]) if (fx[k] != null) it[k] = fx[k];
        if (fx.o || fx.exp != null) { delete it.x; delete it.meta; }
        for (const key of fx.img) {
          const e = entryFor(it, key, src.subject, src.module, credById.get("q-" + qid.slice(0, 12)));
          if (e) { out.set(key, e); fixes++; }
        }
      }
    }
  }
  const items = [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
  const file = path.join(ROOT, "kb/imglib/qbank-images.json");
  fs.writeFileSync(file, JSON.stringify({ v: 1, made: new Date().toISOString().slice(0, 10), total: items.length, items }) + "\n");
  console.log(`qbank images: ${items.length} (${fixes} from fix records) -> ${path.relative(ROOT, file)}`);
}
