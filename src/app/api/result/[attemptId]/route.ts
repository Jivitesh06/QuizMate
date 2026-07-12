import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export async function GET(req: NextRequest, { params }: { params: Promise<{ attemptId: string }> }) {
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

    const { attemptId } = await params;
    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;

    // 2. Fetch attempt document
    const attemptSnap = await adminDb.collection('attempts').doc(attemptId).get();
    if (!attemptSnap.exists) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    const attemptData = attemptSnap.data()!;

    // 3. Authorization check (only owner or admin can view results)
    const adminEmailConfig = process.env.ADMIN_EMAIL || 'admin@example.com';
    const isAdmin = userEmail && userEmail.toLowerCase() === adminEmailConfig.toLowerCase();
    
    if (attemptData.userId !== userId && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden. You do not own this attempt.' }, { status: 403 });
    }

    // 4. Fetch the questions to map responses, correct answers, and explanations
    const answersList: { questionId: string; selectedIndex: number | null }[] = attemptData.answers || [];
    const questionIds = answersList.map(a => a.questionId);

    const questions: any[] = [];
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
          const studentAns = answersList.find(ans => ans.questionId === doc.id);
          
          questions.push({
            id: doc.id,
            topicId: data.topicId,
            questionText: data.questionText,
            options: data.options,
            correctAnswerIndex: data.correctAnswerIndex,
            explanation: data.explanation || '',
            studentSelectedIndex: studentAns ? studentAns.selectedIndex : null,
          });
        }
      }
    }

    // Sort questions in the order of the original test questionIds
    const orderedQuestions = questionIds
      .map(id => questions.find(q => q.id === id))
      .filter(q => q !== undefined);

    // Fetch topic name if topicId exists
    let topicName = 'All Topics';
    if (attemptData.testTopicId) {
      const topicSnap = await adminDb.collection('topics').doc(attemptData.testTopicId).get();
      if (topicSnap.exists) {
        topicName = topicSnap.data()?.name || 'Unknown Topic';
      }
    }

    return NextResponse.json({
      success: true,
      attempt: {
        id: attemptData.id,
        testId: attemptData.testId,
        testType: attemptData.testType,
        testTopicId: attemptData.testTopicId,
        testTopicName: topicName,
        score: attemptData.score,
        correctCount: attemptData.correctCount,
        incorrectCount: attemptData.incorrectCount,
        unattemptedCount: attemptData.unattemptedCount,
        startedAt: attemptData.startedAt,
        submittedAt: attemptData.submittedAt,
      },
      questions: orderedQuestions,
    });
  } catch (error: any) {
    console.error('Error in fetching attempt results API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
