/* PrepNucleus Ask MaiK as a short chat (owner 2026-10-09 evening) and the MaiK AI mark.
 * What must hold:
 *  - a thread counts the student's messages (the first ask counts); the 10th is the last, then canAsk is false;
 *  - each follow-up sends the same grounding, the newest turns as written (6 online, 4 on the phone) and a summary of the
 *    older ones; MaiK turns that failed the check are never sent back; the last message is always the student's; the
 *    sent text stays under the total cap however long the chat gets;
 *  - the client's chat prompt and system prompt are the server's, word for word;
 *  - a follow-up answer passes the same check as the first (numbers and drugs must be in the grounding, never in the
 *    chat); "not covered", an error with a note, an empty answer all fail with a note;
 *  - the hand-off to the MaiK assistant carries a short topic and a capped summary ending on an open line;
 *  - threads are keyed per item, pruned (age, count, length, malformed), and the follow-up idempotency id fits the server;
 *  - maik-ai-mark.js: the variants, the size rule (no "AI" under 28 px, the tile without it under 40 px), decorative by
 *    default; assets/maik-ai-mark.svg holds the symbols, inline fills, nothing external.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-ask-chat.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const req = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = req("../prep-teacher.js");
const A = req("../prep-ask.js");
const M = req("../maik-ai-mark.js");
const LEX = req("../drug-lexicon.js");
const SRV = await import("../functions/api/ai/_prep-teach.js");

const ITEM = { id: "m1", q: "A 30-year-old man on long-term therapy develops gingival hyperplasia. Which drug is responsible?",
  o: ["Phenytoin", "Valproate", "Lamotrigine", "Levetiracetam"], a: 0,
  exp: "Phenytoin causes gingival hyperplasia in about 50% of patients on long-term therapy." };
const GROUND = T.groundingText(ITEM, 1, []);
const u = (t) => ({ r: "u", t });
const m = (t, ok) => ({ r: "m", t, ok: ok !== false });
function thread(n) {   // n exchanges, student then MaiK
  const out = [];
  for (let i = 1; i <= n; i++) { out.push(u("Doubt number " + i + " about the gums?")); out.push(m("Answer " + i + ". Phenytoin is the drug the explanation names.")); }
  return out;
}

/* ---------- turn count and the 10-message hand-off ---------- */
test("userCount and canAsk: the first ask counts, 10 is the last", () => {
  assert.equal(T.CHAT_LIM.turns, 10);
  assert.equal(T.userCount([]), 0);
  assert.equal(T.userCount(thread(3)), 3);
  assert.equal(T.canAsk(thread(9)), true);
  const t10 = thread(9).concat([u("tenth")]);
  assert.equal(T.userCount(t10), 10);
  assert.equal(T.canAsk(t10), false, "the 10th message is the last one");
  assert.equal(T.canAsk(thread(10)), false);
  assert.equal(T.userCount([u("a"), m("x", false), u("b")]), 2, "a failed answer is not a student message");
});

/* ---------- context trimming ---------- */
test("chatContext: the newest 6 as written, older turns summarised, the last message the student's", () => {
  const turns = thread(5).concat([u("And the other options?")]);
  const c = T.chatContext(turns);
  assert.equal(c.messages.length, 5, "a window of 6 that would start on MaiK's turn starts on the student's instead");
  assert.equal(c.messages[0].r, "u");
  assert.equal(c.messages[c.messages.length - 1].t, "And the other options?");
  assert.match(c.summary, /^The student asked: Doubt number 1 about the gums\?; Doubt number 2 about the gums\?; Doubt number 3 about the gums\?\. MaiK said: Answer 1\. Answer 2\./);
  assert.ok(c.summary.length <= T.CHAT_LIM.summary);
  const short = T.chatContext([u("Why?")]);
  assert.deepEqual(short, { messages: [{ r: "u", t: "Why?" }], summary: "" });
});

