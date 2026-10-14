import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { space } from './theme';

export const OPEN_MS = 280;
export const CLOSE_MS = 160;

export const SheetHost = createContext<(sheet: ReactNode) => void>(() => {});

export function SheetSlot({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<ReactNode>(null);
  return (
    <SheetHost value={setSheet}>
      {children}
      {sheet}
    </SheetHost>
  );
}

type Lift = { bottom: number; sheet: number } | null;
export const Reveal = createContext<(lift: Lift) => void>(() => {});

export function RevealScroll({ children, scrollEnabled }: { children: ReactNode; scrollEnabled?: boolean }) {
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const { height } = useWindowDimensions();
  const [lift, setLift] = useState<Lift>(null);
  useEffect(() => {
    if (!lift) return;
    const top = height - lift.sheet - space.s;
    if (lift.bottom + space.m > top) scroll.current?.scrollTo({ y: offset.current + lift.bottom + space.m - top });
  }, [lift, height]);
  return (
    <Reveal value={setLift}>
      <ScrollView
        ref={scroll}
        scrollEnabled={scrollEnabled}
        onScroll={(event) => (offset.current = event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={64}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl * 2 + (lift?.sheet ?? 0) }}
      >
        {children}
      </ScrollView>
    </Reveal>
  );
}

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  modal?: boolean;
  onHeight?: (height: number) => void;
  children: ReactNode;
};

export function BottomSheet({ open, onClose, modal, onHeight, children }: BottomSheetProps) {
  const height = useSharedValue(1000);
  const progress = useSharedValue(1);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    progress.set(withTiming(open ? 0 : 1, { duration: open ? OPEN_MS : CLOSE_MS }));
    if (open) return;
    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open, progress]);

  const drag = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY(8)
    .failOffsetX([-8, 8])
    .onUpdate((e) => progress.set(Math.max(0, e.translationY) / height.get()))
    .onEnd((e, success) => {
      if (success && (e.translationY > height.get() / 3 || e.velocityY > 500)) onClose();
      else progress.set(withTiming(0, { duration: CLOSE_MS }));
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: progress.get() * height.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));

  const body = (
    <>
      {modal && (
        <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.backdrop, backdropStyle]}>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
      )}
      <GestureDetector gesture={drag}>
        <Animated.View
          pointerEvents={open ? 'auto' : 'none'}
          onLayout={(event) => {
            height.set(event.nativeEvent.layout.height);
            onHeight?.(event.nativeEvent.layout.height);
          }}
          style={[styles.sheet, sheetStyle]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </>
  );

  return modal ? (
    <Modal transparent visible={mounted} onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>{body}</GestureHandlerRootView>
    </Modal>
  ) : (
    mounted && body
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
