/* StewardMD — Knowledge Units (KU) endpoint (Cloudflare Pages Function).
 *
 * Server-authoritative, identity-verified points ledger + engagement layer. Identity is derived
 * by reusing _usage.js `identify()` (verified Firebase ID token → "fb:<uid>", or Cf-Access email;
 * unverified/guest → rejected). The client's claimed uid is never trusted. Balance/streak/badges
 * live in KV (usageKv), so localStorage tampering is display-only.
 *
 * ledger.js owns the ECONOMY (earning, caps, streak, bonuses, stats); progression.js owns the
 * LEVEL/QUEST/BADGE framework. This endpoint does identity + KV + orchestration.
 *
 * Routes (all require a signed-in, verified identity → 401 signin-required for guests):
 *   POST /api/ku/award    body { events:[{type,refId,spec?}] }   -> merged summary + { todayEarned, newBadges, questCompleted }
 *   POST /api/ku/qualify  body { day:"YYYYMMDD", tzOffsetMin }    -> merged summary + { qualified, already, newBadges }
 *   POST /api/ku/pin      body { ids:[badgeId,...] }              -> { pinned }
 *   GET  /api/ku/summary                                          -> merged summary (read-only)
 */
import { usageKv, identify } from "../../_usage.js";
import { freshDoc, applyEvents, qualifyDay, summarize, grantKU, noteActivity, dayStr } from "./ledger.js";
import { progressionSummary, questState, evalBadges, badgeById, QUEST_REWARD } from "./progression.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const KEY_TTL = 60 * 60 * 24 * 400; // ~400 days; refreshed on every write

// Merged economy + progression view (what the client dashboard consumes).
function view(doc, day) { return Object.assign(summarize(doc), progressionSummary(doc, day)); }

// Grant the daily quest reward the moment its goals are met (once per day). Mutates doc; returns
// true if it was just completed this call.
function completeQuestIfDone(doc, day) {
  const qs = questState(doc, day);
  if (!qs.done) return false;
  if (doc.quest && doc.quest.doneDay === day) return false;      // already rewarded today
  doc.quest = doc.quest || {};
  doc.quest.doneDay = day; doc.quest.day = qs.id;
  doc.stats = doc.stats || {}; doc.stats.questsDone = (doc.stats.questsDone || 0) + 1;
  grantKU(doc, "quest", QUEST_REWARD, day);
  noteActivity(doc, day, { kind: "quest", id: qs.id, ku: QUEST_REWARD });
  return true;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");

  const store = usageKv(env);
  if (!store) return json({ error: "unavailable" }, 503);       // fail-closed: never grant KU without a ledger

  const who = await identify(request, env);
  if (!who || who.guest) return json({ error: "signin-required" }, 401);
  const key = "ku:" + who.id;
  const nowDay = dayStr(new Date());

  try {
    if (request.method === "POST" && seg === "award") {
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
      const doc = (await store.get(key, "json")) || freshDoc();
      const todayEarned = applyEvents(doc, events, nowDay);
      const questCompleted = completeQuestIfDone(doc, nowDay);
      const newBadges = evalBadges(doc, Date.now());
      newBadges.forEach(function (id) { noteActivity(doc, nowDay, { kind: "badge", id: id }); });
      await store.put(key, JSON.stringify(doc), { expirationTtl: KEY_TTL });
      return json(Object.assign({ todayEarned: todayEarned, questCompleted: questCompleted, newBadges: newBadges }, view(doc, nowDay)));
    }

    if (request.method === "POST" && seg === "qualify") {
      // Client posts its LOCAL calendar day once it has 5 min of active use that day. Server owns
      // the streak maths; only persists on a real advance (idempotent no-ops still return state).
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const day = String(body.day || "").replace(/[^0-9]/g, "").slice(0, 8);
      const tz = Number(body.tzOffsetMin);
      const doc = (await store.get(key, "json")) || freshDoc();
      const res = qualifyDay(doc, day, { nowMs: Date.now(), tzOffsetMin: isFinite(tz) ? tz : 0 });
      let newBadges = [];
      if (res && res.advanced) {
        newBadges = evalBadges(doc, Date.now());
        newBadges.forEach(function (id) { noteActivity(doc, day, { kind: "badge", id: id }); });
        await store.put(key, JSON.stringify(doc), { expirationTtl: KEY_TTL });
      }
      return json(Object.assign({ qualified: !!(res && res.advanced), already: !!(res && res.already), newBadges: newBadges }, view(doc, nowDay)));
    }

    if (request.method === "POST" && seg === "pin") {
      // Pin up to 3 UNLOCKED badges to the profile.
      let body = {};
      try { body = await request.json(); } catch (e) {}
      const doc = (await store.get(key, "json")) || freshDoc();
      const want = Array.isArray(body.ids) ? body.ids.slice(0, 8) : [];
      doc.badges = doc.badges || {};
      const pinned = want.filter(function (id) { return badgeById(id) && doc.badges[id]; }).slice(0, 3);
      doc.pinned = pinned;
      await store.put(key, JSON.stringify(doc), { expirationTtl: KEY_TTL });
      return json({ pinned: pinned });
    }

    if (request.method === "GET" && seg === "summary") {
      const doc = (await store.get(key, "json")) || freshDoc();
      return json(view(doc, nowDay));
    }
    return json({ error: "not-found" }, 404);
  } catch (e) {
    return json({ error: "server", detail: String((e && e.message) || e).slice(0, 120) }, 500);
  }
}
