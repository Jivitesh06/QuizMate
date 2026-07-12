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
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n').replace(/"/g, ''),
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
