import { NextRequest, NextResponse } from 'next/server';
import { validateGCSObject } from '@/lib/gcs';
import { startAsyncRecognition } from '@/lib/speech';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { objectName, language, fileName } = body;

    if (!objectName || typeof objectName !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid "objectName" parameter.' },
        { status: 400 }
      );
    }

    // Step 1: Validate the uploaded object in GCS before invoking Speech-to-Text
    // Enforces confined namespace, existence, file size, and audio MIME type.
    const validated = await validateGCSObject(objectName);

    // Step 2: Invoke Google Speech-to-Text asynchronous longRunningRecognize
    const operationName = await startAsyncRecognition({
      gcsUri: validated.gcsUri,
      contentType: validated.contentType,
      originalFileName: fileName || objectName,
      language: language || 'en-US',
    });

    return NextResponse.json({
      success: true,
      operationName,
      objectName: validated.objectName,
      gcsUri: validated.gcsUri,
      fileSize: validated.size,
      contentType: validated.contentType,
      message: 'Asynchronous Speech-to-Text operation started successfully.',
    });
  } catch (error) {
    console.error('Error starting Speech-to-Text recognition:', error);
    const message = error instanceof Error ? error.message : 'Failed to start transcription';
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 400 }
    );
  }
}
