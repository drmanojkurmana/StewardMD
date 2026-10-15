/* PrepNucleus content fixes: owners and registered signers (the tester doctors the owner manages for Clinical updates)
 * correct a question or a lesson from the Review Desk, and the fix reaches every student without an app release.
 *
 * Storage (KV UPDATES_KV, falls back to MAIK_KV; images in R2 PREP_BANK_R2):
 *   prep:fixix            { "<module>": <ts> }                       public index: which modules have fixes (client asks this, at most every 30 min)
 *   prep:fixmod:<module>  { q: { "<itemId>": fix }, l: { "<lessonKey>": fix } }   public per module
 *   prep:fixlog:<kind>:<id>  [ { ts, by, name, role, before, after } ]            last LOG_MAX changes, editors only
 *   R2 prep-bank/v90/img/fx-<sha16>.webp                               uploaded figure, served by the existing bank route (IMG_RE), immutable
 * Edits go live at once (owner decision 2026-10-14); the log keeps who, when and what it was, and Revert drops the fix.
 *
 * A fix holds only the fields that changed. Question: q, o, a, exp, kp, img, imgPlace. Lesson: title and per-step tx, say, fig.
 * Text is plain: angle brackets and control characters are stripped, lengths are capped. No patient data is accepted or kept.
 */
import { ownerIdentity, signerIdentity } from "./_bulletins_auth.js";
import { ownerOK } from "./_adminauth.js";

export const FIX_IMG_VER = "v90";
export const LIMITS = { q: 1500, opt: 300, optN: 8, exp: 6000, kp: 700, tx: 3000, say: 2000, title: 160, alt: 240, cap: 300, imgN: 3, steps: 60, note: 300, log: 15 };
export const IMG_PATH_RE = /^v\d{1,3}\/img\/[a-z0-9-]{2,80}\.webp$/;
export const SLUG_RE = /^[a-z0-9-]{2,80}$/;
export const ID_RE = /^[a-z0-9-]{4,80}$/i;
export const IMG_MAX_BYTES = 1600000;

export function clean(s, max) {
  return String(s == null ? "" : s).replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/[ \t]+\n/g, "\n").trim().slice(0, max);
}
const isInt = (n) => typeof n === "number" && Number.isInteger(n);

/* validateFix(kind, input) -> { ok:true, fix } | { ok:false, error }. kind: "question" | "lesson". */
export function validateFix(kind, input) {
  const b = input && typeof input === "object" ? input : null;
  if (!b) return { ok: false, error: "bad-fix" };
  const fix = {};
  if (kind === "question") {
    if (b.q != null) { const q = clean(b.q, LIMITS.q); if (q.length < 8) return { ok: false, error: "bad-question" }; fix.q = q; }
    if (b.o != null) {
      if (!Array.isArray(b.o) || b.o.length < 2 || b.o.length > LIMITS.optN) return { ok: false, error: "bad-options" };
      const o = b.o.map((x) => clean(x, LIMITS.opt)); if (o.some((x) => !x)) return { ok: false, error: "bad-options" };
      fix.o = o;
    }
    if (b.a != null) { if (!isInt(b.a) || b.a < 0) return { ok: false, error: "bad-key" }; fix.a = b.a; }
    if (fix.o && fix.a == null) return { ok: false, error: "key-needed" };      // changing the options needs the key stated with them
    if (fix.o && fix.a >= fix.o.length) return { ok: false, error: "bad-key" };
    if (b.exp != null) { const e = clean(b.exp, LIMITS.exp); if (!e) return { ok: false, error: "bad-explanation" }; fix.exp = e; }
    if (b.kp != null) { fix.kp = clean(b.kp, LIMITS.kp); }
    if (b.img != null) {
      if (!Array.isArray(b.img) || b.img.length > LIMITS.imgN || b.img.some((p) => !IMG_PATH_RE.test(String(p)))) return { ok: false, error: "bad-image" };
      fix.img = b.img.map(String);
      if (b.imgPlace != null) fix.imgPlace = b.imgPlace === "exp" ? "exp" : "stem";
    }
  } else if (kind === "lesson") {
    if (b.title != null) { const t = clean(b.title, LIMITS.title); if (!t) return { ok: false, error: "bad-title" }; fix.title = t; }
    if (b.steps != null) {
      if (typeof b.steps !== "object" || Array.isArray(b.steps)) return { ok: false, error: "bad-steps" };
      const steps = {};
      for (const k of Object.keys(b.steps)) {
        const i = Number(k); if (!isInt(i) || i < 0 || i >= LIMITS.steps) return { ok: false, error: "bad-steps" };
        const s = b.steps[k] || {}, o = {};
        if (s.tx != null) { const t = clean(s.tx, LIMITS.tx); if (!t) return { ok: false, error: "bad-text" }; o.tx = t; }
        if (s.say != null) { const t = clean(s.say, LIMITS.say); if (!t) return { ok: false, error: "bad-text" }; o.say = t; }
        if (s.fig != null) {
          const f = s.fig || {}; if (!IMG_PATH_RE.test(String(f.src || ""))) return { ok: false, error: "bad-image" };
          o.fig = { src: String(f.src), alt: clean(f.alt || "Figure", LIMITS.alt) || "Figure", caption: clean(f.caption || "", LIMITS.cap) };
        }
        if (Object.keys(o).length) steps[String(i)] = o;
      }
      if (Object.keys(steps).length) fix.steps = steps;
    }
  } else return { ok: false, error: "bad-kind" };
  if (!Object.keys(fix).length) return { ok: false, error: "empty-fix" };
  return { ok: true, fix };
}

