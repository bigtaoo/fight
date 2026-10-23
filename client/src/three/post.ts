import { Color, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three';

// The effects pass: the frame is drawn into a half-float texture (so flames and sparks can be
// brighter than white), then put on the screen through one pass that adds a two-level bloom of
// what is past white and finishes the picture in the ink look: a slight grade towards paper, an ink
// wash in the corners, paper grain, and the punches of a fight (chromatic split and a radial
// smear on heavy hits, a two-tone impact frame on crits, speed lines on skills, a white flash).
// Two slower beats of the story run through it too: a room held by ink monsters is drained to ink
// and gets its colour back in a spreading wash when it is cleared (`drained`, `restore`), and a
// scene can begin as blank paper and be painted in, outlines first and then colour (`blank`, `reveal`).

const QUAD = new PlaneGeometry(2, 2);
/** Seconds for the colour to wash back over a cleared room, and to drain out of a held one. */
const WASH_SEC = 1.5;
const DRAIN_SEC = 0.8;
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** What is brighter than white, shrunk to a smaller texture (four taps, so nothing flickers). */
const BRIGHT = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 texel;
  uniform float gate;
  varying vec2 vUv;
  vec3 pick(vec2 uv) { vec3 c = texture2D(tSrc, uv).rgb; float m = max(c.r, max(c.g, c.b)); return gate > 0.5 ? c * smoothstep(1.0, 1.8, m) : c; }
  void main() {
    vec3 c = pick(vUv + texel * vec2(-1, -1)) + pick(vUv + texel * vec2(1, -1)) + pick(vUv + texel * vec2(-1, 1)) + pick(vUv + texel * vec2(1, 1));
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`;

/** A 9-tap gaussian along `dir` (linear taps, so 5 reads). */
const BLUR = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
    c += texture2D(tSrc, vUv + dir * 1.3846154).rgb * 0.3162162;
    c += texture2D(tSrc, vUv - dir * 1.3846154).rgb * 0.3162162;
    c += texture2D(tSrc, vUv + dir * 3.2307692).rgb * 0.0702703;
    c += texture2D(tSrc, vUv - dir * 3.2307692).rgb * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }`;

const FINAL = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom1;
  uniform sampler2D tBloom2;
  uniform vec2 res;
  uniform float time;
  uniform vec2 center;
  uniform float ca;
  uniform float smear;
  uniform float impact;
  uniform float speed;
  uniform float flash;
  uniform sampler2D tPaper;
  uniform float bloom;
  uniform vec3 paper;
  uniform vec3 inkColor;
  uniform float grey;
  uniform vec2 washAt;
  uniform float washR;
  uniform float washFade;
  uniform float reveal;
  uniform float seep;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  vec3 lit(vec2 uv) {
    return texture2D(tScene, uv).rgb + (texture2D(tBloom1, uv).rgb * 0.9 + texture2D(tBloom2, uv).rgb * 0.8) * bloom;
  }
  vec3 srgb(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec2 uv = vUv;
    vec2 off = uv - center;
    vec3 col;
    if (smear > 0.001) {
      // a smear towards the hit, as if the frame jumped at it
      col = vec3(0.0);
      for (int i = 0; i < 8; i++) col += lit(uv - off * (float(i) / 7.0) * smear * 0.09);
      col /= 8.0;
    } else col = lit(uv);
    // what is red before the colours are split (a split edge would read as red in the impact frame)
    vec3 pre = srgb(col);
    if (ca > 0.001) {
      col.r = mix(col.r, lit(uv + off * ca * 0.007).r, 0.85);
      col.b = mix(col.b, lit(uv - off * ca * 0.007).b, 0.85);
    }
    col = srgb(col);

    // the grade: a little less colour, and the whites pulled to the paper's warmth
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, 0.9);
    col *= mix(vec3(1.0), paper / max(max(paper.r, paper.g), paper.b), 0.12);
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);

    // the ink seeping down from the scroll's top edge (\`seep\` from 0 to 1.6, then 9: done): it runs
    // faster in some columns, as drips do, and drains the room where it has reached
    float seepIn = 1.0;
    float seepTop = 0.0;
    float seepDrip = 0.0;
    if (seep < 2.0) {
      seepTop = 1.0 - uv.y + (noise(uv * 23.0) - 0.5) * 0.02;
      seepDrip = noise(vec2(uv.x * 11.0, 0.5)) * 0.25 + pow(noise(vec2(uv.x * 41.0, 4.0)), 4.0) * 0.6;
      float f = seep * (0.6 + seepDrip);
      seepIn = 1.0 - smoothstep(f - 0.015, f + 0.015, seepTop);
    }

    // the room drained to ink while monsters hold it (its reds kept), the colour flowing back out
    // from washAt as a wash with a ragged, wet front
    if (grey > 0.001) {
      float g = grey * seepIn;
      float lg = dot(col, vec3(0.299, 0.587, 0.114));
      if (washR > 0.0) {
        vec2 d = (uv - washAt) * vec2(res.x / res.y, 1.0);
        float r = length(d) + (noise(uv * 7.0) - 0.5) * 0.16 + (noise(uv * 37.0) - 0.5) * 0.05;
        float inside = 1.0 - smoothstep(washR - 0.07, washR, r);
        // pigment pools at the front of a wash: a darker, richer ring just inside it; behind it the
        // colour is still wet, warmer and fuller than it will dry
        float rim = inside * smoothstep(washR - 0.16, washR - 0.04, r);
        float wet = inside * exp(-max(washR - r, 0.0) * 3.0) * washFade;
        col = mix(vec3(lg), col, 1.0 + wet * 0.7) * mix(vec3(1.0), vec3(1.04, 1.0, 0.93), wet);
        col = mix(col, col * col * 1.1, rim * 0.45);
        g *= 1.0 - inside;
      }
      // drained: ink on a cold grey sheet, flatter, the warmth gone out of the paper
      float red = smoothstep(0.15, 0.35, col.r - max(col.g, col.b));
      vec3 ink = mix(inkColor, vec3(0.77, 0.78, 0.79), smoothstep(0.0, 1.0, lg));
      col = mix(col, ink, g * 0.9 * (1.0 - red * 0.6));
    }
    if (seep < 2.0) {
      // its source, a heavy band of ink along the top that thins as it soaks down, and the wet,
      // darker front of what is still running
      float f = seep * (0.6 + seepDrip);
      float front = seepIn * smoothstep(f - 0.07, f, seepTop);
      float source = (1.0 - smoothstep(0.0, 0.05 + seepDrip * 0.3, seepTop)) * (1.0 - seep / 1.8);
      col = mix(col, inkColor, clamp(front * 0.55 + source * 0.85, 0.0, 1.0));
    }

    // the first strokes: blank paper, then the outlines brushed in band by band (where the action
    // is first), then the colour washed in behind them
    if (reveal < 1.0) {
      vec2 a = uv * vec2(res.x / res.y, 1.0);
      float yy = a.y * 7.0 + (noise(vec2(a.x * 1.7, 3.0)) - 0.5) * 1.1;
      float k = floor(yy);
      float along = hash(vec2(k, 9.7)) > 0.5 ? uv.x : 1.0 - uv.x;
      float bristle = noise(vec2(along * 5.0, yy * 16.0));
      float s = hash(vec2(k, 3.1)) * 0.5 + along * 0.38 + bristle * 0.12;
      s *= mix(0.45, 1.0, smoothstep(0.08, 0.45, length(off * vec2(res.x / res.y, 1.0))));
      float lineP = reveal * 1.9 - s;
      float line = smoothstep(0.0, 0.05, lineP);
      float wash = smoothstep(0.0, 0.18, (reveal - 0.42) * 1.9 - s);
      vec2 px = 1.5 / res;
      float lx = dot(texture2D(tScene, uv + vec2(px.x, 0.0)).rgb - texture2D(tScene, uv - vec2(px.x, 0.0)).rgb, vec3(0.5));
      float ly = dot(texture2D(tScene, uv + vec2(0.0, px.y)).rgb - texture2D(tScene, uv - vec2(0.0, px.y)).rgb, vec3(0.5));
      float edge = smoothstep(0.04, 0.16, length(vec2(lx, ly)));
      // the drawing: ink lines, a pale ink shading of what is dark, and a wet brush tip leading the stroke
      float tip = smoothstep(0.0, 0.03, lineP) * (1.0 - smoothstep(0.03, 0.1, lineP));
      vec3 sketch = mix(paper, inkColor, max(edge * 0.9, (1.0 - smoothstep(0.05, 0.5, l)) * 0.3));
      sketch = mix(sketch, inkColor, tip * 0.35);
      col = mix(mix(paper, sketch, line), col, wash);
    }

    // speed lines: ink streaks running out from the middle of the action
    if (speed > 0.001) {
      vec2 d = off * vec2(res.x / res.y, 1.0);
      float ang = atan(d.y, d.x);
      float n = noise(vec2(ang * 34.0, time * 14.0)) * noise(vec2(ang * 9.0, time * 5.0));
      float m = smoothstep(0.42, 0.62, n) * smoothstep(0.18, 0.75, length(d));
      col = mix(col, inkColor, m * speed * 0.75);
    }

    // the impact frame: for an instant the picture is ink on paper, its reds kept
    if (impact > 0.001) {
      float red = smoothstep(0.2, 0.4, pre.r - max(pre.g, pre.b));
      vec3 two = l < 0.42 + noise(uv * res / 6.0) * 0.08 ? inkColor : vec3(0.95, 0.93, 0.88);
      two = mix(two, vec3(0.75, 0.12, 0.08), red);
      col = mix(col, two, impact);
    }

    // the corner wash and the paper, baked (see PAPER)
    col *= texture2D(tPaper, uv).rgb;

    col = mix(col, vec3(1.0, 0.98, 0.94), flash);
    gl_FragColor = vec4(col, 1.0);
  }`;

/** `depth` for the target the room is drawn into; the passes after it need none. */
/** What the paper does to the picture, fixed to the screen, so it is worked out once per size
 * rather than with five noises a pixel every frame: an ink wash pooling in the corners, ragged
 * rather than a clean circle, and the paper's fine tooth and long fibres. */
const PAPER = /* glsl */ `
  uniform vec2 res;
  uniform float vignette;
  uniform float grain;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 uv = vUv;
    vec2 v = (uv - 0.5) * vec2(res.x / res.y, 1.0);
    float vw = smoothstep(0.45, 1.25, length(v) + (noise(uv * 4.0 + 3.0) - 0.5) * 0.25);
    vec3 k = mix(vec3(1.0), vec3(0.5, 0.49, 0.47), vw * vignette);
    float tooth = noise(uv * res / 1.6) - 0.5;
    float fibre = noise(vec2(uv.x * res.x / 3.0, uv.y * res.y / 70.0) + noise(uv * 7.0) * 4.0) - 0.5;
    gl_FragColor = vec4(k * (1.0 + (tooth * 0.07 + fibre * 0.05) * grain), 1.0);
  }`;

function target(w: number, h: number, depth = false, samples = 0): WebGLRenderTarget {
  return new WebGLRenderTarget(w, h, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: depth, samples });
}

export class Post {
  /** Draw the frame into this, then call `present`. */
  readonly target: WebGLRenderTarget;
  private readonly half1: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly half2: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly scene = new Scene();
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly bright = new ShaderMaterial({ vertexShader: VERT, fragmentShader: BRIGHT, uniforms: { tSrc: { value: null }, texel: { value: new Vector2() }, gate: { value: 1 } }, depthTest: false, depthWrite: false });
  private readonly blur = new ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, uniforms: { tSrc: { value: null }, dir: { value: new Vector2() } }, depthTest: false, depthWrite: false });
  private readonly final: ShaderMaterial;
  private readonly paperT: WebGLRenderTarget;
  private readonly paperMat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: PAPER, uniforms: { res: { value: new Vector2() }, vignette: { value: 0.85 }, grain: { value: 1 } }, depthTest: false, depthWrite: false });
  /** The paper is baked again on the next frame. */
  private stale = true;
  private readonly size = new Vector2();
  /** The punches, each decaying back to 0 (see kick). */
  ca = 0;
  smear = 0;
  impact = 0;
  speed = 0;
  flash = 0;
  /** Off skips the glow's blur passes (to weigh what they cost). */
  bloomOn = true;
  /** Monsters hold the room: its colour drains away (slowly), and comes back with `restore`. */
  drained = false;
  /** How drained the picture is (0: full colour, 1: ink). */
  private grey = 0;
  /** Seconds into the wash of colour coming back (`restore`), or -1. */
  private washT = -1;
  /** Seconds into painting the scene in (`reveal`), or how long it takes; `revealT` of `revealLen`. */
  private revealT = 1;
  private revealLen = 1;
  private revealHeld = false;
  /** Seconds into the ink seeping down from the top (`seep`), or -1; how long it takes. */
  private seepT = -1;
  private seepLen = 1;

  /** `samples`: MSAA on the scene's target. Resolving a multisampled half-float target costs a
   * Mali phone (A16) more than the rest of the effects together (19 fps against 42), so none by default. */
  constructor(renderer: WebGLRenderer, samples = 0) {
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.target = target(w, h, true, samples);
    this.half1 = [target(w >> 2, h >> 2), target(w >> 2, h >> 2)];
    this.half2 = [target(w >> 3, h >> 3), target(w >> 3, h >> 3)];
    this.paperT = target(w, h);
    this.final = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FINAL,
      uniforms: {
        tScene: { value: this.target.texture },
        tBloom1: { value: this.half1[0].texture },
        tBloom2: { value: this.half2[0].texture },
        res: { value: new Vector2(w, h) },
        time: { value: 0 },
        center: { value: new Vector2(0.5, 0.5) },
        ca: { value: 0 },
        smear: { value: 0 },
        impact: { value: 0 },
        speed: { value: 0 },
        flash: { value: 0 },
        tPaper: { value: this.paperT.texture },
        bloom: { value: 1 },
        paper: { value: new Color(0xf1ece0) },
        inkColor: { value: new Color(0x16151a) },
        grey: { value: 0 },
        washAt: { value: new Vector2(0.5, 0.5) },
        washR: { value: 0 },
        washFade: { value: 0 },
        reveal: { value: 1 },
        seep: { value: 9 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(QUAD, this.final);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** The paper colour of the scene being shown (sRGB hex), which the grade leans towards. */
  set paper(hex: number) {
    (this.final.uniforms.paper.value as Color).setHex(hex).convertLinearToSRGB();
  }

  /** Where the action is, in 0..1 screen coordinates (y up): the smear and speed lines centre on it. */
  focus(x: number, y: number): void {
    (this.final.uniforms.center.value as Vector2).set(x, y);
  }

  /** The colour flows back into a drained room, spreading from (`x`, `y`) in 0..1 screen coordinates
   * (y up) across the screen in `WASH_SEC`. */
  restore(x: number, y: number): void {
    if (this.grey < 0.01) return;
    (this.final.uniforms.washAt.value as Vector2).set(x, y);
    this.washT = 0;
  }

  /** Only paper shows until `reveal`. */
  blank(): void {
    this.revealT = 0;
    this.revealHeld = true;
  }

  /** The scene painted in over `sec` seconds: outlines first, then the colour. */
  reveal(sec = 3.2): void {
    this.revealT = 0;
    this.revealLen = sec;
    this.revealHeld = false;
  }

  /** Ink seeps down from the top edge over `sec` seconds, draining the picture as it goes (where
   * monsters hold the room; it is the drain, come in from above instead of all at once). */
  seep(sec = 2.6): void {
    this.seepT = 0;
    this.seepLen = sec;
  }

  /** The ink is still running down. */
  get seeping(): boolean {
    return this.seepT >= 0;
  }

  /** The paper is still being painted on. */
  get revealing(): boolean {
    return this.revealT < this.revealLen;
  }

  resize(renderer: WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.size);
    const { x: w, y: h } = this.size;
    this.target.setSize(w, h);
    for (const t of this.half1) t.setSize(w >> 2, h >> 2);
    for (const t of this.half2) t.setSize(w >> 3, h >> 3);
    this.paperT.setSize(w, h);
    this.stale = true;
    (this.final.uniforms.res.value as Vector2).set(w, h);
  }

  private pass(renderer: WebGLRenderer, m: ShaderMaterial, to: WebGLRenderTarget | null): void {
    this.quad.material = m;
    renderer.setRenderTarget(to);
    renderer.render(this.scene, this.cam);
  }

  private blurInto(renderer: WebGLRenderer, pair: [WebGLRenderTarget, WebGLRenderTarget], src: Texture, w: number, h: number): void {
    this.bright.uniforms.tSrc.value = src;
    // the first level keeps only what is past white; the second spreads the first wider
    this.bright.uniforms.gate.value = pair === this.half1 ? 1 : 0;
    (this.bright.uniforms.texel.value as Vector2).set(0.5 / w, 0.5 / h);
    this.pass(renderer, this.bright, pair[0]);
    for (let i = 0; i < 2; i++) {
      this.blur.uniforms.tSrc.value = pair[0].texture;
      (this.blur.uniforms.dir.value as Vector2).set((i + 1) / pair[0].width, 0);
      this.pass(renderer, this.blur, pair[1]);
      this.blur.uniforms.tSrc.value = pair[1].texture;
      (this.blur.uniforms.dir.value as Vector2).set(0, (i + 1) / pair[0].height);
      this.pass(renderer, this.blur, pair[0]);
    }
  }

  /** Puts the frame drawn into `target` on the screen, `dt` seconds after the last. */
  present(renderer: WebGLRenderer, dt: number, t: number): void {
    const auto = renderer.autoClear;
    renderer.autoClear = true;
    const w = this.target.width;
    const h = this.target.height;
    if (this.stale) {
      this.stale = false;
      (this.paperMat.uniforms.res.value as Vector2).set(w, h);
      this.pass(renderer, this.paperMat, this.paperT);
    }
    const u = this.final.uniforms;
    if (this.bloomOn) {
      this.blurInto(renderer, this.half1, this.target.texture, w, h);
      this.blurInto(renderer, this.half2, this.half1[0].texture, w >> 2, h >> 2);
    }
    u.bloom.value = this.bloomOn ? 1 : 0;
    u.time.value = t;
    u.ca.value = this.ca;
    u.smear.value = this.smear;
    u.impact.value = this.impact > 0 ? 1 : 0;
    u.speed.value = this.speed;
    u.flash.value = this.flash;
    if (this.washT >= 0) {
      this.washT += dt;
      const k = Math.min(1, this.washT / WASH_SEC);
      // fast out of the kill, slowing as it reaches the far corner (an ink drop spreading in water)
      const at = u.washAt.value as Vector2;
      const aspect = w / h;
      const far = Math.hypot(Math.max(at.x, 1 - at.x) * aspect, Math.max(at.y, 1 - at.y)) + 0.25;
      u.washR.value = (1 - (1 - k) ** 1.5) * far;
      u.washFade.value = 1 - k;
      if (k >= 1) {
        this.washT = -1;
        this.grey = 0;
      }
    } else {
      u.washR.value = 0;
      this.grey = this.drained ? Math.min(1, this.grey + dt / DRAIN_SEC) : Math.max(0, this.grey - dt / DRAIN_SEC);
    }
    if (this.seepT >= 0) {
      this.seepT += dt;
      const k = Math.min(1, this.seepT / this.seepLen);
      // it gathers, then runs: slow off the edge, quicker down the sheet
      u.seep.value = k * k * (3 - 2 * k) * 1.8;
      if (this.drained) this.grey = 1;
      if (k >= 1) this.seepT = -1;
    } else u.seep.value = 9;
    u.grey.value = this.grey;
    if (!this.revealHeld && this.revealT < this.revealLen) this.revealT = Math.min(this.revealLen, this.revealT + dt);
    u.reveal.value = this.revealHeld ? 0 : this.revealT / this.revealLen;
    this.pass(renderer, this.final, null);
    renderer.autoClear = auto;
    // every punch dies away on its own
    this.ca = Math.max(0, this.ca - dt * 6);
    this.smear = Math.max(0, this.smear - dt * 5);
    this.impact = Math.max(0, this.impact - dt);
    this.speed = Math.max(0, this.speed - dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 6);
  }
}
