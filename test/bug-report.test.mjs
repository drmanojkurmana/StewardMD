/* test/bug-report.test.mjs - shake to report a bug, and the Bug Report Centre.
 *
 * Owner request 2026-09-26: "shake the iphone to report a bug ... user can point out the button or
 * screen ... write what is the problem ... promise user to will be solved in 24hrs ... bug report
 * centre in side bar ... reply from developer to user. removing agent connect and my clinic".
 *
 * Server: functions/_support.js (ticket kind "bug"), functions/api/support.js (action bug / seen /
 * ?shot), functions/api/ai/[[path]].js (admin shot, push on reply). Client: bug-report.js.
 * node --test --experimental-test-module-mocks test/bug-report.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WHO = { current: { id: "fb:u1", guest: false, email: "a@x.in", name: "Asha" } };
const realUsage = await import("../functions/_usage.js");
function memKV() {
  const m = new Map();
  return { _m: m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const STORE = memKV();
mock.module("../functions/_usage.js", { namedExports: { ...realUsage, identify: async () => WHO.current, usageKv: () => STORE } });
const route = await import("../functions/api/support.js");
const S = await import("../functions/_support.js");

const post = async (body) => { const r = await route.onRequestPost({ request: new Request("https://x/api/support", { method: "POST", body: JSON.stringify(body) }), env: {} }); return { status: r.status, body: await r.json() }; };
const get = async (q) => route.onRequestGet({ request: new Request("https://x/api/support" + (q || "")), env: {} });
const JPEG = "data:image/jpeg;base64," + Buffer.from("fake-jpeg-bytes").toString("base64");

test("a bug report is a ticket of kind bug, due 24 h after it was made, with where it happened", async () => {
  WHO.current = { id: "fb:u1", guest: false, email: "a@x.in" };
  const before = Date.now();
  const r = await post({ action: "bug", text: "Save does nothing\nsecond line", shot: JPEG, platform: "ios", build: "1.2",
    bug: { route: "#icu | modalX", element: { sel: "button#save", label: "Save", tag: "button", rect: { x: 10, y: 20, w: 80, h: 44 } }, screen: { w: 390, h: 844, dpr: 3 }, ua: "iPhone" } });
  assert.equal(r.status, 200); const t = r.body.ticket;
  assert.match(t.id, /^SMD-/); assert.equal(t.kind, "bug");
  assert.equal(t.subject, "Bug: Save does nothing");
  assert.ok(t.dueAt >= before + S.BUG_SLA_MS && t.dueAt <= Date.now() + S.BUG_SLA_MS, "the 24-hour promise");
  assert.equal(t.bug.element.label, "Save"); assert.deepEqual(t.bug.element.rect, { x: 10, y: 20, w: 80, h: 44 });
  assert.equal(t.hasShot, true);
  assert.equal(STORE._m.get(S.shotKey(t.id)).slice(0, 5), "jpeg:");
  const idx = await S.listTickets(STORE);
  assert.equal(idx[0].kind, "bug"); assert.equal(idx[0].dueAt, t.dueAt);
});

test("only the reporter can see their screenshot; junk or oversized images are not stored", async () => {
  WHO.current = { id: "fb:u1", guest: false };
  const t = (await post({ action: "bug", text: "x broken", shot: JPEG })).body.ticket;
  const mine = await get("?shot=" + t.id);
  assert.equal(mine.status, 200); assert.equal(mine.headers.get("Content-Type"), "image/jpeg");
  assert.equal(Buffer.from(await mine.arrayBuffer()).toString(), "fake-jpeg-bytes");
  WHO.current = { id: "fb:someone-else", guest: false };
  assert.equal((await get("?shot=" + t.id)).status, 404);
  WHO.current = { id: "fb:u1", guest: false };
  assert.equal(route.cleanShot("data:text/html;base64,PGI+"), "");
  assert.equal(route.cleanShot("data:image/jpeg;base64," + "A".repeat(S.SHOT_MAX + 4)), "");
  const noShot = (await post({ action: "bug", text: "y broken", shot: "javascript:alert(1)" })).body.ticket;
  assert.equal(noShot.hasShot, false); assert.equal(STORE._m.has(S.shotKey(noShot.id)), false);
});

test("guests cannot report (no way to reply); empty text is refused; a daily cap stops a stuck sensor", async () => {
  WHO.current = { guest: true };
  assert.equal((await post({ action: "bug", text: "x" })).status, 401);
  WHO.current = { id: "fb:cap", guest: false };
  assert.equal((await post({ action: "bug", text: "  " })).status, 400);
  for (let i = 0; i < route.BUGS_PER_DAY; i++) assert.equal((await post({ action: "bug", text: "r" + i })).status, 200);
  assert.equal((await post({ action: "bug", text: "one more" })).status, 429);
});

test("developer reply -> unread for the doctor until they open it; their reply clears it; resolve stamps resolvedAt", async () => {
  WHO.current = { id: "fb:u2", guest: false };
  const t = (await post({ action: "bug", text: "chart blank" })).body.ticket;
  await S.addMessage(STORE, t.id, "support", "Fixed in 1.3, please update", Date.now(), "resolved");
  let mine = await (await get("")).json();
  const m = mine.tickets.find((x) => x.id === t.id);
  assert.equal(m.userUnread, true); assert.equal(m.status, "resolved"); assert.ok(m.resolvedAt);
  assert.equal((await post({ action: "seen", id: t.id })).status, 200);
  mine = await (await get("")).json();
  assert.equal(mine.tickets.find((x) => x.id === t.id).userUnread, false);
  WHO.current = { id: "fb:intruder", guest: false };
  assert.equal((await post({ action: "seen", id: t.id })).status, 404, "never another doctor's ticket");
});

test("cleanBugMeta clips what the client sends (no giant selectors, numbers only in the rect)", () => {
  const b = S.cleanBugMeta({ route: "r".repeat(500), element: { sel: "s".repeat(900), label: 5, rect: { x: "12", y: "NaN", w: 1e9, h: -3 } }, screen: { w: 390, h: 844, dpr: 2.625 } });
  assert.equal(b.route.length, 200); assert.equal(b.element.sel.length, 300);
  assert.deepEqual(b.element.rect, { x: 12, y: 0, w: 99999, h: -3 });
  assert.equal(b.screen.dpr, 2.63);
});

test("admin: screenshot route is owner-only (under admin/*), resolve drops it, the reply sends a push with no ticket text", () => {
  const src = readFileSync(new URL("../functions/api/ai/[[path]].js", import.meta.url), "utf8");
  // admin/* segs are reachable only when listed in the owner-gated set; the handler lives inside it.
  const gateLine = src.split("\n").find((l) => l.includes('seg === "admin/support-reply" ||'));
  assert.ok(gateLine && gateLine.includes('seg === "admin/support-shot"'), "listed in the owner-gated admin set");
  const reply = src.slice(src.indexOf('if (seg === "admin/support-reply") {'), src.indexOf('if (seg === "admin/config") {'));
  assert.match(reply, /resolve && t\.kind === "bug"[\s\S]*store\.delete\(supportShotKey\(id\)\)/);
  assert.match(reply, /sendNativeToAll\(env, \{ title:[\s\S]*body: t\.id \+ ": open StewardMD to read it\."/);
  assert.equal(/body:\s*b\.text/.test(reply), false, "the reply text never goes on a lock screen");
});

/* ── client (bug-report.js), loaded in a tiny fake window ────────────────────────────────────── */
function loadClient() {
  const SRC = readFileSync(new URL("../bug-report.js", import.meta.url), "utf8");
  const win = { addEventListener() {}, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 };
  const doc = { readyState: "loading", addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], head: { appendChild() {} }, body: {} };
  const loc = { hash: "#icu" };
  new Function("window", "document", "location", "navigator", "localStorage", SRC)(win, doc, loc, { userAgent: "UA" }, { getItem: () => null, setItem() {} });
  return win.SMD_BUGS;
}

