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
from . import responder

VERIFY, ASK, AMBULANCE, DONE = "VERIFY", "ASK", "AMBULANCE", "DONE"
_WORSE = ("orange", "red")


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
        intent = nlu.get("intent")
        if intent == "affirm":
            self.phase = ASK
            self._reasks = 0
            return self._ask_current()
        if intent == "deny":
            self.phase = DONE
            self.status = "wrong_person"
            return Turn(responder.say("wrong_person", self.lang), expect_reply=False, done=True)
        # unclear / off-topic
        if self._reasks < self.max_reasks:
            self._reasks += 1
            name = (self.call.get("firstName") or "").strip()
            return Turn(responder.say("reask_verify", self.lang, name=name), expect_reply=True)
        self.phase = DONE
        self.status = "no_answer"
        return Turn(responder.say("wrong_person", self.lang), expect_reply=False, done=True)

    def _ask_current(self):
        q = self.questions[self.q_index]
        return Turn(q.get("text", ""), expect_reply=True)

    def _ask_answer(self, nlu, engine):
        q = self.questions[self.q_index]
        intent = nlu.get("intent")
        # unintelligible → re-ask the same question once, else record blank and move on.
        if intent == "unclear":
            if self._reasks < self.max_reasks:
                self._reasks += 1
                return Turn(responder.say("unclear", self.lang) + " " + q.get("text", ""), expect_reply=True)
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
            return Turn(pre + self.questions[self.q_index].get("text", ""), expect_reply=True)
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
