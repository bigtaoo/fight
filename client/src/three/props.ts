import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  TorusGeometry,
  Vector2,
  BackSide,
  AdditiveBlending,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  RGBAFormat,
  LinearFilter,
  type Object3D,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INK, bakeTone } from './ink';

// The room's own furniture, built in code from turned profiles and boxes (no model files): the
// hall's red pillars on their stone bases, a bronze incense burner on its stand, a floor
// candlestick and a wine jar. Visual only: they stand in the room so the bodies pass in front of
// and behind them, but nothing in the engine knows they are there (anything that blocks or breaks
// would be engine data). Each kind is one geometry with its colours in the vertices, drawn with the
// bodies' toon ramp and an ink outline, so a prop costs two draws.

export type PropKind = 'pillar' | 'burner' | 'candle' | 'jar' | 'lantern';

/** World units: the hero is 220 tall. */
const OUTLINE_W = 1.6;

function ramp(): DataTexture {
  const t = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

const BODY = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp() });
BODY.onBeforeCompile = bakeTone;

/** The inverted hull for meshes without skinning: pushed out along the smooth normals. */
const OUTLINE = (() => {
  const m = new MeshBasicMaterial({ color: INK, side: BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outline = { value: OUTLINE_W };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 hull;\nuniform float outline;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += hull * outline;');
  };
  return m;
})();

/** Pillars that stand in front of the bodies fade when they cover the hero, each on its own pair
 * of materials (the same shaders, so a new room builds nothing); a room has at most this many. */
const PILLARS = Array.from({ length: 6 }, () => {
  const body = BODY.clone();
  body.onBeforeCompile = bakeTone;
  const line = OUTLINE.clone();
  line.onBeforeCompile = OUTLINE.onBeforeCompile;
  for (const m of [body, line]) m.transparent = true;
  return { body, line };
});

const FLAME = new MeshBasicMaterial({ color: 0xffc860, toneMapped: false });
/** A paper lantern's shade, lit from inside. */
const PAPER = new MeshBasicMaterial({ color: 0xd8553a, toneMapped: false });

/** A soft round falloff, for glows. */
export const GLOW_MAP = (() => {
  const n = 64;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - r) ** 2.2;
      d.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4);
    }
  const t = new DataTexture(d, n, n, RGBAFormat);
  t.minFilter = t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
})();
/** The haze round a flame, and the pool of its light on the floor (with the effects only). */
const HALO = new SpriteMaterial({ map: GLOW_MAP, color: 0xffa860, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
const POOL = new MeshBasicMaterial({ map: GLOW_MAP, color: 0x5a3418, blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false });
const POOL_GEO = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** With the effects on, the flames burn brighter than white (the bloom catches what is past 1);
 * off, they are drawn as before and their glows are hidden. */
let glowing = false;
export function setGlow(on: boolean): void {
  glowing = on;
  FLAME.color.set(0xffc860);
  PAPER.color.set(0xd8553a);
  if (on) {
    FLAME.color.multiplyScalar(3.2);
    PAPER.color.multiplyScalar(1.9);
  }
}
const SHADOW = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.22, depthWrite: false });
const SHADOW_GEO = new CircleGeometry(1, 20);

/** A colour that can change with height: one hex, or a function of y (in the part's own units,
 * before it is moved). */
type Paint = number | ((y: number) => Color);

/** A part: `g` painted `paint`, moved to `x, y, z`. */
function part(g: BufferGeometry, paint: Paint, x = 0, y = 0, z = 0): BufferGeometry {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  const flat = typeof paint === 'number' ? new Color(paint) : null;
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    const c = flat ?? (paint as (y: number) => Color)(pos.getY(i));
    a.set([c.r, c.g, c.b], i * 3);
  }
  g.translate(x, y, z);
  g.setAttribute('color', new BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** A turned shape from (radius, height) pairs. */
function lathe(profile: [number, number][], segments = 20): BufferGeometry {
  return new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), segments);
}

/** One geometry from the parts, with a `hull` attribute: the normal averaged over every face that
 * shares the corner, so the outline stays closed round the hard edges of the boxes. */
