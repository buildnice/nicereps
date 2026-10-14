import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { isDate, isTime, localDate, onOrAfter, repeatDates, weekdays, type Repeat } from '@/domain/rules';
import * as ops from '@/domain/workouts';
import { db, readSetting } from '@/platform/db';
import { scheduleReminders } from '@/platform/notifications';

import { dayLabel } from './home';
import { radius, space, Tap, Txt, useColors } from './theme';

type Day = ReturnType<typeof ops.plannedDays>[number];
type Choice = { key: string; label: string; selected: boolean; pick: () => void };

export const today = () => localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

const setting = (key: string) => readSetting(key) ?? '';

export const reminderTime = (key: 'reminderTime' | 'measureTime') => (isTime(setting(key)) ? setting(key) : '08:00');

const repeatsEvery = ['daily', 'weekly', 'fortnightly', 'monthly'] as const;

export const measureRepeat = (): Repeat => {
  const weekday = weekdays.includes(setting('measureWeekday')) ? setting('measureWeekday') : 'monday';
  return {
    every: repeatsEvery.find((e) => e === setting('measureEvery')) ?? 'weekly',
    weekday,
    day: Math.min(31, Math.max(1, Math.trunc(Number(setting('measureDay'))) || 1)),
    from: isDate(setting('measureFrom')) ? setting('measureFrom') : onOrAfter(today(), weekday),
  };
};

export const remind = () => {
  const time = reminderTime('reminderTime');
  const measureTime = reminderTime('measureTime');
  return scheduleReminders([
    ...(readSetting('reminders') === '1'
      ? ops.plannedDays(db, today(), 14).flatMap((d) => (d.planned && !d.done ? [{ id: 'plan', date: d.date, time, title: d.planned.name, body: 'Planned for today' }] : []))
      : []),
    ...(readSetting('measureReminders') === '1'
      ? repeatDates(measureRepeat(), today(), 14).map((date) => ({ id: 'measure', date, time: measureTime, title: 'Measurements', body: 'Time to log your measurements' }))
      : []),
  ]);
};

export const label = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return dayLabel(new Date(y, m - 1, d));
};
const every = (weekday: string) => `Every ${weekday[0].toUpperCase()}${weekday.slice(1)}`;

export function DayPlan({ day, templates, onChange }: { day: Day; templates: ReturnType<typeof ops.listTemplates>; onChange: () => void }) {
  const set = (fn: () => void) => () => {
    fn();
    onChange();
  };
  const choose = (current: string | null | undefined, pick: (id: string | null) => void): Choice[] =>
    [{ id: null, name: 'Rest' }, ...templates].map((t) => ({ key: t.id ?? 'rest', label: t.name, selected: current === t.id, pick: set(() => pick(t.id)) }));
  return (
    <Animated.View entering={FadeIn.duration(160)} style={{ paddingBottom: space.m }}>
      <Choices
        title={every(day.weekday)}
        choices={choose(day.repeat?.id ?? null, (id) => ops.scheduleWeekday(db, day.weekday, id))}
      />
      <Choices
        title={`${label(day.date)} only`}
        choices={[
          { key: 'weekly', label: 'Weekly plan', selected: !day.changed, pick: set(() => ops.resetDay(db, day.date)) },
          ...choose(day.changed ? (day.planned?.id ?? null) : undefined, (id) => ops.changeDay(db, day.date, id)),
        ]}
      />
    </Animated.View>
  );
}

function Choices({ title, choices }: { title: string; choices: Choice[] }) {
  const c = useColors();
  return (
    <View style={{ marginTop: space.m }}>
      <Txt variant="caps" tone="muted">{title}</Txt>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.choices}>
        {choices.map((x) => (
          <Tap
            key={x.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: x.selected }}
            onPress={x.pick}
            style={[styles.choice, { backgroundColor: x.selected ? c.accent : c.raised }]}
          >
            <Txt variant="label" tone={x.selected ? 'onAccent' : 'muted'}>{x.label}</Txt>
          </Tap>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  choice: { alignItems: 'center', borderRadius: radius.pill, paddingHorizontal: space.l },
});
