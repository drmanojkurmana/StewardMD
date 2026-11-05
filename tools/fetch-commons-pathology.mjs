/* fetch-commons-pathology.mjs: openly licensed pathology and histology micrographs from Wikimedia Commons for the
 * Image Library (owner 2026-11-04: "add any open source CC pathology and histology images to image bank").
 *
 * Walks the Commons category trees "Histopathology of <organ system>", "Histopathology of neoplasms", "Histopathology
 * of infectious diseases and disorders" and "Histology by organ system", and keeps a file only when:
 *   - its licence is CC BY, CC BY-SA, CC0 or public domain (no NC, no ND, no fair use),
 *   - it is a JPEG or PNG at least 400 px wide (no diagrams in SVG, no video),
 *   - the uploader wrote an English description of at least 20 characters (that text is the caption, unchanged apart
 *     from stripping markup; nothing is written by us).
 * Writes kb/imglib/commons-pathology.json (data only: Commons thumbnail URL, title, caption, author, licence and
 * the file page for attribution). No image is downloaded or copied into the repo; the app loads the Commons
 * thumbnail, the same way it already loads other Wikimedia images. tools/build-image-library.mjs merges the file.
 *
 * Run: node tools/fetch-commons-pathology.mjs [--per-cat 25] [--per-seed 320] [--depth 3]
 * Polite by design: one request at a time, a pause between requests, backoff on 429 and maxlag. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "kb/imglib/commons-pathology.json");
const UA = "StewardMD-imagebank/1.0 (https://github.com/drmanojkurmana/stewardmd; image index build)";
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? +process.argv[i + 1] : d; };
const PER_CAT = arg("per-cat", 25), PER_SEED = arg("per-seed", 320), DEPTH = arg("depth", 3);

/* Seed category -> canonical system (the names tools/build-image-library.mjs canonicalSystem returns). "kind" is
 * the default image kind: disease tissue is Histopathology, normal tissue is Histology. */
export const SEEDS = [
  ["Histopathology of the blood and blood-forming organs and certain disorders involving the immune mechanism", "Haematology", "Histopathology"],
  ["Histopathology of the circulatory system", "Cardiology", "Histopathology"],
  ["Histopathology of the digestive system", "Gastroenterology", "Histopathology"],
  ["Histopathology of endocrine, metabolic and nutritional diseases", "Endocrine and Metabolic", "Histopathology"],
  ["Histopathology of the genitourinary system", "Renal and Urology", "Histopathology"],
  ["Histopathology of the musculoskeletal system and connective tissue", "Orthopaedics and Rheumatology", "Histopathology"],
  ["Histopathology of the nervous system", "Neurology", "Histopathology"],
  ["Histopathology of the respiratory tract", "Respiratory", "Histopathology"],
  ["Histopathology of skin and subcutaneous tissue", "Dermatology", "Histopathology"],
  ["Histopathology of neoplasms", "Oncology", "Histopathology"],
  ["Histopathology of infectious diseases and disorders", "Infectious Diseases", "Histopathology"],
  ["Histology by organ system", "Anatomy", "Histology"],
];

const LICENCE_OK = /^(cc[ -]by(-sa)?[ -]\d(\.\d)?|cc0|public domain|pd\b|pd-)/i;
const SKIP_CAT = /veterinar|animal|plant|\bdogs?\b|\bcats?\b|\bmice\b|\bmouse\b|\brats?\b|horse|cattle|fish|bird|insect|botan|videos?\b|publications?|people|histologists|by country|schematic|diagrams?/i;

