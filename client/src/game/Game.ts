import { AFFIX, BODIES, DOOR_HALF, DUNGEONS, MOVES, SLOTS, TIERS, WORLD, fromFp, rateRun, runConfig, validLoadout, type DungeonId, type Entity, type Kind, type Loadout, type RunConfig, type SimEvent, type SimState } from '@dnf/engine';
import { PUBLIC_EVENTS_URL, PUBLIC_SERVER_URL, SERVER_PORT } from '@dnf/server/protocol';
import { botButtons } from '@dnf/engine/bot';
import { Container, Graphics, type Application } from 'pixi.js';
import { BodyView, FLASH_SEC } from './bodyView';
import { ItemView } from './itemView';
import { ShotView } from './shotView';
import { Fx } from './fx';
import { Hud } from './hud';
import { Keyboard } from './keyboard';
import { Scenery } from './scenery';
import { loadFrames, loadRig, loadSprites, type FrameSet, type SpriteSet } from './sprites';
import type { TaoAsset } from './tao/TaoActor';
import { GROUND_TOP, VIEW_H, VIEW_W, cameraX, floorY } from './layout';
import { WsLink } from '../net/Link';
import { OnlineSession } from '../net/OnlineSession';
import { browserStore } from '../platform/store';
import { Character } from '../rpg/character';
import { freePoints, isSkill, runLoadout, runSkillLv } from '../rpg/skills';
import { CharPanel } from './charPanel';
import { SkillPanel } from './skillPanel';
import { OfflineSession, type Session } from '../net/Session';
import { Telemetry } from '../net/telemetry';
import { SoundPlayer } from './audio';
import { cues, trackFor } from './sounds';
import { Menu, type Choice } from './menu';
import { Progress } from './progress';
import { TIER_REWARD } from '../rpg/rewards';
import { TIER_COUNT, openTier, progressKey, showsTiers, tierLock, tierName } from '../rpg/tiers';
import { chooseLang, getLang, t } from '../i18n';
import { platform } from '../platform';

/** The kinds drawn with a skeleton (client/public/art/<kind>/); ?poses shows paintings instead. */
const RIGGED: readonly Kind[] = ['hero', 'bandit', 'archer', 'shield', 'chief'];
/** Kinds drawn with another kind's skeleton, and the tint that tells them apart. */
const BORROWED: Partial<Record<Kind, { rig: Kind; tint: number }>> = { elite: { rig: 'bandit', tint: 0xb06850 } };

// The game: a session (the engine stepped at a fixed 30 Hz from the keyboard, online against
// the server's metronome unless that is not reachable; from an https page, the deployed server) drawn every frame with interpolation
// between ticks. URL switches: ?offline (no server), ?server=ws://host:port, ?lag=N (ms added
// each way), ?dungeon=trial (or training, or hall: the chief alone; the fort by default), ?seed=N (offline), ?bot (the engine's bot plays), ?notutorial (no advice lines in the fort), ?debug (hit
// boxes, also F1), ?cheat=dmg (hero damage x10 locally, which the server must catch), ?blocks
// (ink blocks instead of the pose paintings), ?poses (the hero's pose paintings instead of its
// skeleton), ?zoom=N (a close-up that follows the hero), ?archer3d (the archer
// pre-rendered from 3D, art/archer3d, instead of its skeleton), ?oldrig (the archer's and the hero's
// hand-cut skeletons instead of the ones cut from their 3D models), ?loadout=dragon,-,crush (the
// skills on the bar, in order, '-' an empty slot, instead of the character's). The switches work in a dev build only (main.ts).
// Single player pauses (the pause button, P, the window left or hidden) by not stepping the
// session; online the server's clock runs on, so there the menu opens over a running game.
/** Colour of the loose ink each kind of body throws. */
const DROP_INK = { hero: 0x111014, bandit: 0x2f3d5c, elite: 0x4a2420, archer: 0x4a4636, shield: 0x3d4148, chief: 0x3b2420, dummy: 0x6a5c40 } as const;
/** Moves that throw a heavy splash of ink as they start, and those that cut upward. */
const HEAVY = new Set(['atk3', 'upper', 'slash', 'bash', 'tri3', 'dragon4', 'crush2', 'iai', 'phantom', 'chop', 'chopF', 'roar']);
const RISING = new Set(['upper', 'crush2', 'dragon4']);
/** Moves that rush forward, ink streaming behind them while they cut. */
const RUSHES = new Set(['tri1', 'tri2', 'tri3', 'dragon1', 'dragon2', 'dragon3', 'dragon4', 'crush1']);
/** Rushes that stand still through a windup first: ink only once they are off. */
const CHARGES = new Set(['charge', 'chargeF']);

