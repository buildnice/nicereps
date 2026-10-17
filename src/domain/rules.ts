import type { Mode, Role, SetType, WeightUnit } from '../data/queries.ts';

export const setTypes: SetType[] = ['normal', 'warm-up', 'drop'];
export const modes: Mode[] = ['reps', 'duration', 'distance', 'interval', 'check'];
export const optionalFields = ['targetRpe', 'rpe', 'rest', 'comment', 'plates'] as const;
export type OptionalField = (typeof optionalFields)[number];
export const homeSections = ['heatmap', 'muscles', 'stats', 'recent', 'templates', 'measurements'] as const;
export type HomeSection = (typeof homeSections)[number];

type Visibility = { fields?: string | null; options?: boolean | null; targetRpe?: number | null; rpe?: number | null; rest?: number | null; comment?: string | null };
export const shownFields = (set: Visibility): OptionalField[] => {
  if (set.fields != null) return optionalFields.filter((f) => set.fields!.split(',').includes(f));
  return set.options ?? (set.targetRpe != null || set.rpe != null || set.rest != null || !!set.comment) ? [...optionalFields] : [];
};

export const homeLayout = (order = '', hidden = '') => {
  const stored = order.split(',').filter((s): s is HomeSection => (homeSections as readonly string[]).includes(s));
  return [...new Set([...stored, ...homeSections])].map((id) => ({ id, shown: !hidden.split(',').includes(id) }));
};

export const supersetBlocks = <T extends { superset: string | null }>(items: T[]) => {
  const blocks: T[][] = [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = item.superset ? groups.get(item.superset) : undefined;
    if (group) group.push(item);
    else {
      blocks.push([item]);
      if (item.superset) groups.set(item.superset, blocks[blocks.length - 1]);
    }
  }
  return blocks;
};

export const advance = <T extends { id: string; superset: string | null; sets: { completed: boolean }[] }>(items: T[], from: string) => {
  const open = (x: T) => x.sets.some((s) => !s.completed);
  const blocks = supersetBlocks(items);
  const at = blocks.findIndex((b) => b.some((x) => x.id === from));
  const i = blocks[at].findIndex((x) => x.id === from);
  const inBlock = [...blocks[at].slice(i + 1), ...blocks[at].slice(0, i + 1)].find(open);
  return (inBlock ?? [...blocks.slice(at + 1), ...blocks.slice(0, at)].flat().find(open))?.id ?? null;
};

export const pace = (seconds: number, distance: number, from: Unit = 'km', to: Unit = from) => (distance > 0 ? (seconds * perUnit[to]) / (distance * perUnit[from]) : null);
export const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const isWorkingSet = (set: { type: SetType; completed: boolean }) => set.completed && set.type !== 'warm-up';

export const muscleSets = (rows: { muscle: string; role: Role; type: SetType; completed: boolean; exercise: string }[]) => {
  const totals: Record<string, Record<string, number>> = {};
  for (const r of rows)
    if (isWorkingSet(r)) {
      const by = (totals[r.muscle] ??= {});
      by[r.exercise] = (by[r.exercise] ?? 0) + (r.role === 'primary' ? 1 : 0.5);
    }
  const sorted = <T extends { sets: number }>(items: T[], name: (item: T) => string) => items.sort((a, b) => b.sets - a.sets || name(a).localeCompare(name(b)));
  return sorted(
    Object.entries(totals).map(([muscle, by]) => ({
      muscle,
      sets: Object.values(by).reduce((a, b) => a + b, 0),
      exercises: sorted(Object.entries(by).map(([exercise, sets]) => ({ exercise, sets })), (e) => e.exercise),
    })),
    (m) => m.muscle,
  );
};

export const workingSetsByDate = (rows: { date: string; type: SetType; completed: boolean }[]) => {
  const counts: Record<string, number> = {};
  for (const r of rows) if (isWorkingSet(r)) counts[r.date] = (counts[r.date] ?? 0) + 1;
  return counts;
};

export const e1rm = (weight: number, reps: number) => weight * (1 + reps / 30);

