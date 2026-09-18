/* StewardMD — related figures for a MaiK answer (owner, 2026-09-18).
 *
 * "Show the search-result image just like Google, with the link below." A SEARCH step, not an AI
 * step: TinyFish (already restricted to TRUSTED_MEDICAL_DOMAINS) finds the trusted pages for the
 * topic; we read each page's HTML once and pick the figure it is built around. The phone then loads
 * that image straight from the source site and the caption links to the page.
 *
 * We NEVER host, cache, proxy or regenerate the image: only its URL leaves this function, and only
 * for the request that asked. Zero model tokens. Best effort: any failure returns [] and the answer
 * renders without a strip, exactly as before.
 */
import { fetchWithTimeout } from "./_fetch.js";
import { tinyfishSearch, isTrustedUrl } from "./_search.js";

const PAGE_BYTES = 400 * 1024;
// Live check 2026-09-18: NCBI's <noscript> stat beacon (/stat?jsdisabled=...) and Drupal "styles"
// stock photos (diabetes.org "co-worker giving a high five", IDSA branding photo) were being picked.
const JUNK = /logo|icon|sprite|avatar|badge|banner|button|pixel|tracking|spacer|arrow|social|share|\.svg(\?|$)|\.gif(\?|$)|1x1|blank\.|\/stat\?|jsdisabled|\/styles\/|stock|hero|branding|program_card|placeholder/i;
// Journal figure file names: AAFP "p747-f2-jpg.jpg", PMC "fped-09-780356-g0001.jpg".
const FIGURE_HINT = /algorithm|flowchart|flow-chart|figure|fig[-_]?\d|[-_][ft]\d{1,2}[-_.]|[-_]g\d{3,}\b|chart|diagram|pathway|criteria|table|schema|ecg|ekg|xray|x-ray|ct-|mri|scan/i;
// Not worth a page read for FIGURES (production trace, 2026-09-18): UpToDate is paywalled and
// serves zero images to us; Medscape answers the Worker with 403. Both stay trusted for research.
const NO_FIGURES = /(^|\.)(uptodate\.com|medscape\.com)$/i;
// Markup that wraps a real figure on the sites we read (live pages, 2026-09-18): <figure>, PMC's
// "obj_head"/"graphic", Medscape's "inlineImage" + "::figure" comment, AAFP's "__figure" class.
const FIGURE_CTX = /<figure\b|figcaption|figure|inlineimage|img-box|obj_head|class="graphic/i;
const STOP = /^(?:the|of|and|for|in|on|with|to|a|an|is|are|vs|or|workup|work-up|management|treatment|approach|evaluation)$/i;

function attr(tag, name) {
  const m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}
function topicTokens(topic) {
  return String(topic || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.test(t));
}
function absolute(src, pageUrl) {
  src = String(src || "").trim();
  if (!src) return "";   // an empty src resolves to the PAGE url: aafp.org's srcset-only images did exactly that
  try { const u = new URL(src, pageUrl); return (u.protocol === "https:" && u.href !== String(pageUrl)) ? u.href : ""; } catch (e) { return ""; }
}
// First candidate of a srcset / data-srcset ("url 384w, url 768w, ...").
function firstSrcset(v) { const m = /^\s*([^\s,]+)/.exec(String(v || "")); return m ? m[1] : ""; }

/* Pure: the best figure on one page for one topic, or null. Exported for the unit test. */
export function pickFigure(html, pageUrl, topic) {
  const h = String(html || "").slice(0, PAGE_BYTES);
  const toks = topicTokens(topic);
  const hit = (s) => toks.reduce((n, t) => n + (String(s || "").toLowerCase().includes(t) ? 1 : 0), 0);
  let best = null;
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(h))) {
    const tag = m[0];
    const src = absolute(attr(tag, "data-src") || attr(tag, "src") || firstSrcset(attr(tag, "data-srcset") || attr(tag, "srcset")), pageUrl);
    if (!src || JUNK.test(src)) continue;
    const alt = attr(tag, "alt"), title = attr(tag, "title");
    if (JUNK.test(alt)) continue;
    const w = parseInt(attr(tag, "width"), 10) || 0, hh = parseInt(attr(tag, "height"), 10) || 0;
    if ((w && w < 200) || (hh && hh < 120)) continue;
    // Context: the 600 characters before the tag (a <figure>, a heading, a caption class).
    const before = h.slice(Math.max(0, m.index - 600), m.index);
    // The image ITSELF must name the topic, look like a figure, or sit in figure markup (the 200
    // characters before it). Plain page text only adds score: a stock photo under a paragraph about
    // DKA is not a DKA figure, but an untitled image inside <figure> on a hematuria article is.
    const own = 3 * hit(alt + " " + title) + 2 * hit(src) + ((FIGURE_HINT.test(src) || FIGURE_HINT.test(alt)) ? 2 : 0) +
                (FIGURE_CTX.test(before.slice(-200)) ? 2 : 0);
    if (own <= 0) continue;
    let score = own;
    score += hit(before);
    if (/<figure\b/i.test(before) && !/<\/figure>/i.test(before)) score += 2;
    if (w >= 400 || hh >= 300) score += 1;
    if (score <= 0) continue;
    if (!best || score > best.score) best = { img: src, alt: (alt || title || "").slice(0, 160), score };
  }
  if (!best) {
    // A page built around one figure often carries it as og:image; only when it names the topic.
    const og = /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i.exec(h);
    const ogSrc = og ? absolute(attr(og[0], "content"), pageUrl) : "";
    // Must look like an image file: aafp.org's og:image for its pancreatitis review was the article
    // URL itself (text/html), which would have rendered as a broken card (production, 2026-09-18).
    const looksImage = /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(ogSrc) || /\/(?:image|images|media|img)\//i.test(ogSrc);
    if (ogSrc && looksImage && !JUNK.test(ogSrc) && (hit(ogSrc) || FIGURE_HINT.test(ogSrc))) best = { img: ogSrc, alt: "", score: 1 };
  }
  return best;
}

