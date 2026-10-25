import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, type TextProps, BackHandler, Platform, Image, Keyboard, KeyboardAvoidingView, PanResponder, ScrollView, StyleSheet, TextInput, useWindowDimensions, Vibration, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, interpolateColor, Keyframe, LayoutAnimationConfig, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { ArrowDownIcon } from 'phosphor-react-native/src/icons/ArrowDown';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { DotsThreeVerticalIcon } from 'phosphor-react-native/src/icons/DotsThreeVertical';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Mode, Role, SetFields, SetType } from '@/data/queries';
import { addDays, advance, convert, digitClock, localDate, digitSeconds, intervalPhases, modes, optionalFields, pace, phaseAt, phaseEnds, shownFields, supersetBlocks, timeDigits, unusual, type OptionalField } from '@/domain/rules';
import * as measures from '@/domain/measurements';
import { equipment, loadPlates, type Kit } from '@/domain/plates';
import * as ops from '@/domain/workouts';
import { backup } from '@/platform/data';
import { syncHealth } from '@/platform/health';
import { db, readSetting } from '@/platform/db';
import { alerts, scheduleTimer, VIBRATION, type Timer } from '@/platform/notifications';

import { bodyweight } from '../../assets/catalog/bodyweight';
import { catalog } from '../../assets/catalog/exercises';
import { images } from '../../assets/catalog/images';
import { MusclesWorked, Tiles } from './detail';
import { dayLabel, parseDate, Row, useNow } from './home';
import { parse, type Draft } from './draft';
import { Keypad } from './keypad';
import { BottomSheet, CLOSE_MS, OPEN_MS } from './sheet';
import { clock, describeSet, Digits, Icon, inUnit, radius, space, Tap, touch, Txt, type, useColors, usePrototype } from './theme';

type LoggedSet = SetFields & { id: string };
export type Field = 'weight' | 'reps' | 'duration' | 'distance' | 'recovery' | 'rounds' | 'targetRpe' | 'rpe' | 'rest';
type Editable = Field | 'bodyWeight' | 'bar';
type Edit = Draft & { set: string; title: string; field: Editable; error?: string };

export const decimals: Editable[] = ['weight', 'distance', 'targetRpe', 'rpe', 'bodyWeight', 'bar'];
export const timeFields: Editable[] = ['duration', 'recovery', 'rest'];
export const entered = (field: Field, text: string) => (timeFields.includes(field) ? digitSeconds(text) : parse(text));
export const fieldText = (field: Field, value: number | null | undefined) => (value == null ? '' : timeFields.includes(field) ? clock(value) : String(value));
export const typed = (field: Field, text: string) => (timeFields.includes(field) ? fieldText(field, digitSeconds(text)) : text);
const attempt = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
};

export const modeFields: Record<Mode, [Field, string][]> = {
  reps: [['weight', 'kg'], ['reps', 'reps']],
  duration: [['weight', 'kg'], ['duration', '']],
  distance: [['distance', 'km'], ['duration', '']],
  interval: [['duration', 'on'], ['recovery', 'off'], ['rounds', '×']],
  check: [],
};

export const modeNames: Record<Mode, string> = { reps: 'Weight × reps', duration: 'Duration', distance: 'Distance', interval: 'Intervals', check: 'Mark complete' };

const muscles = [...new Set(Object.values(catalog).flatMap((e) => [...e.primary, ...e.secondary]))].sort();
const nextRole = { none: 'primary', primary: 'secondary', secondary: 'none' } as const;

export const nextType: Record<SetType, SetType> = { normal: 'warm-up', 'warm-up': 'drop', drop: 'normal' };

type WorkoutProps = { id: string; hidden: boolean; onMinimise: () => void; onExit: () => void };

function Ink({ fill, at, from, to, variant = 'body', style, ...props }: TextProps & { fill: SharedValue<number>; at: number; from: string; to: string; variant?: keyof typeof type }) {
  const color = useAnimatedStyle(() => ({ color: interpolateColor(fill.get(), [Math.max(0, at - 0.15), Math.min(1, at + 0.15)], [from, to]) }));
  return <Animated.Text {...props} style={[type[variant], style, color]} />;
}

function Clock({ since, sets }: { since: number; sets: string }) {
  const text = clock((useNow() - since) / 1000);
  return (
    <View accessible accessibilityLabel={text + sets} style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs }}>
      <Digits text={text} variant="meta" color={useColors().muted} accessible={false} />
      <Txt variant="meta" tone="muted">{sets}</Txt>
    </View>
  );
}

function TimerCard({ timer, onChange }: { timer: Timer; onChange: (timer: Timer | null) => void }) {
  const c = useColors();
  const { fontScale } = useWindowDimensions();
  const elapsed = Math.max(0, useNow() - timer.startedAt) / 1000;
  const phase = phaseAt(timer.phases, elapsed);
  const player = useAudioPlayer(require('../../assets/timer.wav'));
  const { ended, since } = phaseEnds(timer.phases, elapsed);
  const seen = useRef(ended);
  useEffect(() => void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }), []);
  useEffect(() => {
    if (ended > seen.current && since < 2 && AppState.currentState === 'active') {
      const { sound, haptics } = alerts();
      if (sound) {
        player.pause();
        player.seekTo(0);
        player.play();
      }
      if (haptics) Vibration.vibrate(Platform.OS === 'ios' ? [0, 450] : VIBRATION);
    }
    seen.current = ended;
  }, [ended, since, player]);
  if (!phase || phase.remaining <= -3) return null;
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(160)}
      style={[styles.rest, { backgroundColor: c.text }]}
    >
      <View>
        <Txt variant="caps" accessibilityLiveRegion="polite" style={{ color: c.bg, opacity: 0.6 }}>{phase.remaining > 0 ? phase.label : `${phase.label} done`}</Txt>
        <Digits text={clock(phase.remaining)} variant="display" color={c.bg} down />
      </View>
      <Txt variant="small" style={{ flexGrow: 1, flexBasis: 80, color: c.bg, opacity: 0.6 }}>
        of {clock(phase.seconds)}{timer.phases.length > 1 ? ` · ${phase.index + 1}/${timer.phases.length}` : ''}{'\n'}{timer.exercise}
      </Txt>
      <View style={[styles.pills, fontScale > 1.3 && { flexBasis: '100%' }]}>
        <Tap accessibilityLabel={`Extend ${phase.label.toLowerCase()} by 30 seconds`} onPress={() => onChange({ ...timer, phases: timer.phases.map((p, i) => (i === phase.index ? { ...p, seconds: p.seconds + 30 + Math.max(0, -phase.remaining) } : p)) })} style={[styles.pill, { borderColor: c.bg }]}>
          <Txt variant="label" style={{ color: c.bg }}>+30s</Txt>
        </Tap>
        <Tap accessibilityLabel="Stop timer" onPress={() => onChange(null)} style={[styles.pill, { borderColor: c.bg }]}>
          <Txt variant="label" style={{ color: c.bg }}>Skip</Txt>
        </Tap>
      </View>
    </Animated.View>
  );
}

