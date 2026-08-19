"""Deterministic call state machine (spec §17): START -> VERIFY -> ASK(questions) -> [ESCALATE/AMBULANCE] -> END.

This holds NO clinical logic. It walks the FollowCare question script, records the patient's answers, and
branches to the escalation/ambulance path when the ENGINE (passed in as `engine` on each answered turn) says
so. The engine's verdict comes from app.followcare.client.classify — one source of truth, no second brain.

Usage (the session drives it):
    conv = Conversation(call)
    turn = conv.start()                     # -> speak turn.say, then listen if turn.expect_reply
    turn = conv.on_reply(nlu, engine)       # repeat until turn.done
    result = conv.result(duration_ms)       # -> POST /voice/result
"""
import re

from . import responder

VERIFY, ASK, AMBULANCE, DONE = "VERIFY", "ASK", "AMBULANCE", "DONE"
_WORSE = ("orange", "red")

_PAREN = re.compile(r"\s*\([^)]*\)")          # "(0-3)", "(kg, e.g. 2 for +2 kg)", "(0 none - 3 severe)"
_VS = re.compile(r"\bvs\.?\b", re.I)

# Natural spoken Telugu for the FollowCare question script (keyed by question id). Screen text is English and
# formatted for a screen; on a Telugu call we speak these reviewed lines instead. Unknown ids fall back to the
# English speakable path. Scale hints are baked into the phrasing so it sounds natural, not "0-3".
_Q_TE = {
    "overall": "మొత్తంగా ఈరోజు మీరు ఎలా ఉన్నారు?",
    "weight_delta": "మూడు రోజుల క్రితంతో పోలిస్తే మీ బరువు ఎన్ని కిలోలు మారింది?",
    "orthopnea": "రాత్రి పడుకున్నప్పుడు శ్వాస తీసుకోవడానికి మీకు ఎన్ని దిండ్లు అవసరం అవుతున్నాయి? సున్నా నుండి మూడు వరకు చెప్పండి.",
    "edema": "మీ కాళ్ళలో వాపు ఎంత ఉంది? సున్నా అంటే లేదు, మూడు అంటే చాలా ఎక్కువ.",
    "breathless": "మీకు ఊపిరి ఆడకపోవడం ఎంత ఉంది? సున్నా నుండి మూడు వరకు, సున్నా అంటే లేదు, మూడు అంటే చాలా ఎక్కువ.",
    "meds_taken": "మీరు ఈరోజు మీ మందులు వేసుకున్నారా?",
    "g_chestpain": "కొత్తగా ఛాతీలో నొప్పి ఏమైనా ఉందా?",
    "g_breathless_rest": "విశ్రాంతిగా ఉన్నప్పుడు కూడా తీవ్రంగా ఊపిరి ఆడకపోవడం ఉందా?",
    "g_syncope": "మీరు స్పృహ తప్పి పడిపోయారా?",
    "g_confusion": "కొత్తగా గందరగోళం లేదా అయోమయం ఉందా?",
    "g_bleeding": "ఎక్కడైనా తీవ్రంగా రక్తస్రావం అవుతోందా?",
    "g_seizure": "మీకు ఏదైనా మూర్ఛ లేదా ఫిట్స్ వచ్చాయా?",
    "g_stroke_fast": "కొత్తగా ముఖం వంకరపోవడం, చేయి బలహీనత, లేదా మాట్లాడటంలో ఇబ్బంది ఉందా?",
    "g_anaphylaxis": "అకస్మాత్తుగా దద్దుర్లు, వాపు, లేదా ఊపిరి ఆడకపోవడం వంటి అలర్జీ ఉందా?",
    "g_selfharm": "మిమ్మల్ని మీరు హాని చేసుకోవాలనే ఆలోచనలు ఏమైనా వస్తున్నాయా?",
}


def speak_q(q, lang="en"):
    """Question text is written for a SCREEN (parentheticals, ranges, abbreviations); read aloud it sounds like
    rubbish. Turn it into one natural spoken line — reviewed Telugu for te, else strip on-screen junk + add a
    proper scale prompt."""
    q = q or {}
    if lang == "te" and q.get("id") in _Q_TE:
        return _Q_TE[q["id"]]
    text = _VS.sub("versus", _PAREN.sub("", q.get("text") or "")).strip().rstrip(".")
    if q.get("type") == "scale" and q.get("max"):
        m = q.get("max")
        return "%s. On a scale of 0 to %s, where 0 is none and %s is severe." % (text, m, m)
    if text and text[-1] not in ".?!":
        text += "."
    return text


class Turn:
    __slots__ = ("say", "expect_reply", "done")

    def __init__(self, say, expect_reply=True, done=False):
        self.say = say
        self.expect_reply = expect_reply
        self.done = done


