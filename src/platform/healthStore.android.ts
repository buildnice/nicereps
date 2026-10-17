import Constants from 'expo-constants';
import { Linking } from 'react-native';
import {
  deleteRecordsByUuids,
  ExerciseType,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  insertRecords,
  openHealthConnectSettings,
  readRecords,
  RecordingMethod,
  requestPermission,
  SdkAvailabilityStatus,
  type HealthConnectRecord,
} from 'react-native-health-connect';

import type { HealthKind, HealthRecord, HealthRef, HealthWeight } from '@/domain/health';

export const healthName = 'Health Connect';

const types = { workout: 'ExerciseSession', weight: 'Weight' } as const;
const permissions = Object.values(types).map((recordType) => ({ accessType: 'write' as const, recordType }));

// Health Connect is part of Android 14+; older versions need its Play app.
export const healthMissing = async () => {
  const status = await getSdkStatus();
  if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return (await initialize()) ? null : 'Health Connect could not start.';
  return status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ? 'Update Health Connect to use it.' : 'Health Connect is not available on this device.';
};

const kinds = (granted: { accessType: string; recordType: string }[]) =>
  (Object.keys(types) as HealthKind[]).filter((k) => granted.some((p) => p.accessType === 'write' && p.recordType === types[k]));

export const healthGranted = async () => kinds(await getGrantedPermissions());

export const readGranted = async () => (await getGrantedPermissions()).some((p) => p.accessType === 'read' && p.recordType === 'Weight');

export const requestHealth = async ({ write, read }: { write: boolean; read: boolean }) => {
  await requestPermission([...(write ? permissions : []), ...(read ? [{ accessType: 'read' as const, recordType: 'Weight' as const }] : [])]);
};

// Health Connect lets an app read only from 30 days before it was first granted read access.
export const readHealthWeights = async () => {
  const weights: HealthWeight[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords('Weight', { timeRangeFilter: { operator: 'after', startTime: new Date(0).toISOString() }, pageSize: 1000, pageToken });
    for (const r of page.records)
      if (r.metadata?.id && r.metadata.dataOrigin !== Constants.expoConfig?.android?.package) weights.push({ id: r.metadata.id, at: r.time, kg: r.weight.inKilograms });
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return weights;
};

const record = (r: HealthRecord, version: number): HealthConnectRecord => {
  const metadata = { clientRecordId: r.id, clientRecordVersion: version, recordingMethod: RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY };
  return r.kind === 'workout'
    ? { recordType: 'ExerciseSession', exerciseType: ExerciseType.STRENGTH_TRAINING, title: r.title, startTime: r.start, endTime: r.end, metadata }
    : { recordType: 'Weight', weight: { unit: 'kilograms', value: r.kg }, time: new Date(`${r.date}T12:00:00`).toISOString(), metadata };
};

// Health Connect takes one record type per insert.
export const writeHealth = async (records: HealthRecord[], version: number) => {
  for (const kind of Object.keys(types) as HealthKind[]) {
    const batch = records.filter((r) => r.kind === kind);
    if (batch.length) await insertRecords(batch.map((r) => record(r, version)));
  }
};

export const removeHealth = async (refs: HealthRef[]) => {
  for (const kind of Object.keys(types) as HealthKind[]) {
    const ids = refs.filter((r) => r.kind === kind).map((r) => r.id);
    if (ids.length) await deleteRecordsByUuids(types[kind], [], ids);
  }
};

export const openHealth = (missing: boolean) =>
  missing ? Linking.openURL('market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding') : openHealthConnectSettings();
