/* /api/mail/* - owner-only proxy to the Mailflare mailbox (hello@maiknowledge.com).
 *
 * The app's Mail screen (mail.js) reads, files and sends mail for ONE configured mailbox through
 * Mailflare's API-key surface (/api/v1/*). The key never reaches the device: it lives in the Pages
 * secret MAILFLARE_API_KEY and every request here is gated by ownerOK (owner Google login).
 *
 * Config (Pages env / secrets):
 *   MAILFLARE_URL       e.g. https://mail.maiknowledge.com  (no trailing path)
 *   MAILFLARE_API_KEY   an ep_... key created at <MAILFLARE_URL>/api-keys (scopes read + send)
 *   MAILFLARE_MAILBOX   address to expose, default hello@maiknowledge.com
 *   MAIL_ON             "0" turns the whole route off (404), the server kill switch
 *
 * Routes (all owner-only):
 *   GET  /api/mail/status                         { configured, address, unread }
 *   GET  /api/mail/list?folder=&offset=&unread=1  { messages, total, unread, offset, limit }
 *   GET  /api/mail/message/:id                    { message, attachments }
 *   POST /api/mail/message/:id                    { read?, starred?, status? } -> { message }
 *   GET  /api/mail/message/:id/attachment/:aid    { filename, type, size, base64 }
 *   POST /api/mail/send                           { to, cc?, bcc?, subject, text, html?, replyToId? }
 *
 * Every message route checks the message belongs to the configured mailbox, so a key that can see
 * other mailboxes still only ever exposes this one. Mail content is never logged.
 */
import { ownerOK } from "../../_adminauth.js";
import { fetchWithTimeout } from "../../_fetch.js";

const DEFAULT_MAILBOX = "hello@maiknowledge.com";
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const FOLDERS = {
  inbox: { status: "received", direction: "inbound" },
  sent: { status: "sent", direction: "outbound" },
  archive: { status: "archived" },
  spam: { status: "spam" },
  trash: { status: "trash" },
};
const MOVE_TO = ["received", "archived", "trash", "spam"];
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function mailConfig(env) {
  const base = String((env && env.MAILFLARE_URL) || "").trim().replace(/\/+$/, "");
  const key = String((env && env.MAILFLARE_API_KEY) || "").trim();
  const address = String((env && env.MAILFLARE_MAILBOX) || DEFAULT_MAILBOX).trim().toLowerCase();
  const ok = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base) && key.length > 0;
  return { ok, base, key, address };
}

// Mailbox id per (base, address), cached for the isolate's life. A miss re-resolves next request.
const mailboxCache = new Map();
export function _resetMailCache() { mailboxCache.clear(); }

async function upstream(cfg, path, init = {}, ms = 15000) {
  const headers = Object.assign({ Authorization: "Bearer " + cfg.key, Accept: "application/json" }, init.headers || {});
  return fetchWithTimeout(cfg.base + path, Object.assign({}, init, { headers, redirect: "manual" }), ms);
}

async function upstreamJson(cfg, path, init) {
  let r;
  try { r = await upstream(cfg, path, init); } catch (e) { return { status: 502, body: { error: "mail-server-unreachable" } }; }
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  if (!r.ok) {
    const err = body && typeof body.error === "string" ? body.error : "mail-server-error";
    return { status: r.status === 401 ? 502 : r.status, body: { error: r.status === 401 ? "mail-key-rejected" : err } };
  }
  return { status: 200, body: body || {} };
}

async function mailboxId(cfg) {
  const ck = cfg.base + "|" + cfg.address;
  if (mailboxCache.has(ck)) return mailboxCache.get(ck);
  const r = await upstreamJson(cfg, "/api/v1/mailboxes");
  if (r.status !== 200) return null;
  const list = Array.isArray(r.body.mailboxes) ? r.body.mailboxes : [];
  const hit = list.find((m) => String(m.address || "").toLowerCase() === cfg.address);
  if (!hit || !ID_RE.test(String(hit.id))) return null;
  mailboxCache.set(ck, hit.id);
  return hit.id;
}

