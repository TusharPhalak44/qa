import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TranscriptRecord } from './types';

// In-memory cache for fast access and serverless runtime support
const recordsCache: Map<string, TranscriptRecord & { id: string }> = new Map();

function getDbFilePath(): string {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {
      // In read-only serverless environments, file write may fail, fall back to memory
    }
  }
  return path.join(dataDir, 'records.json');
}

function loadRecordsFromFile(): void {
  try {
    const filePath = getDbFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const records: (TranscriptRecord & { id: string })[] = JSON.parse(data);
      records.forEach(r => {
        if (r.id) recordsCache.set(r.id, r);
      });
    }
  } catch (err) {
    console.warn('Could not read records file from disk, using memory store:', err);
  }
}

// Initial load
loadRecordsFromFile();

function persistRecordsToFile(): void {
  try {
    const filePath = getDbFilePath();
    const records = Array.from(recordsCache.values());
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not persist records to disk (serverless runtime or read-only fs):', err);
  }
}

export async function saveTranscriptRecord(
  record: Omit<TranscriptRecord, 'processedAt'> & { id?: string; processedAt?: string }
): Promise<TranscriptRecord & { id: string }> {
  const id = record.id || crypto.randomUUID();
  const processedAt = record.processedAt || new Date().toISOString();

  const fullRecord: TranscriptRecord & { id: string } = {
    ...record,
    id,
    processedAt,
  };

  recordsCache.set(id, fullRecord);
  persistRecordsToFile();

  return fullRecord;
}

export async function getTranscriptRecords(limit = 50): Promise<(TranscriptRecord & { id: string })[]> {
  const records = Array.from(recordsCache.values());
  records.sort((a, b) => {
    const dateA = new Date(a.processedAt || 0).getTime();
    const dateB = new Date(b.processedAt || 0).getTime();
    return dateB - dateA;
  });
  return records.slice(0, limit);
}

export async function getTranscriptRecordById(id: string): Promise<(TranscriptRecord & { id: string }) | null> {
  return recordsCache.get(id) || null;
}

export async function deleteTranscriptRecord(id: string): Promise<boolean> {
  const deleted = recordsCache.delete(id);
  if (deleted) {
    persistRecordsToFile();
  }
  return deleted;
}
