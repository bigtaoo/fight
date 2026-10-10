import { BODIES, HERO, MOVES, TICK_RATE, WORLD, armored, fromFp, guarding, type Entity } from '@dnf/engine';
import { ColorMatrixFilter, Container, Graphics, Sprite } from 'pixi.js';
import { floorY, lerp } from './layout';
import type { SpriteSet } from './sprites';
import { TaoActor, type TaoAsset } from './tao/TaoActor';

// One body: a floor shadow, the figure, the brush arc of an active move, a health bar over hurt
// monsters. A rigged body (the hero and the monsters) plays its skeleton: clip time comes from the
// sim tick for moves, so the cut lands on the active frames and freezes with the hitstop, and
// from the distance covered for walking and running, so the feet stay planted. The other
// bodies (the dummy) show one still painting per state (ink blocks when those did not load),
// and the motion between them is faked here: anticipation lean, bob, squash, tumble. Feedback lives here too: a white flash and
// a shake while frozen by a hit.

const INK = {
  hero: { body: 0x17161a, band: 0xc8281e },
  bandit: { body: 0x6f7480, band: 0x34466b },
  archer: { body: 0x6b6a58, band: 0x8a4a2a },
  shield: { body: 0x55595f, band: 0x7a2e24 },
  dummy: { body: 0x9a8a68, band: 0x6a5c40 },
} as const;

const PREFIX = { hero: 'hero', bandit: 'mob', archer: 'archer', shield: 'shield', dummy: 'dummy' } as const;

/** Brush arc of each move in a right-facing frame: angles in radians from forward (negative is
 * up), centre height above the feet, radius as a share of the box reach. */
const ARCS: Record<string, { a0: number; a1: number; cz: number; r: number; w: number }> = {
  atk1: { a0: -0.9, a1: 0.4, cz: 130, r: 0.8, w: 0.22 },
  atk2: { a0: 0.7, a1: -1.4, cz: 130, r: 0.8, w: 0.22 },
  atk3: { a0: -1.7, a1: 0.8, cz: 140, r: 0.85, w: 0.32 },
  jumpAtk: { a0: -0.7, a1: 1.3, cz: 90, r: 0.9, w: 0.26 },
  upper: { a0: 1.1, a1: -1.8, cz: 120, r: 0.85, w: 0.3 },
  slash: { a0: -1.5, a1: 0.7, cz: 150, r: 0.8, w: 0.26 },
  tri1: { a0: -0.9, a1: 0.4, cz: 130, r: 0.8, w: 0.22 },
  tri2: { a0: 0.7, a1: -1.4, cz: 130, r: 0.8, w: 0.22 },
  tri3: { a0: -1.7, a1: 0.8, cz: 140, r: 0.85, w: 0.32 },
  dragon4: { a0: 1.1, a1: -1.8, cz: 120, r: 0.85, w: 0.3 },
  crush2: { a0: 1.2, a1: -1.9, cz: 120, r: 0.8, w: 0.34 },
  // the gathered cut: one flat sweep wide round the hero
  iai: { a0: -2.6, a1: 0.5, cz: 110, r: 0.55, w: 0.18 },
  // the dance: cuts this way and that, a new one each time the hit list clears (see phantomArc)
  phantomA: { a0: -1.2, a1: 0.9, cz: 140, r: 0.9, w: 0.2 },
  phantomB: { a0: 1.0, a1: -1.3, cz: 120, r: 0.9, w: 0.2 },
};

/** The hero's skills have no clips of their own yet (colour blocks): each part plays the clip of
 * a move like it, timed so the clip's strike lands on the part's (see proxyTime). */
