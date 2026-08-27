/* The scrollcraft harness only samples [data-sc-act] elements, so the two flow
   sections on this page are never photographed by it. This shoots them
   directly, plus a couple of neighbouring offsets, so they get looked at. */
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://localhost:4517';
const OUT = process.argv[3] || 'lab/flow';
const W = Number(process.argv[4] || 1440);
const H = Number(process.argv[5] || 900);

const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const p = await b.newPage({ viewport: { width: W, height: H } });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);

const targets = await p.$$eval('main > section', (ns) =>
  ns.map((n, i) => ({ i, cls: n.className || '(act)', top: n.offsetTop, h: n.offsetHeight }))
);
console.log(targets);

const fs = await import('node:fs/promises');
await fs.mkdir(OUT, { recursive: true });

for (const t of targets) {
  /* three positions inside each section: entering, middle, leaving */
  for (const [tag, frac] of [['a', 0.12], ['b', 0.5], ['c', 0.85]]) {
    const y = Math.max(0, t.top + t.h * frac - H / 2);
    await p.evaluate((y) => window.scrollTo(0, y), y);
    await p.waitForTimeout(320);
    await p.screenshot({ path: `${OUT}/s${String(t.i).padStart(2, '0')}${tag}.png` });
  }
}

await b.close();
console.log('wrote', OUT);
