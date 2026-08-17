"""Pipecat voice bot for FollowCare: Plivo <-> Sarvam STT/LLM/TTS, streamed in parallel (call-centre latency).

Design (why it's fast + reliable):
  * LIVE call: the LLM speaks PLAIN Telugu straight to TTS - no per-turn JSON to parse or mis-speak.
  * Turn-taking: Silero VAD + a simple silence timeout (not the default smart-turn ML model) - predictable,
    tunable for slow elderly speakers, no extra model to load.
  * Sarvam STT/LLM/TTS all stream over their own websockets; Pipecat overlaps them -> ~1-2s turns.
  * At call end we run ONE extraction pass over the transcript and POST it to FollowCare (the clinical engine
    still scores/escalates server-side - unchanged safety net).

Run from voice-service/ (so `app.*` imports):  see server.py header.
"""
import asyncio
import json
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)                      # persona.py, results.py
sys.path.insert(0, os.path.dirname(_HERE))     # voice-service/ -> app.*

from loguru import logger

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair, LLMUserAggregatorParams)
from pipecat.serializers.plivo import PlivoFrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import TTSSpeakFrame, LLMRunFrame
from pipecat.runner.utils import parse_telephony_websocket
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.turns.user_start.vad_user_turn_start_strategy import VADUserTurnStartStrategy
from pipecat.turns.user_stop.speech_timeout_user_turn_stop_strategy import (
    SpeechTimeoutUserTurnStopStrategy)

import results
from guard import SpeechGuard
from persona import system_prompt, greeting_text
from app.config import Config
from app.followcare.client import FollowCareClient

# FollowCare lang code -> Sarvam BCP-47-ish code.
SARVAM_LANG = {"te": "te-IN", "hi": "hi-IN", "en": "en-IN", "ta": "ta-IN", "kn": "kn-IN", "ml": "ml-IN",
               "mr": "mr-IN", "gu": "gu-IN", "bn": "bn-IN", "pa": "pa-IN", "od": "od-IN"}


def _f(name, default):
    try:
        return float(os.getenv(name, "") or default)
    except (TypeError, ValueError):
        return default


