import { createId } from '@paralleldrive/cuid2';
import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import * as measures from '@/domain/measurements';

import { db } from './db';

export const photoDir = new Directory(Paths.document, 'photos');

export const photoUri = (file: string) => new File(photoDir, file).uri;

export const addPhoto = async (date: string, camera: boolean) => {
  if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Allow camera access in system settings to take a photo');
  const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ mediaTypes: ['images'] });
  if (result.canceled) return false;
  const source = new File(result.assets[0].uri);
  photoDir.create({ idempotent: true });
  const target = new File(photoDir, `${createId()}${source.extension || '.jpg'}`);
  try {
    source.copySync(target);
    measures.addPhoto(db, date, target.name);
  } catch (e) {
    if (target.exists) target.delete();
    throw e;
  }
  source.delete();
  return true;
};

export const deletePhoto = (id: string) => {
  const file = new File(photoDir, measures.deletePhoto(db, id));
  if (file.exists) file.delete();
};
