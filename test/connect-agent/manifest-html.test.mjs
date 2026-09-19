// test/connect-agent/manifest-html.test.mjs -- node --test
// All patient values here are FAKE. No real PHI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHtml, extractRecords, matchSelector, isValidSelector, HTML_SELECTOR_RE,
} from '../../connect-agent/manifest/html.mjs';

// Synthetic GHIS worklist table, 3 rows, mirroring the real column layout (fake values).
const WORKLIST = `
<table id="data_tables1" class="table table-bordered appointments dataTable"><tbody>
<tr onclick="searchPatient('MR900001','Arrived and Occupied','IPMR700001','2012130687')" class="odd">
  <td>MR900001</td><td>IPMR700001</td><td>JANE DOE</td><td>Cardiology</td><td>45</td><td>Female</td>
  <td>DR SMITH<input type='text' value='2055792' id='curr_doc' hidden></td><td>B-12</td><td>R-3</td>
  <td class='sorting_1'>IP</td><td>2026-09-01</td>
</tr>
<tr onclick="searchPatient('MR900002','Waiting','IPMR700002','2012130688')" class="even">
  <td>MR900002</td><td>IPMR700002</td><td>JOHN ROE</td><td>Neurology</td><td>62</td><td>Male</td>
  <td>DR JONES<input type='text' value='2055793' id='curr_doc' hidden></td><td>C-04</td><td>R-7</td>
  <td class='sorting_1'>IP</td><td>2026-09-02</td>
</tr>
<tr onclick="searchPatient('MR900003','Discharged','IPMR700003','2012130689')" class="odd">
  <td>MR900003</td><td>IPMR700003</td><td>MARY POE</td><td>Oncology</td><td>30</td><td>Female</td>
  <td>DR LEE<input type='text' value='2055794' id='curr_doc' hidden></td><td>A-01</td><td>R-1</td>
  <td class='sorting_1'>OP</td><td>2026-09-03</td>
</tr>
</tbody></table>`;

const WORKLIST_SPEC = {
  rows: '#data_tables1 tbody tr',
  fields: {
    mrn: { cell: 0 }, visitId: { cell: 1 }, name: { cell: 2 }, dept: { cell: 3 },
    age: { cell: 4 }, sex: { cell: 5 }, bed: { cell: 7 }, admit: { cell: 10 },
    mrnFromClick: { onclickArg: 0 }, visitFromClick: { onclickArg: 2 },
  },
};

test('worklist: extracts per-row strings, onclick args, nested input does not corrupt cell text', () => {
  const recs = extractRecords(WORKLIST, WORKLIST_SPEC);
  assert.equal(recs.length, 3);

  assert.deepEqual({ ...recs[0] }, {
    mrn: 'MR900001', visitId: 'IPMR700001', name: 'JANE DOE', dept: 'Cardiology',
    age: '45', sex: 'Female', bed: 'B-12', admit: '2026-09-01',
    mrnFromClick: 'MR900001', visitFromClick: 'IPMR700001',
  });
  assert.equal(recs[1].mrn, 'MR900002');
  assert.equal(recs[2].name, 'MARY POE');
  assert.equal(recs[2].admit, '2026-09-03');

  // mrnFromClick == mrn for every row
  for (const r of recs) assert.equal(r.mrnFromClick, r.mrn);

  // the doctor cell (index 6, not extracted) has a nested hidden input; verify it does not leak text
  const doctorCell = parseHtml(WORKLIST).querySelectorAll('#data_tables1 tbody tr')[0].querySelectorAll('td')[6];
  assert.equal(doctorCell.textContent.trim(), 'DR SMITH');

  // records are null-proto
  assert.equal(Object.getPrototypeOf(recs[0]), null);
});

test('detail page: label/value single record via selector rule', () => {
  const html = `<div class="pd"><label>Patient Name</label><span id="pName">JANE DOE</span>
    <label>MRN</label><span id="mrn">MR900001</span></div>`;
  const recs = extractRecords(html, { rows: '.pd', fields: { name: { selector: '#pName', attr: 'text' } } });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].name, 'JANE DOE');
});

test('selector grammar: descendant, child, class, attr=, nth-of-type, comma groups', () => {
  const html = `<div class="wrap">
    <p class="a">one</p><p class="a">two</p>
    <section><a data-k="v">link</a><b>b1</b></section>
    <ul><li>x</li><li>y</li></ul>
  </div>`;
  const doc = parseHtml(html);

  assert.equal(doc.querySelectorAll('.wrap p').length, 2);              // descendant
  assert.equal(doc.querySelectorAll('section > a').length, 1);         // child
  assert.equal(doc.querySelector('p.a').textContent, 'one');           // class
  assert.equal(doc.querySelector('a[data-k="v"]').textContent, 'link'); // attr=
  assert.equal(doc.querySelector('p:nth-of-type(2)').textContent, 'two'); // nth-of-type
  assert.equal(doc.querySelectorAll('b, li').length, 3);               // comma groups

  // unsupported selectors: no throw, no matches
  assert.deepEqual(doc.querySelectorAll('div:hover'), []);
  assert.deepEqual(doc.querySelectorAll('a ~ b'), []);
  assert.equal(isValidSelector('div:hover'), false);
  assert.equal(isValidSelector('a ~ b'), false);
  assert.equal(isValidSelector('#data_tables1 tbody tr'), true);
  assert.equal(isValidSelector('a[data-k="v"]'), true);
  assert.equal(matchSelector(doc.querySelector('p.a'), 'p.a'), true);
});

