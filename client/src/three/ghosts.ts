import { Group, MeshBasicMaterial, type Bone, type Object3D, type SkinnedMesh } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Model } from './actor';

// Afterimages of a dash: copies of a body left behind in a thin ink wash, each holding the pose it
// was given and fading out. A few are made up front and reused, so a dash builds nothing. One
// resting is taken out of the room, not just hidden: a hidden clone's bones would still be walked
// every frame (8 skeletons cost an A16 about 2 ms a frame).

const LIFE = 0.3;

interface Ghost {
  root: Group;
  body: Object3D;
  bones: Bone[];
  mat: MeshBasicMaterial;
  age: number;
}

export class Ghosts {
  readonly root = new Group();
  private readonly pool: Ghost[] = [];
  private next = 0;

  constructor(model: Model, n = 6, color = 0x24304a) {
    for (let i = 0; i < n; i++) {
      const body = SkeletonUtils.clone(model.scene);
      const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
      const bones: Bone[] = [];
      body.traverse((o) => {
        const m = o as SkinnedMesh;
        if (m.isSkinnedMesh) {
          m.material = mat;
          m.frustumCulled = false;
        }
        if ((o as Bone).isBone) bones.push(o as Bone);
      });
      const root = new Group();
      root.add(body);
      root.renderOrder = 1;
      this.pool.push({ root, body, bones, mat, age: LIFE });
    }
  }

  /** Leaves an afterimage of `src` (an Actor's posed body, its parent placed in the room). */
  leave(src: Object3D, alpha = 0.4): void {
    const g = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    g.root.position.copy(src.parent!.position);
    g.body.rotation.copy(src.rotation);
    g.body.scale.copy(src.scale);
    let i = 0;
    src.traverse((o) => {
      if (!(o as Bone).isBone) return;
      const b = g.bones[i++];
      if (!b) return;
      b.position.copy(o.position);
      b.quaternion.copy(o.quaternion);
      b.scale.copy(o.scale);
    });
    g.age = 0;
    g.mat.userData.peak = alpha;
    this.root.add(g.root);
  }

  update(dt: number): void {
    for (const g of this.pool) {
      if (g.age >= LIFE) {
        if (g.root.parent) g.root.removeFromParent();
        continue;
      }
      g.age += dt;
      const k = Math.min(1, g.age / LIFE);
      g.mat.opacity = (g.mat.userData.peak ?? 0.4) * (1 - k) * (1 - k);
    }
  }

  /** All shown for a moment (so their shader is built with the rest at the start). */
  warm(on: boolean): void {
    for (const g of this.pool) {
      if (on) this.root.add(g.root);
      else g.root.removeFromParent();
    }
  }
}
