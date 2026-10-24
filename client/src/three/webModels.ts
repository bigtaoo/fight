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
};
const pick = typeof location === 'undefined' || typeof URLSearchParams === 'undefined' ? null : new URLSearchParams(location.search).get('hero');

/** The ink villagers' bodies as they were, by the ink body's name: their pictures, for the
 * villagers drawn turning to ink at the start of 1-1 (the meshes and UVs are the same). */
export const COLOUR_OF: Record<string, string> = { inkfisher: RIGS.fisher, inkwasher: RIGS.washer, inkboatman: RIGS.boatman, inkwood: RIGS.wood };

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
  },
  // bodies' own move clips (art/model3d/moves.py)
  moves: {
    hero: new URL('../../../art/model3d/moves/swordsman.glb', import.meta.url).href,
    inkwood: new URL('../../../art/model3d/moves/woodcutter.glb', import.meta.url).href,
  },
};
