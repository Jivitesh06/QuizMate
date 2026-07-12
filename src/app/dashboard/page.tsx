'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebaseClient';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import styles from './dashboard.module.css';

interface Topic {
  id: string;
  name: string;
  description: string;
}

interface Attempt {
  id: string;
  testId: string;
  score: number;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  submittedAt: string;
  testType: string;
  testTopicName?: string;
  totalQuestions: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, isAdmin } = useAuth();

  // Test setup form states
  const [testType, setTestType] = useState<'random' | 'topic'>('random');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [questionCount, setQuestionCount] = useState('10');
  const [durationMinutes, setDurationMinutes] = useState('15');
  const [formError, setFormError] = useState('');
  const [startLoading, setStartLoading] = useState(false);

  // User attempts state
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);

  // Authenticate and load initial data
  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else {
        fetchTopicsAndAttempts();
      }
    }
  }, [user, loading, router]);

  const fetchTopicsAndAttempts = async () => {
    if (!auth.currentUser) return;
    try {
      // 1. Fetch Topics
      const topicsSnap = await getDocs(collection(db, 'topics'));
      const topicsList: Topic[] = [];
      const topicsMap = new Map<string, string>(); // id -> name
      
      topicsSnap.forEach((doc) => {
        const data = doc.data() as Omit<Topic, 'id'>;
        const topicItem = { id: doc.id, ...data };
        topicsList.push(topicItem);
        topicsMap.set(doc.id, data.name);
      });
      setTopics(topicsList);
      if (topicsList.length > 0) {
        setSelectedTopicId(topicsList[0].id);
      }

      // 2. Fetch User Attempts
      const attemptsQuery = query(
        collection(db, 'attempts'),
        where('userId', '==', auth.currentUser.uid)
      );
      const attemptsSnap = await getDocs(attemptsQuery);
      const attemptsList: Attempt[] = [];

      // Since we don't have indexes configured yet on (userId, submittedAt desc),
      // we query by userId and sort in-memory to prevent Firestore index errors
      attemptsSnap.forEach((doc) => {
        const data = doc.data();
        attemptsList.push({
          id: doc.id,
          testId: data.testId,
          score: data.score,
          correctCount: data.correctCount,
          incorrectCount: data.incorrectCount,
          unattemptedCount: data.unattemptedCount,
          submittedAt: data.submittedAt,
          testType: data.testType || 'Unknown',
          testTopicName: data.testTopicId ? topicsMap.get(data.testTopicId) : 'All Topics',
          totalQuestions: (data.correctCount + data.incorrectCount + data.unattemptedCount) || 0,
        });
      });

      // Sort attempts by submittedAt descending
      attemptsList.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setAttempts(attemptsList);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setAttemptsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/login');
    } catch (err) {
      console.error('Signout failed', err);
    }
  };

  const handleStartTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setStartLoading(true);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Authorization required.');

      const response = await fetch('/api/test/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          type: testType,
          topicId: testType === 'topic' ? selectedTopicId : null,
          questionCount: parseInt(questionCount, 10),
          durationMinutes: parseInt(durationMinutes, 10),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to initialize test.');
      }

      // Route user to the testing workspace
      router.push(`/test/${data.testId}`);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'An error occurred while creating the test.');
      setStartLoading(false);
    }
  };

  if (loading || !user) {
    return (
      <div className={styles.container} style={{ textAlign: 'center', marginTop: '10%' }}>
        <p style={{ color: '#64748b', fontSize: '1.1rem', fontWeight: 500 }}>Loading dashboard session...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Student Quiz Console</h1>
          <p className={styles.subtitle}>Configure a new mock test or review previous performance statistics.</p>
        </div>
        <div className={styles.userMenu}>
          {isAdmin && (
            <Link href="/admin" className={styles.adminLink}>
              Admin Console
            </Link>
          )}
          <span className={styles.userEmail}>{user.email}</span>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <div className={styles.grid}>
        {/* Test Setup Form */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Configure New Test</h2>
          {formError && <div style={{ color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 500 }}>{formError}</div>}
          
          <form onSubmit={handleStartTest}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Test Mode</label>
              <div className={styles.typeSelector}>
                <button
                  type="button"
                  className={testType === 'random' ? styles.typeBtnActive : styles.typeBtn}
                  onClick={() => setTestType('random')}
                >
                  Random Mock (All Topics)
                </button>
                <button
                  type="button"
                  className={testType === 'topic' ? styles.typeBtnActive : styles.typeBtn}
                  onClick={() => setTestType('topic')}
                >
                  Topic Focused
                </button>
              </div>
            </div>

            {testType === 'topic' && (
              <div className={styles.formGroup}>
                <label className={styles.label} htmlFor="topicSelect">Select Topic</label>
                {topics.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>
                    No topics loaded. Please upload questions in the Admin Console.
                  </p>
                ) : (
                  <select
                    id="topicSelect"
                    className={styles.select}
                    value={selectedTopicId}
                    onChange={(e) => setSelectedTopicId(e.target.value)}
                    required
                  >
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="questionCountSelect">Number of Questions</label>
              <select
                id="questionCountSelect"
                className={styles.select}
                value={questionCount}
                onChange={(e) => setQuestionCount(e.target.value)}
              >
                <option value="5">5 Questions</option>
                <option value="10">10 Questions</option>
                <option value="15">15 Questions</option>
                <option value="20">20 Questions</option>
                <option value="30">30 Questions</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="durationSelect">Time Limit</label>
              <select
                id="durationSelect"
                className={styles.select}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
              >
                <option value="5">5 Minutes</option>
                <option value="10">10 Minutes</option>
                <option value="15">15 Minutes</option>
                <option value="20">20 Minutes</option>
                <option value="30">30 Minutes</option>
                <option value="45">45 Minutes</option>
                <option value="60">60 Minutes</option>
              </select>
            </div>

            <button type="submit" className={styles.startBtn} disabled={startLoading || (testType === 'topic' && topics.length === 0)}>
              {startLoading ? 'Preparing test environment...' : 'Begin Mock Exam'}
            </button>
          </form>
        </section>

        {/* Previous Attempts List */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Previous Attempt Performance</h2>
          {attemptsLoading ? (
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Loading attempt history...</p>
          ) : attempts.length === 0 ? (
            <div className={styles.noAttempts}>
              You have not attempted any tests yet. Pick a mode on the left to start practicing!
            </div>
          ) : (
            <div className={styles.attemptsTableContainer}>
              <table className={styles.attemptsTable}>
                <thead>
                  <tr>
                    <th>Exam Details</th>
                    <th>Date Attempted</th>
                    <th>Score</th>
                    <th>Accuracy</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((att) => {
                    const formattedDate = new Date(att.submittedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    
                    const accuracy = att.totalQuestions > 0 
                      ? Math.round((att.correctCount / att.totalQuestions) * 100) 
                      : 0;

                    return (
                      <tr key={att.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {att.testType === 'random' ? 'Random Mock' : 'Topic Practice'}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            {att.testTopicName || 'All Topics'} ({att.totalQuestions} Qs)
                          </div>
                        </td>
                        <td>{formattedDate}</td>
                        <td>
                          <span className={styles.scoreBadge}>+{att.score}</span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{accuracy}%</div>
                          <div className={styles.statsText}>
                            <span className={styles.statCorrect}>✓{att.correctCount}</span>
                            <span className={styles.statIncorrect}>✗{att.incorrectCount}</span>
                            <span className={styles.statUnattempted}>∅{att.unattemptedCount}</span>
                          </div>
                        </td>
                        <td>
                          <Link href={`/result/${att.id}`} className={styles.reviewLink}>
                            Review Analysis
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
