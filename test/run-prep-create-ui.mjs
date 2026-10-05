/* PrepNucleus Layer C in the REAL app (headless Chromium over raw CDP): Your decks, Make a deck from pasted notes and
 * from a digital PDF, the step loop against a MOCKED /api/ai/prep-generate, practice and flashcards with FSRS, delete,
 * and the 429 month-decks message.
 * What must hold: every /api/ request is answered by this harness (Fetch.requestPaused), so nothing leaves the machine;
 * each op is its own POST with the Firebase ID token and an idem key; personal details trigger the warning and never
 * reach the request; the deck is saved in IndexedDB and listed with its question count; practising it writes FSRS cards
 * under "p:deck-<id>" and the runner labels the items AI-generated; cards write "p:cards-<id>"; a PDF's headings come
 * from the font size and its sentences carry their page; a 429 month-decks shows the plain monthly-limit message and
 * saves nothing; no em or en dash on screen; every button in these screens is at least 44 px tall; no uncaught error.
 *
 * prep-loader.js loads the Layer C files on first open; the harness checks the order it lists them in.
 * USAGE: node test/run-prep-create-ui.mjs   (BASE=http://localhost:8998/ for a running server; CHROME, CHROME_PORT, SHOTS=<dir>)
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || 8998) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || 9402), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-create-chrome-" + PORT + "-" + Date.now();
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium";
const FIX = "/test/fixtures/prep/";
const DASH = new RegExp("[" + String.fromCharCode(8211, 8212) + "]");
const LAYER_C_CSS = ["prep-create.css"], LAYER_C_JS = ["prep-source.js", "prep-decks.js", "prep-cards.js", "prep-create.js"];

let serveProc = null;
async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  const port = (BASE.match(/:(\d+)/) || [, "8998"])[1];
  serveProc = spawn("node", [join(HERE, "serve.mjs"), join(HERE, ".."), port], { stdio: "ignore" });
  for (let i = 0; i < 30; i++) { try { await fetch(BASE); return; } catch { await sleep(200); } }
}

/* ---------- a tiny digital PDF: two pages, a 20 pt heading, an 16 pt heading, 11 pt body ---------- */
function makePdf(pagesIn) {
  const pageText = pagesIn || [
    [[20, 780, "Acute leukaemia"], [11, 750, "Acute myeloid leukaemia shows more than twenty percent myeloblasts in the marrow."],
      [11, 735, "Auer rods are needle shaped aggregates of azurophilic granules."], [11, 720, "Disseminated intravascular coagulation complicates the promyelocytic subtype."]],
    [[16, 780, "Management"], [11, 750, "Induction combines cytarabine with an anthracycline for seven plus three days."],
      [11, 735, "All trans retinoic acid and arsenic trioxide cure most promyelocytic cases."], [11, 720, "Tumour lysis syndrome is prevented with hydration and allopurinol before induction."]],
  ];
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const pobj = pageText.map((_, k) => 3 + 2 * k), font = 3 + 2 * pageText.length;
  objs[2] = "<< /Type /Pages /Kids [" + pobj.map((o) => o + " 0 R").join(" ") + "] /Count " + pageText.length + " >>";
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pobj.forEach((po, k) => {
    const stream = pageText[k].map(([size, y, t]) => `BT /F1 ${size} Tf 50 ${y} Td (${t}) Tj ET`).join("\n");
    objs[po] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${po + 1} 0 R >>`;
    objs[po + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/* ---------- the mocked server: one op per call ---------- */
const sha12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const api = { mode: "ok", calls: [], other: [], decks: new Set(), month: 3, day: 0 };
function genReply(body, auth) {
  api.calls.push({ op: body.op, body, auth });
  if (auth !== "Bearer test-token") return [401, { error: "sign-in" }];
  if (!body.idem || !/^[0-9a-f]{12}$/.test(body.idem)) return [400, { error: "bad-input" }];
  if (api.mode === "month" && body.op === "facts") return [429, { error: "month-decks", reason: "month-decks" }];
  if (body.op === "facts" && !api.decks.has(body.deckId)) { api.decks.add(body.deckId); api.month++; api.day++; }
  const usage = { inTok: 1200, outTok: 400, thinkTok: 0, inr: 0.0864, deckTok: 1600, deckCapTok: 200000, dayDecks: api.day, monthDecks: api.month };
  if (body.op === "facts") return [200, { facts: body.chunk.sents.slice(0, 15).map((s) => ({ fid: "f_" + sha12(body.deckId + s.n), ft: s.tx, cq: "Recall this: " + s.tx.replace(/\.$/, "") + "?", sn: [s.n], fk: "recall", quote: s.tx, p: s.p, h: s.h })), usage }];
  if (body.op === "mcq") return [200, { items: body.facts.map((f) => ({ id: "q_" + sha12(body.deckId + f.fid + (body.avoid ? "r" : "")), q: "Which statement matches the source? " + f.ft,
    o: ["It is true as stated", "It applies only to children", "It was withdrawn in 2010", "It needs no follow up"], a: 0, r: ["Matches the source", "No age limit stated", "Not withdrawn", "Follow up needed"],
    et: [null, "knowledge", "knowledge", "mgmt"], exp: "Matches the source", kp: "Read the source sentence again.", d: 2, cog: "recall", fid: f.fid, prov: "AI", ex: [body.exam], pv: "p1", mv: "gemini-3.1-flash-lite", rv: null })), usage }];
  if (body.op === "solve") return [200, { solved: body.q.map((q) => ({ id: q.id, ok: true, ot: q.o[q.a] })), usage }];
  if (body.op === "review") return [200, { gates: body.q.map((q, i) => ({ i, g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true, old: false, why: "" })), usage }];
  return [400, { error: "bad-input" }];
}

await ensureServer();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--disable-gpu"], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = ""; chrome.stderr.on("data", (d) => { chromeErr += d; });

let msgId = 1; const pending = new Map(); let ws, sessionId; const errors = [];
const call = (m, p) => { const i = msgId++; return new Promise((r) => { pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {}, sessionId })); }); };
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: `(function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const shot = async (name) => { if (!process.env.SHOTS) return; const r = await call("Page.captureScreenshot", { format: "png" }); if (r.result) writeFileSync(join(process.env.SHOTS, "prep-c-" + name + ".png"), Buffer.from(r.result.data, "base64")); };
const screenText = () => ev(`var r=document.getElementById("smdPrep"); return r ? r.innerText : "";`);
// Every visible button in the current Layer C screen is at least 44 CSS px tall (offsetHeight: the app zooms the page to 0.95).
const smallButtons = () => ev(`var r=document.getElementById("smdPrep"); if(!r) return "none"; return [].filter.call(r.querySelectorAll("button"), function(b){ return b.offsetParent && b.offsetHeight < 44; }).map(function(b){ return (b.getAttribute("data-act")||"") + ":" + b.offsetHeight; }).join(",");`);
const unlabelled = () => ev(`var r=document.getElementById("smdPrep"); return [].filter.call(r.querySelectorAll("button"), function(b){ return !(b.textContent.trim() || b.getAttribute("aria-label")); }).length;`);

const NOTES = [
  "# Iron deficiency anaemia",
  "Iron deficiency is the commonest cause of anaemia in Indian women of reproductive age.",
  "Serum ferritin below 15 ng/mL confirms depleted iron stores.",
  "Microcytic hypochromic red cells with pencil forms are typical on the peripheral smear.",
  "Oral ferrous sulphate 200 mg three times daily supplies about 180 mg elemental iron.",
  "Haemoglobin should rise by roughly 2 g/dL within three weeks of adequate oral therapy.",
  "Patient name: Ramesh Kumar",
  "Call his son on 98765 43210 before the transfusion.",
  "",
  "MEGALOBLASTIC ANAEMIA",
  "Vitamin B12 deficiency causes subacute combined degeneration of the spinal cord.",
  "Hypersegmented neutrophils with five or more lobes appear early in folate deficiency.",
  "Pernicious anaemia results from autoantibodies against gastric intrinsic factor.",
  "Folic acid alone may worsen neurological damage when cobalamin is also lacking.",
  "Strict vegetarians frequently develop dietary cobalamin shortage over several years.",
  "Methylmalonic acid rises in cobalamin deficiency but stays normal with folate lack.",
  "",
  "Haemolytic anaemia:",
  "Spherocytes and raised osmotic fragility point towards hereditary spherocytosis.",
  "Glucose six phosphate dehydrogenase deficiency triggers haemolysis after primaquine exposure.",
  "Bite cells and Heinz bodies accompany oxidant injury to erythrocytes.",
  "Direct antiglobulin testing distinguishes immune destruction from intrinsic membrane defects.",
].join("\n");

try {
  let ver, t = 0; while (t++ < 300) { try { ver = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  if (!ver) throw new Error("Chrome did not start within 60 s: " + chromeErr.slice(-800));
  ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; if (/prep|PREP/.test(JSON.stringify(d))) errors.push((d.exception && d.exception.description) || d.text); }
    if (m.method === "Fetch.requestPaused") {
      const p = m.params, url = p.request.url;
      let status = 404, body = { error: "not-found", note: "blocked by the test harness" };
      if (/\/api\/ai\/prep-generate/.test(url)) {
        let post = p.request.postData;
        if (!post && p.request.hasPostData) { const r = await call("Fetch.getRequestPostData", { requestId: p.requestId }); post = r.result && r.result.postData; }
        const h = p.request.headers || {};
        [status, body] = genReply(JSON.parse(post || "{}"), h.Authorization || h.authorization);
      } else api.other.push(url);
      call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("DOM.enable", {});
  // Every /api/ request stops here and is answered locally: serve.mjs would otherwise proxy it to a real host.
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.confirm=function(){return true;}; try{localStorage.setItem("smd_prep","1");}catch(e){}` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots with the PrepNucleus loader");
  await ev(clean);
  await ev(`try{localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_prep_c_caps");}catch(e){} indexedDB.deleteDatabase("prep-gen"); return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return PREP.isOpen && PREP.isOpen() && !!document.querySelector("#smdPrep .pn-tile");`, 20000), "PrepNucleus opens (fixture bank)");

  // prep-loader.js loads the Layer C files on first open, after prep.js, in this order.
  ok(await ev(`return PREP_LOADER.JS.slice(-4).join(",") + "|" + PREP_LOADER.CSS.join(",");`) === LAYER_C_JS.join(",") + "|prep.css," + LAYER_C_CSS.join(","), "prep-loader.js lists the Layer C files in load order");
  ok(await until(`return !!(window.PREP_SRC && window.PREP_DECKS && window.PREP_CARDS && window.PREP_C && document.querySelector('link[data-prep="prep-create.css"]'));`, 10000), "the loader loaded PREP_SRC, PREP_DECKS, PREP_CARDS, PREP_C and prep-create.css");
  await ev(`PREP_C.cfg.gap = 0; PREP.close(); PREP.open(); window.SMD_AUTH = { currentUser: { uid: "u-test", getIdToken: function () { return Promise.resolve("test-token"); } } }; return 1;`);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act="c-home"]');`, 10000), "home shows the Your decks card");

  // ---- Your decks (empty)
  await click('#smdPrep [data-act="c-home"]');
  ok(await until(`var e=document.querySelector("#pcDecks .pn-empty"); return !!e && /No decks yet/.test(e.textContent);`, 10000), "Your decks: empty state");
  await shot("decks-empty");

  // ---- Make a deck from pasted notes
  await click('#smdPrep [data-act="c-new"]');
  ok(await until(`return !!document.getElementById("pcText");`), "Make a deck: paste box");
  ok(await smallButtons() === "", "create screen: every button is at least 44 px tall " + await smallButtons());
  await ev(`var t=document.getElementById("pcText"); t.value=${JSON.stringify(NOTES)}; t.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var e=document.getElementById("pcErr"); return !!e && /Confirm that these are your own notes/.test(e.textContent);`), "Make without the confirmation asks for it");
  ok(await ev(`return document.getElementById("pcText").value.length;`) === NOTES.length, "the pasted text survives the rerender");
  await click('#smdPrep [data-act="c-own"]');
  await shot("create");
  const before = api.calls.length;
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var w=document.querySelector("#pcScrubView .pc-warn"); return !!w && /1 patient name, 1 phone number/.test(w.textContent);`), "personal details found: the warning names them before anything is sent");
  ok(api.calls.length === before, "nothing is sent while the warning is open");
  await shot("scrub");
  await click('#smdPrep [data-act="c-scrubok"]');
  ok(await until(`var v=document.getElementById("pcProgView"); return !!v && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "the step loop runs to the end: Deck saved");
  await shot("done");
  const ops = api.calls.map((c) => c.op);
  ok(ops.join(",") === "facts,facts,facts,mcq,mcq,solve,solve,review,review", "one POST per op, in order: " + ops.join(","));
  ok(api.calls.every((c) => c.auth === "Bearer test-token" && /^[0-9a-f]{12}$/.test(c.body.idem) && /^gen_[0-9a-f]{12}$/.test(c.body.deckId) && c.body.exam === "neet-pg" && c.body.pv === "p1"), "every call carries the ID token, an idem key, the deck id, exam and prompt version");
  ok(new Set(api.calls.map((c) => c.body.idem)).size === api.calls.length, "each call has its own idem key");
  const allSent = JSON.stringify(api.calls.map((c) => c.body));
  ok(!/Ramesh|98765/.test(allSent), "the patient name and phone number never reach the server");
  const factsSents = api.calls.filter((c) => c.op === "facts").flatMap((c) => c.body.chunk.sents);
  ok(factsSents.map((s) => s.n).join(",") === "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16" && factsSents.every((s) => Object.keys(s).sort().join() === "h,n,p,tx"), "sentences numbered once across the document, sent as { n, p, h, tx }");
  ok(factsSents[0].h === "Iron deficiency anaemia" && factsSents[15].h === "Haemolytic anaemia" && factsSents[5].tx === "Call his son on [removed] before the transfusion." && !factsSents.some((s) => /^\[removed\]/.test(s.tx)), "sentence headings come from the note headings; a line left empty by the scrub is not sent");
  const text = await screenText();
  ok(/14\s+new questions/.test(text) && /14 in the deck/.test(text), "progress result: 14 new questions" + (/14\s+new/.test(text) ? "" : ": " + text.slice(0, 200)));
  ok(/AI cost so far: Rs /.test(text) && /4 of 10 decks this month, 1 of 3 today/.test(text), "shows the cost line and the cap line from the server's counters");
  ok(!DASH.test(text), "no em or en dash on screen");

  // ---- the deck in the list
  await click('#smdPrep [data-act="c-done"]');
  ok(await until(`var d=document.querySelectorAll("#pcDecks .pc-deck"); return d.length === 1 && /14 questions/.test(d[0].textContent) && /AI-generated educational content/.test(d[0].textContent);`, 10000), "Your decks lists the deck: 14 questions, labelled AI-generated");
  ok(await smallButtons() === "", "deck list: every button is at least 44 px tall " + await smallButtons());
  ok(await unlabelled() === 0, "every button has a label");
  ok(/4 of 10 decks this month/.test(await screenText()), "the cap line shows on Your decks");
  const deckId = await ev(`return document.querySelector('#pcDecks [data-act="c-prac"]').getAttribute("data-d");`);
  ok(/^gen_[0-9a-f]{12}$/.test(deckId), "deck id " + deckId);
  await shot("decks");

  // ---- practise: FSRS cards under p:deck-<id>, label in the runner
  await click('#smdPrep [data-act="c-prac"]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-opt");`, 10000), "Practise opens the shared question runner");
  await click('#smdPrep .pn-opt[data-k="0"]');
  ok(await until(`var f=document.querySelector("#smdPrep .pn-fb"); return !!f && /Correct/.test(f.textContent) && /AI-generated, auto-checked/.test(f.textContent);`, 5000), "the answer is marked and the item is labelled AI-generated");
  const keys = await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).cards).join(",");`);
  ok(keys.split(",").some((k) => k.indexOf("p:deck-" + deckId + ":q_") === 0), "an FSRS card is written under p:deck-<id>: " + keys.slice(0, 80));
  await shot("practise");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`return !!document.querySelector("#pcDecks .pc-deck") && /1 due|questions/.test(document.querySelector("#pcDecks .pc-deck").textContent);`, 5000), "back from the runner lands on Your decks");

  // ---- timed test opens with a clock
  await click('#smdPrep [data-act="c-test"]');
  ok(await until(`return !!document.getElementById("pnClock") && document.querySelectorAll("#smdPrep .pn-opt").length === 4;`, 5000), "Timed test opens the runner with a clock");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#pcDecks .pc-deck");`, 5000);

  // ---- flashcards: p:cards-<id>
  await click('#smdPrep [data-act="c-cards"]');
  ok(await until(`return !!document.getElementById("pcFlip") && !!document.querySelector("#pcCardsView .pc-front");`, 5000), "Cards shows a front and Show answer");
  await click("#pcFlip");
  ok(await until(`var b=document.getElementById("pcBack"); return !!b && /From your source: (Iron deficiency anaemia|MEGALOBLASTIC ANAEMIA|Haemolytic anaemia)/.test(b.textContent);`, 5000), "the back shows the fact and the section it came from");
  ok(await smallButtons() === "", "cards: every button is at least 44 px tall " + await smallButtons());
  await shot("card");
  await click('#smdPrep [data-act="c-kyes"]');
  const ck = await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).cards).filter(function(k){return k.indexOf("p:cards-${deckId}:c_")===0;}).length;`);
  ok(ck === 1, "I knew it writes an FSRS card under p:cards-<id>");
  ok(await until(`return /Card 2 of/.test(document.querySelector("#smdPrep .pn-bar p").textContent);`, 3000), "the next card follows");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#pcDecks .pc-deck");`, 5000);

  // ---- 10 more: only unused facts, no new deck counted
  api.calls.length = 0;
  await click('#smdPrep [data-act="c-more"]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved|Deck paused/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "10 more runs");
  const used = new Set();
  ok(api.calls.filter((c) => c.op === "facts").length === 0 && api.calls.filter((c) => c.op === "mcq").flatMap((c) => c.body.facts.map((f) => f.fid)).every((f) => !used.has(f) && used.add(f)), "10 more reads no chunk again and sends each fact once");
  ok(/\b2\s+new questions/.test(await screenText()) && /16 in the deck/.test(await screenText()), "10 more uses the two facts left: 16 in the deck");
  await click('#smdPrep [data-act="c-done"]');

  // ---- a PDF source: font-size headings, page numbers
  api.calls.length = 0;
  const dir = join(process.env.CLAUDE_JOB_DIR || tmpdir(), "prep-c-" + Date.now()); mkdirSync(dir, { recursive: true });
  const pdfPath = join(dir, "AML chapter.pdf"); writeFileSync(pdfPath, makePdf(), "latin1");
  await until(`return !!document.querySelector('#smdPrep [data-act="c-new"]');`, 5000);
  await click('#smdPrep [data-act="c-new"]');
  await until(`return !!document.querySelector('#smdPrep [data-act="c-src"][data-v="pdf"]');`);
  await click('#smdPrep [data-act="c-src"][data-v="pdf"]');
  ok(await until(`return !!document.getElementById("pcFile") && !!document.querySelector('#smdPrep [data-act="c-pick"]');`), "PDF source: Choose a PDF");
  const { result: { root } } = await call("DOM.getDocument", { depth: 0 });
  const { result: { nodeId } } = await call("DOM.querySelector", { nodeId: root.nodeId, selector: "#pcFile" });
  await call("DOM.setFileInputFiles", { nodeId, files: [pdfPath] });
  ok(await until(`var f=document.querySelector("#pcCreateView .pc-file"); return !!f && /AML chapter\\.pdf/.test(f.textContent) && /2 pages/.test(f.textContent) && document.getElementById("pcPages").value === "1-2";`, 20000), "the vendored pdf.js opens the PDF: 2 pages, pages 1-2 preselected");
  ok(await ev(`return document.getElementById("pcTitle").value;`) === "AML chapter", "the deck name defaults to the file name");
  await ev(`var p=document.getElementById("pcPages"); p.value="5"; p.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var e=document.getElementById("pcErr"); return !!e && /has 2 pages/.test(e.textContent);`, 5000), "a page outside the PDF is refused in plain words");
  await ev(`var p=document.getElementById("pcPages"); p.value="1-2"; p.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "the PDF deck is made");
  const pdfSents = api.calls.filter((c) => c.op === "facts").flatMap((c) => c.body.chunk.sents);
  ok(pdfSents.length === 6 && pdfSents.map((s) => s.p).join(",") === "1,1,1,2,2,2", "PDF sentences carry their page: " + pdfSents.map((s) => s.n + "/" + s.p).join(" "));
  ok(pdfSents[0].h === "Acute leukaemia" && pdfSents[3].h === "Management", "PDF headings come from the larger font sizes: " + pdfSents.map((s) => s.h).join(" | "));
  ok(!pdfSents.some((s) => /^Acute leukaemia$|^Management$/.test(s.tx)), "headings are not sent as sentences");
  await click('#smdPrep [data-act="c-done"]');
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-deck").length === 2;`, 5000), "two decks listed");

  // ---- 429 month-decks: plain message, nothing saved
  api.mode = "month"; api.calls.length = 0;
  await click('#smdPrep [data-act="c-new"]');
  await until(`return !!document.querySelector('#smdPrep [data-act="c-src"][data-v="paste"]');`);
  await click('#smdPrep [data-act="c-src"][data-v="paste"]');
  await until(`return !!document.getElementById("pcText");`);
  await ev(`var t=document.getElementById("pcText"); t.value=${JSON.stringify(NOTES.replace(/Patient name.*\n/, "").replace(/Call his son.*\n/, "").replace(/Iron/g, "Ferrous"))}; t.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var e=document.getElementById("pcErr"); return !!e && /You have made 10 decks this month, the monthly limit/.test(e.textContent);`, 15000), "429 month-decks: the monthly-limit message");
  ok(await ev(`return !document.querySelector('#pcProgView [data-act="c-resume"]');`) === true, "no Try again for a monthly cap");
  ok(/Deck not made/.test(await screenText()) && /Nothing was saved and no deck was counted/.test(await screenText()) && /10 of 10 decks this month/.test(await screenText()), "the refusal says nothing was saved and the cap line shows the month as full");
  ok(api.calls.length === 1 && api.calls[0].op === "facts", "the run stops at the first refused call");
  await shot("month-cap");
  await click('#smdPrep [data-act="c-done"]');
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-deck").length === 2;`, 5000), "the refused deck is not saved");
  api.mode = "ok";

  // ---- delete: the deck and its FSRS memory go
  await ev(`var b=[].filter.call(document.querySelectorAll('#pcDecks [data-act="c-del"]'), function(x){return x.getAttribute("data-d")===${JSON.stringify(deckId)};})[0]; b.click(); return 1;`);
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-deck").length === 1;`, 5000), "Delete removes the deck from the list");
  ok(await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).cards).filter(function(k){return k.indexOf("${deckId}")>=0;}).length;`) === 0, "and its FSRS cards from the store");

  // ---- a scanned page (Phase 3b): page 1 has a text layer, page 2 is an image-only page with no text
  const scanPdf = join(dir, "Marrow scan.pdf");
  writeFileSync(scanPdf, makePdf([[[20, 780, "Bone marrow failure"], [11, 750, "Aplastic anaemia presents with pancytopenia and a hypocellular marrow on biopsy."],
    [11, 735, "Fanconi anaemia is inherited and often shows thumb anomalies and short stature."], [11, 720, "Paroxysmal nocturnal haemoglobinuria lacks CD55 and CD59 on red cells."]], []]), "latin1");
  api.calls.length = 0;
  await click('#smdPrep [data-act="c-new"]');
  await until(`return !!document.querySelector('#smdPrep [data-act="c-src"][data-v="pdf"]');`);
  await click('#smdPrep [data-act="c-src"][data-v="pdf"]');
  await until(`return !!document.getElementById("pcFile");`);
  ok(/read only in the StewardMD phone app/.test(await screenText()), "web build: the create screen says scans are read only in the app");
  { const { result: { root: r2 } } = await call("DOM.getDocument", { depth: 0 }); const { result: { nodeId: n2 } } = await call("DOM.querySelector", { nodeId: r2.nodeId, selector: "#pcFile" }); await call("DOM.setFileInputFiles", { nodeId: n2, files: [scanPdf] }); }
  ok(await until(`var f=document.querySelector("#pcCreateView .pc-file"); return !!f && /Marrow scan\.pdf/.test(f.textContent) && /2 pages/.test(f.textContent);`, 20000), "the scanned PDF opens");
  await ev(`var p=document.getElementById("pcPages"); p.value="2"; p.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var e=document.getElementById("pcErr"); return !!e && /These pages are scanned images. Scans are read only in the StewardMD phone app, not on the web/.test(e.textContent);`, 15000), "web build, scanned page only: a clear message and nothing sent");
  ok(api.calls.length === 0, "no request for an unreadable source");
  // The app: on-device OCR through a stubbed SMD_NATIVE.ocr (native-bridge.js shape: { text, lines, boxes }).
  await ev(`window.__ocr = []; window.SMD_NATIVE = { ocr: function (img, opts) { window.__ocr.push([String(img).slice(0, 23), img.length, opts && opts.languageCorrection]); return Promise.resolve({ text: "DIAGNOSIS\\nBone marrow biopsy confirms the diagnosis in most adults.\\nFlow cytometry shows myeloid markers on the blasts.\\nCytogenetics guides the choice of therapy.", lines: [], boxes: [] }); } }; return 1;`);
  await ev(`var p=document.getElementById("pcPages"); p.value="1-2"; p.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "the app: the deck is made with the scanned page read by OCR");
  const ocrCalls = String(await ev(`return JSON.stringify(window.__ocr || null);`));
  ok(/^\[\["data:image\/jpeg;base64,",\d+,true\]\]$/.test(ocrCalls) && JSON.parse(ocrCalls)[0][1] > 5000, "only the scanned page is rendered by pdf.js and sent to on-device OCR, as a JPEG: " + ocrCalls.slice(0, 60));
  const scanSents = api.calls.filter((c) => c.op === "facts").flatMap((c) => c.body.chunk.sents);
  ok(scanSents.map((x) => x.p).join(",") === "1,1,1,2,2,2" && scanSents[3].h === "DIAGNOSIS" && /Bone marrow biopsy/.test(scanSents[3].tx) && scanSents.every((x) => Object.keys(x).sort().join() === "h,n,p,tx"), "OCR text goes through the same sentence pipeline: " + scanSents.map((x) => x.n + "/" + x.p).join(" "));
  ok(/1 page read by on-device OCR/.test(await screenText()), "the progress screen says a page was read by OCR");
  ok(!JSON.stringify(api.calls).includes("data:image"), "no image is ever sent to the server");
  await click('#smdPrep [data-act="c-done"]');
  ok(await until(`return [].some.call(document.querySelectorAll("#pcDecks .pc-deck"), function (d) { return /Marrow scan/.test(d.textContent) && /partly read by OCR/.test(d.textContent); });`, 5000), "the deck list marks the deck as partly read by OCR");
  await ev(`delete window.SMD_NATIVE; return 1;`);

  ok(api.other.every((u) => /\/api\//.test(u)), "every other /api/ request was answered locally (" + api.other.length + "), none left the machine");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: PrepNucleus Layer C" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally { try { ws && ws.close(); } catch {} chrome.kill(); if (serveProc) serveProc.kill(); process.exit(fails === 0 ? 0 : 1); }
