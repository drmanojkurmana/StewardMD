import fs from "node:fs";
const toks = JSON.parse(fs.readFileSync("/Users/diwakarkumar/.claude/jobs/d1986003/tmp/tokens.json", "utf8"));
const ORG = "1898c74a89b8468fb48eca9569714fca";
const B = "https://wardsynq.com/api/queue";
const P = "opd-pat-smd-6teqzm-00025";
const ENC = "wsq-adm-smd-6teqzm-00025-2026-09-11t19-38-46-699z";

const doc = toks.find((t) => t.role === "doctor");
const DH = { "X-Staff-Token": doc.token, "Content-Type": "application/json" };

// 1. the doctor asks for a chest film
const o = await fetch(B + "/ward/investigation", {
  method: "POST", headers: DH,
  body: JSON.stringify({ orgId: ORG, encounterId: ENC, display: "Chest X-ray PA erect", code: "Chest X-ray PA erect", category: "imaging", priority: "urgent" }),
});
const oj = await o.json();
console.log("1. doctor orders a chest film:", oj.ok ? "done" : JSON.stringify(oj).slice(0, 120));

// 2. does the history say who asked for it, and when?
const t = await (await fetch(`${B}/ward/timeline?orgId=${ORG}&patientId=${P}`, { headers: DH })).json();
console.log("\n2. what the patient's history now says:");
(t.events || []).filter((e) => e.resourceType === "ServiceRequest").slice(0, 3)
  .forEach((e) => console.log("   " + e.at.slice(0, 16).replace("T", " ") + "  " + e.label));

// 3. does it reach the radiographer's screen?
const rl = await fetch(B + "/auth/pin", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clinicCode: "SMD-6TEQZM", identity: "radiographer.01@demo.wardsynq.test", pin: "100201" }),
});
const rj = await rl.json();
const wl = await (await fetch(B + "/ward/imaging-worklist?orgId=" + ORG, { headers: { "X-Staff-Token": rj.token } })).json();
const items = wl.worklist || wl.items || wl.entries || [];
console.log("\n3. the radiographer signs in and sees", items.length, "study/studies waiting");
console.log("   raw keys:", Object.keys(wl).join(", "));
console.log("   first item:", JSON.stringify(items[0] || null).slice(0, 400));
