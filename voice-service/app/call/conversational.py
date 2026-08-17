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

_SYS = """You are {nurse}, a warm, caring nurse from the patient's hospital making a post-discharge follow-up
phone call in {language}. The patient was treated for: {disease}. It is day {day} after discharge.

Have a NATURAL, empathetic CONVERSATION - not a questionnaire, never read a list of options. Speak ONLY in
{language}, warmly and simply, like a real nurse on the phone. React to what they actually say. Ask only ONE
thing at a time. Keep every reply SHORT: 1-2 short spoken sentences.

Across the whole conversation, gently find out (in any natural order, weaving it into the chat): how they are
feeling overall; any weight gain since discharge; breathlessness; trouble breathing when lying flat / how many
pillows at night; leg or ankle swelling; whether they are taking their medicines as prescribed.

DANGER SIGNS - if the patient reports any: new or severe chest pain, severe breathlessness at rest,
fainting/blackout, new confusion, or coughing up blood - show concern, tell them you will inform their doctor
right away, and ask if they would like an ambulance.

When you have gently covered the main points (or fully handled an emergency), warmly thank them and close.

Reply with STRICT JSON ONLY, nothing else:
{{"reply":"<exactly what you say next, in {language}, short>",
  "facts":{{<clinical facts gathered so far, short keys e.g. "overall":"tired","weight_gain_kg":2,
            "breathless":"mild","orthopnea_pillows":2,"leg_swelling":"none","took_meds":true>}},
  "emergency":<true only if a danger sign was reported>,
  "complete":<true only when you have just said your closing/goodbye>}}"""


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
        await self._say(turn["reply"])
        emergency = False
        silence = 0
        for _ in range(self.cfg.max_convo_turns):
            if turn.get("complete"):
                break
            pcm = await self.telephony.listen(self.cfg.turn_timeout_s)
            if pcm is None:                              # a pause: nudge once, then close warmly
                if silence == 0:
                    silence = 1
                    turn = await loop.run_in_executor(None, self.brain.step, "(the patient is quiet)")
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
