// KB article figure engine (owner 2026-10-16, cap $50 TOTAL for the whole job).
// KB variant of ~/prep-data/assessment/pipeline/img-engine2.mjs: candidates are KB disease
// articles (kb/reference/*.json) instead of lesson steps.
//
// Free-licence image first (Wikimedia Commons: CC0/PD/CC BY/CC BY-SA, credited), then a
// Vertex-generated figure; one Gemini Flash reviewer scores 0-100, >= 70 ships (R2 +
// figures[] image entry), < 70 goes to the owner's rejected queue
// (~/prep-data/ir-work/kb-img-rejected) and is NOT wired.
//
// usage: REPO=<kb-figs worktree> node tools/kb-img-engine.mjs <limit> [capUSD]
//   PAR=4 (parallel articles), KEYPREFIX=<id prefix>, DRY_RUN=1 (rank only, zero spend).
// Spend is persisted in ~/prep-data/ir-work/kb-img-state.json and HARD STOPS at the cap:
// every paid call checks the counter first and the worker loop exits when it is reached.
// Each article logs its spend. Attribution rows go to prep/lessons/media/ATTRIBUTION.md
// (same style as lesson media). Owner rules, enforced in prompts and checks: no PHI, no
// brand marks, no watermarks, no R/L markers on real scans; real clinical photos only from
// CC licences already allowed by tools/prep-imgharvest.mjs rules.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { bucketOf as bucketOfV2, entryFor as entryForV2 } from "../kb/tools/build-kb-v2.mjs";

const REPO = process.env.REPO;
if (!REPO) { console.error("REPO=<worktree> is required"); process.exit(2); }
const LIMIT = Number(process.argv[2] || 50), CAP = Number(process.argv[3] || 50);
const PAR = Number(process.env.PAR || 4);
const DRY = process.env.DRY_RUN === "1";
const P = "project-6074a703-e86c-40a5-848";
const HOST = "https://aiplatform.googleapis.com/v1/projects/" + P + "/locations/global/publishers/google/models/";
const WORK = process.env.KB_IMG_WORK || path.join(os.homedir(), "prep-data/ir-work");
const REJ = path.join(WORK, "kb-img-rejected");
const KEYS = path.join(WORK, "kb-img-shipped-keys.txt");
const shippedKeys = new Set(fs.existsSync(KEYS) ? fs.readFileSync(KEYS, "utf8").split("\n").filter(Boolean) : []);
const STATE = path.join(WORK, "kb-img-state.json");
const UA = "StewardMD-PrepNucleus-ImageHarvest/1.0 (https://stewardmd.com; contact drmanojkurmana@gmail.com)";
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { spent: 0, shipped: 0, rejected: 0, skipped: 0, commons: 0, ai: 0, failed: {}, byModel: {} };
const { putR2Object } = await import(path.join(REPO, "tools/prep-r2-s3.mjs"));
fs.mkdirSync(REJ, { recursive: true });
function saveState() { fs.writeFileSync(STATE, JSON.stringify(state)); }
function capHit(cost) { return state.spent + cost > CAP; }

