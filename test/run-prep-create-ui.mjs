/* PrepNucleus Layer C in the REAL app (headless Chromium over raw CDP): Your decks, Make a deck from pasted notes and
 * from a digital PDF, the step loop against a MOCKED /api/ai/prep-generate, practice and flashcards with FSRS, delete,
 * and the 429 month-decks message. Owner request 2026-10-09: the steps (source, pages, settings), the page picker on a
 * synthetic 500-page PDF (virtual grid, lazy thumbnails, the 60-page cap for taps, ranges and typing), the deck screen
 * as a module with progress, "Make 10 more" up to 50 with MaiK Tokens shown before and after, and a deck brought back
 * from the account (MOCKED /api/prep/decks) after IndexedDB is cleared. SHOTS=<dir> saves 390, 820 and 1180 px wide
 * screenshots, dark and light. The Chrome profile is deleted at the end.
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
import { freePort } from "./free-port.mjs";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "http://localhost:" + (process.env.PORT || await freePort()) + "/").replace(/\/?$/, "/");
const PORT = +(process.env.CHROME_PORT || await freePort()), userDir = (process.env.CLAUDE_JOB_DIR || tmpdir()) + "/prep-create-chrome-" + PORT + "-" + Date.now();
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

/* A long synthetic PDF: n pages, each a 18 pt heading and four body lines of its own words (so every page reads as
   text and the picker has something to draw). */
function makeBigPdf(n) {
  const W = ["renal", "cardiac", "hepatic", "pulmonary", "neural", "gastric", "splenic", "dermal", "ocular", "osseous", "vascular", "endocrine"];
  const pages = [];
  for (let k = 1; k <= n; k++) {
    const w = (i) => W[(k * 7 + i * 5) % W.length];
    pages.push([[18, 780, "Topic " + k + " " + w(1) + " disorders"], [11, 750, "The " + w(2) + " finding " + k + " is linked with " + w(3) + " change in adults."],
      [11, 735, "Treatment " + k + " starts with " + w(4) + " support and careful monitoring."], [11, 720, "Complication " + k + " involves the " + w(5) + " system in severe cases."],
      [11, 705, "Prognosis " + k + " depends on early " + w(6) + " assessment and follow up."]]);
  }
  return makePdf(pages);
}

