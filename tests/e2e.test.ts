import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { strFromU8, unzipSync } from 'fflate';

const run = (file: string, ...args: string[]) =>
  spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', 'cli/nicereps.ts', file, ...args], { encoding: 'utf8' });
const db = (fixture?: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'nicereps-')), 'e2e.sqlite');
  if (fixture) {
    const sqlite = new DatabaseSync(file);
    sqlite.exec(readFileSync(join(import.meta.dirname, 'fixtures', fixture), 'utf8'));
    sqlite.close();
  }
  return (...args: string[]) => {
    const r = run(file, ...args);
    if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
    return r.stdout.trim();
  };
};
const id = (output: string, line: RegExp) => output.split('\n').find((l) => line.test(l))!.trim().split('  ')[0];
const at = (day: string) => ['--at', `${day}T07:00:00+10:00`, '--tz', 'Australia/Brisbane'];

test('data from an earlier app version migrates and its interrupted workout resumes until finished', () => {
  const cli = db('v6.sql');
  const active = cli('active');
  assert.match(active, /^nm8c0ed82zniwgw2xisacx51  Legs  2026-10-09 \(Australia\/Brisbane\)  in progress  "left knee sore"\n  hnd3sqaou3u0fw1l6jh3urzx  Back Squat/);
  assert.equal(active.match(/  -$/gm)?.length, 7);
  assert.equal(cli('setting', 'weekStart'), '');
  assert.equal(cli('history', 'Bench Press').match(/Push A  /g)?.length, 2);
  assert.match(cli('plan', '2026-10-08', '1'), /rest  \(this day only; weekly: Pull B\)/);
  assert.match(cli('measurements'), /Body weight  preset weight\n[\s\S]*2026-10-01  82\.4 kg\n[\s\S]*Wrist  custom length\n    method: Above the bone/);

  assert.throws(() => cli('start'), /Finish or discard the unfinished workout first/);
  const set = cli('set', 'hnd3sqaou3u0fw1l6jh3urzx', '110', '3', '--done', 'true');
  cli('finish', 'nm8c0ed82zniwgw2xisacx51');
  assert.equal(cli('active'), '');
  assert.match(cli('history', 'Back Squat'), new RegExp(`finished  "left knee sore"[\\s\\S]*${set}  normal  110 kg × 3  done`));
});

test('discarding an interrupted workout removes only that workout', () => {
  const cli = db('v6.sql');
  const before = cli('history');
  cli('discard', 'nm8c0ed82zniwgw2xisacx51');
  assert.equal(cli('active'), '');
  assert.equal(cli('history'), before);
  assert.throws(() => cli('discard', 'aomro3ca58iv9zmyvzzrwa1x'), /Only an unfinished workout can be discarded/);
});

test('a new set copies the previous set, else the last session of that exercise without its warm-ups', () => {
  const cli = db();
  cli('seed');
  const workout = cli('start', ...at('2026-10-08'));
  const bench = cli('add', workout, 'Bench Press');
  cli('set', bench);
  cli('set', bench, '85');
  cli('set', bench);
  assert.deepEqual([...cli('show', workout).matchAll(/normal  (\S+ kg) × 0  -  target (\d+) reps/g)].map((m) => `${m[1]} ${m[2]}`), ['82.5 kg 8', '85 kg 8', '85 kg 8']);
});

test('a workout started from an earlier one copies its plan and visible fields, not its results', () => {
  const cli = db();
  const first = cli('start', ...at('2026-10-01'));
  cli('set', cli('add', first, 'Romanian Deadlift'), '80', '5', '--target-rpe', '8', '--rpe', '9', '--comment', 'grip', '--fields', 'targetRpe,comment', '--done', 'true');
  cli('finish', first);
  const copy = cli('start', '--from', first, ...at('2026-10-08'));
  assert.match(cli('show', copy), /Romanian Deadlift.*\n.*normal  80 kg × 0  -  target 5 reps  target RPE 8  fields targetRpe,comment$/);
});

