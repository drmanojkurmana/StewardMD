// Conversational brain. Code walks a FIXED, DISEASE-SPECIFIC topic checklist (one per turn) so the call can
// never loop or stall - the LLM only reacts to the last answer and phrases the next question. A red flag gets
// ONE gentle confirmation (bounded by a per-topic set) before it counts as an emergency. Deterministic control
// = works with reasoning off (fast) and covers every topic exactly once.
const LANGNAME = { te: "Telugu", hi: "Hindi", en: "English", ta: "Tamil", kn: "Kannada", ml: "Malayalam",
  mr: "Marathi", gu: "Gujarati", bn: "Bengali", pa: "Punjabi", od: "Odia" };

const GREETING = {
  te: "నమస్కారం. నేను మీ ఆసుపత్రి నుంచి నర్స్ మైత్రిని.",
  hi: "नमस्ते। मैं आपके अस्पताल से नर्स मैत्री बोल रही हूँ।",
  en: "Hello, I am a nurse calling from your hospital.",
  ta: "வணக்கம். நான் உங்கள் மருத்துவமனையிலிருந்து நர்ஸ் மைத்ரி பேசுகிறேன்.",
  kn: "ನಮಸ್ಕಾರ. ನಾನು ನಿಮ್ಮ ಆಸ್ಪತ್ರೆಯಿಂದ ನರ್ಸ್ ಮೈತ್ರಿ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ.",
  ml: "നമസ്കാരം. ഞാൻ നിങ്ങളുടെ ആശുപത്രിയിൽ നിന്ന് നഴ്സ് മൈത്രി സംസാരിക്കുന്നു.",
  mr: "नमस्कार. मी तुमच्या रुग्णालयातून नर्स मैत्री बोलत आहे.",
  bn: "নমস্কার। আমি আপনার হাসপাতাল থেকে নার্স মৈত্রী বলছি।",
  gu: "નમસ્તે. હું તમારી હોસ્પિટલમાંથી નર્સ મૈત્રી બોલું છું.",
  pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ। ਮੈਂ ਤੁਹਾਡੇ ਹਸਪਤਾਲ ਤੋਂ ਨਰਸ ਮੈਤਰੀ ਬੋਲ ਰਹੀ ਹਾਂ।",
  od: "ନମସ୍କାର। ମୁଁ ଆପଣଙ୍କ ଡାକ୍ତରଖାନାରୁ ନର୍ସ ମୈତ୍ରୀ କହୁଛି।",
};
export const greetingText = (lang) => GREETING[lang] || GREETING.en;

// Reusable topics. `key` matches the FollowCare question ids used for scoring.
const T = {
  feel:       { key: "overall",      ask: "how they are feeling overall today" },
  weight:     { key: "weight_delta", ask: "whether their weight has gone UP since discharge" },
  breathless: { key: "breathless",   ask: "whether they feel breathless or short of breath" },
  orthopnea:  { key: "orthopnea",    ask: "whether they can lie flat to sleep, or must sit up to breathe" },
  edema:      { key: "edema",        ask: "whether their legs or feet are swollen" },
  cough:      { key: "cough",        ask: "whether they have a cough or bring up phlegm" },
  inhaler:    { key: "inhaler",      ask: "whether they are using their inhaler / breathing medicine as told" },
  chest:      { key: "chest_pain",   ask: "whether they have any chest pain or tightness" },
  activity:   { key: "activity",     ask: "whether they can walk and do light activity without trouble" },
  wound:      { key: "wound",        ask: "whether their operation wound is clean and not red, swollen, or leaking" },
  fever:      { key: "fever",        ask: "whether they have any fever" },
  pain:       { key: "pain",         ask: "whether their pain is under control" },
  sugar:      { key: "sugar",        ask: "whether their sugar readings are in the normal range" },
  hypo:       { key: "hypo",         ask: "whether they get shakiness, sweating, or dizziness (low-sugar) spells" },
  foot:       { key: "foot",         ask: "whether they have any new foot wound or numbness" },
  meds:       { key: "meds_taken",   ask: "whether they are taking all their medicines every day" },
  danger:     { key: "danger",       ask: "in ONE question, any danger signs: chest pain, very severe breathlessness, fainting, new confusion, or bleeding" },
  note:       { key: "doctor_note",  ask: "if there is anything else they want you to tell their doctor" },
};

