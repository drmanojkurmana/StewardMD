"""Conversational voice agent: an LLM (Gemini) drives a NATURAL phone conversation in the patient's language,
gathering the FollowCare check-in organically instead of reading the assessment form question-by-question.

STT/TTS are the ears/mouth; the LLM decides what to SAY each turn based on the real conversation, reacts to the
patient, asks one thing at a time, and closes warmly. It also emits the clinical facts it has gathered + an
emergency flag, so the deterministic FollowCare engine can still score/escalate server-side (safety net).
"""
import asyncio
import json
import re
import time

_LANG = {"te": "Telugu", "hi": "Hindi", "en": "English", "ta": "Tamil", "kn": "Kannada", "ml": "Malayalam",
         "mr": "Marathi", "gu": "Gujarati", "bn": "Bengali", "pa": "Punjabi", "od": "Odia"}

_SYS = """You are {nurse}, a hospital nurse making a QUICK follow-up call in {language} to a patient treated for
{disease} (day {day} after discharge). They are likely elderly and may not read: speak in VERY SIMPLE, warm,
everyday {language} - short kind sentences, no medical or English words, never "scale of 0 to 3".

Act like a fast, kind call-centre nurse: warm but EFFICIENT and to the point. ONE short question per turn, react
in a few words, then move on. No chit-chat. Never repeat yourself. Never re-introduce yourself. If they only say
"hello" or seem lost, just go straight to the next simple question - keep moving.

Cover these quickly, one at a time: 1) how they feel  2) has their weight gone up  3) do they get breathless
4) can they lie flat to sleep or must they sit up  5) any leg/foot swelling  6) are they taking all their
medicines daily. Then ONE quick danger check (chest pain, very bad breathlessness, fainting, confusion, bleeding).

SPEECH CAN BE MISHEARD, so understand meaning generously: "బానే ఉంది / బాగుంది / పర్వాలేదు / బాగానే ఉన్నాను"
all mean the patient is FINE - treat as GOOD. Before you react to any WORRYING answer (pain, breathless,
swelling, not taking meds), gently CONFIRM it ONCE in simple words ("అయ్యో, నిజంగా అలా ఉందా అండీ?") and only
treat it as a problem if they confirm - never alarm the patient over one possibly-misheard word.

REACT CLINICALLY: once CONFIRMED, weight up, swelling, breathless, cannot lie flat, or NOT taking medicines are
BAD - give a short CONCERNED line ("అయ్యో... జాగ్రత్త") and say you will tell the doctor. NEVER say "good/nice"
to a truly bad answer. Reassure warmly when it is fine.

CLOSE decisively as soon as the points are covered:
- All fine: warmly say "త్వరగా కోలుకోండి, జాగ్రత్తగా ఉండండి" and finish.
- Something worrying: say you will inform their doctor now, then finish.
- A danger sign: comfort them, say you will alert the doctor at once and send an ambulance.

Reply STRICT JSON only:
{{"reply":"<one short simple sentence in {language}>","facts":{{...plain facts gathered so far...}},
  "emergency":<true only for a danger sign>,"complete":<true only when you just gave a closing/goodbye line>}}"""


# Fixed, warm opening line per language - pre-synthesized so the patient hears a voice INSTANTLY on answering
# (no LLM/TTS wait = no dead air = they don't hang up). The LLM takes over from the next line.
_GREETING = {
    "te": "నమస్కారం అండీ. నేను మీ ఆసుపత్రి నుంచి నర్స్ మైత్రిని. ఇంటికి వెళ్ళాక మీరు ఎలా ఉన్నారో కనుక్కోవడానికి ఫోన్ చేశాను.",
    "hi": "नमस्ते जी। मैं आपके अस्पताल से नर्स मैत्री बोल रही हूँ। घर जाने के बाद आप कैसे हैं, यह जानने के लिए फ़ोन किया।",
    "en": "Hello. I am a nurse from your hospital, calling to see how you are doing since you went home.",
}
# A tiny acknowledgement played the instant the patient stops speaking, to mask the STT+LLM+TTS gap.
_FILLER = {"te": "అలాగా అండీ...", "hi": "अच्छा जी...", "en": "I see..."}

_greeting_cache = {}
_filler_cache = {}


def greeting_text(lang):
    return _GREETING.get(lang, _GREETING["en"])


def warm(tts, cfg, lang="te"):
    """Pre-synthesize the greeting + filler for a language so the first call has zero warm-up delay.
    Only cache NON-EMPTY audio - caching an empty clip (a transient TTS failure) would mute the greeting forever."""
    if not _greeting_cache.get(lang):
        pcm = tts.synth(greeting_text(lang), lang)
        if pcm:
            _greeting_cache[lang] = pcm
    if not _filler_cache.get(lang):
        pcm = tts.synth(_FILLER.get(lang, _FILLER["en"]), lang)
        if pcm:
            _filler_cache[lang] = pcm
    return _greeting_cache.get(lang)


def _json(text):
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return {}
    return {}