test('muscle sets over the last 7 days count completed working sets of finished workouts by local date', () => {
  const cli = db();
  cli('exercise', 'Press', 'reps', 'shoulders', 'triceps');
  cli('exercise', 'Row', 'reps', 'back');
  const workout = cli('start', '--at', '2026-10-05T22:00:00Z', '--tz', 'Australia/Brisbane');
  const [press, row] = ['Press', 'Row'].map((name) => cli('add', workout, name));
  cli('superset', press, row);
  cli('set', press, '40', '10', 'warm-up', '--done', 'true');
  cli('set', press, '60', '8', '--done', 'true');
  cli('set', press, '60', '8');
  cli('set', press, '45', '10', 'drop', '--done', 'true');
  cli('set', row, '70', '8', '--done', 'true');
  assert.doesNotMatch(cli('totals', '2026-10-06'), /shoulders/);
  cli('finish', workout);
  const unfinished = cli('start', ...at('2026-10-07'));
  cli('set', cli('add', unfinished, 'Row'), '70', '8', '--done', 'true');

  assert.equal(cli('totals', '2026-10-06'), '2026-09-30 to 2026-10-06: completed normal and drop sets; primary muscle 1, secondary 0.5\n  shoulders    2\n    Press  2\n  back         1\n    Row  1\n  triceps      1\n    Press  1');
  assert.match(cli('calendar', '2026-10-06', '1'), /2026-10-06    3 sets/);
  assert.match(cli('totals', '2026-10-12'), /^2026-10-06 to 2026-10-12[\s\S]*shoulders +2/);
  assert.doesNotMatch(cli('totals', '2026-10-13'), /shoulders/);
  assert.doesNotMatch(cli('totals', '2026-10-05'), /shoulders/);
});

test('correcting a finished workout updates totals, heatmap and records', () => {
  const cli = db();
  cli('seed');
  const workout = id(cli('recent'), /Push A  2026-10-06/);
  const shown = cli('show', workout);
  const bench = id(shown, /normal  82\.5 kg × 8/);
  const fly = id(shown, /drop .* -  /);
  const flyExercise = id(shown, /Cable Fly/);

  cli('edit', bench, '--weight', '90', '--rpe', '9');
  cli('edit', fly, '--done', 'true');
  cli('edit', bench, '--target-reps', '10');
  assert.match(cli('show', workout), new RegExp(`${bench}  .*target 10 reps`));
  cli('edit', bench, '--target-reps', '');
  assert.doesNotMatch(cli('show', workout), new RegExp(`${bench}  .*target`));
  cli('map', flyExercise, 'back');
  assert.match(cli('show', workout), new RegExp(`${bench}  normal  90 kg × 8  done  PR  RPE 9`));
  assert.match(cli('records', 'Bench Press'), /best weight  90 kg × 8  2026-10-06/);
  assert.match(cli('calendar', '2026-10-06', '1'), /2026-10-06    8 sets/);
  assert.match(cli('totals', '2026-10-11'), /chest +3\n    Bench Press  3\n  triceps +3\n    Bench Press  1.5\n    Overhead Press  1.5\n  back +2\n    Cable Fly  2$/);

  cli('date', workout, '2026-10-02');
  assert.doesNotMatch(cli('totals', '2026-10-11'), /chest/);
  assert.match(cli('records', 'Bench Press'), /best weight  90 kg × 8  2026-10-02/);
  assert.match(cli('calendar', '2026-10-06', '2'), /2026-10-02    8 sets/);
  assert.throws(() => cli('date', workout, '2999-01-01'), /Cannot move a workout to a future date/);
});

test('changing an exercise default mapping affects only later workouts', () => {
  const cli = db();
  cli('seed');
  const totals = cli('totals', '2026-10-06');
  cli('default-map', 'Bench Press', 'chest');
  assert.match(cli('history', 'Bench Press'), /Bench Press  reps  \[chest, shoulders\/2, triceps\/2\]/);
  assert.equal(cli('totals', '2026-10-06'), totals);
  assert.match(cli('show', cli('start', 'Push A', ...at('2026-10-08'))), /Bench Press  reps  \[chest\]\n/);
});