const PROXY: Record<string, string> = {
  tri1: 'atk1',
  tri2: 'atk2',
  tri3: 'atk3',
  dragon1: 'dash',
  dragon2: 'dash',
  dragon3: 'dash',
  dragon4: 'upper',
  crush1: 'dash',
  crush2: 'upper',
  iai: 'atk3',
  phantomEnd: 'atk3',
};
/** The first active tick of each clip a proxy can play (the moves they were keyed to). */
const STRIKE: Record<string, number> = { atk1: 3, atk2: 3, atk3: 4, upper: 4, dash: 3 };
/** Ticks of each cut of the phantom dance (two hits of its rehit 3). */
const DANCE_CUT = 6;

/** Per rigged kind: world height standing at rest, and the world distance one walk / run cycle
 * (two steps) covers, measured from the stride of the clip's keys at that height. */
const RIG_SIZE: Partial<Record<Entity['kind'], { height: number; walk: number; run: number }>> = {
  hero: { height: 240, walk: 176, run: 250 },
  bandit: { height: 250, walk: 141, run: 141 },
  archer: { height: 236, walk: 168, run: 168 },
  shield: { height: 250, walk: 128, run: 128 },
};
/** The archer's bow tips in the bow bone's space (skeleton units from the grip), from the
 * tips tools/draw_sword.py prints, turned upright as art/rig_archer/make_split.py places it
 * (-90 degrees) and scaled like the pack (0.34): string side back, upper tip first. */
const BOW_TIPS = [
  { x: -13.6, y: -117.6 },
  { x: -13.6, y: 117.6 },
] as const;
/** Ticks of the shot in which the drawing hand holds the string (art/rig_archer/anims.py
 * nocks on 8; the arrow leaves on the move's fire tick). */
const NOCK_TICK = 8;
/** Real seconds of cross-fade into a move (short, so it answers the button), into a hit
 * reaction (shorter: it must snap), and between other clips. */
const FADE_MOVE = 0.08;
const FADE_HURT = 0.05;
const FADE = 0.12;

/** Paints the sprite pure white, for the hit flash. */
const WHITE = new ColorMatrixFilter();
WHITE.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];

interface Look {
  name: string;
  /** Rotation, positive turns the body forward. */
  rot: number;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** Rotate about the middle of the body (tumbling) instead of the feet. */
  centre: boolean;
}

export class BodyView {
  readonly root = new Container();
  private readonly shadow = new Graphics();
  private readonly body = new Graphics();
  private readonly sprite = new Sprite();
  private readonly fxg = new Graphics();
  private readonly bar = new Graphics();
  private readonly rigRoot = new Container();
  private readonly actor: TaoActor | null;
  /** Distance walked or run so far, which drives the step cycle, and where it was last frame. */
  private dist = 0;
  private last: { x: number; y: number } | null = null;
  private lastState: Entity['state'] | null = null;
  private clock = 0;
  /** Render frames left of the white hit flash, and shake ticks left. */
  flash = 0;
  shake = 0;

  constructor(readonly id: number, private readonly sprites: SpriteSet | null, rig: TaoAsset | null = null) {
    this.actor = rig ? new TaoActor(rig) : null;
    if (this.actor) this.rigRoot.addChild(this.actor.view);
    this.root.addChild(this.shadow, this.body, this.sprite, this.rigRoot, this.fxg, this.bar);
  }

