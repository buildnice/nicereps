import { createId } from '@paralleldrive/cuid2';

import { transaction, type Db } from '../data/db.ts';
import * as q from '../data/queries.ts';
import type { DistanceUnit, Mapping, Mode, SetFields, WeightUnit } from '../data/queries.ts';
import { bodyweight } from '../../assets/catalog/bodyweight.ts';
import { bodyWeightLookup } from './measurements.ts';
import { equipment, isBarbell, kitDefaults, kitOptions, type Kit } from './plates.ts';
import { addDays, convert, homeLayout as layout, homeSections, optionalFields, e1rmTrend, holds, holdTrend, isDate, isWorkingSet, localDate, modes, muscleSets, personalBests, progressed, records, repMaxes, setTypes, supersetBlocks, volume, weekdays, weightTrend, workingSetsByDate } from './rules.ts';

type PlannedSet = Omit<SetFields, 'completed'>;

const whole = (v?: number | null) => v == null || (Number.isInteger(v) && v >= 0);
const amount = (v?: number | null) => v == null || (Number.isFinite(v) && v >= 0);
const rpe = (v?: number | null) => v == null || (Number.isFinite(v) && v >= 1 && v <= 10);

const checkSet = <T extends PlannedSet>(set: T) => {
  if (!setTypes.includes(set.type)) throw new Error(`Invalid set type: ${set.type}`);
  if (!(Number.isFinite(set.weight) && set.weight >= 0 && Number.isInteger(set.reps) && set.reps >= 0 && whole(set.targetReps)))
    throw new Error('Weight and reps must be non-negative numbers');
  if (![set.duration, set.rounds, set.recovery, set.rest].every(whole) || !amount(set.distance))
    throw new Error('Durations, rounds and distance must be non-negative numbers');
  if (![set.targetRpe, set.rpe].every(rpe)) throw new Error('RPE must be between 1 and 10');
  if (set.fields && !set.fields.split(',').every((f) => (optionalFields as readonly string[]).includes(f))) throw new Error(`Fields must be a comma-separated list of: ${optionalFields.join(', ')}`);
  return { ...set, comment: set.comment?.trim() || null };
};

// shortcut: 0 reps counts as blank, so a target can't log a deliberate 0; add a nullable reps column if that matters
const logged = <T extends SetFields>(set: T) => (set.completed && !set.reps && set.targetReps ? { ...set, reps: set.targetReps } : set);

const copied = ({ type, weight, unit, reps, duration, distance, distanceUnit, rounds, recovery, rest, targetRpe, options, fields }: PlannedSet) => ({
  type,
  weight,
  unit,
  reps,
  duration,
  distance,
  distanceUnit,
  rounds,
  recovery,
  rest,
  targetRpe,
  options,
  fields,
});

const checkMapping = (mapping: Mapping) => {
  const trimmed = mapping.map((m) => ({ ...m, muscle: m.muscle.trim() }));
  if (trimmed.some((m) => !m.muscle || !['primary', 'secondary'].includes(m.role))) throw new Error('Invalid muscle mapping');
  return trimmed;
};

export const getSetting = q.readSetting;

export const weightUnit = (db: Db) => (getSetting(db, 'weightUnit') ?? 'kg') as WeightUnit;

export const distanceUnit = (db: Db) => (getSetting(db, 'distanceUnit') ?? 'km') as DistanceUnit;

export const choices: Record<string, [string, string[], boolean?]> = {
  weightUnit: ['Weight unit', ['kg', 'lb']],
  lengthUnit: ['Length unit', ['cm', 'in']],
  distanceUnit: ['Distance unit', ['km', 'mi']],
  kgBar: ['kg bar', kitOptions.kg.bars.map(String)],
  lbBar: ['lb bar', kitOptions.lb.bars.map(String)],
  kgPlates: ['kg plates', kitOptions.kg.plates.map(String), true],
  lbPlates: ['lb plates', kitOptions.lb.plates.map(String), true],
  homeOrder: ['Home order', [...homeSections], true],
  homeHidden: ['Hidden home sections', [...homeSections], true],
};

export const badSetting = (key: string, value: string) => {
  if (!Object.hasOwn(choices, key)) return null;
  const [, values, many] = choices[key];
  const list = many ? value.split(',').filter(Boolean) : [value];
  if (list.every((v) => values.includes(v)) && new Set(list).size === list.length) return null;
  return `must be ${many ? 'a comma-separated list of' : 'one of'}: ${values.join(', ')}`;
};

