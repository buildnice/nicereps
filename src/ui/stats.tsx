import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Mode } from '@/data/queries';
import { convert, isWorkingSet, kg, volume, wholeIn } from '@/domain/rules';
import * as measures from '@/domain/measurements';
import * as ops from '@/domain/workouts';
import { db } from '@/platform/db';

import { dayLabel, parseDate, Row, Section } from './home';
import { Page, Trend } from './measurements';
import { today } from './plan';
import { clock, describeSet, inUnit, radius, space, Tap, Txt, useColors, usePrototype, type Units } from './theme';
import { Chip, ExerciseNote, setLabel } from './workout';

type Range = keyof typeof ops.volumeRanges;
const rangeNames: Record<Range, string> = { week: 'Past week', month: 'Past month', all: 'All time' };

export const volumeLabel = (kg: number, unit: 'kg' | 'lb') => `${wholeIn(kg, unit).toLocaleString('en')} ${unit}`;

type Pr = ReturnType<typeof ops.personalRecords>[number];

export const recordLabel = (r: Pr, units: Units) => {
  const weight = inUnit({ ...r.set, weight: r.value }, units).weight;
  const value =
    r.kind === 'weight'
      ? `Weight ${weight} ${units.weight} × ${r.set.reps}`
      : r.kind === 'e1rm'
        ? `e1RM ${weight.toFixed(1)} ${units.weight}${r.set.bodyWeight ? ' with body weight' : ''}`
        : `Hold ${clock(r.value)}`;
  if (!r.change) return `${value} · 1 workout`;
  const date = parseDate(r.change.since);
  const since = date.toLocaleDateString('en', { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  const gain = r.kind === 'hold' ? r.change.gain : Number(convert(r.change.gain, 'kg', units.weight).toFixed(1));
  if (gain <= 0) return `${value} · no change since ${since}`;
  return `${value} · +${r.kind === 'hold' ? clock(gain) : `${gain} ${units.weight}`} since ${since}`;
};

const kindNames: Record<ops.RecordKind, string> = { weight: 'Weight', e1rm: 'e1RM', hold: 'Hold' };

export function RecordTrend({ record: r, compact }: { record: Pr; compact?: boolean }) {
  const { units } = usePrototype();
  const value = (v: number) => (r.kind === 'hold' ? v : Number(convert(v, 'kg', units.weight).toFixed(1)));
  return <Trend compact={compact} series={{ name: `${r.name} ${kindNames[r.kind]}`, entries: r.trend.map((t) => ({ date: t.date, value: value(t.value) })) }} unit={r.kind === 'hold' ? 's' : units.weight} />;
}

function Volume() {
  const { units } = usePrototype();
  const [range, setRange] = useState<Range>('week');
  return (
    <Section title="Volume">
      <View accessibilityRole="radiogroup" accessibilityLabel="Volume range" style={styles.chips}>
        {(Object.keys(rangeNames) as Range[]).map((r) => (
          <Chip key={r} label={rangeNames[r]} selected={range === r} onPress={() => setRange(r)} />
        ))}
      </View>
      <Txt variant="display" style={{ marginTop: space.m }}>{volumeLabel(ops.totalVolume(db, today(), range), units.weight)}</Txt>
      <Txt variant="small" tone="muted" style={{ marginTop: space.s }}>
        Weight × reps of completed normal and drop sets in finished workouts, adding your body weight on bodyweight lifts. Warm-ups excluded.
        {measures.bodyWeight(db, today()) == null && ' Log your body weight to count it.'}
      </Txt>
    </Section>
  );
}

export function Stats() {
  const { units } = usePrototype();
  const read = () => ops.lifts(db).map((lift) => ({ ...lift, ...ops.progress(db, lift.name) }));
  const [lifts, setLifts] = useState(read);
  const [prs, setPrs] = useState(() => ops.personalRecords(db));
  useFocusEffect(useCallback(() => (setLifts(read()), setPrs(ops.personalRecords(db))), []));

  return (
    <Page title="Stats">
      <Volume />
      <Section title="PRs" aside={prs.length ? `${prs.length}` : undefined}>
        {!prs.length && <Txt variant="meta" tone="muted">{"Each lift's best weight, e1RM and hold appear here once you finish a workout."}</Txt>}
        {prs.map((r) => (
          <Row
            key={`${r.exerciseId} ${r.kind}`}
            title={r.name}
            meta={recordLabel(r, units)}
            starred={r.starred}
            onPress={() => {
              ops.starRecord(db, r.exerciseId, r.kind, !r.starred);
              setPrs(ops.personalRecords(db));
            }}
          />
        ))}
      </Section>
      <Section title="Lifts" aside={lifts.length ? `${lifts.length}` : undefined}>
        {!lifts.length && <Txt variant="meta" tone="muted">Finish a workout with a completed working set and its records show here.</Txt>}
        {lifts.map((l) => (
          <Row
            key={l.name}
            title={l.name}
            meta={
              l.estimate
                ? `Best e1RM ${inUnit({ ...l.estimate.set, weight: l.estimate.value }, units).weight.toFixed(1)} ${units.weight}${l.estimate.set.bodyWeight ? ' with body weight' : ''}`
                : l.longest
                  ? `Longest hold ${clock(l.longest.set.duration ?? 0)}`
                  : 'Bodyweight'
            }
            onPress={() => router.push({ pathname: '/lift/[id]', params: { id: l.id } })}
          />
        ))}
      </Section>
    </Page>
  );
}

export function VolumeDetail() {
  const { units } = usePrototype();
  const [weeks, setWeeks] = useState(() => ops.weeklyVolume(db, today()));
  useFocusEffect(useCallback(() => setWeeks(ops.weeklyVolume(db, today())), []));
  return (
    <Page title="Volume">
      <Volume />
      <Section title="Weekly">
        {weeks.length > 1 ? (
          <Trend series={{ name: 'Weekly volume', entries: weeks.map((w) => ({ date: w.date, value: wholeIn(w.value, units.weight) })) }} unit={units.weight} />
        ) : (
          <Txt variant="meta" tone="muted">Train across two weeks to see your weekly volume over time.</Txt>
        )}
        <Txt variant="small" tone="muted" style={{ marginTop: space.s }}>Each point totals the 7 days ending on its date; the last is the past week.</Txt>
      </Section>
    </Page>
  );
}

const readLift = (id: string) => {
  let lift;
  try {
    lift = { id, ...ops.exerciseDraft(db, id) };
  } catch {
    return undefined;
  }
  return { lift, p: ops.progress(db, lift.name), prs: ops.personalRecords(db).filter((r) => r.exerciseId === id).sort((a, b) => ops.recordKinds.indexOf(a.kind) - ops.recordKinds.indexOf(b.kind)) };
};

type Session = ReturnType<typeof ops.progress>['sessions'][number];

const dated = (date: string) => dayLabel(parseDate(date));

function SessionCard({ session: x, mode, current, from }: { session: Session; mode: Mode; current: boolean; from: string }) {
  const c = useColors();
  const { units } = usePrototype();
  const done = x.sets.filter((s) => s.completed);
  const working = done.filter(isWorkingSet);
  const reps = working.reduce((n, s) => n + s.reps, 0);
  const average = reps && convert(working.reduce((n, s) => n + kg(s) * s.reps, 0) / reps, 'kg', units.weight);
  return (
    <View style={[styles.card, { backgroundColor: c.surface }]}>
      <Row title={`${dated(x.date)}${current ? ' · this workout' : ''}`} meta={x.name} onPress={() => router.push({ pathname: '/workout/[id]', params: { id: x.workoutId, from } })} />
      {done.map((s, i) => {
        const set = mode === 'reps' ? `${inUnit(s, units).weight} ${units.weight} × ${s.reps}` : describeSet(s, mode, units);
        const label = setLabel(done, i);
        return (
          <View key={s.id} accessible accessibilityLabel={`${label === 'W' ? 'Warm-up' : label === 'D' ? 'Drop set' : `Set ${label}`}, ${set}${s.comment ? `, ${s.comment}` : ''}`} style={[styles.set, { borderColor: c.line, opacity: s.type === 'warm-up' ? 0.5 : 1 }]}>
            <View style={{ flexDirection: 'row', gap: space.m }}>
              <Txt variant="label" tone="muted" style={{ width: 24 }}>{label}</Txt>
              <Txt variant="label">{set}</Txt>
            </View>
            {s.comment && <Txt variant="meta" tone="muted" style={{ marginLeft: 24 + space.m }}>{s.comment}</Txt>}
          </View>
        );
      })}
      {!done.length && <Txt variant="meta" tone="muted" style={{ paddingVertical: space.s }}>No completed sets</Txt>}
      {mode === 'reps' && reps > 0 && (
        <Txt variant="meta" tone="muted" style={[styles.set, { borderColor: c.line }]}>
          Volume {volumeLabel(volume(x.sets), units.weight)} · {reps} reps · Avg {average} {units.weight}
        </Txt>
      )}
    </View>
  );
}

export function LiftDetail() {
  const c = useColors();
  const { units } = usePrototype();
  const { id, workout } = useLocalSearchParams<{ id: string; workout?: string }>();
  const [state, setState] = useState(() => readLift(id));
  const [tab, setTab] = useState<'history' | 'records'>('history');
  const [by, setBy] = useState<'weight' | 'reps'>('weight');
  const [all, setAll] = useState(false);
  useFocusEffect(useCallback(() => setState(readLift(id)), [id]));
  if (!state) return <Page title="Stats"><Txt tone="muted" style={{ marginTop: space.l }}>Lift not found</Txt></Page>;
  const { lift, p, prs } = state;
  const w = (s: Session['sets'][number], weight = s.weight) => inUnit({ ...s, weight }, units).weight;
  const open = (workoutId: string) => () => router.push({ pathname: '/workout/[id]', params: { id: workoutId, from: lift.name } });
  const rows =
    lift.mode === 'duration'
      ? p.holds.map((r) => ({ hit: r, title: r.set.weight ? `${w(r.set)} ${units.weight}` : 'Bodyweight', meta: clock(r.set.duration ?? 0) }))
      : lift.mode !== 'reps'
        ? []
        : by === 'weight'
          ? p.reps.map((r) => ({ hit: r, title: `${w(r.set)} ${units.weight}`, meta: `${r.set.reps} rep${r.set.reps === 1 ? '' : 's'}` }))
          : p.weights.map((r) => ({ hit: r, title: `${r.set.reps} rep${r.set.reps === 1 ? '' : 's'}`, meta: `${w(r.set)} ${units.weight}` }));
  const max = (weight: number) => p.estimate && w(p.estimate.set, weight).toFixed(1);
  return (
    <Page title={lift.name}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Lift view" style={styles.chips}>
        <Chip label="History" selected={tab === 'history'} onPress={() => setTab('history')} />
        <Chip label="Records" selected={tab === 'records'} onPress={() => setTab('records')} />
      </View>
      {tab === 'history' ? (
        <>
          {!p.sessions.length && <Txt variant="meta" tone="muted" style={{ marginTop: space.l }}>No finished sessions yet.</Txt>}
          {(all ? p.sessions : p.sessions.slice(0, 10)).map((x) => (
            <SessionCard key={x.workoutId} session={x} mode={lift.mode} current={x.workoutId === workout} from={lift.name} />
          ))}
          {p.sessions.length > 10 && (
            <Tap onPress={() => setAll(!all)} style={[styles.more, { borderColor: c.line }]}>
              <Txt variant="label" tone="muted">{all ? 'Recent sessions' : `All ${p.sessions.length} sessions`}</Txt>
            </Tap>
          )}
        </>
      ) : (
        <>
          {(lift.mode === 'reps' || lift.mode === 'duration') && (
            <Section title={lift.mode === 'reps' ? 'Best sets' : 'Longest holds'}>
              {lift.mode === 'reps' && (
                <View accessibilityRole="radiogroup" accessibilityLabel="Best sets by" style={[styles.chips, { marginTop: 0, marginBottom: space.s }]}>
                  <Chip label="Weight" selected={by === 'weight'} onPress={() => setBy('weight')} />
                  <Chip label="Reps" selected={by === 'reps'} onPress={() => setBy('reps')} />
                </View>
              )}
              {!rows.length && <Txt variant="meta" tone="muted">Finish a workout with a completed working set and its records show here.</Txt>}
              {rows.map((r) => (
                <Row key={r.hit.set.id + r.title} title={r.title} meta={`${r.meta} · ${dated(r.hit.date)}`} onPress={open(r.hit.workoutId)} />
              ))}
            </Section>
          )}
          {prs.map((r) => [r, ...recordLabel(r, units).split(' · ')] as const).map(([r, best, change]) => (
            <Section key={r.kind} title={kindNames[r.kind]}>
              <Row
                title={best}
                meta={change}
                starred={r.starred}
                onPress={() => {
                  ops.starRecord(db, r.exerciseId, r.kind, !r.starred);
                  setState(readLift(id));
                }}
              />
              {r.trend.length > 1 && <RecordTrend record={r} />}
            </Section>
          ))}
          {p.estimate && (
            <Section title="Rep maxes" aside={`${units.weight}${p.estimate.set.bodyWeight ? ' with body weight' : ''}`}>
              <View accessible accessibilityLabel={`Rep maxes from best e1RM: ${p.maxes.map((m) => `${m.reps} reps about ${max(m.weight)} ${units.weight}`).join(', ')}`} style={styles.maxes}>
                {p.maxes.map((m) => (
                  <View key={m.reps} style={{ flexGrow: 1, minWidth: 64 }}>
                    <Txt variant="caps" tone="muted">{m.reps}RM</Txt>
                    <Txt variant="label">≈ {max(m.weight)}</Txt>
                  </View>
                ))}
              </View>
              <Txt variant="small" tone="muted" style={{ marginTop: space.s }}>From best e1RM = {p.estimate.set.bodyWeight ? '(body weight + weight)' : 'weight'} × (1 + reps / 30), working sets only.</Txt>
            </Section>
          )}
          <Section title="Note"><ExerciseNote exerciseId={lift.id} name={lift.name} note={lift.note} /></Section>
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  card: { borderRadius: radius.l, padding: 18, marginTop: space.m },
  set: { paddingVertical: space.s, borderTopWidth: StyleSheet.hairlineWidth, gap: space.xs },
  more: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderWidth: 1, borderRadius: radius.pill, marginTop: space.m },
  maxes: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.xs },
});
