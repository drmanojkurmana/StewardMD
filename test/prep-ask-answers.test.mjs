/* prep-ask-answers.test.mjs - Unit tests for Ask MaiK answering policy:
 * 1. Prompt builder fixtures (removal of negative constraints, beyond-flag instruction, srcPack KB assembly).
 * 2. Replay test of owner transcript (GTN MCQ 4 turns: Explain B LVH, Tell exact criteria, Just answer it, Levels above?).
 * 3. Guard test ensuring refusal strings are absent from all prompts and canned replies.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-ask-answers.test.mjs
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Mock auth and import server modules
const CLAIMS = { "tok-student": { sub: "u-student", email: "student@example.com", email_verified: true } };
const realAuth = await import("../functions/_fbauth.js");
const claimsOf = (req) => CLAIMS[(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")] || null;
mock.module("../functions/_fbauth.js", {
  namedExports: {
    ...realAuth,
    verifiedClaimsFor: async (req) => claimsOf(req),
    cfAccessEmail: async () => "",
    identify: async (req) => { const c = claimsOf(req); return c ? "fb:" + c.sub : null; },
  },
});

const T_SRV = await import("../functions/api/ai/_prep-teach.js");
const KB = await import("../functions/api/ai/_prep-kb.js");
const PURE = (await import("../prep-teacher.js")).default || (await import("../prep-teacher.js"));
const { onRequest } = await import("../functions/api/ai/[[path]].js");

function fakeKv() {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix } = {}) => ({
      keys: [...m.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
}

function fakeD1() {
  const counters = new Map(), cost = new Map();
  const stmt = (sql, args) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => {
      if (/INSERT INTO ai_counters/.test(sql)) {
        const k = args[0] + "|" + args[1];
        counters.set(k, (counters.get(k) || 0) + Number(args[2]));
      } else if (/INSERT INTO ai_cost_daily/.test(sql)) {
        cost.set(args[0], (cost.get(args[0]) || 0) + Number(args[1]));
      }
      return { success: true };
    },
    first: async () => (/FROM ai_cost_daily/.test(sql) ? (cost.has(args[0]) ? { cost_paise: cost.get(args[0]) } : null) : null),
    all: async () => ({ results: [] }),
  });
  return { counters, cost, prepare: (sql) => stmt(sql, []), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}

let capturedCalls = [];
let mockReplyHandler = () => "Default response";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const url = String(u);
  if (url.includes("generateContent")) {
    const body = JSON.parse(init.body);
    capturedCalls.push({ url, body });
    const text = await mockReplyHandler(body, init);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 650, candidatesTokenCount: 140, thoughtsTokenCount: 0 },
    }));
  }
  return new Response("{}");
};
process.on("exit", () => { globalThis.fetch = realFetch; });

const envFor = () => ({
  VERTEX_API_KEY: "vk-test",
  GEMINI_API_KEY: "dev-test",
  AI_PROVIDER: "developer",
  MAIK_KV: fakeKv(),
  UPDATES_DB: fakeD1(),
  MAIK_ENFORCE_CAPS: "1",
  MAIK_RATE_LIMIT_SECONDS: "0.001",
});

async function callPrepTeach(env, body) {
  const req = new Request("https://stewardmd.in/api/ai/prep-teach", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer tok-student" },
    body: JSON.stringify(body),
  });
  const waits = [];
  const res = await onRequest({ request: req, env, params: { path: ["prep-teach"] }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { status: res.status, json: await res.json() };
}

/* ---------------- 1. Prompt Builder Fixtures ---------------- */

test("prompt fixtures: 'ONLY the facts in GROUNDING' constraint is removed", () => {
  for (const sys of [T_SRV.CHAT_SYSTEM, T_SRV.TEACH_SYSTEM, T_SRV.STEP_SYSTEM]) {
    assert.doesNotMatch(sys, /ONLY the facts in the GROUNDING/i, "strictly negative grounding restriction must be gone");
    assert.doesNotMatch(sys, /do not add drug doses, exact figures/i, "prohibition on figures/doses must be gone");
    assert.match(sys, /(?:facts in the GROUNDING|The GROUNDING).*first and prefer it/i, "grounding preferred first");
  }
});

