import { screenCanvas, wxLog } from './three/wechatShim';
import { runProto } from './three/proto';

// The 3D trial as a WeChat mini-game (client/wechat, built by `npm run build:wechat3d`): the
// engine's bot plays the trial dungeon over and over, and the frame rate is logged to the console
// once a second and kept in `${USER_DATA_PATH}/three-report.json`, so a run in DevTools can be
// read from disk and one on a phone from vConsole.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const wx: any;

const errors: string[] = [];
wx.onError?.((e: any) => errors.push(String(e?.message ?? e).slice(0, 300)));
const fps: number[] = [];
const report: Record<string, unknown> = { errors, fps };

function save(): void {
  try {
    wx.getFileSystemManager().writeFileSync(`${wx.env.USER_DATA_PATH}/three-report.json`, JSON.stringify(report, null, 2), 'utf8');
  } catch (err) {
    console.warn('[three] report not written', err);
  }
}

async function main(): Promise<void> {
  const screen = screenCanvas();
  // a sharper picture costs fill rate; 2 is what the web build caps at too
  const pixelRatio = Math.min(screen.pixelRatio, 2);
  const device = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
  report.device = { platform: device.platform, model: device.model, system: device.system, benchmarkLevel: device.benchmarkLevel };
  report.baseLibrary = (wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).SDKVersion;
  report.screen = { width: screen.width, height: screen.height, devicePixelRatio: screen.pixelRatio, pixelRatio };

  const context = screen.canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  report.webgl2 = !!context;
  if (!context) {
    save();
    throw new Error('no WebGL2 context');
  }
  const dbg = context.getExtension('WEBGL_debug_renderer_info');
  report.gpu = {
    version: context.getParameter(context.VERSION),
    renderer: context.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : context.RENDERER),
    maxTexture: context.getParameter(context.MAX_TEXTURE_SIZE),
    samples: context.getParameter(context.SAMPLES),
  };
  console.info('[three] boot', JSON.stringify(report));
  wxLog('boot', report);
  save();

  // the models are a pack of their own (the main package is capped at 4 MB)
  await new Promise((resolve, reject) => wx.loadSubpackage({ name: 'models', success: resolve, fail: reject }));
  const fs = wx.getFileSystemManager();
  const read = (url: string) => Promise.resolve(fs.readFileSync(url) as ArrayBuffer);
  const started = Date.now();
  const none = { get: () => null, has: () => false } as unknown as URLSearchParams;
  await runProto(none, {
    canvas: screen.canvas,
    context,
    width: screen.width,
    height: screen.height,
    pixelRatio,
    scenery: 'art/bg/',
    models: {
      hero: 'models/hero.glb',
      clips: { idle: 'models/archer.glb', walk: 'models/walk.glb', hit: 'models/hit.glb', fall: 'models/fall.glb' },
      read,
    },
    onStats: (s) => {
      fps.push(Math.round(s.fps));
      if (fps.length > 120) fps.shift();
      report.last = { ...s, fps: Math.round(s.fps * 10) / 10, worstMs: Math.round(s.worstMs) };
      console.info(`[three] ${s.fps.toFixed(1)} fps, worst ${s.worstMs.toFixed(0)} ms, ${s.draws} draws, ${s.triangles} tris`);
      save();
      wxLog('stats', report.last);
    },
  });
  report.loadMs = Date.now() - started;
  wxLog('loaded', { loadMs: report.loadMs });
  save();
}

main().catch((err) => {
  report.error = String(err?.stack ?? err);
  console.error('[three] failed', err);
  wxLog('failed', report.error);
  save();
});
