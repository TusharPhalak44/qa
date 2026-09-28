import { NextRequest, NextResponse } from 'next/server';
import { getAsyncRecognitionStatus } from '@/lib/speech';
import { deleteGCSObject } from '@/lib/gcs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const operationName = searchParams.get('operationName');
    const objectName = searchParams.get('objectName');
    const cleanup = searchParams.get('cleanup') !== 'false';

    if (!operationName) {
      return NextResponse.json(
        { success: false, error: 'Missing required "operationName" parameter.' },
        { status: 400 }
      );
    }

    const status = await getAsyncRecognitionStatus(operationName);

    if (!status.done) {
      return NextResponse.json({
        done: false,
        progressPercent: status.progressPercent,
        operationName,
      });
    }

    // Operation completed
    if (status.error) {
      if (cleanup && objectName) {
        await deleteGCSObject(objectName).catch(() => {});
      }
      return NextResponse.json(
        {
          done: true,
          success: false,
          error: status.error,
        },
        { status: 500 }
      );
    }

    // Success: Clean up temporary GCS object
    if (cleanup && objectName) {
      await deleteGCSObject(objectName).catch(() => {});
    }

    return NextResponse.json({
      done: true,
      success: true,
      rawTranscript: status.rawTranscript || '',
      transcriptionStatus: 'transcription_completed',
      transcriptionProvider: 'Google Cloud Speech-to-Text (Asynchronous)',
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error polling Speech-to-Text operation status:', error);
    const message = error instanceof Error ? error.message : 'Failed to check operation status';
    return NextResponse.json(
      {
        success: false,
        done: true,
        error: message,
      },
      { status: 500 }
    );
  }
}
