import fs from "node:fs";
const toks = JSON.parse(fs.readFileSync("/Users/diwakarkumar/.claude/jobs/d1986003/tmp/tokens.json", "utf8"));
const admin = toks.find((t) => t.role === "admin");
const ORG = "1898c74a89b8468fb48eca9569714fca";
const H = { "X-Staff-Token": admin.token, "Content-Type": "application/json" };
const B = "https://wardsynq.com/api/queue";

for (const [identity, role, pin] of [
  ["radiographer.01@demo.wardsynq.test", "radiographer", "100201"],
  ["radiologist.01@demo.wardsynq.test", "radiologist", "100202"],
]) {
  const m = await fetch(B + "/member", {
    method: "POST", headers: H,
    body: JSON.stringify({ orgId: ORG, identity, role, active: true, regNo: "DEMO-" + role.toUpperCase() }),
  });
  console.log("create", role, m.status, (await m.text()).slice(0, 120));
  const p = await fetch(B + "/member/pin", {
    method: "POST", headers: H, body: JSON.stringify({ orgId: ORG, identity, pin }),
  });
  console.log("  pin", p.status);
  const l = await fetch(B + "/auth/pin", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clinicCode: "SMD-6TEQZM", identity, pin }),
  });
  const j = await l.json();
  if (!j.ok) { console.log("  sign in FAILED", JSON.stringify(j).slice(0, 80)); continue; }
  const w = await (await fetch(B + "/whoami", { headers: { "X-Staff-Token": j.token } })).json();
  const wl = await fetch(B + "/ward/imaging-worklist?orgId=" + ORG, { headers: { "X-Staff-Token": j.token } });
  console.log("  signs in as", w.role, "| things they can do:", (w.caps || []).length, "| imaging worklist:", wl.status === 200 ? "yes" : "no (" + wl.status + ")");
}
