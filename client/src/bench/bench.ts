import { BENCH_SHOTS, benchRun, benchTopUp } from '@dnf/engine/bench';
import { botButtons } from '@dnf/engine/bot';
import type { Engine } from '@dnf/engine';

// ?bench: M2's performance target measured in this browser (engine/perf.test.ts does the same in
// Node). The worst-case scene, 12 monsters and 10 projectiles: the time of one tick, and of a
// 20-frame rollback as the online session does it (restore, then each tick stepped and
// snapshotted). Targets: under 1 ms and under 8 ms.

function tick(e: Engine): void {
  benchTopUp(e.state);
  e.step([{ owner: 0, tick: e.nextTick, buttons: botButtons(e.state, 0) }]);
}

/** Splits the work into slices so the page stays responsive while it runs. */
const pause = () => new Promise((r) => setTimeout(r, 0));

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

export async function runBench(out: HTMLElement): Promise<void> {
  const say = (line: string) => (out.textContent += line + '\n');
  out.textContent = '';
  say(`${navigator.userAgent}\n`);
  const e = benchRun();
  for (let i = 0; i < 300; i++) tick(e);
  const monsters = e.state.entities.filter((x) => x.team === 1 && x.hp > 0).length;
  say(`场景：${monsters} 只怪，${e.state.shots.length} 个飞行物（目标 12 / ${BENCH_SHOTS}）`);

  // (timed ten ticks at a time: the browser's clock is too coarse for one)
  const ticks: number[] = [];
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      for (let j = 0; j < 10; j++) tick(e);
      ticks.push((performance.now() - t0) / 10);
    }
    await pause();
  }
  const rollbacks: number[] = [];
  for (let r = 0; r < 60; r++) {
    const base = e.snapshot();
    for (let i = 0; i < 20; i++) tick(e);
    const t0 = performance.now();
    e.restore(base);
    for (let i = 0; i < 20; i++) {
      tick(e);
      e.snapshot();
    }
    rollbacks.push(performance.now() - t0);
    await pause();
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ok = (v: number, limit: number) => (v < limit ? '达标' : '超标');
  say(`单帧模拟（每 10 帧取平均）：平均 ${avg(ticks).toFixed(3)} ms，中位 ${median(ticks).toFixed(3)} ms，95% ${p95(ticks).toFixed(3)} ms（目标 < 1 ms，${ok(p95(ticks), 1)}）`);
  say(`回滚 20 帧：平均 ${avg(rollbacks).toFixed(2)} ms，中位 ${median(rollbacks).toFixed(2)} ms，95% ${p95(rollbacks).toFixed(2)} ms（目标 < 8 ms，${ok(p95(rollbacks), 8)}）`);
}
