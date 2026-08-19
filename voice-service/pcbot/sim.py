"""Local Plivo simulator - drive a FULL Telugu call end-to-end WITHOUT a phone.

It speaks Plivo's exact wire protocol to the local server:
  * synthesizes each patient turn with Sarvam TTS -> 8k mu-law -> streams as `media` frames (real-time),
  * streams silence between turns so the bot's VAD detects end-of-turn,
  * captures the bot's `playAudio` replies, measures reply latency, saves the whole bot side to a WAV,
  * after hangup, prints the transcript + extracted facts the bot posted (pcbot/calls/simcall.json).

Run (server must be up on :7860):  pcbot/.venv/bin/python pcbot/sim.py
"""
import asyncio
import audioop
import base64
import io
import json
import os
import time
import urllib.request
import wave

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, "..", "deploy", ".env")
KEY = next(l.split("=", 1)[1].strip() for l in open(ENV) if l.startswith("SARVAM_API_KEY="))
WS_URL = os.getenv("SIM_WS", "ws://localhost:7860/ws/simcall")

# Scenario scripts (pick with SIM_SCENARIO=fine|worsening|emergency|caregiver). Answers are generic enough to
# follow whatever the bot asks; the emergency script drives chest pain -> the bot must OFFER an ambulance + escalate.
SCENARIOS = {
    "fine": [
        "బానే ఉన్నాను అమ్మా",              # I'm okay
        "లేదు, బరువు పెరగలేదు",             # no weight gain
        "లేదు, ఊపిరి బాగానే వస్తోంది",       # no breathlessness
        "కాళ్ళు వాపు ఏమీ లేదు",            # no swelling
        "మందులు రోజూ వేసుకుంటున్నాను",       # taking meds
        "లేదు, ఇంకేమీ లేదు, ధన్యవాదాలు",     # nothing else
    ],
    "worsening": [
        "బానే ఉన్నాను కానీ కొంచెం ఆయాసంగా ఉంది",   # a bit breathless
        "అవును, బరువు కొంచెం పెరిగింది",            # weight up
        "కాళ్ళు కొంచెం వాచాయి",                    # legs swollen
        "మందులు వేసుకుంటున్నాను",                  # taking meds
        "లేదు, ఛాతీలో నొప్పి ఏమీ లేదు",             # no chest pain
        "లేదు, ఇంకేమీ లేదు",                       # nothing else
    ],
    "emergency": [
        "అమ్మా, నాకు గుండెల్లో నొప్పిగా ఉంది",       # I have chest pain
        "అవును, నిజంగా గుండెల్లో నొప్పి ఉంది",       # yes, really chest pain
        "అవును, అంబులెన్స్ పంపండి ప్లీజ్",          # yes, please send an ambulance
        "సరే అమ్మా",                              # ok
    ],
    "caregiver": [
        "నేను వాళ్ళ అబ్బాయిని, మా నాన్న పడుకున్నారు",  # I'm his son, father is resting
        "ఆయనకి కొంచెం ఆయాసంగా ఉంది",               # he's a bit breathless
        "అవును, కాళ్ళు కూడా వాచాయి",               # yes, legs swollen too
        "లేదు, ఇంకేమీ లేదు",                       # nothing else
    ],
}
TURNS = SCENARIOS.get(os.getenv("SIM_SCENARIO", "fine"), SCENARIOS["fine"])

_outbox = bytearray()
_state = {"bot_pcm": bytearray(), "last_audio": 0.0}
_SIL20 = audioop.lin2ulaw(b"\x00\x00" * 160, 2)   # 20ms of 8k silence, mu-law


def tts_mulaw(text):
    """Sarvam TTS -> 8kHz mu-law bytes."""
    body = json.dumps({"text": text, "target_language_code": "te-IN", "speaker": "anushka",
                       "model": "bulbul:v2", "speech_sample_rate": 8000}).encode()
    req = urllib.request.Request("https://api.sarvam.ai/text-to-speech", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "api-subscription-key": KEY})
    obj = json.loads(urllib.request.urlopen(req, timeout=30).read())
    wav = base64.b64decode(obj["audios"][0])
    w = wave.open(io.BytesIO(wav))
    pcm = w.readframes(w.getnframes())
    if w.getframerate() != 8000:
        pcm, _ = audioop.ratecv(pcm, 2, 1, w.getframerate(), 8000, None)
    return audioop.lin2ulaw(pcm, 2)


