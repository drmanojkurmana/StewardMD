/* StewardMD — per-user invisible watermark for gated PrepNucleus bank JSON (owner 2026-11-13).
 *
 * Mark = first 40 bits of HMAC-SHA256(WATERMARK_SECRET, userId + "." + fileKey), encoded as
 * zero-width chars (U+200B = 0, U+200C = 1) framed by U+2060, inserted inside 2–3 explanation
 * strings per file at a deterministic per-user word-boundary position.
 *
 * Second layer: one harmless whitespace variant (regular space vs NBSP after a full stop) in one
 * explanation per file; driven by HMAC bit 40.
 *
 * Touches only explanation text: items[].exp, items[].x.key, items[].x.notes.
 * Never stems (q), options (o), answers (a), ids, r/others, pearls, URLs, or search/scoring fields.
 *
 * Missing WATERMARK_SECRET -> return unmarked + log once; never fail the request.
 */

import { hmacSha256Hex } from "./_prep_bank_gate.js";

export const ZW0 = "\u200B";
export const ZW1 = "\u200C";
export const ZW_FRAME = "\u2060";
export const NBSP = "\u00A0";
export const MARK_BITS = 40;
export const MARK_STRINGS_PER_FILE = 3;
export const MIN_EXPLANATION_LEN = 24;

const ZW_STRIP_RE = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
const MARK_RE = /\u2060([\u200B\u200C]+)\u2060/g;

let _missingSecretLogged = false;

export function resetWatermarkLog() {
  _missingSecretLogged = false;
}

/** Strip watermark zero-width / frame chars (client TTS, compare, AI grounding). */
export function stripWatermarkMarks(s) {
  return String(s == null ? "" : s).replace(ZW_STRIP_RE, "");
}

export function bitsToZw(bits) {
  let out = ZW_FRAME;
  for (let i = 0; i < bits.length; i++) out += bits[i] ? ZW1 : ZW0;
  return out + ZW_FRAME;
}

export function zwToBits(zwInner) {
  const bits = [];
  for (let i = 0; i < zwInner.length; i++) {
    const ch = zwInner[i];
    if (ch === ZW1) bits.push(1);
    else if (ch === ZW0) bits.push(0);
    else return null;
  }
  return bits;
}

/** Extract framed 40-bit marks from leaked text. Returns array of bit arrays. */
export function extractMarks(text) {
  const s = String(text || "");
  const out = [];
  MARK_RE.lastIndex = 0;
  let m;
  while ((m = MARK_RE.exec(s))) {
    const bits = zwToBits(m[1]);
    if (bits && bits.length === MARK_BITS) out.push(bits);
  }
  return out;
}

export function bitsToHex40(bits) {
  let hex = "";
  for (let i = 0; i < MARK_BITS; i += 4) {
    const n = ((bits[i] || 0) << 3) | ((bits[i + 1] || 0) << 2) | ((bits[i + 2] || 0) << 1) | (bits[i + 3] || 0);
    hex += n.toString(16);
  }
  return hex;
}

export function hex40ToBits(hex) {
  const h = String(hex || "").toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 10);
  if (h.length < 10) return null;
  const bits = [];
  for (let i = 0; i < 10; i++) {
    const n = parseInt(h[i], 16);
    for (let b = 3; b >= 0; b--) bits.push((n >> b) & 1);
  }
  return bits;
}

/** First 41 bits from HMAC hex (40 for mark, 1 for variant). */
export async function hmacMarkMaterial(secret, userId, fileKey) {
  const hex = await hmacSha256Hex(secret, String(userId) + "." + String(fileKey));
  const bits40 = hex40ToBits(hex.slice(0, 10));
  const variantBit = (parseInt(hex[10], 16) >> 3) & 1; // MSB of 11th hex nibble = bit 40
  return { bits40, variantBit, hexPrefix: hex.slice(0, 11) };
}

/** Word-interior insert sites: index i means insert before text[i], with word chars on both sides. */
export function insertSites(text) {
  const s = String(text || "");
  const sites = [];
  for (let i = 1; i < s.length - 1; i++) {
    const a = s.charCodeAt(i - 1), b = s.charCodeAt(i);
    const wordA = (a >= 65 && a <= 90) || (a >= 97 && a <= 122) || (a >= 48 && a <= 57);
    const wordB = (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57);
    if (wordA && wordB) sites.push(i);
  }
  return sites;
}

export function insertAtSite(text, mark, site) {
  const s = String(text || "");
  if (site <= 0 || site >= s.length) return s;
  return s.slice(0, site) + mark + s.slice(site);
}

/**
 * Collect mutable explanation string refs: { get, set, path } in stable document order.
 * Only items[].exp, items[].x.key, items[].x.notes.
 */
export function collectExplanationTargets(doc) {
  const out = [];
  if (!doc || typeof doc !== "object") return out;
  const items = doc.items;
  if (!Array.isArray(items)) return out;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== "object") continue;
    if (typeof it.exp === "string" && it.exp.length >= MIN_EXPLANATION_LEN) {
      out.push({
        path: "items[" + i + "].exp",
        get: () => it.exp,
        set: (v) => { it.exp = v; },
      });
    }
    const x = it.x;
    if (x && typeof x === "object") {
      if (typeof x.key === "string" && x.key.length >= MIN_EXPLANATION_LEN) {
        out.push({
          path: "items[" + i + "].x.key",
          get: () => x.key,
          set: (v) => { x.key = v; },
        });
      }
      if (typeof x.notes === "string" && x.notes.length >= MIN_EXPLANATION_LEN) {
        out.push({
          path: "items[" + i + "].x.notes",
          get: () => x.notes,
          set: (v) => { x.notes = v; },
        });
      }
    }
  }
  return out;
}

