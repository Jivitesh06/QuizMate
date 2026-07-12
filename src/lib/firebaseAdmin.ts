import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (getApps().length === 0) {
  if (
    projectId &&
    clientEmail &&
    privateKey &&
    !privateKey.includes('placeholder')
  ) {
    // Vercel stores \n as literal backslash+n — convert to real newlines
    const formattedKey = privateKey
      .replace(/\\n/g, '\n')   // literal \n → actual newline
      .replace(/^"|"$/g, ''); // strip surrounding quotes if any

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: formattedKey,
      }),
    });
  } else {
    try {
      initializeApp();
    } catch (error) {
      console.warn('Firebase Admin SDK could not be initialized. Please configure credentials in .env.local', error);
    }
  }
}

const adminDb = getFirestore();
const adminAuth = getAuth();

export { adminDb, adminAuth };
