console.log('Testing live Next.js API endpoints on http://localhost:3005...\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function run() {
  const baseUrl = 'http://localhost:3005';

  // 1. Test GET /api/records
  console.log('Endpoint 1: GET /api/records');
  const recRes = await fetch(`${baseUrl}/api/records`);
  const recData = await recRes.json();
  assert(recRes.status === 200, 'GET /api/records returns 200 OK');
  assert(recData.success === true, 'Response has success: true');
  assert(Array.isArray(recData.records), 'Response contains records array');

  // 2. Test POST /api/records
  console.log('\nEndpoint 2: POST /api/records');
  const postRecRes = await fetch(`${baseUrl}/api/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordingPath: 'gs://my-bucket/audio-uploads/sample.wav',
      transcriptionProvider: 'Google Cloud Speech-to-Text (GCS Direct Upload)',
      transcriptionStatus: 'transcription_completed',
      rawTranscript: 'Hello world raw transcript',
      leadInfo: { firstName: 'Alice', lastName: 'Smith', companyName: 'Acme', email: 'alice@acme.com', jobTitle: 'VP' },
      campaignInfo: { campaignName: 'Demo', assetTitle: 'LMS Solution', valueProposition: 'Value' },
      aiProvider: 'Google AI Studio',
      aiModel: 'gemini-3.6-flash',
      aiProcessingStatus: 'ai_processing_completed',
      modifiedTranscript: 'Cleaned conversation transcript...',
      implementationResponse: 'Yes',
      implementationTimeline: 'Two to three months',
      qaCheckpoints: { prospect_identified: true },
      missingInformation: [],
      processingNotes: 'Test record created.',
    }),
  });
  const postRecData = await postRecRes.json();
  assert(postRecRes.status === 200, 'POST /api/records returns 200 OK');
  assert(postRecData.success === true, 'Record saved successfully');
  assert(postRecData.record.id !== undefined, `Saved record has ID: ${postRecData.record.id}`);

  // 3. Test that multipart audio file upload to /api/stt/transcribe is rejected
  console.log('\nEndpoint 3: Verify Audio Upload is Rejected on /api/stt/transcribe (No Audio Through Vercel)');
  const fakeMultipartRes = await fetch(`${baseUrl}/api/stt/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ' },
    body: '------WebKitFormBoundaryXYZ\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\n\r\nfakeaudio\r\n------WebKitFormBoundaryXYZ--',
  });
  const fakeMultipartData = await fakeMultipartRes.json();
  assert(fakeMultipartRes.status === 400, 'Direct multipart audio upload returns 400 Bad Request');
  assert(
    fakeMultipartData.error && fakeMultipartData.error.includes('FUNCTION_PAYLOAD_TOO_LARGE'),
    'Error message explicitly explains direct audio uploads are disabled to prevent 413 FUNCTION_PAYLOAD_TOO_LARGE'
  );

  // 4. Test /api/stt/upload-url parameter validation
  console.log('\nEndpoint 4: POST /api/stt/upload-url validation');
  const emptyUploadRes = await fetch(`${baseUrl}/api/stt/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(emptyUploadRes.status === 400, 'Missing fileName returns 400 Bad Request');

  // 5. Test /api/stt/start objectName security validation
  console.log('\nEndpoint 5: POST /api/stt/start security rejection');
  const maliciousStartRes = await fetch(`${baseUrl}/api/stt/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectName: 'arbitrary-bucket/../../secret.wav' }),
  });
  const maliciousStartData = await maliciousStartRes.json();
  assert(maliciousStartRes.status === 400, 'Malicious object path returns 400 Bad Request');
  assert(
    maliciousStartData.error && (maliciousStartData.error.includes('Access denied') || maliciousStartData.error.includes('Unauthorized')),
    'Rejection message explicitly enforces security confinement'
  );

  console.log('\n====================================================');
  console.log(`LIVE ENDPOINTS SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
