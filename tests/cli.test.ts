import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const file = join(mkdtempSync(join(tmpdir(), 'nicereps-')), 'cli.sqlite');
const run = (db: string, ...args: string[]) =>
  execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', 'cli/nicereps.ts', db, ...args], { encoding: 'utf8' }).trim();
const cli = (...args: string[]) => run(file, ...args);

test('CLI operations persist across processes', () => {
  cli('seed');
  const workout = cli('start', '--at', '2026-10-01T07:00:00+10:00', '--tz', 'Australia/Brisbane');
  const exercise = cli('add', workout, 'Back Squat');
  const set = cli('set', exercise, '110', '3');
  cli('edit', set, '--done', 'true');
  cli('finish', workout);
  cli('setting', 'weightUnit', 'kg');

  assert.match(cli('history', 'Back Squat'), new RegExp(`${workout}  Workout  2026-10-01 \\(Australia/Brisbane\\)  finished[\\s\\S]*${set}  normal  110 kg × 3  done`));
  assert.match(cli('totals', '2026-10-04'), /quads +4\n/);
  assert.equal(cli('setting', 'weightUnit'), 'kg');

  const deleted = cli('remove-set', set);
  assert.doesNotMatch(cli('history', 'Back Squat'), new RegExp(set));
  cli('restore-set', deleted);
  assert.match(cli('history', 'Back Squat'), new RegExp(`${set}  normal  110 kg × 3  done`));

  cli('star-pr', 'Back Squat', 'e1rm', 'true');
  assert.match(cli('prs'), /^★ Back Squat +e1RM 121\.0 kg +no change since 2026-10-01\n  Romanian Deadlift +weight 90 kg × 8 +1 workout\n[\s\S]*\n  Back Squat +weight 110 kg × 3 +no change since 2026-10-01\n/);
  assert.throws(() => cli('star-pr', 'Back Squat', 'reps', 'true'), /Record must be weight, e1rm or hold/);
});

test('CLI logs and corrects a mixed-mode workout', () => {
  const workout = cli('start', '--at', '2026-10-08T07:00:00+10:00', '--tz', 'Australia/Brisbane');
  cli('exercise', 'Swim', 'distance', 'lats', '', '--rest', '90');
  const [bench, plank, run, bike, mobility, swim] = ['Bench Press', 'Plank', 'Run', 'Bike Sprints', 'Mobility Flow', 'Swim'].map((name) => cli('add', workout, name));
  const set = cli('set', bench, '85', '8', '--target-rpe', '8', '--rpe', '9', '--rest', '180', '--fields', 'rpe,rest');
  cli('set', plank, '--duration', '60', '--done', 'true');
  cli('set', run, '--distance', '5', '--duration', '1500', '--done', 'true');
  cli('set', bike, '--rounds', '8', '--duration', '20', '--recovery', '10', '--done', 'true');
  cli('set', mobility, '--comment', 'hips', '--done', 'true');
  cli('set', swim, '--distance', '6', '--duration', '1799');
  cli('edit', set, '--done', 'true', '--rpe', '', '--type', 'drop', '--comment', 'paused');
  cli('finish', workout);

  const shown = cli('show', workout);
  assert.match(shown, new RegExp(`${set}  drop    85 kg × 8  done  PR  target RPE 8  rest 180s  "paused"  fields rpe,rest`));
  assert.match(shown, /Plank  duration  \[abdominals\]\n.*normal  1:00  done/);
  assert.match(shown, /5 km in 25:00 · 5:00\/km  done/);
  assert.match(shown, /8 × 0:20 on \/ 0:10 off  done/);
  assert.match(shown, /complete  done  "hips"/);
  assert.match(shown, /Swim  distance  \[lats\]\n.*6 km in 29:59 · 5:00\/km/);
  assert.throws(() => cli('edit', set, '--rpe', '11'), /RPE/);
});

test('CLI template edits leave started and finished workouts unchanged', () => {
  const finished = cli('start', 'Legs', '--at', '2026-10-09T07:00:00+10:00', '--tz', 'Australia/Brisbane');
  cli('finish', finished);
  const started = cli('start', 'Legs', '--at', '2026-10-10T07:00:00+10:00', '--tz', 'Australia/Brisbane');
  const before = [cli('show', finished), cli('show', started)];

  cli('template-set', 'Legs', '1', '2', '--weight', '140', '--reps', '3');
  cli('template-remove', 'Legs', '2');
  const edited = cli('rename-template', 'Legs', 'Legs heavy');
  assert.match(edited, /Legs heavy\n  1  Back Squat  reps\n     1  warm-up 60 kg × 8\n     2  normal  140 kg × 3\n     3  normal  102.5 kg × 5\n     4  normal  102.5 kg × 5$/);
  assert.deepEqual([cli('show', finished), cli('show', started)], before);

  cli('save-template', finished, 'Legs as logged');
  assert.match(cli('template', 'Legs as logged'), /Back Squat[\s\S]*Romanian Deadlift/);
  cli('delete-template', 'Legs heavy');
  assert.deepEqual([cli('show', finished), cli('show', started)], before);
  assert.doesNotMatch(cli('templates'), /Legs heavy/);
});

