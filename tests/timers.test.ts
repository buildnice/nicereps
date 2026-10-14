import assert from 'node:assert/strict';
import test from 'node:test';

import { digitClock, digitSeconds, intervalPhases, livePhase, phaseAt, phaseEnds, timeDigits } from '../src/domain/rules.ts';

test('intervals alternate work and recovery, with no recovery after the last round', () => {
  assert.deepEqual(intervalPhases({ rounds: 2, duration: 20, recovery: 10 }), [
    { label: 'Work', seconds: 20 },
    { label: 'Recover', seconds: 10 },
    { label: 'Work', seconds: 20 },
  ]);
  assert.deepEqual(intervalPhases({ rounds: 3, duration: 30, recovery: 0 }).map((p) => p.seconds), [30, 30, 30]);
  assert.deepEqual(intervalPhases({ rounds: 0, duration: 20, recovery: 10 }), []);
  assert.deepEqual(intervalPhases({ rounds: 4, duration: null, recovery: null }), []);
});

test('phaseAt finds the running phase and counts past the end', () => {
  const phases = intervalPhases({ rounds: 2, duration: 20, recovery: 10 });
  assert.deepEqual(phaseAt(phases, 0), { index: 0, label: 'Work', seconds: 20, remaining: 20 });
  assert.deepEqual(phaseAt(phases, 20), { index: 1, label: 'Recover', seconds: 10, remaining: 10 });
  assert.deepEqual(phaseAt(phases, 45), { index: 2, label: 'Work', seconds: 20, remaining: 5 });
  assert.deepEqual(phaseAt(phases, 52), { index: 2, label: 'Work', seconds: 20, remaining: -2 });
  assert.equal(phaseAt([], 0), undefined);
});

test('phaseEnds counts finished phases and the seconds since the latest end', () => {
  const phases = intervalPhases({ rounds: 2, duration: 20, recovery: 10 });
  assert.deepEqual(phaseEnds(phases, 0), { ended: 0, since: Infinity });
  assert.deepEqual(phaseEnds(phases, 19.5), { ended: 0, since: Infinity });
  assert.deepEqual(phaseEnds(phases, 20), { ended: 1, since: 0 });
  assert.deepEqual(phaseEnds(phases, 31), { ended: 2, since: 1 });
  assert.deepEqual(phaseEnds(phases, 50.5), { ended: 3, since: 0.5 });
  assert.deepEqual(phaseEnds(phases, 600), { ended: 3, since: 550 });
  assert.deepEqual(phaseEnds([], 5), { ended: 0, since: Infinity });
});

test('time entry shifts digits in from the right as hh:mm:ss', () => {
  const typed = ['1', '0', '0'].reduce((d, k) => d + k, '');
  assert.equal(digitClock(typed), '00:01:00');
  assert.equal(digitSeconds(typed), 60);
  assert.equal(digitSeconds('13000'), 5400);
  assert.equal(digitSeconds('90'), 90);
  assert.equal(digitSeconds(''), undefined);
  assert.equal(digitClock(''), '00:00:00');
  for (const s of [0, 45, 90, 3600, 5430]) assert.equal(digitSeconds(timeDigits(s)) ?? 0, s);
  assert.equal(digitSeconds('999999'), 359999);
  assert.equal(timeDigits(400000), '995959');
  assert.equal(timeDigits(5430), '13030');
});

test('the live countdown shows the current phase window and ends after the last phase', () => {
  const t0 = 1_000_000;
  const rest = [{ label: 'Rest', seconds: 90 }];
  assert.deepEqual(livePhase(rest, t0, t0 + 30_000), { title: 'Rest', start: t0, end: t0 + 90_000 });
  assert.equal(livePhase(rest, t0, t0 + 90_000), null);
  assert.equal(livePhase([], t0, t0), null);
  const intervals = intervalPhases({ rounds: 2, duration: 20, recovery: 10 });
  assert.deepEqual(livePhase(intervals, t0, t0), { title: 'Work · 1/3', start: t0, end: t0 + 20_000 });
  assert.deepEqual(livePhase(intervals, t0, t0 + 25_000), { title: 'Recover · 2/3', start: t0 + 20_000, end: t0 + 30_000 });
  assert.deepEqual(livePhase(intervals, t0, t0 + 30_000), { title: 'Work · 3/3', start: t0 + 30_000, end: t0 + 50_000 });
  assert.equal(livePhase(intervals, t0, t0 + 50_000), null);
  const extended = [{ label: 'Rest', seconds: 120 }];
  assert.deepEqual(livePhase(extended, t0, t0 + 100_000), { title: 'Rest', start: t0, end: t0 + 120_000 });
});
