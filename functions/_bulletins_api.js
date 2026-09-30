/* StewardMD - Clinical Bulletins API. Mounted by functions/api/updates/[[path]].js BEFORE its owner gate,
 * because that gate accepts X-Admin-Token and nothing here may.
 *
 *   GET  /api/updates/bulletins                        public: live bulletins for the disease reader (ETag)
 *   GET  /api/updates/bulletins/me                     signed-in: { canSign, reason, isOwner, prefill }
 *   GET  /api/updates/bulletins/queue                  signer: review queue + candidates
 *   POST /api/updates/bulletins                        signer: create or edit a draft
 *   POST /api/updates/bulletins/:id/sign               signer: sign the previewed text
 *   POST /api/updates/bulletins/:id/retract            signer or owner
 *   POST /api/updates/bulletins/skip                   signer: { update_id, undo? } take a source item off the queue
 *   GET  /api/updates/bulletins/signers                owner
 *   GET  /api/updates/bulletins/signers/lookup?email=  owner: uid + pre-fill from the verified-doctor record
 *   POST /api/updates/bulletins/signers                owner: add or update a signer
 *   POST /api/updates/bulletins/signers/:uid/deactivate owner
 *   POST /api/updates/bulletins/kill                   owner: { killed, reason } kill switch, no redeploy
 *   POST /api/updates/bulletins/:id/cosign             signer (not the first signer): second reader confirms the text
 *   POST /api/updates/bulletins/:id/return             signer (not the first signer): { note } send it back to draft
 *   POST /api/updates/bulletins/second-reader          owner: { on, reason } second reader for approvals and safety alerts
 *   GET  /api/updates/bulletins/metrics                signer or owner: days to page, coverage, correction rate, backlog
 *   GET  /api/updates/bulletins/cdsco?q=               signer: look a drug up in the stored CDSCO new-drug lists
 *   POST /api/updates/bulletins/cdsco/refresh          owner: refresh those lists now (also runs with the daily sync)
 *
 * Tables are created on first use (functions/_bulletins_schema.js); no manual migration is needed.
 * Plan: docs/CLINICAL_AUTO_UPDATE_ENGINEERING_SPEC.md.
 */
import * as repo from "./_bulletins_repo.js";
import { validateDraft, bodyHash, publicProjection, sha256Hex, cleanText, knownDiseaseIds, SPECIALTIES, cleanSpecialties, specialtiesOf,
  isMine, cleanWarnings } from "./_bulletin_rules.js";
import { signerIdentity, ownerIdentity } from "./_bulletins_auth.js";
import { ensureBulletinSchema } from "./_bulletins_schema.js";
import { getUserClaims, lookupUidByEmail } from "./_fbadmin.js";
import { lookup as cdscoLookup, refreshCdscoLists } from "./_cdsco.js";
import { pendingCounts } from "./_bulletins_review_digest.js";

const PUB_CACHE = "public, max-age=300";
const RESERVED = ["me", "queue", "signers", "kill", "cdsco", "skip", "metrics", "second-reader"];
const CHECKLIST = ["source_read", "numbers_match", "india_checked", "own_words"];

function json(obj, status, cache, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": cache || "no-store" }, extra || {}),
  });
}
async function body(request) { try { const b = await request.json(); return b && typeof b === "object" ? b : {}; } catch (e) { return {}; } }
function kv(env) { return env.CASES_KV || env.GHIS_KV || null; }

// Name, registration and council from icu:doctor:<uid>, whichever shape verify-doctor.js wrote.
export async function doctorPrefill(env, uid) {
  const store = kv(env);
  if (!store || !uid) return null;
  let rec = null;
  try { rec = await store.get("icu:doctor:" + uid, "json"); } catch (e) {}
  if (!rec) return null;
  return {
    name: cleanText(rec.name || rec.extractedName || ""), reg_no: cleanText(rec.regNo || rec.extractedRegNo || ""),
    council: cleanText(rec.council || ""), record_status: String(rec.status || ""),
  };
}

function checkSignerFields(b) {
  const out = { uid: cleanText(b.uid).slice(0, 128), name: cleanText(b.name), reg_no: cleanText(b.reg_no), council: cleanText(b.council),
    specialties: cleanSpecialties(b.specialties) };
  const bad = [];
  if (!out.uid) bad.push("uid");
  if (out.name.length < 3 || out.name.length > 120) bad.push("name");
  if (!out.reg_no || out.reg_no.length > 40) bad.push("reg_no");
  if (out.council.length < 2 || out.council.length > 120) bad.push("council");
  ["name", "reg_no", "council"].forEach((f) => { if (out[f].indexOf("\u2014") >= 0 && bad.indexOf(f) < 0) bad.push(f); });
  return { out, bad };
}

