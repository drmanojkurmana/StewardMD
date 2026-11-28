// The PaperOrchestra prompt includes record ids, PMIDs and DOIs. A run of ten
// digits inside a record id can satisfy the NHS checksum and used to block a
// systematic review with a false "patient identifiers" error. Bibliographic
// identifiers are skipped; real phone numbers and emails stay blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
function gates() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(readFileSync(repo + 'research-po-gates.js', 'utf8'), ctx);
  return ctx.SMD_RMD_PO_GATES;
}

test('record ids with a 10-digit run do not look like NHS numbers', () => {
  const g = gates();
  const text = 'rec_86eaba4595964145bafaaeae92d02357 | [SCREENED INCLUDE] Kashanian M et al. (2022)';
  const r = g.scanPhi(text, { allowCitationLibraryNames: true });
  assert.equal(r.blocked, false, JSON.stringify(r.hits));
});

test('PMIDs and DOIs are not patient identifiers', () => {
  const g = gates();
  for (const t of ['[PMID:35241023]', 'PMID 23023559', 'doi 10.1080/07853890.2024.2389302']) {
    assert.equal(g.scanPhi(t, { allowCitationLibraryNames: true }).blocked, false, t);
  }
});

test('real contact identifiers are still blocked', () => {
  const g = gates();
  assert.equal(g.scanPhi('call +919876543210', {}).blocked, true);
  assert.equal(g.scanPhi('email dr.mehta@example.com', {}).blocked, true);
});

test('a standalone valid NHS number is still blocked outside a citation', () => {
  const g = gates();
  const r = g.scanPhi('NHS number 9434765919 for the patient', {});
  assert.equal(r.blocked, true, JSON.stringify(r.hits));
});
