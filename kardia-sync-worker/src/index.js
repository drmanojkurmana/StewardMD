/* kardia-sync-worker/src/index.js
 * Cloudflare Worker for Kardia SyncProbe Relay:
 *   POST /sync/session
 *   GET /sync/room?id=<roomId>&role=display|probe (WebSocket upgrade)
 *
 * Spec: ~/prep-data/cxp-briefs/_syncprobe-contract.md
 */

import { DurableObject } from "cloudflare:workers";
import { verifyFirebaseClaims } from "../../functions/_fbauth.js";
import {
  parseProtocol,
  generateRoomId,
  generateRoomToken,
  handleCodeLookup,
  handleSessionCreate,
  normalizeShortCode,
  CodeDirectory,
  LookupRateLimiter,
  IpRateLimiter,
  ANON_UID,
  SESSION_TTL_MS,
  SyncRoomCore,
} from "./core.js";

const text = (s, status, headers = {}) =>
  new Response(s, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Sec-WebSocket-Protocol",
      ...headers,
    },
  });

/* Extract bearer or custom token from request */
/* Client IP for per-IP lookup rate limiting (first address wins) */
function getClientIp(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwarded = request.headers.get("X-Forwarded-For");
  if (forwarded && forwarded.trim()) return forwarded.split(",")[0].trim();
  return "unknown";
}

const CODE_DIRECTORY_NAME = "code-directory-v1";

function getCodeDirectory(env) {
  if (!env.SYNC_CODES) return null;
  const id = env.SYNC_CODES.idFromName(CODE_DIRECTORY_NAME);
  return env.SYNC_CODES.get(id);
}