export const setSetting = (db: Db, key: string, value: string) => {
  const bad = badSetting(key, value);
  if (bad) throw new Error(`${choices[key][0]} ${bad}`);
  q.writeSetting(db, key, value);
};

export const homeLayout = (db: Db) => layout(getSetting(db, 'homeOrder'), getSetting(db, 'homeHidden'));

export const kit = (db: Db, unit: WeightUnit): Kit => {
  const bar = getSetting(db, `${unit}Bar`);
  const plates = getSetting(db, `${unit}Plates`);
  return { bar: bar ? Number(bar) : kitDefaults[unit].bar, plates: plates == null ? kitDefaults[unit].plates : plates.split(',').filter(Boolean).map(Number) };
};

type BarExercise = { source: string | null; equipment: string | null; bar: number | null; barUnit: WeightUnit | null };

export const exerciseKit = (db: Db, unit: WeightUnit, exercise: BarExercise): Kit | undefined =>
  exercise.bar != null ? { ...kit(db, unit), bar: convert(exercise.bar, exercise.barUnit ?? 'kg', unit) } : isBarbell(exercise.source, exercise.equipment) ? kit(db, unit) : undefined;

const checkBar = (bar: number | null) => {
  if (bar != null && !(Number.isFinite(bar) && bar > 0)) throw new Error('Bar weight must be above 0');
};

export const setBar = (db: Db, exerciseId: string, bar: number | null, unit: WeightUnit) => {
  checkBar(bar);
  q.setBar(db, exerciseId, bar, unit);
};

export const createExercise = (db: Db, name: string, mapping: Mapping, { mode = 'reps', rest = 120, equipment = null, bar = null, barUnit = null, note = null }: Partial<q.ExerciseFields> = {}) =>
  transaction(db, () => {
    if (!name.trim()) throw new Error('Exercise name is required');
    if (!modes.includes(mode)) throw new Error(`Mode must be one of: ${modes.join(', ')}`);
    if (!(Number.isInteger(rest) && rest >= 0)) throw new Error('Rest must be whole seconds');
    checkBar(bar);
    const barred = mode === 'reps' && bar != null;
    const id = createId();
    q.insertExercise(db, id, name.trim(), { mode, rest, equipment: equipment?.trim() || null, bar: barred ? bar : null, barUnit: barred ? (barUnit ?? 'kg') : null, note: note?.trim() || null }, checkMapping(mapping));
    return id;
  });

export const exerciseDraft = (db: Db, exerciseId: string) => {
  const { source, ...e } = q.exercise(db, exerciseId);
  return { ...e, equipment: equipment(source, e.equipment) };
};

export const listExercises = q.exercises;

export const listTemplates = q.templates;

export const setDefaultMapping = (db: Db, exerciseId: string, mapping: Mapping) =>
  transaction(db, () => q.replaceExerciseMapping(db, exerciseId, checkMapping(mapping)));

type Plan = { exerciseId: string; superset?: string | null; sets: PlannedSet[] }[];

const writePlan = (db: Db, id: string, name: string, exercises: Plan) => {
  if (!name) throw new Error('Template name is required');
  if (q.templates(db).some((t) => t.name === name && t.id !== id)) throw new Error(`A template named ${name} already exists`);
  const lone = (g?: string | null) => exercises.filter((e) => e.superset === g).length < 2;
  exercises.forEach((e, i) => {
    const templateExerciseId = createId();
    q.insertTemplateExercise(db, templateExerciseId, id, e.exerciseId, i, lone(e.superset) ? null : (e.superset ?? null));
    e.sets.forEach((s, j) => q.insertTemplateSet(db, createId(), templateExerciseId, j, copied(checkSet({ unit: weightUnit(db), distanceUnit: distanceUnit(db), ...s }))));
  });
};

export const createTemplate = (db: Db, name: string, exercises: Plan) =>
  transaction(db, () => {
    const id = createId();
    q.insertTemplate(db, id, name.trim());
    writePlan(db, id, name.trim(), exercises);
    return id;
  });

