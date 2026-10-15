import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, PanResponder, Platform, useWindowDimensions, View } from 'react-native';
import { ListIcon } from 'phosphor-react-native/src/icons/List';
import Animated from 'react-native-reanimated';

import { kitOptions } from '@/domain/plates';
import type { HomeSection } from '@/domain/rules';
import { homeLayout, kit } from '@/domain/workouts';
import { backupFolder, chooseBackupFolder, eraseData, exportData, folderName, shareTemplate, stopBackup } from '@/platform/data';
import { db, readSetting, writeSetting } from '@/platform/db';
import { healthMissing, healthName, openHealth, startHealth, stopHealth, syncHealth } from '@/platform/health';
import { alerts, allowed, rescheduleTimer } from '@/platform/notifications';
import { Page } from '@/ui/measurements';
import { digitTime, from12, localAt, onOrAfter, repeatDates, to12, weekdays } from '@/domain/rules';
import type { Draft } from '@/ui/draft';
import { Keypad } from '@/ui/keypad';
import { label, measureRepeat, remind, reminderTime, today } from '@/ui/plan';
import { BottomSheet } from '@/ui/sheet';
import { Chip } from '@/ui/workout';

import { Choice, Icon, radius, space, Tap, Txt, useColors, usePrototype } from '@/ui/theme';

