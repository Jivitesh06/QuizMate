'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebaseClient';
import { useAuth } from '@/context/AuthContext';
import styles from './admin.module.css';

export default function AdminPage() {
  const router = useRouter();
  const { user, loading, isAdmin } = useAuth();

  // Manual form state
  const [topicName, setTopicName] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswerIndex, setCorrectAnswerIndex] = useState('0');
  const [explanation, setExplanation] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  // Bulk upload state
  const [file, setFile] = useState<File | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Status logs
  const [logs, setLogs] = useState<{ type: 'success' | 'error' | 'info'; text: string }[]>([]);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else if (!isAdmin) {
        router.replace('/dashboard');
      }
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
    const updatedOptions = [...options];
    updatedOptions[index] = value;
    setOptions(updatedOptions);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (options.some(opt => !opt.trim())) {
      addLog('error', 'Manual Creation: All 4 options are required.');
      return;
    }

    setManualLoading(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Could not get authentication token.');

      const response = await fetch('/api/admin/add-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          topicName,
          questionText,
          options,
          correctAnswerIndex: parseInt(correctAnswerIndex, 10),
          explanation,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errMsg = data.error || 'Failed to submit question.';
        const details = data.stack ? `${errMsg} (Stack: ${data.stack.split('\n')[1] || ''})` : errMsg;
        throw new Error(details);
      }

      addLog('success', `Manual Creation: Question successfully created (ID: ${data.questionId}).`);
      
      // Clear manual form except topic (for easier repeated entry)
      setQuestionText('');
      setOptions(['', '', '', '']);
      setCorrectAnswerIndex('0');
      setExplanation('');
    } catch (err: any) {
      console.error(err);
      addLog('error', `Manual Creation Error: ${err.message}`);
    } finally {
      setManualLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      addLog('info', `File selected: ${e.target.files[0].name} (${(e.target.files[0].size / 1024).toFixed(1)} KB)`);
    }
  };

  const handleBulkUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      addLog('error', 'Bulk Upload: No file selected.');
      return;
    }

    setBulkLoading(true);
    addLog('info', `Starting bulk upload parser for ${file.name}...`);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Could not get authentication token.');

      const fileContent = await file.text();
      const fileType = file.name.endsWith('.json') ? 'json' : 'csv';

      const response = await fetch('/api/admin/bulk-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          fileContent,
          fileType,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to execute bulk upload.');
      }

      addLog('success', `Bulk Upload: Successfully inserted ${data.count} questions into Firestore.`);

      if (data.skipped > 0) {
        addLog('info', `Skipped ${data.skipped} rows (see details below).`);
        (data.skippedDetails || []).forEach((s: { row: number; reason: string }) => {
          addLog('info', `  Row ${s.row}: ${s.reason}`);
        });
      }

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
              <label className={styles.label} htmlFor="explanation">Explanation & Solution</label>
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

        {/* Bulk Upload & Status Log Card */}
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
                  <span>Selected file: <strong>{file.name}</strong></span>
                  <button 
                    type="button" 
                    className={styles.removeFile}
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
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
                {bulkLoading ? 'Uploading and Parsing...' : 'Process Bulk File'}
              </button>
            </form>
          </section>

          {/* Logs panel */}
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