export const updateTemplate = (db: Db, id: string, name: string, exercises: Plan) =>
  transaction(db, () => {
    q.resetTemplate(db, id, name.trim());
    writePlan(db, id, name.trim(), exercises);
  });

export const deleteTemplate = (db: Db, id: string) => transaction(db, () => q.deleteTemplate(db, id));

export const getTemplate = q.templatePlan;

const checkTemplate = (db: Db, templateId: string | null) => templateId && q.templatePlan(db, templateId);

export const scheduleWeekday = (db: Db, weekday: string, templateId: string | null) => {
  if (!weekdays.includes(weekday)) throw new Error(`Weekday must be one of: ${weekdays.join(', ')}`);
  checkTemplate(db, templateId);
  q.writeSchedule(db, createId(), weekday, templateId);
};

export const changeDay = (db: Db, date: string, templateId: string | null) => {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  checkTemplate(db, templateId);
  q.writeScheduleChange(db, createId(), date, templateId);
};

export const resetDay = (db: Db, date: string) => {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  q.deleteScheduleChange(db, date);
};

export const plannedDays = (db: Db, from: string, days: number) => {
  if (!isDate(from)) throw new Error(`Invalid date: ${from}`);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error(`Days must be 1 to 366: ${days}`);
  const weekly = Object.fromEntries(q.schedule(db).map((s) => [s.weekday, { id: s.id, name: s.name }]));
  const to = addDays(from, days - 1);
  const changes = new Map(q.scheduleChanges(db, from, to).map((c) => [c.date, c.template]));
  const finished = q.finishedDates(db, from, to);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const weekday = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const repeat = weekly[weekday] ?? null;
    const changed = changes.has(date);
    const planned = changed ? (changes.get(date) ?? null) : repeat;
    return { date, weekday, repeat, changed, planned, done: !!planned && finished.has(date) };
  });
};

export const templateFromWorkout = (db: Db, workoutId: string, name?: string, keep = { weight: true, reps: true }) => {
  const workout = getWorkout(db, workoutId);
  if (!workout.finishedAt) throw new Error('Finish the workout before saving it as a template');
  const exercises = workout.exercises.map((e) => ({
    ...e,
    sets: e.sets.map((s) => ({ ...s, options: s.fields != null ? s.fields !== '' : s.options, weight: keep.weight ? s.weight : 0, reps: keep.reps ? s.reps || (s.targetReps ?? 0) : 0 })),
  }));
  return createTemplate(db, name ?? workout.name, exercises);
};

export const startWorkout = (
  db: Db,
  {
    templateId = null,
    fromWorkoutId = null,
    now = new Date(),
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  }: { templateId?: string | null; fromWorkoutId?: string | null; now?: Date; timeZone?: string } = {},
) =>
  transaction(db, () => {
    if (templateId && fromWorkoutId) throw new Error('Start from a template or a workout, not both');
    if (unfinishedWorkouts(db).length) throw new Error('Finish or discard the unfinished workout first');
    const plan = fromWorkoutId ? getWorkout(db, fromWorkoutId) : templateId ? q.templatePlan(db, templateId) : { name: 'Workout', exercises: [] };
    const id = createId();
    const groups: Record<string, string> = {};
    q.insertWorkout(db, { id, templateId: fromWorkoutId ? null : templateId, name: plan.name, date: localDate(now, timeZone), timeZone, startedAt: now.toISOString() });
    plan.exercises.forEach((e) => {
      const workoutExerciseId = createId();
      q.insertWorkoutExercise(db, workoutExerciseId, id, e.exerciseId, e.superset ? (groups[e.superset] ??= createId()) : null);
      e.sets.forEach((s: PlannedSet) => q.insertSet(db, createId(), workoutExerciseId, { ...copied(s), reps: 0, targetReps: s.reps || s.targetReps || null, completed: false }));
    });
    return id;
  });

export const addExercise = (db: Db, workoutId: string, exerciseId: string) =>
  transaction(db, () => {
    const id = createId();
    q.insertWorkoutExercise(db, id, workoutId, exerciseId);
    return id;
  });

