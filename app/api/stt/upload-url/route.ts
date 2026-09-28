import { NextRequest, NextResponse } from 'next/server';
import { generateV4UploadSignedUrl } from '@/lib/gcs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileName, fileType, fileSize } = body;

    if (!fileName || typeof fileName !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid "fileName" parameter.' },
        { status: 400 }
      );
    }

    if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid "fileSize" parameter.' },
        { status: 400 }
      );
    }

    // Generate short-lived v4 signed PUT URL for direct browser-to-GCS upload
    const result = await generateV4UploadSignedUrl({
      fileName,
      fileType: fileType || 'audio/wav',
      fileSize,
    });

    return NextResponse.json({
      success: true,
      uploadUrl: result.uploadUrl,
      objectName: result.objectName,
      gcsUri: result.gcsUri,
      contentType: result.contentType,
      expiresInSeconds: result.expiresInSeconds,
      bucketName: result.bucketName,
    });
  } catch (error) {
    console.error('Error generating GCS signed upload URL:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate upload URL';
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