let tok = "", tokAt = 0;
function token() { if (Date.now() - tokAt > 40 * 60e3) { tok = execFileSync("gcloud", ["auth", "application-default", "print-access-token"], { encoding: "utf8" }).trim(); tokAt = Date.now(); } return tok; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gen(model, body, cost) {
  if (capHit(cost)) throw new Error("CAP $" + CAP + " reached (spent $" + state.spent.toFixed(2) + ")");
  for (let a = 0; a < 5; a++) {
    const r = await fetch(HOST + model + ":generateContent", { method: "POST", headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { state.spent += cost; return r.json(); }
    if (r.status === 429 || r.status >= 500) { await sleep(6000 * (a + 1)); continue; }
    throw new Error(model + " " + r.status + " " + (await r.text()).slice(0, 160));
  }
  throw new Error(model + " retries exhausted");
}
const POOL = [{ m: "gemini-3.1-flash-lite-image", cost: 0.04 }, { m: "gemini-3.1-flash-image", cost: 0.07 }, { m: "gemini-3-pro-image", cost: 0.14 }];
const cool = {};
async function genImage(body) {
  for (let round = 0; round < 60; round++) {
    for (const p of POOL) {
      if ((cool[p.m] || 0) > Date.now()) continue;
      if (capHit(p.cost)) throw new Error("CAP $" + CAP + " reached (spent $" + state.spent.toFixed(2) + ")");
      const r = await fetch(HOST + p.m + ":generateContent", { method: "POST", headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 429 || r.status >= 500) { cool[p.m] = Date.now() + 15000; continue; }
      if (!r.ok) throw new Error(p.m + " " + r.status + " " + (await r.text()).slice(0, 120));
      state.spent += p.cost; state.byModel[p.m] = (state.byModel[p.m] || 0) + 1;
      return r.json();
    }
    await sleep(3000);
  }
  throw new Error("image quota exhausted for 3 min");
}
const textOf = (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
const clean = (s) => String(s || "").replace(/[–—]/g, "-").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---- licences (same rules as tools/prep-imgharvest.mjs) ----
function parseLicence(lic) {
  if (!lic) return null; const s = String(lic).trim();
  if (/(-nc\b|-nd\b|\bnc\b|\bnd\b|non-?commercial|no-?derivatives|fair\s*use|unknown|ambiguous)/i.test(s)) return null;
  if (/^gfdl/i.test(s) && !/cc\s*by/i.test(s)) return null;
  if (/^(cc0|pdm|public\s*domain|pd\b|pd-)/i.test(s)) return "CC0/PD";
  const sa = s.match(/cc\s*by-sa(?:-igo)?(?:\s*v?(\d(?:\.\d)?))?/i); if (sa) return "CC BY-SA" + (sa[1] ? " " + sa[1] : "");
  const by = s.match(/cc\s*by(?:-igo)?(?:\s*v?(\d(?:\.\d)?))?/i); if (by) return "CC BY" + (by[1] ? " " + by[1] : "");
  return null;
}

// ---- ranking: clinical importance (links index inbounds + nucleus360 hubs + core systems) ----
function linkCounts() {
  const counts = {};
  try {
    const d = JSON.parse(fs.readFileSync(path.join(REPO, "prep/bank/topic-links.json"), "utf8"));
    for (const v of Object.values(d.modules || {})) for (const k of v.kb || []) {
      const id = Array.isArray(k) ? k[0] : k;
      counts[id] = (counts[id] || 0) + 1;
    }
  } catch { /* links index absent: ranking falls back to systems + hubs */ }
  return counts;
}
function hubNames() {
  const names = new Set();
  try {
    const d = JSON.parse(fs.readFileSync(path.join(REPO, "prep/nucleus360/topics.json"), "utf8"));
    for (const t of d.topics || []) {
      if (t.kb) names.add(String(t.kb));
      if (t.kbTitle) names.add(norm(t.kbTitle));
      names.add(norm(t.id)); names.add(norm(t.title));
    }
  } catch { /* hubs absent: no hub bonus */ }
  return names;
}
// Systems whose articles most often carry image-worthy content (imaging, ECG, smear, rash,
// gross/histology, procedures). Rare-metabolic and pure-genetic entities score lower but are
// NOT excluded here: the planner judges image-worthiness per article and skips fillers.
const CORE_SYSTEMS = new Set(["cardiology", "respiratory", "dermatology", "neurology", "gastroenterology",
  "nephrology", "hematology", "oncology", "endocrinology", "rheumatology", "infectious", "obstetrics",
  "pediatrics", "surgery", "ophthalmology", "radiology", "emergency", "intensive", "pathology"]);
function scoreArticle(a, links, hubs) {
  let s = Math.min(links[a.id] || 0, 10) * 2;
  const sys = norm(a.system).split(" ")[0];
  if ([...CORE_SYSTEMS].some((c) => sys.includes(c.replace("obstetrics", "obstet")))) s += 3;
  if (hubs.has(a.id) || hubs.has(norm(a.name))) s += 5;
  if (a.referenceOnly === false) s += 1;
  return s;
}

function articleText(d) {
  const parts = [d.name, (d.aliases || []).join("; "), d.system, d.specialty, d.class];
  const h = d.harrison || {}, r = d.reference || {};
  parts.push((h.clinicalPearls || []).join(" "), (r.clinicalPearls || []).join(" "),
    (h.redFlags || []).join(" "), (r.redFlags || []).join(" "),
    h.pathophysiology || "", r.summary || "");
  for (const k of ["algorithms", "tables", "diagrams", "valueTables", "flowcharts"])
    for (const x of d[k] || []) parts.push(x.title || "");
  return clean(parts.filter(Boolean).join(" \n"));
}

function candidates() {
  const links = linkCounts(), hubs = hubNames();
  const dir = path.join(REPO, "kb/reference"), out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const id = f.replace(/\.json$/, "");
    if (process.env.KEYPREFIX && !id.startsWith(process.env.KEYPREFIX)) continue;
    if (shippedKeys.has(id) || (state.failed[id] || 0) >= 2 || fs.existsSync(path.join(REJ, id + ".json"))) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if ((d.figures || []).some((x) => x && x.type === "image")) continue;
    // A diagnostic disease wins the v2 bucket over a same-id reference entry: never ship blind.
    try {
      const dd = JSON.parse(fs.readFileSync(path.join(REPO, "kb/diseases", id + ".json"), "utf8"));
      if (((dd.flowcharts || []).length || (dd.valueTables || []).length || (dd.figures || []).length)) continue;
    } catch { /* no diagnostic twin: reference entry owns the bucket */ }
    out.push({ id, file: path.join(dir, f), d, score: scoreArticle(d, links, hubs), links: links[id] || 0 });
  }
  out.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : 1));
  return out;
}

async function plan(c) {
  const text = articleText(c.d);
  const prompt = `You plan ONE textbook illustration for a knowledge-base disease article read by doctors (the same article serves every exam: NEET-PG, NEET-SS, ward reference).
Article: ${c.d.name} (system: ${c.d.system || "?"}; specialty: ${c.d.specialty || "?"}; aliases: ${(c.d.aliases || []).join("; ") || "none"}).
Article text:
${text.slice(0, 3500)}
First decide image-worthiness: the article earns an illustration ONLY when it has image-worthy anatomy, pathology, imaging (X-ray/CT/MRI/ultrasound/echo), ECG, smear/histology, rash/skin lesion, or procedure content a good textbook would print. Pure-lab entities with nothing to show, and administrative lists, are NOT image-worthy: say so.
Use ONLY facts stated in the article text (no new numbers, drugs, doses or claims).
Return only JSON: {"imageWorthy": true/false, "reason": "one short sentence", "searchQueries": ["3 short Wikimedia Commons search phrases for a real diagram, drawing or clinical/histology/imaging image of this topic, most specific first"], "composition": "what to draw if no free image exists, 2-4 sentences", "labels": ["up to 8 short labels, 1-3 words, correctly spelled"], "figureTitle": "under 6 words", "caption": "under 14 words", "alt": "under 35 words"}`;
  const j = await gen("gemini-2.5-flash", { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.3 } }, 0.003);
  const o = JSON.parse(textOf(j));
  o.labels = (o.labels || []).map(clean).slice(0, 8); o.searchQueries = (o.searchQueries || []).map(clean).filter(Boolean).slice(0, 3);
  return o;
}

// ---- free images: Wikimedia Commons ----
async function commonsSearch(q) {
  const u = "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=" + encodeURIComponent(q + " filetype:bitmap") + "&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=900";
  await sleep(400);
  const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) return [];
  const j = await r.json(); const out = [];
  for (const pg of Object.values(j.query?.pages || {})) {
    const ii = pg.imageinfo?.[0]; if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || "")) continue;
    if ((ii.width || 0) < 450 || (ii.height || 0) < 300) continue;
    const em = ii.extmetadata || {};
    const lic = parseLicence(em.LicenseShortName?.value || em.UsageTerms?.value);
    if (!lic) continue;
    out.push({ title: pg.title, thumb: ii.thumburl || ii.url, page: ii.descriptionurl, author: clean(em.Artist?.value || "Unknown").split(/\s+Author info\b/)[0].trim().slice(0, 70), licence: lic, licenceName: clean(em.LicenseShortName?.value) });
  }
  return out;
}
async function download(url) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status === 429) await sleep(5000 * (a + 1)); else break;
  }
  return null;
}
const RULES = "The image must be de-identified: no readable patient name or ID, no face that identifies a person, no watermark, brand or logo, no left/right side markers added to a scan, no photograph of a recognisable person.";
async function pickCommons(c, pl, cands) {
  const imgs = [];
  for (const k of cands.slice(0, 6)) { const b = await download(k.thumb); if (b) imgs.push({ k, b }); }
  if (!imgs.length) return null;
  const parts = [{ text: `Article: ${c.d.name} (${c.d.system || "?"}). Article text: ${articleText(c.d).slice(0, 2500)}\nThe article needs an illustration like: ${pl.composition}\nBelow are ${imgs.length} candidate free images, numbered 0..${imgs.length - 1} in order. Pick the single best one for this article.\nCheck: it clearly shows the article topic and is correct for a textbook; legible and good quality; not misleading; ${RULES}\nReturn only JSON: {"best": index or -1 when none is usable, "score": 0-100, "issues": "short problems or empty", "figureTitle": "under 6 words, naming what the CHOSEN image shows", "caption": "under 14 words, describing only what the CHOSEN image shows", "alt": "under 35 words, describing only what the CHOSEN image shows"}.` }];
  imgs.forEach((x, i) => { parts.push({ text: "Image " + i + ":" }); parts.push({ inlineData: { mimeType: /png/i.test(x.k.thumb) ? "image/png" : "image/jpeg", data: x.b.toString("base64") } }); });
  const j = await gen("gemini-2.5-flash", { contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }, 0.01);
  const o = JSON.parse(textOf(j)); const i = Number(o.best);
  if (!(i >= 0 && imgs[i])) return { score: Number(o.score) || 0, issues: clean(o.issues), none: true };
  return { img: imgs[i], score: Number(o.score) || 0, issues: clean(o.issues), desc: { figureTitle: o.figureTitle, caption: o.caption, alt: o.alt } };
}

