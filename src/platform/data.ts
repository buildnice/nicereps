import { open, type DB } from '@op-engineering/op-sqlite';
import { makeImageFromView } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import { Platform, type View } from 'react-native';

import type { Value } from '@/data/db';
import { photoName } from '@/domain/measurements';
import * as data from '@/domain/portability';
import { localDate } from '@/domain/rules';

import { db, readSetting, writeSetting } from './db';
import { photoDir } from './photos';
import { scheduleTimer } from './notifications';

const exportDir = new Directory(Paths.cache, 'export');
const importDir = new Directory(Paths.cache, 'import');

// Import steps hold a transaction across yields, so imports, exports and backups take turns.
let queue: Promise<unknown> = Promise.resolve();
const inTurn = <T>(job: () => Promise<T>) => {
  const next = queue.then(job);
  queue = next.catch(() => {});
  return next;
};

const steps = <T>(run: () => Generator<number, T>, progress: (done: number) => void) =>
  inTurn(async () => {
    const steps = run();
    let shown = Date.now();
    for (let step = steps.next(); ; step = steps.next()) {
      if (step.done) return step.value;
      if (Date.now() - shown < 50) continue;
      progress(step.value);
      await new Promise((resolve) => setTimeout(resolve));
      shown = Date.now();
    }
  });

const writeArchive = async (file: File) => {
  if (!exportDir.exists) exportDir.create();
  if (file.exists) file.delete();
  file.create();
  const out = file.open();
  try {
    return await data.exportArchive(
      db,
      (name) => {
        const photo = new File(photoDir, name);
        return photo.exists ? photo.bytesSync() : null;
      },
      (chunk) => out.writeBytes(chunk),
    );
  } finally {
    out.close();
  }
};

export const folderName = (folder: Directory) =>
  folder.uri.startsWith('content:') ? decodeURIComponent(folder.uri.split('/').filter(Boolean).pop()!).replace(/^[^:]*:/, '') : folder.name;

export const exportData = async () => {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch (e) {
    if (['ERR_PICKER_CANCELLED', 'ERR_FILE_PICKING_CANCELLED'].includes((e as { code?: string }).code!)) return null;
    throw e;
  }
  const file = new File(exportDir, `nicereps-${localDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)}.zip`);
  return inTurn(async () => {
    try {
      const { missing } = await writeArchive(file);
      await file.copy(folder, { overwrite: true });
      writeSetting('exportedAt', new Date().toISOString());
      return { name: file.name, folder: folderName(folder), missing };
    } finally {
      if (file.exists) file.delete();
    }
  });
};

const backupName = 'nicereps-backup.zip';

export const backupFolder = () => {
  const uri = readSetting('backupFolder');
  return uri ? (uri === 'documents' ? Paths.document : new Directory(uri)) : null;
};

const writeBackup = async () => {
  try {
    const folder = backupFolder();
    if (!folder) return;
    const temp = new File(exportDir, backupName);
    await writeArchive(temp);
    let found = false;
    try {
      found = folder.exists;
    } catch {}
    if (!found) throw new Error('The backup folder is missing or nicereps lost access to it. Choose it again.');
    await temp.copy(folder, { overwrite: true });
    temp.delete();
    writeSetting('backupAt', new Date().toISOString());
    writeSetting('backupError', '');
  } catch (e) {
    writeSetting('backupError', (e as Error).message);
  }
};

export const backup = () => inTurn(writeBackup);

export const chooseBackupFolder = async () => {
  if (Platform.OS === 'ios') writeSetting('backupFolder', 'documents');
  else {
    try {
      writeSetting('backupFolder', (await Directory.pickDirectoryAsync()).uri);
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_PICKER_CANCELLED') return;
      throw e;
    }
  }
  await backup();
};

export const stopBackup = () => {
  for (const key of ['backupFolder', 'backupAt', 'backupError']) writeSetting(key, '');
};

export const shareImage = async (view: RefObject<View | null>) => {
  const image = await makeImageFromView(view);
  if (!image) throw new Error('Could not draw the image');
  if (!exportDir.exists) exportDir.create();
  const file = new File(exportDir, 'nicereps-workout.png');
  if (file.exists) file.delete();
  file.create();
  file.write(image.encodeToBytes());
  image.dispose();
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share workout' });
};

export const shareTemplate = async () => {
  if (!exportDir.exists) exportDir.create();
  const file = new File(exportDir, 'nicereps-template.csv');
  file.write(data.blankTemplate);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Blank nicereps CSV template' });
};

export const pickImport = async (progress: (done: number) => void) => {
  const picked = await File.pickFileAsync();
  if (picked.canceled) return null;
  if (importDir.exists) importDir.delete();
  importDir.create();
  const handle = picked.result.open();
  const photos: ReturnType<File['open']>[] = [];
  let room = Paths.availableDiskSpace - 256 * 1024 * 1024;
  let source: DB | undefined;
  let imp: data.Import;
  try {
    imp = await steps(() => data.readImportSteps(
      db,
      (function* () {
        for (let chunk = handle.readBytes(1 << 20); chunk.length; chunk = handle.readBytes(1 << 20)) yield chunk;
      })(),
      undefined,
      (name) => {
        const file = new File(importDir, name);
        file.create();
        const out = file.open();
        photos.push(out);
        return (bytes, final) => {
          if ((room -= bytes.length) < 0) throw new Error('Not enough free space for the photos in this file');
          out.writeBytes(bytes);
          if (final) out.close();
        };
      },
      () => {
        picked.result.copySync(new File(importDir, 'import.sqlite'));
        const file = (source = open({ name: 'import.sqlite', location: importDir.uri, readOnly: true, failOnCreate: true }));
        return {
          all: (sql, params) => file.executeSync(sql, params).rows as Record<string, Value>[],
          run: (sql, params) => void file.executeSync(sql, params),
        };
      },
    ), progress);
  } finally {
    handle.close();
    source?.close();
    for (const out of photos) out.close();
  }
  if (imp.errors.length) importDir.delete();
  return { import: imp };
};

export const discardImport = () => {
  if (importDir.exists) importDir.delete();
};

export const previewImport = (imp: data.Import, map: Record<string, string>, progress: (done: number) => void) =>
  steps(() => data.previewImportSteps(db, imp, 'skip', {}, map), progress);

export const applyImport = async (imp: data.Import, action: data.Action, overrides: Record<string, data.Action>, map: Record<string, string>, progress: (done: number) => void) => {
  const preview = await steps(() => data.applyImportSteps(db, imp, action, overrides, map), progress);
  photoDir.create({ idempotent: true });
  for (const { file } of db.all('SELECT file FROM photo')) {
    const staged = new File(importDir, file as string);
    if (photoName.test(file as string) && staged.exists && !new File(photoDir, file as string).exists) staged.moveSync(photoDir);
  }
  if (importDir.exists) importDir.delete();
  return preview;
};

export const eraseData = () => {
  data.eraseAll(db);
  if (photoDir.exists) photoDir.delete();
  if (exportDir.exists) exportDir.delete();
  if (importDir.exists) importDir.delete();
  scheduleTimer(null, false);
};
