/* prep-arena: PrepNucleus Arena live 1v1 battles. Plan: vault/plans/PrepNucleus-Arena.md (server pieces 1 and 4).
 *
 *   wss://<worker>/battle?exam=<neet-pg|neet-ss|usmle>[&room=<code>]   Sec-WebSocket-Protocol: smd-arena, <Firebase ID token>
 *
 * room: a friend challenge (functions/api/prep/social). Only its two players may use it (social_challenges row, not
 * expired); the challenge's exam wins over ?exam, and the room pairs only with the same room (core.js matchQueue).
 *
 * The Worker verifies the token (functions/_fbauth.js) and the player's consent row in D1 (PREP_ARENA_DB), then hands
 * the socket to the exam's Matchmaker. Matchmaker (one per exam) holds the sockets, the queue and the rate limit, and
 * relays answers. BattleRoom (one per match) owns the authoritative state (core.js), times rounds with alarms, and
 * writes the result and Elo to D1. Keys reach a client only inside the round result.
 */
import { DurableObject } from "cloudflare:workers";
import { verifyFirebaseClaims } from "../../functions/_fbauth.js";
import { EXAMS, uidHash, bankFrom, drawItems } from "../../functions/_prep-arena.js";
import { N_ROUNDS, ROOM_RE, parseClient, tokenFromProtocol, allowQueue, matchQueue, queueWakeAt, newBattle, battleEvent, wakeAt, sideOf } from "./core.js";

const text = (s, status) => new Response(s, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

export default {
  /* Evening digest of PrepNucleus social nudges ("N friends studied today"): the push path lives in Pages
   * (functions/_prep-nudge-push.js, PUSH_KV and the APNs/FCM secrets), so the cron only calls it. Needs the secret
   * PREP_CRON_TOKEN set here and in Pages; PREP_DIGEST_URL overrides the default. */
  async scheduled(event, env, ctx) {
    if (!env.PREP_CRON_TOKEN) return;
    ctx.waitUntil(fetch(env.PREP_DIGEST_URL || "https://stewardmd.in/api/prep/social/digest", { method: "POST", headers: { "X-Prep-Cron": env.PREP_CRON_TOKEN } }).catch(() => null));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return text("ok", 200);
    if (url.pathname !== "/battle") return text("not found", 404);
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return text("websocket only", 426);
    let exam = url.searchParams.get("exam") || "";
    const room = url.searchParams.get("room") || "";
    if (room && !ROOM_RE.test(room)) return text("bad room", 400);
    if (!room && EXAMS.indexOf(exam) < 0) return text("bad exam", 400);
    const token = tokenFromProtocol(request.headers.get("Sec-WebSocket-Protocol"));
    const claims = token ? await verifyFirebaseClaims(token, env).catch(() => null) : null;
    if (!claims || !claims.sub) return text("sign-in required", 401);
    const uidh = uidHash(claims.sub);
    const pl = await env.PREP_ARENA_DB.prepare("SELECT name, rating FROM arena_players WHERE uidh = ?").bind(uidh).first();
    if (!pl) return text("consent required", 403);
    if (room) {
      const c = await env.PREP_ARENA_DB.prepare("SELECT exam FROM social_challenges WHERE room = ? AND (from_uidh = ? OR to_uidh = ?) AND expires_at > ?").bind(room, uidh, uidh, Date.now()).first();
      if (!c) return text("no such challenge", 403);
      exam = c.exam;
    }
    const h = new Headers({ Upgrade: "websocket", "X-Arena-Uidh": uidh, "X-Arena-Name": encodeURIComponent(pl.name), "X-Arena-Rating": String(pl.rating), "X-Arena-Exam": exam, "X-Arena-Room": room });
    const mm = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(exam));
    return mm.fetch(new Request("https://arena/connect", { headers: h }));
  },
};

const send = (ws, msg) => { try { ws.send(JSON.stringify(msg)); } catch (e) {} };