export const addSet = (db: Db, workoutExerciseId: string, set: Partial<SetFields> = {}) => {
  const id = createId();
  const last = q.lastSet(db, workoutExerciseId);
  const { weight = 0, unit = weightUnit(db), reps = 0, targetReps, distanceUnit: lastDistanceUnit = distanceUnit(db), completed, type, ...others } = last ?? {};
  q.insertSet(db, id, workoutExerciseId, logged(checkSet({ ...others, type: 'normal', weight, unit, reps: 0, targetReps: reps || targetReps || null, distanceUnit: lastDistanceUnit, completed: false, ...set })));
  return id;
};

export const deleteSet = (db: Db, setId: string) =>
  transaction(db, () => {
    const deleted = { id: setId, ...q.setPlace(db, setId), set: q.readSet(db, setId) };
    q.deleteRow(db, 'workout_set', setId);
    return deleted;
  });

export type DeletedSet = ReturnType<typeof deleteSet>;

export const restoreSet = (db: Db, { id, workoutExerciseId, position, set }: DeletedSet) =>
  transaction(db, () => {
    q.insertSet(db, id, workoutExerciseId, checkSet(set));
    q.moveRow(db, 'workout_set', id, Math.min(position, q.setPlace(db, id).position));
  });

export const moveSet = (db: Db, setId: string, to: number) => transaction(db, () => q.moveRow(db, 'workout_set', setId, to));

export const removeExercise = (db: Db, workoutExerciseId: string) =>
  transaction(db, () => {
    q.unlinkSuperset(db, workoutExerciseId);
    q.deleteRow(db, 'workout_exercise', workoutExerciseId);
  });

export const moveExercise = (db: Db, workoutExerciseId: string, to: number) => transaction(db, () => q.moveRow(db, 'workout_exercise', workoutExerciseId, to));

export const moveExerciseBlock = (db: Db, workoutExerciseId: string, step: -1 | 1) =>
  transaction(db, () => {
    const workout = q.workouts(db, 'id = (SELECT workout_id FROM workout_exercise WHERE id = ?)', [workoutExerciseId])[0];
    if (!workout) throw new Error(`Not found: ${workoutExerciseId}`);
    const blocks = supersetBlocks(workout.exercises);
    const from = blocks.findIndex((b) => b.some((e) => e.id === workoutExerciseId));
    const to = from + step;
    if (blocks[to]) [blocks[from], blocks[to]] = [blocks[to], blocks[from]];
    q.renumber(db, 'workout_exercise', blocks.flat().map((e) => e.id));
  });

export const linkSuperset = (db: Db, a: string, b: string) => transaction(db, () => q.linkSuperset(db, a, b, createId()));

export const unlinkSuperset = (db: Db, workoutExerciseId: string) => transaction(db, () => q.unlinkSuperset(db, workoutExerciseId));

export const noteWorkout = (db: Db, workoutId: string, note: string) => q.setNote(db, 'workout', workoutId, note.trim() || null);

export const noteExercise = (db: Db, workoutExerciseId: string, note: string) => q.setNote(db, 'workout_exercise', workoutExerciseId, note.trim() || null);

export const setExerciseNote = (db: Db, exerciseId: string, note: string) => {
  const kept = note.trim() || null;
  q.setNote(db, 'exercise', exerciseId, kept);
  return kept;
};

export const discardWorkout = (db: Db, workoutId: string) => transaction(db, () => q.deleteUnfinishedWorkout(db, workoutId));

export const deleteWorkout = (db: Db, workoutId: string) => transaction(db, () => q.deleteWorkout(db, workoutId));

export const firstRun = (db: Db) => !q.hasData(db);

export const backupDue = (db: Db, now = new Date()) => {
  if (getSetting(db, 'backupFolder')) return false;
  const first = db.all('SELECT min(finished_at) AS at FROM workout WHERE finished_at IS NOT NULL')[0].at as string | null;
  if (!first) return false;
  const since = Math.max(...[first, getSetting(db, 'exportedAt'), getSetting(db, 'backupDismissedAt')].map((at) => Date.parse(at ?? '')).map((t) => (t <= now.getTime() ? t : 0)));
  return now.getTime() - since >= 30 * 86400000;
};

export const closeWorkout = (db: Db, workoutId: string) => {
  const workout = getWorkout(db, workoutId);
  if (workout.finishedAt && !workout.exercises.some((e) => e.sets.length)) deleteWorkout(db, workoutId);
};

