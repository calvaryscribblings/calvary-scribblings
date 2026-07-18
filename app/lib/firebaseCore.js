'use client';
// Storage-free Firebase surface for hot read routes.
//
// lib/firebase.js eagerly `import { getStorage } from 'firebase/storage'` and calls
// getStorage(app) at module load, so ANY route importing it — even for `db` alone —
// drags the Storage SDK into its initial bundle. This module initialises the SAME
// app (the getApps() guard shares the singleton, so there is no double-init) but
// exposes only db + auth, keeping firebase/storage off routes that never upload.
//
// lib/firebase.js is deliberately left untouched: bookstore, reader, and admin
// still import `storage` from it. This is an additive lazy path, not a rewrite.
// Routes that need storage but not eagerly can call getStorageLazy(), which
// dynamic-imports firebase/storage on first use so it lands in an async chunk.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export default app;

// Lazy Storage accessor — firebase/storage is only pulled when this is first
// called, so it never enters a route's initial bundle.
let _storage;
export async function getStorageLazy() {
  if (!_storage) {
    const { getStorage } = await import('firebase/storage');
    _storage = getStorage(app);
  }
  return _storage;
}
