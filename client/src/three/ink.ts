import { BackSide, Color, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RedFormat, type Material, type SkinnedMesh, type Texture, type WebGLProgramParametersWithUniforms } from 'three';

// The ink look on a 3D body: flat bands of light instead of smooth shading (a toon ramp), and an
// ink line round the silhouette drawn as the body's own mesh pushed out along its normals and
// shown from the back (the inverted hull), so it follows the skinning for free.

export const INK = 0x111014;
/** The red of seals and cinnabar ink. */
export const CINNABAR = 0xb3261e;

/** Light in three bands: shadow, half, lit. */
function ramp(): DataTexture {
  const t = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

export const RAMP = ramp();

/** The filmic curve three applies on the way to the screen (ACES, exposure 1.05), done in the lit
 * materials' own shaders instead. three leaves it out when it draws into a texture, which the
 * effects pass (post.ts) does, and the painted layers and the glows must not be curved at all; so
 * the renderer itself never tone maps, and the picture is the same with or without the effects. */
const ACES = /* glsl */ `
vec3 inkAces( vec3 color ) {
  const mat3 ACESInputMat = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
  const mat3 ACESOutputMat = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
  color *= 1.05 / 0.6;
  color = ACESInputMat * color;
  vec3 a = color * ( color + 0.0245786 ) - 0.000090537;
  vec3 b = color * ( 0.983729 * color + 0.4329510 ) + 0.238081;
  return clamp( ACESOutputMat * ( a / b ), 0.0, 1.0 );
}
`;

/** Puts the filmic curve into a lit material's fragment shader (see ACES). */
export function bakeTone(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${ACES}\nvoid main() {`)
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = inkAces( gl_FragColor.rgb );');
}

/** A body breaking up into ink as it dies: `dissolve` from 0 (whole) to 1 (gone), eaten from the
 * head down through a ragged noise, with a burning cinnabar rim (bright enough to glow). The noise
 * is in the model's rest-pose units, so the holes stay put on the body as it moves. */
const DISSOLVE_PARS = /* glsl */ `
uniform float dissolve;
varying vec3 vRest;
float inkHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float inkNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( inkHash( i ), inkHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( inkHash( i + vec3( 0, 1, 0 ) ), inkHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( inkHash( i + vec3( 0, 0, 1 ) ), inkHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( inkHash( i + vec3( 0, 1, 1 ) ), inkHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;
/** How far into the dissolve a fragment goes: 0 the first, 1 the last. */
const DISSOLVE_KEY = 'float key = 0.55 * ( inkNoise( vRest * 14.0 ) * 0.7 + inkNoise( vRest * 40.0 ) * 0.3 ) + 0.45 * clamp( 1.0 - vRest.y, 0.0, 1.0 );';

function withDissolve(shader: WebGLProgramParametersWithUniforms, material: Material, rim: boolean): void {
  shader.uniforms.dissolve = material.userData.dissolve;
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec3 vRest;\nvoid main() {\nvRest = position;')
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${DISSOLVE_PARS}\nvoid main() {\n${DISSOLVE_KEY}\nif ( key < dissolve * 1.15 ) discard;`)
    .replace(
      '#include <dithering_fragment>',
      rim ? '#include <dithering_fragment>\nif ( dissolve > 0.0 && key < dissolve * 1.15 + 0.025 ) gl_FragColor.rgb = vec3( 2.0, 0.3, 0.12 );' : '#include <dithering_fragment>',
    );
}

/** The body's own colours under the ramp. `tint` multiplies them (another kind on the same model).
 * Each body has its own, so it can flash and dissolve on its own; they all share one shader. */
export function bodyMaterial(map: Texture | null, tint = 0xffffff): MeshToonMaterial {
  const m = new MeshToonMaterial({ map, gradientMap: RAMP, color: new Color(tint) });
  m.userData.dissolve = { value: 0 };
  m.onBeforeCompile = function (this: Material, shader) {
    bakeTone(shader);
    withDissolve(shader, this, true);
  };
  return m;
}

/** The outline: `width` in the mesh's own units. */
export function outlineMaterial(width: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: INK, side: BackSide });
  m.userData = { width, dissolve: { value: 0 } };
  m.onBeforeCompile = function (this: Material, shader) {
    shader.uniforms.outline = { value: this.userData.width };
    withDissolve(shader, this, false);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float outline;\nvoid main() {')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * outline;');
  };
  return m;
}

/** A body's own copy of an outline (the same shader), so it can dissolve with the body. */
export function ownOutline(m: MeshBasicMaterial): MeshBasicMaterial {
  const c = m.clone();
  c.userData = { width: m.userData.width, dissolve: { value: 0 } };
  c.onBeforeCompile = m.onBeforeCompile;
  return c;
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
