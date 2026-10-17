import { createId } from '@paralleldrive/cuid2';

import { aliases } from '../../assets/catalog/aliases.ts';

import type { Db, Row, Value } from '../data/db.ts';
import { presets, type Kind } from './measurements.ts';
import type { Import, Parsed } from './portability.ts';
import { isDate, localDate, zoned } from './rules.ts';
import { weightUnit } from './workouts.ts';

export type Found = { name: string; mode: 'reps' | 'duration' | 'distance' };

export function* each<T>(items: T[], fn: (item: T, i: number) => void, done = 0, total = items.length) {
  for (let i = 0; i < items.length; i++) {
    fn(items[i], i);
    if (i % 100 === 99) yield (done + i + 1) / total;
  }
}

export const drain = <T>(steps: Generator<number, T>) => {
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
};

const key = (name: string) =>
  [
    ...new Set(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .map((w) => w.replace(/(?<=[^s])s$/, '')),
    ),
  ]
    .sort()
    .join(' ');

export const matchExercises = (db: Db, app: string, names: string[]) => {
  const all = db.all('SELECT id, name FROM exercise');
  const exact = new Map(all.map((e) => [(e.name as string).toLowerCase(), e.id as string]));
  const loose = new Map<string, string | null>();
  for (const e of all) loose.set(key(e.name as string), loose.has(key(e.name as string)) ? null : (e.id as string));
  return Object.fromEntries(
    names.map((n) => {
      const saved = db.all('SELECT exercise_id FROM app_exercise WHERE app = ? AND name = ?', [app, n])[0]?.exercise_id as string | undefined;
      const alias = aliases[n.toLowerCase()] && (db.all('SELECT id FROM exercise WHERE source = ?', [aliases[n.toLowerCase()]])[0]?.id as string | undefined);
      return [n, { id: saved ?? alias ?? exact.get(n.toLowerCase()) ?? loose.get(key(n)) ?? null, saved: !!saved }];
    }),
  );
};

const table = (name: string, columns: string[]): Parsed => ({ table: name, columns, rows: [] });

export type Match = { name: string; id: string | null; exercise: string | null; saved: boolean };

