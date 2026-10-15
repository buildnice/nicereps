import { router, useFocusEffect } from 'expo-router';
import { Fragment, memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { Icon as Phosphor } from 'phosphor-react-native';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CaretUpIcon } from 'phosphor-react-native/src/icons/CaretUp';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import Animated, { FadeIn } from 'react-native-reanimated';

import { localDate, phaseAt } from '@/domain/rules';
import * as ops from '@/domain/workouts';
import { db, readSetting, writeSetting } from '@/platform/db';
import { syncHealth } from '@/platform/health';
import type { Timer } from '@/platform/notifications';

import { Measurements } from './measurements';
import { RecordTrend, recordLabel, volumeLabel } from './stats';
import { DayPlan, remind, today } from './plan';
import { Templates } from './templates';
import { clock, Digits, Icon, radius, space, Tap, touch, Txt, useColors, usePrototype } from './theme';

export const dayLabel = (date: Date) => date.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });

type Active = { name: string; startedAt: number };
type Start = (from: { templateId?: string; fromWorkoutId?: string }) => void;
type Edit = (workoutId: string) => void;
type Finished = ReturnType<typeof ops.history>[number];

const ago = (date: string) => {
  const days = Math.round((Date.parse(localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)) - Date.parse(date)) / 864e5);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
};

export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Elapsed({ since }: { since: number }) {
  return <Digits text={clock((useNow() - since) / 1000)} variant="heading" color={useColors().onAccent} />;
}

type Unfinished = ReturnType<typeof ops.unfinishedWorkouts>[number];

export function ActiveStrip() {
  const [workout, setWorkout] = useState<Unfinished | undefined>(() => ops.unfinishedWorkouts(db)[0]);
  useFocusEffect(useCallback(() => setWorkout(ops.unfinishedWorkouts(db)[0]), []));
  return workout ? <Strip workout={workout} /> : null;
}

function Strip({ workout }: { workout: Unfinished }) {
  const c = useColors();
  const now = useNow();
  const timer: Timer | null = JSON.parse(readSetting('timer') || 'null');
  const phase = timer?.workout === workout.id ? phaseAt(timer.phases, (now - timer.startedAt) / 1000) : undefined;
  const rest = phase && phase.remaining > 0 ? { label: phase.label, left: clock(phase.remaining) } : null;
  const elapsed = clock((now - Date.parse(workout.startedAt)) / 1000);
  return (
    <Tap
      accessibilityLabel={`Resume ${workout.name}, ${elapsed}${rest ? `, ${rest.label} ${rest.left} left` : ''}`}
      onPress={() => router.dismissTo({ pathname: '/', params: { open: workout.id } })}
      style={[styles.strip, { backgroundColor: c.text }]}
    >
      <View style={[styles.live, { backgroundColor: c.bg }]} />
      <Txt variant="label" style={{ color: c.bg, flexShrink: 1 }}>{workout.name}</Txt>
      <Digits text={elapsed} variant="meta" color={c.bg} accessible={false} style={{ opacity: 0.6 }} />
      <View style={styles.stripEnd}>
        {rest && <Txt variant="caps" style={{ color: c.bg, opacity: 0.6 }}>{rest.label}</Txt>}
        {rest && <Digits text={rest.left} variant="label" color={c.bg} accessible={false} down />}
        <Icon of={CaretRightIcon} tone="bg" style={{ opacity: 0.6 }} />
      </View>
    </Tap>
  );
}

