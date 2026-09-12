// Assembles a 6-page PDF: Manoj front/back, Diwakar front/back, Company front/back.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const here = path.dirname(new URL(import.meta.url).pathname);
const inner = (f) => { const s = fs.readFileSync(path.join(here, 'artboards', f), 'utf8'); const m = s.match(/<\/helmet>\s*([\s\S]*?)<\/x-dc>/); return m[1]; };
const b64 = (n) => 'data:image/png;base64,' + fs.readFileSync(path.join(here, 'img', n)).toString('base64');
const swap = (html) => html.replace(/src="([a-z-]+)\.png"/g, (_, n) => `src="${b64(n + '.png')}"`);
const pairs = [
  ['Main.dc.html', 'Back.dc.html'],
  ['MainDiwakar.dc.html', 'BackDiwakar.dc.html'],
  ['MainCompany.dc.html', 'BackCompany.dc.html'],
];
const cards = pairs.flatMap(([f, b]) => [swap(inner(f)), swap(inner(b))]);
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
${cards.map(c => `<div class="card">${c}</div>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(here, 'print-all.html'), page);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await browser.newPage({ viewport: { width: 336, height: 192 }, deviceScaleFactor: 300 / 96 });
await p.goto('file://' + path.join(here, 'print-all.html'));
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
await p.pdf({ path: path.join(here, 'MaiKnowledge-Business-Cards-All.pdf'), preferCSSPageSize: true, printBackground: true });
const els = await p.$$('.card');
const names = ['front-manoj','back-manoj','front-diwakar','back-diwakar','front-company','back-company'];
for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: path.join(here, `proof-${names[i]}.png`) });
await browser.close();
console.log('done', els.length, 'cards');
