import { botButtons } from '@dnf/engine/bot';
import { DUNGEONS, Engine, LocalInputSource, TICK_RATE, rateRun, runConfig, type Grade, type SimState } from '@dnf/engine';
import { CHAPTER1, sectionOf, type Section } from '../game/chapter';
import { loadPicture } from '../game/paint';
import { Progress } from '../game/progress';
import { ScrollCanvas } from '../game/scrollCanvas';
import { SectionEndCanvas } from '../game/sectionEndCanvas';
import { Clock } from '../net/Session';
import type { BagStore } from '../platform/store';
import { CanvasLayer } from './canvasLayer';
import { View3D, type ViewHost } from './view';

// Chapter one as a renderer without a DOM plays it (the WeChat mini-game; ?wxui on a dev page):
// the section select drawn on a canvas over the 3D view, a section played (by the engine's own bot
// until the mini-game has touch controls), its clear coloured in and sealed on the section-end
// card, then back to the scroll, which pays the clear back. The progress is kept on the device as
// the web build keeps it.

/** A pointer in CSS px of the view: pressed, dragged, lifted. */
export interface Pointer {
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
}

export interface ChapterHost {
  store: BagStore;
  /** Where the art folder is ('art/' in the mini-game). */
  art: string;
  /** Hooks the screen's pointer up to the chapter. */
  listen(p: Pointer): void;
  /** The view's host in the mini-game; none on the web. */
  view?: ViewHost;
}

type Mode = 'scroll' | 'loading' | 'play' | 'end';

export async function runChapter(params: URLSearchParams, host: ChapterHost): Promise<void> {
  const [view, ink, colour, silk] = await Promise.all([
    View3D.create(params, CHAPTER1[0].dungeon, host.view),
    loadPicture(`${host.art}scroll/ch1_ink.jpg`),
    loadPicture(`${host.art}scroll/ch1.jpg`),
    loadPicture(`${host.art}bg/silk.jpg`),
  ]);
  if (!ink || !colour) throw new Error('the chapter scroll did not load');
  const pics = { ink, colour, silk };
  const progress = new Progress(host.store);
  const dpr = host.view?.pixelRatio ?? Math.min(window.devicePixelRatio, 2);
  const layer = new CanvasLayer(view.renderer, dpr);
  const scroll = new ScrollCanvas(host.store, pics);
  scroll.unrollAll = params.has('unroll');
  const end = new SectionEndCanvas(pics);
  // ?speed=n plays the run n times as fast (development)
  const speed = Math.max(1, Number(params.get('speed') ?? 1) || 1);

  let mode: Mode = 'scroll';
  let engine: Engine | null = null;
  let section: Section = CHAPTER1[0];
  let seed = Number(params.get('seed') ?? 0) || (Date.now() & 0xffff) + 1;
  const clock = new Clock(1000 / TICK_RATE);
  const now = () => performance.now();

  const toScroll = () => {
    end.hide();
    mode = 'scroll';
    scroll.show(progress);
  };
  const start = async (sec: Section) => {
    if (mode !== 'scroll') return;
    mode = 'loading';
    section = sec;
    await view.preload(sec.dungeon);
    engine = new Engine(runConfig({ seed: seed++, dungeon: sec.dungeon }), new LocalInputSource());
    view.clear();
    scroll.hide();
    mode = 'play';
  };
  const cleared = (s: SimState, grade: Grade) => {
    mode = 'end';
    end.show(sectionOf(s.config.dungeon) ?? section, grade);
  };
  scroll.onStart = (sec) => void start(sec);
  end.onBack = toScroll;

  host.listen({
    down: (x, y) => (mode === 'scroll' ? scroll.press(x, y, now()) : undefined),
    move: (x, y) => (mode === 'scroll' ? scroll.move(x, y, now()) : undefined),
    up: (x, y) => (mode === 'scroll' ? scroll.release(x, y, now()) : mode === 'end' ? end.release(x, y) : undefined),
  });
  if (!host.view) window.addEventListener('wheel', (ev) => mode === 'scroll' && scroll.nudge(ev.deltaX || ev.deltaY), { passive: true });

  // for automation and the console: chapter.mode(), chapter.start('1-2'), chapter.clear('luobi', 'A')
  (globalThis as unknown as { chapter: unknown }).chapter = {
    view,
    layer,
    scroll,
    end,
    progress,
    mode: () => mode,
    engine: () => engine,
    start: (id: string) => start(CHAPTER1.find((s) => s.id === id) ?? CHAPTER1[0]),
    /** The end card as a clear of `dungeon` with `grade` shows it, recorded as one. */
    clear: (dungeon: string, grade: Grade = 'A') => {
      const sec = CHAPTER1.find((s) => s.dungeon === dungeon) ?? CHAPTER1[0];
      progress.record(sec.dungeon, { grade, ticks: 90 * TICK_RATE, maxCombo: 0, hitsTaken: 0 });
      section = sec;
      scroll.hide();
      mode = 'end';
      end.show(sec, grade);
    },
    toScroll,
  };

  toScroll();
  view.loop((dt) => {
    const ms = dt * 1000;
    if (layer.resize(view.width, view.height)) {
      scroll.resize(view.width, view.height, dpr);
      end.resize(view.width, view.height, dpr);
    }
    if (mode === 'scroll' || mode === 'loading') {
      scroll.tick(ms);
      if (scroll.dirty) scroll.draw(layer.begin());
      layer.present(true);
      return;
    }
    if (engine) {
      // a staged moment (1-1's beats) holds the fight still, and its clock runs up nothing
      const n = view.cutscene ? 0 : clock.ticks(ms * speed);
      for (let i = 0; i < n; i++) {
        engine.submit({ owner: 0, tick: engine.nextTick, buttons: botButtons(engine.state, 0) });
        view.onEvents(engine.advance() ?? [], engine.state);
      }
      const s = engine.state;
      view.draw(s, dt, clock.alpha);
      if (mode === 'play' && s.outcome !== 'playing' && !view.passing && view.outroDone) {
        if (s.outcome === 'cleared') {
          const r = rateRun(s);
          // a practice room (the screen until 1-3 has its own) opens nothing
          if (!DUNGEONS[s.config.dungeon].practice) progress.record(s.config.dungeon, r);
          cleared(s, r.grade);
        } else toScroll();
      }
    }
    if (mode === 'end') {
      end.tick(ms);
      if (end.dirty) end.draw(layer.begin());
      // over the fight's last frame; alone when the card came up without one (chapter.clear)
      layer.present(!engine);
    }
  });
}
