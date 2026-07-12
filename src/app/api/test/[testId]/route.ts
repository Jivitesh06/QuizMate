import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export async function GET(req: NextRequest, { params }: { params: Promise<{ testId: string }> }) {
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

    const { testId } = await params;

    // 2. Fetch test document
    const testSnap = await adminDb.collection('tests').doc(testId).get();
    if (!testSnap.exists) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    const testData = testSnap.data()!;
    const questionIds: string[] = testData.questionIds || [];

    // 3. Fetch all matching questions
    const questions: any[] = [];
    
    if (questionIds.length > 0) {
      // Firestore 'in' queries allow up to 30 items.
      // Since mock tests are capped at 30, we can run a single query, or chunk it if needed.
      // Let's support chunking just in case.
      const chunks: string[][] = [];
      const chunkSize = 10;
      for (let i = 0; i < questionIds.length; i += chunkSize) {
        chunks.push(questionIds.slice(i, i + chunkSize));
      }

      for (const chunk of chunks) {
        const questionsSnap = await adminDb
          .collection('questions')
          .where('id', 'in', chunk)
          .get();

        for (const doc of questionsSnap.docs) {
          const data = doc.data();
          // Stripping correctAnswerIndex and explanation to prevent inspect element cheats
          questions.push({
            id: doc.id,
            topicId: data.topicId,
            questionText: data.questionText,
            options: data.options,
          });
        }
      }
    }

    // Sort questions in the order of testData.questionIds
    const orderedQuestions = questionIds
      .map(id => questions.find(q => q.id === id))
      .filter(q => q !== undefined);

    return NextResponse.json({
      success: true,
      test: {
        id: testData.id,
        type: testData.type,
        topicId: testData.topicId,
        durationMinutes: testData.durationMinutes,
        createdAt: testData.createdAt,
      },
      questions: orderedQuestions,
    });
  } catch (error: any) {
    console.error('Error in fetching test details API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