export const logWorkout = (db: Db, date: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  if (date > localDate(new Date(), timeZone)) throw new Error(`Cannot log a future workout: ${date}`);
  return transaction(db, () => {
    const [untouched] = q.workouts(db, 'date = ? AND finished_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workout_exercise e WHERE e.workout_id = workout.id)', [date]);
    if (untouched) return untouched.id;
    const id = createId();
    const at = `${date}T12:00:00.000Z`;
    q.insertWorkout(db, { id, templateId: null, name: 'Workout', date, timeZone, startedAt: at });
    q.finishWorkout(db, id, at);
    return id;
  });
};

export const unfinishedWorkouts = (db: Db) => q.workouts(db, 'finished_at IS NULL', []);

export const correctSet = (db: Db, setId: string, patch: Partial<SetFields>) => {
  const set = { ...q.readSet(db, setId), ...patch };
  const blank = patch.completed === false && set.targetReps && set.reps === set.targetReps ? { ...set, reps: 0 } : set;
  q.updateSet(db, setId, checkSet(patch.completed ? logged(set) : blank));
};

export const finishWorkout = (db: Db, workoutId: string, now = new Date()) => q.finishWorkout(db, workoutId, now.toISOString());

export const renameWorkout = (db: Db, workoutId: string, name: string) => {
  if (!name.trim()) throw new Error('Workout name is required');
  q.renameWorkout(db, workoutId, name.trim());
};

export const moveWorkout = (db: Db, workoutId: string, date: string) => {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  if (date > localDate(new Date(), getWorkout(db, workoutId).timeZone)) throw new Error(`Cannot move a workout to a future date: ${date}`);
  q.updateWorkoutDate(db, workoutId, date);
};

export const remapExercise = (db: Db, workoutExerciseId: string, mapping: Mapping) =>
  transaction(db, () => q.replaceWorkoutMapping(db, workoutExerciseId, checkMapping(mapping)));

export const getWorkout = (db: Db, workoutId: string) => {
  const workout = q.workouts(db, 'id = ?', [workoutId])[0];
  if (!workout) throw new Error(`Not found: ${workoutId}`);
  return workout;
};

export const history = (db: Db, exercise?: string, limit?: number, before?: { date: string; startedAt: string }) =>
  q
    .workouts(
      db,
      'finished_at IS NOT NULL AND (? IS NULL OR id IN (SELECT we.workout_id FROM workout_exercise we JOIN exercise e ON e.id = we.exercise_id WHERE e.name = ?)) AND (? IS NULL OR (date, started_at) < (?, ?))',
      [exercise ?? null, exercise ?? null, before?.date ?? null, before?.date ?? null, before?.startedAt ?? null],
      limit,
      exercise ?? null,
    );

export const suggest = (db: Db, exercise: string, before?: { date: string; startedAt: string }) => {
  const last = history(db, exercise, 1, before)[0]?.exercises[0];
  return last?.mode === 'reps' ? progressed(last.sets).map((s, i) => (s.weight !== last.sets[i].weight ? s : null)) : [];
};

export const progress = (db: Db, exercise: string) => {
  const done = history(db, exercise);
  const source = done[0]?.exercises[0].source;
  const weighOn = source && bodyweight.has(source) ? bodyWeightLookup(db) : () => null;
  const sessions = done.map((w) => ({ workoutId: w.id, date: w.date, name: w.name, sets: w.exercises.flatMap((e) => e.sets.map((s) => ({ ...s, bodyWeight: weighOn(w.date) ?? 0 }))) }));
  const best = records(sessions);
  const trend = e1rmTrend(sessions);
  return { sessions, ...best, maxes: best.estimate ? repMaxes(best.estimate.value) : [], ...holds(done[0]?.exercises[0].mode === 'duration' ? sessions : []), trend, trends: { weight: weightTrend(sessions), e1rm: trend, hold: holdTrend(sessions) } };
};

export const prSets = (db: Db, workout: ReturnType<typeof getWorkout>) => {
  const weighOn = bodyWeightLookup(db);
  const weigh = (source: string | null, date: string) => (source && bodyweight.has(source) ? (weighOn(date) ?? 0) : 0);
  const names = [...new Set(workout.exercises.map((e) => e.name))];
  return new Set(
    names.flatMap((name) => {
      const own = workout.exercises.filter((e) => e.name === name);
      const earlier = history(db, name, undefined, workout).flatMap((w) => w.exercises.flatMap((e) => e.sets.map((s) => ({ ...s, bodyWeight: weigh(e.source, w.date) }))));
      return personalBests(own[0].mode, earlier, own.flatMap((e) => e.sets.map((s) => ({ ...s, bodyWeight: weigh(e.source, workout.date) }))));
    }),
  );
};

