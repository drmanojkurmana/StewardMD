/* Owner Mail screen (mail.js) in a real headless Chromium, against a mocked /api/mail.
 * Verifies: owner-only entry; the inbox lists with an unread count; opening a message renders its
 * HTML in a sandbox where the mail's script does NOT run, and marks it read; reply is threaded and
 * prefilled; archive files the message and removes it from the list; returning to the app pulls new
 * mail in; an unconfigured server shows setup steps; no horizontal scroll at phone width.
 * USAGE: node test/run-mail-ui.mjs   (Playwright: PLAYWRIGHT or the global install; CHROME overrides the binary)
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

let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const MAILJS = readFileSync(join(ROOT, "mail.js"), "utf8");
const HARNESS = (email) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<script>
window.__toasts=[]; window.toast=function(m){window.__toasts.push(m)};
window.SMD_AUTH={currentUser:{email:${JSON.stringify(email)},getIdToken:function(){return Promise.resolve("tok-"+${JSON.stringify(email)})}}};
</script><script>${MAILJS}</script></body></html>`;

function mailbox() {
  return {
    configured: true,
    msgs: [
      { id: "msg_a", from: "Ravi Kumar <ravi@example.net>", to: "hello@maiknowledge.com", cc: "", subject: "Partnership query", snippet: "Hello team, we would like to", read: false, starred: false, status: "received", direction: "inbound", createdAt: new Date().toISOString(),
        htmlBody: '<p id="body">Hello team, we would like to <a href="https://example.net/x">discuss</a>.</p><script>parent.__pwned=1;window.__pwned=1</script><img src="https://example.net/t.png" onerror="parent.__pwned=2">',
        textBody: "Hello team, we would like to discuss." },
      { id: "msg_b", from: "noreply@example.org", to: "hello@maiknowledge.com", cc: "", subject: "Your receipt", snippet: "Thanks for your order", read: true, starred: false, status: "received", direction: "inbound", createdAt: "2026-09-20T09:00:00.000Z", htmlBody: "", textBody: "Thanks for your order" },
    ],
    calls: [],
  };
}

async function run() {
  const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  let MB = mailbox();

  await ctx.route("http://smd.test/**", async (route) => {
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
      const st = { inbox: "received", sent: "sent", archive: "archived", spam: "spam", trash: "trash" }[u.searchParams.get("folder")];
      const rows = MB.msgs.filter((m) => m.status === st).map(({ htmlBody, textBody, ...r }) => r);
      return J({ messages: rows, total: rows.length, unread, offset: 0, limit: 50 });
    }
    let m = p.match(/^\/message\/([\w-]+)$/);
    if (m) {
      const msg = MB.msgs.find((x) => x.id === m[1]);
      if (!msg) return J({ error: "not-found" }, 404);
      if (req.method() === "GET") return J({ message: { ...msg }, attachments: msg.id === "msg_a" ? [{ id: "att_1", filename: "brochure.pdf", type: "application/pdf", size: 2048, disposition: "attachment" }] : [] });
      Object.assign(msg, body);
      return J({ message: msg });
    }
    if (p === "/send") {
      MB.msgs.push({ id: "msg_s" + MB.msgs.length, from: "hello@maiknowledge.com", to: body.to, cc: body.cc || "", subject: body.subject, snippet: body.text.slice(0, 40), read: true, starred: false, status: "sent", direction: "outbound", createdAt: new Date().toISOString(), textBody: body.text, htmlBody: "" });
      return J({ ok: true, id: "msg_sent" });
    }
    return J({ error: "not-found" }, 404);
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // --- non-owner: no entry point, open() refuses ---
  await page.goto("http://smd.test/doc");
  ok(await page.evaluate(() => window.SMD_MAIL && SMD_MAIL.enabled()) === false, "non-owner: Mail is not enabled");
  await page.evaluate(() => SMD_MAIL.open());
  ok(await page.$("#smdMail") === null && (await page.evaluate(() => window.__toasts)).includes("Owner access only"), "non-owner: open() shows 'Owner access only' and no screen");

  // --- owner ---
  await page.goto("http://smd.test/owner");
  ok(await page.evaluate(() => SMD_MAIL.enabled()) === true, "owner: Mail is enabled");
  ok(await page.evaluate(() => SMD_MAIL.checkUnread()) === 1, "owner: unread badge count is 1");
  await page.evaluate(() => SMD_MAIL.open());
  await page.waitForSelector("#smdMail .mm-row");
  ok((await page.$$("#smdMail .mm-row")).length === 2, "inbox lists both messages");
  ok((await page.textContent('[data-folder="inbox"]')) === "Inbox (1)", "inbox tab shows the unread count");
  ok((await page.$$("#smdMail .mm-row.unread")).length === 1, "the unread message is marked unread");
  ok((await page.textContent("#smdMail .mm-t span")) === "hello@maiknowledge.com", "header shows the mailbox address");
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(noHScroll, "no horizontal scroll at 390px");
  if (OUT) await page.screenshot({ path: join(OUT, "mail-inbox.png") });

  // --- open the unread message ---
  await page.click('#smdMail .mm-row[data-id="msg_a"]');
  await page.waitForSelector("#smdMail iframe.mm-frame");
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForSelector("#body");
  ok((await frame.textContent("#body")).includes("Hello team"), "message HTML renders in the frame");
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => window.__pwned) === undefined, "script and onerror handlers in the mail do not run");
  ok(await frame.evaluate(() => window.__pwned) === undefined, "nothing ran inside the frame either");
  ok(await page.$eval("#smdMail iframe.mm-frame", (f) => f.getAttribute("sandbox")) === "allow-same-origin", "frame is sandboxed without allow-scripts");
  await page.waitForTimeout(200);
  ok(MB.calls.some((c) => c.method === "POST" && c.path === "/api/mail/message/msg_a" && c.body && c.body.read === true), "opening an unread message marks it read on the server");
  ok(await page.$('#smdMail [data-att="att_1"]') !== null, "attachment chip is shown");
  ok(await page.$('#smdMail [data-act="replyall"]') === null, "reply-all hidden when there is only one recipient");
  if (OUT) await page.screenshot({ path: join(OUT, "mail-message.png") });

  // --- reply ---
  await page.click('#smdMail [data-act="reply"]');
  await page.waitForSelector("#mmTo");
  ok((await page.inputValue("#mmTo")) === "Ravi Kumar <ravi@example.net>", "reply is addressed to the sender");
  ok((await page.inputValue("#mmSubj")) === "Re: Partnership query", "reply subject gets Re:");
  ok((await page.inputValue("#mmText")).includes("> Hello team, we would like to discuss."), "reply quotes the original");
  await page.fill("#mmText", "Thank you, happy to talk.\n" + (await page.inputValue("#mmText")));
  if (OUT) await page.screenshot({ path: join(OUT, "mail-reply.png") });
  await page.click("#smdMail [data-send]");
  await page.waitForSelector("#smdMail .mm-row");
  const send = MB.calls.find((c) => c.path === "/api/mail/send");
  ok(send && send.body.replyToId === "msg_a" && send.body.to === "Ravi Kumar <ravi@example.net>", "send carries replyToId for threading");
  ok((await page.evaluate(() => window.__toasts)).includes("Sent"), "toast confirms Sent");

  // --- the read message is no longer bold; archive it ---
  ok((await page.$$("#smdMail .mm-row.unread")).length === 0, "back in the list, the opened message is no longer unread");
  ok((await page.textContent('[data-folder="inbox"]')) === "Inbox", "unread count cleared");
  await page.click('#smdMail .mm-row[data-id="msg_a"]');
  await page.waitForSelector('#smdMail [data-act="archive"]');
  await page.click('#smdMail [data-act="archive"]');
  await page.waitForSelector("#smdMail .mm-row");
  ok(MB.calls.some((c) => c.method === "POST" && c.body && c.body.status === "archived"), "archive files the message on the server");
  ok(await page.$('#smdMail .mm-row[data-id="msg_a"]') === null, "archived message leaves the inbox");
  await page.click('[data-folder="archive"]');
  await page.waitForSelector('#smdMail .mm-row[data-id="msg_a"]');
  ok(true, "it appears under Archive");
  await page.click('[data-folder="sent"]');
  await page.waitForSelector("#smdMail .mm-row");
  ok((await page.textContent("#smdMail .mm-row .mm-from")).startsWith("To: Ravi Kumar"), "the reply shows under Sent");

  // --- live: new mail arrives, returning to the app pulls it in ---
  await page.click('[data-folder="inbox"]');
  await page.waitForSelector('#smdMail .mm-row[data-id="msg_b"]');
  MB.msgs.unshift({ id: "msg_new", from: "Asha <asha@example.com>", to: "hello@maiknowledge.com", cc: "", subject: "New enquiry", snippet: "Hi", read: false, starred: false, status: "received", direction: "inbound", createdAt: new Date().toISOString(), htmlBody: "", textBody: "Hi" });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForSelector('#smdMail .mm-row[data-id="msg_new"]', { timeout: 3000 }).catch(() => {});
  ok(await page.$('#smdMail .mm-row[data-id="msg_new"].unread') !== null, "new mail appears without a manual refresh");
  ok((await page.textContent('[data-folder="inbox"]')) === "Inbox (1)", "unread count updates live");

  // --- dark mode keeps contrast ---
  await page.evaluate(() => document.body.classList.add("dark"));
  const bg = await page.$eval("#smdMail", (e) => getComputedStyle(e).backgroundColor);
  ok(bg === "rgb(11, 18, 32)", "dark mode background applies (" + bg + ")");
  if (OUT) await page.screenshot({ path: join(OUT, "mail-dark.png") });
  await page.evaluate(() => document.body.classList.remove("dark"));

  // --- close returns focus and stops polling ---
  await page.click('#smdMail [data-act="close"]');
  ok(await page.$("#smdMail") === null, "Close removes the screen");
  ok(await page.evaluate(() => SMD_MAIL._st.timer) === null, "polling stops on close");

  // --- not configured ---
  MB = mailbox(); MB.configured = false;
  await page.goto("http://smd.test/owner");
  await page.evaluate(() => SMD_MAIL.open());
  await page.waitForSelector("#smdMail .mm-empty b");
  ok((await page.textContent("#smdMail .mm-empty b")) === "Mail is not connected yet", "unconfigured server shows setup steps");
  ok(!(await page.textContent("#smdMail")).includes("—"), "no em-dash in app text");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
}

await run().catch((e) => { console.error(e); fails++; });
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