export function Home({ onStart, onResume, onEdit, active }: { onStart: Start; onResume: () => void; onEdit: Edit; active: Active | null }) {
  const c = useColors();
  const [choosing, setChoosing] = useState(false);
  const [templates, setTemplates] = useState(() => ops.listTemplates(db));
  const refresh = () => {
    setTemplates(ops.listTemplates(db));
    remind();
  };
  useEffect(() => {
    void remind();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setTemplates(ops.listTemplates(db));
      void remind();
      void syncHealth();
    });
    return () => sub.remove();
  }, []);
  useFocusEffect(
    useCallback(() => {
      setTemplates(ops.listTemplates(db));
      void syncHealth();
    }, []),
  );

  return (
    <>
      <View style={styles.brand}>
        <Txt variant="brand">
          nice<Txt variant="brand" tone="muted">reps</Txt>
        </Txt>
        <Tap accessibilityLabel="Settings" onPress={() => router.push('/settings')} style={[styles.iconButton, { backgroundColor: c.surface }]}>
          <Icon of={DotsThreeIcon} tone="muted" />
        </Tap>
      </View>
      {active ? (
        <Tap onPress={onResume} style={[styles.start, { backgroundColor: c.accent }]}>
          <Txt variant="heading" tone="onAccent" style={{ flex: 1 }}>Resume {active.name}</Txt>
          <Elapsed since={active.startedAt} />
        </Tap>
      ) : (
        <Tap
          accessibilityLabel="Start workout"
          accessibilityState={{ expanded: choosing }}
          onPress={() => setChoosing(!choosing)}
          style={[styles.start, { backgroundColor: c.accent }]}
        >
          <Txt variant="heading" tone="onAccent">Start workout</Txt>
          <Icon of={choosing ? CaretUpIcon : CaretDownIcon} tone="onAccent" />
        </Tap>
      )}
      {choosing && !active && <StartChoices onStart={onStart} />}
      <FirstRun templates={templates} />
      <BackupReminder />
      {ops.homeLayout(db).filter((s) => s.shown).map(({ id }) => (
        <Fragment key={id}>
          {{
            heatmap: <Heatmap templates={templates} onEdit={onEdit} onChange={refresh} />,
            muscles: <MuscleSets />,
            stats: <StatsSummary />,
            recent: <Recent />,
            templates: <Templates templates={templates} onStart={active ? undefined : onStart} onChange={refresh} />,
            measurements: <Measurements />,
          }[id]}
        </Fragment>
      ))}
    </>
  );
}

function StartChoices({ onStart }: { onStart: Start }) {
  const c = useColors();
  const recent = ops.recentWorkouts(db, 3);
  const templates = ops.listTemplates(db);
  const { planned, done } = ops.plannedDays(db, today(), 1)[0];
  return (
    <Animated.View entering={FadeIn.duration(160)} style={[styles.section, { backgroundColor: c.surface, paddingVertical: space.xs }]}>
      {planned && !done && <Txt variant="caps" tone="muted" style={styles.caps}>Planned today</Txt>}
      {planned && !done && <Row title={planned.name} meta="From your plan" onPress={() => onStart({ templateId: planned.id })} />}
      {recent.length > 0 && <Txt variant="caps" tone="muted" style={styles.caps}>Recent</Txt>}
      {recent.map((w) => (
        <Row key={w.id} title={w.name} meta={`Last done ${ago(w.date).toLowerCase()}`} onPress={() => onStart({ fromWorkoutId: w.id })} />
      ))}
      {templates.length > 0 && <Txt variant="caps" tone="muted" style={styles.caps}>Templates</Txt>}
      {templates.map((t) => (
        <Row key={t.id} title={t.name} meta={`${t.count} exercise${t.count === 1 ? '' : 's'}`} onPress={() => onStart({ templateId: t.id })} />
      ))}
      <Tap onPress={() => onStart({})} style={[styles.fresh, (recent.length > 0 || templates.length > 0 || (planned && !done)) && { borderTopWidth: 1, borderColor: c.line }]}>
        <View style={[styles.plus, { borderColor: c.text }]}>
          <Icon of={PlusIcon} />
        </View>
        <Txt>Fresh workout</Txt>
      </Tap>
    </Animated.View>
  );
}