export const resolveExercises = (db: Db, imp: Import, map: Record<string, string>) => {
  if (!imp.app || !imp.exercises?.length) return { imp, exercises: [] as Match[], unmatched: [] as string[], errors: [] as string[] };
  const app = imp.app;
  const matched = matchExercises(db, app, imp.exercises.map((e) => e.name));
  const created = table('exercise', ['id', 'name', 'mode']);
  const ids = new Map<string, string>();
  const unmatched: string[] = [];
  const errors: string[] = [];
  for (const e of imp.exercises) {
    const choice = map[e.name] ?? matched[e.name].id;
    if (!choice || choice === 'skip') {
      unmatched.push(e.name);
      continue;
    }
    if (choice === 'new' && db.all('SELECT 1 FROM exercise WHERE name = ? COLLATE NOCASE', [e.name]).length) errors.push(`An exercise named ${e.name} already exists; match it instead`);
    if (choice !== 'new') ids.set(e.name, choice);
    else {
      const id = createId();
      ids.set(e.name, id);
      created.rows.push({ at: e.name, cells: [id, e.name, e.mode] });
    }
  }
  // Skipped names drop their sets, and a workout left with no exercises.
  const all = imp.tables.find((p) => p.table === 'workout_exercise')?.rows ?? [];
  const kept = all.filter(({ cells }) => ids.has(cells[2]!));
  const keptIds = new Set(kept.map(({ cells }) => cells[0]));
  const live = new Set(kept.map(({ cells }) => cells[1]));
  const emptied = new Set(all.map(({ cells }) => cells[1]).filter((w) => !live.has(w)));
  const positions = new Map<string | null, number>();
  const supersets = new Map<string | null, number>();
  for (const { cells } of kept) supersets.set(cells[5], (supersets.get(cells[5]) ?? 0) + 1);
  const muscles = table('workout_exercise_muscle', ['workout_exercise_id', 'muscle', 'role']);
  const tables = imp.tables.map((p) => {
    if (p.table === 'workout') return { ...p, rows: p.rows.filter(({ cells }) => !emptied.has(cells[0])) };
    if (p.table === 'workout_set') return { ...p, rows: p.rows.filter(({ cells }) => keptIds.has(cells[1])) };
    if (p.table !== 'workout_exercise') return p;
    const rows = kept.map(({ at, cells }) => {
      const position = positions.get(cells[1]) ?? 0;
      positions.set(cells[1], position + 1);
      return { at, cells: [cells[0], cells[1], ids.get(cells[2]!)!, String(position), cells[4], supersets.get(cells[5])! > 1 ? cells[5] : null] };
    });
    for (const { at, cells } of rows)
      for (const m of db.all('SELECT muscle, role FROM exercise_muscle WHERE exercise_id = ?', [cells[2]])) muscles.rows.push({ at, cells: [cells[0], m.muscle as string, m.role as string] });
    return { ...p, rows };
  });
  const at = tables.findIndex((p) => p.table === 'workout_exercise');
  return {
    imp: { ...imp, tables: [created, ...tables.slice(0, at + 1), muscles, ...tables.slice(at + 1)] },
    exercises: imp.exercises.map((e): Match => {
      const id = map[e.name] ?? matched[e.name].id;
      return { name: e.name, id, exercise: (id && id !== 'skip' && db.all('SELECT name FROM exercise WHERE id = ?', [id])[0]?.name as string) || null, saved: !map[e.name] && matched[e.name].saved };
    }),
    unmatched,
    errors,
    remember: () => {
      for (const [name, id] of ids)
        db.run('INSERT INTO app_exercise (app, name, exercise_id) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET exercise_id = excluded.exercise_id', [app, name, id]);
    },
  };
};

const stamp = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const isStamp = (v: string | null): v is string => !!v && stamp.test(v) && isDate(v.slice(0, 10));

const strongColumns = ['Workout #', 'Date', 'Workout Name', 'Duration (sec)', 'Exercise Name', 'Set Order', 'Reps', 'RPE', 'Seconds', 'Notes', 'Workout Notes'];
const weights: Record<string, 'kg' | 'lb'> = { kg: 'kg', lbs: 'lb', lb: 'lb' };
const distances: Record<string, ['km' | 'mi', number]> = { meters: ['km', 1000], km: ['km', 1], miles: ['mi', 1], feet: ['mi', 5280] };

export const isStrong = (header: (string | null)[]) => header.includes('Workout #') && header.includes('Set Order');

type Session = { id: string; existing: boolean; exercises: Map<string, { row: (string | null)[]; sets: number }>; supersets: Record<string, string> };
type SetCells = { done?: boolean; type: string; weight: string | null; unit: string; reps: string | null; duration: string | null; distance: string | null; distanceUnit: string; rpe: string | null; comment: string | null };