export function Workout({ id, hidden, onMinimise, onExit }: WorkoutProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const { height: windowHeight, width: windowWidth, fontScale } = useWindowDimensions();
  const [dockHeight, setDockHeight] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const offset = useRef(0);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [shown, setShown] = useState(edit);
  if (edit && edit !== shown) setShown(edit);
  const [workout, setWorkout] = useState(() => ops.getWorkout(db, id));
  const run = (op: () => unknown) => {
    clearTimeout(advancing.current);
    op();
    setWorkout(ops.getWorkout(db, id));
  };
  const [visit, setVisit] = useState(0);
  const reload = useCallback(() => {
    setWorkout(ops.getWorkout(db, id));
    setVisit((v) => v + 1);
  }, [id]);
  useFocusEffect(reload);
  const { units } = usePrototype();
  const exercises = supersetBlocks(workout.exercises).flat().map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...inUnit(s, units), pace: s.distance && s.duration ? pace(s.duration, s.distance, s.distanceUnit, units.distance) : null })) }));
  const [open, setOpen] = useState<string | null>(exercises[0]?.id ?? null);
  const advancing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [arrived, setArrived] = useState<string | null>(null);
  const show = (exercise: string | null) => {
    clearTimeout(advancing.current);
    setOpen(exercise);
    setEdit(null);
    setMenu(null);
  };
  const reduce = useReducedMotion();
  const startedAt = Date.parse(workout.startedAt);
  const [timer, setTimer] = useState<Timer | null>(() => {
    const saved: Timer | null = JSON.parse(readSetting('timer') || 'null');
    return saved?.workout === id ? saved : null;
  });
  const [adding, setAdding] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<ops.DeletedSet | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [howTo, setHowTo] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<string[]>([]);
  const placed = useRef<{ y: number; height: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const nameInput = useRef<TextInput>(null);
  const finished = !!workout.finishedAt;
  const exit = () => {
    ops.closeWorkout(db, id);
    onExit();
  };
  const close = finished ? exit : onMinimise;
  const openName = exercises.find((x) => x.id === open)?.name;
  const recent = openName ? ops.history(db, openName, 5, workout) : [];
  const previous = recent[0];
  const usual = recent.map((w) => w.exercises.flatMap((x) => x.sets));
  const up = openName ? ops.suggest(db, openName, workout) : [];

  useEffect(() => {
    if (finished) return;
    scheduleTimer(timer);
    const sub = AppState.addEventListener('change', (state) => state === 'active' && scheduleTimer(timer, false));
    return () => sub.remove();
  }, [timer, finished]);
  // Animate only bottom: a layout transition on the dock froze it on a stale frame when its timer card exited or the app paused.
  const dockBottom = edit ? sheetHeight + space.s : insets.bottom + space.m;
  const dockMs = edit ? OPEN_MS : CLOSE_MS;
  const dockStyle = useAnimatedStyle(() => ({ bottom: withTiming(dockBottom, { duration: dockMs }) }), [dockBottom, dockMs]);

  useEffect(() => {
    if (hidden) return;
    const sub = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) =>
      TextInput.State.currentlyFocusedInput()?.measureInWindow((_x, y, _w, h) => {
        const over = y + h + space.m - endCoordinates.screenY;
        if (over > 0) scroll.current?.scrollTo({ y: offset.current + over });
      }),
    );
    return () => sub.remove();
  }, [hidden]);

  useEffect(() => {
    if (hidden) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (renaming) nameInput.current?.blur();
      else if (edit) setEdit(null);
      else close();
      return true;
    });
    return () => sub.remove();
  }, [hidden, edit, renaming, close]);

  const startTimer = (exercise: string, phases: Timer['phases'], set?: string) => setTimer(() => ({ workout: id, exercise, startedAt: Date.now(), phases, set }));
  // Retime a rest that was running when its set's rest field opened, once typing there ends, so keystrokes in between don't end it.
  const retime = useRef<{ set: string; live: boolean; typed: boolean } | null>(null);
  useEffect(() => {
    const was = retime.current;
    if (was && edit?.field === 'rest' && edit.set === was.set) {
      was.typed ||= !edit.fresh;
      return;
    }
    retime.current = edit?.field === 'rest' && timer?.set === edit.set ? { set: edit.set, live: (phaseAt(timer.phases, (Date.now() - timer.startedAt) / 1000)?.remaining ?? 0) > 0, typed: false } : null;
    if (!was?.live || !was.typed || timer?.set !== was.set) return;
    const exercise = exercises.find((x) => x.sets.some((s) => s.id === was.set));
    const set = exercise?.sets.find((s) => s.id === was.set);
    if (exercise && set) setTimer({ ...timer, phases: [{ ...timer.phases[0], seconds: set.rest ?? exercise.rest }] });
  }, [edit, exercises, timer]);
  // Leaving the app mid-typing closes the keypad so the background countdown and end alert get the new length.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state !== 'active' && retime.current?.typed && setEdit(null));
    return () => sub.remove();
  }, []);

  const all = exercises.flatMap((e) => e.sets);
  const allDone = all.length > 0 && all.every((s) => s.completed);
  const [cta, setCta] = useState<'wait' | 'show' | 'spent'>('wait');
  if (cta === 'wait' && allDone) setCta('show');
  if (cta === 'show' && !allDone) setCta('spent');
  const update = (set: string, patch: Partial<SetFields>) => run(() => ops.correctSet(db, set, patch));

  const complete = (exercise: (typeof exercises)[number], set: LoggedSet) => {
    update(set.id, { completed: !set.completed });
    const pr = !set.completed && ops.prSets(db, ops.getWorkout(db, id)).has(set.id);
    if (pr) AccessibilityInfo.announceForAccessibility('Personal record');
    if (!set.completed && alerts().haptics) void (pr ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    if (!set.completed && !finished) {
      startTimer(exercise.name, [{ label: 'Rest', seconds: set.rest ?? exercise.rest }], set.id);
      const to = advance(exercises.map((x) => ({ ...x, sets: x.sets.map((s) => (s.id === set.id ? { ...s, completed: true } : s)) })), exercise.id);
      if (to !== exercise.id) {
        advancing.current = setTimeout(() => {
          setArrived(to);
          show(to);
        }, 300);
      }
    }
  };
  useEffect(() => () => clearTimeout(advancing.current), [hidden]);
  const arrive = (y: number, height: number) => {
    setArrived(null);
    if (y < offset.current || y + Math.min(height, windowHeight / 3) > offset.current + windowHeight - dockHeight) scroll.current?.scrollTo({ y: y - space.m, animated: !reduce });
  };

  const [kgOn, setKgOn] = useState(() => measures.bodyWeight(db, workout.date));
  const [seen, setSeen] = useState({ hidden, date: workout.date });
  if (seen.hidden !== hidden || seen.date !== workout.date) {
    if (seen.hidden !== hidden) reload();
    setSeen({ hidden, date: workout.date });
    setKgOn(measures.bodyWeight(db, workout.date));
  }
  const bodyWeight = kgOn == null ? null : convert(kgOn, 'kg', units.weight);
  const prs = useMemo(() => ops.prSets(db, workout), [workout]);
  const startEdit = (title: string, set: LoggedSet, field: Exclude<Editable, 'bar'>) => {
    Keyboard.dismiss();
    clearTimeout(advancing.current);
    if (field === 'bodyWeight') return setEdit({ set: set.id, title: 'Body weight', field, text: String(bodyWeight ?? ''), fresh: true });
    setEdit({ set: set.id, title, field, text: timeFields.includes(field) ? timeDigits(set[field]) : String(set[field] ?? ''), fresh: true });
  };
  const reveal = (bottom: number) => {
    const top = windowHeight - sheetHeight - space.s - dockHeight;
    if (bottom + space.m > top) scroll.current?.scrollTo({ y: offset.current + bottom + space.m - top });
  };
  const gone = useRef<string | null>(null);
  const removeSet = (set: string) => {
    if (gone.current === set) return;
    gone.current = set;
    run(() => setDeleted(ops.deleteSet(db, set)));
    AccessibilityInfo.announceForAccessibility('Set deleted');
    if (edit?.set === set) setEdit(null);
  };
  const undo = (set: ops.DeletedSet) => {
    if (gone.current !== set.id) return;
    gone.current = null;
    run(() => ops.restoreSet(db, set));
    setDeleted(null);
  };
  useEffect(() => {
    if (!deleted) return;
    let live = true;
    let id: ReturnType<typeof setTimeout> | undefined;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
      if (live && !on) id = setTimeout(() => setDeleted(null), 4000);
    });
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [deleted]);

  const addExercise = (exerciseId: string, after?: string) => {
    let added = '';
    run(() => {
      added = ops.addExercise(db, id, exerciseId, after);
      ops.addSet(db, added);
    });
    show(added);
    setAdding(false);
  };

  const finish = () => {
    const unfinished = exercises.find((x) => x.sets.some((s) => !s.completed && !flagged.includes(s.id)));
    if (unfinished) {
      setFlagged(all.filter((s) => !s.completed).map((s) => s.id));
      AccessibilityInfo.announceForAccessibility(`${unfinished.name} has sets not completed. Tap Finish again to finish anyway.`);
      if (open === unfinished.id && placed.current) return arrive(placed.current.y, placed.current.height);
      setArrived(unfinished.id);
      return show(unfinished.id);
    }
    ops.finishWorkout(db, id);
    scheduleTimer(null);
    onExit();
    router.push({ pathname: '/check-in/[id]', params: { id } });
    backup();
    void syncHealth();
  };

  const discard = () => {
    if (finished) {
      ops.deleteWorkout(db, id);
      return onExit();
    }
    ops.discardWorkout(db, id);
    scheduleTimer(null);
    onExit();
  };
  const lastDay = workout.date >= localDate(new Date(), workout.timeZone);
  const move = (step: number) => run(() => ops.moveWorkout(db, id, addDays(workout.date, step)));

  const editing = edit && exercises.flatMap((e) => e.sets).find((s) => s.id === edit.set);

  // The title gets its own row when large text or a narrow screen would break the name mid-word.
  const large = fontScale > 1.3 || windowWidth / fontScale < 360;
  const heading = (
    <View style={large ? { flexBasis: '100%' } : { flex: 1 }}>
      {renaming ? (
        <TextInput
          ref={nameInput}
          autoFocus
          selectTextOnFocus
          defaultValue={workout.name}
          onFocus={() => setEdit(null)}
          onEndEditing={(event) => {
            const name = event.nativeEvent.text;
            if (name.trim()) run(() => ops.renameWorkout(db, id, name));
            setRenaming(false);
          }}
          accessibilityLabel="Workout name"
          style={[type.title, styles.rename, { color: c.text, borderColor: c.line }]}
        />
      ) : (
        <View style={styles.titleRow}>
          <Txt variant="title" accessibilityRole="header" onPress={() => setRenaming(true)} style={{ flexShrink: 1 }}>{workout.name}</Txt>
          <Tap accessibilityLabel="Rename workout" onPress={() => setRenaming(true)} style={styles.pencil}>
            <Icon of={PencilSimpleIcon} tone="muted" />
          </Tap>
        </View>
      )}
      {finished ? (
        <View style={styles.date}>
          <Txt variant="meta" tone="muted">
            {dayLabel(parseDate(workout.date))} · {all.filter((s) => s.completed).length} of {all.length} set{all.length === 1 ? '' : 's'}
          </Txt>
          <Tap accessibilityLabel="Previous day" onPress={() => move(-1)} style={styles.step}>
            <Icon of={CaretLeftIcon} size="s" tone="muted" />
          </Tap>
          <Tap accessibilityLabel="Next day" disabled={lastDay} onPress={() => move(1)} style={[styles.step, lastDay && { opacity: 0.3 }]}>
            <Icon of={CaretRightIcon} size="s" tone="muted" />
          </Tap>
        </View>
      ) : (
        <Clock since={startedAt} sets={` · ${all.filter((s) => s.completed).length} of ${all.length} set${all.length === 1 ? '' : 's'}`} />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        onScroll={(event) => (offset.current = event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: insets.bottom + space.xxl + dockHeight + (edit ? sheetHeight : 0) }}
      >
      <View style={[styles.header, large && { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
        <Tap accessibilityLabel={finished ? 'Close workout' : 'Minimise workout'} onPress={close} style={[styles.minimise, { backgroundColor: c.surface }]}>
          <Icon of={CaretDownIcon} tone="muted" />
        </Tap>
        {!large && heading}
        <Tap onPress={finished ? exit : finish} style={[styles.finish, { backgroundColor: c.accent }]}>
          <Txt tone="onAccent" variant="label">{finished ? 'Done' : 'Finish'}</Txt>
        </Tap>
        {large && heading}
      </View>
      <TextInput
        defaultValue={workout.note ?? ''}
        onChangeText={(t) => ops.noteWorkout(db, id, t)}
        onFocus={() => setEdit(null)}
        placeholder="Workout note"
        placeholderTextColor={c.faint}
        accessibilityLabel="Workout note"
        multiline
        style={[styles.note, { backgroundColor: c.surface, color: c.text }]}
      />

      {exercises.map((exercise, e) => {
        const done = exercise.sets.filter((s) => s.completed).length;
        const partners = exercises.filter((x) => x.superset && x.superset === exercise.superset && x.id !== exercise.id).map((x) => x.name);
        const progress = `${modeNames[exercise.mode]} · ${done} / ${exercise.sets.length}${partners.length ? ` · superset with ${partners.join(', ')}` : ''}`;
        const next = exercises.slice(e + 1).find((x) => !x.superset || x.superset !== exercise.superset);
        const edge = (step: -1 | 1) => {
          const blocks = supersetBlocks(workout.exercises);
          const at = blocks.findIndex((b) => b.some((x) => x.id === exercise.id));
          return !blocks[at + step];
        };
        const last = previous?.exercises[0];
        const guide = exercise.source ? catalog[exercise.source] : undefined;
        const target = exercise.sets.find((s) => !s.completed);
        const kit = ops.exerciseKit(db, units.weight, exercise);
        const barEdit = edit?.field === 'bar' && edit.set === exercise.exerciseId ? edit : null;
        const phases = !target ? [] : exercise.mode === 'interval' ? intervalPhases(target) : exercise.mode === 'duration' && target.duration ? [{ label: 'Countdown', seconds: target.duration }] : [];
        if (open !== exercise.id) {
          return (
            <Tap key={exercise.id} onPress={() => { setArrived(exercise.id); show(exercise.id); }} style={[styles.card, styles.collapsed, { backgroundColor: c.surface }, exercise.superset && { borderLeftWidth: 3, borderLeftColor: c.faint }]}>
              <View style={{ flex: 1 }}>
                <Txt variant="heading">{exercise.name}</Txt>
                {!!exercise.exerciseNote && <Txt variant="meta" tone="muted" style={{ fontWeight: '500' }}>{exercise.exerciseNote}</Txt>}
                <Txt variant="meta" tone="muted">{progress}{done > 0 && done === exercise.sets.length ? ' ✓' : ''}</Txt>
              </View>
              <Icon of={CaretRightIcon} tone="faint" />
            </Tap>
          );
        }
        return (
          <View
            key={exercise.id}
            onLayout={(event) => {
              placed.current = event.nativeEvent.layout;
              if (arrived === exercise.id) arrive(event.nativeEvent.layout.y, event.nativeEvent.layout.height);
            }}
            style={[styles.card, { backgroundColor: c.surface }, exercise.superset && { borderLeftWidth: 3, borderLeftColor: c.faint }]}
          >
            <View style={styles.exerciseHead}>
              <Tap accessibilityLabel={`${exercise.name}, collapse`} onPress={() => show(null)} style={{ flex: 1, justifyContent: 'center' }}>
                <Txt variant="heading">{exercise.name}</Txt>
              </Tap>
              <Tap accessibilityLabel={`${exercise.name} options`} accessibilityState={{ expanded: menu === exercise.id }} onPress={() => { setMenu(menu === exercise.id ? null : exercise.id); if (barEdit) setEdit(null); }} style={styles.menu}>
                <Icon of={DotsThreeVerticalIcon} />
              </Tap>
            </View>
            {menu !== exercise.id && (!!exercise.exerciseNote || !!exercise.note) && (
              <Tap accessibilityLabel={`${exercise.name} notes, ${[exercise.exerciseNote && `every workout: ${exercise.exerciseNote}`, exercise.note && `this workout: ${exercise.note}`].filter(Boolean).join(', ')}, options`} onPress={() => setMenu(exercise.id)} style={{ marginBottom: space.s }}>
                {[exercise.exerciseNote, exercise.note].map((note, i) => !!note && <Txt key={i} variant="meta" tone="muted" style={{ fontWeight: '500' }}>{note}</Txt>)}
              </Tap>
            )}
            {menu === exercise.id && (
              <Animated.View entering={FadeIn.duration(160)} style={{ gap: space.s, marginBottom: space.s }}>
                <Txt variant="meta" tone="muted">{progress}</Txt>
                {exercise.mode === 'reps' && (
                  <Tap
                    accessibilityLabel={`${exercise.name} bar ${kit ? `${kit.bar} ${units.weight}` : 'none'}, change`}
                    accessibilityState={{ selected: !!barEdit }}
                    onPress={() => {
                      Keyboard.dismiss();
                      setEdit({ set: exercise.exerciseId, title: `${exercise.name} bar`, field: 'bar', text: exercise.bar == null ? '' : String(convert(exercise.bar, exercise.barUnit ?? 'kg', units.weight)), fresh: true });
                    }}
                    style={[styles.bar, { backgroundColor: c.raised }, barEdit && { borderWidth: 2, borderColor: c.text }]}
                  >
                    <Txt variant="label">Bar</Txt>
                    <Txt variant="meta" tone="muted">
                      {barEdit?.text ? `${barEdit.text} ${units.weight}` : kit ? `${kit.bar} ${units.weight}${exercise.bar == null ? ' · Settings' : ''}` : 'None'}
                    </Txt>
                  </Tap>
                )}
                <ExerciseNote key={visit} exerciseId={exercise.exerciseId} name={exercise.name} note={exercise.exerciseNote} onFocus={() => setEdit(null)} save={run} />
                <TextInput
                  defaultValue={exercise.note ?? ''}
                  onChangeText={(t) => run(() => ops.noteExercise(db, exercise.id, t))}
                  onFocus={() => setEdit(null)}
                  placeholder="Note for this workout"
                  placeholderTextColor={c.faint}
                  accessibilityLabel={`${exercise.name} note for this workout`}
                  multiline
                  style={[styles.exerciseNote, { color: c.text }]}
                />
                <View style={[styles.actions, { marginTop: 0 }]}>
                  <Tap
                    accessibilityState={{ expanded: history === exercise.id }}
                    onPress={() => setHistory(history === exercise.id ? null : exercise.id)}
                    style={[styles.action, { borderColor: c.line }]}
                  >
                    <Txt variant="label" tone="muted">History</Txt>
                  </Tap>
                  {guide && (
                    <Tap
                      accessibilityState={{ expanded: howTo === exercise.id }}
                      onPress={() => setHowTo(howTo === exercise.id ? null : exercise.id)}
                      style={[styles.action, { borderColor: c.line }]}
                    >
                      <Txt variant="label" tone="muted">How to</Txt>
                    </Tap>
                  )}
                  <Tap
                    accessibilityLabel={`Copy ${exercise.name} as a custom exercise`}
                    accessibilityState={{ expanded: copying === exercise.id }}
                    onPress={() => setCopying(copying === exercise.id ? null : exercise.id)}
                    style={[styles.action, { borderColor: c.line }]}
                  >
                    <Txt variant="label" tone="muted">Copy as custom</Txt>
                  </Tap>
                </View>
                {copying === exercise.id && (
                  <Animated.View entering={FadeIn.duration(160)}>
                    <NewExercise
                      from={exercise.exerciseId}
                      onFocus={() => setEdit(null)}
                      onCreate={(created) => {
                        setCopying(null);
                        addExercise(created, exercise.id);
                      }}
                    />
                  </Animated.View>
                )}
                {guide && howTo === exercise.id && (
                  <Animated.View entering={FadeIn.duration(160)} style={{ gap: space.s }}>
                    <View style={{ flexDirection: 'row', gap: space.s }}>
                      {(images[exercise.source!] ?? []).map((image, i, all) => (
                        <Image key={i} source={image} accessibilityLabel={`${exercise.name}, picture ${i + 1} of ${all.length}`} style={[styles.picture, { backgroundColor: c.raised }]} />
                      ))}
                    </View>
                    {guide.equipment && <Txt variant="meta" tone="muted">Equipment · {guide.equipment}</Txt>}
                    {guide.instructions.map((step, i) => (
                      <Txt key={i} variant="meta">{i + 1}. {step}</Txt>
                    ))}
                  </Animated.View>
                )}
                {history === exercise.id && <ExerciseHistory name={exercise.name} mode={exercise.mode} workout={workout} />}
              </Animated.View>
            )}
            {exercise.sets.flatMap((set, s) => [
              deleted?.workoutExerciseId === exercise.id && deleted.position === s && <Undo key="undo" onUndo={() => undo(deleted)} />,
              <SetRow
                key={set.id}
                label={setLabel(exercise.sets, s)}
                n={s + 1}
                set={set}
                pr={prs.has(set.id)}
                prev={exercise.mode === 'check' || !last?.sets[s]?.completed ? undefined : last.sets[s]}
                next={up[s] ?? undefined}
                mode={exercise.mode}
                onDelete={() => removeSet(set.id)}
                onComplete={() => complete(exercise, set)}
                onChange={(patch) => update(set.id, patch)}
                editing={edit?.set === set.id ? edit : null}
                onEdit={(field) => (field ? startEdit(exercise.name, set, field) : setEdit(null))}
                onReveal={reveal}
                defaultRest={exercise.rest}
                bodyWeight={exercise.source && bodyweight.has(exercise.source) ? bodyWeight : undefined}
                kit={kit}
                usual={exercise.mode === 'reps' ? usual : undefined}
                flagged={flagged.includes(set.id) && !set.completed}
              />,
            ])}
            {deleted?.workoutExerciseId === exercise.id && deleted.position >= exercise.sets.length && <Undo onUndo={() => undo(deleted)} />}
            <View style={styles.actions}>
              <Tap accessibilityLabel="Add set" onPress={() => run(() => ops.addSet(db, exercise.id))} style={[styles.action, styles.iconAction, { borderColor: c.line }]}>
                <Icon of={PlusIcon} size="s" tone="muted" />
                <Txt variant="label" tone="muted">Set</Txt>
              </Tap>
              {phases.length > 0 && !finished && (
                <Tap accessibilityLabel={`Start ${exercise.name} timer`} onPress={() => startTimer(exercise.name, phases)} style={[styles.action, { borderColor: c.line }]}>
                  <Txt variant="label" tone="muted">Timer</Txt>
                </Tap>
              )}
            </View>
            <View style={styles.actions}>
              {!edge(-1) && (
                <Tap accessibilityLabel={`Move ${exercise.name} up`} onPress={() => run(() => ops.moveExerciseBlock(db, exercise.id, -1))} style={[styles.action, { borderColor: c.line }]}>
                  <Icon of={ArrowUpIcon} size="s" tone="muted" />
                </Tap>
              )}
              {!edge(1) && (
                <Tap accessibilityLabel={`Move ${exercise.name} down`} onPress={() => run(() => ops.moveExerciseBlock(db, exercise.id, 1))} style={[styles.action, { borderColor: c.line }]}>
                  <Icon of={ArrowDownIcon} size="s" tone="muted" />
                </Tap>
              )}
              {next && (
                <Tap accessibilityLabel={`Superset with ${next.name}`} onPress={() => run(() => ops.linkSuperset(db, exercise.id, next.id))} style={[styles.action, { borderColor: c.line }]}>
                  <Txt variant="label" tone="muted">Superset</Txt>
                </Tap>
              )}
              {exercise.superset && (
                <Tap accessibilityLabel={`Unlink ${exercise.name}`} onPress={() => run(() => ops.unlinkSuperset(db, exercise.id))} style={[styles.action, { borderColor: c.line }]}>
                  <Txt variant="label" tone="muted">Unlink</Txt>
                </Tap>
              )}
              <Tap
                accessibilityLabel={removing === exercise.id ? `Tap again to remove ${exercise.name}` : `Remove ${exercise.name}`}
                onPress={() => (removing === exercise.id ? run(() => ops.removeExercise(db, exercise.id)) : setRemoving(exercise.id))}
                style={[styles.action, { borderColor: c.line }]}
              >
                <Txt variant="label" tone="muted">{removing === exercise.id ? 'Confirm' : 'Remove'}</Txt>
              </Tap>
            </View>
          </View>
        );
      })}

      {exercises.length === 0 && (
        <Txt variant="meta" tone="muted" style={{ marginTop: space.l }}>Empty workout. Add the first exercise.</Txt>
      )}
      <Tap onPress={() => setAdding(!adding)} accessibilityState={{ expanded: adding }} style={[styles.card, styles.collapsed, { backgroundColor: c.surface, gap: space.s }]}>
        <Icon of={PlusIcon} size="s" />
        <Txt variant="label">Add exercise</Txt>
      </Tap>
      {adding && <ExercisePicker exclude={exercises.map((e) => e.exerciseId)} onPick={addExercise} onFocus={() => setEdit(null)} />}
      {exercises.length > 0 && (
        <Totals key={kgOn} workout={workout} />
      )}
      <Tap
        onPress={() => (discarding ? discard() : setDiscarding(true))}
        style={{ alignSelf: 'center', marginTop: space.xl, paddingHorizontal: space.l }}
      >
        <Txt variant="label" tone="muted">{discarding ? `Tap again to ${finished ? 'delete' : 'discard'} workout` : `${finished ? 'Delete' : 'Discard'} workout`}</Txt>
      </Tap>
      </ScrollView>
      </KeyboardAvoidingView>

      <Animated.View
        onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
        style={[styles.dock, dockStyle]}
      >
        {timer && <TimerCard timer={timer} onChange={setTimer} />}
        {cta === 'show' && !finished && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)}>
            <Tap onPress={finish} style={[styles.done, { backgroundColor: c.accent }]}>
              <Txt tone="onAccent" variant="label">Finish</Txt>
            </Tap>
          </Animated.View>
        )}
      </Animated.View>
      <BottomSheet open={!!edit} onClose={() => setEdit(null)} onHeight={setSheetHeight}>
        {shown && (
          <Keypad
            title={edit?.error ?? shown.title}
            decimal={decimals.includes(shown.field)}
            display={timeFields.includes(shown.field) ? digitClock(shown.text) : undefined}
            draft={shown}
            onChange={(draft) => {
              if (!edit || (!editing && edit.field !== 'bar')) return false;
              const field = edit.field;
              const v = field === 'bodyWeight' || field === 'bar' ? parse(draft.text) : entered(field, draft.text);
              const error = field === 'bar' ? attempt(() => run(() => ops.setBar(db, edit.set, v ?? null, units.weight))) : field === 'bodyWeight' ? attempt(() => v != null && (run(() => measures.logBodyWeight(db, v, workout.date)), setKgOn(measures.bodyWeight(db, workout.date)))) : attempt(() => update(edit.set, { [field]: field === 'weight' || field === 'reps' ? (v ?? 0) : (v ?? null), ...(field === 'weight' && { unit: units.weight }), ...(field === 'distance' && { distanceUnit: units.distance }) }));
              setEdit((e) => e && (error ? { ...e, error } : { ...e, ...draft, error: undefined }));
              if (error) AccessibilityInfo.announceForAccessibility(error);
              return !error;
            }}
            onDone={() => setEdit(null)}
          />
        )}
      </BottomSheet>
    </View>
  );
}

function Totals({ workout }: { workout: ReturnType<typeof ops.getWorkout> }) {
  'use no memo';
  const w = ops.workoutSummary(db, workout.id);
  return (
    <>
      <Tiles w={w} />
      <MusclesWorked muscles={w.muscles} />
    </>
  );
}

export function ExercisePicker({ exclude, onPick, onFocus, create = true }: { exclude: string[]; onPick: (exerciseId: string) => void; onFocus?: () => void; create?: boolean }) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [copying, setCopying] = useState(false);
  const [from, setFrom] = useState<{ id: string; name: string }>();
  const found = ops.listExercises(db, query, 51 + exclude.length).filter((x) => copying || !exclude.includes(x.id));

  return (
    <Animated.View entering={FadeIn.duration(160)} style={[styles.card, { backgroundColor: c.surface, paddingVertical: space.xs }]}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        onFocus={onFocus}
        placeholder="Search exercises"
        placeholderTextColor={c.faint}
        accessibilityLabel="Search exercises"
        autoCorrect={false}
        style={[styles.note, { backgroundColor: c.raised, color: c.text, marginBottom: space.xs }]}
      />
      {copying && <Txt variant="meta" tone="muted" style={{ marginBottom: space.xs }}>Tap the exercise to start from.</Txt>}
      {found
        .slice(0, 50)
        .map((x) => (
          <Row
            key={x.id}
            title={x.name}
            meta={[modeNames[x.mode], equipment(x.source, x.equipment) ?? (x.source && 'catalog'), !x.source && 'custom'].filter(Boolean).join(' · ')}
            icon={copying ? CopyIcon : PlusIcon}
            onPress={() => (copying ? (setFrom(x), setCopying(false)) : onPick(x.id))}
          />
        ))}
      {(found.length > 50 || !found.length) && (
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>
          {found.length ? 'Showing the first 50. Keep typing to narrow.' : create ? 'No match. Create it below.' : 'No match.'}
        </Txt>
      )}
      {create && (
        <>
          <Txt variant="caps" tone="muted" style={{ marginTop: space.l }}>New exercise</Txt>
          <Tap
            accessibilityLabel={`Start from ${from?.name ?? 'Blank'}, change`}
            accessibilityState={{ expanded: copying }}
            onPress={() => setCopying(!copying)}
            style={[styles.bar, { backgroundColor: c.raised, marginBottom: space.xs }, copying && { borderWidth: 2, borderColor: c.text }]}
          >
            <Txt variant="label">Start from</Txt>
            <Txt variant="meta" tone="muted">{from?.name ?? 'Blank'}</Txt>
          </Tap>
          {from && (
            <Tap onPress={() => setFrom(undefined)} style={{ alignSelf: 'flex-start', marginBottom: space.xs }}>
              <Txt variant="meta" tone="muted">Start blank</Txt>
            </Tap>
          )}
          <NewExercise key={from?.id} from={from?.id} onFocus={onFocus} onCreate={onPick} />
        </>
      )}
    </Animated.View>
  );
}

