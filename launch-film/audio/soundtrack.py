"""StewardMD launch film: sound design, synthesized and deterministic (no samples, no licences).

    python3 launch-film/audio/soundtrack.py      # -> launch-film/audio/soundtrack.wav (48 kHz stereo, 30.000 s)

Layers, all cued to the film's master cue sheet (film/lib.js F.T) and section-local timings:
  * score    warm pad chords that change with each capability, plus a soft 8th-note pluck
             arpeggio from the first capability to the finale for momentum
  * heartbeat two low "lub-dub" thumps under the opening mark pulses
  * whooshes filtered-noise sweeps on every device move / section handoff
  * UI foley  taps (short clicks) on every on-screen tap, glassy "lift" chimes when a UI card lifts,
              a two-tone soft alert when the qSOFA alert lifts, a haptic double-tick on Code Blue
  * finale   riser into the convergence, sub impact + shimmer, and a bell chord on the end line
Requires numpy + scipy. Seeded, so every run writes the identical file.
"""
import os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(20260923)
HERE = os.path.dirname(os.path.abspath(__file__))

# Master cue sheet (seconds), identical to film/lib.js F.T
T = dict(open=0.0, reason=3.0, steward=7.6, maik=12.2, icu=16.8, watch=21.4, finale=25.4, end=30.0)

L = np.zeros(N)
R = np.zeros(N)


def t_arr(n):
    return np.arange(n) / SR


def add(sig, at, gain=1.0, pan=0.0):
    """Mix a mono signal in at time `at` (s) with equal-power pan (-1 left .. 1 right)."""
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    a = (pan + 1) * np.pi / 4
    L[i:i + len(sig)] += sig * gain * np.cos(a)
    R[i:i + len(sig)] += sig * gain * np.sin(a)


def env(n, a, d, s_level=1.0, r=None):
    """Attack / decay-to-sustain / release envelope over n samples (times in s)."""
    e = np.ones(n) * s_level
    na, nd = int(a * SR), int(d * SR)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na, endpoint=False) if na else e[:na]
    if nd and na < n:
        m = min(nd, n - na)
        e[na:na + m] = np.linspace(1, s_level, m)
    if r:
        nr = min(int(r * SR), n)
        e[n - nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- score: pads
def pad(notes, dur, gain=0.06, bright=1800):
    n = int(dur * SR)
    t = t_arr(n)
    s = np.zeros(n)
    for m in notes:
        f = midi(m)
        for det in (-0.07, 0.0, 0.07):  # detuned saw-ish (few harmonics) for warmth
            ph = rng.uniform(0, 2 * np.pi)
            for h in range(1, 7):
                s += np.sin(2 * np.pi * f * (1 + det / 12) * h * t + ph * h) / (h ** 1.35)
    s = lp(s, bright)
    s *= env(n, min(1.2, dur * 0.35), 0.1, 1.0, r=min(1.4, dur * 0.4))
    return s / max(1e-9, np.max(np.abs(s))) * gain


# (start, end, notes, gain, brightness): D major colour, following the capabilities
CHORDS = [
    (0.0, 3.4, [38, 50, 57, 61, 64], 0.050, 1100),        # Dmaj9 (sparse) under the mark
    (3.0, 8.0, [47, 54, 57, 61, 62], 0.060, 1700),        # Bm9: reasoning
    (7.6, 12.6, [43, 50, 54, 57, 62], 0.062, 1900),       # Gmaj7: stewardship
    (12.2, 17.2, [40, 52, 55, 59, 62, 66], 0.060, 2600),  # Em9, airy: MaiK
    (16.8, 21.8, [47, 54, 59, 62, 66], 0.064, 1600),      # Bm: ICU tension
    (21.4, 25.6, [42, 54, 57, 61, 64], 0.064, 1800),      # F#m7: on the wrist
    (25.4, 30.0, [38, 50, 57, 62, 64, 66, 69], 0.058, 2200),  # Dmaj9 full: platform
]
for a, b, notes, g, br in CHORDS:
    add(pad(notes, b - a, g * 1.7, br), a, 1.0, 0.0)

# Sub bed that swells into the finale
n = int(4.6 * SR)
sub = np.sin(2 * np.pi * midi(26) * t_arr(n)) * env(n, 0.05, 0.3, 0.6, r=2.4)
add(sub, T["finale"], 0.16)

# ---------------------------------------------------------------- score: pluck arpeggio
def pluck(f, dur=0.5, gain=0.05, tone=3000):
    n = int(dur * SR)
    t = t_arr(n)
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t))
    s *= np.exp(-t * 7.5)
    s[: int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    return lp(s, tone) * gain


ARP = {  # chord tones per capability window
    "reason": [59, 62, 66, 69], "steward": [55, 59, 62, 66], "maik": [64, 67, 71, 74],
    "icu": [59, 62, 66, 71], "watch": [57, 61, 64, 66],
}
step = 60 / 112 / 2  # 8ths at 112 bpm
for key, nxt in (("reason", "steward"), ("steward", "maik"), ("maik", "icu"), ("icu", "watch"), ("watch", "finale")):
    t0, t1 = T[key], T[nxt]
    k = 0
    tt = t0
    while tt < t1 - 0.05:
        notes = ARP[key]
        m = notes[[0, 2, 1, 3, 2, 1, 3, 2][k % 8]]
        vel = 0.030 if k % 2 else 0.042
        fade_in = min(1.0, (tt - T["reason"]) / 1.2)  # arrives gently
        add(pluck(midi(m), 0.45, vel * fade_in * 1.5), tt, 1.0, [-0.35, 0.35][k % 2])
        tt += step
        k += 1

# ---------------------------------------------------------------- heartbeat (opening)
def thump(f0=62, dur=0.35, gain=0.5):
    n = int(dur * SR)
    t = t_arr(n)
    f = f0 * (1 + 1.4 * np.exp(-t * 30))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 11) * gain


