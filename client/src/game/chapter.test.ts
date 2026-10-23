import { describe, expect, it } from 'vitest';
import { CHAPTER1, PEEK, Pan, clearedCount, colouredTo, openCount, sectionAt, sectionOf, unrolledTo, type Cleared } from './chapter';

// The section select's model: which sections the progress opens, how far the scroll unrolls and
// colours, and the pan that drags it (held in bounds, a tap told from a drag, a fling that stops).

const done = (...ds: string[]): Cleared => ({
  cleared: (d) => ds.includes(d),
  get: (d) => (ds.includes(d) ? { grade: 'A', ticks: 900, clears: 1 } : null),
});

describe('chapter one on the scroll', () => {
  it('opens a section after each one cleared, in order', () => {
    expect(openCount(done())).toBe(1);
    expect(openCount(done('luobi'))).toBe(2);
    expect(openCount(done('luobi', 'jiangcun'))).toBe(3);
    // 1-2 cleared without 1-1 (a ?dungeon= run) opens nothing past 1-1
    expect(openCount(done('jiangcun'))).toBe(1);
    expect(clearedCount(done('jiangcun'))).toBe(0);
    expect(clearedCount(done('luobi', 'jiangcun', 'screen'))).toBe(3);
  });

  it('unrolls to the open section and a peek of the next, all of it at the end', () => {
    expect(unrolledTo(1)).toBeCloseTo(CHAPTER1[0].to + PEEK);
    expect(unrolledTo(2)).toBeCloseTo(CHAPTER1[1].to + PEEK);
    expect(unrolledTo(3)).toBe(1);
    expect(colouredTo(0)).toBe(0);
    expect(colouredTo(1)).toBe(CHAPTER1[0].to);
  });

  it('finds the section under a point and a dungeon', () => {
    expect(sectionAt(0)?.id).toBe('1-1');
    expect(sectionAt(0.5)?.id).toBe('1-2');
    expect(sectionAt(1)?.id).toBe('1-3');
    expect(sectionOf('screen')?.id).toBe('1-3');
    expect(sectionOf('heifeng')).toBeNull();
  });
});

describe('the scroll panned', () => {
  it('stays between its ends, centred when it is narrower than the view', () => {
    const p = new Pan(100, 300);
    p.centre(1000);
    expect(p.x).toBe(-200);
    p.centre(-1000);
    expect(p.x).toBe(0);
    const narrow = new Pan(300, 100);
    narrow.nudge(50);
    expect(narrow.x).toBe(100);
  });

  it('tells a tap from a drag', () => {
    const p = new Pan(100, 1000);
    p.press(50, 0);
    p.move(55, 10);
    expect(p.release(20)).toBe(true);
    expect(p.x).toBe(0);
    p.press(50, 0);
    p.move(20, 10);
    expect(p.release(20)).toBe(false);
    expect(p.x).toBe(-30);
  });

  it('flings on after a quick release and comes to rest', () => {
    const p = new Pan(100, 10000);
    p.press(100, 0);
    p.move(80, 10);
    p.move(60, 20);
    p.release(25);
    const at = p.x;
    let n = 0;
    while (p.step(16) && n < 1000) n++;
    expect(p.x).toBeLessThan(at);
    expect(n).toBeLessThan(1000);
    // a pause before lifting stops it
    p.press(100, 0);
    p.move(80, 10);
    p.release(200);
    expect(p.step(16)).toBe(false);
  });
});
