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
const JUNK = /logo|icon|sprite|avatar|badge|banner|button|pixel|tracking|spacer|arrow|social|share|\.svg(\?|$)|\.gif(\?|$)|1x1|blank\./i;
const FIGURE_HINT = /algorithm|flowchart|flow-chart|figure|fig[-_]?\d|chart|diagram|pathway|criteria|table|schema|ecg|ekg|xray|x-ray|ct-|mri|scan/i;
const STOP = /^(?:the|of|and|for|in|on|with|to|a|an|is|are|vs|or|workup|work-up|management|treatment|approach|evaluation)$/i;

function attr(tag, name) {
  const m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}
function topicTokens(topic) {
  return String(topic || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.test(t));
}
function absolute(src, pageUrl) {
  try { const u = new URL(src, pageUrl); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; }
}

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
    const src = absolute(attr(tag, "data-src") || attr(tag, "src"), pageUrl);
    if (!src || JUNK.test(src)) continue;
    const alt = attr(tag, "alt"), title = attr(tag, "title");
    if (JUNK.test(alt)) continue;
    const w = parseInt(attr(tag, "width"), 10) || 0, hh = parseInt(attr(tag, "height"), 10) || 0;
    if ((w && w < 200) || (hh && hh < 120)) continue;
    // Context: the 600 characters before the tag (a <figure>, a heading, a caption class).
    const before = h.slice(Math.max(0, m.index - 600), m.index);
    let score = 0;
    score += 3 * hit(alt + " " + title);
    score += 2 * hit(src);
    score += hit(before);
    if (FIGURE_HINT.test(src) || FIGURE_HINT.test(alt)) score += 2;
    if (/<figure\b/i.test(before) && !/<\/figure>/i.test(before)) score += 2;
    if (w >= 400 || hh >= 300) score += 1;
    if (score <= 0) continue;
    if (!best || score > best.score) best = { img: src, alt: (alt || title || "").slice(0, 160), score };
  }
  if (!best) {
    // A page built around one figure often carries it as og:image; only when it names the topic.
    const og = /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i.exec(h);
    const ogSrc = og ? absolute(attr(og[0], "content"), pageUrl) : "";
    if (ogSrc && !JUNK.test(ogSrc) && (hit(ogSrc) || FIGURE_HINT.test(ogSrc))) best = { img: ogSrc, alt: "", score: 1 };
  }
  return best;
}

/* -> [{ img, page, site, title }] up to `max`, one per trusted page. Never throws. */
export async function findFigures(env, topic, max = 3) {
  const q = String(topic || "").trim().slice(0, 200);
  if (!q) return [];
  let pages = [];
  try { pages = await tinyfishSearch(env, q); } catch (e) { pages = []; }
  pages = (pages || []).filter((p) => p && /^https:\/\//i.test(p.url) && !/\.pdf(\?|$)/i.test(p.url)).slice(0, 5);
  const found = await Promise.all(pages.map(async (p) => {
    if (!isTrustedUrl(p.url)) return null;
    const host = new URL(p.url).hostname;
    try {
      const r = await fetchWithTimeout(p.url, { headers: { "Accept": "text/html", "User-Agent": "Mozilla/5.0 (StewardMD figure lookup)" }, redirect: "follow" }, 6000);
      if (!r.ok || !/text\/html/i.test(r.headers.get("content-type") || "")) return null;
      const html = (await r.text()).slice(0, PAGE_BYTES);
      const f = pickFigure(html, p.url, q);
      return f ? { img: f.img, page: p.url, site: host.replace(/^www\./, ""), title: String(p.title || f.alt || host).slice(0, 160), score: f.score } : null;
    } catch (e) { return null; }
  }));
  return found.filter(Boolean).sort((a, b) => b.score - a.score).slice(0, max).map(({ score, ...rest }) => rest);
}
