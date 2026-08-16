"""Voice-service core tests — codec, responder, state machine, NLU, client, and the full call loop.
Run: cd voice-service && python3 -m unittest discover -s tests -v
"""
import unittest

from app.audio import codec
from app.call import responder
from app.call.state_machine import Conversation, ASK, AMBULANCE
from app.nlu.gemini import SlotExtractor
from app.followcare.client import FollowCareClient
from app.call.session import CallSession
from app.config import Config
from tests.fakes import FakeTelephony, FakeSTT, FakeTTS, FakeNLU, FakeClient


QUESTIONS = [
    {"id": "overall", "text": "How are you feeling today?", "type": "overall"},
    {"id": "meds_taken", "text": "Are you taking your medicines as prescribed?", "type": "choice"},
    {"id": "fever", "text": "Any new or worsening symptoms?", "type": "yesno"},
]


def make_call(**kw):
    base = {"callId": "c1", "episodeId": "e1", "lang": "en", "firstName": "Ravi", "isMinor": False, "questions": [dict(q) for q in QUESTIONS]}
    base.update(kw)
    return base


# ---- codec ----
class TestCodec(unittest.TestCase):
    def test_ulaw_roundtrip_within_quantization_error(self):
        for s in (0, 100, -100, 1000, -1000, 8000, -8000, 20000, -20000, 32000, -32000):
            u = codec.linear_to_ulaw(s)
            self.assertTrue(0 <= u <= 255)
            back = codec.ulaw_to_linear(u)
            # mu-law is lossy; error grows with amplitude but stays a small fraction of full scale.
            self.assertLess(abs(back - s), max(64, abs(s) * 0.12))
        self.assertEqual(codec.ulaw_to_linear(codec.linear_to_ulaw(0)), 0)

    def test_frame_bytes_roundtrip(self):
        pcm = b"".join(int(v).to_bytes(2, "little", signed=True) for v in (0, 500, -500, 12000))
        frame = codec.encode_frame(pcm, "mulaw")
        out = codec.decode_frame(frame, "mulaw")
        self.assertEqual(len(out), len(pcm))
        # l16 passthrough is exact
        self.assertEqual(codec.decode_frame(codec.encode_frame(pcm, "l16"), "l16"), pcm)


# ---- responder ----
class TestResponder(unittest.TestCase):
    def test_short_lines_and_lang_fallback(self):
        self.assertIn("Ravi", responder.say("greeting", "en", name="Ravi"))
        self.assertTrue(responder.say("ambulance_yes", "en"))
        self.assertNotEqual(responder.say("notify_doctor", "hi"), responder.say("notify_doctor", "en"))  # hi is translated
        self.assertNotEqual(responder.say("close_ok", "te"), responder.say("close_ok", "en"))  # te is now complete
        # a line missing in hi falls back to English, never empty
        self.assertEqual(responder.say("close_ok", "hi"), responder.say("close_ok", "en"))


# ---- state machine ----
class TestStateMachine(unittest.TestCase):
    def test_benign_flow_records_all_answers_and_closes(self):
        c = Conversation(make_call())
        t = c.start(); self.assertTrue(t.expect_reply)
        t = c.on_reply({"intent": "affirm"}); self.assertEqual(c.phase, ASK)
        t = c.on_reply({"intent": "answer", "value": "better", "patient_said": "much better"}, {"escalation": "green"})
        t = c.on_reply({"intent": "answer", "value": "yes", "patient_said": "yes"}, {"escalation": "green"})
        t = c.on_reply({"intent": "answer", "value": "no", "patient_said": "no"}, {"escalation": "green"})
        self.assertTrue(t.done)
        self.assertFalse(c.ambulance_requested)
        self.assertEqual(c.answers, {"overall": "better", "meds_taken": "yes", "fever": "no"})
        self.assertEqual(c.result()["status"], "completed")

    def test_emergency_offers_ambulance_and_records_request(self):
        c = Conversation(make_call())
        c.on_reply({"intent": "affirm"})
        t = c.on_reply({"intent": "answer", "value": "worse", "patient_said": "severe breathing difficulty", "emergency": True},
                       {"escalation": "red", "askAmbulance": True, "redFlag": True})
        self.assertEqual(c.phase, AMBULANCE)
        self.assertIn("ambulance", t.say.lower())
        t = c.on_reply({"intent": "affirm"})
        self.assertTrue(t.done)
        self.assertTrue(c.ambulance_requested)
        self.assertEqual(c.patient_statement, "severe breathing difficulty")

    def test_wrong_person_ends_politely(self):
        c = Conversation(make_call())
        c.start()
        t = c.on_reply({"intent": "deny"})
        self.assertTrue(t.done)
        self.assertEqual(c.result()["status"], "wrong_person")

    def test_unclear_verify_reasks_then_ends(self):
        c = Conversation(make_call(), max_reasks=1)
        c.start()
        t = c.on_reply({"intent": "unclear"}); self.assertTrue(t.expect_reply)   # reask once
        t = c.on_reply({"intent": "unclear"}); self.assertTrue(t.done)           # then give up
        self.assertEqual(c.result()["status"], "no_answer")


