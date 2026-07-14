# 🎯 QuizMate — Logical Reasoning Prep Portal

QuizMate is a premium, serverless logical reasoning quiz platform tailored for aptitude and competitive exam preparations (such as AMCAT, CAT, and employability tests). Built with Next.js, Firestore, and Firebase Authentication, the application is wrapped in a high-contrast, modern dark developer console theme for maximum readability and zero-latency performance.

---

## ✨ Key Features

### 👨‍🎓 Student Experience
- **Timed Mock Exams**: Customize your test session with question counts, specific topics, or a randomized mix across all topics. Custom countdown timers auto-submit the exam upon expiry.
- **Split-Screen Exam Workstation**: Real-time examination interface with an interactive **Question Palette**. Color-coded states represent Answered, Not Answered, Not Visited, Marked for Review, and Answered & Marked.
- **CAT-Style Grading Layout**: Secured client-side grading engine implementing standard marking structures (+3 for correct, 0 for incorrect, 0 for unattempted).
- **Performance Analytics**: Review detailed post-exam statistics (Score, accuracy percentage, time taken, correct/incorrect splits) alongside a detailed question-by-question breakdown containing detailed step-by-step explanations.

### 🛡️ Administrator Panel
- **Add Questions Manually**: Form-based question generator with automatic slugification of categories/topics.
- **CSV & JSON Bulk Ingestion**: Upload complete sets of questions instantly via CSV or JSON files. Handles schema mapping (topic, question, option1-4, correct answer, and detailed solutions).
- **Performance Monitor**: Admin-exclusive dashboard to track all student attempts, displaying student full names, emails, scores, exact accuracy percentage, test details, and links to view their exact results.
- **Question Bank Manager**: Search, filter, edit, delete specific questions, or wipe the entire database using a double-verification secure wipe button.

---

## 🛠️ Tech Stack & Architecture

- **Framework**: [Next.js (App Router)](https://nextjs.org/)
- **Database & Auth**: [Firebase (Firestore & Authentication)](https://firebase.google.com/)
- **Design System**: Vanilla CSS Modules (styled using custom CSS variables for premium dark theme visuals)
- **Deployment**: [Vercel](https://vercel.com/)
- **Serverless Security Model**: Employs client-side Firestore interactions secured by custom database rules (in `firestore.rules`). Bypasses the complex private key patterns of standard Firebase Admin SDK integrations, offering a highly stable serverless flow in Vercel.

---

## 🚀 Getting Started

### 1. Prerequisites
Ensure you have Node.js (version 18+ recommended) and npm installed.

### 2. Environment Configuration
Create a `.env.local` file in the root of the project:

```env
# Firebase Client SDK Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Admin Configuration
NEXT_PUBLIC_ADMIN_EMAIL=jiviteshgarg30@gmail.com
```

### 3. Installation
Install the project dependencies:
```bash
npm install
```

### 4. Running Locally
Launch the local development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

### 5. Deploying Firestore Rules
Deploy database rules using the Firebase CLI to secure your database:
```bash
npx firebase-tools deploy --only firestore:rules --project your_project_id
```

---

## 🔒 Security Rules (`firestore.rules`)
Firestore data is secured with declarative rules:
- **Topics & Questions**: Readable by all logged-in students; writable only by the designated administrator.
- **Tests & Attempts**: Created and read by the document owner; admin has read-access for monitoring attempts.
- **Users**: Readable/writable by the owner; admin has complete read-access for student lookups.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
