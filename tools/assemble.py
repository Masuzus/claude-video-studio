"""tools/assemble.py — cut the final film from an edit list (JSON) with ffmpeg.

    python tools/assemble.py edit.json

edit.json (paths relative to the JSON file):
{
  "out": "final.mp4", "size": [1920, 1080], "fps": 24,
  "transition": {"type": "fade", "dur": 0.5},          // "cut" (default) or "fade"/any ffmpeg xfade name, e.g. "fadeblack", "dissolve"
  "fade_in": 0.5, "fade_out": 1.0,                      // whole-film fades (video + audio)
  "clips": [
    {"src": "out/ch01_watercolor.mp4", "in": 0, "out": 12.5},
    {"src": "ai/painting_01.mp4"},                      // whole clip
    {"src": "stills/title.png", "dur": 3}               // still image held for dur seconds
  ],
  "clip_audio": false,                                  // keep the clips' own sound? (default false)
  "audio": [
    {"src": "audio/narration.wav", "start": 0.8, "gain": 1.0, "role": "voice"},
    {"src": "audio/music.mp3", "start": 0, "gain": 0.35, "role": "music"},
    {"src": "audio/sfx.wav", "start": 0, "gain": 0.8}
  ],
  "duck": true,                                         // lower music under the voice
  "subtitles": "subs.srt",
  "sub_style": "FontName=Noto Serif CJK SC,FontSize=20,PrimaryColour=&H00F4EEDC,OutlineColour=&H80000000,BorderStyle=1,Outline=1.2,Shadow=0,MarginV=36"
}
"""
import json, os, subprocess, sys

def probe_dur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True)
    return float(r.stdout.strip())

def main(edit_path):
    E = json.load(open(edit_path, encoding='utf-8')); base = os.path.dirname(os.path.abspath(edit_path))
    P = lambda p: p if os.path.isabs(p) else os.path.join(base, p)
    Wd, Ht = E.get('size', [1920, 1080]); fps = E.get('fps', 24)
    tr = E.get('transition', {'type': 'cut'}); td = tr.get('dur', .5) if tr.get('type', 'cut') != 'cut' else 0
    args, fc, vlabels, durs, clip_aud = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error'], [], [], [], []
    for i, c in enumerate(E['clips']):
        src = P(c['src']); still = src.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))
        if still:
            d = float(c.get('dur', 3)); args += ['-loop', '1', '-t', str(d), '-i', src]
        else:
            a = float(c.get('in', 0)); b = float(c['out']) if 'out' in c else probe_dur(src); d = b - a
            args += ['-ss', str(a), '-t', str(d), '-i', src]
        durs.append(d)
        fc.append(f'[{i}:v]scale={Wd}:{Ht}:force_original_aspect_ratio=decrease,pad={Wd}:{Ht}:(ow-iw)/2:(oh-ih)/2:color=black,'
                  f'fps={fps},format=yuv420p,setsar=1,settb=AVTB[v{i}]')
        vlabels.append(f'[v{i}]'); clip_aud.append(not still)
    n = len(vlabels)
    if td and n > 1:                                   # chained crossfades
        cur, t_acc = vlabels[0], durs[0]
        for i in range(1, n):
            off = t_acc - td; lab = f'[x{i}]'
            fc.append(f'{cur}{vlabels[i]}xfade=transition={tr.get("type", "fade")}:duration={td}:offset={off:.3f}{lab}')
            cur, t_acc = lab, t_acc + durs[i] - td
        total, vcur = t_acc, cur
    else:
        fc.append(''.join(vlabels) + f'concat=n={n}:v=1:a=0[vc]'); total, vcur = sum(durs), '[vc]'
    post = []
    if E.get('fade_in'): post.append(f'fade=t=in:st=0:d={E["fade_in"]}')
    if E.get('fade_out'): post.append(f'fade=t=out:st={total - E["fade_out"]:.3f}:d={E["fade_out"]}')
    if E.get('subtitles'):
        sp = P(E['subtitles']).replace('\\', '/').replace(':', '\\:')
        st = E.get('sub_style', 'FontName=Noto Serif CJK SC,FontSize=20,Outline=1.2,Shadow=0,MarginV=36')
        post.append(f"subtitles='{sp}':force_style='{st}'")
    fc.append(f'{vcur}{",".join(post) or "null"}[vout]')

    # audio
    alabels, voice, music, k = [], [], [], n
    if E.get('clip_audio'):
        t0 = 0.0
        for i in range(n):
            if clip_aud[i]:
                fc.append(f'[{i}:a]adelay={int(t0 * 1000)}:all=1,apad[ca{i}]'); alabels.append(f'[ca{i}]')
            t0 += durs[i] - td
    for j, a in enumerate(E.get('audio', [])):
        args += ['-i', P(a['src'])]
        lab = f'[a{j}]'; fc.append(f'[{k}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={int(a.get("start", 0) * 1000)}:all=1,volume={a.get("gain", 1.0)}{lab}')
        (voice if a.get('role') == 'voice' else music if a.get('role') == 'music' else alabels).append(lab); k += 1
    if E.get('duck', True) and voice and music:
        fc.append(f'{"".join(voice)}amix=inputs={len(voice)}:normalize=0,asplit=2[vox][vkey]')
        fc.append(f'{"".join(music)}amix=inputs={len(music)}:normalize=0[mus]')
        fc.append('[mus][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=30:release=500[mduck]')
        alabels += ['[vox]', '[mduck]']
    else:
        alabels += voice + music
    has_audio = bool(alabels)
    if has_audio:
        af = [f'atrim=0:{total:.3f}']
        if E.get('fade_in'): af.append(f'afade=t=in:st=0:d={E["fade_in"]}')
        if E.get('fade_out'): af.append(f'afade=t=out:st={total - E["fade_out"]:.3f}:d={E["fade_out"]}')
        fc.append(f'{"".join(alabels)}amix=inputs={len(alabels)}:normalize=0:duration=longest,{",".join(af)}[aout]')
    out = P(E.get('out', 'final.mp4'))
    args += ['-filter_complex', ';'.join(fc), '-map', '[vout]'] + (['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] if has_audio else [])
    args += ['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', f'{total:.3f}', out]
    subprocess.run(args, check=True)
    print(f'wrote {out}  ({total:.2f}s, {n} clips)')

if __name__ == '__main__':
    main(sys.argv[1])
