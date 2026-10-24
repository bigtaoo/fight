import type { ModelFiles } from './actor';

// The models as the web build serves them: Tripo's own files, straight from art/. Kept apart so
// the WeChat build can leave them out (vite.wechat3d.config.js), as it packs slimmed copies.

/** Chapter-one bodies rigged by art/model3d/rig.py: the swordsman is the hero, ?hero=<name> tries
 * another. */
const RIGS: Record<string, string> = {
  sword: new URL('../../../art/model3d/sword/rig_v1.glb', import.meta.url).href,
  lion: new URL('../../../art/model3d/lion/rig_v1.glb', import.meta.url).href,
  modou: new URL('../../../art/model3d/modou/rig_v1.glb', import.meta.url).href,
  fisher: new URL('../../../art/model3d/fisher/rig_v1.glb', import.meta.url).href,
  wood: new URL('../../../art/model3d/wood/rig_v1.glb', import.meta.url).href,
  washer: new URL('../../../art/model3d/washer/rig_v1.glb', import.meta.url).href,
  inklion: new URL('../../../art/model3d/inklion/rig_v1.glb', import.meta.url).href,
  boatman: new URL('../../../art/model3d/boatman/rig_v1.glb', import.meta.url).href,
  oldman: new URL('../../../art/model3d/oldman/rig_v1.glb', import.meta.url).href,
  peddler: new URL('../../../art/model3d/peddler/rig_v1.glb', import.meta.url).href,
  monk: new URL('../../../art/model3d/monk/rig_v1.glb', import.meta.url).href,
  inkmonk: new URL('../../../art/model3d/inkmonk/rig_v1.glb', import.meta.url).href,
  child: new URL('../../../art/model3d/child/rig_v1.glb', import.meta.url).href,
  painter: new URL('../../../art/model3d/painter/rig_v1.glb', import.meta.url).href,
};
const query = typeof location === 'undefined' || typeof URLSearchParams === 'undefined' ? null : new URLSearchParams(location.search);
const pick = query?.get('hero');

/** Beasts on skeletons of their own (art/model3d/bird.py) not yet in a section: ?beast=<name>
 * loads one and draws every monster as it. */
const BEASTS: Record<string, string> = {
  buffalo: new URL('../../../art/model3d/buffalo/rig_v1.glb', import.meta.url).href,
  lioness: new URL('../../../art/model3d/lioness/rig_v1.glb', import.meta.url).href,
  inklioness: new URL('../../../art/model3d/inklioness/rig_v1.glb', import.meta.url).href,
  cub: new URL('../../../art/model3d/cub/rig_v1.glb', import.meta.url).href,
  inkcub: new URL('../../../art/model3d/inkcub/rig_v1.glb', import.meta.url).href,
  seal: new URL('../../../art/model3d/seal/rig_v1.glb', import.meta.url).href,
  inkseal: new URL('../../../art/model3d/inkseal/rig_v1.glb', import.meta.url).href,
};
const beast = query?.get('beast');

/** The ink villagers' bodies as they were, by the ink body's name: their pictures, for the
 * villagers drawn turning to ink at the start of 1-1 (the meshes and UVs are the same). */
export const COLOUR_OF: Record<string, string> = {
  inkfisher: RIGS.fisher,
  inkwasher: RIGS.washer,
  inkboatman: RIGS.boatman,
  inkwood: RIGS.wood,
  inkoldman: RIGS.oldman,
  inkpeddler: RIGS.peddler,
  inkbuffalo: BEASTS.buffalo,
};

export const WEB_FILES: ModelFiles = {
  hero: (pick && RIGS[pick]) || RIGS.sword,
  clips: {
    idle: new URL('../../../art/archer3d/model/anim_idle.glb', import.meta.url).href,
    walk: new URL('../../../art/archer3d/model/anim_walk.glb', import.meta.url).href,
    hit: new URL('../../../art/archer3d/model/anim_hit.glb', import.meta.url).href,
    fall: new URL('../../../art/archer3d/model/anim_fall.glb', import.meta.url).href,
  },
  // chapter one's villagers washed in ink (art/model3d/ink.py), for its monsters
  bodies: {
    inkfisher: new URL('../../../art/model3d/inkfisher/rig_v1.glb', import.meta.url).href,
    inkwasher: new URL('../../../art/model3d/inkwasher/rig_v1.glb', import.meta.url).href,
    inkboatman: new URL('../../../art/model3d/inkboatman/rig_v1.glb', import.meta.url).href,
    inkwood: new URL('../../../art/model3d/inkwood/rig_v1.glb', import.meta.url).href,
    inkoldman: new URL('../../../art/model3d/inkoldman/rig_v1.glb', import.meta.url).href,
    inkpeddler: new URL('../../../art/model3d/inkpeddler/rig_v1.glb', import.meta.url).href,
    // a figure of the scenery (figures.ts), not a monster
    child: RIGS.child,
  },
  // the birds and beasts, on skeletons of their own (art/model3d/bird.py): the buffalo and the crane
  // are figures of the scenery (figures.ts)
  birds: {
    finch: new URL('../../../art/model3d/finch/rig_v1.glb', import.meta.url).href,
    bigfinch: new URL('../../../art/model3d/bigfinch/rig_v1.glb', import.meta.url).href,
    pheasant: new URL('../../../art/model3d/pheasant/rig_v1.glb', import.meta.url).href,
    inkbuffalo: new URL('../../../art/model3d/inkbuffalo/rig_v1.glb', import.meta.url).href,
    crane: new URL('../../../art/model3d/crane/rig_v1.glb', import.meta.url).href,
    ...(beast && BEASTS[beast] ? { [beast]: BEASTS[beast] } : {}),
  },
  // bodies' own move clips (art/model3d/moves.py)
  moves: {
    hero: new URL('../../../art/model3d/moves/swordsman.glb', import.meta.url).href,
    inkwood: new URL('../../../art/model3d/moves/woodcutter.glb', import.meta.url).href,
  },
  // the ink villagers' own clips, by kind (art/model3d/moves.py), on whichever ink body draws them
  kinds: {
    inkling: new URL('../../../art/model3d/moves/inkling.glb', import.meta.url).href,
    brute: new URL('../../../art/model3d/moves/brute.glb', import.meta.url).href,
    fisher: new URL('../../../art/model3d/moves/fisher.glb', import.meta.url).href,
    washer: new URL('../../../art/model3d/moves/washer.glb', import.meta.url).href,
  },
};
