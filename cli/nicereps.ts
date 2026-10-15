import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { Mapping, Mode, SetFields, SetType } from '../src/data/queries.ts';
import { exerciseId, templateId } from '../src/data/queries.ts';
import { convert, localDate, pace, wholeIn } from '../src/domain/rules.ts';
import * as measures from '../src/domain/measurements.ts';
import { loadPlates } from '../src/domain/plates.ts';
import * as data from '../src/domain/portability.ts';
import * as ops from '../src/domain/workouts.ts';
import { openDb, readDb } from './db.ts';
import { seed } from './fixtures.ts';

const usage = `Usage: nicereps <db-file> <command> [args]
  seed                                  add fixture exercises, templates and workouts
  exercise <name> [reps|duration|distance|interval|check] [primary,...] [secondary,...] [--rest S]
  exercises [search]                    list exercises, custom first
  default-map <exercise> <primary,...> [secondary,...]
  start [template] [--from WORKOUT] [--at ISO] [--tz TZ]
                                        start fresh, from a template, or from an earlier workout
  active                                show unfinished workouts
  add <workout> <exercise>              add an exercise to a workout
  set <workout-exercise> [weight] [reps] [normal|warm-up|drop] [FIELDS]
                                        omitted values copy the previous set or last session
  plates <weight> [exercise]            plates per side on the bar
  bar <exercise> [weight]               set the exercise's own bar weight in the weight unit; omit it to use the Settings bar
  edit <set> [FIELDS]
  remove-set <set>                      prints the deleted set for restore-set
  restore-set <json>                    put a deleted set back at its position
  move-set <set> <index>
  remove-exercise <workout-exercise>
  move-exercise <workout-exercise> up|down  moves its superset block with it
  superset <workout-exercise> <workout-exercise>
  unlink <workout-exercise>
  note <workout> <text>
  note-exercise <workout-exercise> <text>  this workout's note on the exercise
  exercise-note <exercise> [text]       the exercise's own note, shown in every workout and template; omit text to clear
  finish <workout>
  discard <workout>                     delete an unfinished workout
  delete <workout>                      delete any workout
  log <YYYY-MM-DD> [--tz TZ]            record a finished workout on a past date
  date <workout> <YYYY-MM-DD>           correct a workout's date
  map <workout-exercise> <primary,...> [secondary,...]
  rename <workout> <name>
  recent [count]                        latest finished workout of each name (default 3)
  show <workout>                        an unfinished workout shows try <weight> where last session met every target; PR marks a set beating every earlier workout's weight, e1RM or hold
  history [exercise]
  summary <workout>                     duration, working sets, volume, records, muscles and each exercise's top set and trend
  records <exercise>                    best weight, e1RM, rep maxes, reps at each weight, longest holds and each kind's per-workout trend (kg, holds in seconds); warm-ups excluded
  totals [YYYY-MM-DD]                   muscle sets in the 7 days ending on the date, each with its exercises
  stats [week|month|all] [YYYY-MM-DD]   volume over the past 7 or 30 days or all time, weekly volume, then each lift's best weight, e1RM and hold
  prs                                   each lift's current weight, e1RM and hold records with the gain since the first workout in each trend, starred first, then most recent first
  star-pr <exercise> weight|e1rm|hold true|false
  setting <key> [value]                 weightUnit kg|lb, lengthUnit cm|in, distanceUnit km|mi,
                                        kgBar 20|15|10, lbBar 45|35|25|15, kgPlates and lbPlates as comma lists,
                                        homeOrder and homeHidden as comma lists of heatmap, muscles, stats,
                                        recent, templates, measurements
  templates                             list templates
  template <template>                   show a template's plan
  new-template <name>
  save-template <workout> [name] [--keep weight,reps]
                                        save a finished workout as a template, keeping the listed values (default both)
  rename-template <template> <name>
  delete-template <template>            workouts started from it are kept; its planned days are cleared
  template-add <template> <exercise> [FIELDS]
                                        append an exercise with one planned set
  template-set <template> <exercise#> [set#] [FIELDS]
                                        change a planned set, or append one when set# is omitted
  template-remove <template> <exercise#> [set#]
                                        remove a planned set, or the whole exercise
  weekly <weekday> [template]           plan a template every week, or clear the weekday
  plan-day <YYYY-MM-DD> [template]      change one date only; omit the template to make it a rest day
  reset-day <YYYY-MM-DD>                return one date to the weekly plan
  plan [YYYY-MM-DD] [days]              planned workouts from a date (default today, 14 days)
  calendar [YYYY-MM-DD] [weeks] [days]  working sets and plans by day, through days ahead (default 12 weeks, 0 days)
  presets                               measurement presets and their methods
  measurements                          tracked measurement series, methods and entries
  measure <preset|series> <value> [<preset|series> <value> ...] [--date YYYY-MM-DD]
                                        record measurements for one date (default today) together; a preset starts its series
  new-measurement <name> <weight|length> [method]
                                        start a custom series with an optional method note
  edit-measurement <entry> <value> [--date YYYY-MM-DD]
                                        correct an entry's value, and its date when given
  delete-measurement <entry>
  delete-series <series>                delete a series and all its entries
  star <series> true|false              star a series to surface it in progress
  progress                              progress by month: photo days and starred values (default body weight)
  export <file.zip> [--photos DIR]      write every table as CSV with a manifest, plus the photo files found in DIR
  erase [--photos DIR]                  delete all data and the referenced photo files in DIR; the catalog is restored
  import <file.zip|file.csv|file.fitnotes> [--apply skip|update|replace] [--photos DIR] [--map "NAME=EXERCISE|new" ...]
                                        preview a nicereps export, a filled blank template, a Strong workout CSV or measurements ZIP,
                                        a Hevy workout or measurement CSV, a FitNotes backup, or a StrengthLog CSV;
                                        --map matches another app's exercise name to one of ours or a new custom exercise;
                                        --apply writes it, all or nothing, and its photo files into DIR
  blank-template                        print the blank CSV template
FIELDS: --weight N (in the weightUnit setting) --reps N --target-reps N --type T --duration S --distance N (in the distanceUnit setting) --rounds N --recovery S
        --rest S --target-rpe N --rpe N --comment TEXT --options true|false --fields targetRpe,rpe,rest,comment,plates --done true|false
        ('' clears an optional field)`;

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    ...Object.fromEntries(
      ['at', 'tz', 'from', 'date', 'photos', 'apply', 'keep', 'weight', 'reps', 'target-reps', 'type', 'done', 'duration', 'distance', 'rounds', 'recovery', 'rest', 'target-rpe', 'rpe', 'comment', 'options', 'fields'].map((o) => [
      o,
      { type: 'string' as const },
    ]),
    ),
    map: { type: 'string', multiple: true },
  },
});
const values = parsed.values as Record<string, string | undefined> & { map?: string[] };
const [file, command, ...args] = parsed.positionals;