  draw(e: Entity, alpha: number, frame: number, dt: number, debug: boolean): void {
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    const z = lerp(e.pz, e.z, alpha);
    const b = BODIES[e.kind];
    const hw = fromFp(b.halfWidth);
    const h = fromFp(b.height);
    const jitter = this.shake > 0 ? (frame % 2 === 0 ? 5 : -5) : 0;
    this.root.position.set(x + jitter, floorY(y));
    this.root.zIndex = y;
    this.root.alpha = e.state === 'dead' ? Math.max(0, 1 - e.st / WORLD.fadeTicks) : 1;

    const s = this.shadow.clear();
    const shrink = Math.max(0.4, 1 - z / 400);
    s.ellipse(0, 0, hw * 1.6 * shrink, 14 * shrink).fill({ color: 0x2a2620, alpha: 0.22 });

    const g = this.body.clear();
    const fx = this.fxg.clear();
    if (this.actor) {
      this.drawRig(this.actor, e, x, y, z, alpha, dt);
    } else if (this.sprites && this.painted(e)) {
      this.drawSprite(e, z, frame, alpha);
    } else {
      this.sprite.visible = false;
      this.drawBlocks(g, e, z, hw, h);
    }
    if (e.kind === 'archer') {
      if (this.actor) this.drawString(fx, this.actor, e, alpha);
      else this.drawBow(fx, e, z, alpha);
    }
    if (e.kind === 'shield' && !this.actor) this.drawShield(fx, e, z, hw, alpha);
    if (e.state === 'act') this.strike(fx, e, z, alpha, debug);
    if (armored(e)) {
      // super armour: a red ring of ink about the body, pulsing
      const k = 0.5 + 0.5 * Math.sin(frame / 3);
      fx.ellipse(0, -z - h / 2, hw + 26, h / 2 + 20).stroke({ width: 4 + 3 * k, color: 0xc8281e, alpha: 0.35 + 0.3 * k });
    }
    if (!this.actor) this.root.alpha *= e.inv > 0 && frame % 4 < 2 ? 0.4 : 1;
    if (debug) fx.rect(-hw, -z - h, hw * 2, h).stroke({ width: 1, color: 0x2a7a3a });

    const bar = this.bar.clear();
    if (e.team === 1 && e.kind !== 'dummy' && e.hp < e.maxHp && e.hp > 0) {
      const w = 90;
      bar.rect(-w / 2, -z - h - 30, w, 8).fill({ color: 0x000000, alpha: 0.35 });
      bar.rect(-w / 2, -z - h - 30, (w * e.hp) / e.maxHp, 8).fill(0x34466b);
    }
  }

