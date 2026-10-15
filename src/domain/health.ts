import { transaction, type Db } from '../data/db.ts';
import * as q from '../data/queries.ts';
import { bodyWeights } from './measurements.ts';
import { kg, localDate } from './rules.ts';

export const healthKinds = ['workout', 'weight'] as const;
export type HealthKind = (typeof healthKinds)[number];
export type HealthRecord = { kind: 'workout'; id: string; title: string; start: string; end: string } | { kind: 'weight'; id: string; date: string; kg: number };
export type HealthRef = { id: string; kind: HealthKind };

// A workout moved to another date keeps its clock times on the new date.
const workoutRecords = (db: Db): HealthRecord[] =>
  q.finishedWorkouts(db).flatMap((w) => {
    const started = Date.parse(w.started_at as string);
    const shift = Date.parse(w.date as string) - Date.parse(localDate(new Date(started), w.time_zone as string));
    const start = started + shift;
    const end = Date.parse(w.finished_at as string) + shift;
    return end > start ? [{ kind: 'workout' as const, id: w.id as string, title: w.name as string, start: new Date(start).toISOString(), end: new Date(end).toISOString() }] : [];
  });

export const healthRecords = (db: Db): HealthRecord[] => [
  ...workoutRecords(db),
  ...bodyWeights(db).map((e) => ({ kind: 'weight' as const, id: e.id, date: e.date, kg: kg({ weight: e.value, unit: e.unit }) })),
];

const hash = (r: HealthRecord) => JSON.stringify(r);

export const healthChanges = (db: Db, kinds: readonly HealthKind[] = healthKinds) => {
  const written = new Map(q.healthRecords(db).map((r) => [r.id as string, r]));
  const wanted = healthRecords(db).filter((r) => kinds.includes(r.kind));
  const ids = new Set(wanted.map((r) => r.id));
  return {
    write: wanted.filter((r) => written.get(r.id)?.hash !== hash(r)),
    remove: [...written.values()].filter((r) => kinds.includes(r.kind as HealthKind) && !ids.has(r.id as string)).map((r) => ({ id: r.id as string, kind: r.kind as HealthKind })),
  };
};

export const markWritten = (db: Db, records: HealthRecord[]) => transaction(db, () => records.forEach((r) => q.writeHealthRecord(db, r.id, r.kind, hash(r))));

export const markRemoved = (db: Db, refs: HealthRef[]) => transaction(db, () => refs.forEach((r) => q.deleteHealthRecord(db, r.id)));
