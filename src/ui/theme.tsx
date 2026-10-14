import { createContext, useContext, useState, type ReactNode, type Ref } from 'react';
import { Pressable, Text, View, type PressableProps, type StyleProp, type TextProps, type TextStyle, type ViewProps, type ViewStyle } from 'react-native';
import type { Icon as Phosphor } from 'phosphor-react-native';
import Animated, { Easing, FadeInUp, FadeOutUp, LayoutAnimationConfig, useReducedMotion } from 'react-native-reanimated';

import type { DistanceUnit, Mode, SetFields, WeightUnit } from '@/data/queries';
import { convert } from '@/domain/rules';
import { readSetting, writeSetting } from '@/platform/db';

const palettes = {
  dark: {
    bg: '#0b0b0c',
    surface: '#151517',
    raised: '#1d1d20',
    line: '#2a2a2e',
    text: '#f4f4f5',
    muted: '#9a9aa1',
    faint: '#5c5c63',
    accent: '#f4f4f5',
    onAccent: '#0b0b0c',
    danger: '#ff5a52',
    warning: '#d9b36a',
    heat: ['#26262a', '#4a4a52', '#76767e', '#adadb4', '#f4f4f5'],
  },
  light: {
    bg: '#f6f6f4',
    surface: '#ffffff',
    raised: '#eeeeec',
    line: '#e1e1de',
    text: '#111113',
    muted: '#6a6a70',
    faint: '#a6a6aa',
    accent: '#111113',
    onAccent: '#ffffff',
    danger: '#d92d20',
    warning: '#94691f',
    heat: ['#e6e6e3', '#c4c4c0', '#8e8e8c', '#55555a', '#111113'],
  },
};

type Scheme = keyof typeof palettes;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 28 };
export const radius = { s: 10, m: 16, l: 24, pill: 999 };
export const touch = { min: 44, primary: 64 };
export const iconSize = { s: 14, m: 20, l: 24 };

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};

export const inUnit = <S extends { weight: number; unit?: WeightUnit; distance?: number | null; distanceUnit?: DistanceUnit }>(s: S, to: Units) => ({
  ...s,
  weight: convert(s.weight, s.unit ?? 'kg', to.weight),
  unit: to.weight,
  distance: s.distance == null ? s.distance : convert(s.distance, s.distanceUnit ?? 'km', to.distance),
  distanceUnit: to.distance,
});

export const describeSet = (s: SetFields, mode: Mode, to: Units) =>
  ({
    reps: `${inUnit(s, to).weight} × ${s.reps}`,
    duration: s.weight ? `${inUnit(s, to).weight} ${to.weight} × ${clock(s.duration ?? 0)}` : clock(s.duration ?? 0),
    distance: `${inUnit(s, to).distance ?? 0} ${to.distance} in ${clock(s.duration ?? 0)}`,
    interval: `${s.rounds ?? 0} × ${clock(s.duration ?? 0)}/${clock(s.recovery ?? 0)}`,
    check: 'done',
  })[mode];

const scale = {
  title: { fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -1.4 },
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  brand: { fontSize: 22, fontWeight: '800', letterSpacing: -0.9 },
  value: { fontSize: 21, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '600' },
  input: { fontSize: 16, fontWeight: '400' },
  label: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 14, fontWeight: '400' },
  small: { fontSize: 12, fontWeight: '400' },
  caps: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

export const type = Object.fromEntries(
  Object.entries(scale).map(([k, s]) => [k, { fontFamily: 'Montserrat', fontVariant: ['tabular-nums'], ...s }]),
) as { [K in keyof typeof scale]: TextStyle };

type Prototype = {
  scheme: Scheme;
  setScheme: (scheme: Scheme) => void;
  units: Units;
  setUnit: <K extends keyof Units>(kind: K, unit: Units[K]) => void;
  reset: () => void;
};

export type Units = { weight: WeightUnit; length: 'cm' | 'in'; distance: DistanceUnit };

const PrototypeContext = createContext<Prototype | null>(null);

