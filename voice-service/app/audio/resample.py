"""Dependency-free PCM helpers (no numpy). Linear resampling is fine for 8 kHz telephony speech; the GPU
providers prefer torchaudio.resample when torch is present and fall back to these otherwise."""


def pcm16_to_float(pcm):
    out = []
    for i in range(0, len(pcm) - 1, 2):
        out.append(int.from_bytes(pcm[i:i + 2], "little", signed=True) / 32768.0)
    return out


def float_to_pcm16(samples):
    b = bytearray()
    for s in samples:
        v = int(max(-1.0, min(1.0, s)) * 32767)
        b += int(v).to_bytes(2, "little", signed=True)
    return bytes(b)


def resample_linear(samples, src_hz, dst_hz):
    if src_hz == dst_hz or not samples:
        return list(samples)
    samples = list(samples)
    ratio = dst_hz / float(src_hz)
    n_out = int(len(samples) * ratio)
    # DOWNSAMPLING: average each output sample over its full input window. This is a cheap low-pass
    # (anti-alias) filter — plain linear interpolation only reads 2 of the ~src/dst input samples and
    # aliases everything above the new Nyquist into "underwater/robotic" garble.
    if dst_hz < src_hz:
        win = src_hz / float(dst_hz)
        out = [0.0] * n_out
        for i in range(n_out):
            a = int(i * win)
            b = int((i + 1) * win)
            if b <= a:
                b = a + 1
            if b > len(samples):
                b = len(samples)
            seg = samples[a:b]
            out[i] = sum(seg) / len(seg) if seg else 0.0
        return out
    # UPSAMPLING (no aliasing): linear interpolation.
    out = [0.0] * n_out
    for i in range(n_out):
        pos = i / ratio
        j = int(pos)
        frac = pos - j
        if j + 1 < len(samples):
            out[i] = samples[j] * (1 - frac) + samples[j + 1] * frac
        else:
            out[i] = samples[-1]
    return out
