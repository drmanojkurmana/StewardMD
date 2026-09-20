// test/connect-agent/phone-redo-merge.test.mjs — "Look again" must never cost the doctor work.
// The redo loop used to assign the new walk's views straight over the old list, so a second look that
// came back with less DELETED screens the doctor had demonstrated. On live GHIS that turned a run with
// labs + radiology proven into one reporting both "absent" (owner's iPhone, 2026-09-16), because
// neither view is reachable by the autonomous walk: radiology lives in its own module that the patient
// chart never links to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeObservedViews } from '../../connect-agent/phone/index.mjs';

const view = (resourceHint, pathTemplate) => ({ resourceHint, pathTemplate, rowsSelector: 'table tr' });

test('a second look that finds less keeps every view the doctor demonstrated', () => {
  const demonstrated = [view('labs', '/Doctor/Home'), view('radiology', '/Radio/Home')];
  const thinnerWalk = [view('worklist', '/Doctor/Home')];
  const merged = mergeObservedViews(demonstrated, thinnerWalk);
  const kinds = merged.map((v) => v.resourceHint).sort();
  assert.deepEqual(kinds, ['labs', 'radiology', 'worklist']);
});

test('a second look adds what it newly found', () => {
  const merged = mergeObservedViews([view('labs', '/Doctor/Home')], [view('radiology-detail', '/Radiology/Home/GetRadiologyResultPrint')]);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((v) => v.resourceHint === 'radiology-detail'));
});

test('the same view seen twice is not duplicated', () => {
  const merged = mergeObservedViews([view('labs', '/Doctor/Home')], [view('labs', '/Doctor/Home')]);
  assert.equal(merged.length, 1);
});

test('two views of one resource at different paths are both kept (list and its detail page)', () => {
  const merged = mergeObservedViews([view('labs', '/Lab/Home/GetSearchPatientId')], [view('labs', '/Lab/Home/GetPrintLabResultDetailsAuth')]);
  assert.equal(merged.length, 2);
});

test('an empty or missing second walk changes nothing', () => {
  const demonstrated = [view('radiology', '/Radio/Home')];
  assert.deepEqual(mergeObservedViews(demonstrated, []), demonstrated);
  assert.deepEqual(mergeObservedViews(demonstrated, undefined), demonstrated);
});

// GHIS ver_b27ed367 2026-09-17: the crawl's Administration > Lab reports click proved
// OTLabPrintsSecretary/?id=undefined (a page-side JS bug, id constant) at the same resource+path the
// doctor's own guided walk proved with id traced to the worklist row. Keying merge on resource+path
// alone kept whichever arrived first -- on that run, the crawl's wrong constant-id view.
function viewWithId(resourceHint, pathTemplate, idParam) {
  return { resourceHint, pathTemplate, rowsSelector: 'table tr', endpoints: [{ method: 'GET', path: pathTemplate, role: 'data', params: { id: idParam } }] };
}

test('a view whose patient key is traced to a row wins over one whose key is constant, in either order', () => {
  const constView = viewWithId('labs', '/Doctor/Home/OTLabPrintsSecretary/', { constant: 'undefined' });
  const tracedView = viewWithId('labs', '/Doctor/Home/OTLabPrintsSecretary/', { from: 'worklist', field: 'Patient ID' });

  const crawlFirst = mergeObservedViews([constView], [tracedView]);
  assert.equal(crawlFirst.length, 1);
  assert.deepEqual(crawlFirst[0].endpoints[0].params.id, { from: 'worklist', field: 'Patient ID' });

  const guidedFirst = mergeObservedViews([tracedView], [constView]);
  assert.equal(guidedFirst.length, 1);
  assert.deepEqual(guidedFirst[0].endpoints[0].params.id, { from: 'worklist', field: 'Patient ID' });
});
