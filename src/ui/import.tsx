import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import * as data from '@/domain/portability';
import { applyImport, discardImport, pickImport } from '@/platform/data';
import { db } from '@/platform/db';

import { dayLabel, parseDate, Row, Section } from './home';
import { Page } from './measurements';
import { remind } from './plan';
import { Choice, radius, space, Tap, Txt, useColors, usePrototype } from './theme';
import { ExercisePicker } from './workout';

const actions: [data.Action, string][] = [['skip', 'Skip'], ['update', 'Update'], ['replace', 'Replace']];

const overview: [string, string[]][] = [
  ['Workouts', ['workout']],
  ['Templates', ['template']],
  ['Measurements', ['measurement', 'measurement_series']],
  ['Photos', ['photo']],
  ['Exercises, plan and settings', ['exercise', 'exercise_muscle', 'starred_record', 'schedule', 'schedule_change', 'setting']],
];
const names: Record<string, string> = {
  setting: 'Settings',
  exercise: 'Exercises',
  exercise_muscle: 'Exercise muscles',
  template: 'Templates',
  template_exercise: 'Template exercises',
  template_set: 'Template sets',
  workout: 'Workouts',
  workout_exercise: 'Workout exercises',
  workout_exercise_muscle: 'Workout muscles',
  workout_set: 'Sets',
  schedule: 'Weekly plan',
  schedule_change: 'Day changes',
  measurement_series: 'Measurement series',
  measurement: 'Measurements',
  photo: 'Photos',
  starred_record: 'Starred PRs',
};