async function extractToken(request) {
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader) {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const xTok = request.headers.get("X-Firebase-Token");
  if (xTok) return xTok.trim();

  // Try JSON body if applicable
  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    try {
      const clone = request.clone();
      const body = await clone.json();
      if (body && typeof body.token === "string") return body.token.trim();
    } catch (e) {}
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, Sec-WebSocket-Protocol",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (url.pathname === "/health") {
      return text("ok", 200);
    }

    /* ---------------- POST /sync/session ----------------
     * No sign-in required (owner 2026-10-26): the single use code, ECDH
     * agreement with the 4 digit confirmation and HMAC signed poses secure
     * the room. A valid Firebase token still binds the room to that user;
     * no token (or the anonymous marker) creates an anonymous room. A token
     * that is present but invalid is refused, never silently downgraded.
     * Creation is strictly rate limited per IP either way. */
    if (url.pathname === "/sync/session") {
      if (request.method !== "POST") {
        return text("method not allowed", 405);
      }
      const ip = getClientIp(request);
      const dirStub = getCodeDirectory(env);
      if (dirStub) {
        const gate = await dirStub.checkSessionCreate({ ip, now: Date.now() });
        if (gate && gate.status === 429) {
          const retrySec = Math.max(1, Math.ceil((gate.body && gate.body.retryAfterMs) || 60000) / 1000);
          return json(gate.body, 429, { "Retry-After": String(retrySec) });
        }
      }
      const token = await extractToken(request);
      let displayUid = ANON_UID;
      if (token) {
        const claims = await verifyFirebaseClaims(token, env).catch(() => null);
        if (!claims || !claims.sub) {
          return json({ error: "sign-in required" }, 401);
        }
        displayUid = claims.sub;
      }

      const roomId = generateRoomId();
      const roomToken = generateRoomToken();
      const now = Date.now();
      const expiresAt = now + SESSION_TTL_MS;

      // Initialize the SyncRoom Durable Object
      const doId = env.SYNC_ROOM.idFromName(roomId);
      const roomStub = env.SYNC_ROOM.get(doId);
      await roomStub.initSession({
        roomId,
        roomToken,
        displayUid,
        createdAt: now,
        expiresAt,
      });

      // Optional typed-code registration: the display sends the short
      // code shown on screen plus the public handshake material, so a
      // probe can resolve the code to this room without Bluetooth.
      // Absent (older clients) means relay lookup is simply unavailable.
      let codeRegistered = false;
      let codeBody = null;
      try {
        const maybeBody = await request.clone().json();
        if (maybeBody && typeof maybeBody === "object") codeBody = maybeBody;
      } catch (e) {
        codeBody = null;
      }
      if (codeBody && (codeBody.shortCode || codeBody.sessionId || codeBody.displayPub)) {
        const normalizedCode = normalizeShortCode(codeBody.shortCode);
        const sid = typeof codeBody.sessionId === "string" ? codeBody.sessionId.toLowerCase() : "";
        const pub = codeBody.displayPub;
        if (!normalizedCode || !/^[0-9a-f]{32}$/.test(sid) || typeof pub !== "string" || !/^[A-Za-z0-9_-]{86,88}$/.test(pub)) {
          return json({ error: "invalid code registration" }, 400);
        }
        if (dirStub) {
          const reg = await dirStub.registerCode({
            code: normalizedCode,
            roomId,
            roomToken,
            sessionId: sid,
            displayPub: pub,
            now,
            expiresAt,
          });
          codeRegistered = !!(reg && reg.ok);
        }
      }

      return json({ roomId, roomToken, expiresAt, codeRegistered }, 200);
    }

    /* ---------------- POST /sync/code (typed-code lookup) ----------------
     * No sign-in required: anonymous lookups are limited per IP in the
     * directory (single use, 5 minute expiry, no oracle). A token that is
     * present but invalid is refused, never silently downgraded. The uid
     * is always derived server side from the verified token or the client
     * IP; a uid sent in the body is never trusted. */
    if (url.pathname === "/sync/code") {
      if (request.method !== "POST") {
        return text("method not allowed", 405);
      }
      const token = await extractToken(request);
      let uid = ANON_UID + ":" + getClientIp(request);
      if (token) {
        const claims = await verifyFirebaseClaims(token, env).catch(() => null);
        if (!claims || !claims.sub) {
          return json({ error: "sign-in required" }, 401);
        }
        uid = claims.sub;
      }
      let code = null;
      try {
        const body = await request.json();
        if (body && typeof body.code === "string") code = body.code;
      } catch (e) {
        code = null;
      }
      const dirStub = getCodeDirectory(env);
      if (!dirStub) {
        return json({ error: "not-found" }, 404);
      }
      const res = await dirStub.resolveCode({
        code,
        uid,
        ip: getClientIp(request),
        now: Date.now(),
      });
      if (res && res.status === 429) {
        const retrySec = Math.max(1, Math.ceil((res.body && res.body.retryAfterMs) || 60000) / 1000);
        return json(res.body, 429, { "Retry-After": String(retrySec) });
      }
      return json(res.body, res.status);
    }

    /* ---------------- wss /sync/room ---------------- */
    if (url.pathname === "/sync/room") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return text("websocket only", 426);
      }

      const roomId = url.searchParams.get("id") || "";
      const role = url.searchParams.get("role") || "";

      if (!roomId || (role !== "display" && role !== "probe")) {
        return text("bad request: id and valid role required", 400);
      }

      const parsedProto = parseProtocol(request.headers.get("Sec-WebSocket-Protocol"));
      if (!parsedProto) {
        return text("bad protocol header", 400);
      }

      /* Anonymous sockets carry the kardia-anon marker instead of a
       * Firebase token; the room token and the room's role binding in
       * SyncRoomCore still gate the socket. Signed-in sockets verify as
       * before. The uid is set server side here, never from the client. */
      let syncUid = ANON_UID;
      if (!parsedProto.anonymous) {
        const claims = await verifyFirebaseClaims(parsedProto.token, env).catch(() => null);
        if (!claims || !claims.sub) {
          return text("sign-in required", 401);
        }
        syncUid = claims.sub;
      }

      const doId = env.SYNC_ROOM.idFromName(roomId);
      const roomStub = env.SYNC_ROOM.get(doId);

      const fwdHeaders = new Headers(request.headers);
      fwdHeaders.set("X-Sync-Uid", syncUid);
      fwdHeaders.set("X-Sync-Role", role);
      fwdHeaders.set("X-Sync-Room-Token", parsedProto.roomToken);

      return roomStub.fetch(new Request(request.url, { headers: fwdHeaders }));
    }

    return text("not found", 404);
  },
};

