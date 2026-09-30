"""tools/sfx.py — synthesize an ambient / sound-design track from a JSON cue sheet (numpy + scipy).

    python tools/sfx.py cues.json out.wav

cues.json:
{
  "duration": 8, "sr": 48000, "reverb": {"mix": 0.45, "decay": 1.9}, "fade_out": 0.6, "peak_db": -1,
  "cues": [
    {"type": "whoosh",    "start": 0.0, "end": 1.2, "f0": 200, "f1": 1300, "gain": 0.5},
    {"type": "tink",      "at": 1.2, "freq": 2637, "gain": 0.12, "pan": 0.25},
    {"type": "drone",     "start": 0.8, "end": 8, "freqs": [55, 55.4, 82.4, 110.2], "gain": 0.22, "attack": 1.5},
    {"type": "bed",       "start": 1.0, "end": 8, "cutoff": 500, "gain": 0.35},
    {"type": "heartbeat", "start": 1.2, "end": 8, "period": 0.9, "gain": 0.9},
    {"type": "riser",     "start": 4.6, "end": 6.15, "f0": 300, "f1": 2400, "gain": 0.35},
    {"type": "glide",     "start": 4.6, "end": 6.3, "f0": 110, "f1": 220, "gain": 0.08},
    {"type": "boom",      "at": 6.15, "freq": 38, "gain": 0.9},
    {"type": "bell",      "at": 6.15, "notes": [440, 659.3, 987.8, 1318.5, 1760], "gain": 0.05},
    {"type": "tick",      "at": 3.0, "gain": 0.3},
    {"type": "file",      "src": "narration.wav", "start": 0.5, "gain": 1.0}
  ]
}
Every cue takes optional "gain" and "pan" (-1 left … 1 right). Times are seconds. Keep visual beats (e.g. a
heartbeat function in scenes.js) and cue times from the same numbers so picture and sound stay in sync.
"""
import json, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

