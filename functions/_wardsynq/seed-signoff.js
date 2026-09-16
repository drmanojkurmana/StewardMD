/* functions/_wardsynq/seed-signoff.js - D10 (owner, 2026-09-14): clinical seed data is signed off by
 * Dr Manoj Kurmana, item by item.
 *
 * WHAT A SEED ITEM IS. Clinical content that ships in the code and is marked UNAPPROVED where it is defined:
 * allergy classes and cross-reactivity (wardsynq/data/allergy-classes.seed.json), dose ceilings
 * and pregnancy and lactation rules (adapters/wardsynq-rules-stewardmd.js), the default critical limits (critical-results.js) and the
 * critical threshold seed (wardsynq/data/critical-thresholds.seed.json), PEWS age bands, MEOWS trigger
 * bands, the NEWS2 escalation policy and responder ladder, and the quality measure definitions. Each list
 * is read from the module that USES it, so what is listed is what runs.
 *
 * A SIGN-OFF NAMES THE EXACT CONTENT. Each item's fingerprint is a SHA-256 of its content (function bodies
 * included, as MEOWS and quality measures are functions). A sign-off record is stored under that
 * fingerprint and never rewritten, so an item whose content changes after it was signed shows as
 * UNAPPROVED again, by construction: nothing is ever silently treated as approved.
 *
 * WHAT SIGNING DOES NOT DO. It records the clinical sign-off; it does not change any engine's behaviour.
 * rx-safety still never gates an order, and every consumer keeps its current wording. Turning a signed
 * item into enforced behaviour is a separate, per-engine decision.
 */
import ALLERGY_SEED from "../../wardsynq/data/allergy-classes.seed.json";
import THRESHOLD_SEED from "../../wardsynq/data/critical-thresholds.seed.json";
import { DOSE_LIMITS_SEED, PREGNANCY_LACTATION_SEED } from "../../wardsynq/adapters/wardsynq-rules-stewardmd.js";
import { DEFAULT_CRITICAL_LIMITS } from "./critical-results.js";
import { BANDS as PEWS_BANDS } from "../../wardsynq/wardsynq-pews.js";
import { MEOWS_BANDS } from "../../wardsynq/wardsynq-obstetrics.js";
import { ESCALATION as NEWS2_ESCALATION, RESPONDER_LADDER } from "../../wardsynq/wardsynq-deterioration.js";
import { MEASURES } from "../../wardsynq/wardsynq-quality.js";

/** The owner's decision D10 names the signatory. A sign-off in any other name is refused. */
export const SIGNATORY = "Dr Manoj Kurmana";

