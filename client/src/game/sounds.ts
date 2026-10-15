import { DUNGEONS, MONSTERS, MOVES, type SimEvent, type SimState } from '@dnf/engine';

// What the game sounds like: which sound each engine event plays, and which music a room has.
// Kept apart from the player (audio.ts) so it can be tested without a browser. The files are in
// client/public/audio, each with a .txt beside it naming its source and licence.

/** Sound groups: a cue plays one of the group's files at random, so repeats do not drone. */
export const SFX = {
  swish: ['swish3', 'swish4', 'swish7', 'swish9'],
  slash: ['slash1', 'slash2', 'slash3'],
  hit: ['hit1', 'hit2', 'hit3'],
  heavy: ['heavy1', 'heavy2'],
  clang: ['clang1', 'clang2', 'clang3'],
  armor: ['armor'],
  wave: ['wave'],
  quake: ['quake'],
  stones: ['stones'],
  jump: ['jump'],
  land: ['land'],
  down: ['down'],
  die: ['die1', 'die2'],
  herodown: ['herodown'],
  drink: ['drink'],
  roar: ['roar'],
  clear: ['clear'],
  win: ['win'],
  click: ['click'],
} as const satisfies Record<string, readonly string[]>;

export type SfxGroup = keyof typeof SFX;

export const MUSIC = ['road', 'boss'] as const;
export type Track = (typeof MUSIC)[number];

export interface Cue {
  sfx: SfxGroup;
  /** 0..1, before the master volume. */
  vol: number;
  /** Playback rate (pitch); 1 when left out. */
  rate?: number;
}

/** Moves that cut with the whole body: a blade's ring instead of a light swish. */
const HEAVY_SWINGS = new Set(['atk3', 'upper', 'slash', 'bash', 'tri3', 'dragon4', 'crush2', 'iai', 'phantom', 'chop', 'chopF']);
/** Moves with no swing to hear (besides turns): the dodge, and the boss's roar (its `phase` event roars). */
const SILENT_SWINGS = new Set(['roar', 'backstep']);

/** The cues for one tick's events, against the state after it. The hero's sounds are louder than
 * the monsters', so the player hears their own blows over a crowd's. */
export function cues(events: readonly SimEvent[], s: SimState): Cue[] {
  const out: Cue[] = [];
  const team = (id: number) => s.entities.find((e) => e.id === id)?.team;
  const won = events.some((e) => e.type === 'dungeonClear');
  for (const ev of events) {
    switch (ev.type) {
      case 'swing': {
        if (SILENT_SWINGS.has(ev.move) || MOVES[ev.move]?.turn) {
          if (ev.move === 'backstep') out.push({ sfx: 'jump', vol: 0.35 });
          break;
        }
        const k = team(ev.id) === 0 ? 1 : 0.6;
        out.push(HEAVY_SWINGS.has(ev.move) ? { sfx: 'slash', vol: 0.55 * k } : { sfx: 'swish', vol: 0.5 * k });
        break;
      }
      case 'hit':
        if (ev.blocked) out.push({ sfx: 'clang', vol: 0.55 });
        else if (ev.armor) out.push({ sfx: 'armor', vol: 0.45 }, { sfx: 'hit', vol: 0.35 });
        else if (ev.stop >= 5 || ev.launch) out.push({ sfx: 'heavy', vol: 0.85 });
        else out.push({ sfx: 'hit', vol: 0.7 });
        break;
      case 'fire':
        if (ev.shot === 'arrow') out.push({ sfx: 'swish', vol: 0.4, rate: 1.5 });
        else if (ev.shot === 'quake') out.push({ sfx: 'quake', vol: 1 }, { sfx: 'stones', vol: 0.6 });
        else out.push({ sfx: 'wave', vol: 0.6 });
        break;
      case 'jump':
        out.push({ sfx: 'jump', vol: 0.3 });
        break;
      case 'land':
        out.push({ sfx: 'land', vol: 0.35 });
        break;
      case 'down':
        out.push({ sfx: 'down', vol: 0.6 });
        break;
      case 'death':
        // the hero's fall has its own sound (heroDown)
        if (team(ev.id) !== 0) out.push({ sfx: 'die', vol: 0.5 });
        break;
      case 'affix':
        // a ward breaking rings; a monster rising again or calling help roars, softly
        if (ev.affix === 'ward') out.push({ sfx: 'clang', vol: 0.8, rate: 0.7 });
        else if (ev.affix === 'revive' || ev.affix === 'summon') out.push({ sfx: 'roar', vol: 0.45, rate: 1.4 });
        break;
      case 'heroDown':
        out.push({ sfx: 'herodown', vol: 0.8 });
        break;
      case 'phase':
        out.push({ sfx: 'roar', vol: 1 });
        break;
      case 'pickup':
        out.push({ sfx: 'drink', vol: 0.8 });
        break;
      case 'roomClear':
        if (!won) out.push({ sfx: 'clear', vol: 0.5 });
        break;
      case 'dungeonClear':
        out.push({ sfx: 'win', vol: 0.7 });
        break;
    }
  }
  return out;
}

/** The music for where the run stands: the boss's theme in a room with a boss in it, the road's
 * everywhere else, none once the hero has fallen. */
export function trackFor(s: SimState): Track | null {
  if (s.outcome === 'failed') return null;
  const room = DUNGEONS[s.config.dungeon].rooms[s.room];
  if (!room) return 'road';
  return room.spawns.some((sp) => MONSTERS[sp.kind].brain === 'boss') ? 'boss' : 'road';
}

/** Every file the player may ask for, under audio/. */
export const AUDIO_FILES = [...Object.values(SFX).flat().map((n) => `sfx/${n}.mp3`), ...MUSIC.map((m) => `music/${m}.mp3`)];
