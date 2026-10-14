import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Image, KeyboardAvoidingView, Modal, StyleSheet, TextInput, View } from 'react-native';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Canvas, Circle, DashPathEffect, Path, Skia } from '@shopify/react-native-skia';
import Animated, { FadeIn, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import * as measures from '@/domain/measurements';
import { addDays, convert, type Unit } from '@/domain/rules';
import { db } from '@/platform/db';
import { addPhoto, deletePhoto, photoUri } from '@/platform/photos';

import { ActiveStrip, dayLabel, parseDate, Row, Section } from './home';
import { parse, type Draft } from './draft';
import { Keypad } from './keypad';
import { today } from './plan';
import { BottomSheet, Reveal, RevealScroll } from './sheet';
import { Icon, radius, space, Tap, touch, Txt, type, useColors, usePrototype } from './theme';
import { Chip } from './workout';

type Series = Pick<ReturnType<typeof measures.listSeries>[number], 'name' | 'preset' | 'kind' | 'method' | 'entries'>;
type Entry = Series['entries'][number];

const bands: Record<string, [number, number, number]> = {
  neck: [31, 21, 10],
  chest: [19.5, 36, 33],
  waist: [20.5, 58, 31],
  hips: [19.5, 78, 33],
  'upper-arm': [6, 38, 9.5],
  forearm: [6, 66, 8],
  thigh: [20, 98, 15],
  calf: [22.5, 126, 11],
};

const listSeries = (to: Record<measures.Kind, Unit>) =>
  measures.listSeries(db).map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, value: convert(e.value, e.unit as Unit, to[s.kind]), unit: to[s.kind] })) }));

const useSeries = () => {
  const { units } = usePrototype();
  const [series, setSeries] = useState(() => listSeries(units));
  const reload = useCallback(() => setSeries(listSeries(units)), [units]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'active' && reload());
    return () => sub.remove();
  }, [reload]);
  useFocusEffect(reload);
  return [series, reload] as const;
};

export function Measurements() {
  const c = useColors();
  const [series] = useSeries();
  const [open, setOpen] = useState<string | null>(null);
  const last = series.flatMap((s) => s.entries.map((e) => e.date)).sort().at(-1);
  const starred = series.filter((s) => s.starred && s.entries.length);
  const logged = starred.length ? starred : series.filter((s) => s.entries.at(-1)?.date === last);

  return (
    <Section
      title="Measurements"
      action={
        <Tap accessibilityLabel="Log measurements" onPress={() => router.push('/log-measurements')} style={[styles.add, { backgroundColor: c.raised }]}>
          <Icon of={PlusIcon} />
        </Tap>
      }
    >
      {last && <Txt variant="meta" tone="muted" style={styles.last}>Last measured {dayLabel(parseDate(last))}</Txt>}
      {!last && <Txt variant="meta" tone="muted">Track body weight, waist, arms and more. Guides show where to put the tape.</Txt>}
      {logged.map((s) => {
        const latest = s.entries.at(-1)!;
        const previous = s.entries.at(-2);
        const change = previous && latest.value - previous.value;
        return (
          <View key={s.id}>
            <Row
              title={s.name}
              meta={`${latest.date === last ? '' : `${dayLabel(parseDate(latest.date))} · `}${latest.value} ${latest.unit}${previous ? ` · ${change! >= 0 ? '+' : '−'}${Math.abs(change!).toFixed(1)} since ${dayLabel(parseDate(previous.date))}` : ''}`}
              expanded={open === s.id}
              onPress={() => setOpen(open === s.id ? null : s.id)}
            />
            {open === s.id && <MeasurementGuide series={s} />}
          </View>
        );
      })}
      {series.length > 0 && (
        <Tap onPress={() => router.push('/measurements')} style={[styles.ghost, { borderColor: c.line }]}>
          <Txt variant="label">View all</Txt>
        </Tap>
      )}
    </Section>
  );
}

