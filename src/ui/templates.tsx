import { createId } from '@paralleldrive/cuid2';
import { useFocusEffect } from 'expo-router';
import { use, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, StyleSheet, TextInput, View } from 'react-native';
import { ArrowDownIcon } from 'phosphor-react-native/src/icons/ArrowDown';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { DotsThreeVerticalIcon } from 'phosphor-react-native/src/icons/DotsThreeVertical';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import Animated, { FadeIn } from 'react-native-reanimated';

import { digitClock, supersetBlocks, timeDigits } from '@/domain/rules';
import * as ops from '@/domain/workouts';
import { db } from '@/platform/db';

import { Row, Section } from './home';
import type { Draft } from './draft';
import { Keypad } from './keypad';
import { BottomSheet, Reveal, SheetHost } from './sheet';
import { describeSet, Icon, inUnit, radius, space, Tap, touch, Txt, type, useColors, usePrototype } from './theme';
import { decimals, entered, ExercisePicker, fieldText, modeFields, modeNames, nextType, setLabel, timeFields, typed, type Field } from './workout';

type Plan = ReturnType<typeof ops.getTemplate>;
type Start = (from: { templateId: string }) => void;
type Edit = Draft & { exercise: number; set: number; field: Field; title: string };

export function Templates({ templates, onStart, onChange }: { templates: ReturnType<typeof ops.listTemplates>; onStart?: Start; onChange: () => void }) {
  const c = useColors();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const create = () => {
    let name = 'New template';
    for (let i = 2; templates.some((t) => t.name === name); i++) name = `New template ${i}`;
    const id = ops.createTemplate(db, name, []);
    setOpen(id);
    setEditing(id);
    onChange();
  };

  return (
    <Section title="Templates">
      {!templates.length && <Txt variant="meta" tone="muted">Plan a workout once and start it in one tap. Finished workouts can be saved as templates from Recent.</Txt>}
      {templates.map((t) => (
        <View key={t.id}>
          <Row
            title={t.name}
            meta={`${t.count} exercise${t.count === 1 ? '' : 's'}`}
            expanded={open === t.id}
            onPress={() => {
              setOpen(open === t.id ? null : t.id);
              setEditing(null);
              onChange();
            }}
          />
          {open === t.id &&
            (editing === t.id ? (
              <TemplateEditor id={t.id} onChange={onChange} onDone={() => { setEditing(null); onChange(); }} />
            ) : (
              <TemplateSummary id={t.id} onStart={onStart} onEdit={() => setEditing(t.id)} onDelete={() => { ops.deleteTemplate(db, t.id); setOpen(null); onChange(); }} />
            ))}
        </View>
      ))}
      <Tap onPress={create} style={[styles.ghost, { borderColor: c.line }]}>
        <Txt variant="label">New template</Txt>
      </Tap>
    </Section>
  );
}

function TemplateSummary({ id, onStart, onEdit, onDelete }: { id: string; onStart?: Start; onEdit: () => void; onDelete: () => void }) {
  const c = useColors();
  const { units } = usePrototype();
  const plan = ops.getTemplate(db, id);
  const [deleting, setDeleting] = useState(false);
  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ paddingBottom: space.m }}>
      {plan.exercises.map((e, i) => (
        <Txt key={i} variant="meta" tone="muted">
          {e.name} · {e.sets.map((s) => describeSet({ ...s, completed: false }, e.mode, units)).join(', ') || 'no sets'}
        </Txt>
      ))}
      {!plan.exercises.length && <Txt variant="meta" tone="muted">No exercises yet.</Txt>}
      <View style={styles.actions}>
        {onStart && (
          <Tap onPress={() => onStart({ templateId: id })} style={[styles.action, { backgroundColor: c.accent, borderColor: c.accent }]}>
            <Txt variant="label" tone="onAccent">Start</Txt>
          </Tap>
        )}
        <Tap onPress={onEdit} style={[styles.action, { borderColor: c.line }]}>
          <Txt variant="label">Edit</Txt>
        </Tap>
        <Tap
          accessibilityLabel={deleting ? `Tap again to delete ${plan.name}` : `Delete ${plan.name}`}
          onPress={() => (deleting ? onDelete() : setDeleting(true))}
          style={[styles.action, { borderColor: c.line }]}
        >
          <Txt variant="label" tone="muted">{deleting ? 'Confirm' : 'Delete'}</Txt>
        </Tap>
      </View>
      {deleting && <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>Workouts started from it are kept. Its planned days are cleared.</Txt>}
    </Animated.View>
  );
}