export function Row({ title, meta, onPress, icon, expanded, starred, image, children }: { title: string; meta: string; onPress?: () => void; icon?: Phosphor; expanded?: boolean; starred?: boolean; image?: string; children?: ReactNode }) {
  const c = useColors();
  return (
    <Tap
      onPress={onPress}
      accessibilityRole={starred !== undefined ? 'switch' : onPress ? 'button' : 'text'}
      accessibilityLabel={`${title}, ${meta}`}
      accessibilityHint={starred === undefined ? undefined : starred ? 'Unstars this PR' : 'Stars this PR'}
      accessibilityState={starred !== undefined ? { checked: starred } : expanded === undefined ? undefined : { expanded }}
      style={[styles.row, { borderColor: c.line }]}
    >
      {image && <Image source={{ uri: image }} resizeMethod="resize" style={[styles.thumb, { backgroundColor: c.raised }]} />}
      <View style={{ flex: 1 }}>
        <Txt>{title}</Txt>
        <Txt variant="meta" tone="muted">{meta}</Txt>
        {children}
      </View>
      {starred !== undefined ? <Icon of={StarIcon} tone={starred ? 'text' : 'faint'} filled={starred} /> : onPress && <Icon of={icon ?? (expanded ? CaretDownIcon : CaretRightIcon)} tone="faint" />}
    </Tap>
  );
}

export function Section({ title, aside, action, children }: { title: string; aside?: string; action?: ReactNode; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.section, { backgroundColor: c.surface }]}>
      <View style={styles.sectionHead}>
        <Txt variant="label" accessibilityRole="header">{title}</Txt>
        {aside && <Txt variant="meta" tone="muted">{aside}</Txt>}
        {action}
      </View>
      {children}
    </View>
  );
}

function WorkoutRow({ workout, from }: { workout: Finished; from: string }) {
  const sets = workout.exercises.flatMap((e) => e.sets).filter((s) => s.completed && s.type !== 'warm-up').length;
  const minutes = Math.round((Date.parse(workout.finishedAt ?? workout.startedAt) - Date.parse(workout.startedAt)) / 60000);
  return (
    <Row
      title={workout.name}
      meta={`${ago(workout.date)} · ${minutes ? `${minutes} min · ` : ''}${sets} set${sets === 1 ? '' : 's'}`}
      onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.id, from } })}
    />
  );
}

const heatLevel = (sets: number) => (sets === 0 ? 0 : sets < 5 ? 1 : sets < 9 ? 2 : sets < 15 ? 3 : 4);
export const parseDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
};
type CalendarDay = ReturnType<typeof ops.calendar>[number];
const planned = (d: CalendarDay, now: string) => !!d.plan?.planned && !d.plan.done && d.date >= now;

type DotProps = { date: string; sets: number; name?: string; done: boolean; now: string; selected: boolean; onSelect: (update: (date: string | null) => string | null) => void };
const Dot = memo(function Dot({ date, sets, name, done, now, selected, onSelect }: DotProps) {
  const c = useColors();
  const plan = !!name && !done && date >= now;
  const future = !plan && date > now;
  return (
    <Tap
      accessibilityLabel={`${dayLabel(parseDate(date))}, ${date > now ? 'future' : `${sets} working set${sets === 1 ? '' : 's'}`}${name ? `, ${done ? 'done' : 'planned'} ${name}` : ''}${date === now ? ', today' : ''}`}
      accessibilityState={{ selected }}
      onPress={() => onSelect((current) => (current === date ? null : date))}
      hitSlop={2}
      style={{ minHeight: 0, flex: 1 }}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: plan || future ? 'transparent' : c.heat[heatLevel(sets)] },
          plan && { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.muted },
          future && { borderWidth: 1.5, borderColor: c.faint },
          selected && { outlineWidth: 2, outlineColor: c.muted, outlineOffset: 1, outlineStyle: 'solid' },
        ]}
      >
        {date === now && <View style={[styles.today, { backgroundColor: c.text, borderColor: c.surface }]} />}
      </View>
    </Tap>
  );
});

