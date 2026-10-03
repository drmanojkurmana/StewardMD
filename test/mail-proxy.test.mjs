/* /api/mail/* - the owner-only Mailflare proxy behind the app's Mail screen.
 *
 * Firebase auth and the Mailflare upstream are mocked. What must hold: only owners get in; the API key
 * never leaves the server; every message route is pinned to the configured mailbox; folders map to the
 * right Mailflare filters; replies carry the parent's threading headers; MAIL_ON=0 hides the route.
 *
 * node --test --experimental-test-module-mocks test/mail-proxy.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLAIMS = {
  "tok-owner": { sub: "u-owner", email: "drmanojkurmana@gmail.com", email_verified: true },
  "tok-doc": { sub: "u-doc", email: "doc@example.com", email_verified: true },
  "tok-unverified-owner": { sub: "u-x", email: "drmanojkurmana@gmail.com", email_verified: false },
  "tok-college": { sub: "u-college", email: "stewardmd.in@gmail.com", email_verified: true },
  "tok-kd": { sub: "u-kd", email: "KDiwakar45@gmail.com", email_verified: true },
};
const realAuth = await import("../functions/_fbauth.js");
mock.module("../functions/_fbauth.js", { namedExports: { ...realAuth, verifiedClaimsFor: async (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null } });

const mod = await import("../functions/api/mail/[[path]].js");
const { onRequest, replyThreading, textToHtml, summarise, _resetMailCache } = mod;

const KEY = "ep_testkey_abcdefghijkl";
const ENV = { MAILFLARE_URL: "https://mail.maiknowledge.com", MAILFLARE_API_KEY: KEY };
const MB = "mbx_hello";

const MSG = {
  id: "msg_1", mailboxId: MB, fromAddr: "Ravi <ravi@example.net>", toAddr: "hello@maiknowledge.com", ccAddr: null, bccAddr: null,
  subject: "Hello", snippet: "Hi there", textBody: "Hi there", htmlBody: "<p>Hi there</p>", read: false, starred: false,
  status: "received", direction: "inbound", threadId: "root@x", providerMessageId: "<p1@example.net>", references: "<root@x>",
  createdAt: "2026-10-01T10:00:00.000Z", fromContactName: "Ravi",
};
const OTHER = { ...MSG, id: "msg_other", mailboxId: "mbx_someone_else" };

let calls = [];
function installUpstream(overrides = {}) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const call = { url: u, method: (init.method || "GET").toUpperCase(), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const key = call.method + " " + u.pathname;
    if (overrides[key]) return overrides[key](call);
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
    if (call.headers.Authorization !== "Bearer " + KEY) return J({ error: "Unauthorized" }, 401);
    if (key === "GET /api/v1/mailboxes") return J({ mailboxes: [{ id: "mbx_other", address: "other@maiknowledge.com" }, { id: MB, address: "Hello@MaiKnowledge.com" }] });
    if (key === "GET /api/v1/messages") return J({ messages: [MSG], total: 1, unread: 3, limit: 50, offset: 0 });
    if (key === "GET /api/v1/messages/msg_1") return J({ message: MSG, attachments: [{ id: "att_1", messageId: "msg_1", filename: "a.pdf", type: "application/pdf", size: 3, disposition: "attachment" }] });
    if (key === "GET /api/v1/messages/msg_other") return J({ message: OTHER, attachments: [] });
    if (key === "PATCH /api/v1/messages/msg_1") return J({ message: { ...MSG, ...call.body } });
    if (key === "GET /api/v1/messages/msg_1/attachments/att_1") return new Response(new Uint8Array([1, 2, 255]), { status: 200 });
    if (key === "POST /api/v1/send") return J({ messageId: "msg_sent" });
    return J({ error: "Not found" }, 404);
  };
}

function call(method, path, { token = "tok-owner", body, env = ENV } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://stewardmd.in/api/mail/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const segs = path.split("?")[0].split("/").filter(Boolean);
  return onRequest({ request: req, env, params: { path: segs } });
}

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; _resetMailCache(); });

test("only verified owners get in; nobody else reaches the upstream", async () => {
  installUpstream();
  for (const token of [null, "tok-doc", "tok-unverified-owner", "garbage"]) {
    const r = await call("GET", "list", { token });
    assert.equal(r.status, 403, String(token));
  }
  assert.equal(calls.length, 0);
  const ok = await call("GET", "list");
  assert.equal(ok.status, 200);
});

test("Mail is for three accounts only: a platform owner added through OWNER_EMAILS is still refused", async () => {
  installUpstream();
  // Production's wrangler.toml lists stewardmd.in@gmail.com in OWNER_EMAILS, so ownerOK lets it in.
  const env = { ...ENV, OWNER_EMAILS: "drmanojkurmana@gmail.com,mkkmanojkumar0@gmail.com,kdiwakar45@gmail.com,stewardmd.in@gmail.com" };
  for (const path of ["status", "list", "message/msg_1"]) {
    const r = await call("GET", path, { token: "tok-college", env });
    assert.equal(r.status, 403, path);
  }
  const sent = await call("POST", "send", { token: "tok-college", env, body: { to: "x@example.com", subject: "s", text: "t" } });
  assert.equal(sent.status, 403);
  assert.equal(calls.length, 0, "the college account never reaches Mailflare");
  // The three Mail accounts still get in, case-insensitively.
  assert.equal((await call("GET", "list", { token: "tok-owner", env })).status, 200);
  assert.equal((await call("GET", "list", { token: "tok-kd", env })).status, 200);
});

test("MAIL_ON=0 hides the route, even from owners", async () => {
  installUpstream();
  const r = await call("GET", "status", { env: { ...ENV, MAIL_ON: "0" } });
  assert.equal(r.status, 404);
  assert.equal(calls.length, 0);
});

test("status: unconfigured is reported, not an error; configured gives the unread count", async () => {
  installUpstream();
  const none = await (await call("GET", "status", { env: {} })).json();
  assert.deepEqual(none, { configured: false, address: "hello@maiknowledge.com" });
  const insecure = await (await call("GET", "status", { env: { ...ENV, MAILFLARE_URL: "http://mail.maiknowledge.com" } })).json();
  assert.equal(insecure.configured, false);
  const s = await (await call("GET", "status")).json();
  assert.deepEqual(s, { configured: true, address: "hello@maiknowledge.com", unread: 3 });
});

test("list: folder maps to Mailflare filters, scoped to the resolved mailbox; key is sent upstream only", async () => {
  installUpstream();
  const r = await call("GET", "list?folder=inbox&offset=50&unread=1");
  const body = await r.json();
  const up = calls.find((c) => c.url.pathname === "/api/v1/messages");
  const q = up.url.searchParams;
  assert.equal(q.get("mailboxId"), MB);
  assert.equal(q.get("status"), "received");
  assert.equal(q.get("direction"), "inbound");
  assert.equal(q.get("fields"), "summary");
  assert.equal(q.get("offset"), "50");
  assert.equal(q.get("read"), "unread");
  assert.equal(body.messages[0].id, "msg_1");
  assert.equal(body.messages[0].from, "Ravi <ravi@example.net>");
  assert.equal(body.unread, 3);
  assert.ok(!JSON.stringify(body).includes(KEY));
  assert.equal(up.headers.Authorization, "Bearer " + KEY);

  installUpstream();
  await call("GET", "list?folder=sent");
  const sent = calls.find((c) => c.url.pathname === "/api/v1/messages").url.searchParams;
  assert.equal(sent.get("status"), "sent");
  assert.equal(sent.get("direction"), "outbound");

  assert.equal((await call("GET", "list?folder=drafts")).status, 400);
});

test("mailbox id is cached across requests", async () => {
  installUpstream();
  await call("GET", "list");
  await call("GET", "list");
  assert.equal(calls.filter((c) => c.url.pathname === "/api/v1/mailboxes").length, 1);
});

test("message: bodies + attachments for the mailbox; another mailbox's message is 404", async () => {
  installUpstream();
  const body = await (await call("GET", "message/msg_1")).json();
  assert.equal(body.message.htmlBody, "<p>Hi there</p>");
  assert.equal(body.message.fromName, "Ravi");
  assert.equal(body.attachments[0].filename, "a.pdf");
  assert.equal((await call("GET", "message/msg_other")).status, 404);
  assert.equal((await call("GET", "message/..%2Fmailboxes")).status, 404);
});

test("update: read/star/status pass through; bad status refused; other mailbox never patched", async () => {
  installUpstream();
  const r = await call("POST", "message/msg_1", { body: { read: true, status: "archived", junk: 1 } });
  assert.equal(r.status, 200);
  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(patch.body, { read: true, status: "archived" });
  assert.equal((await call("POST", "message/msg_1", { body: { status: "sent" } })).status, 400);
  assert.equal((await call("POST", "message/msg_1", { body: {} })).status, 400);
  installUpstream();
  assert.equal((await call("POST", "message/msg_other", { body: { read: true } })).status, 404);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});

test("attachment: returned as base64 JSON for the native transport", async () => {
  installUpstream();
  const body = await (await call("GET", "message/msg_1/attachment/att_1")).json();
  assert.deepEqual(body, { filename: "a.pdf", type: "application/pdf", size: 3, base64: "AQL/" });
  assert.equal((await call("GET", "message/msg_1/attachment/att_nope")).status, 404);
});

test("send: from is pinned to the mailbox; reply threads under the parent", async () => {
  installUpstream();
  const r = await call("POST", "send", { body: { to: "a@x.com, b@y.com", subject: "Re: Hello", text: "Thanks\n\nRavi", from: "evil@x.com", mailboxId: "mbx_other", replyToId: "msg_1" } });
  assert.equal(r.status, 200);
  const sent = calls.find((c) => c.url.pathname === "/api/v1/send").body;
  assert.equal(sent.from, "hello@maiknowledge.com");
  assert.equal(sent.mailboxId, MB);
  assert.deepEqual(sent.to, ["a@x.com", "b@y.com"]);
  assert.equal(sent.text, "Thanks\n\nRavi");
  assert.equal(sent.html, "<div>Thanks</div><div><br></div><div>Ravi</div>");
  assert.equal(sent.inReplyTo, "p1@example.net");
  assert.equal(sent.references, "root@x p1@example.net");
  assert.equal(sent.threadId, "root@x");

  for (const bad of [{ subject: "s", text: "t" }, { to: "a@x.com", text: "t" }, { to: "a@x.com", subject: "s", text: "  " }]) {
    assert.equal((await call("POST", "send", { body: bad })).status, 400);
  }
  installUpstream();
  assert.equal((await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "t", replyToId: "msg_other" } })).status, 404);
  assert.equal(calls.filter((c) => c.url.pathname === "/api/v1/send").length, 0);
});

test("a rejected key is reported as such, not as the owner's 401", async () => {
  installUpstream({ "GET /api/v1/mailboxes": () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) });
  const s = await (await call("GET", "status")).json();
  assert.equal(s.configured, false);
  const r = await call("GET", "list");
  assert.equal(r.status, 502);
});

test("helpers: threading, html escaping, summary shape", () => {
  assert.deepEqual(replyThreading({ providerMessageId: "<a@b>", references: null, threadId: null }), { inReplyTo: "a@b", references: "a@b", threadId: "a@b" });
  assert.deepEqual(replyThreading({}), {});
  assert.equal(textToHtml("<b>&"), "<div>&lt;b&gt;&amp;</div>");
  assert.deepEqual(Object.keys(summarise(MSG)).sort(), ["cc", "createdAt", "direction", "from", "id", "read", "snippet", "starred", "status", "subject", "threadId", "to"]);
});