/* applyQuestionFix(item, fix): the item as a student sees it. Edited options or explanation drop the stored per-option
 * reasoning (it, x), which described the OLD wording and would contradict the fix. Pure; returns the same object. */
export function applyQuestionFix(it, fx) {
  if (!it || !fx) return it;
  if (fx.q != null) it.q = fx.q;
  if (fx.o) { it.o = fx.o.slice(); it.a = fx.a; it.r = null; it.x = null; }
  else if (fx.a != null) { it.a = fx.a; it.r = null; it.x = null; }
  if (fx.exp != null) { it.exp = fx.exp; it.r = null; it.x = null; }
  if (fx.kp != null) it.kp = fx.kp;
  if (fx.img) { it.img = fx.img.slice(); it.imgPlace = fx.imgPlace === "exp" ? "exp" : "stem"; delete it.credit; delete it.licence; }
  it._fx = fx.ts || 1;
  return it;
}
export function applyLessonFix(les, fx) {
  if (!les || !fx) return les;
  if (fx.title) les.title = fx.title;
  const steps = (fx.steps || {});
  Object.keys(steps).forEach((k) => {
    const st = les.steps && les.steps[Number(k)], f = steps[k]; if (!st) return;
    if (f.tx != null) st.tx = f.tx;
    if (f.say != null) st.say = f.say;
    if (f.fig) st.vis = { kind: "image", src: f.fig.src, alt: f.fig.alt, caption: f.fig.caption || "" };
  });
  les._fx = fx.ts || 1;
  return les;
}

export const kvOf = (env) => (env && (env.UPDATES_KV || env.MAIK_KV)) || null;
export async function kvJson(kv, key, fallback) { try { const v = JSON.parse((await kv.get(key)) || "null"); return v == null ? fallback : v; } catch (e) { return fallback; } }

/* editorIdentity(request, env) -> { ok:true, role:"owner"|"signer", uid, name } | { ok:false }. Owners by Firebase login or the
 * legacy admin token; signers are the doctors an owner registered for Clinical updates (verified, active). */
export async function editorIdentity(request, env) {
  try { const o = await ownerIdentity(request, env); if (o && o.ok) return { ok: true, role: "owner", uid: o.uid, name: String(o.email || "owner").split("@")[0] }; } catch (e) {}
  try { const s = await signerIdentity(request, env); if (s && s.ok) return { ok: true, role: "signer", uid: s.uid, name: String(s.name || "signer").slice(0, 60) }; } catch (e) {}
  try { if (await ownerOK(request, env)) return { ok: true, role: "owner", uid: "token", name: "owner" }; } catch (e) {}
  return { ok: false };
}
export async function isEditor(request, env) { return (await editorIdentity(request, env)).ok; }

/* imageType(buf) -> "image/webp" | "image/jpeg" | "image/png" | null, from the magic bytes. The app makes WebP when the device can and
 * JPEG when it cannot (Safari before 17 cannot encode WebP); the file is stored under the same .webp key either way, and browsers
 * draw an <img> by its bytes, so the bank route serves it unchanged with the stored Content-Type. */
export function imageType(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf || 0);
  if (u.length > 12 && u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return "image/webp";
  if (u.length > 4 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return "image/jpeg";
  if (u.length > 8 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return "image/png";
  return null;
}
export async function sha16(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}