for at in (0.26, 0.60):
    add(thump(60, 0.4, 0.26), at)
    add(thump(52, 0.4, 0.17), at + 0.16)

# ---------------------------------------------------------------- whooshes
def whoosh(dur=0.7, lo=300, hi=5000, gain=0.12, rise=True):
    n = int(dur * SR)
    t = t_arr(n)
    x = rng.standard_normal(n)
    # sweep a band-pass centre across the whoosh by crossfading 12 fixed bands
    out = np.zeros(n)
    bands = np.geomspace(lo, hi, 12)
    pos = np.linspace(0, 1, n) if rise else np.linspace(1, 0, n)
    for i, c in enumerate(bands):
        w = np.exp(-((pos * 11 - i) ** 2) / 1.6)
        out += bp(x, c / 1.4, min(c * 1.4, SR / 2 - 100)) * w
    shape = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.6
    return out * shape * gain / (np.max(np.abs(out)) + 1e-9) * 3


for at, dur, g, pan in [
    (2.15, 0.8, 0.10, 0.0),                 # identity lifts, phone rises
    (T["reason"] + 0.40, 0.5, 0.05, 0.2),   # push to Dx
    (T["reason"] + 2.30, 0.45, 0.045, 0.2), # push to differential
    (T["steward"] - 0.05, 0.5, 0.05, 0.2),  # push to stewardship
    (T["steward"] + 1.95, 0.9, 0.09, 0.6),  # iPad slides in
    (T["maik"] - 0.55, 1.0, 0.11, 0.5),     # swing across to MaiK
    (T["icu"] - 0.55, 1.0, 0.11, -0.5),     # swing back to ICU
    (T["watch"] - 0.55, 0.9, 0.10, -0.6),   # phone drops away
    (T["watch"] + 0.05, 0.9, 0.08, 0.0),    # watch rises
]:
    add(whoosh(dur, gain=g), at, 1.0, pan)

# ---------------------------------------------------------------- UI foley
def tap_click(gain=0.14):
    n = int(0.06 * SR)
    t = t_arr(n)
    s = np.sin(2 * np.pi * 2300 * t) * np.exp(-t * 160) + 0.5 * hp(rng.standard_normal(n), 3500) * np.exp(-t * 260)
    return s * gain