export function Page({ title, center, scrollEnabled, children }: { title: string; center?: boolean; scrollEnabled?: boolean; children: ReactNode }) {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ActiveStrip />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <RevealScroll scrollEnabled={scrollEnabled}>
        <View style={styles.header}>
          <Tap accessibilityLabel="Back" onPress={() => router.back()} style={[styles.back, { backgroundColor: c.surface }]}>
            <Icon of={CaretLeftIcon} tone="muted" />
          </Tap>
          <Txt variant="heading" accessibilityRole="header" tone={center ? 'muted' : 'text'} style={{ flex: 1, textAlign: center ? 'center' : 'left' }}>{title}</Txt>
          {center && <View style={styles.back} />}
        </View>
        {children}
      </RevealScroll>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AllMeasurements() {
  const c = useColors();
  const [series, reload] = useSeries();
  const [months, setMonths] = useState(() => measures.progress(db));
  const [open, setOpen] = useState<string | null>(null);
  const run = (write: () => void) => {
    write();
    reload();
    setMonths(measures.progress(db));
  };
  useFocusEffect(useCallback(() => setMonths(measures.progress(db)), []));

  return (
    <Page title="Measurements">
      {months.length > 0 && <Progress months={months} onChange={run} />}
      <Section title={`${series.length} tracked`}>
        {!series.length && <Txt variant="meta" tone="muted">No measurements yet.</Txt>}
        {series.map((s) => {
          const latest = s.entries.at(-1);
          const change = latest && s.entries.length > 1 ? latest.value - s.entries[0].value : null;
          return (
            <View key={s.id}>
              <View style={{ flexDirection: 'row' }}>
                <Tap accessibilityRole="switch" accessibilityLabel={`Star ${s.name}`} accessibilityState={{ checked: s.starred }} onPress={() => run(() => measures.starSeries(db, s.id, !s.starred))} style={[styles.star, { borderColor: c.line }]}>
                  <Icon of={StarIcon} tone={s.starred ? 'text' : 'faint'} filled={s.starred} />
                </Tap>
                <View style={{ flex: 1 }}>
                  <Row
                    title={s.name}
                    meta={!latest ? 'No entries' : `${latest.value} ${latest.unit}${change === null ? '' : ` · ${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} over ${s.entries.length} entries`}`}
                    expanded={open === s.id}
                    onPress={() => setOpen(open === s.id ? null : s.id)}
                  />
                </View>
              </View>
              {open === s.id && (
                <>
                  <MeasurementGuide series={s} />
                  <Entries
                    series={s}
                    onChange={run}
                    onDelete={() => {
                      run(() => measures.deleteSeries(db, s.id));
                      setOpen(null);
                    }}
                  />
                </>
              )}
            </View>
          );
        })}
      </Section>
    </Page>
  );
}

type Custom = { name: string; kind: measures.Kind; method: string };

export function LogMeasurements() {
  const c = useColors();
  const { units } = usePrototype();
  const [series] = useState(() => listSeries(units));
  const [date, setDate] = useState(today());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [custom, setCustom] = useState<Custom>({ name: '', kind: 'length', method: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigation = useNavigation();
  const untracked = measures.presets.filter((p) => !series.some((s) => s.preset === p.key));
  const targets: [string, measures.Target][] = [
    ...series.map((s): [string, measures.Target] => [s.id, { id: s.id }]),
    ...untracked.map((p): [string, measures.Target] => [p.key, { preset: p.key }]),
    ['custom', { custom }],
  ];
  const entries = targets.flatMap(([key, target]) => {
    const value = parse(drafts[key]?.text ?? '');
    return value && value > 0 ? [{ series: target, value }] : [];
  });
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!entries.length) return;
        try {
          measures.logMeasurements(db, entries, date);
        } catch (e) {
          event.preventDefault();
          setError((e as Error).message);
          AccessibilityInfo.announceForAccessibility((e as Error).message);
        }
      }),
    [navigation, entries, date],
  );
  const part = (key: string, s: Series) => {
    const draft = drafts[key] ?? blank;
    const unit = units[s.kind];
    const value = parse(draft.text);
    const shown = value && value > 0 ? { ...s, entries: [...s.entries, { id: 'draft', date, value, unit }].sort((a, b) => a.date.localeCompare(b.date)) } : s;
    return (
      <View key={key}>
        <Row title={s.name} meta={draft.text ? `${draft.text} ${unit}` : unit} expanded={open === key} onPress={() => setOpen(open === key ? null : key)} />
        {open === key && (
          <MeasurementGuide series={shown}>
            {key === 'custom' && <CustomSeries draft={custom} onChange={(d) => {
              setCustom(d);
              setError(null);
            }} />}
            <View style={styles.entry}>
              <Field name={s.name} unit={unit} hint={s.entries.at(-1)?.value} draft={draft} onChange={(d) => {
                setDrafts({ ...drafts, [key]: d });
                setError(null);
              }} />
            </View>
          </MeasurementGuide>
        )}
      </View>
    );
  };

  return (
    <Page title="Log measurements">
      <Section title="Date">
        <DateStep date={date} onChange={setDate} />
      </Section>
      <Section title="Photos">
        <Photos key={date} date={date} />
      </Section>
      <Section title="Measurements">
        {series.map((s) => part(s.id, s))}
        {untracked.map((p) => part(p.key, { ...p, preset: p.key, method: p.guide, entries: [] }))}
        {part('custom', { name: custom.name.trim() || 'Custom', preset: null, kind: custom.kind, method: custom.method.trim() ? [custom.method.trim()] : [], entries: [] })}
      </Section>
      {error && <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.m }}>{error}</Txt>}
      <Tap
        accessibilityLabel={`Save ${entries.length} measurement${entries.length === 1 ? '' : 's'}`}
        accessibilityState={{ disabled: !entries.length }}
        disabled={!entries.length}
        onPress={() => router.back()}
        style={[styles.primary, { backgroundColor: c.accent, opacity: entries.length ? 1 : 0.4 }]}
      >
        <Txt tone="onAccent" variant="label">{entries.length ? `Save ${entries.length}` : 'Save'}</Txt>
      </Tap>
    </Page>
  );
}