const draft = (exerciseId?: string) => {
  if (!exerciseId) return { name: '', mode: 'reps' as Mode, equipment: '', muscles: {} as Record<string, Role> };
  const { name, mapping, equipment, ...copied } = ops.exerciseDraft(db, exerciseId);
  return { ...copied, name: `${name} (copy)`, equipment: equipment ?? '', muscles: Object.fromEntries(mapping.map((m) => [m.muscle, m.role])) as Record<string, Role> };
};

export function NewExercise({ from, onCreate, onFocus }: { from?: string; onCreate: (exerciseId: string) => void; onFocus?: () => void }) {
  const c = useColors();
  const [custom, setCustom] = useState<ReturnType<typeof draft> & { error?: string }>(() => draft(from));

  const addCustom = () => {
    try {
      const mapping = Object.entries(custom.muscles).map(([muscle, role]) => ({ muscle, role }));
      onCreate(ops.createExercise(db, custom.name, mapping, custom));
      setCustom(draft());
    } catch (error) {
      setCustom({ ...custom, error: /UNIQUE/.test(String(error)) ? 'That exercise already exists.' : (error as Error).message });
    }
  };

  return (
    <>
      <TextInput
        value={custom.name}
        onChangeText={(name) => setCustom({ ...custom, name, error: undefined })}
        onFocus={onFocus}
        placeholder="Name"
        placeholderTextColor={c.faint}
        accessibilityLabel="New exercise name"
        style={[styles.note, { backgroundColor: c.raised, color: c.text }]}
      />
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {modes.map((mode) => (
          <Chip key={mode} label={modeNames[mode]} selected={custom.mode === mode} onPress={() => setCustom({ ...custom, mode })} />
        ))}
      </View>
      <TextInput
        value={custom.equipment}
        onChangeText={(equipment) => setCustom({ ...custom, equipment })}
        onFocus={onFocus}
        placeholder="Equipment"
        placeholderTextColor={c.faint}
        accessibilityLabel="New exercise equipment"
        style={[styles.note, { backgroundColor: c.raised, color: c.text, marginTop: space.s }]}
      />
      <Txt variant="caps" tone="muted" style={{ marginTop: space.m }}>Muscles · tap for primary, again for secondary</Txt>
      <View style={styles.chips}>
        {[...new Set([...muscles, ...Object.keys(custom.muscles)])].map((muscle) => {
          const role = custom.muscles[muscle];
          const select = () => {
            const { [muscle]: _, ...rest } = custom.muscles;
            const next = nextRole[role ?? 'none'];
            setCustom({ ...custom, muscles: next === 'none' ? rest : { ...rest, [muscle]: next } });
          };
          return <Chip key={muscle} label={role ? `${muscle} · ${role}` : muscle} selected={!!role} role="button" onPress={select} />;
        })}
      </View>
      {custom.error && <Txt variant="meta" style={{ marginTop: space.s }}>{custom.error}</Txt>}
      <Tap onPress={addCustom} style={[styles.action, { borderColor: c.line, marginVertical: space.s }]}>
        <Txt variant="label">Add new exercise</Txt>
      </Tap>
    </>
  );
}

