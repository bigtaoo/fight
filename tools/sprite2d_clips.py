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
# for a start image with the figure against the right edge: the empty paper on the left is for the
# blade, so the camera must not re-centre him
ROOM_TAIL = (' Seen exactly from the side, facing left. The camera is locked and does not move or follow him: '
             'he stays on the right side of the frame at the same size, the empty paper on the left leaves room '
             'for the sword, and the plain off-white paper background stays empty and still. His robe and the '
             'torn red hem strips flow with the motion. Ink-wash painting style, consistent character, one sword.')

# name: (start painting, seconds, prompt[, tail, extra negative]) -- a job may swap the shared tail
# and add negatives (side_hurt2 keeps the sword out of the words so the model does not read a cut)
JOBS: dict[str, tuple] = {
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
    # the moves still missing, from the side stance too; base's backstep barely moved and its hurt
    # swung the sword instead, so these spell the body's change out (feet off the ground, no cut)
    'side_flurry': ('side', 3.5,
                    'The swordsman plants his feet and slashes extremely fast many times in a row in front of '
                    'him to the left, short cuts up and down, the blade blurring, then ends with one huge wide '
                    'horizontal slash to the left. He stays in profile facing left the whole time.'),
    'side_backstep': ('side', 2.0,
                      'The swordsman pushes off and hops backward to the right: both feet leave the ground, his '
                      'knees bend, his body stays low and still faces left, the robe flares forward, then he '
                      'lands on both feet and sinks back into his stance. He does not swing the sword.'),
    'side_jump': ('side', 2.0,
                  'The swordsman bends his knees deep and jumps straight up high: both feet leave the ground '
                  'and his legs tuck up under him, the robe and red strips lifting, then he falls and lands '
                  'in a crouch. He does not swing the sword and stays in profile facing left.'),
    'side_aerial': ('side', 2.5,
                    'The swordsman leaps up off the ground, both feet tucked, and in mid-air swings the sword '
                    'down in a big arc in front of him to the left, then drops and lands in a crouch with the '
                    'blade low. He stays in profile facing left.'),
    'side_hurt': ('side', 2.0,
                  'The swordsman is hit hard in the chest from the left: his head and shoulders snap back, '
                  'his body bends backward, he staggers one step back to the right with the sword arm thrown '
                  'out to the side, then he catches himself and stands in his stance again. He does not '
                  'attack and stays in profile facing left.'),
    'side_down': ('side', 3.5,
                  'The swordsman is knocked off his feet by a blow from the left: he flies backward, falls '
                  'flat on his back on the ground to the right, lies there a moment, then rolls up onto one '
                  'knee and stands. He does not attack.'),
    # the stance is side.png now, so the walk starts from it too: the old walk (from walk_1) turns
    # the chest a little to the camera and blends into the stance on stopping
    'side_walk': ('side', 3.5,
                  'The swordsman walks calmly and steadily to the left with a natural walking gait, the sword '
                  'held out in front of him in his guard; his legs alternate and pass each other with every '
                  'step. He stays in profile facing left the whole time and never turns towards the viewer.'),
    # side_hurt came out as a sword swing twice (from base and from side): "a swordsman is hit" reads
    # as an attack, so this one names only the body, drops "one sword" from the tail and bans cuts
    'side_hurt2': ('side', 2.0,
                   'The man is hit by an invisible blow from the left: his head and chest jerk backward, his '
                   'back arches, his arms stay where they are, he is pushed half a step back to the right and '
                   'sways, then slowly settles back into the same crouched pose as at the start. He stays in '
                   'profile facing left the whole time.',
                   TAIL.replace(' Ink-wash painting style, consistent character, one sword.',
                                ' Ink-wash painting style, consistent character.'),
                   ', 挥剑, 挥砍, 出招, 攻击, 刀光, 转身'),
    # the thrust and the iai draw were made from base (three-quarter) and face the camera; these
    # redo them from the side stance
    'side_thrust': ('side', 2.5,
                    'The swordsman lunges forward to the left in one swift dash, his front knee bending deep, '
                    'and thrusts the sword straight out in front of him to the left at chest height, the arm '
                    'and blade fully extended in one line, then draws back into his stance. He stays in '
                    'profile facing left the whole time and never turns towards the viewer.',
                    TAIL, ', 转身, 正面, 面向镜头'),
    'side_iai': ('side', 2.5,
                 'The swordsman sheathes his sword at his left hip and crouches very low and still, his right '
                 'hand on the hilt; then in a single flash he draws and cuts horizontally far out in front of '
                 'him to the left, ending low with the blade extended to the left, perfectly still. He stays '
                 'in profile facing left the whole time and never turns towards the viewer.',
                 TAIL, ', 转身, 正面, 面向镜头'),
    # both came out in profile but the blade ran off the frame's left edge; again from side_room.png
    # (the stance at 0.75 against the right edge, cut back up by 1/0.75), the camera not centring him
    'side_thrust2': ('side_room', 2.5,
                     'The swordsman lunges forward to the left in one swift dash, his front knee bending deep, '
                     'and thrusts the sword straight out in front of him to the left at chest height, the arm '
                     'and the whole long blade fully extended in one line, then draws back into his stance. He '
                     'stays in profile facing left the whole time and never turns towards the viewer.',
                     ROOM_TAIL, ', 转身, 正面, 面向镜头, 剑出画面'),
    'side_iai2': ('side_room', 2.5,
                  'The swordsman crouches very low and still with his right hand on the hilt at his left hip; '
                  'then in a single flash he draws and cuts horizontally far out in front of him to the left, '
                  'ending low with the whole long blade extended to the left, perfectly still. He stays in '
                  'profile facing left the whole time, his chest turned away from the viewer.',
                  ROOM_TAIL, ', 转身, 正面, 面向镜头, 剑出画面'),
}


def main() -> None:
    want = sys.argv[1:] or list(JOBS)
    # a Hugging Face account's token (HF_TOKEN) gets its daily GPU quota instead of the anonymous one
    client = Client(SPACE, token=os.environ.get('HF_TOKEN') or None, verbose=False)
    for name in want:
        src, secs, prompt, *extra = JOBS[name]
        tail = extra[0] if extra else TAIL
        neg = NEG + (extra[1] if len(extra) > 1 else '')
        out = DIR / f'{name}_video.mp4'
        if out.exists():
            print(name, 'exists')
            continue
        full = prompt + tail
        print(name, 'from', src, '...', flush=True)
        video, seed = client.predict(handle_file(str(DIR / f'{src}.png')), full, 6, neg, secs, 1, 1, 42, True,
                                     api_name='/generate_video')
        path = video['video'] if isinstance(video, dict) else video
        shutil.copy(path, out)
        (DIR / f'{name}_video.txt').write_text(
            f'Image-to-video from {src}.png on the Hugging Face Space {SPACE} (Wan 2.2 I2V, 6 steps, '
            f'{secs} s, guidance 1/1, seed {int(seed)}).\nPrompt: {full}\nNegative: {neg}\n', encoding='utf-8')
        print(name, 'saved, seed', int(seed), flush=True)


if __name__ == '__main__':
    main()
