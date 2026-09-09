#!/usr/bin/env node
// One-time: hapus seluruh data menu Notifikasi di Firestore — koleksi `notifications`
// (riwayat pesan) dan `fcmTokens` (token push perangkat). Menghapus fcmTokens akan
// menghentikan push notification sampai perangkat registrasi ulang otomatis saat
// dibuka lagi.
// Usage: node scripts/clear-notifikasi-data.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    // FIREBASE_SERVICE_ACCOUNT is stored as a JSON-escaped string (its own quotes
    // are backslash-escaped), so the raw quoted value must be JSON-parsed once to
    // unescape it before the resulting text can be JSON-parsed again as the object.
    if (key === 'FIREBASE_SERVICE_ACCOUNT') {
      process.env[key] ??= JSON.parse(rawValue);
      continue;
    }
    process.env[key] ??= rawValue.replace(/^"(.*)"$/, '$1');
  }
}

async function deleteCollection(db, collectionName, batchSize = 300) {
  let total = 0;
  for (;;) {
    const snap = await db.collection(collectionName).limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    total += snap.size;
  }
  return total;
}

async function main() {
  loadEnvLocal();
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const app = initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);

  console.log('-- Hapus data menu Notifikasi (Firestore) --');
  const notifCount = await deleteCollection(db, 'notifications');
  console.log(`notifications: ${notifCount} dokumen dihapus`);

  const tokenCount = await deleteCollection(db, 'fcmTokens');
  console.log(`fcmTokens: ${tokenCount} dokumen dihapus`);

  console.log('\nSelesai.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nGAGAL.');
  console.error(err.message);
  process.exit(1);
});
