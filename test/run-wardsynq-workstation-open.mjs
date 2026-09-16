/* test/run-wardsynq-workstation-open.mjs - the Order safety workstation in a real headless Chrome (LT-09).
 *
 * Live test 2026-09-15: the workstation showed three fabricated patients (Anjali Menon, Ravi Deshpande,
 * Meera Iyer) and "Sign order" made no request at all. Here the real page and modules run against
 * test/wardsynq-workstation-stub.mjs, which answers /api/queue/* in the real routes' shapes (the real
 * router is driven with the same requests in test/wardsynq-order-workstation.test.mjs). Proved:
 *   - the roster is the hospital's admitted patients from /ward/list, and no fabricated patient appears;
 *   - Sign is the chart's two steps on /ward/medication-order: checkOnly, then the order; "Saved" only
 *     when the server wrote it, and no verdict of the page's own is ever sent;
 *   - a finding is shown before anything is written, and proceeding needs a typed reason;
 *   - a server refusal is "Not saved" with the server's reason;
 *   - a list that failed, an empty ward and allergies that could not be read each look like what they are;
 *   - no session gives the sign-in prompt and ordering stays disabled.
 *
 *   node test/run-wardsynq-workstation-open.mjs
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { startStub, PATIENT } from "./wardsynq-workstation-stub.mjs";

const PORT = Number(process.env.WSQ_WS_PORT || 8871);
const stub = await startStub(PORT);
const PAGE = `http://localhost:${PORT}/wardsynq/ui/wardsynq.html?site=1&orgId=org-harness`;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { console.log(`  ${c ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); c ? pass++ : fail++; };
const b = await launch({ port: Number(process.env.CDP_PORT || 9472) });
const text = (id) => b.ev(`var e = document.getElementById(${JSON.stringify(id)}); return e ? e.textContent : ""`);
const setVal = (id, v) => b.ev(`var e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); return 1`);
const orderPosts = () => stub.calls.filter((c) => c.method === "POST" && c.path === "/ward/medication-order");
const open = async (mode) => {
  stub.set(mode); stub.calls.length = 0;
  await b.nav(PAGE);
  return b.until(`var r = document.getElementById("roster"); return r && !r.querySelector(".wait") ? r.textContent : ""`, 15000);
};
const choosePatient = async () => {
  await b.click("#roster button.pt");
  return b.until(`return document.getElementById("drug").disabled === false || /cannot be checked/.test(document.getElementById("findings").textContent) ? "y" : ""`, 10000);
};
const fill = async (drug, dose, freq) => { await setVal("drug", drug); await setVal("dose", dose); await setVal("freq", freq); await b.sleep(150); };
try {
  // 1. The hospital's own ward, no fabricated patients.
  const roster = await open("ok");
  ok(roster.indexOf(PATIENT.name) >= 0, "the roster is the admitted patient from /ward/list", roster);
  ok(!/Anjali Menon|Ravi Deshpande|Meera Iyer|GH-40118/.test(await b.ev(`return document.body.textContent`)), "no fabricated patient anywhere on the page");
  ok(stub.calls.some((c) => c.path === "/ward/list" && c.query.orgId === "org-harness"), "the roster was read for this hospital");
  ok(await b.ev(`return document.getElementById("drug").disabled`) === true, "nothing can be ordered before a patient is chosen");

  await choosePatient();
  ok(await b.ev(`return document.getElementById("drug").disabled`) === false, "choosing the patient loads their context and enables ordering");
  const ident = await text("identity");
  ok(ident.indexOf("62 kg") >= 0 && ident.indexOf("Penicillins") >= 0, "weight and allergy come from the record", ident);
  ok(["/ward/fhir/AllergyIntolerance", "/ward/timeline", `/ward/fhir/Patient/${PATIENT.patientId}`, "/ward/fhir/Observation"].every((p) => stub.calls.some((c) => c.path === p)), "context read through the ward routes");

  // 2. A clean order: checkOnly, then the order, then "Saved".
  await fill("Paracetamol", "1000", "");
  ok(await b.ev(`return document.getElementById("sign").disabled`) === true && /how often/.test(await text("signWhy")), "an order with no frequency cannot be signed", await text("signWhy"));
  await setVal("freq", "q6h");
  stub.calls.length = 0;
  await b.click("#sign");
  const saved = await b.until(`return /Saved to/.test(document.getElementById("signed").textContent) ? document.getElementById("signed").textContent : ""`, 8000);
  ok(!!saved, "the screen says it was saved", saved);
  const [chk, put] = orderPosts();
  ok(!!chk && chk.body.checkOnly === true && !!put && put.body.checkOnly === undefined, "Sign asked the server to check first (checkOnly), then placed the order", JSON.stringify(orderPosts().map((c) => c.body)));
  ok(put && put.body.orgId === "org-harness" && put.body.order.patientId === PATIENT.patientId && put.body.order.encounterId === PATIENT.encounterId
    && put.body.order.drug === "Paracetamol" && put.body.order.dose.value === 1000 && put.body.order.frequency === "q6h", "the order names the chosen admission, dose and frequency", JSON.stringify(put && put.body));
  ok(put && put.body.safety === undefined && chk.body.safety === undefined, "no verdict of the page's own is sent; the server checks");
  ok(stub.calls.some((c) => c.path === "/ward/timeline"), "the patient's medicines are re-read from the server after saving");

  // 3. A finding is shown before anything is written, and proceeding needs a reason.
  stub.calls.length = 0;
  await fill("Amoxicillin", "500", "TDS");
  await b.click("#sign");
  const review = await b.until(`var f = document.getElementById("findings").textContent; return /documented allergic/.test(f) ? f : ""`, 8000);
  ok(!!review && orderPosts().length === 1 && orderPosts()[0].body.checkOnly === true, "the server's finding is shown and nothing was written", review);
  ok(await text("sign") === "Sign anyway" && !!(await b.ev(`return document.getElementById("reason") ? "y" : ""`)), "proceeding is Sign anyway, with a reason box");
  // Retest 2026-09-16: the label says what the server does. An overridable finding is not a "Hard stop".
  const cls = await b.ev(`return Array.prototype.map.call(document.querySelectorAll("#findings .cls"), function (e) { return e.textContent; }).join("|")`);
  ok(cls === "Needs a reason to proceed" && !/Hard stop/.test(await text("findings")), "an overridable finding reads Needs a reason to proceed", cls);
  await b.click("#sign");
  await b.sleep(300);
  ok(/Give a reason/.test(await text("signed")) && orderPosts().length === 1, "Sign anyway with no reason writes nothing", await text("signed"));
  await b.ev(`var t = document.getElementById("reason"); t.value = "Anaphylaxis history disputed, allergy team agrees"; t.dispatchEvent(new Event("input", { bubbles: true })); return 1`);
  await b.click("#sign");
  const saved2 = await b.until(`return /Saved to/.test(document.getElementById("signed").textContent) ? "y" : ""`, 8000);
  const last = orderPosts().pop();
  ok(!!saved2 && last && last.body.overrideReason === "Anaphylaxis history disputed, allergy team agrees" && last.body.checkOnly === undefined, "with a reason the order is placed and carries it", JSON.stringify(last && last.body));

  // 4. A changed order is checked again, never signed on the old check.
  await fill("Amoxicillin", "500", "TDS");
  await b.click("#sign");
  await b.until(`return /documented allergic/.test(document.getElementById("findings").textContent) ? "y" : ""`, 8000);
  await setVal("dose", "250");
  ok(await text("sign") === "Sign order" && !/documented allergic/.test(await text("findings")), "changing the order drops the check it no longer matches");
  await b.click("#clear");

  // 4b. Retest 2026-09-16: a hard stop the server refuses cannot be signed past, reason or not.
  stub.calls.length = 0;
  await fill("Paracetamol 1g", "1000", "QDS");
  await b.click("#sign");
  const stopped = await b.until(`var f = document.getElementById("findings").textContent; return /8000 mg a day/.test(f) ? f : ""`, 8000);
  const cls2 = await b.ev(`return Array.prototype.map.call(document.querySelectorAll("#findings .cls"), function (e) { return e.textContent; }).join("|")`);
  ok(!!stopped && cls2 === "Hard stop|Needs a reason to proceed", "the cumulative ceiling reads Hard stop, the duplicate Needs a reason to proceed", cls2);
  ok(await b.ev(`return document.getElementById("sign").disabled`) === true && /cannot be signed past/.test(await text("signWhy")) && !(await b.ev(`return document.getElementById("reason") ? "y" : ""`)),
    "Sign is disabled, with no reason box, and says why", await text("signWhy"));
  await b.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); return 1`);
  await b.sleep(300);
  ok(orderPosts().length === 1 && orderPosts()[0].body.checkOnly === true, "the keyboard shortcut does not sign it either: only the check was sent", JSON.stringify(orderPosts().map((c) => c.body)));
  await b.click("#clear");

  // 5. A server refusal is not a success.
  stub.set("refuse");
  await fill("Metformin", "500", "BD");
  await b.click("#sign");
  const refused = await b.until(`var s = document.getElementById("signed").textContent; return /Not saved/.test(s) ? s : ""`, 8000);
  ok(!!refused && /microbiology approval/.test(refused) && !/Saved to/.test(refused), "a refusal reads Not saved with the server's reason", refused);

  // 6. States that must not look like an empty ward.
  const failed = await open("listFail");
  ok(/could not be loaded/.test(failed) && !/No patients are admitted/.test(failed), "a failed ward list says so", failed);
  const empty = await open("empty");
  ok(/No patients are admitted/.test(empty), "an empty ward says so", empty);
  await open("allergyFail");
  await choosePatient();
  ok(/cannot be checked/.test(await text("findings")) && await b.ev(`return document.getElementById("drug").disabled`) === true, "allergies that could not be read stop ordering", await text("findings"));

  // 7. No session.
  stub.set("signedOut"); await b.nav(PAGE);
  const banner = await b.until(`var p = document.getElementById("pack"); return p && /sign in to WardSynQ/.test(p.textContent) ? p.textContent : ""`, 15000);
  ok(!!banner, "no session: the sign-in prompt is shown", banner);
  ok(await b.ev(`return document.getElementById("drug").disabled`) === true, "no session: ordering stays disabled");
  if (b.consoleLines.length) console.log("  console:", b.consoleLines.slice(0, 5).join(" | "));
} finally { b.close(); stub.close(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
