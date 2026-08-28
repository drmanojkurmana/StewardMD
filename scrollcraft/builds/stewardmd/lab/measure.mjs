/* devices.md §3: a pan rail narrower than the viewport travels ZERO and the act
   becomes a motionless pinned screen. The harness reports "no dead scroll" on
   it every time, so this has to be measured by hand, at every width. */
import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'http://localhost:4517';
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});

for (const [w, h] of [[1920, 1080], [1440, 900], [1180, 820], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const rail = document.querySelector('.rail');
    return { sw: rail.scrollWidth, vw: window.innerWidth };
  });
  const over = r.sw - r.vw;
  const halfVp = r.vw * 0.5;
  console.log(
    `${String(w).padStart(4)}px  scrollWidth ${r.sw}  overflow ${over}px  ` +
    `(want > ${Math.round(halfVp)})  ${over > halfVp ? 'OK' : over > 0 ? 'THIN' : 'DEAD'}`
  );
  await p.close();
}
await b.close();
