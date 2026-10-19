import { Canvas, Circle, Path, Skia } from '@shopify/react-native-skia';
import { router, useLocalSearchParams } from 'expo-router';
import { type RefObject, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { convert } from '@/domain/rules';
import * as ops from '@/domain/workouts';
import { shareImage } from '@/platform/data';
import { db } from '@/platform/db';

import { MuscleBreakdown, parseDate, Section } from './home';
import { Page } from './measurements';
import { Choice, clock, describeSet, inUnit, radius, space, Tap, Txt, type, useColors, usePrototype } from './theme';

type Summary = ReturnType<typeof ops.workoutSummary>;
type Exercise = Summary['exercises'][number];

const open = (id: string) => router.dismissTo({ pathname: '/', params: { open: id } });

export function WorkoutDetail() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const [w] = useState(() => {
    try {
      return ops.workoutSummary(db, id);
    } catch {
      return null;
    }
  });
  return w ? (
    <Detail w={w} from={from} />
  ) : (
    <Page title={from ?? 'Recent'} center>
      <Txt tone="muted" style={{ marginTop: space.l }}>Workout not found</Txt>
    </Page>
  );
}

export function CheckInPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const [w] = useState(() => {
    try {
      return ops.getWorkout(db, id);
    } catch {
      return null;
    }
  });
  const [rating, setRating] = useState<Rating>(() => ratingOf(w));
  const recap = () => router.replace({ pathname: '/workout/[id]', params: { id, from: 'Home' } });
  if (!w) return <WorkoutDetail />;
  return (
    <Page title="Home" center>
      <Txt variant="caps" tone="muted" style={{ marginTop: space.l }}>How did it go?</Txt>
      <Txt variant="title" accessibilityRole="header" style={{ marginTop: space.xs }}>{w.name}</Txt>
      <CheckIn id={id} rating={rating} onChange={setRating} />
      <TextInput
        defaultValue={w.note ?? ''}
        onChangeText={(t) => ops.noteWorkout(db, id, t)}
        placeholder="Workout note"
        placeholderTextColor={c.faint}
        accessibilityLabel="Workout note"
        multiline
        style={[styles.note, { backgroundColor: c.surface, color: c.text }]}
      />
      <Tap onPress={recap} style={[styles.action, { marginTop: space.xl, backgroundColor: c.accent }]}>
        <Txt variant="label" tone="onAccent">Continue</Txt>
      </Tap>
      <Tap onPress={recap} style={{ alignSelf: 'center', marginTop: space.s, paddingHorizontal: space.l }}>
        <Txt variant="label" tone="muted">Skip</Txt>
      </Tap>
    </Page>
  );
}

type Rating = Pick<Summary, ops.CheckIn>;

const ratingOf = (w: Rating | null): Rating => ({ sleep: w?.sleep ?? null, feel: w?.feel ?? null, energy: w?.energy ?? null });

function CheckIn({ id, rating, onChange }: { id: string; rating: Rating; onChange: (r: Rating) => void }) {
  return (Object.entries(ops.checkIns) as [ops.CheckIn, (typeof ops.checkIns)[ops.CheckIn]][]).map(([k, { title, low, high }]) => (
    <View key={k}>
      <Choice
        title={title}
        value={String(rating[k])}
        options={['1', '2', '3', '4', '5'].map((v) => [v, v, `${title} ${v} of 5${v === '1' ? `, ${low}` : v === '5' ? `, ${high}` : ''}`])}
        onChange={(v) => {
          const value = String(rating[k]) === v ? null : Number(v);
          ops.rateWorkout(db, id, k, value);
          onChange({ ...rating, [k]: value });
        }}
      />
      <View style={styles.scale}>
        <Txt variant="small" tone="muted">1 {low}</Txt>
        <Txt variant="small" tone="muted">5 {high}</Txt>
      </View>
    </View>
  ));
}

