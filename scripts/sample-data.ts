import { closeSync, openSync, rmSync, writeSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { Db } from '../src/data/db.ts';
import { exerciseId } from '../src/data/queries.ts';
import { logBodyWeight } from '../src/domain/measurements.ts';
import { exportArchive } from '../src/domain/portability.ts';
import { isDate } from '../src/domain/rules.ts';
import { addExercise, addSet, createExercise, finishWorkout, noteWorkout, rateWorkout, renameWorkout, startWorkout, templateFromWorkout } from '../src/domain/workouts.ts';

// A believable ~5 months of training for App Review, built through the app's own domain operations.
// Usage: node scripts/sample-data.ts <out.zip> [--end YYYY-MM-DD] [--tz America/Los_Angeles] [--seed 19]

type Kind = 'barbell' | 'dumbbell' | 'machine' | 'body' | 'plank' | 'treadmill' | 'run' | 'row';
type Lift = { kind: Kind; kg: number; reps: [number, number]; sets: number; warmup?: boolean };

const lifts: Record<string, Lift> = {
  'Barbell Squat': { kind: 'barbell', kg: 80, reps: [5, 8], sets: 3, warmup: true },
  'Barbell Bench Press - Medium Grip': { kind: 'barbell', kg: 65, reps: [5, 8], sets: 3, warmup: true },
  'Barbell Deadlift': { kind: 'barbell', kg: 110, reps: [3, 5], sets: 3, warmup: true },
  'Standing Military Press': { kind: 'barbell', kg: 40, reps: [5, 8], sets: 3 },
  'Bent Over Barbell Row': { kind: 'barbell', kg: 60, reps: [6, 10], sets: 3 },
  'Romanian Deadlift': { kind: 'barbell', kg: 80, reps: [8, 10], sets: 3 },
  'Barbell Hip Thrust': { kind: 'barbell', kg: 70, reps: [8, 12], sets: 3 },
  'Barbell Curl': { kind: 'barbell', kg: 25, reps: [8, 12], sets: 2 },
  'Goblet Squat': { kind: 'dumbbell', kg: 24, reps: [8, 12], sets: 3 },
  'Incline Dumbbell Press': { kind: 'dumbbell', kg: 22, reps: [8, 12], sets: 3 },
  'Dumbbell Bench Press': { kind: 'dumbbell', kg: 24, reps: [8, 12], sets: 3 },
  'Side Lateral Raise': { kind: 'dumbbell', kg: 8, reps: [12, 15], sets: 3 },
  'Hammer Curls': { kind: 'dumbbell', kg: 12, reps: [10, 12], sets: 2 },
  'Dumbbell Lunges': { kind: 'dumbbell', kg: 14, reps: [10, 12], sets: 2 },
  'Leg Press': { kind: 'machine', kg: 140, reps: [10, 12], sets: 3 },
  'Leg Extensions': { kind: 'machine', kg: 45, reps: [10, 15], sets: 2 },
  'Lying Leg Curls': { kind: 'machine', kg: 35, reps: [10, 12], sets: 3 },
  'Wide-Grip Lat Pulldown': { kind: 'machine', kg: 55, reps: [8, 12], sets: 3 },
  'Seated Cable Rows': { kind: 'machine', kg: 55, reps: [10, 12], sets: 3 },
  'Triceps Pushdown': { kind: 'machine', kg: 25, reps: [10, 15], sets: 3 },
  'Face Pull': { kind: 'machine', kg: 20, reps: [12, 15], sets: 2 },
  'Standing Calf Raises': { kind: 'machine', kg: 60, reps: [12, 15], sets: 3 },
  Pullups: { kind: 'body', kg: 0, reps: [5, 10], sets: 3 },
  'Dips - Triceps Version': { kind: 'body', kg: 0, reps: [8, 12], sets: 3 },
  'Hanging Leg Raise': { kind: 'body', kg: 0, reps: [8, 15], sets: 2 },
  Pushups: { kind: 'body', kg: 0, reps: [15, 25], sets: 3 },
  Plank: { kind: 'plank', kg: 45, reps: [0, 0], sets: 2 },
  'Rowing, Stationary': { kind: 'row', kg: 300, reps: [0, 0], sets: 1 },
  'Running, Treadmill': { kind: 'treadmill', kg: 1200, reps: [0, 0], sets: 1 },
  'Outdoor Run': { kind: 'run', kg: 4, reps: [0, 0], sets: 1 },
};

// [exercise, chance it is done]; the first ones are the main lifts.
type Split = [string, [string, number][]];
const fullBody: Split[] = [
  ['Full Body A', [['Barbell Squat', 1], ['Barbell Bench Press - Medium Grip', 1], ['Bent Over Barbell Row', 0.9], ['Leg Extensions', 0.6], ['Barbell Curl', 0.5], ['Plank', 0.6]]],
  ['Full Body B', [['Barbell Deadlift', 1], ['Standing Military Press', 1], ['Pullups', 0.9], ['Goblet Squat', 0.7], ['Leg Extensions', 0.4], ['Hanging Leg Raise', 0.5]]],
];
const upperLower: Split[] = [
  ['Upper', [['Barbell Bench Press - Medium Grip', 1], ['Bent Over Barbell Row', 1], ['Standing Military Press', 0.8], ['Wide-Grip Lat Pulldown', 0.8], ['Side Lateral Raise', 0.6], ['Triceps Pushdown', 0.6], ['Barbell Curl', 0.5]]],
  ['Lower', [['Barbell Squat', 1], ['Romanian Deadlift', 0.9], ['Leg Press', 0.6], ['Lying Leg Curls', 0.7], ['Standing Calf Raises', 0.5], ['Plank', 0.5]]],
  ['Upper', [['Standing Military Press', 1], ['Pullups', 1], ['Incline Dumbbell Press', 0.8], ['Seated Cable Rows', 0.8], ['Side Lateral Raise', 0.6], ['Hammer Curls', 0.5]]],
  ['Lower', [['Barbell Deadlift', 1], ['Leg Press', 0.8], ['Lying Leg Curls', 0.7], ['Standing Calf Raises', 0.6], ['Hanging Leg Raise', 0.5]]],
];
const pushPullLegs: Split[] = [
  ['Push', [['Barbell Bench Press - Medium Grip', 1], ['Standing Military Press', 0.9], ['Incline Dumbbell Press', 0.8], ['Side Lateral Raise', 0.8], ['Triceps Pushdown', 0.7], ['Dips - Triceps Version', 0.5]]],
  ['Pull', [['Barbell Deadlift', 0.9], ['Pullups', 1], ['Seated Cable Rows', 0.8], ['Face Pull', 0.7], ['Hammer Curls', 0.6], ['Barbell Curl', 0.5]]],
  ['Legs', [['Barbell Squat', 1], ['Romanian Deadlift', 0.9], ['Barbell Hip Thrust', 0.8], ['Lying Leg Curls', 0.7], ['Standing Calf Raises', 0.6], ['Hanging Leg Raise', 0.4], ['Plank', 0.3]]],
];
const hotel: Split = ['Hotel gym', [['Dumbbell Bench Press', 1], ['Goblet Squat', 1], ['Pushups', 0.9], ['Dumbbell Lunges', 0.8], ['Plank', 0.7]]];

const days = 150;
// Phases, gaps and deloads as fractions of the span so a different end date keeps the same story.
const at = (f: number) => Math.round(f * days);
const phases = [
  { from: 0, splits: fullBody, perWeek: 3, morning: true },
  { from: at(0.37), splits: upperLower, perWeek: 3.6, morning: false },
  { from: at(0.7), splits: pushPullLegs, perWeek: 4.4, morning: false },
];
const sick = [at(0.25), at(0.25) + 6];
const travel = [at(0.62), at(0.62) + 8];
const deload = [at(0.52), at(0.52) + 6];

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The UTC instant of a wall-clock time in a time zone.
const instant = (date: string, minutes: number, timeZone: string) => {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess).map((x) => [x.type, x.value]));
  return new Date(2 * guess - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`));
};

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const generate = (db: Db, end: string, timeZone: string, seed = 19) => {
  const random = rng(seed);
  const chance = (p: number) => random() < p;
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const between = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  createExercise(db, 'Outdoor Run', [{ muscle: 'quads', role: 'primary' }, { muscle: 'calves', role: 'secondary' }], { mode: 'distance', equipment: 'none' });
  const state = Object.fromEntries(Object.entries(lifts).map(([name, l]) => [name, { kg: l.kg, reps: l.reps[0], misses: 0 }]));
  const step = { barbell: 2.5, dumbbell: 2, machine: 5 } as Partial<Record<Kind, number>>;
  const round = (kind: Kind, kg: number) => Math.max(step[kind] ?? 1, Math.round(kg / (step[kind] ?? 1)) * (step[kind] ?? 1));
  const ids: Record<string, string> = {};
  const last: Record<string, string> = {};
  const start = addDays(end, -days);
  let rotation = 0;
  let streak = 0;
  let sinceBreak = 99;
  let bodyWeight = 81.8;
  let comeback: string | undefined;
  let deloaded = false;

  const session = (date: string, minutes: number, [name, plan]: Split, mood: { bad: boolean; light: number; short: boolean; note?: string }) => {
    const begin = instant(date, minutes, timeZone);
    const id = startWorkout(db, { now: begin, timeZone });
    renameWorkout(db, id, name);
    const chosen = plan.filter(([, p], i) => (mood.short ? i < between(2, 3) : chance(p)));
    let sets = 0;
    let cardio = 0;
    let rose = false;
    for (const [exercise] of chosen) {
      const lift = lifts[exercise];
      const s = state[exercise];
      const we = addExercise(db, id, (ids[exercise] ??= exerciseId(db, exercise)));
      if (lift.kind === 'plank' || lift.kind === 'row' || lift.kind === 'treadmill') {
        for (let i = 0; i < lift.sets; i++) {
          const duration = s.kg - (lift.kind === 'plank' ? (mood.bad ? 10 : 0) + i * between(0, 2) * 5 : 0);
          addSet(db, we, { duration, completed: true });
          cardio += lift.kind === 'plank' ? 0 : duration;
        }
        if (!mood.bad) s.kg += lift.kind === 'plank' ? (chance(0.5) ? 5 : 0) : lift.kind === 'treadmill' ? 60 : 0;
        sets += lift.sets;
        continue;
      }
      if (lift.kind === 'run') {
        const km = Math.round((s.kg + random() * 2.5) * 10) / 10;
        const duration = Math.round(km * (348 + (sinceBreak > 7 ? 0 : 15) + between(-12, 18)));
        addSet(db, we, { distance: km, duration, completed: true });
        cardio += duration;
        s.kg = Math.min(8, s.kg + 0.15);
        sets++;
        continue;
      }
      const kg = lift.kind === 'body' ? 0 : round(lift.kind, s.kg * mood.light);
      if (lift.warmup) {
        addSet(db, we, { type: 'warm-up', weight: round(lift.kind, kg * 0.5), reps: 8, completed: true });
        if (kg > 90) addSet(db, we, { type: 'warm-up', weight: round(lift.kind, kg * 0.75), reps: 3, completed: true });
      }
      const count = lift.sets + (chance(0.25) ? 1 : 0) - (mood.short && chance(0.5) ? 1 : 0);
      const done: number[] = [];
      for (let i = 0; i < count; i++) {
        if (i === count - 1 && i > 1 && chance(0.04)) {
          addSet(db, we, { weight: kg, completed: false });
          continue;
        }
        const fatigue = i > 0 && chance(0.35) ? 1 : 0;
        const reps = Math.max(1, s.reps - fatigue - (mood.bad ? between(1, 2) : 0) + (chance(0.15) ? 1 : 0));
        const top = i === 0 && lift.kind === 'barbell' && chance(0.4);
        const comment = mood.bad && i === count - 1 && chance(0.4) ? pick(['grip gave out', 'form broke down, stopped', 'no gas left', 'lower back tight']) : chance(0.015) ? pick(['paused reps', 'belt', 'straps', 'slow eccentric']) : null;
        addSet(db, we, { weight: kg, reps, rpe: top ? Math.min(10, pick([7, 7.5, 8, 8.5, 9]) + (mood.bad ? 1 : 0)) : null, comment, completed: true });
        done.push(reps);
      }
      sets += done.length;
      if (mood.light < 1) continue;
      // Double progression: add reps until every set hits the top of the range, then add weight; three clear misses back off 10%.
      if (done.length && done.every((r) => r >= lift.reps[1])) {
        if (lift.kind === 'body') continue;
        s.kg += (step[lift.kind] ?? 1) * (lift.kind === 'machine' || exercise === 'Barbell Deadlift' ? 1 : chance(0.6) ? 1 : 0.5);
        s.reps = lift.reps[0];
        rose ||= lift.warmup === true;
      } else if (done.filter((r) => r >= s.reps).length >= done.length - 1) {
        if (!mood.bad) s.reps = Math.min(lift.reps[1], s.reps + 1);
        s.misses = 0;
      } else if (done.filter((r) => r >= s.reps - 1).length < done.length / 2 && ++s.misses >= 3) {
        s.kg *= 0.9;
        s.reps = lift.reps[0];
        s.misses = 0;
      }
    }
    if (mood.note) noteWorkout(db, id, mood.note);
    else if (mood.bad && chance(0.5)) noteWorkout(db, id, pick(['Slept badly, everything felt heavy.', 'Rough day at work, just got it done.', 'Low energy. Cut it short-ish.', 'Left knee a bit cranky on squats.', 'Shoulder felt off, skipped the last set.', 'Too hot in the gym today.']));
    else if (rose && chance(0.3)) noteWorkout(db, id, pick(['Felt strong today!', 'Weight went up and moved well.', 'Good session, finally moved up.']));
    else if (chance(0.04)) noteWorkout(db, id, pick(['Gym was packed, had to swap the order around.', 'Trained with Sam today.', 'New gym playlist helped.', 'Tried a slower tempo on everything.', 'Quick one before work.']));
    if (chance(0.35)) {
      rateWorkout(db, id, 'sleep', mood.bad ? between(1, 3) : between(3, 5));
      rateWorkout(db, id, 'feel', mood.bad ? between(1, 2) : between(3, 5));
      rateWorkout(db, id, 'energy', mood.bad ? between(1, 3) : between(3, 5));
    }
    finishWorkout(db, id, new Date(begin.getTime() + cardio * 1000 + (sets * (2.4 + random()) + between(4, 12)) * 60_000));
    last[name] = id;
  };

  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const phase = phases.findLast((p) => d >= p.from)!;
    if (d % between(2, 4) === 0 && !(d >= sick[0] && d <= sick[1]) && !(d >= travel[0] && d <= travel[1])) {
      bodyWeight += -0.03 * 3 + (random() - 0.45) * 0.5 + (d > at(0.7) ? 0.06 : 0);
      logBodyWeight(db, Math.round(bodyWeight * 10) / 10, date);
    }
    if (d >= sick[0] && d <= sick[1]) {
      sinceBreak = 0;
      comeback = 'First session back after being sick. Took it easy.';
      continue;
    }
    if (d >= travel[0] && d <= travel[1]) {
      sinceBreak = 0;
      comeback = 'Back from the trip, everything felt rusty.';
      if (d === travel[0] + 3) session(date, 6 * 60 + 40, hotel, { bad: false, light: 1, short: false, note: 'Hotel gym. Dumbbells only went up to 30 kg.' });
      continue;
    }
    sinceBreak++;
    const morning = phase.morning ? !weekend : chance(0.15);
    const minutes = weekend ? between(8 * 60 + 30, 11 * 60) : morning ? between(5 * 60 + 50, 6 * 60 + 50) : chance(0.12) ? between(12 * 60, 12 * 60 + 25) : between(17 * 60 + 15, 19 * 60 + 30);
    // Train more after a rest streak, less after a run of days; weekends a bit less likely.
    const p = (phase.perWeek / 7) * (streak >= 3 ? 0.2 : streak === 0 ? 1.5 : 1) * (weekend ? 0.8 : 1.1);
    if (chance(p)) {
      const splits = phase.splits;
      const split = splits[rotation++ % splits.length];
      const back = sinceBreak <= 3;
      const bad = chance(back ? 0.4 : 0.12);
      const deloading = d >= deload[0] && d <= deload[1];
      const light = deloading ? 0.85 : back ? 0.9 : 1;
      const note = comeback ?? (deloading && !deloaded ? 'Deload week. Keeping it light.' : undefined);
      comeback = undefined;
      deloaded ||= deloading;
      session(date, minutes, split, { bad, light, short: !back && chance(0.1), note });
      streak++;
      // Double day: an easy run on the other side of the day.
      if (phase !== phases[0] && chance(0.07)) session(date, morning ? 18 * 60 + between(0, 45) : 6 * 60 + between(10, 50), ['Easy run', [['Outdoor Run', 1]]], { bad: false, light: 1, short: false });
    } else {
      streak = 0;
      if (weekend && phase !== phases[0] && chance(0.45)) session(date, between(7 * 60 + 30, 9 * 60 + 30), chance(0.7) ? ['Long run', [['Outdoor Run', 1]]] : ['Cardio', [['Running, Treadmill', 1], ['Rowing, Stationary', 0.6]]], { bad: false, light: 1, short: false });
    }
  }
  for (const name of ['Push', 'Pull', 'Legs']) if (last[name]) templateFromWorkout(db, last[name], name);
};

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { end: { type: 'string' }, tz: { type: 'string' }, seed: { type: 'string' } } });
  const timeZone = values.tz ?? 'America/Los_Angeles';
  const end = values.end ?? new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  if (!positionals[0] || !isDate(end)) throw new Error('Usage: node scripts/sample-data.ts <out.zip> [--end YYYY-MM-DD] [--tz ZONE] [--seed N]');
  const { openDb } = await import('../cli/db.ts');
  const db = openDb(':memory:');
  generate(db, end, timeZone, Number(values.seed ?? 19));
  const out = openSync(positionals[0], 'wx');
  try {
    const result = await exportArchive(db, () => null, (chunk) => writeSync(out, chunk));
    for (const [table, count] of Object.entries(result.tables)) if (count) console.log(`${table}  ${count}`);
  } catch (error) {
    closeSync(out);
    rmSync(positionals[0]);
    throw error;
  }
  closeSync(out);
}