export function stripHtml(s) {
  return String(s == null ? "" : s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/\s+/g, " ").trim();
}
/* "File:Adenocarcinoma_of_the_colon_--_high_mag.jpg" -> "Adenocarcinoma of the colon, high mag" */
export function titleFromFile(t) {
  return String(t || "").replace(/^File:/, "").replace(/\.(jpe?g|png|tiff?)$/i, "").replace(/_/g, " ")
    .replace(/\s+--\s+/g, ", ").replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ").trim();
}
/* Keep a caption to whole sentences under about 500 characters. Text is the uploader's, only trimmed. */
export function trimCaption(s) {
  s = stripHtml(s);
  if (s.length <= 500) return s;
  const cut = s.slice(0, 500), dot = cut.lastIndexOf(". ");
  return dot > 120 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + " ...";
}
export function kindFor(text, dflt) {
  const t = String(text || "").toLowerCase();
  if (/\bgross\b|autopsy specimen|resection specimen|cut surface|macroscop/.test(t)) return "Gross specimen";
  if (/cytolog|\bsmear\b|aspirat|pap stain|papanicolaou|\bfna\b|cytospin/.test(t)) return "Cytology";
  if (/immunohisto|immunostain|\bihc\b/.test(t)) return "Immunohistochemistry";
  return dflt;
}
/* An English description that says something: letters, not just "own work" or a file name. */
export function usableCaption(c, title) {
  if (!c || c.length < 20) return false;
  if (/^(own work|self[- ]made|photo|image|picture|micrograph)\.?$/i.test(c)) return false;
  if (c.toLowerCase() === String(title || "").toLowerCase()) return false;
  const latin = (c.match(/[a-z]/gi) || []).length;
  return latin / c.length > 0.55;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
async function api(q) {
  await sleep(calls++ ? 700 : 0);
  for (let i = 0, w = 5000; i < 10; i++, w = Math.min(w * 2, 120000)) {
    let r, t;
    try {
      r = await fetch("https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&maxlag=5&" + new URLSearchParams(q), { headers: { "User-Agent": UA } });
      t = await r.text();
    } catch (e) { t = String(e); }
    if (r && r.ok && t.startsWith("{")) { const j = JSON.parse(t); if (!j.error) return j; if (j.error.code !== "maxlag") throw new Error(j.error.info); }
    process.stderr.write(`  wait ${w / 1000}s (${r ? r.status : "net"})\n`);
    await sleep(w);
  }
  throw new Error("Commons did not answer after 10 tries");
}

async function subcats(cat) {
  const out = []; let cont = {};
  do {
    const j = await api({ action: "query", list: "categorymembers", cmtitle: "Category:" + cat, cmtype: "subcat", cmlimit: 500, ...cont });
    for (const m of j.query.categorymembers) out.push(m.title.replace(/^Category:/, ""));
    cont = j.continue || null;
  } while (cont);
  return out;
}
async function files(cat, limit) {
  const out = []; let cont = {};
  do {
    const j = await api({ action: "query", generator: "categorymembers", gcmtitle: "Category:" + cat, gcmtype: "file", gcmlimit: 50,
      prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: 800, iiextmetadatalanguage: "en",
      iiextmetadatafilter: "ImageDescription|Artist|Credit|LicenseShortName|UsageTerms|Restrictions", ...cont });
    for (const p of (j.query && j.query.pages) || []) out.push(p);
    cont = j.continue || null;
  } while (cont && out.length < limit * 3);
  return out;
}

async function main() {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { return null; } })();
  const items = [], seenFile = new Set(), seenCat = new Set();
  const stats = {};
  for (const [seed, system, dkind] of SEEDS) {
    let kept = 0;
    const queue = [[seed, 0]];
    stats[seed] = { cats: 0, kept: 0 };
    while (queue.length && kept < PER_SEED) {
      const [cat, d] = queue.shift();
      if (seenCat.has(cat)) continue;
      seenCat.add(cat); stats[seed].cats++;
      let pages = [];
      try { pages = await files(cat, PER_CAT); } catch (e) { process.stderr.write(`  skip ${cat}: ${e.message}\n`); }
      let inCat = 0;
      for (const p of pages) {
        if (inCat >= PER_CAT || kept >= PER_SEED) break;
        const ii = p.imageinfo && p.imageinfo[0]; if (!ii) continue;
        if (seenFile.has(p.title)) continue;
        if (!/^image\/(jpeg|png)$/.test(ii.mime) || ii.width < 400 || !ii.thumburl) continue;
        const md = ii.extmetadata || {}, v = (k) => (md[k] && md[k].value) || "";
        const lic = stripHtml(v("LicenseShortName"));
        if (!LICENCE_OK.test(lic) || /\bnc\b|\bnd\b|non-?commercial|no ?deriv/i.test(lic + " " + v("UsageTerms"))) continue;
        const title = titleFromFile(p.title), cap = trimCaption(v("ImageDescription"));
        if (!usableCaption(cap, title)) continue;
        seenFile.add(p.title);
        items.push({ src: ii.thumburl, title, caption: cap, author: stripHtml(v("Artist")).slice(0, 160) || stripHtml(v("Credit")).slice(0, 160),
          licence: lic, page: ii.descriptionurl, w: ii.thumbwidth, h: ii.thumbheight, kind: kindFor(title + " " + cap + " " + cat, dkind),
          system, category: cat });
        inCat++; kept++;
      }
      if (d < DEPTH) for (const s of await subcats(cat)) if (!SKIP_CAT.test(s) && !seenCat.has(s)) queue.push([s, d + 1]);
    }
    stats[seed].kept = kept;
    process.stderr.write(`${system} <- ${seed}: ${kept} images from ${stats[seed].cats} categories\n`);
  }
  if (prev && prev.items && items.length < prev.items.length * 0.6) throw new Error(`only ${items.length} images (was ${prev.items.length}); not overwriting`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, source: "Wikimedia Commons", fetched: new Date().toISOString().slice(0, 10),
    rule: "CC BY, CC BY-SA, CC0 or public domain; uploader's English description as caption", items }, null, 0) + "\n");
  console.log(`commons-pathology: ${items.length} images -> ${path.relative(ROOT, OUT)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch((e) => { console.error(e.message); process.exit(1); });