export function ExerciseNote({ exerciseId, name, note, onFocus, save = (op) => op() }: { exerciseId: string; name: string; note: string | null; onFocus?: () => void; save?: (op: () => unknown) => void }) {
  const c = useColors();
  return (
    <TextInput
      defaultValue={note ?? ''}
      onChangeText={(t) => save(() => ops.setExerciseNote(db, exerciseId, t))}
      onFocus={onFocus}
      placeholder="Note for every workout"
      placeholderTextColor={c.faint}
      accessibilityLabel={`${name} note for every workout`}
      multiline
      style={[styles.exerciseNote, { color: c.text }]}
    />
  );
}

export function ExerciseHistory({ name, mode, workout }: { name: string; mode: Mode; workout?: ReturnType<typeof ops.getWorkout> }) {
  'use no memo';
  const c = useColors();
  const { units } = usePrototype();
  const w = (set: LoggedSet) => inUnit(set, units).weight;
  const [all, setAll] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [seen, setSeen] = useState(workout);
  const [p, setP] = useState(() => ops.progress(db, name));
  if (seen !== workout) {
    setSeen(workout);
    setP(ops.progress(db, name));
  }
  const max = (weight: number) => p.estimate && inUnit({ ...p.estimate.set, weight }, units).weight.toFixed(1);
  const when = (date: string, workoutId: string) => (workoutId === workout?.id ? `${dayLabel(parseDate(date))} · this workout` : dayLabel(parseDate(date)));
  const sets = (list: LoggedSet[], mark?: string) =>
    list
      .filter((s) => s.completed)
      .map((s) => `${describeSet(s, mode, units)}${s.type === 'warm-up' ? ' warm-up' : ''}${s.id === mark ? ' ◆' : ''}`)
      .join(', ') || 'no completed sets';
  const records =
    mode === 'reps'
      ? [
          p.weight && { label: 'Best weight', meta: `${w(p.weight.set)} ${units.weight} × ${p.weight.set.reps}`, hit: p.weight },
          p.estimate && { label: p.estimate.set.bodyWeight ? 'Best e1RM with body weight' : 'Best e1RM', meta: `${inUnit({ ...p.estimate.set, weight: p.estimate.value }, units).weight.toFixed(1)} ${units.weight} · ${w(p.estimate.set)} × ${p.estimate.set.reps}`, hit: p.estimate },
          ...p.reps.map((r) => ({ label: `Best reps at ${w(r.set)} ${units.weight}`, meta: `${r.set.reps} reps`, hit: r })),
        ].filter((r) => !!r)
      : mode === 'duration'
        ? [
            p.longest && { label: 'Longest hold', meta: `${clock(p.longest.set.duration ?? 0)} at ${w(p.longest.set)} ${units.weight}`, hit: p.longest },
            ...p.holds.map((r) => ({ label: `Longest at ${w(r.set)} ${units.weight}`, meta: clock(r.set.duration ?? 0), hit: r })),
          ].filter((r) => !!r)
        : [];
  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ marginTop: space.m, gap: space.xs }}>
      {p.sessions.length === 0 && <Txt variant="meta" tone="muted">No finished sessions yet.</Txt>}
      {records.map((r) => {
        const source = p.sessions.find((x) => x.workoutId === r.hit.workoutId)!;
        const id = `${r.label} ${r.hit.set.id}`;
        return (
          <View key={id}>
            <Row title={r.label} meta={`${r.meta} · ${when(r.hit.date, r.hit.workoutId)}`} expanded={shown === id} onPress={() => setShown(shown === id ? null : id)} />
            {shown === id && (
              <Txt variant="meta" style={{ paddingVertical: space.s }}>
                {source.name} · {sets(source.sets, r.hit.set.id)}
              </Txt>
            )}
          </View>
        );
      })}
      {p.estimate && (
        <View accessible accessibilityLabel={`Rep maxes from best e1RM: ${p.maxes.map((m) => `${m.reps} reps about ${max(m.weight)} ${units.weight}`).join(', ')}`} style={[styles.maxes, { borderColor: c.line }]}>
          <Txt variant="meta" tone="muted" style={{ width: '100%' }}>Rep maxes from best e1RM, {units.weight}{p.estimate.set.bodyWeight ? ' with body weight' : ''}</Txt>
          {p.maxes.map((m) => (
            <View key={m.reps} style={{ flexGrow: 1, minWidth: 64 }}>
              <Txt variant="caps" tone="muted">{m.reps}RM</Txt>
              <Txt variant="label">≈ {max(m.weight)}</Txt>
            </View>
          ))}
        </View>
      )}
      {mode === 'reps' && <Txt variant="meta" tone="muted">Records use completed sets and exclude warm-ups. e1RM = {p.estimate?.set.bodyWeight ? '(body weight + weight)' : 'weight'} × (1 + reps / 30); rep maxes ≈ e1RM ÷ (1 + reps / 30). ◆ marks the record set.</Txt>}
      {mode === 'duration' && <Txt variant="meta" tone="muted">Records use completed sets and exclude warm-ups. ◆ marks the record set.</Txt>}
      {(all ? p.sessions : p.sessions.slice(0, 10)).map((x) => (
        <View key={x.workoutId} style={{ paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.line }}>
          <Txt variant="label">{when(x.date, x.workoutId)}</Txt>
          <Txt variant="meta" tone="muted">{sets(x.sets)}</Txt>
        </View>
      ))}
      {p.sessions.length > 10 && (
        <Tap onPress={() => setAll(!all)} style={[styles.action, { borderColor: c.line }]}>
          <Txt variant="label" tone="muted">{all ? 'Recent sessions' : `All ${p.sessions.length} sessions`}</Txt>
        </Tap>
      )}
    </Animated.View>
  );
}

