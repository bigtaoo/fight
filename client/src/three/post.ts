import { Color, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three';

// The effects pass: the frame is drawn into a half-float texture (so flames and sparks can be
// brighter than white), then put on the screen through one pass that adds a two-level bloom of
// what is past white and finishes the picture in the ink look: a slight grade towards paper, an ink
// wash in the corners, paper grain, and the punches of a fight (chromatic split and a radial
// smear on heavy hits, a two-tone impact frame on crits, speed lines on skills, a white flash).

const QUAD = new PlaneGeometry(2, 2);
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
