import {
  AuthorizationStatus,
  authorizationStatusFor,
  ComparisonPredicateOperator,
  deleteObjects,
  isHealthDataAvailable,
  queryQuantitySamples,
  requestAuthorization,
  saveQuantitySample,
  saveWorkoutSample,
  WorkoutActivityType,
  WorkoutTypeIdentifier,
} from '@kingstinct/react-native-healthkit';
import Constants from 'expo-constants';
import { Linking } from 'react-native';

import type { HealthKind, HealthRecord, HealthRef, HealthWeight } from '@/domain/health';

export const healthName = 'Apple Health';

const types = { workout: WorkoutTypeIdentifier, weight: 'HKQuantityTypeIdentifierBodyMass' } as const;
const kinds = () => (Object.keys(types) as HealthKind[]).filter((k) => authorizationStatusFor(types[k]) === AuthorizationStatus.sharingAuthorized);

export const healthMissing = async () => (isHealthDataAvailable() ? null : 'Apple Health is not available on this device.');

export const healthGranted = async () => kinds();

// HealthKit never says whether read access was denied; a denied read returns no samples.
export const readGranted = async () => true;

export const requestHealth = async ({ write, read }: { write: boolean; read: boolean }) => {
  await requestAuthorization({ toShare: write ? Object.values(types) : [], toRead: read ? [types.weight] : [] });
};

export const readHealthWeights = async (): Promise<HealthWeight[]> =>
  (await queryQuantitySamples(types.weight, { limit: 0, unit: 'kg' }))
    .filter((s) => s.sourceRevision?.source.bundleIdentifier !== Constants.expoConfig?.ios?.bundleIdentifier)
    .map((s) => ({ id: s.uuid, at: s.startDate.toISOString(), kg: s.quantity }));

// HealthKit replaces a sample whose sync identifier matches and whose version is higher.
export const writeHealth = async (records: HealthRecord[], version: number) => {
  for (const r of records) {
    const metadata = { HKSyncIdentifier: r.id, HKSyncVersion: version };
    if (r.kind === 'workout') await saveWorkoutSample(WorkoutActivityType.traditionalStrengthTraining, [], new Date(r.start), new Date(r.end), undefined, metadata);
    else {
      const at = new Date(Math.min(Date.parse(`${r.date}T12:00:00`), Date.now()));
      await saveQuantitySample(types.weight, 'kg', r.kg, at, at, metadata);
    }
  }
};

export const removeHealth = async (refs: HealthRef[]) => {
  for (const kind of Object.keys(types) as HealthKind[]) {
    const ids = refs.filter((r) => r.kind === kind).map((r) => r.id);
    if (ids.length)
      await deleteObjects(types[kind], { OR: ids.map((value) => ({ metadata: { withMetadataKey: 'HKSyncIdentifier', operatorType: ComparisonPredicateOperator.equalTo, value } })) });
  }
};

export const openHealth = () => Linking.openURL('x-apple-health://');
