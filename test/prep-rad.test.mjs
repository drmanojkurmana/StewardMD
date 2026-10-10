// Radiology NEET-SS pilot builder (tools/prep-rad.mjs) pure helpers and the taxonomy entry.
// Plan: vault/plans/PrepNucleus-RadiologySS.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { licenceOf, xmlLicence, caseText, rankCand, gates, tidy, toItem, strayNumbers, copyRun, genPrompt, tableOk, authorsShort, SOURCE } from "../tools/prep-rad.mjs";
import { validateSubject, taxonomyForApp, loadTaxonomy } from "../tools/prep-build-bank.mjs";

test("licenceOf keeps CC BY, CC BY-SA and CC0 and drops NC, ND and unknown", () => {
  assert.equal(licenceOf("http://creativecommons.org/licenses/by/4.0/").code, "CC BY 4.0");
  assert.equal(licenceOf("https://creativecommons.org/licenses/by/3.0").code, "CC BY 3.0");
  assert.equal(licenceOf("https://creativecommons.org/licenses/by-sa/4.0/").code, "CC BY-SA 4.0");
  assert.equal(licenceOf("https://creativecommons.org/publicdomain/zero/1.0/").code, "CC0 1.0");
  for (const bad of ["http://creativecommons.org/licenses/by-nc/4.0/", "https://creativecommons.org/licenses/by-nc-nd/4.0/", "https://creativecommons.org/licenses/by-nd/2.0", "", null, "open-access"]) assert.equal(licenceOf(bad), null, String(bad));
});

test("xmlLicence reads the article's own permissions block and refuses a mixed or NC one", () => {
  const ok = '<article><permissions><license xlink:href="https://creativecommons.org/licenses/by/4.0/"><license-p>This article is distributed under CC BY.</license-p></license></permissions></article>';
  assert.equal(xmlLicence(ok).code, "CC BY 4.0");
  const nc = '<permissions><ali:license_ref>https://creativecommons.org/licenses/by-nc/4.0/</ali:license_ref></permissions>';
  assert.equal(xmlLicence(nc), null);
  const mixed = '<permissions><license xlink:href="https://creativecommons.org/licenses/by/4.0/"/><ali:license_ref>https://creativecommons.org/licenses/by-nc-nd/4.0/</ali:license_ref></permissions>';
  assert.equal(xmlLicence(mixed), null);
  const textOnly = "<permissions><license><license-p>This is an open access article under the Creative Commons Attribution 4.0 International License.</license-p></license></permissions>";
  assert.equal(xmlLicence(textOnly).code, "CC BY 4.0");
  assert.equal(xmlLicence("<article></article>"), null);
});