test('records come from completed working sets of finished workouts and keep the earliest tie', () => {
  const cli = db();
  cli('seed');
  const records = cli('records', 'Bench Press');
  assert.match(records, /best weight  82\.5 kg × 8  2026-09-29/);
  const workout = cli('start', ...at('2026-10-08'));
  const bench = cli('add', workout, 'Bench Press');
  cli('set', bench, '100', '5', 'warm-up', '--done', 'true');
  cli('set', bench, '95', '3');
  cli('set', bench, '120', '1', '--done', 'true');
  assert.equal(cli('records', 'Bench Press'), records);
  cli('finish', workout);
  assert.match(cli('records', 'Bench Press'), /3 sessions[\s\S]*best weight  120 kg × 1  2026-10-08/);
  assert.doesNotMatch(cli('records', 'Bench Press'), /100 kg × 5|95 kg × 3/);
});

test('a PR marks a set beating every earlier workout on weight, e1RM or hold; ties, reps at a weight and first sessions do not', () => {
  const cli = db();
  cli('seed');
  const workout = cli('start', ...at('2026-10-08'));
  const bench = cli('add', workout, 'Bench Press');
  const plank = cli('add', workout, 'Plank');
  const run = cli('add', workout, 'Run');
  const sets = [
    ['82.5', '8'],
    ['85', '5'],
    ['80', '10'],
    ['85', '5'],
    ['40', '11'],
    ['200', '1', 'warm-up'],
  ].map(([weight, reps, type]) => cli('set', bench, weight, reps, ...(type ? [type] : []), '--done', 'true'));
  const open = cli('set', bench, '200', '1');
  const hold = cli('set', plank, '--duration', '60', '--done', 'true');
  const longest = cli('set', plank, '--duration', '75', '--done', 'true');
  cli('set', run, '--distance', '5', '--duration', '1500', '--done', 'true');
  const marked = (output: string) => output.split('\n').filter((l) => l.endsWith('  PR') || l.includes('  PR  ')).map((l) => l.trim().split('  ')[0]);
  assert.deepEqual(marked(cli('show', workout)), [sets[1], sets[2]]);
  assert.doesNotMatch(cli('show', workout), new RegExp(`${open}.*PR|${hold}.*PR|${longest}.*PR`));
  cli('finish', workout);
  const next = cli('start', ...at('2026-10-09'));
  const plank2 = cli('add', next, 'Plank');
  const tie = cli('set', plank2, '--duration', '75', '--done', 'true');
  const longer = cli('set', plank2, '--duration', '90', '--done', 'true');
  const bench2 = cli('add', next, 'Bench Press');
  const reps = cli('set', bench2, '40', '12', '--done', 'true');
  const pounds = (cli('setting', 'weightUnit', 'lb'), cli('set', bench2, '190', '1', '--done', 'true'));
  const shown = cli('show', next);
  assert.deepEqual(marked(shown), [longer, pounds]);
  assert.doesNotMatch(shown, new RegExp(`(${tie}|${reps}).*PR`));
  cli('edit', longer, '--done', 'false');
  assert.deepEqual(marked(cli('show', next)), [pounds]);
});

test('deleting a template keeps its workouts and clears its planned days', () => {
  const cli = db();
  cli('seed');
  cli('weekly', 'monday', 'Legs');
  assert.match(cli('plan', '2026-10-12', '1'), /mon  Legs$/);
  assert.throws(() => cli('save-template', cli('start', 'Legs', ...at('2026-10-08')), 'Copy'), /Finish the workout before saving it as a template/);
  const history = cli('history', 'Back Squat');
  cli('delete-template', 'Legs');
  assert.match(cli('plan', '2026-10-12', '1'), /mon  rest$/);
  assert.equal(cli('history', 'Back Squat'), history);
  assert.match(cli('active'), /Legs  2026-10-08/);
});

