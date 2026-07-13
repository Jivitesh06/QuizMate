'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseClient';
import { useAuth } from '@/context/AuthContext';
import styles from './admin.module.css';

function generateSlug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

  useEffect(() => {
    if (!loading) {
      if (!user) router.replace('/login');
      else if (!isAdmin) router.replace('/dashboard');
    }
  }, [user, loading, isAdmin, router]);

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

  // Core function: write a question directly to Firestore using client SDK
  async function writeQuestion(
    topicNameStr: string,
    questionTextStr: string,
    opts: string[],
    correctIdx: number,
    explanationStr: string
  ): Promise<string> {
    const cleanTopic = topicNameStr.trim();
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

    // Write question
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
    if (options.some((opt) => !opt.trim())) {
      addLog('error', 'All 4 options are required.');
      return;
    }
    if (!topicName.trim() || !questionText.trim()) {
      addLog('error', 'Topic and Question Text are required.');
      return;
    }

    setManualLoading(true);
    try {
      const qId = await writeQuestion(
        topicName,
        questionText,
        options,
        parseInt(correctAnswerIndex, 10),
        explanation
      );
      addLog('success', `✅ Question created successfully! ID: ${qId}`);
      setQuestionText('');
      setOptions(['', '', '', '']);
      setCorrectAnswerIndex('0');
      setExplanation('');
    } catch (err: any) {
      console.error(err);
      addLog('error', `Error: ${err.message}`);
    } finally {
      setManualLoading(false);
    }
  };

  // Parse CSV content in the browser
  function parseCSV(csv: string) {
    const lines = csv.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0]
      .split(',')
      .map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());

    const results: {
      topic: string;
      question: string;
      options: string[];
      correctAnswerIndex: number;
      explanation: string;
    }[] = [];

    for (let i = 1; i < lines.length; i++) {
      // Basic CSV parser (handles quoted fields)
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
      const opt1 = row['option1'] || '';
      const opt2 = row['option2'] || '';
      const opt3 = row['option3'] || '';
      const opt4 = row['option4'] || '';
      const correctAnswer = row['correctanswer'] || row['correct_answer'] || row['answer'] || '';
      const expl = row['explanation'] || '';

      if (!topic || !question || !opt1 || !opt2 || !opt3 || !opt4) continue;

      const opts = [opt1, opt2, opt3, opt4];
      let correctIdx = 0;
      const parsed = parseInt(correctAnswer, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 4) {
        correctIdx = parsed - 1;
      } else {
        const found = opts.findIndex(
          (o) => o.toLowerCase() === correctAnswer.toLowerCase()
        );
        if (found >= 0) correctIdx = found;
      }

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

      if (questions.length === 0) {
        addLog('error', 'No valid questions found. Check CSV format: topic, question, option1-4, correctAnswer, explanation');
        return;
      }

      addLog('info', `Found ${questions.length} questions. Uploading...`);
      let uploaded = 0;
      let failed = 0;

      for (const q of questions) {
        try {
          await writeQuestion(q.topic, q.question, q.options, q.correctAnswerIndex, q.explanation);
          uploaded++;
        } catch (err: any) {
          failed++;
          addLog('error', `  Row failed: "${q.question.substring(0, 50)}..." — ${err.message}`);
        }
      }

      addLog('success', `✅ Bulk upload done! ${uploaded} uploaded${failed > 0 ? `, ${failed} failed` : ''}.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      console.error(err);
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
          <p className={styles.subtitle}>Manage topics, manually insert questions, or upload CSV/JSON sets.</p>
        </div>
        <button className={styles.navButton} onClick={() => router.push('/dashboard')}>
          Go to Student Dashboard
        </button>
      </header>

      <div className={styles.grid}>
        {/* Manual Creation Card */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Add Single Question Manually</h2>
          <form onSubmit={handleManualSubmit}>
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="topicName">Topic Category</label>
              <input
                id="topicName"
                type="text"
                className={styles.input}
                placeholder="e.g., Syllogisms, Binary Logic"
                value={topicName}
                onChange={(e) => setTopicName(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="questionText">Question Text</label>
              <textarea
                id="questionText"
                className={styles.textarea}
                placeholder="Write the logical reasoning question prompt here..."
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                required
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Options</label>
              <div className={styles.optionGrid}>
                {options.map((opt, idx) => (
                  <input
                    key={idx}
                    type="text"
                    className={styles.input}
                    placeholder={`Option ${idx + 1}`}
                    value={opt}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                    required
                  />
                ))}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="correctAnswerIndex">Correct Option</label>
              <select
                id="correctAnswerIndex"
                className={styles.select}
                value={correctAnswerIndex}
                onChange={(e) => setCorrectAnswerIndex(e.target.value)}
              >
                <option value="0">Option 1</option>
                <option value="1">Option 2</option>
                <option value="2">Option 3</option>
                <option value="3">Option 4</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="explanation">Explanation &amp; Solution</label>
              <textarea
                id="explanation"
                className={styles.textarea}
                placeholder="Provide details on how to arrive at the correct answer..."
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={manualLoading}>
              {manualLoading ? 'Saving...' : 'Add Question'}
            </button>
          </form>
        </section>

        {/* Bulk Upload & Status Log */}
        <div>
          <section className={styles.card} style={{ marginBottom: '2rem' }}>
            <h2 className={styles.cardTitle}>Bulk Upload (CSV / JSON)</h2>
            <form onSubmit={handleBulkUpload}>
              <div
                className={styles.uploadZone}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={styles.uploadIcon}>📥</div>
                <div className={styles.uploadText}>
                  {file ? `File: ${file.name}` : 'Click to browse and upload CSV or JSON file'}
                </div>
                <div className={styles.uploadSubtext}>
                  CSV Columns: topic, question, option1, option2, option3, option4, correctAnswer, explanation
                </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  className={styles.fileInput}
                  accept=".csv,.json"
                  onChange={handleFileChange}
                />
              </div>

              {file && (
                <div className={styles.fileDetails}>
                  <span>Selected: <strong>{file.name}</strong></span>
                  <button
                    type="button"
                    className={styles.removeFile}
                    onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  >
                    Remove
                  </button>
                </div>
              )}

              <button
                type="submit"
                className={styles.submitBtn}
                style={{ backgroundColor: '#0f172a' }}
                disabled={bulkLoading || !file}
              >
                {bulkLoading ? 'Uploading...' : 'Process Bulk File'}
              </button>
            </form>
          </section>

          {/* Logs */}
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Operation Log History</h2>
            <div className={styles.statusLog}>
              {logs.length === 0 ? (
                <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No operations performed yet.</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className={styles.logEntry}>
                    <span className={
                      log.type === 'success' ? styles.logSuccess :
                      log.type === 'error' ? styles.logError : styles.logInfo
                    }>
                      [{log.type.toUpperCase()}]
                    </span>{' '}
                    {log.text}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
