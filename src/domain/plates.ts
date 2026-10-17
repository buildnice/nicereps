import type { WeightUnit } from '../data/queries.ts';
import { catalog } from '../../assets/catalog/exercises.ts';

export type Kit = { bar: number; plates: number[] };

export const kitOptions: Record<WeightUnit, Kit & { bars: number[] }> = {
  kg: { bars: [20, 15, 10], bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5] },
  lb: { bars: [45, 35, 25, 15], bar: 45, plates: [45, 35, 25, 15, 10, 5, 2.5, 1.25] },
};

export const kitDefaults: Record<WeightUnit, Kit> = {
  kg: { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
  lb: { bar: 45, plates: [45, 35, 25, 10, 5, 2.5] },
};

export const equipment = (source: string | null, own: string | null) => (source === 'Trap_Bar_Deadlift' ? 'trap bar' : source ? (catalog[source]?.equipment ?? null) : own);

export const isBarbell = (source: string | null, own: string | null) => ['barbell', 'e-z curl bar', 'trap bar'].includes(equipment(source, own)?.toLowerCase() ?? '');

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export const loadPlates = (weight: number, { bar, plates }: Kit) => {
  const units = plates.map((p) => Math.round(p * 100));
  const step = units.reduce(gcd, 0) || 1;
  const sizes = units.map((u) => u / step).sort((a, b) => b - a);
  const goal = (Math.max(0, weight - bar) * 50) / step;
  if (!sizes.length) return { weight: bar, side: [] };
  if (goal > 50 * sizes[0]) return null;
  const top = Math.ceil(goal) + sizes[0];
  const count = new Array<number>(top + 1).fill(Infinity);
  const last = new Array<number>(top + 1).fill(0);
  count[0] = 0;
  for (let w = 1; w <= top; w++)
    for (const s of sizes)
      if (s <= w && count[w - s] + 1 < count[w]) {
        count[w] = count[w - s] + 1;
        last[w] = s;
      }
  let best = 0;
  for (let w = 1; w <= top; w++) if (count[w] < Infinity && Math.abs(w - goal) < Math.abs(best - goal)) best = w;
  const side: number[] = [];
  for (let w = best; w > 0; w -= last[w]) side.push((last[w] * step) / 100);
  return { weight: bar + (best * step) / 50, side: side.sort((a, b) => b - a) };
};
