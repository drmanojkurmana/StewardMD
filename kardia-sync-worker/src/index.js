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

    /* ---------------- POST /sync/session ---------------- */
    if (url.pathname === "/sync/session") {
      if (request.method !== "POST") {
        return text("method not allowed", 405);
      }
      const token = await extractToken(request);
      const claims = token ? await verifyFirebaseClaims(token, env).catch(() => null) : null;
      if (!claims || !claims.sub) {
        return json({ error: "sign-in required" }, 401);
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
        displayUid: claims.sub,
        createdAt: now,
        expiresAt,
      });

      return json({ roomId, roomToken, expiresAt }, 200);
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

      const claims = await verifyFirebaseClaims(parsedProto.token, env).catch(() => null);
      if (!claims || !claims.sub) {
        return text("sign-in required", 401);
      }

      const doId = env.SYNC_ROOM.idFromName(roomId);
      const roomStub = env.SYNC_ROOM.get(doId);

      const fwdHeaders = new Headers(request.headers);
      fwdHeaders.set("X-Sync-Uid", claims.sub);
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
