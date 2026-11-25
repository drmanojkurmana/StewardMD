// Guard: every ResearchMD export goes through the shared native-safe helper.
// a.download does nothing in the iOS/Android WebView, so no research*.js may
// use it outside SMD.p2.saveFile in research.js (Filesystem CACHE + Share).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(repo).filter((f) => /^research.*\.js$/.test(f));
const DOWNLOAD_RE = /\.download\s*=|setAttribute\(\s*["']download["']/g;

test('research*.js files exist to scan', () => {
  assert.ok(files.length >= 10, `expected research modules, found ${files.length}`);
});

test('no a.download usage outside the shared saveFile helper', () => {
  for (const f of files) {
    const src = readFileSync(join(repo, f), 'utf8');
    const matches = [...src.matchAll(DOWNLOAD_RE)];
    if (f !== 'research.js') {
      assert.equal(matches.length, 0, `${f} uses a.download directly; route exports through SMD.p2.saveFile/downloadText/downloadBytes`);
      continue;
    }
    const start = src.indexOf('function saveFile(');
    const end = src.indexOf('function downloadText(');
    assert.ok(start > -1 && end > start, 'research.js defines saveFile before downloadText');
    for (const m of matches) {
      assert.ok(m.index > start && m.index < end, 'research.js a.download usage must stay inside saveFile (the non-native fallback)');
    }
  }
});

test('shared helper writes to CACHE and shares the file uri on native', () => {
  const src = readFileSync(join(repo, 'research.js'), 'utf8');
  assert.match(src, /Filesystem\.writeFile\(\{[\s\S]*?directory:\s*"CACHE"/);
  assert.match(src, /Share\.share\(\{[\s\S]*?url:\s*w\.uri/);
  assert.match(src, /dialogTitle:\s*"Save or send your file"/);
  assert.match(src, /downloadText:\s*downloadText/);
  assert.match(src, /downloadBytes:\s*downloadBytes/);
  assert.match(src, /saveFile:\s*saveFile/);
});

test('research export screens route through SMD.p2 download helpers', () => {
  const expect = {
    'research-screen-run.js': /SMD\.p2\.downloadText\(/,
    'research-screen-checklist.js': /SMD\.p2\.downloadText\(/,
    'research-screen-protocol.js': /downloadText\(/,
    'research-screen-manuscript.js': /SMD\.p2\.downloadBytes\(/
  };
  for (const [f, re] of Object.entries(expect)) {
    const src = readFileSync(join(repo, f), 'utf8');
    assert.match(src, re, `${f} must export via the shared helper`);
  }
});
