import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId   = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const rawKey      = process.env.FIREBASE_PRIVATE_KEY || '';

/**
 * Decode the private key safely — works on Vercel, local, and any platform.
 * We store the key as Base64 in env vars to avoid \n escaping issues entirely.
 * Falls back to raw string handling for backward-compatibility.
 */
function decodePrivateKey(raw: string): string {
  // Detect Base64: no spaces, no dashes, length multiple of 4 (approx)
  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(raw.trim()) && !raw.includes('BEGIN');
  if (isBase64) {
    return Buffer.from(raw.trim(), 'base64').toString('utf-8');
  }
  // Fallback: handle literal \n sequences (for local .env.local)
  return raw.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
}

if (getApps().length === 0) {
  if (projectId && clientEmail && rawKey && !rawKey.includes('placeholder')) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: decodePrivateKey(rawKey),
      }),
    });
  } else {
    try {
      initializeApp();
    } catch (error) {
      console.warn(
        'Firebase Admin SDK could not be initialized. Configure credentials in .env.local',
        error
      );
    }
  }
}

const adminDb   = getFirestore();
const adminAuth = getAuth();

export { adminDb, adminAuth };
