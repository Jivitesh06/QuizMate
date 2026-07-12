'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { auth } from '@/lib/firebaseClient';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import styles from './result.module.css';

interface AttemptDetails {
  id: string;
  testId: string;
  testType: string;
  testTopicId: string | null;
  testTopicName: string;
  score: number;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  startedAt: string;
  submittedAt: string;
}

interface QuestionReview {
  id: string;
  topicId: string;
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
  studentSelectedIndex: number | null;
}

export default function ResultPage() {
  const router = useRouter();
  const { attemptId } = useParams() as { attemptId: string };
  const { user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState<AttemptDetails | null>(null);
  const [questions, setQuestions] = useState<QuestionReview[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.replace('/login');
      } else {
        fetchAttemptResults();
      }
    }
  }, [user, authLoading, router]);

  const fetchAttemptResults = async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Authorization required.');

      const response = await fetch(`/api/result/${attemptId}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch test results.');
      }

      setAttempt(data.attempt);
      setQuestions(data.questions);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred loading results.');
    } finally {
      setLoading(false);
    }
  };

  // Helper: Format duration from startedAt and submittedAt
  const formatTimeTaken = (start: string, end: string) => {
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    
    if (mins === 0) {
      return `${secs} seconds`;
    }
    return `${mins}m ${secs}s`;
  };

  if (loading || authLoading) {
    return (
      <div className={styles.container} style={{ textAlign: 'center', marginTop: '10%' }}>
        <p style={{ color: '#64748b', fontSize: '1.1rem', fontWeight: 500 }}>Loading mock test analysis...</p>
      </div>
    );
  }

  if (error || !attempt) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Result Details</h1>
          <Link href="/dashboard" className={styles.navButton}>
            Back to Dashboard
          </Link>
        </header>
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', padding: '1.5rem', borderRadius: '12px', textAlign: 'center' }}>
          <p style={{ fontWeight: 600 }}>{error || 'Attempt records could not be loaded.'}</p>
        </div>
      </div>
    );
  }

  const totalQuestions = attempt.correctCount + attempt.incorrectCount + attempt.unattemptedCount;
  const accuracy = totalQuestions > 0 ? Math.round((attempt.correctCount / totalQuestions) * 100) : 0;
  const timeTaken = formatTimeTaken(attempt.startedAt, attempt.submittedAt);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Performance Analysis</h1>
          <p className={styles.subtitle}>
            Review details of your {attempt.testType === 'random' ? 'Random Mock' : 'Topic Practice'} test ({attempt.testTopicName}).
          </p>
        </div>
        <Link href="/dashboard" className={styles.navButton}>
          Back to Dashboard
        </Link>
      </header>

      {/* Summary dashboard cards */}
      <section className={styles.summaryCard}>
        <div className={styles.scoreSection}>
          <span className={styles.scoreLabel}>Final Score</span>
          <div className={styles.scoreVal}>+{attempt.score}</div>
          <span className={styles.accuracyText}>Accuracy: {accuracy}%</span>
        </div>

        <div className={styles.statsSection}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Total Questions</span>
            <span className={styles.statVal} style={{ color: '#475569' }}>{totalQuestions}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Correct Answers</span>
            <span className={styles.statVal} style={{ color: '#16a34a' }}>{attempt.correctCount}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Incorrect Answers</span>
            <span className={styles.statVal} style={{ color: '#dc2626' }}>{attempt.incorrectCount}</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Time Taken</span>
            <span className={styles.statVal} style={{ color: '#2563eb' }}>{timeTaken}</span>
          </div>
        </div>
      </section>

      {/* Questions Review List */}
      <h2 className={styles.sectionTitle}>Question-by-Question Review</h2>
      
      <div style={{ marginTop: '1.5rem' }}>
        {questions.map((q, idx) => {
          const isCorrect = q.studentSelectedIndex === q.correctAnswerIndex;
          const isUnattempted = q.studentSelectedIndex === null || q.studentSelectedIndex === undefined;
          
          let statusText = 'Correct';
          let statusTagStyle = styles.tagCorrect;

          if (isUnattempted) {
            statusText = 'Unattempted';
            statusTagStyle = styles.tagUnattempted;
          } else if (!isCorrect) {
            statusText = 'Incorrect';
            statusTagStyle = styles.tagIncorrect;
          }

          const optionLetters = ['A', 'B', 'C', 'D'];

          return (
            <article key={q.id} className={styles.reviewItem}>
              <div className={styles.reviewHeader}>
                <span className={styles.questionNum}>Question {idx + 1}</span>
                <span className={`${styles.statusTag} ${statusTagStyle}`}>{statusText}</span>
              </div>

              <div className={styles.questionText}>{q.questionText}</div>

              <div className={styles.optionsList}>
                {q.options.map((optionText, optIdx) => {
                  const isCorrectOpt = optIdx === q.correctAnswerIndex;
                  const isSelectedOpt = optIdx === q.studentSelectedIndex;

                  let optionStyle = '';
                  if (isCorrectOpt) {
                    optionStyle = styles.optionCorrect;
                  } else if (isSelectedOpt && !isCorrect) {
                    optionStyle = styles.optionIncorrect;
                  }

                  return (
                    <div key={optIdx} className={`${styles.option} ${optionStyle}`}>
                      <span className={styles.optionIndicator}>{optionLetters[optIdx]}.</span>
                      <span className={styles.optionText}>{optionText}</span>
                      
                      {isCorrectOpt && (
                        <span className={styles.correctTick}>✓ Correct Answer</span>
                      )}
                      {isSelectedOpt && !isCorrect && (
                        <span className={styles.incorrectCross}>✗ Your Selection</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Explanations section */}
              <div className={styles.explanationBox}>
                <div className={styles.explanationTitle}>Step-by-Step Solution & Logic</div>
                <div className={styles.explanationText}>
                  {q.explanation || 'No detailed explanation provided for this question.'}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