function Heatmap({ templates, onEdit, onChange }: { templates: ReturnType<typeof ops.listTemplates>; onEdit: Edit; onChange: () => void }) {
  const c = useColors();
  const now = today();
  const load = () => {
    const days = ops.calendar(db, now, 12, 7);
    return { now, templates, days, rows: Array.from({ length: 6 }, (_, row) => days.slice(row * 14, row * 14 + 14)), total: days.reduce((sum, d) => sum + d.sets, 0) };
  };
  const [heat, setHeat] = useState(load);
  // templates is replaced on every refresh, so it doubles as the reload signal for logged sets
  if (heat.now !== now || heat.templates !== templates) setHeat(load());
  const { days, rows, total } = heat;
  const [selected, setSelected] = useState<string | null>(null);
  const day = days.find((d) => d.date === selected);

  return (
    <Section title="12 weeks" aside={`${total} working set${total === 1 ? '' : 's'}`}>
      <View style={styles.heatRows}>
        {rows.map((row, i) => (
          <View key={i} style={styles.heat}>
            {row.map((d) => (
              <Dot key={d.date} date={d.date} sets={d.sets} name={d.plan?.planned?.name} done={!!d.plan?.done} now={now} selected={d.date === selected} onSelect={setSelected} />
            ))}
          </View>
        ))}
      </View>
      {day && <DayCard day={day} now={now} templates={templates} onEdit={onEdit} onChange={onChange} />}
      <View style={styles.legend}>
        <Txt variant="small" tone="muted">Less</Txt>
        {c.heat.map((color) => <View key={color} style={[styles.legendDot, { backgroundColor: color }]} />)}
        <Txt variant="small" tone="muted">More ·</Txt>
        <View style={[styles.legendDot, { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.muted }]} />
        <Txt variant="small" tone="muted">Planned ·</Txt>
        <View style={[styles.legendDot, { borderWidth: 1.5, borderColor: c.faint }]} />
        <Txt variant="small" tone="muted">Future</Txt>
      </View>
    </Section>
  );
}

function DayCard({ day, now, templates, onEdit, onChange }: { day: CalendarDay; now: string; templates: ReturnType<typeof ops.listTemplates>; onEdit: Edit; onChange: () => void }) {
  const c = useColors();
  const workouts = ops.workoutsOn(db, day.date);
  return (
    <Animated.View entering={FadeIn.duration(160)} style={[styles.dayCard, { backgroundColor: c.raised }]}>
      <View style={styles.sectionHead}>
        <Txt variant="label">{dayLabel(parseDate(day.date))}</Txt>
        <Txt variant="meta" tone="muted">{planned(day, now) ? 'Planned' : day.date > now ? 'Future' : `${day.sets} working set${day.sets === 1 ? '' : 's'}`}</Txt>
      </View>
      {day.plan?.planned && (
        <View style={[styles.planned, { borderColor: c.muted }]}>
          <Txt>{day.plan.planned.name}</Txt>
          <Txt variant="meta" tone="muted">{day.plan.done ? 'Done' : 'Planned'}</Txt>
        </View>
      )}
      {workouts.map((w) => <WorkoutRow key={w.id} workout={w} from="12 weeks" />)}
      {!workouts.length && !day.plan?.planned && <Txt variant="meta" tone="muted">{day.date < now ? 'Nothing logged.' : 'Rest day.'}</Txt>}
      {day.plan && templates.length > 0 && <DayPlan day={day.plan} templates={templates} onChange={onChange} />}
      {day.plan && !templates.length && <Txt variant="meta" tone="muted">Make a template, then place it on days of the week.</Txt>}
      {day.date < now && (
        <Tap onPress={() => onEdit(ops.logWorkout(db, day.date))} style={[styles.ghost, { borderColor: c.line }]}>
          <Txt variant="label">Log workout</Txt>
        </Tap>
      )}
    </Animated.View>
  );
}

