import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en';
import { zh } from './zh';
import { keyName, pickLang, setLang, t, tOr } from './index';
import { ITEMS } from '@dnf/server/lootTables';

// The language picked (a saved choice first, Chinese only for a Chinese locale, English
// otherwise), the tables complete and alike in their placeholders, and every item named.

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('picks the saved language, else Chinese for a Chinese locale, else English', () => {
    expect(pickLang('zh', 'en-US')).toBe('zh');
    expect(pickLang('en', 'zh-CN')).toBe('en');
    expect(pickLang(null, 'zh-TW')).toBe('zh');
    expect(pickLang('fr', 'fr-FR')).toBe('en');
    expect(pickLang(null, undefined)).toBe('en');
  });

  it('has every key in both languages with the same placeholders', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(zh[k], k).toBeTruthy();
      expect(holes(zh[k]), k).toEqual(holes(en[k]));
    }
  });

  it('fills values and key names', () => {
    expect(t('hud.combo', { n: 5 })).toBe('5 Combo');
    expect(t('tip.jump')).toBe('C jumps over low attacks; X in the air is a jump slash');
    expect(keyName('KeyQ')).toBe('Q');
    setLang('zh');
    expect(t('hud.bag', { n: 2 })).toBe('背包（2）');
    expect(tOr('item.nothing', 'x')).toBe('x');
  });

  it('names every item in the loot tables', () => {
    for (const id of Object.keys(ITEMS)) {
      expect(tOr(`item.${id}`, ''), id).not.toBe('');
      setLang('zh');
      expect(tOr(`item.${id}`, ''), id).not.toBe('');
      setLang('en');
    }
  });
});
