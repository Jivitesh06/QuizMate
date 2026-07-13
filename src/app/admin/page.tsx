'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from 'firebase/firestore';
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
  userName: string;
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

interface Question {
  id: string;
  topicId: string;
  topicName: string;
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading, isAdmin } = useAuth();

  // Manual Question state
  const [topicName, setTopicName] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState('0');
  const [explanation, setExplanation] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  // Bulk upload file state
  const [file, setFile] = useState<File | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Logs state
  const [logs, setLogs] = useState<{ type: 'success' | 'error' | 'info'; text: string }[]>([]);

  // Student attempts state
  const [attempts, setAttempts] = useState<StudentAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(true);

  // Questions Manager state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!loading) {
      if (!user) router.replace('/login');
      else if (!isAdmin) router.replace('/dashboard');
      else {
        fetchAllAttempts();
        fetchQuestions();
      }
    }
  }, [user, loading, isAdmin, router]);

  const fetchAllAttempts = async () => {
    setAttemptsLoading(true);
    try {
      const attemptsSnap = await getDocs(collection(db, 'attempts'));
      const topicsSnap = await getDocs(collection(db, 'topics'));
      const topicsMap = new Map<string, string>();
      topicsSnap.forEach(d => topicsMap.set(d.id, d.data().name || d.id));

      const usersSnap = await getDocs(collection(db, 'users'));
      const usersMap = new Map<string, string>();
      usersSnap.forEach(d => {
        const data = d.data();
        if (data.name) usersMap.set(d.id, data.name);
      });

      const list: StudentAttempt[] = [];
      attemptsSnap.forEach(d => {
        const data = d.data();
        const total = (data.correctCount || 0) + (data.incorrectCount || 0) + (data.unattemptedCount || 0);
        const displayName = data.userName || usersMap.get(data.userId) || data.userEmail || data.userId || 'Unknown';
        list.push({
          id: d.id,
          userEmail: data.userEmail || data.userId || 'Unknown',
          userId: data.userId || '',
          userName: displayName,
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

      list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      setAttempts(list);
    } catch (err: any) {
      console.error('Error fetching attempts:', err);
    } finally {
      setAttemptsLoading(false);
    }
  };

  const fetchQuestions = async () => {
    setQuestionsLoading(true);
    try {
      const qSnap = await getDocs(collection(db, 'questions'));
      const topicsSnap = await getDocs(collection(db, 'topics'));
      const topicsMap = new Map<string, string>();
      topicsSnap.forEach(d => topicsMap.set(d.id, d.data().name || d.id));

      const list: Question[] = [];
      qSnap.forEach(d => {
        const data = d.data();
        list.push({
          id: d.id,
          topicId: data.topicId || '',
          topicName: topicsMap.get(data.topicId) || data.topicId || 'Unknown Topic',
          questionText: data.questionText || '',
          options: data.options || [],
          correctAnswerIndex: data.correctAnswerIndex ?? 0,
          explanation: data.explanation || '',
        });
      });

      // Sort by topicName then questionText
      list.sort((a, b) => a.topicName.localeCompare(b.topicName) || a.questionText.localeCompare(b.questionText));
      setQuestions(list);
    } catch (err: any) {
      console.error('Error fetching questions:', err);
    } finally {
      setQuestionsLoading(false);
    }
  };

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
      const cleanTopic = topicName.trim();
      const topicId = generateSlug(cleanTopic);

      // Ensure topic exists
      const topicRef = doc(db, 'topics', topicId);
      const topicSnap = await getDoc(topicRef);
      if (!topicSnap.exists()) {
        await setDoc(topicRef, {
          id: topicId,
          name: cleanTopic,
          description: `Practice questions on ${cleanTopic}.`,
        });
      }

      const qId = editingQuestionId || doc(collection(db, 'questions')).id;
      await setDoc(doc(db, 'questions', qId), {
        id: qId,
        topicId,
        questionText: questionText.trim(),
        options: options.map((o) => o.trim()),
        correctAnswerIndex: parseInt(correctAnswerIndex, 10),
        explanation: (explanation || '').trim(),
      });

      if (editingQuestionId) {
        addLog('success', `✅ Question updated! ID: ${qId}`);
        setEditingQuestionId(null);
      } else {
        addLog('success', `✅ Question created! ID: ${qId}`);
      }

      setQuestionText('');
      setOptions(['', '', '', '']);
      setCorrectAnswerIndex('0');
      setExplanation('');
      fetchQuestions(); // Refresh list
    } catch (err: any) {
      addLog('error', `Error: ${err.message}`);
    } finally {
      setManualLoading(false);
    }
  };

  const handleStartEdit = (q: Question) => {
    setEditingQuestionId(q.id);
    setTopicName(q.topicName);
    setQuestionText(q.questionText);
    setOptions([...q.options]);
    setCorrectAnswerIndex(q.correctAnswerIndex.toString());
    setExplanation(q.explanation);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    addLog('info', `Editing question ${q.id}...`);
  };

  const handleCancelEdit = () => {
    setEditingQuestionId(null);
    setTopicName('');
    setQuestionText('');
    setOptions(['', '', '', '']);
    setCorrectAnswerIndex('0');
    setExplanation('');
    addLog('info', 'Cancelled edit mode.');
  };

  const handleDeleteQuestion = async (qId: string) => {
    if (!window.confirm('Are you sure you want to delete this question?')) return;
    try {
      await deleteDoc(doc(db, 'questions', qId));
      addLog('success', `Deleted question ${qId}`);
      fetchQuestions();
    } catch (err: any) {
      addLog('error', `Failed to delete question: ${err.message}`);
    }
  };

  const handleWipeQuestionBank = async () => {
    if (!window.confirm('🚨 WARNING: Are you absolutely sure you want to wipe the ENTIRE question bank?\nThis will delete all questions and topics. This cannot be undone.')) return;
    if (!window.confirm('Double verification: Please confirm once more to delete all questions and topics.')) return;

    setQuestionsLoading(true);
    try {
      const qSnap = await getDocs(collection(db, 'questions'));
      const tSnap = await getDocs(collection(db, 'topics'));

      addLog('info', `Deleting ${qSnap.size} questions and ${tSnap.size} topics...`);

      const qPromises = qSnap.docs.map(d => deleteDoc(d.ref));
      const tPromises = tSnap.docs.map(d => deleteDoc(d.ref));

      await Promise.all([...qPromises, ...tPromises]);
      addLog('success', '✅ Entire question bank and all topics wiped successfully.');
      fetchQuestions();
    } catch (err: any) {
      addLog('error', `Failed to wipe question bank: ${err.message}`);
    } finally {
      setQuestionsLoading(false);
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
      let questionsToUpload: { topic: string; question: string; options: string[]; correctAnswerIndex: number; explanation: string }[] = [];
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(content);
        questionsToUpload = (Array.isArray(parsed) ? parsed : []).map((q: any) => ({
          topic: q.topic || '',
          question: q.question || q.questionText || '',
          options: q.options || [q.option1, q.option2, q.option3, q.option4].filter(Boolean),
          correctAnswerIndex: q.correctAnswerIndex ?? 0,
          explanation: q.explanation || '',
        }));
      } else {
        questionsToUpload = parseCSV(content);
      }
      if (questionsToUpload.length === 0) { addLog('error', 'No valid questions found. Check CSV columns: topic, question, option1-4, correctAnswer, explanation'); return; }
      addLog('info', `Found ${questionsToUpload.length} questions. Uploading...`);
      let uploaded = 0, failed = 0;
      for (const q of questionsToUpload) {
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
      fetchQuestions(); // Refresh question list
    } catch (err: any) {
      addLog('error', `Bulk Upload Error: ${err.message}`);
    } finally {
      setBulkLoading(false);
    }
  };

  const filteredQuestions = questions.filter(q => 
    q.questionText.toLowerCase().includes(searchQuery.toLowerCase()) ||
    q.topicName.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <h2 className={styles.cardTitle}>{editingQuestionId ? '📝 Edit Question Details' : 'Add Single Question Manually'}</h2>
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
            
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button type="submit" className={styles.submitBtn} style={{ flex: 1 }} disabled={manualLoading}>
                {manualLoading ? 'Saving...' : editingQuestionId ? 'Save Changes' : 'Add Question'}
              </button>
              {editingQuestionId && (
                <button type="button" className={styles.cancelBtn} onClick={handleCancelEdit}>
                  Cancel
                </button>
              )}
            </div>
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

      {/* ─────────────── Question Bank Manager Section ─────────────── */}
      <section className={styles.attemptsSection}>
        <div className={styles.sectionHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 className={styles.sectionTitle}>📚 Question Bank Manager</h2>
            {!questionsLoading && <span className={styles.badge}>{questions.length} questions</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input 
              type="text" 
              placeholder="Search questions or topics..." 
              className={styles.searchBar} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className={styles.refreshBtn} onClick={fetchQuestions} disabled={questionsLoading}>
              ↻ Refresh List
            </button>
            <button className={styles.wipeBtn} onClick={handleWipeQuestionBank} disabled={questionsLoading}>
              ⚠️ Wipe Question Bank
            </button>
          </div>
        </div>

        <div className={styles.tableContainer}>
          {questionsLoading ? (
            <div className={styles.loadingMsg}>Loading questions...</div>
          ) : filteredQuestions.length === 0 ? (
            <div className={styles.emptyState}>
              No questions found. Try adding questions or changing search query.
            </div>
          ) : (
            <table className={styles.attemptsTable}>
              <thead>
                <tr>
                  <th style={{ width: '20%' }}>Topic</th>
                  <th style={{ width: '45%' }}>Question Text</th>
                  <th style={{ width: '20%' }}>Correct Answer</th>
                  <th style={{ width: '15%', textAlign: 'right' as any }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuestions.map((q) => {
                  const correctText = q.options[q.correctAnswerIndex] || `Option ${q.correctAnswerIndex + 1}`;
                  return (
                    <tr key={q.id}>
                      <td style={{ fontWeight: 600, color: '#1e293b' }}>{q.topicName}</td>
                      <td style={{ color: '#475569', fontSize: '0.85rem' }}>{q.questionText}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: '#16a34a' }}>{correctText}</div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Index: {q.correctAnswerIndex + 1}</div>
                      </td>
                      <td>
                        <button className={styles.editBtn} onClick={() => handleStartEdit(q)}>
                          Edit
                        </button>
                        <button className={styles.deleteBtn} onClick={() => handleDeleteQuestion(q.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ─────────────── Student Attempts Section ─────────────── */}
      <section className={styles.attemptsSection} style={{ marginTop: '3.5rem' }}>
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
                  <th>Student</th>
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
                      <td>
                        <div className={styles.emailCell}>{att.userName}</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.1rem' }}>{att.userEmail}</div>
                      </td>
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