const sessions = (db: Db, timeZone: string) => {
  const workout = table('workout', ['id', 'name', 'date', 'time_zone', 'started_at', 'finished_at', 'note']);
  const exercise = table('workout_exercise', ['id', 'workout_id', 'exercise_id', 'position', 'note', 'superset']);
  const set = table('workout_set', ['id', 'workout_exercise_id', 'position', 'type', 'weight', 'unit', 'reps', 'duration', 'distance', 'distance_unit', 'rpe', 'comment', 'completed']);
  const workouts = new Map<string, Session>();
  const found = new Map<string, { reps: boolean; duration: boolean; distance: boolean }>();
  return {
    workout: (at: string, name: string, date: string, startedAt: string, finishedAt: string, note: string | null) => {
      let w = workouts.get(`${startedAt}\n${name}`);
      if (!w) {
        const existing = db.all('SELECT id FROM workout WHERE started_at = ? AND name = ?', [startedAt, name])[0];
        w = { id: (existing?.id as string) ?? createId(), existing: !!existing, exercises: new Map(), supersets: {} };
        workouts.set(`${startedAt}\n${name}`, w);
        workout.rows.push({ at, cells: [w.id, name, date, timeZone, startedAt, finishedAt, note] });
      }
      return w.existing ? null : w;
    },
    exercise: (at: string, w: Session, key: string, name: string, superset: string | null = null) => {
      let e = w.exercises.get(key);
      if (!e) {
        e = { row: [createId(), w.id, name, String(w.exercises.size), null, superset && (w.supersets[superset] ??= createId())], sets: 0 };
        w.exercises.set(key, e);
        exercise.rows.push({ at, cells: e.row });
      }
      if (!found.has(name)) found.set(name, { reps: false, duration: false, distance: false });
      return e;
    },
    set: (at: string, e: { row: (string | null)[]; sets: number }, s: SetCells) => {
      const mode = found.get(e.row[2]!)!;
      mode.reps ||= !!Number(s.reps);
      mode.duration ||= !!Number(s.duration);
      mode.distance ||= !!Number(s.distance);
      set.rows.push({ at, cells: [createId(), e.row[0], String(e.sets++), s.type, s.weight ?? '0', s.unit, s.reps ?? '0', s.duration, s.distance, s.distanceUnit, s.rpe, s.comment, s.done === false ? '0' : '1'] });
    },
    done: (): Pick<Import, 'tables' | 'exercises'> => {
      for (const { cells } of exercise.rows) if (cells[5] && exercise.rows.filter((r) => r.cells[5] === cells[5]).length < 2) cells[5] = null;
      return {
        tables: [workout, exercise, set],
        exercises: [...found].map(([name, m]) => ({ name, mode: m.reps || (!m.distance && !m.duration) ? 'reps' : m.distance ? 'distance' : 'duration' })),
      };
    },
  };
};

const nonNegative = (numbers: Record<string, number | null>) => Object.entries(numbers).map(([c, n]) => n !== null && !(Number.isFinite(n) && n >= 0) && `${c} must be a non-negative number`);

