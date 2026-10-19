import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { localAt, type Phase } from '@/domain/rules';

import { readSetting, writeSetting } from './db';
import { syncActivity } from './restActivity';

export type Timer = { workout: string; exercise: string; startedAt: number; phases: Phase[]; set?: string };

let queue = Promise.resolve();

const countdown = requireOptionalNativeModule<{ show(titles: string[], body: string, ends: number[]): void; clear(): void; exact(): boolean }>('RestCountdown');

const live = (timer: Timer | null) => {
  void syncActivity(timer).catch(() => undefined);
  if (!countdown) return;
  if (!timer || AppState.currentState === 'active') return countdown.clear();
  const { phases } = timer;
  let end = timer.startedAt;
  countdown.show(
    phases.map((p, i) => (phases.length > 1 ? `${p.label} · ${i + 1}/${phases.length}` : p.label)),
    timer.exercise,
    phases.map((p) => (end += p.seconds * 1000)),
  );
};

AppState.addEventListener('change', () => live(JSON.parse(readSetting('timer') || 'null')));
void syncActivity(JSON.parse(readSetting('timer') || 'null')).catch(() => undefined);

export const scheduleTimer = (timer: Timer | null, ask = true) => {
  writeSetting('timer', timer ? JSON.stringify(timer) : '');
  live(timer);
  return (queue = queue.then(() => apply(timer, ask)).catch(() => undefined));
};

export const rescheduleTimer = () => scheduleTimer(JSON.parse(readSetting('timer') || 'null'), false);

export const alerts = () => ({ sound: readSetting('sound') !== '0', haptics: readSetting('haptics') !== '0' });

export const VIBRATION = [0, 300, 150, 300];

const channels = { sv: 'Timer alerts', s: 'Timer alerts, sound only', v: 'Timer alerts, haptics only', '': 'Timer alerts, silent' };

let reminded = '';

export type Reminder = { id: string; date: string; time: string; title: string; body: string };

export const scheduleReminders = (reminders: Reminder[]) => {
  if (JSON.stringify(reminders) === reminded) return queue;
  reminded = JSON.stringify(reminders);
  return (queue = queue.then(() => remind(reminders)).catch(() => undefined));
};

const cancel = async (prefix: string) => {
  for (const n of await Notifications.getAllScheduledNotificationsAsync())
    if (n.identifier.startsWith(prefix)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
};

let asked = false;

export const allowed = async (ask: boolean) => {
  const { granted } = await Notifications.getPermissionsAsync();
  if (granted || !ask || asked) return granted;
  asked = true;
  return (await Notifications.requestPermissionsAsync()).granted;
};

async function remind(reminders: Reminder[]) {
  await cancel('plan-');
  await cancel('measure-');
  if (!reminders.length) return;
  if (!(await allowed(true))) return void (reminded = '');
  for (const { id, date, time, title, body } of reminders) {
    const at = localAt(date, time);
    if (at.getTime() > Date.now())
      await Notifications.scheduleNotificationAsync({
        identifier: `${id}-${date}`,
        content: { title, body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
      });
  }
}

async function apply(timer: Timer | null, ask: boolean) {
  await cancel('timer-');
  if (!timer || !(await allowed(ask))) return;
  if (Platform.OS === 'android' && Platform.Version >= 34 && !readSetting('exactAlarmAsked') && !countdown?.exact()) {
    writeSetting('exactAlarmAsked', '1');
    void IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_SCHEDULE_EXACT_ALARM, {
      data: `package:${Constants.expoConfig?.android?.package}`,
    }).catch(() => undefined);
  }
  const { sound, haptics } = alerts();
  const key = `${sound ? 's' : ''}${haptics ? 'v' : ''}` as keyof typeof channels;
  const channelId = `timer-${key}`;
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync(channelId, {
      name: channels[key],
      importance: Notifications.AndroidImportance.HIGH,
      sound: sound ? 'timer.wav' : null,
      enableVibrate: haptics,
      vibrationPattern: haptics ? VIBRATION : null,
    });
  let end = timer.startedAt;
  for (const [i, phase] of timer.phases.entries()) {
    end += phase.seconds * 1000;
    if (end > Date.now())
      await Notifications.scheduleNotificationAsync({
        identifier: `timer-${i}`,
        content: { title: `${phase.label} done`, body: timer.exercise, sound: sound ? 'timer.wav' : false, vibrate: haptics ? VIBRATION : undefined },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: end, channelId },
      });
  }
}