test("prompt fixtures: beyond-flag instruction and standard reference instructions are present", () => {
  assert.match(T_SRV.CHAT_SYSTEM, /Beyond grounding:/, "CHAT_SYSTEM instructs Beyond grounding: line");
  assert.match(T_SRV.TEACH_SYSTEM, /Beyond grounding:/, "TEACH_SYSTEM instructs Beyond grounding: line");
  assert.match(T_SRV.STEP_SYSTEM, /Beyond grounding:/, "STEP_SYSTEM instructs Beyond grounding: line");

  assert.match(T_SRV.CHAT_SYSTEM, /FIGO 2000\/2018 for GTN/, "CHAT_SYSTEM names guideline standard e.g. FIGO 2000/2018");
  assert.match(T_SRV.CHAT_SYSTEM, /Resolve short follow-ups/, "CHAT_SYSTEM instructs short follow-up resolution");
  assert.match(T_SRV.CHAT_SYSTEM, /just answer it/, "CHAT_SYSTEM instructs immediate answer when asked to just answer");
});

test("prompt fixtures: srcPack grounding assembled with KB text and oncology protocols", () => {
  const gtnGround = "Question: A 28-year-old woman undergoes suction curettage for complete hydatidiform mole. Serial beta-hCG monitoring shows plateau.\nOption B: Persistent GTN is diagnosed if hCG plateaus across 4 values over 3 weeks.\nExplanation: FIGO diagnostic criteria for post-molar gestational trophoblastic neoplasia.";
  const req = T_SRV.readTeachRequest({
    kind: "chat",
    base: "mcq",
    ground: gtnGround,
    srcPack: ["kb-gestational-trophoblastic-neoplasia", "kb-hydatidiform-mole"],
    kp: "FIGO 2000 criteria: hCG plateau over 3 weeks or rise over 2 weeks confirms GTN.",
    turn: 1,
    messages: [{ r: "u", t: "What are the exact criteria?" }],
  }).req;

  assert.ok(Array.isArray(req.srcPack) && req.srcPack.length === 2);
  const prompt = T_SRV.buildTeachPrompt(req);
  assert.ok(prompt.user.includes("KNOWLEDGE BASE (Reference guidelines and protocols):"), "contains KB section");
  assert.ok(prompt.user.includes("hCG") || prompt.user.includes("FIGO") || prompt.user.includes("Gestational Trophoblastic"), "contains real KB grounding");
  assert.ok(prompt.user.includes("methotrexate") || prompt.user.includes("Folinic acid") || prompt.user.includes("EMA-CO"), "links oncology protocol");
});

/* ---------------- 2. Replay Test of Owner Transcript ---------------- */