export const lifts = q.lifts;

export const recordKinds = ['weight', 'e1rm', 'hold'] as const;
export type RecordKind = (typeof recordKinds)[number];

const modeKinds: Partial<Record<Mode, RecordKind[]>> = { reps: ['weight', 'e1rm'], duration: ['hold'] };

export const personalRecords = (db: Db, starredOnly = false) => {
  const starred = new Set(q.starredRecords(db));
  return lifts(db)
    .flatMap((lift) => {
      const kinds = (modeKinds[lift.mode] ?? []).filter((kind) => !starredOnly || starred.has(`${lift.id} ${kind}`));
      if (!kinds.length) return [];
      const p = progress(db, lift.name);
      const hits = { weight: p.weight && { ...p.weight, value: p.weight.set.weight }, e1rm: p.estimate, hold: p.longest && { ...p.longest, value: p.longest.set.duration ?? 0 } };
      return kinds.flatMap((kind) => {
        const hit = hits[kind];
        const trend = p.trends[kind];
        const change = trend.length > 1 ? { since: trend[0].date, gain: Math.max(...trend.map((t) => t.value)) - trend[0].value } : null;
        return hit ? [{ ...hit, exerciseId: lift.id, name: lift.name, kind, starred: starred.has(`${lift.id} ${kind}`), trend, change }] : [];
      });
    })
    .sort((a, b) => Number(b.starred) - Number(a.starred) || b.date.localeCompare(a.date));
};

export const starRecord = (db: Db, exerciseId: string, kind: RecordKind, starred: boolean) => {
  if (!recordKinds.includes(kind)) throw new Error(`Record must be weight, e1rm or hold: ${kind}`);
  const mode = q.exerciseMode(db, exerciseId);
  if (!modeKinds[mode]?.includes(kind)) throw new Error(`A ${mode} exercise has no ${kind} record`);
  q.starRecord(db, createId(), exerciseId, kind, starred);
};

export const volumeRanges = { week: 7, month: 30, all: 0 };

export const totalVolume = (db: Db, today: string, range: keyof typeof volumeRanges) => {
  if (!isDate(today)) throw new Error(`Invalid date: ${today}`);
  if (!Object.hasOwn(volumeRanges, range)) throw new Error(`Range must be week, month or all: ${range}`);
  const days = volumeRanges[range];
  return volume(volumeSets(db, days ? addDays(today, 1 - days) : '0000-01-01', today));
};

const volumeSets = (db: Db, from: string, to: string) => {
  const weighOn = bodyWeightLookup(db);
  return q
    .setRows(db, from, to)
    .filter((s) => s.mode === 'reps')
    .map((s) => (s.source && bodyweight.has(s.source) ? { ...s, bodyWeight: weighOn(s.date) ?? 0 } : s));
};

export const weeklyVolume = (db: Db, today: string) => {
  if (!isDate(today)) throw new Error(`Invalid date: ${today}`);
  const sets = volumeSets(db, '0000-01-01', today);
  const first = sets.reduce((min, s) => (s.date < min ? s.date : min), today);
  const weeks: { date: string; sets: typeof sets }[] = [];
  for (let end = today; end >= first; end = addDays(end, -7)) weeks.unshift({ date: end, sets: [] });
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 864e5;
  for (const s of sets) weeks[weeks.length - 1 - Math.floor((day(today) - day(s.date)) / 7)].sets.push(s);
  return sets.length ? weeks.map((w) => ({ date: w.date, value: volume(w.sets) })) : [];
};