/* ---------- the mocked server: one op per call ---------- */
const sha12 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const api = { mode: "ok", calls: [], other: [], decks: new Set(), month: 3, day: 0, backup: new Map(), salt: Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255)).toString("base64"), bk: [] };
/* /api/prep/decks: the account backup, in memory (opaque base64 blobs, as the server keeps them). */
function decksReply(method, path, body) {
  api.bk.push(method + " " + (path || ""));
  if (!path && method === "GET") return [200, { salt: api.salt, decks: [...api.backup.entries()].map(([id, b]) => ({ id, size: b.length, at: 1 })) }];
  if (method === "PUT") { api.backup.set(path, body); return [200, { id: path, at: Date.now() }]; }
  if (method === "GET") return api.backup.has(path) ? [200, api.backup.get(path), "text/plain"] : [404, { error: "not-found" }];
  if (method === "DELETE") { api.backup.delete(path); return [200, { deleted: true }]; }
  return [405, { error: "method-not-allowed" }];
}
function genReply(body, auth) {
  api.calls.push({ op: body.op, body, auth });
  if (auth !== "Bearer test-token") return [401, { error: "sign-in" }];
  if (!body.idem || !/^[0-9a-f]{12}$/.test(body.idem)) return [400, { error: "bad-input" }];
  if (api.mode === "month" && body.op === "facts") return [429, { error: "month-decks", reason: "month-decks" }];
  if (body.op === "facts" && !api.decks.has(body.deckId)) { api.decks.add(body.deckId); api.month++; api.day++; }
  const usage = { inTok: 1200, outTok: 400, thinkTok: 0, inr: 0.0864, mt: 173, deckTok: 1600, deckCapTok: 600000, dayDecks: api.day, monthDecks: api.month };
  if (body.op === "facts") return [200, { facts: body.chunk.sents.slice(0, 15).map((s) => ({ fid: "f_" + sha12(body.deckId + s.n), ft: s.tx, cq: "Recall this: " + s.tx.replace(/\.$/, "") + "?", sn: [s.n], fk: "recall", quote: s.tx, p: s.p, h: s.h })), usage }];
  if (body.op === "mcq") return [200, { items: body.facts.map((f) => ({ id: "q_" + sha12(body.deckId + f.fid + (body.avoid ? "r" : "")), q: "Which statement matches the source? " + (f.ft || f.quote || ""),
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
const evA = async (e) => { const r = await call("Runtime.evaluate", { expression: `(async function(){try{${e}}catch(x){return "ERR:"+String(x&&x.message||x)}})()`, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
const shotCall = async (p) => { await ev(`document.getAnimations().forEach(function (a) { try { var t = a.effect && a.effect.getTiming(); if (t && t.iterations !== Infinity) a.finish(); } catch (e) {} }); return 1;`); return call("Page.captureScreenshot", p); };
const until = async (e, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(e) === true) return true; await sleep(150); } return false; };
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const click = (sel) => ev(`var b=document.querySelector(${JSON.stringify(sel)}); if(!b) return "missing"; b.click(); return 1;`);
const SIZES = [[390, 844, 2, true], [820, 1180, 2, true], [1180, 820, 2, true]];
const setSize = async ([w, h, d, mob]) => { await call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: d, mobile: mob }); await ev(`window.dispatchEvent(new Event("resize")); return 1;`); await sleep(350); };
/* One screen at 390, 820 and 1180 px, dark and light; back to 390 dark after. */
const shots = async (name, prep) => {
  if (!process.env.SHOTS) return;
  mkdirSync(process.env.SHOTS, { recursive: true });
  await ev(`if (!document.getElementById("pnNoTr")) { var t = document.createElement("style"); t.id = "pnNoTr"; t.textContent = "*{transition:none!important}"; document.head.appendChild(t); } return 1;`);
  for (const sz of SIZES) {
    await setSize(sz);
    if (prep) await prep();
    for (const theme of ["dark", "light"]) {
      await ev(theme === "dark" ? `document.body.classList.add("dark"); return 1;` : `document.body.classList.remove("dark"); return 1;`);
      await sleep(350);
      const r = await shotCall({ format: "png" });
      if (r.result) writeFileSync(join(process.env.SHOTS, "prep-c-" + name + "-" + sz[0] + "-" + theme + ".png"), Buffer.from(r.result.data, "base64"));
    }
  }
  await setSize(SIZES[0]);
  await ev(`document.body.classList.add("dark"); var t=document.getElementById("pnNoTr"); if (t) t.remove(); return 1;`);
};
const screenText = () => ev(`var r=document.getElementById("smdPrep"); return r ? r.innerText : "";`);
const title = () => ev(`var h=document.querySelector("#smdPrep .pn-bar h1"); return h ? h.textContent : "";`);
// Every visible button in the current Layer C screen is at least 44 CSS px tall (offsetHeight: the app zooms the page to 0.95).
const smallButtons = () => ev(`var r=document.getElementById("smdPrep"); if(!r) return "none"; return [].filter.call(r.querySelectorAll("button"), function(b){ return b.offsetParent && b.offsetHeight < 44 && !b.classList.contains("pc-pc"); }).map(function(b){ return (b.getAttribute("data-act")||"") + ":" + b.offsetHeight; }).join(",");`);
const unlabelled = () => ev(`var r=document.getElementById("smdPrep"); return [].filter.call(r.querySelectorAll("button"), function(b){ return !(b.textContent.trim() || b.getAttribute("aria-label")); }).length;`);
const setFile = async (path) => { const { result: { root } } = await call("DOM.getDocument", { depth: 0 }); const { result: { nodeId } } = await call("DOM.querySelector", { nodeId: root.nodeId, selector: "#pcFile" }); await call("DOM.setFileInputFiles", { nodeId, files: [path] }); };
const typeSpec = (v) => ev(`var i=document.getElementById("pcPgSpec"); i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event("input")); document.getElementById("pcPgForm").requestSubmit(); return 1;`);
const pgCount = () => ev(`var e=document.getElementById("pcPgN"); return e ? e.textContent : "";`);
const openDeck = (re) => ev(`var b=[].filter.call(document.querySelectorAll('#pcDecks [data-act="c-open"]'), function(x){ return ${re}.test(x.textContent); })[0]; if(!b) return "missing"; b.click(); return 1;`);
const pasteDeck = async (text) => {
  await click('#smdPrep [data-act="c-new"]');
  await until(`return !!document.getElementById("pcText");`);
  await ev(`var t=document.getElementById("pcText"); t.value=${JSON.stringify(text)}; t.dispatchEvent(new Event("input")); return 1;`);
  await click('#smdPrep [data-act="c-next"]');
  await until(`return !!document.getElementById("pcSetView");`);
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
};

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
// A long note for the 10-at-a-time run to 50: 60 sentences, each with its own words.
const SYL = ["ka", "lo", "mi", "ne", "tu", "ra", "so", "vi", "de", "po", "zu", "fe", "gi", "ha", "ju", "be"];
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const word = () => SYL[Math.floor(rnd() * 16)] + SYL[Math.floor(rnd() * 16)] + SYL[Math.floor(rnd() * 16)];
// Six sections of ten (the mocked facts op, like the server, returns at most 15 facts a chunk).
const LONG = "# Revision sheet\n" + Array.from({ length: 60 }, (_, i) => (i && i % 10 === 0 ? "\n# Part " + (i / 10 + 1) + "\n" : "") + "Point " + (i + 1) + ": the " + Array.from({ length: 8 }, word).join(" ") + " matters.").join("\n");

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
      let status = 404, body = { error: "not-found", note: "blocked by the test harness" }, ctype = "application/json";
      let post = p.request.postData;
      if (!post && p.request.hasPostData) { const r = await call("Fetch.getRequestPostData", { requestId: p.requestId }); post = r.result && r.result.postData; }
      if (/\/api\/ai\/prep-generate/.test(url)) {
        const h = p.request.headers || {};
        [status, body] = genReply(JSON.parse(post || "{}"), h.Authorization || h.authorization);
      } else if (/\/api\/prep\/decks/.test(url)) {
        const path = url.replace(/^.*\/api\/prep\/decks\/?/, "").replace(/\?.*$/, "");
        let ct; [status, body, ct] = decksReply(p.request.method, path, post || ""); if (ct) ctype = ct;
      } else api.other.push(url);
      if (api.slow && /\/api\/ai\/prep-generate/.test(url)) await sleep(api.slow);
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      call("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: ctype }], body: Buffer.from(raw).toString("base64") });
    }
  };
  const { result: { targetId } } = await call("Target.createTarget", { url: "about:blank" });
  const { result: { sessionId: sid } } = await call("Target.attachToTarget", { targetId, flatten: true }); sessionId = sid;
  await call("Runtime.enable", {}); await call("Page.enable", {}); await call("DOM.enable", {});
  // Every /api/ request stops here and is answered locally: serve.mjs would otherwise proxy it to a real host.
  await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  await setSize(SIZES[0]);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.SMD_PREP_SETUP=false; window.SMD_PREP_BANK_VER="v1"; window.SMD_PREP_PYQ_VER="v2"; window.SMD_PREP_BASE=${JSON.stringify(FIX)}; window.SMD_PREP_BANK_API=${JSON.stringify(FIX + "api/")}; window.confirm=function(){return true;}; window.SMD_PREP_ONBOARD=false; try{localStorage.setItem("smd_prep","1");}catch(e){}` });
  const clean = `["introPoster","splash","accountGate","introOverlay","smdBootSplash"].forEach(function(k){var e=document.getElementById(k); if(e) e.remove();}); return 1;`;
  const signIn = `PREP_C.cfg.gap = 0; window.SMD_AUTH = { currentUser: { uid: "u-test", getIdToken: function () { return Promise.resolve("test-token"); } } }; return 1;`;
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "app boots with the PrepNucleus loader");
  await ev(clean);
  await ev(`try{localStorage.removeItem("smd_prep_v1"); localStorage.removeItem("smd_prep_c_caps"); localStorage.removeItem("smd_prep_deck_del"); localStorage.removeItem("smd_prep_deck_bk");}catch(e){} indexedDB.deleteDatabase("prep-gen"); return 1;`);
  await ev(`PREP.open(); return 1;`);
  ok(await until(`return PREP.isOpen && PREP.isOpen() && !!document.querySelector("#smdPrep .pn-tile");`, 20000), "PrepNucleus opens (fixture bank)");

  ok(await ev(`return PREP_LOADER.JS.slice(-4).join(",") + "|" + PREP_LOADER.CSS.slice(0, 2).join(",");`) === LAYER_C_JS.join(",") + "|prep.css," + LAYER_C_CSS.join(","), "prep-loader.js lists the Layer C files in load order");
  ok(await until(`return !!(window.PREP_SRC && window.PREP_DECKS && window.PREP_CARDS && window.PREP_C && document.querySelector('link[data-prep="prep-create.css"]'));`, 10000), "the loader loaded PREP_SRC, PREP_DECKS, PREP_CARDS, PREP_C and prep-create.css");
  await ev(`PREP.close(); PREP.open(); ` + signIn);
  ok(await until(`return !!document.querySelector('#smdPrep [data-act="c-home"]');`, 10000), "home shows the Your decks card");

  // ---- Your decks (empty)
  await click('#smdPrep [data-act="c-home"]');
  ok(await until(`var e=document.querySelector("#pcDecks .pn-empty"); return !!e && /No decks yet/.test(e.textContent);`, 10000), "Your decks: empty state");
  ok(/kept on this phone and in your account/.test(await screenText()), "the keep note says decks are kept on the phone and in the account");
  await shots("decks-empty");

  // ---- Make a deck from pasted notes: Source, then Settings
  await click('#smdPrep [data-act="c-new"]');
  ok(await until(`return !!document.getElementById("pcText") && /Source/.test(document.querySelector(".pc-steps").textContent);`), "Make a deck: step 1 Source with the paste box");
  ok(await smallButtons() === "", "source screen: every button is at least 44 px tall " + await smallButtons());
  await ev(`var t=document.getElementById("pcText"); t.value=${JSON.stringify(NOTES)}; t.dispatchEvent(new Event("input")); return 1;`);
  await shots("source");
  await click('#smdPrep [data-act="c-next"]');
  ok(await until(`return !!document.getElementById("pcSetView") && document.querySelectorAll('#pcSetView [data-act="c-exam"]').length === 4 && document.querySelectorAll('#pcSetView [data-act="c-diff"]').length === 4;`), "step 2 Settings: exam (4) and difficulty (4) choices");
  ok(/about 4,500 MaiK Tokens/.test(await screenText()), "the settings show the MaiK Tokens 10 questions use");
  ok(/Up to 5 new decks a day and 30 a month/.test(await screenText()), "caps on screen: 5 a day, 30 a month");
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var e=document.getElementById("pcErr"); return !!e && /Confirm that these are your own notes/.test(e.textContent);`), "Make without the confirmation asks for it");
  ok(await ev(`return PREP_C._cs.text.length;`) === NOTES.length, "the pasted text is kept across the steps");
  await click('#smdPrep [data-act="c-diff"][data-v="3"]');
  ok(await ev(`return document.querySelector('#smdPrep [data-act="c-diff"][data-v="3"]').getAttribute("aria-pressed");`) === "true", "difficulty Hard chosen");
  await click('#smdPrep [data-act="c-own"]');
  ok(await smallButtons() === "", "settings: every button is at least 44 px tall " + await smallButtons());
  await shots("settings");
  const before = api.calls.length;
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var w=document.querySelector("#pcScrubView .pc-warn"); return !!w && /1 patient name, 1 phone number/.test(w.textContent);`), "personal details found: the warning names them before anything is sent");
  ok(api.calls.length === before, "nothing is sent while the warning is open");
  await click('#smdPrep [data-act="c-scrubok"]');
  ok(await until(`var v=document.getElementById("pcProgView"); return !!v && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "the step loop runs to the end: Deck saved");
  const ops = api.calls.map((c) => c.op);
  ok(ops.join(",") === "facts,facts,mcq,mcq,solve,solve,review,review", "one POST per op, in order, a round of 10: " + ops.join(","));
  ok(api.calls.every((c) => c.auth === "Bearer test-token" && /^[0-9a-f]{12}$/.test(c.body.idem) && /^gen_[0-9a-f]{12}$/.test(c.body.deckId) && c.body.exam === "neet-pg" && c.body.pv === "p1"), "every call carries the ID token, an idem key, the deck id, exam and prompt version");
  ok(api.calls.filter((c) => c.op === "mcq").every((c) => c.body.mix && c.body.mix.dl === 3), "the chosen difficulty reaches the server as dl 3");
  ok(new Set(api.calls.map((c) => c.body.idem)).size === api.calls.length, "each call has its own idem key");
  const allSent = JSON.stringify(api.calls.map((c) => c.body));
  ok(!/Ramesh|98765/.test(allSent), "the patient name and phone number never reach the server");
  const factsSents = api.calls.filter((c) => c.op === "facts").flatMap((c) => c.body.chunk.sents);
  ok(factsSents.every((s) => Object.keys(s).sort().join() === "h,n,p,tx") && factsSents[0].h === "Iron deficiency anaemia" && factsSents[5].tx === "Call his son on [removed] before the transfusion.", "sentences numbered and scrubbed, sent as { n, p, h, tx }");
  let text = await screenText();
  ok(/10\s+new questions/.test(text) && /10 of 50 in the deck/.test(text), "progress result: 10 new questions, 10 of 50 in the deck" + (/10 of 50/.test(text) ? "" : ": " + text.slice(0, 200)));
  ok(/Used 1,384 MaiK Tokens/.test(text), "the MaiK Tokens the round used (8 calls x 173)");
  ok(/Make 10 more/.test(text) && /10 of 50/.test(text), "Make 10 more offered with 10 of 50");
  ok(!/Cost so far|tokens\)/.test(text) && !/\bAI\b/.test(text) && /4 of 30 decks this month, 1 of 5 today/.test(text), "no rupee or AI line (owner rule); the cap line from the server's counters");
  ok(!DASH.test(text), "no em or en dash on screen");
  await shots("done");
  ok(await (async () => { for (let i = 0; i < 40 && !api.bk.some((x) => /^PUT gen_/.test(x)); i++) await sleep(150); return api.bk.some((x) => /^PUT gen_/.test(x)); })(), "the finished round is backed up to the account: " + api.bk.join(","));
  ok(![...api.backup.values()].some((b) => /Iron|ferritin|Which statement/i.test(Buffer.from(b, "base64").toString("latin1"))), "the backup is ciphertext");

  // ---- the deck in the list, then its own screen (a module with progress)
  await click('#smdPrep [data-act="c-done"]');
  ok(await until(`var d=document.querySelectorAll("#pcDecks .pc-drow"); return d.length === 1 && /10 of 50 questions/.test(d[0].textContent) && !/AI-generated/.test(d[0].textContent);`, 10000), "Your decks lists the deck: 10 of 50 questions, no AI label");
  ok(await smallButtons() === "", "deck list: every button is at least 44 px tall " + await smallButtons());
  ok(await unlabelled() === 0, "every button has a label");
  ok(/4 of 30 decks this month/.test(await screenText()), "the cap line shows on Your decks");
  const deckId = await ev(`return document.querySelector('#pcDecks [data-act="c-open"]').getAttribute("data-d");`);
  ok(/^gen_[0-9a-f]{12}$/.test(deckId), "deck id " + deckId);
  await shots("decks");
  await openDeck("/Iron deficiency anaemia|Iron/");
  ok(await until(`var v=document.getElementById("pcDeckView"); return !!v && !!v.querySelector(".pc-dhero") && /10\\s*of 50 questions/.test(v.textContent) && /Not started yet/.test(v.textContent);`, 10000), "deck screen: 10 of 50 questions, not started yet");
  ok(await ev(`return !!document.querySelector('#pcDeckView [data-act="c-prac"]') && !!document.querySelector('#pcDeckView [data-act="c-test"]') && !!document.querySelector('#pcDeckView [data-act="c-cards"]') && !!document.querySelector('#pcDeckView [data-act="c-more"]');`) === true, "the deck's module rows: Questions, Timed test, Flashcards, and Make more");
  ok(/Make 10 more questions/.test(await screenText()) && /10 of 50 in this deck\. Uses about 1,400 MaiK Tokens/.test(await screenText()), "Make 10 more shows 10 of 50 and the deck's own MaiK Token estimate");
  ok(/NEET-PG · Hard/.test(await ev(`return document.querySelector("#smdPrep .pn-bar .pn-t p").textContent;`)), "the deck's exam and difficulty under its title");
  ok(await smallButtons() === "", "deck screen: every button is at least 44 px tall " + await smallButtons());
  await shots("deck");

  // ---- practise: FSRS cards under p:deck-<id>
  await click('#smdPrep #pcDeckView [data-act="c-prac"]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-opt");`, 10000), "Questions opens the shared question runner");
  await click('#smdPrep .pn-opt[data-k="0"]');
  ok(await until(`var f=document.querySelector("#smdPrep .pn-fb"); return !!f && /Correct/.test(f.textContent) && !/AI-generated/.test(f.textContent);`, 5000), "the answer is marked, with no AI label (owner rule)");
  const keys = await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).cards).join(",");`);
  ok(keys.split(",").some((k) => k.indexOf("p:deck-" + deckId + ":q_") === 0), "an FSRS card is written under p:deck-<id>");
  await ev(`PREP.back(); return 1;`);
  ok(await until(`var v=document.getElementById("pcDeckView"); return !!v && /1 answered · 100% correct/.test(v.textContent);`, 5000), "back from the runner lands on the deck screen, now with its progress: 1 answered, 100% correct");

  // ---- timed test and flashcards from the deck screen
  await click('#smdPrep #pcDeckView [data-act="c-test"]');
  ok(await until(`return !!document.getElementById("pnClock") && document.querySelectorAll("#smdPrep .pn-opt").length === 4;`, 5000), "Timed test opens the runner with a clock");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.getElementById("pcDeckView") && !!document.querySelector("#pcDeckView .pc-dhero");`, 5000);
  await click('#smdPrep #pcDeckView [data-act="c-cards"]');
  ok(await until(`return !!document.getElementById("pcFlip") && !!document.querySelector("#pcCardsView .pc-front");`, 5000), "Flashcards shows a front and Show answer");
  await click("#pcFlip");
  await click('#smdPrep [data-act="c-kyes"]');
  ok(await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).cards).filter(function(k){return k.indexOf("p:cards-${deckId}:c_")===0;}).length;`) === 1, "I knew it writes an FSRS card under p:cards-<id>");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#pcDeckView .pc-dhero");`, 5000);

  // ---- 10 more: the facts left and the last chunk, no new deck counted
  api.calls.length = 0;
  await click('#smdPrep #pcDeckView [data-act="c-more"]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved|Deck paused/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "Make 10 more runs");
  const used = new Set();
  ok(api.calls.filter((c) => c.op === "mcq").flatMap((c) => c.body.facts.map((f) => f.fid)).every((f) => !used.has(f) && used.add(f)), "each fact is sent once");
  text = await screenText();
  ok(/16 of 50 in the deck/.test(text), "the source had 6 facts left: 16 of 50 in the deck" + (/16 of 50/.test(text) ? "" : ": " + text.slice(0, 160)));
  ok(/Every part of this source has been used|Saved on this phone/.test(text), "and says so");
  await click('#smdPrep [data-act="c-done"]');
  await until(`return !!document.querySelector("#pcDeckView .pc-dhero");`, 5000);
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#pcDecks .pc-drow");`, 5000);

  // ---- 10 at a time to 50, from a long note
  api.calls.length = 0;
  await pasteDeck(LONG);
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "the long-note deck: first 10");
  let counts = [];
  for (let k = 0; k < 4; k++) {
    counts.push(((await screenText()).match(/(\d+) of 50 in the deck/) || [])[1]);
    if (k === 0) api.slow = 1500;
    await click('#smdPrep #pcProgView [data-act="c-more"]');
    if (k === 0) {
      ok(await until(`var v=document.getElementById("pcProgView"); return !!v && /Making your deck/.test(document.querySelector("#smdPrep .pn-bar h1").textContent) && !!v.querySelector(".pc-stages li.on");`, 10000), "while it runs: the live stage list and the real count (no made-up percentage)");
      ok(/of 10 questions ready/.test(await screenText()) && !/%/.test(await screenText()), "the progress counts questions, never a percentage");
      await shots("progress");
      api.slow = 0;
    }
    await until(`return !!document.getElementById("pcProgView") && !!PREP_C._job().result;`, 30000);
    await until(`return /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000);
  }
  counts.push(((await screenText()).match(/(\d+) of 50 in the deck/) || [])[1]);
  ok(counts.join(",") === "10,20,30,40,50", "Make 10 more, four times: " + counts.join(","));
  ok(!(await ev(`return !!document.querySelector('#pcProgView [data-act="c-more"]');`)), "at 50 there is no Make more");
  ok(/This deck now has all its 50 questions/.test(await screenText()), "and the result says the deck is full");
  await shots("progress-full");
  await click('#smdPrep [data-act="c-done"]');
  await until(`return !!document.querySelector("#pcDecks .pc-drow");`, 5000);
  await openDeck("/Revision sheet/");
  ok(await until(`var v=document.getElementById("pcDeckView"); return !!v && /All 50 questions made/.test(v.textContent) && !v.querySelector('[data-act="c-more"]');`, 5000), "the full deck's screen says all 50 are made, no Make more");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#pcDecks .pc-drow");`, 5000);

  // ---- the page picker on a 500-page PDF
  const dir = join(process.env.CLAUDE_JOB_DIR || tmpdir(), "prep-c-" + Date.now()); mkdirSync(dir, { recursive: true });
  const big = join(dir, "Big textbook.pdf"); writeFileSync(big, makeBigPdf(500), "latin1");
  await click('#smdPrep [data-act="c-new"]');
  await until(`return !!document.querySelector('#smdPrep [data-act="c-src"][data-v="pdf"]');`);
  await click('#smdPrep [data-act="c-src"][data-v="pdf"]');
  await until(`return !!document.getElementById("pcFile");`);
  await setFile(big);
  ok(await until(`return !!document.getElementById("pcPagesView") && !!document.querySelector("#pcPg .pc-pc");`, 30000), "a 500-page PDF opens straight into the page picker");
  ok(/^0 of 60 selected/.test(await pgCount()), "nothing is preselected on a long PDF: " + await pgCount());
  ok(await ev(`return document.getElementById("pcPgOk").disabled;`) === true, "Continue waits for a page");
  const cells = await ev(`return document.querySelectorAll("#pcPg .pc-pc").length;`);
  ok(cells > 0 && cells < 60, "the grid draws only the rows in view: " + cells + " cells of 500");
  ok(await until(`return document.querySelectorAll("#pcPg .pc-pc img").length >= 3;`, 20000), "thumbnails render for the pages in view");
  await click('#pcPg .pc-pc[data-p="2"]'); await click('#pcPg .pc-pc[data-p="5"]');
  ok(/^2 of 60 selected/.test(await pgCount()) && await ev(`return document.querySelector('#pcPg [data-p="2"]').getAttribute("aria-pressed");`) === "true", "tapping selects pages: " + await pgCount());
  await click('#pcPg .pc-pc[data-p="2"]');
  ok(/^1 of 60 selected/.test(await pgCount()), "tapping again deselects");
  await ev(`var b=document.getElementById("pcPagesView"); b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event("scroll")); return 1;`);
  ok(await until(`return !!document.querySelector('#pcPg [data-p="500"]') && !document.querySelector('#pcPg [data-p="2"]');`, 5000), "scrolled to the end: page 500 is drawn, page 2 is gone from the page");
  ok(await until(`return !!document.querySelector('#pcPg [data-p="500"] img');`, 20000), "and its thumbnail renders lazily");
  await typeSpec("100-200");
  ok(/up to 60 pages/.test(await ev(`return document.getElementById("pcPgMsg").textContent;`)) && /^1 of 60 selected/.test(await pgCount()), "typing 101 pages is refused with a clear message, the selection kept");
  await typeSpec("120-179");
  ok(/^60 of 60 selected/.test(await pgCount()), "typing a range of 60 selects 60: " + await pgCount());
  ok(await until(`return !!document.querySelector('#pcPg [data-p="120"]');`, 5000), "the grid scrolls to the first typed page");
  await ev(`var c=document.querySelector('#pcPg [data-p="180"]') || document.querySelector('#pcPg .pc-pc:not(.on)'); c.click(); return 1;`);
  ok(/^60 of 60 selected/.test(await pgCount()) && /up to 60 pages/.test(await ev(`return document.getElementById("pcPgMsg").textContent;`)), "a 61st tap is blocked with the message");
  await shots("pages-cap", async () => { await ev(`var b=document.getElementById("pcPagesView"); var g=document.getElementById("pcPg"); b.scrollTop = 0; b.dispatchEvent(new Event("scroll")); return 1;`); await until(`return document.querySelectorAll("#pcPg .pc-pc img").length >= 3;`, 15000); });
  await click('#smdPrep [data-act="c-pgclear"]');
  ok(/^0 of 60 selected/.test(await pgCount()), "Clear empties the selection");
  await click('#smdPrep [data-act="c-pgrange"]');
  await ev(`var b=document.getElementById("pcPagesView"); b.scrollTop=0; b.dispatchEvent(new Event("scroll")); return 1;`);
  await until(`return !!document.querySelector('#pcPg [data-p="3"]');`, 5000);
  await click('#pcPg .pc-pc[data-p="3"]');
  ok(/Now tap the last page/.test(await ev(`return document.getElementById("pcPgMsg").textContent;`)), "range: the first tap marks the start");
  await click('#pcPg .pc-pc[data-p="9"]');
  ok(/^7 of 60 selected/.test(await pgCount()), "range 3 to 9 selects 7 pages: " + await pgCount());
  await shots("pages", async () => { await until(`return document.querySelectorAll("#pcPg .pc-pc img").length >= 3;`, 15000); });
  ok(await smallButtons() === "", "page picker: every control is at least 44 px tall " + await smallButtons());
  await click('#smdPrep [data-act="c-pgok"]');
  ok(await until(`return !!document.getElementById("pcSetView") && /Big textbook\\.pdf · 7 pages/.test(document.getElementById("pcSetView").textContent);`, 5000), "Continue: the settings show the file and the 7 pages");
  api.calls.length = 0;
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 60000), "the deck is made from the chosen pages only");
  const bigPages = [...new Set(api.calls.filter((c) => c.op === "facts").flatMap((c) => c.body.chunk.sents.map((s) => s.p)))].sort((a, b) => a - b);
  ok(bigPages.every((p) => p >= 3 && p <= 9) && bigPages.length > 1, "only pages 3 to 9 were read: " + bigPages.join(","));
  await click('#smdPrep [data-act="c-done"]');
  await until(`return !!document.querySelector("#pcDecks .pc-drow");`, 5000);

  // ---- a small PDF: every page preselected, a typed page outside it is refused
  api.calls.length = 0;
  const pdfPath = join(dir, "AML chapter.pdf"); writeFileSync(pdfPath, makePdf(), "latin1");
  await click('#smdPrep [data-act="c-new"]');
  await until(`return !!document.querySelector('#smdPrep [data-act="c-src"][data-v="pdf"]');`);
  await click('#smdPrep [data-act="c-src"][data-v="pdf"]');
  await until(`return !!document.getElementById("pcFile");`);
  await setFile(pdfPath);
  ok(await until(`return !!document.getElementById("pcPagesView") && /^2 of 60 selected/.test(document.getElementById("pcPgN").textContent);`, 20000), "a 2-page PDF: both pages preselected in the picker");
  await typeSpec("5");
  ok(/has 2 pages/.test(await ev(`return document.getElementById("pcPgMsg").textContent;`)), "a page outside the PDF is refused in plain words");
  await click('#smdPrep [data-act="c-pgok"]');
  ok(await until(`return !!document.getElementById("pcSetView");`, 5000) && await ev(`return document.getElementById("pcTitle").value;`) === "AML chapter", "the deck name defaults to the file name");
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "the PDF deck is made");
  const pdfSents = api.calls.filter((c) => c.op === "facts").flatMap((c) => c.body.chunk.sents);
  ok(pdfSents.length === 6 && pdfSents.map((s) => s.p).join(",") === "1,1,1,2,2,2" && pdfSents[0].h === "Acute leukaemia" && pdfSents[3].h === "Management", "PDF sentences carry their page and font-size headings");
  await click('#smdPrep [data-act="c-done"]');
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-drow").length === 4;`, 5000), "four decks listed");

  // ---- a scanned page (Phase 3b): page 1 has a text layer, page 2 is an image-only page with no text
  const scanPdf = join(dir, "Marrow scan.pdf");
  writeFileSync(scanPdf, makePdf([[[20, 780, "Bone marrow failure"], [11, 750, "Aplastic anaemia presents with pancytopenia and a hypocellular marrow on biopsy."],
    [11, 735, "Fanconi anaemia is inherited and often shows thumb anomalies and short stature."], [11, 720, "Paroxysmal nocturnal haemoglobinuria lacks CD55 and CD59 on red cells."]], []]), "latin1");
  api.calls.length = 0;
  await click('#smdPrep [data-act="c-new"]');
  await until(`return !!document.querySelector('#smdPrep [data-act="c-src"][data-v="pdf"]');`);
  await click('#smdPrep [data-act="c-src"][data-v="pdf"]');
  await until(`return !!document.getElementById("pcFile");`);
  ok(/read only in the StewardMD phone app/.test(await screenText()), "web build: the source step says scans are read only in the app");
  await setFile(scanPdf);
  ok(await until(`return !!document.getElementById("pcPagesView") && /^2 of 60 selected/.test(document.getElementById("pcPgN").textContent);`, 20000), "the scanned PDF opens in the picker");
  await typeSpec("2");
  await click('#smdPrep [data-act="c-pgok"]');
  await until(`return !!document.getElementById("pcSetView");`, 5000);
  await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`var e=document.getElementById("pcErr"); return !!e && /These pages are scanned images. Scans are read only in the StewardMD phone app, not on the web/.test(e.textContent);`, 15000), "web build, scanned page only: a clear message and nothing sent");
  ok(api.calls.length === 0, "no request for an unreadable source");
  // The app: on-device OCR through a stubbed SMD_NATIVE.ocr (native-bridge.js shape: { text, lines, boxes }).
  await ev(`window.__ocr = []; window.SMD_NATIVE = { ocr: function (img, opts) { window.__ocr.push([String(img).slice(0, 23), img.length, opts && opts.languageCorrection]); return Promise.resolve({ text: "DIAGNOSIS\\nBone marrow biopsy confirms the diagnosis in most adults.\\nFlow cytometry shows myeloid markers on the blasts.\\nCytogenetics guides the choice of therapy.", lines: [], boxes: [] }); } }; return 1;`);
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.getElementById("pcPagesView");`, 5000);
  await typeSpec("1-2");
  await click('#smdPrep [data-act="c-pgok"]');
  await until(`return !!document.getElementById("pcSetView");`, 5000);
  if (await ev(`return document.querySelector('#pcSetView [data-act="c-own"]').getAttribute("aria-pressed");`) !== "true") await click('#smdPrep [data-act="c-own"]');
  await click('#smdPrep [data-act="c-go"]');
  ok(await until(`return !!document.getElementById("pcProgView") && /Deck saved/.test(document.querySelector("#smdPrep .pn-bar h1").textContent);`, 30000), "the app: the deck is made with the scanned page read by OCR");
  const ocrCalls = String(await ev(`return JSON.stringify(window.__ocr || null);`));
  ok(/^\[\["data:image\/jpeg;base64,",\d+,true\]\]$/.test(ocrCalls), "only the scanned page goes to on-device OCR, as a JPEG: " + ocrCalls.slice(0, 60));
  const scanSents = api.calls.filter((c) => c.op === "facts").flatMap((c) => c.body.chunk.sents);
  ok(scanSents.map((x) => x.p).join(",") === "1,1,1,2,2,2" && scanSents[3].h === "DIAGNOSIS", "OCR text goes through the same sentence pipeline");
  ok(/1 page read by on-device OCR/.test(await screenText()), "the progress screen says a page was read by OCR");
  ok(!JSON.stringify(api.calls).includes("data:image"), "no image is ever sent to the server");
  await click('#smdPrep [data-act="c-done"]');
  await until(`return !!document.querySelector("#pcDecks .pc-drow");`, 5000);
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-drow").length === 5;`, 5000), "five decks listed");
  await ev(`delete window.SMD_NATIVE; return 1;`);

  // ---- 429 month-decks: plain message, nothing saved
  api.mode = "month"; api.calls.length = 0;
  await pasteDeck(NOTES.replace(/Patient name.*\n/, "").replace(/Call his son.*\n/, "").replace(/Iron/g, "Ferrous"));
  ok(await until(`var e=document.getElementById("pcErr"); return !!e && /You have made 30 decks this month, the monthly limit/.test(e.textContent);`, 15000), "429 month-decks: the monthly-limit message");
  ok(await ev(`return !document.querySelector('#pcProgView [data-act="c-resume"]');`) === true, "no Try again for a monthly cap");
  ok(/Deck not made/.test(await screenText()) && /Nothing was saved and no deck was counted/.test(await screenText()) && /30 of 30 decks this month/.test(await screenText()), "the refusal says nothing was saved; the cap line shows the month full");
  ok(api.calls.length === 1 && api.calls[0].op === "facts", "the run stops at the first refused call");
  await shots("month-cap");
  await click('#smdPrep [data-act="c-done"]');
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-drow").length === 5;`, 5000), "the refused deck is not saved");
  api.mode = "ok";

  // ---- restore: IndexedDB cleared (a new phone, a reinstall, an evicted store): the decks come back from the account
  for (let i = 0; i < 40 && api.backup.size < 5; i++) await sleep(150);
  ok(api.backup.size === 5, "all five decks are in the account backup: " + api.backup.size);
  await call("Page.navigate", { url: BASE });
  ok(await until(`return !!(window.PREP && window.SMD_showHome);`, 30000), "the app reloads");
  await ev(clean);
  const del = await evA(`await new Promise(function (res) { var r = indexedDB.deleteDatabase("prep-gen"); r.onsuccess = r.onerror = r.onblocked = function () { res(1); }; }); return (await indexedDB.databases()).map(function (d) { return d.name; }).indexOf("prep-gen");`);
  ok(del === -1, "IndexedDB prep-gen is gone");
  await ev(`PREP.open(); return 1;`);
  await until(`return !!window.PREP_C;`, 20000);
  await ev(signIn);
  await until(`return !!document.querySelector('#smdPrep [data-act="c-home"]');`, 10000);
  await click('#smdPrep [data-act="c-home"]');
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-drow").length === 5;`, 20000), "Your decks: the five decks are back from the account");
  ok(await until(`var d=[].filter.call(document.querySelectorAll("#pcDecks .pc-drow"), function(x){ return /Revision sheet/.test(x.textContent); })[0]; return !!d && /50 of 50 questions/.test(d.textContent);`, 5000), "with their questions: the full deck has 50 of 50");
  await openDeck("/Revision sheet/");
  await until(`return !!document.querySelector("#pcDeckView .pc-dhero");`, 5000);
  await click('#smdPrep #pcDeckView [data-act="c-prac"]');
  ok(await until(`return !!document.querySelector("#smdPrep .pn-opt");`, 10000), "a restored deck practises like before");
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#pcDeckView .pc-dhero");`, 5000);

  // ---- delete from the deck screen: the deck, its FSRS memory and its account copy go
  const firstId = deckId;
  await ev(`PREP.back(); return 1;`);
  await until(`return !!document.querySelector("#pcDecks .pc-drow");`, 5000);
  await ev(`var b=document.querySelector('#pcDecks [data-d="${firstId}"]'); b.click(); return 1;`);
  await until(`return !!document.querySelector('#pcDeckView [data-act="c-del"]');`, 5000);
  await click('#smdPrep #pcDeckView [data-act="c-del"]');
  ok(await until(`return document.querySelectorAll("#pcDecks .pc-drow").length === 4;`, 5000), "Delete removes the deck and goes back to the list");
  ok(await ev(`return Object.keys(JSON.parse(localStorage.getItem("smd_prep_v1")).cards).filter(function(k){return k.indexOf("${firstId}")>=0;}).length;`) === 0, "and its FSRS cards from the store");
  ok(await (async () => { for (let i = 0; i < 20 && api.backup.has(firstId); i++) await sleep(150); return !api.backup.has(firstId); })(), "and its account copy");

  ok(api.other.every((u) => /\/api\//.test(u)), "every other /api/ request was answered locally (" + api.other.length + "), none left the machine");
  ok(errors.length === 0, "no uncaught PrepNucleus error" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  console.log(fails === 0 ? "\nALL GREEN: PrepNucleus Layer C" : `\n${fails} FAILED`);
} catch (e) { console.error("HARNESS ERROR:", e.message); fails++; }
finally {
  try { ws && ws.close(); } catch {} if (serveProc) serveProc.kill();
  // Chrome must be gone before its profile (about 150 MB) is deleted, or it writes the folder back (owner disk rule).
  const gone = new Promise((res) => { if (chrome.exitCode != null) return res(); chrome.once("exit", res); });
  chrome.kill();
  await Promise.race([gone, sleep(3000)]);
  if (chrome.exitCode == null) { try { chrome.kill("SIGKILL"); } catch {} await Promise.race([gone, sleep(2000)]); }
  await sleep(300);
  try { if (userDir && /prep-create-chrome-/.test(userDir)) rmSync(userDir, { recursive: true, force: true }); } catch {}
  process.exit(fails === 0 ? 0 : 1);
}