// The page read is what a browser would send. Live check 2026-09-18: aafp.org and medscape.com
// were in TinyFish's top five for hematuria and pick fine from a laptop, yet produced nothing
// from the Worker; a bare "figure lookup" UA from a datacenter address is the usual reason.
const PAGE_HEADERS = {
  "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
};

/* -> [{ img, page, site, title }] up to `max`, one per trusted page. Never throws.
 * opts.debug: also return `_debug` (per-page status, content type, image count, pick) so the
 * production behaviour can be read without guessing; public pages only, never PHI. */
export async function findFigures(env, topic, max = 3, opts = {}) {
  const q = String(topic || "").trim().slice(0, 200);
  if (!q) return [];
  // Up to five page reads, chosen from up to eight results after dropping what can never carry a
  // topic figure: PDFs, untrusted hosts, paywalled/blocking hosts, and HOMEPAGES (a search that
  // falls back to "aasld.org" or "gastro.org" offers only their promo banners: never a figure).
  // When a search yields ONLY such results (TinyFish sometimes answers a short topic with bare
  // site suggestions: "hyperkalemia ECG changes" -> litfl.com, pmc.ncbi.nlm.nih.gov), one reworded
  // retry asks for article pages before giving up. TinyFish search costs no credits.
  const debug = [];
  const eligible = [];
  const queries = [q, q + " review article"];
  for (const query of queries) {
    if (eligible.length) break;
    let pages = [];
    try { pages = await tinyfishSearch(env, query); } catch (e) { pages = []; }
    if (query !== q) debug.push({ retry: query, results: (pages || []).length });
    sift(pages);
  }
  function sift(pages) {
  for (const p of (pages || []).slice(0, 8)) {
    if (!p || !/^https:\/\//i.test(p.url)) continue;
    const d = { url: p.url };
    debug.push(d);
    let u; try { u = new URL(p.url); } catch (e) { d.skip = "bad-url"; continue; }
    if (/\.pdf(\?|$)/i.test(u.pathname)) { d.skip = "pdf"; continue; }
    if (!isTrustedUrl(p.url)) { d.skip = "untrusted"; continue; }
    if (NO_FIGURES.test(u.hostname)) { d.skip = "no-figures-host"; continue; }
    if (u.pathname === "/" || u.pathname === "") { d.skip = "homepage"; continue; }
    if (eligible.length < 5) eligible.push({ p, d });
  }
  }
  const found = await Promise.all(eligible.map(async ({ p, d }) => {
    const host = new URL(p.url).hostname;
    try {
      const r = await fetchWithTimeout(p.url, { headers: PAGE_HEADERS, redirect: "follow" }, 9000);
      d.status = r.status; d.type = (r.headers.get("content-type") || "").slice(0, 40);
      if (!r.ok || !/text\/html/i.test(d.type)) return null;
      const html = (await r.text()).slice(0, PAGE_BYTES);
      d.bytes = html.length; d.imgs = (html.match(/<img\b/gi) || []).length;
      const f = pickFigure(html, p.url, q);
      d.pick = f ? f.img : null;
      return f ? { img: f.img, page: p.url, site: host.replace(/^www\./, ""), title: String(p.title || f.alt || host).slice(0, 160), score: f.score } : null;
    } catch (e) { d.error = String((e && e.message) || e).slice(0, 80); return null; }
  }));
  const out = found.filter(Boolean).sort((a, b) => b.score - a.score).slice(0, max).map(({ score, ...rest }) => rest);
  if (opts.debug) out._debug = debug;
  return out;
}
