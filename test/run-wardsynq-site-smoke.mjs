/* test/run-wardsynq-site-smoke.mjs - wardsynq.com without credentials: the door renders, refuses a
 * wrong sign-in with the server's answer, switches methods, fits a phone, and forwards /api.
 *   BASE=https://wardsynq.com node test/run-wardsynq-site-smoke.mjs */
import { launch } from "./wardsynq-site-cdp.mjs";
const BASE = (process.env.BASE || "https://wardsynq.com").replace(/\/+$/, "");
let pass = 0, fail = 0;
const ok = (c, name, extra) => { console.log(`  ${c ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); c ? pass++ : fail++; };
const b = await launch({ port: Number(process.env.CDP_PORT || 9471) });
try {
  await b.nav(BASE + "/");
  ok(await b.until(`return document.querySelector('[data-tab="staff"]') ? 'y' : '';`, 15000), "sign-in screen renders (3 methods)");
  ok(await b.ev(`return getComputedStyle(document.querySelector('.bar')).position === 'sticky'`), "shell stylesheet applied");
  await b.click('[data-tab="staff"]'); await b.until(`return document.getElementById('goStaff') ? 'y' : '';`, 3000);
  await b.type("sorg", "SMD-NOPE01"); await b.type("sid", "nobody"); await b.type("spw", "0000"); await b.click("#goStaff");
  const msg = await b.until(`var m=document.getElementById('loginMsg'); return m && m.querySelector('.msg.err') ? m.textContent : '';`, 15000);
  ok(!!msg, "wrong staff PIN refused with a message from the real server", msg && msg.trim());
  await b.type("sid", "nobody@example.invalid"); await b.type("spw", "wrongpassword"); await b.click("#goStaff");
  const msg2 = await b.until(`var m=document.getElementById('loginMsg'); return m && m.textContent.indexOf('Wrong email') >= 0 ? m.textContent : '';`, 15000);
  ok(!!msg2, "wrong staff email/password refused via /api/queue/auth/email through this origin");
  const api = await b.ev(`return fetch('/api/queue/whoami').then(function(r){ return r.status + ' ' + r.headers.get('content-type'); })`);
  ok(/^401 application\/json/.test(String(api)), "/api/* forwarded to the record service (401 JSON, not HTML)", api);
  const stat = await b.ev(`return fetch('/api/queue/auth/pin', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}).then(function(r){ return r.status; })`);
  ok(Number(stat) >= 400 && Number(stat) < 500, "a malformed sign-in is refused, not crashed", String(stat));
  await b.click('[data-tab="account"]'); ok(await b.until(`return document.getElementById('goAccount') ? 'y' : '';`, 3000), "account sign-in form (email/password + Google) renders");
  ok(await b.ev(`return !!(window.firebase && firebase.auth)`), "Firebase auth SDK loaded for account sign-in");
  await b.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await b.sleep(300);
  const overflow = await b.ev(`return document.documentElement.scrollWidth - window.innerWidth`);
  ok(Number(overflow) <= 0, "no horizontal overflow at 390px (phone)", overflow + "px");
  const tap = await b.ev(`var r=document.getElementById('goAccount').getBoundingClientRect(); return r.height`);
  ok(Number(tap) >= 40, "primary button is a touch target (>= 40px)", tap + "px");
  ok(b.consoleLines.filter((l) => !/favicon|gstatic|firebase/i.test(l)).length === 0, "no console errors from the shell", b.consoleLines.slice(0, 3).join(" | "));
} finally {
  console.log(`\n${BASE}: ${pass} pass, ${fail} fail`);
  b.close(); process.exit(fail ? 1 : 0);
}