export function PrototypeProvider({ children, reset }: { children: ReactNode; reset: () => void }) {
  const [scheme, setStoredScheme] = useState(() => (readSetting('scheme') ?? 'dark') as Scheme);
  const setScheme = (next: Scheme) => {
    writeSetting('scheme', next);
    setStoredScheme(next);
  };
  const [units, setUnits] = useState(() => ({ weight: readSetting('weightUnit') ?? 'kg', length: readSetting('lengthUnit') ?? 'cm', distance: readSetting('distanceUnit') ?? 'km' }) as Units);
  const setUnit = <K extends keyof Units>(kind: K, unit: Units[K]) => {
    writeSetting(`${kind}Unit`, unit);
    setUnits({ ...units, [kind]: unit });
  };
  return <PrototypeContext value={{ scheme, setScheme, units, setUnit, reset }}>{children}</PrototypeContext>;
}

export function usePrototype() {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error('usePrototype outside PrototypeProvider');
  return value;
}

export const useColors = () => palettes[usePrototype().scheme];

type TxtProps = TextProps & { variant?: keyof typeof type; tone?: 'text' | 'muted' | 'faint' | 'onAccent' };

export function Txt({ variant = 'body', tone = 'text', style, ...props }: TxtProps) {
  const c = useColors();
  return <Text {...props} style={[type[variant], { color: c[tone] }, style]} />;
}

export function Icon({ of: Of, size = 'm', tone = 'text', filled, style }: { of: Phosphor; size?: keyof typeof iconSize; tone?: Exclude<keyof (typeof palettes)['dark'], 'heat'>; filled?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <Of size={iconSize[size]} color={c[tone]} weight={filled ? 'fill' : 'bold'} style={style} />;
}

const roll = (y: number) => ({
  entering: FadeInUp.duration(180).easing(Easing.bezier(0.23, 1, 0.32, 1)).withInitialValues({ transform: [{ translateY: y }] }),
  exiting: FadeOutUp.duration(180).easing(Easing.bezier(0.23, 1, 0.32, 1)).withTargetValues({ transform: [{ translateY: -y }] }),
});

type DigitsProps = Pick<ViewProps, 'style' | 'accessible' | 'accessibilityLiveRegion'> & { text: string; variant: keyof typeof type; color: string; down?: boolean };

export function Digits({ text, variant, color, down, style, ...props }: DigitsProps) {
  const reduce = useReducedMotion();
  const { letterSpacing, ...glyph } = type[variant];
  const motion = roll(((down ? -1 : 1) * (glyph.fontSize ?? 0)) / 2);
  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <View accessible accessibilityLabel={text} {...props} style={[{ flexDirection: 'row', overflow: 'hidden' }, style]}>
        {reduce ? (
          <Text style={[type[variant], { color }]}>{text}</Text>
        ) : (
          [...text].map((ch, i) => (
            <Animated.Text key={`${text.length - i}${ch}`} {...motion} style={[glyph, { color, marginRight: letterSpacing }]}>
              {ch}
            </Animated.Text>
          ))
        )}
      </View>
    </LayoutAnimationConfig>
  );
}

export function Tap({ style, ...props }: PressableProps & { style?: StyleProp<ViewStyle>; ref?: Ref<View> }) {
  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      style={({ pressed }) => [{ minHeight: touch.min, justifyContent: 'center' }, style, pressed && props.onPress && { transform: [{ scale: 0.97 }] }]}
    />
  );
}

export function Choice<T extends string | boolean>({ title, value, options, onChange }: { title: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={{ marginTop: space.xl }}>
      <Txt variant="caps" tone="muted">{title}</Txt>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ flexDirection: 'row', gap: space.s, marginTop: space.s }}>
        {options.map(([option, label]) => (
          <Tap
            key={label}
            accessibilityRole="radio"
            accessibilityState={{ checked: option === value }}
            onPress={() => onChange(option)}
            style={{ flex: 1, alignItems: 'center', borderRadius: radius.s, backgroundColor: option === value ? c.accent : c.raised }}
          >
            <Txt variant="label" tone={option === value ? 'onAccent' : 'muted'}>{label}</Txt>
          </Tap>
        ))}
      </View>
    </View>
  );
}
