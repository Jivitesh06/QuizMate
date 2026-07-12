import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

// Helper function to shuffle an array
function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    try {
      await adminAuth.verifyIdToken(token);
    } catch (err) {
      return NextResponse.json({ error: 'Unauthorized. Invalid token.' }, { status: 401 });
    }

    // 2. Parse body
    const body = await req.json();
    const { type, topicId, questionCount, durationMinutes } = body;

    const count = parseInt(questionCount, 10) || 10;
    const duration = parseInt(durationMinutes, 10) || 15;

    // 3. Query questions
    let questionsQuery = adminDb.collection('questions');
    let questionsSnap;

    if (type === 'topic' && topicId) {
      questionsSnap = await questionsQuery.where('topicId', '==', topicId).get();
    } else {
      questionsSnap = await questionsQuery.get();
    }

    if (questionsSnap.empty) {
      return NextResponse.json({ error: 'No questions found for the selected configuration.' }, { status: 400 });
    }

    // 4. Select random question IDs
    let allIds: string[] = [];
    for (const doc of questionsSnap.docs) {
      allIds.push(doc.id);
    }

    const shuffledIds = shuffleArray(allIds);
    const selectedIds = shuffledIds.slice(0, Math.min(count, shuffledIds.length));

    // 5. Create Test document
    const testRef = adminDb.collection('tests').doc();
    const testData = {
      id: testRef.id,
      type,
      topicId: type === 'topic' ? topicId : null,
      durationMinutes: duration,
      questionIds: selectedIds,
      createdAt: new Date().toISOString(),
    };

    await testRef.set(testData);

    return NextResponse.json({ success: true, testId: testRef.id });
  } catch (error: any) {
    console.error('Error in creating test API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
