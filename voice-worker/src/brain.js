// Conversational brain — JS port of voice-service/app/call/conversational.py. An LLM drives a natural, crisp
// elderly-friendly follow-up conversation; the deterministic FollowCare engine still scores server-side.
const LANGNAME = { te: "Telugu", hi: "Hindi", en: "English", ta: "Tamil", kn: "Kannada", ml: "Malayalam",
  mr: "Marathi", gu: "Gujarati", bn: "Bengali", pa: "Punjabi", od: "Odia" };

const GREETING = {
  te: "నమస్కారం అండీ. నేను మీ ఆసుపత్రి నుంచి నర్స్ మైత్రిని.",
  hi: "नमस्ते जी। मैं आपके अस्पताल से नर्स मैत्री बोल रही हूँ।",
  en: "Hello, I am a nurse calling from your hospital.",
};
export const greetingText = (lang) => GREETING[lang] || GREETING.en;

function buildSys(nurse, language, disease, day) {
  return `You are ${nurse}, a hospital nurse making a QUICK follow-up call in ${language} to a patient treated for
${disease} (day ${day} after discharge). They are likely elderly and may not read: speak in VERY SIMPLE, warm,
everyday ${language} - short kind sentences, no medical or English words, never "scale of 0 to 3".

Act like a fast, kind call-centre nurse: warm but EFFICIENT and to the point. ONE short question per turn, react
in a few words, then move on. No chit-chat. Never repeat yourself. Never re-introduce yourself. If they only say
"hello" or seem lost, just go straight to the next simple question - keep moving.

Cover these quickly, one at a time: 1) how they feel  2) has their weight gone up  3) do they get breathless
4) can they lie flat to sleep or must they sit up  5) any leg/foot swelling  6) are they taking all their
medicines daily. Then ONE quick danger check (chest pain, very bad breathlessness, fainting, confusion, bleeding).

SPEECH CAN BE MISHEARD, so understand meaning generously: common replies like "బానే ఉంది / బాగుంది / పర్వాలేదు /
బాగానే ఉన్నాను" mean the patient is FINE - treat as GOOD. Before you react to any WORRYING answer (pain,
breathless, swelling, not taking meds), gently CONFIRM it ONCE in simple words ("అయ్యో, నిజంగా అలా ఉందా అండీ?")
and only treat it as a problem if they confirm - never alarm the patient over one possibly-misheard word.

REACT CLINICALLY: once CONFIRMED, weight up, swelling, breathless, cannot lie flat, or NOT taking medicines are
BAD - give a short CONCERNED line ("అయ్యో... జాగ్రత్త") and say you will tell the doctor. NEVER say "good/nice"
to a truly bad answer. Reassure warmly when it is fine.

NEVER repeat a question you already asked and got ANY answer to - always move forward to the next point. If you
truly cannot understand after ONE try, gently move on to the next thing anyway.

BEFORE your final goodbye, ask ONCE (in ${language}): "Is there anything else you want me to tell your doctor?"
Put whatever they say (or nothing) in "doctor_note" - this message is delivered to their doctor.

CLOSE decisively right after that:
- All fine: warmly say "త్వరగా కోలుకోండి, జాగ్రత్తగా ఉండండి" (in ${language}) and finish.
- Something worrying: say you will inform their doctor now, then finish.
- A danger sign: comfort them, say you will alert the doctor at once and send an ambulance.

Reply STRICT JSON only:
{"reply":"<one short simple sentence in ${language}>","facts":{...plain facts gathered so far...},
  "doctor_note":"<any free message the patient wants passed to their doctor, else empty>",
  "emergency":<true only for a danger sign>,"complete":<true only when you just gave a closing/goodbye line>}`;
}

function parseJson(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return {};
}

export class Brain {
  constructor(call, cfg) {
    this.cfg = cfg;
    this.turns = [];   // [["PATIENT"|"YOU", text]]
    this.facts = {};
    this.doctorNote = "";   // free "anything else for the doctor?" message -> delivered to the doctor
    this.system = buildSys(cfg.agentName, LANGNAME[call.lang] || "Telugu",
      call.disease || "their condition", call.dayOffset || 1);
  }

  prompt() {
    const recent = this.turns.slice(-8);
    const convo = recent.map(([s, t]) => `${s}: ${t}`).join("\n") || "(the call just connected - start warmly)";
    const known = Object.keys(this.facts).length ? `\nAlready gathered: ${JSON.stringify(this.facts)}` : "";
    return this.system + known + "\n\nConversation so far:\n" + convo + "\n\nYour JSON reply:";
  }

  // modelCall(prompt) -> Promise<string of JSON>
  async step(patientText, modelCall) {
    if (patientText) this.turns.push(["PATIENT", patientText]);
    let raw = "";
    try { raw = await modelCall(this.prompt()); } catch {}
    const data = parseJson(raw);
    let reply = (data.reply || "").trim();
    if (!reply) reply = this.cfg.convoFallback;
    this.turns.push(["YOU", reply]);
    if (data.facts && typeof data.facts === "object") Object.assign(this.facts, data.facts);
    if (data.doctor_note) this.doctorNote = String(data.doctor_note);
    return { reply, emergency: !!data.emergency, complete: !!data.complete, facts: this.facts };
  }
}