const entries = (o) => Object.keys(o || {}).sort().map((k) => [k, o[k]]);
/** The seed lists, each with its items. `seedVersion` is the list's own version where it has one. */
export function seedLists() {
  return [
    { id: "allergy-classes", title: "Allergy classes", source: "wardsynq/data/allergy-classes.seed.json", seedVersion: ALLERGY_SEED.version,
      items: entries(ALLERGY_SEED.allergyClasses).map(([k, v]) => ({ id: k, label: k.replace(/_/g, " "), content: v })) },
    { id: "allergy-cross-reactivity", title: "Allergy cross-reactivity", source: "wardsynq/data/allergy-classes.seed.json", seedVersion: ALLERGY_SEED.version,
      items: (ALLERGY_SEED.crossReactivity || []).map((x) => ({ id: x.id, label: (x.groups || []).join(" and ").replace(/_/g, " "), content: x })) },
    { id: "dose-ceilings", title: "Dose ceilings", source: "wardsynq/adapters/wardsynq-rules-stewardmd.js DOSE_LIMITS_SEED", seedVersion: "code",
      items: entries(DOSE_LIMITS_SEED).map(([k, v]) => ({ id: k, label: k, content: v })) },
    // Ships EMPTY (see the adapter): the list is here so the first entry anyone adds is unapproved until signed.
    { id: "pregnancy-lactation", title: "Pregnancy and lactation rules", source: "wardsynq/adapters/wardsynq-rules-stewardmd.js PREGNANCY_LACTATION_SEED", seedVersion: "code",
      items: entries(PREGNANCY_LACTATION_SEED).map(([k, v]) => ({ id: k, label: k, content: v })) },
    { id: "critical-limits", title: "Default critical limits", source: "functions/_wardsynq/critical-results.js DEFAULT_CRITICAL_LIMITS", seedVersion: "code",
      items: entries(DEFAULT_CRITICAL_LIMITS).map(([k, v]) => ({ id: k, label: (v && v.display) || k, content: v })) },
    { id: "critical-thresholds", title: "Critical threshold seed", source: "wardsynq/data/critical-thresholds.seed.json", seedVersion: THRESHOLD_SEED.version,
      items: entries(THRESHOLD_SEED.thresholds).map(([k, v]) => ({ id: k, label: (v && v.analyte) || k, content: v })) },
    { id: "pews-bands", title: "PEWS age bands", source: "wardsynq/wardsynq-pews.js BANDS", seedVersion: "code",
      items: entries(PEWS_BANDS).map(([k, v]) => ({ id: k, label: k, content: v })) },
    { id: "meows-bands", title: "MEOWS trigger bands", source: "wardsynq/wardsynq-obstetrics.js MEOWS_BANDS", seedVersion: "code",
      items: entries(MEOWS_BANDS).map(([k, v]) => ({ id: k, label: (v && v.label) || k, content: v })) },
    { id: "news2-escalation", title: "NEWS2 escalation policy", source: "wardsynq/wardsynq-deterioration.js ESCALATION, RESPONDER_LADDER", seedVersion: "code",
      items: entries(NEWS2_ESCALATION).map(([k, v]) => ({ id: k, label: "Risk " + k, content: v })).concat([{ id: "responder-ladder", label: "Responder ladder", content: RESPONDER_LADDER }]) },
    { id: "quality-measures", title: "Quality measure definitions", source: "wardsynq/wardsynq-quality.js MEASURES", seedVersion: "code",
      items: entries(MEASURES).map(([k, v]) => ({ id: k, label: (v && v.label) || k, content: v })) },
  ];
}

/** PURE. Canonical text of an item: keys sorted, functions by their source, so any change is a new fingerprint. */
export function canonical(v) {
  if (typeof v === "function") return JSON.stringify("fn:" + v.toString());
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
export async function fingerprint(content) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(content)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const safe = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60);
/** The record id: list, item and the first 24 hex of the fingerprint. A different content is a different record. */
export const signoffId = (listId, itemId, hash) => safe(listId) + "__" + safe(itemId) + "__" + String(hash).slice(0, 24);

/** PURE. Every list with each item's status against the sign-off records held. An item is "signed" only when a
 * record exists for its CURRENT fingerprint; otherwise it is "unapproved". */
export async function seedStatus(records) {
  const byId = new Map((records || []).map((r) => [r.id, r]));
  const out = [];
  for (const l of seedLists()) {
    const items = [];
    for (const it of l.items) {
      const hash = await fingerprint(it.content);
      const rec = byId.get(signoffId(l.id, it.id, hash));
      items.push({ id: it.id, label: it.label, contentHash: hash, version: l.seedVersion + "#" + hash.slice(0, 12), content: canonical(it.content),
        status: rec ? "signed" : "unapproved",
        ...(rec ? { signoff: { text: rec.text, signedBy: rec.signedBy, signedAt: rec.signedAt, version: rec.version } } : {}) });
    }
    out.push({ id: l.id, title: l.title, source: l.source, seedVersion: l.seedVersion, items,
      signed: items.filter((i) => i.status === "signed").length, unapproved: items.filter((i) => i.status !== "signed").length });
  }
  return out;
}
