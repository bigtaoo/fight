import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { slimGlb } from './build/slimGlb.mjs';

// The 3D trial as a WeChat mini-game: one IIFE at wechat/js/game.js (required by wechat/game.js),
// the scenery beside it in the main package and the models in a pack of their own, 'models'.
// Open client/wechat in WeChat DevTools after `npm run build:wechat3d`.

const ENGINE = fileURLToPath(new URL('../engine', import.meta.url));
const at = (p) => fileURLToPath(new URL(p, import.meta.url));

// A mini-game reads files from its package by path, so they are copied next to the bundle.
const copyAssets = {
  name: 'copy-assets',
  closeBundle() {
    rmSync(at('./wechat/art'), { recursive: true, force: true });
    cpSync(at('./public/art/bg'), at('./wechat/art/bg'), { recursive: true });
    const models = at('./wechat/models');
    rmSync(models, { recursive: true, force: true });
    mkdirSync(models, { recursive: true });
    slimGlb(at('../art/model3d/sword/rig_v1.glb'), `${models}/hero.glb`, 'hero.jpg');
    slimGlb(at('../art/archer3d/model/anim_idle.glb'), `${models}/archer.glb`, 'archer.jpg');
    for (const clip of ['walk', 'hit', 'fall']) slimGlb(at(`../art/archer3d/model/anim_${clip}.glb`), `${models}/${clip}.glb`);
    writeFileSync(`${models}/game.js`, '// models: a pack, loaded by wx.loadSubpackage\n');
    console.log('  copied the scenery and slimmed the models into wechat/');
  },
};

// The web build's models (three/webModels.ts) would be inlined whole; this build packs its own.
const noWebModels = {
  name: 'no-web-models',
  enforce: 'pre',
  resolveId: (source) => (source === './webModels' ? '\0web-models' : null),
  load: (id) => (id === '\0web-models' ? 'export const WEB_FILES = null;' : null),
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
