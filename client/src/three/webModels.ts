import type { ModelFiles } from './actor';

// The models as the web build serves them: Tripo's own files, straight from art/. Kept apart so
// the WeChat build can leave them out (vite.wechat3d.config.js), as it packs slimmed copies.

export const WEB_FILES: ModelFiles = {
  hero: new URL('../../../art/hero3d/model/rig_v1.glb', import.meta.url).href,
  clips: {
    idle: new URL('../../../art/archer3d/model/anim_idle.glb', import.meta.url).href,
    walk: new URL('../../../art/archer3d/model/anim_walk.glb', import.meta.url).href,
    hit: new URL('../../../art/archer3d/model/anim_hit.glb', import.meta.url).href,
    fall: new URL('../../../art/archer3d/model/anim_fall.glb', import.meta.url).href,
  },
};