export default function Settings() {
  const { scheme, setScheme, units, setUnit, reset } = usePrototype();
  const c = useColors();
  const [reminders, setReminders] = useState(readReminders);
  const [, setKitChanged] = useState(0);
  const u = units.weight;
  const owned = kit(db, u);
  const saveKit = (key: 'Bar' | 'Plates', value: string) => {
    writeSetting(`${u}${key}`, value);
    setKitChanged((n) => n + 1);
  };
  const [blocked, setBlocked] = useState(false);
  const saveReminders = async (values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) writeSetting(key, value);
    const r = readReminders();
    setReminders(r);
    await remind();
    setBlocked((r.workout || r.measure) && !(await allowed(true)));
  };
  const [timerAlerts, setTimerAlerts] = useState(alerts);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof exportData>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [erasing, setErasing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [{ folder, backupAt, backupError }, setBackup] = useState(readBackup);
  useFocusEffect(useCallback(() => setBackup(readBackup()), [setBackup]));
  const [linkError, setLinkError] = useState<string | null>(null);
  const open = (url: string) => {
    setLinkError(null);
    Linking.openURL(url).catch(() => setLinkError('No app found to open this link.'));
  };
  const button = { alignItems: 'center', borderRadius: radius.s, backgroundColor: c.raised, marginTop: space.s } as const;
  return (
    <Page title="Settings" scrollEnabled={!dragging}>
      <Group title="App" />
      <Choice title="Theme" value={scheme} options={[['dark', 'Dark'], ['light', 'Light']]} onChange={setScheme} />
      <HomeSections onDragging={setDragging} />
      {([['haptics', 'Haptics', 'haptics'], ['sound', 'Sound', 'sound']] as const).map(([kind, title, key]) => (
        <Choice
          key={key}
          title={title}
          value={timerAlerts[kind]}
          options={[[false, 'Off'], [true, 'On']]}
          onChange={(on) => {
            writeSetting(key, on ? '1' : '0');
            setTimerAlerts(alerts());
            rescheduleTimer();
          }}
        />
      ))}
      {segment}
      <Group title="Workout" />
      <Choice title={`Bar · ${u}`} value={String(owned.bar)} options={kitOptions[u].bars.map((b) => [String(b), String(b)])} onChange={(bar) => saveKit('Bar', bar)} />
      <View style={{ marginTop: space.xl }}>
        <Txt variant="caps" tone="muted">Plates available · {u}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s }}>
          {kitOptions[u].plates.map((p) => (
            <Chip
              key={p}
              role="checkbox"
              label={String(p)}
              selected={owned.plates.includes(p)}
              onPress={() => saveKit('Plates', kitOptions[u].plates.filter((x) => (x === p) !== owned.plates.includes(x)).join(','))}
            />
          ))}
        </View>
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>Barbell exercises show the plates per side.</Txt>
      </View>
      <Choice title="Planned-workout reminders" value={reminders.workout} options={[[false, 'Off'], [true, 'On']]} onChange={(on) => on !== reminders.workout && saveReminders({ reminders: on ? '1' : '0' })} />
      {reminders.workout && <TimeField title="Workout reminder time" value={reminders.workoutTime} onSave={(time) => saveReminders({ reminderTime: time })} />}
      <Choice
        title="Measurement reminders"
        value={reminders.measure}
        options={[[false, 'Off'], [true, 'On']]}
        onChange={(on) => on !== reminders.measure && saveReminders({ measureReminders: on ? '1' : '0', measureFrom: onOrAfter(today(), reminders.repeat.weekday) })}
      />
      {reminders.measure && (
        <>
          <TimeField title="Measurement reminder time" value={reminders.measureTime} onSave={(time) => saveReminders({ measureTime: time })} />
          <Chips
            title="Repeat"
            value={reminders.repeat.every}
            options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['fortnightly', 'Fortnightly'], ['monthly', 'Monthly']]}
            onChange={(every) => saveReminders({ measureEvery: every, measureFrom: onOrAfter(today(), reminders.repeat.weekday) })}
          />
          {(reminders.repeat.every === 'weekly' || reminders.repeat.every === 'fortnightly') && (
            <Chips
              title="On"
              value={reminders.repeat.weekday}
              options={[...weekdays.slice(1), weekdays[0]].map((w) => [w, `${w[0].toUpperCase()}${w.slice(1, 3)}`])}
              onChange={(weekday) => saveReminders({ measureWeekday: weekday, measureFrom: onOrAfter(today(), weekday) })}
            />
          )}
          {reminders.repeat.every === 'monthly' && (
            <KeyField
              title="Day of the month"
              value={String(reminders.repeat.day)}
              digits={2}
              display={(text) => text}
              valid={(text) => Number(text) >= 1 && Number(text) <= 31}
              error="Enter a day from 1 to 31"
              onSave={(day) => saveReminders({ measureDay: day })}
            />
          )}
          <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>
            {reminders.next && `Next reminder ${label(reminders.next)} at ${clock(reminders.measureTime)}.`}
            {reminders.repeat.every === 'monthly' && reminders.repeat.day > 28 && ' Months without that day remind on their last day.'}
          </Txt>
        </>
      )}
      {blocked && <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>Notifications are off for nicereps in system settings.</Txt>}
      {segment}
      <Group title="Units" />
      <Choice title="Weight" value={units.weight} options={[['kg', 'kg'], ['lb', 'lb']]} onChange={(unit) => setUnit('weight', unit)} />
      <Choice title="Length" value={units.length} options={[['cm', 'cm'], ['in', 'in']]} onChange={(unit) => setUnit('length', unit)} />
      <Choice title="Distance" value={units.distance} options={[['km', 'km'], ['mi', 'mi']]} onChange={(unit) => setUnit('distance', unit)} />
      {segment}
      <Group title="Data" />
      <View>
        <Tap
          disabled={exporting}
          onPress={async () => {
            setExporting(true);
            setError(null);
            setSaved(null);
            try {
              setSaved(await exportData());
            } catch (e) {
              setError(`Export failed: ${(e as Error).message}`);
            }
            setExporting(false);
          }}
          style={button}
        >
          <Txt variant="label">{exporting ? 'Exporting…' : 'Export data'}</Txt>
        </Tap>
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>Saves a ZIP of every record as CSV, with your photos, to a folder you choose.</Txt>
        {saved && (
          <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>
            Saved {saved.name} to {saved.folder}.
            {saved.missing.length > 0 &&
              ` ${saved.missing.length} photo file${saved.missing.length === 1 ? ' was' : 's were'} missing and left out of the export: ${saved.missing.join(', ')}`}
          </Txt>
        )}
        <Tap
          onPress={() =>
            chooseBackupFolder()
              .catch((e) => setError(`Backup folder failed: ${(e as Error).message}`))
              .finally(() => setBackup(readBackup()))
          }
          style={button}
        >
          <Txt variant="label">{folder ? (Platform.OS === 'ios' ? 'Back up now' : 'Change backup folder') : 'Backup folder'}</Txt>
        </Tap>
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>
          {folder
            ? `Saves ${Platform.OS === 'ios' ? 'nicereps-backup.zip in Files, On My iPhone or iPad › nicereps,' : `nicereps-backup.zip to ${folderName(folder)}`} after each finished workout.${backupAt ? ` Last backup ${new Date(backupAt).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}`
            : `After each finished workout, saves the export as one nicereps-backup.zip ${Platform.OS === 'ios' ? 'in Files, where iCloud device backup keeps it' : 'to a folder you choose. Choose one your sync app backs up'}.`}
        </Txt>
        {folder && backupError ? (
          <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>Last backup failed: {backupError}</Txt>
        ) : null}
        {folder && (
          <Tap
            onPress={() => {
              stopBackup();
              setBackup(readBackup());
            }}
            style={button}
          >
            <Txt variant="label" tone="muted">Stop backups</Txt>
          </Tap>
        )}
        {Platform.OS !== 'web' && <HealthSync button={button} />}
        <Tap onPress={() => router.push('/import')} style={button}>
          <Txt variant="label">Import data</Txt>
        </Tap>
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>From a nicereps export, a filled blank template, or a Strong, Hevy, FitNotes or StrengthLog export. You preview everything first.</Txt>
        <Tap
          onPress={() => shareTemplate().catch((e) => setError(`Sharing failed: ${(e as Error).message}`))}
          style={button}
        >
          <Txt variant="label">Blank CSV template</Txt>
        </Tap>
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>
          One row per set. Rows with the same date and workout name make one workout. Columns: date (YYYY-MM-DD), workout, exercise (a name from your exercise list), type (normal, warm-up or drop), weight, unit (kg or lb), reps, duration (seconds), distance (km), rounds, recovery (seconds), rest (seconds), rpe (1 to 10), comment. Only date, workout and exercise are required.
        </Txt>
        {error && <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>{error}</Txt>}
        <Tap
          accessibilityState={{ expanded: erasing }}
          onPress={() => {
            setErasing(!erasing);
            setConfirming(false);
          }}
          style={button}
        >
          <Txt variant="label" tone="muted">Erase all local data</Txt>
        </Tap>
        {erasing && (
          <>
            <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>
              Deletes every workout, template, plan, measurement, photo and setting on this device. This cannot be undone. Export data first to keep a copy; a backup file in your backup folder is kept.
            </Txt>
            <Tap
              accessibilityLabel={confirming ? 'Tap again to erase all local data' : 'Erase everything'}
              onPress={() => {
                if (!confirming) return setConfirming(true);
                try {
                  eraseData();
                } catch (e) {
                  return setError(`Erase failed: ${(e as Error).message}`);
                }
                remind();
                router.back();
                reset();
              }}
              style={[button, { backgroundColor: c.accent }]}
            >
              <Txt variant="label" tone="onAccent">{confirming ? 'Tap again to erase' : 'Erase everything'}</Txt>
            </Tap>
          </>
        )}
      </View>
      {segment}
      <Group title="About" />
      <View>
        {Platform.OS === 'android' && (
          <Tap accessibilityRole="link" onPress={() => open('market://details?id=com.buildnice.nicereps')} style={button}>
            <Txt variant="label">Rate nicereps</Txt>
          </Tap>
        )}
        <Tap accessibilityRole="link" onPress={() => open(bugReport())} style={button}>
          <Txt variant="label">Report a bug</Txt>
        </Tap>
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>Opens an email to {SUPPORT} with your app version and device. You can read and edit it before sending.</Txt>
        <Tap accessibilityRole="link" onPress={() => open('https://github.com/buildnice/nicereps')} style={button}>
          <Txt variant="label">Source code</Txt>
        </Tap>
        <Tap accessibilityRole="link" onPress={() => open('https://ko-fi.com/buildnice')} style={{ marginTop: space.l, alignSelf: 'center', justifyContent: 'center' }}>
          <Txt variant="meta" tone="muted">Support me on Ko-fi</Txt>
        </Tap>
        <Txt variant="meta" tone="muted" style={{ marginTop: space.s, textAlign: 'center' }}>
          nicereps never connects to the internet. These links open your email, browser or app store.
        </Txt>
        {linkError && <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>{linkError}</Txt>}
      </View>
    </Page>
  );
}

const segment = <View style={{ height: space.xxl }} />;

function Group({ title }: { title: string }) {
  return <Txt variant="heading" accessibilityRole="header" style={{ marginTop: space.l }}>{title}</Txt>;
}

const readReminders = () => {
  const repeat = measureRepeat();
  const measureTime = reminderTime('measureTime');
  return {
    workout: readSetting('reminders') === '1',
    workoutTime: reminderTime('reminderTime'),
    measure: readSetting('measureReminders') === '1',
    measureTime,
    repeat,
    next: repeatDates(repeat, today(), 2).find((date) => localAt(date, measureTime).getTime() > Date.now()),
  };
};

function Chips<T extends string>({ title, value, options, onChange }: { title: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="caps" tone="muted">{title}</Txt>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s }}>
        {options.map(([option, name]) => <Chip key={option} label={name} selected={option === value} onPress={() => option !== value && onChange(option)} />)}
      </View>
    </View>
  );
}

const clock = (time: string) => `${to12(time).text} ${to12(time).pm ? 'PM' : 'AM'}`;

const TimeField = ({ title, value, onSave }: { title: string; value: string; onSave: (time: string) => void }) => {
  const { text, pm } = to12(value);
  return (
    <KeyField
      title={title}
      value={text}
      digits={4}
      display={(digits) => digitTime(digits).replace(/^0/, '')}
      valid={(digits) => digits !== '' && from12(digitTime(digits), pm) !== undefined}
      error="Enter a time from 1:00 to 12:59"
      onSave={(digits) => onSave(from12(digitTime(digits), pm)!)}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel={`${title}, AM or PM`} style={{ flexDirection: 'row', gap: space.s }}>
        {[false, true].map((p) => <Chip key={String(p)} label={p ? 'PM' : 'AM'} selected={p === pm} onPress={() => p !== pm && onSave(from12(text, p)!)} />)}
      </View>
    </KeyField>
  );
};

function KeyField({ title, value, digits, display, valid, error, onSave, children }: { title: string; value: string; digits: number; display: (text: string) => string; valid: (text: string) => boolean; error: string; onSave: (text: string) => void; children?: ReactNode }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ text: '', fresh: true });
  const close = () => {
    if (!draft.fresh && valid(draft.text)) onSave(draft.text);
    setOpen(false);
  };
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="caps" tone="muted">{title}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s }}>
        <Tap
          accessibilityLabel={`${title}, ${value}`}
          onPress={() => {
            setDraft({ text: value.replace(':', ''), fresh: true });
            setOpen(true);
          }}
          style={{ flex: 1, justifyContent: 'center', borderRadius: radius.s, backgroundColor: c.raised, paddingHorizontal: space.l }}
        >
          <Txt variant="value">{value}</Txt>
        </Tap>
        {children}
      </View>
      <BottomSheet modal open={open} onClose={close}>
        <Keypad
          title={draft.fresh || valid(draft.text) ? title : error}
          decimal={false}
          draft={draft}
          display={display(draft.text)}
          onChange={(next) => {
            if (next.text.length > digits) return false;
            setDraft(next);
          }}
          onDone={close}
        />
      </BottomSheet>
    </View>
  );
}

const readHealth = () => ({ on: readSetting('health') === 'on', at: readSetting('healthAt'), error: readSetting('healthError') });

function HealthSync({ button }: { button: object }) {
  const [{ on, at, error }, setHealth] = useState(readHealth);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const refresh = useCallback(() => {
    void healthMissing().then((m) => setMissing(!!m));
    void syncHealth().then(() => setHealth(readHealth()));
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  return (
    <>
      <Choice
        title={healthName}
        value={on}
        options={[[false, 'Off'], [true, 'On']]}
        onChange={(next) => {
          if (next === on || busy) return;
          if (!next) {
            stopHealth();
            return setHealth(readHealth());
          }
          setBusy(true);
          startHealth()
            .catch((e) => writeSetting('healthError', (e as Error).message))
            .finally(() => {
              setBusy(false);
              setHealth(readHealth());
            });
        }}
      />
      <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>
        {busy
          ? 'Writing…'
          : on
            ? `Writes finished workouts and body weight to ${healthName} on this device.${at ? ` Last written ${new Date(at).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}`
            : `Writes finished workouts and body weight to ${healthName} on this device, where apps you allow can read them. Turning it off leaves what was written there.`}
      </Txt>
      {on && error && !busy ? (
        <>
          <Txt variant="meta" accessibilityLiveRegion="polite" style={{ marginTop: space.s }}>{error}</Txt>
          {!(missing && Platform.OS === 'ios') && (
            <Tap accessibilityRole="link" onPress={() => void openHealth(missing)} style={button}>
              <Txt variant="label">{missing ? `Get ${healthName}` : `Open ${healthName}`}</Txt>
            </Tap>
          )}
        </>
      ) : null}
    </>
  );
}

