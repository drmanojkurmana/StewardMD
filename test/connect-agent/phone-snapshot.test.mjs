// test/connect-agent/phone-snapshot.test.mjs — unit tests for connect-agent/phone/snapshot.mjs.
// Runs SNAPSHOT_SOURCE against a minimal DOM stand-in (no jsdom dependency) to check line format,
// digit redaction, truncation and ref bookkeeping without needing a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT_SOURCE, snapshotExpression, clickExpression } from '../../connect-agent/phone/snapshot.mjs';

// A tiny fake DOM sufficient for the walker: children, tagName, getAttribute, textContent,
// getClientRects, value, childElementCount.
function el(tag, { attrs = {}, text = '', children = [], visible = true } = {}) {
  return {
    tagName: tag.toUpperCase(),
    children,
    childElementCount: children.length,
    nodeType: 1,
    textContent: text,
    value: attrs.value || '',
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    getClientRects: () => (visible ? [{}] : []),
  };
}

function runSnapshot(bodyEl) {
  const fakeWindow = {};
  const fakeDocument = { body: bodyEl, documentElement: bodyEl };
  const fn = new Function('window', 'document', 'fetch', `return (${SNAPSHOT_SOURCE})();`);
  const result = fn(fakeWindow, fakeDocument, () => {});
  return { lines: result.split('\n').filter(Boolean), refs: fakeWindow.__smd_refs };
}

test('formats a link with a name and ref', () => {
  const body = el('body', { children: [el('a', { attrs: { href: '/x' }, text: 'Doctor Worklist' })] });
  const { lines } = runSnapshot(body);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- link "Doctor Worklist" \[ref=e1\]$/);
});

test('redacts runs of 4+ digits in names to #', () => {
  const body = el('body', { children: [el('a', { text: 'Patient 482910 chart' })] });
  const { lines } = runSnapshot(body);
  assert.match(lines[0], /Patient # chart/);
  assert.doesNotMatch(lines[0], /482910/);
});

test('does not redact short digit runs (under 4)', () => {
  const body = el('body', { children: [el('a', { text: 'Room 12' })] });
  const { lines } = runSnapshot(body);
  assert.match(lines[0], /Room 12/);
});

test('truncates names to 80 chars', () => {
  const long = 'x'.repeat(200);
  const body = el('body', { children: [el('a', { text: long })] });
  const { lines } = runSnapshot(body);
  const nameMatch = /"([^"]*)"/.exec(lines[0]);
  assert.ok(nameMatch);
  assert.equal(nameMatch[1].length, 80);
});

test('skips hidden elements (zero client rects)', () => {
  const body = el('body', { children: [el('a', { text: 'Hidden link', visible: false })] });
  const { lines } = runSnapshot(body);
  assert.equal(lines.length, 0);
});

test('heading and text lines carry no ref', () => {
  const body = el('body', {
    children: [
      el('h1', { text: 'IP Worklist' }),
      el('div', { text: 'Some context text' }),
    ],
  });
  const { lines } = runSnapshot(body);
  assert.match(lines[0], /^- heading "IP Worklist"$/);
  assert.doesNotMatch(lines[0], /ref=/);
  assert.match(lines[1], /^- text "Some context text"$/);
});

test('caps output at 400 lines', () => {
  const many = Array.from({ length: 500 }, (_, i) => el('a', { text: `Row ${i}` }));
  const body = el('body', { children: many });
  const { lines } = runSnapshot(body);
  assert.ok(lines.length <= 400);
});

test('window.__smd_refs is populated with one entry per ref emitted', () => {
  const linkEl = el('a', { text: 'Open chart' });
  const body = el('body', { children: [linkEl] });
  const { lines, refs } = runSnapshot(body);
  const ref = /\[ref=([a-z0-9]+)\]/.exec(lines[0])[1];
  assert.equal(refs[ref], linkEl);
});

test('snapshotExpression/clickExpression build the expected page-realm calls', () => {
  assert.match(snapshotExpression(), /^\(function SMD_CONNECT_SNAPSHOT/);
  const expr = clickExpression('e12');
  assert.match(expr, /__smd_refs&&window\.__smd_refs\["e12"\]/);
});
