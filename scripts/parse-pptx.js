#!/usr/bin/env node
/**
 * QuizMate PPTX → CSV Converter
 * 
 * Your PPT structure:
 *   Odd slides  (1, 3, 5...) = Question + 4 options (plain)
 *   Even slides (2, 4, 6...) = Same question + correct option highlighted in RED
 *
 * Usage:
 *   node scripts/parse-pptx.js <your-file.pptx> [topic-name]
 *
 * Output:
 *   questions.csv  (ready to upload in Admin Console)
 */

const AdmZip   = require('adm-zip');
const xml2js   = require('xml2js');
const fs       = require('fs');
const path     = require('path');

// ─── Red colour detection ────────────────────────────────────────────────────
// Matches any shade of red: pure FF0000, dark red, vivid red, etc.
function isRedColor(hexColor) {
  if (!hexColor) return false;
  const hex = hexColor.replace('#', '').toUpperCase();
  if (hex.length !== 6) return false;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Red channel dominant and significantly higher than G and B
  return r > 150 && r > g * 1.8 && r > b * 1.8;
}

// ─── Extract all text runs from a shape, tagged as red or plain ──────────────
function extractRunsFromShape(shape) {
  const runs = [];
  try {
    const txBody = shape['p:txBody'];
    if (!txBody) return runs;

    const paras = txBody[0]?.['a:p'] || [];
    for (const para of paras) {
      const rList = para['a:r'] || [];
      for (const r of rList) {
        const text = r['a:t']?.[0] || '';
        if (!text.trim()) continue;

        // Check run-level colour
        let color = null;
        const rPr = r['a:rPr']?.[0];
        const solidFill = rPr?.['a:solidFill']?.[0];
        if (solidFill) {
          color = solidFill['a:srgbClr']?.[0]?.['$']?.val
               || solidFill['a:srgbClr']?.[0]?.val
               || null;
        }
        runs.push({ text: text.trim(), red: isRedColor(color) });
      }

      // Also handle line breaks (a:br) with just text in next run — already handled
    }
  } catch (_) {}
  return runs;
}

// ─── Get all plain text from shapes (joined) ────────────────────────────────
function getPlainText(shapes) {
  return shapes.flatMap(shape => {
    try {
      const txBody = shape['p:txBody'];
      if (!txBody) return [];
      const paras = txBody[0]?.['a:p'] || [];
      return paras.map(para =>
        (para['a:r'] || []).map(r => r['a:t']?.[0] || '').join('')
      ).filter(t => t.trim());
    } catch (_) { return []; }
  });
}

// ─── Get red-coloured text strings from shapes ───────────────────────────────
function getRedTexts(shapes) {
  const reds = [];
  for (const shape of shapes) {
    const runs = extractRunsFromShape(shape);
    const redRuns = runs.filter(r => r.red).map(r => r.text);
    reds.push(...redRuns);
  }
  return reds;
}

// ─── Parse one PPTX slide XML → shapes array ────────────────────────────────
async function parseSlide(zip, slideFile) {
  const xmlData = zip.readAsText(slideFile);
  const result  = await xml2js.parseStringPromise(xmlData);
  const spTree  = result?.['p:sld']?.['p:cSld']?.[0]?.['p:spTree']?.[0];
  return spTree?.['p:sp'] || [];
}

// ─── Guess topic from slide title (first shape that looks like a title) ──────
function guessTopic(shapes, fallback) {
  for (const shape of shapes) {
    const nvSpPr = shape['p:nvSpPr']?.[0];
    const ph = nvSpPr?.['p:nvPr']?.[0]?.['p:ph']?.[0];
    const type = ph?.['$']?.type;
    if (type === 'title' || type === 'ctrTitle') {
      const texts = getPlainText([shape]);
      if (texts[0]) return texts[0].trim();
    }
  }
  // Fallback: first short text that looks like a heading
  const all = getPlainText(shapes);
  const heading = all.find(t => t.length < 60 && !t.includes('?'));
  return heading || fallback;
}

// ─── Identify question and options from text lines ───────────────────────────
function parseQuestionSlide(lines) {
  // Question: line ending with '?' or the longest line before options
  // Options : usually lines starting with A) B) C) D) or 1. 2. 3. 4.
  const optionPattern = /^[A-Da-d1-4][.)]\s+/;

  let question  = '';
  const options = [];
  let inOptions = false;

  for (const line of lines) {
    if (optionPattern.test(line)) {
      inOptions = true;
      // Strip label prefix
      options.push(line.replace(optionPattern, '').trim());
    } else if (!inOptions) {
      question += (question ? ' ' : '') + line;
    }
  }

  // If no labelled options found, take the last 4 non-question lines
  if (options.length === 0 && lines.length >= 5) {
    const body = lines.filter(l => !l.includes('?'));
    options.push(...body.slice(-4));
    question = lines.find(l => l.includes('?')) || lines[0];
  }

  return { question: question.trim(), options: options.slice(0, 4) };
}

