/* /api/prep/fix - PrepNucleus content fixes by owners and registered signers (design: functions/_prepfix.js).
 *
 * Public:
 *   GET ?ix=1                 { mods: { "<module>": ts }, nm: { "<subject>": [{ id, title, n }] } }  which modules carry fixes, and the modules
 *                             the owner created by publishing (the app asks at most every 30 min)
 *   GET ?module=<slug>        { q: { itemId: fix }, l: { lessonKey: fix } }  that module's fixes
 * Editors (owner Firebase login or admin token, or an active registered signer):
 *   GET ?me=1                 { editor: true, role, name }   (200 with editor:false for everyone else)
 *   GET ?log=1&kind=&id=      the last changes to one question or lesson (who, when, before, after)
 *   POST ?image=1             raw WebP, JPEG or PNG body (at most 1.6 MB) -> { path: "v90/img/fx-<hash>.webp" }
 *   POST { kind, id, module, subject, fix, note? }   save a fix (live at once; replaces that item's previous fix)
 *   DELETE { kind, id, module }                      revert to the original (the log keeps the removed fix)
 */
import { editorIdentity, validateFix, kvOf, kvJson, SLUG_RE, ID_RE, LIMITS, clean, imageType, sha16, IMG_MAX_BYTES, FIX_IMG_VER } from "../../_prepfix.js";

const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
const IX = "prep:fixix", MOD = (m) => "prep:fixmod:" + m, LOG = (k, id) => "prep:fixlog:" + k + ":" + id;
const KEEP_S = 400 * 86400;
const KINDS = { question: "q", lesson: "l" };

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), sp = u.searchParams, kv = kvOf(env);
  if (sp.get("ix") === "1") {
    const mods = kv ? await kvJson(kv, IX, {}) : {};
    /* nm: modules the owner created while publishing (no bank file or index row): { subject: [{ id, title, n }] }, n = live questions. */
    const nm = {};
    if (kv) {
      const reg = await kvJson(kv, "prep:newmods", {});
      for (const sub of Object.keys(reg)) {
        for (const m of reg[sub] || []) {
          const rec = await kvJson(kv, MOD(m.id), null), n = rec && Array.isArray(rec.a) ? rec.a.filter((x) => x.sub === sub).length : 0;
          if (n) (nm[sub] = nm[sub] || []).push({ id: m.id, title: m.title, n });
        }
      }
    }
    return json({ mods, nm }, 200, { "Cache-Control": "public, max-age=300" });
  }
  const m = sp.get("module");
  if (m != null) {
    if (!SLUG_RE.test(m)) return json({ error: "bad-request" }, 400);
    const rec = kv ? await kvJson(kv, MOD(m), { q: {}, l: {} }) : { q: {}, l: {} };
    return json({ q: rec.q || {}, l: rec.l || {}, a: Array.isArray(rec.a) ? rec.a : [] }, 200, { "Cache-Control": "public, max-age=120" });
  }
  const who = await editorIdentity(request, env);
  if (sp.get("me") === "1") return json(who.ok ? { editor: true, role: who.role, name: who.name } : { editor: false });
  if (!who.ok) return json({ error: "forbidden" }, 403);
  if (sp.get("log") === "1") {
    const kind = String(sp.get("kind") || ""), id = String(sp.get("id") || "");
    if (!KINDS[kind] || !ID_RE.test(id)) return json({ error: "bad-request" }, 400);
    return json({ log: kv ? await kvJson(kv, LOG(kind, id), []) : [] });
  }
  return json({ error: "bad-request" }, 400);
}

export async function onRequestPost({ request, env }) {
  const who = await editorIdentity(request, env);
  if (!who.ok) return json({ error: "forbidden" }, 403);
  const u = new URL(request.url);
  if (u.searchParams.get("image") === "1") {
    const bucket = env && env.PREP_BANK_R2;
    if (!bucket) return json({ error: "not-configured" }, 503);
    const len = Number(request.headers.get("content-length") || 0);
    if (len > IMG_MAX_BYTES) return json({ error: "image-too-large" }, 413);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > IMG_MAX_BYTES) return json({ error: "image-too-large" }, 413);
    const type = imageType(buf);
    if (!type) return json({ error: "image-only" }, 415);
    const name = "fx-" + (await sha16(buf));
    await bucket.put("prep-bank/" + FIX_IMG_VER + "/img/" + name + ".webp", buf, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    return json({ ok: true, path: FIX_IMG_VER + "/img/" + name + ".webp" });
  }
  const kv = kvOf(env);
  if (!kv) return json({ error: "not-configured" }, 503);
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const kind = String(b.kind || ""), id = String(b.id || ""), mod = String(b.module || "");
  if (!KINDS[kind] || !ID_RE.test(id) || !SLUG_RE.test(mod)) return json({ error: "bad-request" }, 400);
  const v = validateFix(kind, b.fix);
  if (!v.ok) return json({ error: v.error }, 400);
  const now = Date.now(), slot = KINDS[kind];
  const rec = await kvJson(kv, MOD(mod), { q: {}, l: {} });
  rec.q = rec.q || {}; rec.l = rec.l || {};
  const before = rec[slot][id] || null;
  const note = clean(b.note || "", LIMITS.note);
  const fix = Object.assign({}, v.fix, { by: who.uid, name: who.name, role: who.role, ts: now });
  if (note) fix.note = note;
  rec[slot][id] = fix;
  const log = (await kvJson(kv, LOG(kind, id), [])).slice(-(LIMITS.log - 1));
  log.push({ ts: now, by: who.uid, name: who.name, role: who.role, before, after: fix });
  const ix = await kvJson(kv, IX, {});
  ix[mod] = now;
  await Promise.all([kv.put(MOD(mod), JSON.stringify(rec)), kv.put(LOG(kind, id), JSON.stringify(log), { expirationTtl: KEEP_S }), kv.put(IX, JSON.stringify(ix))]);
  return json({ ok: true, ts: now });
}

export async function onRequestDelete({ request, env }) {
  const who = await editorIdentity(request, env);
  if (!who.ok) return json({ error: "forbidden" }, 403);
  const kv = kvOf(env);
  if (!kv) return json({ error: "not-configured" }, 503);
  let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
  const kind = String(b.kind || ""), id = String(b.id || ""), mod = String(b.module || "");
  if (!KINDS[kind] || !ID_RE.test(id) || !SLUG_RE.test(mod)) return json({ error: "bad-request" }, 400);
  const slot = KINDS[kind], rec = await kvJson(kv, MOD(mod), { q: {}, l: {} });
  rec.q = rec.q || {}; rec.l = rec.l || {};
  const before = rec[slot][id] || null;
  if (!before) return json({ ok: true, ts: Date.now(), none: true });
  delete rec[slot][id];
  const now = Date.now();
  const log = (await kvJson(kv, LOG(kind, id), [])).slice(-(LIMITS.log - 1));
  log.push({ ts: now, by: who.uid, name: who.name, role: who.role, before, after: null });
  const ix = await kvJson(kv, IX, {});
  const empty = !Object.keys(rec.q).length && !Object.keys(rec.l).length && !(Array.isArray(rec.a) && rec.a.length);
  if (empty) delete ix[mod]; else ix[mod] = now;
  await Promise.all([empty && kv.delete ? kv.delete(MOD(mod)) : kv.put(MOD(mod), JSON.stringify(rec)), kv.put(LOG(kind, id), JSON.stringify(log), { expirationTtl: KEEP_S }), kv.put(IX, JSON.stringify(ix))]);
  return json({ ok: true, ts: now });
}
