import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, font, foregroundStyle, frame, lineLimit, monospacedDigit, multilineTextAlignment, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import { AppState } from 'react-native';

import { livePhase } from '@/domain/rules';

import type { Timer } from './notifications';

type RestActivityProps = { title: string; exercise: string; start: number; end: number };

const RestActivity = (props: RestActivityProps, env: LiveActivityEnvironment) => {
  'widget';
  const text = '#f4f4f5';
  const muted = '#9a9aa1';
  const up = 'Rest timer up!';
  const clock = (size: number, width: number) => (
    <Text
      timerInterval={{ lower: new Date(props.start), upper: new Date(props.end) }}
      countsDown
      modifiers={[font({ size, weight: 'heavy' }), monospacedDigit(), foregroundStyle(text), multilineTextAlignment('trailing'), frame({ width, alignment: 'trailing' })]}
    />
  );
  const label = (size: number) => (
    <Text modifiers={[font({ size, weight: 'bold' }), foregroundStyle(muted), lineLimit(1)]}>{props.title.toUpperCase()}</Text>
  );
  const exercise = <Text modifiers={[font({ size: 14 }), foregroundStyle(muted), lineLimit(1)]}>{props.exercise}</Text>;
  const done = (size: number) => <Text modifiers={[font({ size, weight: 'bold' }), foregroundStyle(text), lineLimit(1)]}>{up}</Text>;
  return {
    banner: (
      <HStack modifiers={[activityBackgroundTint('#0b0b0c'), padding({ all: 16 })]}>
        <VStack alignment="leading" spacing={4}>
          {label(12)}
          {exercise}
        </VStack>
        <Spacer />
        {env.isStale ? done(18) : clock(30, 120)}
      </HStack>
    ),
    compactLeading: label(12),
    compactTrailing: env.isStale ? <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(text)]}>Up!</Text> : clock(13, 46),
    minimal: env.isStale ? <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(text)]}>Up!</Text> : clock(11, 36),
    expandedLeading: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ leading: 8 })]}>
        {label(12)}
        {exercise}
      </VStack>
    ),
    expandedTrailing: env.isStale ? done(16) : clock(28, 110),
  };
};

const RestTimer = createLiveActivity<RestActivityProps>('RestTimer', RestActivity);

export async function syncActivity(timer: Timer | null) {
  const [current, ...extra] = RestTimer.getInstances();
  for (const a of extra) await a.end('immediate');
  const phase = timer && livePhase(timer.phases, timer.startedAt, Date.now());
  if (!phase) return current?.end('immediate');
  const props = { ...phase, exercise: timer.exercise };
  if (current) return current.update(props, new Date(phase.end));
  if (AppState.currentState === 'active') RestTimer.start(props, undefined, new Date(phase.end));
}