test("chatContext: failed MaiK turns are never sent; a trailing MaiK turn is dropped; on the phone 4 are kept", () => {
  const turns = [u("first?"), m("Phenytoin, per the explanation."), u("second?"), m("Valproate at 900 mg", false), u("third?")];
  const c = T.chatContext(turns);
  assert.equal(c.messages.some((x) => /900 mg/.test(x.t)), false, "the unchecked answer is not sent back");
  assert.equal(c.messages[c.messages.length - 1].t, "third?");
  const tr = T.chatContext([u("q"), m("a")]);
  assert.deepEqual(tr.messages, [{ r: "u", t: "q" }], "the last message is always the student's");
  const local = T.chatContext(thread(6).concat([u("last")]), { keep: T.CHAT_LIM.keepLocal });
  assert.ok(local.messages.length <= 4 && local.messages[0].r === "u" && local.summary, JSON.stringify(local));
});

test("chatContext: long turns are clipped and the total stays under the cap however long the chat", () => {
  const long = "x".repeat(2000);
  const turns = [];
  for (let i = 0; i < 9; i++) { turns.push(u("Why " + i + " " + long)); turns.push(m("Because " + i + " " + long)); }
  turns.push(u("last " + long));
  const c = T.chatContext(turns);
  const total = c.messages.reduce((n, x) => n + x.t.length, 0);
  assert.ok(total <= T.CHAT_LIM.total, "total " + total);
  c.messages.forEach((x) => assert.ok(x.t.length <= (x.r === "u" ? T.CHAT_LIM.user : T.CHAT_LIM.model)));
  assert.equal(c.messages[c.messages.length - 1].r, "u");
  assert.ok(c.summary.length > 0 && c.summary.length <= T.CHAT_LIM.summary);
  // What the server accepts: the client's caps are inside the server's.
  assert.ok(T.CHAT_LIM.user <= SRV.CHAT_LIMITS.user && T.CHAT_LIM.model <= SRV.CHAT_LIMITS.model && T.CHAT_LIM.total <= SRV.CHAT_LIMITS.total && T.CHAT_LIM.summary <= SRV.CHAT_LIMITS.summary && T.CHAT_LIM.keep <= SRV.CHAT_LIMITS.msgs);
  const r = SRV.readTeachRequest({ kind: "chat", base: "mcq", ground: GROUND, turn: 10, messages: c.messages, summary: c.summary });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("chat prompt and system prompt are the server's, word for word", () => {
  assert.equal(T.CHAT_SYSTEM, SRV.CHAT_SYSTEM);
  const c = T.chatContext(thread(5).concat([u("And B?")]));
  assert.equal(T.chatPrompt(GROUND, c), SRV.chatUser(GROUND, c.summary, c.messages));
  assert.match(T.chatPrompt(GROUND, c), /\n\nCHAT:\nStudent: .*\nMaiK: .*\nStudent: And B\?\n\nTASK: Answer the student's last message using only the grounding\.$/s);
  assert.equal(T.chatPrompt(GROUND, { messages: [u("x")], summary: "" }).indexOf("EARLIER"), -1, "no summary block when there is no summary");
});

/* ---------- the follow-up answer and its check ---------- */
test("teachChat: a grounded answer passes; a number or drug not in the grounding fails, even when the chat names it", async () => {
  const turns = [u("Why is B wrong?"), m("Phenytoin is the answer."), u("Is valproate at 900 mg the same?")];
  let seen = null;
  const ok = await T.teachChat(GROUND, turns, { lexicon: LEX, generate: (p, s, cx) => { seen = { p, s, cx }; return { text: "Phenytoin causes gingival hyperplasia in about 50% of patients." }; } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(seen.s, T.CHAT_SYSTEM);
  assert.equal(seen.cx.messages[seen.cx.messages.length - 1].t, "Is valproate at 900 mg the same?");
  const bad = await T.teachChat(GROUND, turns, { lexicon: LEX, generate: () => "Valproate at 900 mg also causes it." });
  assert.equal(bad.ok, false); assert.equal(bad.reason, "check");
  assert.ok(bad.check.numbers.includes("900"), JSON.stringify(bad.check));
});

test("teachChat: not covered, an error with a note, empty, a throw, no generator, no grounding", async () => {
  const turns = [u("q?")];
  const nc = await T.teachChat(GROUND, turns, { generate: () => "The stored explanation does not cover this." });
  assert.deepEqual([nc.ok, nc.reason], [false, "not-covered"]);
  assert.match(nc.note, /MaiK Assistant/);
  const er = await T.teachChat(GROUND, turns, { generate: () => ({ error: "tokens", note: "You have used today's free MaiK Tokens." }) });
  assert.deepEqual([er.ok, er.why, er.note], [false, "tokens", "You have used today's free MaiK Tokens."]);
  assert.equal((await T.teachChat(GROUND, turns, { generate: () => "  " })).reason, "empty");
  assert.equal((await T.teachChat(GROUND, turns, { generate: () => { throw new Error("x"); } })).reason, "model-error");
  assert.equal((await T.teachChat(GROUND, turns, {})).reason, "no-model");
  let called = false;
  assert.equal((await T.teachChat("", turns, { generate: () => { called = true; } })).reason, "no-grounding");
  assert.equal(called, false);
});

/* ---------- hand-off ---------- */
test("handoff: topic and a capped summary, ending on an open line for the next doubt", () => {
  const h = T.handoff({ topic: "Pharmacology: antiepileptics", q: ITEM.q, key: "A. Phenytoin" }, thread(10));
  assert.equal(h.topic, "Pharmacology: antiepileptics");
  assert.match(h.prefill, /^PrepNucleus question: A 30-year-old man/);
  assert.match(h.prefill, /Answer: A\. Phenytoin\./);
  assert.match(h.prefill, /The student asked: /);
  assert.ok(h.prefill.endsWith("\n\nMy next doubt: "));
  assert.ok(h.prefill.length <= 900 + "\n\nMy next doubt: ".length);
  assert.ok(T.handoff({ topic: "x".repeat(300) }, []).topic.length <= 80);
  assert.match(T.handoff({ topic: "Heart sounds" }, [u("why S3?")]).prefill, /^PrepNucleus: Heart sounds\. The student asked: why S3\?\./);
  assert.equal(/\u2014|\u2013/.test(JSON.stringify(h)), false, "no em or en dash");
});

/* ---------- threads ---------- */
test("threadKey: an MCQ by its id whatever the pick; a step and a card by their text", () => {
  assert.equal(A.threadKey({ kind: "mcq", item: ITEM, chosen: 1 }), "q:m1");
  assert.equal(A.threadKey({ kind: "mcq", item: ITEM, chosen: 2 }), "q:m1");
  assert.match(A.threadKey({ kind: "mcq", item: { q: "no id" } }), /^q:[0-9a-z]+$/);
  const s1 = A.threadKey({ kind: "step", step: { tx: "The SA node paces." }, title: "Heart" });
  assert.match(s1, /^s:/);
  assert.notEqual(s1, A.threadKey({ kind: "step", step: { tx: "The AV node delays." }, title: "Heart" }));
  assert.match(A.threadKey({ kind: "card", step: { tx: "front\nback" }, title: "Deck" }), /^c:/);
});

test("pruneThreads: drops old, malformed and extra threads, clips turns", () => {
  const now = Date.UTC(2026, 9, 9);
  const th = { old: { ts: now - 8 * 864e5, turns: [u("x")] }, bad: { ts: now, turns: "x" }, nul: null };
  for (let i = 0; i < 15; i++) th["k" + i] = { ts: now - i * 1000, mode: i % 2 ? "local" : "weird", turns: Array.from({ length: 30 }, (_, j) => (j % 2 ? m("a".repeat(2000)) : u("q" + j))).concat([{ r: "x", t: "drop" }, { r: "u" }]) };
  const out = A.pruneThreads(th, now);
  const keys = Object.keys(out);
  assert.equal(keys.length, A.TH.max);
  assert.ok(!("old" in out) && !("bad" in out) && !("nul" in out));
  assert.ok(keys.includes("k0") && !keys.includes("k14"), "newest kept");
  assert.equal(out.k0.turns.length, A.TH.turns);
  assert.ok(out.k0.turns.every((t) => t.t.length <= A.TH.chars && (t.r === "u" || t.r === "m")));
  assert.equal(out.k0.mode, null); assert.equal(out.k1.mode, "local");
  assert.deepEqual(A.pruneThreads(null, now), {});
});

test("idemFor: fits the server's idempotency rule and changes with the message", () => {
  const a = A.idemFor("q:m1", 2, [u("Why?")]), b = A.idemFor("q:m1", 2, [u("Why not?")]), c = A.idemFor("q:m1", 3, [u("Why?")]);
  for (const x of [a, b, c]) assert.match(x, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a, b); assert.notEqual(a, c);
  assert.equal(a, A.idemFor("q:m1", 2, [u("Why?")]));
});

/* ---------- the MaiK AI mark ---------- */
test("maik-ai-mark: variants, the size rule, decorative by default, escaped options", () => {
  assert.equal(M.variantFor("auto", 20), "mark");
  assert.equal(M.variantFor("auto", 27), "mark");
  assert.equal(M.variantFor("auto", 28), "full");
  assert.equal(M.variantFor("auto", 48), "full");
  // owner review 2026-10-10: no plain mark above 48 px (the tile instead); tile-mark is an alias of the tile
  assert.equal(M.variantFor(undefined, 64), "tile");
  assert.equal(M.variantFor("full", 49), "tile");
  assert.equal(M.variantFor("mark", 140), "tile");
  assert.equal(M.variantFor("tile", 34), "tile");
  assert.equal(M.variantFor("tile-mark", 34), "tile");
  assert.equal(M.variantFor("tile-mark", 140), "tile");
  assert.equal(M.variantFor("tile", 140), "tile");
  assert.match(M.html("full", { size: 140 }), /class="mkai mkai-tile"[^>]*><use href="#mkai-tile">/);
  assert.equal(M.variantFor("full", 16), "full", "an explicit variant is kept");
  const h = M.html("mark", { size: 18, cls: "x" });
  assert.match(h, /^<svg class="mkai mkai-mark x" viewBox="0 0 100 100" width="18" height="18" aria-hidden="true" focusable="false"><use href="#mkai-mark"><\/use><\/svg>$/);
  assert.match(M.html("full", { size: 40, title: 'Ask "MaiK"' }), /role="img" aria-label="Ask &quot;MaiK&quot;"/);
  assert.match(M.html("mark", { color: "#fff" }), /style="color:#fff"/);
  assert.doesNotMatch(M.html("mark", { cls: '"><script>' }), /<script>/);
});

test("assets/maik-ai-mark.svg: the symbols, inline fills, nothing external or raster", () => {
  const svg = readFileSync(join(ROOT, "assets/maik-ai-mark.svg"), "utf8");
  for (const id of ["mkai-m", "mkai-full", "mkai-mark", "mkai-tile", "mkai-tile-bg-s"]) assert.match(svg, new RegExp('<symbol id="' + id + '" viewBox="0 0 100 100"'), id);
  assert.match(svg, /<symbol id="mkai-word" viewBox="-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+"/, "the MaiK wordmark symbol, its viewBox fitted to the word");
  assert.doesNotMatch(svg, /id="mkai-tile-mark"/, "the tile-mark symbol was removed (owner review 2026-10-10)");
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|href="(?!#)/i);
  assert.doesNotMatch(svg, /\sfill="/, "fills are inline styles so page icon CSS cannot repaint the mark");
  assert.doesNotMatch(svg, /<use href="#mkai-ai"/, "owner removed the small AI from the mark (2026-10-10)");
  assert.ok(svg.length < 40000, "small (traced owner artwork): " + svg.length);
  const js = readFileSync(join(ROOT, "maik-ai-mark.js"), "utf8");
  assert.match(js, /\/assets\/maik-ai-mark\.svg\?v=/);
  assert.doesNotMatch(js, /=>|`|\blet\s|\bconst\s|^\s*class\s/m, "ES5");
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.ok(html.indexOf("/maik-ai-mark.js?v=") > 0 && html.indexOf("/maik-ai-mark.js?v=") < html.indexOf("/home.js?v="), "loaded before home.js");
  assert.match(readFileSync(join(ROOT, "scripts/build-www.sh"), "utf8"), /cp assets\/maik-ai-mark\.svg/, "shipped in the native bundle");
});

test("maik-ai-mark: the MaiK wordmark in Ask MaiK labels; text stays for screen readers; MaiKnowledge untouched", () => {
  const w = M.word();
  assert.equal(w, '<span class="mkai-w"><svg class="mkai-word" aria-hidden="true" focusable="false"><use href="#mkai-word"></use></svg><span class="mkai-wt">MaiK</span></span>');
  assert.equal(M.label("Ask MaiK"), '<span class="mkai-l">Ask&nbsp;' + w + "</span>");
  assert.equal(M.label("Why is B wrong? Ask MaiK"), '<span class="mkai-l">Why is B wrong? Ask&nbsp;' + w + "</span>");
  assert.equal(M.label("MaiK से पूछें"), '<span class="mkai-l">' + w + " से पूछें</span>", "the Hindi label too");
  assert.equal(M.label("Open MaiKnowledge"), '<span class="mkai-l">Open MaiKnowledge</span>', "only the standalone word");
  assert.equal(M.label('Ask MaiK about &quot;x&quot;'), '<span class="mkai-l">Ask&nbsp;' + w + ' about &quot;x&quot;</span>', "escaped text stays escaped");
  // the text without tags reads "Ask MaiK ..." for screen readers, find and copy
  assert.equal(M.label("Ask MaiK about this card").replace(/<[^>]+>/g, ""), "Ask&nbsp;MaiK about this card", "Ask and MaiK kept together");
  const js = readFileSync(join(ROOT, "maik-ai-mark.js"), "utf8");
  assert.match(js, /html\.mkai-wok svg\.mkai-word\{display:inline-block\}/, "the wordmark shows only once the sprite holds mkai-word");
  assert.match(js, /svg\.mkai-word\{display:none;width:calc\(\.75em \* var\(--mkai-wr,[\d.]+\)\)!important;height:\.75em!important/, "em-sized, so it follows the label's font size; width from the symbol's viewBox");
});

test("every Ask MaiK label draws MaiK as the wordmark", () => {
  const src = (f) => readFileSync(join(ROOT, f), "utf8");
  // [file, the text that must sit inside a SMD_MAIK_MARK.label(...) call (or the local helper that calls it)]
  const LABELS = [
    ["prep.js", "G.SMD_MAIK_MARK.label(label)"], ["prep-flash.js", 'G.SMD_MAIK_MARK.label("Ask MaiK about this card")'],
    ["prep-ask.js", 'M.label("Ask MaiK")'], ["surgx-screens.js", 'window.SMD_MAIK_MARK.label("Ask MaiK")'],
    ["clinix-screens.js", 'window.SMD_MAIK_MARK.label("Ask MaiK about this step")'], ["clinix-screens.js", 'window.SMD_MAIK_MARK.label("Ask MaiK to review this answer")'],
    ["opd-emr.js", 'window.SMD_MAIK_MARK.label("Ask MaiK")'], ["thorex-screens.js", 'window.SMD_MAIK_MARK.label("Ask MaiK")'],
    ["icu.js", 'window.SMD_MAIK_MARK.label("Ask MaiK")'], ["icu.js", 'label("Ask MaiK about this patient") : "Ask MaiK about this patient") + "</h3>'],
    ["icu.js", 'label("Ask MaiK about this patient") : "Ask MaiK about this patient") + "</button>"'], ["ophthalmos.js", 'window.SMD_MAIK_MARK.label("Ask MaiK")'],
    ["specialty-shell.js", 'window.SMD_MAIK_MARK.label(s("askMaik"))'], ["workspaces.js", 'window.SMD_MAIK_MARK.label("Ask MaiK")'],
    ["reasoning.js", 'window.SMD_MAIK_MARK.label("Ask MaiK")'], ["ward.js", 'window.SMD_MAIK_MARK.label(wTH("ward.ask-maik-to-explain-this-verdict"'],
    ["search.js", 'G.SMD_MAIK_MARK.label(esc(it.title))'], ["home.js", 't.act === "askai" && window.SMD_MAIK_MARK ? window.SMD_MAIK_MARK.label(t.tt)'],
  ];
  for (const [f, needle] of LABELS) assert.ok(src(f).indexOf(needle) >= 0, f + ": " + needle);
  const ask = src("prep-ask.js");
  assert.ok(ask.indexOf("avatar(44) + '<div><h2 id=\"paT\">' + askLbl() + '</h2>") > 0 && ask.indexOf("avatar(36) + '<h2 id=\"paT\">' + askLbl() + '</h2>'") > 0, "both sheet headers");
  // no visible "Ask MaiK" label is left as plain text next to the mark (the aria-labels and fallbacks keep plain text)
  for (const f of ["surgx-screens.js", "ophthalmos.js", "workspaces.js"]) assert.doesNotMatch(src(f), /\) \+ ["'] Ask MaiK<\/button>/, f);
  const home = src("home.js");
  const shell = home.slice(home.indexOf("function maikShellHTML"), home.indexOf("function maikShellHTML") + 6000);
  assert.ok(shell.length > 1000 && !/mkai|SMD_MAIK_MARK/.test(shell), "the MaiK assistant's own shell and logo are unchanged");
  assert.equal((home.match(/SMD_MAIK_MARK/g) || []).length, 2, "home.js uses the wordmark only on the Ask MaiK tile title");
});

test("every Ask MaiK entry point across the app carries the mark; the MaiK assistant and the footer keep their logos", () => {
  const src = (f) => readFileSync(join(ROOT, f), "utf8");
  // [file, the label right after the icon]: the icon markup just before the label must come from SMD_MAIK_MARK.
  const ENTRIES = [
    ["prep.js", "function askBtn("], ["prep-flash.js", "Ask MaiK about this card"], ["prep-lessons.js", 'aria-label="Ask MaiK about this step">'],
    ["prep-ask.js", "function mark(size)"], ["prep-teacher.js", "function avatar()"],
    ["surgx-screens.js", 'data-sgx="ask"'], ["clinix-screens.js", 'label("Ask MaiK about this step")'], ["clinix-screens.js", 'label("Ask MaiK to review this answer")'],
    ["opd-emr.js", '<span class="oe-maik-ico">'], ["thorex-screens.js", '<span class="tx-maik-ico">'], ["icu.js", 'data-icu-act="asksend"'],
    ["icu.js", '"Ask MaiK about this patient") + "</h3>'], ["icu.js", 'data-icu-act="askmaik"'], ["ophthalmos.js", 'class="oph-btn sec oph-maik"'],
    ["specialty-shell.js", 's("askMaik")'], ["workspaces.js", 'data-poc="maik"'], ["reasoning.js", 'label("Ask MaiK")'],
    ["ward.js", '"Ask MaiK to explain this verdict"'], ["search.js", '<span class="us-row-ico">'],
  ];
  for (const [f, label] of ENTRIES) {
    const s = src(f), i = s.indexOf(label);
    assert.ok(i >= 0, f + ": " + label);
    const win = s.slice(Math.max(0, i - 420), i + 420);
    assert.match(win, /SMD_MAIK_MARK/, f + " near " + label);
  }
  const ask = src("prep-ask.js");
  assert.ok(ask.indexOf("avatar(44) + '<div><h2 id=\"paT\">'") > 0 && ask.indexOf("avatar(36) + '<h2 id=\"paT\">'") > 0, "the sheet's two headers use the mark");
  const home = src("home.js");
  assert.match(home, /act: "askai", ic: "auto_awesome", anim: "maikai"/, "the Home Ask MaiK tile");
  assert.match(home, /maikai: '<svg class="mkai mkai-mark"[^']*<use href="#mkai-mark"><\/use><\/svg>'/);
  assert.match(home, /window\.SMD_askMaikHandoff = function/);
  assert.equal((home.match(/mkai/g) || []).length, 3, "home.js uses the mark only on the tile (no change inside the MaiK assistant)");
  const shell = home.slice(home.indexOf("function maikShellHTML"), home.indexOf("function maikShellHTML") + 6000);
  assert.ok(shell.length > 1000 && !/mkai|SMD_MAIK_MARK/.test(shell), "the assistant's own shell is unchanged");
  assert.equal((home.match(/<img class="v4-maik-logo v4-maik-light" src="\/maik-logo\.png" alt="MaiK"><img class="v4-maik-logo v4-maik-dark" src="\/maik-logo-white\.png"/g) || []).length, 2, "the footer MaiKnowledge logo is untouched");
});