function CustomSeries({ draft, onChange }: { draft: Custom; onChange: (draft: Custom) => void }) {
  const c = useColors();
  const { units } = usePrototype();
  return (
    <>
      <TextInput
        value={draft.name}
        onChangeText={(name) => onChange({ ...draft, name })}
        placeholder="Name"
        placeholderTextColor={c.faint}
        accessibilityLabel="Measurement name"
        style={[styles.text, { backgroundColor: c.raised, color: c.text }]}
      />
      <View accessibilityRole="radiogroup" style={styles.chips}>
        <Chip label={`Length · ${units.length}`} selected={draft.kind === 'length'} onPress={() => onChange({ ...draft, kind: 'length' })} />
        <Chip label={`Weight · ${units.weight}`} selected={draft.kind === 'weight'} onPress={() => onChange({ ...draft, kind: 'weight' })} />
      </View>
      <TextInput
        value={draft.method}
        onChangeText={(method) => onChange({ ...draft, method })}
        placeholder="Method: where, posture, relaxed or flexed"
        placeholderTextColor={c.faint}
        multiline
        accessibilityLabel="Method note"
        style={[styles.text, { backgroundColor: c.raised, color: c.text }]}
      />
    </>
  );
}

const cap = (x1: number, y1: number, w1: number, x2: number, y2: number, w2: number) =>
  `M${x1 - w1 / 2} ${y1}A${w1 / 2} ${w1 / 2} 0 0 1 ${x1 + w1 / 2} ${y1}L${x2 + w2 / 2} ${y2}A${w2 / 2} ${w2 / 2} 0 0 1 ${x2 - w2 / 2} ${y2}Z`;
const body = [
  'M36 20L39.5 20L40 25C47 26 52 26 52.5 31L51.5 58L52.5 87L19.5 87L20.5 58L19.5 31C20 26 25 26 32 25L32.5 20Z',
  ...[1, -1].flatMap((s) => [cap(36 - s * 25, 31, 10, 36 - s * 26.5, 82, 7), cap(36 - s * 9, 92, 16, 36 - s * 7.5, 144, 9)]),
].join('');