// ---- generated figure fallback (owner 2026-11-01: full colour, realistic 3D, premium; never the flat teal/navy look) ----
const STYLE = "Premium full-colour medical illustration with a realistic 3D rendered look, like a high-end anatomy atlas or medical animation still: true-to-life tissue, organ and skin colours, soft realistic lighting and depth, crisp detail, clean light neutral background. No watermark, no logos, no patient identifiers, no photograph of a real identifiable person. Use only the labels given, spelled exactly, in a clear sans-serif font with thin leader lines to the structure each names; if a label would crowd the figure leave it out.";
async function aiFigure(c, pl, issues) {
  const p = `${STYLE}\nDraw: ${pl.composition}\nLabels (exact spelling): ${pl.labels.join("; ")}${issues ? "\nFix these problems from the previous attempt: " + issues : ""}`;
  const j = await genImage({ contents: [{ role: "user", parts: [{ text: p }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } });
  for (const part of j.candidates?.[0]?.content?.parts || []) if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  throw new Error("no image returned");
}
async function judgeAi(buf, c, pl) {
  const prompt = `You are a medical-education figure reviewer. Article: ${c.d.name}. Article text: ${articleText(c.d).slice(0, 3000)}\nIntended figure: ${pl.composition}. Intended labels: ${pl.labels.join("; ")}.\nCheck: every number, drug name and claim visible is supported by the article text; the figure is correct for a textbook; every visible word is a real, correctly spelled term; labels point to the right structures; no watermark or logo; readable; ${RULES}\nReturn only JSON: {"score": 0-100, "issues": "short problems or empty"}.`;
  const j = await gen("gemini-2.5-flash", { contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: buf.toString("base64") } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }, 0.003);
  const o = JSON.parse(textOf(j)); return { score: Number(o.score) || 0, issues: clean(o.issues) };
}
function toWebp(buf, outFile) {
  const r = spawnSync("python3", ["-c", "import sys,io;from PIL import Image;im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB');w,h=im.size\nif w>1000: im=im.resize((1000,int(h*1000/w)));w,h=im.size\nim.save(sys.argv[1],'WEBP',quality=80,method=6);print(w,h)", outFile], { input: buf, encoding: "utf8", maxBuffer: 1 << 26 });
  const [w, h] = r.stdout.trim().split(" ").map(Number); return { ar: +(w / h).toFixed(4) };
}

function figName(id) { return (id.toLowerCase() + "-fig1").replace(/[^a-z0-9-]/g, "-").slice(0, 78); }

async function one(c) {
  let pl = await plan(c);
  if (!pl.imageWorthy) { state.skipped++; return `SKIPPED not-image-worthy (${pl.reason || "no reason"})`.slice(0, 140); }
  const name = figName(c.id);
  let best = null;                                              // { buf, score, issues, kind, credit }
  // 1) free image
  const seen = new Set(), cands = [];
  for (const q of pl.searchQueries) { for (const k of await commonsSearch(q)) if (!seen.has(k.title)) { seen.add(k.title); cands.push(k); } if (cands.length >= 6) break; }
  if (cands.length) {
    const r = await pickCommons(c, pl, cands);
    if (r && r.img) best = { buf: r.img.b, score: r.score, issues: r.issues, kind: "commons", credit: r.img.k, desc: r.desc };
  }
  // 2) generated figure when no free image reached 70
  if (!best || best.score < 70) {
    let issues = "";
    for (let t = 0; t < 2; t++) {
      const png = await aiFigure(c, pl, issues), v = await judgeAi(png, c, pl);
      if (!best || v.score > best.score) best = { buf: png, score: v.score, issues: v.issues, kind: "ai", credit: null };
      if (v.score >= 70) break; issues = v.issues;
    }
  }
  const webpTmp = path.join(os.tmpdir(), name + ".webp");
  const { ar } = toWebp(best.buf, webpTmp);
  if (best.desc && best.kind === "commons") pl = { ...pl, ...Object.fromEntries(Object.entries(best.desc).filter(([, v]) => clean(v))) };   // a Commons pick is described from the image itself, not the plan
  const cap = clean(pl.caption).replace(/[.!]+$/, "");
  const credit = best.kind === "commons" ? `Image: ${best.credit.author}, ${best.credit.licence}, Wikimedia Commons.` : "Illustration: StewardMD original.";
  const figTitle = clean(pl.figureTitle) || c.d.name;
  const meta = { key: c.id, name, title: figTitle, links: c.links, score: c.score,
    alt: clean(pl.alt), caption: clean(cap + (credit ? ". " + credit : "")), ar, score70: best.score, issues: best.issues, kind: best.kind,
    source: best.credit ? { page: best.credit.page, author: best.credit.author, licence: best.credit.licenceName || best.credit.licence } : null };
  if (best.score >= 70) {
    await putR2Object(`prep-bank/v1/kb/media/${name}.webp`, fs.readFileSync(webpTmp), "image/webp", "public, max-age=31536000, immutable");
    const d = JSON.parse(fs.readFileSync(c.file, "utf8"));
    d.figures = (d.figures || []).concat([{ id: name, type: "image", title: figTitle, src: `v1/kb/media/${name}.webp`, alt: meta.alt, caption: meta.caption, ar }]);
    fs.writeFileSync(c.file, JSON.stringify(d, null, 2) + "\n");
    patchBucket(c.id, d);
    const src = best.kind === "commons" ? `${best.credit.author}; ${best.credit.page}` : "StewardMD (original, AI-generated with Vertex Gemini image)";
    fs.appendFileSync(path.join(REPO, "prep/lessons/media/ATTRIBUTION.md"), `| ${name}.webp (R2) | ${meta.caption} | ${src} | ${best.kind === "commons" ? best.credit.licenceName || best.credit.licence : "CC BY 4.0 (StewardMD original)"} |\n`);
    fs.appendFileSync(KEYS, c.id + "\n"); shippedKeys.add(c.id);
    state.shipped++; state[best.kind === "commons" ? "commons" : "ai"]++;
    fs.rmSync(webpTmp, { force: true }); return `shipped ${best.kind} ${best.score}`;
  }
  fs.copyFileSync(webpTmp, path.join(REJ, name + ".webp")); fs.rmSync(webpTmp, { force: true });
  fs.writeFileSync(path.join(REJ, c.id + ".json"), JSON.stringify(meta, null, 2));
  state.rejected++; return `REJECTED-for-owner ${best.kind} ${best.score}`;
}

// Keep the disease page fresh without a full rebuild: patch the one v2 bucket for this id
// with the same entry rule as kb/tools/build-kb-v2.mjs (a diagnostic disease wins ties, and
// this article was already screened for a diagnostic twin in candidates()).
function patchBucket(id, d) {
  const f = "b" + String(bucketOfV2(id)).padStart(2, "0") + ".json";
  const p = path.join(REPO, "kb/dist/v2", f);
  const b = JSON.parse(fs.readFileSync(p, "utf8"));
  b[id] = entryForV2(d);
  fs.writeFileSync(p, JSON.stringify(b));
}

const list = candidates().slice(0, LIMIT);
console.log("candidates this run", list.length, "spent so far $" + state.spent.toFixed(2), "cap $" + CAP.toFixed(2));
if (DRY) {
  for (const c of list.slice(0, 50)) console.log(c.score, "links=" + c.links, c.id, "-", String(c.d.name).slice(0, 70));
  console.log("DRY_RUN: no paid calls, nothing written.");
  process.exit(0);
}
let i = 0;
async function worker() {
  while (i < list.length && state.spent < CAP) {
    const c = list[i++];
    try { console.log(c.id, await one(c), "spent $" + state.spent.toFixed(2)); }
    catch (e) {
      if (/CAP \$/.test(String(e.message))) { console.log("HARD STOP: " + e.message); i = list.length; }
      else { state.failed[c.id] = (state.failed[c.id] || 0) + 1; console.log(c.id, "error", String(e.message).slice(0, 120)); }
    }
    saveState();
  }
}
await Promise.all(Array.from({ length: PAR }, worker));
saveState();
console.log("DONE shipped", state.shipped, "(commons", state.commons, "ai", state.ai + ")", "rejected", state.rejected, "skipped", state.skipped, "spent $" + state.spent.toFixed(2));