const perUnit = { kg: 1, lb: 0.45359237, cm: 1, in: 2.54, km: 1, mi: 1.609344 };
export type Unit = keyof typeof perUnit;
export const convert = (value: number, from: Unit, to: Unit) => (from === to ? value : Math.round(((value * perUnit[from]) / perUnit[to]) * 10) / 10);
export const wholeIn = (kg: number, unit: WeightUnit) => Math.round(kg / perUnit[unit]);
export const kg = (set: { weight: number; unit?: WeightUnit }) => set.weight * perUnit[set.unit ?? 'kg'];
const load = (set: { weight: number; unit?: WeightUnit; bodyWeight?: number }) => kg(set) + (set.bodyWeight ?? 0);

export const volume = (sets: { type: SetType; completed: boolean; weight: number; unit?: WeightUnit; reps: number; bodyWeight?: number }[]) =>
  sets.reduce((sum, set) => (isWorkingSet(set) ? sum + load(set) * set.reps : sum), 0);

export const repMaxes = (estimate: number) => [3, 5, 8, 10].map((reps) => ({ reps, weight: estimate / (1 + reps / 30) }));

export const weightStep = { kg: 2.5, lb: 5 };

type Lift = { type: SetType; weight: number; unit?: WeightUnit; reps: number };
export const unusual = (set: Lift, sessions: (Lift & { completed: boolean })[][]) => {
  if (set.type !== 'normal' || set.weight <= 0) return null;
  const ok = (s: Lift & { completed: boolean }) => s.completed && s.type === 'normal' && s.weight > 0;
  const usual = Math.max(0, ...sessions.flat().filter(ok).map(kg));
  const ratio = kg(set) / usual;
  if (usual && (ratio > 1.5 || ratio < 0.5)) return { field: 'weight' as const, usual };
  const last = sessions.map((s) => s.filter(ok).findLast((x) => Math.abs(kg(x) - kg(set)) < 0.05)).find(Boolean)?.reps;
  if (last && set.reps > 0 && (set.reps >= last * 3 || set.reps * 3 <= last)) return { field: 'reps' as const, last };
  return null;
};

export const progressed = <S extends { type: SetType; completed?: boolean; weight: number; unit?: WeightUnit; reps: number; targetReps?: number | null }>(sets: S[]) => {
  const working = sets.filter((s) => s.type !== 'warm-up');
  const met = working.length > 0 && working.every((s) => s.completed && s.targetReps && s.reps >= s.targetReps);
  return met ? sets.map((s) => (s.type !== 'warm-up' && s.weight > 0 ? { ...s, weight: Math.round((s.weight + weightStep[s.unit ?? 'kg']) * 100) / 100 } : s)) : sets;
};

export const bodyWeightOn = (entries: { date: string; value: number; unit: WeightUnit }[], date: string) => {
  const entry = entries.findLast((e) => e.date <= date) ?? entries[0];
  return entry ? kg({ weight: entry.value, unit: entry.unit }) : null;
};

const sessionBests = <S extends { type: SetType; completed: boolean }>(sessions: { date: string; sets: S[] }[], value: (set: S) => number) =>
  sessions
    .map(({ date, sets }) => ({ date, value: Math.max(0, ...sets.filter(isWorkingSet).map(value)) }))
    .filter((p) => p.value > 0)
    .reverse();

export const e1rmTrend = (sessions: { date: string; sets: { type: SetType; completed: boolean; weight: number; unit?: WeightUnit; reps: number; bodyWeight?: number }[] }[]) =>
  sessionBests(sessions, (s) => (load(s) > 0 && s.reps > 0 ? e1rm(load(s), s.reps) : 0));

export const weightTrend = (sessions: { date: string; sets: { type: SetType; completed: boolean; weight: number; unit?: WeightUnit; reps: number }[] }[]) =>
  sessionBests(sessions, (s) => (s.reps > 0 ? kg(s) : 0));

export const holdTrend = (sessions: { date: string; sets: { type: SetType; completed: boolean; duration?: number | null }[] }[]) => sessionBests(sessions, (s) => s.duration ?? 0);

