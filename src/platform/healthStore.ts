import type { HealthKind, HealthRecord, HealthRef } from '@/domain/health';

export const healthName = 'Health';

export const healthMissing = async (): Promise<string | null> => 'Health data is not available here.';

export const healthGranted = async (): Promise<HealthKind[]> => [];

export const requestHealth = async (): Promise<HealthKind[]> => [];

export const writeHealth = async (_records: HealthRecord[], _version: number) => {};

export const removeHealth = async (_refs: HealthRef[]) => {};

export const openHealth = async (_missing: boolean) => {};
