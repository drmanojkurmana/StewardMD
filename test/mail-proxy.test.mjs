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
const { onRequest, replyThreading, textToHtml, summarise, _resetMailCache, b64Bytes, checkSchedule, htmlToText } = mod;

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
    if (key === "POST /api/v1/send") return J(call.body.scheduledAt ? { messageId: "msg_sent", scheduled: true } : { messageId: "msg_sent" });
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

/* ---- 2026-10-03 mail-pro: the iPad action row, rich compose, attachments, forward, schedule ---- */

const sentBody = () => calls.find((c) => c.url.pathname === "/api/v1/send").body;
const b64 = (n) => Buffer.alloc(n, 7).toString("base64");

test("update: the PATCH sent upstream is exactly Mailflare's contract (method, path, field names, values)", async () => {
  for (const [body, want] of [
    [{ starred: true }, { starred: true }],
    [{ starred: false }, { starred: false }],
    [{ read: false }, { read: false }],
    [{ status: "archived" }, { status: "archived" }],
    [{ status: "trash" }, { status: "trash" }],
    [{ status: "spam" }, { status: "spam" }],
    [{ status: "received" }, { status: "received" }],
  ]) {
    installUpstream();
    const r = await call("POST", "message/msg_1", { body });
    assert.equal(r.status, 200, JSON.stringify(body));
    const patch = calls.find((c) => c.method === "PATCH");
    assert.equal(patch.url.pathname, "/api/v1/messages/msg_1");
    assert.equal(patch.headers["Content-Type"], "application/json");
    assert.deepEqual(patch.body, want);
    // Mailflare's V1_MESSAGE_STATUSES: received, archived, trash, spam. Nothing else may be sent.
    if (want.status) assert.ok(["received", "archived", "trash", "spam"].includes(want.status));
    const out = await r.json();
    assert.equal(out.message.id, "msg_1");
  }
  // a string "true" (what a lossy bridge could send) is refused, not silently dropped into a no-op
  installUpstream();
  assert.equal((await call("POST", "message/msg_1", { body: { starred: "true" } })).status, 400);
});

test("bug 1: Mailflare refusing a move (403, key may read but not manage) reaches the app as mail-permission, never as the owner's 403", async () => {
  installUpstream({ "PATCH /api/v1/messages/msg_1": () => new Response(JSON.stringify({ error: "You do not have permission to manage this mailbox" }), { status: 403 }) });
  const r = await call("POST", "message/msg_1", { body: { status: "archived" } });
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: "mail-permission" });
  installUpstream({ "PATCH /api/v1/messages/msg_1": () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) });
  const k = await call("POST", "message/msg_1", { body: { starred: true } });
  assert.equal(k.status, 502);
  assert.deepEqual(await k.json(), { error: "mail-key-rejected" });
});

test("list: the Scheduled folder is Mailflare's outbound queued mail", async () => {
  installUpstream();
  await call("GET", "list?folder=scheduled");
  const q = calls.find((c) => c.url.pathname === "/api/v1/messages").url.searchParams;
  assert.equal(q.get("status"), "queued");
  assert.equal(q.get("direction"), "outbound");
});

test("send: rich html and its plain-text alternative pass through untouched; html-only gets a text part", async () => {
  installUpstream();
  const html = '<div><b>Hello</b> <font color="#d92d20">there</font></div><ul><li>one</li></ul>';
  assert.equal((await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "Hello there\n- one", html } })).status, 200);
  assert.equal(sentBody().html, html);
  assert.equal(sentBody().text, "Hello there\n- one");
  installUpstream();
  assert.equal((await call("POST", "send", { body: { to: "a@x.com", subject: "s", html: "<p>Hi <b>you</b></p><p>Bye &amp; thanks</p>" } })).status, 200);
  assert.equal(sentBody().text, "Hi you\nBye & thanks");
  installUpstream();
  assert.equal((await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "x", html: "y".repeat(2 * 1024 * 1024 + 1) } })).status, 413);
  assert.equal(calls.filter((c) => c.url.pathname === "/api/v1/send").length, 0);
});

