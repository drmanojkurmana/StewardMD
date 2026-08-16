"""G.711 mu-law codec + base64 framing for Plivo Audio Streaming.

Pure Python (Python 3.13+ removed the stdlib `audioop`), no numpy. Plivo streams 8 kHz audio as
base64 frames — mu-law (G.711u) or L16 (16-bit PCM). We convert to/from 16-bit PCM, which is what
IndicConformer STT consumes and Parler-TTS emits.
"""
import base64

_BIAS = 0x84
_CLIP = 32635
# exponent lookup for linear->mu-law (256 entries)
_EXP_LUT = (
    [0, 0, 1, 1] + [2] * 4 + [3] * 8 + [4] * 16 + [5] * 32 + [6] * 64 + [7] * 128
)


def linear_to_ulaw(sample):
    """One signed 16-bit PCM sample -> one mu-law byte (0..255)."""
    sign = 0
    if sample < 0:
        sample = -sample
        sign = 0x80
    if sample > _CLIP:
        sample = _CLIP
    sample += _BIAS
    exponent = _EXP_LUT[(sample >> 7) & 0xFF]
    mantissa = (sample >> (exponent + 3)) & 0x0F
    return (~(sign | (exponent << 4) | mantissa)) & 0xFF


def ulaw_to_linear(u):
    """One mu-law byte -> signed 16-bit PCM sample."""
    u = ~u & 0xFF
    sign = u & 0x80
    exponent = (u >> 4) & 0x07
    mantissa = u & 0x0F
    sample = (((mantissa << 3) + _BIAS) << exponent) - _BIAS
    return -sample if sign else sample


def pcm16_to_ulaw(pcm):
    """bytes of little-endian signed 16-bit PCM -> mu-law bytes."""
    out = bytearray(len(pcm) // 2)
    for i in range(0, len(pcm) - 1, 2):
        s = int.from_bytes(pcm[i:i + 2], "little", signed=True)
        out[i // 2] = linear_to_ulaw(s)
    return bytes(out)


def ulaw_to_pcm16(u):
    """mu-law bytes -> little-endian signed 16-bit PCM bytes."""
    out = bytearray(len(u) * 2)
    for i, b in enumerate(u):
        s = ulaw_to_linear(b)
        out[i * 2:i * 2 + 2] = int(s).to_bytes(2, "little", signed=True)
    return bytes(out)


def decode_frame(payload_b64, audio_format):
    """A Plivo stream frame (base64) -> 16-bit PCM bytes."""
    raw = base64.b64decode(payload_b64)
    if audio_format == "mulaw":
        return ulaw_to_pcm16(raw)
    return raw  # l16 is already PCM16


def encode_frame(pcm, audio_format):
    """16-bit PCM bytes -> base64 payload for a Plivo playback frame."""
    raw = pcm16_to_ulaw(pcm) if audio_format == "mulaw" else pcm
    return base64.b64encode(raw).decode("ascii")
