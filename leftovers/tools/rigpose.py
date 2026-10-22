"""Pose helpers shared by the rigs' anims.py scripts (art/rig_*/anims.py).

Poses are written as absolute limb directions, not bone rotations, because that is how a pose
is thought about ("sword straight up") and it keeps a key valid when its parent changes.
A direction is in degrees from straight down, positive toward the facing side (+x): 0 hangs
down, 90 points forward, 180 points up, -90 points back. Rig.pose() turns them into the
clockwise bone rotations pack_tao.py wants.

Every rig has the same limb bones (arm_f_upper / arm_f_lower / hand_f / a weapon in the front
hand, arm_b_upper / arm_b_lower, leg_f_thigh / leg_f_shin, leg_b_thigh / leg_b_shin, torso,
head, robe); `weapon` names the weapon bone (sword, shield, bow) and `extras` the rig's other
bones that keys may turn (the hero's sash and scarf). A rig with `spine` has its trunk in two,
torso (the waist, from the hips) and chest: a key's torso is then the chest's direction, the
waist taking `spine` of it unless the key gives its own `waist`, so the back bends in a curve.
A rig with `panels` has its robe in two, robe (the back panel) and robe_f (the front): on top of
a key's robe swing the front panel follows the leading thigh forward and the back one the
trailing thigh back, by the two factors, so a stepping knee carries the cloth with it.
"""
import math


class Rig:
    def __init__(self, rest, thigh, shin, extras=(), weapon="sword", spine=None, panels=None):
        """rest: limb directions of the rest pose (the painting), measured from the split's
        pivots. thigh, shin: leg lengths in painting pixels, hip pivot to knee pivot and knee
        pivot to sole."""
        self.rest, self.thigh, self.shin, self.extras = rest, thigh, shin, tuple(extras)
        self.weapon = weapon
        self.spine = spine
        self.panels = panels

    def planted(self, lf, lb):
        """Root drop that keeps the lower foot on the ground for these leg directions."""
        def drop(d):
            return self.thigh * (1 - math.cos(math.radians(d[0]))) + self.shin * (1 - math.cos(math.radians(d[1])))
        return round(min(drop(lf), drop(lb)), 1)

    def chain(self, names, dirs, base=0.0):
        """Bone rotations that point each bone of a parent -> child chain along `dirs`; `base`
        is the rotation the chain's parent already has."""
        out, acc = {}, base
        for n, d in zip(names, dirs):
            if d is None:
                continue
            r = self.rest[n] - d - acc
            out[n] = round(r, 1)
            acc += r
        return out

    def pose(self, torso=4, head=-2, af=(25, 55, 75), ab=(-10, 8), lf=(6, 3), lb=(-6, -5),
             root=None, body=0, robe=0, hand_f=0, plant=True, waist=None, **extra):
        """One key. af: front arm (upper, forearm, weapon); ab: back arm (upper, forearm);
        lf/lb: front/back leg (thigh, shin); body: torso and robe pushed down (a breath, a
        crouch); extra: rotations of the rig's extra bones. With plant, root=(x, dy) is added to
        the drop that keeps the feet on the ground (so a wide stance sinks instead of floating);
        without it root is used as given (airborne, kneeling)."""
        unknown = set(extra) - set(self.extras)
        if unknown:
            raise ValueError(f"no such bones: {sorted(unknown)}")
        root = root or (0, 0)
        if plant:
            root = root[0], round(self.planted(lf, lb) + root[1], 1)
        rot = {"torso": torso, "head": head, "robe": robe}
        if self.spine is not None:
            w = torso * self.spine if waist is None else waist
            rot["torso"], rot["chest"] = round(w, 1), round(torso - w, 1)
        translate = {"root": list(root), "torso": [0, body], "robe": [0, body]}
        if self.panels:
            kf, kb = self.panels
            rot["robe_f"] = round(robe - kf * max(0, lf[0], lb[0]), 1)
            rot["robe"] = round(robe + kb * max(0, -min(lf[0], lb[0])), 1)
            translate["robe_f"] = [0, body]
        rot.update({n: extra.get(n, 0) for n in self.extras})
        rot["hand_f"] = hand_f
        rot.update(self.chain(["arm_f_upper", "arm_f_lower"], af[:2], torso))
        acc = torso + rot["arm_f_upper"] + rot["arm_f_lower"] + hand_f
        rot[self.weapon] = round(self.rest[self.weapon] - af[2] - acc, 1)
        rot.update(self.chain(["arm_b_upper", "arm_b_lower"], ab, torso))
        rot.update(self.chain(["leg_f_thigh", "leg_f_shin"], lf))
        rot.update(self.chain(["leg_b_thigh", "leg_b_shin"], lb))
        return {"rotate": rot, "translate": translate}


def key(t, p, ease=None):
    k = {"t": t, **p}
    if ease:
        k["ease"] = ease
    return k


def loop(duration, keys, ease="ease-in-out", unit=None):
    a = {"duration": duration, "loop": True, "ease": ease, "keys": keys}
    if unit:
        a["unit"] = unit
    return a


def once(duration, keys, ease="linear"):
    """A clip in sim ticks, keyed to a move's frame data in engine/content.ts."""
    return {"duration": duration, "unit": "tick", "ease": ease, "keys": keys}