test('a planned day is done once a workout is finished on it', () => {
  const cli = db();
  cli('seed');
  cli('weekly', 'thursday', 'Pull B');
  assert.match(cli('plan', '2026-10-01', '1'), /^2026-10-01  thu  Pull B  done$/);
  cli('start', 'Pull B', ...at('2026-10-08'));
  assert.match(cli('plan', '2026-10-08', '1'), /^2026-10-08  thu  Pull B$/);
});

test('moving or skipping one scheduled occurrence leaves the weekly plan intact', () => {
  const cli = db();
  cli('seed');
  cli('weekly', 'thursday', 'Pull B');
  cli('plan-day', '2099-01-01', 'Legs');
  cli('plan-day', '2099-01-02', 'Pull B');
  cli('plan-day', '2099-01-08');
  assert.deepEqual(cli('plan', '2099-01-01', '15').split('\n').filter((d) => !/  rest$/.test(d)), [
    '2099-01-01  thu  Legs  (this day only; weekly: Pull B)',
    '2099-01-02  fri  Pull B  (this day only; weekly: rest)',
    '2099-01-08  thu  rest  (this day only; weekly: Pull B)',
    '2099-01-15  thu  Pull B',
  ]);
  cli('reset-day', '2099-01-01');
  assert.match(cli('plan', '2099-01-01', '1'), /^2099-01-01  thu  Pull B$/);
});

test('workouts are independent of the template they came from, and a template can be made from a workout', () => {
  const cli = db();
  cli('seed');
  const done = id(cli('recent'), /Push A  2026-10-06/);
  const before = cli('show', done);
  cli('template-set', 'Push A', '1', '2', '--weight', '100');
  cli('rename-template', 'Push A', 'Push C');
  assert.equal(cli('show', done), before);
  const next = cli('start', 'Push C', ...at('2026-10-08'));
  assert.match(cli('show', next), /Push C[\s\S]*warm-up 40 kg × 0  -  target 10 reps\n.*normal  100 kg × 0  -  target 8 reps/);
  cli('template-set', 'Push C', '1', '2', '--weight', '105');
  assert.match(cli('show', next), /normal  100 kg × 0  -  target 8 reps/);
  cli('discard', next);
  cli('save-template', done, 'Push copy');
  assert.match(cli('template', 'Push copy'), /2  normal  82\.5 kg × 8/);
  cli('save-template', done, 'Push light', '--keep', 'reps');
  assert.match(cli('template', 'Push light'), /2  normal  0 kg × 8/);
  cli('save-template', done, 'Push blank', '--keep', '');
  assert.match(cli('template', 'Push blank'), /2  normal  0 kg × 0/);
  assert.throws(() => cli('save-template', done, 'Typo', '--keep', 'wieght'), /Expected weight or reps: wieght/);
});

test('comments attach to a workout, an exercise and a set, and one workout mixes every exercise mode', () => {
  const cli = db();
  for (const mode of ['reps', 'duration', 'distance', 'interval', 'check']) cli('exercise', `Drill ${mode}`, mode, 'back');
  const workout = cli('start', ...at('2026-10-08'));
  const add = (mode: string) => cli('add', workout, `Drill ${mode}`);
  cli('set', add('reps'), '20', '10', '--done', 'true');
  cli('set', add('duration'), '--duration', '90', '--done', 'true');
  cli('set', add('distance'), '--distance', '5', '--duration', '1500', '--done', 'true');
  cli('set', add('interval'), '--duration', '30', '--recovery', '15', '--rounds', '8', '--done', 'true');
  const check = add('check');
  cli('set', check, '--comment', 'felt ok', '--done', 'true');
  cli('note-exercise', check, 'outside');
  cli('note', workout, 'hotel');
  cli('finish', workout);
  const shown = cli('show', workout);
  for (const line of [/finished  "hotel"$/m, /20 kg × 10  done$/m, /normal  1:30  done$/m, /5 km in 25:00 · 5:00\/km  done$/m, /8 × 0:30 on \/ 0:15 off  done$/m, /check  \[back\]  "outside"\n.*normal  complete  done  "felt ok"$/m]) assert.match(shown, line);
  assert.match(cli('totals', '2026-10-08'), /back +5\n    Drill check  1\n    Drill distance  1\n    Drill duration  1\n    Drill interval  1\n    Drill reps  1$/);
});

