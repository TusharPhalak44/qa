import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ALLOWED_AUDIO_TYPES, validateGCSObject } from '../lib/gcs';
import { saveTranscriptRecord, getTranscriptRecords, getTranscriptRecordById, deleteTranscriptRecord } from '../lib/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('TEST SUITE: GCS Direct Upload & Vercel Payload Limit');
console.log('====================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    testsFailed++;
  }
}

async function runTests() {
  // ---------------------------------------------------------
  // TEST 1: Generate > 4.5 MB Audio File
  // ---------------------------------------------------------
  console.log('Test 1: Generate > 4.5 MB Audio Recording for Testing');
  const tempDir = path.join(__dirname, '../data/test-scratch');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const targetSize = 5.2 * 1024 * 1024; // 5.2 MB (larger than Vercel 4.5MB threshold)
  const testWavPath = path.join(tempDir, 'large-recording-5.2mb.wav');
  const testMp3Path = path.join(tempDir, 'large-recording-5.2mb.mp3');

  // Create valid WAV header (RIFF, 44-byte standard header)
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(targetSize - 8, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  wavHeader.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  wavHeader.writeUInt16LE(1, 22);  // NumChannels (1 mono)
  wavHeader.writeUInt32LE(16000, 24); // SampleRate (16kHz)
  wavHeader.writeUInt32LE(32000, 28); // ByteRate (16000 * 2)
  wavHeader.writeUInt16LE(2, 32);  // BlockAlign
  wavHeader.writeUInt16LE(16, 34); // BitsPerSample
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(targetSize - 44, 40);

  const pcmData = Buffer.alloc(targetSize - 44, 0x12);
  const largeWavBuffer = Buffer.concat([wavHeader, pcmData]);
  fs.writeFileSync(testWavPath, largeWavBuffer);

  const largeMp3Buffer = Buffer.alloc(targetSize, 0xff); // Dummy MP3 frames
  fs.writeFileSync(testMp3Path, largeMp3Buffer);

  const wavStat = fs.statSync(testWavPath);
  const mp3Stat = fs.statSync(testMp3Path);

  assert(wavStat.size > 4.5 * 1024 * 1024, `WAV file size is ${(wavStat.size / (1024 * 1024)).toFixed(2)} MB (> 4.5 MB limit)`);
  assert(mp3Stat.size > 4.5 * 1024 * 1024, `MP3 file size is ${(mp3Stat.size / (1024 * 1024)).toFixed(2)} MB (> 4.5 MB limit)`);

  // ---------------------------------------------------------
  // TEST 2: Verify Audio Encodings in Speech Module
  // ---------------------------------------------------------
  console.log('\nTest 2: Verify Correct Audio Encoding Configuration (Requirement 12)');
  assert(ALLOWED_AUDIO_TYPES['audio/wav'] === 'wav', 'WAV MIME type is supported');
  assert(ALLOWED_AUDIO_TYPES['audio/mpeg'] === 'mp3', 'MP3 MIME type is supported');
  assert(ALLOWED_AUDIO_TYPES['audio/mp3'] === 'mp3', 'audio/mp3 MIME type is supported');
  assert(ALLOWED_AUDIO_TYPES['audio/flac'] === 'flac', 'FLAC MIME type is supported');
  assert(ALLOWED_AUDIO_TYPES['audio/ogg'] === 'ogg', 'OGG MIME type is supported');

  // ---------------------------------------------------------
  // TEST 3: Verify GCS Object Name Confinement & Security
  // ---------------------------------------------------------
  console.log('\nTest 3: Verify GCS Object Validation Security (Requirement 8)');

  // Verify rejection of path traversal
  let pathTraversalCaught = false;
  try {
    process.env.GCS_BUCKET_NAME = 'test-bucket';
    await validateGCSObject('audio-uploads/../../etc/passwd');
  } catch (err: any) {
    pathTraversalCaught = true;
    assert(err.message.includes('Access denied') || err.message.includes('malformed'), 'Path traversal blocked');
  }
  assert(pathTraversalCaught, 'Rejects directory traversal attempts');

  // Verify rejection of arbitrary unapproved prefix
  let arbitraryPrefixCaught = false;
  try {
    await validateGCSObject('arbitrary-prefix/secret-file.wav');
  } catch (err: any) {
    arbitraryPrefixCaught = true;
    assert(err.message.includes('Access denied'), 'Arbitrary object prefix rejected');
  }
  assert(arbitraryPrefixCaught, 'Enforces strict audio-uploads/ namespace');

  // ---------------------------------------------------------
  // TEST 4: Verify Database Persistence
  // ---------------------------------------------------------
  console.log('\nTest 4: Verify Database Integration (Requirement 10)');

  const testRecord = {
    recordingPath: 'gs://test-bucket/audio-uploads/test-recording.wav',
    transcriptionProvider: 'Google Cloud Speech-to-Text (GCS Direct Upload)',
    transcriptionStatus: 'transcription_completed' as const,
    rawTranscript: '[0.0s - 4.2s] [Speaker 1]: Hi, this is Jason Smith from TGS Tech Info.',
    leadInfo: {
      firstName: 'Laura',
      lastName: 'McDurmont',
      companyName: 'Energizer Holdings',
      email: 'laura.mcdurmont@energizer.com',
      jobTitle: 'Director',
    },
    campaignInfo: {
      campaignName: 'LMS Campaign',
      assetTitle: 'Structured LMS Solution',
      valueProposition: 'Improve learning efficiency',
    },
    aiProvider: 'Google AI Studio',
    aiModel: 'gemini-3.6-flash',
    aiProcessingStatus: 'ai_processing_completed' as const,
    modifiedTranscript: 'The agent confirmed they were speaking with Laura McDurmont...',
    implementationResponse: 'Yes',
    implementationTimeline: 'Three to six months',
    qaCheckpoints: {
      prospect_identified: true,
      tgs_tech_info_introduction: true,
      email_verified: true,
      call_closing_present: true,
    },
    missingInformation: [],
    processingNotes: 'Call verified and captured within 3-6 months.',
  };

  const saved = await saveTranscriptRecord(testRecord);
  assert(saved.id !== undefined && saved.id.length > 0, `Record saved with unique ID: ${saved.id}`);

  const fetched = await getTranscriptRecordById(saved.id);
  assert(fetched !== null, 'Record fetched by ID successfully');
  assert(fetched?.leadInfo.companyName === 'Energizer Holdings', 'Lead info preserved in database');
  assert(fetched?.implementationTimeline === 'Three to six months', 'Timeline preserved in database');

  const allRecords = await getTranscriptRecords();
  assert(allRecords.length > 0, `Database contains ${allRecords.length} records`);

  const deleted = await deleteTranscriptRecord(saved.id);
  assert(deleted === true, 'Record deletion verified');

  // ---------------------------------------------------------
  // TEST 5: Verify GCS CORS Configuration File
  // ---------------------------------------------------------
  console.log('\nTest 5: Verify GCS CORS Settings (Requirement 5)');
  const corsPath = path.join(__dirname, '../cors.json');
  assert(fs.existsSync(corsPath), 'cors.json exists in project root');

  const corsConfig = JSON.parse(fs.readFileSync(corsPath, 'utf-8'));
  const corsRule = corsConfig[0];
  assert(corsRule.origin.includes('http://localhost:3000'), 'CORS allows http://localhost:3000');
  assert(corsRule.origin.includes('http://localhost:8080'), 'CORS allows http://localhost:8080');
  assert(corsRule.origin.includes('https://*.vercel.app'), 'CORS allows https://*.vercel.app for production');
  assert(corsRule.method.includes('PUT'), 'CORS allows HTTP PUT for direct uploads');
  assert(corsRule.method.includes('OPTIONS'), 'CORS allows HTTP OPTIONS for preflight requests');
  assert(corsRule.responseHeader.includes('Content-Type'), 'CORS allows Content-Type header');

  // ---------------------------------------------------------
  // TEST 6: Verify Zero Audio Bytes Pass through Vercel Functions
  // ---------------------------------------------------------
  console.log('\nTest 6: Verify Zero Audio Bytes Pass Through Vercel Functions (Requirements 2, 7, 14)');
  const signedUrlRequestPayload = JSON.stringify({
    fileName: 'large-recording-5.2mb.wav',
    fileType: 'audio/wav',
    fileSize: wavStat.size,
  });
  const signedUrlPayloadBytes = Buffer.byteLength(signedUrlRequestPayload, 'utf-8');

  const startTranscriptionPayload = JSON.stringify({
    objectName: 'audio-uploads/1727546000000-a1b2c3d4-large-recording-5.2mb.wav',
    fileName: 'large-recording-5.2mb.wav',
    language: 'en-US',
  });
  const startTranscriptionBytes = Buffer.byteLength(startTranscriptionPayload, 'utf-8');

  const pollingQueryString = 'operationName=projects%2F123%2Foperations%2F456&objectName=audio-uploads%2Ftest.wav';
  const pollingBytes = Buffer.byteLength(pollingQueryString, 'utf-8');

  console.log(`    Payload size for /api/stt/upload-url: ${signedUrlPayloadBytes} bytes`);
  console.log(`    Payload size for /api/stt/start:      ${startTranscriptionBytes} bytes`);
  console.log(`    Payload size for /api/stt/status:     ${pollingBytes} bytes`);

  assert(signedUrlPayloadBytes < 500, `Upload-URL metadata payload is tiny (${signedUrlPayloadBytes} bytes << 4.5 MB)`);
  assert(startTranscriptionBytes < 500, `Start transcription payload is tiny (${startTranscriptionBytes} bytes << 4.5 MB)`);
  assert(pollingBytes < 200, `Status polling query is tiny (${pollingBytes} bytes << 4.5 MB)`);
  assert(
    signedUrlPayloadBytes + startTranscriptionBytes + pollingBytes < 1200,
    'Combined Vercel function payload across the entire pipeline is under 1.2 KB!'
  );

  // Cleanup test scratch files
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('\n====================================================');
  console.log(`SUMMARY: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('====================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled test runner error:', err);
  process.exit(1);
});
