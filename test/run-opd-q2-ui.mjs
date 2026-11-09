/* test/run-opd-q2-ui.mjs - the doctor's personal-clinic day on the REAL queue.js / queue.css, in headless
 * Chrome at phone size, against a stateful fake of /api/queue (test/opd-q2-harness.html).
 *
 * Covers what unit tests cannot: creating a clinic in the app, the earlier screen's corrected text, the
 * 2026-11 screen (flag smd_opd_q2) from its Settings switch, every action through to the server call it
 * sends, the in-app confirm and undo (no window.confirm / prompt / open), the truthful backup card,
 * autosave, check-in, and layout: no sideways overflow, 44px targets, a name on every control, at 320
 * and 390 wide, light and dark.
 *
 *   node test/run-opd-q2-ui.mjs        CHROME=/path/to/chrome  CHROME_FLAGS="--no-sandbox"
 * Screenshots: test-output/opd-q2-*.png
 */
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..");
if (!process.env.CHROME) process.env.CHROME = ["/opt/pw-browsers/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p)) || "";
if (process.env.CHROME_FLAGS == null && process.platform === "linux") process.env.CHROME_FLAGS = "--no-sandbox --disable-dev-shm-usage";
const { launch } = await import("./wardsynq-site-cdp.mjs");

const PORT = Number(process.env.OPD_Q2_PORT || 8817), BASE = `http://localhost:${PORT}`;
const OUT = join(ROOT, "test-output"); mkdirSync(OUT, { recursive: true });
const server = spawn("node", [join(HERE, "serve.mjs"), ROOT, String(PORT)], { stdio: "ignore" });
for (let i = 0; i < 40; i++) { try { await fetch(BASE + "/queue.css"); break; } catch { await sleep(150); } }

let fails = 0;
const ok = (c, m, extra) => { console.log((c ? "PASS " : "FAIL ") + m + (c || extra == null ? "" : "  -> " + JSON.stringify(extra))); if (!c) fails++; };
let b;
const txt = (sel) => b.ev(`var e=document.querySelector(${JSON.stringify(sel)}); return e?e.innerText:null;`);
const has = (sel) => b.ev(`return !!document.querySelector(${JSON.stringify(sel)});`);
const clickAct = (a, scope) => b.ev(`var r=document.querySelector(${JSON.stringify(scope || "#smdQueue")}); var e=r&&(r.querySelector('[data-q-act="${a}"]')||r.querySelector('[data-q-act^="${a}:"]')); if(!e) return 'no ${a}'; e.click(); return 1;`);
const posts = (path) => b.ev(`return JSON.stringify(window.__posts.filter(function(p){return p.path===${JSON.stringify(path)}}).map(function(p){return p.body}));`).then(JSON.parse);
const setSize = (w, h) => b.call("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
/* Layout facts about what is on screen now: anything past the right edge, any control under 44px, any
 * control with no name (aria-label, or text that is not an icon ligature). */
const audit = () => b.ev(`
  var W = innerWidth, wide = [], small = [], unnamed = [];
  var root = document.getElementById('smdQueue');
  root.querySelectorAll('*').forEach(function (e) { var r = e.getBoundingClientRect(); if (r.width && r.right > W + 1) wide.push((e.className || e.tagName) + ' ' + Math.round(r.right)); });
  root.querySelectorAll('button, input:not([type=checkbox]), select').forEach(function (e) {
    var r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
    var label = (e.getAttribute('data-q-act') || e.id || e.className);
    if (r.height < 43.5 || r.width < 43.5) small.push(label + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    var c = e.cloneNode(true); c.querySelectorAll('.material-symbols-outlined').forEach(function (i) { i.remove(); });
    var name = e.getAttribute('aria-label') || c.textContent.trim() || e.getAttribute('placeholder') || (e.id && root.querySelector('label[for="' + e.id + '"]') ? 'l' : '');
    if (!name) unnamed.push(label);
  });
  return JSON.stringify({ wide: wide.slice(0, 6), small: small, unnamed: unnamed, sw: document.documentElement.scrollWidth, w: W });`).then(JSON.parse);
const clean = async (label) => { const a = await audit(); ok(!a.wide.length && a.sw <= a.w, label + ": nothing past the right edge", a.wide); ok(!a.small.length, label + ": every control is at least 44px", a.small); ok(!a.unnamed.length, label + ": every control has a name", a.unnamed); };

try {
  b = await launch({ port: Number(process.env.CDP_PORT || 9517), mobile: true });
  await b.nav(BASE + "/test/opd-q2-harness.html");
  ok(await b.until("return window.__ready", 10000), "queue.js loaded");
  await b.ev("localStorage.clear(); document.fonts && await document.fonts.ready; window.QUEUE.open(); return 1;");

  // ---- 1. a doctor with no clinic creates one in the app ----
  ok(/Where are you working now/.test(await txt("#smdQueue")), "first open asks where the doctor is working");
  await clickAct("typeclinic");
  ok(await b.until(`return /no clinic here yet/.test(document.getElementById('smdQueue').innerText)`), "no clinic yet: says so, with no mention of a console");
  ok(!/console/i.test(await txt("#smdQueue")), "the clinic list never sends the doctor to a console");
  await clickAct("newclinic");
  ok(await has("#qNcName") && await has('label[for="qNcName"]'), "New clinic opens a form in the app, with visible labels");
  await clean("clinic form");
  await clickAct("newclinicgo");
  ok(/Enter your clinic's name/.test(await txt(".q-gate-err")), "an empty name is refused beside the field");
  ok((await posts("/onboard/clinic")).length === 0, "nothing was sent for the empty form");
  await b.type("qNcName", "Sunrise Clinic");
  await clickAct("newclinicgo");
  ok(await b.until("return !!document.querySelector('#smdQueue .q-canvas')"), "the new clinic opens straight into its queue");
  const made = await posts("/onboard/clinic");
  ok(made.length === 1 && made[0].name === "Sunrise Clinic" && made[0].roomName === "Consulting Room", "POST /onboard/clinic carried the name and room", made);
  ok(await b.ev("return localStorage.getItem('smd_opd_workplace')") === "clinic:org1", "the clinic is remembered as the workplace");
  ok(await b.ev("return window.__opens") === 0, "window.open was never called");

  // ---- 2. the earlier screen (flag off): corrected text only ----
  ok(await has("#smdQueue .q-kpis") && !(await has("#smdQueue .q2")), "flag off: the earlier screen, unchanged in structure");
  const old = await txt("#smdQueue");
  ok(!/AI Insights/.test(old) && /Running late/.test(old), "the 30-minute rule is no longer labelled AI");
  ok(!/Next \d/.test(old), "no 'Next 3' above a list of everyone");
  await b.shot(join(OUT, "opd-q2-00-earlier-screen.png"));

  // ---- 3. settings: truthful backup, then the layout switch ----
  await clickAct("nav:settings");
  ok(await b.until(`return /Not backed up/.test((document.getElementById('qStorageCard')||{}).innerText||'')`), "no backup set up: the card says Not backed up");
  const card = await txt("#qStorageCard");
  ok(!/GHIS/.test(card), "a personal clinic's storage card does not talk about GHIS");
  ok(!/Back up to Drive now/.test(card) && /Set up Google Drive backup/.test(card), "it offers set-up, not a backup that cannot run");
  await b.ev("window.__hasPw = true; return 1;"); await clickAct("nav:queue"); await clickAct("nav:settings");
  ok(await b.until(`return /No backup has completed yet/.test((document.getElementById('qStorageCard')||{}).innerText||'')`), "set up but never run: says no backup has completed");
  await clickAct("q2toggle");
  ok(await b.ev("return localStorage.getItem('smd_opd_q2')") === "1" && await has("#smdQueue .q2"), "Settings switches the new layout on");
  ok(!(await has('[data-q-act="savecfg"]')) && /save as you make them/.test(await txt("#smdQueue")), "new layout: no Save button, changes save themselves");
  await b.ev(`var i=document.querySelector('[data-cfg="early"]'); i.value='7'; i.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  ok(await b.until(`return window.__posts.some(function(p){return p.path==='/config'&&p.body.config.early===7})`, 4000), "a changed number is saved without a tap");
  ok(await b.until(`return /Saved\\./.test((document.getElementById('qCfgSaved')||{}).textContent||'')`, 3000), "and the screen says Saved");
  await clean("settings");
  await b.shot(join(OUT, "opd-q2-05-settings.png"));

  // ---- 4. the new queue screen ----
  await clickAct("nav:queue");
  ok(await b.until("return !!document.querySelector('#smdQueue .q2-now')"), "the queue shows the patient in the room");
  ok(await b.until(`return /Sunrise Clinic/.test((document.querySelector('.q2-title')||{}).innerText||'')`, 4000), "the header is titled with the clinic");
  const status = await txt(".q2-status");
  ok(/4 waiting/.test(status) && /Longest 4\d min/.test(status) && /Running late/.test(status), "one status sentence: how many, the longest wait, running late", status);
  ok(!(await has("#smdQueue .q-kpis")) && !(await has("#smdQueue .q-ai")), "no stat cards and no insight card");
  ok(/Arjun Rao/.test(await txt(".q2-now")) && /In consult 5 min/.test(await txt(".q2-now")), "Now: the patient and how long they have been in");
  const next = await txt(".q2-next");
  ok(/Sita Devi/.test(next) && /Start consult/.test(next) && /Did not come/.test(next), "Next (already called): Start consult and Did not come, in words", next);
  ok(await b.ev("return document.querySelectorAll('#qTlRows .q2-row').length") === 3, "the rest of the queue is three plain rows");
  ok(await b.ev("return document.querySelectorAll('#qTlRows .q2-row button, .q2-row .q-ic').length") === 0, "rows carry no icon buttons");
  ok(/rough estimate/.test(await txt("#qTlRows")), "a low-confidence estimate says it is rough");
  await clean("queue 390");
  await b.shot(join(OUT, "opd-q2-10-queue-390.png"));

  // ---- 5. end the consult without swiping ----
  ok(await b.ev("var s=document.getElementById('qSwipe'); return s.tagName==='BUTTON' && s.getAttribute('aria-label')==='End consultation'"), "the end control is a real button with a name");
  await clickAct("endask");
  ok(await has('[role="alertdialog"]') && /End this consult\?/.test(await txt('[role="alertdialog"]')), "a tap asks before ending");
  await clean("confirm sheet");
  await clickAct("confirm-close");
  ok((await posts("/advance")).length === 0 && !(await has('[role="alertdialog"]')), "Cancel ends nothing");
  await clickAct("endask"); await clickAct("confirm-ok");
  ok(await b.until("return window.__posts.some(function(p){return p.path==='/advance'})"), "End consult sends /advance");
  ok(await b.until("return !document.querySelector('#smdQueue .q2-now')"), "the room is empty afterwards");

  // ---- 6. did not come, with undo ----
  await clickAct("noshow");
  ok(await b.until("return !!document.querySelector('.q2-snack')"), "Did not come: a message with Undo, no confirm box");
  ok((await posts("/status")).some((p) => p.ticketId === "t2" && p.status === "no_show"), "it sent no_show for that patient");
  ok(!/Sita Devi/.test(await txt(".q2-next")), "the next patient moved up");
  await clickAct("snack-undo");
  ok(await b.until("return window.__posts.some(function(p){return p.path==='/no-show/recall'&&p.body.ticketId==='t2'&&p.body.reason.length>=3})"), "Undo recalls them with a reason");
  ok(await b.until(`return /Sita Devi/.test(document.getElementById('smdQueue').innerText)`), "they are back in the queue");

  // ---- 7. call in, then start ----
  const nextId = await b.ev(`return document.querySelector('.q2-next [data-q-act^="call:"]').getAttribute('data-q-act').slice(5)`);
  await clickAct("call", ".q2-next");
  ok(await b.until(`return /Start consult/.test(document.querySelector('.q2-next .q2-btn.primary').innerText)`), "after Call in, the main button becomes Start consult");
  ok((await posts("/status")).some((p) => p.ticketId === nextId && p.status === "called"), "Call in sent called");
  await clickAct("start", ".q2-next");
  ok(await b.until("return !!window.__lastOpen && window.__lastOpen.tab==='assess'"), "Start consult opens the assessment");
  ok(await b.until("return !!document.querySelector('#smdQueue .q2-now')"), "and the patient is in the room");

  // ---- 8. a row opens worded actions; remove asks in the app ----
  await b.click("#qTlRows .q2-row");
  ok(await b.until("return !!document.querySelector('.q2-sheet .q2-item')"), "tapping a row opens its actions");
  const sheet = await txt(".q2-sheet");
  ok(["Start consult", "Call in", "Change priority", "Open assessment", "Remove from queue"].every((w) => sheet.includes(w)), "every action is written out", sheet);
  ok(await b.ev("var i=[].slice.call(document.querySelectorAll('.q2-sheet .q2-item')); return i[i.length-1].classList.contains('danger') && /Remove/.test(i[i.length-1].innerText)"), "Remove is last and marked as destructive");
  await clean("row sheet");
  await b.sleep(400);
  await b.shot(join(OUT, "opd-q2-20-row-sheet.png"));
  const rmId = await b.ev(`return document.querySelector('.q2-sheet [data-q-act^="remove:"]').getAttribute('data-q-act').slice(7)`);
  await clickAct("remove", ".q2-sheet");
  ok(await b.until(`return /Remove from the queue\\?/.test((document.querySelector('[role="alertdialog"]')||{}).innerText||'')`), "Remove asks in an in-app sheet");
  ok(!(await posts("/status")).some((p) => p.ticketId === rmId && p.status === "cancelled"), "nothing removed before the doctor confirms");
  await clickAct("confirm-ok");
  ok(await b.until(`return window.__posts.some(function(p){return p.path==='/status'&&p.body.ticketId===${JSON.stringify(rmId)}&&p.body.status==='cancelled'})`), "confirming sends cancelled");
  ok(await b.ev("return window.__confirms + window.__prompts + window.__opens") === 0, "no window.confirm, prompt or open anywhere in the new flow");

  // ---- 9. priority and recall sheets ----
  await b.click("#qTlRows .q2-row"); await b.until("return !!document.querySelector('.q2-sheet .q2-item')"); await clickAct("prio", ".q2-sheet");
  ok(await b.until(`return !!document.querySelector('[aria-label="Set priority"]')`) && !(await has(".q2-sheet .q2-item")), "Set priority opens the reason sheet and closes the action sheet");
  await clickAct("prio-close");
  await clickAct("noshow", ".q2-next") ; await b.sleep(300);
  if (!(await has(".q2-snack"))) { await b.click('.q2-next [data-q-act^="row:"]'); await b.until("return !!document.querySelector('.q2-sheet .q2-item')"); }
  await b.ev("window.QUEUE._st.snack=null; return 1;");

  // ---- 10. check-in ----
  await clickAct("row-close"); await clickAct("add");
  ok(await b.until("return !!document.getElementById('smdPatReg')", 4000), "Add opens the check-in sheet");
  await b.ev("var d=document.getElementById('smdPatReg'); if(d) d.remove(); return 1;");

  // ---- 11. profile sheet: pause lives here; staff text names the app ----
  await clickAct("docprofile");
  ok(await b.until("return !!document.querySelector('.q-profile [data-q-act=\"pause\"]')"), "Pause the queue is in the profile sheet");
  const prof = await txt(".q-profile");
  ok(/front-desk staff/.test(prof) && !/stewardmd\.in/.test(prof), "staff are told to sign in in the app, not at a web address");
  await clean("profile sheet");
  await clickAct("profile-close");

  // ---- 12. small phone, dark, empty ----
  await setSize(320, 640); await b.sleep(250); await clean("queue 320");
  await b.shot(join(OUT, "opd-q2-30-queue-320.png"));
  await setSize(390, 844); await b.ev("document.body.classList.add('dark'); document.body.style.background='#191c1e'; return 1;"); await b.sleep(250);
  await b.shot(join(OUT, "opd-q2-40-queue-dark.png"));
  await b.ev("document.body.classList.remove('dark'); window.__DB.tickets.forEach(function(t){t.status='completed'}); window.__DB.session.currentTicketId=''; window.QUEUE.refresh(); return 1;");
  ok(await b.until("return !!document.querySelector('#smdQueue .q2-empty')", 4000), "an empty day says so");
  ok(/Add your first patient/.test(await txt(".q2-empty")) && await has('.q2-empty [data-q-act="add"]'), "and gives the one action that fills it");
  await clean("empty");
  await b.shot(join(OUT, "opd-q2-50-empty.png"));

  // ---- 13. switching back restores the earlier screen ----
  await clickAct("nav:settings"); await clickAct("q2toggle"); await clickAct("nav:queue");
  ok(await has("#smdQueue .q-kpis") && !(await has("#smdQueue .q2")), "the Settings switch restores the earlier screen");

  const errs = await b.ev("return JSON.stringify(window.__errs)");
  ok(errs === "[]", "no runtime errors", errs);
  ok(!b.consoleLines.filter((l) => /^EXC/.test(l)).length, "no exceptions in the console", b.consoleLines.slice(0, 4));
} catch (e) { console.log("HARNESS ERROR: " + (e && e.stack || e)); fails++; }
finally { try { b && b.close(); } catch {} try { server.kill(); } catch {} }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