// Disease-specific ordered checklists.
const SETS = {
  heart:    [T.feel, T.weight, T.breathless, T.orthopnea, T.edema, T.meds, T.danger, T.note],
  copd:     [T.feel, T.breathless, T.cough, T.inhaler, T.meds, T.danger, T.note],
  cardiac:  [T.feel, T.chest, T.breathless, T.activity, T.meds, T.danger, T.note],
  surgery:  [T.feel, T.wound, T.fever, T.pain, T.meds, T.danger, T.note],
  diabetes: [T.feel, T.sugar, T.hypo, T.foot, T.meds, T.danger, T.note],
  generic:  [T.feel, T.pain, T.fever, T.meds, T.danger, T.note],
};

// Natural ask-hint lookup by question id, so questionnaire-driven topics still sound human where we know them.
const BYKEY = {};
for (const _k in T) BYKEY[T[_k].key] = T[_k];

// Turn a clinical/form question into the plain POINT to check (drop units, examples, 0-3 scales, parentheticals),
// so the LLM asks the intent conversationally instead of reading the form text out loud.
function cleanAsk(text, id) {
  let s = String((text != null ? text : id) || "").trim();
  s = s.replace(/\([^)]*\)/g, " ")                 // (kg), (0-3 severe), (e.g. ...)
       .replace(/\be\.?g\.?[^,;.]*/gi, " ")          // "e.g. 2 for +2 kg"
       .replace(/\bscale\b/gi, " ")
       .replace(/\b\d+\s*[-–to]+\s*\d+\b/gi, " ")     // "0-3", "0 to 3"
       .replace(/[?.]+\s*$/g, "")
       .replace(/\s{2,}/g, " ").trim();
  return "the point: " + (s || String(id || "how they are"));
}

// Build the ordered checklist. If the episode carries the FollowCare questionnaire (call.questions - the SAME
// questions the portal scores), drive the call straight from THAT so EVERY pathway/disease is covered exactly as
// configured; the emergency yes/nos (ids g_*) collapse into one spoken danger check. Else fall back to a
// disease-specific set. Accepts a call object OR a bare disease string (back-compat for tests/callers).
export function topicsFor(callOrDisease) {
  const call = (callOrDisease && typeof callOrDisease === "object") ? callOrDisease : { disease: callOrDisease };
  const qs = Array.isArray(call.questions) ? call.questions : null;
  if (qs && qs.length) {
    const topics = [], hasDanger = qs.some(function (q) { return /^g_/.test((q && q.id) || ""); });
    for (const q of qs) {
      const id = (q && q.id) || "";
      if (/^g_/.test(id)) continue;                       // emergency yes/nos -> one combined danger check below
      topics.push(BYKEY[id] || { key: id, ask: cleanAsk(q && q.text, id) });
    }
    if (hasDanger) topics.push(T.danger);
    topics.push(T.note);
    if (topics.length > 1) return topics;
  }
  return topicsForDisease(call.disease || "");
}
function topicsForDisease(disease) {
  const d = String(disease || "").toLowerCase();
  if (/heart fail|cardiac fail|\bccf\b|\bchf\b|\bhf\b/.test(d)) return SETS.heart;
  if (/copd|asthma|bronch|respirat|\blung|pneumon/.test(d)) return SETS.copd;
  if (/infarct|\bmi\b|\bacs\b|angina|stent|coronary|cardiac/.test(d)) return SETS.cardiac;
  if (/surg|post-?op|operat|wound|append|hernia|c-?section|cesar/.test(d)) return SETS.surgery;
  if (/diab|\bdka\b|sugar|glyc[ae]mi/.test(d)) return SETS.diabetes;
  return SETS.generic;
}