export class Game {
  private readonly root = new Container();
  private readonly scenery = new Scenery();
  private readonly world = new Container();
  private readonly floor = new Graphics();
  private readonly bodies = new Container();
  private readonly views = new Map<number, BodyView>();
  private readonly shotViews = new Map<number, ShotView>();
  private readonly itemViews = new Map<number, ItemView>();
  private readonly fx = new Fx();
  private readonly hud: Hud;
  private readonly keys = new Keyboard();
  /** The single-player character: offline runs earn it experience and gear, and its stats go
   * into each offline run. */
  private readonly character = new Character(platform.store);
  private readonly charPanel = new CharPanel();
  private readonly skillPanel = new SkillPanel();
  private sprites: SpriteSet | null = null;
  /** Skeletons of the rigged kinds; the others show pose paintings. */
  private rigs: Partial<Record<Kind, TaoAsset>> = {};
  /** The archer pre-rendered from 3D (?archer3d), drawn instead of its skeleton. */
  private archer3d: FrameSet | null = null;
  private session: Session | null = null;
  private link: WsLink | null = null;
  private frame = 0;
  private shake = 0;
  private debug: boolean;
  private seed: number;
  private readonly telemetry: Telemetry;
  private readonly sound = new SoundPlayer(import.meta.env.BASE_URL, browserStore);
  private readonly menu = new Menu();
  private readonly progress = new Progress(platform.store);
  /** The dungeon being played: the fort unless ?dungeon=, then wherever the result's buttons lead. */
  private dungeon: DungeonId;
  /** The difficulty tier picked (single player): from the result's row, or ?tier= to try one
   * shut; and why the last tier tapped is shut. */
  private tier = 0;
  private forceTier = false;
  private tierNote = '';
  /** The pause menu is open. */
  private paused = false;
  /** The character panel is open: the run stands still under it. */
  private held = false;
  /** It opened by itself (the window left or hidden): the platform counts that as play going on. */
  private autoPaused = false;
  /** This run's clear went into the progress already. */
  private recorded = false;

