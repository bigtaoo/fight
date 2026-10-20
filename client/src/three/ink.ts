import { BackSide, Color, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RedFormat, type Material, type SkinnedMesh, type Texture } from 'three';

// The ink look on a 3D body: flat bands of light instead of smooth shading (a toon ramp), and an
// ink line round the silhouette drawn as the body's own mesh pushed out along its normals and
// shown from the back (the inverted hull), so it follows the skinning for free.

export const INK = 0x111014;

/** Light in three bands: shadow, half, lit. */
function ramp(): DataTexture {
  const t = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

const RAMP = ramp();

/** The body's own colours under the ramp. `tint` multiplies them (another kind on the same model). */
export function bodyMaterial(map: Texture | null, tint = 0xffffff): MeshToonMaterial {
  return new MeshToonMaterial({ map, gradientMap: RAMP, color: new Color(tint) });
}

/** The outline: `width` in the mesh's own units. */
export function outlineMaterial(width: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: INK, side: BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outline = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float outline;\nvoid main() {')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * outline;');
  };
  return m;
}

/** Draws `mesh` twice from the same skinning: its body, then the outline. */
export function inkMesh(mesh: SkinnedMesh, body: Material, outline: Material): void {
  const g = mesh.geometry;
  const count = g.index ? g.index.count : g.attributes.position.count;
  g.clearGroups();
  g.addGroup(0, count, 0);
  g.addGroup(0, count, 1);
  mesh.material = [body, outline];
}