class Conversation:
    def __init__(self, call, max_reasks=1):
        self.call = call or {}
        self.lang = self.call.get("lang", "en")
        self.questions = self.call.get("questions") or []
        self.max_reasks = max_reasks
        self.phase = VERIFY
        self.q_index = 0
        self.answers = {}
        self.patient_statement = ""
        self.ambulance_requested = False
        self.status = "completed"
        self._reasks = 0

    # ---- entry ----
    def start(self):
        name = (self.call.get("firstName") or "").strip()
        if self.call.get("isMinor"):
            line = "greeting_guardian"
        elif name:
            line = "greeting"
        else:
            line = "greeting_generic"
        return Turn(responder.say(line, self.lang, name=name), expect_reply=True)

    # ---- one patient reply ----
    # nlu    = {intent, value, patient_said, emergency}   (from the slot extractor)
    # engine = {escalation, askAmbulance, redFlag}        (from FollowCare classify; only for ASK answers)
    def on_reply(self, nlu, engine=None):
        nlu = nlu or {}
        if self.phase == VERIFY:
            return self._verify(nlu)
        if self.phase == ASK:
            return self._ask_answer(nlu, engine or {})
        if self.phase == AMBULANCE:
            return self._ambulance(nlu)
        return Turn("", expect_reply=False, done=True)

    # ---- phases ----
    def _verify(self, nlu):
        # Only an explicit "no / wrong number" stops the call. Being strict here made real patients loop on the
        # verification step (they say "hello" / "yes tell me" and it kept re-asking) — a soft confirm is enough:
        # they picked up and spoke, so proceed straight to the questions.
        if nlu.get("intent") == "deny":
            self.phase = DONE
            self.status = "wrong_person"
            return Turn(responder.say("wrong_person", self.lang), expect_reply=False, done=True)
        self.phase = ASK
        self._reasks = 0
        return self._ask_current()

    def _ask_current(self):
        q = self.questions[self.q_index]
        return Turn(speak_q(q, self.lang), expect_reply=True)

    def _ask_answer(self, nlu, engine):
        q = self.questions[self.q_index]
        intent = nlu.get("intent")
        # unintelligible → re-ask the same question once, else record blank and move on.
        if intent == "unclear":
            if self._reasks < self.max_reasks:
                self._reasks += 1
                return Turn(responder.say("unclear", self.lang) + " " + speak_q(q, self.lang), expect_reply=True)
            self.answers[q.get("id")] = ""
        else:
            self._reasks = 0
            self.answers[q.get("id")] = nlu.get("value", "")

        escalation = (engine or {}).get("escalation", "")
        red_flag = bool((engine or {}).get("redFlag"))
        ask_ambulance = bool((engine or {}).get("askAmbulance"))
        emergency = bool(nlu.get("emergency")) or escalation == "red" or ask_ambulance
        worsening = emergency or red_flag or escalation in _WORSE
        if worsening and nlu.get("patient_said"):
            self.patient_statement = nlu.get("patient_said")

        if emergency:
            self.phase = AMBULANCE
            self._reasks = 0
            return Turn(responder.say("notify_doctor", self.lang) + " " + responder.say("ambulance_offer", self.lang), expect_reply=True)

        # advance
        self.q_index += 1
        if self.q_index < len(self.questions):
            pre = (responder.say("ack", self.lang) + " ") if worsening else ""
            return Turn(pre + speak_q(self.questions[self.q_index], self.lang), expect_reply=True)
        # no more questions
        self.phase = DONE
        line = "notify_doctor" if worsening else "close_good"
        return Turn(responder.say(line, self.lang), expect_reply=False, done=True)

    def _ambulance(self, nlu):
        intent = nlu.get("intent")
        if intent == "affirm":
            self.ambulance_requested = True
            self.phase = DONE
            return Turn(responder.say("ambulance_yes", self.lang), expect_reply=False, done=True)
        if intent == "deny":
            self.phase = DONE
            return Turn(responder.say("ambulance_no", self.lang), expect_reply=False, done=True)
        # unclear → re-ask once, else treat as no
        if self._reasks < self.max_reasks:
            self._reasks += 1
            return Turn(responder.say("ambulance_offer", self.lang), expect_reply=True)
        self.phase = DONE
        return Turn(responder.say("ambulance_no", self.lang), expect_reply=False, done=True)

    # ---- terminal result for POST /voice/result ----
    def result(self, duration_ms=0):
        return {
            "episodeId": self.call.get("episodeId"),
            "callId": self.call.get("callId"),
            "answers": self.answers,
            "patientStatement": self.patient_statement,
            "ambulanceRequested": self.ambulance_requested,
            "durationMs": duration_ms,
            "status": self.status,
            "lang": self.lang,
        }
