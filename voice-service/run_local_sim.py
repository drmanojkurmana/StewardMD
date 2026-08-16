"""Offline end-to-end simulation of a full AI follow-up call — no GPU, no Plivo, no network.

Drives the real state machine + session with fake STT/TTS/telephony/NLU/FollowCare, printing the transcript
so you can see the agreed loop working before any provisioning. Run: cd voice-service && python3 run_local_sim.py
"""
import asyncio

from app.config import Config
from app.call.session import CallSession
from tests.fakes import FakeTelephony, FakeSTT, FakeTTS, FakeNLU, FakeClient


CALL = {
    "callId": "sim-1", "episodeId": "ep-sim", "lang": "en", "firstName": "Ravi", "isMinor": False,
    "questions": [
        {"id": "overall", "text": "How are you feeling today?", "type": "overall"},
        {"id": "meds_taken", "text": "Are you taking your medicines as prescribed?", "type": "choice"},
        {"id": "fever", "text": "Any new or worsening symptoms?", "type": "yesno"},
    ],
}


class NarratingTelephony(FakeTelephony):
    async def play(self, pcm):
        text = pcm.decode("utf-8") if isinstance(pcm, (bytes, bytearray)) else str(pcm)
        print(f"  AGENT   : {text}")

    async def listen(self, timeout_s):
        pcm = await super().listen(timeout_s)
        if pcm is not None:
            print(f"  PATIENT : {pcm.decode('utf-8')}")
        return pcm


async def run_scenario(name, script, answered=True):
    print(f"\n=== {name} ===")
    client = FakeClient()
    tel = NarratingTelephony(script, answered=answered)
    sess = CallSession(CALL, FakeSTT(), FakeTTS(), tel, FakeNLU(), client, Config(env={}))
    status = await sess.run()
    res = client.results[-1] if client.results else {}
    print(f"  -> status={status}  ambulance={res.get('ambulanceRequested')}  answers={res.get('answers')}")
    if res.get("patientStatement"):
        print(f"  -> patient statement kept for doctor: {res['patientStatement']!r}")


async def main():
    await run_scenario("Recovering patient", ["yes", "much better", "yes", "no"])
    await run_scenario("Worsening → ambulance", ["yes", "I have severe breathing difficulty", "yes"])
    await run_scenario("No answer", [], answered=False)
    await run_scenario("Wrong person", ["no"])


if __name__ == "__main__":
    asyncio.run(main())