const readBackup = () => ({ folder: backupFolder(), backupAt: readSetting('backupAt'), backupError: readSetting('backupError') });

const SUPPORT = 'support@buildnice.app';

function bugReport() {
  const device = Platform.OS === 'android' ? `Android ${Platform.constants.Release}, ${Platform.constants.Manufacturer} ${Platform.constants.Model}` : `iOS ${Platform.Version}`;
  const body = `What happened:\n\n\nWhat I expected:\n\n\nSteps to repeat it:\n\n\n---\nnicereps ${Constants.expoConfig?.version} · ${device}`;
  return `mailto:${SUPPORT}?subject=${encodeURIComponent('nicereps bug report')}&body=${encodeURIComponent(body.replace(/\n/g, '\r\n'))}`;
}

const ROW = 52;
const sectionNames: Record<HomeSection, string> = { heatmap: '12 weeks', muscles: 'Muscle sets', stats: 'Stats', recent: 'Recent', templates: 'Templates', measurements: 'Measurements' };

function HomeSections({ onDragging }: { onDragging: (on: boolean) => void }) {
  const [layout, setLayout] = useState(() => homeLayout(db));
  const row = ROW + 15 * Math.max(0, useWindowDimensions().fontScale - 1);
  useFocusEffect(useCallback(() => setLayout(homeLayout(db)), []));
  const [drag, setDrag] = useState<{ from: number; to: number; y: number; dy: number } | null>(null);
  const live = useRef(drag);
  const track = (next: typeof drag) => {
    live.current = next;
    setDrag(next);
  };
  const save = (next: typeof layout) => {
    writeSetting('homeOrder', next.map((s) => s.id).join(','));
    writeSetting('homeHidden', next.filter((s) => !s.shown).map((s) => s.id).join(','));
    setLayout(next);
  };
  const moved = (from: number, to: number) => {
    const next = [...layout];
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  };
  const slot = (from: number, dy: number) => Math.max(0, Math.min(layout.length - 1, from + Math.round(dy / row)));
  const onGrab = (from: number, y: number) => {
    track({ from, to: from, y, dy: 0 });
    onDragging(true);
  };
  const onDrag = (y: number) => {
    const d = live.current;
    if (!d) return;
    const to = slot(d.from, y - d.y);
    if (to !== d.to && alerts().haptics) void Haptics.selectionAsync();
    track({ ...d, to, dy: y - d.y });
  };
  const onDrop = () => {
    const d = live.current;
    if (d && d.to !== d.from) save(moved(d.from, d.to));
    track(null);
    onDragging(false);
  };
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="caps" tone="muted">Home sections</Txt>
      <View style={{ marginTop: space.s }}>
        {layout.map((s, index) => {
          const lifted = drag?.from === index;
          const shift = !drag || lifted ? 0 : drag.from < index && index <= drag.to ? -row : drag.to <= index && index < drag.from ? row : 0;
          return (
            <Animated.View
              key={s.id}
              style={[
                { height: row, flexDirection: 'row', alignItems: 'center', gap: space.s, transform: [{ translateY: lifted ? drag.dy : shift }] },
                lifted && { zIndex: 1 },
                drag && !lifted && { transitionProperty: 'transform', transitionDuration: 160 },
              ]}
            >
              <SectionRow
                title={sectionNames[s.id]}
                index={index}
                count={layout.length}
                shown={s.shown}
                lifted={lifted}
                onGrab={(y) => onGrab(index, y)}
                onDrag={onDrag}
                onDrop={onDrop}
                onMove={(to) => save(moved(index, to))}
                onShow={(shown) => save(layout.map((x) => (x === s ? { ...x, shown } : x)))}
              />
            </Animated.View>
          );
        })}
      </View>
      <Txt variant="meta" tone="muted" style={{ marginTop: space.s }}>Start stays first. Drag the handle to reorder.</Txt>
    </View>
  );
}

