import { transaction, type Db } from '../data/db.ts';
import * as q from '../data/queries.ts';
import { add, bodyWeights } from './measurements.ts';
import { convert, kg, localDate, wallTime, zoned } from './rules.ts';
import { weightUnit } from './workouts.ts';

const healthKinds = ['workout', 'weight'] as const;
export type HealthKind = (typeof healthKinds)[number];
export type HealthRecord = { kind: 'workout'; id: string; title: string; start: string; end: string } | { kind: 'weight'; id: string; date: string; kg: number };
export type HealthRef = { id: string; kind: HealthKind };
// A body-weight sample another app put in the health store.
export type HealthWeight = { id: string; at: string; kg: number };

// A workout moved to another date keeps its wall-clock times on the new date; an unreadable time zone leaves it unmoved.
const moved = (at: number, date: string, timeZone: string) => {
  try {
    return Date.parse(zoned(`${date}${wallTime(at, timeZone).slice(10)}`, timeZone)) + (at % 1000);
  } catch {
    return at;
  }
};

const workoutRecords = (db: Db): HealthRecord[] =>
  q.finishedWorkouts(db).flatMap((w) => {
    const started = Date.parse(w.started_at as string);
    const start = moved(started, w.date as string, w.time_zone as string);
    const end = start + Date.parse(w.finished_at as string) - started;
    return end > start ? [{ kind: 'workout' as const, id: w.id as string, title: w.name as string, start: new Date(start).toISOString(), end: new Date(end).toISOString() }] : [];
  });

// Entries read from the store are never written back to it.
const readEntries = (db: Db) => new Set(q.healthRecords(db).filter((r) => r.kind === 'read').map((r) => r.hash as string));

const healthRecords = (db: Db): HealthRecord[] => {
  const read = readEntries(db);
  return [
    ...workoutRecords(db),
    ...bodyWeights(db).filter((e) => !read.has(e.id)).map((e) => ({ kind: 'weight' as const, id: e.id, date: e.date, kg: kg({ weight: e.value, unit: e.unit }) })),
  ];
};

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

// Turning writing off forgets what was written; erase also forgets what was read.
export const forgetHealth = (db: Db, read = false) => q.forgetHealthRecords(db, read);

// Each sample is considered once, so deleting an entry read from the store does not bring it back.
// The earliest sample of a date is kept, and a date that already has a body weight keeps it.
// An entry equal to a sample, such as one read before an export and import, counts as read so it is not written back.
export const readWeights = (db: Db, samples: HealthWeight[], timeZone: string) =>
  transaction(db, () => {
    const seen = new Set(q.healthRecords(db).filter((r) => r.kind === 'read').map((r) => r.id as string));
    const dates = new Map(bodyWeights(db).map((e) => [e.date, e]));
    const unit = weightUnit(db);
    let added = 0;
    for (const s of [...samples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const date = localDate(new Date(s.at), timeZone);
      const value = Math.round(convert(s.kg, 'kg', unit) * 10) / 10;
      const existing = dates.get(date);
      let entry = existing && Math.abs(kg({ weight: existing.value, unit: existing.unit }) - s.kg) < 0.05 ? existing.id : '';
      if (!existing && value > 0) {
        entry = add(db, { preset: 'body-weight' }, value, date).id;
        dates.set(date, { id: entry, date, value, unit });
        added++;
      }
      q.writeHealthRecord(db, s.id, 'read', entry);
    }
    return added;
  });

export const markRemoved = (db: Db, refs: HealthRef[]) => transaction(db, () => refs.forEach((r) => q.deleteHealthRecord(db, r.id)));