const required: Record<string, number> = {
  exercise: 1,
  'default-map': 2,
  add: 2,
  set: 1,
  plates: 1,
  bar: 1,
  edit: 1,
  'remove-set': 1,
  'restore-set': 1,
  'move-set': 2,
  'remove-exercise': 1,
  'move-exercise': 2,
  superset: 2,
  unlink: 1,
  note: 2,
  'note-exercise': 2,
  'exercise-note': 1,
  finish: 1,
  discard: 1,
  delete: 1,
  log: 1,
  records: 1,
  'star-pr': 3,
  date: 2,
  map: 2,
  rename: 2,
  show: 1,
  summary: 1,
  setting: 1,
  template: 1,
  'new-template': 1,
  'save-template': 1,
  'rename-template': 2,
  'delete-template': 1,
  'template-add': 2,
  'template-set': 2,
  'template-remove': 2,
  weekly: 1,
  'plan-day': 1,
  'reset-day': 1,
  measure: 2,
  'new-measurement': 2,
  'edit-measurement': 2,
  'delete-measurement': 1,
  'delete-series': 1,
  star: 2,
  export: 1,
  import: 1,
};
const muscles = (list = '') => list.split(',').filter((m) => m.trim());
const num = (value: string) => {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`Invalid number: ${value}`);
  return Number(value);
};
const bool = (value: string) => {
  if (value !== 'true' && value !== 'false') throw new Error(`Expected true or false: ${value}`);
  return value === 'true';
};
const mapping = (primary?: string, secondary?: string) =>
  [...muscles(primary).map((muscle) => ({ muscle, role: 'primary' })), ...muscles(secondary).map((muscle) => ({ muscle, role: 'secondary' }))] as Mapping;