/* ==================== Durable Object: SyncRoom ==================== */
export class SyncRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = null;
    this.sockets = { display: null, probe: null };
  }

  async loadCore() {
    if (!this.core) {
      const stored = await this.ctx.storage.get("session");
      if (stored) {
        this.core = SyncRoomCore.fromJSON(stored);
      }
    }
    return this.core;
  }

  async saveCore() {
    if (this.core) {
      // Never store frames or logs of payloads; only session state
      await this.ctx.storage.put("session", this.core.toJSON());
      const nextWake = this.core.wakeAt(Date.now());
      if (nextWake) {
        await this.ctx.storage.setAlarm(nextWake);
      } else {
        await this.ctx.storage.deleteAlarm();
      }
    }
  }

  /* RPC method called when POST /sync/session creates the room */
  async initSession({ roomId, roomToken, displayUid, createdAt, expiresAt }) {
    this.core = new SyncRoomCore({
      roomId,
      roomToken,
      displayUid,
      createdAt,
      expiresAt,
    });
    await this.saveCore();
    return { ok: true };
  }

  /* Handle incoming WebSocket upgrade request forwarded from Worker fetch */
  async fetch(request) {
    const url = new URL(request.url);

    // RPC fallback over fetch
    if (url.pathname === "/internal/init") {
      const body = await request.json();
      return json(await this.initSession(body));
    }
    if (url.pathname === "/internal/end") {
      return json(await this.endSession("explicit_end"));
    }

    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return text("websocket only", 426);
    }

    const uid = request.headers.get("X-Sync-Uid");
    const role = request.headers.get("X-Sync-Role");
    const roomToken = request.headers.get("X-Sync-Room-Token");

    await this.loadCore();
    if (!this.core) {
      return text("room not found", 404);
    }

    const check = this.core.canConnect({
      role,
      tokenUid: uid,
      roomToken,
      now: Date.now(),
    });

    if (!check.ok) {
      return text(check.reason || "forbidden", check.status || 403);
    }

    // Connect this role
    this.core.connect({ role, tokenUid: uid, roomToken, now: Date.now() });

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    this.sockets[role] = server;
    await this.saveCore();

    server.addEventListener("message", (e) => {
      this.handleMessage(role, e.data);
    });

    const onEnd = () => this.handleSocketClose(role, server);
    server.addEventListener("close", onEnd);
    server.addEventListener("error", onEnd);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "kardia-sync" },
    });
  }

  handleMessage(role, data) {
    if (!this.core || this.core.closed) return;
    const now = Date.now();
    const res = this.core.onMessage({ role, data, now });
    if (!res.forwarded) return;

    const peerSocket = this.sockets[res.toRole];
    if (peerSocket) {
      try {
        peerSocket.send(data);
      } catch (err) {}
    }

    if (res.closeBoth) {
      this.terminateBoth(res.reason || "bye");
    } else {
      // Reschedule idle alarm
      const nextWake = this.core.wakeAt(now);
      if (nextWake) {
        this.ctx.storage.setAlarm(nextWake).catch(() => {});
      }
    }
  }

  handleSocketClose(role, server) {
    if (!this.core || this.core.closed) return;
    if (server && this.sockets[role] !== server) {
      return;
    }
    this.sockets[role] = null;
    const res = this.core.onClose({ role, now: Date.now() });
    if (res && res.closePeer) {
      const peerSocket = this.sockets[res.peerRole];
      if (peerSocket) {
        try {
          peerSocket.close(1000, res.reason || "peer closed");
        } catch (e) {}
      }
      this.sockets[res.peerRole] = null;
    }
    this.saveCore().catch(() => {});
  }

  async endSession(reason = "ended") {
    this.terminateBoth(reason);
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }

  terminateBoth(reason) {
    for (const r of ["display", "probe"]) {
      const s = this.sockets[r];
      if (s) {
        try {
          s.close(1000, reason);
        } catch (e) {}
        this.sockets[r] = null;
      }
    }
    if (this.core) {
      this.core.invalidate(reason);
      this.saveCore().catch(() => {});
    }
  }

  async alarm() {
    await this.loadCore();
    if (!this.core) return;
    const now = Date.now();
    const timeout = this.core.checkTimeouts(now);
    if (timeout && timeout.expired) {
      this.terminateBoth(timeout.reason);
      await this.ctx.storage.deleteAll();
    }
  }
}