  constructor(private readonly app: Application, private readonly params: URLSearchParams) {
    this.debug = params.has('debug');
    this.hud = new Hud(!params.has('notutorial'));
    this.seed = Number(params.get('seed') ?? 1);
    const d = params.get('dungeon');
    this.dungeon = d && Object.prototype.hasOwnProperty.call(DUNGEONS, d) ? (d as DungeonId) : 'heifeng';
    if (params.has('tier')) {
      this.tier = Math.max(0, Math.min(TIER_COUNT - 1, Number(params.get('tier')) || 0));
      this.forceTier = true;
    }
    this.telemetry = new Telemetry(this.eventsUrl(), browserStore);
    this.telemetry.open(navigator.maxTouchPoints > 0, navigator.language);
    // hidden is the last moment a closing tab (or a phone switching apps) surely sends
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      this.telemetry.leave();
      this.autoPause();
    });
    window.addEventListener('blur', () => this.autoPause());
    this.bodies.sortableChildren = true;
    this.world.addChild(this.scenery.floor, this.floor, this.bodies, this.fx.layer);
    this.root.addChild(this.scenery.back, this.world, this.scenery.front, this.hud.layer, this.menu.layer, this.charPanel.layer, this.skillPanel.layer);
    app.stage.addChild(this.root);
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'F1' && import.meta.env.DEV) {
        ev.preventDefault();
        this.debug = !this.debug;
      }
      if (ev.code === 'KeyR' && this.session) this.restart();
      if (ev.code === 'KeyM') this.toggleMute();
      if (ev.code === 'KeyP' && !this.panelOpen) this.setPaused(!this.paused);
      if (ev.code === 'KeyI') this.toggleChar();
      if (ev.code === 'KeyK') this.toggleSkills();
    });
    this.menu.onChar = () => this.toggleChar();
    this.menu.onSkills = () => this.toggleSkills();
    for (const p of [this.charPanel, this.skillPanel]) {
      p.onClick = () => this.sound.play({ sfx: 'click', vol: 0.5 });
      p.onClose = () => this.hold(false);
    }
    this.menu.onPause = () => this.setPaused(true);
    this.menu.onResume = () => this.setPaused(false);
    this.menu.onRestart = () => this.restart();
    this.menu.onSound = () => this.toggleMute();
    this.menu.onLang = () => {
      chooseLang(getLang() === 'zh' ? 'en' : 'zh');
      this.menu.relabel(this.sound.muted);
    };
    this.menu.relabel(this.sound.muted);
    platform.onMute((m) => this.sound.silence(m));
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  /** Opens the character panel over the run (single player only), or closes it. */
  private toggleChar(): void {
    this.toggle(this.charPanel);
  }

  /** Opens the skill panel over the run (single player only), or closes it. */
  private toggleSkills(): void {
    this.toggle(this.skillPanel);
  }

  /** Opens a panel (closing the other), or closes it. */
  private toggle(panel: CharPanel | SkillPanel): void {
    if (panel.open) return panel.close();
    if (!this.freezes || this.paused) return;
    for (const p of [this.charPanel, this.skillPanel]) if (p.open) p.close();
    this.hold(true);
    panel.show(this.character);
  }

  private get panelOpen(): boolean {
    return this.charPanel.open || this.skillPanel.open;
  }

  /** A panel stops the run like the pause panel, without showing it. */
  private hold(on: boolean): void {
    this.held = on;
    this.keys.release();
    this.hud.controls.release();
    this.sound.pause(on || this.paused);
  }

  private toggleMute(): void {
    this.menu.relabel(this.sound.toggleMute());
  }

  /** Whether pausing stops the game: single player only (online the server's clock runs on). */
  private get freezes(): boolean {
    return this.session instanceof OfflineSession;
  }

  private setPaused(paused: boolean, auto = false): void {
    if (!paused || !this.paused) this.autoPaused = paused && auto;
    if (paused === this.paused) return;
    this.paused = paused;
    this.menu.showPaused(paused);
    if (!this.freezes) return;
    this.keys.release();
    this.hud.controls.release();
    this.sound.pause(paused);
  }

  /** The window left or hidden: single player stops until the player comes back to it. */
  private autoPause(): void {
    if (this.freezes && !this.params.has('bot')) this.setPaused(true, true);
  }

  /** The same dungeon again, on the next seed. */
  private restart(): void {
    void this.start(this.seed + 1);
  }

  /** Another dungeon, from the result's buttons. */
  private play(dungeon: DungeonId): void {
    this.dungeon = dungeon;
    this.restart();
  }

  /** The dungeon again on another tier, from the result's difficulty row. */
  private playTier(tier: number): void {
    this.tier = tier;
    this.forceTier = false;
    this.restart();
  }

  async load(): Promise<void> {
    const sounds = this.sound.load();
    await this.scenery.load();
    if (!this.params.has('blocks')) {
      const rigged = this.params.has('poses') ? [] : RIGGED;
      const rig3d = !this.params.has('oldrig');
      const [sprites, ...rigs] = await Promise.all([loadSprites(), ...rigged.map((k) => loadRig((k === 'archer' || k === 'hero') && rig3d ? `${k}_rig3d` : k))]);
      this.sprites = sprites;
      rigged.forEach((k, i) => {
        const rig = rigs[i];
        if (rig) this.rigs[k] = rig;
      });
      if (this.params.has('archer3d')) this.archer3d = await loadFrames('archer3d');
    }
    this.link = await this.connect();
    await sounds;
    await this.start(this.seed);
    this.app.ticker.add((t) => this.update(t.deltaMS / 1000));
  }

  /** Where the analytics go: the deployed server from a production build (?events=URL to try a
   * dev one), nowhere for bots and ?notelemetry. */
  private eventsUrl(): string | null {
    const p = this.params;
    if (p.has('bot') || p.has('notelemetry')) return null;
    return p.get('events') ?? (import.meta.env.PROD ? PUBLIC_EVENTS_URL : null);
  }

  /** The link to the server, or null to play offline (always, in the platform build). */
  private async connect(): Promise<WsLink | null> {
    if (this.params.has('offline') || import.meta.env.MODE === 'crazygames') return null;
    // the deployed page (https) plays against the deployed server; a dev page against its own host
    const url = this.params.get('server') ?? (location.protocol === 'https:' ? PUBLIC_SERVER_URL : `ws://${location.hostname}:${SERVER_PORT}`);
    try {
      return await WsLink.connect(url, Number(this.params.get('lag') ?? 0));
    } catch {
      this.hud.offlineNote = 'net.noServer';
      return null;
    }
  }

  private config(seed: number): RunConfig {
    return runConfig({
      seed,
      dungeon: this.dungeon,
      heroDamagePct: this.params.get('cheat') === 'dmg' ? 1000 : 100,
      loadout: this.loadout(),
      skillLv: runSkillLv(this.character),
      hero: this.character.heroStats(),
      tier: this.runTier(),
    });
  }

  /** The tier this run is on: the one picked if it is open, else the highest open below it. */
  private runTier(): number {
    return this.forceTier ? this.tier : openTier(this.dungeon, this.tier, this.progress, this.character.level);
  }

  /** The character's bar, or the skills ?loadout= names in its slots in order ('-' leaves one
   * empty). */
  private loadout(): Loadout {
    const want = this.params.get('loadout')?.split(',').map((id) => (isSkill(id) ? id : null));
    const l = want ? [...want, ...new Array<null>(SLOTS).fill(null)].slice(0, SLOTS) : null;
    return l && validLoadout(l) ? l : runLoadout(this.character);
  }

  private async start(seed: number): Promise<void> {
    this.seed = seed;
    this.setPaused(false);
    this.charPanel.close();
    this.skillPanel.close();
    this.recorded = false;
    this.tierNote = '';
    this.menu.showTiers(null, '', '');
    this.hud.best = { best: null, better: { grade: false, time: false } };
    this.menu.showResult(null);
    this.session?.close();
    this.session = null;
    for (const v of this.views.values()) v.root.destroy();
    this.views.clear();
    if (this.link?.open) {
      try {
        const { dungeon, loadout } = this.config(seed);
        this.session = await OnlineSession.join(this.link, { dungeon, loadout: [...loadout], device: deviceId(), cheatDmg: this.params.get('cheat') === 'dmg' });
        this.telemetry.start(dungeon);
        this.menu.showChar(false);
        return;
      } catch {
        this.hud.offlineNote = 'net.noRun';
      }
    }
    this.session = new OfflineSession(this.config(seed), this.character);
    this.menu.showChar(true);
    this.telemetry.start(this.session.engine.state.config.dungeon);
  }

  private get engine() {
    return this.session!.engine;
  }

  /** Scales the 1920x1080 logical view into the window, letterboxed. */
  private fit(): void {
    const k = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
    this.root.scale.set(k);
    this.root.position.set((window.innerWidth - VIEW_W * k) / 2, (window.innerHeight - VIEW_H * k) / 2);
  }

  private update(dt: number): void {
    const session = this.session;
    if (!session) return;
    this.menu.markSkills(freePoints(this.character) > 0);
    // a break is the pause panel the player opened or the result; leaving the window is not one
    platform.gameplay(session.engine.state.outcome === 'playing' && !this.held && (!this.paused || this.autoPaused));
    if ((this.paused || this.held) && this.freezes) {
      // stopped: the scene stands still, and its clock runs up no ticks to catch up on later
      this.render(session.alpha, 0);
      return;
    }
    const n = session.ticksFor(dt * 1000);
    for (let i = 0; i < n; i++) {
      const s = session.engine.state;
      const buttons = this.params.has('bot') ? botButtons(s, 0) : this.keys.read() | this.hud.controls.read();
      const events = session.step(buttons);
      this.telemetry.observe(session.engine.state, events);
      this.onEvents(events);
      for (const c of cues(events, session.engine.state)) this.sound.play(c);
      this.tickInk(session.engine.state);
      for (const v of this.views.values()) v.tick();
    }
    this.sound.music(trackFor(session.engine.state));
    this.finish(session.engine.state);
    this.render(session.alpha, dt);
  }

  /** Once the run is decided: a clear into the progress, and the buttons onward. */
  private finish(s: SimState): void {
    if (s.outcome === 'playing') return;
    const dungeon = s.config.dungeon;
    const key = progressKey(dungeon, s.config.tier);
    if (s.outcome === 'cleared' && !this.recorded && !DUNGEONS[dungeon].practice) {
      this.recorded = true;
      const first = !this.progress.cleared(dungeon);
      const better = this.progress.record(key, rateRun(s));
      this.hud.best = { best: this.progress.get(key), better };
      // the platform's celebration, kept rare: the chief beaten the first time, or a new best
      if (dungeon === 'heifeng' && (first || better.grade || better.time)) platform.happytime();
    }
    const click = (act: () => void) => () => {
      this.sound.play({ sfx: 'click', vol: 0.5 });
      act();
    };
    const choices: Choice[] = [{ label: t('result.again'), main: true, act: click(() => this.restart()) }];
    if (dungeon === 'heifeng' && this.progress.cleared('heifeng')) choices.push({ label: t('result.chief'), act: click(() => this.play('hall')) });
    if (dungeon === 'hall') choices.push({ label: t('result.fort'), act: click(() => this.play('heifeng')) });
    if (this.freezes) choices.push({ label: t('result.bag'), act: click(() => this.toggleChar()) });
    this.menu.showResult(choices);
    this.tierRow(s, click);
  }

  /** Single player, under the result: the dungeon's tiers, the one played lit, the shut ones
   * pale and saying why when tapped. */
  private tierRow(s: SimState, click: (act: () => void) => () => void): void {
    if (!this.freezes || (!showsTiers(s.config.dungeon, this.progress) && s.config.tier === 0)) {
      this.menu.showTiers(null, '', '');
      return;
    }
    const level = this.character.level;
    const row = Array.from({ length: TIER_COUNT }, (_, i) => {
      const lock = tierLock(s.config.dungeon, i, this.progress, level);
      const state = i === s.config.tier ? ('on' as const) : lock ? ('shut' as const) : ('open' as const);
      const act = () => {
        if (!lock) return this.playTier(i);
        this.tierNote = lock.key === 'tier.needClear' ? t(lock.key, { tier: tierName(lock.tier) }) : lock.key === 'tier.needLevel' ? t(lock.key, { n: lock.n }) : t(lock.key);
      };
      return { label: tierName(i), state, act: click(act) };
    });
    const tr = TIERS[s.config.tier];
    const x = (pct: number) => String(pct / 100);
    const note = this.tierNote || t('tier.hint', { hp: x(tr.hpPct), dmg: x(tr.dmgPct), pay: x(TIER_REWARD[s.config.tier].pct) });
    this.menu.showTiers(row, t('tier.label'), note);
  }

  private onEvents(events: readonly SimEvent[]): void {
    const s = this.engine.state;
    for (const ev of events) {
      if (ev.type === 'hit') {
        const target = this.views.get(ev.target);
        if (target) {
          // a blocked blow does not flash the body white: it rocks it behind its shield; one
          // taken under super armour barely shakes it
          target.flash = ev.blocked || ev.armor ? 0 : FLASH_SEC;
          target.shake = ev.blocked || ev.armor ? Math.min(2, ev.stop) : ev.stop;
        }
        const victim = s.entities.find((e) => e.id === ev.target);
        const h = victim ? fromFp(victim.z) + 120 : 120;
        const x = fromFp(ev.x);
        const y = GROUND_TOP + fromFp(ev.y) - h;
        if (ev.blocked && victim) {
          const front = x + ev.dir * -fromFp(BODIES[victim.kind].halfWidth);
          this.fx.clang(front, y, GROUND_TOP + fromFp(ev.y), ev.dir);
        } else {
          this.fx.splash(x, y, ev.dir, ev.stop >= 5);
        }
        this.fx.damage(x, y - 90, ev.dmg, victim?.team === 0, ev.blocked, ev.crit);

        if (ev.stop >= 5 || ev.launch) this.shake = Math.max(this.shake, 0.14);
      } else if (ev.type === 'swing' || ev.type === 'jump' || ev.type === 'land' || ev.type === 'down' || ev.type === 'death' || ev.type === 'rise') {
        const e = s.entities.find((b) => b.id === ev.id);
        if (e) this.ink(e, ev.type === 'rise' ? 'land' : ev.type, ev.type === 'swing' ? ev.move : '');
      } else if (ev.type === 'fire') {
        const p = s.shots.find((q) => q.id === ev.id);
        const owner = s.entities.find((b) => b.id === ev.owner);
        if (p && owner) {
          const floor = floorY(fromFp(p.y));
          const dir = p.vx > 0 ? 0 : Math.PI;
          this.fx.burst(fromFp(p.x), floor - fromFp(p.z), floor, { n: 4, dir, spread: 0.5, speed: [120, 300], r: [2, 4.5], color: DROP_INK[owner.kind] });
          // the slam's landing shakes the room
          if (p.kind === 'quake') this.shake = Math.max(this.shake, 0.22);
        }
      } else if (ev.type === 'phase') {
        // a boss's second phase: its roar shakes the room and throws ink all round it
        const e = s.entities.find((b) => b.id === ev.id);
        this.shake = Math.max(this.shake, 0.5);
        if (e) {
          const floor = GROUND_TOP + fromFp(e.y);
          this.fx.burst(fromFp(e.x), floor - 200, floor, { n: 26, dir: -Math.PI / 2, spread: 3.2, speed: [200, 600], r: [3, 9], color: DROP_INK[e.kind], jitter: [40, 80] });
        }
      } else if (ev.type === 'pickup') {
        // a potion drunk: a green number and a puff of red ink where it lay
        const it = this.itemViews.get(ev.item);
        const e = s.entities.find((b) => b.id === ev.id);
        if (e) {
          const floor = GROUND_TOP + fromFp(e.y);
          this.fx.heal(fromFp(e.x), floor - fromFp(e.z) - 210, ev.heal);
          const px = it ? it.root.x : fromFp(e.x);
          this.fx.burst(px, floor - 20, floor, { n: 8, dir: -Math.PI / 2, spread: 1.2, speed: [80, 260], r: [2.4, 5], g: 600, color: 0xc8281e });
        }
      } else if (ev.type === 'dot') {
        // poison: a small green number, no flash
        this.fx.word(fromFp(ev.x), GROUND_TOP + fromFp(ev.y) - fromFp(ev.z) - 220, String(ev.dmg), 0x4a7a2a, 30);
      } else if (ev.type === 'affix') {
        const e = s.entities.find((b) => b.id === ev.id);
        if (e) {
          const x = fromFp(e.x);
          const floor = GROUND_TOP + fromFp(e.y);
          const head = floor - fromFp(e.z) - fromFp(BODIES[e.kind].height);
          if (ev.affix === 'ward') {
            this.fx.word(x, head - 70, t('affix.wardBroken'), 0x4a6a80);
            this.fx.burst(x, head + 60, floor, { n: 16, dir: -Math.PI / 2, spread: 3, speed: [200, 520], r: [2, 5], color: 0x9ab0c0 });
          } else if (ev.affix === 'revive') {
            this.fx.word(x, head - 70, t('affix.revived'), 0xa8221a, 48);
            this.fx.burst(x, floor - 100, floor, { n: 20, dir: -Math.PI / 2, spread: 1.6, speed: [160, 480], r: [3, 8], color: DROP_INK[e.kind] });
            this.shake = Math.max(this.shake, 0.2);
          } else if (ev.affix === 'summon') {
            this.fx.burst(x, floor - 120, floor, { n: 14, dir: -Math.PI / 2, spread: 3, speed: [120, 360], r: [3, 7], color: DROP_INK[e.kind] });
          }
        }
      } else if (ev.type === 'roomEnter') {
        for (const v of this.views.values()) v.root.destroy();
        this.views.clear();
      }
    }
  }

  /** Ink thrown by one moment of movement. */
  private ink(e: Entity, what: 'swing' | 'jump' | 'land' | 'down' | 'death', move: string): void {
    const x = fromFp(e.x);
    const floor = GROUND_TOP + fromFp(e.y);
    const feet = floor - fromFp(e.z);
    const f = e.facing;
    const color = DROP_INK[e.kind];
    const fwdUp = f > 0 ? -0.45 : -Math.PI + 0.45;
    switch (what) {
      case 'swing': {
        if (MOVES[move].turn) break;
        if (move === 'backstep') {
          this.ink(e, 'jump', '');
          break;
        }
        const dir = RISING.has(move) ? -Math.PI / 2 + f * 0.4 : RUSHES.has(move) ? (f > 0 ? Math.PI : 0) : fwdUp;
        this.fx.burst(x + f * 50, feet - 130, floor, { n: HEAVY.has(move) ? 8 : 5, dir, spread: 1, speed: [220, 520], r: [2.4, 7.2], color, jitter: [30, 40] });
        break;
      }
      case 'jump':
        for (const dir of [-0.35, -Math.PI + 0.35]) this.fx.burst(x, floor - 4, floor, { n: 4, dir, spread: 0.5, speed: [120, 260], r: [2.4, 5.6], g: 1100, color });
        break;
      case 'land':
      case 'down':
        for (const dir of [-0.25, -Math.PI + 0.25]) {
          this.fx.burst(x, floor - 4, floor, { n: what === 'down' ? 7 : 4, dir, spread: 0.4, speed: [140, 360], r: [3.2, what === 'down' ? 9.5 : 6.5], g: 1300, color, jitter: [40, 0] });
        }
        break;
      case 'death':
        // the body dissolves back into the paper: drops drift up and fade
        this.fx.burst(x, feet - 110, floor, { n: 22, dir: -Math.PI / 2, spread: 1.4, speed: [20, 110], r: [4, 11.2], g: -40, life: 1.3, color, jitter: [90, 190] });
        break;
    }
  }

  /** Ink thrown continuously: kicked up behind a runner's feet, streaming behind a dash. */
  private tickInk(s: SimState): void {
    for (const e of s.entities) {
      if (e.held) continue;
      const x = fromFp(e.x);
      const floor = GROUND_TOP + fromFp(e.y);
      const back = e.facing > 0 ? Math.PI : 0;
      if (e.state === 'run' && s.tick % 2 === 0) {
        this.fx.burst(x - e.facing * 20, floor - 6, floor, { n: 2, dir: e.facing > 0 ? -Math.PI + 0.5 : -0.5, spread: 0.6, speed: [120, 280], r: [2.4, 5.6], g: 1300, color: DROP_INK[e.kind] });
      } else if (e.state === 'act' && (RUSHES.has(e.move) || (CHARGES.has(e.move) && e.st >= MOVES[e.move].active[0])) && e.st <= MOVES[e.move].active[1]) {
        this.fx.burst(x - e.facing * 30, floor - 100, floor, { n: 3, dir: back, spread: 0.35, speed: [60, 200], r: [2.4, 6.4], g: 500, color: DROP_INK[e.kind], jitter: [20, 120] });
      }
    }
  }

  private render(alpha: number, dt: number): void {
    const s = this.engine.state;
    this.frame++;
    this.syncViews(s);
    const hero = s.entities.find((e) => e.team === 0);
    const camX = hero ? cameraX(fromFp(hero.px + (hero.x - hero.px) * alpha), s.roomWidth) : 0;
    this.shake = Math.max(0, this.shake - dt);
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 16 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 10 : 0;
    const zoom = Number(this.params.get('zoom') ?? 1);
    if (zoom > 1 && hero) {
      // a close-up on the hero, for checking animation
      const hx = fromFp(hero.px + (hero.x - hero.px) * alpha);
      const hy = GROUND_TOP + fromFp(hero.py + (hero.y - hero.py) * alpha) - 120;
      this.world.scale.set(zoom);
      this.world.position.set(VIEW_W / 2 - hx * zoom, VIEW_H / 2 - hy * zoom);
    } else {
      this.world.position.set(-camX + sx, sy);
    }
    this.scenery.update(s.config.dungeon, s.room, fromFp(s.roomWidth), camX);
    this.drawFloor(s);
    for (const e of s.entities) {
      const v = this.views.get(e.id)!;
      v.draw(e, alpha, this.frame, dt, this.debug);
      v.frame(dt);
    }
    for (const p of s.shots) this.shotViews.get(p.id)!.draw(p, alpha, this.debug);
    for (const it of s.items) this.itemViews.get(it.id)!.draw(it, dt);
    this.fx.update(dt);
    this.hud.update(s, this.session!, this.keys.down);
  }

  private syncViews(s: SimState): void {
    const live = new Set(s.entities.map((e) => e.id));
    for (const [id, v] of this.views) {
      if (!live.has(id)) {
        v.root.destroy();
        this.views.delete(id);
      }
    }
    for (const e of s.entities) {
      if (this.views.has(e.id)) continue;
      const borrowed = BORROWED[e.kind];
      const v = new BodyView(e.id, this.sprites, this.rigs[borrowed?.rig ?? e.kind] ?? null, borrowed?.tint, e.kind === 'archer' ? this.archer3d : null);
      this.views.set(e.id, v);
      this.bodies.addChild(v.root);
    }
    // projectiles sort into the bodies by depth, the same way
    const flying = new Set(s.shots.map((p) => p.id));
    for (const [id, v] of this.shotViews) {
      if (!flying.has(id)) {
        v.root.destroy();
        this.shotViews.delete(id);
      }
    }
    for (const p of s.shots) {
      if (this.shotViews.has(p.id)) continue;
      const v = new ShotView();
      this.shotViews.set(p.id, v);
      this.bodies.addChild(v.root);
    }
    // and potions on the floor
    const lying = new Set(s.items.map((i) => i.id));
    for (const [id, v] of this.itemViews) {
      if (!lying.has(id)) {
        v.root.destroy();
        this.itemViews.delete(id);
      }
    }
    for (const it of s.items) {
      if (this.itemViews.has(it.id)) continue;
      const v = new ItemView();
      this.itemViews.set(it.id, v);
      this.bodies.addChild(v.root);
    }
  }

  /** The floor's back edge drawn as one ink stroke, the walls, and the open doors of a cleared room. */
  private drawFloor(s: SimState): void {
    const w = fromFp(s.roomWidth);
    const g = this.floor.clear();
    g.rect(0, GROUND_TOP - 32, w, 4).fill({ color: 0x3a3630, alpha: 0.5 });
    g.rect(0, GROUND_TOP - 30, 10, VIEW_H).fill({ color: 0x141317, alpha: 0.6 });
    g.rect(w - 10, GROUND_TOP - 30, 10, VIEW_H).fill({ color: 0x141317, alpha: 0.6 });
    // poison clouds left by miasma: a sickly wash on the floor, fading out with its life
    for (const c of s.clouds) {
      const k = Math.min(1, c.life / 30);
      const pulse = 0.85 + 0.15 * Math.sin((this.frame + c.id * 7) / 6);
      g.ellipse(fromFp(c.x), floorY(fromFp(c.y)), fromFp(AFFIX.miasma.x) * pulse, fromFp(AFFIX.miasma.y) * pulse).fill({ color: 0x5a7a3a, alpha: 0.28 * k });
      g.ellipse(fromFp(c.x), floorY(fromFp(c.y)), fromFp(AFFIX.miasma.x) * 0.6, fromFp(AFFIX.miasma.y) * 0.6).fill({ color: 0x3a4a2a, alpha: 0.22 * k });
    }
    if (s.roomCleared && s.outcome === 'playing') {
      const fill = { color: 0xc8281e, alpha: (0.35 + 0.25 * Math.sin(this.frame / 8)) * 0.5 };
      const half = fromFp(DOOR_HALF);
      const front = floorY(fromFp(WORLD.depth));
      for (const d of DUNGEONS[s.config.dungeon].rooms[s.room].doors) {
        const x = fromFp(d.x ?? 0);
        if (d.side === 'right') g.rect(w - 140, GROUND_TOP - 30, 130, VIEW_H - GROUND_TOP + 30).fill(fill);
        else if (d.side === 'left') g.rect(10, GROUND_TOP - 30, 130, VIEW_H - GROUND_TOP + 30).fill(fill);
        else if (d.side === 'up') g.rect(x - half, GROUND_TOP - 30, half * 2, 54).fill(fill);
        else g.rect(x - half, front - 24, half * 2, VIEW_H - front + 24).fill(fill);
      }
    }
  }
}

/** This browser's id for the server's inventory (no accounts in M1). */
function deviceId(): string {
  const make = () => crypto.randomUUID();
  try {
    let id = localStorage.getItem('dnf.device');
    if (!id) localStorage.setItem('dnf.device', (id = make()));
    return id;
  } catch {
    return make();
  }
}
