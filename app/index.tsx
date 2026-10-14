import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as ops from '@/domain/workouts';
import { db } from '@/platform/db';
import { Home } from '@/ui/home';
import { RevealScroll, SheetSlot } from '@/ui/sheet';
import { Workout } from '@/ui/workout';

export default function Index() {
  const [workout, setWorkout] = useState<string | null>(() => ops.unfinishedWorkouts(db)[0]?.id ?? null);
  const [minimised, setMinimised] = useState(false);
  const exit = () => {
    const open = ops.unfinishedWorkouts(db)[0]?.id ?? null;
    setWorkout(open);
    setMinimised(!!open);
  };
  const { open } = useLocalSearchParams<{ open?: string }>();
  const [opened, setOpened] = useState(open);
  if (open !== opened) {
    setOpened(open);
    if (open) {
      setWorkout(open);
      setMinimised(false);
    }
  }
  useEffect(() => {
    if (open) router.setParams({ open: undefined });
  }, [open]);
  const active = workout && minimised ? ops.getWorkout(db, workout) : null;
  const focused = useIsFocused();
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']} importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}>
      {workout && (
        <View style={{ flex: 1, display: minimised ? 'none' : 'flex' }}>
          <Workout key={workout} id={workout} hidden={minimised} onMinimise={() => setMinimised(true)} onExit={exit} />
        </View>
      )}
      {(!workout || minimised) && (
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <SheetSlot>
        <RevealScroll>
          <Home
            active={active && { name: active.name, startedAt: Date.parse(active.startedAt) }}
            onResume={() => setMinimised(false)}
            onEdit={(id) => {
              setWorkout(id);
              setMinimised(false);
            }}
            onStart={(from) => setWorkout(ops.startWorkout(db, from))}
          />
        </RevealScroll>
        </SheetSlot>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