// The list row the app needs; bodies come from the message route.
export function summarise(m) {
  return {
    id: m.id,
    from: m.fromAddr || "",
    to: m.toAddr || "",
    cc: m.ccAddr || "",
    subject: m.subject || "",
    snippet: m.snippet || "",
    read: !!m.read,
    starred: !!m.starred,
    status: m.status || "",
    direction: m.direction || "",
    threadId: m.threadId || null,
    createdAt: m.createdAt || null,
  };
}

// Threading headers for a reply, the same rule Mailflare's own composer uses (getReplyThreading).
export function replyThreading(parent) {
  const parentId = String(parent.providerMessageId || "").trim().replace(/^<|>$/g, "") || null;
  const chain = String(parent.references || "").split(/\s+/).map((id) => id.replace(/^<|>$/g, "")).filter(Boolean);
  if (parentId && chain.indexOf(parentId) < 0) chain.push(parentId);
  const out = {};
  if (parentId) out.inReplyTo = parentId;
  if (chain.length) out.references = chain.join(" ");
  const threadId = parent.threadId || parentId;
  if (threadId) out.threadId = threadId;
  return out;
}

function recipients(v) {
  const list = Array.isArray(v) ? v : String(v || "").split(",");
  return list.map((s) => String(s).trim()).filter(Boolean).slice(0, 50);
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export function textToHtml(text) {
  return "<div>" + esc(text).split(/\r?\n/).map((l) => l || "<br>").join("</div><div>") + "</div>";
}

async function ownMessage(cfg, mbId, id) {
  const r = await upstreamJson(cfg, "/api/v1/messages/" + id);
  if (r.status !== 200) return r;
  if (!r.body.message || r.body.message.mailboxId !== mbId) return { status: 404, body: { error: "not-found" } };
  return r;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (env && env.MAIL_ON === "0") return json({ error: "not-found" }, 404);
  if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403);

  const cfg = mailConfig(env);
  const seg = [].concat((context.params && context.params.path) || []).map(String);
  const method = request.method.toUpperCase();
  const route = seg[0] || "";

  if (route === "status" && method === "GET") {
    if (!cfg.ok) return json({ configured: false, address: cfg.address });
    const mbId = await mailboxId(cfg);
    if (!mbId) return json({ configured: false, address: cfg.address, error: "mailbox-not-found" });
    const r = await upstreamJson(cfg, "/api/v1/messages?mailboxId=" + mbId + "&status=received&fields=summary&limit=1");
    if (r.status !== 200) return json(r.body, r.status);
    return json({ configured: true, address: cfg.address, unread: Number(r.body.unread) || 0 });
  }

  if (!cfg.ok) return json({ error: "not-configured" }, 503);
  const mbId = await mailboxId(cfg);
  if (!mbId) return json({ error: "mailbox-not-found" }, 502);

  if (route === "list" && method === "GET") {
    const q = new URL(request.url).searchParams;
    const folder = FOLDERS[q.get("folder") || "inbox"];
    if (!folder) return json({ error: "bad-folder" }, 400);
    const offset = Math.max(0, Math.min(100000, parseInt(q.get("offset") || "0", 10) || 0));
    let path = "/api/v1/messages?mailboxId=" + mbId + "&fields=summary&limit=50&offset=" + offset + "&status=" + folder.status;
    if (folder.direction) path += "&direction=" + folder.direction;
    if (q.get("unread") === "1") path += "&read=unread";
    const r = await upstreamJson(cfg, path);
    if (r.status !== 200) return json(r.body, r.status);
    const msgs = Array.isArray(r.body.messages) ? r.body.messages : [];
    return json({ messages: msgs.map(summarise), total: Number(r.body.total) || 0, unread: Number(r.body.unread) || 0, offset, limit: 50 });
  }

  if (route === "message" && ID_RE.test(seg[1] || "")) {
    const id = seg[1];
    if (seg.length === 2 && method === "GET") {
      const r = await ownMessage(cfg, mbId, id);
      if (r.status !== 200) return json(r.body, r.status);
      const m = r.body.message;
      return json({
        message: Object.assign(summarise(m), {
          bcc: m.bccAddr || "",
          textBody: m.textBody || "",
          htmlBody: m.htmlBody || "",
          fromName: m.fromContactName || null,
        }),
        attachments: (r.body.attachments || []).map((a) => ({ id: a.id, filename: a.filename, type: a.type, size: a.size, disposition: a.disposition, contentId: a.contentId || null })),
      });
    }
    if (seg.length === 2 && method === "POST") {
      let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
      const patch = {};
      if (typeof b.read === "boolean") patch.read = b.read;
      if (typeof b.starred === "boolean") patch.starred = b.starred;
      if (b.status !== undefined) {
        if (MOVE_TO.indexOf(b.status) < 0) return json({ error: "bad-status" }, 400);
        patch.status = b.status;
      }
      if (!Object.keys(patch).length) return json({ error: "no-changes" }, 400);
      const own = await ownMessage(cfg, mbId, id);
      if (own.status !== 200) return json(own.body, own.status);
      const r = await upstreamJson(cfg, "/api/v1/messages/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (r.status !== 200) return json(r.body, r.status);
      return json({ message: r.body.message ? summarise(r.body.message) : null });
    }
    if (seg.length === 4 && seg[2] === "attachment" && ID_RE.test(seg[3]) && method === "GET") {
      const own = await ownMessage(cfg, mbId, id);
      if (own.status !== 200) return json(own.body, own.status);
      const meta = (own.body.attachments || []).find((a) => a.id === seg[3]);
      if (!meta) return json({ error: "not-found" }, 404);
      if (Number(meta.size) > MAX_ATTACHMENT_BYTES) return json({ error: "attachment-too-large" }, 413);
      let r;
      try { r = await upstream(cfg, "/api/v1/messages/" + id + "/attachments/" + seg[3], {}, 30000); } catch (e) { return json({ error: "mail-server-unreachable" }, 502); }
      if (!r.ok) return json({ error: "attachment-unavailable" }, r.status === 404 ? 404 : 502);
      // JSON + base64 because the native app reads /api/* through CapacitorHttp as text.
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return json({ filename: meta.filename || "attachment", type: meta.type || "application/octet-stream", size: bytes.length, base64: btoa(bin) });
    }
  }

  if (route === "send" && method === "POST") {
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const to = recipients(b.to), cc = recipients(b.cc), bcc = recipients(b.bcc);
    const subject = String(b.subject || "").trim().slice(0, 500);
    const text = String(b.text || "");
    if (!to.length) return json({ error: "to-required" }, 400);
    if (!subject) return json({ error: "subject-required" }, 400);
    if (!text.trim()) return json({ error: "body-required" }, 400);
    if (text.length > MAX_TEXT) return json({ error: "body-too-large" }, 413);
    const payload = { from: cfg.address, mailboxId: mbId, to, subject, text, html: textToHtml(text) };
    if (cc.length) payload.cc = cc;
    if (bcc.length) payload.bcc = bcc;
    if (b.replyToId !== undefined && b.replyToId !== null && b.replyToId !== "") {
      if (!ID_RE.test(String(b.replyToId))) return json({ error: "bad-reply" }, 400);
      const parent = await ownMessage(cfg, mbId, String(b.replyToId));
      if (parent.status !== 200) return json(parent.body, parent.status);
      Object.assign(payload, replyThreading(parent.body.message));
    }
    const r = await upstreamJson(cfg, "/api/v1/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (r.status !== 200) return json(r.body, r.status);
    return json({ ok: true, id: r.body.messageId || null });
  }

  return json({ error: "not-found" }, 404);
}
