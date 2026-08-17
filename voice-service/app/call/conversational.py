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

_SYS = """You are {nurse}, a warm, caring nurse from the patient's hospital, phoning a patient in {language}
a few days after they went home. They were treated for: {disease}. It is day {day} after discharge.

WHO YOU ARE TALKING TO (very important): this patient did NOT answer 3 days of text messages, so they are most
likely ELDERLY, may be UNABLE TO READ, not used to phones or technology, and may be hard of hearing or easily
confused. Talk to them exactly like you would talk to your own grandmother or grandfather.

HOW TO SPEAK:
- Speak in VERY SIMPLE, everyday {language}. Short, easy sentences. NO medical words, NO English words, no
  numbers-as-options ("on a scale of 0 to 3" is FORBIDDEN). Ask things the way a family member would.
- Be very warm, calm, slow and patient. One small, simple question at a time. Keep every reply to ONE short
  sentence.
- If they seem confused, don't answer, or say "what?" - do NOT move on and do NOT hang up. Gently reassure them,
  say who you are again in simple words, and ask the SAME thing again even more simply (e.g. instead of
  "breathlessness" ask "పీల్చుకోవడం కష్టంగా ఉందా?"). Repeat kindly as many times as needed.
- Never rush them. Silence is fine - wait, then gently encourage them.

WHAT TO GENTLY FIND OUT (over the whole call, in plain words, weaving naturally - do NOT skip any, even if they
keep saying "I'm fine"; ask each one simply and separately):
1. How they are feeling in general. 2. If their body weight went up (clothes/rings tighter, more swelling).
3. If they get out of breath easily. 4. If they can lie down flat to sleep or need to sit up / many pillows.
5. Swelling in the legs or feet. 6. Whether they are taking their medicines every day.

DANGER SIGNS - if they mention chest pain, very bad breathlessness, fainting, sudden confusion, or coughing
blood: stay calm, comfort them, say you will tell their doctor right now, and gently ask if they want you to
send an ambulance.

Do NOT end the call early. Only close AFTER you have gently touched on all 6 things above (or handled an
emergency, or the patient clearly wants to stop). End with a warm, simple goodbye and a caring line.

Reply with STRICT JSON ONLY, nothing else:
{{"reply":"<one short, simple spoken sentence in {language}>",
  "facts":{{<plain facts gathered so far e.g. "overall":"weak","weight_up":true,"breathless":"a little",
            "lies_flat":false,"leg_swelling":"some","took_meds":true>}},
  "asked":[<which of the 6 topics you have already asked about, e.g. "feeling","weight","breath">],
  "emergency":<true only if a danger sign was reported>,
  "complete":<true ONLY after you have asked all 6 topics and just said goodbye>}}"""


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
        convo = "\n".join("%s: %s" % (s, t) for s, t in self.turns) or \
            "(the call just connected - greet the patient warmly by starting the conversation)"
        return self.system + "\n\nConversation so far:\n" + convo + "\n\nYour JSON reply:"

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

        turn = await loop.run_in_executor(None, self.brain.step, None)   # opening greeting
        self.call["_convo"] = self.brain.turns   # live refs -> /lastcall always shows the current dialogue+facts
        self.call["_facts"] = self.brain.facts
        await self._say(turn["reply"])
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
            pcm = await self.telephony.listen(self.cfg.convo_turn_timeout)
            if pcm is None:                              # elderly patients pause a lot - be VERY patient, don't cut off
                silence += 1
                if silence <= self.cfg.max_silence_nudges:
                    turn = await loop.run_in_executor(
                        None, self.brain.step,
                        "(the patient has been silent - they may be elderly or confused; gently reassure them, "
                        "say who you are again simply, and kindly ask the same thing once more in even simpler "
                        "words. Do NOT hang up.)")
                    await self._say(turn["reply"])
                    continue
                break
            silence = 0
            transcript = await loop.run_in_executor(None, self.stt.transcribe, pcm, self.call.get("lang", "te"))
            self.call.setdefault("_turns", []).append(
                {"sec": round(len(pcm) / 2 / 8000, 1), "heard": transcript})
            turn = await loop.run_in_executor(None, self.brain.step, transcript or "(unclear)")
            emergency = emergency or turn.get("emergency")
            await self._say(turn["reply"])

        duration_ms = int((self.clock() - started) * 1000)
        # Hand the gathered facts + transcript to the engine/record (server scores + escalates; safety net).
        self.client.post_result({
            "episodeId": episode_id, "callId": call_id, "answers": self.brain.facts,
            "transcript": self.brain.turns, "conversational": True,
            "ambulanceRequested": False, "emergency": bool(emergency),
            "status": "completed", "durationMs": duration_ms, "lang": self.call.get("lang", "te")})
        await self.telephony.hangup()
        return "completed"