test("send: attachments pass through with Mailflare's limits enforced before anything goes upstream", async () => {
  installUpstream();
  const ok = await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "see file", attachments: [{ filename: "../scan\u0000.pdf", type: "application/pdf", contentBase64: b64(1000) }, { filename: "photo.jpg", type: "bogus type", contentBase64: b64(10) }] } });
  assert.equal(ok.status, 200);
  const files = sentBody().attachments;
  assert.equal(files.length, 2);
  assert.equal(files[0].filename, ".._scan_.pdf");
  assert.equal(files[0].type, "application/pdf");
  assert.equal(files[0].contentBase64, b64(1000));
  assert.equal(files[1].type, "application/octet-stream");
  assert.deepEqual(Object.keys(files[0]).sort(), ["contentBase64", "filename", "type"]);

  // an attachment alone is a valid message
  installUpstream();
  assert.equal((await call("POST", "send", { body: { to: "a@x.com", subject: "s", attachments: [{ filename: "a.txt", contentBase64: b64(3) }] } })).status, 200);

  const cases = [
    [{ attachments: Array.from({ length: 11 }, (_, i) => ({ filename: i + ".txt", contentBase64: b64(3) })) }, 413, "too-many-attachments"],
    [{ attachments: [{ filename: "big.bin", contentBase64: b64(10 * 1024 * 1024 + 3) }] }, 413, "attachment-file-too-large"],
    [{ attachments: [0, 1, 2].map((i) => ({ filename: i + ".bin", contentBase64: b64(7 * 1024 * 1024) })) }, 413, "attachments-too-large"],
    [{ attachments: [{ filename: "x", contentBase64: "not base64!" }] }, 400, "bad-attachment"],
    [{ attachments: "nope" }, 400, "bad-attachment"],
  ];
  for (const [extra, status, error] of cases) {
    installUpstream();
    const r = await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "t", ...extra } });
    assert.equal(r.status, status, error);
    assert.equal((await r.json()).error, error);
    assert.equal(calls.filter((c) => c.url.pathname === "/api/v1/send").length, 0, error);
  }
  assert.equal(b64Bytes(b64(10)), 10);
  assert.equal(b64Bytes(b64(11)), 11);
});

test("send: forward copies the original's attachments server side, only from this mailbox", async () => {
  installUpstream();
  const r = await call("POST", "send", { body: { to: "z@x.com", subject: "Fwd: Hello", text: "fyi", forwardId: "msg_1", forwardAttachmentIds: ["att_1"] } });
  assert.equal(r.status, 200);
  const f = sentBody().attachments;
  assert.deepEqual(f, [{ filename: "a.pdf", type: "application/pdf", contentBase64: "AQL/" }]);
  assert.ok(calls.some((c) => c.url.pathname === "/api/v1/messages/msg_1/attachments/att_1"));
  assert.equal(sentBody().inReplyTo, undefined, "a forward is not threaded as a reply");

  installUpstream();
  assert.equal((await call("POST", "send", { body: { to: "z@x.com", subject: "s", text: "t", forwardId: "msg_1", forwardAttachmentIds: ["att_nope"] } })).status, 404);
  installUpstream();
  assert.equal((await call("POST", "send", { body: { to: "z@x.com", subject: "s", text: "t", forwardId: "msg_other", forwardAttachmentIds: ["att_1"] } })).status, 404);
  installUpstream();
  assert.equal((await call("POST", "send", { body: { to: "z@x.com", subject: "s", text: "t", forwardId: "../x", forwardAttachmentIds: ["att_1"] } })).status, 400);
  assert.equal(calls.filter((c) => c.url.pathname === "/api/v1/send").length, 0);

  // forwarded files count toward the limits before they are downloaded
  installUpstream({ "GET /api/v1/messages/msg_1": () => new Response(JSON.stringify({ message: MSG, attachments: [{ id: "att_1", filename: "huge.zip", type: "application/zip", size: 9 * 1024 * 1024 }] }), { status: 200 }) });
  const big = await call("POST", "send", { body: { to: "z@x.com", subject: "s", text: "t", forwardId: "msg_1", forwardAttachmentIds: ["att_1"], attachments: [{ filename: "b.bin", contentBase64: b64(6 * 1024 * 1024) }, { filename: "c.bin", contentBase64: b64(6 * 1024 * 1024) }] } });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error, "attachments-too-large");
  assert.ok(!calls.some((c) => c.url.pathname.includes("/attachments/")));
});

test("send: scheduledAt is validated and normalised to UTC ISO; the reply says it was scheduled", async () => {
  installUpstream();
  const when = new Date(Date.now() + 3 * 3600 * 1000);
  const local = when.toISOString().replace("Z", "+00:00");
  const r = await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "t", scheduledAt: local } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: "msg_sent", scheduled: true });
  assert.equal(sentBody().scheduledAt, when.toISOString());
  for (const [v, err] of [["yesterday", "bad-schedule"], [new Date(Date.now() - 1000).toISOString(), "schedule-in-past"], [new Date(Date.now() + 400 * 86400000).toISOString(), "schedule-too-far"]]) {
    installUpstream();
    const x = await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "t", scheduledAt: v } });
    assert.equal(x.status, 400, v);
    assert.equal((await x.json()).error, err);
    assert.equal(calls.filter((c) => c.url.pathname === "/api/v1/send").length, 0);
  }
  installUpstream();
  await call("POST", "send", { body: { to: "a@x.com", subject: "s", text: "t" } });
  assert.equal(sentBody().scheduledAt, undefined, "no schedule means send now");
  assert.deepEqual(checkSchedule("", 0), { at: null });
  assert.equal(htmlToText("<style>p{}</style><p>a</p>b<br>c"), "a\nb\nc");
});