test('CLI one-off plan change affects only its date', () => {
  cli('weekly', 'monday', 'Push A');
  const before = cli('plan', '2026-10-12', '14').split('\n');
  cli('plan-day', '2026-10-19', 'Pull B');
  const after = cli('plan', '2026-10-12', '14').split('\n');
  assert.deepEqual(after.filter((d, i) => d !== before[i]), ['2026-10-19  mon  Pull B  (this day only; weekly: Push A)']);
  cli('reset-day', '2026-10-19');
  assert.deepEqual(cli('plan', '2026-10-12', '14').split('\n'), before);
});

test('CLI records measurements in separate left and right series', () => {
  cli('measure', 'left calf', '38.5', '--date', '2026-10-01');
  cli('measure', 'right-calf', '38.25', '--date', '2026-10-01');
  cli('new-measurement', 'Wrist', 'length', 'Just above the wrist bone');
  cli('measure', 'wrist', '17');

  const shown = cli('measurements');
  assert.match(shown, /Left calf  preset length\n    method: Stand with weight on both feet\. Tape around the left calf at its widest\. .*\n    \w+  2026-10-01  38\.5 cm\n/);
  assert.match(shown, /Right calf  preset length\n.*\n    \w+  2026-10-01  38\.25 cm\n/);
  assert.match(shown, /Wrist  custom length\n    method: Just above the wrist bone\n    \w+  \d{4}-\d{2}-\d{2}  17 cm/);
  assert.throws(() => cli('measure', 'ankle', '20'), /Not found: ankle/);
});

test('CLI corrects and deletes measurements and series', () => {
  const first = cli('measure', 'neck', '38', '--date', '2026-10-01');
  const second = cli('measure', 'neck', '37.5', '--date', '2026-10-08');
  cli('edit-measurement', first, '38.5');
  cli('edit-measurement', second, '37', '--date', '2026-10-09');
  assert.match(cli('measurements'), new RegExp(`Neck  preset length\n.*\n    ${first}  2026-10-01  38\\.5 cm\n    ${second}  2026-10-09  37 cm`));
  cli('delete-measurement', first);
  assert.doesNotMatch(cli('measurements'), new RegExp(first));
  assert.throws(() => cli('edit-measurement', first, '38'), /Not found/);
  cli('delete-series', 'Neck');
  assert.doesNotMatch(cli('measurements'), /Neck/);
  assert.throws(() => cli('delete-series', 'Neck'), /Not found: Neck/);
});

test('CLI prs shows a PR gain since the first workout in its trend, and an equal e1RM as no change', () => {
  cli('exercise', 'Tie Lift', 'reps', 'quads');
  for (const [at, weight, reps] of [['2026-08-01', '40', '4'], ['2026-08-08', '42.5', '2']]) {
    const workout = cli('log', at);
    cli('edit', cli('set', cli('add', workout, 'Tie Lift'), weight, reps), '--done', 'true');
  }
  const prs = cli('prs');
  assert.match(prs, /Tie Lift +weight 42\.5 kg × 2 +\+2\.5 kg since 2026-08-01\n/);
  assert.match(prs, /Tie Lift +e1RM 45\.3 kg +no change since 2026-08-01(\n|$)/);
});

test('CLI health lists pending writes and removals until marked', () => {
  const own = join(mkdtempSync(join(tmpdir(), 'nicereps-')), 'health.sqlite');
  const cli = (...args: string[]) => run(own, ...args);
  const workout = cli('start', '--at', '2026-10-10T07:00:00+10:00', '--tz', 'Australia/Brisbane');
  cli('finish', workout);
  assert.match(cli('health'), new RegExp(`^write  workout  ${workout}  Workout  2026-10-09T21:00:00\\.000Z  `, 'm'));
  cli('health', '--mark');
  assert.equal(cli('health'), '');
  cli('delete', workout);
  assert.equal(cli('health', '--mark'), `remove  workout  ${workout}`);
  assert.equal(cli('health'), '');
});

test('CLI health-read adds store weights to dates with none, once, without writing them back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nicereps-'));
  const cli = (...args: string[]) => run(join(dir, 'read.sqlite'), ...args);
  const samples = join(dir, 'samples.json');
  writeFileSync(samples, JSON.stringify([{ id: 'a', at: '2026-10-08T21:30:00Z', kg: 79.9 }, { id: 'b', at: '2026-10-07T21:30:00Z', kg: 81 }]));
  cli('measure', 'body-weight', '80.5', '--date', '2026-10-08');
  assert.equal(cli('health-read', samples, '--tz', 'Australia/Brisbane'), 'added  1');
  assert.equal(cli('health-read', samples, '--tz', 'Australia/Brisbane'), 'added  0');
  assert.match(cli('measurements'), /2026-10-08  80\.5 kg\n.*2026-10-09  79\.9 kg/s);
  assert.match(cli('health'), /^write  weight  \S+  2026-10-08  80\.5 kg$/);
  writeFileSync(samples, JSON.stringify([{ id: 'c', at: '2026-10-09T21:30:00Z', kg: -1 }]));
  assert.throws(() => cli('health-read', samples), /Expected a JSON array/);
});
