import { NextRequest, NextResponse } from 'next/server';
import { getTranscriptRecords, saveTranscriptRecord, deleteTranscriptRecord } from '@/lib/db';
import { TranscriptRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const records = await getTranscriptRecords(limit);
    return NextResponse.json({
      success: true,
      records,
    });
  } catch (error) {
    console.error('Error fetching transcript records:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch records',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: TranscriptRecord = await request.json();

    if (!body.rawTranscript && !body.modifiedTranscript) {
      return NextResponse.json(
        { success: false, error: 'Record must contain at least a raw or modified transcript.' },
        { status: 400 }
      );
    }

    const saved = await saveTranscriptRecord(body);
    return NextResponse.json({
      success: true,
      record: saved,
      message: 'Transcript record successfully saved to database.',
    });
  } catch (error) {
    console.error('Error saving transcript record:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save record',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing required "id" parameter.' },
        { status: 400 }
      );
    }

    const deleted = await deleteTranscriptRecord(id);
    return NextResponse.json({
      success: true,
      deleted,
    });
  } catch (error) {
    console.error('Error deleting transcript record:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete record',
      },
      { status: 500 }
    );
  }
}