def lift_chime(base=76, gain=0.05):
    n = int(1.4 * SR)
    t = t_arr(n)
    s = np.zeros(n)
    for m, a in ((base, 1.0), (base + 7, 0.55), (base + 12, 0.3)):
        f = midi(m)
        s += a * (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 9))
    s *= np.exp(-t * 3.2)
    s[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return s * gain


# taps: (section start + local time) from the section files
for at in [T["reason"] + 0.20, T["reason"] + 1.20, T["reason"] + 2.20, T["reason"] + 4.36]:
    add(tap_click(), at, 1.0, -0.3)
# lifted UI cards
for at, base, pan in [
    (T["reason"] + 1.50, 78, -0.1), (T["reason"] + 2.95, 81, -0.1),
    (T["steward"] + 0.75, 79, -0.1),
    (T["maik"] + 0.75, 83, 0.2), (T["maik"] + 2.05, 81, 0.2),
    (T["icu"] + 0.70, 78, -0.1), (T["icu"] + 2.35, 76, -0.1),
]:
    add(lift_chime(base), at, 1.0, pan)
# qSOFA alert: soft two-tone
for k, m in enumerate((81, 76)):
    n = int(0.35 * SR); t = t_arr(n)
    tone = np.sin(2 * np.pi * midi(m) * t) * env(n, 0.01, 0.05, 0.8, r=0.2) * 0.045
    add(tone, T["icu"] + 2.95 + k * 0.16, 1.0, -0.1)
# Watch arrives + Code Blue haptic double-tick with a low thump
add(lift_chime(74, 0.05), T["watch"] + 0.7, 1.0, -0.2)
for k in range(2):
    n = int(0.05 * SR); t = t_arr(n)
    add(np.sin(2 * np.pi * 170 * t) * np.exp(-t * 90) * 0.35, T["watch"] + 2.0 + k * 0.1, 1.0, -0.2)
add(thump(55, 0.4, 0.3), T["watch"] + 2.05)

# ---------------------------------------------------------------- finale
# riser (noise + rising tone) into the convergence
n = int(1.9 * SR); t = t_arr(n)
rise = hp(rng.standard_normal(n), 1500) * (t / t[-1]) ** 2.2 * 0.05
f = np.linspace(midi(50), midi(62), n)
rise += np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / t[-1]) ** 2 * 0.03
add(rise, T["finale"] - 1.9)
# impact: sub drop + soft noise burst + shimmer
add(thump(48, 1.6, 0.34), T["finale"])
n = int(1.2 * SR); t = t_arr(n)
add(lp(rng.standard_normal(n), 2500) * np.exp(-t * 5) * 0.08, T["finale"])
n = int(2.5 * SR); t = t_arr(n)
shim = sum(np.sin(2 * np.pi * midi(m) * t + rng.uniform(0, 6)) for m in (86, 90, 93, 98)) * np.exp(-t * 1.6) * 0.012
add(shim, T["finale"] + 0.05, 1.0, 0.3)
# end line: bell chord (D add9) with long tail
n = int(2.2 * SR); t = t_arr(n)
bell = np.zeros(n)
for m, a in ((62, 1.0), (66, 0.7), (69, 0.6), (74, 0.45), (76, 0.35)):
    fr = midi(m)
    bell += a * (np.sin(2 * np.pi * fr * t) + 0.25 * np.sin(2 * np.pi * fr * 3.01 * t) * np.exp(-t * 4))
bell *= np.exp(-t * 1.4) * 0.035
bell[: int(0.005 * SR)] *= np.linspace(0, 1, int(0.005 * SR))
add(bell, T["finale"] + 2.55)
add(whoosh(1.0, 200, 3000, 0.06, rise=False), T["finale"] + 2.2)

# ---------------------------------------------------------------- mix bus
def reverb(x, secs=2.2, mix=0.22):
    n = int(secs * SR)
    t = t_arr(n)
    ir = rng.standard_normal(n) * np.exp(-t * 3.2)
    ir = lp(ir, 6000)
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = fftconvolve(x, ir)[: len(x)]
    return x * (1 - mix) + wet * mix * 1.4


L = reverb(L)
R = reverb(R)
L = hp(L, 28)
R = hp(R, 28)
stereo = np.stack([L, R], axis=1)
peak = np.max(np.abs(stereo))
stereo = np.tanh(stereo / peak * 1.6) / np.tanh(1.6)    # gentle saturation / limiting
stereo *= 10 ** (-3.0 / 20)                               # ~-16 LUFS integrated, -3 dBFS peak
fade = int(0.8 * SR)
stereo[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
stereo[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
out = os.path.join(HERE, "soundtrack.wav")
wavfile.write(out, SR, (stereo * 32767).astype(np.int16))
print("wrote", out, f"{len(stereo) / SR:.3f}s", f"peak {np.max(np.abs(stereo)):.3f}")
