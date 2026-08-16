"""One outbound call, end to end.

Wires the pieces of the agreed loop:
  telephony.dial -> greeting (TTS->telephony) -> [ listen (telephony) -> STT -> NLU slot-extract ->
  FollowCare engine classify -> state machine -> short response (TTS->telephony) ]* -> POST /voice/result.

Everything clinical is delegated (classify + result = the Cloudflare engine). Providers are injected so the
whole loop runs offline in tests with fakes (no GPU, no Plivo, no network).
"""
import asyncio
import time

from . import responder
from .state_machine import Conversation, ASK, Turn


class CallSession:
    def __init__(self, call, stt, tts, telephony, nlu, client, config, clock=None):
        self.call = call or {}
        self.stt = stt
        self.tts = tts
        self.telephony = telephony
        self.nlu = nlu
        self.client = client
        self.cfg = config
        self.clock = clock or time.monotonic

    async def _say(self, turn):
        if turn and turn.say:
            # TTS is a heavy blocking call (GPU generate); run OFF the event loop so it doesn't freeze the
            # WebSocket (missed keepalives / audio stalls). Same for STT/NLU below.
            pcm = await asyncio.get_event_loop().run_in_executor(
                None, self.tts.synth, turn.say, self.call.get("lang", "en"))
            await self.telephony.play(pcm)

    async def run(self):
        call_id = self.call.get("callId")
        episode_id = self.call.get("episodeId")
        started = self.clock()

        answered = await self.telephony.dial(self.call)
        if not answered:
            self.client.post_status(call_id, {"status": "no_answer", "endedMs": _ms(self.clock())})
            # Record it so the doctor sees a no-answer and we don't retry today (spec §29).
            self.client.post_result({"episodeId": episode_id, "callId": call_id, "answers": {},
                                     "status": "no_answer", "durationMs": 0})
            return "no_answer"

        self.client.post_status(call_id, {"status": "in_progress", "startedMs": _ms(self.clock())})
        conv = Conversation(self.call, max_reasks=self.cfg.max_reasks)

        turn = conv.start()
        await self._say(turn)
        silence_reasks = 0
        while turn.expect_reply and not turn.done:
            pcm = await self.telephony.listen(self.cfg.turn_timeout_s)
            if pcm is None:                       # silence / hangup
                # A pause isn't a hangup — re-prompt once and repeat the question before giving up, so a
                # patient who's just thinking (or a slightly-slow line) doesn't get cut off.
                if silence_reasks < 1:
                    silence_reasks += 1
                    await self._say(Turn(responder.say("still_there", conv.lang), expect_reply=True))
                    await self._say(turn)         # repeat the same question
                    continue
                if not conv.answers:
                    conv.status = "no_answer"
                break
            silence_reasks = 0
            loop = asyncio.get_event_loop()
            transcript = await loop.run_in_executor(None, self.stt.transcribe, pcm, conv.lang)
            cur_q = conv.questions[conv.q_index] if (conv.phase == ASK and conv.q_index < len(conv.questions)) else None
            nlu = await loop.run_in_executor(None, self.nlu.interpret, cur_q, transcript, conv.lang)
            engine = None
            if conv.phase == ASK and cur_q is not None and nlu.get("intent") != "unclear":
                merged = dict(conv.answers)
                merged[cur_q.get("id")] = nlu.get("value", "")
                engine = await loop.run_in_executor(None, self.client.classify, episode_id, merged)
            turn = conv.on_reply(nlu, engine)
            await self._say(turn)

        duration_ms = _ms(self.clock()) - _ms(started)
        result = conv.result(duration_ms)
        self.client.post_result(result)
        await self.telephony.hangup()
        return result["status"]


def _ms(t):
    return int(t * 1000)