type SectionRowProps = {
  title: string;
  index: number;
  count: number;
  shown: boolean;
  lifted: boolean;
  onGrab: (y: number) => void;
  onDrag: (y: number) => void;
  onDrop: () => void;
  onMove: (to: number) => void;
  onShow: (shown: boolean) => void;
};

function SectionRow({ title, index, count, shown, lifted, onGrab, onDrag, onDrop, onMove, onShow }: SectionRowProps) {
  const c = useColors();
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => onGrab(e.nativeEvent.pageY),
    onPanResponderMove: (e) => onDrag(e.nativeEvent.pageY),
    onPanResponderRelease: onDrop,
    onPanResponderTerminate: onDrop,
  });
  return (
    <>
      <View
        accessible
        accessibilityLabel={`${title}, position ${index + 1} of ${count}`}
        accessibilityActions={[{ name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' }]}
        onAccessibilityAction={(e) => {
          const to = index + (e.nativeEvent.actionName === 'moveDown' ? 1 : -1);
          if (to >= 0 && to < count) onMove(to);
        }}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginVertical: space.xs / 2, borderRadius: radius.s, paddingRight: space.m, backgroundColor: lifted ? c.raised : undefined }}
      >
        <View {...pan.panHandlers} style={{ width: ROW, height: '100%', alignItems: 'center', justifyContent: 'center' }}>
          <Icon of={ListIcon} tone="muted" />
        </View>
        <Txt variant="label" tone={shown ? undefined : 'muted'} numberOfLines={1} style={{ flex: 1 }}>{title}</Txt>
      </View>
      <Tap
        accessibilityRole="switch"
        accessibilityLabel={`Show ${title}`}
        accessibilityState={{ checked: shown }}
        onPress={() => onShow(!shown)}
        style={{ minWidth: 88, paddingHorizontal: space.s, alignItems: 'center', borderRadius: radius.s, backgroundColor: shown ? c.accent : c.raised }}
      >
        <Txt variant="label" tone={shown ? 'onAccent' : 'muted'}>{shown ? 'Shown' : 'Hidden'}</Txt>
      </Tap>
    </>
  );
}
