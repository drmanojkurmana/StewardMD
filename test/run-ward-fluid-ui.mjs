/* LT-08 and LT-11 (live test 2026-09-15): the chart's fluid balance card, in real headless Chrome against the
 * real ward.js (test/ward-tablet-harness.html stubs only the network and records every request).
 *
 * LT-08: the Intake/Output list carried the output kinds and the kind list never changed, because the inline
 * onchange held option markup whose quotes ended the attribute. Output must offer output kinds, urine first.
 * LT-11: every entry was sent as intake/oral, because the selects were read after the busy repaint had
 * redrawn them at their first option. What is picked is what is sent, even across a repaint.
 *
 *   node test/run-ward-fluid-ui.mjs      (needs Google Chrome; CHROME=... to point elsewhere)
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./wardsynq-site-cdp.mjs";

const URL = "file://" + join(dirname(fileURLToPath(import.meta.url)), "ward-tablet-harness.html");
let pass = 0, fail = 0;
const ok = (c, name, extra) => { console.log(`  ${c ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); c ? pass++ : fail++; };
const b = await launch({ port: Number(process.env.CDP_PORT || 9496) });
const opts = (id) => b.ev(`return JSON.stringify(Array.from(document.getElementById(${JSON.stringify(id)}).options).map(function (o) { return o.value; }))`).then(JSON.parse);
const pick = (id, v) => b.ev(`var s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value;`);
const lastFluid = () => b.ev(`var c = window.__calls.filter(function (x) { return x.url.indexOf("/ward/fluid") >= 0; }).pop(); return c ? JSON.stringify(c.body.entries) : "";`).then((s) => (s ? JSON.parse(s) : null));
try {
  await b.nav(URL);
  ok(!!(await b.until(`return window.__ready === true`, 10000)), "real ward.js loaded into the harness");
  await b.ev(`WARD.open({ orgId: "org-tablet-harness" }); return 1`);
  await b.until(`return !!document.querySelector('[data-w-act="open:enc-1"]')`, 8000);
  await b.click('[data-w-act="open:enc-1"]');
  ok(!!(await b.until(`return !!document.getElementById("wFKind")`, 8000)), "the chart shows the fluid balance card");

  // LT-08
  ok(JSON.stringify(await opts("wFDir")) === '["intake","output"]', "the first list is only Intake and Output", JSON.stringify(await opts("wFDir")));
  ok(await b.ev(`return document.getElementById("wFDir").hasAttribute("onchange") ? "inline" : "none"`) === "none", "no inline handler carrying markup");
  await pick("wFDir", "output");
  const outKinds = await opts("wFKind");
  ok(JSON.stringify(outKinds) === '["urine","drain","vomit","ng","stool","blood","other"]', "Output offers output kinds: urine, drain, vomit, NG aspirate, stool, blood loss, other", JSON.stringify(outKinds));
  await pick("wFKind", "urine");
  await b.type("wFVal", "300");
  await b.click('[data-w-act="fluid"]');
  await b.until(`return window.__calls.some(function (x) { return x.url.indexOf("/ward/fluid") >= 0; })`, 5000);
  ok(JSON.stringify((await lastFluid() || []).map((e) => [e.direction, e.kind, e.value])) === '[["output","urine","300"]]', "urine output is sent as output, urine", JSON.stringify(await lastFluid()));

  // LT-11, with a repaint between picking the route and pressing Chart.
  await pick("wFDir", "intake");
  ok(JSON.stringify(await opts("wFKind")) === '["oral","iv","ng","blood","other"]', "Intake switches back to intake routes");
  await pick("wFKind", "iv");
  await b.ev(`WARD._dispatch("balance"); return 1`);
  await b.sleep(300);
  ok(await b.ev(`return document.getElementById("wFDir").value + "/" + document.getElementById("wFKind").value`) === "intake/iv", "a repaint keeps the picked direction and route");
  await b.type("wFVal", "100");
  await b.click('[data-w-act="fluid"]');
  await b.sleep(300);
  ok(JSON.stringify((await lastFluid() || []).map((e) => [e.direction, e.kind, e.value])) === '[["intake","iv","100"]]', "IV intake is sent as IV, not oral", JSON.stringify(await lastFluid()));
  if (b.consoleLines.length) console.log("  console:", b.consoleLines.slice(0, 5).join(" | "));
} finally { b.close(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