type Hit<S> = { set: S; workoutId: string; date: string };

export const records = <S extends { type: SetType; completed: boolean; weight: number; unit?: WeightUnit; reps: number; bodyWeight?: number }>(sessions: { workoutId: string; date: string; sets: S[] }[]) => {
  let weight: Hit<S> | null = null;
  let estimate: (Hit<S> & { value: number }) | null = null;
  const atWeight = new Map<string, Hit<S>>();
  for (const { workoutId, date, sets } of [...sessions].reverse())
    for (const set of sets) {
      if (!isWorkingSet(set) || set.reps < 1) continue;
      const hit = { set, workoutId, date };
      const value = e1rm(set.weight + (set.bodyWeight ?? 0) / perUnit[set.unit ?? 'kg'], set.reps);
      if (set.weight > 0 && (!weight || kg(set) > kg(weight.set) || (kg(set) === kg(weight.set) && set.reps > weight.set.reps))) weight = hit;
      if (load(set) > 0 && (!estimate || load(set) * (30 + set.reps) > load(estimate.set) * (30 + estimate.set.reps))) estimate = { ...hit, value };
      const key = `${set.weight} ${set.unit}`;
      if (set.reps > (atWeight.get(key)?.set.reps ?? 0)) atWeight.set(key, hit);
    }
  return { weight, estimate, reps: [...atWeight.values()].sort((a, b) => kg(b.set) - kg(a.set)) };
};

export const holds = <S extends { type: SetType; completed: boolean; weight: number; unit?: WeightUnit; duration?: number | null }>(sessions: { workoutId: string; date: string; sets: S[] }[]) => {
  let longest: Hit<S> | null = null;
  const atWeight = new Map<string, Hit<S>>();
  for (const { workoutId, date, sets } of [...sessions].reverse())
    for (const set of sets) {
      if (!isWorkingSet(set) || !set.duration) continue;
      const hit = { set, workoutId, date };
      if (set.duration > (longest?.set.duration ?? 0)) longest = hit;
      const key = set.weight ? `${set.weight} ${set.unit}` : 'bodyweight';
      if (set.duration > (atWeight.get(key)?.set.duration ?? 0)) atWeight.set(key, hit);
    }
  return { longest, holds: [...atWeight.values()].sort((a, b) => kg(b.set) - kg(a.set)) };
};

type Scored = { id: string; type: SetType; completed: boolean; weight: number; unit?: WeightUnit; reps: number; bodyWeight?: number; duration?: number | null };
const scores: Partial<Record<Mode, ((s: Scored) => number)[]>> = {
  reps: [(s) => (s.reps > 0 && s.weight > 0 ? kg(s) : 0), (s) => (s.reps > 0 ? load(s) * (30 + s.reps) : 0)],
  duration: [(s) => s.duration ?? 0],
};

export const personalBests = (mode: Mode, earlier: Scored[], sets: Scored[]) => {
  const metrics = scores[mode] ?? [];
  const best = metrics.map((score) => earlier.filter(isWorkingSet).reduce((max, s) => Math.max(max, score(s)), 0));
  const tried = best.map((b) => b > 0);
  return sets.filter(isWorkingSet).flatMap((s) => {
    const beaten = metrics.map((score, i) => {
      const value = score(s);
      const beat = tried[i] && value > best[i];
      best[i] = Math.max(best[i], value);
      return beat;
    });
    return beaten.includes(true) ? [s.id] : [];
  });
};

export const isDate = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(d.getTime()) && d.toISOString().startsWith(date);
};

