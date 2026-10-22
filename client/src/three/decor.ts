import { WORLD, fromFp } from '@dnf/engine';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { DEPTH_K } from './actor';
import { CINNABAR, INK } from './ink';
import type { Air } from './vfx';

// What only dresses the picture, never answers the fight: banks of mist low over the floor, the
// shadows of clouds drifting across it, a flock of crows crossing the sky now and then, the wind's
// hairline strokes, war banners waving over the fort, and a sweep of the brush with a seal stamped
// on it when a room begins and when it is won. All of it is cheap: a few quads and one point cloud,
// shaped in their shaders.

const NOISE = /* glsl */ `
float dHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float dNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( dHash( i ), dHash( i + vec2( 1, 0 ) ), f.x ), mix( dHash( i + vec2( 0, 1 ) ), dHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float dFbm( vec2 p ) { return dNoise( p ) * 0.55 + dNoise( p * 2.1 + 3.7 ) * 0.3 + dNoise( p * 4.3 + 9.1 ) * 0.15; }
`;

const PLAIN_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** A bank of mist standing upright across the room (the camera is level, so it faces the screen):
 * soft at its top and ends, torn by drifting noise, in the colour of the paper. */
function mistBank(): Mesh {
  const m = new ShaderMaterial({
    uniforms: { time: { value: 0 }, color: { value: new Color() }, alpha: { value: 0.5 }, seed: { value: 0 } },
    vertexShader: PLAIN_VERT,
    fragmentShader: /* glsl */ `
      uniform float time; uniform vec3 color; uniform float alpha; uniform float seed;
      varying vec2 vUv; varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec2 p = vec2( vWorld.x / 520.0 + time * 0.035 + seed, vWorld.y / 190.0 - time * 0.02 );
        float n = dFbm( p );
        float h = vUv.y;
        float body = smoothstep( 1.0, 0.15, h + ( n - 0.5 ) * 0.7 ) * smoothstep( 0.0, 0.06, h );
        float ends = smoothstep( 0.0, 0.08, vUv.x ) * smoothstep( 1.0, 0.92, vUv.x );
        float a = body * ends * smoothstep( 0.25, 0.65, n ) * alpha;
        gl_FragColor = vec4( color, a );
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  return new Mesh(new PlaneGeometry(1, 1), m);
}

/** The shadows of clouds passing over the floor: large soft blots of ink, drifting with the wind. */
function cloudShadow(): Mesh {
  const m = new ShaderMaterial({
    uniforms: { time: { value: 0 }, alpha: { value: 0.2 } },
    vertexShader: PLAIN_VERT,
    fragmentShader: /* glsl */ `
      uniform float time; uniform float alpha;
      varying vec2 vUv; varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec2 p = vec2( vWorld.x / 1400.0 - time * 0.022, vWorld.z / 700.0 );
        float n = dFbm( p );
        float a = smoothstep( 0.46, 0.62, n ) * alpha;
        // the blot's edge is a little darker, as a wash dries
        a += smoothstep( 0.44, 0.48, n ) * smoothstep( 0.54, 0.48, n ) * alpha * 0.6;
        gl_FragColor = vec4( vec3( 0.07, 0.065, 0.08 ), a );
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const s = new Mesh(new PlaneGeometry(1, 1), m);
  s.rotation.x = -Math.PI / 2;
  s.renderOrder = -0.7;
  return s;
}

/** Crows: each a point, its wings two brush strokes beating in the shader. */
const BIRDS = 9;
function flock(): Points {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(BIRDS * 3), 3));
  const phase = new Float32Array(BIRDS);
  for (let i = 0; i < BIRDS; i++) phase[i] = i * 2.39;
  g.setAttribute('phase', new BufferAttribute(phase, 1));
  const m = new ShaderMaterial({
    uniforms: { time: { value: 0 }, scale: { value: 1 }, dir: { value: 1 }, ink: { value: new Color(INK) } },
    vertexShader: /* glsl */ `
      attribute float phase;
      uniform float scale; uniform float time;
      varying float vBeat;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 64.0 * scale / -mv.z;
        // beats in bursts, then glides
        float b = sin( time * 9.0 + phase );
        vBeat = mix( 0.25, b, smoothstep( -0.3, 0.3, sin( time * 0.9 + phase * 0.5 ) ) );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 ink; uniform float dir;
      varying float vBeat;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        p.y = -p.y;
        p.x *= dir;
        float ax = abs( p.x );
        // each wing a curve from the body out, bent up or down with the beat, thinning to its tip
        float wing = vBeat * 0.55 * ax - 0.25 * ax * ax * ( 1.0 - vBeat );
        float w = 0.11 * ( 1.0 - ax ) + 0.02;
        float d = abs( p.y - wing );
        float a = smoothstep( w, w * 0.4, d ) * step( ax, 0.95 );
        // the body and the head, a little forward
        a = max( a, smoothstep( 0.16, 0.08, length( vec2( p.x - 0.08, p.y * 1.6 ) ) ) );
        if ( a < 0.05 ) discard;
        gl_FragColor = vec4( ink, a * 0.85 );
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const p = new Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -0.5;
  return p;
}

/** A hairline of wind: a thin grey stroke drawn across the air and gone, its head ahead of its tail. */
function windStroke(): Mesh {
  const m = new ShaderMaterial({
    uniforms: { t: { value: 2 }, alpha: { value: 0.3 }, bend: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float bend;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin( uv.x * 3.14159 ) * bend + sin( uv.x * 9.0 + bend ) * 6.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform float t; uniform float alpha;
      varying vec2 vUv;
      void main() {
        float head = smoothstep( t + 0.02, t - 0.1, vUv.x );
        float tail = smoothstep( t - 0.75, t - 0.35, vUv.x );
        float across = 1.0 - abs( vUv.y * 2.0 - 1.0 );
        float a = head * tail * across * alpha;
        gl_FragColor = vec4( vec3( 0.25, 0.24, 0.27 ), a );
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  return new Mesh(new PlaneGeometry(900, 4, 32, 1), m);
}

/** A war banner on its pole: red cloth with an ink border and a paper title strip down it, written
 * with a column of characters, rippling from the pole. */
const POLE_GEO = new BoxGeometry(7, 560, 7).translate(0, 280, 0);
const POLE_MAT = new MeshBasicMaterial({ color: INK });
const CLOTH_GEO = new PlaneGeometry(130, 300, 12, 8).translate(65, 380, 0);
function banner(): Group {
  const m = new ShaderMaterial({
    uniforms: { time: { value: 0 }, seed: { value: 0 }, red: { value: new Color(CINNABAR) }, ink: { value: new Color(INK) } },
    vertexShader: /* glsl */ `
      uniform float time; uniform float seed;
      varying vec2 vUv; varying float vShade;
      void main() {
        vUv = uv;
        vec3 p = position;
        float k = uv.x;
        float w = sin( k * 5.0 - time * 3.2 + seed ) * 0.6 + sin( k * 11.0 - time * 5.1 + seed * 2.0 ) * 0.25;
        p.z += w * 26.0 * k;
        p.y -= k * k * 18.0 + w * 6.0 * k;
        vShade = 0.82 + 0.18 * cos( k * 5.0 - time * 3.2 + seed );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 red; uniform vec3 ink;
      varying vec2 vUv; varying float vShade;
      void main() {
        vec2 p = vUv;
        float edge = step( p.x, 0.06 ) + step( 0.94, p.x ) + step( p.y, 0.04 ) + step( 0.96, p.y );
        vec3 c = mix( red * vShade, ink, min( edge, 1.0 ) );
        // a paper strip down the cloth, as on a temple or army streamer, written with three
        // characters of slanted bars and a dot each. No disc and no crossing strokes: an emblem in a
        // disc on red reads as a modern flag, not as writing
        float sx = p.x - 0.42;
        float strip = step( abs( sx ), 0.12 ) * step( 0.14, p.y ) * step( p.y, 0.9 );
        c = mix( c, vec3( 0.93, 0.9, 0.84 ), strip );
        float g = 0.0;
        for ( int i = 0; i < 3; i++ ) {
          vec2 r = vec2( sx, p.y - ( 0.77 - float( i ) * 0.22 ) );
          g = max( g, smoothstep( 0.02, 0.012, abs( r.y - 0.05 + r.x * 0.3 ) ) * step( abs( r.x ), 0.07 ) );
          g = max( g, smoothstep( 0.02, 0.012, abs( r.y + 0.02 - r.x * 0.15 ) ) * step( abs( r.x + 0.01 ), 0.08 ) );
          g = max( g, smoothstep( 0.03, 0.02, length( ( r - vec2( -0.04, -0.07 ) ) * vec2( 1.0, 0.45 ) ) ) );
        }
        c = mix( c, ink, g * strip );
        // ragged swallow-tail at the free end
        if ( p.x > 0.88 && abs( p.y - 0.5 ) < ( p.x - 0.88 ) * 2.0 ) discard;
        gl_FragColor = vec4( c, 1.0 );
      }`,
    side: DoubleSide,
  });
  const g = new Group();
  g.add(new Mesh(POLE_GEO, POLE_MAT), new Mesh(CLOTH_GEO, m));
  return g;
}

/** The brush sweep and seal: a wide stroke of dry ink drawn across the screen, then a red seal. */
function flourish(): Mesh {
  const m = new ShaderMaterial({
    uniforms: { t: { value: 9 }, seed: { value: 0 }, ink: { value: new Color(INK) }, red: { value: new Color(CINNABAR) } },
    vertexShader: PLAIN_VERT,
    fragmentShader: /* glsl */ `
      uniform float t; uniform float seed; uniform vec3 ink; uniform vec3 red;
      varying vec2 vUv; varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec2 p = vUv;
        // drawn left to right in the first 0.35 s, held, then fading out from 1.1 s
        float drawn = smoothstep( p.x - 0.02, p.x + 0.02, t / 0.35 );
        float fade = 1.0 - smoothstep( 1.1, 1.7, t );
        // the stroke: thick in the middle, a pressed start and a lifted, split end
        float x = p.x;
        float width = 0.2 * smoothstep( 0.0, 0.07, x ) * ( 1.0 - 0.7 * smoothstep( 0.5, 1.0, x ) );
        width *= 0.85 + 0.3 * dNoise( vec2( x * 7.0, seed ) );
        float centre = 0.52 + sin( x * 2.6 + seed ) * 0.05 - x * 0.06;
        // ragged edges: the paper's fibres pull the ink unevenly
        float d = abs( p.y - centre ) + ( dNoise( vec2( x * 40.0, p.y * 12.0 + seed ) ) - 0.5 ) * width * 0.35;
        float body = smoothstep( width, width * 0.75, d );
        // dry-brush hairs along the stroke: whole in its middle, breaking up at its edges and its end
        float n = dNoise( vec2( x * 2.0 + seed, p.y * 45.0 ) ) * 0.7 + dNoise( vec2( x * 8.0, p.y * 110.0 + seed ) ) * 0.3;
        float dry = 0.08 + 0.4 * smoothstep( 0.6, 1.05, x ) + 0.45 * smoothstep( 0.55, 1.0, d / max( width, 1e-3 ) );
        float hairs = smoothstep( dry - 0.06, dry + 0.06, n );
        // the ink lies unevenly: wetter pools and paler, thinner drags
        float wet = 0.55 + 0.4 * dNoise( vec2( x * 5.0 + seed, p.y * 8.0 ) );
        float a = body * hairs * drawn * fade * wet;
        vec3 c = ink;
        // the seal, stamped once the stroke is down: a square of red with a white frame and marks
        vec2 s = ( p - vec2( 0.88, 0.28 ) ) * vec2( 7.6, 1.6 );
        float sealIn = smoothstep( 0.42, 0.5, t ) * fade;
        if ( max( abs( s.x ), abs( s.y ) ) < 0.16 && sealIn > 0.0 ) {
          vec2 g = abs( s ) / 0.16;
          float frame = step( 0.82, max( g.x, g.y ) ) * step( max( g.x, g.y ), 0.92 );
          float marks = step( 0.55, dHash( floor( ( s + 0.16 ) / 0.32 * 5.0 ) + seed ) ) * step( max( g.x, g.y ), 0.74 );
          // the frame and the marks are where the paper shows through; the stone's grit too
          float paper = max( frame, marks );
          float grit = step( 0.18, dNoise( s * 90.0 ) );
          c = red * 1.2;
          a = sealIn * grit * ( 1.0 - paper );
        }
        if ( a < 0.01 ) discard;
        gl_FragColor = vec4( c, min( a * 1.15, 0.95 ) );
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const f = new Mesh(new PlaneGeometry(1, 1), m);
  f.renderOrder = 20;
  f.visible = false;
  return f;
}

/** How each scene is dressed. */
const DRESS: Record<Air, { mist: number; mistAlpha: number; clouds: boolean; birds: boolean; wind: boolean; banners: boolean }> = {
  road: { mist: 0xfbf8f0, mistAlpha: 0.8, clouds: true, birds: true, wind: true, banners: false },
  fort: { mist: 0xe4ded2, mistAlpha: 0.75, clouds: true, birds: true, wind: false, banners: true },
  hall: { mist: 0x5a5a70, mistAlpha: 0.35, clouds: false, birds: false, wind: false, banners: false },
  village: { mist: 0xf4f6ee, mistAlpha: 0.6, clouds: true, birds: true, wind: true, banners: false },
};

export class Decor {
  readonly root = new Group();
  /** Drawn over the finished picture (the brush), so neither the flat foreground nor the bodies cover it. */
  readonly overlay = new Scene();
  readonly overlayCam = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly mists: Mesh[] = [];
  private readonly clouds = cloudShadow();
  private readonly birds = flock();
  private readonly winds: Mesh[] = [];
  private readonly banners: Group[] = [];
  private readonly brush = flourish();
  private air: Air = 'road';
  private roomW = 2000;
  private time = 0;
  /** Seconds to the next flock, where it is, and which way it flies. */
  private flockAt = 3;
  private flockX = 0;
  private flockDir = 1;
  private windAt = 1;
  private brushT = 9;
  private seed = 0;
  private readonly offsets: { x: number; y: number; z: number }[] = [];

  constructor() {
    const depth = fromFp(WORLD.depth) * DEPTH_K;
    // three banks: behind the floor, half way back, and in front of the bodies
    for (const [z, h, s] of [
      [-40, 260, 0],
      [depth * 0.45, 140, 3.1],
      [depth + 120, 200, 6.7],
    ] as const) {
      const m = mistBank();
      m.position.set(0, h / 2 - 10, z);
      m.scale.set(1, h, 1);
      (m.material as ShaderMaterial).uniforms.seed.value = s;
      this.mists.push(m);
    }
    for (let i = 0; i < 3; i++) this.winds.push(windStroke());
    for (let i = 0; i < 4; i++) {
      const b = banner();
      ((b.children[1] as Mesh).material as ShaderMaterial).uniforms.seed.value = i * 1.9;
      this.banners.push(b);
    }
    for (let i = 0; i < BIRDS; i++) {
      // a loose V, with some straggling
      const row = Math.ceil(i / 2);
      const side = i % 2 ? 1 : -1;
      this.offsets.push({ x: -row * 70 + (i * 37) % 30, y: side * row * 28 + ((i * 53) % 20), z: side * row * 20 });
    }
    this.root.add(...this.mists, this.clouds, this.birds, ...this.winds, ...this.banners);
    this.overlay.add(this.brush);
  }

  /** Everything at once for a frame, so every shader builds at the start. */
  warm(on: boolean): void {
    for (const o of [...this.mists, this.clouds, this.birds, ...this.winds, ...this.banners, this.brush] as Object3D[]) o.visible = on;
    if (!on) this.setScene(this.air, this.roomW);
  }

  setScene(air: Air, roomW: number): void {
    this.air = air;
    this.roomW = roomW;
    const d = DRESS[air];
    const depth = fromFp(WORLD.depth) * DEPTH_K;
    for (const m of this.mists) {
      m.visible = true;
      m.scale.x = roomW + 3000;
      m.position.x = roomW / 2;
      const u = (m.material as ShaderMaterial).uniforms;
      (u.color.value as Color).set(d.mist);
      u.alpha.value = d.mistAlpha * (m === this.mists[2] ? 0.6 : 1);
    }
    this.clouds.visible = d.clouds;
    this.clouds.scale.set(roomW + 3000, depth + 900, 1);
    this.clouds.position.set(roomW / 2, 0.7, depth / 2);
    this.birds.visible = false;
    this.flockAt = 2;
    for (const w of this.winds) w.visible = false;
    this.banners.forEach((b, i) => {
      b.visible = d.banners;
      b.position.set(roomW * (0.12 + i * 0.26), 0, -60 - (i % 2) * 30);
    });
  }

  /** A sweep of the brush across the middle of the view (a room begun, a room won). */
  stroke(): void {
    this.brushT = 0;
    this.seed = (this.seed + 2.7) % 10;
  }

  /** `camX`: the centre of the view; `pxPerUnit`, for the birds' size. */
  /** `camX`..: where the level camera stands, and how far down it looks (its pitch). */
  update(dt: number, camX: number, pxPerUnit: number): void {
    this.time += dt;
    const t = this.time;
    const d = DRESS[this.air];
    for (const m of this.mists) (m.material as ShaderMaterial).uniforms.time.value = t;
    (this.clouds.material as ShaderMaterial).uniforms.time.value = t;
    for (const b of this.banners) ((b.children[1] as Mesh).material as ShaderMaterial).uniforms.time.value = t;

    // the flock: now and then, across the sky behind the room
    if (d.birds) {
      this.flockAt -= dt;
      if (this.flockAt <= 0 && !this.birds.visible) {
        this.birds.visible = true;
        this.flockDir = this.seedRand() < 0.5 ? 1 : -1;
        this.flockX = camX - this.flockDir * 1700;
      }
      if (this.birds.visible) {
        this.flockX += this.flockDir * 260 * dt;
        const pos = this.birds.geometry.attributes.position as BufferAttribute;
        for (let i = 0; i < BIRDS; i++) {
          const o = this.offsets[i];
          pos.setXYZ(i, this.flockX + o.x * this.flockDir + Math.sin(t * 0.7 + i) * 12, 560 + o.y + Math.sin(t * 1.3 + i * 2) * 10, -420 + o.z);
        }
        pos.needsUpdate = true;
        const u = (this.birds.material as ShaderMaterial).uniforms;
        u.time.value = t;
        u.scale.value = pxPerUnit;
        u.dir.value = this.flockDir;
        if (Math.abs(this.flockX - camX) > 1900) {
          this.birds.visible = false;
          this.flockAt = 10 + this.seedRand() * 12;
        }
      }
    }

    // the wind's strokes, one at a time, across the front of the room
    if (d.wind) {
      this.windAt -= dt;
      if (this.windAt <= 0) {
        const w = this.winds.find((x) => !x.visible);
        if (w) {
          w.visible = true;
          const u = (w.material as ShaderMaterial).uniforms;
          u.t.value = 0;
          u.bend.value = (this.seedRand() - 0.5) * 60;
          w.position.set(camX + (this.seedRand() - 0.6) * 1400, 120 + this.seedRand() * 380, 300 + this.seedRand() * 700);
        }
        this.windAt = 0.6 + this.seedRand() * 1.8;
      }
    }
    for (const w of this.winds) {
      if (!w.visible) continue;
      const u = (w.material as ShaderMaterial).uniforms;
      u.t.value += dt * 1.1;
      w.position.x += dt * 260;
      if (u.t.value > 1.8) w.visible = false;
    }

    // the brush: in front of everything, centred in the view
    this.brushT += dt;
    this.brush.visible = this.brushT < 1.8;
    if (this.brush.visible) {
      const u = (this.brush.material as ShaderMaterial).uniforms;
      u.t.value = this.brushT;
      u.seed.value = this.seed;
      // a screen quad in the upper part of the view, over the far painting and clear of the bodies' heads
      this.brush.position.set(0, 0.5, 0);
      this.brush.scale.set(2.4, 0.5, 1);
    }
  }

  private readonly _size = new Vector2();
  /** Draws the overlay onto whatever is bound (the screen, after the post). */
  drawOverlay(renderer: WebGLRenderer): void {
    if (!this.brush.visible) return;
    const size = renderer.getSize(this._size);
    const aspect = size.x / Math.max(1, size.y);
    if (this.overlayCam.right !== aspect) {
      this.overlayCam.left = -aspect;
      this.overlayCam.right = aspect;
      this.overlayCam.updateProjectionMatrix();
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.overlay, this.overlayCam);
    renderer.autoClear = auto;
  }

  private r = 0.37;
  private seedRand(): number {
    this.r = (this.r * 9301 + 0.49297) % 1;
    return this.r;
  }
}