// ─── Escape a CSV cell ───────────────────────────────────────────────────────
function csvCell(val) {
  const str = String(val ?? '').replace(/"/g, '""');
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str}"`
    : str;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const pptxPath  = process.argv[2];
  const topicArg  = process.argv[3] || '';

  if (!pptxPath) {
    console.error('Usage: node scripts/parse-pptx.js <file.pptx> [default-topic]');
    process.exit(1);
  }

  if (!fs.existsSync(pptxPath)) {
    console.error(`File not found: ${pptxPath}`);
    process.exit(1);
  }

  console.log(`\n📂  Opening: ${pptxPath}`);
  const zip = new AdmZip(pptxPath);

  // List all slide files in order
  const slideFiles = zip.getEntries()
    .map(e => e.entryName)
    .filter(n => /^ppt\/slides\/slide[0-9]+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)[1]);
      const nb = parseInt(b.match(/slide(\d+)/)[1]);
      return na - nb;
    });

  console.log(`📊  Found ${slideFiles.length} slides → ${slideFiles.length / 2} questions expected\n`);

  const rows    = [];
  const unknown = [];

  for (let i = 0; i < slideFiles.length - 1; i += 2) {
    const qSlideFile = slideFiles[i];
    const aSlideFile = slideFiles[i + 1];
    const qNum       = Math.floor(i / 2) + 1;

    // Parse both slides
    const qShapes = await parseSlide(zip, qSlideFile);
    const aShapes = await parseSlide(zip, aSlideFile);

    // Extract text lines from question slide
    const qLines = getPlainText(qShapes).filter(l => l.trim());
    const topic  = topicArg || guessTopic(qShapes, `Topic ${qNum}`);
    const { question, options } = parseQuestionSlide(qLines);

    // Pad options to 4 if necessary
    while (options.length < 4) options.push(`Option ${options.length + 1}`);

    // Detect red text on answer slide
    const redTexts = getRedTexts(aShapes);

    // Match red text → option index
    let correctIndex = -1;
    for (const red of redTexts) {
      const idx = options.findIndex(opt =>
        opt.toLowerCase().includes(red.toLowerCase()) ||
        red.toLowerCase().includes(opt.toLowerCase())
      );
      if (idx !== -1) { correctIndex = idx; break; }
    }

    const status = correctIndex === -1 ? '⚠️  UNKNOWN' : `✅  Option ${correctIndex + 1}`;
    console.log(`Q${qNum}: ${status}  ${redTexts.length ? `(red: "${redTexts[0]}")` : '(no red found)'}`);

    if (correctIndex === -1) unknown.push(qNum);

    rows.push({
      topic,
      question,
      option1:       options[0] || '',
      option2:       options[1] || '',
      option3:       options[2] || '',
      option4:       options[3] || '',
      correctAnswer: correctIndex === -1 ? 'UNKNOWN' : correctIndex,
      explanation:   correctIndex === -1
        ? 'Please fill in the explanation.'
        : `The correct answer is option ${correctIndex + 1}: ${options[correctIndex]}.`,
    });
  }

  // ─── Write CSV ─────────────────────────────────────────────────────────────
  const header = 'topic,question,option1,option2,option3,option4,correctAnswer,explanation';
  const csvRows = rows.map(r =>
    [r.topic, r.question, r.option1, r.option2, r.option3, r.option4, r.correctAnswer, r.explanation]
      .map(csvCell).join(',')
  );

  const csvContent = [header, ...csvRows].join('\n');
  const outFile    = path.join(process.cwd(), 'questions.csv');
  fs.writeFileSync(outFile, csvContent, 'utf8');

  console.log(`\n✅  CSV saved to: ${outFile}`);
  console.log(`📝  Total questions: ${rows.length}`);

  if (unknown.length > 0) {
    console.log(`\n⚠️  ${unknown.length} questions with UNKNOWN answer (check red colour):`);
    console.log(`    Questions: ${unknown.join(', ')}`);
    console.log(`    Open questions.csv and replace "UNKNOWN" with 0, 1, 2, or 3`);
    console.log(`    (0 = option1, 1 = option2, 2 = option3, 3 = option4)\n`);
  } else {
    console.log(`\n🎉  All answers detected automatically!\n`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
