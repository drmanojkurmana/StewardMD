// Settings > Home colour: only real colour codes pass, and pale colours are refused so white hero text stays readable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../home.js', import.meta.url), 'utf8');
const grab = (n) => src.slice(src.indexOf(`function ${n}(`), src.indexOf('\n  }\n', src.indexOf(`function ${n}(`)) + 4);
const { normHexD, hexOkD } = new Function(`${grab('normHexD')}\n${grab('hexOkD')}\nreturn { normHexD, hexOkD };`)();
test('normHexD accepts colour codes only', () => {
  assert.equal(normHexD('#00004D'), '#00004d');
  assert.equal(normHexD(' 00004d '), '#00004d');
  assert.equal(normHexD('#abc'), '#aabbcc');
  for (const bad of ['', 'navy', '#12345', '#00004g', '#000;}html{', null]) assert.equal(normHexD(bad), '');
});
test('hexOkD refuses colours white text cannot sit on', () => {
  assert.equal(hexOkD('#00004d'), true);
  assert.equal(hexOkD('#ffff00'), false);
  assert.equal(hexOkD('#ffffff'), false);
});