test("shake detector: three hard swings within a second fire once; a bump, a slow tilt or a desk drop do not", () => {
  const B = loadClient();
  let fired = 0; const s = B._detector(() => fired++);
  // a single bump
  s(0, 0, 9.8, 0); s(18, 0, 9.8, 50); s(0, 0, 9.8, 400);
  assert.equal(fired, 0, "one bump is not a shake");
  // slow tilt: large totals but tiny change per sample
  for (let t = 1000, x = 0; t < 2000; t += 20, x += 0.3) s(x, 0, 9.8, t);
  assert.equal(fired, 0);
  // a real shake: alternating hard swings
  let t = 3000; for (let i = 0; i < 6; i++) { s(i % 2 ? 20 : -20, 5, 9.8, t); t += 120; }
  assert.equal(fired, 1, "fires once");
  // keeps shaking inside the cooldown: no second report
  for (let i = 0; i < 6; i++) { s(i % 2 ? 20 : -20, 5, 9.8, t); t += 120; }
  assert.equal(fired, 1, "cooldown");
});

test("the 24-hour promise reads right on every state", () => {
  const B = loadClient(); const now = 1_000_000_000_000;
  assert.deepEqual(B._slaText({ status: "open", dueAt: now + 5 * 3600000 }, now), { txt: "Fix due in 5 h", cls: "" });
  assert.deepEqual(B._slaText({ status: "open", dueAt: now + 20 * 60000 }, now), { txt: "Fix due within the hour", cls: "" });
  assert.deepEqual(B._slaText({ status: "open", dueAt: now - 1 }, now), { txt: "Overdue, we are on it", cls: "late" });
  assert.deepEqual(B._slaText({ status: "resolved", dueAt: now - 1 }, now), { txt: "Fixed", cls: "ok" });
});

test("the report payload carries the screen, the pointed element and the page, and no em-dash in any user text", () => {
  const B = loadClient();
  const p = B._payload({ text: "broken", shot: "", element: { tag: "button", label: "Save" } });
  assert.equal(p.action, "bug"); assert.equal(p.bug.element.label, "Save");
  assert.deepEqual(p.bug.screen, { w: 390, h: 844, dpr: 3 }); assert.match(p.bug.route, /^#icu/);
  const src = readFileSync(new URL("../bug-report.js", import.meta.url), "utf8");
  assert.equal(src.includes("—"), false);
  assert.match(src, /fix it within 24 hours/);
});

test("sidebar: Bug Report Centre in, AgentConnect and My Clinic out; bug-report.js is loaded", () => {
  const sb = readFileSync(new URL("../sidebar-redesign.js", import.meta.url), "utf8");
  const menu = sb.slice(sb.indexOf("function build(menu)"), sb.indexOf("if (menu.__sbrClick) return;"));
  assert.match(menu, /row\("bugs", "bug", "Bug Report Centre", bugBadge\(\)\)/);
  assert.equal(/row\("agentconnect"/.test(menu), false);
  assert.equal(/row\("clinic"/.test(menu), false);
  assert.match(sb, /bugs: function \(\) \{ if \(window\.SMD_BUGS && SMD_BUGS\.openCentre\)/);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<script src="\/bug-report\.js\?v=[^"]+" defer><\/script>/);
});