function Figure({ preset }: { preset: string }) {
  const c = useColors();
  const part = preset.replace(/^(left|right)-/, '');
  if (!bands[part]) return null;
  const [x, y, w] = bands[part];
  const cx = (preset.startsWith('left-') ? 72 - x - w : x) + w / 2;
  const rx = w / 2 + 1.5;
  const ring = (sweep: number) => `M${cx - rx} ${y + 2.5}A${rx} 3.2 0 0 ${sweep} ${cx + rx} ${y + 2.5}`;
  return (
    <Canvas style={styles.figure} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle cx={36} cy={9.5} r={9} color={c.line} />
      <Path path={body} color={c.line} />
      <Path path={ring(1)} style="stroke" strokeWidth={1.2} color={c.text} opacity={0.7}>
        <DashPathEffect intervals={[2, 2]} />
      </Path>
      <Path path={ring(0)} style="stroke" strokeWidth={3} strokeCap="round" color={c.text} />
    </Canvas>
  );
}

export function Trend({ series, unit, compact }: { series: { name: string; entries: { date: string; value: number }[] }; unit: string; compact?: boolean }) {
  const c = useColors();
  const { entries } = series;
  const [width, setWidth] = useState(0);
  const drawn = useSharedValue(1);
  const reduce = useReducedMotion();
  const values = entries.map((e) => e.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const time = (e: { date: string }) => parseDate(e.date).getTime();
  const start = time(entries[0]);
  const span = time(entries[entries.length - 1]) - start;
  const height = compact ? sparkHeight : trendHeight;
  const points = entries.map((e) => ({
    x: dot + (span ? (time(e) - start) / span : 0.5) * (width - 2 * dot),
    y: dot + (max > min ? (max - e.value) / (max - min) : 0.5) * (height - 2 * dot),
  }));
  const line = Skia.Path.Make();
  points.forEach(({ x, y }, i) => (i ? line.lineTo(x, y) : line.moveTo(x, y)));
  const last = points[points.length - 1];
  const key = entries.map((e) => `${e.date}${e.value}`).join();
  useEffect(() => {
    if (reduce) return;
    drawn.set(0);
    drawn.set(withTiming(1, { duration: 400 }));
  }, [key, reduce, drawn]);
  const ends = [entries[0], entries[entries.length - 1]].map((e) => dayLabel(parseDate(e.date)));

  return (
    <View
      accessible={!compact}
      accessibilityLabel={`${series.name} trend, ${ends[0]} ${entries[0].value} to ${ends[1]} ${entries[entries.length - 1].value} ${unit}, range ${min} to ${max}`}
      style={{ marginVertical: space.s }}
    >
      <View style={{ flexDirection: 'row', gap: space.m }}>
        {/* Canvas onLayout and onSize are unreliable on Fabric; measure the wrapper instead. */}
        <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <Canvas style={{ height }}>
            <Path path={line} style="stroke" strokeWidth={4} strokeJoin="round" strokeCap="round" color={c.heat[2]} end={drawn} />
            {points.slice(0, -1).map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={dot} color={c.heat[3]} />
            ))}
            <Circle cx={last.x} cy={last.y} r={dot} color={c.text} />
          </Canvas>
        </View>
        {!compact && (
          <View style={{ height, justifyContent: 'space-between' }}>
            <Txt variant="meta" tone="muted">{max}</Txt>
            <Txt variant="meta" tone="muted">{min}</Txt>
          </View>
        )}
      </View>
      {!compact && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s }}>
          {ends.map((d, i) => (
            <Txt key={i} variant="meta" tone="muted">{d}</Txt>
          ))}
        </View>
      )}
    </View>
  );
}

function MeasurementGuide({ series, children }: { series: Series; children?: ReactNode }) {
  const c = useColors();
  const unit = usePrototype().units[series.kind];

  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ paddingBottom: space.m }}>
      {series.entries.length > 1 && <Trend series={series} unit={unit} />}
      {series.method.length > 0 && (
        <View style={[styles.guide, { backgroundColor: c.raised }]}>
          {series.preset && series.preset !== 'body-weight' && <Figure preset={series.preset} />}
          <View style={{ flex: 1, gap: space.xs }}>
            {series.method.map((step, i) => (
              <Txt key={step} variant="meta">{series.preset ? `${i + 1}. ${step}` : step}</Txt>
            ))}
          </View>
        </View>
      )}
      {!series.method.length && series.entries.length > 0 && (
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>No method note</Txt>
      )}
      {children}
    </Animated.View>
  );
}

const blank: Draft = { text: '', fresh: false };

