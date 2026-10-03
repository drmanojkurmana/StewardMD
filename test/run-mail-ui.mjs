/* Owner Mail screen (mail.js) in real headless browsers, against a mocked /api/mail.
 *
 * Runs in Chromium AND WebKit (the iOS engine), at phone size (390x844) and iPad size (1024x1366),
 * with touch taps. Verifies:
 *   - owner-only entry; inbox, unread count, sandbox (mail scripts never run), mark-read
 *   - bug 1: every message action works by tap at both sizes, shows its result at once, rolls back with
 *     a plain message on failure, and a quick double tap on star cannot leave the star showing the
 *     opposite of what the server stored
 *   - bug 2: the message scrolls as ONE page (the frame takes no touches and always fits its content,
 *     even content that grows after load), wide mail fits the width, and links in the mail still open
 *     (WebKit never runs listeners inside a script-less sandbox, so they must be handled outside it)
 *   - compose: rich text produces the right html + plain text, attach/remove with limits, Bcc, forward
 *     with the original's files, send later, drafts, signature; search; refresh; live arrival; dark mode
 *
 * USAGE: node test/run-mail-ui.mjs
 *   PLAYWRIGHT=<path to playwright>   (else the global install)
 *   ENGINES=chromium,webkit           (default both)   SHOTS=<dir> saves screenshots
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const require = createRequire(import.meta.url);
let pw;
try { pw = require(process.env.PLAYWRIGHT || "playwright"); } catch (e) { pw = require(join(execSync("npm root -g").toString().trim(), "playwright")); }
const OUT = process.env.SHOTS || "";
if (OUT) mkdirSync(OUT, { recursive: true });
const ENGINES = (process.env.ENGINES || "chromium,webkit").split(",");

let fails = 0, tag = "";
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + tag + m); if (!c) fails++; };
async function section(name, fn) {
  try { await fn(); } catch (e) { ok(false, name + " threw: " + String(e && e.message || e).split("\n")[0]); }
}

const MAILJS = readFileSync(process.env.MAILJS || join(ROOT, "mail.js"), "utf8");
const HARNESS = (email) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>
<script>
window.__toasts=[]; window.toast=function(m){window.__toasts.push(m)};
window.__opened=[]; window.open=function(u){window.__opened.push(u)};
window.SMD_AUTH={currentUser:{email:${JSON.stringify(email)},getIdToken:function(){return Promise.resolve("tok-"+${JSON.stringify(email)})}}};
</script><script>${MAILJS}</script></body></html>`;

const LONG_HTML = '<style>@keyframes mmg{to{height:1400px}}#grow{height:10px;background:#eef;animation:mmg .05s linear 1.6s forwards}</style>' +
  '<p>Your account will expire soon. <a id="lnk" href="https://example.net/renew">Renew now</a></p>' +
  '<div id="wide" style="width:900px;min-width:900px;background:#f4f4f4">A wide newsletter block that is 900 pixels across.</div>' +
  Array.from({ length: 30 }, (_, i) => "<p>Paragraph " + i + " of a long message that needs the page to scroll.</p>").join("") +
  '<div id="grow"></div><p id="end">End of mail</p>';

function mailbox() {
  const now = Date.now();
  return {
    configured: true, patchDelay: 0, failNext: null,
    msgs: [
      { id: "msg_a", from: "Ravi Kumar <ravi@example.net>", to: "hello@maiknowledge.com", cc: "", subject: "Partnership query", snippet: "Hello team, we would like to", read: false, starred: false, status: "received", direction: "inbound", createdAt: new Date(now).toISOString(),
        htmlBody: '<p id="body">Hello team, we would like to <a href="https://example.net/x">discuss</a>.</p><script>parent.__pwned=1;window.__pwned=1</script><img src="https://example.net/t.png" onerror="parent.__pwned=2">',
        textBody: "Hello team, we would like to discuss.", attachments: [{ id: "att_1", filename: "brochure.pdf", type: "application/pdf", size: 2048, disposition: "attachment" }] },
      { id: "msg_b", from: "noreply@example.org", to: "hello@maiknowledge.com", cc: "", subject: "Your receipt", snippet: "Thanks for your order", read: true, starred: false, status: "received", direction: "inbound", createdAt: "2026-09-20T09:00:00.000Z", htmlBody: "", textBody: "Thanks for your order" },
      { id: "msg_z", from: "Zoho Store <n@zohostore.in>", to: "hello@maiknowledge.com", cc: "", subject: "Subscription renewal", snippet: "Your account will expire", read: true, starred: false, status: "received", direction: "inbound", createdAt: "2026-09-19T09:00:00.000Z", htmlBody: LONG_HTML, textBody: "" },
      { id: "msg_c", from: "Asha <asha@example.com>", to: "hello@maiknowledge.com, sam@example.com", cc: "lee@example.com", subject: "Group thread", snippet: "Hi all", read: true, starred: false, status: "received", direction: "inbound", createdAt: "2026-09-18T09:00:00.000Z", htmlBody: "", textBody: "Hi all" },
    ],
    calls: [],
  };
}

async function newContext(browser, engine, size, MBref) {
  const vp = size === "ipad" ? { width: 1024, height: 1366 } : { width: 390, height: 844 };
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route("http://smd.test/**", async (route) => {
    const MB = MBref.mb;
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === "/" || u.pathname === "/owner") return route.fulfill({ contentType: "text/html", body: HARNESS("drmanojkurmana@gmail.com") });
    if (u.pathname === "/doc") return route.fulfill({ contentType: "text/html", body: HARNESS("doc@example.com") });
    const J = (o, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(o) });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    MB.calls.push({ method: req.method(), path: u.pathname + u.search, body, auth: req.headers()["authorization"] });
    if (req.headers()["authorization"] !== "Bearer tok-drmanojkurmana@gmail.com") return J({ error: "forbidden" }, 403);
    const p = u.pathname.replace(/^\/api\/mail/, "");
    const unread = MB.msgs.filter((m) => m.status === "received" && !m.read).length;
    if (p === "/status") return J(MB.configured ? { configured: true, address: "hello@maiknowledge.com", unread } : { configured: false, address: "hello@maiknowledge.com" });
    if (p === "/list") {
      const f = u.searchParams.get("folder");
      const stt = { inbox: "received", sent: "sent", archive: "archived", spam: "spam", trash: "trash", scheduled: "queued" }[f];
      const rows = MB.msgs.filter((m) => m.status === stt).map(({ htmlBody, textBody, attachments, ...r }) => r);
      return J({ messages: rows, total: rows.length, unread, offset: 0, limit: 50 });
    }
    const m = p.match(/^\/message\/([\w-]+)$/);
    if (m) {
      const msg = MB.msgs.find((x) => x.id === m[1]);
      if (!msg) return J({ error: "not-found" }, 404);
      if (req.method() === "GET") return J({ message: { ...msg, attachments: undefined }, attachments: msg.attachments || [] });
      if (MB.patchDelay) await new Promise((r) => setTimeout(r, MB.patchDelay));
      if (MB.failNext) { const f = MB.failNext; MB.failNext = null; return J({ error: f.error }, f.status); }
      Object.assign(msg, body);
      return J({ message: msg });
    }
    if (p === "/send") {
      const id = "msg_s" + MB.msgs.length;
      MB.msgs.push({ id, from: "hello@maiknowledge.com", to: body.to, cc: body.cc || "", subject: body.subject, snippet: String(body.text).slice(0, 40), read: true, starred: false, status: body.scheduledAt ? "queued" : "sent", direction: "outbound", createdAt: new Date().toISOString(), textBody: body.text, htmlBody: body.html });
      return J({ ok: true, id, scheduled: !!body.scheduledAt });
    }
    return J({ error: "not-found" }, 404);
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept(page.__prompt || "example.org"));
  return { ctx, page, errors };
}

const toasts = (page) => page.evaluate(() => window.__toasts.slice());
const lastToast = async (page) => (await toasts(page)).slice(-1)[0];
const shot = async (page, name) => { if (OUT) { await page.waitForTimeout(350); await page.screenshot({ path: join(OUT, name.replace(/^-+/, "") + ".png") }); } };
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none"; }, sel);
const settle = (page, ms = 150) => page.waitForTimeout(ms);

async function openMail(page) {
  await page.goto("http://smd.test/owner");
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} SMD_MAIL.open(); });
  await page.waitForSelector("#smdMail .mm-row");
}
async function openMsg(page, id) {
  await page.tap(`#smdMail .mm-row[data-id="${id}"]`);
  await page.waitForSelector("#smdMail .mm-h");
}
// Detail-pane controls first (the list pane has its own Close), else the list pane's.
async function tapAct(page, act) {
  const rpSel = `#smdMail .mm-rp [data-act="${act}"]`, lpSel = `#smdMail .mm-lp [data-act="${act}"]`;
  const sel = (await page.$(rpSel)) ? rpSel : (await page.$(lpSel)) ? lpSel : `#smdMail [data-act="${act}"]`;
  await page.waitForSelector(sel, { state: "visible" });
  await page.tap(sel);
}
async function backToList(page) { if (await visible(page, '#smdMail .mm-rp [data-act="back"]')) await page.tap('#smdMail .mm-rp [data-act="back"]'); }
const lastPost = (MB, id) => MB.calls.filter((c) => c.method === "POST" && c.path === "/api/mail/message/" + id).slice(-1)[0];

/* ---------------- bug 1: the action row, by tap ---------------- */
async function actionsByTap(page, MB, size) {
  await openMail(page);
  await openMsg(page, "msg_b");
  // star: immediate visible state, server gets the value shown, toast confirms
  await tapAct(page, "star");
  ok(await page.$eval('#smdMail [data-act="star"]', (b) => b.classList.contains("on")), size + ": star fills at once");
  await settle(page, 250);
  ok(lastPost(MB, "msg_b") && lastPost(MB, "msg_b").body.starred === true, size + ": star sends {starred:true}");
  ok(await lastToast(page) === "Starred", size + ": toast confirms Starred");
  ok(await page.$('#smdMail .mm-row[data-id="msg_b"] .mm-st') !== null, size + ": the list row shows the star");
  await tapAct(page, "star"); await settle(page, 250);
  ok(lastPost(MB, "msg_b").body.starred === false && await lastToast(page) === "Star removed", size + ": second tap removes the star on the server");

  // a quick double tap while the first change is still in flight
  MB.patchDelay = 500;
  await page.tap('#smdMail [data-act="star"]');
  await page.tap('#smdMail [data-act="star"]');
  await settle(page, 1300);
  MB.patchDelay = 0;
  const server = MB.msgs.find((m) => m.id === "msg_b").starred;
  const shown = await page.$eval('#smdMail [data-act="star"]', (b) => b.classList.contains("on"));
  ok(shown === server, size + ": double tap leaves the star showing what the server stored (shown " + shown + ", server " + server + ")");

  // failure: rolls back and says why in plain words
  MB.failNext = { status: 502, error: "mail-permission" };
  const before = await page.$eval('#smdMail [data-act="star"]', (b) => b.classList.contains("on"));
  await tapAct(page, "star"); await settle(page, 300);
  ok(await page.$eval('#smdMail [data-act="star"]', (b) => b.classList.contains("on")) === before, size + ": a refused star rolls back");
  ok(/needs send access/.test(await lastToast(page)), size + ": the refusal is explained (" + (await lastToast(page)) + ")");
  MB.failNext = { status: 400, error: "You do not have permission to manage this mailbox" };
  await tapAct(page, "star"); await settle(page, 300);
  ok(await lastToast(page) === "You do not have permission to manage this mailbox", size + ": a server sentence is shown as written, not 'Something went wrong'");

  // mark unread: back to the list, row bold again, server told
  await tapAct(page, "unread"); await settle(page, 250);
  ok(lastPost(MB, "msg_b").body.read === false, size + ": mark unread sends {read:false}");
  ok(await lastToast(page) === "Marked as unread", size + ": toast confirms Marked as unread");
  ok(await page.$('#smdMail .mm-row.unread[data-id="msg_b"]') !== null, size + ": the row is unread again");
  ok(await visible(page, "#smdMail .mm-lp"), size + ": the list is showing");

  // archive / spam / trash / back to inbox: each returns to the list and files the message
  const moves = [["msg_b", "archive", "archived", "Archived", null], ["msg_c", "spam", "spam", "Reported as spam", null]];
  for (const [id, act, status, msg] of moves) {
    await openMsg(page, id);
    await tapAct(page, act); await settle(page, 250);
    ok(lastPost(MB, id) && lastPost(MB, id).body.status === status, `${size}: ${act} sends {status:"${status}"}`);
    ok(await page.$(`#smdMail .mm-row[data-id="${id}"]`) === null, `${size}: ${act} removes the row from Inbox`);
    ok(await lastToast(page) === msg, `${size}: toast confirms ${msg}`);
    ok(await page.$("#smdMail .mm-rp .mm-h") === null, `${size}: ${act} closes the message`);
  }
  // a refused move puts the row back
  MB.failNext = { status: 502, error: "mail-server-unreachable" };
  await openMsg(page, "msg_z");
  await tapAct(page, "trash"); await settle(page, 400);
  ok(await page.$('#smdMail .mm-row[data-id="msg_z"]') !== null, size + ": a refused trash puts the row back");
  ok(/could not be reached/.test(await lastToast(page)), size + ": and says the server could not be reached");
  await openMsg(page, "msg_z");
  await tapAct(page, "trash"); await settle(page, 250);
  ok(MB.msgs.find((m) => m.id === "msg_z").status === "trash" && await lastToast(page) === "Moved to trash", size + ": trash works");
  await page.tap('#smdMail [data-folder="trash"]');
  await page.waitForSelector('#smdMail .mm-row[data-id="msg_z"]');
  await openMsg(page, "msg_z");
  await tapAct(page, "inbox"); await settle(page, 250);
  ok(MB.msgs.find((m) => m.id === "msg_z").status === "received" && await lastToast(page) === "Moved to inbox", size + ": move to inbox works from Trash");
  await page.tap('#smdMail [data-folder="inbox"]');
  await page.waitForSelector('#smdMail .mm-row[data-id="msg_z"]');
}

