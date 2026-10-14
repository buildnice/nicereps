import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { type GestureResponderEvent, Platform, StyleSheet, View } from 'react-native';
import { BackspaceIcon } from 'phosphor-react-native/src/icons/Backspace';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { alerts } from '@/platform/notifications';

import { nextPress, type Draft, type Press } from './draft';
import { Digits, Icon, radius, space, Tap, Txt, useColors } from './theme';

type KeypadProps = {
  title: string;
  decimal: boolean;
  draft: Draft;
  display?: string;
  onChange: (draft: Draft) => boolean | void;
  onDone: () => void;
};

export function Keypad({ title, decimal, draft, display, onChange, onDone }: KeypadProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], [decimal ? '.' : '', '0', 'del']];
  const last = useRef<Press>(undefined);

  const press = (key: string) => {
    if (alerts().haptics) void Haptics.selectionAsync();
    const next = nextPress(last.current, draft, key, decimal);
    if (onChange(next.to) !== false) last.current = next;
  };

  return (
    <View style={[styles.sheet, { backgroundColor: c.raised, borderColor: c.line, paddingBottom: insets.bottom + space.s }]}>
      <View style={[styles.grabber, { backgroundColor: c.faint }]} />
      <View style={styles.head}>
        <Txt variant="label" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{title}</Txt>
        <Tap accessibilityLabel="Done" onPress={onDone} style={{ paddingHorizontal: space.m }}>
          <Txt variant="label">Done</Txt>
        </Tap>
      </View>
      {display !== undefined && (
        <Digits text={display} variant="title" color={c.text} accessibilityLiveRegion="polite" style={styles.display} />
      )}
      {rows.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((k) => (k === '' ? <View key="blank" style={styles.key} /> : <Key key={k} k={k} onPress={() => press(k)} />))}
        </View>
      ))}
    </View>
  );
}

function Key({ k, onPress }: { k: string; onPress: () => void }) {
  const c = useColors();
  const [down, setDown] = useState(false);
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(60_000)
    .maxDistance(8)
    .onBegin(() => setDown(true))
    .onEnd((_e, success) => success && onPress())
    .onFinalize(() => setDown(false));
  return (
    <GestureDetector gesture={tap}>
      <View
        accessible
        focusable
        accessibilityRole="button"
        testID={`key-${k}`}
        accessibilityLabel={k === 'del' ? 'Delete' : k === '.' ? 'Decimal point' : k}
        // onClick is missing from View's types; Pressable passes it the same way for screen-reader and keyboard clicks, skipping pointer-event clicks that the tap gesture already handles.
        {...{ onClick: (e: GestureResponderEvent) => !('pointerType' in e.nativeEvent) && onPress() }}
        style={[styles.key, { backgroundColor: c.surface }, down && { transform: [{ scale: 0.97 }] }]}
      >
        {k === 'del' ? <Icon of={BackspaceIcon} size="l" /> : <Txt variant="value">{k}</Txt>}
      </View>
    </GestureDetector>
  );
}

const KEY = 56;

const styles = StyleSheet.create({
  sheet: {
    gap: space.s,
    paddingHorizontal: space.m,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    borderTopWidth: StyleSheet.hairlineWidth,
    ...Platform.select({ android: { elevation: 16 }, default: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } } }),
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: space.s },
  head: { flexDirection: 'row', alignItems: 'center' },
  row: { flexDirection: 'row', gap: space.s, height: KEY },
  display: { alignSelf: 'center' },
  key: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.s },
});