function Field({ name, unit, hint, keep = false, draft, onChange }: { name: string; unit: string; hint?: number; keep?: boolean; draft: Draft; onChange: (draft: Draft) => void }) {
  const c = useColors();
  const [entering, setEntering] = useState(false);
  const reveal = useContext(Reveal);
  const field = useRef<View>(null);
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    if (!entering || !sheet) return;
    const id = requestAnimationFrame(() => field.current?.measureInWindow((_x, y, _w, h) => reveal({ bottom: y + h, sheet })));
    return () => cancelAnimationFrame(id);
  }, [entering, sheet, draft.text, reveal]);
  const close = () => {
    setEntering(false);
    reveal(null);
  };
  return (
    <>
      <Tap ref={field} onPress={() => setEntering(true)} style={[styles.input, { backgroundColor: c.raised }]} accessibilityLabel={`${name} in ${unit}, ${draft.text || (keep ? hint : 'empty')}`}>
        <Txt style={[type.value, styles.inputText, { color: draft.text || keep ? c.text : c.faint }]}>{draft.text || String(hint ?? '0')}</Txt>
        <Txt variant="meta" tone="muted">{unit}</Txt>
      </Tap>
      <BottomSheet modal open={entering} onClose={close} onHeight={setSheet}>
        <Keypad title={`${name} · ${draft.text || (keep ? hint : '–')} ${unit}`} decimal draft={draft} onChange={onChange} onDone={close} />
      </BottomSheet>
    </>
  );
}

function ValueEntry({ name, unit, hint, onSave }: { name: string; unit: string; hint: number; onSave: (value: number | undefined) => void }) {
  const c = useColors();
  const [draft, setDraft] = useState(blank);
  const value = parse(draft.text) ?? hint;

  return (
    <View style={styles.entry}>
      <Field name={name} unit={unit} hint={hint} keep draft={draft} onChange={setDraft} />
      <Tap
        accessibilityLabel={`Save ${name}`}
        accessibilityState={{ disabled: !(value > 0) }}
        disabled={!(value > 0)}
        onPress={() => {
          onSave(parse(draft.text));
          setDraft(blank);
        }}
        style={[styles.save, { backgroundColor: c.accent, opacity: value > 0 ? 1 : 0.4 }]}
      >
        <Txt tone="onAccent" variant="label">Save</Txt>
      </Tap>
    </View>
  );
}

function DateStep({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  return (
    <View style={styles.date}>
      <Txt variant="meta" tone="muted" style={{ flex: 1 }}>{dayLabel(parseDate(date))}</Txt>
      <Tap accessibilityLabel="Previous day" onPress={() => onChange(addDays(date, -1))} style={styles.step}>
        <Icon of={CaretLeftIcon} size="s" tone="muted" />
      </Tap>
      <Tap accessibilityLabel="Next day" disabled={date >= today()} onPress={() => onChange(addDays(date, 1))} style={[styles.step, date >= today() && { opacity: 0.3 }]}>
        <Icon of={CaretRightIcon} size="s" tone="muted" />
      </Tap>
    </View>
  );
}

function Entries({ series, onChange, onDelete }: { series: Series; onChange: (write: () => void) => void; onDelete: () => void }) {
  const c = useColors();
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  return (
    <View style={{ paddingBottom: space.m }}>
      {[...series.entries].reverse().map((e) => (
        <View key={e.id}>
          <Row
            title={dayLabel(parseDate(e.date))}
            meta={`${e.value} ${e.unit}`}
            expanded={open === e.id}
            onPress={() => {
              setOpen(open === e.id ? null : e.id);
              setDeleting(false);
            }}
          />
          {open === e.id && (
            <EntryEditor
              name={series.name}
              entry={e}
              onChange={(write) => {
                onChange(write);
                setOpen(null);
                setDeleting(false);
              }}
            />
          )}
        </View>
      ))}
      <View style={styles.chips}>
        <Tap
          accessibilityLabel={deleting ? `Tap again to delete ${series.name} and its entries` : `Delete ${series.name}`}
          onPress={() => (deleting ? onDelete() : setDeleting(true))}
          style={[styles.ghost, { borderColor: c.line }]}
        >
          <Txt variant="label" tone="muted">{deleting ? 'Confirm delete series' : 'Delete series'}</Txt>
        </Tap>
      </View>
    </View>
  );
}

function EntryEditor({ name, entry, onChange }: { name: string; entry: Entry; onChange: (write: () => void) => void }) {
  const c = useColors();
  const [date, setDate] = useState(entry.date);
  const [deleting, setDeleting] = useState(false);
  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ paddingBottom: space.m }}>
      <DateStep date={date} onChange={setDate} />
      <ValueEntry name={`${name}, ${dayLabel(parseDate(date))}`} unit={entry.unit} hint={entry.value} onSave={(v) => onChange(() => measures.editMeasurement(db, entry.id, v, date))} />
      <Tap
        accessibilityLabel={deleting ? `Tap again to delete ${name} entry` : `Delete ${name} entry`}
        onPress={() => (deleting ? onChange(() => measures.deleteMeasurement(db, entry.id)) : setDeleting(true))}
        style={[styles.ghost, { borderColor: c.line }]}
      >
        <Txt variant="label" tone="muted">{deleting ? 'Confirm' : 'Delete entry'}</Txt>
      </Tap>
    </Animated.View>
  );
}

