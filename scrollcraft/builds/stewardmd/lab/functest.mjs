/* The signature move IS the build, so it gets a real test: edit the patient,
   assert every derived surface actually re-derives, and assert the page never
   emits a prescriptive recommendation. Also fails on any console error. */
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://localhost:4517';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(400);

const read = () => p.evaluate(() => ({
  crcl: document.getElementById('crcl-v').textContent.trim(),
  band: document.getElementById('band').textContent.trim(),
  lvl: document.getElementById('band').dataset.lvl,
  dcrcl: document.getElementById('d-crcl').textContent.trim(),
  dband: document.getElementById('d-band').textContent.trim(),
  drev: document.getElementById('d-review').textContent.trim(),
  dmod: document.getElementById('d-modules').textContent.trim(),
  formula: document.getElementById('d-formula').textContent.trim(),
  note: document.getElementById('note').value,
}));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

/* ── 1. the default state matches Cockcroft-Gault computed by hand ────────
   62 y, 68 kg, F, Scr 1.8  ->  ((140-62)*68)/(72*1.8)*0.85 = 34.79 -> 35   */
let s = await read();
console.log('default 62y / 68kg / F / 1.8');
ok('crcl is 35', s.crcl === '35', 'got ' + s.crcl);
ok('band is Moderate', s.band === 'Moderate', 'got ' + s.band);
ok('band level warn', s.lvl === 'warn', 'got ' + s.lvl);
ok('derivation echoes 35', s.dcrcl === '35 mL/min', 'got ' + s.dcrcl);
ok('renal review required under 50', /Required/.test(s.drev), 'got ' + s.drev);

/* ── 2. drive creatinine UP: clearance must fall and band must worsen ──── */
await p.fill('#p-scr', '4.5');
await p.waitForTimeout(150);
s = await read();
/* ((140-62)*68)/(72*4.5)*0.85 = 13.9 -> 14, below 15 = failure band */
console.log('creatinine 4.5');
ok('crcl fell to 14', s.crcl === '14', 'got ' + s.crcl);
ok('band is Failure', s.band === 'Failure', 'got ' + s.band);
ok('band level crit', s.lvl === 'crit', 'got ' + s.lvl);
ok('ICU engaged under 30', /ICU/.test(s.dmod), 'got ' + s.dmod);
ok('formula shows the new value', /72 x 4.5/.test(s.formula), 'got ' + s.formula);

/* ── 3. healthy kidneys: review must NOT be triggered ─────────────────── */
await p.fill('#p-scr', '0.7');
await p.fill('#p-age', '30');
await p.waitForTimeout(150);
s = await read();
/* ((140-30)*68)/(72*0.7)*0.85 = 126.0 */
console.log('30y / 0.7');
ok('crcl is 126', s.crcl === '126', 'got ' + s.crcl);
ok('band is Normal', s.band === 'Normal', 'got ' + s.band);
ok('review not triggered', /Not triggered/.test(s.drev), 'got ' + s.drev);
ok('no ICU at normal clearance', !/ICU/.test(s.dmod), 'got ' + s.dmod);

/* ── 4. sex factor actually applies (0.85 only for female) ────────────── */
await p.selectOption('#p-sex', 'm');
await p.waitForTimeout(150);
s = await read();
ok('male drops the 0.85 factor', !/0\.85/.test(s.formula), 'got ' + s.formula);
ok('male clearance is 148', s.crcl === '148', 'got ' + s.crcl);

/* ── 5. garbage input must not produce a number ───────────────────────── */
await p.fill('#p-scr', '');
await p.waitForTimeout(150);
s = await read();
ok('empty creatinine yields no number', s.crcl === '--', 'got ' + s.crcl);
ok('no false review claim', /Cannot be determined/.test(s.drev), 'got ' + s.drev);

/* ── 6. the note accumulates and reflects live state ──────────────────── */
await p.fill('#p-scr', '1.8');
await p.fill('#p-age', '62');
await p.selectOption('#p-sex', 'f');
/* scroll the way a reader does, not in one jump: an instant jump skips
   IntersectionObserver entries for everything in between. */
const H = await p.evaluate(() => document.body.scrollHeight);
for (let y = 0; y <= H; y += 420) {
  await p.evaluate((y) => window.scrollTo(0, y), y);
  await p.waitForTimeout(45);
}
await p.waitForTimeout(600);
s = await read();
ok('note carries the patient line', /62 y, 68 kg, F/.test(s.note), s.note.slice(0, 60));
ok('note carries the derivation', /Cockcroft-Gault 35 mL\/min/.test(s.note));
ok('note states it does not choose', /does not choose the antibiotic/.test(s.note));

/* ── 7. SAFETY: the public page must never name a drug or a dose ──────── */
const body = (await p.evaluate(() => document.body.innerText)).toLowerCase();
/* drug names and dosing instructions. "prescribe" on its own is NOT banned:
   it is in the disclaimer, which is the opposite of a recommendation. */
const banned = ['ceftriaxone', 'meropenem', 'piperacillin', 'vancomycin',
  'amoxicillin', 'ciprofloxacin', 'gentamicin', 'nitrofurantoin', 'linezolid',
  'mg bd', 'mg tds', 'mg od', 'mg/kg', 'first-line regimen',
  'we recommend', 'you should give', 'start the patient on'];
const hits = banned.filter((w) => body.includes(w));
ok('no drug name or dosing instruction in visible text', hits.length === 0, hits.join(', '));
ok('carries the clinician-only disclaimer', body.includes('does not diagnose or prescribe'));
ok('labels the case as illustrative', body.includes('illustrative sample'));

ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await b.close();
process.exit(fail ? 1 : 0);
