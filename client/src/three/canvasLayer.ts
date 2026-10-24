import { CanvasTexture, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, SRGBColorSpace, Scene, type WebGLRenderer } from 'three';

// A 2D canvas laid over the 3D picture, for screens drawn without a DOM (the WeChat mini-game's
// section select and section-end card): drawn in CSS pixels at the screen's pixel ratio, uploaded
// as a texture only when it changed, and put over whatever the renderer last drew.

export class CanvasLayer {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  width = 0;
  height = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly dpr: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d')!;
    const tex = (this.texture = new CanvasTexture(this.canvas));
    tex.colorSpace = SRGBColorSpace;
    tex.generateMipmaps = false;
    const quad = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Sizes the canvas to the view (CSS px); whether it changed. */
  resize(w: number, h: number): boolean {
    if (w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    // a resized texture must be made again on the GPU
    this.texture.dispose();
    return true;
  }

  /** Clears the canvas and sets it up for drawing in CSS px. */
  begin(): CanvasRenderingContext2D {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.texture.needsUpdate = true;
    return g;
  }

  /** Draws the canvas over the screen; `alone`: on a cleared screen, nothing of the scene under it. */
  present(alone: boolean): void {
    const r = this.renderer;
    r.setRenderTarget(null);
    const auto = r.autoClear;
    r.autoClear = alone;
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }
}
