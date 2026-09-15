/* test/run-wardsynq-order-i18n.mjs - the Order workstation's staff-language conversion (ui-i18n-site,
 * owner decision 2026-09-15), in a real headless Chrome.
 *
 * The real page and modules run against test/wardsynq-workstation-stub.mjs (the ward routes' shapes, see
 * run-wardsynq-workstation-open.mjs). The stub ALSO answers /wardsynq/site/i18n/te.js with a FAKE catalog
 * built from every T()/TS() key the staff sources extract (test/wsq-site-i18n-harness.mjs), each mapped to
 * "⟦English⟧", so a translated string is visibly marked and an untranslated one is not.
 *
 *   node test/run-wardsynq-order-i18n.mjs
 */
import { launch } from "./wardsynq-site-cdp.mjs";
import { extractKeys, fakeCatalog } from "./wsq-site-i18n-harness.mjs";
import { startStub, PATIENT } from "./wardsynq-workstation-stub.mjs";

const PORT = Number(process.env.WSQ_ORDER_I18N_PORT || 8872);
const FAKE_TE_JS = `(function(){var c=${JSON.stringify(fakeCatalog(extractKeys()))};if(window.WSQI18n)window.WSQI18n.register("te","Fake",c,{reviewed:false});})();`;
const stub = await startStub(PORT, { "/wardsynq/site/i18n/te.js": FAKE_TE_JS });
const PAGE = `http://localhost:${PORT}/wardsynq/ui/wardsynq.html?site=1&orgId=org-harness`;

let pass = 0, fail = 0;
const ok = (c, name, extra) => { console.log(`  ${c ? "PASS" : "FAIL"} ${name}${extra ? " - " + extra : ""}`); c ? pass++ : fail++; };
const b = await launch({ port: Number(process.env.CDP_PORT || 9473) });
const openPatient = async () => {
  await b.until(`return document.querySelector("#roster button.pt") ? "y" : ""`, 15000);
  await b.click("#roster button.pt");
  return b.until(`return document.getElementById("identity").textContent.indexOf(${JSON.stringify(PATIENT.name)}) >= 0 && document.getElementById("drug").disabled === false ? "y" : ""`, 10000);
};
try {
  await b.nav(PAGE);
  await b.ev(`localStorage.setItem("wsqStaffNavLang", "te"); return 1`);
  await b.nav(PAGE);
  ok(!!(await openPatient()), "the ward's patient opens with the staff language set");
  ok(await b.ev(`return document.documentElement.lang`) === "te", "document.documentElement.lang follows the staff language");

  for (const [sel, en] of [['button[data-go="order"]', "Order"], ['button[data-go="meds"]', "Medications"], ['button[data-go="results"]', "Results"], ['button[data-go="ledger"]', "Record"]]) {
    const t = await b.ev(`return document.querySelector('${sel}').textContent`);
    ok(t.indexOf(`⟦${en}⟧`) === 0, `rail: ${en} is translated (key hint kept)`, t);
  }
  ok(await b.ev(`return document.querySelector("#orderSection h2").textContent`) === "⟦Order⟧", "Order section heading is translated");
  ok(await b.ev(`return document.querySelector("#ledgerSection h2").textContent`) === "⟦Record⟧", "Record section heading is translated");
  const fieldLabels = await b.ev(`return Array.from(document.querySelectorAll("label.f span")).map(function (s) { return s.textContent; }).join("|")`);
  ok(fieldLabels === "⟦Medication⟧|⟦Dose⟧|⟦Unit⟧|⟦Route⟧|⟦Frequency⟧", "field labels are translated", fieldLabels);
  ok(await b.ev(`return document.getElementById("sign").textContent`) === "⟦Sign order⟧", "Sign order button is translated");
  ok(await b.ev(`return document.getElementById("clear").textContent`) === "⟦Clear⟧", "Clear button is translated");

  const nameHtml = await b.ev(`return document.querySelector("#identity .name").innerHTML`);
  ok(nameHtml.indexOf(PATIENT.name) >= 0 && nameHtml.indexOf("⟦") === -1, "patient name is shown verbatim, not inside a translated bracket", nameHtml);
  ok(new RegExp(`<span lang="en">${PATIENT.name}</span>`).test(nameHtml), "patient name sits inside a lang=\"en\" element", nameHtml);

  // A failure stays in the staff language with the English underneath.
  stub.set("listFail");
  await b.nav(PAGE);
  const failHtml = await b.until(`var r = document.getElementById("roster"); return r && r.querySelector(".fail") ? r.innerHTML : ""`, 15000);
  ok(failHtml.indexOf("⟦") >= 0 && failHtml.indexOf('class="en-orig"') >= 0, "a failed ward list is translated with the English original underneath", failHtml);

  // No session: the sign-in banner stays in the staff language, with the English original underneath.
  stub.set("signedOut");
  await b.nav(PAGE);
  const bannerHtml = await b.until(`var p = document.getElementById("pack"); return p && p.className.indexOf("bad") >= 0 ? p.innerHTML : ""`, 15000);
  ok(bannerHtml.indexOf("⟦") >= 0 && bannerHtml.indexOf('class="en-orig"') >= 0 && bannerHtml.indexOf('lang="en"') >= 0, "401 banner carries translated text and the English original", bannerHtml);
  ok(await b.ev(`return document.documentElement.lang`) === "te", "document.documentElement.lang stays \"te\" when signed out");

  // Language unset: plain English, no bracket artifacts, no en-orig anywhere.
  stub.set("ok");
  await b.ev(`localStorage.removeItem("wsqStaffNavLang"); return 1`);
  await b.nav(PAGE);
  await openPatient();
  ok(await b.ev(`return document.documentElement.lang`) === "en", "document.documentElement.lang is \"en\" when no staff language is set");
  ok((await b.ev(`return document.body.textContent`)).indexOf("⟦") === -1, "no bracket artifacts anywhere on the page in English");
  ok((await b.ev(`return document.body.innerHTML`)).indexOf("en-orig") === -1, "no en-orig spans anywhere on the page in English");
  ok(await b.ev(`return document.getElementById("sign").textContent`) === "Sign order", "Sign order button reads plain English");
  if (b.consoleLines.length) console.log("  console:", b.consoleLines.slice(0, 5).join(" | "));
} finally { b.close(); stub.close(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
