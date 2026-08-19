"""SpeechGuard: sits between the LLM and TTS.

Two jobs:
  1) SANITIZE - never let symbols/markup reach the TTS. If a model ever emits tags or symbols like
     `<tool_call>`, `_`, `<`, `>`, `*`, the TTS would read them aloud as English ("underscore", "less than").
     We strip those characters so only real speech is spoken (and drop now-empty chunks -> no TTS 400).
  2) END THE CALL - when the nurse speaks her natural closing ("...ఫోన్ పెడుతున్నాను"), finish the call after
     the goodbye has played, via task.stop_when_done(). No fake function calls, no reliance on model tool-use.
"""
import re

from pipecat.frames.frames import TextFrame, LLMFullResponseEndFrame
from pipecat.processors.frame_processor import FrameProcessor

# Characters a TTS would vocalize as English symbol names - never speak these.
_SYMS = re.compile(r"[_*#`|\\/{}\[\]=~^<>()]+")
# Natural closing phrases the nurse uses -> hang up once spoken (Telugu + English).
FAREWELL = ("ఫోన్ పెడుత", "ఫోన్ పెట్ట", "కోరుకుంటున్నాను", "వీడ్కోలు", "సెలవు",
            "hanging up", "get well soon")


def sanitize(text):
    """Replace symbol runs with a space. Text arrives as STREAMED tokens, so NEVER strip - stripping would
    eat the spaces between words and run the whole reply together."""
    if not text:
        return None
    return _SYMS.sub(" ", text)


class SpeechGuard(FrameProcessor):
    def __init__(self):
        super().__init__()
        self._turn = ""          # raw assistant text of the current turn (for farewell detection)
        self.task = None         # set by bot.py after the PipelineTask is built

    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, TextFrame):
            self._turn += frame.text or ""
            cleaned = sanitize(frame.text)
            if cleaned is not None:
                frame.text = cleaned                 # keep spacing; symbol-only tokens become a space (harmless)
                await self.push_frame(frame, direction)
            return

        if isinstance(frame, LLMFullResponseEndFrame):
            if self.task and any(k in self._turn for k in FAREWELL):
                await self.task.stop_when_done()     # let the goodbye play out, then end -> Plivo hangs up
            self._turn = ""

        await self.push_frame(frame, direction)
