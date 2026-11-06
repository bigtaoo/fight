import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { colorOf, slimGlb } from './build/slimGlb.mjs';

// The 3D trial as a WeChat mini-game: one IIFE at wechat/js/game.js (required by wechat/game.js),
// the scenery beside it in the main package and the models in a pack of their own, 'models'.
// Open client/wechat in WeChat DevTools after `npm run build:wechat3d`.

const ENGINE = fileURLToPath(new URL('../engine', import.meta.url));
const at = (p) => fileURLToPath(new URL(p, import.meta.url));

/** The width of every colour map in the pack: a body is a few hundred pixels tall on a phone. */
const MAP = 1024;
/** Chapter one's ink villagers (already cut to the 5k triangles view.ts would cut them to, which
 * matters here: the mini-game has no WebAssembly for lod.ts to cut them with) and the birds, by the
 * names main.wechat3d.ts loads them by, with the scenery's child, buffalo and crane (figures.ts); the
 * villagers' and the buffalo's colour pictures (1-1 draws them turning to ink). */
const BODIES = ['inkfisher', 'inkwasher', 'inkboatman', 'inkwood', 'inkoldman', 'inkpeddler', 'child'];
const BIRDS = ['finch', 'bigfinch', 'pheasant', 'inkbuffalo', 'crane'];
const COLOURS = { inkfisher: 'fisher', inkwasher: 'washer', inkboatman: 'boatman', inkwood: 'wood', inkoldman: 'oldman', inkpeddler: 'peddler', inkbuffalo: 'buffalo' };
/** The ink villagers' own clips, by monster kind (art/model3d/moves.py). */
const KINDS = ['inkling', 'brute', 'fisher', 'washer'];

// A mini-game reads files from its package by path, so they are copied next to the bundle.
const copyAssets = {
  name: 'copy-assets',
  closeBundle() {
    rmSync(at('./wechat/art'), { recursive: true, force: true });
    cpSync(at('./public/art/bg'), at('./wechat/art/bg'), { recursive: true });
    cpSync(at('./public/art/props'), at('./wechat/art/props'), { recursive: true });
    cpSync(at('./public/art/scroll'), at('./wechat/art/scroll'), { recursive: true });
    const models = at('./wechat/models');
    rmSync(models, { recursive: true, force: true });
    mkdirSync(models, { recursive: true });
    slimGlb(at('../art/model3d/sword2/rig_v1.glb'), `${models}/hero.glb`, 'hero.jpg', MAP);
    slimGlb(at('../art/archer3d/model/anim_idle.glb'), `${models}/archer.glb`, 'archer.jpg', MAP);
    slimGlb(at('../art/model3d/moves/swordsman.glb'), `${models}/swordsman.glb`);
    slimGlb(at('../art/model3d/moves/woodcutter.glb'), `${models}/woodcutter.glb`);
    for (const kind of KINDS) slimGlb(at(`../art/model3d/moves/${kind}.glb`), `${models}/kind_${kind}.glb`);
    for (const name of [...BODIES, ...BIRDS]) slimGlb(at(`../art/model3d/${name}/rig_v1.glb`), `${models}/${name}.glb`, `${name}.jpg`, MAP);
    for (const [ink, name] of Object.entries(COLOURS)) colorOf(at(`../art/model3d/${name}/rig_v1.glb`), `${models}/${ink}_colour.jpg`, MAP);
    for (const clip of ['walk', 'hit', 'fall']) slimGlb(at(`../art/archer3d/model/anim_${clip}.glb`), `${models}/${clip}.glb`);
    writeFileSync(`${models}/game.js`, '// models: a pack, loaded by wx.loadSubpackage\n');
    console.log('  copied the scenery and the scroll, slimmed the models into wechat/');
  },
};

// The web build's models (three/webModels.ts) would be inlined whole; this build packs its own.
const noWebModels = {
  name: 'no-web-models',
  enforce: 'pre',
  resolveId: (source) => (source === './webModels' ? '\0web-models' : null),
  load: (id) => (id === '\0web-models' ? 'export const WEB_FILES = null; export const COLOUR_OF = {};' : null),
};

export default defineConfig(({ mode }) => ({
  plugins: [noWebModels, copyAssets],
  resolve: {
    alias: [
      { find: /^@dnf\/engine$/, replacement: `${ENGINE}/index.ts` },
      { find: /^@dnf\/engine\//, replacement: `${ENGINE}/` },
    ],
  },
  // a debug build can send its log to a server on this PC (main.wechat3d.ts, wechatShim.ts)
  define: { __WX_LOG__: JSON.stringify(process.env.WX_LOG ?? '') },
  publicDir: false,
  build: {
    // WeChat DevTools' package check rejects ?. and ?? (see D:\standing's vite.wechat.config.js)
    target: 'es2019',
    outDir: 'wechat/js',
    emptyOutDir: true,
    minify: mode !== 'development',
    assetsInlineLimit: 0,
    lib: { entry: at('./src/main.wechat3d.ts'), formats: ['iife'], name: 'Brushblade3D', fileName: () => 'game.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
}));
