import {
  AuthorizationStatus,
  authorizationStatusFor,
  ComparisonPredicateOperator,
  deleteObjects,
  isHealthDataAvailable,
  requestAuthorization,
  saveQuantitySample,
  saveWorkoutSample,
  WorkoutActivityType,
  WorkoutTypeIdentifier,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';

import type { HealthKind, HealthRecord, HealthRef } from '@/domain/health';

export const healthName = 'Apple Health';

const types = { workout: WorkoutTypeIdentifier, weight: 'HKQuantityTypeIdentifierBodyMass' } as const;
const kinds = () => (Object.keys(types) as HealthKind[]).filter((k) => authorizationStatusFor(types[k]) === AuthorizationStatus.sharingAuthorized);

export const healthMissing = async () => (isHealthDataAvailable() ? null : 'Apple Health is not available on this device.');

export const healthGranted = async () => kinds();

export const requestHealth = async () => {
  await requestAuthorization({ toShare: Object.values(types) });
};

// HealthKit replaces a sample whose sync identifier matches and whose version is higher.
export const writeHealth = async (records: HealthRecord[], version: number) => {
  for (const r of records) {
    const metadata = { HKSyncIdentifier: r.id, HKSyncVersion: version };
    if (r.kind === 'workout') await saveWorkoutSample(WorkoutActivityType.traditionalStrengthTraining, [], new Date(r.start), new Date(r.end), undefined, metadata);
    else {
      const at = new Date(`${r.date}T12:00:00`);
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
