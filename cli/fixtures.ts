import type { Db } from '../src/data/db.ts';
import type { Mapping, Mode, SetType } from '../src/data/queries.ts';
import { correctSet, createExercise, createTemplate, finishWorkout, getWorkout, listExercises, setDefaultMapping, startWorkout } from '../src/domain/workouts.ts';

const exercises: [string, string[], string[]][] = [
  ['Bench Press', ['chest'], ['shoulders', 'triceps']],
  ['Overhead Press', ['shoulders'], ['triceps']],
  ['Cable Fly', ['chest'], []],
  ['Barbell Row', ['back'], ['biceps']],
  ['Pull-up', ['back'], ['biceps']],
  ['Back Squat', ['quads'], ['glutes']],
  ['Romanian Deadlift', ['hamstrings'], ['back', 'glutes']],
];

const otherModes: [string, Mode, string[]][] = [
  ['Plank', 'duration', ['abdominals']],
  ['Run', 'distance', ['quads']],
  ['Bike Sprints', 'interval', ['quads']],
  ['Mobility Flow', 'check', []],
];

const templates: [string, [string, [SetType, number, number][]][]][] = [
  [
    'Push A',
    [
      ['Bench Press', [['warm-up', 40, 10], ['normal', 82.5, 8], ['normal', 82.5, 8], ['normal', 82.5, 8]]],
      ['Overhead Press', [['normal', 50, 6], ['normal', 50, 6], ['normal', 50, 6]]],
      ['Cable Fly', [['normal', 15, 12], ['drop', 10, 10]]],
    ],
  ],
  [
    'Pull B',
    [
      ['Barbell Row', [['normal', 72.5, 8], ['normal', 72.5, 8], ['normal', 72.5, 8]]],
      ['Pull-up', [['normal', 0, 8], ['normal', 0, 8], ['normal', 0, 7]]],
    ],
  ],
  [
    'Legs',
    [
      ['Back Squat', [['warm-up', 60, 8], ['normal', 102.5, 5], ['normal', 102.5, 5], ['normal', 102.5, 5]]],
      ['Romanian Deadlift', [['normal', 90, 8], ['normal', 90, 8], ['normal', 90, 8]]],
    ],
  ],
];

const fixtureTimeZone = 'Australia/Brisbane';

const workouts: [string, string, number[][]][] = [
  ['Push A', '2026-09-29T06:30:00+10:00', [[1, 1, 1, 1], [1, 1, 0], [1, 1]]],
  ['Pull B', '2026-10-01T18:00:00+10:00', [[1, 1, 1], [1, 1, 1]]],
  ['Legs', '2026-10-04T09:00:00+10:00', [[1, 1, 1, 1], [1, 1, 1]]],
  ['Push A', '2026-10-06T06:30:00+10:00', [[1, 1, 1, 1], [1, 1, 1], [1, 0]]],
];

export const seed = (db: Db) => {
  const exercise = (name: string, mapping: Mapping, mode?: Mode) => {
    const id = listExercises(db, name).find((e) => e.name === name)?.id ?? createExercise(db, name, [], { mode });
    setDefaultMapping(db, id, mapping);
    return id;
  };
  const ids = Object.fromEntries(
    exercises.map(([name, primary, secondary]) => [
      name,
      exercise(name, [...primary.map((muscle) => ({ muscle, role: 'primary' as const })), ...secondary.map((muscle) => ({ muscle, role: 'secondary' as const }))]),
    ]),
  );
  otherModes.forEach(([name, mode, primary]) => exercise(name, primary.map((muscle) => ({ muscle, role: 'primary' as const })), mode));
  const templateIds = Object.fromEntries(
    templates.map(([name, items]) => [
      name,
      createTemplate(
        db,
        name,
        items.map(([exercise, sets]) => ({ exerciseId: ids[exercise], sets: sets.map(([type, weight, reps]) => ({ type, weight, reps })) })),
      ),
    ]),
  );
  return workouts.map(([template, at, done]) => {
    const now = new Date(at);
    const id = startWorkout(db, { templateId: templateIds[template], now, timeZone: fixtureTimeZone });
    getWorkout(db, id).exercises.forEach((e, i) => e.sets.forEach((s, j) => done[i][j] && correctSet(db, s.id, { completed: true })));
    finishWorkout(db, id, new Date(now.getTime() + 60 * 60 * 1000));
    return id;
  });
};
