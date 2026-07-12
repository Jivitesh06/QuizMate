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
  const trimmed = raw.trim();
  try {
    // Strip all whitespaces/newlines from base64 string
    const cleanedB64 = trimmed.replace(/\s+/g, '');
    const decoded = Buffer.from(cleanedB64, 'base64').toString('utf-8');
    if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
      return decoded;
    }
  } catch (e) {
    // Not base64 or failed to decode
  }
  // Fallback: handle literal \n sequences (for local .env.local)
  return trimmed.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
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