export class Matchmaker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.socks = new Map();     // uidh -> { ws, name, rating, room }
    this.waiting = [];          // [{ uidh, rating, at, room }]
    this.inMatch = new Map();   // uidh -> match id
    this.rl = {};               // queue joins per uid, last minute
    this.exam = null;
    // ponytail: plain (non-hibernating) sockets, so this state lives in memory while anyone is connected; move to the
    // hibernation API + storage if idle-connection cost matters.
  }

  async fetch(request) {
    const uidh = request.headers.get("X-Arena-Uidh"), name = decodeURIComponent(request.headers.get("X-Arena-Name") || "");
    const rating = Number(request.headers.get("X-Arena-Rating")) || 1200, room = request.headers.get("X-Arena-Room") || null;
    this.exam = request.headers.get("X-Arena-Exam");
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    const old = this.socks.get(uidh);
    this.socks.set(uidh, { ws, name, rating, room });
    if (old) { this.waiting = this.waiting.filter((w) => w.uidh !== uidh); try { old.ws.close(4001, "replaced"); } catch (e) {} }   // one socket per player; a new socket re-queues (its room may differ)
    let junk = 0;
    ws.addEventListener("message", (e) => {
      const m = parseClient(e.data);
      if (!m) { if (++junk > 20) { try { ws.close(1008, "junk"); } catch (x) {} } return; }
      this.onMsg(uidh, m).catch(() => {});
    });
    const gone = () => this.onClose(uidh, ws).catch(() => {});
    ws.addEventListener("close", gone);
    ws.addEventListener("error", gone);
    const mid = this.inMatch.get(uidh);
    if (mid) this.room(mid).reconnect(uidh).then((out) => this.deliver(out)).catch(() => {});
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": "smd-arena" } });
  }

  room(id) { return this.env.BATTLE_ROOM.get(this.env.BATTLE_ROOM.idFromName(id)); }

  async onMsg(uidh, m) {
    const me = this.socks.get(uidh);
    if (!me) return;
    if (m.t === "queue") {
      if (this.inMatch.has(uidh)) return send(me.ws, { t: "busy" });                  // one active battle per uid
      if (this.waiting.some((w) => w.uidh === uidh)) return send(me.ws, { t: "waiting" });
      if (!allowQueue(this.rl, uidh, Date.now())) return send(me.ws, { t: "slow" });   // 10 joins a minute
      this.waiting.push({ uidh, rating: me.rating, at: Date.now(), room: me.room });
      send(me.ws, { t: "waiting" });
      return this.pump();
    }
    const mid = this.inMatch.get(uidh);
    if (m.t === "a" && mid) this.deliver(await this.room(mid).answer(uidh, m.i, m.k));
  }

  async onClose(uidh, ws) {
    const cur = this.socks.get(uidh);
    if (!cur || cur.ws !== ws) return;   // a replaced socket closing
    this.socks.delete(uidh);
    this.waiting = this.waiting.filter((w) => w.uidh !== uidh);
    const mid = this.inMatch.get(uidh);
    if (mid) this.deliver(await this.room(mid).disconnect(uidh));
  }

  async pump() {
    const now = Date.now(), { pairs, nobody } = matchQueue(this.waiting, now);
    for (const u of nobody) { const s = this.socks.get(u); if (s) send(s.ws, { t: "nobody" }); }
    for (const [a, b] of pairs) await this.startMatch(a, b);
    const t = queueWakeAt(this.waiting, Date.now());
    if (t) await this.ctx.storage.setAlarm(t);
  }
  async alarm() { await this.pump(); }

  async startMatch(a, b) {
    const id = crypto.randomUUID();
    const items = await drawItems(bankFrom(this.env.PREP_BANK_R2), this.exam, N_ROUNDS, id);
    const sa = this.socks.get(a.uidh), sb = this.socks.get(b.uidh);
    if (items.length < N_ROUNDS || !sa || !sb) {
      for (const s of [sa, sb]) if (s) send(s.ws, { t: "nobody" });
      return;
    }
    this.inMatch.set(a.uidh, id); this.inMatch.set(b.uidh, id);
    const players = [{ uidh: a.uidh, name: sa.name, rating: sa.rating }, { uidh: b.uidh, name: sb.name, rating: sb.rating }];
    this.deliver(await this.room(id).begin({ id, exam: this.exam, players, items }));
  }

  // Called by this DO and by BattleRoom (RPC): [{ uidh, msg }]. An "end" frees the player for the next battle.
  deliver(list) {
    for (const { uidh, msg } of list || []) {
      const s = this.socks.get(uidh);
      if (s) send(s.ws, msg);
      if (msg.t === "end") this.inMatch.delete(uidh);
    }
  }
}