  private drawRig(actor: TaoActor, e: Entity, x: number, y: number, z: number, alpha: number, dt: number): void {
    this.clock += dt;
    // a jump of more than a stride between frames is a room change, not a step
    const moved = this.last ? Math.hypot(x - this.last.x, y - this.last.y) : 0;
    // backing away while facing the hero (the archer keeping its distance) steps backward
    const back = this.last !== null && (x - this.last.x) * e.facing < 0 && Math.abs(x - this.last.x) > Math.abs(y - this.last.y);
    this.last = { x, y };
    if (moved < 100) this.dist += back ? -moved : moved;
    // a walk or run started from a stand begins at the clip's first step, not wherever the
    // distance walked so far happens to fall in the cycle
    const moving = (s: Entity['state'] | null) => s === 'walk' || s === 'run';
    if (moving(e.state) && !moving(this.lastState)) this.dist = 0;
    this.lastState = e.state;
    // positions are drawn between the last tick and this one (lerp(px, x, alpha)), so the clip
    // time is too; in hitstop the body holds this tick's pose, which is where it got to, and so
    // a hit freezes the cut instead of throwing it back a tick
    const sec = Math.max(0, e.held ? e.st : e.st - 1 + alpha) / TICK_RATE;
    const vz = fromFp(e.vz);
    const size = RIG_SIZE[e.kind] ?? RIG_SIZE.hero!;
    let clip = 'idle';
    let time = this.clock;
    let fade = FADE;
    let tumble = 0;
    let scrub = false;
    switch (e.state) {
      case 'walk':
        clip = 'walk';
        time = this.dist / size.walk;
        break;
      case 'run':
        clip = 'run';
        time = this.dist / size.run;
        break;
      case 'jump':
        clip = 'jump';
        time = Math.min(1, Math.max(0, 0.5 - vz / (2 * fromFp(HERO.jumpVz))));
        break;
      case 'act': {
        fade = FADE_MOVE;
        if (e.move === 'backstep') {
          clip = 'jump';
          time = Math.min(1, Math.max(0, 0.5 - vz / (2 * fromFp(MOVES.backstep.hop!.up))));
          break;
        }
        const p = this.proxy(actor, e, sec * TICK_RATE);
        clip = p.clip;
        time = p.time;
        scrub = e.move === 'phantom';
        // out of the dance into the last heavy cut: a slower blend, as nothing waits on it
        if (scrub && clip !== 'atk1') fade = FADE;
        break;
      }
      case 'hurt':
      case 'getup':
        clip = e.state;
        time = sec;
        if (e.state === 'hurt') fade = FADE_HURT;
        break;
      case 'air':
        if (z < 30 && vz <= 0) {
          clip = 'down';
          time = 0;
        } else {
          // tumbling backward: leaning back while rising, nearly flat while falling
          clip = 'hurt';
          time = 1;
          tumble = -Math.min(1.4, Math.max(0.25, 0.7 - vz / 40));
        }
        break;
      case 'down':
      case 'dead':
        clip = 'down';
        time = 0;
        break;
    }
    actor.seek(clip, time, dt, fade, scrub);
    this.sprite.visible = false;
    const k = size.height / actor.height;
    const r = this.rigRoot;
    // a tumble turns about the middle of the body, everything else about the feet
    const mid = tumble ? actor.height / 2 : 0;
    r.pivot.set(0, -mid);
    r.position.set(0, -z - mid * k);
    // turning round (the facing flips at the move's end): squeezed through edge-on, so the
    // flip lands where the squeeze has turned the body round already
    const turn = e.state === 'act' && MOVES[e.move].turn ? Math.cos((Math.PI * Math.min(1, sec * TICK_RATE / MOVES[e.move].total))) : 1;
    r.scale.set(e.facing * k * (Math.abs(turn) < 0.08 ? 0.08 * Math.sign(turn || 1) : turn), k);
    r.rotation = tumble * e.facing;
    r.filters = this.flash > 0 ? [WHITE] : [];
    // untouchable (the dodge, a quick rise): flickering
    this.rigRoot.alpha = e.inv > 0 && Math.floor(this.clock * 20) % 2 === 0 ? 0.35 : 1;
    // the shield bearer's shield pales while it guards nothing
    if (e.kind === 'shield') actor.setAlpha('shield', guarding(e) ? 1 : 0.55);
  }

  /** The clip and clip time of tick `t` of the body's move: its own clip, or a proxy's (PROXY)
   * with the windup stretched to the move's and the rest to its recovery; the phantom dance
   * cuts down and back up again on one clip, played forward and backward so each cut starts
   * where the last one ended, and ends on the heavy cut as the wave leaves. */
  private proxy(actor: TaoActor, e: Entity, t: number): { clip: string; time: number } {
    const m = MOVES[e.move];
    if (e.move === 'phantom') {
      const end = m.active[1] + 1;
      // each cut runs from just before the clip's strike to its end, or back
      const from = STRIKE.atk1 - 1;
      if (t < m.active[0]) return { clip: 'atk1', time: (t * from) / m.active[0] / TICK_RATE };
      if (t < end) {
        const k = Math.floor((t - m.active[0]) / DANCE_CUT);
        let u = (t - m.active[0] - k * DANCE_CUT) / DANCE_CUT;
        if (k % 2 === 1) u = 1 - u;
        // eased at both ends, so the blade turns round slowly instead of snapping back
        u = u * u * (3 - 2 * u);
        return { clip: 'atk1', time: (from + u * (actor.duration('atk1') * TICK_RATE - from)) / TICK_RATE };
      }
      // the heavy cut from its windup's top, as the last cut of the dance ended raised
      return { clip: 'atk3', time: proxyTime(t - end, m.fire!.at - end, m.total - end, STRIKE.atk3, actor.duration('atk3'), from) };
    }
    const clip = PROXY[e.move];
    if (!clip) return { clip: e.move, time: t / TICK_RATE };
    const strike = m.active[1] >= m.active[0] ? m.active[0] : (m.fire?.at ?? 0);
    return { clip, time: proxyTime(t, strike, m.total, STRIKE[clip], actor.duration(clip)) };
  }

