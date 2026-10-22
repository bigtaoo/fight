import { WORLD, fromFp, type Entity } from '@dnf/engine';
import { MeshoptSimplifier } from 'meshoptimizer';
import {
  AmbientLight,
  Bone,
  DirectionalLight,
  HemisphereLight,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { Actor, DEPTH_K, loadModels, type Model } from './actor';
import { meshOf, variant, type Variant } from './lod';
import { Post } from './post';
import { AIM_Y, DIST, FOV, PITCH, level } from './view';
import { Stage } from './stage';
import { WEB_FILES } from './webModels';

// What a body may cost (?budget, dev only): the hero's model rebuilt with fewer triangles
// (meshoptimizer) and fewer or more bones (the twist bones folded into their parents, or chains of
// hair and robe bones added and swayed in code), stood in rows in the room with the effects on, and
// timed. Each case runs a few seconds; the results go to window.budget and the page.


interface Case {
  name: string;
  hero?: Variant;
  boss?: Variant;
  monsters?: { n: number; v: Variant; cast?: boolean };
}


function body(id: number, kind: Entity['kind'], x: number, y: number, facing: number): Entity {
  const fx = Math.round(x * 1000);
  const fy = Math.round(y * 1000);
  return { id, kind, team: kind === 'hero' ? 0 : 1, x: fx, px: fx, y: fy, py: fy, z: 0, pz: 0, facing, state: 'walk', held: 0, move: '', st: 0 } as unknown as Entity;
}

/** The cases: each dimension on its own against a fixed rest, then whole rooms. */
const CASES: Case[] = [
  // monsters' triangles: ten of them, base bones, no hero
  ...[2000, 4000, 6000, 8000, 12000, 19000].map((t) => ({ name: `10 mon ${t / 1000}k 41b`, monsters: { n: 10, v: { tris: t, bones: 0 } } })),
  // monsters' bones: ten at 6k
  ...(['lean', 0, 20, 40] as const).map((b) => ({ name: `10 mon 6k ${b === 'lean' ? 23 : 41 + b}b`, monsters: { n: 10, v: { tris: 6000, bones: b } } })),
  // a hero's bones (casting the sun's shadow), alone
  ...[0, 30, 60, 100].map((b) => ({ name: `hero 8k ${41 + b}b`, hero: { tris: 8000, bones: b } })),
  // rooms: hero 8k 100b, boss 8k 61b, monsters 5k lean
  ...[0, 4, 8, 12, 16].map((n) => ({ name: `room hero+boss+${n}`, hero: { tris: 8000, bones: 60 }, boss: { tris: 8000, bones: 20 }, monsters: { n, v: { tris: 5000, bones: 'lean' as const } } })),
  ...[8, 12, 16].map((n) => ({ name: `room hero+boss+${n} mon8k`, hero: { tris: 8000, bones: 60 }, boss: { tris: 8000, bones: 20 }, monsters: { n, v: { tris: 8000, bones: 'lean' as const } } })),
];

/** Past what a room will hold, to find where the phone gives way (?stress). */
const STRESS: Case[] = [
  ...[20, 30, 40].map((n) => ({ name: `${n} mon 8k 23b`, monsters: { n, v: { tris: 8000, bones: 'lean' as const } } })),
  ...[20, 30].map((n) => ({ name: `${n} mon 19k 41b`, monsters: { n, v: { tris: 19000, bones: 0 } } })),
  ...[30, 40].map((n) => ({ name: `${n} mon 8k 81b`, monsters: { n, v: { tris: 8000, bones: 40 } } })),
  ...[6, 10, 16].map((n) => ({ name: `${n} casters 8k 61b`, hero: { tris: 8000, bones: 20 }, boss: { tris: 8000, bones: 20 }, monsters: { n: n - 2, v: { tris: 8000, bones: 20 }, cast: true } })),
];

export async function runBudget(params: URLSearchParams): Promise<void> {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Number(params.get('dpr') ?? Math.min(window.devicePixelRatio, 2)));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  document.body.appendChild(renderer.domElement);
  const info = document.createElement('div');
  info.style.cssText = 'position:fixed;left:12px;top:8px;color:#1c1b1f;font:13px/1.4 monospace;pointer-events:none;white-space:pre;background:#fff8;z-index:2';
  document.body.appendChild(info);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 10, 20000);
  scene.add(new HemisphereLight(0xfff8ec, 0x6a6458, 1.2), new AmbientLight(0xffffff, 0.3));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1500, right: 1500, top: 900, bottom: -900, near: 500, far: 4500 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);
  const stage = new Stage(scene);
  stage.effects();
  const post = new Post(renderer, 0);
  const roomW = 3000;
  await stage.preload('heifeng', renderer);
  await stage.show('heifeng', 2, roomW);
  await MeshoptSimplifier.ready;
  const { hero } = await loadModels(WEB_FILES);

  const cx = roomW / 2;
  const d = DIST;
  const tz = (fromFp(WORLD.depth) * DEPTH_K) / 2;
  camera.position.set(cx, AIM_Y + Math.tan(PITCH) * d, tz + d);
  level(camera, Math.tan(PITCH) * d, d);
  sun.target.position.set(cx, 0, tz);
  sun.position.set(cx - 600, 1900, tz + 1100);
  const depth = fromFp(WORLD.depth);

  const models = new Map<string, Model>();
  const model = (v: Variant) => {
    const k = `${v.tris}:${v.bones}`;
    if (!models.has(k)) models.set(k, variant(hero, v));
    return models.get(k)!;
  };

  const results: Record<string, unknown>[] = [];
  (window as unknown as { budget: unknown }).budget = { results, done: false };
  const only = params.get('only');
  const secs = Number(params.get('secs') ?? 5);
  for (const c of params.has('stress') ? STRESS : CASES) {
    if (only && !c.name.includes(only)) continue;
    const bodies: { a: Actor; e: Entity }[] = [];
    let id = 1;
    const add = (kind: Entity['kind'], v: Variant, x: number, y: number) => {
      const m = model(v);
      const a = new Actor(id, kind, m, kind === 'hero' ? 0xffffff : kind === 'chief' ? 0xa07060 : 0xb8bcc8, true);
      const e = body(id++, kind, x, y, id % 2 ? 1 : -1);
      scene.add(a.root, a.floorShadow, a.trail.mesh);
      bodies.push({ a, e });
    };
    if (c.hero) add('hero', c.hero, cx - 300, depth * 0.55);
    if (c.boss) add('chief', c.boss, cx + 300, depth * 0.45);
    const n = c.monsters?.n ?? 0;
    // the monsters in two rows across the view
    for (let i = 0; i < n; i++) {
      const row = i % 2;
      const col = Math.floor(i / 2);
      const cols = Math.ceil(n / 2);
      add(c.monsters!.cast ? 'chief' : 'bandit', c.monsters!.v, cx - 800 + ((col + 0.5) * 1600) / cols, depth * (row ? 0.8 : 0.2));
    }
    // each sway bone of each body, swung in code as a spring chain would be
    const sway: Bone[] = [];
    for (const b of bodies) b.a.pose3d.traverse((o) => o.userData.sway !== undefined && sway.push(o as Bone));
    await renderer.compileAsync(scene, camera);

    const frameMs: number[] = [];
    const cpuMs: number[] = [];
    let tris = 0;
    let draws = 0;
    await new Promise<void>((done) => {
      const t0 = performance.now();
      let last = t0;
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = Math.min(0.1, (now - last) / 1000);
        const t = now / 1000;
        if (now - t0 > 1000) frameMs.push(now - last);
        last = now;
        renderer.info.reset();
        for (const s of sway) s.rotation.set(Math.sin(t * 2.3 + s.userData.sway) * 0.3, 0, Math.cos(t * 1.9 + s.userData.sway) * 0.25);
        for (const b of bodies) b.a.update(b.e, 1, dt);
        renderer.setRenderTarget(post.target);
        stage.render(renderer, camera, cx - 960, cx, () => renderer.render(scene, camera));
        post.present(renderer, dt, t);
        const cpu = performance.now() - now;
        if (now - t0 > 1000) cpuMs.push(cpu);
        tris = renderer.info.render.triangles;
        draws = renderer.info.render.calls;
        if (now - t0 > 1000 + secs * 1000) {
          renderer.setAnimationLoop(null);
          done();
        }
      });
    });
    const sorted = frameMs.slice().sort((a, b) => a - b);
    const cs = cpuMs.slice().sort((a, b) => a - b);
    const total = frameMs.reduce((a, b) => a + b, 0);
    const r = {
      name: c.name,
      fps: +((frameMs.length * 1000) / total).toFixed(1),
      p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      cpu: +cs[Math.floor(cs.length / 2)].toFixed(2),
      tris,
      draws,
      bones: bodies.reduce((s, b) => s + (meshOf(b.a.pose3d).skeleton.bones.length), 0),
    };
    results.push(r);
    info.textContent = results.map((x) => JSON.stringify(x)).join('\n');
    for (const b of bodies) b.a.dispose();
  }
  (window as unknown as { budget: { done: boolean } }).budget.done = true;
}
