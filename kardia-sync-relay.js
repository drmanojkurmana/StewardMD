/* kardia-sync-relay.js - Kardia SyncProbe secure internet relay transport adapter.
 *
 * ES5 IIFE, window.KARDIA_SYNC_RELAY, registers with window.KARDIA_SYNC.
 * Implements the shared SyncProbe transport interface (kind: relay, needsInternet: true).
 * Spec: ~/prep-data/cxp-briefs/_syncprobe-contract.md (Worker C)
 */
(function (G) {
  "use strict";

  var DEFAULT_HTTP = "https://kardia-sync.drmanojkurmana.workers.dev";
  var DEFAULT_WS = "wss://kardia-sync.drmanojkurmana.workers.dev";

  var state = {
    ws: null,
    role: null,
    sentCount: 0,
    recvCount: 0,
    lastRecvAt: 0,
    lastSentAt: 0,
    rttMs: 0,
    lossPct: 0,
    statsInterval: null,
    sentPerSec: 0,
    recvPerSec: 0,
    prevSent: 0,
    prevRecv: 0,
  };

  function getHttpUrl() {
    try {
      if (G.SMD_KARDIA_SYNC_URL) return G.SMD_KARDIA_SYNC_URL.replace(/\/$/, "");
    } catch (e) {}
    return DEFAULT_HTTP;
  }

  function getWsUrl() {
    try {
      if (G.SMD_KARDIA_SYNC_WS) return G.SMD_KARDIA_SYNC_WS.replace(/\/$/, "");
      if (G.SMD_KARDIA_SYNC_URL) return G.SMD_KARDIA_SYNC_URL.replace(/\/$/, "").replace(/^http/i, "ws");
    } catch (e) {}
    return DEFAULT_WS;
  }

  function getPlatform() {
    try {
      if (G.Capacitor && G.Capacitor.getPlatform) {
        var p = G.Capacitor.getPlatform();
        if (p === "ios" || p === "android") return p;
      }
    } catch (e) {}
    return "web";
  }

  function getFirebaseUser() {
    try {
      if (G.SMD_AUTH && G.SMD_AUTH.currentUser) return G.SMD_AUTH.currentUser;
      if (G.firebase && G.firebase.auth) {
        var a = G.firebase.auth();
        if (a && a.currentUser) return a.currentUser;
      }
    } catch (e) {}
    return null;
  }

  function getIdToken(user) {
    if (!user || typeof user.getIdToken !== "function") {
      return Promise.reject(new Error("Sign-in required"));
    }
    return user.getIdToken();
  }

  function startStatsMonitor() {
    if (state.statsInterval) clearInterval(state.statsInterval);
    state.prevSent = state.sentCount;
    state.prevRecv = state.recvCount;
    state.statsInterval = setInterval(function () {
      state.sentPerSec = state.sentCount - state.prevSent;
      state.recvPerSec = state.recvCount - state.prevRecv;
      state.prevSent = state.sentCount;
      state.prevRecv = state.recvCount;
    }, 1000);
  }

  function stopStatsMonitor() {
    if (state.statsInterval) {
      clearInterval(state.statsInterval);
      state.statsInterval = null;
    }
    state.sentPerSec = 0;
    state.recvPerSec = 0;
  }

  function cleanupSocket(reason) {
    stopStatsMonitor();
    if (state.ws) {
      var ws = state.ws;
      state.ws = null;
      state.role = null;
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === 0 || ws.readyState === 1) {
          ws.close(1000, reason || "closed");
        }
      } catch (e) {}
    }
  }

  function connectSocket(wsUrl, protocols, handlers, role) {
    return new Promise(function (resolve, reject) {
      cleanupSocket("new connection");

      var settled = false;
      var WSConstructor = G.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null);
      if (!WSConstructor) {
        return reject(new Error("WebSocket not supported"));
      }

      var ws;
      try {
        ws = new WSConstructor(wsUrl, protocols);
      } catch (e) {
        return reject(e);
      }

      ws.binaryType = "arraybuffer";
      state.ws = ws;
      state.role = role;
      state.sentCount = 0;
      state.recvCount = 0;
      state.lastRecvAt = 0;
      state.lastSentAt = 0;

      ws.onopen = function () {
        if (!settled) {
          settled = true;
          startStatsMonitor();
          if (handlers && typeof handlers.onPeerConnected === "function") {
            try {
              handlers.onPeerConnected({ role: role, transport: "relay" });
            } catch (e) {}
          }
          resolve();
        }
      };

      ws.onmessage = function (e) {
        state.recvCount++;
        state.lastRecvAt = Date.now();
        if (handlers && typeof handlers.onBytes === "function") {
          var bytes;
          if (e.data instanceof Uint8Array) {
            bytes = e.data;
          } else if (e.data instanceof ArrayBuffer) {
            bytes = new Uint8Array(e.data);
          } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(e.data)) {
            bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.length);
          } else if (e.data && typeof e.data.byteLength === "number") {
            bytes = new Uint8Array(e.data);
          }
          if (bytes) {
            try {
              handlers.onBytes(bytes);
            } catch (err) {}
          }
        }
      };

      ws.onerror = function (e) {
        if (!settled) {
          settled = true;
          cleanupSocket("connect error");
          reject(new Error("WebSocket connection error"));
        } else if (handlers && typeof handlers.onError === "function") {
          try {
            handlers.onError(e);
          } catch (err) {}
        }
      };

      ws.onclose = function (e) {
        var reason = (e && e.reason) || "closed";
        if (!settled) {
          settled = true;
          cleanupSocket(reason);
          reject(new Error("WebSocket closed before open: " + reason));
        } else {
          cleanupSocket(reason);
          if (handlers && typeof handlers.onPeerLost === "function") {
            try {
              handlers.onPeerLost(reason);
            } catch (err) {}
          }
        }
      };
    });
  }

  var transport = {
    id: "relay",
    kind: "relay",

    capabilities: function () {
      var isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
      if (!isOnline) {
        return Promise.resolve({
          available: false,
          reason: "Internet connection required",
          canAdvertise: false,
          canScan: false,
          needsInternet: true,
          maxPayload: 128,
          platform: getPlatform(),
        });
      }

      var user = getFirebaseUser();
      if (!user) {
        return Promise.resolve({
          available: false,
          reason: "Sign-in required",
          canAdvertise: false,
          canScan: false,
          needsInternet: true,
          maxPayload: 128,
          platform: getPlatform(),
        });
      }

      return Promise.resolve({
        available: true,
        canAdvertise: true,
        canScan: true,
        needsInternet: true,
        maxPayload: 128,
        platform: getPlatform(),
      });
    },

    // Display side hosts: creates room via POST /sync/session then opens display socket
    host: function (pairing, handlers) {
      if (!pairing || typeof pairing !== "object") {
        return Promise.reject(new Error("Invalid pairing payload"));
      }
      var user = getFirebaseUser();
      if (!user) {
        return Promise.reject(new Error("Sign-in required"));
      }

      var httpUrl = getHttpUrl() + "/sync/session";
      return getIdToken(user).then(function (token) {
        var fetchFn = G.fetch || (typeof fetch !== "undefined" ? fetch : null);
        if (!fetchFn) {
          return Promise.reject(new Error("Fetch API unavailable"));
        }
        // Register the short code shown on screen so a probe can find
        // this room by typing the code (no Bluetooth needed). Older
        // servers ignore the extra body and the relay still works.
        var codeBody = null;
        if (pairing && pairing.shortCode && pairing.sessionId && pairing.displayPub) {
          codeBody = {
            shortCode: pairing.shortCode,
            sessionId: pairing.sessionId,
            displayPub: pairing.displayPub,
          };
        }
        return fetchFn(httpUrl, {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: codeBody ? JSON.stringify(codeBody) : undefined,
        }).then(function (res) {
          if (!res.ok) {
            return res.text().then(function (txt) {
              throw new Error("Relay session creation failed (" + res.status + "): " + txt);
            });
          }
          return res.json();
        }).then(function (data) {
          if (!data || !data.roomId || !data.roomToken) {
            throw new Error("Invalid session response from relay");
          }
          // Attach relay credentials to pairing for QR / BLE payload sharing
          pairing.relay = {
            roomId: data.roomId,
            roomToken: data.roomToken,
            expiresAt: data.expiresAt,
          };
          pairing.roomId = data.roomId;
          pairing.roomToken = data.roomToken;

          var wsUrl = getWsUrl() + "/sync/room?id=" + encodeURIComponent(data.roomId) + "&role=display";
          var protocols = ["kardia-sync", token, data.roomToken];
          return connectSocket(wsUrl, protocols, handlers, "display");
        });
      });
    },

    // Probe side joins: opens probe socket using roomId and roomToken from pairing
    join: function (pairing, handlers) {
      if (!pairing || typeof pairing !== "object") {
        return Promise.reject(new Error("Invalid pairing payload"));
      }
      var roomId = (pairing.relay && pairing.relay.roomId) || pairing.roomId;
      var roomToken = (pairing.relay && pairing.relay.roomToken) || pairing.roomToken;
      if (!roomId || !roomToken) {
        return Promise.reject(new Error("Missing relay room details in pairing payload"));
      }

      var user = getFirebaseUser();
      if (!user) {
        return Promise.reject(new Error("Sign-in required"));
      }

      return getIdToken(user).then(function (token) {
        var wsUrl = getWsUrl() + "/sync/room?id=" + encodeURIComponent(roomId) + "&role=probe";
        var protocols = ["kardia-sync", token, roomToken];
        return connectSocket(wsUrl, protocols, handlers, "probe");
      });
    },

    // Probe typed-code lookup: resolve the 6-character code shown on the
    // display to the room join material. Authenticated, rate limited and
    // single use server side; unknown, expired and used codes all read
    // as not-found. Rejects fast when signed out so the typed-code race
    // can fall through to Bluetooth.
    resolveCode: function (shortCode) {
      var code = String(shortCode == null ? "" : shortCode).toUpperCase().replace(/[^A-Z2-9]/g, "");
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        var bad = new Error("No display found for that code.");
        bad.reason = "not-found";
        bad.code = "not-found";
        return Promise.reject(bad);
      }

      var user = getFirebaseUser();
      if (!user) {
        var auth = new Error("Sign-in required");
        auth.reason = "sign-in-required";
        auth.code = "sign-in-required";
        return Promise.reject(auth);
      }

      return getIdToken(user).then(function (token) {
        var fetchFn = G.fetch || (typeof fetch !== "undefined" ? fetch : null);
        if (!fetchFn) {
          return Promise.reject(new Error("Fetch API unavailable"));
        }
        var settled = new Promise(function (resolve, reject) {
          var timer = null;
          function done(fn, v) {
            if (timer) {
              try { clearTimeout(timer); } catch (e) {}
              timer = null;
            }
            fn(v);
          }
          try {
            timer = setTimeout(function () {
              timer = null;
              var t = new Error("Relay code lookup timed out.");
              t.reason = "offline";
              t.code = "offline";
              reject(t);
            }, 15000);
            if (timer && timer.unref) timer.unref();
          } catch (e) {}
          fetchFn(getHttpUrl() + "/sync/code", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: code }),
          }).then(function (res) {
            if (res.status === 404) {
              var nf = new Error("No display found for that code.");
              nf.reason = "not-found";
              nf.code = "not-found";
              throw nf;
            }
            if (res.status === 401) {
              var se = new Error("Sign-in required");
              se.reason = "sign-in-required";
              se.code = "sign-in-required";
              throw se;
            }
            if (res.status === 429) {
              var rl = new Error("Too many code tries. Wait a minute and try again.");
              rl.reason = "rate-limited";
              rl.code = "rate-limited";
              try { var ra = parseInt(res.headers.get("Retry-After"), 10); if (isFinite(ra)) rl.retryAfterMs = ra * 1000; } catch (e2) {}
              throw rl;
            }
            if (!res.ok) {
              return res.text().then(function (txt) {
                throw new Error("Code lookup failed (" + res.status + "): " + txt);
              });
            }
            return res.json();
          }).then(function (data) {
            if (!data || !data.roomId || !data.roomToken || !data.sessionId || !data.displayPub || !data.expiresAt) {
              throw new Error("Invalid code lookup response from relay");
            }
            done(resolve, {
              sessionId: String(data.sessionId).toLowerCase(),
              displayPub: data.displayPub,
              shortCode: data.shortCode || code,
              expiresAt: +data.expiresAt,
              roomId: String(data.roomId).toLowerCase(),
              roomToken: data.roomToken,
              relay: { roomId: String(data.roomId).toLowerCase(), roomToken: data.roomToken },
            });
          }, function (err) {
            done(reject, err);
          });
        });
        return settled;
      });
    },

    send: function (bytes) {
      if (!state.ws || state.ws.readyState !== 1) {
        return false;
      }
      // Drop if backpressured
      if (typeof state.ws.bufferedAmount === "number" && state.ws.bufferedAmount > 4096) {
        return false;
      }
      try {
        state.ws.send(bytes);
        state.sentCount++;
        state.lastSentAt = Date.now();
        return true;
      } catch (e) {
        return false;
      }
    },

    close: function (reason) {
      cleanupSocket(reason || "client closed");
      return Promise.resolve();
    },

    stats: function () {
      return {
        rttMs: state.rttMs,
        lossPct: state.lossPct,
        sentPerSec: state.sentPerSec,
        recvPerSec: state.recvPerSec,
        lastRecvAt: state.lastRecvAt,
      };
    },
  };

  // Register with KARDIA_SYNC
  G.KARDIA_SYNC_RELAY = transport;
  if (G.KARDIA_SYNC && typeof G.KARDIA_SYNC.registerTransport === "function") {
    G.KARDIA_SYNC.registerTransport(transport);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = transport;
  }
})(typeof window !== "undefined" ? window : globalThis);