async def _sender(ws):
    """Continuously stream 20ms frames (real telephony never goes silent): utterance if queued, else silence."""
    try:
        while True:
            if len(_outbox) >= 160:
                chunk = bytes(_outbox[:160]); del _outbox[:160]
            else:
                chunk = _SIL20
            await ws.send(json.dumps({"event": "media", "media": {"payload": base64.b64encode(chunk).decode()}}))
            await asyncio.sleep(0.02)
    except Exception:
        _state["closed"] = True          # server hung up (goodbye) - expected


async def _receiver(ws):
    try:
        async for msg in ws:
            try:
                d = json.loads(msg)
            except Exception:
                continue
            if d.get("event") == "playAudio":
                _state["bot_pcm"] += audioop.ulaw2lin(base64.b64decode(d["media"]["payload"]), 2)
                _state["last_audio"] = time.monotonic()
    except Exception:
        _state["closed"] = True


async def speak(text):
    _outbox.extend(tts_mulaw(text))
    await asyncio.sleep(len(_outbox) / 8000 + 0.05)   # wait until it has played out (real-time)


async def wait_new_audio(before_len, stop_t, timeout=10):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if len(_state["bot_pcm"]) > before_len + 640:   # >~40ms of new audio = real reply, not a stray frame
            return round(time.monotonic() - stop_t, 2)
        await asyncio.sleep(0.02)
    return None


async def wait_quiet(quiet=1.2, timeout=15):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if _state["last_audio"] and time.monotonic() - _state["last_audio"] > quiet:
            return
        await asyncio.sleep(0.1)


async def main():
    async with websockets.connect(WS_URL, max_size=None) as ws:
        await ws.send(json.dumps({"event": "start", "start": {"streamId": "sim-stream", "callId": "sim-call"}}))
        await ws.send(json.dumps({"event": "media", "media": {"payload": ""}}))   # sacrificial 2nd msg for parse
        rt = asyncio.create_task(_receiver(ws))
        st = asyncio.create_task(_sender(ws))

        await asyncio.sleep(0.5)
        await wait_quiet(quiet=1.2, timeout=20)          # greeting + first question
        print(f"[greeting+Q1 played: {len(_state['bot_pcm'])/2/8000:.1f}s of bot audio]")

        for i, turn in enumerate(TURNS, 1):
            await speak(turn)
            stop_t = time.monotonic()
            before = len(_state["bot_pcm"])
            lat = await wait_new_audio(before, stop_t, timeout=12)
            await wait_quiet(quiet=1.2, timeout=15)
            reply_s = (len(_state["bot_pcm"]) - before) / 2 / 8000
            print(f"[turn {i}] said {turn[:22]!r:26} -> reply_latency={lat}s  reply_audio={reply_s:.1f}s")

        await asyncio.sleep(0.8)
        st.cancel(); rt.cancel()
        await ws.close()

    with wave.open(os.path.join(HERE, "calls", "sim-bot-audio.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); w.writeframes(bytes(_state["bot_pcm"]))
    print(f"\n[bot audio saved: pcbot/calls/sim-bot-audio.wav, {len(_state['bot_pcm'])/2/8000:.1f}s]")

    path = os.path.join(HERE, "calls", "simcall.json")
    for _ in range(20):      # finalize runs an extraction HTTP call, so poll for the transcript
        if os.path.exists(path):
            break
        await asyncio.sleep(1)
    try:
        rec = json.load(open(path))
        print("\n=== TRANSCRIPT ===")
        for who, txt in rec.get("transcript", []):
            print(f"  {who}: {txt}")
        print("\n=== EXTRACTED ===")
        print(json.dumps(rec.get("extracted", {}), ensure_ascii=False, indent=2))
        print("durationMs:", rec.get("durationMs"))
    except Exception as e:
        print("no transcript file yet:", e)


if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "calls"), exist_ok=True)
    try:
        os.remove(os.path.join(HERE, "calls", "simcall.json"))   # avoid reading a stale prior run
    except FileNotFoundError:
        pass
    print(f"[scenario: {os.getenv('SIM_SCENARIO', 'fine')}]")
    asyncio.run(main())