function buildSys(nurse, language, disease, day) {
  return `You are ${nurse}, a warm, caring hospital nurse making a SHORT day-${day} recovery check-in call in ${language} to an elderly patient treated for ${disease}. Talk like a REAL person on the phone - simple, kind, everyday ${language}. No medical jargon, no English words, no "scale of 0 to 3", and do NOT tack a meaningless filler/honorific onto every sentence (in Telugu specifically, never say "అండీ").

You are told the ONE next thing to check. It may be written in short clinical/form words (a "point:") - do NOT read it
out or mention units, numbers or scales; UNDERSTAND what it is really trying to learn and ask it in your OWN warm,
everyday spoken ${language}, the way one caring person genuinely asks another on the phone. This must feel like a real
human conversation, not a form. Always speak ${language}; if the patient ever answers in a DIFFERENT language, switch at once and continue the WHOLE rest of the call in THEIR language. Reply in ONE VERY SHORT human sentence - about 8 to 14 words, one breath, shorter is better - that does two things:

1) ACKNOWLEDGE what they just said, warmly and SPECIFICALLY - react to their ACTUAL answer the way a real nurse would,
   not a canned word. NEVER begin two turns in a row with the same word; very often just ask the next question with NO
   filler at all. Sound reassured only when the answer is genuinely good. If they report a PROBLEM (weight up, breathless,
   cannot lie flat, swelling, NOT taking medicines, or a danger sign) show real gentle concern and say you will tell the
   doctor - never sound cheerful about it. A plain "no" / "fine" is NOT a problem: a light word is enough, no concern.
   When several answers in a row are fine, do NOT keep repeating the SAME acknowledgment word - vary your warm words
   in ${language} each time, or simply ask the next question with no opener.

2) ONE useful FOLLOW-UP (only when confirming is allowed; otherwise skip it and ask the next thing):
   - A DANGER sign was just reported (chest pain, severe breathlessness, fainting, confusion, bleeding): do NOT re-ask the
     same yes/no. Ask ONE caring question to LEARN MORE for the doctor - when did it start, how bad is it, does it come and
     go, where is it. Set "ask":"confirm".
   - They are NOT taking their medicines: gently ask WHY they stopped (cost, side-effects, forgot, felt better?). Set "ask":"confirm".
   - Otherwise: just ask the NEXT thing you are given and set "ask":"next".
   Ask a follow-up AT MOST once per topic; never repeat an earlier question.

Understand meaning generously: common short replies in ${language} that mean "fine" / "no" / "no problem" should be read as good.

Reply STRICT JSON only: {"reply":"<one short, natural ${language} sentence: acknowledgement + the next question or the follow-up>","value":"<short English summary of what they just told you>","worrying":<true if their last answer is a real problem>,"redflag":<true only for chest pain, severe breathlessness, fainting, confusion, or bleeding>,"ask":"confirm"|"next","lang":"<ISO code of the language the patient is speaking NOW: te, hi, en, ta, kn, ml, mr, gu, bn, pa, or od>","doctor_note":"<any message they want passed to the doctor, else empty>"}`;
}

function parseJson(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return {};
}

// Detect the patient's language from the Unicode script of what they said, so we can switch to their language
// mid-call. Latin/short text returns null (don't switch on romanized or one-word replies). Devanagari -> Hindi.
const SCRIPTS = { te: /[ఀ-౿]/g, hi: /[ऀ-ॿ]/g, ta: /[஀-௿]/g, kn: /[ಀ-೿]/g,
  ml: /[ഀ-ൿ]/g, bn: /[ঀ-৿]/g, gu: /[઀-૿]/g, pa: /[਀-੿]/g, od: /[଀-୿]/g };
function detectLang(text) {
  if (!text) return null;
  let best = null, bestN = 0;
  for (const k in SCRIPTS) { const n = (String(text).match(SCRIPTS[k]) || []).length; if (n > bestN) { bestN = n; best = k; } }
  return bestN >= 2 ? best : null;   // need a couple of script chars to switch confidently
}

export class Brain {
  constructor(call, cfg) {
    this.cfg = cfg;
    this.turns = [];             // [["PATIENT"|"YOU", text]]
    this.facts = {};
    this.doctorNote = "";
    this.emergency = false;
    this.topics = topicsFor(call || {});
    this.idx = -1;               // index of the topic most recently ASKED (awaiting its answer)
    this.confirmed = new Set();  // topic indices we've already spent a red-flag confirm on (bounds the loop)
    this.nurse = cfg.agentName;
    this.disease = (call && call.disease) || "their condition";
    this.day = (call && call.dayOffset) || 1;
    this.lang = (call && call.lang && call.lang !== "auto") ? call.lang : "en";   // reply language; "auto" starts neutral (en) then switches to the patient's language
  }

