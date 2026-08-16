"""FastAPI service on the RunPod GPU: Plivo Audio Streaming <-> IndicConformer <-> Gemini slot-extract <->
FollowCare engine (HTTP) <-> Parler-TTS <-> Plivo. No clinical reasoning here; no Plivo AI Agent.

Lifecycle (spec §11-15): the pod is resumed by Cloudflare only when there are calls. On boot this service loads
the models, pulls its queue from FollowCare, originates the calls (bounded concurrency), runs each as a
CallSession over the Plivo WebSocket, and when the queue drains + goes idle it stops its OWN pod.

Heavy deps (fastapi, plivo audio, torch, parler, gemini) are imported lazily / used only here so the tested
core (app.call.*, app.audio.*, app.followcare.client) never depends on them.
"""
import asyncio
import os
import time

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import Response, JSONResponse

from .config import Config
from .followcare.client import FollowCareClient
from .nlu.gemini import SlotExtractor
from .stt.indicconformer import IndicConformerSTT
from .tts.parler import ParlerTTS
from .telephony.plivo_provider import PlivoController, PlivoStreamTelephony
from .call.session import CallSession
from .gpu import RunPodController

cfg = Config()
app = FastAPI(title="StewardMD FollowCare Voice", version="0.2.0")

client = FollowCareClient(cfg)
# Slot extraction runs on the SHARED Cloudflare Gemini transport (Vertex AI primary, AI Studio GEMINI_API_KEY
# fallback) — one integration, no Google creds on this box. Set VOICE_NLU_DIRECT=1 to use a local Gemini key.
nlu = SlotExtractor(cfg) if os.environ.get("VOICE_NLU_DIRECT") == "1" else SlotExtractor(cfg, model_call=client.nlu)
stt = IndicConformerSTT(cfg)
tts = ParlerTTS(cfg)
plivo = PlivoController(cfg)
runpod = RunPodController(cfg)

STATE = {"ready": False, "calls": {}, "last_activity": time.time()}


@app.on_event("startup")
async def _startup():
    # Load models as a BACKGROUND task so uvicorn serves /healthz immediately (ready:false while loading),
    # instead of blocking startup for the multi-GB model download — otherwise the box looks dead while it's fine.
    async def _boot():
        def _load():
            try:
                stt.load(); tts.load(); STATE["ready"] = True
            except Exception as e:  # a model failing to load must not wedge the box; health surfaces the error
                STATE["ready"] = False
                STATE["load_error"] = str(e)
        await asyncio.get_event_loop().run_in_executor(None, _load)
        asyncio.create_task(_campaign())
    asyncio.create_task(_boot())


@app.get("/healthz")
async def healthz():
    return {"ok": True, "ready": STATE["ready"], "loading": (not STATE["ready"] and "load_error" not in STATE),
            "load_error": STATE.get("load_error"),
            "active": sum(1 for c in STATE["calls"].values() if c["state"] == "active"),
            "followcare": cfg.followcare_configured(), "telephony": cfg.telephony_configured()}


# Debug/force: show what THIS pod sees from the queue, and manually originate any fresh calls (bypasses the
# auto-poll loop). Lets us confirm the pod can reach + auth Cloudflare, and force a dial on demand.
@app.post("/drain")
async def drain():
    try:
        q = client.get_queue()
    except Exception as e:
        return {"error": "get_queue_failed", "detail": str(e), "base": cfg.followcare_base}
    out = {"ready": STATE["ready"], "queue_count": len(q), "originated": []}
    for c in q:
        cid = c.get("callId")
        if cid in STATE["calls"]:
            continue
        STATE["calls"][cid] = {"call": c, "state": "originated", "ts": time.time()}
        client.post_status(cid, {"status": "ringing"})
        ok = await asyncio.get_event_loop().run_in_executor(None, plivo.originate, c.get("phone"), cid)
        out["originated"].append({"callId": cid, "phone": c.get("phone"), "plivo_ok": ok})
        if not ok:
            STATE["calls"][cid]["state"] = "done"
    return out


@app.post("/plivo/answer")
async def plivo_answer(request: Request):
    call_id = request.query_params.get("callId", "")
    return Response(content=plivo.answer_xml(call_id), media_type="application/xml")


@app.post("/plivo/hangup")
async def plivo_hangup(request: Request):
    call_id = request.query_params.get("callId", "")
    rec = STATE["calls"].get(call_id)
    if rec and rec["state"] == "originated":     # answered==False path: Plivo hung up before the WS opened
        rec["state"] = "done"
        client.post_result({"episodeId": rec["call"].get("episodeId"), "callId": call_id, "answers": {}, "status": "no_answer", "durationMs": 0})
    return JSONResponse({"ok": True})


@app.websocket("/plivo/stream/{call_id}")
async def plivo_stream(ws: WebSocket, call_id: str):
    await ws.accept()
    rec = STATE["calls"].get(call_id)
    if not rec:
        await ws.close()
        return
    rec["state"] = "active"
    STATE["last_activity"] = time.time()
    telephony = PlivoStreamTelephony(ws, cfg)
    session = CallSession(rec["call"], stt, tts, telephony, nlu, client, cfg)
    try:
        await session.run()
    except Exception:
        client.post_result({"episodeId": rec["call"].get("episodeId"), "callId": call_id, "answers": {}, "status": "technical_failure", "durationMs": 0})
    finally:
        rec["state"] = "done"
        STATE["last_activity"] = time.time()


async def _campaign():
    """POLL the queue while warm: originate any new calls (bounded concurrency), and self-stop the GPU only
    after it's been idle (no active calls, none queued) for idle_shutdown_s. Polling means it doesn't matter
    whether a call is queued before or shortly after the pod boots — it picks it up either way."""
    while not STATE["ready"]:
        await asyncio.sleep(1)
    if not cfg.followcare_configured():
        return

    sem = asyncio.Semaphore(cfg.max_concurrent)

    async def _launch(call):
        async with sem:
            cid = call.get("callId")
            STATE["calls"][cid] = {"call": call, "state": "originated", "ts": time.time()}
            client.post_status(cid, {"status": "ringing"})
            ok = await asyncio.get_event_loop().run_in_executor(None, plivo.originate, call.get("phone"), cid)
            if not ok:
                STATE["calls"][cid]["state"] = "done"
                client.post_result({"episodeId": call.get("episodeId"), "callId": cid, "answers": {}, "status": "technical_failure", "durationMs": 0})
            STATE["last_activity"] = time.time()

    last_work = time.time()
    connect_timeout = cfg.no_answer_timeout_s
    while True:
        try:
            queue = client.get_queue()
        except Exception:
            queue = []
        fresh = [c for c in queue if c.get("callId") not in STATE["calls"]]  # dedup: don't redial an in-flight call
        for c in fresh:
            last_work = time.time()
            asyncio.create_task(_launch(c))

        now = time.time()
        for cid, rec in STATE["calls"].items():
            if rec["state"] == "originated" and (now - rec["ts"]) > connect_timeout:
                rec["state"] = "done"    # never connected → no answer
                client.post_result({"episodeId": rec["call"].get("episodeId"), "callId": cid, "answers": {}, "status": "no_answer", "durationMs": 0})
        active = any(r["state"] in ("originated", "active") for r in STATE["calls"].values())
        if active:
            last_work = now
        if not active and (now - last_work) > cfg.idle_shutdown_s:
            break
        await asyncio.sleep(5)

    runpod.stop_self()
