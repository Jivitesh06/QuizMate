import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

// RFC 4180 compliant CSV parser
function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(currentVal.trim());
      if (row.length > 0 && row.some(cell => cell !== '')) {
        result.push(row);
      }
      row = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  if (currentVal || row.length > 0) {
    row.push(currentVal.trim());
    if (row.some(cell => cell !== '')) {
      result.push(row);
    }
  }
  return result;
}

// Generate a clean slug for Topic IDs
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Map correct answer input to index (0-3)
function mapCorrectAnswer(input: string, options: string[]): number {
  const cleanInput = input.trim().toLowerCase();
  
  // 0-3 index
  if (['0', '1', '2', '3'].includes(cleanInput)) {
    return parseInt(cleanInput, 10);
  }
  
  // 1-4 index
  if (['1', '2', '3', '4'].includes(cleanInput)) {
    return parseInt(cleanInput, 10) - 1;
  }
  
  // Letter A-D
  if (cleanInput === 'a') return 0;
  if (cleanInput === 'b') return 1;
  if (cleanInput === 'c') return 2;
  if (cleanInput === 'd') return 3;

  // Matching option text
  for (let i = 0; i < options.length; i++) {
    if (options[i].trim().toLowerCase() === input.trim().toLowerCase()) {
      return i;
    }
  }

  // Fallback default
  return 0;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate user using Firebase ID Token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized. No token provided.' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (err) {
      return NextResponse.json({ error: 'Unauthorized. Invalid token.' }, { status: 401 });
    }

    // 2. Check if user is Admin
    const userEmail = decodedToken.email;
    const adminEmailConfig = process.env.ADMIN_EMAIL || 'admin@example.com';
    if (!userEmail || userEmail.toLowerCase() !== adminEmailConfig.toLowerCase()) {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    // 3. Parse input request
    const body = await req.json();
    const { fileContent, fileType } = body;

    if (!fileContent) {
      return NextResponse.json({ error: 'Missing fileContent in request body' }, { status: 400 });
    }

    let rawRows: any[] = [];
    if (fileType === 'json') {
      rawRows = JSON.parse(fileContent);
    } else {
      // Parse CSV
      const csvData = parseCSV(fileContent);
      if (csvData.length < 2) {
        return NextResponse.json({ error: 'Empty or invalid CSV file' }, { status: 400 });
      }

      // Read headers and find indices
      const headers = csvData[0].map(h => h.toLowerCase().trim());
      const rows = csvData.slice(1);

      // We expect: [topic, question, option1, option2, option3, option4, correctAnswer, explanation]
      // Support headers mapping dynamically if provided
      const topicIdx = headers.indexOf('topic');
      const questionIdx = headers.indexOf('question');
      const o1Idx = headers.indexOf('option1');
      const o2Idx = headers.indexOf('option2');
      const o3Idx = headers.indexOf('option3');
      const o4Idx = headers.indexOf('option4');
      const correctIdx = headers.indexOf('correctanswer');
      const explanationIdx = headers.indexOf('explanation');

      // If headers did not match exactly, assume default sequential order
      const hasProperHeaders = topicIdx !== -1 && questionIdx !== -1 && o1Idx !== -1;
      
      rawRows = rows.map(row => {
        if (hasProperHeaders) {
          return {
            topic: row[topicIdx] || '',
            question: row[questionIdx] || '',
            option1: row[o1Idx] || '',
            option2: row[o2Idx] || '',
            option3: row[o3Idx] || '',
            option4: row[o4Idx] || '',
            correctAnswer: row[correctIdx] || '',
            explanation: row[explanationIdx] || '',
          };
        } else {
          return {
            topic: row[0] || '',
            question: row[1] || '',
            option1: row[2] || '',
            option2: row[3] || '',
            option3: row[4] || '',
            option4: row[5] || '',
            correctAnswer: row[6] || '',
            explanation: row[7] || '',
          };
        }
      });
    }

    // 4. Ingest and create database objects
    let createdCount = 0;
    let skippedCount = 0;
    const skippedRows: { row: number; reason: string }[] = [];
    const batchLimit = 500;
    let batch = adminDb.batch();
    let currentBatchSize = 0;

    // Cache local topics to prevent repeated queries
    const topicCache = new Map<string, string>(); // topicName.toLowerCase() -> topicId

    // Load existing topics first
    const existingTopicsSnap = await adminDb.collection('topics').get();
    for (const doc of existingTopicsSnap.docs) {
      const data = doc.data();
      if (data.name) {
        topicCache.set(data.name.toLowerCase().trim(), doc.id);
      }
    }

    for (let rowIdx = 0; rowIdx < rawRows.length; rowIdx++) {
      const rawRow = rawRows[rowIdx];
      const rowNum = rowIdx + 2; // +2 because row 1 is header

      const topicName = (rawRow.topic || rawRow.topicName || 'General').trim();
      const questionText = (rawRow.question || rawRow.questionText || '').trim();
      const explanation = (rawRow.explanation || '').trim();

      // Build options array — pad blank cells with a placeholder
      const rawOptions = [
        (rawRow.option1 || rawRow.options?.[0] || '').trim(),
        (rawRow.option2 || rawRow.options?.[1] || '').trim(),
        (rawRow.option3 || rawRow.options?.[2] || '').trim(),
        (rawRow.option4 || rawRow.options?.[3] || '').trim(),
      ];
      // Pad any empty options rather than discarding the whole row
      const options = rawOptions.map((opt, i) => opt || `Option ${i + 1}`);

      // Only skip if the question text itself is missing
      if (!questionText) {
        skippedRows.push({ row: rowNum, reason: 'Empty question text' });
        skippedCount++;
        continue;
      }

      // Warn about rows where correctAnswer looks wrong
      const answerRaw = String(rawRow.correctAnswer || rawRow.correctAnswerIndex || '0').trim();
      const isUnknown = answerRaw.toUpperCase() === 'UNKNOWN' || answerRaw === '';

      // Check topic cache or create new
      const cleanTopicName = topicName.toLowerCase();
      let topicId = topicCache.get(cleanTopicName);

      if (!topicId) {
        topicId = generateSlug(topicName);

        // Double check if generated ID exists as a document
        const topicRef = adminDb.collection('topics').doc(topicId);
        const topicSnap = await topicRef.get();

        if (!topicSnap.exists) {
          batch.set(topicRef, {
            id: topicId,
            name: topicName,
            description: `Mock practice questions on ${topicName}.`,
          });
          currentBatchSize++;
        }
        topicCache.set(cleanTopicName, topicId);
      }

      // Map correct answer index (UNKNOWN → defaults to 0)
      const correctAnswerIndex = isUnknown ? 0 : mapCorrectAnswer(answerRaw, options);

      if (isUnknown) {
        skippedRows.push({ row: rowNum, reason: 'correctAnswer was UNKNOWN — defaulted to option 1' });
      }

      // Create question document
      const questionRef = adminDb.collection('questions').doc();
      batch.set(questionRef, {
        id: questionRef.id,
        topicId,
        questionText,
        options,
        correctAnswerIndex,
        explanation: explanation || `The correct answer is: ${options[correctAnswerIndex]}.`,
      });

      currentBatchSize++;
      createdCount++;

      // Commit batch if limit reached
      if (currentBatchSize >= batchLimit) {
        await batch.commit();
        batch = adminDb.batch();
        currentBatchSize = 0;
      }
    }

    // Commit any remaining
    if (currentBatchSize > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      success: true,
      count: createdCount,
      skipped: skippedCount,
      skippedDetails: skippedRows,
    });
  } catch (error: any) {
    console.error('Error in bulk upload API:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