class ConversationalBrain:
    """Holds the running dialogue and asks Gemini for the next spoken turn + gathered facts."""

    def __init__(self, call, config, model_call):
        self.cfg = config
        self.model_call = model_call
        self.turns = []          # [("PATIENT"|"YOU", text)]
        self.facts = {}
        self.system = _SYS.format(
            nurse=config.agent_name, language=_LANG.get(call.get("lang", "te"), "Telugu"),
            disease=call.get("disease") or "their condition", day=call.get("dayOffset", 1))

    def _prompt(self):
        # Only the last few turns + a running facts summary -> small prompt -> FAST + consistent LLM latency
        # (sending the whole growing transcript makes every later turn slower).
        recent = self.turns[-8:]
        convo = "\n".join("%s: %s" % (s, t) for s, t in recent) or "(the call just connected - start warmly)"
        known = ("\nAlready gathered: %s" % self.facts) if self.facts else ""
        return self.system + known + "\n\nConversation so far:\n" + convo + "\n\nYour JSON reply:"

    def step(self, patient_text):
        """Advance one turn. patient_text=None for the opening greeting. Returns {reply,emergency,complete,facts}."""
        if patient_text:
            self.turns.append(("PATIENT", patient_text))
        try:
            raw = self.model_call(self._prompt())
        except Exception:
            raw = ""
        data = _json(raw)
        reply = (data.get("reply") or "").strip()
        if not reply:                       # never go silent - fall back to a gentle nudge
            reply = self.cfg.convo_fallback
        self.turns.append(("YOU", reply))
        if isinstance(data.get("facts"), dict):
            self.facts.update(data["facts"])
        return {"reply": reply, "emergency": bool(data.get("emergency")),
                "complete": bool(data.get("complete")), "facts": self.facts}


class ConversationalSession:
    def __init__(self, call, stt, tts, telephony, brain, client, config, clock=None):
        self.call = call or {}
        self.stt = stt
        self.tts = tts
        self.telephony = telephony
        self.brain = brain
        self.client = client
        self.cfg = config
        self.clock = clock or time.monotonic

    async def _say(self, text):
        if text:
            loop = asyncio.get_event_loop()
            pcm = await loop.run_in_executor(None, self.tts.synth, text, self.call.get("lang", "te"))
            await self.telephony.play(pcm)

    async def run(self):
        call_id = self.call.get("callId")
        episode_id = self.call.get("episodeId")
        started = self.clock()
        loop = asyncio.get_event_loop()

        if not await self.telephony.dial(self.call):
            self.client.post_result({"episodeId": episode_id, "callId": call_id, "answers": {},
                                     "status": "no_answer", "durationMs": 0})
            return "no_answer"
        self.client.post_status(call_id, {"status": "in_progress"})

        lang = self.call.get("lang", "te")
        self.call["_convo"] = self.brain.turns   # live refs -> /lastcall always shows the current dialogue+facts
        self.call["_facts"] = self.brain.facts
        # Greeting. If we have a pre-synthesized clip, play it INSTANTLY (no dead air) and compute the first
        # question WHILE it plays (pipelined). Otherwise fall back to a normal LLM greeting (still works).
        turn = {"reply": "", "complete": False, "emergency": False}
        try:
            greet_pcm = _greeting_cache.get(lang) or await loop.run_in_executor(None, warm, self.tts, self.cfg, lang)
            if greet_pcm:
                self.brain.turns.append(("YOU", greeting_text(lang)))
                think = loop.run_in_executor(None, self.brain.step, None)  # a Future, already running concurrently
                await self.telephony.play(greet_pcm)
                turn = await think
            else:
                turn = await loop.run_in_executor(None, self.brain.step, None)
            await self._say(turn["reply"])
        except Exception as e:           # a greeting failure must NOT drop the call - fall into the loop anyway
            self.call.setdefault("_error", []).append("greeting: " + str(e)[:200])

        emergency = False
        silence = 0
        for _ in range(self.cfg.max_convo_turns):
            if turn.get("complete"):
                break
            if (self.clock() - started) > self.cfg.convo_max_seconds:   # hard cost ceiling - wrap up warmly
                turn = await loop.run_in_executor(
                    None, self.brain.step, "(the call has gone on a while - warmly say a short goodbye now and end)")
                await self._say(turn["reply"])
                break
            try:
                pcm = await self.telephony.listen(self.cfg.convo_turn_timeout)
            except Exception:            # patient hung up / websocket closed - end cleanly
                break
            if pcm is None:                              # elderly patients pause a lot - be VERY patient, don't cut off
                silence += 1
                if silence <= self.cfg.max_silence_nudges:
                    turn = await loop.run_in_executor(
                        None, self.brain.step,
                        "(the patient has been silent - they may be elderly; gently, warmly encourage them and "
                        "kindly ask the same thing once more in even simpler words. Do NOT re-introduce yourself, "
                        "do NOT hang up.)")
                    await self._say(turn["reply"])
                    continue
                break
            silence = 0
            try:
                transcript = await loop.run_in_executor(None, self.stt.transcribe, pcm, lang)
                self.call.setdefault("_turns", []).append(
                    {"sec": round(len(pcm) / 2 / 8000, 1), "heard": transcript})
                turn = await loop.run_in_executor(None, self.brain.step, transcript or "(unclear)")
                emergency = emergency or turn.get("emergency")
                await self._say(turn["reply"])
            except Exception as e:       # a transient STT/LLM/TTS hiccup must NOT drop the call
                self.call.setdefault("_error", []).append(str(e)[:200])
                await self._say(self.cfg.convo_fallback)

        duration_ms = int((self.clock() - started) * 1000)
        # Hand the gathered facts + transcript to the engine/record (server scores + escalates; safety net).
        self.client.post_result({
            "episodeId": episode_id, "callId": call_id, "answers": self.brain.facts,
            "transcript": self.brain.turns, "conversational": True,
            "ambulanceRequested": False, "emergency": bool(emergency),
            "status": "completed", "durationMs": duration_ms, "lang": self.call.get("lang", "te")})
        await self.telephony.hangup()
        return "completed"