export class BattleRoom extends DurableObject {
  async state() { return this.s || (this.s = (await this.ctx.storage.get("s")) || null); }
  addr(s, out) { return out.map((o) => ({ uidh: s.p[o.to].uidh, msg: o.msg })); }

  async after(s, out) {
    if (s.phase === "end" && !s.saved) {
      s.saved = true;
      const r = s.result, d = [r.after[0] - r.before[0], r.after[1] - r.before[1]];
      const winner = r.sa === 1 ? s.p[0].uidh : r.sa === 0 ? s.p[1].uidh : null;
      const db = this.env.PREP_ARENA_DB;
      try {
        await db.batch([
          db.prepare("INSERT OR IGNORE INTO arena_battles (id, exam, a, b, a_score, b_score, winner, ended_at, a_after, b_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(s.id, s.exam, s.p[0].uidh, s.p[1].uidh, s.score[0], s.score[1], winner, r.at, r.after[0], r.after[1]),
          // a delta, not an absolute: a rating that moved elsewhere meanwhile is not overwritten
          db.prepare("UPDATE arena_players SET rating = rating + ?, battles = battles + 1, wins = wins + ? WHERE uidh = ?").bind(d[0], r.sa === 1 ? 1 : 0, s.p[0].uidh),
          db.prepare("UPDATE arena_players SET rating = rating + ?, battles = battles + 1, wins = wins + ? WHERE uidh = ?").bind(d[1], r.sa === 0 ? 1 : 0, s.p[1].uidh),
        ]);
      } catch (e) { s.dbError = String(e && e.message || e).slice(0, 200); }
    }
    await this.ctx.storage.put("s", s);
    // after the end, one last alarm an hour later clears the room's storage
    const t = wakeAt(s) || (s.phase === "end" ? Date.now() + 3600e3 : null);
    if (t) await this.ctx.storage.setAlarm(t); else await this.ctx.storage.deleteAlarm();
    return this.addr(s, out);
  }

  async begin({ id, exam, players, items }) {
    if (await this.state()) return [];
    // fresh ratings: the Matchmaker's copy is from connect time and a socket can play several battles
    try {
      const { results } = await this.env.PREP_ARENA_DB.prepare("SELECT uidh, rating FROM arena_players WHERE uidh IN (?, ?)").bind(players[0].uidh, players[1].uidh).all();
      for (const r of results || []) for (const p of players) if (p.uidh === r.uidh) p.rating = r.rating;
    } catch (e) {}
    if (await this.state()) return [];
    const s = (this.s = newBattle({ id, exam, players, items, now: Date.now() }));
    return this.after(s, battleEvent(s, { type: "start" }, Date.now()));
  }
  async answer(uidh, i, k) { return this.on(uidh, { type: "answer", i, k }); }
  async disconnect(uidh) { return this.on(uidh, { type: "disconnect" }); }
  async reconnect(uidh) { return this.on(uidh, { type: "reconnect" }); }
  async on(uidh, ev) {
    const s = await this.state();
    if (!s) return [];
    const side = sideOf(s, uidh);
    if (side < 0) return [];
    return this.after(s, battleEvent(s, { ...ev, side }, Date.now()));
  }
  async alarm() {
    const s = await this.state();
    if (!s) return;
    if (s.phase === "end") { this.s = null; await this.ctx.storage.deleteAll(); return; }
    const out = await this.after(s, battleEvent(s, { type: "tick" }, Date.now()));
    if (out.length) await this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName(s.exam)).deliver(out);
  }
}