function MuscleSets() {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [{ from, to, totals }, setWeek] = useState(() => ops.muscleTotals(db, today()));
  // React Compiler memoizes this prop-less component; re-read so the last 7 days follow today.
  useFocusEffect(useCallback(() => setWeek(ops.muscleTotals(db, today())), []));
  const max = Math.max(...totals.map((m) => m.sets));
  const short = (date: string) => parseDate(date).toLocaleDateString('en', { day: 'numeric', month: 'short' });
  return (
    <Section title="Muscle sets · last 7 days" aside={`${short(from)} – ${short(to)}`}>
      {totals.length ? (
        (all ? totals : totals.slice(0, 6)).map((m) => (
          <Fragment key={m.muscle}>
            <Tap
              onPress={() => setOpen(open === m.muscle ? null : m.muscle)}
              accessibilityState={{ expanded: open === m.muscle }}
              accessibilityLabel={`${m.muscle}, ${m.sets} set${m.sets === 1 ? '' : 's'}`}
              style={styles.bar}
            >
              <Txt variant="meta" style={{ width: 96 * fontScale }} numberOfLines={1}>{m.muscle[0].toUpperCase() + m.muscle.slice(1)}</Txt>
              <View style={[styles.track, { backgroundColor: c.heat[0] }]}>
                <View style={{ width: `${(m.sets / max) * 100}%`, height: '100%', borderRadius: 4, backgroundColor: c.text }} />
              </View>
              <Txt variant="label" style={{ minWidth: 40, textAlign: 'right' }}>{m.sets}</Txt>
            </Tap>
            {open === m.muscle && <MuscleBreakdown muscle={m} />}
          </Fragment>
        ))
      ) : (
        <Txt variant="meta" tone="muted">Complete a working set and it will count here.</Txt>
      )}
      {totals.length > 6 && (
        <Tap onPress={() => setAll(!all)} accessibilityState={{ expanded: all }} style={[styles.ghost, { borderColor: c.line }]}>
          <Txt variant="label">{all ? 'Top 6' : `All ${totals.length} muscles`}</Txt>
        </Tap>
      )}
      <Txt variant="small" tone="muted" style={{ marginTop: space.s }}>
        Completed normal and drop sets in finished workouts. Primary muscle 1, secondary 0.5. Warm-ups excluded.
      </Txt>
    </Section>
  );
}

export function MuscleBreakdown({ muscle: { muscle, exercises } }: { muscle: { muscle: string; exercises: { exercise: string; sets: number }[] } }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.breakdown}>
      {exercises.map((e) => (
        <View key={e.exercise} style={styles.breakdownRow} accessible accessibilityLabel={`${e.exercise}, ${e.sets} ${muscle} set${e.sets === 1 ? '' : 's'}`}>
          <Txt variant="meta" tone="muted" style={{ flex: 1 }}>{e.exercise}</Txt>
          <Txt variant="meta" tone="muted">{e.sets}</Txt>
        </View>
      ))}
    </Animated.View>
  );
}

function FirstRun({ templates }: { templates: ReturnType<typeof ops.listTemplates> }) {
  const [show, setShow] = useState(() => ops.firstRun(db));
  const [seen, setSeen] = useState(templates);
  if (templates !== seen) {
    setSeen(templates);
    setShow(ops.firstRun(db));
  }
  if (!show) return null;
  return (
    <Section title="Getting started">
      <Txt variant="meta" tone="muted">
        <Txt variant="meta" style={{ fontWeight: '700' }}>Start workout</Txt> opens a fresh workout, or one from a template or an earlier session. Tick a set to log it and start the rest timer.
      </Txt>
      <Txt variant="meta" tone="muted" style={{ marginTop: space.m }}>
        <Txt variant="meta" style={{ fontWeight: '700' }}>12 weeks</Txt> shows every day you train. Tap a day to plan a template on it; planned days get a dashed ring.
      </Txt>
      <View style={{ marginTop: space.m }}>
        <Row title="Import data" meta="Bring in a nicereps export or a filled CSV template" onPress={() => router.push('/import')} />
      </View>
    </Section>
  );
}

