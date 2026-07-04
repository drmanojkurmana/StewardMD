/* StewardMD — share PHI-guard regression. Extracts the REAL phiScan() from caseshare.js and
 * asserts it flags high-precision patient identifiers but NOT ordinary clinical text.
 * USAGE: node test/run-share-phi.mjs
 */
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../caseshare.js", import.meta.url), "utf8");
const m = src.match(/function phiScan\(str\)\{[\s\S]*?\n {2}\}/);
if (!m) { console.error("❌ could not extract phiScan from caseshare.js"); process.exit(2); }
// eslint-disable-next-line no-eval
const phiScan = eval("(" + m[0].replace(/^function phiScan/, "function") + ")");

let fail = 0;
const chk = (n, ok, d) => { console.log(`  ${ok ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!ok) fail++; };

// MUST flag (patient identifiers that must never be published)
const positives = [
  ["MRN in text", "Diagnosis: sepsis. MRN 12345, admitted ICU"],
  ["UHID label", "UHID: A1234B — acute cholangitis"],
  ["IP no", "IP No. 998877, febrile neutropenia"],
  ["10-digit phone", "relative contact 9876543210 for consent"],
  ["+91 phone", "call +91 98765 43210"],
  ["Aadhaar 12-digit", "ID 1234 5678 9012 on file"],
  ["email", "notify ramesh.k@gmail.com"],
];
// MUST NOT flag (ordinary de-identified clinical decision text)
const negatives = [
  ["GBS eponym", "Guillain-Barré syndrome: ascending weakness, areflexia"],
  ["drug + dose", "Give ceftriaxone 2 g IV every 24 hours for 7 days"],
  ["vitals/labs", "SpO2 88%, BP 90/60, HR 120, potassium 6.5 mmol/L, lactate 4"],
  ["scores", "CURB-65 score 3; qSOFA 2; GCS 13"],
  ["patient-phrases", "Patient education and safety monitoring; reassess in 24-48h"],
  ["cholangitis mgmt", "Acute cholangitis — biliary drainage (ERCP) within 24-48h"],
  ["dose range", "Metronidazole 500-750 mg every 8 hours, then luminal agent"],
  ["generic label", "drug name: Paracetamol; max 4 g/day"],
];

console.log("PHI guard — must FLAG identifiers:");
positives.forEach(([n, t]) => chk(n, phiScan(t) !== null, "hit=" + phiScan(t)));
console.log("PHI guard — must NOT flag clinical text:");
negatives.forEach(([n, t]) => chk(n, phiScan(t) === null, phiScan(t) ? "false-positive: " + phiScan(t) : "clean"));

// code length: genCode now emits SMD- + 7 chars
const genLenOk = /Uint32Array\(7\)/.test(src) && /for \(var i=0;i<7;i\+\+\)/.test(src);
chk("share code is 7 chars (30^7 ≈ 22 billion)", genLenOk);
const normOk = /\/\^\[A-Z0-9\]\{5,8\}\$\//.test(src);
chk("normCode still accepts legacy 5-char codes", normOk);

console.log(`\n${fail ? "❌ " + fail + " FAILED" : "✅ ALL GREEN — PHI guard precise; code lengthened; legacy codes still resolve"}`);
process.exitCode = fail ? 1 : 0;