test("caseText takes the case section without figures or reference numbers", () => {
  const xml = '<article><abstract><p>Abstract words here.</p></abstract><body><sec><title>Introduction</title><p>Intro text.</p></sec>' +
    '<sec><title>Case presentation</title><p>A 45-year-old man had fever [1, 2].</p><fig id="F1"><caption>Fig text</caption></fig><p>CT showed gas [3].</p></sec>' +
    '<sec><title>Discussion</title><p>Discussion text [4].</p></sec></body></article>';
  const c = caseText(xml);
  assert.match(c.case, /45-year-old man had fever/);
  assert.match(c.case, /CT showed gas/);
  assert.doesNotMatch(c.case, /\[\s*1|Fig text|Intro text/);
  assert.match(c.discussion, /Discussion text/);
  assert.equal(c.abstract, "Abstract words here.");
});

test("rankCand prefers an imaging caption that names the disease and has one panel", () => {
  const dx = "Emphysematous pyelonephritis";
  const a = rankCand({ caption: "Axial CT shows gas in the renal parenchyma, emphysematous pyelonephritis." }, dx);
  const b = rankCand({ caption: "(A) Clinical photo. (B) Histology of the kidney." }, dx);
  assert.ok(a > b);
});

const ITEM = {
  q: "A 45-year-old diabetic man has fever and right flank pain. The image shown is from his contrast CT. What is the most appropriate next step?",
  o: ["Percutaneous drainage with antibiotics", "Observation only", "Open biopsy", "Radiotherapy"], a: 0,
  ky: "Percutaneous drainage with antibiotics is right because gas confined to the kidney with a collection is drained first.",
  nt: "## Imaging\n- **Gas** in the renal parenchyma on CT defines the disease.\n- Class matters for treatment.\n## Next step\n| Class | Step |\n| --- | --- |\n| Gas in collecting system | Antibiotics and drainage |\n| Parenchymal gas | Drainage or nephrectomy |\nUltrasound shows dirty shadowing but CT is the test of choice and shows the extent of gas into the perinephric space and the need for urgent source control in a diabetic patient with sepsis and flank pain.",
  ot: [{ k: "B", why: "Observation misses a lethal infection." }, { k: "C", why: "Biopsy has no role." }, { k: "D", why: "This is not a tumour." }],
  pl: "CT is the test of choice for gas forming renal infection.", d: 2,
};
const GROUND = "We present a 45-year-old diabetic man who presented with right-sided flank pain and fever. CT showed gas.";

test("tidy shapes a model reply and gates pass a clean item", () => {
  const x = tidy(ITEM);
  assert.equal(x.a, 0);
  assert.deepEqual(Object.keys(x.others).sort(), ["B", "C", "D"]);
  assert.equal(gates(x, { kind: "img" }, GROUND), null);
  assert.equal(tidy({ ...ITEM, o: ["a", "b"] }), null);
  assert.equal(tidy({ ...ITEM, a: 7 }), null);
});

test("gates catch dashes, sources, stray numbers, copies, a missing image reference and a named key", () => {
  const x = () => tidy(ITEM);
  assert.equal(gates({ ...x(), ky: x().ky + " — indeed" }, {}, GROUND), "dash");
  assert.equal(gates({ ...x(), pl: "As this case report shows, CT is best." }, {}, GROUND), "source");
  assert.equal(gates({ ...x(), pl: "Gas appears in 37 percent." }, {}, GROUND), "numbers");
  assert.equal(gates({ ...x(), pl: "We present a 45-year-old diabetic man who presented with right-sided flank pain and fever." }, {}, GROUND), "verbatim");
  assert.equal(gates({ ...x(), q: "A 45-year-old diabetic man has fever. What is the next step?" }, {}, GROUND), "no-image-ref");
  assert.equal(gates({ ...x(), q: x().q + " Percutaneous drainage with antibiotics was planned." }, {}, GROUND), "key-in-stem");
  assert.equal(gates({ ...x(), o: ["A", "A", "B", "C"] }, {}, GROUND), "options");
  assert.ok(SOURCE.test("Radiopaedia") && SOURCE.test("et al") && SOURCE.test("AI-generated"));
});

test("strayNumbers, copyRun and tableOk", () => {
  assert.deepEqual(strayNumbers("A 45-year-old with 3 lesions of 12 mm", "45 years"), ["12"]);
  assert.deepEqual(strayNumbers("T2 and T1 images in 2021, 1st study", ""), []);
  assert.equal(copyRun("one two three four five six seven eight nine ten eleven twelve", "x one two three four five six seven eight nine ten eleven twelve y"), true);
  assert.equal(copyRun("one two three", "one two three"), false);
  assert.equal(tableOk("| a | b |\n| --- | --- |\n| 1 | 2 |"), true);
  assert.equal(tableOk("| a | b |\n| 1 | 2 | 3 |"), false);
  assert.equal(authorsShort("A B, C D, E F, G H"), "A B, C D, E F et al.");
});

test("toItem builds the bank item with a bank-relative image path or a stack", () => {
  const x = tidy(ITEM);
  const it = toItem(x, { style: "next" }, { id: "rad-emph-pyelo", img: "v6/ss-radiology/img/rad-emph.webp" });
  assert.equal(it.id, "rad-emph-pyelo");
  assert.deepEqual(it.img, ["v6/ss-radiology/img/rad-emph.webp"]);
  assert.equal(it.imgPlace, "stem");
  assert.equal(it.r.length, 4);
  assert.equal(it.r[0], x.ky);
  assert.equal(it.exp, x.ky);
  assert.equal(it.kp, x.pl);
  assert.deepEqual(it.ex, ["neet-ss"]);
  assert.ok(it.x && it.x.notes && it.x.others.B);
  const st = toItem(x, { style: "dx" }, { id: "rad-st-x", stack: { id: "rad-x-01", n: 40, base: "v6/ss-radiology/stack/rad-x-01/", w: ["soft"] } });
  assert.equal(st.stack.n, 40);
  assert.equal(st.img, undefined);
});

test("genPrompt names the target and keeps sources and AI out of what it asks for", () => {
  const p = genPrompt({ kind: "img", dx: "Moyamoya disease", style: "sign" }, { caption: "MRA shows stenoses.", text: "A 35-year-old woman.", extra: "" });
  assert.match(p.user, /Moyamoya disease/);
  assert.match(p.system, /Never mention the article/);
  assert.match(p.system, /No long dashes/);
  const s = genPrompt({ kind: "stack", dx: "Glioblastoma", style: "proto" }, { modality: "MRI", series: "48 slices", text: "A 69-year-old man." });
  assert.match(s.system, /scrollable/);
});

test("the ss-radiology taxonomy entry is valid, ships bv v9 (owner-notes module v7 plus the radmax and radmax depth items, tools/prep-radss.mjs) and changes no other subject", () => {
  const src = JSON.parse(fs.readFileSync(new URL("../prep/taxonomy/ss-radiology.json", import.meta.url), "utf8"));
  assert.deepEqual(validateSubject(src), []);
  assert.deepEqual(validateSubject({ ...src, bank: "x6" }), ["bank x6"]);
  const app = taxonomyForApp(loadTaxonomy());
  const rad = app.branches.flatMap((b) => b.subjects).find((s) => s.id === "ss-radiology");
  assert.equal(rad.bv, "v16");
  assert.deepEqual(rad.ex, ["neet-ss"]);
  assert.equal(rad.sections.reduce((n, s) => n + s.modules.length, 0), 24);
  assert.equal(app.branches.flatMap((b) => b.subjects).filter((s) => s.bv).length, 1);
  const shipped = JSON.parse(fs.readFileSync(new URL("../prep/taxonomy.json", import.meta.url), "utf8"));
  assert.deepEqual(shipped, app, "prep/taxonomy.json is regenerated from prep/taxonomy/");
});