  prompt(nextAsk, patientText, allowConfirm) {
    const system = buildSys(this.nurse, LANGNAME[this.lang] || "Telugu", this.disease, this.day);
    const recent = this.turns.slice(-6).map(([s, t]) => `${s}: ${t}`).join("\n");
    return system
      + `\n\nRecent conversation:\n${recent || "(you just greeted them)"}`
      + `\n\nThe patient just said: "${patientText || "(nothing yet)"}"`
      + `\n\nConfirming a danger sign is ${allowConfirm ? "ALLOWED this turn" : "NOT allowed now - do not ask to confirm, move on"}.`
      + `\n\nNEXT thing to do: ${nextAsk}`
      + `\n\nYour JSON reply:`;
  }

  // One turn. Code advances the checklist; a fresh red flag earns ONE confirm (no advance) before counting.
  // nudge=true re-asks the SAME topic (used on silence) without advancing.
  async step(patientText, modelCall, nudge = false) {
    if (patientText && !nudge) this.turns.push(["PATIENT", patientText]);
    if (patientText) { const dl = detectLang(patientText); if (dl && dl !== this.lang && LANGNAME[dl]) this.lang = dl; }   // switch to the patient's language
    const T2 = this.topics;
    const answeredIdx = this.idx;                       // topic the patient just answered (-1 before first Q)
    const allowConfirm = !nudge && answeredIdx >= 0 && !this.confirmed.has(answeredIdx);
    const lastTopic = answeredIdx + 1 >= T2.length;     // patient just answered the final topic

    let nextAsk;
    if (nudge) {
      const cur = answeredIdx >= 0 && answeredIdx < T2.length ? T2[answeredIdx].ask : "how they are feeling";
      nextAsk = `the patient was silent or unclear - GENTLY re-ask the SAME thing in simpler words (do not move on, do not re-introduce yourself): ${cur}`;
    } else if (lastTopic) {
      nextAsk = this.emergency
        ? "nothing more to ask - warmly reassure them, tell them you will inform their doctor right away, then a short goodbye"
        : "nothing more to ask - warmly wish them a quick recovery and to take care, thank them, then a short goodbye";
    } else {
      nextAsk = T2[answeredIdx + 1].ask;
    }

    let raw = "";
    try { raw = await modelCall(this.prompt(nextAsk, patientText, allowConfirm)); } catch {}
    const data = parseJson(raw);
    if (data.lang && LANGNAME[data.lang] && data.lang !== this.lang) this.lang = data.lang;   // LLM-detected language switch (works even when STT romanizes)
    const reply = ((data.reply || "").trim()) || this.cfg.convoFallback;

    let complete = false;
    if (!nudge) {
      const answeredKey = (answeredIdx >= 0 && answeredIdx < T2.length) ? T2[answeredIdx].key : "";
      // Record the patient's ACTUAL words for the topic they just addressed - reliable + always aligned, even
      // across a confirm turn (the follow-up answer refines the same topic). The LLM "value" summary drifts, so
      // we do NOT key facts on it.
      if (answeredKey && patientText) this.facts[answeredKey] = String(patientText).slice(0, 200);
      if (data.redflag) this.emergency = true;
      if (data.doctor_note) this.doctorNote = String(data.doctor_note);
      const confirming = data.ask === "confirm" && allowConfirm && (!!data.worrying || !!data.redflag || answeredKey === "meds_taken");   // one bounded follow-up: danger symptom-probe OR meds "why?"; never on a clear "no"/"fine"
      if (confirming) this.confirmed.add(answeredIdx);   // stay on this topic for one follow-up
      else { this.idx = answeredIdx + 1; complete = lastTopic; }
    }

    this.turns.push(["YOU", reply]);
    return { reply, emergency: this.emergency, complete, facts: this.facts };
  }
}
