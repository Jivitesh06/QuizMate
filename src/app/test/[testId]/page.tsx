'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { collection, doc, getDoc, getDocs, setDoc, query, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebaseClient';
import { useAuth } from '@/context/AuthContext';
import styles from './test.module.css';

interface Question {
  id: string;
  topicId: string;
  questionText: string;
  options: string[];
}

interface TestDetails {
  id: string;
  type: string;
  topicId: string | null;
  durationMinutes: number;
}

export default function TestPage() {
  const router = useRouter();
  const { testId } = useParams() as { testId: string };
  const { user, loading: authLoading } = useAuth();

  // Test states
  const [loading, setLoading] = useState(true);
  const [test, setTest] = useState<TestDetails | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);

  // Status arrays (1-to-1 with questions)
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [marked, setMarked] = useState<boolean[]>([]);
  const [visited, setVisited] = useState<boolean[]>([]);

  // Timer states
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Submit and modal states
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // 1. Session Guard & Loading Details
  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.replace('/login');
      } else {
        fetchTestQuestions();
      }
    }
  }, [user, authLoading, router]);

  const fetchTestQuestions = async () => {
    try {
      if (!auth.currentUser) throw new Error('Not authenticated.');

      // 1. Fetch test document from Firestore
      const testSnap = await getDoc(doc(db, 'tests', testId));
      if (!testSnap.exists()) throw new Error('Test session not found.');

      const testData = testSnap.data();
      const questionIds: string[] = testData.questionIds || [];

      // 2. Fetch questions in chunks (Firestore 'in' limit = 10)
      const questionsMap = new Map<string, Question>();
      const chunks: string[][] = [];
      for (let i = 0; i < questionIds.length; i += 10) {
        chunks.push(questionIds.slice(i, i + 10));
      }
      for (const chunk of chunks) {
        const snap = await getDocs(query(collection(db, 'questions'), where('id', 'in', chunk)));
        snap.forEach(d => {
          const data = d.data();
          questionsMap.set(d.id, {
            id: d.id,
            topicId: data.topicId,
            questionText: data.questionText,
            options: data.options,
          });
        });
      }

      // 3. Sort in original order
      const orderedQuestions = questionIds
        .map(id => questionsMap.get(id))
        .filter((q): q is Question => q !== undefined);

      setTest({
        id: testData.id,
        type: testData.type,
        topicId: testData.topicId,
        durationMinutes: testData.durationMinutes || 15,
      });
      setQuestions(orderedQuestions);

      const size = orderedQuestions.length;
      setAnswers(new Array(size).fill(null));
      setMarked(new Array(size).fill(false));
      const initialVisited = new Array(size).fill(false);
      if (size > 0) initialVisited[0] = true;
      setVisited(initialVisited);
      setTimeLeft((testData.durationMinutes || 15) * 60);
    } catch (err: any) {
      console.error(err);
      setSubmitError(err.message || 'An error occurred loading the test.');
    } finally {
      setLoading(false);
    }
  };

  // 2. Countdown Timer Loop
  useEffect(() => {
    if (timeLeft === null) return;

    if (timeLeft <= 0) {
      // Auto-submit when timer hits 0
      autoSubmitTest();
      return;
    }

    timerRef.current = setTimeout(() => {
      setTimeLeft((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [timeLeft]);

  // 3. Navigation utilities
  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      const nextIdx = currentIdx + 1;
      // Mark next question as visited
      const updatedVisited = [...visited];
      updatedVisited[nextIdx] = true;
      setVisited(updatedVisited);
      setCurrentIdx(nextIdx);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) {
      const prevIdx = currentIdx - 1;
      const updatedVisited = [...visited];
      updatedVisited[prevIdx] = true;
      setVisited(updatedVisited);
      setCurrentIdx(prevIdx);
    }
  };

  const handleSelectOption = (optionIdx: number) => {
    const updatedAnswers = [...answers];
    updatedAnswers[currentIdx] = optionIdx;
    setAnswers(updatedAnswers);
  };

  const handleClearResponse = () => {
    const updatedAnswers = [...answers];
    updatedAnswers[currentIdx] = null;
    setAnswers(updatedAnswers);
  };

  const handleToggleMark = () => {
    const updatedMarked = [...marked];
    updatedMarked[currentIdx] = !updatedMarked[currentIdx];
    setMarked(updatedMarked);
  };

  const jumpToQuestion = (idx: number) => {
    const updatedVisited = [...visited];
    updatedVisited[idx] = true;
    setVisited(updatedVisited);
    setCurrentIdx(idx);
  };

  // 4. Submission
  const getSubmissionStats = () => {
    let answered = 0;
    let unanswered = 0;
    let reviewCount = 0;
    
    questions.forEach((_, idx) => {
      const isAnswered = answers[idx] !== null;
      const isMarked = marked[idx];
      
      if (isAnswered) answered++;
      else unanswered++;
      if (isMarked) reviewCount++;
    });

    return { answered, unanswered, reviewCount };
  };

  const autoSubmitTest = () => {
    if (submitting) return;
    submitTest(true);
  };

  const submitTest = async (isAuto = false) => {
    setSubmitting(true);
    setSubmitError('');
    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      if (!auth.currentUser) throw new Error('Not authenticated.');

      // 1. Fetch test doc to get questionIds and metadata
      const testSnap = await getDoc(doc(db, 'tests', testId));
      if (!testSnap.exists()) throw new Error('Test session not found.');
      const testData = testSnap.data();
      const questionIds: string[] = testData.questionIds || [];

      // 2. Fetch full question data (for grading correctAnswerIndex + explanation for result)
      const questionsMap = new Map<string, { correctAnswerIndex: number; explanation: string; questionText: string; options: string[]; topicId: string }>();
      const chunks: string[][] = [];
      for (let i = 0; i < questionIds.length; i += 10) {
        chunks.push(questionIds.slice(i, i + 10));
      }
      for (const chunk of chunks) {
        const snap = await getDocs(query(collection(db, 'questions'), where('id', 'in', chunk)));
        snap.forEach(d => {
          const data = d.data();
          questionsMap.set(d.id, {
            correctAnswerIndex: data.correctAnswerIndex ?? -1,
            explanation: data.explanation || '',
            questionText: data.questionText || '',
            options: data.options || [],
            topicId: data.topicId || '',
          });
        });
      }

      // 3. Build submission answers
      const submissionAnswers = questions.map((q, idx) => ({
        questionId: q.id,
        selectedIndex: answers[idx] ?? null,
      }));

      // 4. Grade client-side
      let correctCount = 0, incorrectCount = 0, unattemptedCount = 0;
      questionIds.forEach(qId => {
        const qInfo = questionsMap.get(qId);
        const studentAns = submissionAnswers.find(a => a.questionId === qId);
        if (!qInfo) { unattemptedCount++; return; }
        const isAttempted = studentAns && studentAns.selectedIndex !== null && studentAns.selectedIndex !== undefined;
        if (!isAttempted) {
          unattemptedCount++;
        } else if (studentAns!.selectedIndex === qInfo.correctAnswerIndex) {
          correctCount++;
        } else {
          incorrectCount++;
        }
      });

      const score = correctCount * 3;

      // 5. Embed full question details in attempt (so result page works without extra queries)
      const questionDetails = questionIds.map(qId => {
        const qInfo = questionsMap.get(qId);
        const studentAns = submissionAnswers.find(a => a.questionId === qId);
        return {
          questionId: qId,
          questionText: qInfo?.questionText ?? '',
          options: qInfo?.options ?? [],
          topicId: qInfo?.topicId ?? '',
          correctAnswerIndex: qInfo?.correctAnswerIndex ?? -1,
          explanation: qInfo?.explanation ?? '',
          studentSelectedIndex: studentAns?.selectedIndex ?? null,
        };
      });

      // 6. Save attempt to Firestore
      const attemptRef = doc(collection(db, 'attempts'));
      await setDoc(attemptRef, {
        id: attemptRef.id,
        userId: auth.currentUser.uid,
        userEmail: auth.currentUser.email || 'Unknown',
        userName: auth.currentUser.displayName || auth.currentUser.email || 'Unknown',
        testId,
        testType: testData.type,
        testTopicId: testData.topicId,
        answers: submissionAnswers,
        questionDetails,
        score,
        correctCount,
        incorrectCount,
        unattemptedCount,
        startedAt: testData.createdAt || new Date().toISOString(),
        submittedAt: new Date().toISOString(),
      });

      router.replace(`/result/${attemptRef.id}`);
    } catch (err: any) {
      console.error(err);
      setSubmitError(err.message || 'An error occurred while submitting.');
      setSubmitting(false);
      setShowSubmitModal(false);
    }
  };

  // Helper: Format remaining seconds to mm:ss
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading || authLoading || !test) {
    return (
      <div className={styles.container} style={{ textAlign: 'center', justifyContent: 'center', display: 'flex' }}>
        <p style={{ color: '#64748b', fontSize: '1.1rem', fontWeight: 500 }}>Initializing secure exam session...</p>
      </div>
    );
  }

  const currentQuestion = questions[currentIdx];
  const stats = getSubmissionStats();
  const isTimeWarning = timeLeft !== null && timeLeft <= 60; // Warn when under 1 minute

  return (
    <div className={styles.container}>
      {/* Top Bar Navigation */}
      <header className={styles.topBar}>
        <div className={styles.logo}>Quiz<span className={styles.logoText}>Mate</span></div>
        <div className={styles.testTitle}>
          Logical Reasoning: {test.type === 'random' ? 'General Mock Exam' : 'Topic Practice Test'}
        </div>
        <div className={styles.headerActions}>
          <div className={`${styles.timer} ${isTimeWarning ? styles.timerWarning : ''}`}>
            Time Left: {timeLeft !== null ? formatTime(timeLeft) : '00:00'}
          </div>
          <button className={styles.submitBtn} onClick={() => setShowSubmitModal(true)}>
            Submit Test
          </button>
        </div>
      </header>

      {/* Main split exam area */}
      <div className={styles.workspace}>
        {/* Left Column - Workstation */}
        {questions.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', flex: 1 }}>
            <p style={{ color: '#dc2626', fontWeight: 600 }}>This test contains no questions. Please contact administration.</p>
          </div>
        ) : (
          <main className={styles.questionPanel}>
            <div className={styles.questionHeader}>
              <div className={styles.questionMeta}>
                Question {currentIdx + 1} of {questions.length}
              </div>
              <div className={styles.topicTag}>Topic ID: {currentQuestion.topicId}</div>
            </div>

            <div className={styles.questionBody}>
              <div className={styles.questionText}>{currentQuestion.questionText}</div>
              
              <div className={styles.optionsList}>
                {currentQuestion.options.map((optionText, idx) => {
                  const isSelected = answers[currentIdx] === idx;
                  const optionLetters = ['A', 'B', 'C', 'D'];
                  return (
                    <label 
                      key={idx} 
                      className={`${styles.optionLabel} ${isSelected ? styles.optionSelected : ''}`}
                    >
                      <input
                        type="radio"
                        name="mcq-options"
                        className={styles.radioInput}
                        checked={isSelected}
                        onChange={() => handleSelectOption(idx)}
                      />
                      <span className={styles.optionText}>
                        <strong>{optionLetters[idx]}.</strong> {optionText}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Panel Actions Footer */}
            <footer className={styles.footerActions}>
              <div className={styles.btnGroup}>
                <button 
                  className={`${styles.actionBtn} ${marked[currentIdx] ? styles.actionBtnReview : ''}`} 
                  onClick={handleToggleMark}
                >
                  {marked[currentIdx] ? 'Unmark Review' : 'Mark for Review'}
                </button>
                <button className={styles.actionBtn} onClick={handleClearResponse}>
                  Clear Response
                </button>
              </div>

              <div className={styles.btnGroup}>
                <button 
                  className={styles.actionBtn} 
                  onClick={handlePrev}
                  disabled={currentIdx === 0}
                >
                  &larr; Previous
                </button>
                <button 
                  className={`${styles.actionBtn} ${styles.actionBtnPrimary}`} 
                  onClick={handleNext}
                  disabled={currentIdx === questions.length - 1}
                >
                  Next &rarr;
                </button>
              </div>
            </footer>
          </main>
        )}

        {/* Right Column - Navigation Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTitle}>Question Palette</div>
          
          <div className={styles.gridContainer}>
            <div className={styles.questionGrid}>
              {questions.map((_, idx) => {
                const isCurrent = currentIdx === idx;
                const isAnswered = answers[idx] !== null;
                const isMarked = marked[idx];
                const isVisited = visited[idx];

                // Determine grid item CSS class
                let gridStyle = styles.gridUnvisited;
                if (isMarked && isAnswered) {
                  gridStyle = styles.gridMarkedAnswered;
                } else if (isMarked) {
                  gridStyle = styles.gridMarked;
                } else if (isAnswered) {
                  gridStyle = styles.gridAnswered;
                } else if (isVisited) {
                  gridStyle = styles.gridNotAnswered;
                }

                return (
                  <button
                    key={idx}
                    className={`${styles.gridItem} ${gridStyle} ${isCurrent ? styles.gridActive : ''}`}
                    onClick={() => jumpToQuestion(idx)}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Color Legend */}
            <div className={styles.legend}>
              <div className={styles.legendItem}>
                <div className={`${styles.legendBox} ${styles.gridAnswered}`}></div>
                <span>Answered</span>
              </div>
              <div className={styles.legendItem}>
                <div className={`${styles.legendBox} ${styles.gridNotAnswered}`}></div>
                <span>Not Answered</span>
              </div>
              <div className={styles.legendItem}>
                <div className={`${styles.legendBox} ${styles.gridUnvisited}`}></div>
                <span>Not Visited</span>
              </div>
              <div className={styles.legendItem}>
                <div className={`${styles.legendBox} ${styles.gridMarked}`}></div>
                <span>Marked for Review</span>
              </div>
              <div className={styles.legendItem}>
                <div className={`${styles.legendBox} ${styles.gridMarkedAnswered}`}></div>
                <span>Answered & Marked</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Submit Confirmation Modal */}
      {showSubmitModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>Confirm Submission</div>
            
            <div className={styles.modalBody}>
              <div className={styles.modalTitle}>Are you sure you want to submit your mock test?</div>
              
              <table className={styles.statsTable}>
                <tbody>
                  <tr>
                    <td>Total Questions</td>
                    <td className={styles.statsVal}>{questions.length}</td>
                  </tr>
                  <tr>
                    <td style={{ color: '#16a34a', fontWeight: 600 }}>✓ Answered Questions</td>
                    <td className={styles.statsVal} style={{ color: '#16a34a' }}>{stats.answered}</td>
                  </tr>
                  <tr>
                    <td style={{ color: '#dc2626', fontWeight: 600 }}>✗ Unanswered Questions</td>
                    <td className={styles.statsVal} style={{ color: '#dc2626' }}>{stats.unanswered}</td>
                  </tr>
                  <tr>
                    <td style={{ color: '#d97706', fontWeight: 600 }}>★ Marked for Review</td>
                    <td className={styles.statsVal} style={{ color: '#d97706' }}>{stats.reviewCount}</td>
                  </tr>
                </tbody>
              </table>
              
              {submitError && <div style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 500 }}>{submitError}</div>}
            </div>

            <div className={styles.modalFooter}>
              <button 
                className={styles.modalBtn} 
                onClick={() => setShowSubmitModal(false)}
                disabled={submitting}
              >
                Return to Test
              </button>
              <button 
                className={`${styles.modalBtn} ${styles.modalBtnConfirm}`} 
                onClick={() => submitTest(false)}
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : 'Yes, Submit Test'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Submit / Time Expired HUD Overlay */}
      {submitting && !showSubmitModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ textAlign: 'center', padding: '2rem' }}>
            <h3 style={{ color: '#0f172a', marginBottom: '0.5rem' }}>Submitting Mock Exam</h3>
            <p style={{ color: '#64748b' }}>Uploading responses and generating detailed score analysis...</p>
          </div>
        </div>
      )}
    </div>
  );
}
