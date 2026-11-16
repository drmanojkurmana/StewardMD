/* Phase 3 pure helpers: templates, add-page maths, fav, outline, zoom, paging */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../study-pages.js");

test("templates: labels, dark detection, list covers required set", () => {
  assert.equal(P.tplIsDark("ruled-dark"), true);
  assert.equal(P.tplIsDark("ruled"), false);
  assert.equal(P.tplBase("ruled-dark"), "ruled");
  assert.match(P.tplLabel("ruled"), /Ruled/);
  assert.match(P.tplLabel("ruled-wide"), /wide/);
  assert.match(P.tplLabel("mcq"), /MCQ/);
  assert.match(P.tplLabel("blank-dark"), /Blank \(dark\)/);
  const list = P.tplList();
  ["blank","ruled","grid","dotgrid","cornell","mcq"].forEach(t => assert.ok(list.includes(t), "missing "+t));
  /* dark variants */
  ["blank-dark","ruled-dark","ruled-wide-dark","grid-dark","dotgrid-dark","cornell-dark","mcq-dark"].forEach(t => assert.ok(list.includes(t)));
});

test("addIndex: before/after/last", () => {
  assert.equal(P.addIndex(1,1,"before"), 0);
  assert.equal(P.addIndex(1,1,"after"), 1);
  assert.equal(P.addIndex(1,1,"last"), 1);
  assert.equal(P.addIndex(3,12,"before"), 2);
  assert.equal(P.addIndex(3,12,"after"), 3);
  assert.equal(P.addIndex(3,12,"last"), 12);
  assert.equal(P.addIndex(5,5,"after"), 5);
  assert.equal(P.addIndex(5,5,"last"), 5);
});

test("insertAt/removeAt: does not mutate", () => {
  const a=[1,2,3];
  assert.deepEqual(P.insertAt(a,1,9), [1,9,2,3]);
  assert.deepEqual(a, [1,2,3]);
  assert.deepEqual(P.removeAt([1,9,2,3],1), [1,2,3]);
  assert.deepEqual(P.removeAt([1,2],5), [1,2]);
});

test("rotateStep: 90deg cycle", () => {
  assert.equal(P.rotateStep(0,1),1);
  assert.equal(P.rotateStep(3,1),0);
  assert.equal(P.rotateStep(0,-1),3);
  assert.equal(P.rotateStep(2,2),0);
});

test("zoom: clamp 50-400%", () => {
  assert.equal(P.clampZoom(0.2),0.5);
  assert.equal(P.clampZoom(1),1);
  assert.equal(P.clampZoom(4),4);
  assert.equal(P.clampZoom(8),4);
  assert.equal(P.pinchZoom(1,100,200),2);
  assert.equal(P.pinchZoom(2,100,50),1);
  assert.equal(P.pinchZoom(4,100,300),4);
});

test("fav: toggle per page, isFav", () => {
  const doc={ favPages:{} };
  assert.equal(P.isFav(doc,"3"), false);
  let m=P.toggleFav(doc.favPages,"3");
  assert.equal(P.isFav({favPages:m},"3"), true);
  m=P.toggleFav(m,"3");
  assert.equal(P.isFav({favPages:m},"3"), false);
  assert.deepEqual(m, {});
});

test("outline flatten + filter", () => {
  const out=[{title:"Intro",dest:[1]},{title:"Anatomy",dest:[5],items:[{title:"Heart",dest:[6]}]}];
  const flat=P.flattenOutline(out,[],0);
  assert.equal(flat.length,3);
  assert.equal(flat[0].title,"Intro");
  assert.equal(flat[2].level,1);
  assert.equal(P.filterOutline(flat,"intro").length,1);
  assert.equal(P.filterOutline(flat,"").length,3);
  assert.equal(P.filterOutline(flat,"heart").length,1);
});

test("visibleRange: lazy near viewport, no gaps", () => {
  const heights=[100,100,100,100,100];
  const [lo,hi]=P.visibleRange(0,200, heights, 1);
  /* scrollTop 0, client 200, margin 1 => window -200 to 600 => pages 0..3 (4 pages) within */
  assert.ok(lo===0 && hi>=2 && hi<=4);
  const [lo2,hi2]=P.visibleRange(1000,200, heights, 0);
  /* far beyond => last page */
  assert.ok(hi2<heights.length);
});

test("fitWidth: double-tap fit", () => {
  assert.equal(P.fitWidth(400,400),1);
  assert.equal(P.fitWidth(200,400),2);
});
