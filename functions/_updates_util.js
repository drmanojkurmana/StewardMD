/* StewardMD — Medical Updates: pure helpers (no bindings, no network).
 * Kept dependency-free so the crawl/dedup logic is unit-testable in plain Node.
 */

export const APPROVAL_RE = /\b(approv|clearance|cleared|clears|authoriz|granted|green[-\s]?light|new indication|expanded indication|launch|now available|market(ing)? (authoris|authoriz)|introduc|roll(ing)?[-\s]?out|rolled out|debut|unveil|first[-\s]?in[-\s]?class|receives? marketing)/i;
export const NON_MEDICAL_RE = /\b(pet food|dog food|cat food|pet treats?|dogs?|cats?|puppy|kitten|veterinary|animal (health|feed)|shampoo|conditioner|lotion|cosmetic|makeup|mascara|eyeliner|fragrance|perfume|undeclared|allergy alert|ice cream|cheese|yogurt|frozen (food|meal)|snack|beverage|seafood|salad|sausage|poultry)\b/i;

export function decodeEntities(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCharCode(+n); } catch (e) { return m; } });
}
export function stripTags(s) {
  return String(s).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
}
export function clean(s) { return decodeEntities(stripTags(decodeEntities(s || ""))); }

export async function sha256hex(str) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// Stable dedup key for an RSS item.
export function itemHashInput(it) { return [it.title, it.url, it.ts, String(it.desc || "").slice(0, 500)].join("|"); }

// RSS 2.0 <item> parser with an Atom <entry> fallback. Regex-based (no XML lib on the edge).
export function parseRss(xml) {
  const out = [];
  const itemBlocks = String(xml || "").split(/<item[\s>]/i).slice(1);
  const isAtom = itemBlocks.length === 0;
  const list = isAtom ? String(xml || "").split(/<entry[\s>]/i).slice(1) : itemBlocks;
  const closeRe = isAtom ? /<\/entry>/i : /<\/item>/i;
  for (const raw of list) {
    const seg = raw.split(closeRe)[0];
    const pick = (tag) => { const m = seg.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i")); return m ? clean(m[1]) : ""; };
    const title = pick("title"); if (!title) continue;
    let link = pick("link") || pick("guid") || pick("id");
    if (!link) { const m = seg.match(/<link[^>]*href=["']([^"']+)["']/i); if (m) link = m[1]; }
    const desc = pick("description") || pick("summary") || pick("content");
    const date = pick("pubDate") || pick("updated") || pick("published") || pick("date");
    const ts = date ? (Date.parse(date) || 0) : 0;
    out.push({ title, url: link, desc, ts });
  }
  return out;
}

// Item-level relevance: approval feeds keep only approval headlines; always drop
// pet-food / cosmetic / food-allergen noise; other feed types pass through.
export function keepItem(sourceType, title, desc) {
  const hay = String(title || "") + " " + String(desc || "");
  if (NON_MEDICAL_RE.test(hay)) return false;
  if (sourceType === "drug_approval") return APPROVAL_RE.test(hay);
  return true;
}