/* ---------------- bug 2: one smooth page ---------------- */
async function scrollsAsOnePage(page, size) {
  await openMail(page);
  await openMsg(page, "msg_z");
  await page.waitForSelector("#smdMail iframe");
  await page.waitForTimeout(2600); // the mail's content grows 1.6 s after load
  const m = await page.evaluate(() => {
    const fr = document.querySelector("#smdMail .mm-rp iframe") || document.querySelector("#smdMail iframe");
    const d = fr.contentDocument, end = d.getElementById("end").getBoundingClientRect();
    const sc = fr.closest(".mm-body");
    return { frameH: fr.clientHeight, endBottom: Math.ceil(end.bottom), pe: getComputedStyle(fr).pointerEvents, ov: d.defaultView.getComputedStyle(d.documentElement).overflowY,
      scH: sc.scrollHeight, scC: sc.clientHeight, scW: sc.scrollWidth, scCW: sc.clientWidth, pageW: document.documentElement.scrollWidth, vw: innerWidth,
      wideRight: Math.ceil(d.getElementById("wide").getBoundingClientRect().right), frameW: fr.clientWidth, textScale: d.getElementById("end").getBoundingClientRect().height / d.getElementById("end").offsetHeight, sandbox: fr.getAttribute("sandbox"),
      dbg: d.getElementById("mmw") ? [d.getElementById("mmw").style.transform, d.getElementById("mmw").style.width, d.getElementById("mmw").offsetHeight, d.getElementById("mmw").scrollWidth, d.documentElement.scrollWidth] : null };
  });
  if (process.env.DBG) console.log(JSON.stringify(m));
  ok(m.endBottom <= m.frameH + 1, size + ": the frame grows with mail that grows after load (end at " + m.endBottom + ", frame " + m.frameH + ")");
  ok(m.pe === "none" && m.ov === "hidden", size + ": the frame never scrolls or takes touches itself");
  ok(m.sandbox === "allow-same-origin", size + ": sandbox unchanged (no allow-scripts)");
  ok(m.wideRight <= m.frameW + 1, size + ": a 900 px wide block fits inside the body (" + m.wideRight + " <= " + m.frameW + ")");
  ok(m.textScale >= 0.59, size + ": wide mail is scaled no smaller than 60 % (" + m.textScale + ")");
  ok(m.scW <= m.scCW && m.pageW <= m.vw, size + ": no sideways scroll on the page");
  ok(m.scH > m.scC, size + ": header, actions and body scroll as one page");
  const box = await (await page.$("#smdMail .mm-fhost")).boundingBox();
  const px = box.x + box.width / 2, py = Math.min(box.y + 200, 700);
  // A finger on the mail body lands on this page's scroller, never inside the frame (WebKit gives a
  // touch that starts inside a frame to the frame's own scroller, which is what trapped the iPad).
  ok(await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName !== "IFRAME" && !!e.closest(".mm-body"); }, [px, py]), size + ": a touch on the mail body goes to the page, not into the frame");
  let wheeled = true;
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, 900).catch(() => { wheeled = false; });
  if (wheeled) {
    await page.waitForTimeout(400);
    const top = await page.evaluate(() => (document.querySelector("#smdMail .mm-rp iframe") || document.querySelector("#smdMail iframe")).closest(".mm-body").scrollTop);
    ok(top > 100, size + ": scrolling over the mail body scrolls the whole message (scrollTop " + top + ")");
  }
  // a tap on a link inside the mail opens it outside the app
  await page.evaluate(() => (document.querySelector("#smdMail .mm-rp iframe") || document.querySelector("#smdMail iframe")).closest(".mm-body").scrollTop = 0);
  await page.waitForTimeout(150);
  const pt = await page.evaluate(() => {
    const fr = document.querySelector("#smdMail .mm-rp iframe") || document.querySelector("#smdMail iframe");
    const f = fr.getBoundingClientRect(), a = fr.contentDocument.getElementById("lnk").getBoundingClientRect();
    return { x: f.left + a.left + Math.min(a.width / 2, 20), y: f.top + a.top + a.height / 2 };
  });
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(250);
  ok((await page.evaluate(() => window.__opened)).includes("https://example.net/renew"), size + ": tapping a link in the mail opens it");
  await shot(page, tag.replace(/\W+/g, "-") + "message-long");
}