function Detail({ w, from }: { w: Summary; from?: string }) {
  const c = useColors();
  const [rating, setRating] = useState<Rating>(() => ratingOf(w));
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [keep, setKeep] = useState({ weight: true, reps: true });
  const [deleting, setDeleting] = useState<boolean | 'done'>(false);
  const save = () => {
    try {
      ops.templateFromWorkout(db, w.id, name!, keep);
      setMessage(`Saved template ${name!.trim()}`);
      setName(null);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const card = useRef<View>(null);
  const share = () => shareImage(card).catch((e: Error) => setMessage(e.message));
  const time = w.minutes ? ` · ${new Date(w.startedAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: w.timeZone })}` : '';
  const date = parseDate(w.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + time;

  return (
    <Page title={from ?? 'Recent'} center>
      <ShareCard ref={card} w={w} date={date} />
      <Txt variant="caps" tone="muted" style={{ marginTop: space.l }}>{date}</Txt>
      <Txt variant="title" accessibilityRole="header" style={{ marginTop: space.xs }}>{w.name}</Txt>
      {!!w.note && <Txt tone="muted" style={{ marginTop: space.s, fontWeight: '400' }}>“{w.note}”</Txt>}
      <Tap accessibilityLabel={`Check-in: ${ops.checkInLine(rating).join(', ').replaceAll('/5', ' of 5') || 'none'}`} accessibilityHint={checking ? undefined : 'Edits the check-in'} accessibilityState={{ expanded: checking }} onPress={() => setChecking(!checking)} style={{ justifyContent: 'center' }}>
        {ops.checkInLine(rating).length ? (
          <View style={styles.checkIn}>
            {(Object.keys(ops.checkIns) as ops.CheckIn[]).map((k) => (
              <View key={k} style={{ flex: 1 }}>
                <Txt variant="caps" tone="muted">{ops.checkIns[k].short}</Txt>
                <Txt variant="value" tone={rating[k] ? 'text' : 'faint'} style={{ marginTop: space.xs }}>{rating[k] ? `${rating[k]}/5` : '–'}</Txt>
              </View>
            ))}
          </View>
        ) : (
          <Txt variant="meta" tone="muted">Add check-in</Txt>
        )}
      </Tap>
      {checking && <CheckIn id={w.id} rating={rating} onChange={setRating} />}

      <Tiles w={w} />
      <MusclesWorked muscles={w.muscles} />

      {w.exercises.map((e) => <ExerciseCard key={e.id} exercise={e} />)}

      <View style={styles.actions}>
        {!ops.unfinishedWorkouts(db).length && (
          <Tap onPress={() => open(ops.startWorkout(db, { fromWorkoutId: w.id }))} style={[styles.action, { flex: 2, backgroundColor: c.accent }]}>
            <Txt variant="label" tone="onAccent">Repeat workout</Txt>
          </Tap>
        )}
        <Tap onPress={() => open(w.id)} style={[styles.action, { flex: 1, borderWidth: 1, borderColor: c.line }]}>
          <Txt variant="label">Edit</Txt>
        </Tap>
      </View>
      {name === null ? (
        <Tap onPress={() => { setName(w.name); setMessage(null); }} style={[styles.action, { marginTop: space.s, borderWidth: 1, borderColor: c.line }]}>
          <Txt variant="label">Save as template</Txt>
        </Tap>
      ) : (
        <View style={styles.entry}>
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={save}
            autoFocus
            placeholder="Template name"
            placeholderTextColor={c.faint}
            accessibilityLabel="Template name"
            style={[styles.input, { backgroundColor: c.raised, color: c.text }, type.input]}
          />
          <Tap onPress={save} style={[styles.save, { backgroundColor: c.accent }]}>
            <Txt variant="label" tone="onAccent">Save</Txt>
          </Tap>
        </View>
      )}
      {name !== null && (
        <View style={styles.entry}>
          {(['weight', 'reps'] as const).map((k) => (
            <Tap
              key={k}
              accessibilityRole="switch"
              accessibilityState={{ checked: keep[k] }}
              onPress={() => setKeep({ ...keep, [k]: !keep[k] })}
              style={[styles.toggle, { backgroundColor: keep[k] ? c.accent : c.raised }]}
            >
              <Txt variant="label" tone={keep[k] ? 'onAccent' : 'muted'}>Keep {k}</Txt>
            </Tap>
          ))}
        </View>
      )}
      <Tap onPress={share} style={[styles.action, { marginTop: space.s, borderWidth: 1, borderColor: c.line }]}>
        <Txt variant="label">Share image</Txt>
      </Tap>
      {message && <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.xs }}>{message}</Txt>}
      <Tap
        disabled={deleting === 'done'}
        onPress={() => {
          if (!deleting) return setDeleting(true);
          setDeleting('done');
          ops.deleteWorkout(db, w.id);
          router.dismissTo('/');
        }}
        style={{ alignSelf: 'center', marginTop: space.xl, paddingHorizontal: space.l }}
      >
        <Txt variant="label" tone="muted">{deleting ? 'Tap again to delete workout' : 'Delete workout'}</Txt>
      </Tap>
      <View style={{ height: space.xxl }} />
    </Page>
  );
}

function ShareCard({ ref, w, date }: { ref: RefObject<View | null>; w: Summary; date: string }) {
  const c = useColors();
  const { units } = usePrototype();
  const records = w.exercises.filter((e) => e.records.length);
  return (
    <View ref={ref} collapsable={false} style={[styles.share, { backgroundColor: c.bg }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Txt variant="caps" tone="muted">{date}</Txt>
      <Txt variant="title" style={{ marginTop: space.xs }}>{w.name}</Txt>
      <Tiles w={w} />
      {records.map((e) => (
        <View key={e.id} style={[styles.card, { backgroundColor: c.surface }]}>
          <Txt variant="heading">{e.name}</Txt>
          <View style={styles.chips}>
            {e.sets.filter((s) => e.records.includes(s.id)).map((s) => (
              <View key={s.id} style={[styles.chip, { backgroundColor: c.accent, borderColor: c.accent }]}>
                <Txt variant="label" tone="onAccent">◆ {describeSet(s, e.mode, units)}</Txt>
              </View>
            ))}
          </View>
        </View>
      ))}
      <Txt variant="brand" style={{ marginTop: space.l }}>
        nice<Txt variant="brand" tone="muted">reps</Txt>
      </Txt>
    </View>
  );
}

export function Tiles({ w }: { w: Pick<Summary, 'minutes' | 'sets' | 'volume' | 'records'> }) {
  const { units } = usePrototype();
  const volume = convert(w.volume, 'kg', units.weight);
  const [amount, unit] = units.weight === 'kg' && volume >= 1000 ? [(volume / 1000).toFixed(1), 't'] : [Math.round(volume).toLocaleString('en'), units.weight];
  return (
    <View style={styles.tiles}>
      {w.minutes > 0 && <Tile label="Duration" value={String(w.minutes)} unit="min" />}
      <Tile label="Working sets" value={String(w.sets)} />
      <Tile label="Volume" value={amount} unit={unit} />
      <Tile label="Records" value={w.records ? `${w.records} ◆` : '0'} inverted={w.records > 0} spoken={String(w.records)} />
    </View>
  );
}

export function MusclesWorked({ muscles: all }: { muscles: Summary['muscles'] }) {
  const c = useColors();
  const muscles = all.slice(0, 6);
  const top = muscles[0]?.sets ?? 0;
  const [open, setOpen] = useState<string | null>(null);
  const shown = muscles.find((m) => m.muscle === open);
  if (!muscles.length) return null;
  return (
    <View style={[styles.card, { backgroundColor: c.surface }]}>
      <Txt variant="caps" tone="muted">Muscles worked</Txt>
      <View style={styles.bars}>
        {muscles.map((m, i) => (
          <Tap
            key={m.muscle}
            onPress={() => setOpen(open === m.muscle ? null : m.muscle)}
            accessibilityState={{ expanded: open === m.muscle }}
            accessibilityLabel={`${m.muscle}, ${m.sets} set${m.sets === 1 ? '' : 's'}`}
            style={styles.barColumn}
          >
            <Txt variant="label">{m.sets}</Txt>
            <View style={[styles.bar, { height: Math.max(6, (m.sets / top) * 96), backgroundColor: c.heat[Math.max(1, 4 - i)] }]} />
          </Tap>
        ))}
      </View>
      <View style={styles.barLabels}>
        {muscles.map((m) => (
          <Txt key={m.muscle} variant="small" tone={open === m.muscle ? 'text' : 'muted'} numberOfLines={2} android_hyphenationFrequency="normal" style={styles.barLabel} importantForAccessibility="no">
            {m.muscle[0].toUpperCase() + m.muscle.slice(1)}
          </Txt>
        ))}
      </View>
      {shown && <MuscleBreakdown key={shown.muscle} muscle={shown} />}
      <Txt variant="small" tone="muted" style={{ marginTop: space.m }}>Completed normal and drop sets. Primary muscle 1, secondary 0.5. Warm-ups excluded.</Txt>
    </View>
  );
}

function Tile({ label, value, unit, inverted, spoken = value }: { label: string; value: string; unit?: string; inverted?: boolean; spoken?: string }) {
  const c = useColors();
  const tone = inverted ? 'onAccent' : 'text';
  return (
    <View style={[styles.tile, { backgroundColor: inverted ? c.accent : c.surface }]} accessible accessibilityLabel={`${label}, ${spoken}${unit ? ` ${unit}` : ''}`}>
      <Txt variant="meta" tone={inverted ? 'onAccent' : 'muted'}>{label}</Txt>
      <Txt variant="title" tone={tone} style={{ marginTop: space.s }}>
        {value}
        {unit && <Txt variant="value" tone={tone}>{unit}</Txt>}
      </Txt>
    </View>
  );
}

function ExerciseCard({ exercise: e }: { exercise: Exercise }) {
  const c = useColors();
  const { units } = usePrototype();
  const done = e.sets.filter((s) => s.completed);
  const working = done.filter((s) => s.type !== 'warm-up').length;
  const t = e.top && inUnit(e.top, units);
  const estimate = e.top && e.estimate && `${inUnit({ ...e.top, weight: e.estimate }, units).weight.toFixed(1)} ${units.weight}${e.top.bodyWeight ? ' with body weight' : ''}`;
  return (
    <Section
      title={e.name}
      action={
        e.records.length ? (
          <View style={[styles.pill, { backgroundColor: c.accent }]}>
            <Txt variant="caps" tone="onAccent">◆ Record</Txt>
          </View>
        ) : (
          <Txt variant="meta" tone="muted">{working} set{working === 1 ? '' : 's'}</Txt>
        )
      }
    >
      {t && (
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            {e.mode === 'reps' ? (
              <Txt variant="title">{t.weight}<Txt variant="value">{` × ${t.reps}`}</Txt></Txt>
            ) : (
              <Txt variant="title">{clock(t.duration ?? 0)}{t.weight > 0 && <Txt variant="value">{` @ ${t.weight} ${units.weight}`}</Txt>}</Txt>
            )}
            <Txt variant="meta" tone="muted">{e.mode === 'reps' ? `top set${estimate ? ` · e1RM ${estimate}` : ''}` : 'longest hold'}</Txt>
          </View>
          {e.trend.length > 1 && <Sparkline values={e.trend.map((p) => p.value)} label={e.mode === 'reps' ? 'e1RM' : 'longest hold'} />}
        </View>
      )}
      <View style={[styles.chips, !t && { marginTop: 0 }]}>
        {done.map((s) => {
          const record = e.records.includes(s.id);
          return (
            <View key={s.id} accessible accessibilityLabel={`${record ? 'Record, ' : s.type === 'warm-up' ? 'Warm-up, ' : ''}${describeSet(s, e.mode, units)}`} style={[styles.chip, { borderColor: c.line, opacity: s.type === 'warm-up' ? 0.5 : 1 }, record && { backgroundColor: c.accent, borderColor: c.accent }]}>
              <Txt variant="label" tone={record ? 'onAccent' : 'text'}>
                {record ? '◆ ' : s.type === 'warm-up' ? 'W ' : ''}
                {describeSet(s, e.mode, units)}
              </Txt>
            </View>
          );
        })}
        {!done.length && <Txt variant="meta" tone="muted">No completed sets</Txt>}
      </View>
    </Section>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const c = useColors();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values.map((v, i) => ({ x: dot + (i / (values.length - 1)) * (sparkWidth - 2 * dot), y: dot + (max > min ? (max - v) / (max - min) : 0.5) * (sparkHeight - 2 * dot) }));
  const line = Skia.Path.Make();
  points.forEach(({ x, y }, i) => (i ? line.lineTo(x, y) : line.moveTo(x, y)));
  const last = points[points.length - 1];
  return (
    <View accessible accessibilityLabel={`${label} trend over ${values.length} sessions, ${values.at(-1)! > values[0] ? 'up' : values.at(-1)! < values[0] ? 'down' : 'level'} since the first`}>
      <Canvas style={{ width: sparkWidth, height: sparkHeight }}>
        <Path path={line} style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" color={c.heat[2]} />
        <Circle cx={last.x} cy={last.y} r={dot} color={c.text} />
      </Canvas>
    </View>
  );
}

const dot = 5;
const sparkWidth = 112;
const sparkHeight = 48;

const styles = StyleSheet.create({
  share: { position: 'absolute', left: -10000, width: 390, padding: space.xl },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m, marginTop: space.l },
  tile: { flexBasis: '45%', flexGrow: 1, borderRadius: radius.l, padding: 18 },
  card: { borderRadius: radius.l, padding: 18, marginTop: space.m },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s, marginTop: space.l },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: space.xs },
  bar: { alignSelf: 'stretch', borderRadius: radius.s },
  barLabels: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  barLabel: { flex: 1, textAlign: 'center' },
  pill: { borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs },
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: space.m },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.m },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.m, minHeight: 36, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.s, marginTop: space.l },
  action: { minHeight: 56, borderRadius: radius.m, alignItems: 'center' },
  entry: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  checkIn: { flexDirection: 'row', marginTop: space.l },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  note: { borderRadius: radius.s, paddingHorizontal: space.m, minHeight: 44, ...type.input, marginTop: space.xl },
  input: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', borderRadius: radius.s, paddingHorizontal: space.m, minHeight: 48 },
  toggle: { flex: 1, alignItems: 'center', borderRadius: radius.s },
  save: { width: 72, borderRadius: radius.s, alignItems: 'center' },
});
