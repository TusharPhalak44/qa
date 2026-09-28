import { NextRequest, NextResponse } from 'next/server';
import { getBucketCors, setBucketCors } from '@/lib/gcs';

export async function GET() {
  try {
    const cors = await getBucketCors();
    return NextResponse.json({
      success: true,
      cors,
    });
  } catch (error) {
    console.error('Error fetching bucket CORS:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bucket CORS',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const customOrigins = body.origins || [];
    const appliedConfig = await setBucketCors(customOrigins);
    return NextResponse.json({
      success: true,
      message: 'Bucket CORS configuration applied successfully.',
      cors: appliedConfig,
    });
  } catch (error) {
    console.error('Error applying bucket CORS:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply bucket CORS configuration',
      },
      { status: 500 }
    );
  }
}