type SetRowProps = {
  label: string;
  n: number;
  set: LoggedSet & { pace: number | null };
  pr: boolean;
  prev?: SetFields;
  next?: SetFields;
  mode: Mode;
  defaultRest: number;
  onDelete: () => void;
  onComplete: () => void;
  onChange: (patch: Partial<LoggedSet>) => void;
  editing: Edit | null;
  onEdit: (field: Exclude<Editable, 'bar'> | null) => void;
  onReveal: (bottom: number) => void;
  bodyWeight?: number | null;
  kit?: Kit;
  usual?: SetFields[][];
  flagged: boolean;
};

const ACTIONS = 112;
const popIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.8 }] },
  55: { opacity: 1, transform: [{ scale: 1.12 }], easing: Easing.bezier(0.23, 1, 0.32, 1) },
  100: { transform: [{ scale: 1 }], easing: Easing.bezier(0.77, 0, 0.175, 1) },
}).duration(320).delay(160);
const fieldNames: Record<OptionalField, string> = { targetRpe: 'Target RPE', rpe: 'RPE', rest: 'Rest', comment: 'Comment', plates: 'Plates' };

export const setLabel = (sets: { type: string }[], j: number) =>
  sets[j].type === 'warm-up' ? 'W' : sets[j].type === 'drop' ? 'D' : String(sets.slice(0, j + 1).filter((x) => x.type === 'normal').length);