const flag = <T>(name: string, parse: (v: string) => T, clearable = true) => {
  const v = values[name] as string | undefined;
  return v === undefined ? {} : { [name.replace(/-(\w)/, (_, c: string) => c.toUpperCase())]: clearable && v === '' ? null : parse(v) };
};
const fields = (db: ReturnType<typeof openDb>): Partial<SetFields> => ({
  ...(values.weight !== undefined && { weight: num(values.weight), unit: ops.weightUnit(db) }),
  ...flag('reps', num, false),
  ...flag('target-reps', num),
  ...flag('type', (v) => v as SetType, false),
  ...(values.done !== undefined && { completed: bool(values.done as string) }),
  ...flag('duration', num),
  ...(values.distance !== undefined && { distance: values.distance === '' ? null : num(values.distance), distanceUnit: ops.distanceUnit(db) }),
  ...flag('rounds', num),
  ...flag('recovery', num),
  ...flag('rest', num),
  ...flag('target-rpe', num),
  ...flag('rpe', num),
  ...flag('comment', (v) => v),
  ...flag('options', bool),
  ...flag('fields', (v) => v),
});
const clock = (seconds: number) => {
  const t = Math.round(seconds);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const measure = (mode: Mode, s: SetFields) => {
  const d = clock(s.duration ?? 0);
  switch (mode) {
    case 'reps':
      return `${s.weight} ${s.unit} × ${s.reps}`;
    case 'duration':
      return s.weight ? `${s.weight} ${s.unit} × ${d}` : d;
    case 'distance': {
      const p = pace(s.duration ?? 0, s.distance ?? 0);
      return `${s.distance ?? 0} ${s.distanceUnit} in ${d}${p === null ? '' : ` · ${clock(p)}/${s.distanceUnit}`}`;
    }
    case 'interval':
      return `${s.rounds ?? 0} × ${d} on / ${clock(s.recovery ?? 0)} off`;
    case 'check':
      return 'complete';
  }
};
const extras = (s: SetFields) =>
  [
    s.targetReps != null && s.reps !== s.targetReps && `target ${s.targetReps} reps`,
    s.targetRpe != null && `target RPE ${s.targetRpe}`,
    s.rpe != null && `RPE ${s.rpe}`,
    s.rest != null && `rest ${s.rest}s`,
    s.comment && `"${s.comment}"`,
    s.options != null && `options ${s.options ? 'shown' : 'hidden'}`,
    s.fields != null && `fields ${s.fields || 'none'}`,
  ]
    .filter(Boolean)
    .map((x) => `  ${x}`)
    .join('');
const showWorkout = (w: ReturnType<typeof ops.getWorkout>, suggest?: (exercise: string) => ReturnType<typeof ops.suggest>, prs?: Set<string>) => {
  console.log(`${w.id}  ${w.name}  ${w.date} (${w.timeZone})  ${w.finishedAt ? 'finished' : 'in progress'}${w.note ? `  "${w.note}"` : ''}`);
  for (const e of w.exercises) {
    const muscles = e.mapping.map((m) => (m.role === 'primary' ? m.muscle : `${m.muscle}/2`)).join(', ');
    console.log(`  ${e.id}  ${e.name}  ${e.mode}  [${muscles}]${e.superset ? `  superset ${e.superset.slice(0, 6)}` : ''}${e.note ? `  "${e.note}"` : ''}`);
    if (e.exerciseNote && !w.finishedAt) console.log(`    note: ${e.exerciseNote}`);
    const up = suggest?.(e.name) ?? [];
    e.sets.forEach((s, i) => console.log(`    ${s.id}  ${s.type.padEnd(7)} ${measure(e.mode, s)}  ${s.completed ? 'done' : '-'}${prs?.has(s.id) ? '  PR' : ''}${extras(s)}${up[i] ? `  try ${up[i].weight} ${up[i].unit}` : ''}`));
  }
};

const showTemplate = (t: ReturnType<typeof ops.getTemplate>) => {
  console.log(`${t.id}  ${t.name}`);
  t.exercises.forEach((e, i) => {
    console.log(`  ${i + 1}  ${e.name}  ${e.mode}${e.superset ? `  superset ${e.superset.slice(0, 6)}` : ''}`);
    if (e.exerciseNote) console.log(`     note: ${e.exerciseNote}`);
    e.sets.forEach((s, j) => console.log(`     ${j + 1}  ${s.type.padEnd(7)} ${measure(e.mode, { ...s, completed: false })}${extras({ ...s, completed: false })}`));
  });
};
const item = <T>(list: T[], position: string) => {
  const i = num(position) - 1;
  if (!list[i]) throw new Error(`No item ${position}`);
  return i;
};
const editTemplate = (db: ReturnType<typeof openDb>, name: string, change: (plan: ReturnType<typeof ops.getTemplate>) => void) => {
  const plan = ops.getTemplate(db, templateId(db, name));
  change(plan);
  ops.updateTemplate(db, plan.id, plan.name, plan.exercises);
  showTemplate(ops.getTemplate(db, plan.id));
};

if (!file || !command || args.length < (required[command] ?? 0)) {
  console.error(usage);
  process.exit(2);
}

try {
  const db = openDb(file);
  switch (command) {
    case 'seed':
      seed(db).forEach((id) => showWorkout(ops.getWorkout(db, id)));
      break;
    case 'exercise':
      console.log(
        ops.createExercise(db, args[0], mapping(args[2], args[3]), { mode: (args[1] ?? 'reps') as Mode, ...(values.rest !== undefined && { rest: num(values.rest) }) }),
      );
      break;
    case 'exercises':
      ops.listExercises(db, args.join(' ')).forEach((e) => console.log(`${e.id}  ${e.name}  ${e.mode}${e.source ? '' : '  custom'}`));
      break;
    case 'default-map':
      ops.setDefaultMapping(db, exerciseId(db, args[0]), mapping(args[1], args[2]));
      break;
    case 'active':
      ops.unfinishedWorkouts(db).forEach((w) => showWorkout(w));
      break;
    case 'start':
      console.log(
        ops.startWorkout(db, {
          templateId: args[0] ? templateId(db, args[0]) : null,
          fromWorkoutId: values.from,
          now: values.at ? new Date(values.at) : undefined,
          timeZone: values.tz,
        }),
      );
      break;
    case 'add':
      console.log(ops.addExercise(db, args[0], exerciseId(db, args[1])));
      break;
    case 'set':
      console.log(
        ops.addSet(db, args[0], {
          ...(args[1] !== undefined && { weight: num(args[1]), unit: ops.weightUnit(db) }),
          ...(args[2] !== undefined && { reps: num(args[2]) }),
          ...(args[3] !== undefined && { type: args[3] as SetType }),
          ...fields(db),
        }),
      );
      break;
    case 'edit':
      ops.correctSet(db, args[0], fields(db));
      break;
    case 'plates': {
      const unit = ops.weightUnit(db);
      const exercise = args[1] ? ops.listExercises(db).find((e) => e.name === args[1]) : undefined;
      if (args[1] && !exercise) throw new Error(`Not found: ${args[1]}`);
      const kit = exercise ? ops.exerciseKit(db, unit, exercise) : ops.kit(db, unit);
      if (!kit) throw new Error(`${args[1]} has no bar`);
      const typed = num(args[0]);
      const load = loadPlates(typed, kit);
      console.log(
        load
          ? `${typed} ${unit}${load.weight === typed ? '' : ` loads ${load.weight} ${unit}`} on a ${kit.bar} ${unit} bar: ${load.side.length ? `${load.side.join(' · ')} per side` : 'bar only'}`
          : `${typed} ${unit} is more than 50 plates per side`,
      );
      console.log(`plates: ${kit.plates.join(', ') || 'none'}`);
      break;
    }
    case 'bar': {
      const unit = ops.weightUnit(db);
      ops.setBar(db, exerciseId(db, args[0]), args[1] === undefined ? null : num(args[1]), unit);
      const exercise = ops.listExercises(db).find((e) => e.name === args[0])!;
      const kit = ops.exerciseKit(db, unit, exercise);
      console.log(`${args[0]} bar: ${kit ? `${kit.bar} ${unit}${exercise.bar == null ? ' (Settings)' : ''}` : 'none'}`);
      break;
    }
    case 'remove-set':
      console.log(JSON.stringify(ops.deleteSet(db, args[0])));
      break;
    case 'restore-set':
      ops.restoreSet(db, JSON.parse(args[0]));
      break;
    case 'move-set':
      ops.moveSet(db, args[0], num(args[1]));
      break;
    case 'remove-exercise':
      ops.removeExercise(db, args[0]);
      break;
    case 'move-exercise':
      if (args[1] !== 'up' && args[1] !== 'down') throw new Error(`Expected up or down: ${args[1]}`);
      ops.moveExerciseBlock(db, args[0], args[1] === 'up' ? -1 : 1);
      break;
    case 'superset':
      ops.linkSuperset(db, args[0], args[1]);
      break;
    case 'unlink':
      ops.unlinkSuperset(db, args[0]);
      break;
    case 'note':
      ops.noteWorkout(db, args[0], args.slice(1).join(' '));
      break;
    case 'note-exercise':
      ops.noteExercise(db, args[0], args.slice(1).join(' '));
      break;
    case 'exercise-note':
      console.log(`${args[0]} note: ${ops.setExerciseNote(db, exerciseId(db, args[0]), args.slice(1).join(' ')) ?? 'none'}`);
      break;
    case 'discard':
      ops.discardWorkout(db, args[0]);
      break;
    case 'delete':
      ops.deleteWorkout(db, args[0]);
      break;
    case 'log':
      console.log(ops.logWorkout(db, args[0], values.tz));
      break;
    case 'finish':
      ops.finishWorkout(db, args[0]);
      break;
    case 'date':
      ops.moveWorkout(db, args[0], args[1]);
      break;
    case 'map':
      ops.remapExercise(db, args[0], mapping(args[1], args[2]));
      break;
    case 'rename':
      ops.renameWorkout(db, args[0], args.slice(1).join(' '));
      break;
    case 'recent':
      ops.recentWorkouts(db, args[0] ? num(args[0]) : 3).forEach((w) => console.log(`${w.id}  ${w.name}  ${w.date}`));
      break;
    case 'show': {
      const w = ops.getWorkout(db, args[0]);
      showWorkout(w, w.finishedAt ? undefined : (exercise) => ops.suggest(db, exercise, w), ops.prSets(db, w));
      break;
    }
    case 'summary': {
      const w = ops.workoutSummary(db, args[0]);
      console.log(`${w.name}  ${w.date}  ${w.minutes} min  ${w.sets} working sets  volume ${Math.round(w.volume)} kg  ${w.records} records`);
      console.log(`  muscles  ${w.muscles.map((m) => `${m.muscle} ${m.sets}`).join(', ')}`);
      for (const e of w.exercises)
        console.log(`  ${e.name}  top ${e.top ? measure(e.mode, e.top) : '-'}  records ${e.records.length}  trend ${e.trend.map((t) => `${t.date} ${+t.value.toFixed(1)}`).join(', ') || '-'}`);
      break;
    }
    case 'history':
      ops.history(db, args[0]).forEach((w) => showWorkout(w));
      break;
    case 'records': {
      const p = ops.progress(db, args[0]);
      const at = (h: NonNullable<typeof p.weight>) => `${h.set.weight} ${h.set.unit} × ${h.set.reps}  ${h.date}  set ${h.set.id} in ${h.workoutId}`;
      const body = p.estimate?.set.bodyWeight ? ' with body weight' : '';
      console.log(`${args[0]}: ${p.sessions.length} sessions; working sets only; e1RM = ${body ? '(body weight + weight)' : 'weight'} × (1 + reps / 30)`);
      if (p.weight) console.log(`  best weight  ${at(p.weight)}`);
      if (p.estimate) {
        console.log(`  best e1RM    ${p.estimate.value.toFixed(1)} ${p.estimate.set.unit}${body}  from ${at(p.estimate)}`);
        console.log(`  rep maxes    ${p.maxes.map((r) => `${r.reps}RM ≈ ${r.weight.toFixed(1)}`).join('  ')} ${p.estimate.set.unit}${body}`);
      }
      for (const r of p.reps) console.log(`  best reps    ${at(r)}`);
      const hold = (h: NonNullable<typeof p.longest>) => `${clock(h.set.duration ?? 0)} at ${h.set.weight} ${h.set.unit}  ${h.date}  set ${h.set.id} in ${h.workoutId}`;
      if (p.longest) console.log(`  longest hold ${hold(p.longest)}`);
      for (const h of p.holds) console.log(`  longest at   ${hold(h)}`);
      for (const [kind, trend] of Object.entries(p.trends)) if (trend.length) console.log(`  trend ${kind.padEnd(6)} ${trend.map((t) => `${t.date} ${+t.value.toFixed(1)}`).join(', ')}`);
      break;
    }
    case 'stats': {
      const range = (args[0] ?? 'week') as keyof typeof ops.volumeRanges;
      const unit = ops.weightUnit(db);
      const day = args[1] ?? localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      const kg = ops.totalVolume(db, day, range);
      console.log(`volume ${range}  ${wholeIn(kg, unit)} ${unit}  weight × reps of completed working sets, plus body weight on bodyweight lifts`);
      console.log(`  weekly  ${ops.weeklyVolume(db, day).map((w) => `${w.date} ${wholeIn(w.value, unit)}`).join(', ') || '-'}  7 days ending on each date`);
      for (const lift of ops.lifts(db)) {
        const p = ops.progress(db, lift.name);
        const best = [
          p.weight && `best ${convert(p.weight.set.weight, p.weight.set.unit ?? 'kg', unit)} ${unit} × ${p.weight.set.reps}`,
          p.estimate && `e1RM ${convert(p.estimate.value, p.estimate.set.unit ?? 'kg', unit).toFixed(1)} ${unit}${p.estimate.set.bodyWeight ? ' with body weight' : ''}`,
          p.longest && `hold ${clock(p.longest.set.duration ?? 0)}`,
        ].filter(Boolean);
        console.log(`  ${lift.name.padEnd(20)} ${best.join('  ') || 'bodyweight'}`);
      }
      break;
    }
    case 'prs': {
      const unit = ops.weightUnit(db);
      for (const r of ops.personalRecords(db)) {
        const value =
          r.kind === 'weight'
            ? `weight ${convert(r.value, r.set.unit ?? 'kg', unit)} ${unit} × ${r.set.reps}`
            : r.kind === 'e1rm'
              ? `e1RM ${convert(r.value, r.set.unit ?? 'kg', unit).toFixed(1)} ${unit}${r.set.bodyWeight ? ' with body weight' : ''}`
              : `hold ${clock(r.value)}`;
        const gain = r.change && (r.kind === 'hold' ? r.change.gain : Number(convert(r.change.gain, 'kg', unit).toFixed(1)));
        const change = !r.change ? '1 workout' : !gain ? `no change since ${r.change.since}` : `+${r.kind === 'hold' ? clock(gain) : `${gain} ${unit}`} since ${r.change.since}`;
        console.log(`${r.starred ? '★' : ' '} ${r.name.padEnd(20)} ${value.padEnd(32)} ${change}`);
      }
      break;
    }
    case 'star-pr':
      ops.starRecord(db, exerciseId(db, args[0]), args[1] as ops.RecordKind, bool(args[2]));
      break;
    case 'totals': {
      const { from, to, totals } = ops.muscleTotals(db, args[0] ?? localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
      console.log(`${from} to ${to}: completed normal and drop sets; primary muscle 1, secondary 0.5`);
      for (const t of totals) {
        console.log(`  ${t.muscle.padEnd(12)} ${t.sets}`);
        for (const e of t.exercises) console.log(`    ${e.exercise}  ${e.sets}`);
      }
      break;
    }
    case 'setting':
      if (args[1] !== undefined) ops.setSetting(db, args[0], args[1]);
      console.log(ops.getSetting(db, args[0]) ?? '');
      break;
    case 'templates':
      ops.listTemplates(db).forEach((t) => console.log(`${t.id}  ${t.name}  ${t.count} exercises`));
      break;
    case 'template':
      showTemplate(ops.getTemplate(db, templateId(db, args[0])));
      break;
    case 'new-template':
      console.log(ops.createTemplate(db, args[0], []));
      break;
    case 'save-template': {
      const keep = ((values.keep as string | undefined) ?? 'weight,reps').split(',').filter(Boolean);
      const bad = keep.find((k) => k !== 'weight' && k !== 'reps');
      if (bad) throw new Error(`Expected weight or reps: ${bad}`);
      console.log(ops.templateFromWorkout(db, args[0], args[1], { weight: keep.includes('weight'), reps: keep.includes('reps') }));
      break;
    }
    case 'rename-template':
      editTemplate(db, args[0], (plan) => (plan.name = args[1]));
      break;
    case 'delete-template':
      ops.deleteTemplate(db, templateId(db, args[0]));
      break;
    case 'template-add':
      editTemplate(db, args[0], (plan) => {
        const id = exerciseId(db, args[1]);
        plan.exercises.push({ exerciseId: id, name: args[1], mode: 'reps', exerciseNote: null, superset: null, sets: [{ type: 'normal', weight: 0, reps: 0, ...fields(db) }] });
      });
      break;
    case 'template-set':
      editTemplate(db, args[0], (plan) => {
        const { sets } = plan.exercises[item(plan.exercises, args[1])];
        if (args[2] === undefined) sets.push({ ...(sets.at(-1) ?? { type: 'normal', weight: 0, reps: 0 }), ...fields(db) });
        else sets[item(sets, args[2])] = { ...sets[item(sets, args[2])], ...fields(db) };
      });
      break;
    case 'template-remove':
      editTemplate(db, args[0], (plan) => {
        const e = item(plan.exercises, args[1]);
        if (args[2] === undefined) plan.exercises.splice(e, 1);
        else plan.exercises[e].sets.splice(item(plan.exercises[e].sets, args[2]), 1);
      });
      break;
    case 'weekly':
      ops.scheduleWeekday(db, args[0], args[1] ? templateId(db, args[1]) : null);
      break;
    case 'plan-day':
      ops.changeDay(db, args[0], args[1] ? templateId(db, args[1]) : null);
      break;
    case 'reset-day':
      ops.resetDay(db, args[0]);
      break;
    case 'plan':
      for (const d of ops.plannedDays(db, args[0] ?? localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), args[1] ? num(args[1]) : 14))
        console.log(
          `${d.date}  ${d.weekday.slice(0, 3)}  ${d.planned?.name ?? 'rest'}${d.done ? '  done' : ''}${d.changed ? `  (this day only; weekly: ${d.repeat?.name ?? 'rest'})` : ''}`,
        );
      break;
    case 'calendar':
      for (const d of ops.calendar(db, args[0] ?? localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), args[1] ? num(args[1]) : 12, args[2] ? num(args[2]) : 0))
        console.log(`${d.date}  ${String(d.sets).padStart(3)} sets${d.plan?.planned ? `  ${d.plan.planned.name} ${d.plan.done ? 'done' : 'planned'}` : ''}`);
      break;
    case 'presets':
      for (const p of measures.presets) console.log(`${p.key.padEnd(16)} ${p.name} (${p.kind})\n${p.guide.map((g) => `    ${g}`).join('\n')}`);
      break;
    case 'measurements':
      for (const s of measures.listSeries(db)) {
        console.log(`${s.id}  ${s.name}  ${s.preset ? 'preset' : 'custom'} ${s.kind}${s.starred ? ' starred' : ''}${s.method.length ? `\n    method: ${s.method.join(' ')}` : ''}`);
        for (const e of s.entries) console.log(`    ${e.id}  ${e.date}  ${e.value} ${e.unit}`);
      }
      break;
    case 'measure': {
      if (args.length % 2) throw new Error('Expected a value for each part');
      const series = measures.listSeries(db);
      const entries = args.flatMap((part, i) => {
        if (i % 2) return [];
        const name = part.toLowerCase();
        const preset = measures.presets.find((p) => p.key === name || p.name.toLowerCase() === name);
        const id = series.find((s) => s.name.toLowerCase() === name)?.id;
        if (!preset && !id) throw new Error(`Not found: ${part}`);
        return [{ series: id ? { id } : { preset: preset!.key }, value: num(args[i + 1]) }];
      });
      const date = values.date ?? localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      measures.logMeasurements(db, entries, date).forEach((e) => console.log(e.id));
      break;
    }
    case 'new-measurement':
      console.log(measures.createSeries(db, args[0], args[1] as measures.Kind, args[2]));
      break;
    case 'edit-measurement': {
      const entry = measures.listSeries(db).flatMap((s) => s.entries).find((e) => e.id === args[0]);
      if (!entry) throw new Error(`Not found: ${args[0]}`);
      measures.editMeasurement(db, entry.id, num(args[1]), values.date ?? entry.date);
      break;
    }
    case 'delete-measurement':
      measures.deleteMeasurement(db, args[0]);
      break;
    case 'delete-series': {
      const name = args[0].toLowerCase();
      measures.deleteSeries(db, measures.listSeries(db).find((s) => s.id === args[0] || s.name.toLowerCase() === name || s.preset === name)?.id ?? args[0]);
      break;
    }
    case 'star': {
      const name = args[0].toLowerCase();
      measures.starSeries(db, measures.listSeries(db).find((s) => s.id === args[0] || s.name.toLowerCase() === name || s.preset === name)?.id ?? args[0], bool(args[1]));
      break;
    }
    case 'progress':
      for (const m of measures.progress(db)) {
        console.log(`${m.month}${m.photo ? `  photo ${m.photo.file}` : ''}`);
        for (const d of m.days) console.log(`    ${d.date}  ${d.photos.length} photo${d.photos.length === 1 ? '' : 's'}${d.values.map((v) => `  ${v.name} ${v.value} ${v.unit}`).join('')}`);
      }
      break;
    case 'export': {
      const out = openSync(args[0], 'wx');
      try {
        const result = await data.exportArchive(
          db,
          (photo) => (values.photos && existsSync(join(values.photos, photo)) ? readFileSync(join(values.photos, photo)) : null),
          (chunk) => writeSync(out, chunk),
        );
        for (const [table, count] of Object.entries(result.tables)) console.log(`${table}  ${count}`);
        console.log(`photo files  ${result.photos}`);
        for (const photo of result.missing) console.log(`missing photo  ${photo}`);
      } catch (error) {
        closeSync(out);
        rmSync(args[0]);
        throw error;
      }
      closeSync(out);
      break;
    }
    case 'erase':
      for (const photo of data.eraseAll(db)) if (values.photos) rmSync(join(values.photos, photo), { force: true });
      break;
    case 'import': {
      if (values.apply && !['skip', 'update', 'replace'].includes(values.apply)) throw new Error(`Invalid duplicate action: ${values.apply}`);
      const photos = new Map<string, Uint8Array[]>();
      const sink = (file: string) => {
        const parts: Uint8Array[] = [];
        photos.set(file, parts);
        return (bytes: Uint8Array) => void parts.push(bytes);
      };
      const imp = data.readImport(db, [readFileSync(args[0])], values.tz, values.photos ? sink : undefined, () => readDb(args[0]));
      const map = Object.fromEntries(
        (values.map ?? []).map((m) => {
          if (!m.includes('=')) throw new Error(`--map ${m} must be NAME=EXERCISE or NAME=new`);
          const [name, target] = [m.slice(0, m.indexOf('=')), m.slice(m.indexOf('=') + 1)];
          return [name, target === 'new' ? 'new' : exerciseId(db, target)];
        }),
      );
      const checked = data.previewImport(db, imp, 'skip', {}, map);
      const preview = values.apply && !checked.unmatched.length ? data.applyImport(db, imp, values.apply as data.Action, {}, map) : checked;
      for (const e of preview.exercises) console.log(`exercise  ${e.name}  ->  ${e.id === 'new' ? 'new custom exercise' : (e.exercise ?? 'unmatched')}${e.saved ? '  (saved)' : ''}`);
      for (const note of imp.skipped ?? []) console.log(`skipped  ${note}`);
      for (const note of imp.notes ?? []) console.log(`note  ${note}`);
      if (values.apply && values.photos) {
        mkdirSync(values.photos, { recursive: true });
        for (const [file, bytes] of photos)
          if (!existsSync(join(values.photos, file)) && db.all('SELECT 1 FROM photo WHERE file = ?', [file]).length) writeFileSync(join(values.photos, file), Buffer.concat(bytes));
      }
      for (const [table, count] of Object.entries(preview.counts)) console.log(`${table}  ${count.new} new  ${count.duplicates} changed  ${count.unchanged} unchanged`);
      const latest = data.importHighlights(imp);
      if (latest.workout && !preview.errors.length) console.log(`most recent workout  ${latest.workout.name}  ${latest.workout.date}`);
      if (latest.measured && !preview.errors.length) console.log(`last measurements  ${latest.measured}`);
      for (const error of preview.errors) console.log(`error  ${error}`);
      if (preview.unmatched.length) console.log(`unmatched  ${preview.unmatched.length} exercise names; add --map "NAME=EXERCISE" or --map "NAME=new"${values.apply ? ', nothing was written' : ''}`);
      else if (values.apply) console.log(`applied, duplicates: ${values.apply}`);
      if (preview.errors.length || (values.apply && preview.unmatched.length)) process.exitCode = 1;
      break;
    }
    case 'blank-template':
      process.stdout.write(data.blankTemplate);
      break;
    default:
      console.error(usage);
      process.exit(2);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