def main(cue_path, out_path):
    spec = json.load(open(cue_path, encoding='utf-8'))
    SR = int(spec.get('sr', 48000)); DUR = float(spec['duration']); N = int(SR * DUR); t = np.arange(N) / SR
    rng = np.random.default_rng(spec.get('seed', 7)); noise = rng.standard_normal(N)
    L = np.zeros(N); R = np.zeros(N)
    lp = lambda x, f, o=2: signal.sosfilt(signal.butter(o, f, 'low', fs=SR, output='sos'), x)
    bp = lambda x, f1, f2, o=2: signal.sosfilt(signal.butter(o, [max(20, f1), min(SR / 2 - 100, f2)], 'band', fs=SR, output='sos'), x)
    def add(x, c):
        nonlocal L, R
        pan, g = c.get('pan', 0.0), c.get('gain', 1.0)
        L += x * g * np.sqrt((1 - pan) / 2) * 1.414; R += x * g * np.sqrt((1 + pan) / 2) * 1.414
    def window(a, b, attack=.05, release=.3):
        return np.clip((t - a) / max(attack, 1e-3), 0, 1) * np.clip((b + release - t) / max(release, 1e-3), 0, 1) * (t >= a)
    def sweep_band(a, b, f0, f1, width, steps=30):
        out = np.zeros(N); edges = np.linspace(a, b, steps + 1)
        for i in range(steps):
            f = f0 * (f1 / f0) ** (i / (steps - 1)); s = bp(noise, f, f * width); m = (t >= edges[i]) & (t < edges[i + 1]); out[m] = s[m]
            if i == steps - 1: out[t >= edges[-1]] = s[t >= edges[-1]]
        return out
    def brown(seed):
        x = np.cumsum(np.random.default_rng(seed).standard_normal(N)); x -= lp(x, 3); return x / (np.abs(x).max() + 1e-9)
    def thump(at, f0, dec):
        x = t - at; m = x >= 0; y = np.zeros(N)
        y[m] = np.sin(2 * np.pi * (f0 * x[m] - f0 * .35 * (1 - np.exp(-x[m] * 20)) / 20)) * np.exp(-x[m] * dec) * np.clip(x[m] / .004, 0, 1)
        return y

    for c in spec['cues']:
        k = c['type']
        if k == 'drone':
            fs = c.get('freqs', [55, 55.4, 82.4, 110.2]); x = sum(np.sin(2 * np.pi * f * t + i) / (1 + i * .6) for i, f in enumerate(fs))
            lfo = .85 + .15 * np.sin(2 * np.pi * c.get('lfo', .21) * t)
            add(lp(x, c.get('cutoff', 400)) * window(c['start'], c['end'], c.get('attack', 1.5), c.get('release', .5)) * lfo, c)
        elif k == 'bed':
            e = window(c['start'], c['end'], c.get('attack', 1.2), c.get('release', .5)) * (.7 + .3 * np.sin(2 * np.pi * .13 * t))
            add(lp(brown(1), c.get('cutoff', 500)) * e, {**c, 'pan': -.5}); add(lp(brown(2), c.get('cutoff', 500)) * e, {**c, 'pan': .5})
        elif k == 'whoosh':
            add(sweep_band(c['start'], c['end'], c.get('f0', 200), c.get('f1', 1300), 2.2) * window(c['start'], c['end'], (c['end'] - c['start']) * .5, .45), c)
        elif k == 'riser':
            x = sweep_band(c['start'], c['end'], c.get('f0', 300), c.get('f1', 2400), 1.6)
            add(x * np.clip((t - c['start']) / (c['end'] - c['start']), 0, 1) ** 2 * (t < c['end']), c)
        elif k == 'glide':
            m = (t >= c['start']) & (t < c['end']); x = np.zeros(N); d = c['end'] - c['start']
            f = c['f0'] * (c['f1'] / c['f0']) ** ((t[m] - c['start']) / d)
            x[m] = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.clip((t[m] - c['start']) / (d * .7), 0, 1) * np.clip((c['end'] - t[m]) / .15, 0, 1); add(x, c)
        elif k == 'heartbeat':
            x = np.zeros(N); a = c['start']
            while a < min(c['end'], DUR): x += thump(a, c.get('freq', 58), 16) + .6 * thump(a + .23, c.get('freq', 58) * .86, 20); a += c.get('period', .9)
            add(lp(x, 180), c)
        elif k == 'boom':
            x = t - c['at']; m = x >= 0; y = np.zeros(N); f = c.get('freq', 38)
            y[m] = np.sin(2 * np.pi * (f * x[m] + f * .3 * (1 - np.exp(-x[m] * 8)) / 8)) * np.exp(-x[m] * c.get('decay', 2.2)); add(y, c)
        elif k in ('bell', 'tink'):
            notes = c.get('notes', [c.get('freq', 2637)]) if k == 'bell' else [c.get('freq', 2637) * r for r in (1, 1.5, 2.0, 2.5)]
            x = t - c['at']; m = x >= 0; y = np.zeros(N)
            for i, f in enumerate(notes):
                a = 1 / (1 + i * .5)
                for det in ((-.7, .7) if k == 'bell' else (0,)):
                    y[m] += a * np.sin(2 * np.pi * (f + det) * x[m]) * np.exp(-x[m] * ((1.2 + f / 2000) if k == 'bell' else (5 + i * 2))) * np.clip(x[m] / .01, 0, 1)
            add(y, c)
        elif k == 'tick':
            x = t - c['at']; m = x >= 0; y = np.zeros(N); y[m] = bp(noise, 2000, 6000)[m] * np.exp(-x[m] * 60); add(y, c)
        elif k == 'file':
            sr2, d = wavfile.read(c['src']); d = d.astype(np.float64); d /= (np.abs(d).max() + 1e-9)
            if d.ndim == 1: d = np.stack([d, d], 1)
            if sr2 != SR: d = signal.resample_poly(d, SR, sr2, axis=0)
            i0 = int(c.get('start', 0) * SR); n = max(0, min(len(d), N - i0)); g = c.get('gain', 1.0)
            L[i0:i0 + n] += d[:n, 0] * g; R[i0:i0 + n] += d[:n, 1] * g
        else:
            print('unknown cue type', k)

    rv = spec.get('reverb', {'mix': .45, 'decay': 1.9})
    if rv and rv.get('mix', 0) > 0:
        def verb(x, seed):
            n = int(SR * (rv.get('decay', 1.9) + .3)); it = np.arange(n) / SR
            ir = lp(np.random.default_rng(seed).standard_normal(n) * np.exp(-it * 6.9 / rv.get('decay', 1.9) / 2), 5000); ir /= np.sqrt((ir ** 2).sum())
            return signal.fftconvolve(x, ir)[:N]
        L, R = L * .8 + verb(L, 1) * rv['mix'], R * .8 + verb(R, 2) * rv['mix']
    fade = np.clip(t / .05, 0, 1) * np.clip((DUR - t) / spec.get('fade_out', .6), 0, 1)
    st = np.stack([L * fade, R * fade], 1); st = signal.sosfilt(signal.butter(2, 25, 'high', fs=SR, output='sos'), st, axis=0)
    st *= 10 ** (spec.get('peak_db', -1) / 20) / (np.abs(st).max() + 1e-9)
    wavfile.write(out_path, SR, (st * 32767).astype(np.int16)); print('wrote', out_path, f'{DUR:.2f}s')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