function pickIndices(n, k, bits) {
  /* Deterministic distinct picks from bits as a base-2 stream. */
  const want = Math.min(k, n);
  if (want <= 0 || n <= 0) return [];
  const picked = [];
  const used = new Set();
  let acc = 0;
  for (let i = 0; i < bits.length; i++) acc = (acc * 2 + bits[i]) >>> 0;
  for (let t = 0; t < want; t++) {
    let idx = (acc + t * 2654435761) >>> 0;
    for (let probe = 0; probe < n; probe++) {
      const j = (idx + probe) % n;
      if (!used.has(j)) {
        used.add(j);
        picked.push(j);
        break;
      }
    }
  }
  return picked;
}

function applyVariantSpace(text, variantBit) {
  /* Replace the first ". " (period + regular space) with ".\u00A0" when variantBit=1.
   * When variantBit=0, leave ". " as-is (stable choice among the two harmless variants). */
  if (!variantBit) return { text, applied: false };
  const s = String(text || "");
  const i = s.indexOf(". ");
  if (i < 0) return { text: s, applied: false };
  return { text: s.slice(0, i) + "." + NBSP + s.slice(i + 2), applied: true };
}

/** Detect variant layer in leaked text: 1 if period+NBSP present, 0 if only period+space, null if neither. */
export function detectVariantBit(text) {
  const s = String(text || "");
  if (s.indexOf("." + NBSP) >= 0) return 1;
  if (/\. [A-Za-z0-9]/.test(s)) return 0;
  return null;
}

/**
 * Mutate doc in place with per-user marks. Returns { marked, targets, variantPath } or { marked:false, reason }.
 */
export async function watermarkDocument(doc, { userId, fileKey, secret }) {
  if (!secret || typeof secret !== "string" || !secret.length) {
    return { marked: false, reason: "missing-secret" };
  }
  if (!userId || !fileKey) return { marked: false, reason: "missing-ids" };

  const targets = collectExplanationTargets(doc).filter((t) => insertSites(t.get()).length > 0);
  if (!targets.length) return { marked: false, reason: "no-targets" };

  const { bits40, variantBit } = await hmacMarkMaterial(secret, userId, fileKey);
  const mark = bitsToZw(bits40);
  const idxs = pickIndices(targets.length, MARK_STRINGS_PER_FILE, bits40);

  for (let n = 0; n < idxs.length; n++) {
    const t = targets[idxs[n]];
    const s = t.get();
    const sites = insertSites(s);
    let siteSeed = 0;
    for (let b = 0; b < 16 && b < bits40.length; b++) siteSeed = (siteSeed * 2 + bits40[(b + n * 7) % bits40.length]) >>> 0;
    const site = sites[siteSeed % sites.length];
    t.set(insertAtSite(s, mark, site));
  }

  /* Variant layer: first marked target that has ". ", else first target with ". ". */
  let variantPath = null;
  const tryOrder = idxs.concat(targets.map((_, i) => i).filter((i) => idxs.indexOf(i) < 0));
  for (let n = 0; n < tryOrder.length; n++) {
    const t = targets[tryOrder[n]];
    const r = applyVariantSpace(t.get(), variantBit);
    if (r.applied || (!variantBit && t.get().indexOf(". ") >= 0)) {
      if (r.applied) t.set(r.text);
      variantPath = t.path;
      break;
    }
  }

  return { marked: true, targets: idxs.map((i) => targets[i].path), variantPath, variantBit };
}

/**
 * Watermark a JSON string. On missing secret: log once, return original. On parse failure: return original.
 * Never throws for request-path use.
 */
export async function watermarkJsonText(jsonText, { userId, fileKey, secret }) {
  if (!secret || typeof secret !== "string" || !secret.length) {
    if (!_missingSecretLogged) {
      _missingSecretLogged = true;
      try { console.warn("[prep-watermark] WATERMARK_SECRET missing; serving unmarked"); } catch (e) {}
    }
    return { text: jsonText, marked: false, reason: "missing-secret" };
  }
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch (e) {
    return { text: jsonText, marked: false, reason: "invalid-json" };
  }
  const r = await watermarkDocument(doc, { userId, fileKey, secret });
  if (!r.marked) return { text: jsonText, marked: false, reason: r.reason };
  return { text: JSON.stringify(doc), marked: true, detail: r };
}

/** Match extracted marks against candidate user ids. Never prints the secret. */
export async function matchCandidates(extractedBitArrays, candidates, fileKey, secret) {
  const want = new Set(extractedBitArrays.map(bitsToHex40));
  if (!want.size || !secret) return [];
  const hits = [];
  for (let i = 0; i < candidates.length; i++) {
    const id = String(candidates[i] || "");
    if (!id) continue;
    const { bits40 } = await hmacMarkMaterial(secret, id, fileKey);
    if (want.has(bitsToHex40(bits40))) hits.push(id);
  }
  return hits;
}
