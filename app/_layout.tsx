import { Stack } from 'expo-router';
import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { PrototypeProvider, useColors, usePrototype } from '@/ui/theme';

function Screens() {
  const { scheme } = usePrototype();
  const c = useColors();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="index" />
      </Stack>
    </>
  );
}

export default function Layout() {
  const [generation, setGeneration] = useState(0);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PrototypeProvider key={generation} reset={() => setGeneration(generation + 1)}>
        <Screens />
      </PrototypeProvider>
    </GestureHandlerRootView>
  );
}