export const workoutSummary = (db: Db, workoutId: string) => {
  const workout = getWorkout(db, workoutId);
  const bodyWeight = bodyWeightLookup(db)(workout.date) ?? 0;
  const done = new Map<string, ReturnType<typeof progress>>();
  const exercises = workout.exercises.map((e) => {
    const p = done.get(e.name) ?? done.set(e.name, progress(db, e.name)).get(e.name)!;
    const sets = e.sets.map((s) => ({ ...s, bodyWeight: e.source && bodyweight.has(e.source) ? bodyWeight : 0 }));
    const hits = e.mode === 'reps' ? [p.weight, p.estimate, ...p.reps] : e.mode === 'duration' ? [p.longest, ...p.holds] : [];
    const ids = new Set(e.sets.map((s) => s.id));
    const marked = [...new Set(hits.flatMap((h) => (h && ids.has(h.set.id) ? [h.set.id] : [])))];
    const one = (sets: typeof p.sessions[number]['sets']) => [{ workoutId: workout.id, date: workout.date, sets }];
    const best = (sets: typeof p.sessions[number]['sets']) => {
      const hit = e.mode === 'reps' ? records(one(sets)).estimate : null;
      const hold = e.mode === 'duration' ? holds(one(sets)).longest : null;
      return hit ? { set: hit.set, value: hit.value } : hold && { set: hold.set, value: hold.set.duration ?? 0 };
    };
    const at = p.sessions.findIndex((s) => s.workoutId === workout.id);
    const trend = e.mode === 'reps' || e.mode === 'duration'
      ? p.sessions
          .slice(Math.max(at, 0))
          .flatMap((s) => {
            const top = best(s.sets);
            if (!top) return [];
            return [{ date: s.date, value: e.mode === 'reps' ? convert(top.value, top.set.unit ?? 'kg', 'kg') : top.value }];
          })
          .slice(0, 8)
          .reverse()
      : [];
    const working = sets.filter(isWorkingSet);
    const own = best(sets);
    const top = own?.set ?? (e.mode === 'reps' ? working.reduce<(typeof working)[number] | null>((a, s) => (s.reps > (a?.reps ?? 0) ? s : a), null) : null);
    return { ...e, top, estimate: e.mode === 'reps' ? (own?.value ?? null) : null, records: marked, trend };
  });
  return {
    ...workout,
    minutes: Math.round((Date.parse(workout.finishedAt ?? workout.startedAt) - Date.parse(workout.startedAt)) / 60000),
    sets: workout.exercises.flatMap((e) => e.sets.filter(isWorkingSet)).length,
    volume: volume(
      workout.exercises
        .filter((e) => e.mode === 'reps')
        .flatMap((e) => (e.source && bodyweight.has(e.source) ? e.sets.map((s) => ({ ...s, bodyWeight })) : e.sets)),
    ),
    records: exercises.reduce((n, e) => n + e.records.length, 0),
    muscles: muscleSets(workout.exercises.flatMap((e) => e.mapping.flatMap((m) => e.sets.map((s) => ({ ...m, type: s.type, completed: s.completed, exercise: e.name }))))),
    exercises,
  };
};

export const recentWorkouts = (db: Db, limit: number) =>
  q.workouts(
    db,
    'finished_at IS NOT NULL AND id = (SELECT x.id FROM workout x WHERE x.name = workout.name AND x.finished_at IS NOT NULL ORDER BY x.date DESC, x.started_at DESC LIMIT 1)',
    [],
    limit,
  );

export const muscleTotals = (db: Db, date: string) => {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  const from = addDays(date, -6);
  return { from, to: date, totals: muscleSets(q.muscleRows(db, from, date)) };
};

export const workoutsOn = (db: Db, date: string) => {
  if (!isDate(date)) throw new Error(`Invalid date: ${date}`);
  return q.workouts(db, 'finished_at IS NOT NULL AND date = ?', [date]);
};

export const calendar = (db: Db, today: string, weeks: number, ahead = 0) => {
  if (!isDate(today)) throw new Error(`Invalid date: ${today}`);
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error(`Weeks must be at least 1: ${weeks}`);
  if (!Number.isInteger(ahead) || ahead < 0 || ahead > 365) throw new Error(`Days ahead must be 0 to 365: ${ahead}`);
  const to = addDays(today, ahead);
  const from = addDays(to, 1 - 7 * weeks);
  const sets = workingSetsByDate(q.setRows(db, from, to));
  const plans = new Map(plannedDays(db, today, ahead + 1).map((d) => [d.date, d]));
  return Array.from({ length: 7 * weeks }, (_, i) => {
    const date = addDays(from, i);
    return { date, sets: sets[date] ?? 0, plan: plans.get(date) ?? null };
  });
};
