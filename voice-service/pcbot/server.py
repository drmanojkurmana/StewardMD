"""FastAPI server: Plivo answer XML + outbound dial + the audio WebSocket that hands off to the Pipecat bot.

Flow:  POST /originate {phone,lang,disease,...}  -> stash call meta, dial via Plivo (answer_url -> /plivo/answer)
       Plivo answers -> GET/POST /plivo/answer?callId=  -> <Stream> XML pointing at  wss://<public>/ws/<callId>
       Plivo opens the WS -> /ws/{callId} -> run_bot(websocket, call_meta)

Run (from voice-service/, so `app.*` and the pcbot modules import):
    PYTHONPATH=.:pcbot pcbot/.venv/bin/uvicorn pcbot.server:app --host 0.0.0.0 --port 7860
"""
import base64
import json
import os
import urllib.request
import urllib.error

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import Response, JSONResponse

app = FastAPI()

# callId -> patient/call metadata {phone, lang, disease, dayOffset, episodeId}. In-memory is fine: one process,
# short-lived calls. (Cloudflare KV held this before; here the same process dials and answers.)
CALLS = {}

PUBLIC_BASE = os.getenv("VOICE_PUBLIC_BASE", "")          # e.g. https://xxxx.trycloudflare.com (the tunnel)
VOICE_TOKEN = os.getenv("FOLLOWCARE_VOICE_SERVICE_TOKEN", "")
PLIVO_ID = os.getenv("PLIVO_AUTH_ID", "")
PLIVO_TOKEN = os.getenv("PLIVO_AUTH_TOKEN", "")
PLIVO_FROM = os.getenv("PLIVO_FROM", "")


def _wss_base(request):
    base = PUBLIC_BASE or f"https://{request.headers.get('host', '')}"
    return base.replace("https://", "wss://").replace("http://", "ws://").rstrip("/")


def _answer_xml(wss_url):
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<Response><Stream bidirectional="true" keepCallAlive="true" '
            f'contentType="audio/x-mulaw;rate=8000">{wss_url}</Stream></Response>')


@app.get("/health")
async def health():
    return {"ok": True, "public_base": PUBLIC_BASE, "calls": len(CALLS)}


@app.api_route("/plivo/answer", methods=["GET", "POST"])
async def plivo_answer(request: Request):
    call_id = request.query_params.get("callId", "")
    xml = _answer_xml(f"{_wss_base(request)}/ws/{call_id}")
    return Response(content=xml, media_type="application/xml")


@app.post("/plivo/hangup")
async def plivo_hangup():
    return {"ok": True}


@app.post("/originate")
async def originate(request: Request):
    if request.headers.get("X-Voice-Token", "") != VOICE_TOKEN:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    call = {
        "callId": body.get("callId") or ("call-" + base64.urlsafe_b64encode(os.urandom(6)).decode().rstrip("=")),
        "phone": body.get("phone"), "lang": body.get("lang", "te"),
        "disease": body.get("disease"), "dayOffset": body.get("dayOffset", 1),
        "episodeId": body.get("episodeId"), "hospitalName": body.get("hospitalName") or body.get("hospital") or "",
    }
    CALLS[call["callId"]] = call
    if body.get("dryDial"):                        # skip real dialing (offline WS test)
        return {"callId": call["callId"], "prepared": True}
    base = PUBLIC_BASE or f"https://{request.headers.get('host', '')}"
    ok, detail = _plivo_dial(call["phone"], f"{base}/plivo/answer?callId={call['callId']}")
    return {"callId": call["callId"], "phone": call["phone"], "plivo_ok": ok, "detail": detail}


def _plivo_dial(to, answer_url):
    auth = base64.b64encode(f"{PLIVO_ID}:{PLIVO_TOKEN}".encode()).decode()
    payload = json.dumps({"from": PLIVO_FROM, "to": to, "answer_url": answer_url, "answer_method": "GET"}).encode()
    req = urllib.request.Request(
        f"https://api.plivo.com/v1/Account/{PLIVO_ID}/Call/", data=payload, method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Basic " + auth})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status in (200, 201, 202), resp.status
    except urllib.error.HTTPError as e:
        return False, f"{e.code}: {e.read().decode()[:200]}"
    except Exception as e:
        return False, str(e)[:200]


@app.websocket("/ws/{call_id}")
async def ws(websocket: WebSocket, call_id: str):
    from bot import run_bot                       # imported lazily so the server starts even before deps warm up
    call = CALLS.get(call_id, {"callId": call_id, "lang": "te"})
    await run_bot(websocket, call)