export function Import() {
  const c = useColors();
  const { reset } = usePrototype();
  const [picked, setPicked] = useState<{ import: data.Import; preview: data.Preview } | null>(null);
  const [action, setAction] = useState<data.Action>('skip');
  const [overrides, setOverrides] = useState<Record<string, data.Action>>({});
  const [map, setMap] = useState<Record<string, string>>({});
  const [matching, setMatching] = useState<string | null>(null);
  const [shown, setShown] = useState(20);
  const [busy, setBusy] = useState(false);
  const applied = useRef(false);
  useEffect(() => discardImport, []);
  const [error, setError] = useState<string | null>(null);
  const button = { alignItems: 'center', borderRadius: radius.s, backgroundColor: c.raised, marginTop: space.l } as const;
  const preview = picked?.preview;
  const groups = overview
    .map(([title, tables]) => {
      const n = tables.map((t) => preview?.counts[t] ?? { new: 0, duplicates: 0, unchanged: 0 }).reduce((a, b) => ({ new: a.new + b.new, duplicates: a.duplicates + b.duplicates, unchanged: a.unchanged + b.unchanged }));
      return { title, n };
    })
    .filter(({ n }) => n.new + n.duplicates + n.unchanged);
  const latest = picked && data.importHighlights(picked.import);
  const choose = (name: string, id: string) => {
    if (!picked) return;
    const next = { ...map, [name]: id };
    setMap(next);
    setMatching(null);
    setPicked({ ...picked, preview: data.previewImport(db, picked.import, 'skip', {}, next) });
  };
  return (
    <Page title="Import data">
      <Txt variant="meta" tone="muted" style={{ marginTop: space.l }}>
        Choose a nicereps export (ZIP), a filled blank template (CSV), a Strong export (its workouts CSV or measurements ZIP), a Hevy export (its workout or measurement CSV), a FitNotes backup, or a StrengthLog export (CSV). Nothing is written until you tap Import.
      </Txt>
      <Tap
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            const file = await pickImport();
            if (file) {
              setPicked({ ...file, preview: data.previewImport(db, file.import) });
              setAction('skip');
              setOverrides({});
              setMap({});
              setMatching(null);
              setShown(20);
            }
          } catch (e) {
            setPicked(null);
            setError(`Could not read the file: ${(e as Error).message}`);
          }
          setBusy(false);
        }}
        style={button}
      >
        <Txt variant="label">{busy ? 'Reading…' : picked ? 'Choose another file' : 'Choose file'}</Txt>
      </Tap>
      {error && <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>{error}</Txt>}
      {picked && preview && (
        <>
          <Section title="Selected file">
            {!groups.length && !preview.errors.length && <Txt variant="meta" tone="muted">No records found.</Txt>}
            {groups.map(({ title, n }) => (
              <Row key={title} title={title} meta={[n.new && `${n.new} new`, n.duplicates && `${n.duplicates} changed`].filter(Boolean).join(' · ') || 'no changes'} />
            ))}
            {!preview.errors.length && latest?.workout && <Row title="Most recent workout" meta={`${latest.workout.name} on ${dayLabel(parseDate(latest.workout.date))}`} />}
            {!preview.errors.length && latest?.measured && <Row title="Last measurements" meta={dayLabel(parseDate(latest.measured))} />}
            {picked.import.skipped?.map((note) => <Row key={note} title="Skipped" meta={note} />)}
            {picked.import.notes?.map((note) => <Row key={note} title="Note" meta={note} />)}
          </Section>
          {preview.errors.length > 0 && (
            <Section title={`${preview.errors.length} error${preview.errors.length === 1 ? '' : 's'}`}>
              <Txt variant="meta" tone="muted" accessibilityLiveRegion="polite">Fix the file and choose it again. Nothing was imported.</Txt>
              {preview.errors.slice(0, 20).map((e) => (
                <Txt key={e} variant="meta" style={{ marginTop: space.s }}>{e}</Txt>
              ))}
              {preview.errors.length > 20 && <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>and {preview.errors.length - 20} more</Txt>}
            </Section>
          )}
          {!preview.errors.length && (
            <>
              {preview.exercises.length > 0 && (
                <Section title="Exercises" aside={preview.unmatched.length ? `${preview.unmatched.length} to match` : undefined}>
                  <Txt variant="meta" tone="muted">Each name from the file needs a nicereps exercise. Tap a name to change it. Your choices are remembered for the next import.</Txt>
                  {preview.exercises.map((e) => (
                    <View key={e.name}>
                      <Row
                        title={e.name}
                        meta={e.id === 'new' ? 'New custom exercise' : e.exercise ? `${e.exercise}${e.saved ? ' · remembered' : ''}` : 'Not matched'}
                        expanded={matching === e.name}
                        onPress={() => setMatching(matching === e.name ? null : e.name)}
                      />
                      {matching === e.name && (
                        <>
                          <Tap onPress={() => choose(e.name, 'new')} style={[button, { padding: space.m }]}>
                            <Txt variant="label">Create {e.name} as a custom exercise</Txt>
                          </Tap>
                          <ExercisePicker exclude={[]} create={false} onPick={(id) => choose(e.name, id)} />
                        </>
                      )}
                    </View>
                  ))}
                </Section>
              )}
              {preview.duplicates.length > 0 && (
                <Section title={`${preview.duplicates.length} changed duplicate${preview.duplicates.length === 1 ? '' : 's'}`}>
                  <Txt variant="meta" tone="muted">
                    These records already exist here with different values. Skip keeps yours, Update fills in the imported values, Replace uses the imported record as it is.
                  </Txt>
                  <Choice title="All duplicates" value={action} options={actions} onChange={setAction} />
                  {preview.duplicates.slice(0, shown).map((d) => (
                    <Choice
                      key={d.key}
                      title={`${names[d.table] ?? d.table} · ${d.label}`}
                      value={overrides[d.key] ?? action}
                      options={actions}
                      onChange={(v) => setOverrides({ ...overrides, [d.key]: v })}
                    />
                  ))}
                  {preview.duplicates.length > shown && (
                    <Tap onPress={() => setShown(shown + 50)} style={button}>
                      <Txt variant="label" tone="muted">Show {Math.min(50, preview.duplicates.length - shown)} more</Txt>
                    </Tap>
                  )}
                </Section>
              )}
              {preview.unmatched.length > 0 && (
                <Txt variant="meta" tone="muted" style={{ marginTop: space.l }}>
                  Match every exercise to import.
                </Txt>
              )}
              <Tap
                disabled={busy || preview.unmatched.length > 0}
                onPress={() => {
                  if (applied.current) return;
                  try {
                    applyImport(picked.import, action, overrides, map);
                  } catch (e) {
                    return setError((e as Error).message);
                  }
                  applied.current = true;
                  remind();
                  router.dismissTo('/');
                  reset();
                }}
                style={[button, { backgroundColor: preview.unmatched.length ? c.raised : c.accent }]}
              >
                <Txt variant="label" tone={preview.unmatched.length ? 'muted' : 'onAccent'}>Import</Txt>
              </Tap>
            </>
          )}
        </>
      )}
    </Page>
  );
}