  /** Whether this kind has paintings; one without (a monster not drawn yet) shows ink blocks. */
  private painted(e: Entity): boolean {
    return this.sprites!.has(e.kind === 'dummy' ? 'dummy' : `${PREFIX[e.kind]}_idle`);
  }

  /** The rigged archer's bowstring, drawn here so it can be pulled: straight between the bow's
   * tips, or to the drawing hand from the nock to the release with the arrow on it, its head
   * glinting red in the last moments; and the lane marked on the floor while it aims. */
  private drawString(g: Graphics, actor: TaoActor, e: Entity, alpha: number): void {
    if (e.state === 'down' || e.state === 'dead') return;
    const to = (p: { x: number; y: number }) => g.toLocal(p, actor.view);
    const top = to(actor.pointIn('bow', BOW_TIPS[0].x, BOW_TIPS[0].y));
    const bottom = to(actor.pointIn('bow', BOW_TIPS[1].x, BOW_TIPS[1].y));
    const ink = 0x2b2620;
    const fire = e.state === 'act' ? MOVES[e.move].fire : undefined;
    const t = e.held ? e.st : e.st - 1 + alpha;
    if (!fire || t < NOCK_TICK || t >= fire.at) {
      g.moveTo(top.x, top.y).lineTo(bottom.x, bottom.y).stroke({ width: 1.5, color: ink, alpha: 0.8 });
      return;
    }
    const nock = to(actor.point('hand_b'));
    const grip = to(actor.point('bow'));
    g.moveTo(top.x, top.y).lineTo(nock.x, nock.y).lineTo(bottom.x, bottom.y).stroke({ width: 1.5, color: ink, alpha: 0.8 });
    // the arrow from the nock through the grip and a little past it
    const dx = grip.x - nock.x;
    const dy = grip.y - nock.y;
    const len = Math.hypot(dx, dy) || 1;
    const head = { x: grip.x + (dx / len) * 14, y: grip.y + (dy / len) * 14 };
    g.moveTo(nock.x, nock.y).lineTo(head.x, head.y).stroke({ width: 3, color: ink });
    const left = fire.at - t;
    if (left <= 7) {
      const k = 1 - left / 7;
      g.circle(head.x, head.y, 6 + 10 * k).fill({ color: 0xc8281e, alpha: 0.25 + 0.5 * k });
    }
    const lane = Math.min(1, t / fire.at);
    const f = e.facing;
    g.rect(f > 0 ? 40 : -40 - 700 * lane, -2, 700 * lane, 4).fill({ color: 0xc8281e, alpha: 0.18 * lane });
  }

