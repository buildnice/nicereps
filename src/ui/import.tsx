import { router, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import * as data from '@/domain/portability';
import { applyImport, discardImport, pickImport, previewImport } from '@/platform/data';

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
  const [busy, setBusy] = useState<{ label: string; done: number; at: 'file' | 'import' } | null>(null);
  const running = useRef(false);
  const applied = useRef(false);
  const navigation = useNavigation();
  useEffect(() => discardImport, []);
  // An unfinished import step holds a database transaction open, so the page stays until it ends.
  useEffect(() => navigation.addListener('beforeRemove', (event) => running.current && event.preventDefault()), [navigation]);
  const work = async <T,>(label: string, at: 'file' | 'import', job: (progress: (done: number) => void) => Promise<T>) => {
    running.current = true;
    setBusy({ label, done: 0, at });
    setError(null);
    try {
      return await job((done) => setBusy({ label, done, at }));
    } finally {
      running.current = false;
      setBusy(null);
      // Reminders read during a step can see rows the step later rolled back.
      remind();
    }
  };
  const [error, setError] = useState<string | null>(null);
  const button = { alignItems: 'center', borderRadius: radius.s, backgroundColor: c.raised, marginTop: space.l } as const;
  const preview = picked?.preview;
  const groups = overview
    .map(([title, tables]) => {
      const n = tables.map((t) => preview?.counts[t] ?? { new: 0, duplicates: 0, unchanged: 0 }).reduce((a, b) => ({ new: a.new + b.new, duplicates: a.duplicates + b.duplicates, unchanged: a.unchanged + b.unchanged }));
      return { title, n };
    })
    .filter(({ n }) => n.new + n.duplicates + n.unchanged);
  const latest = preview?.latest;
  const choose = async (name: string, id: string) => {
    if (!picked || running.current) return;
    const next = { ...map, [name]: id };
    setMatching(null);
    try {
      const preview = await work('Checking', 'import', (progress) => previewImport(picked.import, next, progress));
      setMap(next);
      setPicked({ ...picked, preview });
    } catch (e) {
      setError(`Could not check the file: ${(e as Error).message}`);
    }
  };
  const progress = busy && (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={busy.label} accessibilityValue={{ min: 0, max: 100, now: Math.round(busy.done * 100) }} style={{ marginTop: space.l }}>
      <Txt variant="meta" tone="muted">{busy.label}… {Math.round(busy.done * 100)}%</Txt>
      <View style={{ height: space.s, borderRadius: radius.s, backgroundColor: c.raised, marginTop: space.s, overflow: 'hidden' }}>
        <View style={{ width: `${busy.done * 100}%`, height: '100%', backgroundColor: c.accent }} />
      </View>
    </View>
  );
  return (
    <Page title="Import data">
      <Txt variant="meta" tone="muted" style={{ marginTop: space.l }}>
        Choose a nicereps export (ZIP), a filled blank template (CSV), a Strong export (its workouts CSV or measurements ZIP), a Hevy export (its workout or measurement CSV), a FitNotes backup, or a StrengthLog export (CSV). Nothing is written until you tap Import.
      </Txt>
      <Tap
        disabled={!!busy}
        onPress={async () => {
          if (running.current) return;
          try {
            const file = await work('Reading', 'file', pickImport);
            if (file) {
              const preview = await work('Checking', 'file', (progress) => previewImport(file.import, {}, progress));
              setPicked({ ...file, preview });
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
        }}
        style={button}
      >
        <Txt variant="label" tone={busy ? 'muted' : 'text'}>{picked ? 'Choose another file' : 'Choose file'}</Txt>
      </Tap>
      {busy?.at === 'file' && progress}
      {error && <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>{error}</Txt>}
      {picked && preview && (
        <View pointerEvents={busy ? 'none' : 'auto'}>
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
                <Section title="Exercises" aside={preview.unmatched.length ? `${preview.unmatched.length} skipped` : undefined}>
                  <Txt variant="meta" tone="muted">Names without a nicereps exercise are skipped with their sets. Tap a name to change it. Your matches are remembered for the next import.</Txt>
                  {preview.exercises.map((e) => (
                    <View key={e.name}>
                      <Row
                        title={e.name}
                        meta={e.id === 'new' ? 'New custom exercise' : e.exercise ? `${e.exercise}${e.saved ? ' · remembered' : ''}` : e.id === 'skip' ? 'Skipped' : 'No match · skipped'}
                        expanded={matching === e.name}
                        onPress={() => setMatching(matching === e.name ? null : e.name)}
                      />
                      {matching === e.name && (
                        <>
                          <Tap onPress={() => choose(e.name, 'new')} style={[button, { padding: space.m }]}>
                            <Txt variant="label">Create {e.name} as a custom exercise</Txt>
                          </Tap>
                          {e.id !== 'skip' && (
                            <Tap onPress={() => choose(e.name, 'skip')} style={[button, { padding: space.m }]}>
                              <Txt variant="label">Skip {e.name}</Txt>
                            </Tap>
                          )}
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
              {busy?.at === 'import' ? (
                progress
              ) : (
                <Tap
                  disabled={!!busy}
                  onPress={async () => {
                    if (applied.current || running.current) return;
                    try {
                      await work('Importing', 'import', (progress) => applyImport(picked.import, action, overrides, map, progress));
                    } catch (e) {
                      return setError((e as Error).message);
                    }
                    applied.current = true;
                    router.dismissTo('/');
                    reset();
                  }}
                  style={[button, { backgroundColor: c.accent }]}
                >
                  <Txt variant="label" tone="onAccent">Import</Txt>
                </Tap>
              )}
            </>
          )}
        </View>
      )}
    </Page>
  );
}