test('malformed HTML: unclosed td, mismatched tags, script content is not parsed as tags', () => {
  const html = `<table id="t"><tbody>
    <tr><td>A1<td>A2<td>A3</tr>
    <tr><td>B1</span></td><td>B2</td></tr>
  </tbody></table>
  <div><script>var x='<td>phantom</td>';</script><span>real</span></div>`;
  const doc = parseHtml(html);

  // unclosed <td> still yields three distinct cells in the first row
  const row0 = doc.querySelectorAll('#t tbody tr')[0];
  assert.deepEqual(row0.querySelectorAll('td').map((c) => c.textContent), ['A1', 'A2', 'A3']);

  // script contents must not create phantom cells anywhere
  assert.equal(doc.querySelectorAll('td').length, 5); // 3 + 2, no phantom
  assert.equal(doc.querySelector('div span').textContent, 'real');
  // script text excluded from textContent
  assert.equal(doc.querySelector('div').textContent.includes('phantom'), false);
});

test('entities decode in text and attributes', () => {
  const doc = parseHtml('<a title="a &amp; b &#39;q&#39;">x &lt;y&gt; &#x41;&nbsp;z</a>');
  const a = doc.querySelector('a');
  assert.equal(a.getAttribute('title'), "a & b 'q'");
  assert.equal(a.textContent, 'x <y> A z');
});

test('hardening: oversize input throws before parsing', () => {
  const big = 'a'.repeat(100);
  assert.throws(() => parseHtml(big, { maxBytes: 10 }), /maxBytes/);
  assert.throws(() => extractRecords(big, { rows: 'a', fields: { id: { cell: 0 } } }, { maxBytes: 10 }), /maxBytes/);
});

test('hardening: deeply nested divs do not hang and return a bounded tree', () => {
  const html = '<div>'.repeat(2000) + 'deep' + '</div>'.repeat(2000);
  const start = Date.now();
  const doc = parseHtml(html, { maxDepth: 500 });
  assert.ok(Date.now() - start < 2000, 'parse completed quickly');
  // parsing stopped at the depth cap; tree exists and is walkable
  assert.equal(doc.tagName, '#document');
  assert.ok(doc.querySelectorAll('div').length <= 501);
});

test('hardening: node-count cap stops parsing, returns partial tree', () => {
  const html = '<p></p>'.repeat(5000);
  const doc = parseHtml(html, { maxNodes: 100 });
  assert.ok(doc.querySelectorAll('p').length <= 100);
});

test('hardening: no prototype pollution from __proto__ attribute or record key', () => {
  const doc = parseHtml('<div __proto__="x" class="y" constructor="z">hello</div>');
  const div = doc.querySelector('div.y');
  assert.ok(div, 'element parsed normally');
  assert.equal(div.getAttribute('__proto__'), 'x'); // stored as a safe own property
  assert.equal(div.getAttribute('class'), 'y');
  // Object.prototype must be untouched by the hostile attribute name
  assert.equal(({}).x, undefined);
  assert.equal(Object.prototype.x, undefined);

  // a rule producing a forbidden record key is dropped; still no pollution
  const recs = extractRecords('<div class="y"><span>v</span></div>', {
    rows: '.y',
    fields: { __proto__: { selector: 'span', attr: 'text' }, ok: { selector: 'span', attr: 'text' } },
  });
  assert.equal(recs[0].ok, 'v');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).ok, undefined); // __proto__ key did not become a shared prototype member
  assert.equal(Object.getPrototypeOf(recs[0]), null);
});

test('hardening: pathological selector string is rejected fast', () => {
  const evil = '[' + 'a='.repeat(5000) + ']'; // long, way over the 200 cap
  const start = Date.now();
  assert.equal(isValidSelector(evil), false);
  assert.equal(HTML_SELECTOR_RE.test(evil), false);
  const doc = parseHtml('<div>x</div>');
  assert.deepEqual(doc.querySelectorAll(evil), []);
  assert.ok(Date.now() - start < 200, 'validation returned quickly');
});

test('extractRecords: rows matching nothing returns []', () => {
  assert.deepEqual(extractRecords('<div></div>', { rows: '#nope tr', fields: { id: { cell: 0 } } }), []);
});
