"""Makes the hero's image-to-video clips (art/heroes/sprite2d/<name>_video.mp4, prompt in
<name>_video.txt) on the free Hugging Face Space running Wan 2.2 image-to-video. Clips already
made are skipped; the Space's anonymous quota is small, so run a few at a time.

usage: PYTHONIOENCODING=utf-8 python tools/sprite2d_clips.py [name ...]   (no names: all)
Frames are then cut out of each clip with tools/sprite2d_video.py.
"""
import os
import shutil
import sys
from pathlib import Path

from gradio_client import Client, handle_file

DIR = Path(__file__).resolve().parent.parent / 'art' / 'heroes' / 'sprite2d'
SPACE = 'zerogpu-aoti/wan2-2-fp8da-aoti-faster'
NEG = ('色调艳丽, 过曝, 静态, 细节模糊不清, 字幕, 静止, 最差质量, 低质量, 畸形的, 三条腿, 多余的手臂, '
       '两把剑, 镜头转动, 镜头推拉, 背景变化, 场景切换')
# every clip: one figure seen from the side, the camera keeping him in the middle of the empty paper
# (the engine moves the body; the paintings only pose it)
TAIL = (' Seen exactly from the side, facing left. The camera holds still and keeps him in the centre '
        'of the frame at the same size; the plain off-white paper background stays empty and still. '
        'His robe and the torn red hem strips flow with the motion. Ink-wash painting style, '
        'consistent character, one sword.')

# name: (start painting, seconds, prompt)
JOBS: dict[str, tuple[str, float, str]] = {
    'run': ('run_1', 3.0,
            'The swordsman runs fast to the left in long low strides, leaning forward, the sword held '
            'back low in his right hand; his legs alternate and pass each other with every stride.'),
    'combo': ('base', 3.5,
              'The swordsman steps forward and strikes three quick sword slashes in a row to the left: '
              'a horizontal cut, a backhand cut, then a big overhead downward chop, and returns to his '
              'stance.'),
    'thrust': ('base', 2.5,
               'The swordsman lunges forward to the left in one swift dash and thrusts the sword straight '
               'out in front of him at chest height, arm fully extended, then draws back to his stance.'),
    'rising': ('base', 2.5,
               'The swordsman crouches low then sweeps the sword upward in a rising arc from the ground '
               'to high over his head, rising up on his toes, then settles back into his stance.'),
    'spin': ('base', 2.5,
             'The swordsman spins forward to the left with a flurry of fast whirling sword cuts, the '
             'blade sweeping round him in circles.'),
    'smash': ('base', 2.5,
              'The swordsman raises the sword high above his head with both hands and smashes it down '
              'hard onto the ground in front of him, crouching low with the impact.'),
    'iai': ('iai_1', 2.5,
            'The swordsman crouches still with his hand on the sheathed sword, then in a single flash '
            'draws and cuts horizontally far to the left, ending with the blade extended, perfectly '
            'still.'),
    'flurry': ('base', 3.5,
               'The swordsman stands his ground and slashes extremely fast many times in a row in front '
               'of him to the left, the blade blurring, then ends with one huge wide sweeping slash.'),
    'backstep': ('base', 2.0,
                 'The swordsman leaps backward to the right in a light hop, both feet off the ground, '
                 'robe flaring, and lands softly back in his stance.'),
    'aerial': ('jump_1', 2.5,
               'The swordsman in mid-air slashes the sword downward in front of him, then plunges '
               'straight down with the blade pointing at the ground.'),
    'jump': ('base', 2.0,
             'The swordsman bends his knees and jumps straight up high, tucking his legs, then comes '
             'down and lands.'),
    'hurt': ('base', 2.0,
             'The swordsman is struck from the front and recoils backward to the right, flinching, '
             'then recovers his stance.'),
    'down': ('hurt_1', 3.5,
             'The swordsman is knocked off his feet, falls backward onto the ground and lies flat, then '
             'pushes himself up and stands again.'),
    # the same moves again from the side-view stance (side.png), so the body stays in profile: the
    # stance three-quarters to the camera (base) left the clips facing the viewer or turning round
    'side_combo': ('side', 3.5,
                   'The swordsman steps forward and strikes three quick sword slashes in a row to the left: '
                   'a horizontal cut, a backhand cut, then a big overhead downward chop, and returns to his '
                   'stance.' + ' He stays in profile facing left the whole time; every cut goes to the left, '
                   'in front of him, and he never turns towards the viewer or away.'),
    'side_smash': ('side', 2.5,
                   'The swordsman raises the sword high above his head with both hands and smashes it down '
                   'hard onto the ground in front of him to the left, crouching low with the impact.'
                   ' He stays in profile facing left the whole time and never turns towards the viewer or away.'),
    'side_rising': ('side', 2.5,
                    'The swordsman crouches low then sweeps the sword upward in a rising arc in front of him '
                    'to the left, from the ground to high over his head, rising up on his toes, then settles '
                    'back into his stance. He stays in profile facing left the whole time and never turns '
                    'towards the viewer or away.'),
    'side_spin': ('side', 2.5,
                  'The swordsman spins forward to the left with a flurry of fast whirling sword cuts, the '
                  'blade sweeping round him in circles, and ends in profile facing left.'),
}


def main() -> None:
    want = sys.argv[1:] or list(JOBS)
    # a Hugging Face account's token (HF_TOKEN) gets its daily GPU quota instead of the anonymous one
    client = Client(SPACE, token=os.environ.get('HF_TOKEN') or None, verbose=False)
    for name in want:
        src, secs, prompt = JOBS[name]
        out = DIR / f'{name}_video.mp4'
        if out.exists():
            print(name, 'exists')
            continue
        full = prompt + TAIL
        print(name, 'from', src, '...', flush=True)
        video, seed = client.predict(handle_file(str(DIR / f'{src}.png')), full, 6, NEG, secs, 1, 1, 42, True,
                                     api_name='/generate_video')
        path = video['video'] if isinstance(video, dict) else video
        shutil.copy(path, out)
        (DIR / f'{name}_video.txt').write_text(
            f'Image-to-video from {src}.png on the Hugging Face Space {SPACE} (Wan 2.2 I2V, 6 steps, '
            f'{secs} s, guidance 1/1, seed {int(seed)}).\nPrompt: {full}\nNegative: {NEG}\n', encoding='utf-8')
        print(name, 'saved, seed', int(seed), flush=True)


if __name__ == '__main__':
    main()
