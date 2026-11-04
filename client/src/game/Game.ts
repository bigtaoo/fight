import { BODIES, DUNGEONS, SLOTS, TIERS, fromFp, rateRun, runConfig, validLoadout, type DungeonId, type Loadout, type RunConfig, type SimEvent, type SimState } from '@dnf/engine';
import { PUBLIC_EVENTS_URL, PUBLIC_SERVER_URL, SERVER_PORT } from '@dnf/server/protocol';
import { botButtons } from '@dnf/engine/bot';
import { Overlay } from './dom';
import { Hud } from './hud';
import { Keyboard } from './keyboard';
import { Numbers } from './numbers';
import { Tutorial } from './tutorial';
import type { View3D } from '../three/view';
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
import { sectionOf, type Section } from './chapter';
import { ScrollSelect } from './scrollSelect';
import { SectionEnd } from './sectionEnd';
import { TIER_REWARD } from '../rpg/rewards';
import { TIER_COUNT, openTier, progressKey, showsTiers, tierLock, tierName } from '../rpg/tiers';
import { chooseLang, getLang, t } from '../i18n';
import { platform } from '../platform';

// The game: a session (the engine stepped at a fixed 30 Hz from the keyboard and the touch
// controls, online against the server's metronome unless that is not reachable; from an https
// page, the deployed server) drawn by the 3D view (three/view.ts) every frame with interpolation
// between ticks, the HUD, menus and panels an HTML overlay over it (dom.ts). URL switches:
// ?offline (no server), ?server=ws://host:port, ?lag=N (ms added each way), ?dungeon=trial (or
// training, heifeng: the fort, or hall: the chief alone; 1-1 by default), ?seed=N (offline), ?bot (the engine's
// bot plays), ?notutorial (no advice on the scroll), ?cheat=dmg (hero damage x10 locally,
// which the server must catch), ?loadout=dragon,-,crush (the skills on the bar, in order, '-' an
// empty slot, instead of the character's), ?fps=N (the frame cap: 30 on a touch device, every
// display frame otherwise), and the 3D view's own. The switches work in a dev build only (main.ts).
// Single player pauses (the pause button, P, the window left or hidden) by not stepping the
// session; online the server's clock runs on, so there the menu opens over a running game.

export class Game {
  private readonly ui = new Overlay();
  /** Made first, so the numbers sit under the HUD and the controls. */
  private readonly numbers = new Numbers(this.ui);
  /** The advice written on the scroll, over the numbers and under the HUD. */
  private readonly tutorial = new Tutorial(this.ui);
  private readonly hud: Hud;
  private readonly keys = new Keyboard();
  /** The single-player character: offline runs earn it experience and gear, and its stats go
   * into each offline run. */
  private readonly character = new Character(platform.store);
  private readonly charPanel: CharPanel;
  private readonly skillPanel: SkillPanel;
  /** A chapter section's end card over the result, and the chapter's scroll to pick one from,
   * over everything. */
  private readonly sectionEnd: SectionEnd;
  private readonly scroll: ScrollSelect;
  private session: Session | null = null;
  private link: WsLink | null = null;
  private seed: number;
  private readonly telemetry: Telemetry;
  private readonly sound = new SoundPlayer(import.meta.env.BASE_URL, browserStore);
  private readonly menu: Menu;
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

