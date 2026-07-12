import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user using Firebase ID Token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized. No token provided.' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (err) {
      return NextResponse.json({ error: 'Unauthorized. Invalid token.' }, { status: 401 });
    }

    // 2. Check if user is Admin
    const userEmail = decodedToken.email;
    const adminEmailConfig = process.env.ADMIN_EMAIL || 'admin@example.com';
    if (!userEmail || userEmail.toLowerCase() !== adminEmailConfig.toLowerCase()) {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    // 3. Parse input request
    const body = await req.json();
    const { topicName, questionText, options, correctAnswerIndex, explanation } = body;

    // Validate inputs
    if (!topicName || !questionText || !options || options.length !== 4 || options.some((opt: string) => !opt.trim()) || correctAnswerIndex === undefined) {
      return NextResponse.json({ error: 'Missing or invalid fields. 4 non-empty options required.' }, { status: 400 });
    }

    const cleanTopicName = topicName.trim();
    const topicId = generateSlug(cleanTopicName);

    // 4. Find or create Topic in Firestore
    const topicRef = adminDb.collection('topics').doc(topicId);
    const topicSnap = await topicRef.get();
    
    if (!topicSnap.exists) {
      await topicRef.set({
        id: topicId,
        name: cleanTopicName,
        description: `Practice questions on ${cleanTopicName}.`,
      });
    }

    // 5. Create Question in Firestore
    const questionRef = adminDb.collection('questions').doc();
    const questionData = {
      id: questionRef.id,
      topicId,
      questionText: questionText.trim(),
      options: options.map((opt: string) => opt.trim()),
      correctAnswerIndex: parseInt(correctAnswerIndex, 10),
      explanation: (explanation || '').trim(),
    };

    await questionRef.set(questionData);

    return NextResponse.json({ success: true, questionId: questionRef.id });
  } catch (error: any) {
    console.error('Error in manual question creation API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