export function* fromStrong(db: Db, [header, ...lines]: (string | null)[][], timeZone: string, errors: string[]): Generator<number, Pick<Import, 'tables' | 'exercises'>> {
  const unit = (label: string, units: object) => header.map((c) => new RegExp(`^${label} \\((\\w+)\\)$`).exec(c ?? '')?.[1]).find((u) => u && u in units);
  const weightUnit = unit('Weight', weights);
  const distanceUnit = unit('Distance', distances);
  const missing = [...strongColumns.filter((c) => !header.includes(c)), !weightUnit && 'Weight (kg or lbs)', !distanceUnit && 'Distance (meters, km, miles or feet)'].filter(Boolean);
  if (missing.length) return errors.push(`This Strong export is missing the columns ${missing.join(', ')}`), { tables: [] };
  const weightColumn = `Weight (${weightUnit})`;
  const distanceColumn = `Distance (${distanceUnit})`;
  const [distanceTo, distanceDivisor] = distances[distanceUnit!];
  const out = sessions(db, timeZone);
  yield* each(lines, (cells, i) => {
    const at = `Strong line ${i + 2}`;
    const col = (c: string) => cells[header.indexOf(c)] || null;
    const date = col('Date');
    const name = col('Workout Name');
    const exerciseName = col('Exercise Name');
    const order = col('Set Order') ?? '';
    const numbers = Object.fromEntries(['Duration (sec)', weightColumn, 'Reps', 'RPE', distanceColumn, 'Seconds'].map((c) => [c, col(c) === null ? null : Number(col(c))]));
    const bad = [
      !isStamp(date) && 'Date must be YYYY-MM-DD HH:MM:SS',
      !name && 'Workout Name is required',
      !exerciseName && 'Exercise Name is required',
      !/^(\d+|W|F|D|Note)$/.test(order) && `unknown Set Order ${order}`,
      ...nonNegative(numbers),
    ].filter(Boolean);
    if (bad.length) return errors.push(`${at}: ${bad.join('; ')}`);
    const startedAt = zoned(date!.replace(' ', 'T'), timeZone);
    const w = out.workout(at, name!, date!.slice(0, 10), startedAt, new Date(Date.parse(startedAt) + (numbers['Duration (sec)'] ?? 0) * 1000).toISOString(), col('Workout Notes'));
    if (!w) return;
    const e = out.exercise(at, w, exerciseName!, exerciseName!);
    if (order === 'Note') return void (e.row[4] = col('Notes'));
    const distance = numbers[distanceColumn];
    out.set(at, e, {
      type: { W: 'warm-up', D: 'drop' }[order] ?? 'normal',
      weight: col(weightColumn),
      unit: weights[weightUnit!],
      reps: col('Reps'),
      duration: col('Seconds'),
      distance: distance === null ? null : String(distance / distanceDivisor),
      distanceUnit: distanceTo,
      rpe: col('RPE'),
      comment: col('Notes'),
    });
  });
  return out.done();
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hevyStamp = (v: string | null) => {
  const m = /^(\d{1,2}) (\w{3}) (\d{4}), (\d{2}:\d{2})$/.exec(v ?? '');
  const stamp = m && `${m[3]}-${String(months.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')} ${m[4]}:00`;
  return isStamp(stamp) ? stamp : null;
};
const hevyColumns = ['title', 'start_time', 'end_time', 'description', 'exercise_title', 'superset_id', 'exercise_notes', 'set_index', 'set_type', 'reps', 'duration_seconds', 'rpe'];
const hevyTypes: Record<string, string> = { warmup: 'warm-up', normal: 'normal', dropset: 'drop', failure: 'normal' };

export const isHevy = (header: (string | null)[]) => header.includes('exercise_title') && header.includes('set_type');

export function* fromHevy(db: Db, [header, ...lines]: (string | null)[][], timeZone: string, errors: string[]): Generator<number, Pick<Import, 'tables' | 'exercises'>> {
  const weightColumn = ['weight_kg', 'weight_lbs'].find((c) => header.includes(c));
  const distanceColumn = ['distance_km', 'distance_miles'].find((c) => header.includes(c));
  const missing = [...hevyColumns.filter((c) => !header.includes(c)), !weightColumn && 'weight_kg or weight_lbs', !distanceColumn && 'distance_km or distance_miles'].filter(Boolean);
  if (missing.length) return errors.push(`This Hevy export is missing the columns ${missing.join(', ')}`), { tables: [] };
  const out = sessions(db, timeZone);
  let last: { w: object; name: string; index: number; block: number } | undefined;
  yield* each(lines, (cells, i) => {
    const at = `Hevy line ${i + 2}`;
    const col = (c: string) => cells[header.indexOf(c)] || null;
    const start = hevyStamp(col('start_time'));
    const end = hevyStamp(col('end_time'));
    const name = col('title');
    const exerciseName = col('exercise_title');
    const type = col('set_type') ?? '';
    const numbers = Object.fromEntries(['set_index', weightColumn!, 'reps', distanceColumn!, 'duration_seconds', 'rpe'].map((c) => [c, col(c) === null ? null : Number(col(c))]));
    const bad = [
      !start && 'start_time must be like 13 Oct 2026, 10:25',
      !end && 'end_time must be like 13 Oct 2026, 10:25',
      !name && 'title is required',
      !exerciseName && 'exercise_title is required',
      !(type in hevyTypes) && `unknown set_type ${type}`,
      ...nonNegative(numbers),
    ].filter(Boolean);
    if (bad.length) return errors.push(`${at}: ${bad.join('; ')}`);
    const w = out.workout(at, name!, start!.slice(0, 10), zoned(start!.replace(' ', 'T'), timeZone), zoned(end!.replace(' ', 'T'), timeZone), col('description'));
    if (!w) return;
    const index = numbers.set_index ?? 0;
    const block = last?.w === w && last.name === exerciseName && index > last.index ? last.block : (last?.block ?? 0) + 1;
    last = { w, name: exerciseName!, index, block };
    const e = out.exercise(at, w, String(block), exerciseName!, col('superset_id'));
    e.row[4] ??= col('exercise_notes');
    out.set(at, e, {
      type: hevyTypes[type],
      weight: col(weightColumn!),
      unit: weightColumn === 'weight_kg' ? 'kg' : 'lb',
      reps: col('reps'),
      duration: col('duration_seconds'),
      distance: col(distanceColumn!),
      distanceUnit: distanceColumn === 'distance_km' ? 'km' : 'mi',
      rpe: col('rpe'),
      comment: null,
    });
  });
  return out.done();
}

const strengthLogColumns = ['workout', 'start', 'end', 'exercise', 'specialset', 'weight', 'extraWeight', 'assistingWeight', 'distanceKM', 'reps', 'time', 'warmup', 'setComment', 'workoutComment'];
const flags = ['warmup', 'max', 'fail'];
const epoch = (n: number | null) => Number.isInteger(n) && !isNaN(new Date(n!).getTime());

export const isStrengthLog = (header: (string | null)[]) => header.includes('specialset') && header.includes('workoutComment');

export function* fromStrengthLog(db: Db, [header, ...lines]: (string | null)[][], timeZone: string, errors: string[]): Generator<number, Pick<Import, 'tables' | 'exercises' | 'notes'>> {
  const missing = strengthLogColumns.filter((c) => !header.includes(c));
  if (missing.length) return errors.push(`This StrengthLog export is missing the columns ${missing.join(', ')}`), { tables: [] };
  const unit = weightUnit(db);
  const out = sessions(db, timeZone);
  let last: { w: object; name: string; superset: boolean; block: number; run: number } | undefined;
  yield* each(lines, (cells, i) => {
    const at = `StrengthLog line ${i + 2}`;
    const col = (c: string) => cells[header.indexOf(c)] || null;
    const name = col('workout');
    const exerciseName = col('exercise');
    const special = col('specialset') ?? '';
    const time = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(col('time') ?? '0:00:00');
    const numbers = Object.fromEntries(['start', 'end', 'weight', 'extraWeight', 'assistingWeight', 'distanceKM', 'reps'].map((c) => [c, col(c) === null ? null : Number(col(c))]));
    const bad = [
      !epoch(numbers.start) && 'start must be epoch milliseconds',
      !(epoch(numbers.end) && numbers.end! >= numbers.start!) && 'end must be epoch milliseconds after start',
      !name && 'workout is required',
      !exerciseName && 'exercise is required',
      !['', 'superset'].includes(special) && `unknown specialset ${special}`,
      !time && 'time must be HH:MM:SS',
      ...flags.filter((f) => !['true', 'false'].includes(col(f) ?? 'false')).map((f) => `${f} must be true or false`),
      ...nonNegative(numbers),
    ].filter(Boolean);
    if (bad.length) return errors.push(`${at}: ${bad.join('; ')}`);
    const w = out.workout(at, name!, localDate(new Date(numbers.start!), timeZone), new Date(numbers.start!).toISOString(), new Date(numbers.end!).toISOString(), col('workoutComment'));
    if (!w) return;
    const superset = special === 'superset';
    const same = last?.w === w;
    const run = superset && !(same && last!.superset) ? (last?.run ?? 0) + 1 : (last?.run ?? 0);
    const block = same && last!.name === exerciseName && last!.superset === superset ? last!.block : (last?.block ?? 0) + 1;
    last = { w, name: exerciseName!, superset, block, run };
    const e = out.exercise(at, w, superset ? `superset ${run} ${exerciseName}` : String(block), exerciseName!, superset ? String(run) : null);
    const duration = +time![1] * 3600 + +time![2] * 60 + +time![3];
    const assisted = numbers.assistingWeight && `assisted ${numbers.assistingWeight} ${unit}`;
    out.set(at, e, {
      done: !!(numbers.reps || duration || numbers.distanceKM),
      type: col('warmup') === 'true' ? 'warm-up' : 'normal',
      weight: numbers.extraWeight ? col('extraWeight') : col('weight'),
      unit,
      reps: col('reps'),
      duration: duration ? String(duration) : null,
      distance: numbers.distanceKM ? col('distanceKM') : null,
      distanceUnit: 'km',
      rpe: null,
      comment: [col('setComment'), assisted].filter(Boolean).join('; ') || null,
    });
  });
  return { ...out.done(), notes: [`Weights are read as ${unit}, the weight unit in Settings: StrengthLog's export does not say which unit it used`] };
}

export const isStrongMeasurements = (files: Record<string, string>) => {
  const names = Object.keys(files);
  return names.length > 0 && names.every((n) => /^\w+\.csv$/.test(n) && files[n].startsWith('"Date";'));
};

type Series = { at: string; name: string; unit: string | undefined; entries: { at: string; stamp: string | null; value: string | null }[] };

const toMeasurements = (db: Db, list: Series[], errors: string[]): Pick<Import, 'tables' | 'skipped'> => {
  const series = table('measurement_series', ['id', 'name', 'preset', 'kind']);
  const measurement = table('measurement', ['id', 'series_id', 'date', 'value', 'unit']);
  const skipped: string[] = [];
  for (const { at: from, name, unit, entries } of list) {
    if (!unit) {
      if (entries.length) skipped.push(`${name}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}; nicereps has no measurement for it`);
      continue;
    }
    if (!entries.length) continue;
    const kind: Kind = unit === 'kg' || unit === 'lb' ? 'weight' : 'length';
    const preset = presets.find((p) => p.name.toLowerCase() === name.toLowerCase() || (p.key === 'body-weight' && name === 'Weight'));
    if (preset && preset.kind !== kind) {
      errors.push(`${from}: ${name} must be a ${preset.kind} measurement`);
      continue;
    }
    const local: Row | undefined = db.all(`SELECT id, kind FROM measurement_series WHERE ${preset ? 'preset' : 'name'} = ?`, [preset ? preset.key : name])[0];
    if (local && local.kind !== kind) {
      errors.push(`${from}: the existing ${name} series is not a ${kind} measurement`);
      continue;
    }
    const seriesId = (local?.id as string) ?? createId();
    if (!local) series.rows.push({ at: from, cells: [seriesId, preset?.name ?? name, preset?.key ?? null, kind] });
    const latest = new Map<string, { at: string; stamp: string; value: number }>();
    for (const { at, stamp, value } of entries) {
      const n = Number(value);
      if (!isStamp(stamp) || !(value && Number.isFinite(n) && n > 0)) {
        errors.push(`${at}: expected a date and a positive value`);
        continue;
      }
      const date = stamp.slice(0, 10);
      if (!latest.has(date) || latest.get(date)!.stamp <= stamp) latest.set(date, { at, stamp, value: Math.round(n * 100) / 100 });
    }
    for (const [date, { at, value }] of latest) {
      const existing = db.all('SELECT id FROM measurement WHERE series_id = ? AND date = ?', [seriesId, date])[0];
      measurement.rows.push({ at, cells: [(existing?.id as string) ?? createId(), seriesId, date, String(value), unit] });
    }
  }
  return { tables: [series, measurement], skipped };
};

export const fromStrongMeasurements = (db: Db, files: Record<string, string>, parse: (text: string) => (string | null)[][], errors: string[]) =>
  toMeasurements(
    db,
    Object.keys(files)
      .sort()
      .flatMap((file) => {
        const [header = [], ...rows] = parse(files[file]);
        if (header.length !== 2) return errors.push(`${file}: expected the columns Date and one measurement`), [];
        const [, name, raw] = /^(.*?)(?: \((kg|lbs|lb|cm|in)\))?$/.exec(header[1] ?? '')!;
        return [{ at: file, name, unit: raw === 'lbs' ? 'lb' : raw, entries: rows.flatMap(([stamp, value], i) => (stamp || value ? [{ at: `${file} line ${i + 2}`, stamp, value }] : [])) }];
      }),
    errors,
  );

export const isHevyMeasurements = (header: (string | null)[]) => header[0] === 'date' && header.includes('fat_percent');

export const fromHevyMeasurements = (db: Db, [header, ...rows]: (string | null)[][], errors: string[]) =>
  toMeasurements(
    db,
    header.slice(1).map((column, c) => {
      const [, part, raw] = /^(.*?)(?:_(kg|lbs|cm|in))?$/.exec(column ?? '')!;
      const name = part.replaceAll('_', ' ').replace(/^./, (x) => x.toUpperCase());
      return {
        at: column ?? '',
        name,
        unit: raw === 'lbs' ? 'lb' : raw,
        entries: rows.flatMap((cells, i) => (cells[c + 1] ? [{ at: `Hevy measurements line ${i + 2}, ${column}`, stamp: hevyStamp(cells[0]), value: cells[c + 1] }] : [])),
      };
    }),
    errors,
  );

const fitNotesDistances: Record<number, ['km' | 'mi', number]> = { 2: ['km', 1000], 3: ['km', 1], 4: ['mi', 5280], 5: ['mi', 1] };
const fitNotesUnits: Record<string, string> = { kgs: 'kg', lbs: 'lb', cm: 'cm', in: 'in' };
const perLb = 0.45359237;
const lengthsAndWeights: Record<string, number> = { kg: 1, lb: perLb, cm: 1, in: 2.54 };
const hundredths = (n: number) => String(Math.round(n * 100) / 100);

export const isFitNotes = (file: Db) => file.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'training_log'").length > 0;

export function* fromFitNotes(db: Db, file: Db, timeZone: string, errors: string[]): Generator<number, Pick<Import, 'tables' | 'exercises' | 'skipped'>> {
  const metric = file.all('SELECT metric FROM settings')[0]?.metric !== 0;
  const times = new Map(file.all('SELECT workout_date, start_date_time, end_date_time FROM WorkoutTime ORDER BY start_date_time DESC').map((t) => [t.workout_date, t]));
  const notes = new Map<Value, string>();
  for (const c of file.all('SELECT date, comment FROM WorkoutComment ORDER BY _id')) notes.set(c.date, [notes.get(c.date), c.comment].filter(Boolean).join('\n'));
  const groups = new Map(file.all('SELECT date, exercise_id, workout_group_id FROM WorkoutGroupExercise').map((g) => [`${g.date}\n${g.exercise_id}`, String(g.workout_group_id)]));
  const sets = file.all(
    `SELECT t._id, t.date, t.exercise_id, t.metric_weight, t.reps, t.unit, t.distance, t.duration_seconds, e.name, e.weight_unit_id, c.name AS category,
      (SELECT group_concat(comment, char(10)) FROM Comment WHERE owner_type_id = 1 AND owner_id = t._id) AS comment
    FROM training_log t LEFT JOIN exercise e ON e._id = t.exercise_id LEFT JOIN Category c ON c._id = e.category_id ORDER BY t.date, t._id`,
  );
  const names = new Map<Value, string[]>();
  for (const s of sets) {
    const list = names.get(s.date) ?? [];
    if (s.category && !list.includes(String(s.category))) list.push(String(s.category));
    names.set(s.date, list);
  }
  const out = sessions(db, timeZone);
  for (const [i, s] of sets.entries()) {
    if (i % 100 === 99) yield i / sets.length;
    const at = `FitNotes set ${s._id}`;
    const date = String(s.date);
    const time = times.get(s.date);
    const startedAt = Date.parse(time ? String(time.start_date_time) : `${date}T12:00:00.000Z`);
    const finishedAt = time ? Date.parse(String(time.end_date_time)) : startedAt;
    const numbers = Object.fromEntries(['metric_weight', 'reps', 'distance', 'duration_seconds'].map((c) => [c, Number(s[c])]));
    const bad = [!isDate(date) && 'date must be YYYY-MM-DD', !s.name && 'its exercise is missing', isDate(date) && !(finishedAt >= startedAt) && 'its workout time is invalid', ...nonNegative(numbers)].filter(Boolean);
    if (bad.length) {
      errors.push(`${at}: ${bad.join('; ')}`);
      continue;
    }
    const w = out.workout(at, names.get(s.date)!.join(', ') || 'Workout', date, new Date(startedAt).toISOString(), new Date(finishedAt).toISOString(), notes.get(s.date) ?? null);
    if (!w) continue;
    const e = out.exercise(at, w, String(s.exercise_id), String(s.name), groups.get(`${date}\n${s.exercise_id}`));
    const lb = s.weight_unit_id === 2 || (s.weight_unit_id !== 1 && !metric);
    const [distanceUnit, divisor] = fitNotesDistances[s.unit as number] ?? fitNotesDistances[2];
    out.set(at, e, {
      type: 'normal',
      weight: hundredths(lb ? numbers.metric_weight / perLb : numbers.metric_weight),
      unit: lb ? 'lb' : 'kg',
      reps: String(numbers.reps),
      duration: numbers.duration_seconds ? String(numbers.duration_seconds) : null,
      distance: numbers.distance ? String(numbers.distance / divisor) : null,
      distanceUnit,
      rpe: null,
      comment: (s.comment as string | null) || null,
    });
  }
  const series = new Map<string, Series>();
  const add = (name: string, unit: string | undefined, at: string, stamp: string, value: Value) => {
    const fixed = name === 'Bodyweight' ? 'Body weight' : name.replace(/^(.*) \((Left|Right)\)$/, '$2 $1').replace('Upper Arm', 'Bicep');
    const key = fixed.toLowerCase();
    if (!series.has(key)) series.set(key, { at, name: fixed, unit, entries: [] });
    const into = series.get(key)!;
    const converted = value !== null && unit && into.unit && unit !== into.unit ? hundredths((Number(value) * lengthsAndWeights[unit]) / lengthsAndWeights[into.unit]) : value;
    into.entries.push({ at, stamp, value: converted === null ? null : String(converted) });
  };
  for (const b of file.all('SELECT _id, date, body_weight_metric, body_fat FROM BodyWeight ORDER BY _id')) {
    const at = `FitNotes body weight ${b._id}`;
    const stamp = `${String(b.date).slice(0, 10)} 00:00:00`;
    add('Body weight', metric ? 'kg' : 'lb', at, stamp, metric ? b.body_weight_metric : Number(b.body_weight_metric) / perLb);
    if (Number(b.body_fat)) add('Body fat', undefined, at, stamp, b.body_fat);
  }
  for (const r of file.all('SELECT r._id, m.name, u.short_name AS unit, r.date, r.time, r.value FROM MeasurementRecord r JOIN Measurement m ON m._id = r.measurement_id LEFT JOIN MeasurementUnit u ON u._id = m.unit_id ORDER BY r._id'))
    add(String(r.name), fitNotesUnits[r.unit as string], `FitNotes measurement ${r._id}`, `${r.date} ${String(r.time).slice(0, 8).padEnd(8, ':00')}`, r.value);
  const workouts = out.done();
  const measured = toMeasurements(db, [...series.values()], errors);
  return { tables: [...workouts.tables, ...measured.tables], exercises: workouts.exercises, skipped: measured.skipped };
}