  /** The archer's bow, drawn in code (without its rig): held low at rest, raised and drawn back through the draw,
   * a red glint on the arrowhead in the last moments before the release, and its lane marked
   * on the floor while it aims down it. */
  private drawBow(g: Graphics, e: Entity, z: number, alpha: number): void {
    if (e.state === 'down' || e.state === 'dead' || e.state === 'air') return;
    const f = e.facing;
    const fire = e.state === 'act' ? MOVES[e.move].fire : undefined;
    const t = e.held ? e.st : e.st - 1 + alpha;
    const drawing = fire !== undefined && t < fire.at;
    // 0 at rest, 1 fully drawn
    const pull = fire ? (drawing ? Math.min(1, t / (fire.at - 4)) : Math.max(0, 1 - (t - fire.at) / 2)) : 0;
    const raised = fire ? 1 : 0;
    const bx = f * (34 + 14 * raised);
    const by = -z - (raised ? fromFp(fire!.z) : 110);
    const half = 62;
    const ink = 0x2b2620;
    // the limbs: a shallow curve bowing forward
    g.moveTo(bx, by - half).quadraticCurveTo(bx + f * 26, by, bx, by + half).stroke({ width: 5, color: ink });
    const nock = bx - f * (6 + 46 * pull);
    g.moveTo(bx, by - half).lineTo(nock, by).lineTo(bx, by + half).stroke({ width: 1.5, color: ink, alpha: 0.8 });
    if (!drawing) return;
    // the nocked arrow
    g.moveTo(nock, by).lineTo(bx + f * 40, by).stroke({ width: 3, color: ink });
    const left = fire!.at - t;
    if (left <= 7) {
      const k = 1 - left / 7;
      g.circle(bx + f * 42, by, 6 + 10 * k).fill({ color: 0xc8281e, alpha: 0.25 + 0.5 * k });
    }
    // the lane, a thin dry line on the floor ahead
    const lane = Math.min(1, t / fire!.at);
    g.rect(f > 0 ? 40 : -40 - 700 * lane, -2, 700 * lane, 4).fill({ color: 0xc8281e, alpha: 0.18 * lane });
  }

  /** The shield bearer's shield, drawn in code without its rig: a tall board held square in front while it
   * guards, rammed forward in the bash, and swung down to its side (pale: open) through the
   * recovery, while it turns round and when it is knocked about. */
  private drawShield(g: Graphics, e: Entity, z: number, hw: number, alpha: number): void {
    if (e.state === 'down' || e.state === 'dead' || (e.state === 'air' && z < 30 && e.vz <= 0)) return;
    const f = e.facing;
    const ink = 0x2b2620;
    const w = 22;
    const h = 170;
    if (guarding(e)) {
      let dx = hw + 8;
      if (e.state === 'act') {
        // the bash: drawn back through the windup, rammed out on the strike
        const m = MOVES[e.move];
        const t = e.held ? e.st : e.st - 1 + alpha;
        dx += t < m.active[0] ? -10 * Math.min(1, t / m.active[0]) : 36;
      }
      const x = f > 0 ? dx : -dx - w;
      g.rect(x, -z - 40 - h, w, h).fill(ink);
      g.rect(x + (f > 0 ? w - 5 : 0), -z - 40 - h, 5, h).fill(0x8a7a5a);
      // the boss of the shield
      g.circle(x + w / 2, -z - 40 - h / 2, 7).fill(0x8a7a5a);
      return;
    }
    // open: lowered and turned edge-on at its side, too thin to stop anything
    const x = f > 0 ? hw - 4 : -hw - 4;
    g.rect(x, -z - 30 - h * 0.8, 8, h * 0.8).fill({ color: ink, alpha: 0.45 });
  }

  private drawSprite(e: Entity, z: number, frame: number, alpha: number): void {
    const look = this.look(e, z, frame, alpha);
    if (look.name.endsWith('_down') && !this.sprites!.has(look.name)) {
      // no lying painting yet: the standing one laid on its back
      look.name = `${PREFIX[e.kind]}_idle`;
      look.centre = true;
      look.rot = -Math.PI / 2;
      look.dy = 40;
    }
    const pose =this.sprites!.get(look.name) ?? this.sprites!.get(`${PREFIX[e.kind]}_idle`) ?? this.sprites!.get('dummy');
    const sp = this.sprite;
    if (!pose) {
      sp.visible = false;
      return;
    }
    sp.visible = true;
    sp.texture = pose.tex;
    const { w, h, ax, ay, scale } = pose.info;
    const k = scale;
    if (look.centre) {
      sp.anchor.set(ax / w, 0.5);
      sp.position.set(look.dx * e.facing, -z - ((ay - h / 2) * k * look.sy) + look.dy);
    } else {
      sp.anchor.set(ax / w, ay / h);
      sp.position.set(look.dx * e.facing, -z + look.dy);
    }
    sp.scale.set(e.facing * k * look.sx, k * look.sy);
    sp.rotation = look.rot * e.facing;
    sp.filters = this.flash > 0 ? [WHITE] : [];
  }