/* ============ Durable Object: SyncCodeDirectory (typed-code lookup) ============
 * Singleton directory (one instance at a fixed name) mapping short codes
 * to room join material for the code lifetime. Holds only small join
 * fields, never frames or payloads. Rate limits lookups per user and per
 * IP. Entries are single use: a successful resolve deletes the entry. */
export class SyncCodeDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.dir = null;
    this.limiter = null;
    this.sessionLimiter = null;
  }

  async load() {
    if (!this.dir) {
      const stored = await this.ctx.storage.get("codes");
      this.dir = CodeDirectory.fromJSON(stored || null);
    }
    if (!this.limiter) {
      const storedLimits = await this.ctx.storage.get("lookup-limits");
      this.limiter = LookupRateLimiter.fromJSON(storedLimits || null);
    }
    if (!this.sessionLimiter) {
      const storedCreate = await this.ctx.storage.get("session-limits");
      this.sessionLimiter = IpRateLimiter.fromJSON(storedCreate || null);
    }
  }

  async save() {
    const now = Date.now();
    await this.ctx.storage.put("codes", this.dir.toJSON());
    await this.ctx.storage.put("lookup-limits", this.limiter.toJSON(now));
    await this.ctx.storage.put("session-limits", this.sessionLimiter.toJSON(now));
    const next = this.dir.nextExpiry();
    if (next) {
      await this.ctx.storage.setAlarm(next);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  /* RPC: display registers its short code when it creates a session. */
  async registerCode({ code, roomId, roomToken, sessionId, displayPub, now, expiresAt }) {
    await this.load();
    const t = now == null ? Date.now() : now;
    const res = this.dir.register({ code, roomId, roomToken, sessionId, displayPub, now: t, expiresAt });
    if (!res.ok) return res;
    await this.save();
    return { ok: true };
  }

  /* RPC: per-IP gate on anonymous session creation. */
  async checkSessionCreate({ ip, now }) {
    await this.load();
    const t = now == null ? Date.now() : now;
    const res = handleSessionCreate({ ip, now: t }, { limiter: this.sessionLimiter });
    await this.save();
    return res;
  }

  /* RPC: probe resolves a typed code to the room join material. */
  async resolveCode({ code, uid, ip, now }) {
    await this.load();
    const t = now == null ? Date.now() : now;
    const res = handleCodeLookup({ code, uid, ip, now: t }, { directory: this.dir, limiter: this.limiter });
    await this.save();
    return res;
  }

  /* RPC: remove entries for a room (reserved for explicit session end). */
  async deleteByRoom({ roomId }) {
    await this.load();
    const res = this.dir.deleteByRoom({ roomId });
    await this.save();
    return res;
  }

  async alarm() {
    await this.load();
    this.dir.sweep(Date.now());
    await this.save();
  }
}
