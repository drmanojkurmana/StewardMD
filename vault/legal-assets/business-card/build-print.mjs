// Assemble print.html from the canvas artboards, swapping in full-resolution logos, then print to PDF via Chromium.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const here = path.dirname(new URL(import.meta.url).pathname);
const inner = (f) => { const s = fs.readFileSync(path.join(here, 'artboards', f), 'utf8'); const m = s.match(/<\/helmet>\s*([\s\S]*?)<\/x-dc>/); return m[1]; };
const b64 = (n) => 'data:image/png;base64,' + fs.readFileSync(path.join(here, 'img', n)).toString('base64');
const swap = (html) => html.replace(/src="([a-z-]+)\.png"/g, (_, n) => `src="${b64(n + '.png')}"`);
const page = `<!doctype html><html><head><meta charset="utf-8">
<style>
@font-face { font-family: "Inter"; font-weight: 400; src: url("fonts/inter-400.woff") format("woff"); }
@font-face { font-family: "Inter"; font-weight: 500; src: url("fonts/inter-500.woff") format("woff"); }
@font-face { font-family: "Inter"; font-weight: 600; src: url("fonts/inter-600.woff") format("woff"); }
@font-face { font-family: "Dancing Script"; font-weight: 400; src: url("fonts/dancing-400.woff") format("woff"); }
@font-face { font-family: "Dancing Script"; font-weight: 600; src: url("fonts/dancing-600.woff") format("woff"); }
@page { size: 3.5in 2in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.card { width: 336px; height: 192px; overflow: hidden; page-break-after: always; break-after: page; }
.card:last-child { page-break-after: auto; break-after: auto; }
</style></head><body>
<div class="card">${swap(inner('Main.dc.html'))}</div>
<div class="card">${swap(inner('Back.dc.html'))}</div>
</body></html>`;
fs.writeFileSync(path.join(here, 'print.html'), page);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await browser.newPage({ viewport: { width: 336, height: 192 }, deviceScaleFactor: 300 / 96 });
await p.goto('file://' + path.join(here, 'print.html'));
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
const fonts = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight));
console.log('fonts loaded:', fonts.join(', ') || 'NONE');
await p.pdf({ path: path.join(here, 'MaiKnowledge-Business-Card.pdf'), preferCSSPageSize: true, printBackground: true });
// 300 DPI proofs
const cards = await p.$$('.card');
await cards[0].screenshot({ path: path.join(here, 'proof-front.png') });
await cards[1].screenshot({ path: path.join(here, 'proof-back.png') });
await browser.close();
console.log('done');