  /** Which painting a body shows, and how it is bent to fake the motion around it. */
  private look(e: Entity, z: number, frame: number, alpha: number): Look {
    const p = PREFIX[e.kind];
    const l: Look = { name: `${p}_idle`, rot: 0, dx: 0, dy: 0, sx: 1, sy: 1, centre: false };
    if (e.kind === 'dummy') {
      l.name = 'dummy';
      if (e.state === 'hurt') l.rot = -0.08 * Math.max(0, 1 - e.st / 8);
      return l;
    }
    const t = e.st + alpha;
    const vz = fromFp(e.vz);
    switch (e.state) {
      case 'idle':
        l.sy = 1 + 0.012 * Math.sin(frame / 14);
        break;
      case 'walk':
        l.dy = -Math.abs(Math.sin(t * 0.45)) * 5;
        l.rot = 0.03;
        break;
      case 'run':
        l.name = `${p}_run`;
        l.dy = -Math.abs(Math.sin(t * 0.6)) * 7;
        break;
      case 'jump':
        l.name = `${p}_jump`;
        l.rot = vz > 0 ? -0.05 : 0.08;
        break;
      case 'act': {
        const m = MOVES[e.move];
        const windup = e.st < m.active[0];
        if (e.kind === 'bandit') {
          l.name = windup ? `${p}_windup` : `${p}_slash`;
          if (windup) l.rot = -0.1 * (t / m.active[0]);
        } else {
          l.name = `${p}_${e.move.toLowerCase()}`;
          // anticipation: lean back before the cut, snap forward on its first active tick
          if (windup) {
            l.rot = -0.07;
            l.dx = -6;
          } else {
            const since = t - m.active[0];
            l.dx = 8 * Math.max(0, 1 - since / 4);
          }
        }
        break;
      }
      case 'hurt':
        l.name = `${p}_hurt`;
        l.dx = -4 * Math.max(0, 1 - t / 6);
        break;
      case 'air':
        if (z < 30 && vz <= 0) {
          l.name = `${p}_down`;
        } else {
          // tumbling backward: leaning back while rising, nearly flat while falling
          l.name = `${p}_hurt`;
          l.centre = true;
          l.rot = -Math.min(1.4, Math.max(0.25, 0.7 - vz / 40));
        }
        break;
      case 'down':
      case 'dead':
        l.name = `${p}_down`;
        break;
      case 'getup':
        l.sy = 0.75 + 0.25 * Math.min(1, t / WORLD.getupTicks);
        break;
    }
    return l;
  }

  private drawBlocks(g: Graphics, e: Entity, z: number, hw: number, h: number): void {
    const ink = INK[e.kind];
    const white = this.flash > 0;
    const color = white ? 0xfaf7ef : ink.body;
    if (e.state === 'down' || e.state === 'dead' || (e.state === 'air' && z < 30 && e.vz <= 0)) {
      // lying flat, head toward the attacker's side
      g.rect(-h / 2, -42 - z, h, 42).fill(color);
      g.rect(e.facing > 0 ? -h / 2 : h / 2 - 34, -42 - z, 34, 42).fill(white ? color : ink.band);
    } else {
      const squat = e.state === 'getup' ? 0.6 : e.state === 'hurt' ? 0.92 : 1;
      const top = -z - h * squat;
      g.rect(-hw, top, hw * 2, h * squat).fill(color);
      g.rect(-hw, top + 26, hw * 2, 18).fill(white ? color : ink.band);
      // facing mark at head height
      const fx = e.facing * hw;
      g.poly([fx, top + 8, fx + e.facing * 16, top + 18, fx, top + 28]).fill(white ? color : ink.band);
    }
  }