function Undo({ onUndo }: { onUndo: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)}>
      <Tap accessibilityLabel="Set deleted, undo" onPress={onUndo} style={[styles.set, { justifyContent: 'space-between' }]}>
        <Txt variant="meta" tone="muted">Set deleted</Txt>
        <Txt variant="label">Undo</Txt>
      </Tap>
    </Animated.View>
  );
}

function SetRow({ label, n, set, pr, prev, mode, defaultRest, next, onDelete, onComplete, onChange, editing, onEdit, onReveal, bodyWeight, kit, usual, flagged }: SetRowProps) {
  const fields = useRef<Partial<Record<Editable, View | null>>>({});
  const editingField = editing?.field;
  useEffect(() => {
    if (!editingField) return;
    const id = requestAnimationFrame(() => fields.current[editingField]?.measureInWindow((_x, y, _w, h) => onReveal(y + h)));
    return () => cancelAnimationFrame(id);
  }, [editingField, onReveal]);
  const c = useColors();
  const { units } = usePrototype();
  const speed = mode === 'distance' ? set.pace : null;
  const visible = shownFields(set);
  const [picking, setPicking] = useState(false);
  const rows = (['targetRpe', 'rpe', 'rest'] as const).filter((f) => visible.includes(f));
  const pick = () => {
    if (picking && rows.some((f) => f === editing?.field)) onEdit(null);
    setPicking(!picking);
  };
  const toggle = (field: OptionalField) => {
    if (editing?.field === field && visible.includes(field)) onEdit(null);
    onChange({ fields: optionalFields.filter((f) => (f === field) !== visible.includes(f)).join(',') });
  };
  const weight = editing?.field === 'weight' ? Number(editing.text) || 0 : set.weight;
  const found = usual && unusual(set, usual);
  // Not while typing that field: its first digit alone would flag.
  const odd = found && editing?.field !== found.field ? found : null;
  const oddText = odd && (odd.field === 'weight' ? `Unusual · your usual is ${convert(odd.usual, 'kg', units.weight)} ${units.weight}` : `Unusual · ${odd.last} reps last time at ${set.weight} ${units.weight}`);
  const load = visible.includes('plates') && kit && weight > 0 ? loadPlates(weight, kit) : null;
  const plates = load && `${load.side.length ? `Per side ${load.side.join(' · ')}` : 'Bar only'}${load.weight === weight ? '' : ` (${load.weight} ${units.weight})`}`;
  const x = useSharedValue(0);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const reduce = useReducedMotion();
  const warnings = [oddText, flagged && 'Not completed · tap Finish again to finish anyway'].filter((w): w is string => !!w);
  const glow = useSharedValue(1);
  const pulse = useAnimatedStyle(() => ({ opacity: glow.get() }));
  const warned = warnings.join();
  useEffect(() => {
    if (warned && !reduce) glow.set(withRepeat(withSequence(withTiming(0.35, { duration: 300 }), withTiming(1, { duration: 300 })), 2));
  }, [warned, reduce, glow]);
  const fill = useSharedValue(set.completed ? 1 : 0);
  useEffect(() => fill.set(reduce ? +set.completed : withTiming(+set.completed, { duration: 240 })), [set.completed, reduce, fill]);
  const [resumes, setResumes] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'active' && setResumes((n) => n + 1));
    return () => sub.remove();
  }, []);
  const sweep = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.get() }] }));
  const ink = set.completed ? c.bg : undefined;
  const soft = `${c.bg}99`;
  const [swipe] = useState(() => {
    let from = 0;
    let past = false;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderGrant: () => {
        from = x.get();
        past = from < -ACTIONS / 2;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        const to = Math.min(0, Math.max(-ACTIONS, from + g.dx));
        x.set(to);
        if (to < -ACTIONS / 2 !== past) {
          past = !past;
          if (alerts().haptics) void Haptics.selectionAsync();
        }
      },
      onPanResponderRelease: (_e, g) => x.set(withTiming(from + g.dx < -ACTIONS / 2 ? -ACTIONS : 0, { duration: 160 })),
      onPanResponderTerminate: () => x.set(withTiming(from, { duration: 160 })),
    });
  });
  const act = (run: () => void) => {
    x.set(0);
    run();
  };
  const shown = (field: Field) => (editing?.field === field ? typed(field, editing.text) : fieldText(field, set[field]));
  const active = (field: Editable) => editing?.field === field && { borderWidth: 2, borderColor: ink || c.text };
  const highlight = (field: Field) => editing?.field === field && editing.fresh && (ink ? { backgroundColor: ink } : { backgroundColor: c.line });
  const target = (field: Field) =>
    editing?.field === field ? null : field === 'reps' && !set.reps && !set.completed && set.targetReps ? String(set.targetReps) : field === 'weight' && !set.weight && bodyWeight !== undefined ? 'BW' : null;
  const cycle = () => onChange({ type: nextType[set.type] });
  const copy = (p: SetFields) => {
    onEdit(null);
    onChange(Object.fromEntries(modeFields[mode].flatMap(([f]) => (f === 'weight' ? ['weight', 'unit'] : f === 'distance' ? ['distance', 'distanceUnit'] : [f]).map((k) => [k, p[k as keyof SetFields]]))));
  };

  return (
    <View style={{ overflow: 'hidden' }}>
      <View style={styles.swipeActions} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Tap accessibilityLabel={`Set ${n} options`} onPress={() => act(pick)} style={[styles.swipeAction, { backgroundColor: c.raised }]}>
          <Icon of={DotsThreeVerticalIcon} />
        </Tap>
        <Tap accessibilityLabel={`Delete set ${n}`} onPress={() => act(onDelete)} style={styles.swipeAction}>
          <Icon of={TrashIcon} tone="danger" />
        </Tap>
      </View>
      <Animated.View {...swipe.panHandlers} style={[{ backgroundColor: c.surface }, slide]}>
        <View key={resumes}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: c.text }, sweep]} />
          <LayoutAnimationConfig skipEntering>
            <View style={styles.set}>
              <Tap
                accessibilityLabel={`Set ${n}, ${set.type}${mode === 'reps' ? ', change type' : ''}`}
                accessibilityState={{ expanded: picking }}
                accessibilityActions={[...(mode === 'reps' ? [{ name: 'activate' }] : []), { name: 'options', label: `${picking ? 'Hide' : 'Choose'} optional fields` }, { name: 'delete', label: 'Delete set' }]}
                onAccessibilityAction={(event) => act(event.nativeEvent.actionName === 'delete' ? onDelete : event.nativeEvent.actionName === 'options' ? pick : cycle)}
                onPress={mode === 'reps' ? cycle : undefined}
                hitSlop={8}
                style={{ width: 28 }}
              >
                <Ink fill={fill} at={0.05} from={c.muted} to={c.bg} variant={set.type === 'normal' ? 'label' : 'small'} numberOfLines={1} adjustsFontSizeToFit style={set.type !== 'normal' && { fontWeight: '700' }}>{label}</Ink>
              </Tap>
              {modeFields[mode].map(([field, fieldUnit], i, all) => (
                <Tap
                  key={field}
                  accessibilityLabel={`Set ${n} ${field}, ${shown(field) || 0}${target(field) ? `, ${field === 'weight' ? 'body weight only' : `target ${target(field)}`}` : ''}`}
                  ref={(node) => { fields.current[field] = node; }}
                  accessibilityState={{ selected: editing?.field === field }}
                  onPress={() => onEdit(field)}
                  style={[styles.field, { backgroundColor: set.completed ? 'transparent' : c.raised }, active(field)]}
                >
                  {odd?.field === field && <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: c.warning }, pulse]} />}
                  <Ink fill={fill} at={(i + 1) / (all.length + 1)} from={target(field) ? c.faint : c.text} to={ink && highlight(field) ? c.text : target(field) ? soft : c.bg} variant="value" numberOfLines={1} adjustsFontSizeToFit style={[styles.fieldText, highlight(field)]}>{target(field) ?? (shown(field) || '0')}</Ink>
                  {target(field) !== 'BW' && <Ink fill={fill} at={(i + 1) / (all.length + 1)} from={c.muted} to={soft} variant="small" style={{ fontWeight: '600' }}>{field === 'weight' ? units.weight : field === 'distance' ? units.distance : fieldUnit}</Ink>}
                </Tap>
              ))}
              {mode === 'check' && <Ink fill={fill} at={0.15} from={c.muted} to={c.bg} variant="meta" style={{ flex: 1 }}>{set.completed ? 'Done' : 'Mark complete'}</Ink>}
              {pr && (
                <Animated.View entering={popIn} accessible accessibilityLabel="Personal record" style={[styles.badge, { backgroundColor: c.bg }]}>
                  <Txt variant="caps">◆ PR</Txt>
                </Animated.View>
              )}
              <Tap
                accessibilityRole="checkbox"
                accessibilityLabel={`Complete set ${n}`}
                accessibilityState={{ checked: set.completed }}
                onPress={onComplete}
                hitSlop={11}
                style={[styles.check, set.completed ? { backgroundColor: c.bg, borderColor: c.bg } : { borderColor: c.faint }]}
              >
                {flagged && <Animated.View pointerEvents="none" style={[styles.ring, { top: -2, left: -2, right: -2, bottom: -2, borderRadius: radius.pill, borderWidth: 3, borderColor: c.warning }, pulse]} />}
                {set.completed && <Icon of={CheckIcon} size="s" />}
              </Tap>
            </View>
          </LayoutAnimationConfig>
          {(prev || bodyWeight !== undefined || plates || warnings.length > 0) && (
            <View style={styles.notes}>
              {warnings.map((warning) => (
                <Animated.View key={warning} style={[styles.prev, { justifyContent: 'center', flexBasis: '100%' }, pulse]}>
                  <Ink fill={fill} at={0.2} from={c.warning} to={soft} variant="small" accessibilityLiveRegion="polite" style={{ fontWeight: '600' }}>{warning}</Ink>
                </Animated.View>
              ))}
              {plates && (
                <View style={[styles.prev, { justifyContent: 'center' }]}>
                  <Ink fill={fill} at={0.2} from={c.muted} to={soft} variant="small" accessibilityLabel={plates.replaceAll(' · ', ', ')}>{plates}</Ink>
                </View>
              )}
              {bodyWeight !== undefined && (
                <Tap
                  accessibilityLabel={`Set ${n} ${bodyWeight == null ? 'no body weight logged, log it' : `plus ${bodyWeight} ${units.weight} body weight, change it`}`}
                  ref={(node) => { fields.current.bodyWeight = node; }}
                  accessibilityState={{ selected: editing?.field === 'bodyWeight' }}
                  onPress={() => onEdit('bodyWeight')}
                  hitSlop={8}
                  style={[styles.prev, styles.bodyWeight, active('bodyWeight')]}
                >
                  <Ink fill={fill} at={0.2} from={c.muted} to={soft} variant="small">
                    {editing?.field === 'bodyWeight' ? `Body weight ${editing.text || '0'} ${units.weight}` : bodyWeight == null ? 'Log body weight' : `+ ${bodyWeight} ${units.weight} body weight`}
                  </Ink>
                </Tap>
              )}
              {prev && (
                <Tap accessibilityLabel={`Set ${n} previous ${describeSet(prev, mode, units)}${next ? `, try ${inUnit(next, units).weight} ${units.weight}` : ''}, copy`} onPress={() => copy(prev)} hitSlop={8} style={styles.prev}>
                  <Ink fill={fill} at={0.2} from={c.muted} to={soft} variant="small">Prev {describeSet(prev, mode, units)}{next ? ` · try ${inUnit(next, units).weight}` : ''}</Ink>
                </Tap>
              )}
            </View>
          )}
          {speed !== null && (
            <Ink fill={fill} at={0.2} from={c.muted} to={soft} variant="meta" style={{ paddingLeft: space.s, paddingBottom: space.s }}>Pace {clock(speed)} /{units.distance}</Ink>
          )}
        </View>
        {picking && (rows.length > 0 || visible.includes('comment')) && (
          <Animated.View entering={FadeIn.duration(160)} style={[styles.group, { backgroundColor: c.line }]}>
            {rows.map((field) => (
              <Tap
                key={field}
                accessibilityLabel={`Set ${n} ${fieldNames[field]}, ${shown(field) || (field === 'rest' ? clock(defaultRest) : 'empty')}`}
                ref={(node) => { fields.current[field] = node; }}
                accessibilityState={{ selected: editing?.field === field }}
                onPress={() => onEdit(field)}
                style={[styles.option, { backgroundColor: c.raised, borderColor: editing?.field === field ? c.text : 'transparent' }]}
              >
                <Txt variant="label" tone="muted">{fieldNames[field]}</Txt>
                <Txt variant="label" style={[{ color: shown(field) ? c.text : c.faint }, highlight(field)]}>
                  {shown(field) || (field === 'rest' ? clock(defaultRest) : '–')}
                </Txt>
              </Tap>
            ))}
            {visible.includes('comment') && (
              <View style={[styles.commentRow, { backgroundColor: c.raised }]}>
                <Txt variant="label" tone="muted" accessibilityElementsHidden importantForAccessibility="no">Comment</Txt>
                <TextInput
                  defaultValue={set.comment ?? ''}
                  onChangeText={(t) => onChange({ comment: t })}
                  onFocus={() => onEdit(null)}
                  placeholder="Add a comment"
                  placeholderTextColor={c.faint}
                  accessibilityLabel={`Set ${n} comment`}
                  multiline
                  style={[type.body, styles.commentInput, { color: c.text }]}
                />
              </View>
            )}
          </Animated.View>
        )}
        {picking && (
          <Animated.View entering={FadeIn.duration(160)} accessibilityLabel={`Set ${n} fields`} style={styles.options}>
            {optionalFields.filter((f) => f !== 'plates' || kit).map((field) => (
              <Chip key={field} role="checkbox" label={fieldNames[field]} selected={visible.includes(field)} onPress={() => toggle(field)} />
            ))}
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.m, marginTop: space.l, marginBottom: space.l },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  pencil: { width: touch.min, alignItems: 'center' },
  rename: { padding: 0, borderBottomWidth: 1 },
  minimise: { width: touch.min, height: touch.min, borderRadius: radius.pill, alignItems: 'center' },
  finish: { paddingHorizontal: 18, borderRadius: radius.pill },
  date: { flexDirection: 'row', alignItems: 'center' },
  step: { minWidth: touch.min, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.l, paddingHorizontal: 18, paddingVertical: space.l, marginTop: space.s + 2 },
  collapsed: { flexDirection: 'row', alignItems: 'center' },
  exerciseHead: { flexDirection: 'row', alignItems: 'center', columnGap: space.s, minHeight: 32 },
  menu: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', marginVertical: -space.s, marginRight: -space.m },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: radius.s, paddingHorizontal: space.m, minHeight: touch.min },
  swipeActions: { position: 'absolute', right: 0, top: 0, bottom: 0, width: ACTIONS, flexDirection: 'row', gap: space.xs, paddingVertical: space.s },
  swipeAction: { flex: 1, alignItems: 'center', borderRadius: radius.s },
  notes: { flexDirection: 'row', flexWrap: 'wrap', marginTop: -space.s, paddingBottom: space.xs },
  bodyWeight: { paddingLeft: space.s, borderRadius: radius.s },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.s, paddingVertical: 2 },
  prev: { alignSelf: 'flex-start', minHeight: 28, paddingLeft: space.s, paddingRight: space.m },
  set: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 68, paddingHorizontal: space.s },
  field: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', borderRadius: radius.s, minHeight: 46, paddingTop: 11 },
  fieldText: { includeFontPadding: false, textAlign: 'right', minWidth: 32, maxWidth: 64, padding: 0, marginRight: 3 },
  fill: { top: 1, bottom: 1, borderRadius: radius.s, transformOrigin: 'left' },
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.s, borderWidth: 2 },
  check: { width: 22, height: 22, minHeight: 22, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingTop: space.m, paddingBottom: space.m },
  group: { gap: 1, borderRadius: radius.s, marginTop: space.s, overflow: 'hidden' },
  option: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: touch.min, paddingHorizontal: space.m - 2, borderWidth: 2 },
  commentRow: { gap: space.xs, paddingHorizontal: space.m, paddingTop: space.m },
  commentInput: { minHeight: touch.min, padding: 0, paddingBottom: space.m },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  maxes: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.xs, paddingVertical: space.s, borderTopWidth: StyleSheet.hairlineWidth },
  action: { flexGrow: 1, minWidth: touch.min, alignItems: 'center', borderRadius: radius.s, borderWidth: 1, borderStyle: 'dashed' },
  done: { marginHorizontal: space.m, minHeight: touch.primary, borderRadius: radius.l, alignItems: 'center', justifyContent: 'center' },
  iconAction: { flexDirection: 'row', justifyContent: 'center', gap: space.xs },
  dock: { position: 'absolute', left: 0, right: 0, gap: space.s },
  rest: { marginHorizontal: space.m, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.m, borderRadius: radius.l, padding: space.l },
  exerciseNote: { paddingVertical: space.s, minHeight: touch.min, ...type.meta, fontWeight: '500' },
  note: { borderRadius: radius.s, paddingHorizontal: space.m, minHeight: touch.min, ...type.input, marginTop: space.s },
  chip: { paddingHorizontal: space.m, borderRadius: radius.pill },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  picture: { flex: 1, aspectRatio: 3 / 2, borderRadius: radius.s },
  pills: { flexDirection: 'row', gap: space.m },
  pill: { paddingHorizontal: space.l, borderRadius: radius.pill, borderWidth: 1.5 },
});

export function Chip({ label, selected, onPress, role = 'radio' }: { label: string; selected: boolean; onPress: () => void; role?: 'radio' | 'checkbox' | 'button' }) {
  const c = useColors();
  return (
    <Tap
      accessibilityRole={role}
      accessibilityState={role === 'button' ? { selected } : { checked: selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.accent : c.raised }]}
    >
      <Txt variant="label" tone={selected ? 'onAccent' : 'muted'}>{label}</Txt>
    </Tap>
  );
}