function TemplateEditor({ id, onChange, onDone }: { id: string; onChange: () => void; onDone: () => void }) {
  const c = useColors();
  const { units } = usePrototype();
  const [plan, setPlan] = useState(() => ops.getTemplate(db, id));
  const [name, setName] = useState(plan.name);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [shown, setShown] = useState(edit);
  if (edit && edit !== shown) setShown(edit);
  const host = use(SheetHost);
  const reveal = use(Reveal);
  const activeField = useRef<View>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const editing = !!edit;
  useEffect(() => {
    if (!edit || !sheetHeight) return;
    const id = requestAnimationFrame(() => activeField.current?.measureInWindow((_x, y, _w, h) => reveal({ bottom: y + h, sheet: sheetHeight })));
    return () => cancelAnimationFrame(id);
  }, [edit, sheetHeight, reveal]);
  useEffect(() => {
    if (editing) return () => reveal(null);
  }, [editing, reveal]);

  const save = (next: Pick<Plan, 'name' | 'exercises'>, refresh = true) => {
    try {
      ops.updateTemplate(db, id, next.name, next.exercises);
      setPlan(ops.getTemplate(db, id));
      setError(null);
      if (refresh) onChange();
      return true;
    } catch (e) {
      setError((e as Error).message);
      AccessibilityInfo.announceForAccessibility((e as Error).message);
      return false;
    }
  };
  const change = (fn: (exercises: Plan['exercises']) => void) => {
    const exercises = structuredClone(plan.exercises);
    fn(exercises);
    save({ name, exercises: supersetBlocks(exercises).flat() });
  };
  const close = () => {
    setEdit(null);
    setError(null);
  };
  const move = (i: number, step: -1 | 1) =>
    change((exercises) => {
      const blocks = supersetBlocks(exercises);
      const from = blocks.findIndex((b) => b.includes(exercises[i]));
      if (blocks[from + step]) [blocks[from], blocks[from + step]] = [blocks[from + step], blocks[from]];
      exercises.splice(0, exercises.length, ...blocks.flat());
    });

  const body = (
    <Animated.View entering={FadeIn.duration(160)} style={{ paddingBottom: space.m }}>
      <TextInput
        value={name}
        onChangeText={(text) => {
          setName(text);
          save({ name: text, exercises: plan.exercises }, false);
        }}
        onBlur={() => {
          if (name.trim() !== plan.name) setName(plan.name);
          onChange();
        }}
        onFocus={() => setEdit(null)}
        placeholder="Template name"
        placeholderTextColor={c.faint}
        accessibilityLabel="Template name"
        style={[styles.input, { backgroundColor: c.raised, color: c.text }]}
      />
      {error && <Txt variant="meta" style={{ marginTop: space.xs }}>{error}</Txt>}
      {plan.exercises.map((e, i) => {
        const blocks = supersetBlocks(plan.exercises);
        const at = blocks.findIndex((b) => b.includes(e));
        const next = plan.exercises.findIndex((x, k) => k > i && (!x.superset || x.superset !== e.superset));
        return (
          <View key={i} style={[styles.card, { backgroundColor: c.raised }, e.superset && { borderLeftWidth: 3, borderLeftColor: c.faint }]}>
            <Txt variant="heading">{e.name}</Txt>
            <Txt variant="meta" tone="muted">{e.mode === 'reps' ? 'Weight × target reps' : modeNames[e.mode]}</Txt>
            {e.sets.map((s, j) => {
              const label = setLabel(e.sets, j);
              const expanded = s.options ?? (s.targetRpe != null || s.rest != null);
              const field = (f: Field) => {
                const active = edit?.exercise === i && edit.set === j && edit.field === f;
                const saved = inUnit(s, units)[f as keyof typeof s] as number | null;
                const text = timeFields.includes(f) ? timeDigits(saved) : String(saved ?? '');
                return { active, text, value: active ? typed(f, edit.text) : fieldText(f, saved) };
              };
              return (
                <View key={j}>
                <View style={styles.set}>
                  <Tap
                    accessibilityLabel={`Set ${j + 1}, ${s.type}, change type`}
                    onPress={() => change((x) => (x[i].sets[j].type = nextType[s.type]))}
                    style={styles.label}
                  >
                    <Txt numberOfLines={1} adjustsFontSizeToFit variant="label" tone="muted">{label}</Txt>
                  </Tap>
                  {modeFields[e.mode].map(([f, fieldUnit]) => {
                    const { active, text, value } = field(f);
                    const unit = f === 'weight' ? units.weight : f === 'distance' ? units.distance : fieldUnit;
                    return (
                      <Tap
                        key={f}
                        ref={active ? activeField : undefined}
                        accessibilityLabel={`Set ${j + 1} ${f === 'reps' ? 'target reps' : f}, ${value || 'empty'} ${unit}`}
                        onPress={() => setEdit({ exercise: i, set: j, field: f, title: `${e.name} · set ${j + 1}`, text, fresh: true })}
                        style={[styles.field, { backgroundColor: c.surface }, active && { borderWidth: 2, borderColor: c.text }]}
                      >
                        <Txt numberOfLines={1} adjustsFontSizeToFit style={[type.value, { flexShrink: 1 }]}>{value || '–'}</Txt>
                        <Txt variant="meta" tone="muted"> {unit}</Txt>
                      </Tap>
                    );
                  })}
                  {!modeFields[e.mode].length && <Txt variant="meta" tone="muted" style={{ flex: 1 }}>Mark complete</Txt>}
                  <Tap
                    accessibilityLabel={`Set ${j + 1} options`}
                    accessibilityState={{ expanded }}
                    onPress={() => {
                      if (expanded && edit?.exercise === i && edit.set === j) setEdit(null);
                      change((x) => (x[i].sets[j].options = !expanded));
                    }}
                    style={styles.icon}
                  >
                    <Icon of={DotsThreeVerticalIcon} tone="muted" />
                  </Tap>
                  <Tap
                    accessibilityLabel={`Remove set ${j + 1}`}
                    onPress={() => {
                      setEdit(null);
                      change((x) => x[i].sets.splice(j, 1));
                    }}
                    style={styles.label}
                  >
                    <Icon of={XIcon} tone="muted" />
                  </Tap>
                </View>
                {expanded && (
                  <View style={styles.set}>
                    <View style={styles.label} />
                    {([
                      ['targetRpe', 'Target RPE', ''],
                      ['rest', 'Rest', ''],
                    ] as const).map(([f, title, unit]) => {
                      const { active, text, value } = field(f);
                      return (
                        <Tap
                          key={f}
                          ref={active ? activeField : undefined}
                          accessibilityLabel={`Set ${j + 1} ${title}, ${value || 'empty'}`}
                          onPress={() => setEdit({ exercise: i, set: j, field: f, title: `${e.name} · set ${j + 1} · ${title}`, text, fresh: true })}
                          style={[styles.field, { backgroundColor: c.surface }, active && { borderWidth: 2, borderColor: c.text }]}
                        >
                          <Txt variant="meta" tone="muted">{title} </Txt>
                          <Txt numberOfLines={1} adjustsFontSizeToFit style={[type.value, { flexShrink: 1 }]}>{value || '–'}</Txt>
                          {!!unit && <Txt variant="meta" tone="muted"> {unit}</Txt>}
                        </Tap>
                      );
                    })}
                    <View style={styles.icon} />
                    <View style={styles.label} />
                  </View>
                )}
                </View>
              );
            })}
            <View style={styles.actions}>
              <Tap
                onPress={() => change((x) => x[i].sets.push({ ...(e.sets.at(-1) ?? { type: 'normal', weight: 0, reps: 0, duration: null, distance: null, rounds: null, recovery: null, rest: null, targetRpe: null, options: null }) }))}
                accessibilityLabel="Add set"
                style={[styles.action, styles.dashed, styles.iconAction, { borderColor: c.line }]}
              >
                <Icon of={PlusIcon} size="s" tone="muted" />
                <Txt variant="label" tone="muted">Set</Txt>
              </Tap>
              {next > 0 && (
                <Tap
                  accessibilityLabel={`Superset with ${plan.exercises[next].name}`}
                  onPress={() =>
                    change((x) => {
                      const group = x[i].superset ?? createId();
                      const old = x[next].superset;
                      x.forEach((y, k) => {
                        if (k === i || k === next || (old && y.superset === old)) y.superset = group;
                      });
                    })
                  }
                  style={[styles.action, styles.dashed, { borderColor: c.line }]}
                >
                  <Txt variant="label" tone="muted">Superset</Txt>
                </Tap>
              )}
              {e.superset && (
                <Tap accessibilityLabel={`Unlink ${e.name}`} onPress={() => change((x) => (x[i].superset = null))} style={[styles.action, styles.dashed, { borderColor: c.line }]}>
                  <Txt variant="label" tone="muted">Unlink</Txt>
                </Tap>
              )}
              {blocks[at - 1] && (
                <Tap accessibilityLabel={`Move ${e.name} up`} onPress={() => move(i, -1)} style={[styles.action, styles.dashed, { borderColor: c.line }]}>
                  <Icon of={ArrowUpIcon} size="s" tone="muted" />
                </Tap>
              )}
              {blocks[at + 1] && (
                <Tap accessibilityLabel={`Move ${e.name} down`} onPress={() => move(i, 1)} style={[styles.action, styles.dashed, { borderColor: c.line }]}>
                  <Icon of={ArrowDownIcon} size="s" tone="muted" />
                </Tap>
              )}
              <Tap
                accessibilityLabel={`Remove ${e.name}`}
                onPress={() => {
                  setEdit(null);
                  change((x) => x.splice(i, 1));
                }}
                style={[styles.action, styles.dashed, { borderColor: c.line }]}
              >
                <Txt variant="label" tone="muted">Remove</Txt>
              </Tap>
            </View>
          </View>
        );
      })}
      <Tap onPress={() => setAdding(!adding)} accessibilityState={{ expanded: adding }} style={[styles.card, styles.iconAction, { backgroundColor: c.raised, justifyContent: 'flex-start', gap: space.s }]}>
        <Icon of={PlusIcon} size="s" />
        <Txt variant="label">Add exercise</Txt>
      </Tap>
      {adding && (
        <ExercisePicker
          exclude={plan.exercises.map((e) => e.exerciseId)}
          onFocus={() => setEdit(null)}
          onPick={(exerciseId) => {
            change((x) => x.push({ exerciseId, name: '', mode: 'reps', superset: null, sets: [{ type: 'normal', weight: 0, reps: 0, duration: null, distance: null, rounds: null, recovery: null, rest: null, targetRpe: null, options: null }] }));
            setAdding(false);
          }}
        />
      )}
      <Tap onPress={onDone} style={[styles.ghost, { borderColor: c.line }]}>
        <Txt variant="label">Done</Txt>
      </Tap>
    </Animated.View>
  );
  const sheet = (
    <BottomSheet open={!!edit} onClose={close} onHeight={setSheetHeight}>
      {shown && (
        <Keypad
          title={edit && error ? error : shown.title}
          decimal={decimals.includes(shown.field)}
          display={timeFields.includes(shown.field) ? digitClock(shown.text) : undefined}
          draft={shown}
          onChange={(draft) => {
            if (!edit) return false;
            const v = entered(edit.field, draft.text);
            const ok = save({
              name: plan.name,
              exercises: plan.exercises.map((e, i) =>
                i !== edit.exercise ? e : { ...e, sets: e.sets.map((s, j) => (j !== edit.set ? s : { ...s, [edit.field]: edit.field === 'weight' || edit.field === 'reps' ? (v ?? 0) : (v ?? null), ...(edit.field === 'weight' && { unit: units.weight }), ...(edit.field === 'distance' && { distanceUnit: units.distance }) })) },
              ),
            });
            if (ok) setEdit({ ...edit, ...draft });
            return ok;
          }}
          onDone={close}
        />
      )}
    </BottomSheet>
  );
  useLayoutEffect(() => {
    host(sheet);
  });
  useFocusEffect(useCallback(() => () => setEdit(null), []));
  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setEdit(null);
      setError(null);
      return true;
    });
    return () => sub.remove();
  }, [editing]);
  useEffect(() => () => host(null), [host]);
  return body;
}

const styles = StyleSheet.create({
  ghost: { alignSelf: 'flex-start', marginTop: space.m, paddingHorizontal: space.l, borderWidth: 1, borderRadius: radius.pill },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  action: { flexGrow: 1, minWidth: touch.min, alignItems: 'center', borderRadius: radius.s, borderWidth: 1 },
  iconAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  dashed: { borderStyle: 'dashed' },
  card: { borderRadius: radius.m, padding: space.m, marginTop: space.s },
  input: { borderRadius: radius.s, paddingHorizontal: space.m, minHeight: touch.min, ...type.input },
  set: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  label: { width: touch.min, alignItems: 'center' },
  icon: { width: touch.min, alignItems: 'center' },
  field: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', borderRadius: radius.s, paddingTop: 10 },
});