# ---- NLU (fake model) ----
class TestSlotExtractor(unittest.TestCase):
    def test_parses_model_json(self):
        ex = SlotExtractor(Config(env={}), model_call=lambda p: '{"intent":"answer","value":"worse","patient_said":"getting worse","emergency":false}')
        r = ex.interpret({"text": "How are you?", "type": "overall"}, "I am getting worse", "en")
        self.assertEqual(r["intent"], "answer")
        self.assertEqual(r["value"], "worse")

    def test_tolerates_prose_around_json_and_bad_output(self):
        ex = SlotExtractor(Config(env={}), model_call=lambda p: 'Sure! {"intent":"affirm","value":"yes"} hope that helps')
        self.assertEqual(ex.interpret({"text": "?"}, "yes", "en")["intent"], "affirm")
        ex2 = SlotExtractor(Config(env={}), model_call=lambda p: "not json at all")
        self.assertIn(ex2.interpret({"text": "?"}, "mumble", "en")["intent"], ("answer", "unclear"))

    def test_model_exception_degrades_to_unclear(self):
        def boom(p): raise RuntimeError("gemini down")
        ex = SlotExtractor(Config(env={}), model_call=boom)
        self.assertEqual(ex.interpret({"text": "?"}, "", "en")["intent"], "unclear")


# ---- client (fake transport) ----
class TestFollowCareClient(unittest.TestCase):
    def _client(self, recorder):
        cfg = Config(env={"FOLLOWCARE_BASE": "https://x/api/followcare", "FOLLOWCARE_VOICE_SERVICE_TOKEN": "tok"})
        def transport(method, url, headers, obj):
            recorder.append((method, url, headers.get("X-Voice-Token"), obj))
            if url.endswith("/voice/queue"):
                return 200, {"count": 1, "calls": [{"callId": "c1"}]}
            if url.endswith("/voice/classify"):
                return 200, {"ok": True, "escalation": "orange", "askAmbulance": False}
            if url.endswith("/voice/nlu"):
                return 200, {"ok": True, "text": '{"intent":"affirm","value":"yes"}'}
            return 200, {"ok": True}
        return FollowCareClient(cfg, transport=transport)

    def test_sends_token_and_shapes_calls(self):
        rec = []
        c = self._client(rec)
        self.assertEqual(c.get_queue(), [{"callId": "c1"}])
        self.assertEqual(c.classify("e1", {"overall": "worse"})["escalation"], "orange")
        self.assertIn("affirm", c.nlu("some prompt"))   # slot extraction via Cloudflare (Vertex/fallback)
        c.post_status("c1", {"status": "in_progress"})
        self.assertEqual(c.post_result({"episodeId": "e1"})["ok"], True)
        # every call carried the service token
        self.assertTrue(all(tok == "tok" for (_, _, tok, _) in rec))
        self.assertTrue(any(u.endswith("/voice/result") for (_, u, _, _) in rec))


# ---- full loop (session + fakes) ----
class TestCallLoop(unittest.IsolatedAsyncioTestCase):
    def _session(self, script, answered=True):
        client = FakeClient()
        tel = FakeTelephony(script, answered=answered)
        sess = CallSession(make_call(), FakeSTT(), FakeTTS(), tel, FakeNLU(), client, Config(env={}))
        return sess, client, tel

    async def test_benign_call_completes_and_posts_result(self):
        sess, client, tel = self._session(["yes", "much better", "yes", "no"])
        status = await sess.run()
        self.assertEqual(status, "completed")
        self.assertEqual(len(client.results), 1)
        res = client.results[0]
        self.assertEqual(res["status"], "completed")
        self.assertFalse(res["ambulanceRequested"])
        self.assertEqual(res["answers"], {"overall": "better", "meds_taken": "yes", "fever": "no"})
        self.assertTrue(any(s[1].get("status") == "in_progress" for s in client.statuses))

    async def test_emergency_call_routes_ambulance(self):
        sess, client, tel = self._session(["yes", "I have severe breathing difficulty", "yes"])
        status = await sess.run()
        self.assertEqual(status, "completed")
        res = client.results[0]
        self.assertTrue(res["ambulanceRequested"])
        self.assertIn("breathing", res["patientStatement"].lower())

    async def test_no_answer_records_and_stops(self):
        sess, client, tel = self._session([], answered=False)
        status = await sess.run()
        self.assertEqual(status, "no_answer")
        self.assertEqual(client.results[0]["status"], "no_answer")
        self.assertEqual(client.results[0]["answers"], {})

    async def test_wrong_person_call(self):
        sess, client, tel = self._session(["no"])
        status = await sess.run()
        self.assertEqual(status, "wrong_person")
        self.assertEqual(client.results[0]["status"], "wrong_person")


if __name__ == "__main__":
    unittest.main()