// signer: { uid, specialties } of the viewer, for "Mine" and whether they may co-sign.
function queueItem(r, now, known, secondOn, signer) {
  const state = repo.stateOf(r, now, secondOn);
  const orphaned = (r.disease_ids || []).filter((d) => !known.has(d));
  const specialties = specialtiesOf([r.u_title, r.u_summary, r.headline, r.what_changed].join(" "), r.u_branch, r.u_workspace);
  const item = Object.assign({}, r, { state, orphaned, specialties, mine: isMine(specialties, signer && signer.specialties),
    can_cosign: state === "awaiting_second" && !!signer && signer.uid !== r.signed_uid });
  delete item.dz;
  return item;
}
function candidateItem(c, signer) {
  const specialties = specialtiesOf([c.title, c.summary].join(" "), c.branch, c.workspace);
  return Object.assign({}, c, { specialties, mine: isMine(specialties, signer && signer.specialties) });
}

export async function handleBulletins(context, parts) {
  const { request, env } = context;
  const method = request.method;
  const sub = parts[1] || "";
  const now = Date.now();

  /* ---------- public read ---------- */
  if (method === "GET" && !sub) {
    if (!repo.hasDb(env) || String(env.BULLETINS_OFF || "") === "1") return json({ enabled: false, items: [] });
    let items;
    try {
      await ensureBulletinSchema(env.UPDATES_DB);
      if (!(await repo.isEnabled(env))) return json({ enabled: false, items: [] });
      items = (await repo.listVisible(env, now, 500)).map((r) => publicProjection(r, r.disease_ids));
    } catch (e) {
      return json({ enabled: false, items: [] });                       // any D1 failure: fail closed
    }
    const etag = '"' + (await sha256Hex(items.map((i) => i.id + ":" + i.updated_ts + ":" + i.signed_ts + ":" + i.review_due_ts).join("|"))).slice(0, 32) + '"';
    const inm = (request.headers.get("If-None-Match") || "").replace(/^W\//, "");
    if (inm && inm === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": PUB_CACHE } });
    return json({ enabled: true, v: 1, items }, 200, PUB_CACHE, { ETag: etag });
  }

  if (!repo.hasDb(env)) return json({ error: "no-db" }, 501);
  await ensureBulletinSchema(env.UPDATES_DB);   // throws to the router's catch (clean 500) if D1 refuses

  /* ---------- who am I ---------- */
  if (method === "GET" && sub === "me") {
    const s = await signerIdentity(request, env);
    const o = await ownerIdentity(request, env);
    if (!s.ok && s.reason === "not-signed-in") return json({ error: "sign-in-required" }, 401);
    let killed = false;
    try { killed = !(await repo.isEnabled(env)); } catch (e) {}
    const uid = s.ok ? s.uid : (o.ok ? o.uid : null);
    const prefill = o.ok ? await doctorPrefill(env, o.uid) : null;
    let pending = null, secondOn = true;
    if (s.ok) { try { pending = await pendingCounts(env, now, s); } catch (e) {} }
    try { secondOn = await repo.secondReaderOn(env); } catch (e) {}
    return json({
      canSign: s.ok, reason: s.ok ? "" : s.reason, isOwner: o.ok, killed, pending, secondReader: secondOn,
      signer: s.ok ? { uid: s.uid, name: s.name, regNo: s.regNo, council: s.council, specialties: s.specialties || [] } : null,
      self: o.ok ? Object.assign({ uid }, prefill || {}) : null,
      specialtyOptions: SPECIALTIES.map((x) => [x[0], x[1]]),
    });
  }

  /* ---------- numbers: signer or owner ---------- */
  if (method === "GET" && sub === "metrics") {
    const s0 = await signerIdentity(request, env);
    const o0 = s0.ok ? null : await ownerIdentity(request, env);
    if (!s0.ok && !(o0 && o0.ok)) return json({ error: "forbidden", reason: s0.reason }, s0.reason === "not-signed-in" ? 401 : 403);
    const days = Math.min(365, Math.max(7, parseInt(new URL(request.url).searchParams.get("days"), 10) || 90));
    return json(Object.assign({ ok: true, second_reader: await repo.secondReaderOn(env) }, await repo.metrics(env, now, days)));
  }

  /* ---------- owner: signers + kill switch + second reader ---------- */
  if (sub === "signers" || sub === "kill" || sub === "second-reader") {
    const o = await ownerIdentity(request, env);
    if (!o.ok) return json({ error: "forbidden", reason: o.reason }, o.reason === "not-signed-in" ? 401 : 403);

    if (sub === "kill" && method === "POST") {
      const b = await body(request);
      const reason = cleanText(b.reason);
      if (typeof b.killed !== "boolean") return json({ error: "killed-boolean-required" }, 400);
      if (reason.length < 10 || reason.length > 300) return json({ error: "reason-required" }, 400);
      await repo.setEnabled(env, !b.killed, o.uid, reason, now);
      return json({ ok: true, killed: b.killed });
    }
    if (sub === "second-reader" && method === "POST") {
      const b = await body(request);
      const reason = cleanText(b.reason);
      if (typeof b.on !== "boolean") return json({ error: "on-boolean-required" }, 400);
      if (reason.length < 10 || reason.length > 300) return json({ error: "reason-required" }, 400);
      await repo.setSecondReader(env, b.on, o.uid, reason, now);
      return json({ ok: true, on: b.on });
    }
    if (sub === "signers" && method === "GET" && !parts[2]) return json({ ok: true, signers: await repo.listSigners(env) });
    if (sub === "signers" && method === "GET" && parts[2] === "lookup") {
      const email = cleanText(new URL(request.url).searchParams.get("email")).toLowerCase();
      if (!email) return json({ error: "email-required" }, 400);
      let found = null, claims = {};
      try { found = await lookupUidByEmail(env, email); } catch (e) {}   // -> { uid, email, name } | null
      const uid = found && found.uid;
      if (!uid) return json({ error: "no-account" }, 404);
      try { claims = (await getUserClaims(env, uid)) || {}; } catch (e) {}
      return json({ ok: true, uid, email, verified: claims.verified === true, prefill: await doctorPrefill(env, uid) });
    }
    if (sub === "signers" && method === "POST" && !parts[2]) {
      const { out, bad } = checkSignerFields(await body(request));
      if (bad.length) return json({ error: "invalid", fields: bad }, 400);
      let claims = {};
      try { claims = (await getUserClaims(env, out.uid)) || {}; } catch (e) {}
      if (claims.verified !== true) return json({ error: "not-verified-doctor" }, 400);
      await repo.upsertSigner(env, out, o.uid, now);
      return json({ ok: true, signer: await repo.getSigner(env, out.uid) });
    }
    if (sub === "signers" && method === "POST" && parts[2] && parts[3] === "deactivate") {
      await repo.deactivateSigner(env, parts[2], o.uid, now);
      return json({ ok: true });
    }
    return json({ error: "bad-request" }, 400);
  }

  /* ---------- CDSCO lists: refresh (owner), lookup (signer) ---------- */
  if (sub === "cdsco" && method === "POST" && parts[2] === "refresh") {
    const o = await ownerIdentity(request, env);
    if (!o.ok) return json({ error: "forbidden", reason: o.reason }, o.reason === "not-signed-in" ? 401 : 403);
    return json(await refreshCdscoLists(env));
  }
  if (sub === "cdsco" && method === "GET") {
    const s0 = await signerIdentity(request, env);
    if (!s0.ok) return json({ error: "forbidden", reason: s0.reason }, s0.reason === "not-signed-in" ? 401 : 403);
    const q = cleanText(new URL(request.url).searchParams.get("q")).slice(0, 160);
    if (q.length < 4) return json({ error: "query-too-short" }, 400);
    return json(Object.assign({ ok: true, q }, await cdscoLookup(env, q)));
  }

  /* ---------- retract: any active signer, or an owner ---------- */
  if (method === "POST" && sub && RESERVED.indexOf(sub) < 0 && parts[2] === "retract") {
    const s = await signerIdentity(request, env);
    const o = s.ok ? null : await ownerIdentity(request, env);
    if (!s.ok && !(o && o.ok)) return json({ error: "forbidden", reason: s.reason }, s.reason === "not-signed-in" ? 401 : 403);
    const reason = cleanText((await body(request)).reason);
    if (reason.length < 10 || reason.length > 300) return json({ error: "reason-required" }, 400);
    const r = await repo.retract(env, { id: sub, reason, uid: s.ok ? s.uid : o.uid, now });
    return r.ok ? json({ ok: true }) : json({ error: r.code }, r.code === "not-found" ? 404 : 409);
  }

  /* ---------- signer-only from here ---------- */
  const s = await signerIdentity(request, env);
  if (!s.ok) return json({ error: "forbidden", reason: s.reason }, s.reason === "not-signed-in" ? 401 : 403);

  const secondOn = await repo.secondReaderOn(env);

  if (method === "GET" && sub === "queue") {
    const known = knownDiseaseIds();
    const rows = await repo.listForQueue(env);
    const items = rows.map((r) => queueItem(r, now, known, secondOn, s));
    for (const it of items) {
      if (it.state === "source_changed" && it.update_id) {
        try { it.source_change = await repo.latestSourceChange(env, it.update_id); } catch (e) {}
      }
    }
    let killed = false;
    try { killed = !(await repo.isEnabled(env)); } catch (e) {}
    const candidates = (await repo.listCandidates(env, now - 90 * 86400000, 50)).map((c) => candidateItem(c, s));
    return json({ ok: true, killed, secondReader: secondOn, items, candidates });
  }

  if (method === "POST" && !sub) {
    const b = await body(request);
    const id = b.id ? cleanText(b.id).slice(0, 40) : "";
    let existing = null;
    if (id) {
      existing = await repo.getBulletin(env, id);
      if (!existing) return json({ error: "not-found" }, 404);
      if (existing.status === "retracted") return json({ error: "retracted" }, 409);
      if (cleanText(b.update_id) !== existing.update_id) return json({ error: "update-id-immutable" }, 400);
      if (Number(b.updated_ts) !== existing.updated_ts) return json({ error: "stale", item: queueItem(existing, now, knownDiseaseIds(), secondOn, s) }, 409);
    }
    const res = validateDraft(b, { now });
    if (!res.ok) return json({ error: "invalid", errors: res.errors }, 400);
    const u = await repo.getUpdateRow(env, res.value.update_id);
    if (!u) return json({ error: id ? "source-missing" : "unknown-update" }, id ? 409 : 400);
    const hash = await bodyHash(res.value);
    const ts = existing ? Math.max(now, existing.updated_ts + 1) : now;   // updated_ts strictly increases: it is the edit guard
    const saved = await repo.saveDraft(env, {
      id: id || null, value: res.value, sourceHash: u.content_hash || "", bodyHash: hash, uid: s.uid, now: ts,
      expectUpdatedTs: existing ? existing.updated_ts : undefined,
    });
    if (!saved) return json({ error: "stale" }, 409);
    return json({ ok: true, item: queueItem(await repo.getBulletin(env, saved), now, knownDiseaseIds(), secondOn, s) });
  }

  if (method === "POST" && sub && RESERVED.indexOf(sub) < 0 && parts[2] === "sign") {
    const b = await body(request);
    const cl = b.checklist || {};
    const missing = CHECKLIST.filter((k) => cl[k] !== true);
    if (missing.length) return json({ error: "checklist-incomplete", missing }, 400);
    const previewed = cleanText(b.body_hash);
    if (!/^[0-9a-f]{64}$/.test(previewed)) return json({ error: "body-hash-required" }, 400);
    const r = await repo.sign(env, { id: sub, previewedHash: previewed, signer: s, now, secondOn, warnings: cleanWarnings(b.warnings) });
    if (!r.ok) return json({ error: r.code }, r.code === "not-found" ? 404 : 409);
    return json({ ok: true, item: queueItem(r.row, now, knownDiseaseIds(), secondOn, s) });
  }

  if (method === "POST" && sub && RESERVED.indexOf(sub) < 0 && parts[2] === "cosign") {
    const b = await body(request);
    const cl = b.checklist || {};
    const missing = CHECKLIST.filter((k) => cl[k] !== true);
    if (missing.length) return json({ error: "checklist-incomplete", missing }, 400);
    const previewed = cleanText(b.body_hash);
    if (!/^[0-9a-f]{64}$/.test(previewed)) return json({ error: "body-hash-required" }, 400);
    const r = await repo.cosign(env, { id: sub, previewedHash: previewed, signer: s, now });
    if (!r.ok) return json({ error: r.code }, r.code === "not-found" ? 404 : 409);
    return json({ ok: true, item: queueItem(r.row, now, knownDiseaseIds(), secondOn, s) });
  }

  if (method === "POST" && sub && RESERVED.indexOf(sub) < 0 && parts[2] === "return") {
    const note = cleanText((await body(request)).note);
    if (note.length < 10 || note.length > 500) return json({ error: "note-required" }, 400);
    const r = await repo.sendBack(env, { id: sub, note, uid: s.uid, now });
    if (!r.ok) return json({ error: r.code }, r.code === "not-found" ? 404 : 409);
    return json({ ok: true, item: queueItem(r.row, now, knownDiseaseIds(), secondOn, s) });
  }

  if (method === "POST" && sub === "skip") {
    const b = await body(request);
    const updateId = cleanText(b.update_id).slice(0, 80);
    if (!updateId) return json({ error: "update-id-required" }, 400);
    if (!(await repo.getUpdateRow(env, updateId))) return json({ error: "unknown-update" }, 404);
    await repo.setSkip(env, { updateId, uid: s.uid, now, undo: b.undo === true });
    return json({ ok: true, update_id: updateId, skipped: b.undo !== true });
  }

  if (method === "GET" && sub && RESERVED.indexOf(sub) < 0 && parts[2] === "audit") {
    return json({ ok: true, audit: await repo.listAudit(env, sub, 50) });
  }

  return json({ error: "bad-request" }, 400);
}