def _msg_text(content):
    """LLMContext message content may be a str or a list of {type,text} parts."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return ""


async def run_bot(websocket, call):
    cfg = Config()
    lang = call.get("lang", "te")
    slang = SARVAM_LANG.get(lang, "te-IN")
    sarvam_key = os.getenv("SARVAM_API_KEY", "")
    # Conversation model: sarvam-105b-conversations STREAMS (TTFT ~0.3s) + best natural-dialogue Telugu.
    llm_model = os.getenv("SARVAM_LLM", "sarvam-105b-conversations")

    await websocket.accept()
    _, call_data = await parse_telephony_websocket(websocket)

    serializer = PlivoFrameSerializer(
        stream_id=call_data.stream_id, call_id=call_data.call_id,
        auth_id=os.getenv("PLIVO_AUTH_ID"), auth_token=os.getenv("PLIVO_AUTH_TOKEN"),
        params=PlivoFrameSerializer.InputParams(plivo_sample_rate=8000, auto_hang_up=True))

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True, audio_out_enabled=True, add_wav_header=False,
            audio_in_sample_rate=8000, audio_out_sample_rate=8000, serializer=serializer))

    stt = SarvamSTTService(
        api_key=sarvam_key, model=os.getenv("SARVAM_STT_MODEL", "saarika:v2.5"), sample_rate=8000,
        params=SarvamSTTService.InputParams(language=slang, vad_signals=True, high_vad_sensitivity=True))

    llm = OpenAILLMService(model=llm_model, api_key=sarvam_key, base_url="https://api.sarvam.ai/v1")

    tts = SarvamTTSService(
        api_key=sarvam_key, model=os.getenv("SARVAM_TTS_MODEL", "bulbul:v2"),
        voice_id=os.getenv("SARVAM_SPEAKER", "anushka"), sample_rate=8000,
        params=SarvamTTSService.InputParams(
            language=slang, pace=_f("SARVAM_PACE", 0.9), loudness=_f("SARVAM_LOUDNESS", 1.3),
            enable_preprocessing=True, output_audio_codec="linear16"))   # normalize numbers/symbols -> fewer TTS 400s

    # Silero VAD: short silence to detect end-of-speech; the resume window (below) gives elderly speakers
    # room to keep going without being cut off.
    vad = SileroVADAnalyzer(params=VADParams(
        stop_secs=_f("VOICE_VAD_STOP_SECS", 0.35), start_secs=0.2, confidence=0.6, min_volume=0.5))
    turn = UserTurnStrategies(
        start=[VADUserTurnStartStrategy()],
        stop=[SpeechTimeoutUserTurnStopStrategy(user_speech_timeout=_f("VOICE_RESUME_SECS", 0.35))])

    disease = call.get("disease") or "their condition"
    hospital = call.get("hospitalName") or call.get("hospital") or ""   # spoken in the greeting; from FollowCare settings
    greet = greeting_text(lang, hospital)
    # Only the system prompt is pre-seeded. The spoken greeting (TTSSpeakFrame below) is recorded by the
    # assistant aggregator itself, so the LLM sees it and won't re-greet - no need to pre-seed it twice.
    context = LLMContext(messages=[
        {"role": "system", "content": system_prompt(cfg.agent_name, lang, disease, call.get("dayOffset", 1), hospital)}])
    aggregators = LLMContextAggregatorPair(
        context, user_params=LLMUserAggregatorParams(vad_analyzer=vad, user_turn_strategies=turn))

    guard = SpeechGuard()   # strip stray symbols/tags before TTS + end the call on the natural goodbye
    pipeline = Pipeline([
        transport.input(), stt, aggregators.user(), llm, guard, tts, transport.output(), aggregators.assistant()])
    task = PipelineTask(
        pipeline, params=PipelineParams(audio_in_sample_rate=8000, audio_out_sample_rate=8000,
                                        enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=int(_f("VOICE_IDLE_TIMEOUT_SECS", 30)), cancel_on_idle_timeout=True)
    guard.task = task

    @transport.event_handler("on_client_connected")
    async def _connected(_transport, _client):
        # Play the warm fixed greeting INSTANTLY (no dead air), then let the LLM ask the first question.
        await task.queue_frames([TTSSpeakFrame(greet), LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def _disconnected(_transport, _client):
        await task.cancel()

    started = time.monotonic()
    logger.info(f"[voicebot] call={call.get('callId')} lang={lang} disease={disease} llm={llm_model}")
    try:
        await PipelineRunner(handle_sigint=False).run(task)
    finally:
        dur_ms = int((time.monotonic() - started) * 1000)
        await asyncio.to_thread(_finalize, cfg, call, context, dur_ms, sarvam_key, llm_model)


def _finalize(cfg, call, context, dur_ms, sarvam_key, llm_model):
    """Turn the transcript into facts and POST to FollowCare. Also drop a local JSON for self-review."""
    pairs = []
    for m in context.get_messages():
        role = m.get("role")
        if role == "user":
            pairs.append(("PATIENT", _msg_text(m.get("content"))))
        elif role == "assistant":
            pairs.append(("YOU", _msg_text(m.get("content"))))
    # sarvam-105b-conversations extracts clean JSON here; the base 105b returned empty on this prompt.
    ecfg = {"sarvam_key": sarvam_key, "extract_model": os.getenv("SARVAM_EXTRACT_LLM", "sarvam-105b-conversations")}
    client = FollowCareClient(cfg)
    info = results.post_result(client, call, pairs, dur_ms, ecfg)
    try:
        os.makedirs(os.path.join(_HERE, "calls"), exist_ok=True)
        with open(os.path.join(_HERE, "calls", (call.get("callId") or "call") + ".json"), "w") as fh:
            json.dump({"call": call, "durationMs": dur_ms, "transcript": pairs, "extracted": info},
                      fh, ensure_ascii=False, indent=2)
    except Exception:
        pass
    logger.info(f"[voicebot] done call={call.get('callId')} dur={dur_ms}ms turns={len(pairs)} "
                f"emergency={info.get('emergency')} note={bool(info.get('doctor_note'))}")
