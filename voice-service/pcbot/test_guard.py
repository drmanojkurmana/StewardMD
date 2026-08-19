"""Guard tests: run  pcbot/.venv/bin/python pcbot/test_guard.py  (from voice-service/)."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import guard
from guard import SpeechGuard, sanitize, FAREWELL
from pipecat.frames.frames import TextFrame, LLMFullResponseEndFrame
from pipecat.processors.frame_processor import FrameProcessor


def test_sanitize_strips_symbols():
    out = sanitize("హలో <b> _ x* (y) </tool_call>")
    for bad in "<>_*(){}[]":
        assert bad not in out, f"symbol {bad!r} leaked: {out!r}"
    assert "హలో" in out


def test_sanitize_keeps_token_spacing():
    # Streamed tokens: leading/trailing spaces MUST survive or words run together.
    assert sanitize(" ఎలా") == " ఎలా"
    assert sanitize("ఉన్నారు ") == "ఉన్నారు "


def test_sanitize_empty():
    assert sanitize("") is None


def test_farewell_detection():
    assert any(k in "త్వరగా కోలుకోండి, జాగ్రత్తగా ఉండండి, ఫోన్ పెడుతున్నాను." for k in FAREWELL)
    assert not any(k in "బరువు ఏమైనా పెరిగిందా అండీ?" for k in FAREWELL)


def test_guard_ends_on_goodbye():
    """Feed streamed goodbye tokens + response-end; the guard must call task.stop_when_done exactly once."""
    async def run():
        calls = {"stop": 0, "pushed": []}

        class FakeTask:
            async def stop_when_done(self):
                calls["stop"] += 1

        # Bypass the pipeline machinery: no-op the base setup and capture pushes.
        orig = FrameProcessor.process_frame
        async def noop(self, frame, direction):
            return
        FrameProcessor.process_frame = noop
        try:
            g = SpeechGuard()
            g.task = FakeTask()
            async def cap(frame, direction=None):
                calls["pushed"].append(getattr(frame, "text", frame.__class__.__name__))
            g.push_frame = cap

            for tok in ["జాగ్రత్తగా ", "ఉండండి, ", "ఫోన్ ", "పెడుతున్నాను."]:
                await g.process_frame(TextFrame(tok), None)
            await g.process_frame(LLMFullResponseEndFrame(), None)
        finally:
            FrameProcessor.process_frame = orig
        return calls

    calls = asyncio.run(run())
    assert calls["stop"] == 1, f"expected 1 hangup, got {calls['stop']}"
    # spacing preserved across the streamed goodbye
    assert "".join(t for t in calls["pushed"] if isinstance(t, str)).count(" ") >= 3


def test_guard_no_end_midcall():
    async def run():
        calls = {"stop": 0}

        class FakeTask:
            async def stop_when_done(self):
                calls["stop"] += 1

        orig = FrameProcessor.process_frame
        async def noop(self, frame, direction):
            return
        FrameProcessor.process_frame = noop
        try:
            g = SpeechGuard()
            g.task = FakeTask()
            async def cap(frame, direction=None):
                return
            g.push_frame = cap
            await g.process_frame(TextFrame("బరువు పెరిగిందా అండీ?"), None)
            await g.process_frame(LLMFullResponseEndFrame(), None)
        finally:
            FrameProcessor.process_frame = orig
        return calls

    assert asyncio.run(run())["stop"] == 0


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name); n += 1
    print(f"\n{n} tests passed")
