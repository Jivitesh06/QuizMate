'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, setDoc, getDoc, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import styles from './admin.module.css';

function generateSlug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

interface StudentAttempt {
  id: string;
  userEmail: string;
  userId: string;
  testType: string;
  testTopicId: string | null;
  testTopicName?: string;
  score: number;
  correctCount: number;
  incorrectCount: number;
  unattemptedCount: number;
  submittedAt: string;
  totalQuestions: number;
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading, isAdmin } = useAuth();

  const [topicName, setTopicName] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState('0');
  const [explanation, setExplanation] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [logs, setLogs] = useState<{ type: 'success' | 'error' | 'info'; text: string }[]>([]);

  // Student attempts
  const [attempts, setAttempts] = useState<StudentAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);

  useEffect(() => {
    if (!loading) {
      if (!user) router.replace('/login');
      else if (!isAdmin) router.replace('/dashboard');
      else fetchAllAttempts();
    }
  }, [user, loading, isAdmin, router]);

  const fetchAllAttempts = async () => {
    setAttemptsLoading(true);
    try {
      // Fetch all attempts (admin can read all via Firestore rules)
      const attemptsSnap = await getDocs(collection(db, 'attempts'));
      
      // Fetch topics map for name lookup
      const topicsSnap = await getDocs(collection(db, 'topics'));
      const topicsMap = new Map<string, string>();
      topicsSnap.forEach(d => topicsMap.set(d.id, d.data().name || d.id));

      const list: StudentAttempt[] = [];
      attemptsSnap.forEach(d => {
        const data = d.data();
        const total = (data.correctCount || 0) + (data.incorrectCount || 0) + (data.unattemptedCount || 0);
        list.push({
          id: d.id,
          userEmail: data.userEmail || data.userId || 'Unknown',
          userId: data.userId || '',
          testType: data.testType || 'random',
          testTopicId: data.testTopicId || null,
          testTopicName: data.testTopicId ? (topicsMap.get(data.testTopicId) || data.testTopicId) : 'All Topics',
          score: data.score || 0,
          correctCount: data.correctCount || 0,
          incorrectCount: data.incorrectCount || 0,
          unattemptedCount: data.unattemptedCount || 0,
          submittedAt: data.submittedAt || '',
          totalQuestions: total,
        });
      });

      // Sort by most recent first
      list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setAttempts(list);
    } catch (err: any) {
      console.error('Error fetching attempts:', err);
    } finally {
      setAttemptsLoading(false);
    }
  };

  if (loading || !user || !isAdmin) {
    return (
      <div className={styles.container} style={{ textAlign: 'center', marginTop: '10%' }}>
        <p style={{ color: '#64748b', fontSize: '1.1rem', fontWeight: 500 }}>
          Verifying administrator authorization...
        </p>
      </div>
    );
  }

  const addLog = (type: 'success' | 'error' | 'info', text: string) => {
    setLogs((prev) => [{ type, text }, ...prev]);
  };

  const handleOptionChange = (index: number, value: string) => {
    const updated = [...options];
    updated[index] = value;
    setOptions(updated);
  };

  async function writeQuestion(
    topicNameStr: string,
    questionTextStr: string,
    opts: string[],
    correctIdx: number,
    explanationStr: string
  ): Promise<string> {
    const cleanTopic = topicNameStr.trim();
    const topicId = generateSlug(cleanTopic);
    const topicRef = doc(db, 'topics', topicId);
    const topicSnap = await getDoc(topicRef);
    if (!topicSnap.exists()) {
      await setDoc(topicRef, {
        id: topicId,
        name: cleanTopic,
        description: `Practice questions on ${cleanTopic}.`,
      });
    }
    const questionId = doc(collection(db, 'questions')).id;
    await setDoc(doc(db, 'questions', questionId), {
      id: questionId,
      topicId,
      questionText: questionTextStr.trim(),
      options: opts.map((o) => o.trim()),
      correctAnswerIndex: correctIdx,
      explanation: (explanationStr || '').trim(),
    });
    return questionId;
  }

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (options.some((opt) => !opt.trim())) { addLog('error', 'All 4 options are required.'); return; }
    if (!topicName.trim() || !questionText.trim()) { addLog('error', 'Topic and Question Text are required.'); return; }
    setManualLoading(true);
    try {
      const qId = await writeQuestion(topicName, questionText, options, parseInt(correctAnswerIndex, 10), explanation);
      addLog('success', `✅ Question created! ID: ${qId}`);
      setQuestionText('');
      setOptions(['', '', '', '']);
      setCorrectAnswerIndex('0');
      setExplanation('');
    } catch (err: any) {
      addLog('error', `Error: ${err.message}`);
    } finally {
      setManualLoading(false);
    }
  };

  function parseCSV(csv: string) {
    const lines = csv.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const results: { topic: string; question: string; options: string[]; correctAnswerIndex: number; explanation: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values: string[] = [];
      let cur = '';
      let inQ = false;
      for (const ch of lines[i]) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      values.push(cur.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').replace(/^"|"$/g, ''); });
      const topic = row['topic'] || '';
      const question = row['question'] || '';
      const opts = [row['option1'] || '', row['option2'] || '', row['option3'] || '', row['option4'] || ''];
      const correctAnswer = row['correctanswer'] || row['correct_answer'] || row['answer'] || '';
      const expl = row['explanation'] || '';
      if (!topic || !question || opts.some(o => !o)) continue;
      let correctIdx = 0;
      const parsed = parseInt(correctAnswer, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) { correctIdx = parsed - 1; }
      else { const found = opts.findIndex(o => o.toLowerCase() === correctAnswer.toLowerCase()); if (found >= 0) correctIdx = found; }
      results.push({ topic, question, options: opts, correctAnswerIndex: correctIdx, explanation: expl });
    }
    return results;
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      addLog('info', `File selected: ${e.target.files[0].name} (${(e.target.files[0].size / 1024).toFixed(1)} KB)`);
    }
  };

  const handleBulkUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { addLog('error', 'No file selected.'); return; }
    setBulkLoading(true);
    addLog('info', `Parsing ${file.name}...`);
    try {
      const content = await file.text();
      let questions: { topic: string; question: string; options: string[]; correctAnswerIndex: number; explanation: string }[] = [];
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(content);
        questions = (Array.isArray(parsed) ? parsed : []).map((q: any) => ({
          topic: q.topic || '',
          question: q.question || q.questionText || '',
          options: q.options || [q.option1, q.option2, q.option3, q.option4].filter(Boolean),
          correctAnswerIndex: q.correctAnswerIndex ?? 0,
          explanation: q.explanation || '',
        }));
      } else {
        questions = parseCSV(content);
      }
      if (questions.length === 0) { addLog('error', 'No valid questions found. Check CSV columns: topic, question, option1-4, correctAnswer, explanation'); return; }
      addLog('info', `Found ${questions.length} questions. Uploading...`);
      let uploaded = 0, failed = 0;
      for (const q of questions) {
        try {
          await writeQuestion(q.topic, q.question, q.options, q.correctAnswerIndex, q.explanation);
          uploaded++;
        } catch (err: any) {
          failed++;
          addLog('error', `  Failed: "${q.question.substring(0, 40)}..." — ${err.message}`);
        }
      }
      addLog('success', `✅ Bulk done! ${uploaded} uploaded${failed > 0 ? `, ${failed} failed` : ''}.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      addLog('error', `Bulk Upload Error: ${err.message}`);
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>QuizMate Admin Console</h1>
          <p className={styles.subtitle}>Manage topics, insert questions, and monitor student performance.</p>
        </div>
        <button className={styles.navButton} onClick={() => router.push('/dashboard')}>
          Go to Student Dashboard
        </button>
      </header>

      {/* Top 2-column grid: Manual Entry + Bulk Upload / Logs */}
      <div className={styles.grid}>
        {/* Manual Creation */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Add Single Question Manually</h2>
          <form onSubmit={handleManualSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="topicName">Topic Category</label>
              <input id="topicName" type="text" className={styles.input} placeholder="e.g., Syllogisms, Binary Logic"
                value={topicName} onChange={(e) => setTopicName(e.target.value)} required />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="questionText">Question Text</label>
              <textarea id="questionText" className={styles.textarea} placeholder="Write the logical reasoning question here..."
                value={questionText} onChange={(e) => setQuestionText(e.target.value)} required />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Options</label>
              <div className={styles.optionGrid}>
                {options.map((opt, idx) => (
                  <input key={idx} type="text" className={styles.input} placeholder={`Option ${idx + 1}`}
                    value={opt} onChange={(e) => handleOptionChange(idx, e.target.value)} required />
                ))}
              </div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="correctAnswerIndex">Correct Option</label>
              <select id="correctAnswerIndex" className={styles.select} value={correctAnswerIndex} onChange={(e) => setCorrectAnswerIndex(e.target.value)}>
                <option value="0">Option 1</option>
                <option value="1">Option 2</option>
                <option value="2">Option 3</option>
                <option value="3">Option 4</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="explanation">Explanation &amp; Solution</label>
              <textarea id="explanation" className={styles.textarea} placeholder="How to arrive at the correct answer..."
                value={explanation} onChange={(e) => setExplanation(e.target.value)} />
            </div>
            <button type="submit" className={styles.submitBtn} disabled={manualLoading}>
              {manualLoading ? 'Saving...' : 'Add Question'}
            </button>
          </form>
        </section>

        {/* Bulk Upload + Logs */}
        <div>
          <section className={styles.card} style={{ marginBottom: '2rem' }}>
            <h2 className={styles.cardTitle}>Bulk Upload (CSV / JSON)</h2>
            <form onSubmit={handleBulkUpload}>
              <div className={styles.uploadZone} onClick={() => fileInputRef.current?.click()}>
                <div className={styles.uploadIcon}>📥</div>
                <div className={styles.uploadText}>{file ? `File: ${file.name}` : 'Click to browse and upload CSV or JSON'}</div>
                <div className={styles.uploadSubtext}>CSV: topic, question, option1, option2, option3, option4, correctAnswer, explanation</div>
                <input type="file" ref={fileInputRef} className={styles.fileInput} accept=".csv,.json" onChange={handleFileChange} />
              </div>
              {file && (
                <div className={styles.fileDetails}>
                  <span>Selected: <strong>{file.name}</strong></span>
                  <button type="button" className={styles.removeFile} onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>Remove</button>
                </div>
              )}
              <button type="submit" className={styles.submitBtn} style={{ backgroundColor: '#0f172a' }} disabled={bulkLoading || !file}>
                {bulkLoading ? 'Uploading...' : 'Process Bulk File'}
              </button>
            </form>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Operation Log History</h2>
            <div className={styles.statusLog}>
              {logs.length === 0 ? (
                <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No operations performed yet.</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className={styles.logEntry}>
                    <span className={log.type === 'success' ? styles.logSuccess : log.type === 'error' ? styles.logError : styles.logInfo}>
                      [{log.type.toUpperCase()}]
                    </span>{' '}{log.text}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* ─────────────── Student Attempts Section ─────────────── */}
      <section className={styles.attemptsSection}>
        <div className={styles.sectionHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 className={styles.sectionTitle}>📊 Student Performance Monitor</h2>
            {!attemptsLoading && <span className={styles.badge}>{attempts.length} attempts</span>}
          </div>
          <button className={styles.refreshBtn} onClick={fetchAllAttempts} disabled={attemptsLoading}>
            {attemptsLoading ? 'Loading...' : '↻ Refresh'}
          </button>
        </div>

        <div className={styles.tableContainer}>
          {attemptsLoading ? (
            <div className={styles.loadingMsg}>Loading student attempts...</div>
          ) : attempts.length === 0 ? (
            <div className={styles.emptyState}>
              No attempts yet. Students will appear here once they complete a test.
            </div>
          ) : (
            <table className={styles.attemptsTable}>
              <thead>
                <tr>
                  <th>Student Email</th>
                  <th>Test Type</th>
                  <th>Topic</th>
                  <th>Score</th>
                  <th>✓ / ✗ / ∅</th>
                  <th>Accuracy</th>
                  <th>Date &amp; Time</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((att) => {
                  const accuracy = att.totalQuestions > 0
                    ? Math.round((att.correctCount / att.totalQuestions) * 100)
                    : 0;

                  const submittedDate = att.submittedAt
                    ? new Date(att.submittedAt).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : '—';

                  return (
                    <tr key={att.id}>
                      <td className={styles.emailCell}>{att.userEmail}</td>
                      <td>
                        <span className={`${styles.testTypeBadge} ${att.testType === 'random' ? styles.testTypeRandom : styles.testTypeTopic}`}>
                          {att.testType === 'random' ? '🎲 Random' : '📌 Topic'}
                        </span>
                      </td>
                      <td style={{ color: '#64748b', fontSize: '0.82rem' }}>
                        {att.testTopicName || 'All Topics'}
                      </td>
                      <td>
                        <span className={styles.scoreBadge}>+{att.score}</span>
                      </td>
                      <td>
                        <div className={styles.statsRow}>
                          <span className={styles.statCorrect}>✓{att.correctCount}</span>
                          <span className={styles.statWrong}>✗{att.incorrectCount}</span>
                          <span className={styles.statSkip}>∅{att.unattemptedCount}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: accuracy >= 70 ? '#16a34a' : accuracy >= 40 ? '#d97706' : '#dc2626' }}>
                          {accuracy}%
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{att.totalQuestions} Qs</div>
                      </td>
                      <td style={{ fontSize: '0.82rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        {submittedDate}
                      </td>
                      <td>
                        <Link href={`/result/${att.id}`} className={styles.reviewLink}>
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