test("an exercise's own note carries into every workout and template, apart from each workout's note", () => {
  const cli = db('v6.sql');
  assert.equal(cli('exercise-note', 'Back Squat', '  seat 4, pin 7 '), 'Back Squat note: seat 4, pin 7');
  const active = cli('active');
  assert.match(active, /Back Squat  reps  \[[^\]]*\]\n    note: seat 4, pin 7\n/);
  assert.match(cli('template', 'Legs'), /Back Squat  reps\n     note: seat 4, pin 7\n/);
  const squat = id(active, /Back Squat/);
  cli('note-exercise', squat, 'knee wraps today');
  cli('finish', active.split('  ')[0]);
  const fresh = cli('start', 'Legs', ...at('2026-10-10'));
  const shown = cli('show', fresh);
  assert.match(shown, /Back Squat  reps  \[[^\]]*\]\n    note: seat 4, pin 7\n/);
  assert.doesNotMatch(shown, /knee wraps/);
  assert.match(cli('history', 'Back Squat'), /"knee wraps today"\n(?!    note:)/);
  assert.equal(cli('exercise-note', 'Back Squat'), 'Back Squat note: none');
  assert.doesNotMatch(cli('show', fresh), /note:/);
});

test('deleting a finished workout removes it from history, totals and records', () => {
  const cli = db();
  cli('seed');
  cli('delete', id(cli('recent'), /Push A  2026-10-06/));
  assert.doesNotMatch(cli('totals', '2026-10-06'), /chest/);
  assert.match(cli('calendar', '2026-10-06', '1'), /2026-10-06    0 sets/);
  assert.match(cli('records', 'Bench Press'), /1 sessions?[\s\S]*2026-09-29/);
  assert.equal(cli('history', 'Bench Press').match(/Push A  /g)?.length, 1);
});

test('start lists the latest finished workout of each name, newest first', () => {
  const cli = db();
  cli('seed');
  cli('start', 'Legs', ...at('2026-10-08'));
  assert.deepEqual(cli('recent').split('\n').map((l) => l.split('  ').slice(1).join('  ')), ['Push A  2026-10-06', 'Legs  2026-10-04', 'Pull B  2026-10-01']);
});

test('a past day can log an empty finished workout to rename and fill in', () => {
  const cli = db();
  const workout = cli('log', '2026-10-02', '--tz', 'Australia/Brisbane');
  assert.equal(cli('show', workout), `${workout}  Workout  2026-10-02 (Australia/Brisbane)  finished`);
  cli('rename', workout, 'Hotel gym');
  cli('set', cli('add', workout, 'Romanian Deadlift'), '60', '10', '--done', 'true');
  assert.match(cli('recent'), new RegExp(`^${workout}  Hotel gym  2026-10-02$`));
  assert.match(cli('calendar', '2026-10-02', '1'), /2026-10-02    1 sets/);
  assert.throws(() => cli('rename', workout, ' '), /Workout name is required/);
  assert.throws(() => cli('log', '2999-01-01'), /Cannot log a future workout/);
});

test('exercises in a superset move as one block and a removed partner unlinks the other', () => {
  const cli = db();
  const workout = cli('start', ...at('2026-10-02'));
  const [solo, first, second] = ['Barbell Squat', 'Romanian Deadlift', 'Box Squat'].map((name) => cli('add', workout, name));
  cli('superset', first, second);
  const order = () => [...cli('show', workout).matchAll(/^  (\w+)  .*$/gm)].map((m) => [m[1], / superset /.test(m[0])]);
  cli('move-exercise', second, 'up');
  assert.deepEqual(order(), [[first, true], [second, true], [solo, false]]);
  cli('move-exercise', solo, 'up');
  assert.deepEqual(order(), [[solo, false], [first, true], [second, true]]);
  cli('remove-exercise', first);
  assert.deepEqual(order(), [[solo, false], [second, false]]);
});

