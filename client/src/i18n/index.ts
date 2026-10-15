import { en, type Key } from './en';
import { zh } from './zh';

// The game's text in the player's language. English and Chinese; CrazyGames asks for English
// and for the language its SDK reports, English when it reports another. A choice made in the
// pause menu is kept on the device and wins over both. The keys' names in the text follow the
// player's keyboard layout where the browser tells it (an AZERTY player reads Q for KeyA).

export type { Key };
export type Lang = 'en' | 'zh';

const TABLES: Record<Lang, Record<Key, string>> = { en, zh };
const LANG_KEY = 'dnf.lang';

let lang: Lang = 'en';
const keyNames = new Map<string, string>();

/** The language to show: the one chosen before, else the platform's (or browser's) first. */
export function pickLang(saved: string | null, locale: string | undefined): Lang {
  if (saved === 'en' || saved === 'zh') return saved;
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  lang = l;
  // (no DOM types here: the server's type check reaches this through the online session)
  const doc = (globalThis as { document?: { documentElement: { lang: string }; title: string } }).document;
  if (doc) {
    doc.documentElement.lang = l;
    doc.title = TABLES[l]['game.title'];
  }
}

/** Sets the language at start: `forced` (a development switch) or what pickLang says. */
export function initLang(locale: string | undefined, forced?: string | null): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LANG_KEY);
  } catch {
    // storage blocked: go by the locale
  }
  setLang(pickLang(forced ?? saved, locale));
}

/** The player switching language in the pause menu: kept for the next visit. */
export function chooseLang(l: Lang): void {
  setLang(l);
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    // storage blocked: this visit only
  }
}

/** The text for `key`, `{name}` filled from `vars` and `{KeyX}` with that key's name. */
export function t(key: Key, vars: Record<string, string | number> = {}): string {
  return fill(TABLES[lang][key], vars);
}

/** A key built at run time (an item's id): its text, or `fallback` when the table lacks it. */
export function tOr(key: string, fallback: string): string {
  const s = (TABLES[lang] as Record<string, string>)[key];
  return s === undefined ? fallback : fill(s, {});
}

function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (name in vars) return String(vars[name]);
    if (/^Key[A-Z]$/.test(name)) return keyName(name);
    return m;
  });
}

/** A key's name by its code ('KeyA') on the player's layout, the US one when it is unknown. */
export function keyName(code: string): string {
  return keyNames.get(code) ?? code.slice(3);
}

/** Reads the keyboard layout (Chromium only; elsewhere the US names stay). */
export async function readKeyboardLayout(): Promise<void> {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  try {
    const map = await kb?.getLayoutMap?.();
    map?.forEach((v, code) => {
      if (/^Key[A-Z]$/.test(code) && v.length === 1) keyNames.set(code, v.toUpperCase());
    });
  } catch {
    // not allowed (in some iframes): the US names stay
  }
}