function build(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => {
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') p.deleteAttribute(k);
    return p;
  }))!;
  const smooth = mergeVertices(new BufferGeometry().setAttribute('position', g.attributes.position.clone()), 0.01);
  smooth.computeVertexNormals();
  const key = (x: number, y: number, z: number) => `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
  const at = new Map<string, number>();
  const sp = smooth.attributes.position;
  for (let i = 0; i < sp.count; i++) at.set(key(sp.getX(i), sp.getY(i), sp.getZ(i)), i);
  const p = g.attributes.position;
  const hull = new Float32Array(p.count * 3);
  const sn = smooth.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const j = at.get(key(p.getX(i), p.getY(i), p.getZ(i)))!;
    hull.set([sn.getX(j), sn.getY(j), sn.getZ(j)], i * 3);
  }
  g.setAttribute('hull', new BufferAttribute(hull, 3));
  return g;
}

// pulled towards the painting: the hall's reds are worn and greyed, its stone a cool slate
const RED = 0x8a3a30;
const STONE = 0x5f5e66;
const STONE_DARK = 0x46454d;
const BRONZE = 0x4a4136;
const WOOD = 0x6e5440;
const CLAY = 0xb5a68c;
const GLAZE = 0x4a3426;
const CLOTH = 0x9c2a20;
const _ink = new Color(INK);

/** `hex` washed into ink by `k` (0 none, 1 all ink). */
function wash(hex: number, k: number): Color {
  return new Color(hex).lerp(_ink, Math.min(1, Math.max(0, k)));
}

function pillar(): BufferGeometry {
  return build([
    part(new BoxGeometry(150, 46, 150), STONE_DARK, 0, 23),
    part(new BoxGeometry(132, 14, 132), STONE, 0, 53),
    part(lathe([[0, 0], [62, 0], [64, 10], [58, 30], [44, 40], [0, 40]], 24), STONE, 0, 60),
    // the lacquer darkens into ink near the foot, like a brush wash, and fades to ink from about
    // head height up into the roof, as the painted pillars do (y here is from the middle, 750 up)
    part(new CylinderGeometry(36, 40, 1500, 24, 16, true), (y) => wash(RED, Math.max(0.15 + (-560 - y) / 250, (y + 420) / 380) * 0.9), 0, 100 + 750),
  ]);
}

function burner(): BufferGeometry {
  const legs: BufferGeometry[] = [];
  for (const [x, z] of [[-54, -42], [54, -42], [-54, 42], [54, 42]]) legs.push(part(new BoxGeometry(9, 104, 9), WOOD, x, 52, z));
  const feet: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    feet.push(part(new CylinderGeometry(5, 3, 26, 8), BRONZE, Math.cos(a) * 30, 125, Math.sin(a) * 30));
  }
  const handles = [-1, 1].map((s) => {
    const t = new TorusGeometry(11, 3, 6, 14, Math.PI);
    t.rotateY(Math.PI / 2);
    return part(t, BRONZE, s * 52, 196, 0);
  });
  return build([
    part(new BoxGeometry(136, 10, 106), WOOD, 0, 109),
    ...legs,
    part(new BoxGeometry(120, 6, 6), WOOD, 0, 30, 42),
    part(new BoxGeometry(120, 6, 6), WOOD, 0, 30, -42),
    ...feet,
    part(lathe([[0, 0], [30, 2], [46, 14], [54, 34], [52, 56], [56, 60], [54, 62], [0, 58]]), BRONZE, 0, 136),
    ...handles,
  ]);
}

function candle(): BufferGeometry {
  return build([
    part(lathe([[0, 0], [30, 0], [30, 4], [24, 12], [10, 20], [6, 30], [0, 30]]), BRONZE),
    part(new CylinderGeometry(3.5, 4.5, 130, 8), BRONZE, 0, 95),
    part(lathe([[0, 0], [5, 0], [7, 6], [5, 10], [0, 10]], 12), BRONZE, 0, 70),
    part(lathe([[0, 0], [6, 0], [20, 4], [22, 8], [0, 7]]), BRONZE, 0, 160),
    part(new CylinderGeometry(6, 6.5, 26, 12), 0xe8dcc0, 0, 180),
  ]);
}

/** A paper lantern's frame (wooden caps, a tassel and the cord it hangs from); the shade is
 * `shade()`, drawn lit. Hangs from its top: the origin is the cord's end, far above. */
const CORD = 900;
function lantern(): BufferGeometry {
  return build([
    part(new CylinderGeometry(1.5, 1.5, CORD, 4), INK, 0, -CORD / 2),
    part(lathe([[0, 0], [20, 0], [22, 6], [0, 8]], 14), WOOD, 0, -CORD - 8),
    part(lathe([[0, 0], [22, 0], [20, 6], [0, 6]], 14), WOOD, 0, -CORD - 92),
    part(new CylinderGeometry(3, 7, 34, 6), CLOTH, 0, -CORD - 110),
  ]);
}
const SHADE = (() => {
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    prof.push([20 + Math.sin(t * Math.PI) * 26, -CORD - 86 + t * 80]);
  }
  return build([part(lathe(prof, 18), 0xffffff)]);
})();

function jar(): BufferGeometry {
  const cloth: [number, number][] = [[33, 0], [30, 6], [26, 14], [22, 20], [0, 26]];
  return build([
    // bare clay below, a dark glaze poured over the shoulder and running down to about the middle
    part(lathe([[0, 0], [26, 0], [36, 14], [48, 44], [54, 68], [50, 84], [36, 100], [22, 110], [20, 116], [0, 116]], 24), (y) =>
      new Color(CLAY).lerp(new Color(GLAZE), Math.min(1, Math.max(0, (y - 58) / 12)))),
    part(lathe(cloth, 14), CLOTH, 0, 106),
    part(new TorusGeometry(22, 2.5, 6, 18).rotateX(Math.PI / 2), 0x3a2a22, 0, 116),
  ]);
}

/** Built on first use and kept: dropping one would free its shader mid-fight. */
const GEOS: Partial<Record<PropKind, BufferGeometry>> = {};
const MAKE: Record<PropKind, () => BufferGeometry> = { pillar, burner, candle, jar, lantern };
/** How wide the floor shadow is. */
const FOOT: Record<PropKind, number> = { pillar: 92, burner: 82, candle: 30, jar: 50, lantern: 0 };

function geo(kind: PropKind): BufferGeometry {
  return (GEOS[kind] ??= MAKE[kind]());
}

const FLAME_GEO = new ConeGeometry(4, 14, 8).translate(0, 7, 0);

/** One prop standing at the origin: the body, its outline, a shadow and (for a candle) the flame.
 * A pillar takes `slot`, which pair of fading materials it uses. */
export function prop(kind: PropKind, slot = 0): Group {
  const g = new Group();
  const mats = kind === 'pillar' ? PILLARS[slot % PILLARS.length] : { body: BODY, line: OUTLINE };
  const body = new Mesh(geo(kind), mats.body);
  const line = new Mesh(geo(kind), mats.line);
  body.castShadow = true;
  g.add(body, line);
  if (FOOT[kind]) {
    const shadow = new Mesh(SHADOW_GEO, SHADOW);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.6;
    shadow.scale.set(FOOT[kind], FOOT[kind] * 0.6, 1);
    shadow.renderOrder = -1;
    shadow.name = 'blob';
    g.add(shadow);
  }
  const glow = (y: number, size: number, pool: number) => {
    const h = new Sprite(HALO);
    h.position.y = y;
    h.scale.setScalar(size);
    h.name = 'fx';
    h.renderOrder = 4;
    const p = new Mesh(POOL_GEO, POOL);
    p.position.y = 1.2;
    p.scale.set(pool, 1, pool * 0.6);
    p.name = 'fx';
    g.add(h, p);
  };
  if (kind === 'candle') {
    const f = new Mesh(FLAME_GEO, FLAME);
    f.position.y = 193;
    f.name = 'flame';
    g.add(f);
    glow(200, 90, 260);
  }
  if (kind === 'lantern') {
    const shade = new Mesh(SHADE, PAPER);
    const rim = new Mesh(SHADE, mats.line);
    shade.name = 'sway';
    g.add(shade, rim);
    glow(-CORD - 46, 200, 0);
  }
  g.userData.kind = kind;
  g.userData.fade = kind === 'pillar' ? mats : null;
  return g;
}

/** Fades a pillar towards `to` (1 solid) by `k` of the way; the outline goes faster, its back faces
 * would otherwise show through as a dark core. */
export function fade(p: Object3D, to: number, k: number): void {
  const m = p.userData.fade as (typeof PILLARS)[number] | null;
  if (!m) return;
  m.body.opacity += (to - m.body.opacity) * k;
  m.line.opacity = m.body.opacity ** 3;
  // solid again: drawn with the opaque bodies, so nothing behind it blends through
  m.body.depthWrite = m.body.opacity > 0.98;
}

/** One of each kind, to put in the scene while its shaders compile. */
export function propWarmup(): Object3D {
  const g = new Group();
  for (const k of Object.keys(MAKE) as PropKind[]) g.add(prop(k));
  for (let i = 1; i < PILLARS.length; i++) g.add(prop('pillar', i));
  return g;
}

/** Candle flames waver and lanterns swing a little; `t` in seconds. */
export function flicker(root: Object3D, t: number): void {
  HALO.opacity = 0.55 + Math.sin(t * 17) * 0.06 + Math.sin(t * 7.3) * 0.05;
  root.traverse((o) => {
    if (o.name === 'fx') o.visible = glowing;
    else if (o.name === 'flame') {
      const s = 1 + Math.sin(t * 13 + o.id) * 0.08 + Math.sin(t * 29 + o.id * 3) * 0.05;
      o.scale.set(1 / s, s, 1 / s);
    } else if (o.userData.kind === 'lantern') o.rotation.z = Math.sin(t * 0.9 + o.id) * 0.012;
  });
}