type Month = ReturnType<typeof measures.progress>[number];

function Progress({ months, onChange }: { months: Month[]; onChange: (write: () => void) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const days = (m: Month) => m.days.map((d) => <ProgressDay key={d.date} day={d} onChange={onChange} />);
  return (
    <Section title="Progress">
      {months.length === 1
        ? days(months[0])
        : months.map((m) => (
            <View key={m.month}>
              <Row
                title={parseDate(`${m.month}-01`).toLocaleDateString('en', { month: 'long', year: 'numeric' })}
                meta={`${m.days.length} ${m.days.length === 1 ? 'entry' : 'entries'}`}
                image={m.photo && photoUri(m.photo.file)}
                expanded={open === m.month}
                onPress={() => setOpen(open === m.month ? null : m.month)}
              />
              {open === m.month && days(m)}
            </View>
          ))}
    </Section>
  );
}

function ProgressDay({ day, onChange }: { day: Month['days'][number]; onChange: (write: () => void) => void }) {
  const c = useColors();
  const { units } = usePrototype();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const label = dayLabel(parseDate(day.date));
  const count = `${day.photos.length} photo${day.photos.length === 1 ? '' : 's'}`;
  const values = day.values.map((v) => `${v.name} ${convert(v.value, v.unit as Unit, units[v.kind])} ${units[v.kind]}`).join(' · ');
  return (
    <View>
      <Row
        title={label}
        meta={[values, day.photos.length ? count : ''].filter(Boolean).join(' · ')}
        image={day.photos.length ? photoUri(day.photos.at(-1)!.file) : undefined}
        expanded={day.photos.length ? open : undefined}
        onPress={day.photos.length ? () => setOpen(!open) : undefined}
      />
      {open &&
        day.photos.map((p) => (
          <Animated.View key={p.id} entering={FadeIn.duration(160)} style={{ paddingBottom: space.m }}>
            <Tap accessibilityLabel={`Progress photo, ${label}, open full screen`} onPress={() => setPreview(p.file)}>
              <Image source={{ uri: photoUri(p.file) }} resizeMode="contain" style={[styles.photo, { backgroundColor: c.raised }]} />
            </Tap>
            <Tap
              accessibilityLabel={deleting === p.id ? `Tap again to delete photo from ${label}` : `Delete photo from ${label}`}
              onPress={() => (deleting === p.id ? onChange(() => deletePhoto(p.id)) : setDeleting(p.id))}
              style={[styles.ghost, { borderColor: c.line }]}
            >
              <Txt variant="label" tone="muted">{deleting === p.id ? 'Confirm' : 'Delete photo'}</Txt>
            </Tap>
          </Animated.View>
        ))}
      <Preview file={preview} label={label} onClose={() => setPreview(null)} />
    </View>
  );
}

function Preview({ file, label, onClose }: { file: string | null; label: string; onClose: () => void }) {
  return (
    <Modal visible={!!file} animationType="fade" onRequestClose={onClose}>
      <Tap accessibilityLabel={`Progress photo, ${label}, close`} onPress={onClose} style={styles.preview}>
        {file && <Image source={{ uri: photoUri(file) }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />}
      </Tap>
    </Modal>
  );
}

function Photos({ date }: { date: string }) {
  const c = useColors();
  const list = () => measures.listPhotos(db).filter((p) => p.date === date);
  const [photos, setPhotos] = useState(list);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const label = dayLabel(parseDate(date));
  const remove = (id: string) => {
    setDeleting(null);
    setError(null);
    try {
      deletePhoto(id);
    } catch (e) {
      setError((e as Error).message);
    }
    setPhotos(list());
  };
  const add = (camera: boolean) => {
    setError(null);
    setDeleting(null);
    addPhoto(date, camera).then(
      (added) => added && setPhotos(list()),
      (e: Error) => setError(e.message),
    );
  };
  return (
    <>
      <Txt variant="meta" tone="muted">Saved as you add them. Photos stay in the app, out of your gallery.</Txt>
      {photos.length > 0 && (
        <View style={styles.chips}>
          {photos.map((p) => (
            <View key={p.id}>
              <Tap accessibilityLabel={`Progress photo, ${label}, open full screen`} onPress={() => setPreview(p.file)}>
                <Image source={{ uri: photoUri(p.file) }} resizeMethod="resize" style={[styles.thumb, { backgroundColor: c.raised }]} />
              </Tap>
              <Tap
                accessibilityLabel={deleting === p.id ? `Tap again to delete photo from ${label}` : `Delete photo from ${label}`}
                onPress={() => (deleting === p.id ? remove(p.id) : setDeleting(p.id))}
                style={styles.remove}
              >
                <View style={[styles.removeMark, { backgroundColor: deleting === p.id ? c.accent : c.surface }]}>
                  {deleting === p.id ? <Txt variant="meta" tone="onAccent" style={{ fontWeight: '700' }}>Delete</Txt> : <Icon of={XIcon} size="s" />}
                </View>
              </Tap>
            </View>
          ))}
        </View>
      )}
      <View style={styles.chips}>
        <Tap onPress={() => add(true)} style={[styles.ghost, { borderColor: c.line }]}>
          <Txt variant="label">Take photo</Txt>
        </Tap>
        <Tap onPress={() => add(false)} style={[styles.ghost, { borderColor: c.line }]}>
          <Txt variant="label">Choose photo</Txt>
        </Tap>
      </View>
      {error && <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>{error}</Txt>}
      <Preview file={preview} label={label} onClose={() => setPreview(null)} />
    </>
  );
}

const trendHeight = 64;
const sparkHeight = 28;
const dot = 4;

const styles = StyleSheet.create({
  ghost: { alignSelf: 'flex-start', marginTop: space.m, paddingHorizontal: space.l, borderWidth: 1, borderRadius: radius.pill },
  text: { borderRadius: radius.s, paddingHorizontal: space.m, minHeight: 48, ...type.input, marginTop: space.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  date: { flexDirection: 'row', alignItems: 'center' },
  star: { width: touch.min, alignItems: 'flex-start', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  step: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center' },
  guide: { flexDirection: 'row', gap: space.m, alignItems: 'center', borderRadius: radius.m, padding: space.m, marginTop: space.s },
  figure: { width: 72, height: 150 },
  entry: { flexDirection: 'row', gap: space.s, marginTop: space.m },
  input: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', borderRadius: radius.s, paddingHorizontal: space.m, minHeight: 48 },
  inputText: { flex: 1, minWidth: 0 },
  save: { width: 72, borderRadius: radius.s, alignItems: 'center' },
  add: { width: touch.min, height: touch.min, borderRadius: radius.pill, alignItems: 'center', alignSelf: 'center' },
  last: { marginTop: -space.m, marginBottom: space.s },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.l },
  back: { width: touch.min, height: touch.min, borderRadius: radius.pill, alignItems: 'center' },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.m },
  thumb: { width: 72, height: 96, borderRadius: radius.s },
  remove: { position: 'absolute', top: 0, right: 0, minWidth: touch.min, minHeight: touch.min, alignItems: 'flex-end', justifyContent: 'flex-start' },
  removeMark: { margin: space.xs, minWidth: 24, height: 24, paddingHorizontal: space.xs, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  preview: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 56, borderRadius: radius.pill, alignItems: 'center', marginTop: space.l },
});