  /** The active part of a move: a brush arc sweeping through its hit box (the box in debug). */
  private strike(g: Graphics, e: Entity, z: number, alpha: number, debug: boolean): void {
    const m = MOVES[e.move];
    const box = m.box;
    if (!box) return;
    const x0 = fromFp(box.x0);
    const x1 = fromFp(box.x1);
    const active = e.st >= m.active[0] && e.st <= m.active[1];
    if (debug) {
      const left = e.facing > 0 ? x0 : -x1;
      g.rect(left, -z - fromFp(box.z1), x1 - x0, fromFp(box.z1 - box.z0)).stroke({ width: 2, color: active ? 0xc8281e : 0x888888 });
    }
    // the dance draws each cut on its own, as if it were a move of DANCE_CUT ticks
    const dance = e.move === 'phantom';
    const span = dance ? DANCE_CUT : m.active[1] - m.active[0] + 1;
    // on the rig's clock (see drawRig), so the arc trails the blade instead of leading it
    let since = (e.held ? e.st : e.st - 1 + alpha) - m.active[0];
    if (dance && since >= 0 && e.st <= m.active[1]) since %= DANCE_CUT;
    if (since < 0 || since > span + 3) return;
    const grow = Math.min(1, (since + 1) / span);
    const fade = since > span ? 1 - (since - span) / 3 : 1;
    const color = e.team === 0 ? 0x111014 : 0x34466b;
    const arc = ARCS[e.move === 'phantom' ? phantomArc(e) : e.move];
    if (!arc) {
      // the dash: one long tapering stroke along the thrust
      const f = e.facing;
      const mid = -z - 120;
      g.poly([f * x0, mid - 3, f * x1 * grow, mid - 14, f * x1 * grow * 1.06, mid, f * x1 * grow, mid + 10, f * x0, mid + 3]).fill({ color, alpha: 0.8 * fade });
      return;
    }
    const r = x1 * arc.r;
    const cx = 10 * e.facing;
    const cy = -z - arc.cz;
    const a1 = arc.a0 + (arc.a1 - arc.a0) * grow;
    const n = 18;
    const pts: number[] = [];
    // outer edge from the tail to the leading edge, then the inner edge back
    for (let i = 0; i <= n; i++) {
      const a = arc.a0 + ((a1 - arc.a0) * i) / n;
      pts.push(cx + e.facing * Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    for (let i = n; i >= 0; i--) {
      const u = i / n;
      const a = arc.a0 + (a1 - arc.a0) * u;
      // thick at the leading edge, thinning to a dry tail
      const w = r * arc.w * Math.pow(u, 0.7);
      pts.push(cx + e.facing * Math.cos(a) * (r - w), cy + Math.sin(a) * (r - w));
    }
    g.poly(pts).fill({ color, alpha: 0.82 * fade });
  }

  /** Called once per sim tick. */
  tick(): void {
    if (this.shake > 0) this.shake--;
  }

  /** Called once per render frame. */
  frame(): void {
    if (this.flash > 0) this.flash--;
  }
}

/** Clip time (seconds) of tick `t` of a move whose cut lands on `strike` and that lasts `total`,
 * played on a clip whose cut lands on `clipStrike` and that lasts `clipSec`, starting at clip
 * tick `from`. */
function proxyTime(t: number, strike: number, total: number, clipStrike: number, clipSec: number, from = 0): number {
  const clipTicks = clipSec * TICK_RATE;
  const tick = t < strike ? from + (t * (clipStrike - from)) / Math.max(1, strike) : clipStrike + ((t - strike) * (clipTicks - clipStrike)) / Math.max(1, total - strike);
  return Math.min(clipTicks, tick) / TICK_RATE;
}

/** Which way the current cut of the phantom dance sweeps. */
function phantomArc(e: Entity): string {
  const m = MOVES.phantom;
  return Math.floor((e.st - m.active[0]) / DANCE_CUT) % 2 === 0 ? 'phantomA' : 'phantomB';
}