/* ---------------- compose features ---------------- */
async function editorHtml(page) { return page.$eval("#mmText", (e) => SMD_MAIL._cleanHtml(e.innerHTML)); }
async function selectAllEditor(page) {
  await page.evaluate(() => { const e = document.getElementById("mmText"); e.focus(); const r = document.createRange(); r.selectNodeContents(e); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
}
async function compose(page, MB, size) {
  await openMail(page);
  // ---- formatting
  await tapAct(page, "compose");
  await page.waitForSelector("#mmText");
  ok(await page.$("#mmBcc") === null && await page.$(".mm-ccb") !== null, size + ": Cc and Bcc start collapsed");
  await page.tap("#mmText");
  await page.keyboard.type("Hello world");
  await selectAllEditor(page);
  for (const f of ["bold", "italic", "underline", "strikeThrough"]) await page.tap(`[data-fmt="${f}"]`);
  let h = await editorHtml(page);
  ok(/<b>/.test(h) && /<i>/.test(h) && /<u>/.test(h) && /<(s|strike)>/.test(h), size + ": bold, italic, underline, strikethrough (" + h.slice(0, 120) + ")");
  ok(await page.$eval('[data-fmt="bold"]', (b) => b.getAttribute("aria-pressed")) === "true", size + ": Bold shows as on");
  await selectAllEditor(page); await page.tap('[data-fmt="removeFormat"]');
  h = await editorHtml(page);
  ok(!/<(b|i|u|s|strike)>/.test(h) && /Hello world/.test(h), size + ": clear formatting removes it");
  await selectAllEditor(page);
  await page.selectOption("[data-size]", "5");
  ok(/<font size="5">/.test(await editorHtml(page)), size + ": size Large");
  await selectAllEditor(page);
  await page.evaluate(() => { const c = document.querySelector("[data-color]"); c.value = "#1570ef"; c.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(/color="#1570ef"/i.test(await editorHtml(page)), size + ": text colour");
  await selectAllEditor(page); await page.tap('[data-fmt="insertUnorderedList"]');
  ok(/<ul><li>/.test(await editorHtml(page)), size + ": bulleted list");
  await selectAllEditor(page); await page.tap('[data-fmt="insertOrderedList"]');
  ok(/<ol><li>/.test(await editorHtml(page)), size + ": numbered list");
  await selectAllEditor(page); await page.tap('[data-fmt="insertOrderedList"]');
  await selectAllEditor(page); await page.tap('[data-fmt="quote"]');
  ok(/<blockquote[ >]/.test(await editorHtml(page)), size + ": block quote (" + (await editorHtml(page)).slice(0, 80) + ")");
  await selectAllEditor(page); await page.tap('[data-fmt="quote"]');
  await selectAllEditor(page); await page.tap('[data-fmt="removeFormat"]');
  await selectAllEditor(page);
  page.__prompt = "example.org/a";
  await page.tap('[data-fmt="link"]'); await settle(page);
  ok(/<a href="https:\/\/example\.org\/a">/.test(await editorHtml(page)), size + ": add link (https added)");
  await selectAllEditor(page); await page.tap('[data-fmt="unlink"]');
  ok(!/<a /.test(await editorHtml(page)), size + ": remove link");
  // plain-text alternative
  await page.evaluate(() => { document.getElementById("mmText").innerHTML = "<div><b>Plan</b></div><ul><li>one</li><li>two</li></ul><ol><li>first</li></ol><blockquote>quoted</blockquote><div>see <a href=\"https://x.org/p\">page</a></div>"; });
  const pt = await page.$eval("#mmText", (e) => SMD_MAIL._plainText(e));
  ok(pt === "Plan\n- one\n- two\n1. first\n> quoted\nsee page (https://x.org/p)", size + ": plain-text alternative " + JSON.stringify(pt));

  // ---- attachments + Bcc + send
  await page.fill("#mmTo", "a@x.com");
  await page.fill("#mmSubj", "Files");
  await page.tap(".mm-ccb");
  await page.fill("#mmBcc", "boss@x.com");
  await page.setInputFiles("#mmFile", [{ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("PDFDATA") }, { name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(3000, 1) }]);
  ok((await page.$$("#smdMail .mm-catts .mm-chip")).length === 2, size + ": two files attached");
  ok(/scan\.pdf/.test(await page.textContent(".mm-catts")) && /7 B/.test(await page.textContent(".mm-catts")), size + ": chip shows name and size");
  await page.tap('[data-rm="own:1"]');
  ok((await page.$$("#smdMail .mm-catts .mm-chip")).length === 1, size + ": remove before sending");
  await page.setInputFiles("#mmFile", [{ name: "huge.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
  ok((await page.$$("#smdMail .mm-catts .mm-chip")).length === 1 && /larger than 10 MB/.test(await lastToast(page)), size + ": a file over 10 MB is refused with a reason");
  await page.setInputFiles("#mmFile", Array.from({ length: 10 }, (_, i) => ({ name: i + ".txt", mimeType: "text/plain", buffer: Buffer.from("x") })));
  ok((await page.$$("#smdMail .mm-catts .mm-chip")).length === 10 && /up to 10 attachments/.test(await lastToast(page)), size + ": the 11th file is refused");
  for (let i = 0; i < 9; i++) await page.tap('[data-rm="own:1"]');
  await page.tap("#smdMail [data-send]");
  await page.waitForFunction(() => window.__toasts.includes("Sent"));
  let send = MB.calls.filter((c) => c.path === "/api/mail/send").slice(-1)[0].body;
  ok(send.attachments && send.attachments.length === 1 && send.attachments[0].filename === "scan.pdf" && Buffer.from(send.attachments[0].contentBase64, "base64").toString() === "PDFDATA", size + ": attachment sent as base64");
  ok(send.bcc === "boss@x.com", size + ": Bcc sent");
  ok(/<ul><li>one<\/li>/.test(send.html) && send.text.startsWith("Plan\n- one"), size + ": html and text both sent");

  // ---- validation is shown at the field
  await tapAct(page, "compose"); await page.waitForSelector("#mmText");
  await page.tap("#smdMail [data-send]");
  ok(/Add at least one recipient/.test(await page.textContent("#smdMail .mm-ferr")), size + ": missing recipient is explained at the field");
  await tapAct(page, "delete");

  // ---- reply keeps the quoted original; formatting reaches the payload
  await openMsg(page, "msg_a");
  await tapAct(page, "reply");
  await page.waitForSelector("#mmText");
  ok((await page.inputValue("#mmTo")) === "Ravi Kumar <ravi@example.net>" && (await page.inputValue("#mmSubj")) === "Re: Partnership query", size + ": reply addressed and subject Re:");
  await page.waitForFunction(() => { const f = document.querySelector(".mm-quote iframe"); return f && f.contentDocument && f.contentDocument.getElementById("mmw"); });
  ok(/Quoted message/.test(await page.textContent(".mm-quote")) && /Ravi Kumar wrote:/.test(await page.$eval(".mm-quote iframe", (f) => f.contentDocument.body.textContent)), size + ": quoted original shown under the reply");
  await page.tap("#mmText"); await page.keyboard.type("Thanks, happy to talk.");
  await selectAllEditor(page); await page.tap('[data-fmt="bold"]');
  await page.tap("#smdMail [data-send]");
  await page.waitForFunction(() => window.__toasts.filter((t) => t === "Sent").length >= 2);
  send = MB.calls.filter((c) => c.path === "/api/mail/send").slice(-1)[0].body;
  ok(send.replyToId === "msg_a" && /<b>Thanks, happy to talk\.<\/b>/.test(send.html) && /<blockquote type="cite"/.test(send.html), size + ": reply html carries the formatting and the quote");
  ok(/\n> Hello team, we would like to discuss\./.test(send.text) && !/__pwned/.test(send.html) && !/onerror/.test(send.html), size + ": text quotes the original; scripts and handlers are stripped");

  // ---- forward carries the original's attachments
  await openMsg(page, "msg_a");
  await tapAct(page, "forward");
  await page.waitForSelector("#mmText");
  ok((await page.inputValue("#mmSubj")) === "Fwd: Partnership query" && /brochure\.pdf/.test(await page.textContent(".mm-catts")), size + ": forward has Fwd: and the original's file");
  await page.fill("#mmTo", "z@x.com");
  await page.tap("#smdMail [data-send]");
  await page.waitForFunction(() => window.__toasts.filter((t) => t === "Sent").length >= 3);
  send = MB.calls.filter((c) => c.path === "/api/mail/send").slice(-1)[0].body;
  ok(send.forwardId === "msg_a" && JSON.stringify(send.forwardAttachmentIds) === '["att_1"]' && /Begin forwarded message/.test(send.html) && !send.replyToId, size + ": forward sends the original's attachment ids");

  // ---- send later
  await tapAct(page, "compose"); await page.waitForSelector("#mmText");
  await page.fill("#mmTo", "later@x.com"); await page.fill("#mmSubj", "Tomorrow"); await page.tap("#mmText"); await page.keyboard.type("See you");
  await tapAct(page, "later");
  await page.waitForSelector(".mm-sheet .mm-opt");
  await page.waitForTimeout(300);
  await shot(page, tag.replace(/\W+/g, "-") + "schedule");
  await page.tap('.mm-opt[data-opt="1"]');
  const sum = await page.textContent(".mm-sheet .mm-sum[aria-live]");
  ok(/^Sends .*8:00/.test(sum), size + ": the chosen time is shown in words (" + sum + ")");
  await page.tap('[data-sc="go"]');
  await page.waitForFunction(() => window.__toasts.some((t) => /^Scheduled for/.test(t)));
  send = MB.calls.filter((c) => c.path === "/api/mail/send").slice(-1)[0].body;
  const want = new Date(); want.setDate(want.getDate() + 1); want.setHours(8, 0, 0, 0);
  ok(send.scheduledAt === want.toISOString(), size + ": scheduledAt is tomorrow 8:00 device time (" + send.scheduledAt + ")");
  await page.tap('#smdMail [data-folder="scheduled"]');
  await page.waitForSelector("#smdMail .mm-row .mm-tag.sch");
  ok(/Sends/.test(await page.textContent("#smdMail .mm-row .mm-tag.sch")), size + ": Scheduled folder shows when it will send");
  await page.tap("#smdMail .mm-row"); await page.waitForSelector("#smdMail .mm-note");
  ok(/cannot cancel/.test(await page.textContent("#smdMail .mm-note")), size + ": scheduled mail says plainly it cannot be cancelled yet");
  await backToList(page);
  await page.tap('#smdMail [data-folder="inbox"]'); await page.waitForSelector("#smdMail .mm-row");

  // ---- drafts
  await tapAct(page, "compose"); await page.waitForSelector("#mmText");
  await page.fill("#mmTo", "draft@x.com"); await page.fill("#mmSubj", "Half written");
  await page.waitForTimeout(1500);
  ok((await page.evaluate(() => JSON.parse(localStorage.getItem("smd_mail_drafts") || "[]"))).some((d) => d.subject === "Half written"), size + ": drafts save automatically");
  await tapAct(page, "close");
  ok(await lastToast(page) === "Saved to Drafts", size + ": closing keeps a draft (" + (await toasts(page)).slice(-3).join(" | ") + ")");
  await page.tap('#smdMail [data-folder="drafts"]');
  await page.waitForSelector("#smdMail .mm-row");
  ok(/Half written/.test(await page.textContent("#smdMail .mm-list")) && /Draft/.test(await page.textContent("#smdMail .mm-list")), size + ": Drafts lists it");
  await page.tap("#smdMail .mm-row"); await page.waitForSelector("#mmSubj");
  ok((await page.inputValue("#mmSubj")) === "Half written" && (await page.inputValue("#mmTo")) === "draft@x.com", size + ": a draft restores");
  await tapAct(page, "delete");
  ok(await lastToast(page) === "Draft deleted" && (await page.evaluate(() => JSON.parse(localStorage.getItem("smd_mail_drafts") || "[]"))).length === 0, size + ": delete draft");

  // ---- signature
  await tapAct(page, "settings"); await page.waitForSelector("#mmSig");
  await page.fill("#mmSig", "Dr M Kurmana\nMaiKnowledge");
  await page.tap("[data-save]");
  ok(await lastToast(page) === "Signature saved", size + ": signature saved");
  await tapAct(page, "compose"); await page.waitForSelector("#mmText");
  ok(/Dr M Kurmana<br>MaiKnowledge/.test(await page.$eval("#mmText", (e) => e.innerHTML)), size + ": new messages carry the signature");
  await tapAct(page, "delete");

  // ---- search + refresh
  await page.tap('#smdMail [data-folder="inbox"]'); await page.waitForSelector("#smdMail .mm-row");
  await tapAct(page, "search");
  await page.fill("#mmQ", "receipt");
  ok((await page.$$("#smdMail .mm-row")).length === 1 && await page.$('#smdMail .mm-row[data-id="msg_b"]') !== null, size + ": search filters the mailbox");
  await page.fill("#mmQ", "zzzz");
  ok(/No results/.test(await page.textContent("#smdMail .mm-list")), size + ": no matches says so");
  await page.tap('[data-act="search-cancel"]');
  const n0 = MB.calls.filter((c) => c.path.startsWith("/api/mail/list")).length;
  await tapAct(page, "refresh"); await settle(page, 300);
  ok(MB.calls.filter((c) => c.path.startsWith("/api/mail/list")).length === n0 + 1, size + ": refresh reloads the folder");
}

async function basics(page, MB, errors) {
  // --- non-owner: no entry point, open() refuses ---
  await page.goto("http://smd.test/doc");
  ok(await page.evaluate(() => window.SMD_MAIL && SMD_MAIL.enabled()) === false, "non-owner: Mail is not enabled");
  await page.evaluate(() => SMD_MAIL.open());
  ok(await page.$("#smdMail") === null && (await page.evaluate(() => window.__toasts)).includes("Owner access only"), "non-owner: open() shows 'Owner access only' and no screen");

  await page.goto("http://smd.test/owner");
  ok(await page.evaluate(() => SMD_MAIL.enabled()) === true, "owner: Mail is enabled");
  ok(await page.evaluate(() => SMD_MAIL.checkUnread()) === 1, "owner: unread badge count is 1");
  await page.evaluate(() => SMD_MAIL.open());
  await page.waitForSelector("#smdMail .mm-row");
  ok((await page.$$("#smdMail .mm-row")).length === 4, "inbox lists the messages");
  ok((await page.textContent('[data-folder="inbox"]')) === "Inbox (1)", "inbox tab shows the unread count");
  ok((await page.$$("#smdMail .mm-row.unread")).length === 1, "the unread message is marked unread");
  ok((await page.textContent("#smdMail .mm-lp .mm-t span")) === "hello@maiknowledge.com", "header shows the mailbox address");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal scroll");
  await shot(page, tag.replace(/\W+/g, "-") + "inbox-light");

  await page.tap('#smdMail .mm-row[data-id="msg_a"]');
  await page.waitForSelector("#smdMail iframe.mm-frame");
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForSelector("#body");
  ok((await frame.textContent("#body")).includes("Hello team"), "message HTML renders in the frame");
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => window.__pwned) === undefined, "script and onerror handlers in the mail do not run");
  ok(await frame.evaluate(() => window.__pwned) === undefined, "nothing ran inside the frame either");
  ok(MB.calls.some((c) => c.method === "POST" && c.path === "/api/mail/message/msg_a" && c.body && c.body.read === true), "opening an unread message marks it read on the server");
  ok(await page.$('#smdMail [data-att="att_1"]') !== null, "attachment chip is shown");
  ok(await page.$('#smdMail [data-act="replyall"]') === null, "reply-all hidden when there is only one recipient");
  ok((await page.textContent('[data-folder="inbox"]')) === "Inbox", "unread count clears once the server marked it read");
  await shot(page, tag.replace(/\W+/g, "-") + "message-light");
  await page.evaluate(() => document.body.classList.add("dark"));
  const bg = await page.$eval("#smdMail", (e) => getComputedStyle(e).backgroundColor);
  ok(bg === "rgb(11, 18, 32)", "dark mode background applies (" + bg + ")");
  await shot(page, tag.replace(/\W+/g, "-") + "message-dark");
  await tapAct(page, "reply"); await page.waitForSelector("#mmText");
  await page.tap("#mmText"); await page.keyboard.type("Thank you, happy to talk.");
  await shot(page, tag.replace(/\W+/g, "-") + "compose-dark");
  await page.evaluate(() => document.body.classList.remove("dark"));
  await shot(page, tag.replace(/\W+/g, "-") + "compose-light");
  await tapAct(page, "delete");

  // --- live: new mail arrives, returning to the app pulls it in ---
  if (await page.$('#smdMail .mm-lp [data-act="close"]')) {
    MB.msgs.unshift({ id: "msg_new", from: "Asha <asha@example.com>", to: "hello@maiknowledge.com", cc: "", subject: "New enquiry", snippet: "Hi", read: false, starred: false, status: "received", direction: "inbound", createdAt: new Date().toISOString(), htmlBody: "", textBody: "Hi" });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForSelector('#smdMail .mm-row[data-id="msg_new"]', { timeout: 3000 }).catch(() => {});
    ok(await page.$('#smdMail .mm-row[data-id="msg_new"].unread') !== null, "new mail appears without a manual refresh");
    ok((await page.textContent('[data-folder="inbox"]')) === "Inbox (1)", "unread count updates live");
    await page.evaluate(() => document.body.classList.add("dark"));
    await shot(page, tag.replace(/\W+/g, "-") + "inbox-dark");
    await page.evaluate(() => document.body.classList.remove("dark"));
  }
  await page.tap('#smdMail .mm-lp [data-act="close"]');
  ok(await page.$("#smdMail") === null, "Close removes the screen");
  ok(await page.evaluate(() => SMD_MAIL._st.timer) === null, "polling stops on close");

  MB.configured = false;
  await page.goto("http://smd.test/owner");
  await page.evaluate(() => SMD_MAIL.open());
  await page.waitForSelector("#smdMail .mm-empty b");
  ok((await page.textContent("#smdMail .mm-lp .mm-empty b")) === "Mail is not connected yet", "unconfigured server shows setup steps");
  ok(!(await page.textContent("#smdMail")).includes("—"), "no em-dash in app text");
  MB.configured = true;
}

async function ipadLayout(page, MB) {
  await openMail(page);
  ok(await visible(page, "#smdMail .mm-lp") && await visible(page, "#smdMail .mm-rp"), "iPad: list and message panes side by side");
  ok(/No message selected/.test(await page.textContent("#smdMail .mm-rp")), "iPad: empty detail says what to do");
  await openMsg(page, "msg_a");
  ok(await visible(page, "#smdMail .mm-lp") && await page.$('#smdMail .mm-row.sel[data-id="msg_a"]') !== null, "iPad: the list stays visible with the open message selected");
  const tb = await page.evaluate(() => { const a = document.querySelector("#smdMail .mm-acts").getBoundingClientRect(), h = document.querySelector("#smdMail .mm-rp .mm-bar").getBoundingClientRect(); return a.top - h.bottom; });
  ok(Math.abs(tb) < 2, "iPad: actions sit under the header, outside the scrolling message");
  ok(!(await visible(page, '#smdMail .mm-rp [data-act="back"]')), "iPad: no back button in the detail pane");
}

async function run() {
  for (const engine of ENGINES) {
    const browser = await pw[engine].launch(process.env.CHROME && engine === "chromium" ? { executablePath: process.env.CHROME } : {});
    for (const size of ["phone", "ipad"]) {
      const MBref = { mb: mailbox() };
      const { ctx, page, errors } = await newContext(browser, engine, size, MBref);
      tag = `[${engine} ${size}] `;
      await section("basics", () => basics(page, MBref.mb, errors));
      MBref.mb = mailbox();
      await section("bug 1 actions", () => actionsByTap(page, MBref.mb, size));
      MBref.mb = mailbox();
      await section("bug 2 scroll", () => scrollsAsOnePage(page, size));
      MBref.mb = mailbox();
      await section("compose", () => compose(page, MBref.mb, size));
      if (size === "ipad") { MBref.mb = mailbox(); await section("ipad layout", () => ipadLayout(page, MBref.mb)); }
      ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
      await ctx.close();
    }
    await browser.close();
  }
}

await run().catch((e) => { console.error(e); fails++; });
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