  constructor(private readonly view: View3D, private readonly params: URLSearchParams) {
    // made in the order they stack: the HUD and the controls, the menus over them, the panels on top
    this.tutorial.on = !params.has('notutorial');
    this.hud = new Hud(this.ui);
    this.sectionEnd = new SectionEnd(this.ui, import.meta.env.BASE_URL);
    this.menu = new Menu(this.ui);
    this.charPanel = new CharPanel(this.ui);
    this.skillPanel = new SkillPanel(this.ui);
    this.scroll = new ScrollSelect(this.ui, platform.store, import.meta.env.BASE_URL);
    this.scroll.unrollAll = params.has('unroll');
    this.scroll.onClick = () => this.sound.play({ sfx: 'click', vol: 0.5 });
    this.scroll.onStart = (sec) => void this.enter(sec);
    this.seed = Number(params.get('seed') ?? 1);
    const d = params.get('dungeon');
    this.dungeon = d && Object.prototype.hasOwnProperty.call(DUNGEONS, d) ? (d as DungeonId) : 'luobi';
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
    window.addEventListener('keydown', (ev) => {
      if (this.scroll.open) return;
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
    this.link = await this.connect();
    await sounds;
    // the chapter's scroll first, unless ?dungeon= (or a bot) says where to go
    if (this.params.has('dungeon') || this.params.has('bot')) await this.begin();
    else this.toScroll();
    // a phone draws 30 frames a second unless ?fps= says otherwise: the engine ticks at 30, and
    // the GPU's work and heat halve (the governor holds that rate)
    this.view.loop((dt) => this.update(dt), navigator.maxTouchPoints > 0 ? 30 : 0);
  }

  /** The run started, and 1-1 opening the chapter: the hero and the landscape painted in on
   * blank paper (?reveal does it for any dungeon). */
  private async begin(): Promise<void> {
    await this.start(this.seed);
    if (this.dungeon === 'luobi' && !this.params.has('reveal')) {
      this.view.blank();
      setTimeout(() => this.view.reveal(), 600);
    }
  }

  /** A section picked on the scroll. */
  private async enter(sec: Section): Promise<void> {
    this.scroll.hide();
    this.dungeon = sec.dungeon;
    this.tier = 0;
    this.forceTier = false;
    await this.begin();
  }

  /** Back to the chapter's scroll: the run left, the scroll showing what it opened. */
  private toScroll(): void {
    this.session?.close();
    this.session = null;
    this.setPaused(false);
    this.menu.showResult(null);
    this.menu.showTiers(null, '', '');
    this.sectionEnd.hide();
    this.scroll.show(this.progress);
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
    this.sectionEnd.hide();
    this.hud.quiet = !!sectionOf(this.dungeon);
    this.session?.close();
    this.session = null;
    await this.view.preload(this.dungeon);
    this.view.clear();
    this.numbers.clear();
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

  private update(dt: number): void {
    const session = this.session;
    if (!session) return;
    this.menu.markSkills(freePoints(this.character) > 0);
    // a break is the pause panel the player opened or the result; leaving the window is not one
    platform.gameplay(session.engine.state.outcome === 'playing' && !this.held && (!this.paused || this.autoPaused));
    if ((this.paused || this.held || this.view.cutscene) && this.freezes) {
      // stopped (or still being painted in, or one of 1-1's beats playing): the scene stands
      // still, and its clock runs up no ticks to catch up on later
      this.render(session.alpha, this.view.cutscene && !this.paused ? dt : 0);
      return;
    }
    const n = session.ticksFor(dt * 1000);
    for (let i = 0; i < n; i++) {
      const s = session.engine.state;
      const buttons = this.params.has('bot') ? botButtons(s, 0) : this.keys.read() | this.hud.controls.read();
      const events = session.step(buttons);
      this.telemetry.observe(session.engine.state, events);
      this.view.onEvents(events, session.engine.state);
      this.onEvents(events);
      for (const c of cues(events, session.engine.state)) this.sound.play(c);
    }
    this.sound.music(trackFor(session.engine.state));
    this.finish(session.engine.state);
    this.render(session.alpha, dt);
  }

  /** Once the run is decided: a clear into the progress, and the buttons onward. */
  private finish(s: SimState): void {
    // going into the folding screen (or back out of it) plays out before the result
    if (s.outcome === 'playing' || this.view.passing) return;
    // 1-1 ends on the camera resting on the folding screen: the result waits for it
    if (!this.view.outroDone) return;
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
    if (dungeon === 'luobi') choices.push({ label: t('result.toVillage'), act: click(() => this.play('jiangcun')) });
    if (dungeon === 'jiangcun') choices.push({ label: t('result.toScreen'), act: click(() => this.play('pingfeng')) });
    if (dungeon === 'pingfeng') choices.push({ label: t('result.toFort'), act: click(() => this.play('heifeng')) });
    if (sectionOf(dungeon)) choices.push({ label: t('result.scroll'), act: click(() => this.toScroll()) });
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

  /** What the overlay shows of a tick's events (the 3D view draws the rest), and the shakes. */
  private onEvents(events: readonly SimEvent[]): void {
    const s = this.engine.state;
    const nums = this.numbers;
    for (const ev of events) {
      if (ev.type === 'hit') {
        const victim = s.entities.find((e) => e.id === ev.target);
        const h = (victim ? fromFp(victim.z) : 0) + 210;
        nums.damage(fromFp(ev.x), h, fromFp(ev.y), ev.dmg, victim?.team === 0, ev.blocked, ev.crit);
      } else if (ev.type === 'fire') {
        // the slam's landing shakes the room
        const p = s.shots.find((q) => q.id === ev.id);
        if (p?.kind === 'quake') this.view.shakeFor(0.22);
      } else if (ev.type === 'phase') {
        // a boss's second phase: its roar shakes the room
        this.view.shakeFor(0.5);
      } else if (ev.type === 'pickup') {
        // a potion drunk: a green number over the drinker
        const e = s.entities.find((b) => b.id === ev.id);
        if (e) nums.heal(fromFp(e.x), fromFp(e.z) + 210, fromFp(e.y), ev.heal);
      } else if (ev.type === 'dot') {
        // poison: a small green number
        nums.word(fromFp(ev.x), fromFp(ev.z) + 220, fromFp(ev.y), String(ev.dmg), 0x4a7a2a, 30);
      } else if (ev.type === 'affix') {
        const e = s.entities.find((b) => b.id === ev.id);
        if (!e) continue;
        const head = fromFp(e.z) + fromFp(BODIES[e.kind].height) + 70;
        if (ev.affix === 'ward') nums.word(fromFp(e.x), head, fromFp(e.y), t('affix.wardBroken'), 0x4a6a80, 48);
        else if (ev.affix === 'revive') {
          nums.word(fromFp(e.x), head, fromFp(e.y), t('affix.revived'), 0xa8221a, 48);
          this.view.shakeFor(0.2);
        }
      } else if (ev.type === 'roomEnter') nums.clear();
    }
  }

  private render(alpha: number, dt: number): void {
    const s = this.engine.state;
    this.view.draw(s, dt, alpha);
    this.numbers.update(this.view, dt);
    this.tutorial.touch = this.hud.controls.touch;
    this.tutorial.update(s, this.view, dt);
    this.hud.holding = !this.view.outroDone;
    this.hud.update(s, this.session!, this.keys.down);
    const sec = s.outcome === 'cleared' ? sectionOf(s.config.dungeon) : null;
    if (sec && this.hud.shown && !this.hud.holding && !this.sectionEnd.on) this.sectionEnd.show(sec, this.hud.shown.grade);
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
