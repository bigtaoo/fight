import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Texture } from 'three';

// The village's folding screen (design/CHAPTER1.md, the end of 1-1 and the way into 1-2): four
// gold panels in a red lacquer frame, folded in a zig-zag, standing at the back of the threshing
// floor. `seep` makes ink well up out of the paintings and run over the frame, the first sign
// that the screen is a way in. Its faces are cut from the k3 keyframe (public/art/props/
// screen_panels.jpg, see the .txt beside it). A prop of its own so the way into the screen (the
// transition into 1-2) can stand the same one wherever it needs it.

/** One panel's size (world units: the hero is about 230 tall) and how far each is turned. */
export const SCREEN_PANEL_W = 120;
export const SCREEN_PANEL_H = 330;
const FOLD = (22 * Math.PI) / 180;
const FRAME = 10;
const FEET = 26;
const LACQUER = new MeshBasicMaterial({ color: 0x7a1e16, toneMapped: false });

/** Ink welling up from a few spots on each panel and running down; `seep` 0 (none) to 1 (the
 * panels drowned but for their edges). */
const SEEP = /* glsl */ `
  #include <map_fragment>
  {
    vec2 p = vUv * vec2(4.0, 1.0);
    float n = fract(sin(dot(floor(p * vec2(24.0, 60.0)), vec2(12.9898, 78.233))) * 43758.5453);
    float cell = fract(p.x);
    // a spring at each panel's heart, a second lower down, and drips running from both
    float d = min(length(vec2(cell - 0.5, (vUv.y - 0.62) * 0.5)), length(vec2(cell - 0.42, (vUv.y - 0.3) * 0.6)) + 0.08);
    float drip = (1.0 - vUv.y) * 0.18 * step(0.75, fract(sin(floor(p.x * 9.0) * 91.7) * 4375.5));
    float r = seep * 0.75 + drip * seep;
    float inked = 1.0 - smoothstep(r - 0.02, r + 0.02, d + n * 0.04);
    float wet = smoothstep(r - 0.05, r, d + n * 0.04) * inked;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.055, 0.05) + wet * 0.08, inked * 0.92);
  }
`;

export class FoldingScreen {
  readonly root = new Group();
  private readonly face: MeshBasicMaterial;
  private readonly seepU = { value: 0 };

  /** `base`: where the props' pictures are. */
  constructor(base: string) {
    this.face = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, toneMapped: false });
    this.face.onBeforeCompile = (shader) => {
      shader.uniforms.seep = this.seepU;
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform float seep;\nvoid main() {').replace('#include <map_fragment>', SEEP);
    };
    // the define for vUv without a map yet, so one program serves before and after the picture
    this.face.defines = { USE_UV: '' };
    new TextureLoader().load(`${base}screen_panels.jpg`, (t: Texture) => {
      t.colorSpace = SRGBColorSpace;
      this.face.map = t;
      this.face.needsUpdate = true;
    });
    const w = SCREEN_PANEL_W;
    const h = SCREEN_PANEL_H;
    // each panel's own slice of the picture
    let x = 0;
    for (let i = 0; i < 4; i++) {
      const panel = new Group();
      const geo = new PlaneGeometry(w, h);
      const uv = geo.attributes.uv;
      for (let j = 0; j < uv.count; j++) uv.setX(j, (i + uv.getX(j)) / 4);
      const face = new Mesh(geo, this.face);
      face.position.set(w / 2, FEET + h / 2, 0);
      panel.add(face);
      // the lacquer frame: two stiles with feet, a top and a bottom rail
      for (const sx of [0, w]) {
        const stile = new Mesh(new BoxGeometry(FRAME, h + FEET + FRAME, FRAME), LACQUER);
        stile.position.set(sx, (h + FEET + FRAME) / 2, 0);
        panel.add(stile);
      }
      for (const y of [FEET, FEET + h]) {
        const rail = new Mesh(new BoxGeometry(w, FRAME, FRAME * 0.8), LACQUER);
        rail.position.set(w / 2, y, 0);
        panel.add(rail);
      }
      // zig-zag: the panels alternately angled back and forward, hinged at their shared edge
      const turn = i % 2 === 0 ? FOLD : -FOLD;
      panel.position.set(x, 0, i % 2 === 0 ? 0 : -Math.sin(FOLD) * w);
      panel.rotation.y = turn;
      x += Math.cos(FOLD) * w;
      this.root.add(panel);
    }
    this.root.userData.width = x;
  }

  /** How wide it stands along the room. */
  get width(): number {
    return this.root.userData.width as number;
  }

  /** How far the ink has welled up out of the panels (0 to 1). */
  set seep(k: number) {
    this.seepU.value = k;
  }

  get seep(): number {
    return this.seepU.value;
  }
}