test('measurements logged together are saved all or nothing, with left and right kept apart', () => {
  const cli = db();
  assert.equal(cli('measure', 'left calf', '38', 'right-calf', '38.5', 'body weight', '82', '--date', '2026-10-01').split('\n').length, 3);
  const shown = cli('measurements');
  assert.match(shown, /Body weight  preset weight\n.*\n    \w+  2026-10-01  82 kg\n/);
  assert.match(shown, /Left calf  preset length\n.*\n    \w+  2026-10-01  38 cm\n\w+  Right calf/);
  assert.throws(() => cli('measure', 'neck', '38', 'waist', '0'), /positive number/);
  assert.equal(cli('measurements'), shown);
});

test('entries keep the unit they were entered in and records compare across units', () => {
  const cli = db();
  cli('seed');
  cli('setting', 'weightUnit', 'lb');
  cli('setting', 'lengthUnit', 'in');
  const workout = cli('start', ...at('2026-10-08'));
  cli('set', cli('add', workout, 'Bench Press'), '180', '8', '--done', 'true');
  cli('finish', workout);
  cli('measure', 'waist', '32', '--date', '2026-10-01');
  cli('setting', 'weightUnit', 'kg');
  cli('setting', 'lengthUnit', 'cm');
  assert.match(cli('show', workout), /normal  180 lb × 8  done/);
  assert.match(cli('records', 'Bench Press'), /best weight  82\.5 kg × 8  2026-09-29/);
  assert.match(cli('measurements'), /2026-10-01  32 in/);
  cli('set', cli('add', cli('start', ...at('2026-10-09')), 'Bench Press'), '--done', 'true');
  assert.match(cli('active'), /normal  180 lb × 8  done/);
});

test('export writes every table and the photo files, refuses to overwrite, and erase leaves a fresh catalog', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nicereps-'));
  const file = join(dir, 'e2e.sqlite');
  const cli = (...args: string[]) => {
    const r = run(file, ...args);
    if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr}`);
    return r.stdout.trim();
  };
  cli('seed');
  cli('measure', 'body-weight', '80.5', '--date', '2026-10-01');
  const photos = join(dir, 'photos');
  mkdirSync(photos);
  writeFileSync(join(photos, 'front.jpg'), 'jpeg bytes');
  const sqlite = new DatabaseSync(file);
  sqlite.exec("INSERT INTO photo (id, date, file) VALUES ('p1', '2026-10-01', 'front.jpg'), ('p2', '2026-10-01', 'lost.jpg')");
  sqlite.close();

  const out = cli('export', join(dir, 'out.zip'), '--photos', photos);
  assert.match(out, /^setting  0\nexercise  \d+\n[\s\S]*\nworkout_set  \d+\n[\s\S]*\nmeasurement  1\nphoto  2\nstarred_record  0\nphoto files  1\nmissing photo  lost\.jpg$/);
  const files = unzipSync(readFileSync(join(dir, 'out.zip')));
  assert.equal(strFromU8(files['photos/front.jpg']), 'jpeg bytes');
  assert.equal(JSON.parse(strFromU8(files['manifest.json'])).tables.workout, Number(/^workout  (\d+)$/m.exec(out)![1]));
  assert.match(run(file, 'export', join(dir, 'out.zip')).stderr, /EEXIST/);

  cli('erase', '--photos', photos);
  assert.equal(existsSync(join(photos, 'front.jpg')), false);
  assert.equal(cli('templates'), '');
  assert.equal(cli('history'), '');
  assert.equal(cli('measurements'), '');
  assert.match(cli('exercises', 'Bench Press'), /Bench Press/);
});
