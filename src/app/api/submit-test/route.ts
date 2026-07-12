import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (err) {
      return NextResponse.json({ error: 'Unauthorized. Invalid token.' }, { status: 401 });
    }

    const userId = decodedToken.uid;

    // 2. Parse request body
    const body = await req.json();
    const { testId, answers } = body as {
      testId: string;
      answers: { questionId: string; selectedIndex: number | null }[];
    };

    if (!testId || !answers) {
      return NextResponse.json({ error: 'Missing testId or answers' }, { status: 400 });
    }

    // 3. Fetch test configuration
    const testSnap = await adminDb.collection('tests').doc(testId).get();
    if (!testSnap.exists) {
      return NextResponse.json({ error: 'Test configuration not found' }, { status: 404 });
    }
    const testData = testSnap.data()!;
    const questionIds: string[] = testData.questionIds || [];

    // 4. Fetch questions from Firestore to grade them securely
    const questionsMap = new Map<string, { correctAnswerIndex: number }>();
    
    if (questionIds.length > 0) {
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
          questionsMap.set(doc.id, {
            correctAnswerIndex: data.correctAnswerIndex,
          });
        }
      }
    }

    // 5. Grading logic (+3 for correct, 0 for incorrect, 0 for unattempted)
    let correctCount = 0;
    let incorrectCount = 0;
    let unattemptedCount = 0;

    questionIds.forEach((qId) => {
      const studentAns = answers.find((ans) => ans.questionId === qId);
      const isAttempted = studentAns && studentAns.selectedIndex !== null && studentAns.selectedIndex !== undefined;

      const questionInfo = questionsMap.get(qId);
      if (!questionInfo) {
        unattemptedCount++;
        return;
      }

      if (!isAttempted) {
        unattemptedCount++;
      } else {
        if (studentAns.selectedIndex === questionInfo.correctAnswerIndex) {
          correctCount++;
        } else {
          incorrectCount++;
        }
      }
    });

    const score = correctCount * 3; // +3 for correct, 0 for incorrect

    // 6. Write attempt document to Firestore
    const attemptRef = adminDb.collection('attempts').doc();
    const attemptData = {
      id: attemptRef.id,
      userId,
      testId,
      testType: testData.type,
      testTopicId: testData.topicId,
      answers,
      score,
      correctCount,
      incorrectCount,
      unattemptedCount,
      startedAt: testData.createdAt || new Date().toISOString(),
      submittedAt: new Date().toISOString(),
    };

    await attemptRef.set(attemptData);

    return NextResponse.json({ success: true, attemptId: attemptRef.id });
  } catch (error: any) {
    console.error('Error in grading test API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