test("replay test of owner transcript on GTN MCQ (4 turns)", async () => {
  const env = envFor();
  capturedCalls = [];

  const GTN_GROUND =
    "Question: A 24-year-old woman (G1P0) undergoes suction curettage for complete hydatidiform mole. Histopathology confirms molar pregnancy. Which of the following beta-hCG surveillance findings defines persistent gestational trophoblastic neoplasia (GTN)?\n" +
    "A. Plateau of hCG over 2 consecutive weeks\n" +
    "B. Plateau of hCG across 4 measurements over 3 weeks\n" +
    "C. Rise of hCG across 2 measurements over 1 week\n" +
    "D. Persistent detectable hCG at 12 weeks post-evacuation\n" +
    "Correct answer: B. Plateau of hCG across 4 measurements over 3 weeks\n" +
    "Explanation: Post-molar GTN is diagnosed based on FIGO 2000 staging criteria.";

  const thread = "gtntest-" + Date.now();
  const messages = [];

  // Turns from owner's transcript:
  // Turn 1: "Explain B LVH [criteria]"
  messages.push({ r: "u", t: "Explain B LVH [sic: the criteria]" });
  mockReplyHandler = () =>
    "Option B represents the standard FIGO 2000/2018 criterion for post-molar GTN. It requires an hCG plateau across 4 measurements over at least 3 weeks (days 1, 7, 14, and 21) with variation within ±10%.";
  let r1 = await callPrepTeach(env, {
    kind: "chat",
    base: "mcq",
    ground: GTN_GROUND,
    srcPack: ["kb-gestational-trophoblastic-neoplasia", "kb-hydatidiform-mole"],
    kp: "FIGO diagnostic criteria: hCG plateau across 4 values over 3 weeks.",
    turn: 1,
    thread,
    messages,
  });
  assert.equal(r1.status, 200);
  assert.ok(r1.json.text.includes("FIGO"));
  assert.ok(r1.json.text.includes("4 measurements") && r1.json.text.includes("3 weeks"));
  messages.push({ r: "m", t: r1.json.text });

  // Turn 2: "Tell exact criteria with values"
  messages.push({ r: "u", t: "Tell exact criteria with values" });
  mockReplyHandler = () =>
    "Under FIGO 2000/2018 guidelines, persistent GTN is diagnosed by:\n" +
    "- An hCG plateau across 4 measurements over 3 weeks (days 1, 7, 14, 21)\n" +
    "- An hCG rise >=10% across 3 measurements over 2 weeks (days 1, 7, 14)\n" +
    "- Histological diagnosis of choriocarcinoma\n" +
    "- Persistent elevated hCG >=6 months after evacuation\n" +
    "Beyond grounding: FIGO 2000/2018 criteria, 10% rise, 3 measurements, 2 weeks, 6 months";
  let r2 = await callPrepTeach(env, {
    kind: "chat",
    base: "mcq",
    ground: GTN_GROUND,
    srcPack: ["kb-gestational-trophoblastic-neoplasia", "kb-hydatidiform-mole"],
    kp: "FIGO diagnostic criteria: hCG plateau across 4 values over 3 weeks.",
    turn: 2,
    thread,
    messages,
  });
  assert.equal(r2.status, 200);
  assert.ok(r2.json.text.includes("10%"));
  assert.ok(r2.json.text.includes("3 measurements") || r2.json.text.includes("2 weeks"));
  assert.ok(Array.isArray(r2.json.beyond) && r2.json.beyond.length > 0, "beyond facts parsed and returned");
  assert.ok(r2.json.beyond.some((b) => b.includes("10%") || b.includes("2 weeks") || b.includes("FIGO")));
  messages.push({ r: "m", t: r2.json.text });

  // Turn 3: "Just answer it"
  messages.push({ r: "u", t: "Just answer it" });
  mockReplyHandler = () =>
    "The 4 FIGO criteria are: 1) hCG plateau across 4 values over 3 weeks (days 1, 7, 14, 21); 2) hCG rise >=10% across 3 values over 2 weeks (days 1, 7, 14); 3) choriocarcinoma histology; 4) hCG elevated >=6 months.";
  let r3 = await callPrepTeach(env, {
    kind: "chat",
    base: "mcq",
    ground: GTN_GROUND,
    srcPack: ["kb-gestational-trophoblastic-neoplasia", "kb-hydatidiform-mole"],
    kp: "FIGO diagnostic criteria: hCG plateau across 4 values over 3 weeks.",
    turn: 3,
    thread,
    messages,
  });
  assert.equal(r3.status, 200);
  assert.ok(r3.json.text.includes("4 values") || r3.json.text.includes("3 weeks"));
  messages.push({ r: "m", t: r3.json.text });

  // Turn 4: "Levels above?" (short follow-up resolved from context)
  messages.push({ r: "u", t: "Levels above?" });
  mockReplyHandler = () =>
    "For post-molar hCG surveillance, a serum beta-hCG level >=20,000 IU/L at 4 weeks post-evacuation indicates high risk for persistent GTN needing immediate staging and methotrexate therapy (FIGO 2018).\nBeyond grounding: 20000 IU/L, 4 weeks, methotrexate";
  let r4 = await callPrepTeach(env, {
    kind: "chat",
    base: "mcq",
    ground: GTN_GROUND,
    srcPack: ["kb-gestational-trophoblastic-neoplasia", "kb-hydatidiform-mole"],
    kp: "FIGO diagnostic criteria: hCG plateau across 4 values over 3 weeks.",
    turn: 4,
    thread,
    messages,
  });
  assert.equal(r4.status, 200);
  assert.ok(r4.json.text.includes("20,000") || r4.json.text.includes("20000"));
  assert.ok(Array.isArray(r4.json.beyond) && r4.json.beyond.some((b) => b.includes("20000")));

  // Verify none of the 4 responses had refusal strings
  for (const r of [r1, r2, r3, r4]) {
    assert.doesNotMatch(r.json.text, /I cannot provide specific numerical/i);
    assert.doesNotMatch(r.json.text, /please use the MaiK Assistant/i);
  }
});

/* ---------------- 3. Refusal Strings Guard Test ---------------- */

test("guard test: refusal strings absent from all prompts and source files", () => {
  const targetFiles = [
    "functions/api/ai/_prep-teach.js",
    "functions/api/ai/_prep-kb.js",
    "prep-teacher.js",
    "prep-ask.js",
  ];

  const forbiddenRefusals = [
    "I cannot provide specific numerical",
    "cannot provide specific numerical cut-offs",
    "cannot provide numerical values",
  ];

  for (const rel of targetFiles) {
    const code = readFileSync(join(ROOT, rel), "utf8");
    for (const phrase of forbiddenRefusals) {
      // It can only appear in prompt negation rules (e.g. "Never give refusal lines like 'I cannot provide...'")
      const matches = code.split("\n").filter((line) => line.includes(phrase) && !line.includes("Never give refusal lines") && !line.includes("forbiddenRefusals"));
      assert.equal(matches.length, 0, `File ${rel} contains refusal string "${phrase}": ${matches.join("; ")}`);
    }
  }
});