const formats = new Map<string, Intl.DateTimeFormat>();
export const wallTime = (t: number, timeZone: string) => {
  if (!formats.has(timeZone))
    formats.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const format = formats.get(timeZone)!;
  const p = Object.fromEntries(format.formatToParts(t).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

export const localDate = (now: Date, timeZone: string) => wallTime(now.getTime(), timeZone).slice(0, 10);

export const zoned = (wall: string, timeZone: string) => {
  const offset = (t: number) => Date.parse(`${wallTime(t, timeZone)}Z`) - t;
  const guess = Date.parse(`${wall}Z`);
  return new Date(guess - offset(guess - offset(guess))).toISOString();
};

export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export type Phase = { label: string; seconds: number };

export const intervalPhases = (s: { duration?: number | null; recovery?: number | null; rounds?: number | null }): Phase[] =>
  Array.from({ length: s.rounds ?? 0 }, () => [{ label: 'Work', seconds: s.duration ?? 0 }, { label: 'Recover', seconds: s.recovery ?? 0 }])
    .flat()
    .slice(0, -1)
    .filter((p) => p.seconds > 0);

export const phaseAt = (phases: Phase[], elapsed: number) => {
  let end = 0;
  for (const [index, phase] of phases.entries()) {
    end += phase.seconds;
    if (elapsed < end || index === phases.length - 1) return { index, ...phase, remaining: end - elapsed };
  }
};

export const livePhase = (phases: Phase[], startedAt: number, now: number) => {
  const phase = phaseAt(phases, (now - startedAt) / 1000);
  if (!phase || phase.remaining <= 0) return null;
  const end = now + phase.remaining * 1000;
  return { title: phases.length > 1 ? `${phase.label} · ${phase.index + 1}/${phases.length}` : phase.label, start: end - phase.seconds * 1000, end };
};

export const phaseEnds = (phases: Phase[], elapsed: number) => {
  let end = 0;
  let ended = 0;
  let at = -Infinity;
  for (const { seconds } of phases) {
    end += seconds;
    if (end > elapsed) break;
    ended += 1;
    at = end;
  }
  return { ended, since: elapsed - at };
};

const maxSeconds = 99 * 3600 + 59 * 60 + 59;
export const timeDigits = (seconds: number | null | undefined) => {
  if (!seconds) return '';
  const s = Math.min(seconds, maxSeconds);
  return String(Math.floor(s / 3600) * 10000 + Math.floor((s % 3600) / 60) * 100 + (s % 60));
};

export const digitSeconds = (digits: string) => {
  if (digits === '') return undefined;
  const n = Number(digits);
  return Math.min(Math.floor(n / 10000) * 3600 + (Math.floor(n / 100) % 100) * 60 + (n % 100), maxSeconds);
};

export const digitClock = (digits: string) => digits.padStart(6, '0').replace(/(..)(..)(..)/, '$1:$2:$3');

export const digitTime = (digits: string) => digits.padStart(4, '0').replace(/(..)(..)/, '$1:$2');

export const isTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

export const localAt = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
};

export type Repeat = { every: 'daily' | 'weekly' | 'fortnightly' | 'monthly'; weekday: string; day: number; from: string };

const weekdayOf = (date: string) => weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];

export const onOrAfter = (date: string, weekday: string) => addDays(date, (weekdays.indexOf(weekday) - weekdays.indexOf(weekdayOf(date)) + 7) % 7);

const repeats = (r: Repeat, date: string) => {
  if (r.every === 'daily') return true;
  if (r.every === 'weekly') return weekdayOf(date) === r.weekday;
  if (r.every === 'fortnightly') return date >= r.from && (Date.parse(date) - Date.parse(r.from)) % (14 * 864e5) === 0;
  const [y, m, d] = date.split('-').map(Number);
  return d === Math.min(r.day, new Date(Date.UTC(y, m, 0)).getUTCDate());
};

export const repeatDates = (r: Repeat, from: string, count: number) => {
  const dates: string[] = [];
  for (let i = 0, date = from; i < 500 && dates.length < count; i++, date = addDays(date, 1)) if (repeats(r, date)) dates.push(date);
  return dates;
};

export const to12 = (time: string) => {
  const [h, m] = time.split(':');
  return { text: `${Number(h) % 12 || 12}:${m}`, pm: Number(h) >= 12 };
};

export const from12 = (time: string, pm: boolean) => {
  const [h, m] = time.split(':').map(Number);
  return h >= 1 && h <= 12 && m < 60 ? `${String((h % 12) + (pm ? 12 : 0)).padStart(2, '0')}:${String(m).padStart(2, '0')}` : undefined;
};