function BackupReminder() {
  const [due, setDue] = useState(() => ops.backupDue(db));
  useFocusEffect(useCallback(() => setDue(ops.backupDue(db)), []));
  if (!due) return null;
  return (
    <Section
      title="Back up your data"
      action={
        <Tap
          accessibilityLabel="Dismiss backup reminder"
          onPress={() => {
            writeSetting('backupDismissedAt', new Date().toISOString());
            setDue(false);
          }}
          style={styles.dismiss}
        >
          <Txt variant="meta" tone="muted">Dismiss</Txt>
        </Tap>
      }
    >
      <Txt variant="meta" tone="muted">Your data lives only on this device, with no backup or export in the last 30 days.</Txt>
      <View style={{ marginTop: space.m }}>
        <Row title="Backup folder" meta="Save a copy after each finished workout" onPress={() => router.push('/settings')} />
        <Row title="Export data" meta="Save a ZIP of everything now" onPress={() => router.push('/settings')} />
      </View>
    </Section>
  );
}

function StatsSummary() {
  const { units } = usePrototype();
  const read = () => ({ volume: ops.totalVolume(db, today(), 'week'), lifts: ops.lifts(db).length, starred: ops.personalRecords(db, true) });
  const [{ volume, lifts, starred }, setStats] = useState(read);
  useFocusEffect(useCallback(() => setStats(read()), []));
  return (
    <Section title="Stats">
      <Row
        title={`${volumeLabel(volume, units.weight)} past week`}
        meta="Volume by week"
        onPress={() => router.push('/volume')}
      />
      {starred.map((r) => (
        <Row key={`${r.exerciseId} ${r.kind}`} title={`★ ${r.name}`} meta={recordLabel(r, units)} onPress={() => router.push({ pathname: '/lift/[id]', params: { id: r.exerciseId } })}>
          {r.trend.length > 1 && <RecordTrend record={r} compact />}
        </Row>
      ))}
      <Row title="Show all" meta={lifts ? `Volume, PRs and ${lifts} lift${lifts === 1 ? '' : 's'}` : 'Volume, PRs and lifts'} onPress={() => router.push('/stats')} />
    </Section>
  );
}

function Recent() {
  const [workouts, setWorkouts] = useState(() => ops.history(db, undefined, 5));
  useFocusEffect(useCallback(() => setWorkouts(ops.history(db, undefined, 5)), []));
  if (!workouts.length) return null;
  return (
    <Section title="Recent">
      {workouts.map((w) => <WorkoutRow key={w.id} workout={w} from="Recent" />)}
    </Section>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: space.l },
  iconButton: { width: touch.min, height: touch.min, borderRadius: radius.pill, alignItems: 'center' },
  start: { minHeight: touch.primary, borderRadius: radius.m, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m, paddingHorizontal: 22 },
  section: { borderRadius: radius.l, padding: 18, marginTop: space.m },
  dismiss: { minWidth: touch.min, alignItems: 'flex-end', marginVertical: -space.m },
  sectionHead: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.m, justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.m },
  caps: { marginTop: space.l },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.m, borderTopWidth: StyleSheet.hairlineWidth },
  thumb: { width: touch.min, height: touch.min, borderRadius: radius.s, marginRight: space.m },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m },
  plus: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  heat: { flexDirection: 'row', gap: 4 },
  heatRows: { gap: 8 },
  dot: { width: '100%', aspectRatio: 1, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  today: { width: '58%', aspectRatio: 1, borderRadius: radius.pill, borderWidth: 2 },
  dayCard: { borderRadius: radius.m, padding: space.l, marginTop: space.l },
  planned: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.m, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.s },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: space.m },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  breakdown: { paddingLeft: space.l, paddingBottom: space.s },
  breakdownRow: { flexDirection: 'row', gap: space.s, paddingVertical: space.xs },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.s, paddingHorizontal: space.xl, paddingVertical: space.xs },
  live: { width: 8, height: 8, borderRadius: radius.pill },
  stripEnd: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginLeft: 'auto' },
  ghost: { alignSelf: 'flex-start', marginTop: space.m, paddingHorizontal: space.l, borderWidth: 1, borderRadius: radius.pill },
});
