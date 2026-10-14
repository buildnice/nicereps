import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { convert, wholeIn } from '@/domain/rules';
import * as measures from '@/domain/measurements';
import * as ops from '@/domain/workouts';
import { db } from '@/platform/db';

import { parseDate, Row, Section } from './home';
import { Page, Trend } from './measurements';
import { today } from './plan';
import { clock, inUnit, space, Txt, usePrototype, type Units } from './theme';
import { Chip, ExerciseHistory } from './workout';

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
  const lift = ops.lifts(db).find((l) => l.id === id);
  return lift && { lift, prs: ops.personalRecords(db).filter((r) => r.exerciseId === id).sort((a, b) => ops.recordKinds.indexOf(a.kind) - ops.recordKinds.indexOf(b.kind)) };
};

export function LiftDetail() {
  const { units } = usePrototype();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [state, setState] = useState(() => readLift(id));
  useFocusEffect(useCallback(() => setState(readLift(id)), [id]));
  if (!state) return <Page title="Stats"><Txt tone="muted" style={{ marginTop: space.l }}>Lift not found</Txt></Page>;
  const { lift, prs } = state;
  return (
    <Page title={lift.name}>
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
      <Section title="History">
        <ExerciseHistory name={lift.name} mode={lift.mode} />
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
});
