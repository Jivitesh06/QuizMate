'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const handleCTA = () => {
    if (user) {
      router.push('/dashboard');
    } else {
      router.push('/login');
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.navBar}>
        <div className={styles.logo}>Quiz<span className={styles.logoText}>Mate</span></div>
        <button className={styles.ctaButtonOutline} onClick={handleCTA}>
          {loading ? 'Checking Session...' : user ? 'Go to Dashboard' : 'Student Sign In'}
        </button>
      </header>

      <main className={styles.heroSection}>
        <div className={styles.heroContent}>
          <span className={styles.badge}>Aptitude & Employability Preparation</span>
          <h1 className={styles.heroTitle}>
            Master <span>Logical Reasoning</span> for Competitive Exams
          </h1>
          <p className={styles.heroSubtitle}>
            Practice with high-quality mock tests structured specifically like AIMCAT exams. Improve accuracy, monitor pace, and track historical results.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.ctaButton} onClick={handleCTA}>
              {user ? 'Open Student Console' : 'Get Started for Free &rarr;'}
            </button>
          </div>
        </div>

        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>⏱️</div>
            <h3 className={styles.featureTitle}>Timed Mock Exams</h3>
            <p className={styles.featureDescription}>
              Simulate real testing environments with custom question counts and countdown timers that auto-submit when time runs out.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📊</div>
            <h3 className={styles.featureTitle}>AIMCAT Grading Layout</h3>
            <p className={styles.featureDescription}>
              Experience CAT-style marking (+3 for correct, 0 for incorrect) and split-screen MCQ panels with color-coded question grids.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>💡</div>
            <h3 className={styles.featureTitle}>Detailed Logical Review</h3>
            <p className={styles.featureDescription}>
              Analyze your performance with accuracy percentages, exact pacing metrics, and step-by-step logical explanations for every question.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>📁</div>
            <h3 className={styles.featureTitle}>Admin CSV Ingestion</h3>
            <p className={styles.featureDescription}>
              Upload questions in bulk via CSV or JSON files. Dynamic parsing automatically structures topics, categories, options, and keys.
            </p>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <p>&copy; {new Date().getFullYear()} QuizMate - Logical Reasoning Prep Portal. All rights reserved.</p>
      </footer>
    </div>
  );
}
